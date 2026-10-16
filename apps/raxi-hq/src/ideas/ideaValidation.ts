import {
  IDEA_CHANNELS, IDEA_EVIDENCE_KINDS, IDEA_PRIORITIES, IDEA_SOURCES, IDEA_STATUSES,
  type IdeaChannel, type IdeaEvidence, type IdeaEvidenceKind, type IdeaHandoffToHQ,
  type IdeaPriority, type IdeaRecord, type IdeaSource, type IdeaStatus,
} from './ideaContracts';

// Reject oversized input before visiting its records. No collection is truncated.
export const MAX_IDEAS = 200;
export const MAX_TITLE_LENGTH = 120;
export const MAX_SUMMARY_LENGTH = 1000;
export const MAX_REASON_LENGTH = 1500;
export const MAX_TAGS = 12;
export const MAX_TAG_LENGTH = 40;
export const MAX_CHANNELS = 8;
export const MAX_EVIDENCE_PER_IDEA = 12;
export const MAX_RELATED_CAMPAIGNS = 20;
const MAX_ID_LENGTH = 128;

type SourceRecord = Record<string, unknown>;
function record(value: unknown): SourceRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid idea record');
  return value as SourceRecord;
}
function own(item: SourceRecord, key: string): unknown {
  return Object.hasOwn(item, key) ? item[key] : undefined;
}
function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error('Invalid idea text');
  }
  return value;
}
function multilineText(value: unknown, max: number): string {
  // Preserve LF exactly; CR/CRLF and every other ASCII control remain invalid.
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/.test(value)) {
    throw new Error('Invalid idea text');
  }
  return value;
}
function id(value: unknown): string {
  const result = text(value, MAX_ID_LENGTH);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(result) || result === 'prototype' || Object.hasOwn(Object.prototype, result)) {
    throw new Error('Invalid idea ID');
  }
  return result;
}
function optional<T>(value: unknown, validate: (input: unknown) => T): T | undefined {
  return value === undefined ? undefined : validate(value);
}
function member<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) throw new Error('Unknown idea value');
  return value as T;
}
function boundedList(value: unknown, maximum: number): unknown[] {
  if (!Array.isArray(value)) throw new Error('Invalid idea collection');
  const length = value.length;
  if (!Number.isSafeInteger(length) || length < 0) throw new Error('Invalid idea collection');
  if (length > maximum) throw new Error('Idea collection exceeds maximum');
  // Read only the approved slots; accessors and changing length make the input unstable.
  const entries: unknown[] = [];
  for (let index = 0; index < length; index++) {
    if (value.length !== length) throw new Error('Invalid idea collection');
    const descriptor = Object.getOwnPropertyDescriptor(value, index);
    if (value.length !== length || descriptor === undefined || !Object.hasOwn(descriptor, 'value')) {
      throw new Error('Invalid idea collection');
    }
    entries.push(descriptor.value);
  }
  if (value.length !== length) throw new Error('Invalid idea collection');
  return entries;
}
function unique<T>(values: T[]): T[] {
  if (new Set(values).size !== values.length) throw new Error('Duplicate idea value');
  return values;
}
function score(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) throw new Error('Invalid idea score');
  return value;
}

/** Same ISO grammar and strict calendar policy as the v0.5 canonical feed. */
export function validateIdeaTimestamp(value: unknown): string {
  const result = text(value, 40);
  const parts = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.\d+)?(?:Z|[+-](\d\d):(\d\d))$/.exec(result);
  if (!parts) throw new Error('Invalid idea timestamp');
  const year = Number(parts[1]), month = Number(parts[2]), day = Number(parts[3]);
  const hour = Number(parts[4]), minute = Number(parts[5]), second = Number(parts[6]);
  const offsetHour = parts[7] === undefined ? undefined : Number(parts[7]);
  const offsetMinute = parts[8] === undefined ? undefined : Number(parts[8]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1] || hour > 23 || minute > 59 || second > 59 ||
      (offsetHour !== undefined && (offsetHour > 23 || offsetMinute! > 59)) || !Number.isFinite(Date.parse(result))) {
    throw new Error('Invalid idea timestamp');
  }
  return result;
}

