# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[SemVer](https://semver.org/).

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
