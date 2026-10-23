/** Pure preparation helpers. They cannot contact providers, authorize spending, or dispatch work. */
export interface TrustedTokenMeter {
  /** Server-configured tokenizer for the exact model and exact outbound JSON body. */
  countInputTokens(model: string, serializedRequest: string): Promise<number>;
}
export interface SupervisedPreflightInput {
  model: string;
  serializedRequest: string;
  maxInputTokens: number;
  maxOutputTokens: number;
  quoteExpiresAt: string;
  meter: TrustedTokenMeter;
}

/** A preflight result is evidence of bounds checking, never permission to send a request. */
export async function inspectSupervisedPreflight(input: SupervisedPreflightInput) {
  const expires = Date.parse(input.quoteExpiresAt);
  if (!Number.isFinite(expires) || !Number.isFinite(Date.now()) || Date.now() >= expires) {
    throw Error('Quote expired or invalid');
  }
  if (typeof input.model !== 'string' || !/^[a-zA-Z0-9._-]{1,100}$/.test(input.model) ||
    !Number.isSafeInteger(input.maxInputTokens) || input.maxInputTokens < 1 ||
    !Number.isSafeInteger(input.maxOutputTokens) || input.maxOutputTokens < 1 ||
    typeof input.serializedRequest !== 'string' || input.serializedRequest.length > 131072 ||
    !input.meter || typeof input.meter.countInputTokens !== 'function') {
    throw Error('Invalid or unmetered request');
  }
  let payload: unknown;
  try { payload = JSON.parse(input.serializedRequest); } catch { throw Error('Invalid request JSON'); }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw Error('Invalid request payload');
  const p = payload as Record<string, unknown>;
  if (p.model !== input.model || p.store !== false || !Array.isArray(p.tools) || p.tools.length !== 0 ||
    p.max_output_tokens !== input.maxOutputTokens || !Array.isArray(p.input)) {
    throw Error('Unsafe or mismatched request');
  }
  // No estimate from character count: missing or untrusted meter must fail closed.
  const measured = await input.meter.countInputTokens(input.model, input.serializedRequest);
  if (!Number.isSafeInteger(measured) || measured < 1 || measured > input.maxInputTokens) {
    throw Error('Input token limit not verified');
  }
  if (Date.now() >= expires) throw Error('Quote expired during metering');
  return Object.freeze({kind:'PREFLIGHT_ONLY' as const, liveEnabled:false as const,
    model:input.model, inputTokens:measured, maxInputTokens:input.maxInputTokens,
    maxOutputTokens:input.maxOutputTokens});
}

export interface ResponseUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}
export type InspectedResponse =
  | {kind:'PARSED_UNVERIFIED'; receipt:string; usage:ResponseUsage|null; output:unknown}
  | {kind:'RECONCILIATION_REQUIRED'; receipt:string|null; usage:ResponseUsage|null; reason:string};

/** Extract receipt + usage BEFORE interpreting untrusted model output. Never a billing receipt. */
export function inspectResponseReceipt(value:unknown):InspectedResponse {
  const body = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {} as Record<string,unknown>;
  const receipt = typeof body.id === 'string' && /^resp_[a-zA-Z0-9_-]{1,180}$/.test(body.id) ? body.id : null;
  const rawUsage = body.usage && typeof body.usage === 'object' && !Array.isArray(body.usage)
    ? body.usage as Record<string, unknown> : null;
  const valid = (n:unknown):n is number => Number.isSafeInteger(n) && (n as number) >= 0;
  let usage:ResponseUsage|null = null;
  if (rawUsage && valid(rawUsage.input_tokens) && valid(rawUsage.output_tokens) &&
    valid(rawUsage.total_tokens) && rawUsage.total_tokens >= rawUsage.input_tokens + rawUsage.output_tokens) {
    usage = {inputTokens:rawUsage.input_tokens, outputTokens:rawUsage.output_tokens, totalTokens:rawUsage.total_tokens};
  }
  if (!receipt) return {kind:'RECONCILIATION_REQUIRED',receipt:null,usage,reason:'NO_PROVIDER_ID'};
  if (body.status !== 'completed') return {kind:'RECONCILIATION_REQUIRED',receipt,usage,reason:'NOT_COMPLETED'};
  const outputItems = body.output;
  if (!Array.isArray(outputItems)) return {kind:'RECONCILIATION_REQUIRED',receipt,usage,reason:'NO_OUTPUT'};
  const parts:string[]=[];
  for (const item of outputItems) {
    if (!item || typeof item!=='object' || (item as {type?:unknown}).type!=='message') continue;
    const content = (item as {content?:unknown}).content;
    if (!Array.isArray(content)) return {kind:'RECONCILIATION_REQUIRED',receipt,usage,reason:'MALFORMED_CONTENT'};
    for (const p of content) if (p && typeof p==='object' && (p as {type?:unknown}).type==='output_text') {
      const text=(p as {text?:unknown}).text;
      if (typeof text!=='string') return {kind:'RECONCILIATION_REQUIRED',receipt,usage,reason:'MALFORMED_TEXT'};
      parts.push(text);
    }
  }
  const outputText=parts.join('');
  if (!outputText || outputText.length > 196608) return {kind:'RECONCILIATION_REQUIRED',receipt,usage,reason:'OUTPUT_SIZE'};
  try {return {kind:'PARSED_UNVERIFIED',receipt,usage,output:JSON.parse(outputText)};}
  catch {return {kind:'RECONCILIATION_REQUIRED',receipt,usage,reason:'INVALID_OUTPUT_JSON'};}
}
