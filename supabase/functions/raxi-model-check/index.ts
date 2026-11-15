// Returns only whether a fixed model supports server-side web search (Models API). No secrets, no prompts, no cost.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
Deno.serve(async () => {
  const out: Record<string, unknown> = {};
  for (const id of ["claude-haiku-5-5", "claude-sonnet-5-5"]) {
    const r = await fetch(`https://api.anthropic.com/v1/models/${id}`, { headers: { "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!, "anthropic-version": "2023-06-01" } });
    const j = await r.json().catch(() => ({}));
    out[id] = { status: r.status, web_search: j?.capabilities?.server_tools?.web_search?.supported ?? null, max_output: j?.max_tokens ?? j?.capabilities?.max_output_tokens ?? null };
  }
  return Response.json(out);
});
