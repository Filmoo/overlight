# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[SemVer](https://semver.org/).

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
