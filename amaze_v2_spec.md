# amaze — v2 Implementation Specification

> **Scope:** This document is the implementation contract for `amaze` v2. It derives from `amaze_v2_foundation.md`, which owns intent, philosophy, and closed decisions for v2, and inherits base identity from `amaze_foundation.md`. This spec owns exact values, algorithms, interfaces, and acceptance criteria. Any conflict between this spec and the v2 foundation document should be resolved in favor of the foundation's intent, with this spec updated to match.
>
> **Relationship to v1:** This spec supersedes `amaze_spec.md` for all v2 implementation work. Sections marked **(unchanged from v1)** reproduce v1 content for developer convenience; they carry no v2 changes. Sections marked **(v2)** contain new or revised requirements.

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
8. **(v2)** The HUD is drawn on the main canvas after all grid cells and theme overlays; it uses full-opacity colors and is never subject to attention field dimming.
9. **(v2)** The cursor position is never passed to any solver logic path. Cursor state feeds the visual light model only.

---

## §1 Purpose

`amaze` generates a full-screen ASCII maze, animates a set of solver algorithms traversing it, then resets into a new maze and repeats. The implementation target is a Wallpaper Engine web wallpaper: an `index.html` file and supporting assets delivered as a local web page, rendered inside Wallpaper Engine's Chromium runtime.

v2 builds on the working v1 foundation. It does not change the core loop. v2 addresses behavioral defects observed in v1, promotes random walk to a first-class solver, deepens the honesty of the solver lifecycle through a walk-to-goal phase, gives frontier solvers directional momentum through commit-to-path, introduces the mouse cursor as a second independent light source, adds per-theme decorative elements, and formally adopts the HUD as a theme-aligned UI element.

The wallpaper must run without network access. All assets must be bundled locally.

---

## §2 Project Structure **(v2)**

```
amaze/
  index.html          entry point; minimal shell, loads main.js
  main.js             top-level orchestrator; owns run loop, WE integration, cursor state
  renderer.js         Canvas 2D renderer; owns glyph drawing, glow, flicker, HUD draw call
  maze.js             maze cell model and grid utilities
  hud.js              HUD state, layout algorithm, and canvas rendering     ← NEW
  attention.js        Attention field computation; solver + cursor light blend
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
  project.json        Wallpaper Engine project manifest and property declarations
  assets/
    font.woff2        Bundled monospace font (see Open Items O-1)
```

**Module boundaries (v2 additions in bold):**

- `main.js` imports from all other modules. No other module imports from `main.js`.
- `renderer.js` imports from `maze.js`, `themes/index.js`, `attention.js`, and **`hud.js`**.
- **`hud.js` imports from `themes/index.js` only.**
- `attention.js` has no imports.
- Generator modules import only from `maze.js`.
- Solver modules import only from `maze.js`. They do not import renderer, theme, or HUD modules.
- Theme modules import only the semantic state and lifecycle enums from `solvers/index.js` and `maze.js`.

---

## §3 Canvas Renderer

### 3.1 Scale Presets and Cell Metrics *(unchanged from v1)*

| Preset  | Font (px) | Cell W (px) | Cell H (px) | Label   |
|---------|-----------|-------------|-------------|---------|
| Tiny    | 12        | 8           | 15          | `tiny`  |
| Small   | 14        | 9           | 17          | `small` |
| Compact | 16        | 10          | 19          | `compact` |
| Medium  | 18        | 11          | 22          | `medium` |
| Large   | 20        | 12          | 24          | `large` |
| XL      | 22        | 14          | 27          | `xl`    |
| Huge    | 24        | 15          | 30          | `huge`  |
| Poster  | 28        | 17          | 34          | `poster` |

Cell width and cell height are the CSS-pixel advance width and line height used for grid layout. Font size is the `font-size` value passed to `ctx.font`. All cell metrics are fixed per preset; there is no dynamic measurement of actual glyph advance.

### 3.2 Grid Sizing *(unchanged from v1)*

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

### 3.3 DPI Scaling *(unchanged from v1)*

A global scale transform is applied once after canvas resize:

```
ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0)
```

After that transform, all `ctx` draw calls and coordinate math use CSS pixels. Cell (col, row) draws its glyph at CSS pixel position `(col * cw, row * ch)`.

### 3.4 Render Loop **(v2)**

The render loop runs via `requestAnimationFrame`. Each frame:

1. Clear the canvas with the active theme's background color.
2. For each cell `(col, row)` in the display grid, determine its semantic state from the current maze and solver trace.
3. Ask the active theme to render that cell given its semantic state, solver color (if any), and attention factor.
4. Apply glow pass over bright cells (actor, beat glyphs, final path, beat targets).
5. Apply cursor flicker to the actor cell.
6. Call `theme.renderOverlay(ctx, D_cols, D_rows, cw, ch, frameCount)`.
7. **(v2)** Call `hud.render(ctx, theme, cw, ch, D_cols, D_rows, frameCount)` if HUD is visible.

The rAF loop runs continuously. Solver stepping is governed by a separate `setInterval` (see §9.2). The render loop never advances solver or generator state; it only reads it.

**Actor semantic state selection (v2):** The renderer determines the SemanticState for the actor cell as follows:

```
if trace.beatGlyph === "!":  state = SemanticState.ACTOR_WALK_FOUND
elif trace.beatGlyph === "?": state = SemanticState.ACTOR_CHANGE_OF_MIND
else:                         state = SemanticState.ACTOR
```

`trace.beatGlyph` is a field on SolverTrace (see §6.1). It is null during normal movement, `"?"` during a change-of-mind beat, and `"!"` during a walk-to-goal beat.

### 3.5 Glyph Rendering *(unchanged from v1)*

Each cell is drawn by:

```
ctx.fillStyle = bgColor
ctx.fillRect(col * cw, row * ch, cw, ch)
ctx.fillStyle = fgColor
ctx.font = fontSize + "px 'AmazeMono', monospace"
ctx.textBaseline = "top"
ctx.fillText(glyph, col * cw + xOffset, row * ch + yOffset)
```

`xOffset` and `yOffset` are theme-owned constants that center the glyph within the cell. Default: `xOffset = 0`, `yOffset = 0`. Themes may adjust within `±2px` for optical alignment.

Each cell is redrawn every frame. There is no dirty-cell optimization in v2.

### 3.6 Glow *(unchanged from v1)*

Glow is a soft shadow drawn under bright glyphs. When enabled by intensity setting:

- Low: no glow.
- Medium: `ctx.shadowBlur = 6`, `ctx.shadowColor = glowColor`.
- High: `ctx.shadowBlur = 12`, `ctx.shadowColor = glowColor`.

Glow applies to: the actor glyph, final-path cells, ACTOR_WALK_FOUND cells (always `shadowBlur = 12`, `shadowColor = #FFFFFF`, regardless of intensity setting — the `!` beat always glows), ACTOR_CHANGE_OF_MIND cells at Medium/High, and any cell in an active lifecycle beat that the theme marks as bright. All other cells are drawn with `ctx.shadowBlur = 0`.

Glow state must be reset after each bright glyph draw to avoid bleeding onto neighboring cells.

### 3.7 Cursor Flicker *(unchanged from v1)*

The actor cell alternates between full opacity and `0.55` opacity on a 530ms cycle (265ms on, 265ms off). Flicker is implemented by modulating the actor glyph's `ctx.globalAlpha` before drawing. All other cells draw at `ctx.globalAlpha = 1.0`.

Cursor flicker is independent of solver step cadence. Flicker is suppressed when the actor is rendering as `ACTOR_WALK_FOUND` or `ACTOR_CHANGE_OF_MIND` — beat cells always render at full opacity for their duration.

### 3.8 Resize and Restart *(unchanged from v1)*

A `ResizeObserver` watches the document body. On resize:

1. Recompute `D_cols`, `D_rows`, and canvas dimensions.
2. Cancel the active generator animation frame callback and solver `setInterval`.
3. Discard all maze, solver, and trace state.
4. Signal the run loop to begin a new cycle from generation.

Debounce resize events with a 150ms trailing delay to avoid thrashing during window drag.

### 3.9 HUD Rendering **(v2)**

The HUD is rendered directly onto the main canvas at the end of each rAF frame (step 7 of §3.4). It does not use a separate DOM canvas element. Drawing uses `ctx.save()` / `ctx.restore()` to avoid corrupting renderer state. All HUD draw calls use full-opacity colors; no attention factor is applied.

`hud.render(ctx, theme, cw, ch, D_cols, D_rows, frameCount)` owns the full HUD draw pass. See §8.6 for the HUD layout specification and §8.8 for per-theme `hudPalette` values.

### 3.10 Mouse Cursor Light Tracking **(v2)**

`main.js` attaches event listeners to the canvas to track cursor position for the cursor light source:

```js
canvas.addEventListener('mousemove', e => {
  const rect = canvas.getBoundingClientRect()
  cursorState.col   = Math.floor((e.clientX - rect.left) / cw)
  cursorState.row   = Math.floor((e.clientY - rect.top)  / ch)
  cursorState.alpha = 1.0
  cursorState.col   = Math.max(0, Math.min(D_cols - 1, cursorState.col))
  cursorState.row   = Math.max(0, Math.min(D_rows - 1, cursorState.row))
  cursorState.fadeStart = null
})

canvas.addEventListener('mouseleave', () => {
  cursorState.fadeStart = performance.now()
})
```

`cursorState` is a plain object `{ col, row, alpha, fadeStart }` owned by `main.js` and passed to `renderer.draw()` each frame. Each rAF frame, `main.js` updates `cursorState.alpha`:

```js
if (cursorState.fadeStart !== null) {
  const elapsed = performance.now() - cursorState.fadeStart
  cursorState.alpha = Math.max(0, 1.0 - elapsed / CURSOR_FADE_MS)
}
```

`CURSOR_FADE_MS = 500`.

When `config.cursorLight` is `false`, `cursorState.alpha` is forced to `0` regardless of cursor position.

`cursorState` is passed to `attention.compute()` (see §7.5). It is never passed to any solver, generator, or theme function.

---

## §4 Maze Cell Model *(unchanged from v1)*

### 4.1 CellType Enum

```js
const CellType = {
  WALL:  0,
  FLOOR: 1,
  START: 2,
  GOAL:  3,
}
```

Solver trace state (actor, visited, frontier, path) is stored separately from the base cell model. The base maze model contains only `CellType` values.

### 4.2 Grid Storage

The display grid is stored as a flat `Uint8Array` of length `D_cols * D_rows`. Cell `(col, row)` maps to index `row * D_cols + col`.

```js
function cellAt(grid, col, row, D_cols) {
  return grid[row * D_cols + col]
}
function setCell(grid, col, row, D_cols, value) {
  grid[row * D_cols + col] = value
}
```

A new `Uint8Array` is allocated at the start of each generation cycle.

### 4.2.1 Passability

```js
function isPassableCell(type) {
  return type === CellType.FLOOR || type === CellType.START || type === CellType.GOAL
}
```

`START` and `GOAL` are passable map cells. Any pseudocode that refers to FLOOR neighbors for solver movement means passable neighbors unless explicitly describing generator carving before start/goal placement.

### 4.3 Coordinate System

- `(0, 0)` is the top-left cell.
- `col` increases to the right; `row` increases downward.
- Display cells at even `col` and even `row` are wall cells in the initial grid before carving.
- Display cells at odd `col` and odd `row` are potential room cells.
- Display cells at mixed parity are passage cells between rooms.

### 4.4 Logical Room Grid

```
room_cols = floor((D_cols - 1) / 2)
room_rows = floor((D_rows - 1) / 2)
```

Logical room `(rx, ry)` maps to display cell `(2*rx + 1, 2*ry + 1)`.

The passage between logical room `(rx, ry)` and its right neighbor `(rx+1, ry)` occupies display cell `(2*rx + 2, 2*ry + 1)`. The passage between `(rx, ry)` and its bottom neighbor `(rx, ry+1)` occupies display cell `(2*rx + 1, 2*ry + 2)`.

The Organic/CA generator does not use the logical room grid; it operates directly on the display grid.

### 4.5 Initial Grid State

At the start of generation, all display cells are set to `CellType.WALL`. Generators carve floor cells from this initial state.

