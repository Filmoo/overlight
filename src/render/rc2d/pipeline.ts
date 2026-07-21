import * as THREE from 'three';

/** Small helpers for screen-space passes: render targets + a fullscreen quad. */

export interface TargetOpts {
  filter?: THREE.MagnificationTextureFilter;
  type?: THREE.TextureDataType;
}

export function makeTarget(w: number, h: number, opts: TargetOpts = {}): THREE.WebGLRenderTarget {
  const filter = opts.filter ?? THREE.LinearFilter;
  return new THREE.WebGLRenderTarget(w, h, {
    type: opts.type ?? THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: filter,
    magFilter: filter,
    depthBuffer: false,
    stencilBuffer: false,
  });
}

export const FULLSCREEN_VS = /* glsl */ `
precision highp float;
in vec3 position;
out vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/** A single fullscreen triangle reused by every screen-space pass. */
export class FSQuad {
  private scene = new THREE.Scene();
  private camera = new THREE.Camera();
  private mesh: THREE.Mesh;

  constructor() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3),
    );
    this.mesh = new THREE.Mesh(geo);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }

  render(
    renderer: THREE.WebGLRenderer,
    material: THREE.Material,
    target: THREE.WebGLRenderTarget | null,
  ): void {
    this.mesh.material = material;
    renderer.setRenderTarget(target);
    renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
  }
}

export function rawMaterial(
  fragmentShader: string,
  uniforms: Record<string, THREE.IUniform>,
): THREE.RawShaderMaterial {
  return new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: FULLSCREEN_VS,
    fragmentShader,
    uniforms,
    depthTest: false,
    depthWrite: false,
  });
}