// Compare instants without losing fractional precision beyond milliseconds.
function compareIdeaTimestamps(left: string, right: string): number {
  const withoutFraction = (value: string) => value.replace(/\.\d+(?=Z|[+-]\d\d:\d\d$)/, '');
  const seconds = Date.parse(withoutFraction(left)) - Date.parse(withoutFraction(right));
  if (seconds !== 0) return Math.sign(seconds);
  const fraction = (value: string) => /\.(\d+)(?:Z|[+-]\d\d:\d\d)$/.exec(value)?.[1] ?? '';
  const leftFraction = fraction(left), rightFraction = fraction(right);
  const width = Math.max(leftFraction.length, rightFraction.length);
  const a = leftFraction.padEnd(width, '0'), b = rightFraction.padEnd(width, '0');
  return a < b ? -1 : a > b ? 1 : 0;
}

function evidence(value: unknown): IdeaEvidence {
  const item = record(value);
  return {
    id: id(own(item, 'id')),
    kind: member<IdeaEvidenceKind>(own(item, 'kind'), IDEA_EVIDENCE_KINDS),
    label: text(own(item, 'label'), 160),
    sourceRef: optional(own(item, 'sourceRef'), input => text(input, 256)),
    capturedAt: optional(own(item, 'capturedAt'), validateIdeaTimestamp),
  };
}

/** Returns a clean, validated record; unknown source fields are not forwarded. */
export function validateIdeaRecord(value: unknown): IdeaRecord {
  const item = record(value);
  const rawEvidence = boundedList(own(item, 'evidence'), MAX_EVIDENCE_PER_IDEA);
  const rawChannels = boundedList(own(item, 'suggestedChannels'), MAX_CHANNELS);
  const rawTags = boundedList(own(item, 'tags'), MAX_TAGS);
  const related = own(item, 'relatedCampaignIds');
  const rawRelated = related === undefined ? undefined : boundedList(related, MAX_RELATED_CAMPAIGNS);
  const evidenceItems = rawEvidence.map(evidence);
  unique(evidenceItems.map(entry => entry.id));
  const idea: IdeaRecord = {
    id: id(own(item, 'id')),
    title: text(own(item, 'title'), MAX_TITLE_LENGTH),
    summary: multilineText(own(item, 'summary'), MAX_SUMMARY_LENGTH),
    source: member<IdeaSource>(own(item, 'source'), IDEA_SOURCES),
    status: member<IdeaStatus>(own(item, 'status'), IDEA_STATUSES),
    priority: member<IdeaPriority>(own(item, 'priority'), IDEA_PRIORITIES),
    createdAt: validateIdeaTimestamp(own(item, 'createdAt')),
    updatedAt: validateIdeaTimestamp(own(item, 'updatedAt')),
    reason: multilineText(own(item, 'reason'), MAX_REASON_LENGTH),
    suggestedChannels: unique(rawChannels.map(channel => member<IdeaChannel>(channel, IDEA_CHANNELS))),
    tags: unique(rawTags.map(tag => text(tag, MAX_TAG_LENGTH))),
    fitScore: score(own(item, 'fitScore')),
    confidenceScore: score(own(item, 'confidenceScore')),
    evidence: evidenceItems,
    duplicateOfIdeaId: optional(own(item, 'duplicateOfIdeaId'), id),
    relatedCampaignIds: rawRelated === undefined ? undefined : unique(rawRelated.map(id)),
    approvedAt: optional(own(item, 'approvedAt'), validateIdeaTimestamp),
    sentToHqAt: optional(own(item, 'sentToHqAt'), validateIdeaTimestamp),
  };
  if (compareIdeaTimestamps(idea.createdAt, idea.updatedAt) > 0 ||
      (idea.approvedAt !== undefined && (compareIdeaTimestamps(idea.createdAt, idea.approvedAt) > 0 ||
        compareIdeaTimestamps(idea.approvedAt, idea.updatedAt) > 0)) ||
      (idea.sentToHqAt !== undefined && (idea.approvedAt === undefined ||
        compareIdeaTimestamps(idea.approvedAt, idea.sentToHqAt) > 0 ||
        compareIdeaTimestamps(idea.sentToHqAt, idea.updatedAt) > 0)) ||
      (idea.sentToHqAt !== undefined && idea.status !== 'SENT_TO_HQ') ||
      (idea.approvedAt !== undefined && (idea.status === 'PROPOSED' || idea.status === 'UNDER_REVIEW' ||
        idea.status === 'REJECTED')) ||
      (idea.status === 'APPROVED_FOR_HQ' && idea.approvedAt === undefined) ||
      (idea.status === 'SENT_TO_HQ' && (idea.approvedAt === undefined || idea.sentToHqAt === undefined))) {
    throw new Error('Invalid idea chronology');
  }
  return idea;
}

