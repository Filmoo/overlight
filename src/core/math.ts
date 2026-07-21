export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const TAU = Math.PI * 2;

export function v3(x = 0, y = 0, z = 0): Vec3 {
  return { x, y, z };
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function dist2d(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function randRange(lo: number, hi: number): number {
  return lo + Math.random() * (hi - lo);
}

/** Framerate-independent exponential smoothing factor (use as lerp t). */
export function damp(dt: number, rate: number): number {
  return 1 - Math.exp(-rate * dt);
}