---

## §5 Maze Generation

### 5.1 Generator Interface *(unchanged from v1)*

```js
class Generator {
  totalSteps(D_cols, D_rows) { return 0 }
  begin(grid, D_cols, D_rows, rng) {}
  step() { return true }
  getGrid() { return null }
}
```

Generators own the `Uint8Array` grid during the generation phase. On completion, `main.js` takes ownership by calling `getGrid()` and discarding the generator.

### 5.2 Generation Animation *(unchanged from v1)*

Generation animation runs in the rAF loop. Each frame, the renderer calls `generator.step()` `steps_per_frame` times before drawing:

```
steps_per_frame = max(1, floor(total_steps / 240))
```

Where `total_steps = generator.totalSteps(D_cols, D_rows)` and 240 is the target frame count at 60 fps (~4 seconds).

Generators that do not support incremental animation may call their full generation synchronously in `begin()` and return `true` from the first `step()` call. The renderer then shows a reveal transition: cells fade from background to their generated state over 30 frames.

### 5.3 Generator Algorithms

#### 5.3.1 Recursive Backtracker **(v2 — bug fix)**

Operates on logical room grid. Total steps = `room_cols * room_rows`.

```
begin:
  mark all logical rooms unvisited
  push start room onto stack; mark visited; set as FLOOR

step:
  if stack is empty: return complete
  current = stack.top()
  unvisited_neighbors = [logical neighbors of current not yet visited]
  if unvisited_neighbors is empty:
    stack.pop()
  else:
    next = random pick from unvisited_neighbors
    carve passage between current and next in display grid
    set next display cell to FLOOR
    mark next visited
    push next onto stack
  return stack is empty
```

Carving a passage sets the intermediate display cell between `current` and `next` to `CellType.FLOOR`.

**v2 edge-wall fix:** After generation completes, the backtracker must verify that the outermost row and column of the display grid are uniformly `CellType.WALL`. Any display cell at `col == 0`, `col == D_cols - 1`, `row == 0`, or `row == D_rows - 1` that was inadvertently set to `FLOOR` during carving must be reset to `WALL`. This post-pass runs synchronously inside the final `step()` call before returning `true`. It does not affect the animation or the carving logic; it is a boundary-repair operation only.

#### 5.3.2 Randomized Prim's *(unchanged from v1)*

Operates on logical room grid. Total steps = `room_cols * room_rows`.

```
begin:
  mark all logical rooms unvisited
  start_room = random room
  mark start_room visited; set as FLOOR
  add all unvisited neighbors of start_room to frontier set

step:
  if frontier is empty: return complete
  candidate = random pick from frontier set
  remove candidate from frontier
  if candidate is already visited: return false (skip)
  visited_neighbors = [visited logical neighbors of candidate]
  connect = random pick from visited_neighbors
  carve passage between connect and candidate in display grid
  mark candidate visited; set as FLOOR
  add unvisited neighbors of candidate to frontier set
  return frontier is empty
```

#### 5.3.3 Recursive Division *(unchanged from v1)*

Operates on the display grid directly. Initializes all display cells to `FLOOR`, then places walls. Total steps = `(D_cols * D_rows) / 4` (estimate for animation rate).

```
begin:
  set all display cells to FLOOR
  initialize recursion queue: [(0, 0, D_cols, D_rows)]

step:
  if queue is empty: return complete
  (x, y, w, h) = dequeue
  if w <= 2 or h <= 2: return false
  choose orientation: HORIZONTAL if h > w, VERTICAL if w > h, random if equal
  if HORIZONTAL:
    wall_row = y + random_even(1, h-2)
    gap_col  = x + random_odd(0, w-1)
    draw horizontal wall from (x, wall_row) to (x+w-1, wall_row) as WALL
    set (gap_col, wall_row) to FLOOR
    enqueue (x, y, w, wall_row - y) and (x, wall_row+1, w, h - (wall_row - y) - 1)
  if VERTICAL: (symmetric)
  return queue is empty
```

`random_even(lo, hi)` picks a random even integer in [lo, hi]. `random_odd(lo, hi)` picks a random odd integer in [lo, hi].

#### 5.3.4 Organic / Cellular Automata **(v2 — small-grid fix)**

Operates on display grid. The CA generator detects the display grid size and adjusts its behavior at two thresholds:

**Grid area thresholds:**
- `AREA_MIN_VIABLE = 400` display cells (e.g., 20×20)
- `AREA_HARD_MIN = 100` display cells (e.g., 10×10)

**If `D_cols * D_rows < AREA_HARD_MIN`:** Immediately fall back to the Randomized Prim's generator for this cycle. The fallback is transparent — `organic.begin()` calls `prims.begin()` internally and delegates all `step()` and `getGrid()` calls to the Prim's instance. The theme generator weights table (§5.4) still governs which generator is nominally selected; the fallback happens silently inside the Organic instance when the grid is below the hard minimum.

**If `AREA_MIN_VIABLE > D_cols * D_rows >= AREA_HARD_MIN`:** Use reduced CA parameters:
- Seed density: `0.35` (normal: `0.45`)
- Iteration count: `8` (normal: `15`)
- Survival threshold: unchanged (≥ 5 wall neighbors → stay wall for floor cells; ≥ 4 → stay wall for wall cells)

**Normal operation (`D_cols * D_rows >= AREA_MIN_VIABLE`):** Original v1 behavior. Total steps = `15` iterations.

```
begin:
  for each display cell (col, row):
    set to FLOOR with probability seedDensity, else WALL

step (iteration i):
  new_grid = copy of current grid
  for each display cell (col, row):
    wall_neighbors = count of WALL cells in 8-neighborhood (clamped to grid)
    if current cell is WALL:
      new_grid[col][row] = WALL if wall_neighbors >= 4 else FLOOR
    else:
      new_grid[col][row] = WALL if wall_neighbors >= 5 else FLOOR
  current grid = new_grid
  if i == (iterationCount - 1) (final iteration):
    flood_fill_connectivity()
  return i == (iterationCount - 1)
```

`flood_fill_connectivity()`: find the largest contiguous FLOOR region via flood fill; set all FLOOR cells not in the largest region to WALL.

The CA animation override from v1 applies only when running normally (not in fallback): each `step()` call is one CA iteration; the animation holds each iteration for 16 rendered frames before calling the next `step()`.

#### 5.3.5 Room-and-Corridor *(unchanged from v1)*

Operates on display grid. Two-phase animation. Total steps = `num_rooms + num_corridors`.

```
begin:
  set all display cells to WALL
  attempt to place N rooms:
    N = max(4, floor(room_cols * room_rows / 8))
    for each attempt (up to 200 tries):
      pick random room size: w in [3,9] odd, h in [3,7] odd
      pick random position such that room fits with 1-cell border
      if room does not overlap any existing room:
        stamp room (set all cells inside to FLOOR)
        add to room list
  phase = ROOMS; room_index = 0

step:
  if phase == ROOMS:
    if room_index < len(rooms): room_index++; draw next room; return false
    else: phase = CORRIDORS; corridor_index = 0; build corridor list
  if phase == CORRIDORS:
    if corridor_index < len(corridors):
      draw next corridor (L-shaped FLOOR path between two room centers)
      corridor_index++; return false
    else: return true
```

Corridors connect each room to its nearest unconnected room using an L-shaped path. The path first moves horizontally, then vertically (or vice versa, random choice per corridor).

### 5.4 Theme Generator Weights *(unchanged from v1)*

| Theme  | Backtracker | Prim's | Division | Organic | Room-Corridor |
|--------|------------|--------|----------|---------|---------------|
| Stone  | 25%        | 0%     | 15%      | 0%      | 60%           |
| Forest | 0%         | 55%    | 0%       | 35%     | 10%           |
| Desert | 60%        | 15%    | 25%      | 0%      | 0%            |
| Cold   | 25%        | 0%     | 75%      | 0%      | 0%            |
| Void   | 30%        | 0%     | 55%      | 0%      | 15%           |
| Water  | 0%         | 30%    | 0%       | 70%     | 0%            |
| Lava   | 15%        | 0%     | 30%      | 55%     | 0%            |

At cycle start, the active theme selects a generator by weighted random draw from this table.

### 5.5 Start and Goal Placement *(unchanged from v1)*

After generation completes:

1. Collect all `CellType.FLOOR` cells into a candidate list.
2. Pick a random candidate as `start`. Run BFS from `start` over passable cells, recording BFS distance to every reachable cell.
3. `goal_candidates` = all reachable FLOOR cells with BFS distance ≥ 75th percentile of observed distances.
4. Pick `goal` = random cell from `goal_candidates`.
5. If `goal_candidates` is empty (degenerate maze), pick the cell with maximum BFS distance.
6. Set `grid[start] = CellType.START`, `grid[goal] = CellType.GOAL`.

---

## §6 Solver System

### 6.1 SolverTrace Model **(v2)**

The solver trace is a plain object updated by the solver and read by the renderer each frame:

```js
{
  phase:      "searching" | "walk_to_goal" | "holding" | "fading" | "complete" | "timeout",
  actorCell:  [col, row],          // current actor display-grid position
  visited:    Set<index>,          // display-grid cell indices marked as visited
  frontier:   Set<index>,          // display-grid cell indices in active frontier
  breadcrumb: Map<index, depth>,   // display-grid cell → traversal depth for color gradient
  path:       [index, ...],        // final solved path as ordered list of display-grid indices
  movementHistory: [index, ...],   // actor movement sequence, including revisits
  fadeAlpha:  number,              // [0,1] current fade opacity; 1=fully visible, 0=gone
  solverKey:  string,              // identifies color identity (see §6.5)
  stepCount:  number,              // total steps taken so far
  elapsedMs:  number,              // wall time since solver start

  // v2 additions:
  beatGlyph:  null | "?" | "!",   // actor glyph override; null = use "@"
  walkPath:   [index, ...],        // path from actorCell at solve time to goal (populated by run loop)
  walkIndex:  number,              // current position in walkPath during walk_to_goal phase
}
```

Solvers write to this object. The renderer reads it. No other communication channel exists between solvers and the renderer.

**`beatGlyph` ownership:**
- `"?"` (change-of-mind): set and cleared by the frontier solver internally (see §6.9).
- `"!"` (walk-to-goal found): set by the run loop when solver transitions to "solved"; cleared by the run loop after `STEP_INTERVAL_MS`.
- Both beats last exactly one full step interval as perceived by the renderer.

**`trace.phase` value `"solved"` is removed from v2.** The solver still uses the string `"solved"` internally as the trigger for the run loop — the run loop detects it and immediately transitions — but the renderer should never observe `"walk_to_goal"` while `phase === "solved"` for more than one frame. In practice, `"solved"` is a transient trigger value that the run loop replaces within the same rAF cycle. Renderers must handle it gracefully (treat as `"holding"` if seen unexpectedly).

### 6.2 TraceAdapter Contract **(v2)**

Frontier algorithms (BFS, A*, Greedy) compute using their natural data structures but emit movement as an adjacent-step walk. The TraceAdapter is extended in v2 with a second method for walk-to-goal advancement.

```js
class TraceAdapter {
  // Called by solver to move actor one step toward targetCell using the discovered graph.
  // Updates trace.actorCell. Returns true if actor reached targetCell.
  advanceActorToward(trace, targetCell, discoveredAdjacency) { ... }

  // (v2) Called by run loop to advance actor one step along a pre-computed walkPath.
  // walkPath is an ordered array of display-grid indices from actorCell to goalCell.
  // Updates trace.actorCell and trace.walkIndex. Returns true if actor reached goal.
  advanceAlongPath(trace, walkPath) {
    if (trace.walkIndex >= walkPath.length - 1) return true
    trace.walkIndex++
    const idx = walkPath[trace.walkIndex]
    trace.actorCell = [idx % D_cols, Math.floor(idx / D_cols)]
    return trace.walkIndex >= walkPath.length - 1
  }
}
```

`advanceActorToward` finds the next step from `trace.actorCell` toward `targetCell` by running a bounded BFS over the solver's discovered passable graph, then taking the first adjacent step on that route. If no discovered route exists yet, the solver continues expanding its frontier without moving the actor; the actor must not teleport.

