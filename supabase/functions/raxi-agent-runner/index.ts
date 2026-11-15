// Raxi HQ — agent runner (Modo Autónomo).
// Processes ONE queued row of public.raxi_agent_jobs per invocation. Jobs are only created by the
// owner-checked, budget-checked RPC raxi_request_agent_job (or by privileged roles), so a caller can
// never create work or choose tools: request bodies are ignored.
// Secrets (server only): ANTHROPIC_API_KEY, ARIA_MCP_URL, ARIA_MCP_TOKEN.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

const MODELS = {
  sonnet: { id: "claude-sonnet-5-5", inPerM: 2, outPerM: 10 },
  haiku: { id: "claude-haiku-5-5", inPerM: 0.1, outPerM: 0.5 },
} as const;
const WEB_SEARCH_USD = 0.01; // $10 per 1,000 searches
const MCP_BETA = "mcp-client-2025-11-20";
// Aria tools that never spend money. generar_imagen is NOT enabled in any step here.
const ARIA_READ_ONLY = ["mis_personajes", "modelos", "saldo"];
const STAGE: Record<string, { stage: string; agent: string }> = {
  SMOKE: { stage: "DIRECTOR", agent: "director" },
  BRIEF: { stage: "DIRECTOR", agent: "director" },
  STRATEGY: { stage: "DIRECTOR", agent: "director" },
  RESEARCH: { stage: "RESEARCHER", agent: "researcher" },
  DESIGN: { stage: "CREATIVE", agent: "creative" },
  REVIEW: { stage: "DIRECTOR", agent: "director" },
};
// Who hands what to whom before a step starts (shown as a walk in the office).
const HANDOFF: Record<string, { from: string; fromStage: string; artifact: string; after: string }> = {
  RESEARCH: { from: "director", fromStage: "DIRECTOR", artifact: "RESEARCH_BRIEF", after: "BRIEF" },
  STRATEGY: { from: "researcher", fromStage: "RESEARCHER", artifact: "RESEARCH_REPORT", after: "RESEARCH" },
  DESIGN: { from: "director", fromStage: "DIRECTOR", artifact: "STRATEGY_BRIEF", after: "STRATEGY" },
  REVIEW: { from: "creative", fromStage: "CREATIVE", artifact: "DESIGN_PACKAGE", after: "DESIGN" },
};

type Usage = { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number; server_tool_use?: { web_search_requests?: number } };

function cost(model: keyof typeof MODELS, u: Usage): number {
  const m = MODELS[model];
  const input = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) * 1.25 + (u.cache_read_input_tokens ?? 0) * 0.1;
  return (input * m.inPerM + (u.output_tokens ?? 0) * m.outPerM) / 1e6 + (u.server_tool_use?.web_search_requests ?? 0) * WEB_SEARCH_USD;
}

function addUsage(a: Usage, b: Usage): Usage {
  return {
    input_tokens: (a.input_tokens ?? 0) + (b.input_tokens ?? 0),
    output_tokens: (a.output_tokens ?? 0) + (b.output_tokens ?? 0),
    cache_creation_input_tokens: (a.cache_creation_input_tokens ?? 0) + (b.cache_creation_input_tokens ?? 0),
    cache_read_input_tokens: (a.cache_read_input_tokens ?? 0) + (b.cache_read_input_tokens ?? 0),
    server_tool_use: { web_search_requests: (a.server_tool_use?.web_search_requests ?? 0) + (b.server_tool_use?.web_search_requests ?? 0) },
  };
}

