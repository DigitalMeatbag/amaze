# amaze — v3 Implementation Specification

> **Scope:** This document is the implementation contract for `amaze` v3. It derives from `amaze_v3_foundation.md`, which owns intent, philosophy, and closed decisions for v3. This spec owns exact values, algorithms, interfaces, and acceptance criteria. Any conflict between this spec and the v3 foundation should be resolved in favor of the foundation's intent, with this spec updated to match.
>
> **Relationship to v2:** This spec supersedes `amaze_v2_spec.md` for all v3 implementation work. Sections marked *(unchanged from v2)* reproduce v2 content for developer convenience. Sections marked **(v3)** contain new or revised requirements. The v3 spec is a complete standalone reference; the v2 spec is superseded.

---

## Invariants

These properties must hold at all times:

1. Every display cell is occupied by exactly one glyph from the active theme's glyph set.
2. The display grid exactly fills the canvas with no partial cells at any edge; any unused viewport margin outside the centered canvas is page background.
3. A solver step never executes during a rAF render frame; the two loops are independent.
4. Solver color identity is the primary visual cue for breadcrumbs and path; it must survive theme glyph changes.
5. The attention field is computed from the actor's current display-grid position, not logical-grid position.
6. On viewport resize, all in-progress state is discarded and the cycle restarts from generation.
7. Canvas is drawn at device pixel ratio; all coordinate math uses CSS pixels.
8. The HUD is drawn on the main canvas after all grid cells and theme overlays; it uses full-opacity colors and is never subject to attention field dimming.
9. The cursor position is never passed to any solver logic path. Cursor state feeds the visual light model only.
10. **(v3)** Item glyph assignments are fixed for the life of the process; no item glyph ever duplicates a reserved semantic glyph or a glyph used by the active theme for WALL, FLOOR, START, GOAL, ACTOR, or GENERATING state.
11. **(v3)** The precomputed solution (`nextStep` array) is computed once per cycle, after generation completes, before any solver runs.
12. **(v3)** Item effects are scoped to the run in which they were collected; they expire when that solver run ends regardless of remaining duration.

---

## §1 Purpose *(unchanged from v2)*

`amaze` generates a full-screen ASCII maze, animates a set of solver algorithms traversing it, then resets into a new maze and repeats. The implementation target is a Wallpaper Engine web wallpaper: an `index.html` file and supporting assets delivered as a local web page, rendered inside Wallpaper Engine's Chromium runtime.

v3 adds visual richness and experiential surprise to the working v2 foundation: a theme brightness pass, deterministic per-cell floor glyph and color variation, a two-phase Wall Follower, and a collectible items system that introduces chaotic events into actor runs.

The wallpaper must run without network access. All assets must be bundled locally.

---

## §2 Project Structure **(v3)**

```
amaze/
  index.html          entry point; minimal shell, loads main.js
  main.js             top-level orchestrator; owns run loop, WE integration, cursor state
  renderer.js         Canvas 2D renderer; owns glyph drawing, glow, flicker, HUD draw call
  maze.js             maze cell model and grid utilities
  attention.js        Attention field computation; solver + cursor light blend
  hud/
    index.js          HUD class; state, layout, and canvas rendering
  generators/
    index.js          Generator interface and registry
    backtracker.js
    prims.js
    division.js
    organic.js
    roomcorridor.js
  solvers/
    index.js          Solver interface, TraceAdapter base, registry
    dfs.js
    bfs.js
    astar.js
    greedy.js
    wallfollower.js
    randomwalk.js
  themes/
    index.js          Theme interface and registry
    forest.js
    desert.js
    stone.js
    void.js
    water.js
    lava.js
    cold.js
  items/              ← NEW
    index.js          Item placement, type definitions, glyph map, cycle state
    effects.js        Effect application logic for all 11 item types
  cycle/
    index.js          Cycle state machine
  events/
    index.js          Lifecycle event bus
  config/
    index.js          Shared configuration
  render/
    index.js          Render utilities
  project.json        Wallpaper Engine project manifest and property declarations
  assets/
    font.woff2        Bundled monospace font (see Open Items O-1)
```

**Module boundaries (v3 additions in bold):**

- `main.js` imports from all other modules. No other module imports from `main.js`.
- `renderer.js` imports from `maze.js`, `themes/index.js`, `attention.js`, and `hud/index.js`.
- `hud/index.js` imports from `themes/index.js` only.
- `attention.js` has no imports.
- Generator modules import only from `maze.js`.
- Solver modules import only from `maze.js`. They do not import renderer, theme, HUD, or items modules.
- Theme modules import only the semantic state and lifecycle enums from `solvers/index.js` and `maze.js`.
- **`items/index.js` imports from `maze.js` and `solvers/index.js` (for SemanticState and LifecycleEvent enums) only.**
- **`items/effects.js` imports from `items/index.js` only.**
- **No module other than `main.js` imports from `items/index.js`.**

---

## §3 Canvas Renderer *(unchanged from v2)*

### 3.1 Scale Presets and Cell Metrics

| Preset  | Font (px) | Cell W (px) | Cell H (px) | Label     |
|---------|-----------|-------------|-------------|-----------|
| Tiny    | 12        | 8           | 15          | `tiny`    |
| Small   | 14        | 9           | 17          | `small`   |
| Compact | 16        | 10          | 19          | `compact` |
| Medium  | 18        | 11          | 22          | `medium`  |
| Large   | 20        | 12          | 24          | `large`   |
| XL      | 22        | 14          | 27          | `xl`      |
| Huge    | 24        | 15          | 30          | `huge`    |
| Poster  | 28        | 17          | 34          | `poster`  |

Cell width and cell height are the CSS-pixel advance width and line height used for grid layout. Font size is the `font-size` value passed to `ctx.font`. All cell metrics are fixed per preset; there is no dynamic measurement of actual glyph advance.

### 3.2 Grid Sizing

Given viewport CSS dimensions `vw × vh` and active cell metrics `cw × ch`:

```
D_cols = floor(vw / cw)
D_rows = floor(vh / ch)
canvas.width  = D_cols * cw * devicePixelRatio
canvas.height = D_rows * ch * devicePixelRatio
canvas.style.width  = (D_cols * cw) + "px"
canvas.style.height = (D_rows * ch) + "px"
```

The canvas is positioned such that the rendered grid is centered in the viewport. Unused edge pixels outside the canvas area are filled by the page background color, which must match the active theme's background color.

`D_cols` and `D_rows` must each be at least 5. If the viewport is too small to satisfy this with the chosen preset, fall back to the next smaller preset until the minimum is met, or use Tiny if all presets fail.

### 3.3 DPI Scaling

`ctx.scale(devicePixelRatio, devicePixelRatio)` is called once after canvas creation. All subsequent drawing uses CSS pixel coordinates.

### 3.4 Render Loop

The render loop runs at `requestAnimationFrame` cadence. Each frame:

1. Clear canvas (`ctx.clearRect`).
2. Compute attention field array (see §7).
3. For each fading trace in `fadingTraces[]` (passed from `main.js`; see §3.8), render its `visited`, `frontier`, and `path` cells at `ctx.globalAlpha = trace.fadeAlpha` using that trace's solver color, with no attention dimming. Restore `ctx.globalAlpha = 1.0` after each trace. See §3.8 for full rendering contract.
4. For each cell `(col, row)` in the display grid:
   a. Read semantic state from `stateGrid[row * D_cols + col]` (pre-resolved by `main.js` before this call; see §3.8).
   b. Call `theme.renderCell(col, row, state, solverColor, attentionFactor, ctx, cw, ch, frameCount)`.
5. Call `theme.renderOverlay(ctx, D_cols, D_rows, cw, ch, frameCount)`.
6. Call `renderer.renderActivationEffects(ctx, cw, ch, frameCount)` for any active item activation animations.
7. If HUD is visible, call `hud.render(ctx, theme, cw, ch, D_cols, D_rows, frameCount)`.

Steps 6 and 7 are drawn on top of all maze cell content.

### 3.5 Glyph Rendering

For each cell, the theme's `renderCell` is responsible for:

1. Drawing the background fill: `ctx.fillStyle = bgColor; ctx.fillRect(col*cw, row*ch, cw, ch)`.
2. Applying glow if the intensity and state call for it: `ctx.shadowBlur`, `ctx.shadowColor`.
3. Drawing the foreground glyph: `ctx.fillStyle = fgColor * attentionFactor; ctx.fillText(glyph, col*cw + xOffset, row*ch + yOffset)`.

The attention factor is applied to foreground colors only, by multiplying each RGB channel independently. Background colors are not dimmed.

### 3.6 Actor Flicker

The actor cell (`ACTOR` semantic state) flickers at 530ms period when `trace.beatGlyph` is null. Flicker is suppressed while `trace.beatGlyph` is non-null (`"!"` or `"?"`).

Flicker is implemented as an alpha oscillation driven by `frameCount`. The theme owns the exact flicker expression.

### 3.7 Glow Levels

| Intensity | `ctx.shadowBlur` for wall/floor | Actor/path glow |
|-----------|---------------------------------|-----------------|
| Low       | 0 (no glow)                     | 0               |
| Medium    | 4                               | 8               |
| High      | 8                               | 16              |

`ACTOR_WALK_FOUND` (`!` beat) always renders with `shadowBlur = 12, shadowColor = "#FFFFFF"` regardless of intensity.

### 3.8 Semantic State Resolution **(v3)**

Before each `renderer.renderFrame(stateGrid, fadingTraces)` call, `main.js` resolves two structures and passes them to the renderer:

**`stateGrid: Uint8Array`** — length `D_cols * D_rows`. Each entry holds the `SemanticState` enum value for the corresponding cell. This encodes only the *current-active-solver* state plus items and static cells (start, goal, walls, floor). Fading solver traces from prior runs are **not** encoded here; they are passed separately via `fadingTraces[]`. The renderer reads `stateGrid` in step 4a and does not perform state determination itself.

**`fadingTraces: Array`** — one entry per solver run currently in its fading phase. Each entry:

```js
{ visited: Set<number>, frontier: Set<number>, path: Array<number>, fadeAlpha: number, solverColor: string }
```

Rendered in step 3 (behind the current-active-solver cells). For each fading trace: the renderer sets `ctx.globalAlpha = trace.fadeAlpha`, then calls `theme.renderCell(col, row, state, trace.solverColor, 1.0, ctx, cw, ch, frameCount)` for each cell in `visited`, `frontier`, and `path` (state = `VISITED`, `FRONTIER`, or `PATH` respectively). Attention dimming does not apply to fading-trace cells (`attentionFactor` is always 1.0). The renderer restores `ctx.globalAlpha = 1.0` after each trace.

**`stateGrid` resolution priority order (highest wins):**

1. `actorCell` (with active solver): `ACTOR`, `ACTOR_WALK_FOUND`, or `ACTOR_CHANGE_OF_MIND` based on `trace.beatGlyph`.
2. `startCell`: `START`.
3. `goalCell`: `GOAL`.
4. `itemMap.has(cellIdx)` and `config.itemsEnabled`: `ITEM`.
5. Cell in `trace.path` (during walk-to-goal / hold phases): `PATH`.
6. Cell in `trace.frontier`: `FRONTIER`.
7. Cell in `trace.visited`: `VISITED`.
8. `grid[cellIdx] === CellType.WALL`: `WALL`.
9. Default: `FLOOR`.

During generation (`GENERATING` cycle state), all carving-active cells receive `GENERATING` state; the priority list above does not apply.

This resolution lives in `main.js` because it requires access to `itemMap` (from `items/index.js`), `trace` (from the active solver), `grid` (from `maze.js`), and `config` — a cross-module aggregation that only the orchestrator can perform without violating module boundaries.

---

## §4 Maze Cell Model *(unchanged from v2)*

### 4.1 CellType Enum

```js
const CellType = {
  WALL:  0,
  FLOOR: 1,
}
```

### 4.2 Grid Storage

The maze grid is a flat `Uint8Array` of length `D_cols * D_rows`. Cell index = `row * D_cols + col`. Cell type values map to `CellType` constants.

### 4.3 Passability

A cell is passable if and only if its `CellType` is `FLOOR`. WALL cells are impassable. Grid boundaries (cells outside `[0, D_cols) × [0, D_rows)`) are treated as impassable walls for all solver and pathfinding purposes.

### 4.4 Start and Goal Placement

After generation, two cells are selected as START and GOAL:

- Both must be `FLOOR` cells.
- BFS distance from START to GOAL must be ≥ 50% of the maximum BFS distance in the maze.
- If no pair meets the distance threshold, the pair with the maximum BFS distance is selected.
- START and GOAL are stable for all solver runs in the cycle; they do not change between runs.

