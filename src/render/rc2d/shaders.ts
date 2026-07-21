/**
 * Screen-space shaders for the rc2d pipeline:
 * JFA seed/step/distance → radiance cascades → composite.
 * All distances are in pixels of the (half-res) GI buffer.
 */

export const JFA_SEED_FS = /* glsl */ `
precision highp float;
uniform sampler2D uScene; // rgb: emission, a: surface (emitter or occluder)
uniform vec2 uRes;
in vec2 vUv;
out vec4 outColor;
void main() {
  float a = texture(uScene, vUv).a;
  outColor = a > 0.5 ? vec4(vUv * uRes, 0.0, 1.0) : vec4(-1e4, -1e4, 0.0, 0.0);
}
`;

export const JFA_STEP_FS = /* glsl */ `
precision highp float;
uniform sampler2D uPrev; // rg: nearest seed position (px)
uniform vec2 uRes;
uniform float uOffset;   // jump distance in px
in vec2 vUv;
out vec4 outColor;
void main() {
  vec2 px = vUv * uRes;
  vec2 best = vec2(-1e4);
  float bestD = 1e12;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 uv = vUv + vec2(float(x), float(y)) * uOffset / uRes;
      if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) continue;
      vec2 seed = texture(uPrev, uv).rg;
      if (seed.x < -1e3) continue;
      float d = dot(px - seed, px - seed);
      if (d < bestD) { bestD = d; best = seed; }
    }
  }
  outColor = vec4(best, 0.0, 1.0);
}
`;

export const JFA_DIST_FS = /* glsl */ `
precision highp float;
uniform sampler2D uSeeds;
uniform vec2 uRes;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec2 seed = texture(uSeeds, vUv).rg;
  float d = seed.x < -1e3 ? 1e4 : distance(vUv * uRes, seed);
  outColor = vec4(d, 0.0, 0.0, 1.0);
}
`;

export const CASCADE_FS = /* glsl */ `
precision highp float;
uniform sampler2D uScene;   // rgb: emission, a: surface
uniform sampler2D uDist;    // r: distance field (px)
uniform sampler2D uSeeds;   // rg: nearest surface position (px)
uniform sampler2D uUpper;   // cascade n+1
uniform bool uHasUpper;
uniform vec2 uRes;          // GI buffer resolution (px)
uniform float uCascadeIndex;
uniform float uBasePx;      // cascade 0 interval length (px)
in vec2 vUv;
out vec4 outColor;

const float TAU = 6.28318530718;

void main() {
  float n = uCascadeIndex;
  float tiles = pow(2.0, n + 2.0);        // direction tiles per axis (16 dirs at c0)
  vec2 px = vUv * uRes;
  vec2 tileSize = uRes / tiles;
  vec2 tile = floor(px / tileSize);
  vec2 probeUV = (px - tile * tileSize) / tileSize; // probe position, 0..1 of screen
  vec2 probePx = probeUV * uRes;
  float dirCount = tiles * tiles;
  float dirIndex = tile.y * tiles + tile.x;
  float ang = TAU * (dirIndex + 0.5) / dirCount;
  vec2 dir = vec2(cos(ang), sin(ang));

  // Geometric ray intervals: cascade n covers [t0, t1), each 4x the previous.
  // Intervals overlap by one probe spacing to hide the seams between cascades.
  float t0 = max(0.0, uBasePx * (pow(4.0, n) - 1.0) / 3.0 - tiles);
  float t1 = uBasePx * (pow(4.0, n + 1.0) - 1.0) / 3.0;

  vec3 radiance = vec3(0.0);
  bool hit = false;
  float t = t0;
  for (int i = 0; i < 32; i++) {
    vec2 p = probePx + dir * t;
    if (p.x < 0.0 || p.y < 0.0 || p.x >= uRes.x || p.y >= uRes.y) break;
    float d = texture(uDist, p / uRes).r;
    if (d < 1.0) {
      // Sample the emitter color at the actual surface (via the seed map),
      // not at the march position — the march position often lands on an
      // empty texel next to the surface and reads black.
      vec2 seed = texture(uSeeds, p / uRes).rg;
      radiance = texture(uScene, seed / uRes).rgb;
      hit = true;
      break;
    }
    t += d;
    if (t > t1) break;
  }

  if (!hit && uHasUpper) {
    // Merge the 4 child directions from the upper cascade, bilinearly at
    // this probe's position (clamped inside each tile to avoid bleeding).
    float tilesU = tiles * 2.0;
    vec2 probesU = uRes / tilesU;
    vec2 margin = 0.5 / probesU;
    vec2 pc = clamp(probeUV, margin, 1.0 - margin);
    vec3 sum = vec3(0.0);
    for (int k = 0; k < 4; k++) {
      float dU = dirIndex * 4.0 + float(k);
      vec2 tU = vec2(mod(dU, tilesU), floor(dU / tilesU));
      sum += texture(uUpper, (tU + pc) / tilesU).rgb;
    }
    radiance = sum * 0.25;
  }

  outColor = vec4(radiance, 1.0);
}
`;

export const TEMPORAL_FS = /* glsl */ `
precision highp float;
uniform sampler2D uCurr;
uniform sampler2D uPrev;
uniform float uBlend; // history weight
in vec2 vUv;
out vec4 outColor;
void main() {
  vec3 curr = texture(uCurr, vUv).rgb;
  vec3 prev = texture(uPrev, vUv).rgb;
  outColor = vec4(mix(curr, prev, uBlend), 1.0);
}
`;

export const COMPOSITE_FS = /* glsl */ `
precision highp float;
uniform sampler2D uAlbedo;    // full-res albedo (a: coverage)
uniform sampler2D uEmission;  // full-res emission glows
uniform sampler2D uCascade0;  // GI result, 2x2 direction tiles
uniform vec2 uGiRes;
uniform vec3 uAmbient;
uniform float uIntensity;
in vec2 vUv;
out vec4 outColor;

void main() {
  vec4 albedo = texture(uAlbedo, vUv);
  vec4 emission = texture(uEmission, vUv);

  // Average the 16 cascade-0 directions -> incoming radiance at this pixel.
  vec2 margin = 2.0 / uGiRes;
  vec2 pc = clamp(vUv, margin, 1.0 - margin);
  vec3 irr = vec3(0.0);
  for (int k = 0; k < 16; k++) {
    vec2 tile = vec2(float(k % 4), float(k / 4));
    irr += texture(uCascade0, (tile + pc) * 0.25).rgb;
  }
  irr *= 1.0 / 16.0;

  vec3 lit = albedo.rgb * (uAmbient + irr * uIntensity) + emission.rgb;

  // Subtle cool water grade, tonemap, gentle contrast, gamma.
  lit *= vec3(0.92, 0.98, 1.06);
  lit = lit / (lit + 1.0);
  lit = mix(lit, lit * lit * (3.0 - 2.0 * lit), 0.35);
  lit = pow(lit, vec3(1.0 / 2.2));

  // Dither before 8-bit quantization: large smooth dark gradients would
  // otherwise show visible banding (Mach bands).
  float dn = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  lit += (dn - 0.5) / 255.0;

  float alpha = max(albedo.a, min(1.0, max(emission.r, max(emission.g, emission.b))));
  outColor = vec4(lit * alpha, alpha); // premultiplied for OBS compositing
}
`;