### 6.3 Solver Interface *(unchanged from v1)*

```js
class Solver {
  begin(grid, D_cols, D_rows, trace, rng) {}
  step() {}
  get key() { return "" }
}
```

One `step()` call corresponds to one logical solver advance. The step interval governs how often `step()` is called.

### 6.4 Solver Algorithms

#### 6.4.1 Depth-First Search **(v2 — exit-visibility)**

Maintains an explicit stack. Actor position follows top of stack.

```
begin:
  stack = [start_display_cell]
  visited = {start_display_cell}
  parent = {}
  trace.actorCell = start_display_cell
  exitShortcutFired = false

step:
  if stack is empty: trace.phase = "timeout"; return
  current = stack.top()
  trace.actorCell = current
  trace.visited.add(current)
  if current == goal_display_cell:
    reconstruct_path(parent, start, goal) → trace.path
    trace.phase = "solved"; return
  // (v2) exit-visibility check
  if not exitShortcutFired:
    if exitVisible(trace.actorCell, goal, grid, D_cols, D_rows, parent):
      exitPath = bfsPath(actorCell, goal, grid, D_cols, D_rows)   // full maze BFS
      trace.path = parentPath(parent, start, actorCell) + exitPath
      trace.phase = "solved"
      exitShortcutFired = true; return
  unvisited_floor_neighbors = [adjacent passable cells not in visited]
  if unvisited_floor_neighbors is empty:
    stack.pop()
  else:
    next = unvisited_floor_neighbors[0]  // DFS takes first
    parent[next] = current
    stack.push(next)
    visited.add(next)
```

`exitVisible` is defined in §6.10. `parentPath(parent, start, cell)` reconstructs the path from start to `cell` via the parent map. `bfsPath(from, to, grid, ...)` runs BFS over all passable maze cells to find shortest path. The combined path concatenates these two sequences with no duplicated junction cell.

Adjacent means 4-directional (N/S/E/W) in display grid coordinates.

#### 6.4.2 Breadth-First Search **(v2 — commit-to-path + exit-visibility)**

Maintains a FIFO queue. Actor commits to a target for a randomized window of steps (see §6.9).

```
begin:
  queue = [start_display_cell]
  visited = {start_display_cell}
  parent = {}
  trace.actorCell = start_display_cell
  commitTarget = start_display_cell
  commitStepsRemaining = 0
  exitShortcutFired = false

step:
  // expand frontier
  if queue is not empty:
    current = queue.dequeue()
    trace.frontier.delete(current)
    if current == goal_display_cell:
      reconstruct_path(parent, start, goal) → trace.path
      trace.phase = "solved"; return
    for each unvisited passable neighbor n of current:
      parent[n] = current; visited.add(n); queue.enqueue(n); trace.frontier.add(n)

  // (v2) exit-visibility override
  if not exitShortcutFired and exitVisible(trace.actorCell, goal, grid, ...):
    exitShortcutFired = true
    newTarget = goal
    if newTarget != commitTarget:
      trace.beatGlyph = "?"     // change-of-mind beat fires
    commitTarget = newTarget
    commitStepsRemaining = bfsDistance(actorCell, goal, visited_graph)

  // commit-to-path actor movement
  if commitStepsRemaining <= 0:
    newTarget = bestFrontierTarget(trace.frontier, goal)
    if newTarget != commitTarget:
      trace.beatGlyph = "?"     // change-of-mind beat fires
    commitTarget = newTarget
    dist = bfsDistance(actorCell, commitTarget, visited_graph)
    N = random(floor(2000 / STEP_INTERVAL_MS), dist)
    commitStepsRemaining = N
  advanceActorToward(trace, commitTarget, parent)
  commitStepsRemaining--
```

`bestFrontierTarget` selects the frontier cell with the smallest Manhattan distance to goal. `bfsDistance` runs BFS over the visited/discovered adjacency graph (cells in `visited`), not the full maze.

The `beatGlyph` set to `"?"` is cleared by the solver after exactly one `step()` call:

```
// at start of each step(), before other logic:
if trace.beatGlyph === "?":
  trace.beatGlyph = null
```

#### 6.4.3 A\* **(v2 — commit-to-path + exit-visibility)**

Uses a min-heap priority queue ordered by `f = g + h` where `h = manhattan(cell, goal)`.

```
begin:
  open_heap = MinHeap keyed on f
  open_heap.push(start, f=h(start))
  g_score = {start: 0}
  parent = {}
  visited = {}
  trace.actorCell = start
  commitTarget = start
  commitStepsRemaining = 0
  exitShortcutFired = false

step:
  // clear beat from previous step
  if trace.beatGlyph === "?": trace.beatGlyph = null

  // expand frontier
  if open_heap is not empty:
    current = open_heap.pop()
    trace.frontier.delete(current)
    visited.add(current)
    if current == goal:
      reconstruct_path(parent, start, goal) → trace.path
      trace.phase = "solved"; return
    for each passable neighbor n of current:
      tentative_g = g_score[current] + 1
      if tentative_g < g_score.get(n, Infinity):
        parent[n] = current; g_score[n] = tentative_g
        open_heap.push(n, tentative_g + h(n)); trace.frontier.add(n)
  elif visited is empty or (open_heap is empty and trace.frontier.size == 0):
    trace.phase = "timeout"; return

  // (v2) exit-visibility override (same pattern as BFS §6.4.2)
  // (v2) commit-to-path movement (same pattern as BFS §6.4.2)
```

The exit-visibility override and commit-to-path movement blocks for A* are identical in structure to BFS (§6.4.2), substituting `open_heap`-based frontier. `bestFrontierTarget` selects the frontier cell with the smallest `f` score.

#### 6.4.4 Greedy Best-First Search **(v2 — commit-to-path + exit-visibility)**

Uses a min-heap ordered by `h` (heuristic only).

```
begin:
  open_heap = MinHeap keyed on h
  open_heap.push(start, h=manhattan(start, goal))
  visited = {}; parent = {}
  trace.actorCell = start
  commitTarget = start; commitStepsRemaining = 0
  exitShortcutFired = false

step:
  if trace.beatGlyph === "?": trace.beatGlyph = null

  // expand frontier
  if open_heap is not empty:
    current = open_heap.pop()
    trace.frontier.delete(current); visited.add(current)
    if current == goal:
      reconstruct_path(parent, start, goal) → trace.path
      trace.phase = "solved"; return
    for each unvisited passable neighbor n of current:
      parent[n] = current; visited.add(n)
      open_heap.push(n, manhattan(n, goal)); trace.frontier.add(n)
  elif open_heap is empty:
    trace.phase = "timeout"; return

  // (v2) exit-visibility override (same pattern as BFS §6.4.2)
  // (v2) commit-to-path movement (same pattern as BFS §6.4.2)
  // bestFrontierTarget: frontier cell with smallest h score
```

#### 6.4.5 Wall Follower **(v2 — cycle detection)**

Follows the right-hand wall rule. Uses compass direction state. Does not use TraceAdapter.

```
begin:
  place actor at start_display_cell
  facing = direction from start toward nearest passable neighbor
  trace.actorCell = start
  visited.add(start); movementHistory = [start]
  stateFingerprints = new Set()   // (v2) cycle detection

step:
  // right-hand rule: try turning right, then forward, then left, then back
  right = turn_right(facing)
  if passable cell exists in direction right from actorCell:
    facing = right; move actor in facing direction
  elif passable cell exists in direction facing from actorCell:
    move actor in facing direction
  elif passable cell exists in direction turn_left(facing) from actorCell:
    facing = turn_left(facing); move actor in facing direction
  else:
    facing = turn_back(facing); move actor in facing direction
  visited.add(trace.actorCell); movementHistory.push(trace.actorCell)
  
  // (v2) cycle detection
  fingerprint = `${trace.actorCell[0]},${trace.actorCell[1]},${facing}`
  if stateFingerprints.has(fingerprint):
    trace.phase = "timeout"; return   // loop detected; end as timeout
  stateFingerprints.add(fingerprint)
  
  if trace.actorCell == goal:
    trace.path = movementHistory.slice()
    trace.phase = "solved"
```

Wall Follower does not produce an optimal path. `trace.path` is the actor's full movement sequence. Wall Follower is excluded from both exit-visibility and commit-to-path features; they would compromise its wall-following algorithm identity.

The (position, facing) fingerprint Set has at most `4 * D_cols * D_rows` entries (four facing directions per cell). Memory is bounded by grid size.

#### 6.4.6 Random Walk **(v2 — always included; walk-to-goal beat only)**

Moves to a random passable neighbor each step. Prefers unvisited neighbors; revisits when all neighbors are visited.

```
begin:
  trace.actorCell = start
  visited = {start}; parent = {}; movementHistory = [start]

step:
  neighbors = passable neighbors of actorCell
  unvisited = neighbors not in visited
  next = unvisited is empty ? random(neighbors) : random(unvisited)
  if next not in parent: parent[next] = actorCell   // first-visit parent only
  actorCell = next
  visited.add(next); movementHistory.push(next)
  if actorCell == goal:
    reconstruct_path(parent, start, goal) → trace.path
    trace.phase = "solved"
```

Random walk is **unconditionally included** in the solver pool in v2. The v1 `randomWalkEnabled` property is removed. Random walk participates in every cycle.

Random walk is **exempt from commit-to-path** (it has no frontier target) and **exempt from exit-visibility** (using a directional shortcut would contradict its "truly random movement" identity).

For walk-to-goal: random walk fires the `!` beat when it sets `trace.phase = "solved"`, but does not enter the walk-to-goal walking phase — the actor is already at the goal cell when the solve condition is met. See §6.8.

### 6.5 Solver Color Identities *(unchanged from v1)*

| Solver        | Key            | Breadcrumb  | Path        |
|---------------|----------------|-------------|-------------|
| DFS           | `dfs`          | `#FF5533`   | `#FF7755`   |
| BFS           | `bfs`          | `#33CCFF`   | `#66DDFF`   |
| A*            | `astar`        | `#33FF66`   | `#66FF99`   |
| Greedy        | `greedy`       | `#FFCC33`   | `#FFE066`   |
| Wall Follower | `wallfollower` | `#CC66FF`   | `#DD99FF`   |
| Random Walk   | `randomwalk`   | `#AAAAAA`   | `#CCCCCC`   |

Breadcrumb color is used for `trace.visited` cells. Path color is used for `trace.path` cells after solve. Both colors are specified in CSS hex. Themes may modulate alpha but must not alter hue.

### 6.6 Solver Selection **(v2)**

At the start of each maze cycle:

```
pool = [dfs, bfs, astar, greedy, wallfollower, randomwalk]   // always 6; no toggle
count = 4
selected = shuffle(pool).slice(0, count)  // 4 solvers, without replacement
```

The `randomWalkEnabled` config flag and Wallpaper Engine property are removed. Random walk is always in the pool.

Selected solvers run in the shuffled order. The same maze is used for all solvers in the cycle.

### 6.7 Maximum Solve Time **(v2)**

The maximum solve time is computed from the grid size each cycle:

```js
function computeMaxSolveMs(D_cols, D_rows, multiplier) {
  const gridAwareSeconds = Math.min(5 * Math.sqrt(D_cols * D_rows), 600)
  return Math.round(gridAwareSeconds * multiplier * 1000)
}
```

`multiplier` is the user-configured value from the WE property (see §10.1). Default multiplier = `1.0`.

Representative values at multiplier = 1.0:

| Scale preset | Approx D_cols × D_rows | Grid-aware limit |
|--------------|------------------------|-----------------|
| Tiny (1080p) | ~320 × 72             | 600s (capped)   |
| Medium (1080p)| ~174 × 49             | ~462s           |
| Poster (1080p)| ~113 × 32             | ~301s           |
| Poster (4K)  | ~226 × 63             | ~597s           |

Each solver starts a timer at `begin()`. On each `step()`:

```js
if (trace.elapsedMs >= maxSolveMs) {
  trace.phase = "timeout"
  return
}
```

The timeout produces no `trace.path`. The theme's `SOLVER_TIMEOUT` lifecycle event fires. The solver proceeds through the fade phase normally. Walk-to-goal is skipped on timeout.

