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
  // Capture all caller-owned values before the first await. Strings are immutable;
  // neither the request object nor its meter method is consulted after suspension.
  const {model,serializedRequest,maxInputTokens,maxOutputTokens,quoteExpiresAt,meter}=input;
  const expires = Date.parse(quoteExpiresAt);
  if (!Number.isFinite(expires) || !Number.isFinite(Date.now()) || Date.now() >= expires) {
    throw Error('Quote expired or invalid');
  }
  if (typeof model !== 'string' || !/^[a-zA-Z0-9._-]{1,100}$/.test(model) ||
    !Number.isSafeInteger(maxInputTokens) || maxInputTokens < 1 ||
    !Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1 ||
    typeof serializedRequest !== 'string' || serializedRequest.length > 131072 ||
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(serializedRequest) ||
    !meter || typeof meter.countInputTokens !== 'function') {
    throw Error('Invalid or unmetered request');
  }
  const countInputTokens=meter.countInputTokens.bind(meter);
  let payload: unknown;
  try { payload = JSON.parse(serializedRequest); } catch { throw Error('Invalid request JSON'); }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw Error('Invalid request payload');
  const p = payload as Record<string, unknown>;
  if (Object.keys(p).some(k=>!['model','store','tools','max_output_tokens','input'].includes(k)) ||
    p.model !== model || p.store !== false || !Array.isArray(p.tools) || p.tools.length !== 0 ||
    p.max_output_tokens !== maxOutputTokens || !Array.isArray(p.input) ||
    p.input.length<1 || p.input.length>2 || !p.input.every((item,i,items)=>
      record(item) && Object.keys(item).length===2 && Object.keys(item).every(k=>['role','content'].includes(k)) &&
      item.role===(items.length===2&&i===0?'developer':'user') &&
      typeof item.content==='string' && item.content.trim().length>0)) {
    throw Error('Unsafe or mismatched request');
  }
  const bytes=new TextEncoder().encode(serializedRequest);
  const requestSha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
  // No estimate from character count: missing or untrusted meter must fail closed.
  const measured = await countInputTokens(model, serializedRequest);
  if (!Number.isSafeInteger(measured) || measured < 1 || measured > maxInputTokens) {
    throw Error('Input token limit not verified');
  }
  const finishedAt=Date.now();
  if (!Number.isFinite(finishedAt) || finishedAt >= expires) throw Error('Quote expired during metering');
  // Future transports MUST send this exact UTF-8 string, never reread the caller's
  // input or reserialize parsed JSON. The digest identifies those same checked bytes.
  return Object.freeze({kind:'PREFLIGHT_ONLY' as const, liveEnabled:false as const,
    model, inputTokens:measured, maxInputTokens,maxOutputTokens,
    serializedRequest,requestSha256,requestByteLength:bytes.byteLength,quoteExpiresAt});
}

function record(value:unknown):value is Record<string,unknown> {
  return !!value && typeof value==='object' && !Array.isArray(value);
}
export interface ResponseUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  inputTokensDetails: {cachedTokens:number;cacheWriteTokens:number};
  outputTokensDetails: {reasoningTokens:number};
}
export type InspectedResponse =
  | {kind:'PARSED_UNVERIFIED'; receipt:string; usage:ResponseUsage|null; output:unknown}
  | {kind:'RECONCILIATION_REQUIRED'; receipt:string|null; usage:ResponseUsage|null; reason:string};

/** Extract receipt + usage BEFORE interpreting untrusted model output. Never a billing receipt. */
export function inspectResponseReceipt(value:unknown):InspectedResponse {
  const body = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {} as Record<string,unknown>;
  const receipt = typeof body.id === 'string' && /^resp_[a-zA-Z0-9_-]{1,180}$/.test(body.id) ? body.id : null;
  // Receipt extraction is separate from telemetry validation, even for bad envelopes.
  if(body.object!=='response' || !Number.isSafeInteger(body.created_at) || (body.created_at as number)<0 ||
    typeof body.model!=='string' || !body.model.trim() ||
    !['completed','failed','in_progress','cancelled','queued','incomplete'].includes(body.status as string) ||
    !Array.isArray(body.output) ||
    (body.status==='completed' && (body.error!==null || body.incomplete_details!==null))) {
    return {kind:'RECONCILIATION_REQUIRED',receipt,usage:null,reason:'INVALID_RESPONSE_ENVELOPE'};
  }
  const rawUsage = record(body.usage)?body.usage:null;
  const valid = (n:unknown):n is number => Number.isSafeInteger(n) && (n as number) >= 0;
  let usage:ResponseUsage|null = null;
  const inDetails=rawUsage&&record(rawUsage.input_tokens_details)?rawUsage.input_tokens_details:null;
  const outDetails=rawUsage&&record(rawUsage.output_tokens_details)?rawUsage.output_tokens_details:null;
  if (rawUsage && Object.keys(rawUsage).every(k=>['input_tokens','output_tokens','total_tokens','input_tokens_details','output_tokens_details'].includes(k)) &&
    valid(rawUsage.input_tokens) && valid(rawUsage.output_tokens) && valid(rawUsage.total_tokens) &&
    Number.isSafeInteger(rawUsage.input_tokens+rawUsage.output_tokens) &&
    rawUsage.total_tokens === rawUsage.input_tokens + rawUsage.output_tokens &&
    inDetails && Object.keys(inDetails).every(k=>['cached_tokens','cache_write_tokens'].includes(k)) &&
    valid(inDetails.cached_tokens) && valid(inDetails.cache_write_tokens) &&
    inDetails.cached_tokens+inDetails.cache_write_tokens<=rawUsage.input_tokens &&
    outDetails && Object.keys(outDetails).every(k=>k==='reasoning_tokens') &&
    valid(outDetails.reasoning_tokens) && outDetails.reasoning_tokens<=rawUsage.output_tokens) {
    usage = {inputTokens:rawUsage.input_tokens, outputTokens:rawUsage.output_tokens, totalTokens:rawUsage.total_tokens,
      inputTokensDetails:{cachedTokens:inDetails.cached_tokens,cacheWriteTokens:inDetails.cache_write_tokens},
      outputTokensDetails:{reasoningTokens:outDetails.reasoning_tokens}};
  }
  if (!receipt) return {kind:'RECONCILIATION_REQUIRED',receipt:null,usage,reason:'NO_PROVIDER_ID'};
  if (!usage) return {kind:'RECONCILIATION_REQUIRED',receipt,usage:null,reason:'INVALID_OR_MISSING_USAGE'};
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
