import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadMockIdeaCenter } from '../src/ideas/mockIdeas';
import { getIdeaById, getIdeasBySource, getIdeasByStatus, getIdeasSortedByPriority, summarizeIdeas } from '../src/ideas/ideaSelectors';
import {
  MAX_CHANNELS, MAX_EVIDENCE_PER_IDEA, MAX_IDEAS, MAX_REASON_LENGTH, MAX_RELATED_CAMPAIGNS,
  MAX_SUMMARY_LENGTH, MAX_TAGS, MAX_TITLE_LENGTH, canTransitionIdea, createIdeaHandoff,
  transitionIdea, validateIdeaCollection, validateIdeaRecord, validateIdeaTimestamp,
} from '../src/ideas/ideaValidation';
import type { IdeaRecord, IdeaStatus } from '../src/ideas/ideaContracts';

const base = (): IdeaRecord => ({
  id: 'IDEA-TEST-001', title: 'Propuesta de prueba', summary: 'Una propuesta, no una campaña.',
  source: 'MANUAL_LUIS', status: 'PROPOSED', priority: 'MEDIUM',
  createdAt: '2026-10-10T10:00:00.0009Z', updatedAt: '2026-10-10T10:00:00.0009Z',
  reason: 'Validar el contrato sin conectar ninguna fuente.',
  suggestedChannels: ['INSTAGRAM_FEED'], tags: ['mock'], fitScore: 70, confidenceScore: 50,
  evidence: [{ id: 'EV-TEST-001', kind: 'MANUAL_NOTE', label: 'Referencia opaca', sourceRef: 'mock:note:001' }],
});

test('IdeaRecord validates a complete proposal without inventing optional data', () => {
  const record = validateIdeaRecord(base());
  assert.deepEqual(record, { ...base(), duplicateOfIdeaId: undefined, relatedCampaignIds: undefined,
    approvedAt: undefined, sentToHqAt: undefined,
    evidence: [{ ...base().evidence[0], capturedAt: undefined }] });
  assert.equal(record.createdAt, '2026-10-10T10:00:00.0009Z');
  assert.equal(record.status, 'PROPOSED');
});

test('scores reject negative, over-100, NaN and nonnumeric values without auto-approval', () => {
  for (const key of ['fitScore','confidenceScore'] as const) {
    for (const invalid of [-0.1,100.1,NaN,Infinity,'90']) {
      assert.throws(() => validateIdeaRecord({ ...base(), [key]: invalid }), /Invalid idea score/);
    }
  }
  assert.equal(validateIdeaRecord({ ...base(), fitScore: 0, confidenceScore: 100 }).status,'PROPOSED');
});

test('ISO validation rejects impossible calendars and clock fields, preserving valid source text', () => {
  for(const invalid of ['2026-02-30T03:04:05Z','2026-04-31T03:04:05Z','2025-02-29T03:04:05Z',
    '2026-01-01T24:04:05Z','2026-01-01T03:60:05Z','2026-01-01T03:04:60Z']) {
    assert.throws(() => validateIdeaTimestamp(invalid));
    assert.throws(() => validateIdeaRecord({ ...base(), createdAt: invalid }));
  }
  const valid='2024-02-29T23:59:59.00001+02:00';
  assert.equal(validateIdeaTimestamp(valid),valid);
  assert.equal(validateIdeaRecord({ ...base(), createdAt: valid }).createdAt,valid);
});

test('SENT_TO_HQ requires recorded approval and send timestamps in chronological order', () => {
  const sent = { ...base(), status: 'SENT_TO_HQ' as const,
    updatedAt: '2026-10-12T12:00:00Z', approvedAt: '2026-10-11T12:00:00Z', sentToHqAt: '2026-10-12T12:00:00Z' };
  assert.throws(() => validateIdeaRecord({ ...sent, approvedAt: undefined }), /chronology/);
  assert.throws(() => validateIdeaRecord({ ...sent, sentToHqAt: undefined }), /chronology/);
  assert.throws(() => validateIdeaRecord({ ...sent, sentToHqAt: '2026-10-11T11:59:59Z' }), /chronology/);
  assert.throws(() => validateIdeaRecord({ ...sent, approvedAt: '2026-10-09T12:00:00Z' }), /chronology/);
  assert.equal(validateIdeaRecord(sent).status, 'SENT_TO_HQ');
  assert.throws(() => createIdeaHandoff({ ...sent, approvedAt: undefined }), /chronology/);
  assert.equal(createIdeaHandoff(sent).sentAt, sent.sentToHqAt);
});

