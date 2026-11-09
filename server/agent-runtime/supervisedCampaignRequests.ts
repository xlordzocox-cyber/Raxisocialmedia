import { evaluateCampaign } from '../../apps/raxi-hq/src/campaigns/campaignEligibility';
import { parseCampaignSnapshot, sameValue } from '../../apps/raxi-hq/src/persistence/campaignCommands';
import { stagingProject, type HostedIdentity, type ServerRpcPort } from './supabaseSupervisedAuth';

interface RequestDraft {
  workspaceId: string;
  campaignId: string;
  strategyRevision: number;
  deliverableId: string;
  expectedCampaignVersion: number;
  requestKey: string;
  purpose: 'PREPARE_VISUAL_BRIEF';
}
type Command = RequestDraft & { snapshotHash: string };
const fields = ['workspaceId', 'campaignId', 'strategyRevision', 'deliverableId', 'expectedCampaignVersion', 'requestKey', 'purpose'];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const hashPattern = /^[0-9a-f]{64}$/;
const matches = (pattern: RegExp, value: unknown): value is string => typeof value === 'string' && pattern.test(value);
const integer = (value: unknown, minimum: number) => typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid object');
  return value as Record<string, unknown>;
}
async function readBody(request: Request, submit: boolean) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '') || !request.body) throw Error('JSON required');
  const reader = request.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let size = 0;
  let body = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4096) throw Error('Body too large');
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  const value = record(JSON.parse(body));
  const allowed = submit ? [...fields, 'snapshotHash'] : fields;
  if (Object.keys(value).length !== allowed.length || !allowed.every(key => Object.hasOwn(value, key)) ||
      !matches(uuid, value.workspaceId) || !matches(uuid, value.requestKey) ||
      !matches(/^CAMPAIGN-\d{3}$/, value.campaignId) || !matches(/^STRATEGY-ITEM-\d{3}$/, value.deliverableId) ||
      !integer(value.strategyRevision, 1) || !integer(value.expectedCampaignVersion, 0) ||
      value.purpose !== 'PREPARE_VISUAL_BRIEF' || (submit && !matches(hashPattern, value.snapshotHash))) {
    throw Error('Command denied');
  }
  return Object.freeze(value) as unknown as Readonly<Command>;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(record(value)[key])]));
  return value;
}
async function fingerprint(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(canonical(value)));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}
const json = (status: number, body: object) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const denied = () => json(403, { status: 'INELIGIBLE', reason: 'IDENTITY_NOT_CONFIRMED' });
const stale = () => json(409, { status: 'STALE', reason: 'CANONICAL_SUBJECT_CHANGED' });
const unknown = () => json(503, { status: 'UNKNOWN', reason: 'CONFIRMATION_UNAVAILABLE' });

async function confirmed(value: unknown, command: Command, identity: HostedIdentity) {
  const receipt = record(value);
  if (receipt.status === 'CONFLICT') return json(409, { status: 'CONFLICT' });
  if (receipt.status === 'STALE') return stale();
  if (receipt.status !== 'REQUESTED' || receipt.authorization !== 'PENDING_HUMAN_EXECUTION_AUTH' ||
      !sameValue(receipt.command, command) || receipt.actorId !== identity.actorId || !matches(uuid, receipt.requestId) ||
      typeof receipt.createdAt !== 'string' || !Number.isFinite(Date.parse(receipt.createdAt))) return unknown();
  const { snapshotHash, ...draft } = command;
  if (await fingerprint({ evidence: receipt.evidence, request: draft }) !== snapshotHash) return unknown();
  return json(200, { status: 'REQUESTED', authorization: receipt.authorization, requestId: receipt.requestId,
    actorId: receipt.actorId, createdAt: receipt.createdAt, command });
}

