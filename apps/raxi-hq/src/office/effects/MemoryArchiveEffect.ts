import { Container, Graphics } from 'pixi.js';
import type { Point } from '../zones';

export class MemoryArchiveEffect extends Container {
  private ring = new Graphics();
  private pulse = new Graphics();
  private age = 0;
  private readonly duration = 2200;

  constructor(anchor: Point) {
    super();
    this.position.set(anchor.x, anchor.y);
    this.addChild(this.ring, this.pulse);
  }

  update(deltaMs: number): boolean {
    this.age += deltaMs;
    const p = Math.min(1, this.age / this.duration);
    this.ring.clear();
    this.ring.lineStyle(3, 0xb68cff, 1 - p);
    this.ring.drawEllipse(0, 8, 26 + p * 58, 13 + p * 29);

    this.pulse.clear();
    this.pulse.beginFill(0x35e7ff, 0.28 * (1 - p));
    this.pulse.drawEllipse(0, 8, 16 + Math.sin(p * Math.PI) * 20, 8 + Math.sin(p * Math.PI) * 10);
    this.pulse.endFill();
    return p >= 1;
  }
}