for (const status of ['ARCHIVED', 'REJECTED', 'PROPOSED', 'UNDER_REVIEW', 'APPROVED_FOR_HQ'] as const) {
  test(`${status} rejects sentToHqAt even when its timestamps are coherent`, () => {
    const idea = { ...base(), status, updatedAt: '2026-10-12T12:00:00Z',
      approvedAt: '2026-10-11T12:00:00Z', sentToHqAt: '2026-10-12T12:00:00Z' };
    assert.throws(() => validateIdeaRecord(idea), /chronology/);
  });
}

test('approved ideas can have approval metadata without send metadata; sent ideas require both', () => {
  const approved = { ...base(), status: 'APPROVED_FOR_HQ' as const,
    updatedAt: '2026-10-11T12:00:00Z', approvedAt: '2026-10-11T12:00:00Z' };
  assert.equal(validateIdeaRecord(approved).sentToHqAt, undefined);
  const sent = { ...approved, status: 'SENT_TO_HQ' as const,
    updatedAt: '2026-10-12T12:00:00Z', sentToHqAt: '2026-10-12T12:00:00Z' };
  assert.equal(validateIdeaRecord(sent).sentToHqAt, sent.sentToHqAt);
});

for (const status of ['PROPOSED', 'UNDER_REVIEW', 'REJECTED'] as const) {
  test(`${status} rejects approvedAt even when its timestamp is coherent`, () => {
    assert.throws(() => validateIdeaRecord({ ...base(), status,
      updatedAt: '2026-10-11T12:00:00Z', approvedAt: '2026-10-11T12:00:00Z' }), /chronology/);
  });
}

test('legitimate review, approval, send, rejection and archive paths retain valid metadata', () => {
  const reviewing = transitionIdea(base(), 'UNDER_REVIEW', '2026-10-11T00:00:00Z');
  const approved = transitionIdea(reviewing, 'APPROVED_FOR_HQ', '2026-10-11T01:00:00Z');
  const sent = transitionIdea(approved, 'SENT_TO_HQ', '2026-10-11T02:00:00Z');
  assert.equal(validateIdeaRecord(approved).approvedAt, approved.updatedAt);
  assert.equal(validateIdeaRecord(sent).sentToHqAt, sent.updatedAt);
  const archivedApproved = transitionIdea(approved, 'ARCHIVED', '2026-10-11T02:00:00Z');
  assert.equal(validateIdeaRecord(archivedApproved).approvedAt, approved.approvedAt);
  assert.equal(archivedApproved.sentToHqAt, undefined);
  const rejected = transitionIdea(reviewing, 'REJECTED', '2026-10-11T01:00:00Z');
  const archivedRejected = transitionIdea(rejected, 'ARCHIVED', '2026-10-11T02:00:00Z');
  const archivedReview = transitionIdea(reviewing, 'ARCHIVED', '2026-10-11T01:00:00Z');
  assert.equal(validateIdeaRecord(archivedRejected).approvedAt, undefined);
  assert.equal(validateIdeaRecord(archivedReview).approvedAt, undefined);
});

test('record validation rejects incoherent history even outside SENT_TO_HQ', () => {
  assert.throws(() => validateIdeaRecord({ ...base(), updatedAt: '2026-10-09T00:00:00Z' }), /chronology/);
  assert.throws(() => validateIdeaRecord({ ...base(), status: 'APPROVED_FOR_HQ' }), /chronology/);
  assert.throws(() => validateIdeaRecord({ ...base(), sentToHqAt: base().updatedAt }), /chronology/);
  assert.throws(() => validateIdeaRecord({ ...base(), approvedAt: '2026-10-11T00:00:00Z' }), /chronology/);
  assert.throws(() => validateIdeaRecord({ ...base(), approvedAt: base().createdAt,
    sentToHqAt: '2026-10-11T00:00:00Z' }), /chronology/);
});

test('transitions cannot predate createdAt or updatedAt, including approval', () => {
  const reviewing = transitionIdea(base(), 'UNDER_REVIEW', '2026-10-11T00:00:00Z');
  assert.throws(() => transitionIdea(base(), 'UNDER_REVIEW', '2026-10-09T00:00:00Z'), /chronology/);
  assert.throws(() => transitionIdea(reviewing, 'REJECTED', '2026-10-10T12:00:00Z'), /chronology/);
  assert.throws(() => transitionIdea(reviewing, 'APPROVED_FOR_HQ', '2026-10-10T12:00:00Z'), /chronology/);
  const approved = transitionIdea(reviewing, 'APPROVED_FOR_HQ', '2026-10-11T01:00:00Z');
  assert.throws(() => transitionIdea(approved, 'SENT_TO_HQ', '2026-10-11T00:59:59Z'), /chronology/);
  assert.equal(transitionIdea(approved, 'SENT_TO_HQ', approved.approvedAt!).sentToHqAt, approved.approvedAt);
  assert.equal(transitionIdea(base(), 'UNDER_REVIEW', base().updatedAt).updatedAt, base().updatedAt);
});