/** Server-only, intentionally unmounted. The verifier and RPC client are trusted server dependencies. */
export function supervisedCampaignRequests(deps: {
  projectRef: string;
  verify(token: string, workspaceId: string): Promise<Readonly<HostedIdentity>>;
  server: ServerRpcPort;
}) {
  if (typeof window !== 'undefined') throw Error('Server only');
  const projectRef = stagingProject(deps.projectRef);
  async function rpc(name: string, args: Record<string, unknown>) {
    const result = await deps.server.rpc(name, args);
    if (result.error) throw result.error;
    return result.data;
  }
  async function handle(request: Request, submit: boolean): Promise<Response> {
    if (request.method !== 'POST') return json(405, { status: 'INELIGIBLE', reason: 'METHOD_NOT_ALLOWED' });
    const token = /^Bearer ([^\s,]{1,16384})$/i.exec(request.headers.get('authorization') ?? '')?.[1];
    if (!token) return json(401, { status: 'INELIGIBLE', reason: 'SESSION_REQUIRED' });
    let command;
    try { command = await readBody(request, submit); }
    catch { return json(400, { status: 'INELIGIBLE', reason: 'INVALID_COMMAND' }); }

    try {
      const identity = structuredClone(await deps.verify(token, command.workspaceId));
      if (identity.provenance !== 'SUPABASE_AUTH_STAGING' || identity.workspaceId !== command.workspaceId ||
          identity.projectRef !== projectRef || !matches(uuid, identity.actorId) || !matches(uuid, identity.sessionId) ||
          !(Date.parse(identity.expiresAt) > Date.now())) return denied();
      const args = { p_identity: identity, p_command: command };
      if (submit) {
        const existing = await rpc('raxi_supervised_campaign_request_replay', args);
        if (existing !== null) return await confirmed(existing, command, identity);
      }
      const raw = record(structuredClone(await rpc('raxi_campaign_snapshot', { p_workspace: command.workspaceId, p_actor: identity.actorId })));
      const snapshot = parseCampaignSnapshot(raw, identity.actorId, identity.workspaceId);
      if (snapshot.version !== command.expectedCampaignVersion) return stale();
      const campaign = snapshot.session.campaigns.find(item => item.id === command.campaignId);
      if (!campaign) return json(422, { status: 'INELIGIBLE', reason: 'CAMPAIGN_NOT_FOUND' });
      const eligibility = evaluateCampaign(snapshot, campaign);
      if (eligibility.revision !== undefined && eligibility.revision !== command.strategyRevision) return stale();
      if (!eligibility.eligible || !eligibility.deliverables.some(item => item.eligible && item.deliverable.id === command.deliverableId)) {
        return json(422, { status: 'INELIGIBLE', reason: 'EDITORIAL_REQUIREMENTS_NOT_MET' });
      }
      const source = raw as unknown as typeof snapshot;
      const evidence = {
        campaign: source.session.campaigns.find(item => item.id === command.campaignId),
        strategy: source.session.strategies.find(item => item.campaignId === command.campaignId && item.revision === command.strategyRevision),
        approvalReceipt: source.receipts.find(({ command: item }) => item.action.type === 'APPROVE_STRATEGY' &&
          item.action.campaignId === command.campaignId && item.action.revision === command.strategyRevision),
        approvalEvent: source.session.audit.find(item => item.action === 'STRATEGY_APPROVED' &&
          item.campaignId === command.campaignId && item.revision === command.strategyRevision),
      };
      const { serverTime: _serverTime, ...expected } = raw;
      const { snapshotHash: providedHash, ...draft } = command;
      const snapshotHash = await fingerprint({ evidence, request: draft });
      if (!submit) return json(200, { status: 'ELIGIBLE', snapshotHash });
      if (providedHash !== snapshotHash) return stale();
      return await confirmed(await rpc('raxi_supervised_campaign_request_commit', { ...args, p_expected: expected, p_evidence: evidence }), command, identity);
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === '42501') return denied();
      return unknown();
    }
  }
  return { preflight: (request: Request) => handle(request, false), submit: (request: Request) => handle(request, true) };
}
