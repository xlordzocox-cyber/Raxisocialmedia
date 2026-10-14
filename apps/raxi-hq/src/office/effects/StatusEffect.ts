import { Container, Graphics, Text, TextStyle } from 'pixi.js';

export class StatusEffect extends Container {
  private age = 0;
  private readonly duration = 1100;

  constructor(label: string, color: number) {
    super();
    const bg = new Graphics();
    bg.beginFill(color, 0.95);
    bg.drawRoundedRect(-36, -12, 72, 24, 12);
    bg.endFill();
    const text = new Text(label, new TextStyle({
      fill: '#090b12',
      fontFamily: 'Inter, Segoe UI, sans-serif',
      fontSize: 10,
      fontWeight: '800',
    }));
    text.anchor.set(0.5);
    this.addChild(bg, text);
  }

  update(deltaMs: number): boolean {
    this.age += deltaMs;
    const p = Math.min(1, this.age / this.duration);
    this.y -= deltaMs * 0.02;
    this.alpha = 1 - p;
    return p >= 1;
  }
}