---

## §5 Maze Generation **(v3)**

### 5.1 Generators *(unchanged from v2)*

Five generators are available. Generator selection is theme-weighted (§5.2). Each generator produces a fully connected maze.

#### 5.1.1 Recursive Backtracker

Randomized DFS. Starts from a random cell, carves passages by choosing random unvisited neighbors. All four outer-border rows and columns are uniformly WALL after generation.

Generation animation: carves cells are revealed one by one as the algorithm progresses.

#### 5.1.2 Prim's Algorithm (Randomized)

Frontier-based. Starts from a random cell, maintains a frontier of reachable-but-unvisited cells, and randomly selects from the frontier at each step.

Generation animation: frontier cells pulse while interior cells settle.

#### 5.1.3 Recursive Division

Divides the grid with walls, then punches a passage through each wall. Produces a highly regular, room-like structure.

Generation animation: walls stamp in room by room.

#### 5.1.4 Organic / CA

Cellular automaton producing irregular, cave-like passages. Parameters for standard grids (area ≥ 400): seed density 0.45, 5 iterations. For small grids (400 > area ≥ 100): seed density 0.35, 8 iterations. For very small grids (area < 100): fall back to Prim's. Post-processing ensures a single contiguous FLOOR region.

Generation animation: reveal transition (full maze revealed at once after CA completes).

#### 5.1.5 Room-and-Corridor

Places rectangular rooms, then connects them with corridors. All placed rooms are connected to at least one corridor.

Generation animation: rooms stamp in, then corridors connect them.

### 5.2 Theme Generation Weights *(unchanged from v2)*

| Generator      | Forest | Desert | Stone | Void | Water | Lava | Cold |
|----------------|--------|--------|-------|------|-------|------|------|
| Backtracker    | 40%    | 30%    | 15%   | 20%  | 30%   | 20%  | 30%  |
| Prim's         | 20%    | 25%    | 20%   | 20%  | 25%   | 25%  | 20%  |
| Division       | 10%    | 15%    | 35%   | 10%  | 10%   | 15%  | 15%  |
| Organic/CA     | 20%    | 20%    | 10%   | 40%  | 25%   | 30%  | 20%  |
| Room-Corridor  | 10%    | 10%    | 20%   | 10%  | 10%   | 10%  | 15%  |

### 5.3 Item Placement **(v3)**

After start and goal cells are established, items are placed. Item placement is part of generation and is complete before any solver runs.

**Item count:**

```js
function computeItemCount(D_cols, D_rows) {
  return Math.max(3, Math.min(11, Math.round(0.08 * Math.sqrt(D_cols * D_rows))))
}
```

Representative values (at `multiplier = 1.0`):

| Scale / Display      | Approx D_cols × D_rows | Item Count |
|----------------------|------------------------|------------|
| Tiny (1080p)         | ~320 × 72              | 11         |
| Medium (1080p)       | ~174 × 49              | 9          |
| Poster (1080p)       | ~113 × 32              | 8          |
| Poster (4K)          | ~226 × 63              | 11         |

**Placement algorithm:**

```
itemCount = computeItemCount(D_cols, D_rows)
if config.itemsEnabled == false: itemCount = 0

typePool = shuffle([SpeedUp, SlowDown, Fog, Lantern, Freeze, VisualEffect,
                    Transformation, Teleport, SolutionReveal, Death, Amnesia])
eligibleCells = all FLOOR cells excluding startCell and goalCell

placed = []
for i in 0..itemCount-1:
  pool = eligibleCells excluding cells already in placed
  if pool is empty: break
  cell = pool[random(pool.length)]
  placed.push({ type: typePool[i], cell: cell })
```

Items are drawn without replacement from the 11 types. No two items occupy the same cell. No path avoidance — items may be placed on the optimal start→goal path.

**Item state per cycle:**

```js
// items/index.js
const itemMap = new Map()  // cellIndex → ItemType
// initialized from placed[] above; persists for full cycle
// remove entry when item is collected
```

### 5.4 Precomputed Solution **(v3)**

After item placement is complete, a full navigational solution is precomputed. This solution is independent of all solver state and is used by the Solution Path Reveal item effect.

**Algorithm — reverse BFS from goal:**

```js
function precomputeSolution(grid, D_cols, D_rows, goalCellIndex) {
  const n = D_cols * D_rows
  const nextStep = new Int32Array(n).fill(-1)
  nextStep[goalCellIndex] = goalCellIndex   // goal points to itself
  const queue = [goalCellIndex]
  let head = 0
  while (head < queue.length) {
    const cell = queue[head++]
    for each passable 4-directional neighbor nb of cell:
      if nextStep[nb] === -1:
        nextStep[nb] = cell   // to move from nb toward goal, step to cell
        queue.push(nb)
  }
  return nextStep   // Int32Array stored on cycle state
}
```

`nextStep[cellIdx]` gives the display-grid cell index of the next step from `cellIdx` toward the goal. `nextStep[goalIdx] === goalIdx`. `nextStep[unreachableCellIdx] === -1` (no passable path; should not occur in a connected maze).

The `nextStep` array is held for the full cycle duration and discarded on `CYCLE_RESET`.

---

## §6 Solver System **(v3)**

### 6.1 SolverTrace Model *(unchanged from v2)*

```js
const trace = {
  actorCell:   cellIndex,          // current actor position (display grid)
  visited:     Set<cellIndex>,     // all cells the algorithm has examined
  frontier:    Set<cellIndex>,     // cells queued but not yet visited
  path:        Array<cellIndex>,   // solution path (set on solve)
  walkIndex:   number,             // walk-to-goal progress index
  phase:       string,             // "solving" | "solved" | "walk_to_goal" | "holding" | "fading" | "timeout"
  fadeAlpha:   number,             // [0.0, 1.0]; 1.0 during active run
  solverColor: { breadcrumb, path },  // CSS hex colors
  beatGlyph:   string | null,      // "!" | "?" | null
}
```

### 6.2 TraceAdapter *(unchanged from v2)*

The TraceAdapter base class provides:

- `advanceActorToward(trace, targetCell, parentMap)` — moves actor one step toward target using BFS over `trace.visited`.
- `advanceAlongPath(trace, walkPath)` — advances actor one step along `walkPath`; returns `true` when goal reached.
- `reconstructPath(parentMap, startCell, goalCell)` — builds path array from parent map.

### 6.3 Solver Interface **(v3)**

Each solver exposes:

```js
class Solver {
  begin(startCell, goalCell, grid, D_cols, D_rows, trace) {}
  step(trace) {}

  // (v3) Clears visited and breadcrumb state from the algorithm and display.
  // Actor position and phase are unchanged. Called by the Amnesia item effect.
  applyAmnesia(trace) {}
}
```

`applyAmnesia()` clears `trace.visited`, `trace.frontier`, and the solver's internal data structures (parent map, queue, stack, open heap) to their post-`begin()` empty state, except that the actor's current position is re-added to `trace.visited`. `trace.actorCell`, `trace.phase`, and `trace.path` are unchanged.

For DFS, BFS, A*, and Greedy: the parent map is cleared; frontier and queue/heap are reset. The actor re-initializes from its current position as though `begin()` was called there.

For Wall Follower: `stateFingerprints` is cleared; phase resets to seek-or-follow based on current position adjacency.

For Random Walk: `movementHistory` is cleared; the actor continues from its current position.

### 6.4 Solver Algorithms

#### 6.4.1 Depth-First Search *(unchanged from v2)*

Maintains a stack. DFS takes the first unvisited neighbor. Exits as timeout if stack is empty. Exit-visibility shortcut applies.

```
begin:
  stack = [start]
  visited = {start}; parent = {}
  trace.actorCell = start
  exitShortcutFired = false

step:
  if trace.beatGlyph === "?": trace.beatGlyph = null
  if stack is empty: trace.phase = "timeout"; return
  current = stack.top()
  trace.actorCell = current
  trace.visited.add(current)
  if current == goal:
    reconstruct_path(parent, start, goal) → trace.path
    trace.phase = "solved"; return
  if not exitShortcutFired:
    if exitVisible(trace.actorCell, goal, grid, D_cols, D_rows, parent):
      exitPath = bfsPath(actorCell, goal, grid, D_cols, D_rows)
      trace.path = parentPath(parent, start, actorCell) + exitPath
      trace.phase = "solved"
      exitShortcutFired = true; return
  unvisited = passable neighbors not in visited
  if unvisited is empty:
    stack.pop()
  else:
    next = unvisited[0]
    parent[next] = current; stack.push(next); visited.add(next)
```

#### 6.4.2 Breadth-First Search *(unchanged from v2)*

Maintains a FIFO queue. Commit-to-path and exit-visibility apply.

```
begin:
  queue = [start]; visited = {start}; parent = {}
  trace.actorCell = start
  commitTarget = start; commitStepsRemaining = 0
  exitShortcutFired = false

step:
  if trace.beatGlyph === "?": trace.beatGlyph = null
  if queue is not empty:
    current = queue.dequeue(); trace.frontier.delete(current)
    if current == goal:
      reconstruct_path(parent, start, goal) → trace.path
      trace.phase = "solved"; return
    for each unvisited passable neighbor n:
      parent[n] = current; visited.add(n); queue.enqueue(n); trace.frontier.add(n)
  // exit-visibility override and commit-to-path movement (see §6.9, §6.10)
```

`bestFrontierTarget` for BFS: frontier cell with smallest Manhattan distance to goal.

#### 6.4.3 A\* *(unchanged from v2)*

Min-heap ordered by `f = g + h`, `h = manhattan(cell, goal)`. Commit-to-path and exit-visibility apply. `bestFrontierTarget`: frontier cell with smallest `f` score.

#### 6.4.4 Greedy Best-First Search *(unchanged from v2)*

Min-heap ordered by `h` only. Commit-to-path and exit-visibility apply. `bestFrontierTarget`: frontier cell with smallest `h` score.

#### 6.4.5 Wall Follower **(v3 — two-phase; supersedes v2 §6.4.5)**

The Wall Follower operates in two sequential phases. Does not use TraceAdapter. Excluded from commit-to-path and exit-visibility.

**Definitions:**

- *Wall-adjacent*: the actor's current cell has at least one impassable neighbor in the four cardinal directions (N, S, E, W). Grid boundaries count as impassable.
- *Right-hand priority order*: given current `facing`, the ordered sequence is `[right(facing), facing, left(facing), back(facing)]`.

```
begin:
  place actor at start_display_cell
  facing = direction from start toward nearest passable neighbor
           (if multiple equally near, prefer East > South > West > North)
  trace.actorCell = start
  trace.visited.add(start)
  movementHistory = [start]
  stateFingerprints = new Set()

  phase = wallAdjacent(start) ? "follow" : "seek"
```

**Seek phase** (actor is not yet wall-adjacent):

```
seek_step:
  unvisited = passable neighbors of actorCell not in trace.visited
  if unvisited is not empty:
    // right-hand bias over unvisited candidates
    next = first cell in right-hand priority order that is in unvisited
  else:
    // all neighbors visited — fall back to any passable in right-hand order
    next = first passable cell in right-hand priority order
  facing = direction from actorCell to next
  actorCell = next
  trace.visited.add(next); movementHistory.push(next)
  if actorCell == goal:
    trace.path = movementHistory.slice(); trace.phase = "solved"; return
  if wallAdjacent(actorCell):
    phase = "follow"   // transition immediately; fingerprint detection activates
```

Fingerprint detection is **not active** during seek.

**Follow phase** (actor is wall-adjacent; pure right-hand rule):

```
follow_step:
  // right-hand rule: try right, forward, left, back — first passable wins
  for dir in right-hand priority order:
    if passable neighbor exists in dir from actorCell:
      facing = dir; next = neighbor in dir; break
  actorCell = next
  trace.visited.add(next); movementHistory.push(next)

  fingerprint = encode(actorCell, facing)
  if stateFingerprints.has(fingerprint):
    trace.phase = "timeout"; return   // cycle detected
  stateFingerprints.add(fingerprint)

  if actorCell == goal:
    trace.path = movementHistory.slice(); trace.phase = "solved"
```

The right-hand rule in follow mode is unconditional — no visit condition, no fallback scoring.

`wallAdjacent(cell)`: returns true if any of the four cardinal neighbors of `cell` is WALL or out of bounds.

The `(position, facing)` fingerprint set has at most `4 * D_cols * D_rows` entries. Memory is bounded by grid size.

**`applyAmnesia()` for Wall Follower:** clears `trace.visited`, `movementHistory` (reset to `[actorCell]`), and `stateFingerprints`. Re-evaluates `wallAdjacent(actorCell)` to set phase.

