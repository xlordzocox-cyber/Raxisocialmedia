/** Offline planning only. This quote cannot authorize a task, change policy or call a provider. */
export const PILOT_QUOTE = Object.freeze({
 provider: 'openai', model: 'gpt-6-luna', currency: 'USD',
 source: 'https://developers.openai.com/api/docs/models/gpt-6-luna',
 checkedAt: '2026-10-22T18:00:00Z', expiresAt: '2026-10-23T18:00:00Z',
 inputMicrosPerMillion: 100000, outputMicrosPerMillion: 500000,
 stages: 2, maxInputTokensPerStage: 8000, maxOutputTokensPerStage: 256,
 maxTaskMicros: 10000,
} as const);

/** Standard text pricing, no cached discount, tools, retries or regional premiums.
 * The future host must measure the COMPLETE provider payload before admission.
 * A reservation alone cannot enforce billing limits on a remote provider.
 */
export function planPilotBudget(input: {
 inputTokensPerStage: number; outputTokensPerStage: number; maxCostMicros: number;
}) {
 if (!input || Object.keys(input).some(key => ![
  'inputTokensPerStage', 'outputTokensPerStage', 'maxCostMicros',
 ].includes(key))) throw Error('Unsupported pilot input');
 const q = PILOT_QUOTE;
 // Only the process clock determines freshness. No request field or exported clock override.
 const now = Date.now(), checkedAt = Date.parse(q.checkedAt), expiresAt = Date.parse(q.expiresAt);
 if (![now, checkedAt, expiresAt].every(Number.isFinite) || checkedAt >= expiresAt ||
  now < checkedAt || now >= expiresAt) {
  throw Error('Refresh the published quote before planning');
 }
 for (const [value, maximum] of [
  [input.inputTokensPerStage, q.maxInputTokensPerStage],
  [input.outputTokensPerStage, q.maxOutputTokensPerStage],
  [input.maxCostMicros, q.maxTaskMicros],
 ]) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) throw Error('Pilot limit exceeded');
 }
 // Round each stage up to the next microdollar, never down or with cached discounts.
 const perStageMicros = Math.ceil((input.inputTokensPerStage * q.inputMicrosPerMillion
  + input.outputTokensPerStage * q.outputMicrosPerMillion) / 1000000);
 const estimatedMaxMicros = q.stages * perStageMicros;
 if (estimatedMaxMicros > input.maxCostMicros) throw Error('Estimate exceeds proposed human ceiling');
 return {
  kind: 'UNAUTHORIZED_PLANNING_ONLY' as const, liveEnabled: false as const,
  provider: q.provider, model: q.model, currency: q.currency,
  estimatedMaxMicros, proposedCeilingMicros: input.maxCostMicros,
  quoteExpiresAt: q.expiresAt,
 };
}
