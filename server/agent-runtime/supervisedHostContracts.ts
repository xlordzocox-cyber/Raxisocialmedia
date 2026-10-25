/** Local contract inspection only. No host, transport, SQL or spending authority. */
import { taskSpec, type TaskSpec, type Claim, type RuntimeRepository } from './runtime';
import { PILOT_QUOTE } from './pilotBudget';
import type { InspectedResponse } from './supervisedSafety';

export type SupervisedStage = Claim['run']['stage'];
export const SUPERVISED_STAGES: readonly SupervisedStage[] = Object.freeze(['DIRECTOR', 'RESEARCHER']);
export interface SupervisedIntent {
 taskId: string; workspaceId: string; approvalId: string; commandKey: string; spec: TaskSpec;
}
export interface LocalOperatorEvidence {
 provenance: 'LOCAL_FIXTURE'; operatorId: string; workspaceId: string; ownerId: string;
 anonymous: boolean; capabilities: readonly string[]; expiresAt: string;
}
export interface LocalHumanApproval {
 provenance: 'LOCAL_FIXTURE'; id: string; operatorId: string; workspaceId: string; taskId: string;
 scopeDigest: string; policyVersion: number; decision: 'APPROVED' | 'REJECTED';
 provider: string; model: string; maxCostMicros: number; issuedAt: string; expiresAt: string; revoked: boolean;
}
export interface LocalSupervisedPolicy {
 provenance: 'LOCAL_FIXTURE'; workspaceId: string; version: number; enabled: boolean;
 simulated: true; provider: 'simulated'; model: string; expiresAt: string;
 perCallMicros: number; remainingMicros: number; maxInputTokens: number; maxOutputTokens: number;
}
/** Trusted test ports, not a Supabase Auth/RLS implementation or a request-body attestation. */
export interface LocalAdmissionPorts {
 identify(sessionHandle: string, workspaceId: string): Promise<LocalOperatorEvidence | null>;
 readApproval(id: string): Promise<LocalHumanApproval | null>;
 readPolicy(workspaceId: string): Promise<LocalSupervisedPolicy | null>;
}
const id = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 200 &&
 v.trim()===v && !/[\u0000-\u001f\u007f]/u.test(v);
const integer = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const digestPattern = /^[a-f0-9]{64}$/;
function intentSnapshot(value: SupervisedIntent): SupervisedIntent {
 if (!value || Object.keys(value).some(k => !['taskId','workspaceId','approvalId','commandKey','spec'].includes(k)) ||
  ![value.taskId,value.workspaceId,value.approvalId,value.commandKey].every(id)) throw Error('Invalid supervised intent');
 const s = taskSpec(value.spec); // Existing closed task/authorization validation, not a second parser.
 return { taskId:value.taskId,workspaceId:value.workspaceId,approvalId:value.approvalId,commandKey:value.commandKey,
  spec:{question:s.question,externalResearch:s.externalResearch,provider:s.provider,model:s.model,
   authorization:{confirmed:true,maxCostMicros:s.authorization.maxCostMicros,expiresAt:s.authorization.expiresAt}} };
}
async function digest(snapshot: SupervisedIntent): Promise<string> {
 const bytes = new TextEncoder().encode(JSON.stringify(snapshot));
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
}
/** Stable task/scope/provider/budget/operation binding; this does not create an approval. */
export function supervisedIntentDigest(intent: SupervisedIntent) { return digest(intentSnapshot(intent)); }

