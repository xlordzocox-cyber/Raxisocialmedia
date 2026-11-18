// Prueba A/B de identidad (2026-11-18): same general face + same scene text → Seedream 5.5 edit vs FLUX-PuLID.
// Luis votes blind (which model is "A" is shuffled per scene and only revealed on request). Public level only, no archiving.
// Same engine as the rest of the creator (cap, ledger, atomic claim, polling, key handling). No Deno/npm imports.
import { CAP_MILLS, formatUsd, takeCost, type Price } from './sheetPlan.ts';
import { SERIES_RESOLUTION, type Ref } from './seriesPlan.ts';
import { MAX_PROMPT } from './sheetPrompts.ts';
import { PUBLIC_OUTFIT_GUARD } from './photoSpec.ts';
import type { EditBody, PollResult, ReferenceBody } from './wavespeed.ts';

export const TEST_MODELS = ['bytedance/seedream-v5.5/edit', 'wavespeed-ai/flux-pulid'] as const;
export const TEST_MODEL_LABEL: Record<string, string> = { 'bytedance/seedream-v5.5/edit': 'Seedream 5.5', 'wavespeed-ai/flux-pulid': 'FLUX-PuLID' };
export const MAX_TEST_SCENES = 3;
export const MAX_TEST_SCENE = 300;
const PULID_GUIDANCE = 3.5; // page recommends 3.0–4.0
// Identical text for both models; the reference only carries identity (pilot 2026-11-17: the sheet's bra leaked into outfits).
export const TEST_RULE = 'Photo of the woman from the reference image: keep exactly the same face and hair. ' +
  'The reference image only shows who she is: ignore its clothing, pose and background. Only one woman in the photo. She is clearly an adult. Scene:';

export interface ModelTestRow {
  id: string; character_id: string; face_asset_id: string; face_path: string; scenes: string[]; models: string[]; a_index: number[];
  votes: Record<string, 'A' | 'B' | 'TIE'>; revealed: boolean; ceiling_mills: number; attested_not_real: true;
}
export interface TestTakeRow {
  id: string; test_id: string; shot_no: number; test_arm: number; take_no: number; prompt: string; input_count: number; cost_mills: number;
  status: 'QUEUED' | 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  prediction_id?: string | null; object_path?: string | null; sha256?: string | null; byte_size?: number | null; mime_type?: string | null; error?: string | null;
}
export interface ModelTestDependencies {
  price(model: string): Promise<Price | null>;
  fixedPrompt(workspaceId: string, character: string): Promise<string | null>;
  identityLocked(workspaceId: string, character: string): Promise<boolean>;
  currentRefs(workspaceId: string, character: string): Promise<{ face?: Ref }>;
  monthSpendMills(actor: string): Promise<number>;
  createModelTest(actor: string, test: ModelTestRow, takes: TestTakeRow[]): Promise<void>;
  loadModelTest(workspaceId: string, id: string): Promise<{ test: ModelTestRow; takes: TestTakeRow[] } | null>;
  updateModelTest(id: string, patch: Partial<Pick<ModelTestRow, 'votes' | 'revealed'>>): Promise<void>;
  updateTake(takeId: string, patch: Partial<TestTakeRow>): Promise<void>;
  claimTake(takeId: string): Promise<boolean>;
  signedUrl(path: string): Promise<string>;
  secret(actor: string): Promise<string | null>;
  submit(key: string, model: string, body: EditBody | ReferenceBody): Promise<string>;
  poll(key: string, predictionId: string): Promise<PollResult>;
  storeOutput(url: string, path: string): Promise<{ path: string; sha256: string; byteSize: number; mime: string }>;
  /** 0 or 1, uniformly (crypto in production). */
  coin(): number;
  newId(): string;
}

const ROSTER = new Set(['raxi-vox', 'vesper-corvus']);
type Out = { status: number; body: Record<string, unknown> };
const fail = (status: number, error: string): Out => ({ status, body: { error } });
const ok = (body: Record<string, unknown>): Out => ({ status: 200, body });
const isCap = (e: unknown) => typeof e === 'object' && e !== null && (e as { cap?: unknown }).cap === true;
export const MODELTEST_ACTIONS = new Set(['MODELTEST_QUOTE', 'MODELTEST_START', 'MODELTEST_STATUS', 'MODELTEST_VOTE', 'MODELTEST_REVEAL']);
const VOTES = new Set(['A', 'B', 'TIE']);

