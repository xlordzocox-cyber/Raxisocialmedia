// sheet-creator: creates a model's 360 sheet with WaveSpeed. No Deno/npm imports (unit-tested under Node).
// Rules enforced here and in the database: owner session, roster, "not a real person" attestation,
// server-side price check (the click is the approval), $10/month cap, anchor-first chain, key never returned.
import { anchorOf, chainImages, formatUsd, inputsFor, isLevel, isView, quoteRun, takeCost, viewsFor, CAP_MILLS, type Level, type Price, type Resolution, type View } from './sheetPlan.ts';
import { buildSheetPrompt, MAX_ADULT_TEMPLATE, MAX_INSTRUCTION } from './sheetPrompts.ts';
import type { EditBody, PollResult, ReferenceBody } from './wavespeed.ts';
import { handleSeries, SERIES_ACTIONS, type SeriesDependencies } from './series.ts';
import { handleRecreate, RECREATE_ACTIONS, type RecreateDependencies } from './recreate.ts';
import { handleModelTest, MODELTEST_ACTIONS, type ModelTestDependencies } from './modelTest.ts';

export type TakeStatus = 'QUEUED' | 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
export interface RunRow {
  id: string; character_id: string; level: Level; model: string; resolution: Resolution;
  source_asset_ids: string[]; source_paths: string[]; attested_not_real: true; adult_template: string | null; created_at?: string;
}
export interface TakeRow {
  id: string; run_id: string; view: View; take_no: number; prompt: string; input_count: number; cost_mills: number; status: TakeStatus;
  prediction_id?: string | null; object_path?: string | null; sha256?: string | null; byte_size?: number | null; mime_type?: string | null;
  error?: string | null; chosen_asset_id?: string | null; created_at?: string;
}
export interface AssetRef { id: string; objectPath: string }
export interface CreatorReference {
  id: string; workspace_id: string; kind: 'REFERENCE'; object_path: string; mime_type: string; byte_size: number; sha256: string;
  metadata: { character_id: string; angle: View; content_level: 'PUBLIC' | 'NSFW'; source: 'RAXI_CREATOR'; run_id: string; take_id: string; model: string };
}
export interface SheetDependencies {
  verifyUser(token: string): Promise<{ id: string; isAnonymous: boolean } | null>;
  workspaceOf(userId: string): Promise<string | null>;
  price(model: string): Promise<Price | null>;
  fixedPrompt(workspaceId: string, character: string): Promise<string | null>;
  /** Owner's uploaded photos of this model (REFERENCE, general level). Null if any id is foreign or missing. */
  sourceAssets(workspaceId: string, character: string, ids: string[]): Promise<AssetRef[] | null>;
  /** Newest general FRONT and BODY_FRONT references of this model. */
  generalAnchors(workspaceId: string, character: string): Promise<Partial<Record<'FRONT' | 'BODY_FRONT', AssetRef>>>;
  monthSpendMills(actor: string): Promise<number>;
  /** Atomic: checks the monthly cap and inserts the run and its takes. Throws an error with `cap: true` when over the cap. */
  createRun(actor: string, run: RunRow, takes: TakeRow[]): Promise<void>;
  addTake(actor: string, take: TakeRow): Promise<void>;
  latestRun?(workspaceId: string, character: string, level: Level): Promise<string | null>;
  loadRun(workspaceId: string, runId: string): Promise<{ run: RunRow; takes: TakeRow[] } | null>;
  loadTake(workspaceId: string, takeId: string): Promise<TakeRow | null>;
  updateTake(takeId: string, patch: Partial<TakeRow>): Promise<void>;
  /** Atomically moves a take from QUEUED to PENDING; false if another request already claimed it (prevents double charges). */
  claimTake(takeId: string): Promise<boolean>;
  signedUrl(path: string): Promise<string>;
  secret(actor: string): Promise<string | null>;
  submit(key: string, model: string, body: EditBody | ReferenceBody): Promise<string>;
  poll(key: string, predictionId: string): Promise<PollResult>;
  storeOutput(url: string, path: string): Promise<{ path: string; sha256: string; byteSize: number; mime: string }>;
  registerReference(row: CreatorReference): Promise<void>;
  /** Retires this model's older references for the same view and level, so Talento keeps one chosen image per view. */
  supersede(workspaceId: string, character: string, angle: View, level: 'PUBLIC' | 'NSFW', keepId: string): Promise<void>;
  newId(): string;
}

const ROSTER = new Set(['raxi-vox', 'vesper-corvus']);
const MAX_BODY = 16 * 1024;
const MAX_UPLOAD_BODY = 6 * 1024 * 1024; // only RECREATE_PROMPT carries a photo (≤ 3 MB as base64)
class Reply { constructor(readonly status: number, readonly body: Record<string, unknown>) {} }
const fail = (status: number, error: string) => new Reply(status, { error });
const isCap = (e: unknown) => typeof e === 'object' && e !== null && (e as { cap?: unknown }).cap === true;

