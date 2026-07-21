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
uniform float uJitter;      // fresh random per frame, 0..1
uniform float uTileExp;     // tiles at c0 = 2^uTileExp (1 → 4 dirs, 2 → 16 dirs)
uniform float uFeather;     // cross-fade width at cascade boundaries, 0..1
in vec2 vUv;
out vec4 outColor;

const float TAU = 6.28318530718;

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

void main() {
  float n = uCascadeIndex;
  float tiles = pow(2.0, n + uTileExp);   // direction tiles per axis
  vec2 px = vUv * uRes;
  vec2 tileSize = uRes / tiles;
  vec2 tile = floor(px / tileSize);
  vec2 probeUV = (px - tile * tileSize) / tileSize; // probe position, 0..1 of screen
  vec2 probePx = probeUV * uRes;
  float dirCount = tiles * tiles;
  float dirIndex = tile.y * tiles + tile.x;

  // Per-frame jitter within this ray's angular cone: the temporal history
  // integrates it into an effectively continuous set of directions,
  // turning the hard direction fan into smooth penumbras.
  float rnd = hash13(vec3(probePx, dirIndex + uJitter * 61.803));
  float ang = TAU * (dirIndex + 0.25 + 0.5 * rnd) / dirCount;
  vec2 dir = vec2(cos(ang), sin(ang));

  // Geometric ray intervals: cascade n covers [t0, t1), each 4x the previous,
  // with half a probe spacing of overlap to hide seams between cascades.
  float t0 = max(0.0, uBasePx * (pow(4.0, n) - 1.0) / 3.0 - tiles * 0.5);
  float t1 = uBasePx * (pow(4.0, n + 1.0) - 1.0) / 3.0;

  vec3 hitCol = vec3(0.0);
  bool hit = false;
  float tHit = t1;
  float t = t0;
  for (int i = 0; i < 40; i++) {
    vec2 p = probePx + dir * t;
    if (p.x < 0.0 || p.y < 0.0 || p.x >= uRes.x || p.y >= uRes.y) break;
    float d = texture(uDist, p / uRes).r;
    if (d < 0.5) {
      // Sample the emitter color at the actual surface (via the seed map),
      // not at the march position — the march position often lands on an
      // empty texel next to the surface and reads black.
      vec2 seed = texture(uSeeds, p / uRes).rg;
      hitCol = texture(uScene, seed / uRes).rgb;
      hit = true;
      tHit = t;
      break;
    }
    t += max(d, 0.5);
    if (t > t1) break;
  }

  // Cross-fade band at the far end of the interval: a hit near the boundary
  // blends toward the upper cascade's estimate instead of switching hard.
  // Kills the visible rings at cascade range boundaries.
  float band = uFeather * 0.35 * (t1 - t0);
  float w = hit ? smoothstep(t1 - band, t1, tHit) : 1.0;

  vec3 merged = vec3(0.0);
  if (uHasUpper && w > 0.001) {
    // Merge the 4 child directions from the upper cascade with MANUAL
    // bilinear filtering (texelFetch): hardware filtering near tile borders
    // bleeds into neighboring tiles — which hold different directions — and
    // clamping shifts edge probes inward, biasing the field near edges.
    float tilesU = tiles * 2.0;
    vec2 tileSizeU = uRes / tilesU;               // exact integers by construction
    vec2 gp = probeUV * tileSizeU - 0.5;          // position in upper-probe units
    vec2 base = floor(gp);
    vec2 fw = gp - base;
    vec2 mx = tileSizeU - 1.0;
    vec2 p00 = clamp(base, vec2(0.0), mx);
    vec2 p11 = clamp(base + 1.0, vec2(0.0), mx);
    vec3 sum = vec3(0.0);
    for (int k = 0; k < 4; k++) {
      float dU = dirIndex * 4.0 + float(k);
      vec2 tO = vec2(mod(dU, tilesU), floor(dU / tilesU)) * tileSizeU;
      vec3 s00 = texelFetch(uUpper, ivec2(tO + vec2(p00.x, p00.y)), 0).rgb;
      vec3 s10 = texelFetch(uUpper, ivec2(tO + vec2(p11.x, p00.y)), 0).rgb;
      vec3 s01 = texelFetch(uUpper, ivec2(tO + vec2(p00.x, p11.y)), 0).rgb;
      vec3 s11 = texelFetch(uUpper, ivec2(tO + vec2(p11.x, p11.y)), 0).rgb;
      sum += mix(mix(s00, s10, fw.x), mix(s01, s11, fw.x), fw.y);
    }
    merged = sum * 0.25;
  }

  vec3 radiance = hit ? mix(hitCol, merged, uHasUpper ? w : 0.0) : merged;
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
uniform sampler2D uCascade0;  // GI result, uTiles0 x uTiles0 direction tiles
uniform vec2 uGiRes;
uniform vec3 uAmbient;
uniform float uIntensity;
uniform int uTiles0;          // direction tiles per axis at cascade 0
in vec2 vUv;
out vec4 outColor;

void main() {
  vec4 albedo = texture(uAlbedo, vUv);
  vec4 emission = texture(uEmission, vUv);

  // Average the cascade-0 directions -> incoming radiance at this pixel.
  // Manual bilinear per tile (same reasoning as the cascade merge).
  vec2 tileSize0 = uGiRes / float(uTiles0);
  vec2 gp = vUv * tileSize0 - 0.5;
  vec2 base = floor(gp);
  vec2 fw = gp - base;
  vec2 mx = tileSize0 - 1.0;
  vec2 p00 = clamp(base, vec2(0.0), mx);
  vec2 p11 = clamp(base + 1.0, vec2(0.0), mx);
  vec3 irr = vec3(0.0);
  int dirs = uTiles0 * uTiles0;
  for (int k = 0; k < 16; k++) {
    if (k >= dirs) break;
    vec2 tO = vec2(float(k % uTiles0), float(k / uTiles0)) * tileSize0;
    vec3 s00 = texelFetch(uCascade0, ivec2(tO + vec2(p00.x, p00.y)), 0).rgb;
    vec3 s10 = texelFetch(uCascade0, ivec2(tO + vec2(p11.x, p00.y)), 0).rgb;
    vec3 s01 = texelFetch(uCascade0, ivec2(tO + vec2(p00.x, p11.y)), 0).rgb;
    vec3 s11 = texelFetch(uCascade0, ivec2(tO + vec2(p11.x, p11.y)), 0).rgb;
    irr += mix(mix(s00, s10, fw.x), mix(s01, s11, fw.x), fw.y);
  }
  irr *= 1.0 / float(dirs);

  vec3 lit = albedo.rgb * (uAmbient + irr * uIntensity) + emission.rgb;

  // DIAGNOSTIC MODE: plain tonemap + gamma only — no grade, no contrast
  // curve — so the light field is seen as-is.
  lit = lit / (lit + 1.0);
  lit = pow(lit, vec3(1.0 / 2.2));

  // Dither before 8-bit quantization: large smooth dark gradients would
  // otherwise show visible banding (Mach bands).
  float dn = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  lit += (dn - 0.5) / 255.0;

  float alpha = max(albedo.a, min(1.0, max(emission.r, max(emission.g, emission.b))));
  outColor = vec4(lit * alpha, alpha); // premultiplied for OBS compositing
}
`;
