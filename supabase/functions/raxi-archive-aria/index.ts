// Raxi HQ — Fototeca archiver.
// Processes PENDING rows of public.raxi_archive_requests (enqueued only by privileged roles):
// downloads the Aria Studio image, verifies type/size, computes SHA-256, stores the original
// bytes in the private bucket and registers raxi_assets. Request bodies are ignored, so a caller
// can only trigger processing of work that is already queued.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const BUCKET = "raxi-hq-private";
const MAX_BYTES = 50 * 1024 * 1024;
const BATCH = 5;
const MAX_ATTEMPTS = 3;
const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

function allowedSource(raw: string): URL | null {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && u.hostname === "studio.ariacruz.com" && u.pathname === "/mcp/img" ? u : null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
  const { data: pending, error } = await db
    .from("raxi_archive_requests")
    .select("id, workspace_id, source_url, aria_file, character_id, attempts")
    .eq("status", "PENDING")
    .order("created_at")
    .limit(BATCH);
  if (error) return Response.json({ ok: false, error: "queue read failed" }, { status: 500 });

  const results: unknown[] = [];
  for (const r of pending ?? []) {
    const { data: claimed } = await db
      .from("raxi_archive_requests")
      .update({ status: "PROCESSING", attempts: r.attempts + 1, updated_at: new Date().toISOString() })
      .eq("id", r.id)
      .eq("status", "PENDING")
      .select("id");
    if (!claimed?.length) continue;
    try {
      const src = allowedSource(r.source_url);
      if (!src) throw new Error("source not allowed");
      const res = await fetch(src, { redirect: "error" });
      if (!res.ok) throw new Error(`download ${res.status}`);
      const mime = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
      if (!EXT[mime]) throw new Error(`unsupported type ${mime}`);
      const bytes = await res.arrayBuffer();
      if (bytes.byteLength < 1 || bytes.byteLength > MAX_BYTES) throw new Error("invalid size");
      const sha256 = hex(await crypto.subtle.digest("SHA-256", bytes));

      const { data: existing } = await db
        .from("raxi_assets")
        .select("id")
        .eq("workspace_id", r.workspace_id)
        .eq("sha256", sha256)
        .limit(1);
      let assetId = existing?.[0]?.id as string | undefined;
      if (!assetId) {
        assetId = crypto.randomUUID();
        const path = `${r.workspace_id}/${assetId}/original.${EXT[mime]}`;
        const up = await db.storage.from(BUCKET).upload(path, bytes, { contentType: mime, upsert: false });
        if (up.error) throw new Error(`upload: ${up.error.message}`);
        const ins = await db.from("raxi_assets").insert({
          id: assetId,
          workspace_id: r.workspace_id,
          external_asset_id: r.aria_file,
          kind: "ORIGINAL",
          bucket_id: BUCKET,
          object_path: path,
          mime_type: mime,
          byte_size: bytes.byteLength,
          sha256,
          metadata: { source: "ARIA_LIBRARY", aria_file: r.aria_file, character_id: r.character_id, archived_at: new Date().toISOString() },
        });
        if (ins.error) {
          await db.storage.from(BUCKET).remove([path]);
          throw new Error(`register: ${ins.error.message}`);
        }
      }
      await db.from("raxi_archive_requests")
        .update({ status: "DONE", asset_id: assetId, error: null, updated_at: new Date().toISOString() })
        .eq("id", r.id);
      await db.from("raxi_portfolio_items")
        .update({ asset_id: assetId, updated_at: new Date().toISOString() })
        .eq("workspace_id", r.workspace_id)
        .eq("aria_file", r.aria_file)
        .is("asset_id", null);
      results.push({ id: r.id, status: "DONE", sha256 });
    } catch (e) {
      const message = e instanceof Error ? e.message.slice(0, 300) : "unknown error";
      const retry = r.attempts + 1 < MAX_ATTEMPTS;
      await db.from("raxi_archive_requests")
        .update({ status: retry ? "PENDING" : "FAILED", error: message, updated_at: new Date().toISOString() })
        .eq("id", r.id);
      results.push({ id: r.id, status: retry ? "RETRY" : "FAILED", error: message });
    }
  }
  return Response.json({ ok: true, processed: results.length, results });
});
