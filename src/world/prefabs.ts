import type { Material, Shape } from './components';

export interface PrefabDef {
  shape: Shape;
  material: Material;
  tags: string[];
}

/**
 * Element templates. Maps reference these by name and override params
 * (pos, tint, scale). Prefabs describe WHAT things are, never how any
 * renderer should draw them.
 */
export const PREFABS: Record<string, PrefabDef> = {
  'fish-glow': {
    shape: { kind: 'sphere', radius: 0.18 },
    material: {
      albedo: [0.05, 0.07, 0.08],
      emissive: [0.25, 0.85, 1.0],
      emissiveStrength: 1.0,
    },
    tags: ['wander', 'emitter'],
  },
  'rock-round': {
    shape: { kind: 'sphere', radius: 0.45 },
    material: {
      albedo: [0.52, 0.51, 0.5],
      emissive: [0, 0, 0],
      emissiveStrength: 0,
    },
    tags: ['occluder'],
  },
  'sand-floor': {
    shape: { kind: 'box', size: { x: 12, y: 8, z: 0.2 } },
    material: {
      albedo: [0.62, 0.61, 0.55],
      emissive: [0, 0, 0],
      emissiveStrength: 0,
    },
    tags: ['floor'],
  },
};
