// Ficha 360 plan: views, chain order and cost quotes. Pure, no Deno/npm imports (unit-tested under Node).
// Money is handled in integer mills (1/1000 USD) so totals never drift with floating point.

export type Level = 'GENERAL' | 'ADULT';
export type View = 'FRONT' | 'THREE_QUARTER' | 'PROFILE' | 'BODY_FRONT' | 'BODY_SIDE' | 'BODY_BACK';
export type Resolution = '1k' | '1.5k' | '2k';
export interface Price { model: string; enabled: boolean; out: Record<Resolution, number>; perInput: number }
export interface TakeQuote { view: View; inputs: number; costMills: number }

export const CAP_MILLS = 10_000; // $10 USD per month (Luis, 2026-11-16)
export const RESOLUTIONS: readonly Resolution[] = ['1k', '1.5k', '2k'];
const GENERAL_VIEWS: View[] = ['FRONT', 'THREE_QUARTER', 'PROFILE', 'BODY_FRONT', 'BODY_SIDE', 'BODY_BACK'];
const ADULT_VIEWS: View[] = ['BODY_FRONT', 'BODY_SIDE', 'BODY_BACK'];
export const ALL_VIEWS: readonly View[] = GENERAL_VIEWS;

/** Views of a sheet in generation order; the first one is the anchor of the chain. */
export function viewsFor(level: Level): View[] { return level === 'ADULT' ? [...ADULT_VIEWS] : [...GENERAL_VIEWS]; }
export const anchorOf = (level: Level): View => viewsFor(level)[0];
export const isLevel = (v: unknown): v is Level => v === 'GENERAL' || v === 'ADULT';
export const isView = (v: unknown): v is View => typeof v === 'string' && (GENERAL_VIEWS as string[]).includes(v);

export function takeCost(price: Price, resolution: Resolution, inputs: number): number {
  if (!RESOLUTIONS.includes(resolution)) throw new Error('Esa resolución no está disponible.');
  if (!price.enabled) throw new Error('Ese modelo no está disponible todavía.');
  return price.out[resolution] + price.perInput * inputs;
}

/** Number of reference images each take sends. General: anchor = sources, rest = anchor + sources.
 *  Adult: sources are the chosen general body and face; anchor = both, rest = anchor + general body. */
export function inputsFor(level: Level, view: View, sources: number): number {
  if (view === anchorOf(level)) return sources;
  return level === 'ADULT' ? 2 : sources + 1;
}

export function quoteRun(input: { level: Level; sources: number; resolution: Resolution; price: Price }): { totalMills: number; takes: TakeQuote[] } {
  const { level, sources, resolution, price } = input;
  if (!price.enabled) throw new Error('Ese modelo no está disponible todavía.');
  if (!RESOLUTIONS.includes(resolution)) throw new Error('Esa resolución no está disponible.');
  if (level === 'GENERAL' && (sources < 1 || sources > 3)) throw new Error('Sube de 1 a 3 fotos de la modelo.');
  if (level === 'ADULT' && sources !== 2) throw new Error('La ficha adulta necesita la cara y el cuerpo de frente de la ficha general.');
  const takes = viewsFor(level).map((view) => { const inputs = inputsFor(level, view, sources); return { view, inputs, costMills: takeCost(price, resolution, inputs) }; });
  return { totalMills: takes.reduce((s, t) => s + t.costMills, 0), takes };
}

/** Reference images for one take, in order. `anchor` is the stored anchor output (null until it exists). */
export function chainImages(level: Level, view: View, sources: string[], anchor: string | null): string[] {
  if (view === anchorOf(level)) return [...sources];
  if (!anchor) throw new Error('Primero tiene que estar lista la vista de frente.');
  return level === 'ADULT' ? [anchor, sources[0]] : [anchor, ...sources];
}

export const formatUsd = (mills: number) => `$${(mills / 1000).toFixed(mills % 10 === 0 ? 2 : 3)}`;