// One Claude call, following pause_turn continuations for long server-tool loops.
async function callClaude(opts: { model: keyof typeof MODELS; system: string; prompt: string; maxTokens: number; webSearch?: number; aria?: boolean }) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!,
    "anthropic-version": "2023-06-01",
  };
  const tools: unknown[] = [];
  const body: Record<string, unknown> = { model: MODELS[opts.model].id, max_tokens: opts.maxTokens, system: opts.system };
  if (opts.webSearch) tools.push({ type: "web_search_20250305", name: "web_search", max_uses: opts.webSearch });
  if (opts.aria) {
    headers["anthropic-beta"] = MCP_BETA;
    body.mcp_servers = [{ type: "url", url: Deno.env.get("ARIA_MCP_URL")!, name: "aria", authorization_token: Deno.env.get("ARIA_MCP_TOKEN")! }];
    tools.push({
      type: "mcp_toolset", mcp_server_name: "aria", default_config: { enabled: false },
      configs: Object.fromEntries(ARIA_READ_ONLY.map((t) => [t, { enabled: true }])),
    });
  }
  if (tools.length) body.tools = tools;
  const messages: { role: string; content: unknown }[] = [{ role: "user", content: opts.prompt }];
  let usage: Usage = {};
  let stopReason = "";
  const content: Record<string, unknown>[] = [];
  for (let turn = 0; turn < 4; turn++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers, body: JSON.stringify({ ...body, messages }) });
    const json = await res.json();
    if (!res.ok) throw new Error(`Claude API ${res.status}: ${String(json?.error?.message ?? "error").slice(0, 300)}`);
    usage = addUsage(usage, json.usage ?? {});
    content.push(...(json.content ?? []));
    stopReason = String(json.stop_reason ?? "");
    if (json.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: json.content });
  }
  const text = content.filter((b) => b.type === "text").map((b) => String(b.text)).join("");
  const sources = new Map<string, string>();
  for (const b of content) for (const c of (b.citations as { url?: string; title?: string }[] | undefined) ?? []) if (c.url) sources.set(c.url, c.title ?? c.url);
  return { text, usage, stopReason, cost: cost(opts.model, usage), sources: [...sources].map(([url, title]) => ({ url, title })) };
}

function lastJson(text: string): unknown {
  const fences = [...text.matchAll(/```json\s*([\s\S]*?)```/g)];
  const raw = fences.length ? fences[fences.length - 1][1] : text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  try { return JSON.parse(raw); } catch { return null; }
}

function rulesOf(profile: Record<string, unknown> | null): string {
  const rules = (profile?.capability_config as { owner_rules?: string[] } | undefined)?.owner_rules ?? [];
  return rules.map((r, i) => `${i + 1}. ${r}`).join("\n");
}

const COMMON = `Eres parte del equipo de agentes de Raxi HQ, la oficina de IA de Luis (dueño) para campañas de personajes virtuales adultos.
Escribe en español de México. Nunca inventes datos, cifras, cuentas ni fuentes; si algo no se pudo verificar, dilo explícitamente.
No generes imágenes ni gastes créditos de Aria Studio. Distingue hechos verificados, inferencias e hipótesis.`;

const TITLES: Record<string, string> = { BRIEF: "Brief del Director", RESEARCH: "Investigar", STRATEGY: "Análisis y estrategia del Director",
  DESIGN: "Diseñar", REVIEW: "Revisión del Director" };
const CHANNELS = new Set(["INSTAGRAM", "INSTAGRAM_STORY", "TEASER", "FANVUE_FEED", "FANVUE_CHAT"]);
const txt = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Short, factual list of what already exists in the Fototeca, so the Creative can reuse real photos. */
async function archiveSummary(db: SupabaseClient, ws: string): Promise<string> {
  const { data: cols } = await db.from("raxi_portfolio_collections").select("id, external_id, title").eq("workspace_id", ws).limit(20);
  const lines: string[] = [];
  for (const c of cols ?? []) {
    const { data: items } = await db.from("raxi_portfolio_items").select("position, alt_text, asset_id").eq("collection_id", c.id).order("position");
    const withPhoto = (items ?? []).filter((i) => i.asset_id);
    if (!withPhoto.length) continue;
    lines.push(`- ${c.external_id} (${c.title}):`);
    for (const i of withPhoto) lines.push(`  ${i.position}: ${txt(i.alt_text, 160)}`);
  }
  return lines.join("\n") || "(ninguna)";
}

