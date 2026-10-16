import type { IdeaRecord } from './ideaContracts';
import { validateIdeaCollection } from './ideaValidation';

// Development examples only. Source labels here do not imply connected integrations.
const records: IdeaRecord[] = [
  {
    id: 'IDEA-GAMING-HORROR', title: 'Noche de juegos de terror',
    summary: 'Propuesta de conversación gamer alrededor de juegos de terror y reacciones de Raxi.',
    source: 'TREND_RADAR', status: 'PROPOSED', priority: 'HIGH',
    createdAt: '2026-10-10T10:00:00Z', updatedAt: '2026-10-10T10:00:00Z',
    reason: 'Encaja con la personalidad gamer; requiere evaluación editorial antes de llegar a HQ.',
    suggestedChannels: ['INSTAGRAM_REEL', 'INSTAGRAM_STORY'], tags: ['gaming', 'terror'],
    fitScore: 88, confidenceScore: 68,
    evidence: [{ id: 'EV-GAMING-01', kind: 'TREND', label: 'Señal de interés gamer simulada', sourceRef: 'mock:trend:gaming' }],
  },
  {
    id: 'IDEA-HALLOWEEN', title: 'Momento de calendario de Halloween',
    summary: 'Explorar una propuesta temática para el calendario editorial de octubre.',
    source: 'EDITORIAL_CALENDAR', status: 'UNDER_REVIEW', priority: 'HIGH',
    createdAt: '2026-10-10T11:00:00Z', updatedAt: '2026-10-10T12:00:00Z',
    reason: 'La oportunidad temporal requiere revisar encaje, tono y capacidad de producción.',
    suggestedChannels: ['INSTAGRAM_FEED', 'TEASER'], tags: ['calendario', 'octubre'],
    fitScore: 82, confidenceScore: 74,
    evidence: [{ id: 'EV-CALENDAR-01', kind: 'CALENDAR', label: 'Hito editorial mock', capturedAt: '2026-10-10T11:00:00Z' }],
  },
  {
    id: 'IDEA-ANALYTICS-GAMER', title: 'Preguntas de la comunidad gamer',
    summary: 'Revisar si una serie de preguntas sobre juegos merece pasar a planificación.',
    source: 'ANALYTICS', status: 'UNDER_REVIEW', priority: 'MEDIUM',
    createdAt: '2026-10-10T13:00:00Z', updatedAt: '2026-10-10T14:00:00Z',
    reason: 'La señal simulada sugiere interés, pero la evidencia todavía es limitada.',
    suggestedChannels: ['INSTAGRAM_STORY', 'FANVIEW_CHAT'], tags: ['comunidad', 'gaming'],
    fitScore: 76, confidenceScore: 55,
    evidence: [{ id: 'EV-ANALYTICS-01', kind: 'ANALYTICS', label: 'Resumen de interacción mock' }],
  },
  {
    id: 'IDEA-MANUAL-001', title: 'Idea manual reservada para Luis',
    summary: 'Ejemplo ficticio de fuente manual; no es una idea capturada por Luis.',
    source: 'MANUAL_LUIS', status: 'PROPOSED', priority: 'LOW',
    createdAt: '2026-10-10T15:00:00Z', updatedAt: '2026-10-10T15:00:00Z',
    reason: 'Permite probar la fuente manual sin atribuir una propuesta real a Luis.',
    suggestedChannels: ['INSTAGRAM_FEED'], tags: ['manual', 'mock'],
    fitScore: 60, confidenceScore: 40,
    evidence: [{ id: 'EV-MANUAL-01', kind: 'MANUAL_NOTE', label: 'Nota de ejemplo, no enviada por Luis' }],
  },
  {
    id: 'IDEA-APPROVED-001', title: 'Serie de momentos detrás de escena',
    summary: 'Propuesta evaluada internamente para que HQ considere una posible campaña.',
    source: 'EXTERNAL_SIGNAL', status: 'APPROVED_FOR_HQ', priority: 'URGENT',
    createdAt: '2026-10-10T16:00:00Z', updatedAt: '2026-10-10T18:00:00Z',
    reason: 'Buen encaje editorial mock; la urgencia no reemplaza la decisión final de HQ.',
    suggestedChannels: ['INSTAGRAM_STORY', 'TEASER'], tags: ['presencia', 'propuesta'],
    fitScore: 91, confidenceScore: 79,
    evidence: [{ id: 'EV-EXTERNAL-01', kind: 'EXTERNAL_REFERENCE', label: 'Referencia opaca simulada', sourceRef: 'mock:external:001' }],
    approvedAt: '2026-10-10T18:00:00Z',
  },
  {
    id: 'IDEA-REJECTED-001', title: 'Repetir una propuesta agotada',
    summary: 'Ejemplo rechazado tras la revisión interna.',
    source: 'SUPERMEMORY_INSIGHT', status: 'REJECTED', priority: 'MEDIUM',
    createdAt: '2026-10-10T19:00:00Z', updatedAt: '2026-10-10T20:00:00Z',
    reason: 'La evidencia mock no justifica avanzar; Supermemory no está conectado.',
    suggestedChannels: ['FANVIEW_FEED'], tags: ['descartada'],
    fitScore: 35, confidenceScore: 30,
    evidence: [{ id: 'EV-MEMORY-01', kind: 'MEMORY', label: 'Insight de ejemplo sin lectura real' }],
  },
  {
    id: 'IDEA-ARCHIVED-001', title: 'Variación duplicada de terror gamer',
    summary: 'Ejemplo conservado como referencia, sin actividad vigente.',
    source: 'TREND_RADAR', status: 'ARCHIVED', priority: 'LOW',
    createdAt: '2026-10-10T21:00:00Z', updatedAt: '2026-10-10T22:00:00Z',
    reason: 'Se archiva por solapamiento con otra propuesta mock.',
    suggestedChannels: ['INSTAGRAM_REEL'], tags: ['archivo', 'gaming'],
    fitScore: 54, confidenceScore: 60, evidence: [], duplicateOfIdeaId: 'IDEA-GAMING-HORROR',
  },
];

/** A fresh deterministic snapshot for tests and local development; never LIVE. */
export function loadMockIdeaCenter(): { mode: 'MOCK'; ideas: IdeaRecord[] } {
  return { mode: 'MOCK', ideas: validateIdeaCollection(records) };
}
