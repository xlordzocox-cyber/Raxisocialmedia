import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import type { Point } from '../zones';
import { memoryFrame } from './visualTimelines';

/** Mock archive signal, followed by a receiving and indexing pulse at the Core. */
export class MemoryArchiveEffect extends Container {
  private signal = new Graphics();
  private coreRing = new Graphics();
  private caption = new Text('', new TextStyle({ fill: 0xd8c8ff, fontFamily: 'Segoe UI, sans-serif', fontSize: 10, fontWeight: '700', stroke: 0x090d18, strokeThickness: 3 }));
  private age = 0;

  constructor(private readonly from: Point, private readonly core: Point) {
    super();
    this.signal.beginFill(0xe9d9ff).drawCircle(0, 0, 5).endFill();
    this.signal.lineStyle(2, 0xb68cff, 0.8).drawCircle(0, 0, 10);
    this.caption.anchor.set(0.5); this.caption.position.set(core.x, core.y - 112);
    this.addChild(this.coreRing, this.signal, this.caption);
  }

  get frame() { return memoryFrame(this.age, this.from, this.core); }

  update(deltaMs: number): boolean {
    this.age += Math.max(0, deltaMs);
    const frame = this.frame;
    this.signal.position.set(frame.signal.x, frame.signal.y);
    this.signal.alpha = frame.signal.alpha;
    this.caption.text = frame.phase === 'receiving' ? 'RECEIVING' : frame.phase === 'indexing' ? 'INDEXING' : '';
    this.coreRing.clear();
    if (frame.phase === 'receiving' || frame.phase === 'indexing') {
      const radius = 17 + frame.pulse * 42;
      this.coreRing.lineStyle(3, 0xb68cff, 0.85 - frame.pulse * 0.6).drawEllipse(this.core.x, this.core.y + 10, radius, radius * 0.48);
      this.coreRing.beginFill(0x35e7ff, 0.17 * (1 - frame.pulse)).drawEllipse(this.core.x, this.core.y + 10, radius * 0.68, radius * 0.3).endFill();
    }
    return frame.phase === 'done';
  }
}
