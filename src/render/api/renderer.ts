import type { World } from '../../world/components';

/**
 * The renderer contract. Anything satisfying this interface is swappable
 * via ?renderer=<id>. Renderers READ the world — they never mutate it.
 */

export type Capability =
  | 'unlit'
  | 'emissives'
  | 'gi-2d'
  | 'soft-shadows'
  | 'media-approx';

export interface RenderContext {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
}

export interface RendererModule {
  readonly id: string;
  readonly capabilities: readonly Capability[];
  init(ctx: RenderContext, world: World): void;
  resize(width: number, height: number): void;
  render(world: World, dt: number, time: number): void;
  dispose(): void;
}
