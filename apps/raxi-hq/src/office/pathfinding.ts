import type { ZoneId } from '../domain/agents';
import { zones, type Point } from './zones';

const graph: Record<ZoneId, ZoneId[]> = {
  SUPERMEMORY_CORE: ['WAR_ROOM'],
  RESEARCH_LAB: ['WAR_ROOM', 'QA_LAB'],
  WAR_ROOM: ['SUPERMEMORY_CORE', 'RESEARCH_LAB', 'ARIA_LINK', 'GITHUB_HUB'],
  ARIA_LINK: ['WAR_ROOM', 'PUBLISHING'],
  QA_LAB: ['RESEARCH_LAB', 'GITHUB_HUB'],
  GITHUB_HUB: ['WAR_ROOM', 'QA_LAB', 'PUBLISHING'],
  PUBLISHING: ['ARIA_LINK', 'GITHUB_HUB'],
};

export function routeBetweenZones(from: ZoneId, to: ZoneId): Point[] {
  if (from === to) {
    return [zones[to].workPoints[0]];
  }

  const queue: ZoneId[][] = [[from]];
  const visited = new Set<ZoneId>([from]);
  while (queue.length > 0) {
    const path = queue.shift() as ZoneId[];
    const last = path[path.length - 1];
    for (const next of graph[last]) {
      if (visited.has(next)) {
        continue;
      }
      const nextPath = [...path, next];
      if (next === to) {
        return zonesToPoints(nextPath);
      }
      visited.add(next);
      queue.push(nextPath);
    }
  }

  return [zones[to].entrances[0], zones[to].workPoints[0]];
}

function zonesToPoints(path: ZoneId[]): Point[] {
  const points: Point[] = [];
  for (const zoneId of path.slice(1)) {
    points.push(zones[zoneId].entrances[0]);
  }
  points.push(zones[path[path.length - 1]].workPoints[0]);
  return points;
}