#### 6.4.6 Random Walk *(unchanged from v2)*

Moves to a random passable neighbor each step. Prefers unvisited neighbors. Exempt from commit-to-path and exit-visibility. Fires `!` beat on goal discovery but skips walking phase (actor is already at goal when solve condition fires).

```
begin:
  trace.actorCell = start
  visited = {start}; parent = {}; movementHistory = [start]

step:
  neighbors = passable neighbors of actorCell
  unvisited = neighbors not in visited
  next = unvisited is empty ? random(neighbors) : random(unvisited)
  if next not in parent: parent[next] = actorCell
  actorCell = next; visited.add(next); movementHistory.push(next)
  if actorCell == goal:
    reconstruct_path(parent, start, goal) → trace.path
    trace.phase = "solved"
```

### 6.5 Solver Color Identities *(unchanged from v2)*

| Solver        | Key            | Breadcrumb  | Path        |
|---------------|----------------|-------------|-------------|
| DFS           | `dfs`          | `#FF5533`   | `#FF7755`   |
| BFS           | `bfs`          | `#33CCFF`   | `#66DDFF`   |
| A*            | `astar`        | `#33FF66`   | `#66FF99`   |
| Greedy        | `greedy`       | `#FFCC33`   | `#FFE066`   |
| Wall Follower | `wallfollower` | `#CC66FF`   | `#DD99FF`   |
| Random Walk   | `randomwalk`   | `#AAAAAA`   | `#CCCCCC`   |

### 6.6 Solver Selection *(unchanged from v2)*

```js
pool = [dfs, bfs, astar, greedy, wallfollower, randomwalk]
selected = shuffle(pool).slice(0, 4)
```

The `selectedSolvers` array is stored on cycle state. When a transformation item fires mid-run (§11.4), the transformation target is drawn from solvers not yet run and not the current solver, and the cycle's remaining slots are updated accordingly (see §11.4).

### 6.7 Maximum Solve Time *(unchanged from v2)*

```js
function computeMaxSolveMs(D_cols, D_rows, multiplier) {
  const gridAwareSeconds = Math.min(5 * Math.sqrt(D_cols * D_rows), 600)
  return Math.round(gridAwareSeconds * multiplier * 1000)
}
```

Default multiplier = `1.0`. User-configurable via WE slider.

### 6.8 Walk-to-Goal Phase **(v3 — extended for items)**

When a solver transitions to `trace.phase = "solved"`, the standard walk-to-goal pipeline runs:

**Step 1 — Beat:** `trace.beatGlyph = "!"`. Fire `WALK_TO_GOAL_BEAT` lifecycle event. `setTimeout` of `STEP_INTERVAL_MS`. Solver step interval stops.

**Step 2 — Walk decision:**

- **Random Walk:** actor is already at goal. Skip to SOLVED_HOLD.
- **Solution Path Reveal item:** use `nextStep[]` array (§5.4) instead of solver's parent map. Walk computed as: starting from `trace.actorCell`, follow `nextStep[cell]` until `goalCell`.
- **All other solvers:** compute `walkPath` via BFS over `trace.visited` cells from `trace.actorCell` to `goalCell`. If unreachable through discovered graph, fall back to BFS over all passable maze cells. Set `trace.walkIndex = 0`. Set `trace.phase = "walk_to_goal"`.

**Step 3 — Walking:** `setInterval` at `WALK_STEP_MS`:

```js
WALK_STEP_MS = Math.max(10, Math.floor(config.stepIntervalMs / 2))
```

Each walk tick: advance actor one step along `walkPath`. Check item collection (§9.3) at the actor's new position. If death item fires during walk: transition to DEAD_HOLD (§9.5) immediately; walk interval stops.

**Step 4 — Arrival:** When actor reaches goal and no death has fired, stop walk interval. Set `trace.phase = "holding"`. Fire `SOLVER_SOLVED`. Begin `PATH_HOLD_MS` timer.

Walk-to-goal is skipped on timeout. The `!` beat does not fire on timeout.

### 6.9 Commit-to-Path *(unchanged from v2)*

Applies to BFS, A*, and Greedy. Each frontier solver maintains internal commit state:

```
commitTarget:          display-cell index | null
commitStepsRemaining:  number
```

**Commit cycle:**

1. When `commitStepsRemaining == 0`, select `newTarget = bestFrontierTarget(trace.frontier, goal)`.
2. If `newTarget != commitTarget`: `trace.beatGlyph = "?"`.
3. `commitTarget = newTarget`.
4. `dist = bfsDistance(actorCell, commitTarget, discoveredGraph)`.
5. `N = random(floor(2000 / STEP_INTERVAL_MS), dist)`. If `dist == 0`: `N = 1`.
6. `commitStepsRemaining = N`.
7. `advanceActorToward(trace, commitTarget, parent)`.
8. `commitStepsRemaining--`.

At the start of each `step()`: if `trace.beatGlyph === "?"`, clear to `null`.

### 6.10 Exit-Visibility Shortcut *(unchanged from v2)*

Applies to DFS, BFS, A*, Greedy. Excluded from Random Walk and Wall Follower.

```js
function exitVisible(actorCell, goalCell, grid, D_cols, D_rows, discoveredGraph) {
  const [ac, ar] = actorCell
  const [gc, gr] = goalCell
  if (chebyshev(ac, ar, gc, gr) > ATTENTION_RADIUS) return false   // ATTENTION_RADIUS = 6
  if (!hasLOS(grid, ac, ar, gc, gr, D_cols)) return false
  return canReach(actorCell, goalCell, discoveredGraph, ATTENTION_RADIUS * 4)
}
```

`hasLOS`: Bresenham ray; return false if any non-endpoint cell is WALL. `canReach`: BFS over discovered graph bounded to `maxSteps`.

Exit-visibility override fires at most once per solver run. Overrides commit target to goal when active.

---

## §7 Attention Field **(v3)**

### 7.1 Definition **(v3 — parameterized radius)**

The attention field is a per-cell brightness multiplier centered on the actor's current display-grid cell:

```
attention_factor(d, r) = ambient + (1.0 - ambient) * cos²(π * min(d, r) / (2 * r))
```

Where `d` is the Chebyshev distance from the cell to `trace.actorCell`, and `r` is the effective attention radius.

**Default values at `r = 6`:**

| d   | attention_factor |
|-----|-----------------|
| 0   | 1.000           |
| 1   | 0.957           |
| 2   | 0.833           |
| 3   | 0.652           |
| 4   | 0.469           |
| 5   | 0.310           |
| 6   | 0.250           |
| >6  | 0.250 (ambient) |

The ambient floor level is 0.25 at Medium intensity (see §7.3). At `d ≥ r`, `attention_factor = ambient`.

`ATTENTION_RADIUS = 6` is the default radius. This constant is used by the exit-visibility check (§6.10) regardless of any active item effect — exit-visibility always uses the default radius.

**Fog effect:** `r = 3`. Actor sees only half the normal radius; terrain beyond 3 cells is at ambient.

**Lantern effect:** `r = 9`. Actor sees 1.5× the normal radius; terrain farther from the actor is visible.

### 7.2 Application *(unchanged from v2)*

The renderer passes `attention_factor(d, r)` to the theme's cell render function. The theme multiplies wall and floor foreground colors by this factor (applied to RGB channels, leaving alpha unchanged).

Solver breadcrumb, path, start, goal, and **item** cells are exempt from attention dimming; they render at full color regardless of actor distance. Background colors are not dimmed.

### 7.3 Intensity Scaling *(unchanged from v2)*

| Intensity | Ambient (`ambient`) | Formula                                  |
|-----------|---------------------|------------------------------------------|
| Low       | 0.50                | `0.50 + 0.50 * cos²(π * min(d,r)/(2r))` |
| Medium    | 0.25                | `0.25 + 0.75 * cos²(π * min(d,r)/(2r))` |
| High      | 0.15                | `0.15 + 0.85 * cos²(π * min(d,r)/(2r))` |

At Low intensity, the attention array is filled with 0.50 once and not recomputed until intensity changes.

### 7.4 Layer Ownership **(v3 — updated signature)**

`attention.js` exposes a single function:

```js
// Returns Float32Array of length D_cols * D_rows.
// actorCol, actorRow: actor position (-1 if no active solver)
// cursorCol, cursorRow: cursor grid position (-1 if cursor not over canvas)
// cursorAlpha: [0, 1]
// intensity: "low" | "medium" | "high"
// attentionRadius: 3 (Fog) | 6 (default) | 9 (Lantern)
function compute(actorCol, actorRow, cursorCol, cursorRow, cursorAlpha,
                 D_cols, D_rows, intensity, attentionRadius)
```

`attentionRadius` is passed in by `main.js` based on the current active item effects (see §11.3). Default is `6`. If both Fog and Lantern effects are simultaneously active, they cancel to the default radius `6`.

The returned array is pre-allocated and reused across frames.

### 7.5 Cursor Light Source *(unchanged from v2)*

```
cursor_factor(d) = ambient + (1.0 - ambient) * cos²(π * min(d, 6) / 12)
```

Cursor light always uses radius 6, independent of active item effects. Blend rule: `max(solver_factor, cursor_factor * cursorAlpha)`. Fade-out on canvas leave: 500ms.

---

## §8 Theme System **(v3)**

### 8.1 SemanticState Enum **(v3)**

```js
const SemanticState = {
  // v1/v2 states (unchanged)
  WALL:                  "wall",
  FLOOR:                 "floor",
  START:                 "start",
  GOAL:                  "goal",
  ACTOR:                 "actor",
  VISITED:               "visited",
  FRONTIER:              "frontier",
  PATH:                  "path",
  GENERATING:            "generating",
  ACTOR_WALK_FOUND:      "actor_walk_found",
  ACTOR_CHANGE_OF_MIND:  "actor_change_of_mind",

  // v3 addition
  ITEM:                  "item",    // cell contains an uncollected item
}
```

### 8.2 LifecycleEvent Enum **(v3)**

```js
const LifecycleEvent = {
  // v1/v2 events (unchanged)
  MAZE_READY:           "maze_ready",
  SOLVER_START:         "solver_start",
  SOLVER_SOLVED:        "solver_solved",
  SOLVER_TIMEOUT:       "solver_timeout",
  SOLVER_FADE_COMPLETE: "solver_fade_complete",
  CYCLE_RESET:          "cycle_reset",
  WALK_TO_GOAL_BEAT:    "walk_to_goal_beat",

  // v3 addition
  SOLVER_DEATH:         "solver_death",   // actor collected a Death item; run ends
}
```

`SOLVER_DEATH` fires in place of `SOLVER_SOLVED` or `SOLVER_TIMEOUT` when the actor collects a Death item. It carries `{ position: cellIndex }` in the event data. Themes use this to render a death-specific animation on the actor cell.

### 8.3 Theme Interface **(v3)**

```js
class Theme {
  get backgroundColor() { return "#000000" }
  get hudPalette() { return { background, border, header, meta, active, done, pending } }
  get activationPalette() { return { primary, secondary, flash } }  // (v3) item activation colors

  renderCell(col, row, state, solverColor, attentionFactor, ctx, cw, ch, frameCount) {}

  onLifecycleEvent(event, data) {}

  // (v3) Called when an item is collected at the given cell index.
  // Implement for optional theme-specific extras (ongoing overlays, ambient sounds, etc.)
  // beyond the standard pickup animation managed by the renderer (see §8.10).
  // itemType: one of the 11 ItemType constants (see §11.1)
  // position: display-grid cell index
  // durationMs: effect duration in ms (null for Permanent and One-time items)
  onItemActivated(itemType, position, durationMs) {}

  // (v3) Called when a duration-based item effect expires naturally (timer reaches zero).
  // NOT called when effects expire due to run end (transition to FADING or DEAD_HOLD).
  // itemType: one of the 11 ItemType constants (see §11.1)
  // position: display-grid cell index of original pickup
  onItemExpired(itemType, position) {}

  renderOverlay(ctx, D_cols, D_rows, cw, ch, frameCount) {}
}
```

**`activationPalette`** provides three colors for item activation animations:

| Key       | Usage                               |
|-----------|-------------------------------------|
| primary   | Main flash/ring color               |
| secondary | Expanding ripple / trailing color   |
| flash     | Instantaneous full-brightness burst |

### 8.4 Theme Behavior Rules **(v3)**

All v2 rules apply unchanged. v3 additions:

