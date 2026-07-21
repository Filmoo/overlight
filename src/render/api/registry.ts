import type { RendererModule } from './renderer';

/**
 * Renderer registry. Factories are lazy (dynamic import) so pages that only
 * need the id list (e.g. the control panel) don't pull renderer bundles,
 * and future heavy renderers only load when selected.
 *
 * Adding a renderer = one folder under src/render/ + one line here.
 */
const REGISTRY: Record<string, () => Promise<RendererModule>> = {
  rc2d: async () => (await import('../rc2d/index')).createRc2dRenderer(),
  flat: async () => (await import('../flat/index')).createFlatRenderer(),
};

export const RENDERER_IDS = Object.keys(REGISTRY);

export async function createRenderer(id: string): Promise<RendererModule> {
  const factory = REGISTRY[id];
  if (!factory) {
    console.warn(`[overlight] unknown renderer "${id}", falling back to "flat"`);
    return REGISTRY['flat']!();
  }
  return factory();
}
