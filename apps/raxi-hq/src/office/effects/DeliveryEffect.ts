import { Container, Graphics } from 'pixi.js';
import { routeBetweenZones } from '../pathfinding';
import type { ZoneId } from '../../domain/agents';
import type { Point } from '../zones';
import { deliveryFrame } from './visualTimelines';

/** Walking path from the sender's desk to a spot beside the receiver (same routing as agent motion). */
export function deliveryRoute(from: Point, to: Point, fromZone: ZoneId, toZone: ZoneId): Point[] {
  const middle = fromZone === toZone ? [] : routeBetweenZones(fromZone, toZone).slice(0, -1);
  const before = middle.length ? middle[middle.length - 1] : from;
  const dx = to.x - before.x, dy = to.y - before.y, len = Math.max(1, Math.hypot(dx, dy));
  const stop = { x: to.x - dx / len * 30, y: to.y - dy / len * 30 + 4 };
  return [{ ...from }, ...middle.map((p) => ({ ...p })), stop];
}

/** A verified runtime handoff shown as a person carrying a printed report to a colleague. */
export class DeliveryEffect extends Container {
  private sheets = new Graphics();
  private age = 0;
  constructor(readonly senderId: string, readonly receiverId: string, private readonly route: Point[], private readonly receiver: Point, readonly eventId: string) {
    super();
    const sheet = (dx: number, dy: number, rot: number) => {
      const g = new Graphics();
      g.lineStyle(1, 0x9aa7b8, 0.9).beginFill(0xfbfdff).drawRect(-6, -8, 12, 15).endFill();
      g.lineStyle(1, 0x7d8ba0, 0.8);
      for (const y of [-4, -1, 2]) g.moveTo(-4, y).lineTo(4, y);
      g.position.set(dx, dy); g.rotation = rot;
      return g;
    };
    this.sheets.addChild(sheet(-1.5, 1.5, -0.12), sheet(1, 0.5, 0.08), sheet(0, -0.5, -0.02));
    this.addChild(this.sheets);
  }
  get frame() { return deliveryFrame(this.age, this.route, this.receiver); }
  update(deltaMs: number): boolean {
    this.age += Math.max(0, deltaMs);
    const f = this.frame;
    this.position.set(f.papers.x, f.papers.y + f.bob);
    this.alpha = f.papers.alpha;
    this.zIndex = 10_000;
    return f.phase === 'done';
  }
}