export function validateIdeaCollection(value: unknown): IdeaRecord[] {
  const raw = boundedList(value, MAX_IDEAS);
  const ideas = raw.map(validateIdeaRecord);
  unique(ideas.map(idea => idea.id));
  return ideas.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

const transitions: Readonly<Record<IdeaStatus, readonly IdeaStatus[]>> = {
  PROPOSED: ['UNDER_REVIEW'],
  UNDER_REVIEW: ['APPROVED_FOR_HQ', 'REJECTED', 'ARCHIVED'],
  APPROVED_FOR_HQ: ['SENT_TO_HQ', 'ARCHIVED'],
  REJECTED: ['ARCHIVED'],
  ARCHIVED: [],
  SENT_TO_HQ: [],
};
export function canTransitionIdea(from: IdeaStatus, to: IdeaStatus): boolean {
  return Object.hasOwn(transitions, from) && transitions[from].includes(to);
}
export function transitionIdea(value: IdeaRecord, to: IdeaStatus, at: string): IdeaRecord {
  const idea = validateIdeaRecord(value);
  if (!canTransitionIdea(idea.status, to)) throw new Error('Invalid idea transition');
  const timestamp = validateIdeaTimestamp(at);
  if (compareIdeaTimestamps(timestamp, idea.createdAt) < 0 ||
      compareIdeaTimestamps(timestamp, idea.updatedAt) < 0 ||
      (to === 'SENT_TO_HQ' && (idea.approvedAt === undefined || compareIdeaTimestamps(timestamp, idea.approvedAt) < 0))) {
    throw new Error('Invalid idea chronology');
  }
  return validateIdeaRecord({
    ...idea, status: to, updatedAt: timestamp,
    approvedAt: to === 'APPROVED_FOR_HQ' ? timestamp : idea.approvedAt,
    sentToHqAt: to === 'SENT_TO_HQ' ? timestamp : idea.sentToHqAt,
  });
}

export function createIdeaHandoff(value: IdeaRecord): IdeaHandoffToHQ {
  const idea = validateIdeaRecord(value);
  if (idea.status !== 'SENT_TO_HQ' || idea.approvedAt === undefined || idea.sentToHqAt === undefined) {
    throw new Error('Idea is not approved and sent to HQ');
  }
  return {
    ideaId: idea.id, title: idea.title, summary: idea.summary, reason: idea.reason,
    source: idea.source, priority: idea.priority, suggestedChannels: [...idea.suggestedChannels],
    fitScore: idea.fitScore, confidenceScore: idea.confidenceScore,
    evidenceRefs: idea.evidence.map(entry => entry.id).sort(), sentAt: idea.sentToHqAt,
  };
}
