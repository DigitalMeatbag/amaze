# amaze

ASCII maze wallpaper for Wallpaper Engine. Generates a full-screen maze, animates solver algorithms traversing it, and resets into a new maze on repeat.

## Governing Documents

The highest-versioned foundation and spec documents are authoritative:

- `amaze_vN_foundation.md` — intent, philosophy, closed decisions
- `amaze_vN_spec.md` — implementation contract, acceptance criteria

Lower-versioned docs are reference only. When the spec and foundation conflict, the foundation's intent is authoritative and the spec should be updated to match.

## Runtime Environment

amaze runs inside Wallpaper Engine's Chromium-based renderer as a local web page (`index.html`). It is not a Node.js application.

- **No ES modules** — plain global-scope JS only; no `import`/`export`
- **No bundler** — files load directly via `<script>` tags in `index.html`
- **No network access** at runtime — all assets must be local
- **WE property API** — user properties arrive via `window.wallpaperPropertyListener`; property keys match the names in `project.json`

## Project Structure

| Path | Role |
|---|---|
| `main.js` | Top-level orchestrator; run loop, WE integration, cursor state |
| `renderer.js` | Canvas 2D renderer; glyph drawing, glow, flicker, HUD draw call. Entry point for all rendering work — `render/` contains utilities it draws on |
| `maze.js` | Maze cell model and grid utilities |
| `attention.js` | Attention field computation; solver + cursor light blend |
| `hud/` | HUD state, layout, and canvas rendering |
| `generators/` | Maze generators (backtracker, prims, division, organic, roomcorridor) |
| `solvers/` | Solver implementations (dfs, bfs, astar, greedy, wallfollower, randomwalk) |
| `themes/` | Theme definitions (forest, desert, stone, void, water, lava, cold) |
| `cycle/` | Cycle state machine |
| `events/` | Lifecycle event bus |
| `config/` | Shared configuration |
| `render/` | Render utilities |
| `tools/` | Development tools (not part of wallpaper runtime) |

## Verification

**Syntax check** individual files before declaring work complete:

```
node --check <filename>
```

**Visual testing** — start a Python server in the project directory and open it in a browser:

```
python -m http.server 8765
```

Then open `http://127.0.0.1:8765/index.html`. The wallpaper runs with default property values in this context. For full property-driven behavior, testing in Wallpaper Engine is required.

Headless Edge cannot verify maze behavior — the maze will not initialize outside the WE runtime because the property system that bootstraps the cycle is absent.

## WE Property Reference

| Key | Type | Default |
|---|---|---|
| `theme` | combo | `random` |
| `scale` | combo | `medium` |
| `intensity` | combo | `medium` |
| `stepInterval` | slider | `80` (ms) |
| `fadeOpacity` | slider | `0` |
| `maxSolveTime` | slider | `1.0` (multiplier on grid-aware default) |
| `cursorLight` | bool | `true` |
| `hudVisible` | bool | `true` |