- Themes must handle `SemanticState.ITEM`. Item cells render at full theme color (no attention dimming). The glyph is the item-type glyph from §11.1. Foreground color is the theme's `activationPalette.primary`. Background is the theme's floor background.
- An unknown semantic state falls back to `FLOOR` rendering.
- Themes must handle the `SOLVER_DEATH` lifecycle event either with a visible effect or an explicit no-op.
- Themes may implement `onItemActivated(itemType, position, durationMs)` and `onItemExpired(itemType, position)` for optional theme extras. The standard pickup animation is managed by the renderer; themes do not need to schedule it (see §8.10).
- Floor visual variation (§8.9) is expressed entirely within the theme's `renderCell` for `FLOOR` state. The renderer is unaware of floor variation.
- Decoratives (§8.7) and floor variation both apply to `FLOOR` cells. When a cell has a decorative assignment, the decorative renders instead of floor variation. Decoratives take priority.

### 8.5 Theme Fade Behavior **(v3 — revised)**

When a solver transitions to fading phase, `main.js` moves its trace into `fadingTraces[]` and begins decreasing `trace.fadeAlpha` from 1.0 to `targetFadeOpacity` over 1500ms. The actor cell is not carried into the fading trace; actor and beat effects disappear immediately on phase entry.

The renderer owns fade alpha for fading traces (§3.4 step 3). It sets `ctx.globalAlpha = trace.fadeAlpha` and calls `theme.renderCell` for each visited, frontier, and path cell. **Themes must not set `ctx.globalAlpha` in `renderCell`** — they render normally and the canvas context applies the renderer-controlled alpha transparently.

### 8.6 HUD Specification **(v3 — extended)**

The HUD panel is drawn in the top-left corner.

**Layout constants:**

| Constant                | Value                              |
|-------------------------|------------------------------------|
| Margin from canvas edge | `12px`                             |
| Panel width             | `200px`                            |
| Panel padding           | `8px`                              |
| Font                    | `11px 'AmazeMono', monospace`      |
| Line height             | `16px`                             |
| Corner radius           | `3px`                              |

**Panel height (v3 — dynamic):**

```
base_rows = 1 (header) + 1 (theme) + 1 (gen) + 1 (separator) + 4 (solver rows) = 8
effects_rows = count of currently active Temporary or Permanent effects
separator_row = effects_rows > 0 ? 1 : 0
total_rows = base_rows + separator_row + effects_rows
height = 8 + total_rows * 16 + 8
```

Base height with no active effects = `8 + 8 * 16 + 8 = 144px`.

**Rendering algorithm (executed by `hud.render()`):**

```
ctx.save()

// Panel background
ctx.fillStyle = palette.background
roundedRect(12, 12, 200, height, 3); ctx.fill()
ctx.strokeStyle = palette.border; ctx.lineWidth = 1
roundedRect(12, 12, 200, height, 3); ctx.stroke()

// Row 1: header
ctx.fillStyle = palette.header
ctx.font = "bold 11px 'AmazeMono', monospace"
ctx.fillText("AMAZE", 20, 20)

// Row 2: theme name
ctx.fillStyle = palette.meta
ctx.font = "11px 'AmazeMono', monospace"
ctx.fillText("theme: " + themeName, 20, 36)

// Row 3: generator name
ctx.fillText("gen: " + generatorName, 20, 52)

// Row 4: separator
ctx.fillStyle = palette.meta; ctx.fillRect(20, 69, 184, 1)

// Rows 5-8: solver run rows
for i in 0..3:
  y = 76 + i * 16
  ... (same as v2, with death outcome below)

// Effects section (v3)
if effects_rows > 0:
  effectsY_separator = 76 + 4 * 16 + 4   // 144
  ctx.fillStyle = palette.meta; ctx.fillRect(20, effectsY_separator, 184, 1)
  for j in 0..effects_rows-1:
    y = effectsY_separator + 8 + j * 16
    effect = activeEffects[j]
    ctx.fillStyle = palette.active
    label = padEnd(effect.name, 14)
    suffix = effect.permanent ? "∞" : (Math.ceil(effect.remainingMs / 1000) + "s")
    ctx.fillText(label + padStart(suffix, 4), 20, y)

ctx.restore()
```

**Solver row outcome icons (v3):**

| Outcome          | Icon  |
|------------------|-------|
| Solved           | `✓`   |
| Timeout (DNF)    | `✗`   |
| Death (item)     | `☠`   |
| Active (running) | `…`   |

**HUD state management (v3):**

```js
class HUD {
  setContext(themeName, generatorName, selectedSolvers) {}
  setCurrentSolver(key, startTimeMs) {}
  recordOutcome(key, elapsedMs, outcome)  // outcome: "solved"|"timeout"|"death"
  setActiveEffects(effects)   // effects: Array<{name:string, remainingMs:number|null, permanent:bool}>
  reset() {}
  setVisible(visible) {}
  get isVisible() {}
  render(ctx, theme, cw, ch, D_cols, D_rows, frameCount) {}
}
```

`setActiveEffects()` is called each rAF frame by the run loop with the current list of active item effects. Effects are sorted with Temporary effects first (ascending remaining time), then Permanent effects. The HUD renders whatever the array contains.

**Visibility:** Initialized from `config.hudVisible` at each `CYCLE_RESET`. `H` key toggles within the cycle. Toggle does not persist across cycles unless WE property is also changed.

### 8.7 Decorative Elements *(unchanged from v2)*

Each theme has a class of decorative elements placed on FLOOR cells at `MAZE_READY`. Density is intensity-governed. Decorative assignments are stored in a `Map<cellIndex, {glyph, phase}>` in the theme instance.

**Decorative takes priority over floor variation.** When a cell has a decorative assignment, the theme renders the decorative glyph and color in `renderCell` for `FLOOR` state; floor variation is not applied to that cell.

Decorative glyphs must not be any glyph used for semantic maze state and must not conflict with item glyphs (§11.1). Solver states (VISITED, FRONTIER, PATH, ACTOR) suppress decorative rendering.

At Low intensity, density is 0% for all themes.

### 8.8 Theme Specifications **(v3 — brightness pass applied)**

All palette values are CSS hex colors. Channels affected by the v3 brightness pass: `WALL` foreground, `FLOOR` foreground, `GENERATING` foreground, and the wallEmerge color in `MAZE_READY` lifecycle beat. Channels unaffected: `bg`, `START`, `GOAL`, `ACTOR`, HUD palette. Void is excluded from the brightness pass.

---

#### Forest **(v3)**

| Semantic State         | Glyph | Foreground  | Background  | Change    |
|------------------------|-------|-------------|-------------|-----------|
| WALL                   | `#`   | `#3D9029`   | `#0A1A0A`   | brighter  |
| FLOOR                  | `.`   | `#235216`   | `#0A1A0A`   | brighter  |
| START                  | `>`   | `#90FF60`   | `#0A1A0A`   | unchanged |
| GOAL                   | `X`   | `#FF9900`   | `#0A1A0A`   | unchanged |
| ACTOR                  | `@`   | `#B0FF80`   | `#0A1A0A`   | unchanged |
| GENERATING             | `*`   | `#66DD44`   | `#0A1A0A`   | brighter  |
| ACTOR_WALK_FOUND       | `!`   | `#FFFFFF`   | `#0A1A0A`   | unchanged |
| ACTOR_CHANGE_OF_MIND   | `?`   | `#FF9900`   | `#0A1A0A`   | unchanged |
| ITEM                   | *(§11.1)* | `#90FF60` | `#0A1A0A` | new     |

Lifecycle beats:
- `MAZE_READY`: walls fade from `#143914` → `#3D9029` over 60 frames. (wallEmerge brightened from v2 `#0F2A0F`)
- `SOLVER_START`: actor blinks from `.` to `@` over 12 frames.
- `WALK_TO_GOAL_BEAT`: no additional effect beyond universal `ACTOR_WALK_FOUND` rendering.
- `SOLVER_SOLVED`: path pulses `#CCFF99` → path color twice over 30 frames.
- `SOLVER_TIMEOUT`: actor glyph changes to `x`; dim to `#444444` over 20 frames.
- `SOLVER_DEATH`: actor glyph changes to `☠` at `#FF3333`; brief white flash (alpha 0.4) on actor cell; dim to `#222222` over 20 frames.
- `CYCLE_RESET`: brief full-canvas darken to `#050F05` over 16 frames.

Overlay: at Medium/High intensity, subtle green tint shimmer on FLOOR cells within radius 3 of actor. Period: 120 frames, amplitude: ±0.08 alpha.

**Activation palette:**
| Key       | Value     |
|-----------|-----------|
| primary   | `#90FF60` |
| secondary | `#3D9029` |
| flash     | `#CCFF99` |

**Decorative elements (unchanged from v2):**
- Glyph set: `♣` `♠`; Foreground: `#1E4A12`; Background: `#0A1A0A`
- Density: Low 0%, Med 3%, High 7%
- Animation: High only — cycle `♣`↔`♠` every `random(80,160)` frames per cell

**HUD palette (unchanged from v2):**
- background: `rgba(10,26,10,0.88)` | border: `#3D9029` | header: `#90FF60` | meta: `#3D9029` | active: `#B0FF80` | done: `#66DD44` | pending: `#235216`

---

#### Desert **(v3)**

| Semantic State         | Glyph | Foreground  | Background  | Change    |
|------------------------|-------|-------------|-------------|-----------|
| WALL                   | `#`   | `#E89030`   | `#1A120A`   | brighter  |
| FLOOR                  | `.`   | `#8C621C`   | `#1A120A`   | brighter  |
| START                  | `>`   | `#FFE080`   | `#1A120A`   | unchanged |
| GOAL                   | `X`   | `#FF6600`   | `#1A120A`   | unchanged |
| ACTOR                  | `@`   | `#FFE880`   | `#1A120A`   | unchanged |
| GENERATING             | `*`   | `#E09A3A`   | `#1A120A`   | brighter  |
| ACTOR_WALK_FOUND       | `!`   | `#FFFFFF`   | `#1A120A`   | unchanged |
| ACTOR_CHANGE_OF_MIND   | `?`   | `#FF6600`   | `#1A120A`   | unchanged |
| ITEM                   | *(§11.1)* | `#FFE080` | `#1A120A` | new     |

Lifecycle beats:
- `MAZE_READY`: walls shimmer from `#A06018` → `#E89030` over 40 frames. (wallEmerge brightened from v2 `#7A4A10`)
- `SOLVER_START`: actor fades in from sand-colored `.` to `@` over 12 frames.
- `WALK_TO_GOAL_BEAT`: no additional effect.
- `SOLVER_SOLVED`: path pulses `#FFEE99` → path color over 25 frames.
- `SOLVER_TIMEOUT`: actor changes to `%`; dim to `#554422` over 20 frames.
- `SOLVER_DEATH`: actor becomes `☠` at `#FF3333`; heat-shimmer flash on actor cell; dim to `#332211` over 20 frames.
- `CYCLE_RESET`: brief darken to `#0D0905` over 16 frames.

Overlay: at High intensity, heat shimmer on WALL cells adjacent to actor. Alternate glyph `║` on random wall cells at period 180 frames.

**Activation palette:**
| Key       | Value     |
|-----------|-----------|
| primary   | `#FFE080` |
| secondary | `#E89030` |
| flash     | `#FFEE99` |

**Decorative elements (unchanged from v2):**
- Glyph set: `Y` `,`; Foreground: `#7A4D18`; Background: `#1A120A`
- Density: Low 0%, Med 2%, High 4%; Animation: none

**HUD palette:**
- background: `rgba(26,18,10,0.88)` | border: `#8C621C` | header: `#FFE080` | meta: `#8C621C` | active: `#FFE880` | done: `#E09A3A` | pending: `#3D2A08`

---

#### Stone **(v3)**

| Semantic State         | Glyph | Foreground  | Background  | Change    |
|------------------------|-------|-------------|-------------|-----------|
| WALL                   | `#`   | `#AAAACC`   | `#080810`   | brighter  |
| FLOOR                  | `.`   | `#363650`   | `#080810`   | brighter  |
| START                  | `>`   | `#CCCCFF`   | `#080810`   | unchanged |
| GOAL                   | `X`   | `#AAAAFF`   | `#080810`   | unchanged |
| ACTOR                  | `@`   | `#EEEEFF`   | `#080810`   | unchanged |
| GENERATING             | `*`   | `#6E6E99`   | `#080810`   | brighter  |
| ACTOR_WALK_FOUND       | `!`   | `#FFFFFF`   | `#080810`   | unchanged |
| ACTOR_CHANGE_OF_MIND   | `?`   | `#AAAAFF`   | `#080810`   | unchanged |
| ITEM                   | *(§11.1)* | `#CCCCFF` | `#080810` | new     |

