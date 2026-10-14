import { Container, Graphics } from 'pixi.js';
import type { Point } from '../zones';
import { handoffFrame } from './visualTimelines';

/** Visual-only handoff started by a mock event. Endpoints are captured from agent positions. */
export class HandoffEffect extends Container {
  private packet = new Graphics();
  private glow = new Graphics();
  private halo = new Graphics();
  private trail = new Graphics();
  private age = 0;

  constructor(readonly senderId: string, readonly receiverId: string, private readonly from: Point, private readonly to: Point) {
    super();
    this.packet.beginFill(0xf5fbff).drawRoundedRect(-9, -7, 18, 14, 2).endFill();
    this.packet.lineStyle(2, 0x35e7ff).drawRoundedRect(-9, -7, 18, 14, 2);
    this.packet.lineStyle(1, 0xb68cff).moveTo(-7, -4).lineTo(0, 1).lineTo(7, -4);
    this.halo.lineStyle(2, 0xb68cff, 0.65).drawCircle(0, 0, 15);
    this.addChild(this.trail, this.glow, this.halo, this.packet);
  }

  get frame() { return handoffFrame(this.age, this.from, this.to); }

  update(deltaMs: number): boolean {
    this.age += Math.max(0, deltaMs);
    const frame = this.frame;
    this.position.set(frame.packet.x, frame.packet.y);
    this.packet.alpha = frame.packet.alpha;
    this.halo.alpha = frame.packet.alpha * (0.6 + Math.sin(this.age / 90) * 0.2);
    this.glow.clear();
    if (frame.phase === 'transfer') {
      const pulse = 0.13 + (Math.sin(this.age / 95) + 1) * 0.045;
      this.glow.beginFill(0x35e7ff, pulse).drawCircle(0, 0, 19).endFill();
    }
    this.trail.clear();
    if (frame.phase === 'transfer') {
      this.trail.lineStyle(2, 0x35e7ff, 0.28).moveTo(this.from.x - this.x, this.from.y - 48 - this.y).lineTo(0, 0);
    }
    return frame.phase === 'done';
  }
}
