import * as THREE from 'three';
import { depth01, type Entity, type World } from '../../world/components';
import { fitTopDown } from '../api/extract/planar';
import type { Capability, RenderContext, RendererModule } from '../api/renderer';

/**
 * The flat renderer: unlit, honest, always correct.
 * It exists as ground truth for maps and as the fallback when a fancy
 * renderer breaks. It never goes away.
 */

function displayColor(e: Entity): THREE.Color {
  const [ar, ag, ab] = e.material.albedo;
  const [er, eg, eb] = e.material.emissive;
  const s = e.material.emissiveStrength;
  return new THREE.Color(
    Math.min(1, ar + er * s),
    Math.min(1, ag + eg * s),
    Math.min(1, ab + eb * s),
  );
}

class FlatRenderer implements RendererModule {
  readonly id = 'flat';
  readonly capabilities: readonly Capability[] = ['unlit'];

  private three!: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera();
  private meshes = new Map<number, THREE.Mesh>();
  private world!: World;

  init(ctx: RenderContext, world: World): void {
    this.world = world;
    this.three = new THREE.WebGLRenderer({ canvas: ctx.canvas, alpha: true, antialias: true });
    this.three.setPixelRatio(1); // OBS canvas is native res; never upscale
    this.three.setClearColor(0x000000, 0); // transparent everywhere outside the map

    for (const e of world.entities) {
      const mesh = this.buildMesh(e);
      mesh.position.set(e.transform.pos.x, e.transform.pos.y, e.transform.pos.z);
      this.scene.add(mesh);
      this.meshes.set(e.id, mesh);
    }

    // Faint water film over the whole volume: shows the renderable space in OBS.
    const b = world.bounds;
    const film = new THREE.Mesh(
      new THREE.PlaneGeometry(b.max.x - b.min.x, b.max.y - b.min.y),
      new THREE.MeshBasicMaterial({
        color: 0x4db8ff,
        transparent: true,
        opacity: 0.05,
        depthWrite: false,
      }),
    );
    film.position.set((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, b.max.z + 0.05);
    this.scene.add(film);

    this.camera.position.set((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, b.max.z + 5);
    this.camera.near = 0.1;
    this.camera.far = b.max.z - b.min.z + 10;

    this.resize(ctx.width, ctx.height);
  }

  private buildMesh(e: Entity): THREE.Mesh {
    if (e.shape.kind === 'box') {
      const { x, y } = e.shape.size;
      return new THREE.Mesh(
        new THREE.PlaneGeometry(x * e.transform.scale, y * e.transform.scale),
        new THREE.MeshBasicMaterial({ color: displayColor(e) }),
      );
    }
    const r = e.shape.radius * e.transform.scale;
    return new THREE.Mesh(
      new THREE.CircleGeometry(r, 48),
      new THREE.MeshBasicMaterial({ color: displayColor(e), transparent: true }),
    );
  }

  resize(width: number, height: number): void {
    this.three.setSize(width, height, false);
    const f = fitTopDown(this.world.bounds, width, height);
    this.camera.left = -f.halfW;
    this.camera.right = f.halfW;
    this.camera.top = f.halfH;
    this.camera.bottom = -f.halfH;
    this.camera.updateProjectionMatrix();
  }

  render(world: World, _dt: number, _time: number): void {
    for (const e of world.entities) {
      const mesh = this.meshes.get(e.id);
      if (!mesh) continue;
      const p = e.transform.pos;
      mesh.position.set(p.x, p.y, p.z);
      if (e.tags.includes('wander')) {
        // Cheap depth cue: deeper (lower z) = smaller and fainter.
        const d = depth01(world.bounds, p.z);
        mesh.scale.setScalar(0.85 + 0.3 * d);
        (mesh.material as THREE.MeshBasicMaterial).opacity = 0.65 + 0.35 * d;
      }
    }
    this.three.render(this.scene, this.camera);
  }

  dispose(): void {
    this.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        (obj.material as THREE.Material).dispose();
      }
    });
    this.three.dispose();
  }
}

export const createFlatRenderer = (): RendererModule => new FlatRenderer();
