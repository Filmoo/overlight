# overlight architecture

## The two rules

1. **The world is always 3D.** Maps are authored in 3D world-space, no matter
   which renderer draws them today. A 2D renderer projects the world; a 3D
   renderer inhabits it. Maps never know or care which.
2. **Renderers only read.** The dependency arrow points one way:
   `render → world`. Nothing in `world/` or `sim/` may import from `render/`.
   Elements describe *what they physically are* (shape, albedo, emission,
   media); renderers *interpret* those properties as well as their technique
   allows. An element never names a renderer.

Consequence: every map runs on every renderer, always — some just look better.
Rendering quality is a property of the renderer, never a requirement of the
map.

## Layers

```
┌─────────────────────────────────────────────────┐
│ host/    OBS adapter: canvas, config from URL,  │
│          transparency, FPS cap                  │
├─────────────────────────────────────────────────┤
│ world/   entities + components (pure data):     │
│          Transform, Shape, Material · maps as   │
│          JSON · prefabs as templates            │
├─────────────────────────────────────────────────┤
│ sim/     systems that mutate world state        │
│          (wander, later: spawns, Twitch events) │
│          knows nothing about rendering          │
├─────────────────────────────────────────────────┤
│ render/  api/ (interface, registry, extract     │
│          toolkit) + one folder per renderer     │
│          reads world, never writes              │
├─────────────────────────────────────────────────┤
│ main.ts  glue: load map → pick renderer →       │
│          loop { sim.tick(); renderer.render() } │
└─────────────────────────────────────────────────┘
```

## The renderer contract

```ts
interface RendererModule {
  readonly id: string;
  readonly capabilities: readonly Capability[];
  init(ctx: RenderContext, world: World): void;
  resize(width: number, height: number): void;
  render(world: World, dt: number, time: number): void; // read-only!
  dispose(): void;
}
```

Renderers are registered lazily in `render/api/registry.ts` and selected with
`?renderer=<id>`. The `flat` renderer is the permanent ground truth: unlit,
always correct, the fallback when anything breaks.

### Adding a renderer

1. Create `src/render/<id>/index.ts` exporting a factory that returns a
   `RendererModule`.
2. Use the shared `render/api/extract/` helpers for world→input conversion
   (planar projection, later: SDF scene functions, light lists). Add new
   extractors there — shared, tested, reused.
3. Register one lazy line in `render/api/registry.ts`.
4. Done. If you touched `world/` or `sim/`, you did it wrong.

### Extraction toolkit (`render/api/extract/`)

The hard part of integrating a technique is converting the world into what the
technique eats. That conversion lives here, shared between renderers:

- `planar.ts` — fit/project the 3D world onto a plane (top-down for now).
  Used by `flat`; `rc2d` will build its emission/albedo/occluder textures on
  top of it.
- (planned) `sdf.ts` — world → GLSL SDF scene function, for raymarchers.
- (planned) `lights.ts` — world → flat emitter list.

## Maps, prefabs, elements

- **Prefabs** (`world/prefabs.ts`) are element templates: shape + material +
  semantic tags (`wander`, `emitter`, `occluder`, `floor`).
- **Maps** (`world/maps/*.json`) place prefabs with overrides (pos, tint,
  scale) inside 3D bounds, plus a *suggested* view. Maps are pure data —
  auto-discovered from the folder.
- **Materials are semantic** (albedo, emission, later media/IOR): each
  renderer maps them to its own passes. Water in rc2d = tint + projected
  caustics; the same water in a path tracer = a real refractive medium. Same
  map file, different fidelity — by design.

## Roadmap

| version | goal                                                               |
| ------- | ------------------------------------------------------------------ |
| v0.1    | skeleton: host + world + sim + flat renderer + control panel       |
| v0.2    | `rc2d` renderer: JFA distance field + radiance cascades 2D GI      |
| v0.3    | media interpretation: water tint, projected caustics, god rays     |
| v0.4    | spawn API (console-callable) — the future Twitch hook point        |
| v0.5    | second non-aquarium map to prove generality                        |

Heavy experiments (path tracing, radiant foam, splatting) live in
`experiments/` when they arrive — never on the live overlay path.