export function createSheetHandler(d: SheetDependencies & SeriesDependencies & RecreateDependencies & ModelTestDependencies) {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Cache-Control': 'no-store' };
  const reply = (r: Reply) => Response.json(r.body, { status: r.status, headers });

  async function capReply(actor: string) { return fail(402, `Superarías el tope mensual: llevas ${formatUsd(await d.monthSpendMills(actor))} de $10.`); }

  async function plan(ws: string, b: Record<string, unknown>) {
    const character = b.character; const level = b.level; const model = b.model; const resolution = b.resolution;
    if (typeof character !== 'string' || !ROSTER.has(character) || !isLevel(level)) throw fail(400, 'Modelo o tipo de ficha no válido.');
    if (typeof model !== 'string' || typeof resolution !== 'string') throw fail(400, 'Falta el modelo o la resolución.');
    const price = await d.price(model);
    if (!price) throw fail(400, 'Ese modelo no está disponible todavía.');
    let sources: AssetRef[];
    if (level === 'GENERAL') {
      const ids = Array.isArray(b.sourceIds) ? b.sourceIds.filter((x): x is string => typeof x === 'string') : [];
      if (ids.length < 1 || ids.length > 3) throw fail(400, 'Sube de 1 a 3 fotos de la modelo.');
      const found = await d.sourceAssets(ws, character, ids);
      if (!found) throw fail(400, 'Alguna foto no pertenece a esta modelo.');
      sources = found;
    } else {
      const a = await d.generalAnchors(ws, character);
      if (!a.FRONT || !a.BODY_FRONT) throw fail(400, 'Primero elige la cara y el cuerpo de frente de la ficha general.');
      sources = [a.BODY_FRONT, a.FRONT];
    }
    let quote;
    try { quote = quoteRun({ level, sources: sources.length, resolution: resolution as Resolution, price }); } catch (e) { throw fail(400, (e as Error).message); }
    return { character, level, model, resolution: resolution as Resolution, price, sources, quote };
  }

  async function submitTake(key: string, run: RunRow, take: TakeRow, anchorPath: string | null) {
    if (!(await d.claimTake(take.id))) return;
    try {
      const sources = await Promise.all(run.source_paths.map((p) => d.signedUrl(p)));
      const anchor = anchorPath ? await d.signedUrl(anchorPath) : null;
      const images = chainImages(run.level, take.view, sources, anchor);
      const id = await d.submit(key, run.model, { prompt: take.prompt, images, resolution: run.resolution });
      await d.updateTake(take.id, { status: 'PENDING', prediction_id: id });
    } catch (e) {
      await d.updateTake(take.id, { status: 'FAILED', error: (e as Error).message.slice(0, 300) });
    }
  }

  const anchorDone = (run: RunRow, takes: TakeRow[]) => takes.filter((t) => t.view === anchorOf(run.level) && t.status === 'SUCCEEDED' && t.object_path)
    .sort((a, b) => b.take_no - a.take_no)[0] ?? null;

  async function view(ws: string, runId: string) {
    const loaded = await d.loadRun(ws, runId);
    if (!loaded) throw fail(404, 'No encontré esa ficha.');
    const takes = await Promise.all(loaded.takes.sort((a, b) => viewsFor(loaded.run.level).indexOf(a.view) - viewsFor(loaded.run.level).indexOf(b.view) || a.take_no - b.take_no)
      .map(async (t) => ({ id: t.id, view: t.view, takeNo: t.take_no, status: t.status, costMills: t.cost_mills, error: t.error ?? null,
        chosen: Boolean(t.chosen_asset_id), previewUrl: t.object_path ? await d.signedUrl(t.object_path) : null })));
    const r = loaded.run;
    return { runId: r.id, character: r.character_id, level: r.level, model: r.model, resolution: r.resolution, takes };
  }

  async function handle(request: Request): Promise<Reply> {
    const token = /^Bearer ([^\s]+)$/i.exec(request.headers.get('Authorization') ?? '')?.[1];
    if (!token) return fail(401, 'Sesión requerida.');
    const user = await d.verifyUser(token);
    if (!user || user.isAnonymous) return fail(401, 'Sesión no válida.');
    const ws = await d.workspaceOf(user.id);
    if (!ws) return fail(403, 'No tienes acceso a este workspace.');
    const raw = await request.text();
    if (raw.length > MAX_UPLOAD_BODY) return fail(413, 'Solicitud demasiado grande.');
    let b: Record<string, unknown>;
    try { b = JSON.parse(raw); } catch { return fail(400, 'Solicitud inválida.'); }
    if (!b || typeof b !== 'object') return fail(400, 'Solicitud inválida.');
    if (raw.length > MAX_BODY && b.action !== 'RECREATE_PROMPT') return fail(413, 'Solicitud demasiado grande.');

    switch (b.action) {
      case 'QUOTE': {
        const p = await plan(ws, b);
        return new Reply(200, { totalMills: p.quote.totalMills, spentMills: await d.monthSpendMills(user.id), capMills: CAP_MILLS, takes: p.quote.takes.map((t) => t.costMills) });
      }
      case 'START': {
        const p = await plan(ws, b);
        if (b.attestNotReal !== true) return fail(400, 'Confirma que es un personaje creado con IA y no la imagen de una persona real.');
        if (b.expectedTotalMills !== p.quote.totalMills) return fail(409, 'El costo cambió. Vuelve a cotizar antes de crear.');
        const adultTemplate = p.level === 'ADULT' && typeof b.adultTemplate === 'string' && b.adultTemplate.trim() ? b.adultTemplate.trim() : null;
        if (adultTemplate && adultTemplate.length > MAX_ADULT_TEMPLATE) return fail(400, 'La plantilla adulta es demasiado larga.');
        const key = await d.secret(user.id);
        if (!key) return fail(412, 'Conecta tu clave de WaveSpeed en Conexiones antes de crear.');
        const fixed = await d.fixedPrompt(ws, p.character);
        const run: RunRow = { id: d.newId(), character_id: p.character, level: p.level, model: p.model, resolution: p.resolution,
          source_asset_ids: p.sources.map((s) => s.id), source_paths: p.sources.map((s) => s.objectPath), attested_not_real: true, adult_template: adultTemplate };
        let takes: TakeRow[];
        try {
          takes = p.quote.takes.map((t) => ({ id: d.newId(), run_id: run.id, view: t.view, take_no: 1, input_count: t.inputs, cost_mills: t.costMills, status: 'QUEUED' as const,
            prompt: buildSheetPrompt({ level: p.level, view: t.view, fixedPrompt: fixed, adultTemplate }) }));
        } catch (e) { return fail(400, (e as Error).message); }
        try { await d.createRun(user.id, run, takes); } catch (e) { if (isCap(e)) return capReply(user.id); throw e; }
        await submitTake(key, run, takes[0], null);
        const loaded = await d.loadRun(ws, run.id);
        if (loaded && loaded.takes.find((t) => t.id === takes[0].id)?.status === 'FAILED') {
          for (const t of takes.slice(1)) await d.updateTake(t.id, { status: 'CANCELLED' });
        }
        return new Reply(200, await view(ws, run.id));
      }
      case 'STATUS': {
        if (typeof b.runId !== 'string') return fail(400, 'Falta la ficha.');
        const loaded = await d.loadRun(ws, b.runId);
        if (!loaded) return fail(404, 'No encontré esa ficha.');
        const pending = loaded.takes.filter((t) => t.status === 'PENDING' && t.prediction_id);
        const queued = loaded.takes.filter((t) => t.status === 'QUEUED');
        if (pending.length || queued.length) {
          const key = await d.secret(user.id);
          if (!key) return fail(412, 'Conecta tu clave de WaveSpeed en Conexiones.');
          for (const t of pending) {
            let r: PollResult;
            try { r = await d.poll(key, t.prediction_id!); } catch { continue; }
            if (r.status === 'SUCCEEDED') {
              try {
                const out = await d.storeOutput(r.outputUrl, `${ws}/sheets/${loaded.run.id}/${t.view}/${t.take_no}.png`);
                await d.updateTake(t.id, { status: 'SUCCEEDED', object_path: out.path, sha256: out.sha256, byte_size: out.byteSize, mime_type: out.mime });
              } catch { /* retried on the next STATUS */ }
            } else if (r.status === 'FAILED') await d.updateTake(t.id, { status: 'FAILED', error: r.error });
          }
          const now = (await d.loadRun(ws, loaded.run.id))!;
          const anchor = anchorDone(now.run, now.takes);
          const stillQueued = now.takes.filter((t) => t.status === 'QUEUED');
          if (anchor) for (const t of stillQueued) await submitTake(key, now.run, t, anchor.object_path!);
          else if (!now.takes.some((t) => t.view === anchorOf(now.run.level) && (t.status === 'PENDING' || t.status === 'QUEUED'))) {
            for (const t of stillQueued) await d.updateTake(t.id, { status: 'CANCELLED' });
          }
        }
        return new Reply(200, await view(ws, loaded.run.id));
      }
      case 'LATEST': {
        if (typeof b.character !== 'string' || !ROSTER.has(b.character) || !isLevel(b.level)) return fail(400, 'Modelo o tipo de ficha no válido.');
        const id = d.latestRun ? await d.latestRun(ws, b.character, b.level) : null;
        return new Reply(200, id ? await view(ws, id) : { runId: null });
      }
      case 'RETAKE': {
        if (typeof b.runId !== 'string' || !isView(b.view)) return fail(400, 'Falta la ficha o la vista.');
        const loaded = await d.loadRun(ws, b.runId);
        if (!loaded) return fail(404, 'No encontré esa ficha.');
        const { run, takes } = loaded;
        const v = b.view;
        if (!viewsFor(run.level).includes(v)) return fail(400, 'Esa vista no existe en esta ficha.');
        const anchor = anchorDone(run, takes);
        if (v !== anchorOf(run.level) && !anchor) return fail(409, 'Primero tiene que estar lista la vista de frente.');
        const price = await d.price(run.model);
        if (!price) return fail(400, 'Ese modelo no está disponible todavía.');
        const inputs = inputsFor(run.level, v, run.source_paths.length);
        let cost: number;
        try { cost = takeCost(price, run.resolution, inputs); } catch (e) { return fail(400, (e as Error).message); }
        if (b.expectedCostMills !== cost) return fail(409, 'El costo cambió. Vuelve a cotizar.');
        const instruction = typeof b.instruction === 'string' ? b.instruction.trim().slice(0, MAX_INSTRUCTION) : null;
        const key = await d.secret(user.id);
        if (!key) return fail(412, 'Conecta tu clave de WaveSpeed en Conexiones.');
        const fixed = await d.fixedPrompt(ws, run.character_id);
        let prompt: string;
        try { prompt = buildSheetPrompt({ level: run.level, view: v, fixedPrompt: fixed, instruction, adultTemplate: run.adult_template }); } catch (e) { return fail(400, (e as Error).message); }
        const take: TakeRow = { id: d.newId(), run_id: run.id, view: v, take_no: Math.max(0, ...takes.filter((t) => t.view === v).map((t) => t.take_no)) + 1,
          prompt, input_count: inputs, cost_mills: cost, status: 'QUEUED' };
        try { await d.addTake(user.id, take); } catch (e) { if (isCap(e)) return capReply(user.id); throw e; }
        await submitTake(key, run, take, v === anchorOf(run.level) ? null : anchor!.object_path!);
        return new Reply(200, await view(ws, run.id));
      }
      case 'CHOOSE': {
        if (typeof b.takeId !== 'string') return fail(400, 'Falta la toma.');
        const take = await d.loadTake(ws, b.takeId);
        if (!take) return fail(404, 'No encontré esa toma.');
        if (!take.run_id) return fail(409, 'Esa foto es de una serie.');
        if (take.status !== 'SUCCEEDED' || !take.object_path || !take.sha256) return fail(409, 'Esa toma todavía no está lista.');
        if (take.chosen_asset_id) return new Reply(200, { assetId: take.chosen_asset_id, duplicate: true });
        const loaded = await d.loadRun(ws, take.run_id);
        if (!loaded) return fail(404, 'No encontré esa ficha.');
        const id = d.newId();
        const level = loaded.run.level === 'ADULT' ? 'NSFW' as const : 'PUBLIC' as const;
        await d.registerReference({ id, workspace_id: ws, kind: 'REFERENCE', object_path: take.object_path, mime_type: take.mime_type ?? 'image/png', byte_size: take.byte_size ?? 0, sha256: take.sha256,
          metadata: { character_id: loaded.run.character_id, angle: take.view, content_level: level, source: 'RAXI_CREATOR', run_id: loaded.run.id, take_id: take.id, model: loaded.run.model } });
        await d.updateTake(take.id, { chosen_asset_id: id });
        await d.supersede(ws, loaded.run.character_id, take.view, level, id);
        return new Reply(200, { assetId: id, duplicate: false });
      }
      default: {
        if (typeof b.action === 'string' && SERIES_ACTIONS.has(b.action)) { const out = await handleSeries(d, user.id, ws, b); return new Reply(out.status, out.body); }
        if (typeof b.action === 'string' && RECREATE_ACTIONS.has(b.action)) { const out = await handleRecreate(d, user.id, ws, b); return new Reply(out.status, out.body); }
        if (typeof b.action === 'string' && MODELTEST_ACTIONS.has(b.action)) { const out = await handleModelTest(d, user.id, ws, b); return new Reply(out.status, out.body); }
        return fail(400, 'Acción no válida.');
      }
    }
  }

  return async (request: Request): Promise<Response> => {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return reply(fail(405, 'Método no permitido.'));
    try { return reply(await handle(request)); }
    catch (e) { return reply(e instanceof Reply ? e : fail(503, 'No se pudo completar. No se confirmó ningún gasto nuevo.')); }
  };
}
