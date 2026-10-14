import type { Container } from 'pixi.js';

export interface CameraBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export function clampCamera(stage: Container, bounds: CameraBounds): void {
  stage.x = Math.min(bounds.maxX, Math.max(bounds.minX, stage.x));
  stage.y = Math.min(bounds.maxY, Math.max(bounds.minY, stage.y));
}

/** Move toward the reachable focus point; false means the focus has finished. */
export function advanceCameraFocus(stage: Container, target: { x: number; y: number }, bounds: CameraBounds, deltaMs: number): boolean {
  const x = Math.min(bounds.maxX, Math.max(bounds.minX, target.x));
  const y = Math.min(bounds.maxY, Math.max(bounds.minY, target.y));
  const blend = Math.min(1, Math.max(0, deltaMs) * 0.004);
  stage.x += (x - stage.x) * blend;
  stage.y += (y - stage.y) * blend;
  clampCamera(stage, bounds);
  if (Math.hypot(x - stage.x, y - stage.y) < 1) {
    stage.x = x;
    stage.y = y;
    return false;
  }
  return true;
}

export function zoomAt(stage: Container, factor: number, x: number, y: number, min = 0.58, max = 1.55): void {
  const next = Math.min(max, Math.max(min, stage.scale.x * factor));
  const beforeX = (x - stage.x) / stage.scale.x;
  const beforeY = (y - stage.y) / stage.scale.y;
  stage.scale.set(next);
  stage.x = x - beforeX * next;
  stage.y = y - beforeY * next;
}
