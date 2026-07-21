import type { RendererModule } from '../render/api/renderer';

/**
 * Tuning panel: sliders for any renderer that exposes params.
 * Values persist in localStorage per renderer id — note that OBS's browser
 * source has its own storage, so tune in the same browser/source you stream.
 */

const storageKey = (id: string): string => `overlight.tune.${id}`;

function loadSaved(id: string): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(storageKey(id)) ?? '{}') as Record<string, number>;
  } catch {
    return {};
  }
}

/** Apply persisted values (call always, panel or not — OBS uses these too). */
export function applySavedParams(renderer: RendererModule): void {
  if (!renderer.setParam) return;
  const saved = loadSaved(renderer.id);
  for (const [key, value] of Object.entries(saved)) {
    if (typeof value === 'number' && Number.isFinite(value)) renderer.setParam(key, value);
  }
}

const PANEL_CSS = /* css */ `
.ol-tune {
  position: fixed;
  top: 12px;
  right: 12px;
  width: 248px;
  padding: 14px 16px;
  background: #12151acc;
  backdrop-filter: blur(6px);
  border: 1px solid #232a34;
  border-radius: 10px;
  color: #e7eaee;
  font: 12px/1.5 ui-sans-serif, system-ui, sans-serif;
  z-index: 10;
}
.ol-tune header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 10px;
}
.ol-tune h2 {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.1em;
}
.ol-tune .ms {
  color: #8b94a1;
  font-variant-numeric: tabular-nums;
}
.ol-tune .row {
  display: grid;
  grid-template-columns: 1fr 44px;
  gap: 8px;
  align-items: center;
  margin: 7px 0;
}
.ol-tune label {
  grid-column: 1 / -1;
  color: #8b94a1;
  font-size: 11px;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  margin-bottom: -4px;
}
.ol-tune input[type='range'] {
  width: 100%;
  accent-color: #5bd7ff;
}
.ol-tune .val {
  text-align: right;
  color: #e7eaee;
  font-variant-numeric: tabular-nums;
}
.ol-tune .actions {
  display: flex;
  justify-content: space-between;
  margin-top: 12px;
}
.ol-tune button {
  padding: 5px 10px;
  border: 1px solid #232a34;
  border-radius: 6px;
  background: #0c0e12;
  color: #8b94a1;
  font: inherit;
  cursor: pointer;
}
.ol-tune button:hover { color: #e7eaee; }
.ol-tune.collapsed .body { display: none; }
`;

export interface TunePanel {
  tick(dtMs: number): void;
}

export function mountTunePanel(renderer: RendererModule): TunePanel | null {
  if (!renderer.params || !renderer.setParam) return null;

  const style = document.createElement('style');
  style.textContent = PANEL_CSS;
  document.head.appendChild(style);

  const panel = document.createElement('div');
  panel.className = 'ol-tune';
  if (localStorage.getItem('overlight.tune.collapsed') === '1') panel.classList.add('collapsed');

  const header = document.createElement('header');
  const title = document.createElement('h2');
  title.textContent = `${renderer.id} · tuning`;
  const ms = document.createElement('span');
  ms.className = 'ms';
  ms.textContent = '— ms';
  header.append(title, ms);
  header.style.cursor = 'pointer';
  header.addEventListener('click', () => {
    panel.classList.toggle('collapsed');
    localStorage.setItem(
      'overlight.tune.collapsed',
      panel.classList.contains('collapsed') ? '1' : '0',
    );
  });
  panel.appendChild(header);

  const body = document.createElement('div');
  body.className = 'body';
  panel.appendChild(body);

  const save = (key: string, value: number): void => {
    const saved = loadSaved(renderer.id);
    saved[key] = value;
    localStorage.setItem(storageKey(renderer.id), JSON.stringify(saved));
  };

  const sliders = new Map<string, { input: HTMLInputElement; val: HTMLSpanElement }>();
  for (const def of renderer.params) {
    const row = document.createElement('div');
    row.className = 'row';
    const label = document.createElement('label');
    label.textContent = def.label;
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(def.min);
    input.max = String(def.max);
    input.step = String(def.step);
    input.value = String(renderer.getParam?.(def.key) ?? def.value);
    const val = document.createElement('span');
    val.className = 'val';
    val.textContent = input.value;
    input.addEventListener('input', () => {
      const v = Number(input.value);
      renderer.setParam!(def.key, v);
      save(def.key, v);
      val.textContent = input.value;
    });
    row.append(label, input, val);
    body.appendChild(row);
    sliders.set(def.key, { input, val });
  }

  const actions = document.createElement('div');
  actions.className = 'actions';
  const reset = document.createElement('button');
  reset.textContent = 'Reset defaults';
  reset.addEventListener('click', () => {
    localStorage.removeItem(storageKey(renderer.id));
    for (const def of renderer.params!) {
      renderer.setParam!(def.key, def.value);
      const s = sliders.get(def.key)!;
      s.input.value = String(def.value);
      s.val.textContent = s.input.value;
    }
  });
  const hint = document.createElement('span');
  hint.className = 'ms';
  hint.textContent = 'saved locally';
  actions.append(reset, hint);
  body.appendChild(actions);

  document.body.appendChild(panel);

  let emaMs = 16.7;
  let frames = 0;
  return {
    tick(dtMs: number): void {
      emaMs += (dtMs - emaMs) * 0.05;
      if (++frames % 15 === 0) {
        ms.textContent = `${(1000 / emaMs).toFixed(0)} fps · ${emaMs.toFixed(1)} ms`;
      }
    },
  };
}
