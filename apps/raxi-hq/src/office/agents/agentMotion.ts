import type { AgentSnapshot, ZoneId } from '../../domain/agents';
import { routeBetweenZones } from '../pathfinding';
import { zones, type Point } from '../zones';

/** Coordinates change only in response to a snapshot destination, never randomly. */
export class AgentMotion {
  position: Point;
  private route: Point[] = [];
  private zone: ZoneId;
  private goal: ZoneId;
  private blocked = false;

  constructor(agent: AgentSnapshot, public slot: number) {
    this.zone = this.goal = agent.zone;
    this.position = this.stationPoint(agent.zone);
  }

  stationPoint(zone: ZoneId): Point {
    const points = zones[zone].workPoints;
    const point = points[this.slot % points.length];
    const row = Math.floor(this.slot / points.length) % 2;
    return { x: point.x + row * 26, y: point.y + row * 32 };
  }

  setSlot(slot: number): void {
    if (slot === this.slot) return;
    this.slot = slot;
    const station = this.stationPoint(this.goal);
    if (this.route.length) this.route[this.route.length - 1] = station;
    else if (this.position.x !== station.x || this.position.y !== station.y) this.route = [station];
  }

  sync(agent: AgentSnapshot): void {
    this.blocked = ['BLOCKED', 'FAILED', 'QUARANTINED'].includes(agent.status);
    const destination = agent.destinationZone ?? agent.zone;
    if (destination === this.goal) return;
    this.goal = destination;
    this.route = routeBetweenZones(this.zone, destination).map((point) => ({ ...point }));
    this.route[this.route.length - 1] = this.stationPoint(destination);
  }

  get walking(): boolean { return !this.blocked && this.route.length > 0; }
  atStation(zone: ZoneId): boolean {
    const point = this.stationPoint(zone);
    return !this.walking && this.position.x === point.x && this.position.y === point.y;
  }

  update(deltaMs: number): void {
    if (this.blocked) return;
    let distance = Math.max(0, deltaMs) * 0.18;
    while (distance > 0 && this.route.length > 0) {
      const next = this.route[0];
      const length = Math.hypot(next.x - this.position.x, next.y - this.position.y);
      if (length <= distance) {
        this.position = { ...next };
        distance -= length;
        this.route.shift();
      } else {
        this.position.x += (next.x - this.position.x) / length * distance;
        this.position.y += (next.y - this.position.y) / length * distance;
        distance = 0;
      }
    }
    if (this.route.length === 0) this.zone = this.goal;
  }
}

/** Keep existing motions while reconciling every station slot on each roster refresh. */
export function syncAgentMotions(agents: readonly AgentSnapshot[], motions: Map<string, AgentMotion>, sortById: boolean): AgentSnapshot[] {
  const ordered = sortById ? [...agents].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : [...agents];
  const active = new Set(ordered.map(agent => agent.id));
  for (const id of motions.keys()) if (!active.has(id)) motions.delete(id);
  const zoneSlots = new Map<ZoneId, number>();
  for (const agent of ordered) {
    const slot = zoneSlots.get(agent.zone) ?? 0;
    zoneSlots.set(agent.zone, slot + 1);
    let motion = motions.get(agent.id);
    if (!motion) {
      motion = new AgentMotion(agent, slot);
      motions.set(agent.id, motion);
    } else motion.setSlot(slot);
    motion.sync(agent);
  }
  return ordered;
}
