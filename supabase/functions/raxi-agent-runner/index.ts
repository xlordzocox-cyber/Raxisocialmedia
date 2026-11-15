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
  RESEARCH: { stage: "RESEARCHER", agent: "researcher" },
  DESIGN: { stage: "CREATIVE", agent: "creative" },
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
  const content: Record<string, unknown>[] = [];
  for (let turn = 0; turn < 4; turn++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers, body: JSON.stringify({ ...body, messages }) });
    const json = await res.json();
    if (!res.ok) throw new Error(`Claude API ${res.status}: ${String(json?.error?.message ?? "error").slice(0, 300)}`);
    usage = addUsage(usage, json.usage ?? {});
    content.push(...(json.content ?? []));
    if (json.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: json.content });
  }
  const text = content.filter((b) => b.type === "text").map((b) => String(b.text)).join("");
  const sources = new Map<string, string>();
  for (const b of content) for (const c of (b.citations as { url?: string; title?: string }[] | undefined) ?? []) if (c.url) sources.set(c.url, c.title ?? c.url);
  return { text, usage, cost: cost(opts.model, usage), sources: [...sources].map(([url, title]) => ({ url, title })) };
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

async function runJob(db: SupabaseClient, job: Record<string, unknown>) {
  const kind = String(job.kind);
  const meta = STAGE[kind];
  if (!meta) throw new Error("unsupported job kind");
  const { data: profile } = await db.from("raxi_agent_profiles").select("id, capability_config")
    .eq("workspace_id", job.workspace_id).eq("agent_key", meta.agent).single();
  const proposal = job.proposal_id
    ? (await db.from("raxi_team_proposals").select("*").eq("id", job.proposal_id).single()).data
    : null;

  // Visible, verified activity in the office.
  const taskId = crypto.randomUUID();
  const now = () => new Date().toISOString();
  await db.from("raxi_agent_tasks").insert({
    id: taskId, workspace_id: job.workspace_id, agent_id: profile?.id ?? null, external_id: `JOB-${String(job.id).slice(0, 8)}-${kind}`,
    title: `${kind === "RESEARCH" ? "Investigar" : kind === "DESIGN" ? "Diseñar" : "Prueba de conexión"}${proposal ? `: ${proposal.title}` : ""}`.slice(0, 1400),
    status: "RUNNING", input_snapshot: { runtime: "true", policy: { simulated: false }, executor: "claude-api", job: job.id }, started_at: now(),
  });
  const event = (type: string) => db.from("raxi_agent_events").insert({
    workspace_id: job.workspace_id, agent_id: profile?.id ?? null, task_id: taskId, event_type: type,
    source_kind: "AGENT_EXECUTOR", evidence_status: "VERIFIED", source_ref: `raxi-agent-runner:${job.id}`,
    payload: { simulated: false, stage: meta.stage, leaseUntil: new Date(Date.now() + 10 * 60_000).toISOString(), executor: "claude-api" },
    occurred_at: now(),
  });
  if (kind === "DESIGN" && profile?.id) {
    // The Researcher hands the report to the Creative Director: a real, verified step shown as a walk in the office.
    const { data: researcher } = await db.from("raxi_agent_profiles").select("id")
      .eq("workspace_id", job.workspace_id).eq("agent_key", "researcher").single();
    if (researcher?.id) {
      await db.from("raxi_agent_events").insert({
        workspace_id: job.workspace_id, agent_id: researcher.id, task_id: taskId, event_type: "RUNTIME_HANDOFF",
        source_kind: "AGENT_EXECUTOR", evidence_status: "VERIFIED", source_ref: `raxi-agent-runner:${job.id}`,
        payload: { simulated: false, stage: "RESEARCHER", leaseUntil: new Date(Date.now() + 10 * 60_000).toISOString(),
          targetAgentId: profile.id, artifact: "RESEARCH_REPORT", executor: "claude-api" },
        occurred_at: now(),
      });
      await new Promise((r) => setTimeout(r, 9000)); // let the office show the delivery before the Creative starts
    }
  }
  await event("RUNTIME_ACKNOWLEDGED");
  const heartbeat = setInterval(() => { void db.from("raxi_agent_tasks").update({ updated_at: now() }).eq("id", taskId); }, 30_000);

  try {
    let result: { text: string; usage: Usage; cost: number; sources: { url: string; title: string }[] };
    let model: keyof typeof MODELS;
    if (kind === "SMOKE") {
      model = "haiku";
      result = await callClaude({ model, maxTokens: 600, aria: true, system: COMMON,
        prompt: "Prueba de conexión. Usa las herramientas de Aria Studio mis_personajes y modelos. Responde SOLO un bloque ```json con {\"personajes\": [ids], \"modelos_disponibles\": número, \"ok\": true}." });
    } else if (kind === "RESEARCH") {
      model = "sonnet";
      result = await callClaude({ model, maxTokens: 4000, webSearch: 8, system: `${COMMON}\nEres el Investigador.\nReglas del dueño:\n${rulesOf(profile)}`,
        prompt: `Campaña aceptada por el dueño:\n- Título: ${proposal?.title}\n- Personaje: ${proposal?.character_id}\n- Canal: ${proposal?.channel}\n- Resumen: ${proposal?.summary}\n\n` +
          `Investiga en la web al menos 3 modelos o creadoras digitales/virtuales (cuentas de IA o personajes virtuales) con estética o propuesta parecida a este personaje. ` +
          `Para cada una: nombre o usuario, plataforma, por qué es comparable y qué patrones de contenido usa (formatos, escenarios, encuadres, textos, ritmo de publicación). ` +
          `Incluye cifras solo si aparecen en una fuente, con su fecha. Luego sintetiza patrones adaptables a esta campaña, qué NO copiar y 2-3 hipótesis medibles.\n` +
          `Termina con un bloque \`\`\`json {"modelos":[{"nombre","plataforma","por_que","patrones":[],"fuentes":[]}],"patrones_adaptables":[],"no_copiar":[],"hipotesis":[],"limitaciones":""}\`\`\`.` });
    } else {
      model = "sonnet";
      const { data: research } = await db.from("raxi_agent_jobs").select("output").eq("proposal_id", job.proposal_id)
        .eq("kind", "RESEARCH").eq("status", "SUCCEEDED").order("finished_at", { ascending: false }).limit(1).single();
      result = await callClaude({ model, maxTokens: 6000, aria: true, system: `${COMMON}\nEres el Director Creativo.\nReglas del dueño:\n${rulesOf(profile)}`,
        prompt: `Campaña: ${proposal?.title} (${proposal?.channel}, personaje ${proposal?.character_id}).\nResumen: ${proposal?.summary}\n\n` +
          `Investigación previa (JSON):\n${JSON.stringify(research?.output?.data ?? {}).slice(0, 12000)}\n\n` +
          `Usa la herramienta mis_personajes de Aria para respetar la identidad exacta del personaje y modelos para el precio real por imagen. ` +
          `Diseña el paquete de la campaña: concepto, microhistoria y publicaciones. Si es un Reel hecho con fotos ya existentes, entrega un kit de montaje (foto, segundos, texto en pantalla, ambiente musical) sin generar nada. ` +
          `Si requiere fotos nuevas: un prompt autónomo en inglés por foto (identidad, escena, vestuario, cámara/POV correcto, luz, realismo, salida única), texto bilingüe ES/EN breve y texto alternativo. ` +
          `Recomienda modelo de Aria y calcula el costo estimado total con los precios reales devueltos por la herramienta.\n` +
          `Termina con un bloque \`\`\`json {"concepto","microhistoria","publicaciones":[{"posicion","escena","plano","prompt","texto","alt"}],"montaje":[{"foto","segundos","texto_pantalla"}],"modelo_aria","costo_estimado_usd","checklist_qa":[]}\`\`\`.` });
    }
    const output = { markdown: result.text.slice(0, 60000), data: lastJson(result.text), sources: result.sources, model: MODELS[model].id };
    await db.from("raxi_agent_jobs").update({
      status: "SUCCEEDED", output, usage: result.usage, cost_usd: Number(result.cost.toFixed(4)), finished_at: now(), updated_at: now(),
    }).eq("id", job.id);
    await db.from("raxi_agent_tasks").update({ status: "COMPLETED", completed_at: now(), updated_at: now(),
      output_snapshot: { summary: `Listo · costo $${result.cost.toFixed(4)}`, job: job.id } }).eq("id", taskId);
    await event("RUNTIME_RESULT_COMMITTED");
  } catch (e) {
    const message = e instanceof Error ? e.message.slice(0, 900) : "error";
    await db.from("raxi_agent_jobs").update({ status: "FAILED", error: message, finished_at: now(), updated_at: now() }).eq("id", job.id);
    await db.from("raxi_agent_tasks").update({ status: "FAILED", completed_at: now(), updated_at: now(), output_snapshot: { error: message } }).eq("id", taskId);
  } finally {
    clearInterval(heartbeat);
  }
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