### 6.8 Walk-to-Goal Phase **(v2)**

When a solver transitions to `trace.phase = "solved"`, the run loop intercepts this before the solution path animation begins:

**Step 1 — Beat:** The run loop sets `trace.beatGlyph = "!"`. This triggers `ACTOR_WALK_FOUND` semantic state for the actor cell. The run loop fires the `WALK_TO_GOAL_BEAT` lifecycle event to the theme. A `setTimeout` of `STEP_INTERVAL_MS` duration starts. During this beat, the solver step interval is stopped; the actor does not move; the solved path is not yet shown.

**Step 2 — Walk decision:** After the beat timer fires, the run loop clears `trace.beatGlyph = null` and evaluates:

- **Random walk:** actor is already at goal. Skip to SOLVED_HOLD immediately.
- **All other solvers:** compute `walkPath` = shortest path from `trace.actorCell` to `goalCell` through the solver's discovered graph (BFS over `trace.visited` cells). If goal is unreachable through the discovered graph (degenerate case), fall back to BFS over all passable maze cells. Set `trace.walkIndex = 0`. Set `trace.phase = "walk_to_goal"`.

**Step 3 — Walking:** A separate `setInterval` at `WALK_STEP_MS` advances the actor one step along `walkPath` each tick:

```js
WALK_STEP_MS = Math.max(10, Math.floor(config.stepIntervalMs / 2))
```

`WALK_STEP_MS` is recomputed whenever `config.stepIntervalMs` changes.

Each walk step calls `traceAdapter.advanceAlongPath(trace, walkPath)`. The actor's `trace.actorCell` updates each tick. `trace.visited`, `trace.frontier`, and `trace.breadcrumb` do not change during the walk. `trace.path` is not yet shown to the theme (the path hold timer has not started). Only the actor moves.

**Step 4 — Arrival:** When `advanceAlongPath` returns `true` (actor reached goal), the walk interval is stopped. Transition to SOLVED_HOLD: set `trace.phase = "holding"`, fire `SOLVER_SOLVED` lifecycle event, begin `PATH_HOLD_MS` timer.

Walk-to-goal is skipped for timeout runs. The `"!"` beat does not fire on timeout.

### 6.9 Commit-to-Path **(v2)**

Commit-to-path applies to BFS, A*, and Greedy Best-First. It does not apply to DFS, Wall Follower, or Random Walk.

Each frontier solver maintains internal (not in SolverTrace) commit state:

```
commitTarget:          display-cell index | null   // current locked walking target
commitStepsRemaining:  number                       // steps remaining in this commit
```

**Commit cycle:**

1. When `commitStepsRemaining == 0` (or on first step), select a new target: `bestFrontierTarget` (see per-solver definition in §6.4). If the frontier is empty, do not move the actor this step.
2. If the new target differs from `commitTarget`, set `trace.beatGlyph = "?"` (change-of-mind beat).
3. Set `commitTarget = newTarget`.
4. Compute `dist = bfsDistance(trace.actorCell, commitTarget, discoveredGraph)`.
5. `N = random(floor(2000 / STEP_INTERVAL_MS), dist)` where `dist` serves as the upper bound. If `dist == 0` (actor already at target), `N = 1`.
6. Set `commitStepsRemaining = N`.
7. Call `advanceActorToward(trace, commitTarget, parent)`.
8. Decrement `commitStepsRemaining`.

At the start of each `step()`, if `trace.beatGlyph === "?"`, clear it to `null` before processing (the beat persisted for one full interval; now it clears).

**Exit-visibility override (§6.10) takes priority over commit-to-path target selection.** When exit-visibility fires, it overrides `commitTarget` to the goal and sets `commitStepsRemaining` to `bfsDistance(actorCell, goal, discoveredGraph)`. The change-of-mind beat fires if the goal was not already the commit target.

### 6.10 Exit-Visibility Shortcut **(v2)**

Applies to DFS, BFS, A*, and Greedy Best-First. Excluded from Random Walk and Wall Follower.

**Visibility check (called once per `step()` before main step logic, while `exitShortcutFired == false`):**

```js
function exitVisible(actorCell, goalCell, grid, D_cols, D_rows, discoveredGraph) {
  const [ac, ar] = actorCell
  const [gc, gr] = goalCell

  // Condition 1: goal within attention field radius
  if (chebyshev(ac, ar, gc, gr) > ATTENTION_RADIUS) return false   // ATTENTION_RADIUS = 6

  // Condition 2: unobstructed line-of-sight (Bresenham ray)
  if (!hasLOS(grid, ac, ar, gc, gr, D_cols)) return false

  // Condition 3: goal reachable through discovered graph
  return canReach(actorCell, goalCell, discoveredGraph, ATTENTION_RADIUS * 4)
}
```

**`hasLOS(grid, fromCol, fromRow, toCol, toRow, D_cols)`:** Bresenham line from `(fromCol, fromRow)` to `(toCol, toRow)`. For each cell on the ray (exclusive of start and end endpoints), if `grid[row * D_cols + col] === CellType.WALL`, return `false`. Return `true` if no wall cell is encountered.

**`canReach(from, to, discoveredGraph, maxSteps)`:** BFS from `from` over cells in `discoveredGraph`, bounded to `maxSteps`. Returns `true` if `to` is reached within the step budget.

`discoveredGraph` is the set of cell indices in `trace.visited` (all cells discovered by the solver so far). This BFS does not explore the full maze — only the solver's already-discovered cells.

**Behavior when condition fires:**

- **BFS, A*, Greedy:** Immediately override commit-to-path target to goal (see §6.9). Change-of-mind beat fires if goal was not already the commit target.
- **DFS:** Set `trace.path` using combined path (see §6.4.1). Set `trace.phase = "solved"`.

The shortcut fires at most once per solver run. `exitShortcutFired` is set to `true` after the first trigger and prevents re-evaluation.

---

## §7 Attention Field

### 7.1 Definition *(unchanged from v1)*

The attention field is a per-cell brightness multiplier centered on the actor's current display-grid cell:

```
attention_factor(d) = 0.25 + 0.75 * cos²(π * min(d, 6) / 12)
```

Where `d` is the Chebyshev distance from the cell to `trace.actorCell`.

| d   | attention_factor |
|-----|-----------------|
| 0   | 1.000           |
| 1   | 0.957           |
| 2   | 0.833           |
| 3   | 0.652           |
| 4   | 0.469           |
| 5   | 0.310           |
| 6   | 0.250           |
| >6  | 0.250           |

The ambient floor level is 0.25. The full-brightness level at d=0 is 1.0.

`ATTENTION_RADIUS = 6` (used by exit-visibility check §6.10).

### 7.2 Application *(unchanged from v1)*

The renderer passes `attention_factor(d)` to the theme's cell render function. The theme multiplies wall and floor foreground colors by this factor (applied to RGB channels, leaving alpha unchanged).

Solver breadcrumb, path, and start/goal cells are exempt from attention dimming; they render at full solver color. Start and goal cells render at full theme color regardless of actor distance.

The attention field does not affect background colors.

### 7.3 Intensity Scaling *(unchanged from v1)*

| Intensity | Ambient floor | Formula adjustment                 |
|-----------|--------------|-------------------------------------|
| Low       | 0.50         | `0.50 + 0.50 * cos²(…)`            |
| Medium    | 0.25         | `0.25 + 0.75 * cos²(…)` (default)  |
| High      | 0.15         | `0.15 + 0.85 * cos²(…)`            |

### 7.4 Layer Ownership **(v2)**

`attention.js` exposes a single function that computes the max-blend of solver and cursor attention fields:

```js
// Returns Float32Array of length D_cols * D_rows.
// actorCol, actorRow: actor position (-1 if no active solver)
// cursorCol, cursorRow: cursor grid position (-1 if cursor not over canvas)
// cursorAlpha: [0, 1] — 0 suppresses cursor contribution entirely
// intensity: "low" | "medium" | "high"
function compute(actorCol, actorRow, cursorCol, cursorRow, cursorAlpha,
                 D_cols, D_rows, intensity)
```

The returned array is reused across frames (pre-allocated at grid init). At Low intensity, the array is filled with the ambient constant once and not recomputed until intensity changes (same as v1). At Medium and High, the array is recomputed each frame.

During generation (no active solver), `actorCol = actorRow = -1`. The solver contribution is zero; only cursor light (if any) contributes above ambient.

### 7.5 Cursor Light Source **(v2)**

The cursor projects a second attention field onto the maze using the same cos² falloff formula and radius as the solver field:

```
cursor_factor(d) = ambient + (1.0 - ambient) * cos²(π * min(d, 6) / 12)
```

Where `d` is Chebyshev distance from the cell to the cursor grid cell, and `ambient` is the intensity-specific ambient floor (§7.3).

**Blend rule:** The final per-cell attention factor is `max(solver_factor, cursor_factor * cursorAlpha)`. Both illuminated areas remain simultaneously visible; neither source washes out the other.

When `cursorAlpha = 0` (cursor off canvas and fully faded, or `config.cursorLight = false`), the cursor contributes nothing. The formula degrades to the v1 behavior.

The cursor attention field uses the same Chebyshev distance metric and the same cos² formula as the solver field. Visual distinction from the solver light is achieved entirely through the color cast, which is theme-owned.

---

## §8 Theme System

### 8.1 SemanticState Enum **(v2)**

```js
const SemanticState = {
  // v1 states (unchanged)
  WALL:                "wall",
  FLOOR:               "floor",
  START:               "start",
  GOAL:                "goal",
  ACTOR:               "actor",
  VISITED:             "visited",
  FRONTIER:            "frontier",
  PATH:                "path",
  GENERATING:          "generating",

  // v2 additions
  ACTOR_WALK_FOUND:     "actor_walk_found",    // @ → ! during walk-to-goal beat
  ACTOR_CHANGE_OF_MIND: "actor_change_of_mind", // @ → ? during commit-to-path target change
}
```

### 8.2 LifecycleEvent Enum **(v2)**

```js
const LifecycleEvent = {
  // v1 events (unchanged)
  MAZE_READY:           "maze_ready",
  SOLVER_START:         "solver_start",
  SOLVER_SOLVED:        "solver_solved",       // v2: fires when actor ARRIVES at goal
  SOLVER_TIMEOUT:       "solver_timeout",
  SOLVER_FADE_COMPLETE: "solver_fade_complete",
  CYCLE_RESET:          "cycle_reset",

  // v2 addition
  WALK_TO_GOAL_BEAT:    "walk_to_goal_beat",   // fires when solver finds goal, before ! beat begins
}
```

**v2 change to `SOLVER_SOLVED` semantics:** In v1, `SOLVER_SOLVED` fired when the solver algorithm found the goal. In v2, it fires when the actor physically arrives at the goal cell after the walk-to-goal phase. This changes the timing: the event arrives after the `!` beat and the walk, not immediately after goal discovery. Themes that use `SOLVER_SOLVED` to trigger path-reveal animations will see the correct delay naturally.

### 8.3 Theme Interface **(v2)**

```js
class Theme {
  // Returns CSS color string for the page background.
  get backgroundColor() { return "#000000" }

  // Returns the HUD color palette object (v2).
  get hudPalette() {
    return {
      background: cssColor,   // HUD panel fill color (typically theme bg with alpha)
      border:     cssColor,   // HUD panel border
      header:     cssColor,   // "AMAZE" title row
      meta:       cssColor,   // generator name row and separator
      active:     cssColor,   // current solver row (live)
      done:       cssColor,   // completed solver rows
      pending:    cssColor,   // not-yet-run solver rows
    }
  }

  // Renders one cell. Called by renderer for every cell every frame.
  renderCell(col, row, state, solverColor, attentionFactor, ctx, cw, ch, frameCount) {}

  // Called by main.js when a lifecycle event fires.
  onLifecycleEvent(event, data) {}

  // Called each rAF frame after all cells are drawn.
  renderOverlay(ctx, D_cols, D_rows, cw, ch, frameCount) {}
}
```

### 8.4 Theme Behavior Rules **(v2)**

All v1 rules apply unchanged. v2 additions:

