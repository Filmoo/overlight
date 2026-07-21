# overlight

A modular real-time rendering engine for OBS overlays. Maps describe worlds;
renderers interpret them; the two never touch. Swap rendering techniques with a
query param.

**Status: v0.1** — architecture skeleton with the `flat` debug renderer and the
`glowfish-topdown` map. The first real technique (2D radiance cascades GI) lands
in v0.2.

## Quick start (dev)

```sh
npm install
npm run dev
```

- Overlay: `http://localhost:5173/?map=glowfish-topdown&renderer=flat`
- Control panel: `http://localhost:5173/control.html`

Outside OBS the overlay shows a checkerboard backdrop so you can see the
transparency; inside OBS it is automatically transparent.

## Add to OBS

1. Sources → **+** → **Browser**
2. URL: paste from the control panel (or hand-write, see params below)
3. Width/Height: match your OBS canvas (e.g. 1920×1080)

That's it. For a no-server setup, `npm run build:single` produces
`dist-single/index.html` — one self-contained file. Use a `file:///` URL with
query params in the Browser source URL field.

## URL params

| param      | default            | meaning                                     |
| ---------- | ------------------ | ------------------------------------------- |
| `map`      | `glowfish-topdown` | which world to load                         |
| `renderer` | `flat`             | which rendering technique draws it          |
| `fps`      | `60`               | render cap (15–120); match your stream      |
| `debug`    | auto               | `1` forces the checkerboard backdrop        |

## Architecture

The short version: the world is always authored in 3D; renderers only read it;
adding a renderer touches one folder and one registry line. The long version
with the rules and the roadmap: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Versioning

[SemVer](https://semver.org/) tags, [Conventional Commits](https://www.conventionalcommits.org/),
history in [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE)
