import * as THREE from 'three';
import type { Entity, World } from '../../world/components';

/**
 * rc2d's visual interpretation of the world: three parallel scene graphs
 * rendered into the pipeline's inputs.
 *  - albedo:   what surfaces look like (textured sand, shaded rocks, fish bodies)
 *  - emission: soft glow gradients (full-res, composited over the lit scene)
 *  - rcScene:  what the GI solver sees (rock occluders + fish light cores)
 */

const SPRITE_VS = /* glsl */ `
varying vec2 vLocal;
varying vec2 vWorld;
void main() {
  vLocal = position.xy;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xy;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

// Kept for when texture detail returns after the GI diagnosis.
// @ts-expect-error TS6133 — intentionally unused in diagnostic mode
const NOISE = /* glsl */ `
float hash21(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
    mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}
float fbm(vec2 p) {
  return 0.5 * vnoise(p) + 0.3 * vnoise(p * 2.7) + 0.2 * vnoise(p * 6.1);
}
`;

// DIAGNOSTIC MODE: sand and rocks are flat colors so any visible pattern
// must come from the GI pipeline itself. Texture detail returns once the
// light field is proven smooth. (fbm helpers in NOISE, currently unused.)
const SAND_FS = /* glsl */ `
uniform vec3 uColor;
void main() {
  gl_FragColor = vec4(uColor, 1.0);
}
`;

const ROCK_FS = /* glsl */ `
uniform vec3 uColor;
void main() {
  gl_FragColor = vec4(uColor, 1.0);
}
`;

const CORE_FS = /* glsl */ `
uniform vec3 uColor;
uniform float uRadius;
varying vec2 vLocal;
void main() {
  // Soft-edged AREA light: full-bright plateau out to 80% of the radius, a
  // 2-texel antialiased rim beyond. The plateau (not a full radial falloff)
  // keeps rays hitting bright interior — a point source is RC's worst case,
  // an area source its best, so a larger soft disc reads far smoother.
  float r = length(vLocal) / uRadius;
  float a = 1.0 - smoothstep(0.8, 1.0, r);
  gl_FragColor = vec4(uColor * a, a);
}
`;

const GLOW_FS = /* glsl */ `
uniform vec3 uColor;
uniform float uStrength;
uniform float uRadius;
varying vec2 vLocal;
void main() {
  float r = length(vLocal) / uRadius;
  float a = pow(clamp(1.0 - r, 0.0, 1.0), 1.7);
  gl_FragColor = vec4(uColor * uStrength * a, a);
}
`;

function fishBodyGeometry(r: number): THREE.ShapeGeometry {
  const s = new THREE.Shape();
  s.moveTo(1.3 * r, 0);
  s.quadraticCurveTo(0.5 * r, 0.75 * r, -0.55 * r, 0.55 * r);
  s.quadraticCurveTo(-0.9 * r, 0.28 * r, -0.9 * r, 0);
  s.quadraticCurveTo(-0.9 * r, -0.28 * r, -0.55 * r, -0.55 * r);
  s.quadraticCurveTo(0.5 * r, -0.75 * r, 1.3 * r, 0);
  return new THREE.ShapeGeometry(s, 16);
}

function fishTailGeometry(r: number): THREE.ShapeGeometry {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.lineTo(-0.7 * r, 0.45 * r);
  s.quadraticCurveTo(-0.45 * r, 0, -0.7 * r, -0.45 * r);
  s.closePath();
  return new THREE.ShapeGeometry(s, 8);
}

interface FishParts {
  albedoGroup: THREE.Group;
  emissionMesh: THREE.Mesh;
  rcMesh: THREE.Mesh;
  tail: THREE.Mesh;
  glowMats: THREE.ShaderMaterial[];
  rcMat: THREE.ShaderMaterial;
  tint: THREE.Color;
  phase: number;
}

export class SpriteWorld {
  readonly albedo = new THREE.Scene();
  readonly emission = new THREE.Scene();
  readonly rcScene = new THREE.Scene();
  private fish = new Map<number, FishParts>();

  /** Brightness of fish cores as GI light sources. */
  /** Brightness of fish cores as GI light sources. Tunable via setBoost. */
  private boost = 5.5;

  setBoost(b: number): void {
    this.boost = b;
  }

  constructor(world: World) {
    for (const e of world.entities) {
      if (e.tags.includes('floor')) this.addFloor(e);
      else if (e.tags.includes('occluder')) this.addRock(e);
      else if (e.tags.includes('emitter')) this.addFish(e);
    }
  }

  private addFloor(e: Entity): void {
    if (e.shape.kind !== 'box') return;
    const mat = new THREE.ShaderMaterial({
      vertexShader: SPRITE_VS,
      fragmentShader: SAND_FS,
      uniforms: { uColor: { value: new THREE.Color(...e.material.albedo) } },
    });
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(e.shape.size.x * e.transform.scale, e.shape.size.y * e.transform.scale),
      mat,
    );
    mesh.position.set(e.transform.pos.x, e.transform.pos.y, 0);
    mesh.renderOrder = 0;
    this.albedo.add(mesh);
  }

  private addRock(e: Entity): void {
    if (e.shape.kind !== 'sphere') return;
    const r = e.shape.radius * e.transform.scale;
    const geo = new THREE.CircleGeometry(r, 48);
    const albedoMat = new THREE.ShaderMaterial({
      vertexShader: SPRITE_VS,
      fragmentShader: ROCK_FS,
      uniforms: {
        uColor: { value: new THREE.Color(...e.material.albedo) },
        uRadius: { value: r },
      },
    });
    const albedoMesh = new THREE.Mesh(geo, albedoMat);
    albedoMesh.position.set(e.transform.pos.x, e.transform.pos.y, e.transform.pos.z);
    albedoMesh.renderOrder = 1;
    this.albedo.add(albedoMesh);

    // Occluder for the GI solver: opaque, non-emitting.
    const rcMesh = new THREE.Mesh(
      geo.clone(),
      new THREE.MeshBasicMaterial({ color: 0x000000 }),
    );
    rcMesh.position.copy(albedoMesh.position);
    this.rcScene.add(rcMesh);
  }

  private addFish(e: Entity): void {
    if (e.shape.kind !== 'sphere') return;
    const r = e.shape.radius * e.transform.scale;
    const tint = new THREE.Color(...e.material.emissive);
    const phase = (e.id * 2.399963) % 6.2831853; // golden-angle hash

    // Albedo: body silhouette + tail + eye, tinted toward the glow color.
    const bodyColor = new THREE.Color(0.13, 0.16, 0.2).lerp(tint, 0.3);
    const albedoGroup = new THREE.Group();
    const body = new THREE.Mesh(fishBodyGeometry(r), new THREE.MeshBasicMaterial({ color: bodyColor }));
    const tail = new THREE.Mesh(
      fishTailGeometry(r),
      new THREE.MeshBasicMaterial({ color: bodyColor.clone().multiplyScalar(0.8) }),
    );
    tail.position.x = -0.8 * r;
    const eye = new THREE.Mesh(
      new THREE.CircleGeometry(0.16 * r, 12),
      new THREE.MeshBasicMaterial({ color: 0xe8eef2 }),
    );
    eye.position.set(0.62 * r, 0.2 * r, 0.01);
    albedoGroup.add(body, tail, eye);
    albedoGroup.renderOrder = 2;
    this.albedo.add(albedoGroup);

    // Emission: soft full-res glow around the fish.
    const glowR = 2.6 * r;
    const glowMat = new THREE.ShaderMaterial({
      vertexShader: SPRITE_VS,
      fragmentShader: GLOW_FS,
      uniforms: {
        uColor: { value: tint },
        uStrength: { value: e.material.emissiveStrength },
        uRadius: { value: glowR },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const emissionMesh = new THREE.Mesh(new THREE.PlaneGeometry(glowR * 2, glowR * 2), glowMat);
    this.emission.add(emissionMesh);

    // GI light source: a soft-edged area disc, larger than the fish body so
    // it has real angular extent (fish don't occlude — they float above the
    // light plane). Transparent so the soft rim alpha-blends onto the scene.
    const coreR = 1.35 * r;
    const rcMat = new THREE.ShaderMaterial({
      vertexShader: SPRITE_VS,
      fragmentShader: CORE_FS,
      uniforms: {
        uColor: {
          value: tint
            .clone()
            .multiplyScalar(this.boost * e.material.emissiveStrength),
        },
        uRadius: { value: coreR },
      },
      transparent: true,
      depthWrite: false,
    });
    const rcMesh = new THREE.Mesh(new THREE.CircleGeometry(coreR, 40), rcMat);
    this.rcScene.add(rcMesh);

    this.fish.set(e.id, {
      albedoGroup,
      emissionMesh,
      rcMesh,
      tail,
      glowMats: [glowMat],
      rcMat,
      tint,
      phase,
    });
  }

  /** Sync visual objects from world state. Pure read of the world. */
  update(world: World, time: number): void {
    for (const e of world.entities) {
      const f = this.fish.get(e.id);
      if (!f) continue;
      const p = e.transform.pos;
      f.albedoGroup.position.set(p.x, p.y, p.z);
      f.albedoGroup.rotation.z = e.transform.yaw;
      f.emissionMesh.position.set(p.x, p.y, p.z);
      f.rcMesh.position.set(p.x, p.y, p.z);
      // Tail wiggle only — glow pulse disabled while diagnosing GI smoothness
      // (a pulsing source makes it impossible to tell noise from intent).
      f.tail.rotation.z = Math.sin(time * 6.0 + f.phase) * 0.3;
      const glowMat = f.glowMats[0]!;
      (glowMat.uniforms['uStrength'] as THREE.IUniform).value = e.material.emissiveStrength;
      (f.rcMat.uniforms['uColor']!.value as THREE.Color)
        .copy(f.tint)
        .multiplyScalar(this.boost * e.material.emissiveStrength);
    }
  }

  dispose(): void {
    for (const scene of [this.albedo, this.emission, this.rcScene]) {
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          (obj.material as THREE.Material).dispose();
        }
      });
    }
  }
}
