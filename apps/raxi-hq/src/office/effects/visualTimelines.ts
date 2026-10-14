import type { Point } from '../zones';

export type HandoffPhase = 'approach' | 'transfer' | 'resume' | 'done';
export type MemoryPhase = 'travel' | 'receiving' | 'indexing' | 'done';

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const mix = (a: number, b: number, p: number): number => a + (b - a) * p;

/** A short, event-triggered animation. It has no clock or randomness of its own. */
export function handoffFrame(ageMs: number, from: Point, to: Point) {
  const p = clamp01(ageMs / 1900);
  const phase: HandoffPhase = p < 0.28 ? 'approach' : p < 0.76 ? 'transfer' : p < 1 ? 'resume' : 'done';
  const direction = { x: to.x - from.x, y: to.y - from.y };
  const length = Math.max(1, Math.hypot(direction.x, direction.y));
  const reach = Math.min(22, length * 0.23);
  const approach = phase === 'approach' ? p / 0.28 : phase === 'resume' ? (1 - p) / 0.24 : phase === 'done' ? 0 : 1;
  const senderOffset = { x: direction.x / length * reach * approach, y: direction.y / length * reach * approach };
  const receiverOffset = approach === 0 ? { x: 0, y: 0 } : { x: -senderOffset.x, y: -senderOffset.y };
  const transfer = clamp01((p - 0.28) / 0.48);
  return {
    phase, senderOffset, receiverOffset,
    packet: {
      x: mix(from.x + senderOffset.x, to.x + receiverOffset.x, transfer),
      y: mix(from.y + senderOffset.y, to.y + receiverOffset.y, transfer) - 55 - Math.sin(transfer * Math.PI) * 18,
      alpha: phase === 'approach' ? 0 : phase === 'resume' ? (1 - p) / 0.24 : phase === 'done' ? 0 : 1,
    },
  };
}

export function memoryFrame(ageMs: number, from: Point, to: Point) {
  const p = clamp01(ageMs / 2500);
  const phase: MemoryPhase = p < 0.54 ? 'travel' : p < 0.73 ? 'receiving' : p < 1 ? 'indexing' : 'done';
  const travel = clamp01(p / 0.54);
  return {
    phase,
    signal: {
      x: mix(from.x, to.x, travel),
      y: mix(from.y - 40, to.y - 43, travel) - (phase === 'travel' ? Math.sin(travel * Math.PI) * 35 : 0),
      alpha: phase === 'travel' ? 1 : 0,
    },
    pulse: phase === 'receiving' ? (p - 0.54) / 0.19 : phase === 'indexing' ? (p - 0.73) / 0.27 : 0,
  };
}
