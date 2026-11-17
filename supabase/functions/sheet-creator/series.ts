// Continuity series actions, on the same engine as the 360 sheet (cap, ledger, atomic claim, polling, key handling).
// No Deno/npm imports (unit-tested under Node).
import { CAP_MILLS, formatUsd, type Price, type Resolution } from './sheetPlan.ts';
import { CHANNEL_LEVEL, channelsFor, cleanScenes, isChannel, quoteSeries, seriesRefs, type Channel, type ContentLevel, type Ref } from './seriesPlan.ts';
import { buildSeriesPrompt, } from './seriesPrompts.ts';
import { MAX_INSTRUCTION } from './sheetPrompts.ts';
import type { EditBody, PollResult } from './wavespeed.ts';

export interface SeriesRow {
  id: string; character_id: string; channel: Channel; level: ContentLevel; base_asset_id: string; base_path: string;
  identity_version?: number; ref_asset_ids: string[]; ref_paths: string[]; scenes: string[]; model: string; resolution: Resolution;
  ceiling_mills: number; attested_not_real: true; collection_id?: string | null; proposal_id?: string | null; title?: string;
}
export interface SeriesTakeRow {
  id: string; series_id: string; shot_no: number; take_no: number; prompt: string; input_count: number; cost_mills: number;
  status: 'QUEUED' | 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  prediction_id?: string | null; object_path?: string | null; sha256?: string | null; byte_size?: number | null; mime_type?: string | null;
  error?: string | null; chosen_asset_id?: string | null;
}
export interface SeriesPhotoAsset {
  id: string; workspace_id: string; kind: 'ORIGINAL'; object_path: string; mime_type: string; byte_size: number; sha256: string;
  metadata: { character_id: string; content_level: ContentLevel; source: 'RAXI_SERIES'; series_id: string; take_id: string; shot: number; model: string };
}
export interface SeriesDependencies {
  price(model: string): Promise<Price | null>;
  fixedPrompt(workspaceId: string, character: string): Promise<string | null>;
  identityLocked(workspaceId: string, character: string): Promise<boolean>;
  /** A photo of this model (archive or reference, not retired) with its content level. */
  baseAsset(workspaceId: string, character: string, assetId: string): Promise<{ id: string; objectPath: string; level: ContentLevel } | null>;
  /** Current (not retired) references: general face front, general body front, adult body front. */
  currentRefs(workspaceId: string, character: string): Promise<{ face?: Ref; body?: Ref; adultBody?: Ref }>;
  monthSpendMills(actor: string): Promise<number>;
  createSeries(actor: string, series: SeriesRow & { title: string }, takes: SeriesTakeRow[]): Promise<void>;
  addSeriesTake(actor: string, take: SeriesTakeRow): Promise<void>;
  loadSeries(workspaceId: string, seriesId: string): Promise<{ series: SeriesRow; takes: SeriesTakeRow[] } | null>;
  loadSeriesTake(workspaceId: string, takeId: string): Promise<SeriesTakeRow | null>;
  updateTake(takeId: string, patch: Partial<SeriesTakeRow>): Promise<void>;
  claimTake(takeId: string): Promise<boolean>;
  signedUrl(path: string): Promise<string>;
  secret(actor: string): Promise<string | null>;
  submit(key: string, model: string, body: EditBody): Promise<string>;
  poll(key: string, predictionId: string): Promise<PollResult>;
  storeOutput(url: string, path: string): Promise<{ path: string; sha256: string; byteSize: number; mime: string }>;
  registerSeriesPhoto(row: SeriesPhotoAsset): Promise<void>;
  placeInCollection(workspaceId: string, collectionId: string, position: number, assetId: string, payload: Record<string, unknown>): Promise<void>;
  newId(): string;
}

const ROSTER = new Set(['raxi-vox', 'vesper-corvus']);
export type Out = { status: number; body: Record<string, unknown> };
const fail = (status: number, error: string): Out => ({ status, body: { error } });
const ok = (body: Record<string, unknown>): Out => ({ status: 200, body });
const isCap = (e: unknown) => typeof e === 'object' && e !== null && (e as { cap?: unknown }).cap === true;
export const SERIES_ACTIONS = new Set(['SERIES_QUOTE', 'SERIES_START', 'SERIES_STATUS', 'SERIES_RETAKE', 'SERIES_CHOOSE']);