test('chronology compares full fractional precision and equivalent offset instants', () => {
  const instant = '2026-10-10T10:00:00.0009Z';
  assert.throws(() => transitionIdea(base(), 'UNDER_REVIEW', '2026-10-10T10:00:00.0008Z'), /chronology/);
  assert.equal(transitionIdea(base(), 'UNDER_REVIEW', '2026-10-10T12:00:00.0009+02:00').createdAt, instant);
});

test('idea collection rejects an oversized array before visiting any record', () => {
  const trap = { get id(): never { throw new Error('record was visited'); } };
  const oversized = Array.from({length:MAX_IDEAS+1},() => trap);
  assert.throws(() => validateIdeaCollection(oversized), /exceeds maximum/);
  const exact = Array.from({length:MAX_IDEAS},(_,index)=>({...base(),id:`IDEA-${String(index).padStart(3,'0')}`}));
  assert.equal(validateIdeaCollection(exact).length,MAX_IDEAS);
  assert.deepEqual(validateIdeaCollection([]),[]);
});

test('idea collection rejects leading and middle holes before mapping records', () => {
  assert.throws(() => validateIdeaCollection(Array(1)), /Invalid idea collection/);
  assert.throws(() => validateIdeaCollection([base(), , { ...base(), id: 'IDEA-TEST-002' }]), /Invalid idea collection/);
  assert.equal(validateIdeaCollection([base()]).length, 1);
});

const nestedSparseCases = [
  { field: 'evidence', first: base().evidence[0], second: { ...base().evidence[0], id: 'EV-TEST-002' } },
  { field: 'tags', first: 'a', second: 'b' },
  { field: 'suggestedChannels', first: 'INSTAGRAM_FEED', second: 'TEASER' },
  { field: 'relatedCampaignIds', first: 'CAMPAIGN-A', second: 'CAMPAIGN-B' },
] as const;
for (const { field, first, second } of nestedSparseCases) {
  test(`${field} rejects leading and middle holes but accepts dense arrays`, () => {
    assert.throws(() => validateIdeaRecord({ ...base(), [field]: Array(1) }), /Invalid idea collection/);
    assert.throws(() => validateIdeaRecord({ ...base(), [field]: [first, , second] }), /Invalid idea collection/);
    assert.equal((validateIdeaRecord({ ...base(), [field]: [first, second] })[field] ?? []).length, 2);
  });
}

test('inherited array indices cannot stand in for own entries', () => {
  const inherited = Array(1);
  const prototype = Object.create(Array.prototype) as unknown[];
  prototype[0] = 'inherited';
  Object.setPrototypeOf(inherited, prototype);
  assert.equal(0 in inherited, true);
  assert.equal(Object.hasOwn(inherited, 0), false);
  assert.throws(() => validateIdeaRecord({ ...base(), tags: inherited }), /Invalid idea collection/);
});

test('input-owned array methods cannot bypass element validation', () => {
  const records = [base()];
  Object.defineProperty(records, 'map', { value: () => [] });
  assert.equal(validateIdeaCollection(records).length, 1);
  const tags = ['ok'];
  Object.defineProperty(tags, 'map', { value: () => [] });
  assert.deepEqual(validateIdeaRecord({ ...base(), tags }).tags, ['ok']);
});

test('null, undefined and duplicate nested values remain invalid', () => {
  for (const entry of [null, undefined]) {
    assert.throws(() => validateIdeaCollection([entry]));
    for (const field of ['evidence', 'tags', 'suggestedChannels', 'relatedCampaignIds']) {
      assert.throws(() => validateIdeaRecord({ ...base(), [field]: [entry] }));
    }
  }
  assert.throws(() => validateIdeaRecord({ ...base(), tags: ['same', 'same'] }), /Duplicate idea value/);
  assert.throws(() => validateIdeaRecord({ ...base(), suggestedChannels: ['TEASER', 'TEASER'] }), /Duplicate idea value/);
  assert.throws(() => validateIdeaRecord({ ...base(), relatedCampaignIds: ['CAMPAIGN-A', 'CAMPAIGN-A'] }), /Duplicate idea value/);
});

