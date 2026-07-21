import { describe, expect, it } from 'vitest';
import { v3 } from '../../../core/math';
import { fitTopDown } from './planar';

const bounds = { min: v3(0, 0, 0), max: v3(12, 8, 3) };

describe('fitTopDown', () => {
  it('centers on the world bounds', () => {
    const f = fitTopDown(bounds, 1920, 1080);
    expect(f.cx).toBe(6);
    expect(f.cy).toBe(4);
  });

  it('letterboxes a wide viewport (world fully visible)', () => {
    const f = fitTopDown(bounds, 1920, 1080); // viewport 16:9 wider than world 3:2
    expect(f.halfH).toBe(4);
    expect(f.halfW).toBeCloseTo(4 * (1920 / 1080));
    expect(f.halfW).toBeGreaterThanOrEqual(6);
  });

  it('letterboxes a tall viewport', () => {
    const f = fitTopDown(bounds, 800, 1000);
    expect(f.halfW).toBe(6);
    expect(f.halfH).toBeCloseTo(6 / (800 / 1000));
    expect(f.halfH).toBeGreaterThanOrEqual(4);
  });
});
