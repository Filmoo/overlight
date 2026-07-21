import type { Bounds } from '../../../world/components';

/**
 * Shared world→renderer-input helpers for planar (top-down / side-on) views.
 * Every planar renderer should use these instead of rolling its own mapping,
 * so all renderers agree on how the world lands on screen.
 */

export interface PlanarFit {
  /** World-space center of the view. */
  cx: number;
  cy: number;
  /** Ortho frustum half-extents that fit the bounds into the viewport. */
  halfW: number;
  halfH: number;
}

/**
 * Fit world XY bounds into a viewport, preserving aspect ratio.
 * The world is always fully visible and centered; extra viewport space
 * stays empty (transparent) rather than stretching the world.
 */
export function fitTopDown(bounds: Bounds, viewportW: number, viewportH: number): PlanarFit {
  const worldW = bounds.max.x - bounds.min.x;
  const worldH = bounds.max.y - bounds.min.y;
  const cx = (bounds.min.x + bounds.max.x) / 2;
  const cy = (bounds.min.y + bounds.max.y) / 2;

  const worldAspect = worldW / worldH;
  const viewportAspect = viewportW / viewportH;

  let halfW = worldW / 2;
  let halfH = worldH / 2;
  if (viewportAspect > worldAspect) {
    halfW = halfH * viewportAspect;
  } else {
    halfH = halfW / viewportAspect;
  }
  return { cx, cy, halfW, halfH };
}
