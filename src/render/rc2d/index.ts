import * as THREE from 'three';
import type { World } from '../../world/components';
import { fitTopDown } from '../api/extract/planar';
import type { Capability, RenderContext, RendererModule } from '../api/renderer';
import { FSQuad, makeTarget, rawMaterial } from './pipeline';
import {
  CASCADE_FS,
  COMPOSITE_FS,
  JFA_DIST_FS,
  JFA_SEED_FS,
  JFA_STEP_FS,
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
 *   4. composite: albedo × radiance + emission, tonemapped, premultiplied α
 *
 * References: Radiance Cascades (Sannikov 2023), jason.today/rc.
 */

const GI_SCALE = 0.5; // GI buffer = half canvas resolution
const BASE_INTERVAL_PX = 8;

class Rc2dRenderer implements RendererModule {
  readonly id = 'rc2d';
  readonly capabilities: readonly Capability[] = ['gi-2d', 'emissives', 'soft-shadows'];

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

  private seedMat!: THREE.RawShaderMaterial;
  private stepMat!: THREE.RawShaderMaterial;
  private distMat!: THREE.RawShaderMaterial;
  private cascadeMat!: THREE.RawShaderMaterial;
  private temporalMat!: THREE.RawShaderMaterial;
  private compositeMat!: THREE.RawShaderMaterial;

  private giW = 1;
  private giH = 1;
  private cascadeCount = 5;

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
      uSeeds: { value: null },
      uUpper: { value: null },
      uHasUpper: { value: false },
      uRes: { value: new THREE.Vector2() },
      uCascadeIndex: { value: 0 },
      uBasePx: { value: BASE_INTERVAL_PX },
    });
    this.temporalMat = rawMaterial(TEMPORAL_FS, {
      uCurr: { value: null },
      uPrev: { value: null },
      uBlend: { value: 0.8 },
    });
    this.compositeMat = rawMaterial(COMPOSITE_FS, {
      uAlbedo: { value: null },
      uEmission: { value: null },
      uCascade0: { value: null },
      uGiRes: { value: new THREE.Vector2() },
      uAmbient: { value: new THREE.Vector3(0.06, 0.08, 0.115) },
      uIntensity: { value: 1.3 },
    });

    this.allocTargets(ctx.width, ctx.height);
    this.resize(ctx.width, ctx.height);
  }

  private allocTargets(w: number, h: number): void {
    this.disposeTargets();
    this.giW = Math.max(4, Math.floor(w * GI_SCALE));
    this.giH = Math.max(4, Math.floor(h * GI_SCALE));

    this.albedoRT = makeTarget(w, h);
    this.emissionRT = makeTarget(w, h);
    this.rcSceneRT = makeTarget(this.giW, this.giH);
    // Float32 seeds: half precision wobbles at large coordinates and the
    // wobble reads as flicker in the light field.
    this.jfaA = makeTarget(this.giW, this.giH, { filter: THREE.NearestFilter, type: THREE.FloatType });
    this.jfaB = makeTarget(this.giW, this.giH, { filter: THREE.NearestFilter, type: THREE.FloatType });
    this.distRT = makeTarget(this.giW, this.giH);
    this.cascadeA = makeTarget(this.giW, this.giH);
    this.cascadeB = makeTarget(this.giW, this.giH);
    this.histA = makeTarget(this.giW, this.giH);
    this.histB = makeTarget(this.giW, this.giH);

    // Enough cascades for the top interval to span the GI buffer diagonal.
    const diag = Math.hypot(this.giW, this.giH);
    this.cascadeCount = Math.max(
      3,
      Math.ceil(Math.log((3 * diag) / BASE_INTERVAL_PX + 1) / Math.log(4)),
    );
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
    ]) {
      rt?.dispose();
    }
  }

  resize(width: number, height: number): void {
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
    this.cascadeMat.uniforms['uSeeds']!.value = src.texture;
    this.cascadeMat.uniforms['uRes']!.value = giRes;
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

    // 5 — composite to canvas
    this.compositeMat.uniforms['uAlbedo']!.value = this.albedoRT.texture;
    this.compositeMat.uniforms['uEmission']!.value = this.emissionRT.texture;
    this.compositeMat.uniforms['uCascade0']!.value = this.histA.texture;
    this.compositeMat.uniforms['uGiRes']!.value = giRes;
    this.quad.render(gl, this.compositeMat, null);
  }

  dispose(): void {
    this.disposeTargets();
    this.sprites.dispose();
    this.quad.dispose();
    for (const m of [this.seedMat, this.stepMat, this.distMat, this.cascadeMat, this.compositeMat]) {
      m.dispose();
    }
    this.three.dispose();
  }
}

export const createRc2dRenderer = (): RendererModule => new Rc2dRenderer();