- Themes must handle `SemanticState.ACTOR_WALK_FOUND` and `SemanticState.ACTOR_CHANGE_OF_MIND`. An unknown state should fall back to `ACTOR` rendering.
- **`ACTOR_WALK_FOUND`** (universal `!` beat): render the `!` glyph at `#FFFFFF` foreground with `ctx.shadowBlur = 12, ctx.shadowColor = "#FFFFFF"` regardless of intensity setting. Background is the theme's actor background color. This beat is universally bright across all themes.
- **`ACTOR_CHANGE_OF_MIND`** (universal `?` beat): render the `?` glyph in the theme's goal cell foreground color. Standard glow applies (Medium/High intensity). Background is the theme's actor background color. Using the goal's color communicates: "I see a better path."
- Themes must handle `WALK_TO_GOAL_BEAT` lifecycle event either with a visible effect or an explicit no-op.
- Decorative elements are managed internally by the theme (see §8.7). The renderer is unaware of decoratives; they are expressed through the theme's `renderCell` implementation for `FLOOR` state.
- Core semantic glyph reservations extend to `?` and `!` in v2. Themes must not use `?` or `!` for any purpose other than `ACTOR_CHANGE_OF_MIND` and `ACTOR_WALK_FOUND` states respectively.

### 8.5 Theme Fade Behavior *(unchanged from v1)*

When a solver transitions to `"fading"` phase, `trace.fadeAlpha` decreases from 1.0 to `targetFadeOpacity` over 1500ms. Themes apply `ctx.globalAlpha = fadeAlpha` when drawing visited, frontier, and breadcrumb cells.

Final path cells fade from 1.0 to `targetFadeOpacity` using the same duration and target. Actor and lifecycle beat effects fade immediately when the solver enters `"fading"` phase.

### 8.6 HUD Specification **(v2)**

The HUD is rendered by `hud.js`'s `HUD` class. It is a single panel drawn on the main canvas in the top-left corner.

**Layout constants:**

| Constant        | Value   |
|-----------------|---------|
| Margin from canvas edge | `12px` |
| Panel width     | `200px` |
| Panel padding   | `8px`   |
| Font            | `11px 'AmazeMono', monospace` |
| Line height     | `16px`  |
| Corner radius   | `3px`   |

**Panel height:** computed from content. `height = padding_top + (content_rows * line_height) + padding_bottom`. Content rows = 1 (header) + 1 (gen line) + 1 (separator) + 4 (solver rows) = 7 rows. Fixed height ≈ `8 + 7 * 16 + 8 = 128px`.

**Rendering algorithm (executed by `hud.render()`):**

```
ctx.save()

// Draw background panel
ctx.fillStyle = palette.background
ctx.beginPath(); roundedRect(12, 12, 200, 128, 3); ctx.fill()
ctx.strokeStyle = palette.border; ctx.lineWidth = 1
ctx.beginPath(); roundedRect(12, 12, 200, 128, 3); ctx.stroke()

// Row 1: header
ctx.fillStyle = palette.header
ctx.font = "bold 11px 'AmazeMono', monospace"
ctx.fillText("AMAZE", 20, 20)

// Row 2: generator name
ctx.fillStyle = palette.meta
ctx.font = "11px 'AmazeMono', monospace"
ctx.fillText("gen: " + generatorName, 20, 36)

// Row 3: separator line
ctx.fillStyle = palette.meta
ctx.fillRect(20, 53, 184, 1)   // 1px horizontal rule

// Rows 4-7: solver run rows
for i in 0..3:
  y = 60 + i * 16
  solver = selectedSolvers[i]
  if solver == null: draw "–" row in palette.pending; continue
  if solver is current (active): color = palette.active
  elif solver is complete:       color = palette.done
  else:                          color = palette.pending
  
  ctx.fillStyle = color
  label = padEnd(solver.key, 12)    // e.g., "dfs         "
  if solver is active:
    time = formatElapsed(performance.now() - solver.startTime)
    icon = "…"
  elif solver is solved:
    time = formatElapsed(solver.elapsedMs)
    icon = "✓"
  elif solver is timeout:
    time = formatElapsed(solver.elapsedMs)
    icon = "✗"
  else:
    time = ""; icon = ""
  ctx.fillText((i+1) + "  " + label + padStart(time, 7) + " " + icon, 20, y)

ctx.restore()
```

`formatElapsed(ms)` formats as `"123.4s"` (one decimal place). `padEnd` and `padStart` are fixed-width string formatters.

**HUD state management (in `hud.js`):**

```js
class HUD {
  setContext(themeName, generatorName, selectedSolvers) {}  // called on MAZE_READY
  setCurrentSolver(key, startTimeMs) {}                    // called on SOLVER_START
  recordOutcome(key, elapsedMs, outcome) {}                // called on SOLVER_SOLVED / SOLVER_TIMEOUT
  reset() {}                                               // called on CYCLE_RESET
  setVisible(visible) {}                                   // called on H key or WE property change
  get isVisible() {}
  render(ctx, theme, cw, ch, D_cols, D_rows, frameCount) {}
}
```

**Visibility:** The HUD is initialized from `config.hudVisible` at each `CYCLE_RESET`. The `H` keyboard key toggles `hud.setVisible()` for the current cycle only. The toggle does not persist across cycles unless the WE property is also changed.

**HUD and solver start/goal cells:** The HUD is positioned in the top-left corner. It may visually overlap maze cells at that position. This is intentional; the HUD is a canvas overlay.

### 8.7 Decorative Elements **(v2)**

Each theme has a class of decorative elements: static or animated glyphs placed on FLOOR cells that reinforce the theme's physical identity. Decorative elements are purely atmospheric; the solver system is unaware of them.

**Placement:** On `MAZE_READY`, the theme scans all FLOOR cells (excluding START and GOAL cells) and randomly selects a subset for decoration. The selection density depends on the active intensity setting (see per-theme tables in §8.8). Each selected cell is assigned:
- A glyph chosen randomly from the theme's decorative glyph set
- A random animation phase offset (integer in `[0, 360)`) for animated themes

The selections are stored in a `Map<cellIndex, {glyph, phase}>` within the theme instance. This map persists for the life of the maze cycle.

**Rendering:** In the theme's `renderCell` function, when `state === SemanticState.FLOOR`, the theme checks whether the cell index exists in its decorative map. If it does, the theme renders the decorative glyph instead of the normal floor glyph, using the theme's decorative foreground color and the same background as FLOOR. The attention factor applies normally to decorative cells (they are visually part of the floor, not exempt from dimming).

**Solver state priority:** A decorative assignment has no effect when the cell is in any solver-semantic state (VISITED, FRONTIER, PATH, ACTOR, START, GOAL). The decorative only renders when the renderer passes `state === FLOOR` for that cell. After a solver's fade completes and the cell returns to FLOOR visibility, the decorative re-appears automatically.

**Animation:** Animated decoratives update their appearance based on `frameCount + phase`:
- Glyph-cycling: `glyph = glyphs[Math.floor((frameCount + phase) / halfPeriod) % glyphs.length]`
- Alpha-modulated: `alpha = base + amplitude * sin(2π * (frameCount + phase) / period)`

Animation only runs at the intensity level specified per theme. At lower intensities, animated decoratives render statically or not at all per the density table.

**Glyph reservations:** Decorative glyphs must not be any glyph used for semantic maze state. Reserved glyphs include: all theme-specific WALL, FLOOR, START, GOAL, ACTOR, GENERATING, and timeout-death glyphs; and universally: `@`, `?`, `!`.

**Intensity override:** The visual/effect intensity setting governs decorative density. At Low intensity, density is 0% for all themes (no decoratives rendered).

### 8.8 Theme Specifications

All palette values are CSS hex colors. Core semantic glyph values are ASCII characters. Glyph values used in overlays, lifecycle beats, or decorative elements may be UTF-8 if the bundled font supports them (see Open Item O-1).

---

#### Forest **(v2)**

| Semantic State         | Glyph | Foreground  | Background  |
|------------------------|-------|-------------|-------------|
| WALL                   | `#`   | `#2D6B1E`   | `#0A1A0A`   |
| FLOOR                  | `.`   | `#1A3D10`   | `#0A1A0A`   |
| START                  | `>`   | `#90FF60`   | `#0A1A0A`   |
| GOAL                   | `X`   | `#FF9900`   | `#0A1A0A`   |
| ACTOR                  | `@`   | `#B0FF80`   | `#0A1A0A`   |
| GENERATING             | `*`   | `#55CC33`   | `#0A1A0A`   |
| ACTOR_WALK_FOUND       | `!`   | `#FFFFFF`   | `#0A1A0A`   |
| ACTOR_CHANGE_OF_MIND   | `?`   | `#FF9900`   | `#0A1A0A`   |

Lifecycle beats:
- `MAZE_READY`: walls fade from `#0F2A0F` → `#2D6B1E` over 60 frames.
- `SOLVER_START`: actor blinks from `.` to `@` over 12 frames.
- `WALK_TO_GOAL_BEAT`: no additional effect beyond the universal `ACTOR_WALK_FOUND` rendering.
- `SOLVER_SOLVED`: path pulses `#CCFF99` → path color twice over 30 frames.
- `SOLVER_TIMEOUT`: actor glyph changes to `x`; dim to `#444444` over 20 frames.
- `CYCLE_RESET`: brief full-canvas darken to `#050F05` over 16 frames.

Overlay: at Medium/High intensity, subtle green tint shimmer on FLOOR cells within radius 3 of actor. Period: 120 frames, amplitude: ±0.08 alpha.

**Decorative elements:**

| Glyph set | `♣` `♠`                    |
|-----------|----------------------------|
| Foreground | `#1E4A12`                 |
| Background | `#0A1A0A` (floor bg)      |
| Density   | Low: 0%, Med: 3%, High: 7% |
| Animation | High only: cycle `♣`↔`♠` every `random(80, 160)` frames per cell, using per-cell phase offset |

**HUD palette:**

| Key        | Value                    |
|------------|--------------------------|
| background | `rgba(10, 26, 10, 0.88)` |
| border     | `#2D6B1E`                |
| header     | `#90FF60`                |
| meta       | `#2D6B1E`                |
| active     | `#B0FF80`                |
| done       | `#55CC33`                |
| pending    | `#1A3D10`                |

---

#### Desert **(v2)**

| Semantic State         | Glyph | Foreground  | Background  |
|------------------------|-------|-------------|-------------|
| WALL                   | `#`   | `#C87820`   | `#1A120A`   |
| FLOOR                  | `.`   | `#6B4A14`   | `#1A120A`   |
| START                  | `>`   | `#FFE080`   | `#1A120A`   |
| GOAL                   | `X`   | `#FF6600`   | `#1A120A`   |
| ACTOR                  | `@`   | `#FFE880`   | `#1A120A`   |
| GENERATING             | `*`   | `#CC8830`   | `#1A120A`   |
| ACTOR_WALK_FOUND       | `!`   | `#FFFFFF`   | `#1A120A`   |
| ACTOR_CHANGE_OF_MIND   | `?`   | `#FF6600`   | `#1A120A`   |

Lifecycle beats:
- `MAZE_READY`: walls shimmer from `#7A4A10` → `#C87820` over 40 frames.
- `SOLVER_START`: actor fades in from sand-colored `.` to `@` over 12 frames.
- `WALK_TO_GOAL_BEAT`: no additional effect beyond the universal `ACTOR_WALK_FOUND` rendering.
- `SOLVER_SOLVED`: path pulses `#FFEE99` → path color over 25 frames.
- `SOLVER_TIMEOUT`: actor changes to `%`; dim to `#554422` over 20 frames.
- `CYCLE_RESET`: brief darken to `#0D0905` over 16 frames.

Overlay: at High intensity, heat shimmer on WALL cells adjacent to actor. Alternate glyph `║` on random wall cells at period 180 frames for mirage effect.

**Decorative elements:**

| Glyph set | `Y` `,`                    |
|-----------|----------------------------|
| Foreground | `#7A4D18`                 |
| Background | `#1A120A` (floor bg)      |
| Density   | Low: 0%, Med: 2%, High: 4% |
| Animation | None at any intensity      |

**HUD palette:**

