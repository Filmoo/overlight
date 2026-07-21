import { v3 } from '../core/math';
import type { Entity, RGB, ViewSpec, World } from './components';
import { PREFABS } from './prefabs';

interface RawEntity {
  prefab: string;
  pos: [number, number, number];
  tint?: [number, number, number];
  scale?: number;
}

interface RawMap {
  name: string;
  view: ViewSpec;
  bounds: { min: [number, number, number]; max: [number, number, number] };
  entities: RawEntity[];
}

const MAP_MODULES = import.meta.glob('./maps/*.json', { eager: true }) as Record<
  string,
  { default: RawMap }
>;

function mapNameFromPath(path: string): string {
  return path.replace(/^.*\//, '').replace(/\.json$/, '');
}

export function listMaps(): string[] {
  return Object.keys(MAP_MODULES).map(mapNameFromPath).sort();
}

export function loadMap(name: string): World {
  const entry = Object.entries(MAP_MODULES).find(([path]) => mapNameFromPath(path) === name);
  if (!entry) {
    throw new Error(`Unknown map "${name}". Available maps: ${listMaps().join(', ')}`);
  }
  const raw = entry[1].default;
  validateRawMap(raw);

  const entities: Entity[] = raw.entities.map((e, i) => {
    const prefab = PREFABS[e.prefab];
    if (!prefab) {
      throw new Error(
        `Map "${name}" entity #${i}: unknown prefab "${e.prefab}". ` +
          `Available prefabs: ${Object.keys(PREFABS).join(', ')}`,
      );
    }
    const material = structuredClone(prefab.material);
    if (e.tint) material.emissive = [...e.tint] as RGB;
    return {
      id: i,
      prefab: e.prefab,
      transform: { pos: v3(...e.pos), yaw: 0, scale: e.scale ?? 1 },
      shape: structuredClone(prefab.shape),
      material,
      tags: [...prefab.tags],
    };
  });

  return {
    name: raw.name,
    view: raw.view,
    bounds: { min: v3(...raw.bounds.min), max: v3(...raw.bounds.max) },
    entities,
  };
}

function validateRawMap(raw: RawMap): void {
  const { min, max } = raw.bounds;
  if (min.length !== 3 || max.length !== 3) {
    throw new Error(`Map "${raw.name}": bounds min/max must be [x, y, z]`);
  }
  for (let axis = 0; axis < 3; axis++) {
    if (min[axis]! >= max[axis]!) {
      throw new Error(`Map "${raw.name}": bounds.min must be < bounds.max on every axis`);
    }
  }
}
