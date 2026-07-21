import { describe, expect, it } from 'vitest';
import { clamp, damp, dist2d, lerp, randRange, v3 } from './math';

describe('math', () => {
  it('clamps below, inside, above', () => {
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(11, 0, 10)).toBe(10);
  });

  it('lerps endpoints and midpoint', () => {
    expect(lerp(0, 10, 0)).toBe(0);
    expect(lerp(0, 10, 1)).toBe(10);
    expect(lerp(0, 10, 0.5)).toBe(5);
  });

  it('damp stays in (0, 1) for positive dt and rate', () => {
    for (const dt of [0.001, 0.016, 0.1, 1]) {
      const k = damp(dt, 2);
      expect(k).toBeGreaterThan(0);
      expect(k).toBeLessThan(1);
    }
  });

  it('dist2d ignores z', () => {
    expect(dist2d(v3(0, 0, 5), v3(3, 4, -5))).toBe(5);
  });

  it('randRange stays within bounds', () => {
    for (let i = 0; i < 100; i++) {
      const r = randRange(2, 3);
      expect(r).toBeGreaterThanOrEqual(2);
      expect(r).toBeLessThanOrEqual(3);
    }
  });
});