export async function inspectLocalSupervisedAdmission(sessionHandle: string, value: SupervisedIntent, ports: LocalAdmissionPorts) {
 if (!id(sessionHandle)) throw Error('Operator session required');
 const intent = intentSnapshot(value); // Capture caller-owned input before any await.
 const scopeDigest = await digest(intent);
 const [operator,approval,policy] = await Promise.all([
  ports.identify(sessionHandle,intent.workspaceId).then(v=>structuredClone(v)),
  ports.readApproval(intent.approvalId).then(v=>structuredClone(v)),
  ports.readPolicy(intent.workspaceId).then(v=>structuredClone(v)),
 ]);
 const now = Date.now();
 const validUntil = (v: string) => Number.isFinite(Date.parse(v)) && Date.parse(v) > now;
 if (!Number.isFinite(now) || !operator || operator.provenance !== 'LOCAL_FIXTURE' || !id(operator.operatorId) ||
  operator.anonymous !== false || operator.ownerId !== operator.operatorId || operator.workspaceId !== intent.workspaceId ||
  !Array.isArray(operator.capabilities) || !operator.capabilities.includes('TEXT_RESEARCH') || !validUntil(operator.expiresAt)) {
  throw Error('Operator not authorized for local simulation');
 }
 if (!approval || approval.provenance !== 'LOCAL_FIXTURE' || approval.id !== intent.approvalId ||
  approval.decision !== 'APPROVED' || approval.revoked !== false || approval.operatorId !== operator.operatorId ||
  approval.taskId !== intent.taskId || approval.workspaceId !== intent.workspaceId || approval.scopeDigest !== scopeDigest ||
  approval.provider !== intent.spec.provider || approval.model !== intent.spec.model ||
  !Number.isFinite(Date.parse(approval.issuedAt)) || Date.parse(approval.issuedAt) > now ||
  !validUntil(approval.expiresAt) || !validUntil(intent.spec.authorization.expiresAt) ||
  approval.maxCostMicros !== intent.spec.authorization.maxCostMicros) throw Error('Human approval missing, stale or incompatible');
 if (!policy || policy.provenance !== 'LOCAL_FIXTURE' || policy.workspaceId !== intent.workspaceId || policy.enabled !== true ||
  policy.simulated !== true || policy.provider !== 'simulated' || intent.spec.provider !== policy.provider ||
  intent.spec.externalResearch !== false || policy.model !== intent.spec.model || !validUntil(policy.expiresAt) ||
  !integer(policy.version) || policy.version < 1 || approval.policyVersion !== policy.version ||
  !integer(policy.perCallMicros) || !integer(policy.remainingMicros) ||
  !integer(policy.maxInputTokens) || policy.maxInputTokens < 1 || policy.maxInputTokens > PILOT_QUOTE.maxInputTokensPerStage ||
  !integer(policy.maxOutputTokens) || policy.maxOutputTokens < 1 || policy.maxOutputTokens > PILOT_QUOTE.maxOutputTokensPerStage) {
  throw Error('Policy denies local simulation');
 }
 // Reuse pilot bounds only, NEVER its expired price quote as a current tariff.
 const reservationMicros = SUPERVISED_STAGES.length * policy.perCallMicros;
 if (!Number.isSafeInteger(reservationMicros) || reservationMicros > policy.remainingMicros ||
  reservationMicros > approval.maxCostMicros || approval.maxCostMicros > PILOT_QUOTE.maxTaskMicros) throw Error('Insufficient supervised budget');
 return Object.freeze({kind:'LOCAL_CONTRACT_ONLY' as const,mode:'SIMULATED' as const,liveEnabled:false as const,
  taskId:intent.taskId,workspaceId:intent.workspaceId,commandKey:intent.commandKey,operatorId:operator.operatorId,
  approvalId:approval.id,scopeDigest,policyVersion:policy.version,reservationMicros,
  maxInputTokens:policy.maxInputTokens,maxOutputTokens:policy.maxOutputTokens,
  expiresAt:new Date(Math.min(...[operator.expiresAt,approval.expiresAt,policy.expiresAt,intent.spec.authorization.expiresAt].map(Date.parse))).toISOString()});
}