Lifecycle beats:
- `MAZE_READY`: rooms stamp in one by one; each room flashes `#C0C0E0` for 8 frames then settles to wall color. (wallEmerge brightened from v2 `#AAAACC`)
- `SOLVER_START`: actor appears with brief white flash over 10 frames.
- `WALK_TO_GOAL_BEAT`: no additional effect.
- `SOLVER_SOLVED`: path pulses `#FFFFFF` → path color over 20 frames.
- `SOLVER_TIMEOUT`: actor becomes `+`; dim to `#444455` over 15 frames.
- `SOLVER_DEATH`: actor becomes `☠` at `#FF5555`; stone-crack flash `#FFFFFF` (alpha 0.5) radiating 1 cell; dim to `#222233` over 20 frames.
- `CYCLE_RESET`: full-canvas darken to `#030306` over 20 frames.

Overlay: at Medium/High intensity, drip effect on WALL cells — one `·` drip per 300 frames per column, falling one row per 4 frames.

**Activation palette:**
| Key       | Value     |
|-----------|-----------|
| primary   | `#CCCCFF` |
| secondary | `#AAAACC` |
| flash     | `#FFFFFF` |

**Decorative elements (unchanged from v2):**
- Glyph set: `,` `·`; Foreground: `#333344`; Background: `#080810`
- Density: Low 0%, Med 4%, High 8%; Animation: none

**HUD palette:**
- background: `rgba(8,8,16,0.88)` | border: `#6E6E99` | header: `#CCCCFF` | meta: `#6E6E99` | active: `#EEEEFF` | done: `#AAAACC` | pending: `#363650`

---

#### Void *(unchanged from v2 — excluded from brightness pass)*

| Semantic State         | Glyph | Foreground  | Background  |
|------------------------|-------|-------------|-------------|
| WALL                   | `#`   | `#220833`   | `#000005`   |
| FLOOR                  | ` `   | `#000005`   | `#000005`   |
| START                  | `*`   | `#CC44FF`   | `#000005`   |
| GOAL                   | `*`   | `#FF44CC`   | `#000005`   |
| ACTOR                  | `@`   | `#DD55FF`   | `#000005`   |
| GENERATING             | `*`   | `#110022`   | `#000005`   |
| ACTOR_WALK_FOUND       | `!`   | `#FFFFFF`   | `#000005`   |
| ACTOR_CHANGE_OF_MIND   | `?`   | `#FF44CC`   | `#000005`   |
| ITEM                   | *(§11.1)* | `#CC44FF` | `#000005` | new     |

Lifecycle beats: unchanged from v2, plus:
- `SOLVER_DEATH`: actor vanishes (alpha → 0 over 8 frames). No death glyph in Void.

Overlay: random FLOOR cells twinkle `·` at `#1A0033` alpha 0.4; one new twinkle per 8 frames; each lasting 40 frames; max 20 active.

**Activation palette:**
| Key       | Value     |
|-----------|-----------|
| primary   | `#CC44FF` |
| secondary | `#FF44CC` |
| flash     | `#FFFFFF` |

**Decorative elements (unchanged from v2):**
- Glyph set: `·` `°`; Foreground: `#110022`; Background: `#000005`
- Density: Low 0%, Med 1%, High 2%; Animation: High only — pulse alpha 0.2→0.6→0.2 per-cell random period [180,360] frames

**HUD palette (unchanged from v2):**
- background: `rgba(0,0,5,0.92)` | border: `#220833` | header: `#CC44FF` | meta: `#220833` | active: `#DD55FF` | done: `#CC44FF` | pending: `#110022`

---

#### Water **(v3)**

| Semantic State         | Glyph | Foreground  | Background  | Change    |
|------------------------|-------|-------------|-------------|-----------|
| WALL                   | `~`   | `#264E8C`   | `#040B1F`   | brighter  |
| FLOOR                  | `.`   | `#122A56`   | `#040B1F`   | brighter  |
| START                  | `>`   | `#40AAFF`   | `#040B1F`   | unchanged |
| GOAL                   | `O`   | `#00CCFF`   | `#040B1F`   | unchanged |
| ACTOR                  | `@`   | `#66BBFF`   | `#040B1F`   | unchanged |
| GENERATING             | `~`   | `#12396C`   | `#040B1F`   | brighter  |
| ACTOR_WALK_FOUND       | `!`   | `#FFFFFF`   | `#040B1F`   | unchanged |
| ACTOR_CHANGE_OF_MIND   | `?`   | `#00CCFF`   | `#040B1F`   | unchanged |
| ITEM                   | *(§11.1)* | `#40AAFF` | `#040B1F` | new     |

Lifecycle beats:
- `MAZE_READY`: wall glyphs cycle `~` → `≈` → `≋` → `≈` over 60 frames (ripple effect; no wallEmerge color in Water).
- `SOLVER_START`: actor rises from `~` to `@` over 12 frames.
- `WALK_TO_GOAL_BEAT`: no additional effect.
- `SOLVER_SOLVED`: path ripples outward from goal; path color pulses `#AAEEFF` → path color.
- `SOLVER_TIMEOUT`: actor becomes `~`; fades to `#12396C` over 20 frames.
- `SOLVER_DEATH`: actor becomes `☠` at `#66DDFF`; ripple rings expand outward from position (1–3 rings in `#264E8C`); dim to `#081830` over 20 frames.
- `CYCLE_RESET`: canvas fades to `#020810` over 25 frames.

Overlay: sinusoidal alpha modulation on WALL cells — `alpha_mod = 0.15 * sin(2π * frameCount / 80 + col * 0.3)`.

**Activation palette:**
| Key       | Value     |
|-----------|-----------|
| primary   | `#40AAFF` |
| secondary | `#264E8C` |
| flash     | `#AAEEFF` |

**Decorative elements (unchanged from v2):**
- Glyph set: `∿` `·`; Foreground: `#12396C`; Background: `#040B1F`
- Density: Low 0%, Med 5%, High 10%; Animation: Med+ — `alpha = 0.3 + 0.2 * sin(2π*(frameCount+phase)/90 + col*0.4)`

**HUD palette:**
- background: `rgba(4,11,31,0.88)` | border: `#264E8C` | header: `#40AAFF` | meta: `#264E8C` | active: `#66BBFF` | done: `#264E8C` | pending: `#122A56`

---

#### Lava **(v3)**

| Semantic State         | Glyph | Foreground  | Background  | Change    |
|------------------------|-------|-------------|-------------|-----------|
| WALL                   | `#`   | `#DD3300`   | `#1A0400`   | brighter  |
| FLOOR                  | `.`   | `#520E00`   | `#1A0400`   | brighter  |
| START                  | `>`   | `#FF8800`   | `#1A0400`   | unchanged |
| GOAL                   | `X`   | `#FF4400`   | `#1A0400`   | unchanged |
| ACTOR                  | `@`   | `#FFAA00`   | `#1A0400`   | unchanged |
| GENERATING             | `*`   | `#A82A00`   | `#1A0400`   | brighter  |
| ACTOR_WALK_FOUND       | `!`   | `#FFFFFF`   | `#1A0400`   | unchanged |
| ACTOR_CHANGE_OF_MIND   | `?`   | `#FF4400`   | `#1A0400`   | unchanged |
| ITEM                   | *(§11.1)* | `#FF8800` | `#1A0400` | new     |

Lifecycle beats:
- `MAZE_READY`: walls erupt — flash `#FF4400` for 8 frames, then settle to `#DD3300` over 20 frames.
- `SOLVER_START`: actor flashes `*` then settles to `@` over 8 frames.
- `WALK_TO_GOAL_BEAT`: actor `!` additionally gets `shadowBlur = 16, shadowColor = "#FF8800"`.
- `SOLVER_SOLVED`: path pulses `#FFDD00` → path color over 25 frames. Strong glow (`shadowBlur = 16`).
- `SOLVER_TIMEOUT`: actor becomes `*`; flash `#FFFFFF` 4 frames; fade to `#441100` over 20 frames.
- `SOLVER_DEATH`: actor becomes `☠` at `#FFDD00`; lava eruption flash `#FFFFFF` (alpha 0.6) on actor cell; surrounding cells pulse `#FF4400` for 16 frames; dim to `#331100` over 20 frames.
- `CYCLE_RESET`: full-canvas white flash (alpha 0.3) over 8 frames, then fade to `#0D0200`.

Overlay: slow lava pulse on FLOOR cells — `alpha_mod = 0.1 * sin(2π * frameCount / 200 + row * 0.5 + col * 0.3)`.

**Activation palette:**
| Key       | Value     |
|-----------|-----------|
| primary   | `#FF8800` |
| secondary | `#DD3300` |
| flash     | `#FFDD00` |

**Decorative elements (unchanged from v2):**
- Glyph set: `;` `'`; Foreground: `#4A1200`; Background: `#1A0400`
- Density: Low 0%, Med 3%, High 6%; Animation: High only — alpha flicker ±0.15, per-cell random period [40,80] frames

**HUD palette:**
- background: `rgba(26,4,0,0.88)` | border: `#A82A00` | header: `#FF8800` | meta: `#A82A00` | active: `#FFAA00` | done: `#DD3300` | pending: `#520E00`

---

#### Cold **(v3)**

| Semantic State         | Glyph | Foreground  | Background  | Change    |
|------------------------|-------|-------------|-------------|-----------|
| WALL                   | `+`   | `#7AB0E0`   | `#040814`   | brighter  |
| FLOOR                  | `.`   | `#0E1B36`   | `#040814`   | brighter  |
| START                  | `>`   | `#EEEEFF`   | `#040814`   | unchanged |
| GOAL                   | `X`   | `#AACCFF`   | `#040814`   | unchanged |
| ACTOR                  | `@`   | `#FFFFFF`   | `#040814`   | unchanged |
| GENERATING             | `+`   | `#435A88`   | `#040814`   | brighter  |
| ACTOR_WALK_FOUND       | `!`   | `#FFFFFF`   | `#040814`   | unchanged |
| ACTOR_CHANGE_OF_MIND   | `?`   | `#AACCFF`   | `#040814`   | unchanged |
| ITEM                   | *(§11.1)* | `#EEEEFF` | `#040814` | new     |

Lifecycle beats:
- `MAZE_READY`: walls crystallize from `·` → `+` one column at a time, left to right, over 40 frames.
- `SOLVER_START`: actor crystallizes from `.` to `@` over 12 frames.
- `WALK_TO_GOAL_BEAT`: no additional effect.
- `SOLVER_SOLVED`: path pulses `#FFFFFF` → path color; glow `shadowColor = #CCDDFF`, `shadowBlur = 10`.
- `SOLVER_TIMEOUT`: actor becomes `x`; dims to `#223355` over 15 frames.
- `SOLVER_DEATH`: actor becomes `☠` at `#AACCFF`; frost crystal rings expand from position (2 rings at `#7AB0E0`); dim to `#0A1224` over 20 frames.
- `CYCLE_RESET`: canvas fades to `#020508` over 20 frames.

Overlay: occasional frost crystals — random FLOOR cells gain `+` at `#1A2A44` alpha 0.5 for 60 frames; max 8 active.

**Activation palette:**
| Key       | Value     |
|-----------|-----------|
| primary   | `#EEEEFF` |
| secondary | `#7AB0E0` |
| flash     | `#FFFFFF` |

**Decorative elements (unchanged from v2):**
- Glyph set: `*` `·`; Foreground: `#1A2A44`; Background: `#040814`
- Density: Low 0%, Med 3%, High 7%; Animation: High only — alpha 0.2→0.5→0.2, per-cell random period [160,240] frames

**HUD palette:**
- background: `rgba(4,8,20,0.88)` | border: `#435A88` | header: `#EEEEFF` | meta: `#435A88` | active: `#FFFFFF` | done: `#7AB0E0` | pending: `#0E1B36`

---

### 8.9 Floor Visual Variation **(v3)**

Each non-Void theme defines per-cell floor glyph and color micro-variants. Variation applies only when `state === SemanticState.FLOOR` and the cell has no decorative assignment.

**Hash formulas:**

```js
function floorGlyphVariant(col, row, N) {
  return (col * 31 + row * 17) % N
}

function floorColorVariant(col, row) {
  return (col * 37 + row * 29) % 3
}
```

Both hashes are computed per `renderCell` call. No per-cell storage is required; the result is deterministic and stable across frames.

**Per-theme floor variant tables:**

