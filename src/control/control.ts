import { RENDERER_IDS } from '../render/api/registry';
import { listMaps } from '../world/loader';
import './control.css';

/**
 * The control panel: builds an overlay URL visually. It knows the world
 * and the renderer id list — never renderer internals.
 */

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`control panel: missing #${id}`);
  return el as T;
};

const mapSel = $<HTMLSelectElement>('map');
const rendererSel = $<HTMLSelectElement>('renderer');
const fpsSel = $<HTMLSelectElement>('fps');
const backdropChk = $<HTMLInputElement>('backdrop');
const urlInput = $<HTMLInputElement>('url');
const copyBtn = $<HTMLButtonElement>('copy');
const preview = $<HTMLIFrameElement>('preview');

function fill(select: HTMLSelectElement, options: string[]): void {
  for (const value of options) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = value;
    select.appendChild(opt);
  }
}

fill(mapSel, listMaps());
fill(rendererSel, RENDERER_IDS);

function update(): void {
  const qs = new URLSearchParams({
    map: mapSel.value,
    renderer: rendererSel.value,
    fps: fpsSel.value,
  });
  // The OBS URL never carries debug: the overlay auto-detects OBS.
  urlInput.value = new URL(`index.html?${qs}`, window.location.href).toString();
  preview.src = `index.html?${qs}&debug=${backdropChk.checked ? 1 : 0}`;
}

for (const el of [mapSel, rendererSel, fpsSel, backdropChk]) {
  el.addEventListener('change', update);
}

copyBtn.addEventListener('click', async () => {
  await navigator.clipboard.writeText(urlInput.value);
  copyBtn.textContent = 'Copied';
  copyBtn.classList.add('copied');
  setTimeout(() => {
    copyBtn.textContent = 'Copy';
    copyBtn.classList.remove('copied');
  }, 1200);
});

update();