test('handoff cannot emit sparse evidenceRefs from a validated idea', () => {
  const reviewing = transitionIdea(base(), 'UNDER_REVIEW', '2026-10-11T00:00:00Z');
  const approved = transitionIdea(reviewing, 'APPROVED_FOR_HQ', '2026-10-11T01:00:00Z');
  const sent = transitionIdea(approved, 'SENT_TO_HQ', '2026-10-11T02:00:00Z');
  assert.throws(() => createIdeaHandoff({ ...sent, evidence: Array(1) }), /Invalid idea collection/);
  const second = { ...base().evidence[0], id: 'EV-TEST-002' };
  const refs = createIdeaHandoff({ ...sent, evidence: [base().evidence[0], second] }).evidenceRefs;
  assert.deepEqual(refs, ['EV-TEST-001', 'EV-TEST-002']);
  for (let index = 0; index < refs.length; index++) assert.equal(Object.hasOwn(refs, index), true);
});

test('title, summary and reason enforce documented length limits', () => {
  assert.throws(() => validateIdeaRecord({...base(),title:'x'.repeat(MAX_TITLE_LENGTH+1)}));
  assert.throws(() => validateIdeaRecord({...base(),summary:'x'.repeat(MAX_SUMMARY_LENGTH+1)}));
  assert.throws(() => validateIdeaRecord({...base(),reason:'x'.repeat(MAX_REASON_LENGTH+1)}));
  assert.equal(validateIdeaRecord({...base(),title:'x'.repeat(MAX_TITLE_LENGTH)}).title.length,MAX_TITLE_LENGTH);
});

test('nested collections reject overflow before mapping their entries', () => {
  const trap = { get id(): never { throw new Error('evidence was visited'); } };
  assert.throws(() => validateIdeaRecord({...base(),evidence:Array(MAX_EVIDENCE_PER_IDEA+1).fill(trap)}),/exceeds maximum/);
  assert.throws(() => validateIdeaRecord({...base(),tags:Array(MAX_TAGS+1).fill('tag')}),/exceeds maximum/);
  assert.throws(() => validateIdeaRecord({...base(),suggestedChannels:Array(MAX_CHANNELS+1).fill('TEASER')}),/exceeds maximum/);
  assert.throws(() => validateIdeaRecord({...base(),relatedCampaignIds:Array(MAX_RELATED_CAMPAIGNS+1).fill('CAMPAIGN-1')}),/exceeds maximum/);
  assert.equal(validateIdeaRecord({...base(),evidence:[],tags:[],suggestedChannels:[],relatedCampaignIds:[]}).evidence.length,0);
});

test('IDs cannot resolve inherited Object.prototype properties or collide within a collection', () => {
  for(const unsafe of ['constructor','prototype','__proto__','toString','valueOf','hasOwnProperty']) {
    assert.throws(() => validateIdeaRecord({...base(),id:unsafe}),/Invalid idea ID/);
    assert.throws(() => validateIdeaRecord({...base(),evidence:[{...base().evidence[0],id:unsafe}]}),/Invalid idea ID/);
  }
  assert.throws(() => validateIdeaCollection([base(),base()]),/Duplicate idea value/);
  assert.equal(getIdeaById([base()],'constructor'),undefined);
  assert.equal(Object.hasOwn(Object.prototype,'polluted'),false);
});

test('untrusted evidence stays inert and unknown source fields are never forwarded', () => {
  const input={...base(),unexpected:'ignore',evidence:[{...base().evidence[0],instructions:'publish now'}]};
  const result=validateIdeaRecord(input);
  assert.equal(Object.hasOwn(result,'unexpected'),false);
  assert.equal(Object.hasOwn(result.evidence[0],'instructions'),false);
  assert.equal(result.evidence[0].sourceRef,'mock:note:001');
});

test('only documented state transitions are allowed, including explicit HQ approval path', () => {
  const allowed: [IdeaStatus,IdeaStatus][]=[
    ['PROPOSED','UNDER_REVIEW'],['UNDER_REVIEW','APPROVED_FOR_HQ'],
    ['UNDER_REVIEW','REJECTED'],['UNDER_REVIEW','ARCHIVED'],
    ['APPROVED_FOR_HQ','SENT_TO_HQ'],['APPROVED_FOR_HQ','ARCHIVED'],['REJECTED','ARCHIVED'],
  ];
  for(const [from,to] of allowed) assert.equal(canTransitionIdea(from,to),true);
  for(const [from,to] of [['PROPOSED','SENT_TO_HQ'],['REJECTED','SENT_TO_HQ'],['ARCHIVED','SENT_TO_HQ']] as [IdeaStatus,IdeaStatus][]) {
    assert.equal(canTransitionIdea(from,to),false);
    assert.throws(() => transitionIdea({...base(),status:from,priority:'URGENT',fitScore:100,confidenceScore:100},to,'2026-10-11T00:00:00Z'));
  }
});

