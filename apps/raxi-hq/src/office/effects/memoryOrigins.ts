import type { HQEvent } from '../../domain/events';
import type { Point } from '../zones';

/** Scene-local positions from mock requests; no persistence or external memory access. */
export class PendingMemoryOrigins {
  private origins = new Map<string, Point[]>();

  remember(event: HQEvent, position: Point): void {
    if (!event.actorId) return;
    const key = this.key(event);
    this.origins.set(key, [...(this.origins.get(key) ?? []), { ...position }]);
  }

  consume(event: HQEvent, fallback: Point): Point {
    if (!event.actorId) return { ...fallback };
    const key = this.key(event);
    const pending = this.origins.get(key);
    const origin = pending?.shift();
    if (pending?.length === 0) this.origins.delete(key);
    return { ...(origin ?? fallback) };
  }

  clear(): void { this.origins.clear(); }

  private key(event: HQEvent): string {
    return JSON.stringify([event.campaignId ?? null, event.actorId, event.targetId ?? null]);
  }
}
