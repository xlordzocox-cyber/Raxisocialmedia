import type { SupabaseClient } from '@supabase/supabase-js';

export type SheetLevel = 'GENERAL' | 'ADULT';
export type SheetView = 'FRONT' | 'THREE_QUARTER' | 'PROFILE' | 'BODY_FRONT' | 'BODY_SIDE' | 'BODY_BACK';
export type TakeStatus = 'QUEUED' | 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
export interface SheetTake { id: string; view: SheetView; takeNo: number; status: TakeStatus; costMills: number; error: string | null; chosen: boolean; previewUrl: string | null }
export interface SheetRun { runId: string; character: string; level: SheetLevel; model: string; resolution: string; takes: SheetTake[] }
export interface Quote { totalMills: number; spentMills: number; capMills: number; takes: number[] }

export const DEFAULT_MODEL = 'bytedance/seedream-v5.5/edit'; // AGENTS.md: NSFW in Raxi HQ defaults to Seedream 5.5; also used for the general sheet
export const VIEWS: Record<SheetLevel, SheetView[]> = {
  GENERAL: ['FRONT', 'THREE_QUARTER', 'PROFILE', 'BODY_FRONT', 'BODY_SIDE', 'BODY_BACK'],
  ADULT: ['BODY_FRONT', 'BODY_SIDE', 'BODY_BACK'],
};
export const VIEW_LABEL: Record<SheetView, string> = {
  FRONT: 'Cara de frente', THREE_QUARTER: 'Cara a tres cuartos', PROFILE: 'Cara de perfil',
  BODY_FRONT: 'Cuerpo de frente', BODY_SIDE: 'Cuerpo de lado', BODY_BACK: 'Cuerpo de espalda',
};
export const STATUS_LABEL: Record<TakeStatus, string> = { QUEUED: 'En espera del frente', PENDING: 'Generando…', SUCCEEDED: 'Lista', FAILED: 'Falló', CANCELLED: 'Cancelada' };

export const usd = (mills: number) => `$${(mills / 1000).toFixed(mills % 10 === 0 ? 2 : 3)}`;
export const isBusy = (run: SheetRun | null) => Boolean(run?.takes.some((t) => t.status === 'QUEUED' || t.status === 'PENDING'));
export const anchorReady = (run: SheetRun) => run.takes.some((t) => t.view === VIEWS[run.level][0] && t.status === 'SUCCEEDED');
export const viewCost = (run: SheetRun, view: SheetView) => run.takes.find((t) => t.view === view)?.costMills ?? 0;

/** Calls the sheet-creator function and returns its JSON, or throws with the server's Spanish message. */
export async function callSheet<T>(client: SupabaseClient, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await client.functions.invoke('sheet-creator', { body });
  if (error) throw new Error(await serverMessage(error, 'No se pudo completar la acción.'));
  return data as T;
}

/** The Spanish message our functions return in `{ error }`, or the fallback. */
export async function serverMessage(error: unknown, fallback: string): Promise<string> {
  const ctx = (error as { context?: unknown }).context;
  if (ctx instanceof Response) { try { const j = await ctx.json(); if (typeof j?.error === 'string') return j.error; } catch { /* keep fallback */ } }
  return fallback;
}
