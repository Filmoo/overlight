import { parseConfig } from './host/config';
import { startLoop } from './host/loop';
import { applySavedParams, mountTunePanel } from './host/tune';
import { createRenderer } from './render/api/registry';
import { createWanderSystem } from './sim/wander';
import { loadMap } from './world/loader';

declare global {
  interface Window {
    /** Injected by OBS Browser Source. */
    obsstudio?: unknown;
  }
}

async function boot(): Promise<void> {
  const cfg = parseConfig();
  const inOBS = typeof window.obsstudio !== 'undefined';
  document.body.classList.toggle('debug', cfg.debug ?? !inOBS);

  const canvas = document.createElement('canvas');
  document.body.appendChild(canvas);

  const world = loadMap(cfg.map);
  const renderer = await createRenderer(cfg.renderer);
  renderer.init({ canvas, width: window.innerWidth, height: window.innerHeight }, world);
  window.addEventListener('resize', () =>
    renderer.resize(window.innerWidth, window.innerHeight),
  );

  // Persisted tuning applies with or without the panel — OBS uses it too.
  applySavedParams(renderer);
  const panel = (cfg.tune ?? !inOBS) ? mountTunePanel(renderer) : null;

  const tick = createWanderSystem(world);
  startLoop(cfg.fps, (dt, time) => {
    tick(dt, time);
    renderer.render(world, dt, time);
    panel?.tick(dt * 1000);
  });
}

boot().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  const box = document.createElement('div');
  box.className = 'boot-error';
  box.textContent = `overlight failed to start: ${msg}`;
  document.body.appendChild(box);
  console.error('[overlight]', err);
});