export function cleanTestScenes(raw: unknown): string[] {
  const scenes = Array.isArray(raw) ? raw.map((s) => (typeof s === 'string' ? s.trim() : '')) : [];
  if (scenes.length < 1 || scenes.length > MAX_TEST_SCENES) throw new Error('La prueba lleva de 1 a 3 escenas.');
  if (scenes.some((s) => s.length < 1 || s.length > MAX_TEST_SCENE)) throw new Error('Cada escena debe tener de 1 a 300 caracteres.');
  return scenes;
}
/** Seedream edit sends the face as its one input image; FLUX-PuLID charges a flat price per image. */
export function quoteTest(input: { scenes: number; seedream: Price; pulid: Price }) {
  const perArm = [takeCost(input.seedream, SERIES_RESOLUTION, 1), takeCost(input.pulid, SERIES_RESOLUTION, 0)];
  return { perArm, perSceneMills: perArm[0] + perArm[1], totalMills: (perArm[0] + perArm[1]) * input.scenes };
}
export function buildTestPrompt(fixedPrompt: string | null, scene: string): string {
  const out = [fixedPrompt?.trim() || null, `${TEST_RULE} ${scene.trim()}`, PUBLIC_OUTFIT_GUARD].filter(Boolean).join('\n\n');
  if (out.length > MAX_PROMPT) throw new Error('El prompt es demasiado largo (máximo 4000 caracteres).');
  return out;
}

