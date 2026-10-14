import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import type { Point } from '../zones';

export class HandoffEffect extends Container {
  private packet = new Graphics();
  private label: Text;
  private age = 0;
  private readonly duration = 1500;

  constructor(
    private readonly from: Point,
    private readonly to: Point,
    label: string,
  ) {
    super();
    this.label = new Text(label, new TextStyle({
      fill: '#f4f7ff',
      fontFamily: 'Inter, Segoe UI, sans-serif',
      fontSize: 10,
      fontWeight: '700',
    }));
    this.label.anchor.set(0.5);
    this.packet.beginFill(0x35e7ff, 0.92);
    this.packet.lineStyle(2, 0xb68cff, 0.8);
    this.packet.drawRoundedRect(-12, -8, 24, 16, 4);
    this.packet.endFill();
    this.addChild(this.packet, this.label);
    this.position.set(from.x, from.y - 40);
  }

  update(deltaMs: number): boolean {
    this.age += deltaMs;
    const p = Math.min(1, this.age / this.duration);
    const eased = 1 - Math.pow(1 - p, 3);
    this.position.set(
      this.from.x + (this.to.x - this.from.x) * eased,
      this.from.y - 40 + (this.to.y - this.from.y) * eased - Math.sin(p * Math.PI) * 44,
    );
    this.alpha = 1 - Math.max(0, p - 0.72) / 0.28;
    this.label.position.set(0, -18);
    return p >= 1;
  }
}
