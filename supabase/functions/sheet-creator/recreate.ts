// Recrear actions, on the same engine as the 360 sheet and the series (cap, ledger, atomic claim, polling, key handling).
// No Deno/npm imports (unit-tested under Node).
import { CAP_MILLS, formatUsd, type Price, type Resolution } from './sheetPlan.ts';
import { SERIES_RESOLUTION, type Ref } from './seriesPlan.ts';
import { buildRecreatePrompt, cleanAdultText, cleanEditedPrompt, cleanVariants, decodeTarget, draftFolder, isDraftPath, isStyle, quoteRecreate, recreateRefs, recreateRule,
  CHANNEL_LEVEL, isChannel, MAX_SCENE_TEXT, type Channel, type ContentLevel, type Style } from './recreatePlan.ts';
import { MAX_INSTRUCTION } from './sheetPrompts.ts';
import type { PrompterInput, PrompterResult } from './recreatePrompter.ts';
import type { EditBody, PollResult } from './wavespeed.ts';

export interface RecreationRow {
  id: string; character_id: string; channel: Channel; level: ContentLevel; objective_path: string; ref_asset_ids: string[]; ref_paths: string[];
  style: Style; scene: string | null; prompt: string; adult_text: string | null; prompt_cost_mills: number; variants: number; model: string; resolution: Resolution;
  ceiling_mills: number; attested_not_real: true;
}
export interface RecreateTakeRow {
  id: string; recreation_id: string; variant_no: number; take_no: number; prompt: string; input_count: number; cost_mills: number;
  status: 'QUEUED' | 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  prediction_id?: string | null; object_path?: string | null; sha256?: string | null; byte_size?: number | null; mime_type?: string | null;
  error?: string | null; chosen_asset_id?: string | null;
}
export interface RecreatePhotoAsset {
  id: string; workspace_id: string; kind: 'ORIGINAL'; object_path: string; mime_type: string; byte_size: number; sha256: string;
  metadata: { character_id: string; content_level: ContentLevel; source: 'RAXI_RECREATE'; recreation_id: string; take_id: string; variant: number; model: string };
}
export interface RecreateDependencies {
  price(model: string): Promise<Price | null>;
  fixedPrompt(workspaceId: string, character: string): Promise<string | null>;
  identityLocked(workspaceId: string, character: string): Promise<boolean>;
  currentRefs(workspaceId: string, character: string): Promise<{ face?: Ref; body?: Ref; adultBody?: Ref }>;
  monthSpendMills(actor: string): Promise<number>;
  storeUpload(path: string, bytes: Uint8Array, mime: string): Promise<void>;
  prompterKey(): string | null;
  writePrompt(key: string, input: PrompterInput): Promise<PrompterResult>;
  audit(workspaceId: string, action: string, details: Record<string, unknown>): Promise<void>;
  /** Prompter calls today (successful or failed) for this workspace. */
  promptsToday(workspaceId: string): Promise<number>;
  createRecreation(actor: string, rec: RecreationRow, takes: RecreateTakeRow[]): Promise<void>;
  addRecreationTake(actor: string, take: RecreateTakeRow): Promise<void>;
  loadRecreation(workspaceId: string, id: string): Promise<{ rec: RecreationRow; takes: RecreateTakeRow[] } | null>;
  loadRecreationTake(workspaceId: string, takeId: string): Promise<RecreateTakeRow | null>;
  updateTake(takeId: string, patch: Partial<RecreateTakeRow>): Promise<void>;
  claimTake(takeId: string): Promise<boolean>;
  signedUrl(path: string): Promise<string>;
  secret(actor: string): Promise<string | null>;
  submit(key: string, model: string, body: EditBody): Promise<string>;
  poll(key: string, predictionId: string): Promise<PollResult>;
  storeOutput(url: string, path: string): Promise<{ path: string; sha256: string; byteSize: number; mime: string }>;
  registerRecreatePhoto(row: RecreatePhotoAsset): Promise<void>;
  newId(): string;
}

const ROSTER = new Set(['raxi-vox', 'vesper-corvus']);
type Out = { status: number; body: Record<string, unknown> };
const fail = (status: number, error: string): Out => ({ status, body: { error } });
const ok = (body: Record<string, unknown>): Out => ({ status: 200, body });
const isCap = (e: unknown) => typeof e === 'object' && e !== null && (e as { cap?: unknown }).cap === true;
export const RECREATE_ACTIONS = new Set(['RECREATE_UPLOAD', 'RECREATE_PROMPT', 'RECREATE_QUOTE', 'RECREATE_START', 'RECREATE_STATUS', 'RECREATE_RETAKE', 'RECREATE_CHOOSE']);
const MAX_DAILY_PROMPTS = 40; // prompter calls cost Claude tokens; a hard daily ceiling per workspace