export async function handleModelTest(d: ModelTestDependencies, actor: string, ws: string, b: Record<string, unknown>): Promise<Out> {
  async function plan() {
    if (typeof b.character !== 'string' || !ROSTER.has(b.character)) return fail(400, 'Modelo no válida.');
    if (!(await d.identityLocked(ws, b.character))) return fail(400, 'Primero bloquea la identidad de la modelo en Talento.');
    const { face } = await d.currentRefs(ws, b.character);
    if (!face) return fail(400, 'Primero elige la cara de frente de la ficha general.');
    const [seedream, pulid] = await Promise.all(TEST_MODELS.map((m) => d.price(m)));
    if (!seedream || !pulid) return fail(400, 'Alguno de los dos modelos no está disponible todavía.');
    let scenes: string[]; let quote;
    try { scenes = cleanTestScenes(b.scenes); quote = quoteTest({ scenes: scenes.length, seedream, pulid }); } catch (e) { return fail(400, (e as Error).message); }
    return { character: b.character, face, scenes, quote };
  }

  async function submitTake(key: string, test: ModelTestRow, take: TestTakeRow) {
    if (!(await d.claimTake(take.id))) return;
    try {
      const face = await d.signedUrl(test.face_path);
      const model = test.models[take.test_arm];
      const body: EditBody | ReferenceBody = model === 'wavespeed-ai/flux-pulid'
        ? { prompt: take.prompt, image: face, guidance_scale: PULID_GUIDANCE }
        : { prompt: take.prompt, images: [face], resolution: SERIES_RESOLUTION };
      const id = await d.submit(key, model, body);
      await d.updateTake(take.id, { status: 'PENDING', prediction_id: id });
    } catch (e) {
      await d.updateTake(take.id, { status: 'FAILED', error: (e as Error).message.slice(0, 300) });
    }
  }

  /** Blind view: per scene, the "A" and "B" photos; model names only after the reveal. */
  async function view(id: string): Promise<Out> {
    const loaded = await d.loadModelTest(ws, id);
    if (!loaded) return fail(404, 'No encontré esa prueba.');
    const t = loaded.test;
    const pick = async (scene: number, arm: number) => {
      const take = loaded.takes.filter((x) => x.shot_no === scene && x.test_arm === arm).sort((a, c) => c.take_no - a.take_no)[0];
      return take ? { status: take.status, error: take.error ?? null, previewUrl: take.object_path ? await d.signedUrl(take.object_path) : null } : null;
    };
    const scenes = await Promise.all(t.scenes.map(async (text, i) => {
      const aArm = t.a_index[i];
      return { scene: i + 1, text, vote: t.votes[String(i + 1)] ?? null, A: await pick(i + 1, aArm), B: await pick(i + 1, 1 - aArm),
        ...(t.revealed ? { modelA: TEST_MODEL_LABEL[t.models[aArm]], modelB: TEST_MODEL_LABEL[t.models[1 - aArm]] } : {}) };
    }));
    let tally: Record<string, number> | null = null;
    if (t.revealed) {
      tally = { [TEST_MODEL_LABEL[t.models[0]]]: 0, [TEST_MODEL_LABEL[t.models[1]]]: 0, Empate: 0 };
      t.scenes.forEach((_, i) => {
        const v = t.votes[String(i + 1)];
        if (v === 'TIE') tally!.Empate++;
        else if (v) tally![TEST_MODEL_LABEL[t.models[v === 'A' ? t.a_index[i] : 1 - t.a_index[i]]]]++;
      });
    }
    return ok({ testId: t.id, character: t.character_id, revealed: t.revealed, faceUrl: await d.signedUrl(t.face_path), scenes, tally });
  }

  switch (b.action) {
    case 'MODELTEST_QUOTE': {
      const p = await plan();
      if ('status' in p) return p;
      return ok({ totalMills: p.quote.totalMills, perSceneMills: p.quote.perSceneMills, spentMills: await d.monthSpendMills(actor), capMills: CAP_MILLS });
    }
    case 'MODELTEST_START': {
      const p = await plan();
      if ('status' in p) return p;
      if (b.attestNotReal !== true) return fail(400, 'Confirma que es un personaje creado con IA y no la imagen de una persona real.');
      if (b.expectedTotalMills !== p.quote.totalMills) return fail(409, 'El costo cambió. Vuelve a cotizar antes de crear.');
      const key = await d.secret(actor);
      if (!key) return fail(412, 'Conecta tu clave de WaveSpeed en Conexiones antes de crear.');
      const fixed = await d.fixedPrompt(ws, p.character);
      let prompts: string[];
      try { prompts = p.scenes.map((s) => buildTestPrompt(fixed, s)); } catch (e) { return fail(400, (e as Error).message); }
      const test: ModelTestRow = { id: d.newId(), character_id: p.character, face_asset_id: p.face.id, face_path: p.face.objectPath, scenes: p.scenes,
        models: [...TEST_MODELS], a_index: p.scenes.map(() => d.coin()), votes: {}, revealed: false, ceiling_mills: p.quote.totalMills, attested_not_real: true };
      const takes: TestTakeRow[] = p.scenes.flatMap((_, i) => [0, 1].map((arm) => ({ id: d.newId(), test_id: test.id, shot_no: i + 1, test_arm: arm, take_no: 1,
        prompt: prompts[i], input_count: 1, cost_mills: p.quote.perArm[arm], status: 'QUEUED' as const })));
      try { await d.createModelTest(actor, test, takes); } catch (e) {
        if (isCap(e)) return fail(402, `Superarías el tope mensual: llevas ${formatUsd(await d.monthSpendMills(actor))} de $10.`); throw e; }
      for (const t of takes) await submitTake(key, test, t);
      return view(test.id);
    }
    case 'MODELTEST_STATUS': {
      if (typeof b.testId !== 'string') return fail(400, 'Falta la prueba.');
      const loaded = await d.loadModelTest(ws, b.testId);
      if (!loaded) return fail(404, 'No encontré esa prueba.');
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
              const out = await d.storeOutput(r.outputUrl, `${ws}/tests/${loaded.test.id}/${t.shot_no}/${t.test_arm}-${t.take_no}.png`);
              await d.updateTake(t.id, { status: 'SUCCEEDED', object_path: out.path, sha256: out.sha256, byte_size: out.byteSize, mime_type: out.mime });
            } catch { /* retried on the next STATUS */ }
          } else if (r.status === 'FAILED') await d.updateTake(t.id, { status: 'FAILED', error: r.error });
        }
        for (const t of queued) await submitTake(key, loaded.test, t);
      }
      return view(loaded.test.id);
    }
    case 'MODELTEST_VOTE': {
      if (typeof b.testId !== 'string' || typeof b.scene !== 'number' || typeof b.vote !== 'string' || !VOTES.has(b.vote)) return fail(400, 'Voto no válido.');
      const loaded = await d.loadModelTest(ws, b.testId);
      if (!loaded) return fail(404, 'No encontré esa prueba.');
      if (loaded.test.revealed) return fail(409, 'Ya revelaste los modelos: el voto queda cerrado.');
      if (!Number.isInteger(b.scene) || b.scene < 1 || b.scene > loaded.test.scenes.length) return fail(400, 'Esa escena no existe.');
      await d.updateModelTest(loaded.test.id, { votes: { ...loaded.test.votes, [String(b.scene)]: b.vote as 'A' | 'B' | 'TIE' } });
      return view(loaded.test.id);
    }
    case 'MODELTEST_REVEAL': {
      if (typeof b.testId !== 'string') return fail(400, 'Falta la prueba.');
      const loaded = await d.loadModelTest(ws, b.testId);
      if (!loaded) return fail(404, 'No encontré esa prueba.');
      if (loaded.test.scenes.some((_, i) => !loaded.test.votes[String(i + 1)])) return fail(409, 'Vota todas las escenas antes de revelar.');
      await d.updateModelTest(loaded.test.id, { revealed: true });
      return view(loaded.test.id);
    }
  }
  return fail(400, 'Acción no válida.');
}
