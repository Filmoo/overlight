import * as THREE from 'three';
import type { World } from '../../world/components';
import { fitTopDown } from '../api/extract/planar';
import type { Capability, ParamDef, RenderContext, RendererModule } from '../api/renderer';
import { FSQuad, makeTarget, rawMaterial } from './pipeline';
import {
  BLUR_FS,
  CASCADE_FS,
  COMPOSITE_FS,
  JFA_DIST_FS,
  JFA_SEED_FS,
  JFA_STEP_FS,
  RESOLVE_FS,
  TEMPORAL_FS,
} from './shaders';
import { SpriteWorld } from './sprites';

/**
 * rc2d — 2D radiance cascades global illumination.
 *
 * Per frame:
 *   1. scene passes: albedo (full res), emission glows (full res),
 *      GI scene = occluders + light cores (half res)
 *   2. JFA: seeds → jump flood → distance field
 *   3. radiance cascades, top cascade down to 0
 *   4. resolve tile-packed cascade 0 → per-pixel irradiance
 *   5. separable blur of the irradiance (erases probe-grid residue)
 *   6. composite: albedo × irradiance + emission, tonemapped, premultiplied α
 *
 * References: Radiance Cascades (Sannikov 2023), jason.today/rc.
 */

/** Ambient hue (deep water blue); the `ambient` param scales it. */
const AMBIENT_HUE = new THREE.Vector3(0.52, 0.7, 1.0);

const PARAM_DEFS: readonly ParamDef[] = [
  { key: 'giScale', label: 'GI resolution', min: 0.4, max: 1.0, step: 0.05, value: 0.5 },
  { key: 'tileExp', label: 'c0 dirs (4^x)', min: 1, max: 2, step: 1, value: 2 },
  { key: 'basePx', label: 'c0 interval px', min: 1, max: 8, step: 0.5, value: 4 },
  { key: 'history', label: 'temporal history', min: 0, max: 0.95, step: 0.01, value: 0.3 },
  { key: 'blur', label: 'GI blur (texels)', min: 0, max: 4, step: 0.25, value: 1.5 },
  { key: 'jitter', label: 'ray jitter', min: 0, max: 1, step: 0.05, value: 0 },
  { key: 'intensity', label: 'light intensity', min: 0.2, max: 3, step: 0.05, value: 1.3 },
  { key: 'ambient', label: 'ambient level', min: 0, max: 0.4, step: 0.005, value: 0.115 },
  { key: 'boost', label: 'emitter boost', min: 1, max: 10, step: 0.1, value: 5.5 },
  { key: 'debugView', label: 'view (0 final · 1 GI · 2 no glow)', min: 0, max: 2, step: 1, value: 0 },
];

class Rc2dRenderer implements RendererModule {
  readonly id = 'rc2d';
  readonly capabilities: readonly Capability[] = ['gi-2d', 'emissives', 'soft-shadows'];
  readonly params = PARAM_DEFS;

  private p: Record<string, number> = Object.fromEntries(
    PARAM_DEFS.map((d) => [d.key, d.value]),
  );

  private three!: THREE.WebGLRenderer;
  private world!: World;
  private sprites!: SpriteWorld;
  private camera = new THREE.OrthographicCamera();
  private quad = new FSQuad();

  private albedoRT!: THREE.WebGLRenderTarget;
  private emissionRT!: THREE.WebGLRenderTarget;
  private rcSceneRT!: THREE.WebGLRenderTarget;
  private jfaA!: THREE.WebGLRenderTarget;
  private jfaB!: THREE.WebGLRenderTarget;
  private distRT!: THREE.WebGLRenderTarget;
  private cascadeA!: THREE.WebGLRenderTarget;
  private cascadeB!: THREE.WebGLRenderTarget;
  private histA!: THREE.WebGLRenderTarget;
  private histB!: THREE.WebGLRenderTarget;
  private irrA!: THREE.WebGLRenderTarget;
  private irrB!: THREE.WebGLRenderTarget;

