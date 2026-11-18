// Raxi HQ — agent runner (Modo Autónomo).
// Processes ONE queued row of public.raxi_agent_jobs per invocation. Jobs are only created by the
// owner-checked, budget-checked RPC raxi_request_agent_job (or by privileged roles), so a caller can
// never create work or choose tools: request bodies are ignored.
// Secrets (server only): ANTHROPIC_API_KEY, ARIA_MCP_URL, ARIA_MCP_TOKEN.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { continuityBlocked, continuityGroups, continuityOf, continuationScene, continuityOrder, type CampaignItem } from "./continuity.ts";
import { makeCreatorDeps } from "../sheet-creator/deps.ts";
import { handleSeries } from "../sheet-creator/series.ts";
import { quoteSeries, seriesRefs, SERIES_RESOLUTION } from "../sheet-creator/seriesPlan.ts";
import { PHOTO_SPEC_ES, PUBLIC_OUTFIT_GUARD } from "../sheet-creator/photoSpec.ts";
const CONTINUITY_MODEL = "bytedance/seedream-v5.5/edit"; // AGENTS.md: Raxi HQ creator default

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
  COPY: { stage: "COPY", agent: "copy" },
  QA: { stage: "QA", agent: "qa" },
  FINAL: { stage: "DIRECTOR", agent: "director" },
  PRODUCTION: { stage: "PRODUCTION", agent: "production" },
  GENERATE: { stage: "PRODUCTION", agent: "production" },
  ARCHIVE: { stage: "ARCHIVIST", agent: "archivist" },
};
// Who hands what to whom before a step starts (shown as a walk in the office).
const HANDOFF: Record<string, { from: string; fromStage: string; artifact: string; after: string }> = {
  RESEARCH: { from: "director", fromStage: "DIRECTOR", artifact: "RESEARCH_BRIEF", after: "BRIEF" },
  STRATEGY: { from: "researcher", fromStage: "RESEARCHER", artifact: "RESEARCH_REPORT", after: "RESEARCH" },
  DESIGN: { from: "director", fromStage: "DIRECTOR", artifact: "STRATEGY_BRIEF", after: "STRATEGY" },
  REVIEW: { from: "creative", fromStage: "CREATIVE", artifact: "DESIGN_PACKAGE", after: "DESIGN" },
  COPY: { from: "director", fromStage: "DIRECTOR", artifact: "CAMPAIGN_PACKAGE", after: "REVIEW" },
  QA: { from: "copy", fromStage: "COPY", artifact: "SOCIAL_COPY", after: "COPY" },
  FINAL: { from: "qa", fromStage: "QA", artifact: "QA_REPORT", after: "QA" },
  PRODUCTION: { from: "director", fromStage: "DIRECTOR", artifact: "PRODUCTION_ORDER", after: "REVIEW" },
  ARCHIVE: { from: "copy", fromStage: "COPY", artifact: "PUBLISHED_PACKAGE", after: "PUBLISH" },
};

type Usage = { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number; server_tool_use?: { web_search_requests?: number } };