| Theme   | Glyph variants (N=3) | Color variant 0 (base) | Color variant 1 (darker) | Color variant 2 (lighter) |
|---------|----------------------|------------------------|--------------------------|---------------------------|
| Forest  | `.` `,` `` ` ``      | `#235216`              | `#1B3F10`                | `#2C6120`                 |
| Desert  | `.` `'` `` ` ``      | `#8C621C`              | `#704E16`                | `#A87224`                 |
| Stone   | `.` `'` `` ` ``      | `#363650`              | `#2A2A40`                | `#40405E`                 |
| Water   | `.` `,` `` ` ``      | `#122A56`              | `#0E2244`                | `#163266`                 |
| Lava    | `.` `,` `` ` ``      | `#520E00`              | `#3E0B00`                | `#621200`                 |
| Cold    | `.` `,` `` ` ``      | `#0E1B36`              | `#0A1428`                | `#121F40`                 |

Glyph variants for Desert avoid `,` (Desert decorative). Glyph variants for Stone avoid `,` (Stone decorative). No other conflicts exist with the tables above.

The backtick (`` ` ``, U+0060) is standard ASCII and is included in the font's required glyph set (Open Item O-1 update).

Color variants are applied to the foreground only; background color is always the theme's floor background.

Void is excluded. Void's floor renders as blank space and has no variation.

### 8.10 Item Activation Visuals **(v3)**

When an item is collected, `main.js` enqueues a standard pickup animation via `renderer.addActivation(itemType, cellIndex, activationPalette)`. Animations are managed by the renderer's `renderActivationEffects` pass (§3.4 step 6). `theme.onItemActivated(itemType, position, durationMs)` is called immediately after for optional theme extras; it does not schedule animations in the renderer queue.

**Activation shape templates:**

| Shape    | Definition                                                                   |
|----------|------------------------------------------------------------------------------|
| Ring     | All cells at Chebyshev distance exactly `R` from position; R=2               |
| Cross    | The 4 cardinal neighbors of position + position itself                       |
| Burst    | All cells within Chebyshev distance `R` of position; R varies               |
| Ripple   | Expanding ring animation: Ring(R=1) → Ring(R=2) → Ring(R=3), each ring fades as next expands |
| Column   | All cells in the same column as position, full grid height                   |
| Spiral   | Cells added in clockwise spiral order, 8 cells, starting from position       |

**Item type → activation shape mapping:**

| Item Type           | Shape     | Duration (frames) | Theme color key |
|---------------------|-----------|-------------------|-----------------|
| Speed Up            | Burst R=2 | 20                | primary         |
| Slow Down           | Ripple    | 40                | secondary       |
| Fog                 | Ring R=3  | 30                | secondary       |
| Lantern             | Burst R=4 | 30                | primary         |
| Freeze              | Ripple    | 60                | flash           |
| Visual Effect       | Column    | 40                | primary         |
| Solver Transformation | Spiral  | 60                | flash           |
| Teleport            | Cross     | 20                | primary         |
| Solution Path Reveal | Column   | 40                | flash           |
| Death               | Ring R=2  | 40                | flash → bg fade |
| Amnesia             | Burst R=2 | 30                | secondary       |

Each activation animation renders affected cells at the theme's `activationPalette` color (at the key listed), with alpha fading linearly from 1.0 to 0.0 over its duration. The Death animation fades from `flash` color toward the theme's background color. Activation animations are drawn on top of maze cells but beneath the HUD.

**Renderer animation interface:** The renderer manages an internal animation queue. `main.js` enqueues a new animation on each item collection:

```js
renderer.addActivation(itemType, cellIndex, activationPalette)
```

The renderer looks up the shape template and duration from the table above, reads the color from `activationPalette[colorKey]`, and adds the animation to its queue. `renderActivationEffects` drains the queue each frame, advancing each animation by one frame and removing it when its duration expires. The renderer owns this queue; themes do not interact with it directly.

**Three-layer visual model for item effects:**

Item collection and duration expiry follow a layered visual contract:

| Layer | Trigger | Who owns it | Required? | When NOT fired |
|-------|---------|-------------|-----------|----------------|
| **Pickup flash** | Item collected | Renderer (`addActivation`) | Yes — always fires | Never skipped |
| **Expiry flash** | Effect timer reaches zero | Theme (`onItemExpired`) | Optional | Run ends (FADING / DEAD_HOLD) |
| **Ongoing visual** | Duration-based effect active | Theme (`onItemActivated` → uses `durationMs`) | Optional | One-time / Permanent items |

- **Pickup flash:** The renderer fires the activation shape animation from the table above (once, on collection). This is the only mandatory visual.
- **Expiry flash:** If a theme wants to signal effect end (e.g., a brief counter-flash), it implements `onItemExpired`. This hook fires only on natural expiry (timer reaching zero), not on run-boundary cleanup (§11.6). Themes that do nothing on expiry leave the hook as a no-op.
- **Ongoing visual:** For duration-based items, `onItemActivated` receives `durationMs`. The theme may use this to drive an ambient overlay or effect for that duration, managed entirely within `renderOverlay`. The effect must self-terminate at `durationMs` (tracked via `performance.now()`). One-time and Permanent items receive `durationMs = null`.

**Visual Effect item (Column shape, pickup flash):** The entire column flashes at `activationPalette.primary` at full alpha at `t=0`, fading linearly to alpha 0 over the activation duration (40 frames). This is the mandatory pickup flash only; the ongoing Visual Effect behavior is theme-governed via the ongoing-visual layer described above.

---

## §9 Cycle and Run Loop **(v3)**

### 9.1 Timing Constants **(v3)**

| Constant         | Value                                       | Configurable |
|------------------|---------------------------------------------|--------------|
| STEP_INTERVAL_MS | config.stepIntervalMs (default 80)          | WE slider    |
| WALK_STEP_MS     | max(10, floor(STEP_INTERVAL_MS / 2))        | Derived      |
| PATH_HOLD_MS     | 2500                                        | No           |
| INTER_SOLVER_MS  | 500 (0 before first solver)                 | No           |
| FADE_MS          | 1500                                        | No           |
| DEAD_HOLD_MS     | PATH_HOLD_MS (2500)                         | No           |

**Effective step interval (v3):** Item effects modify step timing without mutating `config.stepIntervalMs`:

```js
function effectiveStepMs(baseStepMs, isSpeedUpActive, isSlowDownActive) {
  if (isSpeedUpActive && isSlowDownActive) return baseStepMs  // cancel
  if (isSpeedUpActive) return Math.max(10, Math.floor(baseStepMs / 2))
  if (isSlowDownActive) return baseStepMs * 2
  return baseStepMs
}
```

This is recomputed each time the step interval is rescheduled. `config.stepIntervalMs` is never mutated by item effects. During WALK_TO_GOAL, `baseStepMs = WALK_STEP_MS`; during SOLVING, `baseStepMs = config.stepIntervalMs`.

### 9.2 Cycle State Machine **(v3)**

States:

```
GENERATING → INTER_SOLVER → SOLVING → WALK_BEAT → WALK_TO_GOAL → SOLVED_HOLD → FADING
                    ↑_____INTER_SOLVER____↓ (repeat for each solver)
                                       ↓ (death item)
                                   DEAD_HOLD → FADING
                             (SOLVING → DEAD_HOLD also possible)
```

**New state: DEAD_HOLD**

Entered when the actor collects a Death item during SOLVING or WALK_TO_GOAL:
- All solver step intervals are cleared.
- Walk step interval is cleared.
- `trace.phase` is set to `"timeout"` (the run is over; no path animation).
- `SOLVER_DEATH` lifecycle event fires with `{ position: actorCell }`.
- HUD records outcome as `"death"`.
- Actor glyph displays `☠` (theme handles this in `SOLVER_DEATH` event).
- After `DEAD_HOLD_MS` (2500ms), transition to FADING.

**Death during WALK_TO_GOAL overrides prior solve.** The run exits as death `☠`, not as solved `✓`. The `SOLVER_SOLVED` event does not fire.

**Freeze item** causes the step interval to stop ticking (actor does not move) for the Freeze duration. The solve timer continues running. If the Freeze duration expires, the step interval restarts at `effectiveStepMs`. Freeze does not change `trace.phase`.

### 9.3 Item Collection Check **(v3)**

After each actor movement (in both SOLVING step and WALK_TO_GOAL tick):

```js
function checkItemCollection(actorCell, itemMap, runState, config) {
  if (!config.itemsEnabled) return
  if (!itemMap.has(actorCell)) return

  const itemType = itemMap.get(actorCell)
  itemMap.delete(actorCell)           // consumed; gone for remainder of cycle

  const durationMs = fireItemEffect(itemType, actorCell, runState)  // returns ms or null
  renderer.addActivation(itemType, actorCell, theme.activationPalette)        // required pickup flash
  theme.onItemActivated(itemType, actorCell, durationMs)                       // optional theme extras
}
```

This function is implemented in `main.js`, where `theme` and `renderer` are module-level variables. `fireItemEffect` is exported from `items/effects.js` and returns the effect's `durationMs` (a positive number for Temporary items; `null` for Permanent and One-time items). Item collection is checked once per step. Items are collected on the step the actor first occupies that cell.

### 9.4 Run Loop Extensions **(v3)**

The run loop passes `attentionRadius` to `attention.compute()` each frame:

```js
function getAttentionRadius(activeEffects) {
  const hasFog    = activeEffects.some(e => e.type === "fog")
  const hasLantern = activeEffects.some(e => e.type === "lantern")
  if (hasFog && hasLantern) return 6   // cancel
  if (hasFog)    return 3
  if (hasLantern) return 9
  return 6
}
```

Active effects list is managed by the run loop. Each effect has:

```js
{
  type:        string,       // item type key
  name:        string,       // display name for HUD
  expiresAt:   number|null,  // performance.now() value, or null for permanent
  permanent:   bool,
  pickupCell:  number,       // display-grid cell index of the original pickup (for onItemExpired); set from actorCell at collection time
}
```

On each rAF frame: check for naturally expired effects (`performance.now() >= expiresAt`). For each such effect, call `theme.onItemExpired(effect.type, effect.pickupCell)` before removing it from the list. Then remove all expired effects and pass the updated list to `hud.setActiveEffects()`.

When a run ends (transition to FADING or DEAD_HOLD), all active effects are cleared immediately **without** calling `onItemExpired` — run-boundary expiry is silent. Effects do not carry to the next run.

### 9.5 DEAD_HOLD Entry **(v3)**

```js
function enterDeadHold(runState) {
  clearInterval(runState.stepInterval)
  clearInterval(runState.walkInterval)
  runState.activeEffects = []           // expire all effects immediately
  runState.cycleState = "DEAD_HOLD"
  trace.phase = "timeout"              // run is over; suppress path animation
  events.fire(LifecycleEvent.SOLVER_DEATH, { position: trace.actorCell })
  hud.recordOutcome(currentSolverKey, runState.elapsedMs, "death")
  setTimeout(() => enterFading(), DEAD_HOLD_MS)
}
```

---

## §10 WE Integration **(v3)**

### 10.1 Property Declarations **(v3)**

```json
{
  "properties": {
    "theme": {
      "order": 1, "text": "Visual theme", "type": "combo",
      "options": "random;forest;desert;stone;void;water;lava;cold",
      "value": "random"
    },
    "scale": {
      "order": 2, "text": "Terminal scale", "type": "combo",
      "options": "tiny;small;compact;medium;large;xl;huge;poster",
      "value": "medium"
    },
    "intensity": {
      "order": 3, "text": "Effect intensity", "type": "combo",
      "options": "low;medium;high",
      "value": "medium"
    },
    "stepInterval": {
      "order": 4, "text": "Step interval (ms)", "type": "slider",
      "min": 20, "max": 300, "value": 80, "precision": 0
    },
    "fadeOpacity": {
      "order": 5, "text": "Solver fade opacity", "type": "slider",
      "min": 0.0, "max": 1.0, "value": 0.0, "precision": 2
    },
    "maxSolveTime": {
      "order": 6, "text": "Max solve time (multiplier)", "type": "slider",
      "min": 0.25, "max": 4.0, "value": 1.0, "precision": 2
    },
    "cursorLight": {
      "order": 7, "text": "Mouse cursor light", "type": "bool",
      "value": true
    },
    "hudVisible": {
      "order": 8, "text": "Show HUD", "type": "bool",
      "value": true
    },
    "itemsEnabled": {
      "order": 9, "text": "Items enabled", "type": "bool",
      "value": true
    }
  }
}
```

### 10.2 Property Application **(v3)**

| Property       | Behavior on change             |
|----------------|-------------------------------|
| `theme`        | Restart cycle                 |
| `scale`        | Restart cycle                 |
| `intensity`    | Restart cycle                 |
| `stepInterval` | Live update; recompute `WALK_STEP_MS`; restart active step interval |
| `fadeOpacity`  | Live update; next fade uses new value |
| `maxSolveTime` | Live update; new timeout applies on next solver start |
| `cursorLight`  | Live update; no restart       |
| `hudVisible`   | Live update; no restart       |
| `itemsEnabled` | Live update; no restart — see §10.3 |

### 10.3 itemsEnabled Live Update **(v3)**

When `itemsEnabled` changes to `false` mid-cycle:
- All currently active item effects immediately expire.
- No further items are collected for the remainder of the cycle.
- Uncollected items remain in `itemMap` but are invisible to the actor (collection check short-circuits).
- Item cells revert from `ITEM` semantic state to `FLOOR` state in the renderer.

When `itemsEnabled` changes to `true` mid-cycle:
- Uncollected items in `itemMap` resume rendering as `ITEM` state.
- Collection checks resume on the next actor step.

### 10.4 Dev-Mode Defaults *(unchanged from v2)*

When running in a plain browser (WE property listener absent), defaults apply from `config/index.js`. The H key toggles HUD visibility.

### 10.5 Pause and Throttle *(unchanged from v2)*

On WE pause signal: cancel both rAF loop and both step intervals (solver and walk). On resume: restore rAF, restart step interval from current state. Freeze effect duration does not tick during pause (item effect timers are wall-clock-based via `performance.now()`; they do not tick during pause because `performance.now()` is suspended during WE pause in Chromium).

---

## §11 Items System **(v3 — new)**

### 11.1 Item Types and Glyphs

| Item Type           | Key              | Glyph | Effect Category | Unicode     |
|---------------------|------------------|-------|-----------------|-------------|
| Speed Up            | `speed_up`       | `⚡`   | Temporary       | U+26A1      |
| Slow Down           | `slow_down`      | `⧖`   | Temporary       | U+29D6      |
| Fog                 | `fog`            | `◌`   | Temporary       | U+25CC      |
| Lantern             | `lantern`        | `◉`   | Temporary       | U+25C9      |
| Freeze              | `freeze`         | `❄`   | Temporary       | U+2744      |
| Visual Effect       | `visual_effect`  | `◆`   | Temporary       | U+25C6      |
| Solver Transformation | `transformation` | `⟳` | Permanent       | U+27F3      |
| Teleport            | `teleport`       | `⊕`   | One-time        | U+2295      |
| Solution Path Reveal | `solution_reveal` | `⊞` | One-time        | U+229E      |
| Death               | `death`          | `☠`   | One-time        | U+2620      |
| Amnesia             | `amnesia`        | `∅`   | One-time        | U+2205      |

All item glyphs are Unicode symbols. They must not conflict with reserved semantic glyphs (`@`, `!`, `?`) or any theme-specific WALL, FLOOR, START, GOAL, ACTOR, or GENERATING glyph in the active theme.

The `☠` glyph is used both as the Death item's tile glyph and in the HUD death outcome. This dual use is intentional.

### 11.2 Item Density

```js
function computeItemCount(D_cols, D_rows) {
  return Math.max(3, Math.min(11, Math.round(0.08 * Math.sqrt(D_cols * D_rows))))
}
```

See §5.3 for placement algorithm.

### 11.3 Effect Application

**Speed Up** (`speed_up`, Temporary, 5–60s):
- `effectiveStepMs` halves (capped at 10ms minimum).
- Speed Up + Slow Down simultaneously: cancel to base interval.
- Speed Up + Freeze: actor is frozen; Speed Up duration ticks silently; actor resumes at sped-up rate if Freeze expires first; if Speed Up expires while frozen, no visible effect on thaw.
- HUD: `"Speed Up    Xs"` (countdown).

**Slow Down** (`slow_down`, Temporary, 5–60s):
- `effectiveStepMs` doubles.
- Speed Up + Slow Down simultaneously: cancel to base interval.
- HUD: `"Slow Down   Xs"`.

**Fog** (`fog`, Temporary, 5–60s):
- `attentionRadius` = 3.
- Fog + Lantern simultaneously: cancel to default radius 6.
- HUD: `"Fog         Xs"`.

**Lantern** (`lantern`, Temporary, 5–60s):
- `attentionRadius` = 9.
- Fog + Lantern simultaneously: cancel to default radius 6.
- HUD: `"Lantern     Xs"`.

**Freeze** (`freeze`, Temporary, 5–60s):
- Solver step interval stops (actor does not move). Solve timer continues running.
- Walk step interval stops if in WALK_TO_GOAL phase.
- After Freeze expires, step interval restarts at current `effectiveStepMs`.
- HUD: `"Freeze      Xs"`.

**Visual Effect** (`visual_effect`, Temporary, 5–60s):
- Pickup: renderer fires the mandatory Column activation flash (§8.10).
- Ongoing (optional): theme receives `durationMs` in `onItemActivated` and may drive an ambient full-screen or overlay effect for that duration via `renderOverlay`. The theme is responsible for terminating the effect at `durationMs`.
- Expiry (optional): theme may implement `onItemExpired` to signal effect end with a brief counter-visual. Not called on run-boundary expiry (§11.6).
- HUD: `"Visual Fx   Xs"`.

**Solver Transformation** (`transformation`, Permanent):
- Current solver's algorithm is replaced by a new solver drawn from eligible pool: all solvers not yet run this cycle, excluding the current solver.
- Pool math guarantees ≥ 2 eligible candidates (6 solvers in pool, 4 cycle slots, at most 1 transformation per cycle).
- If the drawn solver was a future scheduled slot in `selectedSolvers`, that slot is replaced by the next bench solver (pool remainder = the 2 solvers not assigned to cycle slots).
- Actor position unchanged. Timer carries over (no reset). `trace.visited` and breadcrumbs carry over. New solver initializes from `trace.actorCell`.
- Actor glyph color oscillates between pre-transformation path color and new solver path color:
  ```js
  // t = performance.now() at time of transformation pickup
  // each frame:
  const phase = ((performance.now() - transformPickupTime) % 2000) / 2000
  const blend = 0.5 - 0.5 * Math.cos(2 * Math.PI * phase)
  actorColor = lerpColor(preTransformPathColor, newSolverPathColor, blend)
  ```
  Period: 2000ms. `blend` goes 0→1→0 over each 2000ms cycle (sinusoidal, not linear).
- HUD solver row name updates to new solver name immediately.
- Only one transformation can occur per run (one transformation item per maze; once collected, gone).
- HUD: `"Transform   ∞"`.

**Teleport** (`teleport`, One-time):
- Actor is immediately moved to a randomly selected floor cell.
- Destination pool: all FLOOR cells excluding start, goal, and cells currently in `itemMap`.
- Any active temporary effects continue from new position.
- No HUD entry.

**Solution Path Reveal** (`solution_reveal`, One-time):
- If `trace.phase === "walk_to_goal"`: no-op. Item consumed.
- Otherwise: triggers the standard WALK_TO_GOAL pipeline immediately. `trace.beatGlyph = "!"`. `WALK_TO_GOAL_BEAT` fires. Walk uses `nextStep[]` (§5.4) rather than solver's parent map. Actor walks to goal and run exits as solved.
- No HUD entry.

**Death** (`death`, One-time):
- Enter DEAD_HOLD immediately (§9.5). Run exits as `☠`.
- If in WALK_TO_GOAL: DEAD_HOLD overrides prior solved state.
- No HUD entry (outcome recorded as death `☠` in solver row).

**Amnesia** (`amnesia`, One-time):
- Calls `solver.applyAmnesia(trace)` (§6.3).
- All VISITED cells revert to FLOOR display state.
- Actor continues from current position.
- No HUD entry.

### 11.4 Walk-to-Goal Half-Cadence Rule

Effects collected during WALK_TO_GOAL phase apply at half-cadence:

| Effect type              | Half-cadence rule                                               |
|--------------------------|-----------------------------------------------------------------|
| Speed Up / Slow Down     | Applied relative to already-halved `WALK_STEP_MS`              |
| Fog / Lantern            | Duration is halved                                              |
| Freeze                   | Pauses walk; duration is halved                                 |
| Visual Effect            | `durationMs` passed to `onItemActivated` is halved; pickup flash duration is unaffected |
| All other effects        | Standard rules apply                                            |

Effects already active when WALK_TO_GOAL begins (collected during SOLVING phase) continue at their original wall-clock duration; they are not retroactively halved.

### 11.5 Effect Stacking

Same-type stacking is impossible (at most one instance per type per maze). Effects of different types stack freely; each active effect's duration runs independently.

Opposing effect pairs:
- Speed Up + Slow Down → net interval = base (both durations tick independently)
- Fog + Lantern → net radius = 6 default (both durations tick independently)
- Speed Up + Freeze → Freeze wins; actor is frozen; Speed Up ticks silently

### 11.6 Effect Scoping and Expiry

All active item effects expire at run boundary:
- Transition to FADING: all active effects cleared.
- Transition to DEAD_HOLD: all active effects cleared immediately.
- Effects do not carry over to the next solver's run.

The `itemMap` persists across runs within a cycle. Once an item is collected, it is removed from `itemMap` for the remainder of the cycle. Uncollected items survive solver run boundaries.

### 11.7 Item Rendering

Item cells render as `SemanticState.ITEM` in the theme's `renderCell`. The `ITEM` state is pre-resolved by `main.js` into `stateGrid` (see §3.8); the renderer reads the state and calls `theme.renderCell` with `state = ITEM`.

Item cells are exempt from attention field dimming (same as start and goal cells). They render at full foreground color regardless of actor distance.

Item glyph is looked up from the `ItemType → glyph` table in §11.1. Foreground color is the theme's ITEM foreground. Background is the theme's floor background.

---

## §12 Performance Contract **(v3)**

### 12.1 Frame Budget *(unchanged from v2)*

Target: ≥ 55 fps sustained during active solving at Tiny scale on a mid-tier GPU. All frame work must complete within a single rAF callback. No solver work is permitted in the rAF callback.

### 12.2 Per-Frame Work Bounds **(v3)**

| Work item                          | Bound                                              |
|------------------------------------|----------------------------------------------------|
| Attention field compute            | O(D_cols × D_rows)                                 |
| Cell render loop                   | O(D_cols × D_rows)                                 |
| Activation animations              | O(active_animations × affected_cells); max ~50 cells per animation |
| HUD render                         | O(1) (fixed content)                               |
| Item collection check              | O(1) per step (hash map lookup)                    |
| Precomputed solution (generation)  | O(D_cols × D_rows) BFS; one-time per cycle         |

### 12.3 Memory Bounds **(v3)**

- `nextStep` array: `D_cols × D_rows × 4` bytes (Int32Array). Freed on CYCLE_RESET.
- `itemMap`: at most 11 entries. Negligible.
- Active effects list: at most 11 entries (one per item type; same-type stacking impossible). Negligible.
- Item activation animations: at most 11 simultaneously active. Each holds at most 50 affected cells. Freed when animation completes.
- Wall Follower fingerprint set: at most `4 × D_cols × D_rows` entries. Released on solver run end.

### 12.4 Intensity Scaling *(unchanged from v2)*

At Low intensity: no glow, no per-frame attention recomputation (static ambient), no decoratives. Item collection and effects still apply at Low intensity — intensity governs visual richness, not game logic.

### 12.5 No Per-Frame Allocations

The attention field array, render scratch buffers, and activation animation cell arrays are pre-allocated and reused. No new arrays are allocated per frame during steady-state solving or rendering.

---

## §13 Acceptance Criteria **(v3)**

Criteria marked **(v1)** are inherited from v1. Criteria marked **(v2)** are from v2. Criteria marked **(v3)** are new.

### Renderer

- **(v1)** Canvas contains a centered exact-cell grid with no partial cells visible at any canvas edge.
- **(v1)** All 8 scale presets produce a legible grid at the specified font and cell metrics.
- **(v1)** On a 2560×1440 display at Tiny scale, the wallpaper sustains ≥ 55 fps during active solving.
- **(v1)** Cursor flicker on the actor cell fires at 530ms period.
- **(v1)** Glow is absent at Low intensity; present at Medium and High.
- **(v1)** After resize, the grid recomputes and a new cycle begins within 200ms.
- **(v2)** `ACTOR_WALK_FOUND` state renders `!` glyph at `#FFFFFF` with `shadowBlur = 12` regardless of intensity.
- **(v2)** `ACTOR_CHANGE_OF_MIND` state renders `?` glyph in the theme's goal foreground color.
- **(v2)** Cursor flicker is suppressed while `trace.beatGlyph` is non-null.
- **(v3)** `ITEM` state cells render at full theme foreground color; attention dimming is not applied to item cells.
- **(v3)** Item cells render with the correct glyph from §11.1 for their type.
- **(v3)** Floor variation: non-Void themes render at least 2 distinct floor glyphs across a standard grid; same cell always renders same glyph across frames.
- **(v3)** Floor variation does not appear on cells in VISITED, FRONTIER, PATH, ACTOR, START, GOAL, or ITEM state.
- **(v3)** Decorative cells do not show floor variation; decorative takes priority.
- **(v3)** Activation animations render on top of maze cells and beneath the HUD.
- **(v3)** Activation animations are absent when `config.itemsEnabled = false`.

### Maze Generation

- **(v1)** Each of the 5 generators produces a fully connected maze.
- **(v1)** CA generator: one contiguous FLOOR region after generation.
- **(v1)** Room-and-Corridor: all placed rooms connected to at least one corridor.
- **(v1)** Generation animation completes in 3–6 seconds at 60 fps across all scale presets.
- **(v1)** START and GOAL cells are never the same cell.
- **(v1)** BFS distance from START to GOAL is ≥ 50% of maximum BFS distance.
- **(v2)** Backtracker: all four outer-border rows/columns are uniformly WALL after generation.
- **(v2)** Organic/CA: area < 400 uses reduced parameters; area < 100 falls back to Prim's.
- **(v3)** `computeItemCount(160, 45)` returns a value in [3, 11].
- **(v3)** No two items occupy the same cell. START and GOAL cells contain no items.
- **(v3)** `nextStep[goalCellIndex] === goalCellIndex`.
- **(v3)** `nextStep[startCellIndex] !== -1` on a connected maze.
- **(v3)** Following `nextStep[]` from start reaches goal in BFS-optimal step count.
- **(v3)** When `config.itemsEnabled = false`, `itemMap` is empty after generation.

### Solver System

- **(v1)** DFS, BFS, A*, Greedy, Wall Follower each solve a standard 21×21 display grid correctly.
- **(v1)** Each solver leaves its breadcrumb color; no solver uses another's color.
- **(v1)** After `maxSolveMs`, solver transitions to `"timeout"` within one step interval.
- **(v1)** Solver selection never picks the same solver twice in one cycle.
- **(v1)** Exactly 4 solvers run per cycle.
- **(v1)** Frontier algorithms keep the actor adjacent on each step (no teleporting).
- **(v2)** Random Walk is unconditionally present in the solver pool.
- **(v2)** `computeMaxSolveMs(113, 32, 1.0)` returns approximately 300000ms (±5s).
- **(v2)** BFS, A*, Greedy do not change `commitTarget` more often than their commit window allows.
- **(v2)** Exit-visibility shortcut does not fire for Random Walk or Wall Follower.
- **(v3)** Wall Follower in seek mode navigates toward a wall surface and transitions to follow mode upon first wall contact.
- **(v3)** Wall Follower in follow mode applies the pure right-hand rule with no visit condition.
- **(v3)** Wall Follower terminates (timeout) on a maze where the actor would loop; fingerprint detection fires in follow mode.
- **(v3)** Wall Follower starting in a fully open area does not immediately timeout; it navigates visibly before follow mode begins.
- **(v3)** `applyAmnesia()` on any solver clears `trace.visited` and all breadcrumb display; actor stays at current position.
- **(v3)** After `applyAmnesia()`, solver resumes from actor's current position without errors.
- **(v3)** Transformation: actor color oscillates between pre-transformation and new solver path colors with 2000ms period after collection.
- **(v3)** Transformation: `selectedSolvers` still runs exactly 4 slots after any transformation; no solver runs twice.

### Walk-to-Goal

- **(v2)** After a path-tracking solver finds the goal, the `!` beat fires for exactly one `STEP_INTERVAL_MS` before the walk begins.
- **(v2)** Walk steps fire at `WALK_STEP_MS = max(10, floor(STEP_INTERVAL_MS / 2))`.
- **(v2)** Actor arrives at goal before `SOLVER_SOLVED` fires.
- **(v2)** Random Walk: `SOLVER_SOLVED` fires immediately after the `!` beat (no walk phase).
- **(v2)** Walk-to-goal is skipped entirely on timeout runs.
- **(v3)** Solution Path Reveal triggers the walk-to-goal pipeline using `nextStep[]`; run exits as solved.
- **(v3)** Solution Path Reveal fired during walk-to-goal phase is a no-op; item is consumed.
- **(v3)** Death item collected during walk-to-goal enters DEAD_HOLD; outcome is `☠` not `✓`.
- **(v3)** Items collected during walk-to-goal apply effects at half-cadence (duration-based effects at half their rolled duration).

### Attention Field

- **(v1)** At d=0, attention_factor = 1.0. At d=6 (default radius), attention_factor = 0.25.
- **(v1)** Wall and floor glyphs are visibly dimmer in cells far from the actor at Medium intensity.
- **(v1)** At Low intensity, all cells render at flat ambient (0.50).
- **(v2)** Cursor light illuminates nearby cells when cursor is over canvas.
- **(v2)** Cursor light fades to zero within 500ms after cursor leaves the canvas.
- **(v2)** Max-blend: far cell is as bright as the brighter of the two sources.
- **(v3)** With Fog active, cells at d=4 render noticeably dimmer than without Fog (radius = 3 vs 6).
- **(v3)** With Lantern active, cells at d=8 render noticeably brighter than without Lantern (radius = 9 vs 6).
- **(v3)** With Fog + Lantern simultaneously active, attention radius is 6 (default).
- **(v3)** Exit-visibility shortcut always uses radius 6, regardless of Fog or Lantern effect.
- **(v3)** Item cells are not subject to attention dimming; they render at full foreground color at any distance.

### HUD

- **(v2)** HUD is visible by default. `H` key toggles it within the current cycle.
- **(v2)** HUD initializes to `config.hudVisible` state at each cycle start.
- **(v2)** HUD displays theme name, generator name, and up to 4 solver run rows.
- **(v2)** Active solver row shows live elapsed time updating each rAF frame.
- **(v2)** HUD renders on top of all maze cells at full opacity; no attention dimming.
- **(v2)** Each of the 7 themes renders HUD with its distinct `hudPalette` colors.
- **(v3)** Death outcome in solver row displays `☠`, not `✓` or `✗`.
- **(v3)** With one active Temporary effect, HUD panel is taller than base 144px by exactly 2 rows (separator + 1 effect).
- **(v3)** Active effect rows show countdown in seconds (Temporary) or `∞` (Permanent).
- **(v3)** Effects list is empty when no item effects are active.
- **(v3)** Effects list clears when the solver run ends (transition to FADING or DEAD_HOLD).

### Theme System

- **(v1)** Each of the 7 themes renders without JS errors or missing glyphs.
- **(v1)** Solver breadcrumb and path colors are recognizable in all 7 themes.
- **(v1)** Fade completes in 1500ms; `targetFadeOpacity` is honored.
- **(v2)** On MAZE_READY, each theme (at Medium intensity) places decoratives on ≥ 1% of eligible floor cells.
- **(v2)** Decoratives do not appear on START or GOAL cells.
- **(v2)** At Low intensity, no decoratives appear for any theme.
- **(v3)** Each non-Void theme's WALL foreground is visibly brighter than v2 values while preserving hue identity.
- **(v3)** Void theme is visually unchanged from v2.
- **(v3)** `SOLVER_DEATH` event fires when actor collects Death item; `SOLVER_SOLVED` and `SOLVER_TIMEOUT` do not fire for that run.
- **(v3)** `onItemActivated(itemType, position, durationMs)` fires for each item type; `durationMs` is a positive number for Temporary items and `null` for Permanent and One-time items; no JS errors across all 7 themes.
- **(v3)** `onItemExpired` fires for each Temporary item on natural timer expiry; does not fire on run-boundary effect clearing.

### Items System

- **(v3)** Speed Up halves `effectiveStepMs` (capped at 10ms) for the effect's duration.
- **(v3)** Slow Down doubles `effectiveStepMs` for the effect's duration.
- **(v3)** Speed Up + Slow Down simultaneously: actor moves at base interval.
- **(v3)** Freeze stops actor movement; solve timer continues; actor resumes on expiry.
- **(v3)** Fog: `attentionRadius = 3` for the effect's duration.
- **(v3)** Lantern: `attentionRadius = 9` for the effect's duration.
- **(v3)** Teleport: actor moves to a valid floor cell excluding start, goal, and item cells; no chain-reaction teleports.
- **(v3)** Amnesia: `trace.visited` is empty (except actor's current cell) after firing; no errors.
- **(v3)** Transformation: new solver draws from eligible pool (not already run, not current solver); run continues normally.
- **(v3)** All active item effects expire when the run ends; next solver starts with no active effects.
- **(v3)** Once an item is collected, it does not reappear in subsequent solver runs of the same cycle.
- **(v3)** When `itemsEnabled` toggled false mid-cycle, no further items are collected and all active effects expire.
- **(v3)** When `itemsEnabled` toggled true after being false, uncollected items resume rendering and collection.
- **(v3)** No JS errors or degenerate behavior on any of the 11 item types across all 7 themes.

### Cycle and Run Loop

- **(v1)** Full cycle runs without deadlock or hang on a fresh browser page.
- **(v1)** PATH_HOLD_MS of 2500ms elapses before fade begins (for solved runs).
- **(v1)** INTER_SOLVER_MS pause is 500ms between solvers; 0ms before first solver.
- **(v2)** CYCLE_RESET fires after all 4 solvers complete.
- **(v2)** On step interval change via WE property, WALK_STEP_MS is recomputed.
- **(v3)** DEAD_HOLD lasts 2500ms before FADING; no solver step fires during DEAD_HOLD.
- **(v3)** Death during WALK_TO_GOAL stops the walk interval immediately.
- **(v3)** `nextStep` array is freed on CYCLE_RESET (not retained across cycles).

### Wallpaper Engine Integration

- **(v1)** Properties appear in WE panel with correct labels and defaults.
- **(v1)** `stepInterval` changes update solver cadence without restarting current solver.
- **(v1)** `theme` and `scale` changes restart the cycle.
- **(v2)** `cursorLight` and `hudVisible` properties appear with correct defaults.
- **(v2)** Wallpaper runs correctly in plain Chrome/Edge with no WE present.
- **(v3)** `itemsEnabled` property appears in WE panel, type bool, default true.
- **(v3)** `itemsEnabled` change is a live update; no cycle restart.

### Performance

- **(v1)** No `console.error` or uncaught exceptions during a 10-minute run.
- **(v1)** Memory usage does not grow between successive cycles.
- **(v1)** No per-frame allocations during steady-state solving.
- **(v2)** Cursor light max-blend pass does not cause sustained frame times above 16.7ms at Tiny scale.
- **(v3)** Item activation animations do not cause sustained frame times above 16.7ms at Tiny scale.
- **(v3)** `precomputeSolution()` completes before the first solver starts; no perceptible delay at any scale preset.

---

## Open Items

**O-1: Bundled font glyph requirements (updated for v3).**

The font must include at minimum: all printable ASCII (including `` ` `` U+0060); `█ ░ ▒ ▓ · ≈ ≋ ╬ ║ ×` (v1); `° ∿ ♣ ♠ ✓ ✗` (v2); and the following v3 additions:

Item glyphs: `⚡` U+26A1, `⧖` U+29D6, `◌` U+25CC, `◉` U+25C9, `❄` U+2744, `◆` U+25C6, `⟳` U+27F3, `⊕` U+2295, `⊞` U+229E, `☠` U+2620, `∅` U+2205.

HUD additions: `∞` U+221E (permanent effect indicator).

The item glyphs are the highest-risk additions for font coverage — particularly `⧖` (U+29D6 HOURGLASS WITH FLOWING SAND), `⟳` (U+27F3 CLOCKWISE GAPPED CIRCLE ARROW), and `⊞` (U+229E SQUARED PLUS). If any glyph is absent from the chosen font, fallback glyphs must be designated before implementation:
- `⧖` → `T` (not used as semantic glyph in any theme; `%` is Desert's SOLVER_TIMEOUT glyph and must be avoided)
- `⟳` → `&` (arbitrary, not used elsewhere)
- `⊞` → `=` (arbitrary, not used elsewhere)

Fallback assignment must not introduce conflicts with theme semantic glyphs.

**O-2: Wallpaper Engine `project.json` property schema encoding.**

Unchanged from v2. The `itemsEnabled` property follows the same encoding pattern as `cursorLight` and `hudVisible`.

**O-3: Wallpaper Engine pause and resume API.**

Unchanged from v2. During WE pause, item effect expiry timers do not advance (Chromium suspends `performance.now()` during WE pause); no special handling is required.

*(No open items remain.)*