| Key        | Value                       |
|------------|-----------------------------|
| background | `rgba(26, 18, 10, 0.88)`    |
| border     | `#6B4A14`                   |
| header     | `#FFE080`                   |
| meta       | `#6B4A14`                   |
| active     | `#FFE880`                   |
| done       | `#CC8830`                   |
| pending    | `#3D2A08`                   |

---

#### Stone **(v2)**

| Semantic State         | Glyph | Foreground  | Background  |
|------------------------|-------|-------------|-------------|
| WALL                   | `#`   | `#8888AA`   | `#080810`   |
| FLOOR                  | `.`   | `#2A2A3A`   | `#080810`   |
| START                  | `>`   | `#CCCCFF`   | `#080810`   |
| GOAL                   | `X`   | `#AAAAFF`   | `#080810`   |
| ACTOR                  | `@`   | `#EEEEFF`   | `#080810`   |
| GENERATING             | `*`   | `#555577`   | `#080810`   |
| ACTOR_WALK_FOUND       | `!`   | `#FFFFFF`   | `#080810`   |
| ACTOR_CHANGE_OF_MIND   | `?`   | `#AAAAFF`   | `#080810`   |

Lifecycle beats:
- `MAZE_READY`: rooms stamp in one by one. Each room flashes `#AAAACC` for 8 frames then settles to wall color.
- `SOLVER_START`: actor appears as `@` with a brief white flash over 10 frames.
- `WALK_TO_GOAL_BEAT`: no additional effect beyond the universal `ACTOR_WALK_FOUND` rendering.
- `SOLVER_SOLVED`: path pulses `#FFFFFF` → path color over 20 frames.
- `SOLVER_TIMEOUT`: actor becomes `+`; glyph color dims to `#444455` over 15 frames.
- `CYCLE_RESET`: full-canvas darken to `#030306` over 20 frames.

Overlay: at Medium/High intensity, drip effect on WALL cells. One `·` drip per 300 frames per column, falling one row per 4 frames.

**Decorative elements:**

| Glyph set | `,` `·`                    |
|-----------|----------------------------|
| Foreground | `#333344`                 |
| Background | `#080810` (floor bg)      |
| Density   | Low: 0%, Med: 4%, High: 8% |
| Animation | None at any intensity      |

**HUD palette:**

| Key        | Value                       |
|------------|-----------------------------|
| background | `rgba(8, 8, 16, 0.88)`      |
| border     | `#555577`                   |
| header     | `#CCCCFF`                   |
| meta       | `#555577`                   |
| active     | `#EEEEFF`                   |
| done       | `#8888AA`                   |
| pending    | `#2A2A3A`                   |

---

#### Void **(v2)**

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

Floor cells render as blank space. The maze reads as walls floating in void.

Lifecycle beats:
- `MAZE_READY`: walls appear at full opacity with no transition (instantaneous).
- `SOLVER_START`: actor appears from blank space to `@` over 10 frames.
- `WALK_TO_GOAL_BEAT`: no additional effect beyond the universal `ACTOR_WALK_FOUND` rendering.
- `SOLVER_SOLVED`: path glows with `ctx.shadowBlur = 20`, `shadowColor = #CC44FF` for 60 frames then fades to normal glow.
- `SOLVER_TIMEOUT`: actor vanishes (alpha → 0 over 10 frames). No death glyph.
- `CYCLE_RESET`: canvas fades to `#000000` over 30 frames.

Overlay: at Medium/High intensity, random FLOOR cells twinkle `·` at `#1A0033` alpha 0.4, one new twinkle per 8 frames, each lasting 40 frames. Maximum 20 active twinkles.

**Decorative elements:**

| Glyph set | `·` `°`                    |
|-----------|----------------------------|
| Foreground | `#110022`                 |
| Background | `#000005` (floor bg)      |
| Density   | Low: 0%, Med: 1%, High: 2% |
| Animation | High only: individual glyphs pulse alpha 0.2→0.6→0.2 with per-cell random period in [180, 360] frames |

Note: `·` is U+00B7 (MIDDLE DOT), `°` is U+00B0 (DEGREE SIGN). Decorative density is intentionally very sparse to preserve the void atmosphere.

**HUD palette:**

| Key        | Value                       |
|------------|-----------------------------|
| background | `rgba(0, 0, 5, 0.92)`       |
| border     | `#220833`                   |
| header     | `#CC44FF`                   |
| meta       | `#220833`                   |
| active     | `#DD55FF`                   |
| done       | `#CC44FF`                   |
| pending    | `#110022`                   |

---

#### Water **(v2)**

| Semantic State         | Glyph | Foreground  | Background  |
|------------------------|-------|-------------|-------------|
| WALL                   | `~`   | `#1A3A6A`   | `#040B1F`   |
| FLOOR                  | `.`   | `#0D1F40`   | `#040B1F`   |
| START                  | `>`   | `#40AAFF`   | `#040B1F`   |
| GOAL                   | `O`   | `#00CCFF`   | `#040B1F`   |
| ACTOR                  | `@`   | `#66BBFF`   | `#040B1F`   |
| GENERATING             | `~`   | `#0D2A50`   | `#040B1F`   |
| ACTOR_WALK_FOUND       | `!`   | `#FFFFFF`   | `#040B1F`   |
| ACTOR_CHANGE_OF_MIND   | `?`   | `#00CCFF`   | `#040B1F`   |

Lifecycle beats:
- `MAZE_READY`: wall glyphs cycle `~` → `≈` → `≋` → `≈` over 60 frames (ripple effect).
- `SOLVER_START`: actor rises from `~` to `@` over 12 frames.
- `WALK_TO_GOAL_BEAT`: no additional effect beyond the universal `ACTOR_WALK_FOUND` rendering.
- `SOLVER_SOLVED`: path ripples outward from goal; path color pulses `#AAEEFF` → path color.
- `SOLVER_TIMEOUT`: actor becomes `~`; fades to `#0D2A50` over 20 frames.
- `CYCLE_RESET`: canvas fades to `#020810` over 25 frames.

Overlay: at Medium/High intensity, sinusoidal alpha modulation on WALL cells. `alpha_mod = 0.15 * sin(2π * frameCount / 80 + col * 0.3)`. Applied additively to base wall foreground alpha.

**Decorative elements:**

| Glyph set  | `∿` `·`                      |
|------------|------------------------------|
| Foreground | `#0D2A50`                    |
| Background | `#040B1F` (floor bg)         |
| Density    | Low: 0%, Med: 5%, High: 10%  |
| Animation  | Med+: alpha = `0.3 + 0.2 * sin(2π * (frameCount + phase) / 90 + col * 0.4)` |

Note: `∿` is U+223F (SINE WAVE). Water decoratives animate at both Medium and High intensity, representing surface ripple texture.

**HUD palette:**

| Key        | Value                       |
|------------|-----------------------------|
| background | `rgba(4, 11, 31, 0.88)`     |
| border     | `#1A3A6A`                   |
| header     | `#40AAFF`                   |
| meta       | `#1A3A6A`                   |
| active     | `#66BBFF`                   |
| done       | `#1A3A6A`                   |
| pending    | `#0D1F40`                   |

---

#### Lava **(v2)**

| Semantic State         | Glyph | Foreground  | Background  |
|------------------------|-------|-------------|-------------|
| WALL                   | `#`   | `#CC2200`   | `#1A0400`   |
| FLOOR                  | `.`   | `#3D0A00`   | `#1A0400`   |
| START                  | `>`   | `#FF8800`   | `#1A0400`   |
| GOAL                   | `X`   | `#FF4400`   | `#1A0400`   |
| ACTOR                  | `@`   | `#FFAA00`   | `#1A0400`   |
| GENERATING             | `*`   | `#882200`   | `#1A0400`   |
| ACTOR_WALK_FOUND       | `!`   | `#FFFFFF`   | `#1A0400`   |
| ACTOR_CHANGE_OF_MIND   | `?`   | `#FF4400`   | `#1A0400`   |

Lifecycle beats:
- `MAZE_READY`: walls erupt — flash `#FF4400` for 8 frames, then settle to `#CC2200` over 20 frames.
- `SOLVER_START`: actor flashes `*` then settles to `@` over 8 frames.
- `WALK_TO_GOAL_BEAT`: actor `!` glyph additionally gets `ctx.shadowBlur = 16, ctx.shadowColor = "#FF8800"` for extra eruption effect layered on top of universal white glow.
- `SOLVER_SOLVED`: path pulses `#FFDD00` → path color over 25 frames. Strong glow (`shadowBlur = 16`).
- `SOLVER_TIMEOUT`: actor becomes `*`; flash `#FFFFFF` for 4 frames, then fade to `#441100` over 20 frames.
- `CYCLE_RESET`: brief full-canvas white flash (alpha 0.3) over 8 frames, then fade to `#0D0200`.

Overlay: at Medium/High intensity, slow lava pulse on FLOOR cells. `alpha_mod = 0.1 * sin(2π * frameCount / 200 + row * 0.5 + col * 0.3)`.

**Decorative elements:**

| Glyph set  | `;` `'`                     |
|------------|-----------------------------|
| Foreground | `#4A1200`                   |
| Background | `#1A0400` (floor bg)        |
| Density    | Low: 0%, Med: 3%, High: 6%  |
| Animation  | High only: alpha flicker `±0.15` with per-cell random period in [40, 80] frames (ember glow) |

**HUD palette:**

| Key        | Value                       |
|------------|-----------------------------|
| background | `rgba(26, 4, 0, 0.88)`      |
| border     | `#882200`                   |
| header     | `#FF8800`                   |
| meta       | `#882200`                   |
| active     | `#FFAA00`                   |
| done       | `#CC2200`                   |
| pending    | `#3D0A00`                   |

---

#### Cold **(v2)**

| Semantic State         | Glyph | Foreground  | Background  |
|------------------------|-------|-------------|-------------|
| WALL                   | `+`   | `#6699CC`   | `#040814`   |
| FLOOR                  | `.`   | `#0A1428`   | `#040814`   |
| START                  | `>`   | `#EEEEFF`   | `#040814`   |
| GOAL                   | `X`   | `#AACCFF`   | `#040814`   |
| ACTOR                  | `@`   | `#FFFFFF`   | `#040814`   |
| GENERATING             | `+`   | `#334466`   | `#040814`   |
| ACTOR_WALK_FOUND       | `!`   | `#FFFFFF`   | `#040814`   |
| ACTOR_CHANGE_OF_MIND   | `?`   | `#AACCFF`   | `#040814`   |

Lifecycle beats:
- `MAZE_READY`: walls crystallize from `·` → `+` one column at a time, left to right, over 40 frames.
- `SOLVER_START`: actor crystallizes from `.` to `@` over 12 frames.
- `WALK_TO_GOAL_BEAT`: no additional effect beyond the universal `ACTOR_WALK_FOUND` rendering.
- `SOLVER_SOLVED`: path pulses `#FFFFFF` → path color; glow `shadowColor = #CCDDFF`, `shadowBlur = 10`.
- `SOLVER_TIMEOUT`: actor becomes `x`; dims to `#223355` over 15 frames.
- `CYCLE_RESET`: canvas fades to `#020508` over 20 frames.

Overlay: at Medium/High intensity, occasional frost crystals. Random FLOOR cells gain `+` at `#1A2A44` alpha 0.5 for 60 frames. Maximum 8 active frost cells.

**Decorative elements:**

| Glyph set  | `*` `·`                     |
|------------|-----------------------------|
| Foreground | `#1A2A44`                   |
| Background | `#040814` (floor bg)        |
| Density    | Low: 0%, Med: 3%, High: 7%  |
| Animation  | High only: alpha 0.2→0.5→0.2 with per-cell random period in [160, 240] frames (frost sparkle) |

**HUD palette:**

| Key        | Value                       |
|------------|-----------------------------|
| background | `rgba(4, 8, 20, 0.88)`      |
| border     | `#334466`                   |
| header     | `#EEEEFF`                   |
| meta       | `#334466`                   |
| active     | `#FFFFFF`                   |
| done       | `#6699CC`                   |
| pending    | `#0A1428`                   |

---

## §9 Cycle and Run Loop

### 9.1 Timing Constants **(v2)**