/**
 * Turns an approved-for-design campaign into a DRAFT Fototeca collection.
 * New photos → one item per post with "foto pendiente". Reel from archived photos → items that point to the
 * existing assets in montage order (no duplicates, no new files). Never overwrites anything the owner already decided.
 */
async function materializeCampaign(db: SupabaseClient, job: Record<string, unknown>, proposal: Record<string, unknown>, data: Record<string, unknown>, meta: Record<string, unknown>) {
  const ws = String(job.workspace_id);
  const externalId = `CAMP-${String(proposal.external_id).replace(/^PROP-/, "")}`.slice(0, 128);
  const channel = CHANNELS.has(String(proposal.channel)) ? String(proposal.channel) : "INSTAGRAM";
  const isReel = String(proposal.channel) === "REELS" || (Array.isArray(data.montaje) && data.montaje.length > 0 && !(Array.isArray(data.publicaciones) && data.publicaciones.length));
  type Row = { position: number; asset_id: string | null; aria_file: string | null; caption: string | null; alt_text: string | null; crop: string; payload: Record<string, unknown> };
  const rows: Row[] = [];
  if (isReel) {
    const { data: source } = await db.from("raxi_portfolio_collections").select("id").eq("workspace_id", ws).eq("external_id", txt(data.coleccion_existente, 128)).maybeSingle();
    const { data: srcItems } = source ? await db.from("raxi_portfolio_items").select("position, asset_id, aria_file, alt_text").eq("collection_id", source.id) : { data: [] };
    const byPos = new Map((srcItems ?? []).map((i) => [Number(i.position), i]));
    (data.montaje as Record<string, unknown>[]).slice(0, 60).forEach((step, idx) => {
      const src = byPos.get(Number(step.posicion));
      rows.push({ position: idx + 1, asset_id: src?.asset_id ?? null, aria_file: src?.aria_file ?? null,
        caption: txt(step.texto_pantalla, 2200) || null, alt_text: src?.alt_text ?? null, crop: "9:16",
        payload: { kind: "REEL_STEP", seconds: Number(step.segundos) || null, source_collection: txt(data.coleccion_existente, 128), source_position: Number(step.posicion) || null, job: job.id } });
    });
  } else {
    ((data.publicaciones as Record<string, unknown>[] | undefined) ?? []).slice(0, 30).forEach((post, idx) => {
      rows.push({ position: idx + 1, asset_id: null, aria_file: null, caption: txt(post.texto, 2200) || null, alt_text: txt(post.alt, 1000) || null,
        crop: channel === "INSTAGRAM_STORY" ? "9:16" : "4:5",
        payload: { kind: "PHOTO_TO_GENERATE", scene: txt(post.escena, 500), shot: txt(post.plano, 200), prompt: txt(post.prompt, 6000), job: job.id } });
    });
  }
  const concept = [txt(data.concepto, 2000), txt(data.microhistoria, 1900)].filter(Boolean).join("\n\n") || null;
  const payload = { proposal: proposal.external_id, job: job.id, format: isReel ? "REEL" : "POSTS", model: txt(data.modelo_aria, 300),
    estimated_cost_usd: Number(data.costo_estimado_usd) || 0, qa_checklist: Array.isArray(data.checklist_qa) ? data.checklist_qa.slice(0, 20) : [],
    objective: txt(meta.objetivo, 600), audience: txt(meta.audiencia, 600), primary_metric: txt(meta.metrica_principal, 300), cta: txt(meta.cta, 300),
    calendar: Array.isArray(meta.calendario) ? meta.calendario.slice(0, 30) : [], approved_by: "director", review_job: job.id };
  const hashtags = (Array.isArray(meta.hashtags) ? meta.hashtags : []).map((h) => txt(h, 60).replace(/^#?/, "#")).filter((h) => h.length > 1).slice(0, 30);

  const { data: existing } = await db.from("raxi_portfolio_collections").select("id").eq("workspace_id", ws).eq("external_id", externalId).maybeSingle();
  let collectionId = existing?.id as string | undefined;
  if (collectionId) {
    const { data: items } = await db.from("raxi_portfolio_items").select("human_decision, status").eq("collection_id", collectionId);
    if ((items ?? []).some((i) => i.human_decision !== "PENDING" || i.status !== "DRAFT"))
      return { externalId, collectionId, items: 0, kept: true, note: "La campaña ya tiene decisiones tuyas; no se reemplazó." };
    await db.from("raxi_portfolio_items").delete().eq("collection_id", collectionId);
    await db.from("raxi_portfolio_collections").update({ title: txt(proposal.title, 160), channel, concept, payload, status: "DRAFT", updated_at: new Date().toISOString() }).eq("id", collectionId);
  } else {
    const { data: created, error } = await db.from("raxi_portfolio_collections").insert({ workspace_id: ws, external_id: externalId,
      character_id: txt(proposal.character_id, 64) || "vesper-corvus", title: txt(proposal.title, 160), channel, status: "DRAFT", concept, payload }).select("id").single();
    if (error || !created) throw new Error(`No se pudo crear la campaña en la Fototeca: ${error?.message ?? ""}`.slice(0, 300));
    collectionId = created.id;
  }
  if (rows.length) {
    const { error } = await db.from("raxi_portfolio_items").insert(rows.map((r) => ({ ...r, workspace_id: ws, collection_id: collectionId, hashtags,
      qa_status: "VISUAL_REVIEW_REQUIRED", human_decision: "PENDING", status: "DRAFT" })));
    if (error) throw new Error(`No se pudieron crear las publicaciones: ${error.message}`.slice(0, 300));
  }
  await db.from("raxi_audit_events").insert({ workspace_id: ws, action: "CAMPAIGN_DRAFT_CREATED", actor_kind: "AGENT", resource_kind: "raxi_portfolio_collections",
    resource_id: collectionId, source_ref: `raxi-agent-runner:${job.id}`, details: { externalId, items: rows.length, format: payload.format }, occurred_at: new Date().toISOString(), recorded_at: new Date().toISOString() });
  return { externalId, collectionId, items: rows.length, kept: false, format: payload.format };
}

async function lastOutput(db: SupabaseClient, proposalId: unknown, kind: string): Promise<Record<string, unknown> | null> {
  const { data } = await db.from("raxi_agent_jobs").select("output").eq("proposal_id", proposalId).eq("kind", kind)
    .in("status", ["SUCCEEDED"]).order("finished_at", { ascending: false }).limit(1).maybeSingle();
  return (data?.output as Record<string, unknown>) ?? null;
}

async function runJob(db: SupabaseClient, job: Record<string, unknown>) {
  const kind = String(job.kind);
  const meta = STAGE[kind];
  if (!meta) throw new Error("unsupported job kind");
  const { data: profile } = await db.from("raxi_agent_profiles").select("id, capability_config")
    .eq("workspace_id", job.workspace_id).eq("agent_key", meta.agent).single();
  const proposal = job.proposal_id
    ? (await db.from("raxi_team_proposals").select("*").eq("id", job.proposal_id).single()).data
    : null;

  const input = (job.input ?? {}) as Record<string, unknown>;
  // Visible, verified activity in the office.
  const taskId = crypto.randomUUID();
  const now = () => new Date().toISOString();
  await db.from("raxi_agent_tasks").insert({
    id: taskId, workspace_id: job.workspace_id, agent_id: profile?.id ?? null, external_id: `JOB-${String(job.id).slice(0, 8)}-${kind}`,
    title: `${TITLES[kind] ?? "Prueba de conexión"}${proposal ? `: ${proposal.title}` : ""}`.slice(0, 1400),
    status: "RUNNING", input_snapshot: { runtime: "true", policy: { simulated: false }, executor: "claude-api", job: job.id }, started_at: now(),
  });
  const event = (type: string) => db.from("raxi_agent_events").insert({
    workspace_id: job.workspace_id, agent_id: profile?.id ?? null, task_id: taskId, event_type: type,
    source_kind: "AGENT_EXECUTOR", evidence_status: "VERIFIED", source_ref: `raxi-agent-runner:${job.id}`,
    payload: { simulated: false, stage: meta.stage, leaseUntil: new Date(Date.now() + 10 * 60_000).toISOString(), executor: "claude-api" },
    occurred_at: now(),
  });
  const hand = HANDOFF[kind];
  if (hand && profile?.id) {
    // The previous agent hands its finished work to this one: a real, verified step shown as a walk in the office.
    const { data: giver } = await db.from("raxi_agent_profiles").select("id")
      .eq("workspace_id", job.workspace_id).eq("agent_key", hand.from).single();
    if (giver?.id && giver.id !== profile.id) {
      await db.from("raxi_agent_events").insert({
        workspace_id: job.workspace_id, agent_id: giver.id, task_id: taskId, event_type: "RUNTIME_HANDOFF",
        source_kind: "AGENT_EXECUTOR", evidence_status: "VERIFIED", source_ref: `raxi-agent-runner:${job.id}`,
        payload: { simulated: false, stage: hand.fromStage, leaseUntil: new Date(Date.now() + 10 * 60_000).toISOString(),
          targetAgentId: profile.id, artifact: hand.artifact, executor: "claude-api" },
        occurred_at: now(),
      });
      await new Promise((r) => setTimeout(r, 9000)); // let the office show the delivery before the receiver starts
    }
  }
  await event("RUNTIME_ACKNOWLEDGED");
  const heartbeat = setInterval(() => { void db.from("raxi_agent_tasks").update({ updated_at: now() }).eq("id", taskId); }, 30_000);

  try {
    let result: { text: string; usage: Usage; stopReason: string; cost: number; sources: { url: string; title: string }[] };
    let model: keyof typeof MODELS;
    if (kind === "SMOKE") {
      model = "haiku";
      result = await callClaude({ model, maxTokens: 600, aria: true, system: COMMON,
        prompt: "Prueba de conexión. Usa las herramientas de Aria Studio mis_personajes y modelos. Responde SOLO un bloque ```json con {\"personajes\": [ids], \"modelos_disponibles\": número, \"ok\": true}." });
    } else if (kind === "BRIEF") {
      model = "sonnet";
      result = await callClaude({ model, maxTokens: 2500, system: `${COMMON}\nEres el Director IA de Raxi HQ. Recibes una idea aceptada por el dueño y defines el trabajo antes de delegar. No investigas tú: encargas.\nReglas del dueño:\n${rulesOf(profile)}`,
        prompt: `Idea aceptada: ${proposal?.title} (${proposal?.channel}, personaje ${proposal?.character_id}).\nResumen: ${proposal?.summary}\nPor qué: ${proposal?.rationale ?? "—"}\n\n` +
          `Evalúa viabilidad y define el encargo para el Investigador. Termina con un bloque \`\`\`json {"viable":true,"objetivo_trabajo","preguntas_investigacion":[],"criterios_exito":[],"riesgos":[],"notas_para_el_equipo"}\`\`\`. Breve y concreto.` });
    } else if (kind === "STRATEGY") {
      model = "sonnet";
      const research = await lastOutput(db, job.proposal_id, "RESEARCH");
      const brief = await lastOutput(db, job.proposal_id, "BRIEF");
      const prev = input.owner_note ? await lastOutput(db, job.proposal_id, "STRATEGY") : null;
      result = await callClaude({ model, maxTokens: 6000, system: `${COMMON}\nEres el Director IA de Raxi HQ. Evalúas la investigación con criterio y conviertes los hallazgos en una estrategia de campaña. El dueño debe aprobarla antes de que el equipo creativo empiece.\nReglas del dueño:\n${rulesOf(profile)}`,
        prompt: `Campaña: ${proposal?.title} (${proposal?.channel}, personaje ${proposal?.character_id}).\nResumen: ${proposal?.summary}\n\n` +
          `Tu encargo inicial (JSON):\n${JSON.stringify(brief?.data ?? {}).slice(0, 4000)}\n\nInvestigación entregada (JSON):\n${JSON.stringify(research?.data ?? {}).slice(0, 12000)}\n\n` +
          (input.owner_note ? `El dueño revisó tu estrategia anterior y pidió estos cambios (obligatorios):\n${String(input.owner_note).slice(0, 1000)}\n\nEstrategia anterior (JSON):\n${JSON.stringify(prev?.data ?? {}).slice(0, 6000)}\n\n` : "") +
          `1) Evalúa la investigación: ¿responde el encargo, cumple las reglas (≥2-3 modelos digitales además de cualquier referencia), separa hechos de hipótesis? Si falta algo esencial, decide "MAS_INVESTIGACION" con preguntas concretas (solo si de verdad es necesario). ` +
          `2) Si es suficiente, redacta la estrategia: objetivo, audiencia, plataformas y rol de cada una (Instagram/Stories/Reels/Fanvue), etapa del funnel, mensajes clave, formatos, duración, métrica principal y secundarias, hipótesis a medir, riesgos y cómo mitigarlos. ` +
          `Termina con un bloque \`\`\`json {"decision":"SUFICIENTE|MAS_INVESTIGACION","evaluacion_investigacion","preguntas_extra":[],"estrategia":{"objetivo","audiencia","plataformas":[{"plataforma","rol"}],"funnel","mensajes_clave":[],"formatos":[],"duracion","metrica_principal","metricas_secundarias":[],"hipotesis":[],"riesgos":[{"riesgo","mitigacion"}]}}\`\`\`. Si la decisión es MAS_INVESTIGACION, "estrategia" va en null.` });
    } else if (kind === "RESEARCH") {
      model = "sonnet";
      result = await callClaude({ model, maxTokens: 8000, webSearch: 8, system: `${COMMON}\nEres el Investigador.\nReglas del dueño:\n${rulesOf(profile)}`,
        prompt: `Campaña aceptada por el dueño:\n- Título: ${proposal?.title}\n- Personaje: ${proposal?.character_id}\n- Canal: ${proposal?.channel}\n- Resumen: ${proposal?.summary}\n\n` +
          (input.brief ? `Encargo del Director (JSON):\n${JSON.stringify(input.brief).slice(0, 4000)}\n\n` : "") +
          (input.follow_up ? `El Director revisó tu investigación anterior y pide responder específicamente:\n${JSON.stringify(input.follow_up).slice(0, 3000)}\n\n` : "") +
          `Investiga en la web al menos 3 modelos o creadoras digitales/virtuales (cuentas de IA o personajes virtuales) con estética o propuesta parecida a este personaje. ` +
          `Para cada una: nombre o usuario, plataforma, por qué es comparable y qué patrones de contenido usa (formatos, escenarios, encuadres, textos, ritmo de publicación). ` +
          `Incluye cifras solo si aparecen en una fuente, con su fecha. Luego sintetiza patrones adaptables a esta campaña, qué NO copiar y 2-3 hipótesis medibles.\n` +
          `Termina con un bloque \`\`\`json {"modelos":[{"nombre","plataforma","por_que","patrones":[],"fuentes":[]}],"patrones_adaptables":[],"no_copiar":[],"hipotesis":[],"limitaciones":""}\`\`\`.` });
    } else if (kind === "REVIEW") {
      model = "sonnet";
      const research = await lastOutput(db, job.proposal_id, "RESEARCH");
      const design = await lastOutput(db, job.proposal_id, "DESIGN");
      const strategy = (await lastOutput(db, job.proposal_id, "STRATEGY"))?.data as Record<string, unknown> | undefined;
      const archive = await archiveSummary(db, String(job.workspace_id));
      result = await callClaude({ model, maxTokens: 16000, aria: true, system: `${COMMON}\nEres el Director IA de Raxi HQ: revisas el trabajo del equipo antes de que exista una campaña. Eres exigente y honesto: si algo no cumple, lo regresas.\nReglas del dueño:\n${rulesOf(profile)}`,
        prompt: `Campaña: ${proposal?.title} (${proposal?.channel}, personaje ${proposal?.character_id}).\nResumen: ${proposal?.summary}\n\n` +
          (strategy?.estrategia ? `Estrategia aprobada por el dueño (JSON):\n${JSON.stringify(strategy.estrategia).slice(0, 6000)}\n\n` : "") +
          `Investigación (JSON):\n${JSON.stringify(research?.data ?? {}).slice(0, 8000)}\n\nDiseño del Director Creativo (JSON):\n${JSON.stringify(design?.data ?? {}).slice(0, 20000)}\n\n` +
          `Fotos que ya existen en la Fototeca:\n${archive}\n\n` +
          `Usa mis_personajes de Aria para comprobar que el diseño respeta la identidad exacta del personaje, y modelos/saldo para comprobar costo y saldo reales. ` +
          `Revisa: que el diseño cumpla la estrategia aprobada, coherencia con la investigación, identidad y edad adulta, que los prompts sean autónomos y sin contradicciones (POV, luz, vestuario), que las fotos citadas existan, textos, riesgos de plataforma (etiqueta de IA, nada explícito en Instagram), costo vs. tope de $2 por campaña. ` +
          `Si todo cumple, aprueba y entrega el paquete final de campaña (puedes corregir textos menores). Si hay problemas de fondo, pide cambios concretos y no entregues paquete.\n` +
          `Termina con un bloque \`\`\`json {"veredicto":"APROBADA|CAMBIOS","revision":[{"punto","estado":"OK|FALLA","nota"}],"cambios_requeridos":[],` +
          `"campana":{"objetivo","audiencia","metrica_principal","cta","calendario":[{"dia","publicacion"}],"hashtags":[]},` +
          `"paquete":{"concepto","microhistoria","publicaciones":[{"posicion","escena","plano","prompt","texto","alt"}],"coleccion_existente":null,"montaje":[{"posicion","segundos","texto_pantalla"}],"modelo_aria","costo_estimado_usd","checklist_qa":[]}}\`\`\`. Si el veredicto es CAMBIOS, "campana" y "paquete" van en null.` });
    } else {
      model = "sonnet";
      const archive = await archiveSummary(db, String(job.workspace_id));
      const research = { output: await lastOutput(db, job.proposal_id, "RESEARCH") };
      const lastReview = (await lastOutput(db, job.proposal_id, "REVIEW"))?.data as Record<string, unknown> | undefined;
      const strategy = (await lastOutput(db, job.proposal_id, "STRATEGY"))?.data as Record<string, unknown> | undefined;
      const notes = lastReview && lastReview.veredicto === "CAMBIOS" ? JSON.stringify(lastReview.cambios_requeridos ?? []).slice(0, 4000) : "";
      result = await callClaude({ model, maxTokens: 16000, aria: true, system: `${COMMON}\nEres el Director Creativo.\nReglas del dueño:\n${rulesOf(profile)}`,
        prompt: `Campaña: ${proposal?.title} (${proposal?.channel}, personaje ${proposal?.character_id}).\nResumen: ${proposal?.summary}\n\n` +
          `Investigación previa (JSON):\n${JSON.stringify(research?.output?.data ?? {}).slice(0, 12000)}\n\n` +
          (strategy?.estrategia ? `Estrategia aprobada por el dueño (JSON, obligatoria):\n${JSON.stringify(strategy.estrategia).slice(0, 6000)}\n\n` : "") +
          (notes ? `El Director pidió estos cambios a tu diseño anterior; atiéndelos todos:\n${notes}\n\n` : "") +
          `Fotos que ya existen en la Fototeca (colección → posición: descripción):\n${archive}\n\n` +
          `Usa la herramienta mis_personajes de Aria para respetar la identidad exacta del personaje y modelos para el precio real por imagen. ` +
          `Diseña el paquete de la campaña: concepto, microhistoria y publicaciones. Si es un Reel hecho con fotos ya existentes, entrega un kit de montaje (foto, segundos, texto en pantalla, ambiente musical) sin generar nada, indicando en "coleccion_existente" el id de la colección usada y en cada paso "posicion" con el número de la foto en esa colección; en ese caso "publicaciones" va vacío. Sé conciso: textos breves y prompts completos pero sin repetir. ` +
          `Si requiere fotos nuevas: un prompt autónomo en inglés por foto (identidad, escena, vestuario, cámara/POV correcto, luz, realismo, salida única), texto bilingüe ES/EN breve y texto alternativo. ` +
          `Recomienda modelo de Aria y calcula el costo estimado total con los precios reales devueltos por la herramienta.\n` +
          `Termina con un bloque \`\`\`json {"concepto","microhistoria","publicaciones":[{"posicion","escena","plano","prompt","texto","alt"}],"coleccion_existente":null,"montaje":[{"posicion","segundos","texto_pantalla"}],"modelo_aria","costo_estimado_usd","checklist_qa":[]}\`\`\`.` });
    }
    const output: Record<string, unknown> = { markdown: result.text.slice(0, 60000), data: lastJson(result.text), sources: result.sources, model: MODELS[model].id };
    const incomplete = result.stopReason === "max_tokens" ? "La respuesta quedó cortada por su longitud. Vuelve a intentarlo."
      : ["BRIEF", "STRATEGY", "DESIGN", "REVIEW"].includes(kind) && !output.data ? "La respuesta no incluyó un bloque de datos válido. Vuelve a intentarlo." : null;
    if (incomplete) throw Object.assign(new Error(incomplete), { partial: { output, usage: result.usage, cost: result.cost } });
    if (kind === "REVIEW" && proposal) {
      const d = output.data as Record<string, unknown>;
      if (d.veredicto === "APROBADA" && d.paquete && typeof d.paquete === "object")
        output.campaign = await materializeCampaign(db, job, proposal, d.paquete as Record<string, unknown>, (d.campana as Record<string, unknown>) ?? {});
    }
    await db.from("raxi_agent_jobs").update({
      status: "SUCCEEDED", output, usage: result.usage, cost_usd: Number(result.cost.toFixed(4)), finished_at: now(), updated_at: now(),
    }).eq("id", job.id);
    await db.from("raxi_agent_tasks").update({ status: "COMPLETED", completed_at: now(), updated_at: now(),
      output_snapshot: { summary: `Listo · costo $${result.cost.toFixed(4)}`, job: job.id } }).eq("id", taskId);
    await event("RUNTIME_RESULT_COMMITTED");
  } catch (e) {
    const message = e instanceof Error ? e.message.slice(0, 900) : "error";
    // Money already spent is always recorded, so budgets stay honest even when a step fails.
    const partial = (e as { partial?: { output: unknown; usage: Usage; cost: number } }).partial;
    await db.from("raxi_agent_jobs").update({ status: "FAILED", error: message, finished_at: now(), updated_at: now(),
      ...(partial ? { output: partial.output, usage: partial.usage, cost_usd: Number(partial.cost.toFixed(4)) } : {}) }).eq("id", job.id);
    await db.from("raxi_agent_tasks").update({ status: "FAILED", completed_at: now(), updated_at: now(), output_snapshot: { error: message } }).eq("id", taskId);
  } finally {
    clearInterval(heartbeat);
  }
  // The Director decides the next step of an "Iniciar campaña" pipeline (no-op for manual steps).
  const { error: advanceError } = await db.rpc("raxi_pipeline_advance", { p_job: job.id });
  if (advanceError) console.error("pipeline advance failed", advanceError.message);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: pending } = await db.from("raxi_agent_jobs").select("*").eq("status", "PENDING").order("created_at").limit(1);
  const job = pending?.[0];
  if (!job) return Response.json({ ok: true, processed: 0 });
  const { data: claimed } = await db.from("raxi_agent_jobs")
    .update({ status: "RUNNING", attempts: job.attempts + 1, started_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", job.id).eq("status", "PENDING").select("id");
  if (!claimed?.length) return Response.json({ ok: true, processed: 0 });
  // Run in the background so the HTTP caller (pg_net) is not held open.
  EdgeRuntime.waitUntil(runJob(db, job));
  return Response.json({ ok: true, accepted: job.id });
});