test('transitions use only explicit timestamps and urgent priority never bypasses review', t => {
  const clock=t.mock.method(Date,'now',()=>987654321);
  const proposed={...base(),priority:'URGENT' as const,fitScore:100,confidenceScore:100};
  const reviewing=transitionIdea(proposed,'UNDER_REVIEW','2026-10-11T00:00:00Z');
  const approved=transitionIdea(reviewing,'APPROVED_FOR_HQ','2026-10-11T01:00:00Z');
  const sent=transitionIdea(approved,'SENT_TO_HQ','2026-10-11T02:00:00Z');
  assert.equal(approved.approvedAt,'2026-10-11T01:00:00Z');
  assert.equal(sent.sentToHqAt,'2026-10-11T02:00:00Z');
  assert.equal(sent.status,'SENT_TO_HQ');
  assert.equal(clock.mock.callCount(),0);
  assert.deepEqual(sent,transitionIdea(transitionIdea(transitionIdea(proposed,'UNDER_REVIEW','2026-10-11T00:00:00Z'),
    'APPROVED_FOR_HQ','2026-10-11T01:00:00Z'),'SENT_TO_HQ','2026-10-11T02:00:00Z'));
});

test('selectors produce stable counts, filtering, safe lookup and priority order', () => {
  const ideas=loadMockIdeaCenter().ideas;
  assert.deepEqual(summarizeIdeas(ideas),{
    totalIdeas:7, proposedCount:2, underReviewCount:2, approvedForHqCount:1,
    sentToHqCount:0, rejectedCount:1, archivedCount:1,
  });
  assert.equal(getIdeaById(ideas,'IDEA-GAMING-HORROR')?.id,'IDEA-GAMING-HORROR');
  assert.deepEqual(getIdeasByStatus(ideas,'PROPOSED'),getIdeasByStatus([...ideas].reverse(),'PROPOSED'));
  assert.deepEqual(getIdeasBySource(ideas,'TREND_RADAR'),getIdeasBySource([...ideas].reverse(),'TREND_RADAR'));
  assert.deepEqual(getIdeasSortedByPriority(ideas),getIdeasSortedByPriority([...ideas].reverse()));
  assert.equal(getIdeasSortedByPriority(ideas)[0].priority,'URGENT');
  assert.equal(ideas.length,7,'selectors never mutate the source');
});

test('MOCK fixture is explicitly labeled, fresh and deterministic across resets', () => {
  const first=loadMockIdeaCenter(),second=loadMockIdeaCenter();
  assert.equal(first.mode,'MOCK');
  assert.deepEqual(first,second);
  assert.notEqual(first.ideas,second.ideas);
  assert.deepEqual(validateIdeaCollection([...first.ideas].reverse()),first.ideas);
  assert.deepEqual(new Set(first.ideas.map(idea=>idea.source)),
    new Set(['TREND_RADAR','EDITORIAL_CALENDAR','ANALYTICS','MANUAL_LUIS','EXTERNAL_SIGNAL','SUPERMEMORY_INSIGHT']));
});

test('handoff carries only proposal data and never creates a Campaign', () => {
  const approved=getIdeaById(loadMockIdeaCenter().ideas,'IDEA-APPROVED-001')!;
  assert.throws(()=>createIdeaHandoff(approved));
  const sent=transitionIdea(approved,'SENT_TO_HQ','2026-10-12T12:00:00Z');
  const handoff=createIdeaHandoff(sent);
  assert.deepEqual(Object.keys(handoff).sort(),[
    'ideaId','title','summary','reason','source','priority','suggestedChannels',
    'fitScore','confidenceScore','evidenceRefs','sentAt',
  ].sort());
  assert.equal(handoff.ideaId,approved.id);
  assert.equal(handoff.sentAt,'2026-10-12T12:00:00Z');
  assert.deepEqual(handoff.evidenceRefs,['EV-EXTERNAL-01']);
  assert.equal(Object.hasOwn(handoff,'campaignId'),false);
  assert.equal(Object.hasOwn(handoff,'status'),false);
});