export async function handleSeries(d: SeriesDependencies, actor: string, ws: string, b: Record<string, unknown>): Promise<Out> {
  const capOut = async () => fail(402, `Superarías el tope mensual: llevas ${formatUsd(await d.monthSpendMills(actor))} de $10.`);

  async function plan() {
    const character = b.character; const channel = b.channel; const model = b.model; const resolution = b.resolution;
    if (typeof character !== 'string' || !ROSTER.has(character) || !isChannel(channel)) return fail(400, 'Modelo o canal no válido.');
    if (typeof model !== 'string' || typeof resolution !== 'string' || typeof b.baseAssetId !== 'string') return fail(400, 'Falta la foto base, el modelo o la resolución.');
    const price = await d.price(model);
    if (!price) return fail(400, 'Ese modelo no está disponible todavía.');
    if (!(await d.identityLocked(ws, character))) return fail(400, 'Primero bloquea la identidad de la modelo en Talento.');
    const base = await d.baseAsset(ws, character, b.baseAssetId);
    if (!base) return fail(400, 'Esa foto base no es de esta modelo.');
    if (!channelsFor(base.level).includes(channel)) return fail(400, 'Una serie nunca baja de nivel: esta foto base no puede ir a ese canal.');
    const level = CHANNEL_LEVEL[channel];
    let scenes: string[]; let refs: Ref[]; let quote;
    try {
      scenes = cleanScenes(b.scenes);
      refs = seriesRefs(level, await d.currentRefs(ws, character));
      quote = quoteSeries({ shots: scenes.length, refs: refs.length, resolution: resolution as Resolution, price });
    } catch (e) { return fail(400, (e as Error).message); }
    return { character, channel, level, model, resolution: resolution as Resolution, base, scenes, refs, quote };
  }

  async function submitShot(key: string, s: SeriesRow, take: SeriesTakeRow) {
    if (!(await d.claimTake(take.id))) return;
    try {
      const images = await Promise.all([s.base_path, ...s.ref_paths].map((p) => d.signedUrl(p)));
      const id = await d.submit(key, s.model, { prompt: take.prompt, images, resolution: s.resolution });
      await d.updateTake(take.id, { status: 'PENDING', prediction_id: id });
    } catch (e) {
      await d.updateTake(take.id, { status: 'FAILED', error: (e as Error).message.slice(0, 300) });
    }
  }

  async function view(seriesId: string): Promise<Out> {
    const loaded = await d.loadSeries(ws, seriesId);
    if (!loaded) return fail(404, 'No encontré esa serie.');
    const s = loaded.series;
    const takes = await Promise.all([...loaded.takes].sort((a, c) => a.shot_no - c.shot_no || a.take_no - c.take_no).map(async (t) => ({
      id: t.id, shot: t.shot_no, takeNo: t.take_no, status: t.status, costMills: t.cost_mills, error: t.error ?? null,
      chosen: Boolean(t.chosen_asset_id), previewUrl: t.object_path ? await d.signedUrl(t.object_path) : null })));
    return ok({ seriesId: s.id, character: s.character_id, channel: s.channel, level: s.level, model: s.model, scenes: s.scenes,
      baseUrl: await d.signedUrl(s.base_path), collectionId: s.collection_id ?? null, takes });
  }

  switch (b.action) {
    case 'SERIES_QUOTE': {
      const p = await plan();
      if ('status' in p) return p;
      return ok({ totalMills: p.quote.totalMills, perPhotoMills: p.quote.perPhotoMills, level: p.level, channels: channelsFor(p.base.level),
        spentMills: await d.monthSpendMills(actor), capMills: CAP_MILLS });
    }
    case 'SERIES_START': {
      const p = await plan();
      if ('status' in p) return p;
      if (b.attestNotReal !== true) return fail(400, 'Confirma que es un personaje creado con IA y no la imagen de una persona real.');
      if (b.expectedTotalMills !== p.quote.totalMills) return fail(409, 'El costo cambió. Vuelve a cotizar antes de crear.');
      const key = await d.secret(actor);
      if (!key) return fail(412, 'Conecta tu clave de WaveSpeed en Conexiones antes de crear.');
      const fixed = await d.fixedPrompt(ws, p.character);
      const series: SeriesRow & { title: string } = { id: d.newId(), character_id: p.character, channel: p.channel, level: p.level, base_asset_id: p.base.id,
        base_path: p.base.objectPath, ref_asset_ids: p.refs.map((r) => r.id), ref_paths: p.refs.map((r) => r.objectPath), scenes: p.scenes,
        model: p.model, resolution: p.resolution, ceiling_mills: p.quote.totalMills, attested_not_real: true,
        proposal_id: typeof b.proposalId === 'string' ? b.proposalId : null,
        title: typeof b.title === 'string' && b.title.trim() ? b.title.trim().slice(0, 160) : 'Serie de continuidad' };
      let takes: SeriesTakeRow[];
      try {
        takes = p.scenes.map((scene, i) => ({ id: d.newId(), series_id: series.id, shot_no: i + 1, take_no: 1, input_count: p.quote.inputs,
          cost_mills: p.quote.perPhotoMills, status: 'QUEUED' as const, prompt: buildSeriesPrompt({ fixedPrompt: fixed, scene }) }));
      } catch (e) { return fail(400, (e as Error).message); }
      try { await d.createSeries(actor, series, takes); } catch (e) { if (isCap(e)) return capOut(); throw e; }
      for (const t of takes) await submitShot(key, series, t); // no anchor: the base already exists
      return view(series.id);
    }
    case 'SERIES_STATUS': {
      if (typeof b.seriesId !== 'string') return fail(400, 'Falta la serie.');
      const loaded = await d.loadSeries(ws, b.seriesId);
      if (!loaded) return fail(404, 'No encontré esa serie.');
      const pending = loaded.takes.filter((t) => t.status === 'PENDING' && t.prediction_id);
      const queued = loaded.takes.filter((t) => t.status === 'QUEUED');
      if (pending.length || queued.length) {
        const key = await d.secret(actor);
        if (!key) return fail(412, 'Conecta tu clave de WaveSpeed en Conexiones.');
        for (const t of pending) {
          let r: PollResult;
          try { r = await d.poll(key, t.prediction_id!); } catch { continue; }
          if (r.status === 'SUCCEEDED') {
            try {
              const out = await d.storeOutput(r.outputUrl, `${ws}/series/${loaded.series.id}/${t.shot_no}/${t.take_no}.png`);
              await d.updateTake(t.id, { status: 'SUCCEEDED', object_path: out.path, sha256: out.sha256, byte_size: out.byteSize, mime_type: out.mime });
            } catch { /* retried on the next STATUS */ }
          } else if (r.status === 'FAILED') await d.updateTake(t.id, { status: 'FAILED', error: r.error });
        }
        for (const t of queued) await submitShot(key, loaded.series, t); // a take reserved but never sent (e.g. interrupted start)
      }
      return view(loaded.series.id);
    }
    case 'SERIES_RETAKE': {
      if (typeof b.seriesId !== 'string' || typeof b.shot !== 'number') return fail(400, 'Falta la serie o la foto.');
      const loaded = await d.loadSeries(ws, b.seriesId);
      if (!loaded) return fail(404, 'No encontré esa serie.');
      const s = loaded.series;
      const shot = b.shot;
      if (!Number.isInteger(shot) || shot < 1 || shot > s.scenes.length) return fail(400, 'Esa foto no existe en la serie.');
      const price = await d.price(s.model);
      if (!price) return fail(400, 'Ese modelo no está disponible todavía.');
      const quote = quoteSeries({ shots: 1, refs: s.ref_paths.length, resolution: s.resolution, price });
      if (b.expectedCostMills !== quote.perPhotoMills) return fail(409, 'El costo cambió. Vuelve a cotizar.');
      const key = await d.secret(actor);
      if (!key) return fail(412, 'Conecta tu clave de WaveSpeed en Conexiones.');
      const instruction = typeof b.instruction === 'string' ? b.instruction.trim().slice(0, MAX_INSTRUCTION) : null;
      let prompt: string;
      try { prompt = buildSeriesPrompt({ fixedPrompt: await d.fixedPrompt(ws, s.character_id), scene: s.scenes[shot - 1], instruction }); }
      catch (e) { return fail(400, (e as Error).message); }
      const take: SeriesTakeRow = { id: d.newId(), series_id: s.id, shot_no: shot, take_no: Math.max(0, ...loaded.takes.filter((t) => t.shot_no === shot).map((t) => t.take_no)) + 1,
        prompt, input_count: quote.inputs, cost_mills: quote.perPhotoMills, status: 'QUEUED' };
      try { await d.addSeriesTake(actor, take); } catch (e) { if (isCap(e)) return capOut(); throw e; }
      await submitShot(key, s, take);
      return view(s.id);
    }
    case 'SERIES_CHOOSE': {
      if (typeof b.takeId !== 'string') return fail(400, 'Falta la foto.');
      const take = await d.loadSeriesTake(ws, b.takeId);
      if (!take) return fail(404, 'No encontré esa foto.');
      if (take.status !== 'SUCCEEDED' || !take.object_path || !take.sha256) return fail(409, 'Esa foto todavía no está lista.');
      if (take.chosen_asset_id) return ok({ assetId: take.chosen_asset_id, duplicate: true });
      const loaded = await d.loadSeries(ws, take.series_id);
      if (!loaded) return fail(404, 'No encontré esa serie.');
      const s = loaded.series;
      const id = d.newId();
      await d.registerSeriesPhoto({ id, workspace_id: ws, kind: 'ORIGINAL', object_path: take.object_path, mime_type: take.mime_type ?? 'image/png', byte_size: take.byte_size ?? 0, sha256: take.sha256,
        metadata: { character_id: s.character_id, content_level: s.level, source: 'RAXI_SERIES', series_id: s.id, take_id: take.id, shot: take.shot_no, model: s.model } });
      await d.updateTake(take.id, { chosen_asset_id: id });
      for (const other of loaded.takes.filter((t) => t.shot_no === take.shot_no && t.id !== take.id && t.chosen_asset_id)) await d.updateTake(other.id, { chosen_asset_id: null });
      if (s.collection_id) await d.placeInCollection(ws, s.collection_id, take.shot_no + 1, id, { kind: 'SERIES_PHOTO', series_id: s.id, take_id: take.id, content_level: s.level });
      return ok({ assetId: id, duplicate: false });
    }
  }
  return fail(400, 'Acción no válida.');
}
