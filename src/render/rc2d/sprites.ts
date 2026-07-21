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

const SAND_FS = /* glsl */ `
uniform vec3 uColor;
varying vec2 vWorld;
${NOISE}
void main() {
  float grain = fbm(vWorld * 9.0) - 0.5;
  float patches = fbm(vWorld * 1.1) - 0.5;
  float ripple = sin(vWorld.x * 3.1 + fbm(vWorld * 0.9) * 6.0) * 0.5;
  vec3 c = uColor * (1.0 + grain * 0.04 + patches * 0.03 + ripple * 0.02);
  gl_FragColor = vec4(c, 1.0);
}
`;

const ROCK_FS = /* glsl */ `
uniform vec3 uColor;
uniform float uRadius;
varying vec2 vLocal;
varying vec2 vWorld;
${NOISE}
void main() {
  float r = length(vLocal) / uRadius;
  float rim = 1.0 - 0.35 * smoothstep(0.55, 1.0, r);       // darker edge
  float top = 1.0 + 0.12 * (vLocal.y / uRadius) * (1.0 - r); // faint top light
  float n = 1.0 + (fbm(vWorld * 5.0) - 0.5) * 0.22;
  gl_FragColor = vec4(uColor * rim * top * n, 1.0);
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
  rcMat: THREE.MeshBasicMaterial;
  tint: THREE.Color;
  phase: number;
}

export class SpriteWorld {
  readonly albedo = new THREE.Scene();
  readonly emission = new THREE.Scene();
  readonly rcScene = new THREE.Scene();
  private fish = new Map<number, FishParts>();

  /** Brightness of fish cores as GI light sources. */
  static readonly EMISSION_BOOST = 3.5;

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

    // GI light source: a solid bright core (fish don't occlude — they float).
    const rcMat = new THREE.MeshBasicMaterial({
      color: tint.clone().multiplyScalar(SpriteWorld.EMISSION_BOOST * e.material.emissiveStrength),
    });
    const rcMesh = new THREE.Mesh(new THREE.CircleGeometry(0.8 * r, 24), rcMat);
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
      // Tail wiggle + gentle glow pulse: renderer-side life, sim stays clean.
      f.tail.rotation.z = Math.sin(time * 6.0 + f.phase) * 0.3;
      const pulse = 1.0 + 0.05 * Math.sin(time * 1.3 + f.phase);
      const glowMat = f.glowMats[0]!;
      (glowMat.uniforms['uStrength'] as THREE.IUniform).value =
        e.material.emissiveStrength * pulse;
      f.rcMat.color
        .copy(f.tint)
        .multiplyScalar(SpriteWorld.EMISSION_BOOST * e.material.emissiveStrength * pulse);
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
