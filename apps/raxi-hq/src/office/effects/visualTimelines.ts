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

export type DeliveryPhase = 'walk' | 'give' | 'return' | 'done';
const WALK_SPEED = 0.13; // px per ms, a calm walking pace
const GIVE_MS = 1700;

function pointAlong(route: Point[], distance: number): Point {
  let left = Math.max(0, distance);
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1], b = route[i];
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (left <= seg) return seg === 0 ? { ...b } : { x: mix(a.x, b.x, left / seg), y: mix(a.y, b.y, left / seg) };
    left -= seg;
  }
  return { ...route[route.length - 1] };
}
export function routeLength(route: Point[]): number {
  let total = 0;
  for (let i = 1; i < route.length; i++) total += Math.hypot(route[i].x - route[i - 1].x, route[i].y - route[i - 1].y);
  return total;
}

/**
 * Walk to the receiver carrying papers, hand them over, walk back.
 * route[0] is the sender's station, the last point is where the sender stops beside the receiver.
 */
export function deliveryFrame(ageMs: number, route: Point[], receiver: Point) {
  const length = routeLength(route);
  const walkMs = length / WALK_SPEED;
  const age = Math.max(0, ageMs);
  const phase: DeliveryPhase = age < walkMs ? 'walk' : age < walkMs + GIVE_MS ? 'give' : age < 2 * walkMs + GIVE_MS ? 'return' : 'done';
  const sender = phase === 'walk' ? pointAlong(route, age * WALK_SPEED)
    : phase === 'give' ? { ...route[route.length - 1] }
      : phase === 'return' ? pointAlong(route, length - (age - walkMs - GIVE_MS) * WALK_SPEED) : { ...route[0] };
  const prev = phase === 'walk' ? pointAlong(route, Math.max(0, age * WALK_SPEED - 2))
    : phase === 'return' ? pointAlong(route, length - Math.max(0, (age - walkMs - GIVE_MS) * WALK_SPEED - 2)) : sender;
  const hand = (p: Point, side: number) => ({ x: p.x + 9 * side, y: p.y - 30 });
  const facing = receiver.x >= route[route.length - 1].x ? 1 : -1;
  const give = clamp01((age - walkMs - 250) / 900);
  const papers = phase === 'walk' ? { ...hand(sender, sender.x >= prev.x ? 1 : -1), alpha: 1 }
    : phase === 'give' ? { x: mix(hand(sender, facing).x, hand(receiver, -facing).x, give), y: mix(hand(sender, facing).y, hand(receiver, -facing).y, give) - Math.sin(give * Math.PI) * 6, alpha: 1 }
      : phase === 'return' ? { ...hand(receiver, -facing), alpha: clamp01(1 - (age - walkMs - GIVE_MS) / 700) } : { ...hand(receiver, -facing), alpha: 0 };
  return {
    phase, walking: phase === 'walk' || phase === 'return',
    senderOffset: { x: sender.x - route[0].x, y: sender.y - route[0].y },
    direction: sender.x - prev.x, papers, bob: phase === 'walk' ? Math.sin(age / 110) * 1.5 : 0,
  };
}