function cost(model: keyof typeof MODELS, u: Usage): number {
  // Haiku 5.5 is billed at a higher tier for prompts over 100k tokens; apply it conservatively to the whole call.
  const long = model === "haiku" && (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) > 100_000;
  const m = long ? { inPerM: 0.5, outPerM: 2.5 } : MODELS[model];
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
async function callClaude(opts: { model: keyof typeof MODELS; system: string; prompt: string; maxTokens: number; webSearch?: number; aria?: boolean; images?: { label: string; url: string }[] }) {
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
  const userContent = opts.images?.length
    ? [...opts.images.flatMap((im) => [{ type: "text", text: im.label }, { type: "image", source: { type: "url", url: im.url } }]), { type: "text", text: opts.prompt }]
    : opts.prompt;
  const messages: { role: string; content: unknown }[] = [{ role: "user", content: userContent }];
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

/** If an answer was cut, a cheap Haiku pass turns what was written into the required JSON instead of throwing it away. */
async function rescueJson(partial: string, schema: string): Promise<{ data: unknown; usage: Usage; cost: number }> {
  const r = await callClaude({ model: "haiku", maxTokens: 8000, system: "Conviertes texto incompleto en JSON válido. No inventes nada: usa solo lo que está en el texto; si un campo falta, déjalo vacío.",
    prompt: `Texto (puede estar cortado):\n${partial.slice(0, 60000)}\n\nDevuelve SOLO un bloque \`\`\`json con esta forma:\n${schema}` });
  return { data: lastJson(r.text), usage: r.usage, cost: r.cost };
}

const COMPACT = "Formato obligatorio: responde SOLO con un bloque ```json (sin texto antes ni después). Frases cortas (máx. 25 palabras por campo de texto). Sin relleno.";

function rulesOf(profile: Record<string, unknown> | null): string {
  const rules = (profile?.capability_config as { owner_rules?: string[] } | undefined)?.owner_rules ?? [];
  return rules.map((r, i) => `${i + 1}. ${r}`).join("\n");
}

const COMMON = `Eres parte del equipo de agentes de Raxi HQ, la oficina de IA de Luis (dueño) para campañas de personajes virtuales adultos.
Escribe en español de México. Nunca inventes datos, cifras, cuentas ni fuentes; si algo no se pudo verificar, dilo explícitamente.
No generes imágenes ni gastes créditos de Aria Studio. Distingue hechos verificados, inferencias e hipótesis.`;

const TITLES: Record<string, string> = { BRIEF: "Brief del Director", RESEARCH: "Investigar", STRATEGY: "Análisis y estrategia del Director",
  DESIGN: "Diseñar", REVIEW: "Revisión del Director", COPY: "Copy de la publicación", QA: "Control de calidad", FINAL: "Paquete final del Director",
  PRODUCTION: "Orden de producción en Aria", GENERATE: "Generar fotos en Aria", ARCHIVE: "Archivar campaña" };
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
    const posts = ((data.publicaciones as Record<string, unknown>[] | undefined) ?? []).slice(0, 30);
    const bases = continuityOf(posts);
    posts.forEach((post, idx) => {
      const base = bases[idx];
      rows.push({ position: idx + 1, asset_id: null, aria_file: null, caption: txt(post.texto, 2200) || null, alt_text: txt(post.alt, 1000) || null,
        crop: channel === "INSTAGRAM_STORY" ? "9:16" : "4:5",
        payload: base === null
          ? { kind: "PHOTO_TO_GENERATE", scene: txt(post.escena, 500), shot: txt(post.plano, 200), prompt: txt(post.prompt, 6000), job: job.id }
          // Same moment as photo `base`: made by the Raxi HQ creator from the archived base photo.
          : { kind: "PHOTO_TO_CONTINUE", base_position: base, scene: continuationScene(post), job: job.id } });
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

/** The Director approves with small corrections instead of rewriting the whole design (saves most of the review cost). */
function applyCorrections(design: Record<string, unknown>, corrections: unknown): Record<string, unknown> {
  const out = structuredClone(design) as Record<string, unknown>;
  const fields = new Set(["texto", "alt", "prompt", "escena", "plano", "texto_pantalla", "segundos"]);
  for (const c of (Array.isArray(corrections) ? corrections : []).slice(0, 60) as Record<string, unknown>[]) {
    const list = c?.tipo === "montaje" ? out.montaje : out.publicaciones;
    if (!Array.isArray(list) || !fields.has(String(c.campo))) continue;
    const item = (list as Record<string, unknown>[]).find((x) => Number(x.posicion) === Number(c.posicion));
    if (item) item[String(c.campo)] = c.campo === "segundos" ? Number(c.valor) || item.segundos : txt(c.valor, 6000);
  }
  return out;
}

// ---- Aria Studio, called directly over MCP (JSON-RPC). Deterministic: no model decides what to spend. ----
let ariaSession: string | null = null;
async function ariaRpc(method: string, params: Record<string, unknown>, id: number | null): Promise<unknown> {
  const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json, text/event-stream",
    authorization: `Bearer ${Deno.env.get("ARIA_MCP_TOKEN")}` };
  if (ariaSession) headers["mcp-session-id"] = ariaSession;
  const res = await fetch(Deno.env.get("ARIA_MCP_URL")!, { method: "POST", headers,
    body: JSON.stringify(id === null ? { jsonrpc: "2.0", method, params } : { jsonrpc: "2.0", id, method, params }) });
  const sid = res.headers.get("mcp-session-id"); if (sid) ariaSession = sid;
  if (id === null) return null;
  const raw = await res.text();
  if (!res.ok) throw new Error(`Aria ${res.status}: ${raw.slice(0, 200)}`);
  const body = raw.trim().startsWith("{") ? raw : raw.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).filter(Boolean).pop() ?? "{}";
  const json = JSON.parse(body);
  if (json.error) throw new Error(`Aria: ${String(json.error.message ?? "error").slice(0, 200)}`);
  return json.result;
}
async function aria(tool: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  if (!ariaSession) {
    await ariaRpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "raxi-hq", version: "1.0" } }, 1);
    await ariaRpc("notifications/initialized", {}, null);
  }
  const result = await ariaRpc("tools/call", { name: tool, arguments: args }, Date.now()) as { content?: { type: string; text?: string }[]; isError?: boolean };
  const text = (result?.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n");
  if (result?.isError) throw new Error(`Aria ${tool}: ${text.slice(0, 200)}`);
  try { return JSON.parse(text); } catch { return { text }; }
}
const ARIA_IMG = /https:\/\/studio\.ariacruz\.com\/mcp\/img\?[^\s"']+/;
/** Finds the 24 h link and file name in whatever shape estado_imagen returns. */
function readyImage(r: Record<string, unknown>): { url: string; file: string } | null {
  const text = JSON.stringify(r);
  const url = text.match(ARIA_IMG)?.[0]?.replace(/\\u0026/g, "&");
  const file = text.match(/assets\/live\/([A-Za-z0-9._-]+\.(?:jpg|jpeg|png|webp))/)?.[1];
  return url ? { url, file: file ?? `aria-${crypto.randomUUID().slice(0, 8)}.jpg` } : null;
}
const priceOf = (r: Record<string, unknown>): number | null => {
  const m = JSON.stringify(r).match(/"(?:precio|precio_usd|usd|coste|costo|cost)"\s*:\s*"?\$?([0-9.]+)/i);
  return m ? Number(m[1]) : null;
};
const ariaIdOf = (r: Record<string, unknown>): string | null => {
  const v = r.id ?? r.imagen_id ?? r.job_id ?? (JSON.stringify(r).match(/"id"\s*:\s*"([^"]+)"/)?.[1]);
  return typeof v === "string" || typeof v === "number" ? String(v) : null;
};

/** Short memory of campaigns already published for this character, so nobody repeats them. */
async function campaignMemory(db: SupabaseClient, ws: string, character: unknown): Promise<string> {
  const { data } = await db.from("raxi_campaign_archive").select("title, summary, facets, published_url").eq("workspace_id", ws)
    .eq("character_id", String(character ?? "")).order("created_at", { ascending: false }).limit(15);
  if (!data?.length) return "(aún no hay campañas archivadas)";
  return data.map((c) => `- ${c.title}: ${txt(c.summary, 300)} | ${JSON.stringify(c.facets).slice(0, 400)}`).join("\n");
}

/** The campaign's Fototeca collection with its items and archived photo paths (service role, server only). */
async function loadCampaign(db: SupabaseClient, proposal: Record<string, unknown>) {
  const externalId = `CAMP-${String(proposal.external_id).replace(/^PROP-/, "")}`;
  const { data: col } = await db.from("raxi_portfolio_collections").select("id, title, channel, concept, payload")
    .eq("workspace_id", proposal.workspace_id).eq("external_id", externalId).maybeSingle();
  if (!col) throw new Error("La campaña no existe en la Fototeca.");
  const { data: items } = await db.from("raxi_portfolio_items").select("id, position, caption, alt_text, payload, human_decision, asset_id, aria_file, crop")
    .eq("collection_id", col.id).neq("human_decision", "REJECTED").order("position"); // photos the owner discarded never reach Copy/QA/final
  const ids = (items ?? []).map((i) => i.asset_id).filter(Boolean);
  const { data: assets } = ids.length ? await db.from("raxi_assets").select("id, object_path").in("id", ids) : { data: [] };
  const paths = new Map((assets ?? []).map((a) => [a.id, a.object_path as string]));
  return { col, items: (items ?? []).map((i) => ({ ...i, object_path: i.asset_id ? paths.get(i.asset_id) ?? null : null })) as Record<string, unknown>[] };
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
    const SCHEMAS: Record<string, string> = {
      BRIEF: `{"viable":true,"objetivo_trabajo":"","preguntas_investigacion":["máx. 4"],"criterios_exito":["máx. 3"],"riesgos":["máx. 3"]}`,
      RESEARCH: `{"modelos":[{"nombre":"","plataforma":"","por_que":"","patrones":["máx. 3"],"fuentes":["URL, máx. 2"]}],"patrones_adaptables":["máx. 4"],"no_copiar":["máx. 3"],"hipotesis":["máx. 3"],"limitaciones":""}`,
      STRATEGY: `{"decision":"SUFICIENTE|MAS_INVESTIGACION","evaluacion_investigacion":"","preguntas_extra":[],"estrategia":{"objetivo":"","audiencia":"","plataformas":[{"plataforma":"","rol":""}],"funnel":"","mensajes_clave":["máx. 3"],"formatos":["máx. 4"],"duracion":"","metrica_principal":"","metricas_secundarias":["máx. 3"],"hipotesis":["máx. 3"],"riesgos":[{"riesgo":"","mitigacion":""}]}}`,
      DESIGN: `{"concepto":"","microhistoria":"","publicaciones":[{"posicion":1,"escena":"","plano":"","prompt":"","texto":"","alt":"","continuidad_de":null}],"coleccion_existente":null,"montaje":[{"posicion":1,"segundos":1,"texto_pantalla":""}],"modelo_aria":"","costo_estimado_usd":0,"checklist_qa":["máx. 6"]}`,
      ARCHIVE: `{"resumen":"","facetas":{},"aprendizajes":[],"evitar_repetir":[]}`,
      COPY: `{"gancho":"","caption":"","hashtags":[],"primer_comentario":"","cta":"","alt_reel":"","audio_sugerido":""}`,
      QA: `{"estado":"APPROVED|APPROVED_WITH_CAUTION|REWRITE|REJECT","resumen":"","items":[{"posicion":1,"estado":"PASS|CAUTION|FAIL","nota":""}],"copy":{"estado":"OK|REWRITE","nota":""},"defectos":[]}`,
      REVIEW: `{"veredicto":"APROBADA|CAMBIOS","revision":[{"punto":"","estado":"OK|FALLA","nota":""}],"cambios_requeridos":[],"correcciones":[{"tipo":"publicacion|montaje","posicion":1,"campo":"texto|alt|prompt|escena|plano|texto_pantalla|segundos","valor":""}],"campana":{"objetivo":"","audiencia":"","metrica_principal":"","cta":"","calendario":[{"dia":"","publicacion":""}],"hashtags":["máx. 8"]}}`,
    };
    if (kind === "SMOKE") {
      model = "haiku";
      result = await callClaude({ model, maxTokens: 600, aria: true, system: COMMON,
        prompt: "Prueba de conexión. Usa las herramientas de Aria Studio mis_personajes y modelos. Responde SOLO un bloque ```json con {\"personajes\": [ids], \"modelos_disponibles\": número, \"ok\": true}." });
    } else if (kind === "BRIEF") {
      model = "sonnet";
      result = await callClaude({ model, maxTokens: 6000, system: `${COMMON}\nEres el Director IA de Raxi HQ. Recibes una idea aceptada por el dueño y defines el trabajo antes de delegar. No investigas tú: encargas.\nReglas del dueño:\n${rulesOf(profile)}`,
        prompt: `Idea aceptada: ${proposal?.title} (${proposal?.channel}, personaje ${proposal?.character_id}).\nResumen: ${proposal?.summary}\nPor qué: ${proposal?.rationale ?? "—"}\n\n` +
          `Campañas ya publicadas de este personaje (no repitas concepto, locación ni gancho):\n${await campaignMemory(db, String(job.workspace_id), proposal?.character_id)}\n\n` +
          `Evalúa viabilidad y define el encargo para el Investigador.\n${COMPACT}\nForma: ${SCHEMAS.BRIEF}` });
    } else if (kind === "STRATEGY") {
      model = "sonnet";
      const research = await lastOutput(db, job.proposal_id, "RESEARCH");
      const brief = await lastOutput(db, job.proposal_id, "BRIEF");
      const prev = input.owner_note ? await lastOutput(db, job.proposal_id, "STRATEGY") : null;
      result = await callClaude({ model, maxTokens: 12000, system: `${COMMON}\nEres el Director IA de Raxi HQ. Evalúas la investigación con criterio y la conviertes en estrategia. El dueño la aprueba antes de que el equipo creativo empiece.\nReglas del dueño:\n${rulesOf(profile)}`,
        prompt: `Campaña: ${proposal?.title} (${proposal?.channel}, personaje ${proposal?.character_id}).\nResumen: ${proposal?.summary}\n\n` +
          `Tu encargo (JSON): ${JSON.stringify(brief?.data ?? {}).slice(0, 3000)}\n\nInvestigación (JSON): ${JSON.stringify(research?.data ?? {}).slice(0, 9000)}\n\n` +
          (input.owner_note ? `El dueño pidió estos cambios a tu estrategia anterior (obligatorios): ${String(input.owner_note).slice(0, 1000)}\nEstrategia anterior (JSON): ${JSON.stringify(prev?.data ?? {}).slice(0, 5000)}\n\n` : "") +
          `1) ¿La investigación responde el encargo, cumple las reglas (≥2-3 modelos digitales) y separa hechos de hipótesis? Pide "MAS_INVESTIGACION" solo si falta algo esencial, con preguntas concretas. ` +
          `2) Si basta, redacta la estrategia. Si la decisión es MAS_INVESTIGACION, "estrategia" va en null.\n${COMPACT}\nForma: ${SCHEMAS.STRATEGY}` });
    } else if (kind === "RESEARCH") {
      model = "haiku";
      const call = (m: keyof typeof MODELS) => callClaude({ model: m, maxTokens: 16000, webSearch: 4, system: `${COMMON}\nEres el Investigador. Eres eficiente: máximo 4 búsquedas, bien elegidas.\nReglas del dueño:\n${rulesOf(profile)}`,
        prompt: `Campaña aceptada:\n- Título: ${proposal?.title}\n- Personaje: ${proposal?.character_id}\n- Canal: ${proposal?.channel}\n- Resumen: ${proposal?.summary}\n\n` +
          (input.brief ? `Encargo del Director (JSON): ${JSON.stringify(input.brief).slice(0, 3000)}\n\n` : "") +
          (input.follow_up ? `El Director pide responder específicamente: ${JSON.stringify(input.follow_up).slice(0, 2000)}\n\n` : "") +
          `Encuentra exactamente 3 modelos o creadoras digitales/virtuales (IA o personajes virtuales) comparables a este personaje y sus patrones de contenido (formatos, escenarios, encuadres, textos, ritmo). ` +
          `Cifras solo si aparecen en una fuente, con fecha. Sintetiza patrones adaptables, qué NO copiar e hipótesis medibles.\n${COMPACT}\nForma: ${SCHEMAS.RESEARCH}` });
      try { result = await call("haiku"); }
      catch (e) {
        // Safety net: if the cheap model is ever refused for search, fall back once to Sonnet.
        if (!/web_search|not supported|unsupported/i.test(String(e))) throw e;
        model = "sonnet"; result = await call("sonnet");
      }
    } else if (kind === "PRODUCTION") {
      // Production order with REAL prices from Aria. No model call and no spending here.
      model = "haiku";
      const { col, items } = await loadCampaign(db, proposal!);
      const todo = items.filter((i) => !i.asset_id && (i.payload as Record<string, unknown>)?.kind === "PHOTO_TO_GENERATE");
      const groups = continuityGroups(items as unknown as CampaignItem[]);
      if (!todo.length && !groups.length) throw new Error("No hay fotos pendientes por producir en esta campaña.");
      // Continuity part: priced with the creator's verified WaveSpeed price; only public channels and a locked identity.
      const creator = makeCreatorDeps(db, db);
      const cChar = String(proposal?.character_id ?? "");
      const cPrice = await creator.price(CONTINUITY_MODEL);
      const cRefs = await creator.currentRefs(String(job.workspace_id), cChar);
      const { data: ownerRow } = await db.from("raxi_workspaces").select("owner_user_id").eq("id", job.workspace_id).maybeSingle();
      const blocked = groups.length ? continuityBlocked({ channel: String(col.channel), identityLocked: await creator.identityLocked(String(job.workspace_id), cChar),
        hasGeneralRefs: Boolean(cRefs.face), keyConnected: Boolean(ownerRow && await creator.secret(String(ownerRow.owner_user_id))), priceEnabled: Boolean(cPrice?.enabled) }) : null;
      const perPhoto = cPrice?.enabled ? quoteSeries({ shots: 1, refs: cRefs.face ? seriesRefs("PUBLIC", cRefs).length : 1, resolution: SERIES_RESOLUTION, price: cPrice }).perPhotoMills : 0;
      const continuidad = continuityOrder(groups, perPhoto, blocked);
      const catalog = ((await aria("modelos")).modelos as Record<string, unknown>[] | undefined ?? []).filter((m) => Number(m.usd_std) > 0);
      if (!catalog.length) throw new Error("Aria no devolvió modelos disponibles.");
      const keys = new Set(catalog.map((m) => String(m.key)));
      const pick = (t: unknown) => [...String(t ?? "").toLowerCase().matchAll(/[a-z0-9]+/g)].map((m) => m[0]).find((w) => keys.has(w));
      const preferred = (profile?.capability_config as { preferred_model?: string } | undefined)?.preferred_model;
      const fromNote = pick(input.owner_note), fromPref = preferred && keys.has(preferred) ? preferred : undefined;
      const fromText = fromNote ?? fromPref ?? pick((col.payload as Record<string, unknown>)?.model);
      const key = fromText ?? (keys.has("gptimg") ? "gptimg" : String(catalog[0].key));
      const m = catalog.find((x) => String(x.key) === key)!;
      const pr = await aria("mis_personajes");
      const people = (pr.personajes ?? pr.characters ?? pr) as unknown;
      const character = String(proposal?.character_id ?? "");
      const plist = Array.isArray(people) ? people as Record<string, unknown>[] : [];
      const person = plist.find((p) => [p.id, p.slug, p.nombre, p.name].some((v) => String(v ?? "").toLowerCase().replace(/\s+/g, "-") === character.toLowerCase())) ?? plist.find((p) => JSON.stringify(p).toLowerCase().includes(character.toLowerCase()));
      const personaje = String(person?.id ?? character);
      const formato = items.some((i) => i.crop === "9:16") ? "9:16" : "3:4";
      const unit = Number(m.usd_std);
      // Luis's fixed prompt for this character always goes first; the scene from the design goes below it.
      const { data: fixedRow } = await db.from("raxi_character_profiles").select("fixed_prompt").eq("workspace_id", job.workspace_id).eq("character_id", character).maybeSingle();
      const fixed = txt(fixedRow?.fixed_prompt, 4000);
      // Public channels only: never borrow the reference's clothing (pilot 2026-11-18). Fanvue wardrobe stays Luis's.
      const publicChannel = ["INSTAGRAM", "INSTAGRAM_STORY", "TEASER"].includes(String(proposal?.channel ?? ""));
      const fotos = todo.map((i) => { const scene = String((i.payload as Record<string, unknown>).prompt ?? "").slice(0, 4000);
        return { item_id: i.id, posicion: i.position, prompt: `${fixed ? `${fixed}\n\nSCENE:\n` : ''}${scene}${publicChannel ? `\n\n${PUBLIC_OUTFIT_GUARD}` : ''}` }; });
      const ariaTotal = Number((unit * fotos.length).toFixed(4));
      const plan = { modelo_key: key, modelo_nombre: m.nombre, precio_unitario_usd: unit, calidad: "std", formato, personaje, fotos,
        aria_total_usd: ariaTotal, continuidad,
        total_usd: Number((ariaTotal + (continuidad?.total_usd ?? 0)).toFixed(4)),
        prompt_fijo: fixed ? "Incluido al inicio de cada foto" : "Sin prompt fijo para este personaje",
        nota: fromNote ? "Modelo que pediste en tu nota." : fromPref ? "Tu modelo preferido (conserva mejor la cara)." : fromText ? "Modelo indicado en el diseño." : "Se usa el modelo general por defecto." };
      result = { text: JSON.stringify(plan), usage: {}, stopReason: "end_turn", cost: 0, sources: [] };
    } else if (kind === "GENERATE") {
      // Generates only what Luis approved, never above the approved amount, and never pays twice for the same photo.
      model = "haiku";
      const plan = input.plan as Record<string, unknown> | undefined;
      const approved = Number(input.approved_usd);
      if (!plan || !Number.isFinite(approved)) throw new Error("Falta la orden aprobada.");
      const { col: genCol, items } = await loadCampaign(db, proposal!);
      const byId = new Map(items.map((i) => [String(i.id), i]));
      // Spending limit per approval: only rounds of THIS approved order count (a redo gets its own approval).
      const { data: prev } = await db.from("raxi_agent_jobs").select("cost_usd").eq("proposal_id", job.proposal_id).eq("kind", "GENERATE").neq("id", job.id)
        .eq("input->>approved_at", String(input.approved_at ?? ""));
      let spent = (prev ?? []).reduce((t, r) => t + Number(r.cost_usd), 0), costNow = 0;
      const continuityPlan = plan.continuidad as { grupos?: { base_posicion: number; item_ids: string[]; escenas: string[]; total_mills: number }[]; total_usd?: number } | null | undefined;
      const continuityReserved = Number(continuityPlan?.total_usd ?? 0);
      const unit = Number(plan.precio_unitario_usd);
      try {
      for (const f of (plan.fotos as Record<string, unknown>[]) ?? []) {
        const it = byId.get(String(f.item_id));
        const pl = (it?.payload ?? {}) as Record<string, unknown>;
        if (!it || it.asset_id || pl.aria_request_id || it.aria_file) continue;
        if (spent + unit > approved - continuityReserved + 1e-6) break; // never above what was approved (continuity keeps its part)
        const r = await aria("generar_imagen", { personaje: plan.personaje, escena: f.prompt, modelo: plan.modelo_key, calidad: plan.calidad, formato: plan.formato });
        const rid = ariaIdOf(r);
        if (!rid) throw new Error(`Aria no devolvió un id: ${JSON.stringify(r).slice(0, 200)}`);
        const price = priceOf(r) ?? unit;
        spent += price; costNow += price;
        await db.from("raxi_portfolio_items").update({ payload: { ...pl, aria_request_id: rid, aria_model: plan.modelo_key, aria_price_usd: price, generated_job: job.id }, updated_at: now() }).eq("id", it.id);
        it.payload = { ...pl, aria_request_id: rid };
      }
      } catch (e) {
        // Anything Aria already charged is recorded even if a later photo fails; a retry never pays twice.
        throw Object.assign(e instanceof Error ? e : new Error(String(e)), { partial: { output: { data: { gastado_usd: costNow } }, usage: {}, cost: costNow } });
      }
      // Poll pending generations (about 75 s per run; the Director re-queues this step while photos are still cooking).
      let ready = 0;
      for (let round = 0; round < 6; round++) {
        const pending = items.filter((i) => !i.asset_id && !i.aria_file && (i.payload as Record<string, unknown>)?.aria_request_id);
        if (!pending.length) break;
        if (round > 0) await new Promise((r) => setTimeout(r, 15000));
        for (const it of pending) {
          const st = await aria("estado_imagen", { id: String((it.payload as Record<string, unknown>).aria_request_id) }).catch(() => null);
          const img = st ? readyImage(st) : null;
          if (!img) continue;
          it.aria_file = img.file; ready += 1;
          await db.from("raxi_portfolio_items").update({ aria_file: img.file, updated_at: now() }).eq("id", it.id);
          await db.from("raxi_archive_requests").insert({ workspace_id: job.workspace_id, source_url: img.url, aria_file: img.file, character_id: String(proposal?.character_id ?? ""), status: "PENDING" });
        }
      }
      // Archive into the Fototeca (download, hash, private storage) and give it a moment to finish.
      const supa = Deno.env.get("SUPABASE_URL")!;
      await fetch(`${supa}/functions/v1/raxi-archive-aria`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).catch(() => null);
      // Continuity: once a base photo is archived, the creator makes the rest of that moment (approved in this same order).
      if (continuityPlan?.grupos?.length) {
        const creator = makeCreatorDeps(db, db);
        const { data: ownerRow } = await db.from("raxi_workspaces").select("owner_user_id").eq("id", job.workspace_id).maybeSingle();
        const actor = String(ownerRow?.owner_user_id ?? "");
        const { data: fresh } = await db.from("raxi_portfolio_items").select("id, position, asset_id, human_decision, payload").in("id", items.map((i) => i.id));
        const freshById = new Map((fresh ?? []).map((i) => [String(i.id), i]));
        for (const g of continuityPlan.grupos) {
          const base = (fresh ?? []).find((i) => Number(i.position) === Number(g.base_posicion));
          const pendingItems = g.item_ids.map((id) => freshById.get(id)).filter((i) => i && !i.asset_id && i.human_decision !== "REJECTED");
          if (!base?.asset_id || !actor || !pendingItems.length) continue;
          const started = pendingItems.find((i) => typeof (i!.payload as Record<string, unknown>)?.series_id === "string");
          let seriesId = started ? String((started.payload as Record<string, unknown>).series_id) : null;
          if (!seriesId) {
            // Luis approved this exact amount at PRODUCTION_COST; the creator re-quotes and refuses if the price changed.
            const out = await handleSeries(creator, actor, String(job.workspace_id), { action: "SERIES_START", character: String(proposal?.character_id ?? ""),
              baseAssetId: String(base.asset_id), channel: String(genCol.channel),
              scenes: g.escenas, model: CONTINUITY_MODEL, resolution: SERIES_RESOLUTION, attestNotReal: true, expectedTotalMills: g.total_mills,
              proposalId: String(job.proposal_id), title: `Continuidad de la foto ${g.base_posicion}` });
            if (out.status !== 200) throw new Error(`Continuidad de la foto ${g.base_posicion}: ${String(out.body.error ?? out.status)}`);
            seriesId = String(out.body.seriesId);
            costNow += g.total_mills / 1000;
            for (const [n, id] of g.item_ids.entries()) {
              const it = freshById.get(id);
              if (it) await db.from("raxi_portfolio_items").update({ payload: { ...(it.payload as Record<string, unknown>), series_id: seriesId, shot: n + 1 }, updated_at: now() }).eq("id", id);
            }
          }
          const st = await handleSeries(creator, actor, String(job.workspace_id), { action: "SERIES_STATUS", seriesId });
          const takes = (st.body.takes as { id: string; shot: number; takeNo: number; status: string; chosen: boolean }[] | undefined) ?? [];
          for (const [n, id] of g.item_ids.entries()) {
            const it = freshById.get(id);
            const done = takes.filter((t) => t.shot === n + 1 && t.status === "SUCCEEDED").sort((a, b) => b.takeNo - a.takeNo)[0];
            if (!it || it.asset_id || !done) continue;
            const chosen = await handleSeries(creator, actor, String(job.workspace_id), { action: "SERIES_CHOOSE", takeId: done.id });
            if (chosen.status === 200) { await db.from("raxi_portfolio_items").update({ asset_id: String(chosen.body.assetId), updated_at: now() }).eq("id", id); ready += 1; }
          }
        }
      }
      const { data: after } = await db.from("raxi_portfolio_items").select("id, asset_id, aria_file, payload, human_decision").in("id", items.map((i) => i.id));
      const missing = (after ?? []).filter((i) => i.human_decision !== "REJECTED" && !i.asset_id).length;
      const data = { generadas_ahora: Math.round(costNow / (unit || 1)), listas_en_esta_vuelta: ready, pendientes: missing, gastado_usd: Number(costNow.toFixed(4)), aprobado_usd: approved };
      result = { text: JSON.stringify(data), usage: {}, stopReason: "end_turn", cost: Number(costNow.toFixed(4)), sources: [] };
    } else if (kind === "ARCHIVE") {
      model = "haiku";
      const { col, items } = await loadCampaign(db, proposal!);
      const strategy = (await lastOutput(db, job.proposal_id, "STRATEGY"))?.data as Record<string, unknown> | undefined;
      const qa = (await lastOutput(db, job.proposal_id, "QA"))?.data as Record<string, unknown> | undefined;
      const { data: rejected } = await db.from("raxi_portfolio_items").select("position, qa_notes").eq("collection_id", col.id).eq("human_decision", "REJECTED");
      const { data: spentRows } = await db.from("raxi_agent_jobs").select("cost_usd").eq("proposal_id", job.proposal_id);
      const spentTotal = (spentRows ?? []).reduce((t, r) => t + Number(r.cost_usd), 0);
      const p = col.payload as Record<string, unknown>;
      result = await callClaude({ model, maxTokens: 4000, system: `${COMMON}\nEres el Archivista de Raxi HQ. Conviertes una campaña publicada en memoria útil para que el equipo no repita y aprenda.`,
        prompt: `Campaña publicada: ${col.title} (${p.format ?? "POSTS"}, personaje ${proposal?.character_id}). Enlace: ${p.published_url ?? "—"}\n` +
          `Concepto: ${String(col.concept ?? "").slice(0, 1500)}\nEstrategia (JSON): ${JSON.stringify(strategy?.estrategia ?? {}).slice(0, 2500)}\n` +
          `Fotos publicadas (descripción): ${items.map((i) => `${i.position}: ${String(i.alt_text ?? "").slice(0, 140)}`).join(" | ").slice(0, 3000)}\n` +
          `Fotos descartadas y por qué: ${JSON.stringify(rejected ?? []).slice(0, 800)}\nQA: ${JSON.stringify(qa ?? {}).slice(0, 1500)}\n` +
          `Texto publicado: ${JSON.stringify((p.copy as Record<string, unknown>)?.caption ?? "").slice(0, 800)}\nCosto total de agentes: $${spentTotal.toFixed(2)}\n` +
          `Resume la campaña y extrae facetas concretas para no repetir (locaciones, vestuario, poses/encuadres, ganchos, temas, formato) y aprendizajes verificados (solo lo que consta arriba; no inventes métricas).\n${COMPACT}\n` +
          `Forma: {"resumen":"","facetas":{"locaciones":[],"vestuario":[],"encuadres":[],"ganchos":[],"temas":[],"formato":""},"aprendizajes":[],"evitar_repetir":[]}` });
      const d = lastJson(result.text) as Record<string, unknown> | null;
      if (d) {
        const facets = { ...(d.facetas as Record<string, unknown> ?? {}), evitar_repetir: d.evitar_repetir ?? [] };
        let smId: string | null = null;
        const smKey = Deno.env.get("SUPERMEMORY_API_KEY");
        if (smKey) {
          const content = `Raxi HQ · campaña archivada: ${col.title} (${proposal?.character_id}). ${p.published_url ?? ""}\n${txt(d.resumen, 2000)}\nFacetas: ${JSON.stringify(facets)}\nAprendizajes: ${JSON.stringify(d.aprendizajes ?? [])}`;
          const sm = await fetch("https://api.supermemory.ai/v3/documents", { method: "POST", headers: { authorization: `Bearer ${smKey}`, "content-type": "application/json" },
            body: JSON.stringify({ content, customId: `raxi-campaign-${String(proposal?.external_id ?? job.proposal_id)}`, containerTags: [Deno.env.get("SUPERMEMORY_CONTAINER") ?? "raxi-hq"], metadata: { source: "raxi-hq-archivist", character: String(proposal?.character_id ?? "") } }) }).catch(() => null);
          if (sm?.ok) smId = String((await sm.json().catch(() => ({})))?.id ?? "") || null;
        }
        await db.from("raxi_campaign_archive").upsert({ proposal_id: job.proposal_id, workspace_id: job.workspace_id, character_id: String(proposal?.character_id ?? ""),
          title: txt(col.title, 200), published_url: typeof p.published_url === "string" && /^https:\/\/(www\.)?instagram\.com\//.test(p.published_url) ? p.published_url : null,
          summary: txt(d.resumen, 4000) || txt(col.title, 200), facets, learnings: Array.isArray(d.aprendizajes) ? d.aprendizajes.slice(0, 20) : [], supermemory_id: smId, updated_at: now() });
        (d as Record<string, unknown>).guardado_en = smKey ? (smId ? "Base de datos + Supermemory" : "Base de datos (Supermemory falló)") : "Base de datos (Supermemory sin clave)";
        result = { ...result, text: "```json\n" + JSON.stringify(d) + "\n```" };
      }
    } else if (kind === "FINAL") {
      // Deterministic integration by the Director: no model call, no cost.
      model = "haiku";
      const { col, items } = await loadCampaign(db, proposal!);
      const copy = (await lastOutput(db, job.proposal_id, "COPY"))?.data as Record<string, unknown> | undefined;
      const qa = (await lastOutput(db, job.proposal_id, "QA"))?.data as Record<string, unknown> | undefined;
      const montage = items.map((i) => ({ posicion: i.position, segundos: (i.payload as Record<string, unknown>)?.seconds ?? null, texto_pantalla: i.caption ?? "" }));
      const seconds = montage.reduce((t, m) => t + (Number(m.segundos) || 0), 0);
      const final = { formato: (col.payload as Record<string, unknown>)?.format ?? "POSTS", fotos: items.length, duracion_segundos: Number(seconds.toFixed(1)),
        texto_publicacion: copy?.caption ?? "", gancho: copy?.gancho ?? "", hashtags: copy?.hashtags ?? [], primer_comentario: copy?.primer_comentario ?? "",
        audio_sugerido: copy?.audio_sugerido ?? "", qa_estado: qa?.estado ?? "", qa_resumen: qa?.resumen ?? "",
        cta: (col.payload as Record<string, unknown>)?.cta ?? "", metrica_principal: (col.payload as Record<string, unknown>)?.primary_metric ?? "",
        siguiente_paso: "Luis autoriza la publicación; luego publica en Instagram con un audio en tendencia y registra el enlace." };
      await db.from("raxi_portfolio_collections").update({ status: "IN_REVIEW", payload: { ...(col.payload as Record<string, unknown>), final, copy }, updated_at: now() }).eq("id", col.id);
      result = { text: JSON.stringify(final), usage: {}, stopReason: "end_turn", cost: 0, sources: [] };
    } else if (kind === "COPY") {
      model = "sonnet";
      const { col, items } = await loadCampaign(db, proposal!);
      const strategy = (await lastOutput(db, job.proposal_id, "STRATEGY"))?.data as Record<string, unknown> | undefined;
      const prevQa = (await lastOutput(db, job.proposal_id, "QA"))?.data as Record<string, unknown> | undefined;
      const montage = items.map((i) => `${i.position}. (${(i.payload as Record<string, unknown>)?.seconds ?? "?"} s) ${i.caption ?? ""} — ${String(i.alt_text ?? "").slice(0, 120)}`).join("\n");
      result = await callClaude({ model, maxTokens: 6000, system: `${COMMON}\nEres Copy y Publicación de Raxi HQ: escribes textos de redes con la voz del personaje (natural, segura, actual, sin tono corporativo ni hashtags excesivos).\nReglas del dueño:\n${rulesOf(profile)}`,
        prompt: `Campaña aprobada por el Director: ${col.title} (${(col.payload as Record<string, unknown>)?.format ?? "POSTS"} para Instagram, personaje ${proposal?.character_id}).\n` +
          `Concepto y microhistoria: ${String(col.concept ?? "").slice(0, 1500)}\nCTA: ${(col.payload as Record<string, unknown>)?.cta ?? ""}\nMétrica principal: ${(col.payload as Record<string, unknown>)?.primary_metric ?? ""}\n` +
          (strategy?.estrategia ? `Estrategia aprobada (JSON): ${JSON.stringify(strategy.estrategia).slice(0, 3000)}\n` : "") +
          `Montaje (foto, segundos, texto en pantalla, descripción):\n${montage}\n\n` +
          (input.owner_note ? `El dueño pidió estos cambios al texto (obligatorios): ${String(input.owner_note).slice(0, 1000)}\n` : "") +
          (input.qa_notes ? `QA devolvió el texto con estos defectos (corrígelos todos): ${JSON.stringify(input.qa_notes).slice(0, 2000)}\nTexto anterior: ${JSON.stringify(prevQa ?? {}).slice(0, 1500)}\n` : "") +
          `Escribe el texto de la publicación (${(col.payload as Record<string, unknown>)?.format === "REEL" ? "un Reel" : items.length > 1 ? "un carrusel de " + items.length + " fotos" : "una foto"}): primera línea con gancho fuerte (≤ 90 caracteres), cuerpo breve bilingüe ES/EN, CTA natural, 3 a 5 hashtags relevantes (no genéricos), primer comentario y texto alternativo. ` +
          `Nada explícito ni promesas engañosas; no finjas ser una persona real. Si es Reel o carrusel, sugiere el tipo de audio en tendencia a buscar en Instagram (ánimo, ritmo), sin nombrar canciones con derechos.\n${COMPACT}\n` +
          `Forma: {"gancho":"","caption":"texto completo listo para pegar, incluye el gancho al inicio","hashtags":["3-5"],"primer_comentario":"","cta":"","alt_reel":"","audio_sugerido":""}` });
    } else if (kind === "QA") {
      model = "sonnet";
      const { col, items } = await loadCampaign(db, proposal!);
      const copy = (await lastOutput(db, job.proposal_id, "COPY"))?.data as Record<string, unknown> | undefined;
      const images: { label: string; url: string }[] = [];
      // Identity reference: photos of this character that Luis approved in OTHER campaigns (his judgment of her real face).
      const { data: refCols } = await db.from("raxi_portfolio_collections").select("id").eq("workspace_id", job.workspace_id)
        .eq("character_id", String(proposal?.character_id ?? "")).neq("id", col.id);
      const { data: refItems } = (refCols ?? []).length ? await db.from("raxi_portfolio_items").select("asset_id")
        .in("collection_id", (refCols ?? []).map((c) => c.id)).eq("human_decision", "APPROVED").not("asset_id", "is", null).order("position").limit(2) : { data: [] };
      const { data: refAssets } = (refItems ?? []).length ? await db.from("raxi_assets").select("object_path").in("id", (refItems ?? []).map((r) => r.asset_id)) : { data: [] };
      for (const [n, a] of (refAssets ?? []).entries()) {
        const { data: signed } = await db.storage.from("raxi-hq-private").createSignedUrl(a.object_path, 900);
        if (signed?.signedUrl) images.push({ label: `REFERENCIA DE IDENTIDAD ${n + 1} (foto ya aprobada por Luis; así es su cara real, NO se evalúa)`, url: signed.signedUrl });
      }
      const refs = images.length;
      for (const i of items) {
        const path = i.object_path as string | null;
        if (!path) continue;
        const { data: signed } = await db.storage.from("raxi-hq-private").createSignedUrl(path, 900);
        if (signed?.signedUrl) images.push({ label: `Foto ${i.position} · ${(i.payload as Record<string, unknown>)?.seconds ?? "?"} s · texto en pantalla: "${i.caption ?? ""}"`, url: signed.signedUrl });
      }
      result = await callClaude({ model, maxTokens: 8000, aria: true, images, system: `${COMMON}\nEres QA Visual de Raxi HQ, independiente del equipo creativo. Eres estricto: solo apruebas lo que ves bien.\nReglas del dueño:\n${rulesOf(profile)}`,
        prompt: `Campaña: ${col.title} (${(col.payload as Record<string, unknown>)?.format ?? "POSTS"} para Instagram, personaje ${proposal?.character_id}). Arriba están las fotos en el orden del montaje.\n` +
          `Texto de la publicación propuesto (JSON): ${JSON.stringify(copy ?? {}).slice(0, 4000)}\n\n` +
          (refs ? `Las primeras ${refs} imágenes son REFERENCIAS de su cara real: compara rostro (forma de cara, ojos, nariz, labios, edad aparente) de cada foto contra ellas. Si una foto no parece la misma persona, esa foto es FAIL aunque todo lo demás esté bien. ` : `No tienes foto de referencia de su cara: dilo y marca la identidad como no verificada (CAUTION como mínimo). `) +
          `Usa mis_personajes de Aria para conocer la identidad oficial del personaje. Revisa en cada foto: identidad consistente, anatomía y manos, reflejos y luz coherentes, vestuario, texto o marcas extrañas, apariencia artificial, edad adulta evidente. ` +
          `Revisa el montaje: duración total (ideal 7–10 s), que cada texto en pantalla sea legible en su tiempo y coincida con la foto. Revisa el copy: gancho, claridad, tono, hashtags, cumplimiento de Instagram (nada explícito). ` +
          `Estados: APPROVED, APPROVED_WITH_CAUTION (detalles menores que no bloquean), REWRITE (solo el texto debe corregirse), REJECT (problema visual que exige cambiar fotos). Lista defectos concretos. Solo puedes juzgar lo que realmente ves.\n${COMPACT}\n` +
          `Forma: {"estado":"APPROVED|APPROVED_WITH_CAUTION|REWRITE|REJECT","resumen":"","items":[{"posicion":1,"estado":"PASS|CAUTION|FAIL","nota":""}],"copy":{"estado":"OK|REWRITE","nota":""},"defectos":[]}` });
    } else if (kind === "REVIEW") {
      model = "sonnet";
      const research = await lastOutput(db, job.proposal_id, "RESEARCH");
      const design = await lastOutput(db, job.proposal_id, "DESIGN");
      const strategy = (await lastOutput(db, job.proposal_id, "STRATEGY"))?.data as Record<string, unknown> | undefined;
      const archive = await archiveSummary(db, String(job.workspace_id));
      result = await callClaude({ model, maxTokens: 12000, aria: true, system: `${COMMON}\nEres el Director IA de Raxi HQ: revisas el trabajo del equipo antes de que exista una campaña. Eres exigente y honesto: si algo no cumple, lo regresas.\nReglas del dueño:\n${rulesOf(profile)}`,
        prompt: `Campaña: ${proposal?.title} (${proposal?.channel}, personaje ${proposal?.character_id}).\nResumen: ${proposal?.summary}\n\n` +
          (strategy?.estrategia ? `Estrategia aprobada por el dueño (JSON): ${JSON.stringify(strategy.estrategia).slice(0, 5000)}\n\n` : "") +
          `Investigación (JSON): ${JSON.stringify(research?.data ?? {}).slice(0, 5000)}\n\nDiseño del Director Creativo (JSON): ${JSON.stringify(design?.data ?? {}).slice(0, 20000)}\n\n` +
          `Fotos que ya existen en la Fototeca:\n${archive}\n\n` +
          `Usa mis_personajes de Aria para comprobar la identidad exacta del personaje, y modelos/saldo para costo y saldo reales. ` +
          `Revisa: cumplimiento de la estrategia, identidad y edad adulta, prompts autónomos y sin contradicciones (POV, luz, vestuario), que cada prompt de foto nueva sea completo (${PHOTO_SPEC_ES} Si a un prompt le falta un punto, sobre todo el vestuario, es FALLA y lo corriges en "correcciones"), que las fotos citadas existan, textos, riesgos de plataforma (etiqueta de IA, nada explícito en Instagram), costo vs. tope de $2. ` +
          `NO reescribas el diseño: si apruebas, lista solo las correcciones menores en "correcciones" (campo y valor nuevo) y define "campana". Si hay problemas de fondo, veredicto CAMBIOS con "cambios_requeridos" concretos y "campana" en null. "revision": máx. 8 puntos.\n${COMPACT}\nForma: ${SCHEMAS.REVIEW}` });
    } else {
      model = "sonnet";
      const archive = await archiveSummary(db, String(job.workspace_id));
      const research = { output: await lastOutput(db, job.proposal_id, "RESEARCH") };
      const lastReview = (await lastOutput(db, job.proposal_id, "REVIEW"))?.data as Record<string, unknown> | undefined;
      const strategy = (await lastOutput(db, job.proposal_id, "STRATEGY"))?.data as Record<string, unknown> | undefined;
      const notes = lastReview && lastReview.veredicto === "CAMBIOS" ? JSON.stringify(lastReview.cambios_requeridos ?? []).slice(0, 3000) : "";
      result = await callClaude({ model, maxTokens: 24000, aria: true, system: `${COMMON}\nEres el Director Creativo.\nReglas del dueño:\n${rulesOf(profile)}`,
        prompt: `Campaña: ${proposal?.title} (${proposal?.channel}, personaje ${proposal?.character_id}).\nResumen: ${proposal?.summary}\n\n` +
          `Investigación (JSON): ${JSON.stringify(research?.output?.data ?? {}).slice(0, 6000)}\n\n` +
          (strategy?.estrategia ? `Estrategia aprobada por el dueño (JSON, obligatoria): ${JSON.stringify(strategy.estrategia).slice(0, 5000)}\n\n` : "") +
          (notes ? `El Director pidió estos cambios a tu diseño anterior; atiéndelos todos: ${notes}\n\n` : "") +
          `Campañas ya publicadas de este personaje (no repitas locaciones, vestuario, encuadres ni ganchos):\n${await campaignMemory(db, String(job.workspace_id), proposal?.character_id)}\n\n` +
          `Fotos que ya existen en la Fototeca (colección → posición: descripción):\n${archive}\n\n` +
          `Usa mis_personajes de Aria para respetar la identidad exacta del personaje y modelos para el precio real por imagen. ` +
          `Diseña concepto, microhistoria y publicaciones. Si es un Reel con fotos ya existentes: kit de montaje sin generar nada, "coleccion_existente" = id de la colección y "posicion" = número de foto en ella; "publicaciones" vacío. ` +
          `Si requiere fotos nuevas: un prompt en inglés por foto con SOLO la escena, muy específico. ${PHOTO_SPEC_ES} Máx. 180 palabras por prompt. Producción antepone automáticamente el prompt fijo del personaje (identidad, anatomía, collar, @Image1), así que no lo repitas ni lo contradigas. Texto ES/EN breve y alt. Por defecto cada publicación es una foto única con su propio momento (decisión de Luis, 2026-11-17). Continuidad solo de forma esporádica, cuando la idea de verdad sea una serie: si varias fotos son el MISMO momento (mismo lugar, ropa y luz; cambia solo la pose, el gesto o el encuadre), haz nueva solo la primera y marca las demás con "continuidad_de" = posición de esa primera foto (máx. 6 por base; la base nunca es continuidad de otra). En ellas escribe en "escena" y "plano" solo qué cambia (pose, gesto, encuadre) en inglés, sin repetir lugar ni ropa. Producción las hace con el creador de Raxi HQ usando la foto base, más barato y con la misma ropa y lugar. Solo para Instagram, Stories y teaser. ` +
          `Modelo de Aria recomendado y costo estimado con precios reales.\n${COMPACT} (Los prompts pueden superar las 25 palabras.)\nForma: ${SCHEMAS.DESIGN}` });
    }
    const output: Record<string, unknown> = { markdown: result.text.slice(0, 60000), data: ["FINAL", "PRODUCTION", "GENERATE"].includes(kind) ? JSON.parse(result.text) : lastJson(result.text), sources: result.sources, model: MODELS[model].id };
    // Rescue instead of discarding paid work: a cut or malformed answer is converted to JSON by a cheap pass.
    if (SCHEMAS[kind] && (!output.data || result.stopReason === "max_tokens")) {
      const rescued = await rescueJson(result.text, SCHEMAS[kind]);
      result = { ...result, usage: addUsage(result.usage, rescued.usage), cost: result.cost + rescued.cost };
      if (rescued.data) { output.data = rescued.data; output.rescued = true; }
    }
    const incomplete = SCHEMAS[kind] && !output.data ? "La respuesta no incluyó datos válidos ni pudo rescatarse. Reintenta este paso." : null;
    if (incomplete) throw Object.assign(new Error(incomplete), { partial: { output, usage: result.usage, cost: result.cost } });
    if (kind === "QA" && proposal) {
      const d = output.data as Record<string, unknown>;
      const { items } = await loadCampaign(db, proposal);
      const map: Record<string, string> = { PASS: "PASS", CAUTION: "PRELIMINARY_PASS", FAIL: "NEEDS_FIX" };
      for (const r of (Array.isArray(d.items) ? d.items : []).slice(0, 60) as Record<string, unknown>[]) {
        const it = items.find((i) => Number(i.position) === Number(r.posicion));
        const qa = map[String(r.estado)];
        if (it && qa) await db.from("raxi_portfolio_items").update({ qa_status: qa, qa_notes: txt(r.nota, 2000) || null, updated_at: now() }).eq("id", it.id);
      }
    }
    if (kind === "REVIEW" && proposal) {
      const d = output.data as Record<string, unknown>;
      const design = (await lastOutput(db, job.proposal_id, "DESIGN"))?.data as Record<string, unknown> | undefined;
      if (d.veredicto === "APROBADA" && design) {
        const paquete = applyCorrections(design, d.correcciones);
        output.data = { ...d, paquete };
        output.campaign = await materializeCampaign(db, job, proposal, paquete, (d.campana as Record<string, unknown>) ?? {});
      }
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
