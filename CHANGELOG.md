# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[SemVer](https://semver.org/).

## [0.2.8] - 2026-07-21

Studied a complete reference implementation and fixed the ringing at its
root instead of hacking around it.

### Fixed

- **The bilinear fix** — the actual cure for radiance-cascade ringing. A
  child probe sits at exactly the 0.25 or 0.75 point between two parent
  probes; the merge now uses those parity-based weights instead of the naive
  continuous lerp, which is the textbook cause of the rings. This removed
  the gross ringing that no amount of tuning could.
- Intervals matched to the reference (`[L·4^(n-1), L·4^n)`), and every
  compensating hack removed: the cascade "feather" cross-fade and the
  interval pull-back are gone — both were papering over the wrong weights.
- Soft-edged **area-light** emitters (was a solid disc): a point source is
  RC's worst case, an area source its best, so a larger soft disc reads far
  smoother. Default cascade-0 directions 4 → 16.

### Added

- Resolve → separable-blur → composite tail: cascade 0 is resolved to a
  per-pixel irradiance, optionally blurred, then shaded. The blur plus a
  reduced-resolution GI buffer (upsampled with hardware bilinear, like the
  reference) erase the last probe-grid residue. New `blur` param.
- `test-single` map (one static orb) + `orb-glow` prefab — the light-field
  diagnostic scene; maps being pure data made this a 10-line addition.

### Changed

- Defaults tuned on the single-orb close-up: GI resolution 0.5, base
  interval 4px, 16 directions, blur 1.5. Removed the `feather` param.

## [0.2.7] - 2026-07-21

### Fixed

- THE gradient bug: GI light cores had a radial falloff (added in 0.2.2 to
  hide rings), but rays always stop at a source's edge — so every distant ray
  sampled the near-zero rim and the light field's 1/r falloff collapsed into
  a tight halo + darkness. Emitters are now solid, like every reference
  implementation; pools finally spread across the scene and blend.
- Added a debug view param (0 final · 1 raw GI field · 2 no glow) — judging
  the solver without the cosmetic layers is what exposed the bug.

## [0.2.6] - 2026-07-21

### Fixed

- Aligned the cascade solve with the canonical reference (jason.today/rc),
  removing the artifacts that tuning could not fix:
  - canonical intervals (`start = 4^(n-1)·L`, `length = 4^n·L`) with their
    built-in 25% overlap — cascade range rings gone structurally, c0 interval
    shrinks 8px → 2px so the near field is resolved by the densest probes;
  - deterministic rays by default (jitter now opt-in, default 0) — the petal
    noise around bright cores was the jitter itself;
  - hits sample the scene at the ray position again (MSAA + soft cores make
    that clean), matching the reference;
  - GI buffer at full resolution by default (was 0.7x) — rock shadow edges
    and near-fish gradients are no longer upsampled.
- Colored rings around bright glows ("light rounds"): the tonemapper
  compressed per channel, saturating the dominant channel first; now
  Reinhard on luminance — hue survives, cores stay colored.
- Temporal history relaxed to 0.3 (stability assist, no longer doing the
  smoothing the solver should do itself).

## [0.2.5] - 2026-07-21

### Added

- Tuning panel: any renderer exposing `params`/`setParam` gets live sliders
  (auto-shown outside OBS, `?tune=1` to force). Values persist per renderer
  in localStorage — the overlay applies them with or without the panel — plus
  an fps/ms readout and reset. rc2d exposes: GI resolution, cascade-0
  direction count, base interval, temporal history, cascade feather, light
  intensity, ambient level, emitter boost.

### Fixed

- Pixelated near-field shadows: cascade 0 now defaults to the canonical
  4-direction layout, doubling probe density (2px grid) where shadow edges
  are resolved; direction count is tunable (4 vs 16) for live comparison.
- Visible cascade range rings: hits near an interval's far boundary now
  cross-fade into the upper cascade's estimate (feathered hand-off) instead
  of switching hard at a fixed radius.

## [0.2.4] - 2026-07-21

### Fixed

