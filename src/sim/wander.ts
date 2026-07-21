import { clamp, damp, dist2d, lerp, randRange, TAU, v3, type Vec3 } from '../core/math';
import type { World } from '../world/components';

/**
 * Simulation systems mutate world state and know NOTHING about rendering.
 * Behavioral state (targets, velocities) lives here, not in the world data.
 */

interface WanderState {
  target: Vec3;
  vel: Vec3;
  baseZ: number;
  phase: number;
  speed: number;
}

const WALL_MARGIN = 0.7;
const ARRIVE_DIST = 0.5;
const STEER_RATE = 1.8;

export function createWanderSystem(world: World) {
  const { min, max } = world.bounds;
  const states = new Map<number, WanderState>();

  const pickTarget = (): Vec3 =>
    v3(
      randRange(min.x + WALL_MARGIN, max.x - WALL_MARGIN),
      randRange(min.y + WALL_MARGIN, max.y - WALL_MARGIN),
      0,
    );

  for (const e of world.entities) {
    if (!e.tags.includes('wander')) continue;
    states.set(e.id, {
      target: pickTarget(),
      vel: v3(),
      baseZ: e.transform.pos.z,
      phase: randRange(0, TAU),
      speed: randRange(0.8, 1.4),
    });
  }

  return function tick(dt: number, time: number): void {
    for (const e of world.entities) {
      const s = states.get(e.id);
      if (!s) continue;
      const p = e.transform.pos;

      if (dist2d(p, s.target) < ARRIVE_DIST) s.target = pickTarget();

      const dx = s.target.x - p.x;
      const dy = s.target.y - p.y;
      const len = Math.hypot(dx, dy) || 1;
      const k = damp(dt, STEER_RATE);
      s.vel.x = lerp(s.vel.x, (dx / len) * s.speed, k);
      s.vel.y = lerp(s.vel.y, (dy / len) * s.speed, k);

      p.x = clamp(p.x + s.vel.x * dt, min.x + 0.3, max.x - 0.3);
      p.y = clamp(p.y + s.vel.y * dt, min.y + 0.3, max.y - 0.3);
      // Gentle vertical bob around the fish's authored depth.
      p.z = clamp(s.baseZ + Math.sin(time * 0.7 + s.phase) * 0.35, min.z + 0.2, max.z - 0.1);

      e.transform.yaw = Math.atan2(s.vel.y, s.vel.x);
    }
  };
}