export async function handleRecreate(d: RecreateDependencies, actor: string, ws: string, b: Record<string, unknown>): Promise<Out> {
  const capOut = async () => fail(402, `Superarías el tope mensual: llevas ${formatUsd(await d.monthSpendMills(actor))} de $10.`);

  async function identity(character: unknown) {
    if (typeof character !== 'string' || !ROSTER.has(character)) return fail(400, 'Modelo no válida.');
    if (!(await d.identityLocked(ws, character))) return fail(400, 'Primero bloquea la identidad de la modelo en Talento.');
    const refs = await d.currentRefs(ws, character);
    if (!refs.face) return fail(400, 'Primero elige la cara de frente de la ficha general.');
    return { character, face: refs.face, refs };
  }
  const levelOf = (channel: unknown): ContentLevel | null => (isChannel(channel) ? CHANNEL_LEVEL[channel] : null);

  async function plan() {
    const id = await identity(b.character);
    if ('status' in id) return id;
    const level = levelOf(b.channel);
    if (!level || !isChannel(b.channel)) return fail(400, 'Canal no válido.');
    if (!isStyle(b.style)) return fail(400, 'Estilo no válido.');
    if (typeof b.model !== 'string') return fail(400, 'Falta el modelo.');
    const price = await d.price(b.model);
    if (!price) return fail(400, 'Ese modelo no está disponible todavía.');
    let variants: number; let quote; let refs: Ref[];
    try { variants = cleanVariants(b.variants); refs = recreateRefs(level, id.refs); quote = quoteRecreate({ variants, price, resolution: SERIES_RESOLUTION, refs: refs.length }); }
    catch (e) { return fail(400, (e as Error).message); }
    return { ...id, channel: b.channel, level, refs: refs, style: b.style, model: b.model, variants, quote };
  }

  async function submitTake(key: string, rec: RecreationRow, take: RecreateTakeRow) {
    if (!(await d.claimTake(take.id))) return;
    try {
      const images = await Promise.all([...rec.ref_paths, rec.objective_path].map((p) => d.signedUrl(p)));
      const id = await d.submit(key, rec.model, { prompt: take.prompt, images, resolution: rec.resolution });
      await d.updateTake(take.id, { status: 'PENDING', prediction_id: id });
    } catch (e) {
      await d.updateTake(take.id, { status: 'FAILED', error: (e as Error).message.slice(0, 300) });
    }
  }

  async function view(id: string): Promise<Out> {
    const loaded = await d.loadRecreation(ws, id);
    if (!loaded) return fail(404, 'No encontré esa recreación.');
    const r = loaded.rec;
    const takes = await Promise.all([...loaded.takes].sort((a, c) => a.variant_no - c.variant_no || a.take_no - c.take_no).map(async (t) => ({
      id: t.id, variant: t.variant_no, takeNo: t.take_no, status: t.status, costMills: t.cost_mills, error: t.error ?? null,
      chosen: Boolean(t.chosen_asset_id), previewUrl: t.object_path ? await d.signedUrl(t.object_path) : null })));
    return ok({ recreationId: r.id, character: r.character_id, channel: r.channel, level: r.level, style: r.style, prompt: r.prompt, variants: r.variants,
      objectiveUrl: await d.signedUrl(r.objective_path), takes });
  }

  switch (b.action) {
    // Manual mode (Luis, 2026-11-18): store the target photo without calling the prompter; Luis writes the prompt himself.
    case 'RECREATE_UPLOAD': {
      const id = await identity(b.character);
      if ('status' in id) return id;
      const level = levelOf(b.channel);
      if (!level) return fail(400, 'Canal no válido.');
      let img;
      try { img = decodeTarget(b.image); } catch (e) { return fail(400, (e as Error).message); }
      const objectivePath = `${ws}/recreate/${draftFolder(level)}/${d.newId()}.${img.ext}`;
      await d.storeUpload(objectivePath, img.bytes, img.mime);
      return ok({ objectivePath, objectiveUrl: await d.signedUrl(objectivePath) });
    }
    case 'RECREATE_PROMPT': {
      const id = await identity(b.character);
      if ('status' in id) return id;
      if (!isStyle(b.style)) return fail(400, 'Estilo no válido.');
      const level = levelOf(b.channel);
      if (!level) return fail(400, 'Canal no válido.');
      const scene = typeof b.scene === 'string' ? b.scene.trim().slice(0, MAX_SCENE_TEXT) : '';
      if ((await d.promptsToday(ws)) >= MAX_DAILY_PROMPTS) return fail(429, `Llegaste al máximo de ${MAX_DAILY_PROMPTS} prompts por día.`);
      const key = d.prompterKey();
      if (!key) return fail(412, 'El prompter no tiene su clave configurada en el servidor.');
      let objectivePath: string; let target: PrompterInput['target'];
      if (isDraftPath(ws, b.objectivePath, level)) {
        objectivePath = b.objectivePath; target = { kind: 'url', url: await d.signedUrl(objectivePath) };
      } else {
        let img;
        try { img = decodeTarget(b.image); } catch (e) { return fail(400, (e as Error).message); }
        objectivePath = `${ws}/recreate/${draftFolder(level)}/${d.newId()}.${img.ext}`;
        await d.storeUpload(objectivePath, img.bytes, img.mime);
        target = { kind: 'base64', mime: img.mime, data: img.base64 };
      }
      const previousPrompt = typeof b.previousPrompt === 'string' ? b.previousPrompt.slice(0, 3000) : null;
      const fix = typeof b.fix === 'string' ? b.fix.trim().slice(0, MAX_INSTRUCTION) : null;
      try {
        const r = await d.writePrompt(key, { style: b.style, level, scene, faceUrl: await d.signedUrl(id.face.objectPath), target, previousPrompt, fix });
        await d.audit(ws, 'RECREATE_PROMPT', { character: id.character, level, style: b.style, cost_mills: r.costMills, objective_path: objectivePath });
        return ok({ objectivePath, objectiveUrl: await d.signedUrl(objectivePath), prompt: r.prompt, summary: r.summary, observations: r.observations, warnings: r.warnings, checklist: r.checklist, promptCostMills: r.costMills });
      } catch (e) {
        const cost = (e as { costMills?: number }).costMills ?? 0;
        await d.audit(ws, 'RECREATE_PROMPT_FAILED', { character: id.character, level, style: b.style, cost_mills: cost, diag: (e as { diag?: unknown }).diag ?? null });
        return fail((e as { refused?: boolean }).refused ? 422 : 502, (e as Error).message);
      }
    }
    case 'RECREATE_QUOTE': {
      const p = await plan();
      if ('status' in p) return p;
      return ok({ totalMills: p.quote.totalMills, perPhotoMills: p.quote.perPhotoMills, level: p.level, spentMills: await d.monthSpendMills(actor), capMills: CAP_MILLS });
    }
    case 'RECREATE_START': {
      const p = await plan();
      if ('status' in p) return p;
      if (b.attestNotReal !== true) return fail(400, 'Confirma que la modelo es un personaje creado con IA y que no se copia la identidad de la persona de la foto objetivo.');
      if (b.expectedTotalMills !== p.quote.totalMills) return fail(409, 'El costo cambió. Vuelve a cotizar antes de crear.');
      if (!isDraftPath(ws, b.objectivePath, p.level)) return fail(400, 'Primero prepara el prompt con tu foto objetivo para este canal.');
      let prompt: string; let adultText: string | null;
      try { prompt = cleanEditedPrompt(b.prompt, p.style); adultText = cleanAdultText(b.adultText, p.level); } catch (e) { return fail(400, (e as Error).message); }
      const key = await d.secret(actor);
      if (!key) return fail(412, 'Conecta tu clave de WaveSpeed en Conexiones antes de crear.');
      let full: string;
      try { full = buildRecreatePrompt({ fixedPrompt: await d.fixedPrompt(ws, p.character), rule: recreateRule(p.level, p.refs.length), prompt, adultText }); } catch (e) { return fail(400, (e as Error).message); }
      const promptCost = typeof b.promptCostMills === 'number' && Number.isInteger(b.promptCostMills) ? Math.min(Math.max(b.promptCostMills, 0), 1000) : 0;
      const rec: RecreationRow = { id: d.newId(), character_id: p.character, channel: p.channel, level: p.level, objective_path: b.objectivePath,
        ref_asset_ids: p.refs.map((r) => r.id), ref_paths: p.refs.map((r) => r.objectPath), style: p.style, adult_text: adultText,
        scene: typeof b.scene === 'string' && b.scene.trim() ? b.scene.trim().slice(0, MAX_SCENE_TEXT) : null, prompt, prompt_cost_mills: promptCost,
        variants: p.variants, model: p.model, resolution: SERIES_RESOLUTION, ceiling_mills: p.quote.totalMills, attested_not_real: true };
      const takes: RecreateTakeRow[] = Array.from({ length: p.variants }, (_, i) => ({ id: d.newId(), recreation_id: rec.id, variant_no: i + 1, take_no: 1,
        prompt: full, input_count: p.quote.inputs, cost_mills: p.quote.perPhotoMills, status: 'QUEUED' as const }));
      try { await d.createRecreation(actor, rec, takes); } catch (e) { if (isCap(e)) return capOut(); throw e; }
      for (const t of takes) await submitTake(key, rec, t);
      return view(rec.id);
    }
    case 'RECREATE_STATUS': {
      if (typeof b.recreationId !== 'string') return fail(400, 'Falta la recreación.');
      const loaded = await d.loadRecreation(ws, b.recreationId);
      if (!loaded) return fail(404, 'No encontré esa recreación.');
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
              const out = await d.storeOutput(r.outputUrl, `${ws}/recreate/${loaded.rec.id}/${t.variant_no}/${t.take_no}.png`);
              await d.updateTake(t.id, { status: 'SUCCEEDED', object_path: out.path, sha256: out.sha256, byte_size: out.byteSize, mime_type: out.mime });
            } catch { /* retried on the next STATUS */ }
          } else if (r.status === 'FAILED') await d.updateTake(t.id, { status: 'FAILED', error: r.error });
        }
        for (const t of queued) await submitTake(key, loaded.rec, t);
      }
      return view(loaded.rec.id);
    }
    case 'RECREATE_RETAKE': {
      if (typeof b.recreationId !== 'string' || typeof b.variant !== 'number') return fail(400, 'Falta la recreación o la versión.');
      const loaded = await d.loadRecreation(ws, b.recreationId);
      if (!loaded) return fail(404, 'No encontré esa recreación.');
      const r = loaded.rec; const variant = b.variant;
      if (!Number.isInteger(variant) || variant < 1 || variant > r.variants) return fail(400, 'Esa versión no existe.');
      const price = await d.price(r.model);
      if (!price) return fail(400, 'Ese modelo no está disponible todavía.');
      const quote = quoteRecreate({ variants: 1, price, resolution: r.resolution, refs: r.ref_paths.length });
      if (b.expectedCostMills !== quote.perPhotoMills) return fail(409, 'El costo cambió. Vuelve a cotizar.');
      const key = await d.secret(actor);
      if (!key) return fail(412, 'Conecta tu clave de WaveSpeed en Conexiones.');
      const instruction = typeof b.instruction === 'string' ? b.instruction.trim().slice(0, MAX_INSTRUCTION) : null;
      let full: string;
      try { full = buildRecreatePrompt({ fixedPrompt: await d.fixedPrompt(ws, r.character_id), rule: recreateRule(r.level, r.ref_paths.length), prompt: r.prompt, adultText: r.adult_text, instruction }); } catch (e) { return fail(400, (e as Error).message); }
      const take: RecreateTakeRow = { id: d.newId(), recreation_id: r.id, variant_no: variant,
        take_no: Math.max(0, ...loaded.takes.filter((t) => t.variant_no === variant).map((t) => t.take_no)) + 1,
        prompt: full, input_count: quote.inputs, cost_mills: quote.perPhotoMills, status: 'QUEUED' };
      try { await d.addRecreationTake(actor, take); } catch (e) { if (isCap(e)) return capOut(); throw e; }
      await submitTake(key, r, take);
      return view(r.id);
    }
    case 'RECREATE_CHOOSE': {
      if (typeof b.takeId !== 'string') return fail(400, 'Falta la foto.');
      const take = await d.loadRecreationTake(ws, b.takeId);
      if (!take) return fail(404, 'No encontré esa foto.');
      if (take.status !== 'SUCCEEDED' || !take.object_path || !take.sha256) return fail(409, 'Esa foto todavía no está lista.');
      if (take.chosen_asset_id) return ok({ assetId: take.chosen_asset_id, duplicate: true });
      const loaded = await d.loadRecreation(ws, take.recreation_id);
      if (!loaded) return fail(404, 'No encontré esa recreación.');
      const id = d.newId();
      await d.registerRecreatePhoto({ id, workspace_id: ws, kind: 'ORIGINAL', object_path: take.object_path, mime_type: take.mime_type ?? 'image/png', byte_size: take.byte_size ?? 0, sha256: take.sha256,
        metadata: { character_id: loaded.rec.character_id, content_level: loaded.rec.level ?? 'PUBLIC', source: 'RAXI_RECREATE', recreation_id: loaded.rec.id, take_id: take.id, variant: take.variant_no, model: loaded.rec.model } });
      await d.updateTake(take.id, { chosen_asset_id: id });
      return ok({ assetId: id, duplicate: false, level: loaded.rec.level ?? 'PUBLIC' });
    }
  }
  return fail(400, 'Acción no válida.');
}
