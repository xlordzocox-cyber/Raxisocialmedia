import type { AgentSprite } from './AgentSprite';
import type { AgentStatus } from '../../domain/agents';

export function applyAgentAnimation(sprite: AgentSprite, status: AgentStatus, elapsedMs: number): void {
  // Animate local limbs, never the root coordinates or its depth-sort key.
  sprite.animate(status, elapsedMs);
}
