import type { ZoneId } from '../domain/agents';

export interface Point {
  x: number;
  y: number;
}

export interface Zone {
  id: ZoneId;
  label: string;
  system: string;
  anchor: Point;
  workPoints: Point[];
  waitingPoints: Point[];
  entrances: Point[];
  accent: number;
}

export const zones: Record<ZoneId, Zone> = {
  SUPERMEMORY_CORE: {
    id: 'SUPERMEMORY_CORE',
    label: 'Supermemory Core',
    system: 'memory',
    anchor: { x: 520, y: 60 },
    workPoints: [{ x: 520, y: 108 }],
    waitingPoints: [{ x: 470, y: 122 }],
    entrances: [{ x: 520, y: 150 }],
    accent: 0xb68cff,
  },
  RESEARCH_LAB: {
    id: 'RESEARCH_LAB',
    label: 'Research Lab',
    system: 'insights',
    anchor: { x: 260, y: 220 },
    workPoints: [{ x: 230, y: 242 }, { x: 284, y: 254 }],
    waitingPoints: [{ x: 320, y: 260 }],
    entrances: [{ x: 335, y: 252 }],
    accent: 0x35e7ff,
  },
  WAR_ROOM: {
    id: 'WAR_ROOM',
    label: 'War Room',
    system: 'campaign',
    anchor: { x: 520, y: 220 },
    workPoints: [{ x: 488, y: 242 }, { x: 550, y: 250 }],
    waitingPoints: [{ x: 520, y: 292 }],
    entrances: [{ x: 520, y: 292 }],
    accent: 0xffffff,
  },
  ARIA_LINK: {
    id: 'ARIA_LINK',
    label: 'Aria Link',
    system: 'visual production',
    anchor: { x: 780, y: 220 },
    workPoints: [{ x: 748, y: 250 }, { x: 810, y: 250 }],
    waitingPoints: [{ x: 720, y: 284 }],
    entrances: [{ x: 705, y: 252 }],
    accent: 0xff8bd1,
  },
  QA_LAB: {
    id: 'QA_LAB',
    label: 'QA Lab',
    system: 'quality',
    anchor: { x: 260, y: 430 },
    workPoints: [{ x: 230, y: 455 }, { x: 286, y: 462 }],
    waitingPoints: [{ x: 320, y: 462 }],
    entrances: [{ x: 335, y: 448 }],
    accent: 0x5be39a,
  },
  GITHUB_HUB: {
    id: 'GITHUB_HUB',
    label: 'GitHub Hub',
    system: 'canonical repo',
    anchor: { x: 520, y: 430 },
    workPoints: [{ x: 488, y: 455 }, { x: 550, y: 462 }],
    waitingPoints: [{ x: 520, y: 500 }],
    entrances: [{ x: 520, y: 500 }],
    accent: 0xffc857,
  },
  PUBLISHING: {
    id: 'PUBLISHING',
    label: 'Publishing',
    system: 'planner',
    anchor: { x: 780, y: 430 },
    workPoints: [{ x: 750, y: 455 }, { x: 812, y: 462 }],
    waitingPoints: [{ x: 720, y: 462 }],
    entrances: [{ x: 705, y: 448 }],
    accent: 0x8cb7ff,
  },
};

export const zoneOrder: ZoneId[] = [
  'SUPERMEMORY_CORE',
  'RESEARCH_LAB',
  'WAR_ROOM',
  'ARIA_LINK',
  'QA_LAB',
  'GITHUB_HUB',
  'PUBLISHING',
];

export function stationCapacity(zone: ZoneId): number {
  return zone === 'SUPERMEMORY_CORE' ? 2 : 4;
}
