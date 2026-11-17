// Minimal WaveSpeed client with injected fetch. Response shape and statuses follow WaveSpeed's docs
// (data.id, data.status, data.outputs; terminal failures: failed, cancelled, timeout, deleted), checked 2026-11-17.
// Errors never include the API key or the provider's raw body.

export interface EditBody { prompt: string; images: string[]; resolution: string }
export type PollResult = { status: 'PENDING' } | { status: 'SUCCEEDED'; outputUrl: string } | { status: 'FAILED'; error: string };

const BASE = 'https://api.wavespeed.ai/api/v3';
const MODEL = /^[a-z0-9-]+\/[a-z0-9.-]+\/edit$/;
const PRED = /^[A-Za-z0-9_-]{1,128}$/;
const FAILED = new Set(['failed', 'cancelled', 'timeout', 'deleted']);

export function createWaveSpeed(fetchImpl: typeof fetch) {
  const headers = (key: string) => ({ Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' });
  return {
    async submit(key: string, model: string, body: EditBody): Promise<string> {
      if (!MODEL.test(model)) throw new Error('Ese modelo no es válido.');
      const res = await fetchImpl(`${BASE}/${model}`, { method: 'POST', headers: headers(key), body: JSON.stringify({ ...body, output_format: 'png' }) });
      if (!res.ok) throw new Error(`WaveSpeed rechazó el envío (HTTP ${res.status}).`);
      const json = await res.json().catch(() => null) as { data?: { id?: unknown } } | null;
      const id = json?.data?.id;
      if (typeof id !== 'string' || !PRED.test(id)) throw new Error('WaveSpeed no devolvió un id de tarea.');
      return id;
    },
    async poll(key: string, predictionId: string): Promise<PollResult> {
      if (!PRED.test(predictionId)) throw new Error('Id de predicción no válido.');
      const res = await fetchImpl(`${BASE}/predictions/${predictionId}/result`, { method: 'GET', headers: headers(key) });
      if (!res.ok) throw new Error(`WaveSpeed no respondió (HTTP ${res.status}).`);
      const json = await res.json().catch(() => null) as { data?: { status?: unknown; outputs?: unknown; error?: unknown } } | null;
      const status = String(json?.data?.status ?? '');
      if (status === 'completed') {
        const out = Array.isArray(json?.data?.outputs) ? json!.data!.outputs[0] : null;
        if (typeof out !== 'string' || !/^https:\/\//.test(out)) return { status: 'FAILED', error: 'WaveSpeed terminó sin imagen.' };
        return { status: 'SUCCEEDED', outputUrl: out };
      }
      if (FAILED.has(status)) {
        const e = json?.data?.error;
        return { status: 'FAILED', error: typeof e === 'string' && e ? e.slice(0, 300) : `Tarea ${status}.` };
      }
      return { status: 'PENDING' };
    },
  };
}
