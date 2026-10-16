import { type IdeaChannel, type IdeaHandoffToHQ, type IdeaPriority, type IdeaRecord, type IdeaStatus } from './ideaContracts';
import { createManualIdeaDraft, validateManualText, type ManualIdeaDraft, type ManualIdeaInput } from './manualIdeaDraft';
import { createIdeaHandoff, MAX_IDEAS, MAX_REASON_LENGTH, MAX_SUMMARY_LENGTH, transitionIdea, validateIdeaCollection, validateIdeaRecord, validateIdeaTimestamp } from './ideaValidation';

export type Clock = () => string;
export type IdeaAuditAction = 'DRAFT_CREATED' | 'DRAFT_DELETED' | 'DRAFT_PROMOTED' | 'REVIEW_STARTED' | 'APPROVED_FOR_HQ' | 'REJECTED' | 'ARCHIVED' | 'SENT_TO_HQ';
export interface IdeaCenterAuditEvent { id: string; timestamp: string; action: IdeaAuditAction; ideaId?: string; draftId?: string; actor: 'LUIS' }
export interface IdeaCenterSession {
  mockIdeas: IdeaRecord[];
  manualDrafts: ManualIdeaDraft[];
  sessionIdeas: IdeaRecord[];
  handoffs: IdeaHandoffToHQ[];
  audit: IdeaCenterAuditEvent[];
  nextManualNumber: number;
}
export interface IdeaReviewInput {
  title: string; summary: string; reason: string; priority: IdeaPriority;
  suggestedChannels: IdeaChannel[]; tags: string[]; fitScore: number; confidenceScore: number;
}
export type IdeaSessionAction =
  | { type: 'CREATE_DRAFT'; input: ManualIdeaInput; at: string }
  | { type: 'DELETE_DRAFT'; draftId: string; at: string }
  | { type: 'PROMOTE_DRAFT'; draftId: string; input: IdeaReviewInput; at: string }
  | { type: 'TRANSITION'; ideaId: string; to: Exclude<IdeaStatus, 'SENT_TO_HQ'>; at: string }
  | { type: 'SEND_TO_HQ'; ideaId: string; at: string };
export type IdeaSessionCommand = IdeaSessionAction extends infer A ? A extends IdeaSessionAction ? Omit<A, 'at'> : never : never;

