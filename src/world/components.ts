import type { Vec3 } from '../core/math';

/**
 * The world model is pure data, always authored in 3D world-space.
 * Renderers READ this and interpret it — they never write to it,
 * and nothing in here may ever reference a rendering technique.
 */

export type RGB = [number, number, number];

export interface Transform {
  pos: Vec3;
  /** Heading in the XY plane, radians. */
  yaw: number;
  scale: number;
}

export type Shape =
  | { kind: 'sphere'; radius: number }
  | { kind: 'box'; size: Vec3 };

export interface Material {
  albedo: RGB;
  emissive: RGB;
  emissiveStrength: number;
}

export interface Entity {
  id: number;
  prefab: string;
  transform: Transform;
  shape: Shape;
  material: Material;
  /** Semantic tags: 'wander' | 'emitter' | 'occluder' | 'floor' | ... */
  tags: string[];
}

export interface ViewSpec {
  /** Suggested view for renderers that need one. Renderers may override. */
  kind: 'ortho-topdown';
}

export interface Bounds {
  min: Vec3;
  max: Vec3;
}

export interface World {
  name: string;
  view: ViewSpec;
  bounds: Bounds;
  entities: Entity[];
}

export function depth01(bounds: Bounds, z: number): number {
  const range = bounds.max.z - bounds.min.z;
  return range > 0 ? (z - bounds.min.z) / range : 0;
}