  private seedMat!: THREE.RawShaderMaterial;
  private stepMat!: THREE.RawShaderMaterial;
  private distMat!: THREE.RawShaderMaterial;
  private cascadeMat!: THREE.RawShaderMaterial;
  private temporalMat!: THREE.RawShaderMaterial;
  private resolveMat!: THREE.RawShaderMaterial;
  private blurMat!: THREE.RawShaderMaterial;
  private compositeMat!: THREE.RawShaderMaterial;

  private giW = 1;
  private giH = 1;
  private cascadeCount = 5;
  private lastW = 1;
  private lastH = 1;

  init(ctx: RenderContext, world: World): void {
    this.world = world;
    this.three = new THREE.WebGLRenderer({ canvas: ctx.canvas, alpha: true, antialias: false });
    this.three.setPixelRatio(1);
    this.three.setClearColor(0x000000, 0);

    this.sprites = new SpriteWorld(world);

    const b = world.bounds;
    this.camera.position.set((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, b.max.z + 5);
    this.camera.near = 0.1;
    this.camera.far = b.max.z - b.min.z + 10;

    this.seedMat = rawMaterial(JFA_SEED_FS, {
      uScene: { value: null },
      uRes: { value: new THREE.Vector2() },
    });
    this.stepMat = rawMaterial(JFA_STEP_FS, {
      uPrev: { value: null },
      uRes: { value: new THREE.Vector2() },
      uOffset: { value: 1 },
    });
    this.distMat = rawMaterial(JFA_DIST_FS, {
      uSeeds: { value: null },
      uRes: { value: new THREE.Vector2() },
    });
    this.cascadeMat = rawMaterial(CASCADE_FS, {
      uScene: { value: null },
      uDist: { value: null },
      uUpper: { value: null },
      uHasUpper: { value: false },
      uRes: { value: new THREE.Vector2() },
      uCascadeIndex: { value: 0 },
      uBasePx: { value: this.p['basePx'] },
      uJitter: { value: 0 },
      uJitterAmt: { value: this.p['jitter'] },
      uTileExp: { value: this.p['tileExp'] },
    });
    this.temporalMat = rawMaterial(TEMPORAL_FS, {
      uCurr: { value: null },
      uPrev: { value: null },
      uBlend: { value: this.p['history'] },
    });
    this.resolveMat = rawMaterial(RESOLVE_FS, {
      uCascade0: { value: null },
      uGiRes: { value: new THREE.Vector2() },
      uTiles0: { value: 2 ** this.p['tileExp']! },
    });
    this.blurMat = rawMaterial(BLUR_FS, {
      uTex: { value: null },
      uTexel: { value: new THREE.Vector2() },
      uDir: { value: new THREE.Vector2(1, 0) },
      uRadius: { value: this.p['blur'] },
    });
    this.compositeMat = rawMaterial(COMPOSITE_FS, {
      uAlbedo: { value: null },
      uEmission: { value: null },
      uIrr: { value: null },
      uAmbient: { value: AMBIENT_HUE.clone().multiplyScalar(this.p['ambient']!) },
      uIntensity: { value: this.p['intensity'] },
      uDebugView: { value: this.p['debugView'] },
    });

    this.allocTargets(ctx.width, ctx.height);
    this.resize(ctx.width, ctx.height);
  }

  private allocTargets(w: number, h: number): void {
    this.disposeTargets();
    const rawW = Math.max(64, Math.floor(w * this.p['giScale']!));
    const rawH = Math.max(64, Math.floor(h * this.p['giScale']!));

    // Enough cascades for the top interval to span the GI buffer diagonal.
    // Canonical intervals: top cascade (count-1) ends at 5·4^(count-2)·L0.
    const diag = Math.hypot(rawW, rawH);
    this.cascadeCount = Math.max(
      3,
      2 + Math.ceil(Math.log(diag / (5 * this.p['basePx']!)) / Math.log(4)),
    );

    // The buffer MUST be a multiple of the top cascade's tile count —
    // fractional tile sizes put probes at inconsistent positions across
    // cascades and render as moiré "curtains" in the light field.
    const mult = 2 ** (this.cascadeCount + 1);
    this.giW = Math.max(mult, Math.floor(rawW / mult) * mult);
    this.giH = Math.max(mult, Math.floor(rawH / mult) * mult);

    // MSAA on every target that rasterizes geometry: silhouettes (rocks,
    // fish, tank border) come out clean instead of 1px staircases.
    this.albedoRT = makeTarget(w, h, { samples: 4 });
    this.emissionRT = makeTarget(w, h, { samples: 4 });
    this.rcSceneRT = makeTarget(this.giW, this.giH, { samples: 4 });
    // Float32 seeds: half precision wobbles at large coordinates and the
    // wobble reads as flicker in the light field.
    this.jfaA = makeTarget(this.giW, this.giH, { filter: THREE.NearestFilter, type: THREE.FloatType });
    this.jfaB = makeTarget(this.giW, this.giH, { filter: THREE.NearestFilter, type: THREE.FloatType });
    this.distRT = makeTarget(this.giW, this.giH);
    this.cascadeA = makeTarget(this.giW, this.giH);
    this.cascadeB = makeTarget(this.giW, this.giH);
    this.histA = makeTarget(this.giW, this.giH);
    this.histB = makeTarget(this.giW, this.giH);
    this.irrA = makeTarget(this.giW, this.giH);
    this.irrB = makeTarget(this.giW, this.giH);
  }

  private disposeTargets(): void {
    for (const rt of [
      this.albedoRT,
      this.emissionRT,
      this.rcSceneRT,
      this.jfaA,
      this.jfaB,
      this.distRT,
      this.cascadeA,
      this.cascadeB,
      this.histA,
      this.histB,
      this.irrA,
      this.irrB,
    ]) {
      rt?.dispose();
    }
  }

  setParam(key: string, value: number): void {
    if (!(key in this.p)) return;
    this.p[key] = value;
    switch (key) {
      case 'giScale':
      case 'basePx':
        // Buffer geometry depends on these — reallocate.
        this.cascadeMat.uniforms['uBasePx']!.value = this.p['basePx'];
        this.allocTargets(this.lastW, this.lastH);
        break;
      case 'tileExp':
        this.cascadeMat.uniforms['uTileExp']!.value = value;
        this.resolveMat.uniforms['uTiles0']!.value = 2 ** value;
        break;
      case 'blur':
        this.blurMat.uniforms['uRadius']!.value = value;
        break;
      case 'history':
        this.temporalMat.uniforms['uBlend']!.value = value;
        break;
      case 'jitter':
        this.cascadeMat.uniforms['uJitterAmt']!.value = value;
        break;
      case 'intensity':
        this.compositeMat.uniforms['uIntensity']!.value = value;
        break;
      case 'ambient':
        (this.compositeMat.uniforms['uAmbient']!.value as THREE.Vector3)
          .copy(AMBIENT_HUE)
          .multiplyScalar(value);
        break;
      case 'boost':
        this.sprites.setBoost(value);
        break;
      case 'debugView':
        this.compositeMat.uniforms['uDebugView']!.value = value;
        break;
    }
  }

  getParam(key: string): number | undefined {
    return this.p[key];
  }

  resize(width: number, height: number): void {
    this.lastW = width;
    this.lastH = height;
    this.three.setSize(width, height, false);
    this.allocTargets(width, height);
    const f = fitTopDown(this.world.bounds, width, height);
    this.camera.left = -f.halfW;
    this.camera.right = f.halfW;
    this.camera.top = f.halfH;
    this.camera.bottom = -f.halfH;
    this.camera.updateProjectionMatrix();
  }

  render(world: World, _dt: number, time: number): void {
    const gl = this.three;
    this.sprites.update(world, time);

    // 1 — scene passes
    gl.setRenderTarget(this.albedoRT);
    gl.clear();
    gl.render(this.sprites.albedo, this.camera);
    gl.setRenderTarget(this.emissionRT);
    gl.clear();
    gl.render(this.sprites.emission, this.camera);
    gl.setRenderTarget(this.rcSceneRT);
    gl.clear();
    gl.render(this.sprites.rcScene, this.camera);

    const giRes = new THREE.Vector2(this.giW, this.giH);

    // 2 — jump flood → distance field
    this.seedMat.uniforms['uScene']!.value = this.rcSceneRT.texture;
    this.seedMat.uniforms['uRes']!.value = giRes;
    this.quad.render(gl, this.seedMat, this.jfaA);

    let src = this.jfaA;
    let dst = this.jfaB;
    let offset = 2 ** Math.ceil(Math.log2(Math.max(this.giW, this.giH))) / 2;
    while (offset >= 1) {
      this.stepMat.uniforms['uPrev']!.value = src.texture;
      this.stepMat.uniforms['uRes']!.value = giRes;
      this.stepMat.uniforms['uOffset']!.value = offset;
      this.quad.render(gl, this.stepMat, dst);
      [src, dst] = [dst, src];
      offset /= 2;
    }

    this.distMat.uniforms['uSeeds']!.value = src.texture;
    this.distMat.uniforms['uRes']!.value = giRes;
    this.quad.render(gl, this.distMat, this.distRT);

    // 3 — cascades, top down to 0
    this.cascadeMat.uniforms['uScene']!.value = this.rcSceneRT.texture;
    this.cascadeMat.uniforms['uDist']!.value = this.distRT.texture;
    this.cascadeMat.uniforms['uRes']!.value = giRes;
    this.cascadeMat.uniforms['uJitter']!.value = Math.random();
    let upper: THREE.WebGLRenderTarget | null = null;
    let ping = this.cascadeA;
    let pong = this.cascadeB;
    for (let n = this.cascadeCount - 1; n >= 0; n--) {
      this.cascadeMat.uniforms['uCascadeIndex']!.value = n;
      this.cascadeMat.uniforms['uHasUpper']!.value = upper !== null;
      this.cascadeMat.uniforms['uUpper']!.value = upper ? upper.texture : null;
      this.quad.render(gl, this.cascadeMat, ping);
      upper = ping;
      [ping, pong] = [pong, ping];
    }

    // 4 — temporal accumulation: EMA over frames stabilizes the light field
    this.temporalMat.uniforms['uCurr']!.value = upper!.texture;
    this.temporalMat.uniforms['uPrev']!.value = this.histA.texture;
    this.quad.render(gl, this.temporalMat, this.histB);
    [this.histA, this.histB] = [this.histB, this.histA];

    // 5 — resolve tile-packed cascade 0 → per-pixel irradiance
    this.resolveMat.uniforms['uCascade0']!.value = this.histA.texture;
    this.resolveMat.uniforms['uGiRes']!.value = giRes;
    this.quad.render(gl, this.resolveMat, this.irrA);

    // 6 — separable blur (skipped when radius is 0)
    if (this.p['blur']! > 0.001) {
      const texel = new THREE.Vector2(1 / this.giW, 1 / this.giH);
      this.blurMat.uniforms['uTex']!.value = this.irrA.texture;
      this.blurMat.uniforms['uTexel']!.value = texel;
      this.blurMat.uniforms['uDir']!.value = new THREE.Vector2(1, 0);
      this.quad.render(gl, this.blurMat, this.irrB);
      this.blurMat.uniforms['uTex']!.value = this.irrB.texture;
      this.blurMat.uniforms['uDir']!.value = new THREE.Vector2(0, 1);
      this.quad.render(gl, this.blurMat, this.irrA);
    }

    // 7 — composite to canvas
    this.compositeMat.uniforms['uAlbedo']!.value = this.albedoRT.texture;
    this.compositeMat.uniforms['uEmission']!.value = this.emissionRT.texture;
    this.compositeMat.uniforms['uIrr']!.value = this.irrA.texture;
    this.quad.render(gl, this.compositeMat, null);
  }

  dispose(): void {
    this.disposeTargets();
    this.sprites.dispose();
    this.quad.dispose();
    for (const m of [
      this.seedMat,
      this.stepMat,
      this.distMat,
      this.cascadeMat,
      this.temporalMat,
      this.resolveMat,
      this.blurMat,
      this.compositeMat,
    ]) {
      m.dispose();
    }
    this.three.dispose();
  }
}

export const createRc2dRenderer = (): RendererModule => new Rc2dRenderer();