export function createIdeaCenterSession(mockIdeas: readonly IdeaRecord[]): IdeaCenterSession {
  return { mockIdeas: validateIdeaCollection(mockIdeas), manualDrafts: [], sessionIdeas: [], handoffs: [], audit: [], nextManualNumber: 1 };
}
export function sessionIdeas(state: IdeaCenterSession): IdeaRecord[] {
  const replacements = new Map(state.sessionIdeas.map(idea => [idea.id, idea]));
  return [...state.mockIdeas.map(idea => replacements.get(idea.id) ?? idea),
    ...state.sessionIdeas.filter(idea => !state.mockIdeas.some(mock => mock.id === idea.id))];
}
export function ideaProvenance(state: IdeaCenterSession, id: string): string {
  return state.mockIdeas.some(idea => idea.id === id)
    ? state.sessionIdeas.some(idea => idea.id === id) ? 'MOCK · modificado en sesión' : 'MOCK'
    : 'LOCAL · SESIÓN';
}
function withAudit(state: IdeaCenterSession, at: string, action: IdeaAuditAction, id: { ideaId?: string; draftId?: string }): IdeaCenterSession {
  if (state.audit.length >= 1000) throw new Error('Límite del registro de sesión alcanzado.');
  const event: IdeaCenterAuditEvent = { id: `AUDIT-${String(state.audit.length + 1).padStart(4, '0')}`, timestamp: at, action, actor: 'LUIS', ...id };
  return { ...state, audit: [...state.audit, event] };
}
function nextManualId(state: IdeaCenterSession): { id: string; next: number } {
  const used = new Set([...state.mockIdeas.map(idea => idea.id), ...state.sessionIdeas.map(idea => idea.id), ...state.manualDrafts.map(draft => draft.id)]);
  let next = state.nextManualNumber;
  while (used.has(`IDEA-MANUAL-${String(next).padStart(3, '0')}`)) next++;
  return { id: `IDEA-MANUAL-${String(next).padStart(3, '0')}`, next: next + 1 };
}
function reviewRecord(draft: ManualIdeaDraft, input: IdeaReviewInput, at: string): IdeaRecord {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new Error('Propuesta inválida.');
  const raw = input as unknown as Record<string, unknown>;
  const title = validateManualText(Object.hasOwn(raw, 'title') ? raw.title : undefined, 120, 'Título');
  const summary = validateManualText(Object.hasOwn(raw, 'summary') ? raw.summary : undefined, MAX_SUMMARY_LENGTH, 'Resumen');
  const reason = validateManualText(Object.hasOwn(raw, 'reason') ? raw.reason : undefined, MAX_REASON_LENGTH, 'Motivo');
  const timestamp = validateIdeaTimestamp(at);
  const evidence = draft.sourceRef === undefined ? [] : [{ id: `${draft.id}-REF`, kind: 'MANUAL_NOTE' as const,
    label: 'Referencia aportada por Luis', sourceRef: draft.sourceRef, capturedAt: draft.createdAt }];
  return validateIdeaRecord({ id: draft.id, title, summary, reason, source: 'MANUAL_LUIS', status: 'PROPOSED',
    priority: Object.hasOwn(raw, 'priority') ? raw.priority : undefined, createdAt: draft.createdAt, updatedAt: timestamp,
    suggestedChannels: Object.hasOwn(raw, 'suggestedChannels') ? raw.suggestedChannels : undefined,
    tags: Object.hasOwn(raw, 'tags') ? raw.tags : undefined,
    fitScore: Object.hasOwn(raw, 'fitScore') ? raw.fitScore : undefined,
    confidenceScore: Object.hasOwn(raw, 'confidenceScore') ? raw.confidenceScore : undefined, evidence });
}
/** Pure internal write boundary. Every action is atomic and has an explicit clock value. */
export function reduceIdeaCenterSession(state: IdeaCenterSession, action: IdeaSessionAction): IdeaCenterSession {
  const at = validateIdeaTimestamp(action.at);
  if (action.type === 'CREATE_DRAFT') {
    if (sessionIdeas(state).length + state.manualDrafts.length >= MAX_IDEAS) throw new Error('Límite de ideas de sesión alcanzado.');
    const { id, next } = nextManualId(state);
    const draft = createManualIdeaDraft(id, action.input, at);
    return withAudit({ ...state, manualDrafts: [...state.manualDrafts, draft], nextManualNumber: next }, at, 'DRAFT_CREATED', { draftId: id });
  }
  if (action.type === 'DELETE_DRAFT') {
    if (!state.manualDrafts.some(draft => draft.id === action.draftId)) throw new Error('Borrador inexistente.');
    return withAudit({ ...state, manualDrafts: state.manualDrafts.filter(draft => draft.id !== action.draftId) }, at, 'DRAFT_DELETED', { draftId: action.draftId });
  }
  if (action.type === 'PROMOTE_DRAFT') {
    const draft = state.manualDrafts.find(item => item.id === action.draftId);
    if (!draft) throw new Error('Borrador inexistente.');
    if (sessionIdeas(state).length >= MAX_IDEAS) throw new Error('Límite de ideas alcanzado.');
    if (sessionIdeas(state).some(idea => idea.id === draft.id)) throw new Error('ID de propuesta duplicado.');
    const idea = reviewRecord(draft, action.input, at);
    return withAudit({ ...state, manualDrafts: state.manualDrafts.filter(item => item.id !== draft.id), sessionIdeas: [...state.sessionIdeas, idea] }, at, 'DRAFT_PROMOTED', { draftId: draft.id, ideaId: idea.id });
  }
  const idea = sessionIdeas(state).find(item => item.id === action.ideaId);
  if (!idea) throw new Error('Idea inexistente.');
  if (action.type === 'SEND_TO_HQ') {
    if (state.handoffs.some(item => item.ideaId === idea.id)) return state;
    const sent = transitionIdea(idea, 'SENT_TO_HQ', at);
    const handoff = createIdeaHandoff(sent);
    const updated = { ...state, sessionIdeas: [...state.sessionIdeas.filter(item => item.id !== idea.id), sent], handoffs: [...state.handoffs, handoff] };
    return withAudit(updated, at, 'SENT_TO_HQ', { ideaId: idea.id });
  }
  const next = transitionIdea(idea, action.to, at);
  const auditAction: Record<'UNDER_REVIEW' | 'APPROVED_FOR_HQ' | 'REJECTED' | 'ARCHIVED', IdeaAuditAction> = {
    UNDER_REVIEW: 'REVIEW_STARTED', APPROVED_FOR_HQ: 'APPROVED_FOR_HQ', REJECTED: 'REJECTED', ARCHIVED: 'ARCHIVED',
  };
  if (!Object.hasOwn(auditAction, action.to)) throw new Error('Transición no disponible.');
  return withAudit({ ...state, sessionIdeas: [...state.sessionIdeas.filter(item => item.id !== idea.id), next] }, at,
    auditAction[action.to as keyof typeof auditAction], { ideaId: idea.id });
}

/** Runtime calls this only on a user action. Tests inject a fixed clock. */
export function dispatchIdeaAction(state: IdeaCenterSession, clock: Clock, action: IdeaSessionCommand): IdeaCenterSession {
  return reduceIdeaCenterSession(state, { ...action, at: validateIdeaTimestamp(clock()) } as IdeaSessionAction);
}
