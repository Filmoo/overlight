import { clamp } from '../core/math';

/**
 * All runtime configuration comes from URL query params, so a single
 * hosted/downloaded file serves every streamer and every OBS source.
 */

export interface AppConfig {
  map: string;
  renderer: string;
  fps: number;
  /** null = auto (checkerboard outside OBS, transparent inside). */
  debug: boolean | null;
  /** null = auto (tuning panel visible outside OBS, hidden inside). */
  tune: boolean | null;
}

export function parseConfig(search: string = window.location.search): AppConfig {
  const q = new URLSearchParams(search);
  const fpsRaw = Number(q.get('fps') ?? 60);
  const debugRaw = q.get('debug');
  const tuneRaw = q.get('tune');
  return {
    map: q.get('map') ?? 'glowfish-topdown',
    renderer: q.get('renderer') ?? 'rc2d',
    fps: Number.isFinite(fpsRaw) ? clamp(fpsRaw, 15, 120) : 60,
    debug: debugRaw === null ? null : debugRaw === '1' || debugRaw === 'true',
    tune: tuneRaw === null ? null : tuneRaw === '1' || tuneRaw === 'true',
  };
}