/** Mirrors existing run states; local evidence is never projected as a REAL agent. */
export interface LocalAttemptEvidence {
 taskId: string; workspaceId: string; runId: string; commandKey: string;
 stage: SupervisedStage; attempt: 1; status: 'CLAIMED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN';
 simulated: true; requestSha256: string; receipt: string | null;
}
function attemptSnapshot(value: LocalAttemptEvidence): LocalAttemptEvidence {
 const v=structuredClone(value);
 if (!v || ![v.taskId,v.workspaceId,v.runId,v.commandKey].every(id) || !SUPERVISED_STAGES.includes(v.stage) ||
  v.attempt!==1 || v.simulated!==true || !digestPattern.test(v.requestSha256) ||
  !['CLAIMED','RUNNING','SUCCEEDED','FAILED','UNKNOWN'].includes(v.status) ||
  (v.receipt!==null && (typeof v.receipt!=='string' || !v.receipt.startsWith('SIMULATED:') || v.receipt.length>200)) ||
  (['RUNNING','SUCCEEDED'].includes(v.status) && !v.receipt)) throw Error('Invalid local attempt evidence');
 return v;
}
/** Plans a manual step from canonical history; does NOT claim, run or retry an attempt. */
export function inspectLocalManualStep(taskId: string, workspaceId: string, history: readonly LocalAttemptEvidence[]) {
 if (!id(taskId) || !id(workspaceId) || !Array.isArray(history) || history.length>SUPERVISED_STAGES.length) throw Error('Invalid attempt history');
 const attempts=history.map(attemptSnapshot);
 if (new Set(attempts.map(a=>a.runId)).size!==attempts.length || new Set(attempts.map(a=>a.commandKey)).size!==attempts.length ||
  attempts.some((a,i)=>a.taskId!==taskId || a.workspaceId!==workspaceId || a.stage!==SUPERVISED_STAGES[i]) ||
  (attempts.length===2 && attempts[0].status!=='SUCCEEDED')) throw Error('Duplicate, foreign or invalid stage history');
 const blocked=attempts.some(a=>a.status==='UNKNOWN'||a.status==='FAILED')?'RECONCILIATION_REQUIRED':
  attempts.some(a=>a.status==='CLAIMED'||a.status==='RUNNING')?'IN_FLIGHT':null;
 const nextStage=blocked?null:SUPERVISED_STAGES[attempts.length]??null;
 return Object.freeze({kind:'LOCAL_CONTRACT_ONLY' as const,liveEnabled:false as const,automaticRetry:false as const,
  phase:blocked?'BLOCKED' as const:nextStage?'MANUAL_STEP_AVAILABLE' as const:'COMPLETED' as const,
  reason:blocked,nextStage});
}

export interface LocalOperationReceipt {
 taskId:string;workspaceId:string;runId:string;commandKey:string;requestSha256:string;
 simulated:true;sourceKind:'MOCK';evidenceStatus:'UNVERIFIED';
}
/** A matching local fixture is not a DB commit and never reopens an uncertain attempt. */
export function inspectLocalReconciliation(pending: LocalAttemptEvidence, received: LocalOperationReceipt|null) {
 const retainedCommand=Object.freeze(attemptSnapshot(pending));
 const matches=received && received.simulated===true && received.sourceKind==='MOCK' && received.evidenceStatus==='UNVERIFIED' &&
  (['taskId','workspaceId','runId','commandKey','requestSha256'] as const).every(k=>received[k]===retainedCommand[k]);
 return Object.freeze({kind:'LOCAL_CONTRACT_ONLY' as const,liveEnabled:false as const,automaticRetry:false as const,
  status:received===null?'PENDING' as const:matches?'MATCHED_LOCAL' as const:'CONFLICT' as const,retainedCommand});
}

/** Future durable journal contract only; no implementation or persistence assertion in this PR. */
interface JournalWriteFields {
 operationId:string;expectedVersion:number;taskId:string;workspaceId:string;runId:string;attempt:number;
 operatorId:string;approvalId:string;scopeDigest:string;requestSha256:string;
 event:Parameters<RuntimeRepository['step']>[2];response:InspectedResponse|null;
}
export type SupervisedJournalWrite = JournalWriteFields & (
 {simulated:true;sourceKind:'MOCK';evidenceStatus:'UNVERIFIED'} |
 {simulated:false;sourceKind:'AGENT_EXECUTOR';evidenceStatus:'UNVERIFIED'|'VERIFIED'}
);
export interface SupervisedJournalPort {
 /** Must atomically enforce owner, version, policy, idempotency and audit in a future implementation. */
 commit(write: Readonly<SupervisedJournalWrite>): Promise<{operationId:string;version:number;committedDigest:string}>;
 reconcile(operationId:string): Promise<{status:'FOUND'|'MISSING'|'CONFLICT'|'UNAVAILABLE';write:SupervisedJournalWrite|null}>;
}