| Constant              | Value                                      | Configurable |
|-----------------------|--------------------------------------------|--------------|
| `STEP_INTERVAL_MS`    | 80                                         | Yes (WE)     |
| `WALK_STEP_MS`        | `max(10, floor(STEP_INTERVAL_MS / 2))`     | Derived       |
| `PATH_HOLD_MS`        | 2500                                       | No           |
| `FADE_DURATION_MS`    | 1500                                       | No           |
| `INTER_SOLVER_MS`     | 500                                        | No           |
| `FIRST_SOLVER_DELAY`  | 0                                          | No           |
| `MAX_SOLVE_MS`        | `computeMaxSolveMs(D_cols, D_rows, 1.0)` (grid-aware) | Yes (WE multiplier) |
| `RESET_BEAT_MS`       | 1000                                       | No           |
| `RESIZE_DEBOUNCE_MS`  | 150                                        | No           |
| `FLICKER_PERIOD_MS`   | 530                                        | No           |
| `FLICKER_ON_FRAC`     | 0.5                                        | No           |
| `CURSOR_FADE_MS`      | 500                                        | No           |

`WALK_STEP_MS` is recomputed whenever `STEP_INTERVAL_MS` changes (via WE property or `updateStepInterval()`).

`MAX_SOLVE_MS` is recomputed at the start of each cycle:
```js
function computeMaxSolveMs(D_cols, D_rows, multiplier) {
  const gridAwareSeconds = Math.min(5 * Math.sqrt(D_cols * D_rows), 600)
  return Math.round(gridAwareSeconds * multiplier * 1000)
}
```

### 9.2 Solver Step Loop **(v2)**

Two separate intervals are used: the search step interval (existing) and the walk step interval (new for walk-to-goal).

```js
let stepInterval = null
let walkInterval = null

function startSolverStep(solver, trace) {
  stepInterval = setInterval(() => {
    if (trace.phase === "searching") {
      solver.step()
      trace.elapsedMs += STEP_INTERVAL_MS
      if (trace.elapsedMs >= maxSolveMs) {
        trace.phase = "timeout"
      }
    }
  }, STEP_INTERVAL_MS)
}

function stopSolverStep() {
  if (stepInterval !== null) { clearInterval(stepInterval); stepInterval = null }
}

// (v2) Walk-to-goal interval
function startWalkStep(trace, walkPath) {
  walkInterval = setInterval(() => {
    const done = traceAdapter.advanceAlongPath(trace, walkPath)
    if (done) {
      stopWalkStep()
      runLoop.signal("WALK_COMPLETE")
    }
  }, WALK_STEP_MS)
}

function stopWalkStep() {
  if (walkInterval !== null) { clearInterval(walkInterval); walkInterval = null }
}
```

`updateStepInterval()` calls `clearInterval` on the current step interval and creates a new one at the updated rate. It also recomputes `WALK_STEP_MS = Math.max(10, Math.floor(config.stepIntervalMs / 2))`. If a walk interval is active, it is also restarted at the updated `WALK_STEP_MS`.

### 9.3 Run Loop State Machine **(v2)**

```
IDLE
  → GENERATING          on cycle start

GENERATING
  → GENERATION_BEAT     when generator.step() returns true
                        fire MAZE_READY lifecycle event
                        hud.setContext(themeName, generatorName, selectedSolvers)
                        theme initializes decorative map
                        computeMaxSolveMs for this grid

GENERATION_BEAT
  → SOLVER_INIT         after RESET_BEAT_MS

SOLVER_INIT
  → SOLVING             immediately (delay = 0 for first solver, INTER_SOLVER_MS for subsequent)
                        create solver; call solver.begin(); set trace.phase = "searching"
                        hud.setCurrentSolver(key, performance.now())
                        call startSolverStep()

SOLVING
  → BEAT_PENDING        when trace.phase becomes "solved"
                        stopSolverStep()
                        fire WALK_TO_GOAL_BEAT lifecycle event
                        trace.beatGlyph = "!"
                        start beatTimer for STEP_INTERVAL_MS

  → TIMEOUT_HOLD        when trace.phase becomes "timeout"
                        stopSolverStep(); fire SOLVER_TIMEOUT
                        hud.recordOutcome(key, elapsedMs, "timeout")
                        begin PATH_HOLD_MS timer

BEAT_PENDING
  → WALK_TO_GOAL        after beatTimer fires (STEP_INTERVAL_MS elapsed)
                        trace.beatGlyph = null
                        if actorCell == goalCell (random walk):
                          skip walk; signal WALK_COMPLETE immediately
                        else:
                          compute walkPath (BFS over trace.visited from actorCell to goal;
                            fallback to full-maze BFS if unreachable through visited graph)
                          trace.walkPath = walkPath; trace.walkIndex = 0
                          trace.phase = "walk_to_goal"
                          startWalkStep(trace, walkPath)

WALK_TO_GOAL
  → SOLVED_HOLD         on WALK_COMPLETE signal (actor arrived at goal)
                        stopWalkStep()
                        trace.phase = "holding"
                        fire SOLVER_SOLVED
                        hud.recordOutcome(key, elapsedMs, "solved")
                        begin PATH_HOLD_MS timer

SOLVED_HOLD
  → FADING              after PATH_HOLD_MS
                        trace.phase = "fading"; begin FADE_DURATION_MS timer

TIMEOUT_HOLD
  → FADING              after PATH_HOLD_MS
                        trace.phase = "fading"; begin FADE_DURATION_MS timer

FADING
  → SOLVER_COMPLETE     after FADE_DURATION_MS
                        trace.phase = "complete"; trace.fadeAlpha = targetFadeOpacity
                        fire SOLVER_FADE_COMPLETE

SOLVER_COMPLETE
  → SOLVER_INIT         if more solvers remain in selectedSolvers queue
  → CYCLE_END           if all solvers complete

CYCLE_END
  → IDLE                after RESET_BEAT_MS
                        fire CYCLE_RESET; discard maze and all trace state
                        hud.reset()

IDLE
  → GENERATING          immediately (cycle repeats)
```

On resize, the state machine transitions to `IDLE` from any state, discarding all in-progress work (including stopping both `stepInterval` and `walkInterval`).

**HUD visibility initialization:** At each `CYCLE_END → IDLE → GENERATING` transition, `hud.setVisible(config.hudVisible)` is called. This re-reads the WE property value. The H-key toggle override from the previous cycle does not persist.

### 9.4 Fade Interpolation *(unchanged from v1)*

During `FADING` phase, `trace.fadeAlpha` is updated each rAF frame:

```
elapsed  = performance.now() - fadeStartTime
progress = clamp(elapsed / FADE_DURATION_MS, 0, 1)
trace.fadeAlpha = 1.0 - progress * (1.0 - targetFadeOpacity)
```

---

## §10 Wallpaper Engine Integration

### 10.1 Property Declarations **(v2)**

The following properties are declared in `project.json` under `general.properties`. Properties marked **(removed)** are no longer present. Properties marked **(new)** are additions. Properties marked **(revised)** have changed semantics.

```json
"theme": {
  "title": "Visual Theme",
  "type": "combo",
  "value": "random",
  "options": {
    "random": "Random",
    "forest": "Forest",
    "desert": "Desert",
    "stone": "Stone",
    "void": "Void",
    "water": "Water",
    "lava": "Lava",
    "cold": "Cold"
  }
}

"scale": {
  "title": "Terminal Scale",
  "type": "combo",
  "value": "medium",
  "options": {
    "tiny": "Tiny (densest)",
    "small": "Small",
    "compact": "Compact",
    "medium": "Medium",
    "large": "Large",
    "xl": "XL",
    "huge": "Huge",
    "poster": "Poster (largest)"
  }
}

"intensity": {
  "title": "Visual Intensity",
  "type": "combo",
  "value": "medium",
  "options": {
    "low": "Low",
    "medium": "Medium",
    "high": "High"
  }
}

"stepInterval": {
  "title": "Solver Step Interval (ms)",
  "type": "slider",
  "value": 80,
  "min": 20,
  "max": 500,
  "step": 10
}

"fadeOpacity": {
  "title": "Completed Solver Fade Opacity",
  "type": "slider",
  "value": 0,
  "min": 0,
  "max": 1,
  "step": 0.05,
  "precision": 2
}

// (revised) Semantics changed from absolute seconds to a grid-aware multiplier.
// Displayed value × grid-aware base = actual maxSolveMs.
// Grid-aware base = min(5 × √(D_cols × D_rows), 600) seconds.
"maxSolveTime": {
  "title": "Max Solve Time (multiplier)",
  "type": "slider",
  "value": 1.0,
  "min": 0.25,
  "max": 4.0,
  "step": 0.25,
  "precision": 2
}

// (new) Mouse cursor light source toggle.
"cursorLight": {
  "title": "Cursor Light Source",
  "type": "bool",
  "value": true
}

// (new) HUD visibility default. Keyboard H key overrides within current cycle.
"hudVisible": {
  "title": "Show HUD",
  "type": "bool",
  "value": true
}

// (removed) "randomWalk" — random walk is now unconditionally in the solver pool.
```

### 10.2 Property Application **(v2)**

```js
window.wallpaperPropertyListener = {
  applyUserProperties(props) {
    let needsRestart = false

    if (props.theme)        { config.theme = props.theme.value; needsRestart = true }
    if (props.scale)        { config.scale = props.scale.value; needsRestart = true }
    if (props.intensity)    { config.intensity = props.intensity.value }
    if (props.stepInterval) {
      config.stepIntervalMs = props.stepInterval.value
      updateStepInterval()    // recomputes WALK_STEP_MS; restarts both intervals if active
    }
    if (props.fadeOpacity)  { config.targetFadeOpacity = props.fadeOpacity.value }
    if (props.maxSolveTime) { config.maxSolveMultiplier = props.maxSolveTime.value }
                              // maxSolveMs recomputed at next cycle start via computeMaxSolveMs
    if (props.cursorLight)  { config.cursorLight = props.cursorLight.value }
    if (props.hudVisible)   { config.hudVisible = props.hudVisible.value; hud.setVisible(config.hudVisible) }

    if (needsRestart) restartCycle()
  }
}
```

`hudVisible` changes take effect immediately (no restart needed). `cursorLight` takes effect immediately (next rAF frame). `maxSolveTime` multiplier changes take effect at the start of the next solver run (current solver keeps its computed limit).

### 10.3 Pause and Throttle *(unchanged from v1)*

When the wallpaper is paused:
- Cancel the rAF loop.
- Cancel the solver step interval and walk step interval.
- Preserve all current state.

When the wallpaper resumes:
- Restart the rAF loop.
- Restart the solver step interval at the current `config.stepIntervalMs`.
- If a walk-to-goal was in progress, restart the walk step interval at `WALK_STEP_MS`.

### 10.4 Browser Development Mode **(v2)**

```js
const DEFAULT_CONFIG = {
  theme:              "random",
  scale:              "medium",
  intensity:          "medium",
  stepIntervalMs:     80,
  targetFadeOpacity:  0,
  maxSolveMultiplier: 1.0,
  cursorLight:        true,
  hudVisible:         true,
}
```

The wallpaper must produce a correct and complete run in a plain browser with these defaults. The `H` key must toggle HUD visibility in plain browser mode.

---

## §11 Performance Contract

### 11.1 Frame Budget *(unchanged from v1)*

Target: 60 fps. Maximum frame time: 16.7ms. The renderer must complete one rAF callback within this budget on a mid-tier desktop GPU (Integrated Intel Xe or equivalent) at 2560×1440 with the Tiny scale preset.

### 11.2 Per-Frame Work Bounds **(v2)**

| Operation                      | Bound                                     |
|--------------------------------|-------------------------------------------|
| Cell rendering loop            | O(D_cols × D_rows) — one pass             |
| Attention field computation    | O(D_cols × D_rows) — one pass, all cells  |
| Cursor light computation       | O(D_cols × D_rows) — one pass (max-blend) |
| Glow pass                      | O(bright_cells) — typically < 200 cells   |
| Theme overlay                  | O(1) draw calls or O(small constant)      |
| HUD render                     | O(1) — fixed layout, 7 text rows          |
| Solver step (setInterval)      | O(1) per tick — not in rAF                |
| Walk step (setInterval)        | O(1) per tick — not in rAF                |
| Generator step                 | O(1) per tick for Backtracker/Prim's      |
| CA generator step              | O(D_cols × D_rows) — once per iteration   |