- The "curtain"/moiré patterns in the light field — two structural bugs:
  - The GI buffer had arbitrary dimensions, so cascade tiles were
    fractional pixels wide; probes sat at inconsistent positions across
    cascades and interfered. The buffer is now sized to a multiple of the
    top cascade's tile count — every tile is integer-sized.
  - Cascade merging and composite integration used hardware bilinear
    filtering, which bleeds across tile borders (different ray directions!)
    and biases probes near screen edges. Both now use manual bilinear with
    texelFetch, clamped per-axis inside each tile.

### Changed

- Diagnostic mode (temporary): flat sand/rock colors, no water grade, no
  glow pulse — so GI smoothness can be judged without cosmetic layers.
  Texture detail returns after sign-off.

## [0.2.3] - 2026-07-21

### Fixed

- Dark rows in lit sand: removed the sand shader's sine "ripple" term — it
  drew periodic dark stripes that light made visible.
- Shadow fins on the lit side of rocks: tangent rays no longer eat light
  (hit epsilon 1.0 → 0.5 with a conservative march step), and the cascade
  interval overlap is half a probe spacing instead of a full one (the full
  overlap made cascades 0 and 1 disagree near occluders).
- Fan-shaped penumbra steps: per-frame direction jitter within each ray's
  cone, integrated by the temporal history — 16 hard directions become
  effectively continuous soft penumbras.

### Changed

- GI buffer 0.6x → 0.7x canvas; march budget 32 → 40 steps; history weight
  0.85. Still ~4 ms per frame.

## [0.2.2] - 2026-07-21

### Fixed

- Jagged silhouettes: 4x MSAA on all geometry passes (albedo, emission, GI
  scene) — rock rims, fish outlines, and the tank border are clean.
- Light-pool rings: GI light cores now have a radial falloff, so rays hitting
  the rim pick up dimmer color and pools fade smoothly (emission boost
  retuned to compensate).
- Gradient banding: dithered before 8-bit output — Mach bands on the large
  smooth dark gradients are gone.

### Changed

- GI buffer 0.5x → 0.6x canvas resolution for finer shadow gradients
  (still ~4 ms per frame with MSAA).

## [0.2.1] - 2026-07-21

### Fixed

- rc2d flicker: float32 JFA seeds (half precision wobbled at large
  coordinates) + a temporal accumulation pass (EMA over frames) stabilize the
  light field.
- rc2d hit-color noise ("weird patterns"): rays now sample the emitter color
  at the exact nearest surface via the seed map instead of the march position,
  which often landed on an empty texel and read black.
- rc2d light seams: cascade ray intervals now overlap by one probe spacing so
  emitters no longer pop when crossing interval boundaries.
- Softer glow pulse (8% → 5%).

## [0.2.0] - 2026-07-21

### Added

- `rc2d` renderer: real-time 2D global illumination via radiance cascades —
  scene passes (albedo / emission / GI scene) → jump-flood distance field →
  cascade solve (16 directions at cascade 0, 4× per level) → tonemapped
  composite with premultiplied alpha for OBS. ~2–4 ms per frame at 1080p.
- Visual pass: procedural sand (fbm grain), shaded rocks, fish silhouettes
  with wiggling tails and eyes, soft glow gradients with a gentle pulse.
- `rc2d` is now the default renderer; `flat` remains available as ground truth.

### Changed

- Cooler sand and lighter rock palette in the world prefabs (map data, applies
  to all renderers).

## [0.1.0] - 2026-07-21

### Added

- Architecture skeleton: `host` / `world` / `sim` / `render` layers with
  one-way dependencies (world is always 3D; renderers only read).
- Renderer contract + lazy registry, selected via `?renderer=`.
- `flat` debug renderer (Three.js, unlit ground truth) with transparent
  output for OBS and letterboxed top-down fit.
- `glowfish-topdown` map: sand, rocks, six glowing wandering fish.
- Wander simulation system (3D: XY roam + Z bob), independent of rendering.
- OBS host layer: URL-param config, FPS-capped loop, auto checkerboard
  backdrop outside OBS.
- Control panel (`control.html`): visual URL builder with live preview.
- Single-file overlay build (`npm run build:single`).
