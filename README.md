# amaze

ASCII maze wallpaper for [Wallpaper Engine](https://www.wallpaperengine.io/). Generates mazes and animates solving algorithms traversing them in a continuous loop.

No build step. Plain ES6 modules, canvas 2D, Chromium runtime.

## How it works

Each cycle:
1. A maze is generated using a theme-weighted algorithm
2. Four solvers are chosen at random and run in sequence
3. Each solver searches for the goal, walks to it, holds briefly, then fades
4. The cycle resets with a new maze and theme

The HUD (top-left) shows the active theme, generator, current solver name and elapsed time, and previous solvers' times.

## Themes

| Key | Description |
|-----|-------------|
| `forest` | Greens and earth tones |
| `desert` | Amber and sandstone |
| `stone` | Cool greys |
| `void` | Deep blacks and purples |
| `water` | Blues and teals |
| `lava` | Reds and oranges |
| `cold` | Ice blues and whites |
| `random` | Picks a theme randomly each cycle |

Each theme biases generation toward certain maze algorithms that match its aesthetic.

## Generators

| Key | Algorithm |
|-----|-----------|
| `backtracker` | Recursive backtracker — long winding corridors |
| `prims` | Prim's — dense, organic branching |
| `division` | Recursive division — rectangular rooms and corridors |
| `organic` | Cellular automaton — cave-like open spaces |
| `roomcorridor` | Room-and-corridor — dungeon-style rooms connected by hallways |

## Solvers

Four of these six are selected randomly each cycle, in a random order:

| Key | Algorithm |
|-----|-----------|
| `dfs` | Depth-first search — deep stack-driven exploration |
| `bfs` | Breadth-first search — radiates outward uniformly |
| `astar` | A* — heuristic-guided shortest path |
| `greedy` | Greedy best-first — fast, inexact, heuristic only |
| `wallfollower` | Right-hand wall follower — traces walls continuously |
| `randomwalk` | Random walk — undirected brownian motion |

Frontier solvers (BFS, A*, Greedy) use a commit-to-path momentum system — the actor periodically breaks from the frontier to walk visibly through already-explored space.

## Configuration

All settings are exposed as Wallpaper Engine properties. Defaults also apply when running directly in a browser.

| Property | Default | Description |
|----------|---------|-------------|
| `theme` | `random` | Visual theme |
| `scale` | `medium` | Terminal grid density (`tiny` → `poster`) |
| `intensity` | `medium` | Glow and attention effect strength (`low`, `medium`, `high`) |
| `stepInterval` | `80ms` | Time between solver steps (20–500ms) |
| `fadeOpacity` | `0` | Opacity of completed solver trails (0 = fully faded) |
| `maxSolveTime` | `1.0×` | Timeout multiplier relative to grid size (0.25–4.0×) |
| `cursorLight` | `true` | Mouse position acts as a secondary light source |
| `hudVisible` | `true` | Show the HUD overlay |

**Scale presets** (affects glyph size and grid density):
`tiny` · `small` · `compact` · `medium` · `large` · `xl` · `huge` · `poster`

**Keyboard:** `H` toggles the HUD while the page is focused.

## Running locally

Open `index.html` in any modern browser — no server required for local file access, though a simple static server avoids module CORS restrictions:

```sh
npx serve .
# or
python -m http.server
```

## Module structure

```
main.js                    # ~65-line bootstrap
renderer.js                # Canvas 2D rendering
attention.js               # Spatial attention/dim field
maze.js                    # Grid types, placement, helpers
config/
  ConfigStore.js           # Runtime config with onChange callbacks
  WallpaperEngineAdapter.js# Maps WE property events to config
cycle/
  CycleStateMachine.js     # Generation → solve → fade → reset loop
events/
  LifecycleBus.js          # Pub/sub for lifecycle events
hud/
  HUD.js                   # Overlay DOM management
render/
  RenderState.js           # Per-frame display state (zero allocations)
generators/
  GeneratorBase.js         # Abstract base
  backtracker.js · prims.js · division.js · organic.js · roomcorridor.js
solvers/
  SolverBase.js            # Abstract base
  FrontierSolverBase.js    # Shared commit-to-path logic for BFS/A*/Greedy
  bfs.js · astar.js · greedy.js · dfs.js · wallfollower.js · randomwalk.js
  SolverPhase.js · Trace.js · MinHeap.js · pathfinding.js · registry.js
themes/
  base.js                  # BaseTheme with beat effects and HUD palette
  forest.js · desert.js · stone.js · void.js · water.js · lava.js · cold.js
```