Cursor and solver attention fields share the same `Float32Array` output buffer. The max-blend is computed in a single pass over the buffer, not two separate passes.

No per-frame heap allocation. Reuse typed arrays for attention field output. Reuse `Float32Array` buffers initialized at grid creation.

### 11.3 Intensity Scaling **(v2)**

| Intensity | Glow | Attention field | Theme overlay | Decoratives    | Flicker |
|-----------|------|----------------|---------------|----------------|---------|
| Low       | Off  | Flat ambient    | Disabled      | Disabled (0%)  | On      |
| Medium    | On   | Full cosine     | On (limited)  | Static (med %) | On      |
| High      | On   | Full cosine     | On (full)     | Animated       | On      |

At Low intensity, the attention field (solver + cursor) degrades to a constant ambient factor. The `Float32Array` is filled with the ambient constant once and not recomputed per-frame until intensity changes.

### 11.4 Resolution Independence *(unchanged from v1)*

All rendering costs are proportional to `D_cols × D_rows`, not canvas pixel dimensions. DPR scaling is applied via a single `setTransform` call.

### 11.5 Memory Bounds **(v2)**

| Structure                        | Size bound                                              |
|----------------------------------|---------------------------------------------------------|
| Maze grid (`Uint8Array`)         | D_cols × D_rows bytes                                   |
| Attention field (`Float32Array`) | D_cols × D_rows × 4 bytes (solver + cursor max-blend)  |
| Solver trace visited (`Set`)     | ≤ D_cols × D_rows entries                              |
| Solver trace frontier (`Set`)    | ≤ D_cols × D_rows entries                              |
| Solver trace breadcrumb (`Map`)  | ≤ D_cols × D_rows entries                              |
| Solver trace path (array)        | ≤ movement history length for walking solvers; ≤ D_cols × D_rows for shortest-path solvers |
| Solver trace movementHistory     | ≤ steps executed before solve or timeout                |
| Solver trace walkPath            | ≤ D_cols × D_rows entries                              |
| Wall follower fingerprints (Set) | ≤ 4 × D_cols × D_rows string entries                   |
| Theme decorative map             | ≤ D_cols × D_rows entries per maze cycle                |
| Commit-to-path internal state    | O(1) per frontier solver                                |
| Generator state                  | ≤ 2 × D_cols × D_rows entries                          |

All allocations are bounded by grid size. No unbounded growth. Theme decorative maps are deallocated on CYCLE_RESET.

---

## §12 Acceptance Criteria

Criteria marked **(v1)** are inherited from v1 and must still pass. Criteria marked **(v2)** are new.

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

### Maze Generation

- **(v1)** Each of the 5 generators produces a fully connected maze.
- **(v1)** CA generator: one contiguous FLOOR region after generation.
- **(v1)** Room-and-Corridor: all placed rooms connected to at least one corridor.
- **(v1)** Generation animation completes in 3–6 seconds at 60 fps across all scale presets.
- **(v1)** START and GOAL cells are never the same cell.
- **(v1)** BFS distance from START to GOAL is ≥ 50% of maximum BFS distance.
- **(v2)** Backtracker: all four outer-border rows/columns are uniformly WALL after generation.
- **(v2)** Organic/CA: on a grid with area < 400 cells, CA uses reduced parameters (seed 0.35, 8 iterations) and still produces a connected maze.
- **(v2)** Organic/CA: on a grid with area < 100 cells, the Prim's fallback runs; no JS errors or degenerate output.
- **(v2)** Organic/CA: large-grid behavior (area ≥ 400) is identical to v1 behavior.

### Solver System

- **(v1)** DFS, BFS, A*, Greedy, WallFollower each solve a standard 21×21 display grid correctly.
- **(v1)** Each solver leaves its breadcrumb color; no solver uses another's color.
- **(v1)** After `maxSolveMs`, solver transitions to `"timeout"` within one step interval.
- **(v1)** Solver selection never picks the same solver twice in one cycle.
- **(v1)** Exactly 4 solvers run per cycle.
- **(v1)** Frontier algorithms keep the actor adjacent on each step (no teleporting).
- **(v2)** Random Walk is unconditionally present in the solver pool; no `randomWalkEnabled` flag exists.
- **(v2)** A cycle always selects 4 solvers from a pool of 6.
- **(v2)** `computeMaxSolveMs(113, 32, 1.0)` returns approximately 300000ms (300s ± 5s).
- **(v2)** `computeMaxSolveMs(D_cols, D_rows, 1.0)` never returns a value exceeding 600000ms.
- **(v2)** `computeMaxSolveMs(D_cols, D_rows, 4.0)` is exactly 4× the 1.0 multiplier result for the same grid.
- **(v2)** Wall follower terminates (phase → "timeout") on a maze where the actor would loop: the (position, facing) fingerprint set detects the repeat before `maxSolveMs` elapses.
- **(v2)** BFS, A*, and Greedy do not change `commitTarget` more often than their commit-to-path window allows. Actor direction is held for ≥ 25 steps at 80ms step interval before a target re-evaluation.
- **(v2)** Change-of-mind beat: `trace.beatGlyph === "?"` for exactly one step interval; clears to null on next step.
- **(v2)** Exit-visibility shortcut fires at most once per solver run (`exitShortcutFired` guard).
- **(v2)** Exit-visibility shortcut does not fire for Random Walk or Wall Follower.

### Walk-to-Goal

- **(v2)** After a path-tracking solver finds the goal, the `!` beat fires (`trace.beatGlyph === "!"`) for exactly one `STEP_INTERVAL_MS` before the walk begins.
- **(v2)** `WALK_TO_GOAL_BEAT` lifecycle event fires exactly once per solved (non-timeout) run.
- **(v2)** Walk-to-goal steps fire at `WALK_STEP_MS = max(10, floor(STEP_INTERVAL_MS / 2))` interval. At 80ms step interval, walk steps fire at 40ms.
- **(v2)** Actor arrives at the goal cell before `SOLVER_SOLVED` fires. `SOLVER_SOLVED` does not fire before actor occupies the goal cell.
- **(v2)** Random Walk: `SOLVER_SOLVED` fires immediately after the `!` beat (no walk phase).
- **(v2)** Walk-to-goal is skipped entirely on timeout runs.
- **(v2)** `trace.phase === "walk_to_goal"` is visible to the renderer during walk-to-goal steps.
- **(v2)** The actor cell at walk completion matches the goal cell (`trace.actorCell == goalCell`).

### Attention Field

- **(v1)** At d=0, attention_factor = 1.0. At d=6, attention_factor = 0.25.
- **(v1)** Wall and floor glyphs are visibly dimmer in cells far from the actor at Medium intensity.
- **(v1)** At Low intensity, all cells render at flat ambient.
- **(v2)** With cursor over the canvas at a grid cell, that cell and surrounding cells within radius 6 are brighter than they would be without cursor light.
- **(v2)** Cursor light fades to zero within 500ms after cursor leaves the canvas.
- **(v2)** Max-blend: when cursor is positioned between actor and a far cell, the far cell is as bright as the brighter of the two sources.
- **(v2)** When `config.cursorLight = false`, cursor position has no visible effect on cell brightness.
- **(v2)** Cursor position is not observable in any solver or generator log or state.

### HUD

- **(v2)** HUD is visible by default. `H` key toggles it within the current cycle.
- **(v2)** HUD initializes to `config.hudVisible` state at each cycle start, regardless of H-key state in the previous cycle.
- **(v2)** HUD displays the theme name, generator name, and up to 4 solver run rows.
- **(v2)** Active solver row shows live elapsed time that updates each rAF frame.
- **(v2)** Completed solver rows show resolved elapsed time and outcome icon (`✓` or `✗`).
- **(v2)** HUD renders on top of all maze cells and overlays at full opacity.
- **(v2)** HUD receives no attention dimming; cells behind the HUD panel remain normally dimmed.
- **(v2)** Each of the 7 themes renders HUD with its distinct `hudPalette` colors.

### Theme System

- **(v1)** Each of the 7 themes renders without JS errors or missing glyphs.
- **(v1)** Solver breadcrumb and path colors are recognizable in all 7 themes.
- **(v1)** Each theme's lifecycle events fire in correct order.
- **(v1)** Fade completes in 1500ms; `targetFadeOpacity` is honored.
- **(v2)** On MAZE_READY, each theme (at Medium intensity) places decoratives on ≥ 1% of eligible floor cells (density table values produce non-zero decoratives on a standard grid).
- **(v2)** Decoratives do not appear on START or GOAL cells.
- **(v2)** Decoratives do not render on cells currently showing VISITED, FRONTIER, PATH, or ACTOR state.
- **(v2)** Decorative glyphs do not include `@`, `?`, `!`, or any theme-specific semantic glyph.
- **(v2)** At Low intensity, no decoratives appear for any theme.
- **(v2)** Theme decorative map is cleared and rebuilt on each MAZE_READY.

### Cycle and Run Loop

- **(v1)** Full cycle runs without deadlock or hang on a fresh browser page.
- **(v1)** PATH_HOLD_MS of 2500ms elapses before fade begins (for solved runs).
- **(v1)** INTER_SOLVER_MS pause is 500ms between solvers; 0ms before first solver.
- **(v2)** CYCLE_RESET fires after all 4 solvers complete, discarding maze and trace state.
- **(v2)** On step interval change via WE property, WALK_STEP_MS is recomputed. If walk interval is active, it restarts at the new WALK_STEP_MS.

### Wallpaper Engine Integration

- **(v1)** Properties appear in WE panel with correct labels and defaults (updated per §10.1).
- **(v1)** `stepInterval` changes update solver cadence without restarting current solver.
- **(v1)** `theme` and `scale` changes restart the cycle.
- **(v2)** `randomWalk` property is absent from the WE property surface.
- **(v2)** `cursorLight` and `hudVisible` properties appear with correct defaults.
- **(v2)** `maxSolveTime` property is a slider with range 0.25–4.0. Default value 1.0.
- **(v2)** Changing `hudVisible` in WE immediately updates HUD visibility (no restart).
- **(v2)** Wallpaper runs correctly in plain Chrome/Edge with no WE present. H key toggles HUD.

### Performance

- **(v1)** No `console.error` or uncaught exceptions during a 10-minute run.
- **(v1)** Memory usage does not grow between successive cycles.
- **(v1)** No per-frame allocations during steady-state solving.
- **(v2)** Adding cursor light (max-blend pass) does not cause sustained frame times above 16.7ms on a mid-tier GPU at Tiny scale preset.

---

## Open Items

**O-1: Bundled font glyph requirements (updated for v2).**
The spec references `'AmazeMono'` as the font family name. The font must include at minimum: all printable ASCII; `█ ░ ▒ ▓ · ≈ ≋ ╬ ║ ×` (v1 requirement); and the following v2 additions: `° ∿ ♣ ♠ ✓ ✗`. The `∿` (U+223F SINE WAVE) is the highest-risk glyph for font coverage. If `∿` is absent, Water decoratives should fall back to `~` (ensuring `~` is not simultaneously used as a WALL glyph in Water — it is; use `≈` as the fallback instead, since it is already in the v1 required set). All other v2 decorative glyphs (`·` U+00B7, `°` U+00B0, `♣` U+2663, `♠` U+2660) and HUD icon glyphs (`✓` U+2713, `✗` U+2717) are widely supported in modern monospace fonts.

**O-2: Wallpaper Engine `project.json` property schema encoding.**
The property declarations in §10.1 use a representative schema. The exact field names, type strings, and nesting structure required by Wallpaper Engine's web wallpaper runtime must be verified against current WE documentation before implementation. The behavioral contract (which properties trigger restart vs. live update) is fixed in §10.2 regardless of schema encoding.

**O-3: Wallpaper Engine pause and resume API.**
§10.3 describes pause behavior. The exact callback names used by Wallpaper Engine to signal pause must be verified before implementation. The behavioral contract (cancel both rAF and both step intervals on pause; restore on resume) is fixed regardless of API name.
