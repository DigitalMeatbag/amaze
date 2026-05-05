# amaze — Implementation Specification

> **Scope:** This document is the implementation contract for `amaze`, a Wallpaper Engine web wallpaper. It derives from `amaze_foundation.md`, which owns intent, philosophy, and closed decisions. This spec owns exact values, algorithms, interfaces, and acceptance criteria. Any conflict between this spec and the foundation document should be resolved in favor of the foundation's intent, with this spec updated to match.

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

---

## §1 Purpose

`amaze` generates a full-screen ASCII maze, animates a set of solver algorithms traversing it, then resets into a new maze and repeats. The implementation target is a Wallpaper Engine web wallpaper: an `index.html` file and supporting assets delivered as a local web page, rendered inside Wallpaper Engine's Chromium runtime.

The wallpaper must run without network access. All assets must be bundled locally.

---

## §2 Project Structure

```
amaze/
  index.html          entry point; minimal shell, loads main.js
  main.js             top-level orchestrator; owns run loop and WE integration
  renderer.js         Canvas 2D renderer; owns glyph drawing, glow, flicker
  maze.js             maze cell model and grid utilities
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
  attention.js        Attention field computation
  project.json        Wallpaper Engine project manifest and property declarations
  assets/
    font.woff2        Bundled monospace font (see Open Items O-1)
```

**Module boundaries:**

- `main.js` imports from all other modules. No other module imports from `main.js`.
- `renderer.js` imports from `maze.js`, `themes/index.js`, and `attention.js`. It does not import solver or generator internals.
- Generator modules import only from `maze.js`.
- Solver modules import only from `maze.js`. They do not import renderer or theme modules.
- Theme modules import only the semantic state and lifecycle enums from `solvers/index.js` and `maze.js`.
- `attention.js` has no imports.

**`project.json` shape:**

```json
{
  "title": "amaze",
  "type": "web",
  "file": "index.html",
  "preview": "preview.gif",
  "general": {
    "properties": { ... }
  }
}
```

Property declarations are specified in §10.

---

## §3 Canvas Renderer

### 3.1 Scale Presets and Cell Metrics

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

A global scale transform is applied once after canvas resize:

```
ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0)
```

After that transform, all `ctx` draw calls and coordinate math use CSS pixels. Cell (col, row) draws its glyph at CSS pixel position `(col * cw, row * ch)`.

### 3.4 Render Loop

The render loop runs via `requestAnimationFrame`. Each frame:

1. Clear the canvas with the active theme's background color.
2. For each cell `(col, row)` in the display grid, determine its semantic state from the current maze and solver trace.
3. Ask the active theme to render that cell given its semantic state, solver color (if any), and attention factor.
4. Apply glow pass over bright cells (actor, final path, beat targets).
5. Apply cursor flicker to the actor cell.

The rAF loop runs continuously. Solver stepping is governed by a separate `setInterval` (see §9.2). The render loop never advances solver or generator state; it only reads it.

### 3.5 Glyph Rendering

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

Each cell is redrawn every frame. There is no dirty-cell optimization in v1.

### 3.6 Glow

Glow is a soft shadow drawn under bright glyphs. When enabled by intensity setting:

- Low: no glow.
- Medium: `ctx.shadowBlur = 6`, `ctx.shadowColor = glowColor`.
- High: `ctx.shadowBlur = 12`, `ctx.shadowColor = glowColor`.

Glow applies only to: the actor glyph, final-path cells, and any cell in an active lifecycle beat that the theme marks as bright. All other cells are drawn with `ctx.shadowBlur = 0`.

Glow state must be reset after each bright glyph draw to avoid bleeding onto neighboring cells.

### 3.7 Cursor Flicker

The actor cell alternates between full opacity and `0.55` opacity on a 530ms cycle (265ms on, 265ms off). Flicker is implemented by modulating the actor glyph's `ctx.globalAlpha` before drawing. All other cells draw at `ctx.globalAlpha = 1.0`.

Cursor flicker is independent of solver step cadence.

### 3.8 Resize and Restart

A `ResizeObserver` watches the document body. On resize:

1. Recompute `D_cols`, `D_rows`, and canvas dimensions.
2. Cancel the active generator animation frame callback and solver `setInterval`.
3. Discard all maze, solver, and trace state.
4. Signal the run loop to begin a new cycle from generation.

Debounce resize events with a 150ms trailing delay to avoid thrashing during window drag.

---

## §4 Maze Cell Model

### 4.1 CellType Enum

```js
const CellType = {
  WALL:      0,
  FLOOR:     1,
  START:     2,
  GOAL:      3,
};
```

Solver trace state (actor, visited, frontier, path) is stored separately from the base cell model. The base maze model contains only `CellType` values.

### 4.2 Grid Storage

The display grid is stored as a flat `Uint8Array` of length `D_cols * D_rows`. Cell `(col, row)` maps to index `row * D_cols + col`.

Accessor pattern:

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

Solver and pathfinding code must use a shared passability helper:

```js
function isPassableCell(type) {
  return type === CellType.FLOOR || type === CellType.START || type === CellType.GOAL
}
```

`START` and `GOAL` are passable map cells. Any pseudocode that refers to FLOOR neighbors for solver movement, BFS distance checks, or path reconstruction means passable neighbors unless it is explicitly describing generator carving before start/goal placement.

### 4.3 Coordinate System

- `(0, 0)` is the top-left cell.
- `col` increases to the right; `row` increases downward.
- Display cells at even `col` and even `row` are wall cells in the initial grid before carving.
- Display cells at odd `col` and odd `row` are potential room cells.
- Display cells at mixed parity are passage cells between rooms.

### 4.4 Logical Room Grid

Carving algorithms operate on a logical room grid derived from the display grid:

```
room_cols = floor((D_cols - 1) / 2)
room_rows = floor((D_rows - 1) / 2)
```

Logical room `(rx, ry)` maps to display cell `(2*rx + 1, 2*ry + 1)`.

The passage between logical room `(rx, ry)` and its right neighbor `(rx+1, ry)` occupies display cell `(2*rx + 2, 2*ry + 1)`.

The passage between logical room `(rx, ry)` and its bottom neighbor `(rx, ry+1)` occupies display cell `(2*rx + 1, 2*ry + 2)`.

The Organic/CA generator does not use the logical room grid; it operates directly on the display grid.

### 4.5 Initial Grid State

At the start of generation, all display cells are set to `CellType.WALL`. Generators carve floor cells from this initial state.

---

## §5 Maze Generation

### 5.1 Generator Interface

```js
// generators/index.js
class Generator {
  // Returns the total number of animation steps for this run.
  // Called once after grid initialization, before begin().
  totalSteps(D_cols, D_rows) { return 0 }

  // Called once to initialize generator state with a fresh grid.
  begin(grid, D_cols, D_rows, rng) {}

  // Called each animation tick. Advances internal state by one step.
  // Returns true if generation is complete, false if more steps remain.
  step() { return true }

  // Returns the current display grid. Generator owns the grid during generation.
  getGrid() { return null }
}
```

Generators own the `Uint8Array` grid during the generation phase. On completion, `main.js` takes ownership by calling `getGrid()` and discarding the generator.

### 5.2 Generation Animation

Generation animation runs in the rAF loop. Each frame, the renderer calls `generator.step()` `steps_per_frame` times before drawing. This advances internal generator state briskly without blocking the render:

```
steps_per_frame = max(1, floor(total_steps / 240))
```

Where `total_steps = generator.totalSteps(D_cols, D_rows)` and 240 is the target frame count at 60 fps (~4 seconds). This formula ensures generation completes in approximately 4 seconds regardless of grid size or scale preset.

Generators that do not support incremental animation (currently none in v1) may call their full generation synchronously in `begin()` and return `true` from the first `step()` call. The renderer then shows a reveal transition: cells fade from background to their generated state over 30 frames.

### 5.3 Generator Algorithms

#### 5.3.1 Recursive Backtracker

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

#### 5.3.2 Randomized Prim's

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

#### 5.3.3 Recursive Division

Operates on the display grid directly. Initializes all display cells to `FLOOR`, then places walls. Total steps = estimated number of wall placements; use `(D_cols * D_rows) / 4` as the estimate for animation rate purposes.

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
    wall_row = y + random_even(1, h-2)   // even offset = display grid wall row
    gap_col  = x + random_odd(0, w-1)    // odd offset = passage
    draw horizontal wall from (x, wall_row) to (x+w-1, wall_row) as WALL
    set (gap_col, wall_row) to FLOOR
    enqueue (x, y, w, wall_row - y) and (x, wall_row+1, w, h - (wall_row - y) - 1)
  if VERTICAL: (symmetric)
  return queue is empty
```

`random_even(lo, hi)` picks a random even integer in [lo, hi]. `random_odd(lo, hi)` picks a random odd integer in [lo, hi].

#### 5.3.4 Organic / Cellular Automata

Operates on display grid. Total steps = 15 iterations. Each `step()` call performs one full CA iteration over the entire display grid.

```
begin:
  for each display cell (col, row):
    set to FLOOR with probability 0.45, else WALL

step (iteration i):
  new_grid = copy of current grid
  for each display cell (col, row):
    wall_neighbors = count of WALL cells in 8-neighborhood (clamped to grid)
    if current cell is WALL:
      new_grid[col][row] = WALL if wall_neighbors >= 4 else FLOOR
    else:
      new_grid[col][row] = WALL if wall_neighbors >= 5 else FLOOR
  current grid = new_grid
  if i == 14 (final iteration):
    flood_fill_connectivity()
  return i == 14
```

`flood_fill_connectivity()`: find the largest contiguous FLOOR region via flood fill. Set all FLOOR cells not in the largest region to WALL.

The CA animation rate formula produces `steps_per_frame = max(1, floor(15/240)) = 1` step per frame. Each of the 15 iterations is therefore shown for 16 frames at 60fps (~4 seconds total). This is the correct behavior: each CA iteration is visually interesting enough to hold for multiple frames.

**Override**: for CA, ignore the general `steps_per_frame` formula. Each `step()` call advances by exactly one CA iteration. The animation holds each iteration for 16 rendered frames before calling the next `step()`.

#### 5.3.5 Room-and-Corridor

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
      draw next corridor (L-shaped path of FLOOR cells between two room centers)
      corridor_index++; return false
    else: return true
```

Corridors connect each room to its nearest unconnected room using an L-shaped path. The path first moves horizontally, then vertically (or vice versa, random choice per corridor).

### 5.4 Theme Generator Weights

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

### 5.5 Start and Goal Placement

After generation completes:

1. Collect all `CellType.FLOOR` cells into a candidate list.
2. Pick a random candidate as `start`. Run BFS from `start` over passable cells, recording BFS distance to every reachable cell.
3. `goal_candidates` = all reachable FLOOR cells with BFS distance ≥ 75th percentile of observed distances.
4. Pick `goal` = random cell from `goal_candidates`.
5. If `goal_candidates` is empty (degenerate maze), pick the cell with maximum BFS distance.
6. Set `grid[start] = CellType.START`, `grid[goal] = CellType.GOAL`.

This produces distant endpoints while avoiding strict corner-to-corner repetition.

---

## §6 Solver System

### 6.1 SolverTrace Model

The solver trace is a plain object updated by the solver and read by the renderer each frame:

```js
{
  phase:      "searching" | "solved" | "holding" | "fading" | "complete" | "timeout",
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
}
```

Solvers write to this object. The renderer reads it. No other communication channel exists between solvers and the renderer.

### 6.2 TraceAdapter Contract

Frontier algorithms (BFS, A*, Greedy) compute using their natural data structures but emit movement as an adjacent-step walk through already discovered passable cells. This keeps the `@` embodied even when the next expanded target is on a different branch from the actor's current position.

```js
class TraceAdapter {
  // Called by solver to move actor one step along the path from
  // actorCell toward targetCell, using the discovered movement graph.
  // Updates trace.actorCell. Returns true if actor reached targetCell.
  advanceActorToward(trace, targetCell, discoveredAdjacency) { ... }
}
```

The adapter finds the next step from `trace.actorCell` toward `targetCell` by running a bounded BFS over the solver's discovered passable graph, then taking the first adjacent step on that route. The discovered graph may be represented as an adjacency map, or reconstructed from the solver's visited/frontier/parent state, but it must include enough connectivity to route between discovered branches.

If no discovered route exists yet, the solver must continue expanding its frontier without moving the actor, or select another target that is reachable through the discovered graph. The actor must not teleport.

Frontier algorithms call `advanceActorToward` each solver step to keep the actor moving. They expand the frontier independently of actor movement; frontier expansion and actor movement may happen at different rates.

### 6.3 Solver Interface

```js
class Solver {
  // One-time setup. grid is the completed maze Uint8Array.
  // trace is the SolverTrace object this solver should write to.
  begin(grid, D_cols, D_rows, trace, rng) {}

  // Called each solver step interval tick.
  // Advances algorithm by one logical step.
  // Updates trace.phase, trace.actorCell, trace.visited, etc.
  step() {}

  // Returns the solver's string key for color identity lookup.
  get key() { return "" }
}
```

One `step()` call corresponds to one logical solver advance (one cell visit for DFS/BFS, one actor move for WallFollower). The step interval governs how often `step()` is called (see §9.2).

### 6.4 Solver Algorithms

#### 6.4.1 Depth-First Search

Maintains an explicit stack. Actor position follows top of stack.

```
begin:
  stack = [start_display_cell]
  visited = {start_display_cell}
  parent = {}
  trace.actorCell = start_display_cell

step:
  if stack is empty: trace.phase = "timeout"; return
  current = stack.top()
  trace.actorCell = current
  trace.visited.add(current)
  if current == goal_display_cell:
    reconstruct_path(parent, start, goal) → trace.path
    trace.phase = "solved"; return
  unvisited_floor_neighbors = [adjacent passable cells not in visited]
  if unvisited_floor_neighbors is empty:
    stack.pop()
  else:
    next = unvisited_floor_neighbors[0]  // no random here; DFS takes first
    parent[next] = current
    stack.push(next)
    visited.add(next)
```

Adjacent means 4-directional (N/S/E/W) in display grid coordinates.

#### 6.4.2 Breadth-First Search

Maintains a FIFO queue. Actor moves toward the most recently dequeued cell via TraceAdapter.

```
begin:
  queue = [start_display_cell]
  visited = {start_display_cell}
  parent = {}
  trace.actorCell = start_display_cell
  frontier_target = start_display_cell

step:
  if actor has not reached frontier_target:
    advanceActorToward(trace, frontier_target, parent)
    return
  if queue is empty: trace.phase = "timeout"; return
  current = queue.dequeue()
  frontier_target = current
  trace.frontier.delete(current)
  if current == goal_display_cell:
    reconstruct_path(parent, start, goal) → trace.path
    trace.phase = "solved"; return
  for each unvisited passable neighbor n of current:
    parent[n] = current
    visited.add(n)
    queue.enqueue(n)
    trace.frontier.add(n)
```

#### 6.4.3 A*

Uses a min-heap priority queue ordered by `f = g + h`, where `g` is steps from start and `h` is Manhattan distance to goal.

```
begin:
  open_heap = MinHeap keyed on f
  open_heap.push(start, f=h(start))
  g_score = {start: 0}
  parent = {}
  visited = {}
  trace.actorCell = start
  frontier_target = start

step:
  if actor has not reached frontier_target:
    advanceActorToward(trace, frontier_target, parent)
    return
  if open_heap is empty: trace.phase = "timeout"; return
  current = open_heap.pop()
  trace.frontier.delete(current)
  visited.add(current)
  frontier_target = current
  if current == goal: reconstruct path; trace.phase = "solved"; return
  for each passable neighbor n of current:
    tentative_g = g_score[current] + 1
    if tentative_g < g_score.get(n, Infinity):
      parent[n] = current
      g_score[n] = tentative_g
      f = tentative_g + manhattan(n, goal)
      open_heap.push(n, f)
      trace.frontier.add(n)
```

#### 6.4.4 Greedy Best-First Search

Uses a min-heap ordered by `h` (heuristic only, no path cost).

```
begin:
  open_heap = MinHeap keyed on h
  open_heap.push(start, h=manhattan(start, goal))
  visited = {}
  parent = {}
  trace.actorCell = start
  frontier_target = start

step:
  if actor has not reached frontier_target:
    advanceActorToward(trace, frontier_target, parent)
    return
  if open_heap is empty: trace.phase = "timeout"; return
  current = open_heap.pop()
  trace.frontier.delete(current)
  visited.add(current)
  frontier_target = current
  if current == goal: reconstruct path; trace.phase = "solved"; return
  for each unvisited passable neighbor n of current:
    parent[n] = current
    visited.add(n)
    open_heap.push(n, manhattan(n, goal))
    trace.frontier.add(n)
```

#### 6.4.5 Wall Follower

Follows the right-hand wall rule. Uses compass direction state. Does not use TraceAdapter (already adjacent-step).

```
begin:
  place actor at start_display_cell
  facing = direction from start toward nearest passable neighbor
  trace.actorCell = start
  visited.add(start)
  movementHistory = [start]

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
  visited.add(trace.actorCell)
  movementHistory.push(trace.actorCell)
  if trace.actorCell == goal:
    trace.path = movementHistory.slice()
    trace.phase = "solved"
```

Wall Follower does not produce an optimal path. `trace.path` is the actor's full movement sequence. This is correct and intentional.

Wall Follower has a known limitation: it may loop indefinitely on mazes with isolated wall islands. The maximum solve time (§9.3) is the safety valve.

#### 6.4.6 Random Walk

Moves to a random unvisited passable neighbor each step. If no unvisited neighbor exists, moves to any random passable neighbor (allows revisiting).

```
step:
  neighbors = passable neighbors of actorCell
  unvisited = neighbors not in visited
  next = unvisited is empty ? random(neighbors) : random(unvisited)
  parent[next] = actorCell (only if not already set)
  actorCell = next
  visited.add(next)
  if actorCell == goal:
    reconstruct_path(parent, start, goal) → trace.path
    trace.phase = "solved"
```

Random Walk is excluded from the default solver pool. It is included only when the user enables it via the WE property (§10).

### 6.5 Solver Color Identities

| Solver       | Key           | Breadcrumb  | Path        |
|--------------|---------------|-------------|-------------|
| DFS          | `dfs`         | `#FF5533`   | `#FF7755`   |
| BFS          | `bfs`         | `#33CCFF`   | `#66DDFF`   |
| A*           | `astar`       | `#33FF66`   | `#66FF99`   |
| Greedy       | `greedy`      | `#FFCC33`   | `#FFE066`   |
| Wall Follower| `wallfollower`| `#CC66FF`   | `#DD99FF`   |
| Random Walk  | `randomwalk`  | `#AAAAAA`   | `#CCCCCC`   |

Breadcrumb color is used for `trace.visited` cells. Path color is used for `trace.path` cells after solve. Both colors are specified in CSS hex. Themes may modulate alpha but must not alter hue.

### 6.6 Solver Selection

At the start of each maze cycle:

```
pool = [dfs, bfs, astar, greedy, wallfollower]
if randomWalkEnabled: pool.push(randomwalk)
count = min(4, pool.length)
selected = shuffle(pool).slice(0, count)  // without replacement
```

Selected solvers run in the shuffled order. The same maze is used for all solvers in the cycle.

### 6.7 Maximum Solve Time

Each solver starts a timer at `begin()`. On each `step()`, check:

```
if trace.elapsedMs >= maxSolveMs:
  trace.phase = "timeout"
  return
```

`maxSolveMs` defaults to 60000ms. The timeout produces no `trace.path`. The theme's `SOLVER_TIMEOUT` lifecycle event fires. The solver proceeds through the fade phase normally.

---

## §7 Attention Field

### 7.1 Definition

The attention field is a per-cell brightness multiplier centered on the actor's current display-grid cell. It is computed each frame from `trace.actorCell`.

```
attention_factor(d) = 0.25 + 0.75 * cos²(π * min(d, 6) / 12)
```

Where `d` is the Chebyshev distance (max of |Δcol|, |Δrow|) from the cell to `trace.actorCell`.

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

### 7.2 Application

The renderer passes `attention_factor(d)` to the theme's cell render function. The theme multiplies wall and floor foreground colors by this factor (applied to the RGB channels, leaving alpha unchanged). Solver breadcrumb, path, and start/goal cells are exempt from attention dimming; they render at full solver color.

The attention field does not affect background colors.

### 7.3 Intensity Scaling

| Intensity | Ambient floor | Formula adjustment                    |
|-----------|--------------|---------------------------------------|
| Low       | 0.50         | `0.50 + 0.50 * cos²(…)`              |
| Medium    | 0.25         | `0.25 + 0.75 * cos²(…)` (default)    |
| High      | 0.15         | `0.15 + 0.85 * cos²(…)`              |

### 7.4 Layer Ownership

Attention field computation lives in `attention.js`. The renderer calls `attention.compute(actorCol, actorRow)` once per frame to get a `Float32Array` of length `D_cols * D_rows` with precomputed factors. The theme's render function reads from this array by cell index.

During generation (no active solver), all cells render at the ambient floor level for the current intensity setting.

---

## §8 Theme System

### 8.1 SemanticState Enum

```js
const SemanticState = {
  WALL:        "wall",
  FLOOR:       "floor",
  START:       "start",
  GOAL:        "goal",
  ACTOR:       "actor",
  VISITED:     "visited",
  FRONTIER:    "frontier",
  PATH:        "path",
  GENERATING:  "generating",   // cell in active generation animation
}
```

### 8.2 LifecycleEvent Enum

```js
const LifecycleEvent = {
  MAZE_READY:           "maze_ready",       // generation complete, about to start solvers
  SOLVER_START:         "solver_start",     // new solver beginning
  SOLVER_SOLVED:        "solver_solved",    // solver reached goal
  SOLVER_TIMEOUT:       "solver_timeout",  // solver hit maxSolveMs without solving
  SOLVER_FADE_COMPLETE: "solver_fade_complete", // fade phase finished
  CYCLE_RESET:          "cycle_reset",      // new maze cycle starting
}
```

### 8.3 Theme Interface

```js
class Theme {
  // Returns CSS color string for the page background.
  get backgroundColor() { return "#000000" }

  // Renders one cell. Called by renderer for every cell every frame.
  // col, row: display grid coordinates
  // state: SemanticState string
  // solverColor: {breadcrumb, path} hex strings or null if not solver state
  // attentionFactor: number [0.25, 1.0] from attention field
  // ctx: Canvas 2D context
  // cw, ch: cell width/height in CSS pixels
  // frameCount: current rAF frame number (for animated effects)
  renderCell(col, row, state, solverColor, attentionFactor, ctx, cw, ch, frameCount) {}

  // Called by main.js when a lifecycle event fires.
  // event: LifecycleEvent string
  // data: event-specific payload object
  onLifecycleEvent(event, data) {}

  // Called each rAF frame after all cells are drawn.
  // For theme-level overlay effects (e.g., water shimmer layer).
  renderOverlay(ctx, D_cols, D_rows, cw, ch, frameCount) {}
}
```

### 8.4 Theme Behavior Rules

- Themes control glyphs, foreground color, background color per cell, and overlay effects.
- Core semantic map glyphs for WALL, FLOOR, START, GOAL, ACTOR, and GENERATING must be ASCII. Themes may use non-ASCII glyphs in overlays, lifecycle beats, or decorative effects.
- Solver color identity (breadcrumb/path hex) must be preserved. Themes may tint or brighten these colors for effect but must not replace them with theme palette colors.
- Start and goal cells use theme-defined glyphs and colors even when occupied by solver state. Start/goal identity must remain readable throughout all solver phases.
- Themes must handle all `SemanticState` values. An unknown state should fall back to `FLOOR` rendering.
- Lifecycle events are required semantic hooks. Themes must handle every event either with a visible beat or an explicit no-op documented in that theme's specification.
- `renderOverlay()` is called after all cells are drawn. It must use `ctx.save()` / `ctx.restore()` to avoid corrupting renderer state.
- Theme effects are gated by the intensity setting (Low/Medium/High).

### 8.5 Theme Fade Behavior

When a solver transitions to `"fading"` phase, `trace.fadeAlpha` decreases from 1.0 to `targetFadeOpacity` over 1500ms. The renderer passes `trace.fadeAlpha` to the theme via the cell `state` context. Themes apply `ctx.globalAlpha = fadeAlpha` when drawing visited, frontier, and breadcrumb cells.

Final path cells fade from 1.0 to `targetFadeOpacity` using the same duration and target.

Actor and lifecycle beat effects fade immediately when the solver enters `"fading"` phase.

### 8.6 Theme Specifications

All palette values are CSS hex colors. Core semantic glyph values are ASCII characters. Decorative glyph values used by overlays and lifecycle beats may be UTF-8 characters if the bundled font supports them.

---

#### Forest

| Semantic State | Glyph  | Foreground  | Background  |
|----------------|--------|-------------|-------------|
| WALL           | `#`    | `#2D6B1E`   | `#0A1A0A`   |
| FLOOR          | `.`    | `#1A3D10`   | `#0A1A0A`   |
| START          | `>`    | `#90FF60`   | `#0A1A0A`   |
| GOAL           | `X`    | `#FF9900`   | `#0A1A0A`   |
| ACTOR          | `@`    | `#B0FF80`   | `#0A1A0A`   |
| GENERATING     | `*`    | `#55CC33`   | `#0A1A0A`   |

Lifecycle beats:
- `MAZE_READY`: walls fade from `#0F2A0F` → `#2D6B1E` over 60 frames.
- `SOLVER_START`: actor blinks from `.` to `@` over 12 frames.
- `SOLVER_SOLVED`: path pulses `#CCFF99` → path color twice over 30 frames.
- `SOLVER_TIMEOUT`: actor glyph changes to `x`; dim to `#444444` over 20 frames.
- `CYCLE_RESET`: brief full-canvas darken to `#050F05` over 16 frames.

Overlay: at Medium/High intensity, a subtle green tint shimmer on FLOOR cells within radius 3 of actor. Period: 120 frames, amplitude: ±0.08 alpha.

---

#### Desert

| Semantic State | Glyph  | Foreground  | Background  |
|----------------|--------|-------------|-------------|
| WALL           | `#`    | `#C87820`   | `#1A120A`   |
| FLOOR          | `.`    | `#6B4A14`   | `#1A120A`   |
| START          | `>`    | `#FFE080`   | `#1A120A`   |
| GOAL           | `X`    | `#FF6600`   | `#1A120A`   |
| ACTOR          | `@`    | `#FFE880`   | `#1A120A`   |
| GENERATING     | `*`    | `#CC8830`   | `#1A120A`   |

Lifecycle beats:
- `MAZE_READY`: walls shimmer from `#7A4A10` → `#C87820` over 40 frames.
- `SOLVER_START`: actor fades in from sand-colored `.` to `@` over 12 frames.
- `SOLVER_SOLVED`: path pulses `#FFEE99` → path color over 25 frames.
- `SOLVER_TIMEOUT`: actor changes to `%`; dim to `#554422` over 20 frames.
- `CYCLE_RESET`: brief darken to `#0D0905` over 16 frames.

Overlay: at High intensity, heat shimmer on WALL cells adjacent to actor. Alternate glyph `║` on random wall cells at period 180 frames for mirage effect.

---

#### Stone

| Semantic State | Glyph  | Foreground  | Background  |
|----------------|--------|-------------|-------------|
| WALL           | `#`    | `#8888AA`   | `#080810`   |
| FLOOR          | `.`    | `#2A2A3A`   | `#080810`   |
| START          | `>`    | `#CCCCFF`   | `#080810`   |
| GOAL           | `X`    | `#AAAAFF`   | `#080810`   |
| ACTOR          | `@`    | `#EEEEFF`   | `#080810`   |
| GENERATING     | `*`    | `#555577`   | `#080810`   |

Lifecycle beats:
- `MAZE_READY`: rooms stamp in one by one (matches Room-and-Corridor primary generator). Each room flashes `#AAAACC` for 8 frames then settles to wall color.
- `SOLVER_START`: actor appears as `@` with a brief white flash over 10 frames.
- `SOLVER_SOLVED`: path pulses `#FFFFFF` → path color over 20 frames.
- `SOLVER_TIMEOUT`: actor becomes `+`; glyph color dims to `#444455` over 15 frames.
- `CYCLE_RESET`: full-canvas darken to `#030306` over 20 frames.

Overlay: at Medium/High intensity, drip effect on WALL cells. One `·` drip per 300 frames per column, falling one row per 4 frames.

---

#### Void

| Semantic State | Glyph  | Foreground  | Background  |
|----------------|--------|-------------|-------------|
| WALL           | `#`    | `#220833`   | `#000005`   |
| FLOOR          | ` `    | `#000005`   | `#000005`   |
| START          | `*`    | `#CC44FF`   | `#000005`   |
| GOAL           | `*`    | `#FF44CC`   | `#000005`   |
| ACTOR          | `@`    | `#DD55FF`   | `#000005`   |
| GENERATING     | `*`    | `#110022`   | `#000005`   |

Floor cells render as blank space. The maze reads as walls floating in void.

Lifecycle beats:
- `MAZE_READY`: walls appear at full opacity with no transition (instantaneous).
- `SOLVER_START`: actor appears from blank space to `@` over 10 frames.
- `SOLVER_SOLVED`: path glows with `ctx.shadowBlur = 20`, `shadowColor = #CC44FF` for 60 frames then fades to normal glow.
- `SOLVER_TIMEOUT`: actor vanishes (alpha → 0 over 10 frames). No death glyph.
- `CYCLE_RESET`: canvas fades to `#000000` over 30 frames.

Overlay: at Medium/High intensity, random FLOOR cells twinkle `·` at `#1A0033` alpha 0.4, one new twinkle per 8 frames, each lasting 40 frames. Maximum 20 active twinkles.

---

#### Water

| Semantic State | Glyph  | Foreground  | Background  |
|----------------|--------|-------------|-------------|
| WALL           | `~`    | `#1A3A6A`   | `#040B1F`   |
| FLOOR          | `.`    | `#0D1F40`   | `#040B1F`   |
| START          | `>`    | `#40AAFF`   | `#040B1F`   |
| GOAL           | `O`    | `#00CCFF`   | `#040B1F`   |
| ACTOR          | `@`    | `#66BBFF`   | `#040B1F`   |
| GENERATING     | `~`    | `#0D2A50`   | `#040B1F`   |

Lifecycle beats:
- `MAZE_READY`: wall glyphs cycle `~` → `≈` → `≋` → `≈` over 60 frames (ripple effect).
- `SOLVER_START`: actor rises from `~` to `@` over 12 frames.
- `SOLVER_SOLVED`: path ripples outward from goal; path color pulses `#AAEEFF` → path color.
- `SOLVER_TIMEOUT`: actor becomes `~`; fades to `#0D2A50` over 20 frames.
- `CYCLE_RESET`: canvas fades to `#020810` over 25 frames.

Overlay: at Medium/High intensity, sinusoidal alpha modulation on WALL cells. `alpha_mod = 0.15 * sin(2π * frameCount / 80 + col * 0.3)`. Applied additively to base wall foreground alpha.

---

#### Lava

| Semantic State | Glyph  | Foreground  | Background  |
|----------------|--------|-------------|-------------|
| WALL           | `#`    | `#CC2200`   | `#1A0400`   |
| FLOOR          | `.`    | `#3D0A00`   | `#1A0400`   |
| START          | `>`    | `#FF8800`   | `#1A0400`   |
| GOAL           | `X`    | `#FF4400`   | `#1A0400`   |
| ACTOR          | `@`    | `#FFAA00`   | `#1A0400`   |
| GENERATING     | `*`    | `#882200`   | `#1A0400`   |

Lifecycle beats:
- `MAZE_READY`: walls erupt — flash `#FF4400` for 8 frames, then settle to `#CC2200` over 20 frames.
- `SOLVER_START`: actor flashes `*` then settles to `@` over 8 frames.
- `SOLVER_SOLVED`: path pulses `#FFDD00` → path color over 25 frames. Strong glow (`shadowBlur=16`).
- `SOLVER_TIMEOUT`: actor becomes `*`; flash `#FFFFFF` for 4 frames, then fade to `#441100` over 20 frames.
- `CYCLE_RESET`: brief full-canvas white flash (alpha 0.3) over 8 frames, then fade to `#0D0200`.

Overlay: at Medium/High intensity, slow lava pulse on FLOOR cells. `alpha_mod = 0.1 * sin(2π * frameCount / 200 + row * 0.5 + col * 0.3)`. Applied to foreground alpha.

---

#### Cold

| Semantic State | Glyph  | Foreground  | Background  |
|----------------|--------|-------------|-------------|
| WALL           | `+`    | `#6699CC`   | `#040814`   |
| FLOOR          | `.`    | `#0A1428`   | `#040814`   |
| START          | `>`    | `#EEEEFF`   | `#040814`   |
| GOAL           | `X`    | `#AACCFF`   | `#040814`   |
| ACTOR          | `@`    | `#FFFFFF`   | `#040814`   |
| GENERATING     | `+`    | `#334466`   | `#040814`   |

Lifecycle beats:
- `MAZE_READY`: walls crystallize from `·` → `+` one column at a time, left to right, over 40 frames.
- `SOLVER_START`: actor crystallizes from `.` to `@` over 12 frames.
- `SOLVER_SOLVED`: path pulses `#FFFFFF` → path color; glow `shadowColor = #CCDDFF`, `shadowBlur = 10`.
- `SOLVER_TIMEOUT`: actor becomes `x`; dims to `#223355` over 15 frames.
- `CYCLE_RESET`: canvas fades to `#020508` over 20 frames.

Overlay: at Medium/High intensity, occasional frost crystals. Random FLOOR cells gain `+` at `#1A2A44` alpha 0.5 for 60 frames. Maximum 8 active frost cells.

---

## §9 Cycle and Run Loop

### 9.1 Timing Constants

| Constant              | Value   | Configurable |
|-----------------------|---------|--------------|
| `STEP_INTERVAL_MS`    | 80      | Yes (WE)     |
| `PATH_HOLD_MS`        | 2500    | No           |
| `FADE_DURATION_MS`    | 1500    | No           |
| `INTER_SOLVER_MS`     | 500     | No           |
| `FIRST_SOLVER_DELAY`  | 0       | No           |
| `MAX_SOLVE_MS`        | 60000   | Yes (WE)     |
| `RESET_BEAT_MS`       | 1000    | No           |
| `RESIZE_DEBOUNCE_MS`  | 150     | No           |
| `FLICKER_PERIOD_MS`   | 530     | No           |
| `FLICKER_ON_FRAC`     | 0.5     | No           |

The first solver in each cycle starts with 0ms delay (`FIRST_SOLVER_DELAY`). Subsequent solvers wait `INTER_SOLVER_MS` after the previous solver's fade completes.

### 9.2 Solver Step Loop

```js
let stepInterval = null

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
  if (stepInterval !== null) {
    clearInterval(stepInterval)
    stepInterval = null
  }
}
```

The `setInterval` only advances `trace.phase = "searching"` steps. Phase transitions (`searching → solved`, `searching → timeout`) are detected in `solver.step()` or the interval callback. Subsequent phases (`holding`, `fading`, `complete`) are managed by the run loop state machine.

### 9.3 Run Loop State Machine

States and transitions:

```
IDLE
  → GENERATING          on cycle start

GENERATING
  → GENERATION_BEAT     when generator.step() returns true
                        fire MAZE_READY lifecycle event

GENERATION_BEAT
  → SOLVER_INIT         after RESET_BEAT_MS

SOLVER_INIT
  → SOLVING             immediately (delay = 0 for first solver, INTER_SOLVER_MS for subsequent)
                        create solver, call solver.begin(), set trace.phase = "searching"
                        call startSolverStep()

SOLVING
  → SOLVED_HOLD         when trace.phase becomes "solved"
                        stopSolverStep(); fire SOLVER_SOLVED; begin PATH_HOLD_MS timer
  → TIMEOUT_HOLD        when trace.phase becomes "timeout"
                        stopSolverStep(); fire SOLVER_TIMEOUT; begin PATH_HOLD_MS timer

SOLVED_HOLD
  → FADING              after PATH_HOLD_MS
                        trace.phase = "fading"; begin FADE_DURATION_MS timer

TIMEOUT_HOLD
  → FADING              after PATH_HOLD_MS (same as SOLVED_HOLD)
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

IDLE
  → GENERATING          immediately (cycle repeats)
```

On resize, the state machine transitions to `IDLE` from any state, discarding all in-progress work.

### 9.4 Fade Interpolation

During `FADING` phase, `trace.fadeAlpha` is updated each rAF frame:

```
elapsed = performance.now() - fadeStartTime
progress = clamp(elapsed / FADE_DURATION_MS, 0, 1)
trace.fadeAlpha = 1.0 - progress * (1.0 - targetFadeOpacity)
```

This produces a linear fade from 1.0 to `targetFadeOpacity`.

---

## §10 Wallpaper Engine Integration

### 10.1 Property Declarations

The following properties are declared in `project.json` under `general.properties`:

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

"maxSolveTime": {
  "title": "Maximum Solve Time (seconds)",
  "type": "slider",
  "value": 60,
  "min": 5,
  "max": 300,
  "step": 5
}

"randomWalk": {
  "title": "Include Random Walk Solver",
  "type": "bool",
  "value": false
}
```

See Open Item O-2 for the exact encoding of these declarations in `project.json`.

### 10.2 Property Application

Wallpaper Engine calls `window.wallpaperPropertyListener.applyUserProperties(props)` when any property changes.

```js
window.wallpaperPropertyListener = {
  applyUserProperties(props) {
    let needsRestart = false

    if (props.theme)        { config.theme = props.theme.value; needsRestart = true }
    if (props.scale)        { config.scale = props.scale.value; needsRestart = true }
    if (props.intensity)    { config.intensity = props.intensity.value; /* no restart */ }
    if (props.stepInterval) { config.stepIntervalMs = props.stepInterval.value; updateStepInterval() }
    if (props.fadeOpacity)  { config.targetFadeOpacity = props.fadeOpacity.value; /* no restart */ }
    if (props.maxSolveTime) { config.maxSolveMs = props.maxSolveTime.value * 1000; /* no restart */ }
    if (props.randomWalk)   { config.randomWalkEnabled = props.randomWalk.value; needsRestart = true }

    if (needsRestart) restartCycle()
  }
}
```

`updateStepInterval()` calls `clearInterval` on the current step interval and creates a new one at the updated rate without restarting the current solver from the beginning.

`restartCycle()` is the same as a resize-triggered restart: discard all state, reinitialize canvas metrics, begin a new generation cycle.

Theme changes that require a restart pick the new theme for the next cycle. Scale changes recompute `D_cols` and `D_rows` and force new grid allocation.

### 10.3 Pause and Throttle

See Open Item O-3 for the exact Wallpaper Engine pause/resume API names.

When the wallpaper is paused:
- Cancel the rAF loop.
- Cancel the solver step interval.
- Preserve all current state.

When the wallpaper resumes:
- Restart the rAF loop.
- Restart the solver step interval at the current `config.stepIntervalMs`.

When the wallpaper is not the active wallpaper (user-facing window obscures it), Wallpaper Engine may throttle the frame rate. The rAF loop handles this automatically. The solver step interval is time-based and remains accurate regardless of frame rate.

### 10.4 Browser Development Mode

When `window.wallpaperPropertyListener` would not be called (plain browser), `main.js` applies default config values directly:

```js
const DEFAULT_CONFIG = {
  theme:             "random",
  scale:             "medium",
  intensity:         "medium",
  stepIntervalMs:    80,
  targetFadeOpacity: 0,
  maxSolveMs:        60000,
  randomWalkEnabled: false,
}
```

The wallpaper must produce a correct and complete run in a plain browser with these defaults.

---

## §11 Performance Contract

### 11.1 Frame Budget

Target: 60 fps. Maximum frame time: 16.7ms. The renderer must complete one rAF callback within this budget on a mid-tier desktop GPU (Integrated Intel Xe or equivalent) at 2560×1440 with the Tiny scale preset (densest grid).

### 11.2 Per-Frame Work Bounds

| Operation                   | Bound                                      |
|-----------------------------|--------------------------------------------|
| Cell rendering loop         | O(D_cols × D_rows) — one pass              |
| Attention field computation | O(D_cols × D_rows) — one pass, all cells   |
| Glow pass                   | O(bright_cells) — typically < 200 cells    |
| Theme overlay               | O(1) draw calls or O(small constant)       |
| Solver step (setInterval)   | O(1) per tick — not in rAF                 |
| Generator step              | O(1) per tick for Backtracker/Prim's       |
| CA generator step           | O(D_cols × D_rows) — once per iteration    |

No per-frame heap allocation. Reuse typed arrays for attention field output. Reuse `Float32Array` buffers initialized at grid creation.

### 11.3 Intensity Scaling

| Intensity | Glow | Attention field | Theme overlay | Flicker |
|-----------|------|----------------|---------------|---------|
| Low       | Off  | Flat ambient    | Disabled      | On      |
| Medium    | On   | Full cosine     | On (limited)  | On      |
| High      | On   | Full cosine     | On (full)     | On      |

At Low intensity, the attention field degrades to a constant ambient factor (no per-cell computation). The attention `Float32Array` is filled with the ambient constant once at init and never recomputed until intensity setting changes.

### 11.4 Resolution Independence

All rendering costs are proportional to the number of display cells `D_cols × D_rows`, not to canvas pixel dimensions. DPR scaling is applied via a single `setTransform` call; glyph draw calls remain in CSS pixel space.

At Poster scale on a 1920×1080 display: `D_cols ≈ 113`, `D_rows ≈ 32`, total cells ≈ 3600. At Tiny scale on a 2560×1440 display: `D_cols ≈ 320`, `D_rows ≈ 96`, total cells ≈ 30720. Render cost scales between these bounds.

### 11.5 Memory Bounds

| Structure                      | Size bound                           |
|-------------------------------|--------------------------------------|
| Maze grid (`Uint8Array`)       | D_cols × D_rows bytes                |
| Attention field (`Float32Array`)| D_cols × D_rows × 4 bytes            |
| Solver trace visited (`Set`)   | ≤ D_cols × D_rows entries            |
| Solver trace frontier (`Set`)  | ≤ D_cols × D_rows entries            |
| Solver trace breadcrumb (`Map`)| ≤ D_cols × D_rows entries            |
| Solver trace path (array)      | ≤ movement history length for walking solvers; ≤ D_cols × D_rows for shortest-path solvers |
| Solver trace movementHistory   | ≤ steps executed before solve or timeout |
| Generator state                | ≤ 2 × D_cols × D_rows entries        |

All allocations are bounded by grid size. No unbounded growth. Trace structures are allocated fresh per solver run and released when the run is discarded.

---

## §12 Acceptance Criteria

### Renderer

- [ ] Canvas contains a centered exact-cell grid with no partial cells visible at any canvas edge; any unused viewport margin is filled by the active theme background.
- [ ] All 8 scale presets produce a legible grid at the specified font and cell metrics.
- [ ] On a 2560×1440 display at Tiny scale, the wallpaper sustains ≥ 55 fps during active solving.
- [ ] Cursor flicker on the actor cell fires at 530ms period (measured with devtools).
- [ ] Glow is absent at Low intensity; present at Medium and High.
- [ ] After resize, the grid recomputes and a new cycle begins within 200ms.

### Maze Generation

- [ ] Each of the 5 generators produces a fully connected maze (all passable cells reachable from START).
- [ ] CA generator: connectivity post-processing removes isolated chambers; one contiguous FLOOR region after generation.
- [ ] Room-and-Corridor: all placed rooms are connected to at least one corridor.
- [ ] Generation animation completes in 3–6 seconds at 60 fps across all scale presets.
- [ ] START and GOAL cells are never the same cell.
- [ ] BFS distance from START to GOAL is ≥ 50% of maximum BFS distance across all passable cells.

### Solver System

- [ ] DFS, BFS, A*, Greedy, WallFollower each solve a standard 10×10 logical room maze (21×21 display grid) correctly.
- [ ] Each solver leaves its breadcrumb color on visited cells; no solver uses another solver's color.
- [ ] After `maxSolveMs`, solver transitions to `"timeout"` within one step interval.
- [ ] Random Walk is excluded from solver selection when `randomWalkEnabled = false`.
- [ ] Solver selection never picks the same solver twice in one cycle.
- [ ] At most 4 solvers run per cycle.
- [ ] Frontier algorithms keep the actor adjacent to its previous position on each step (no teleporting).

### Attention Field

- [ ] At d=0 (actor cell), attention_factor = 1.0 (within floating-point tolerance).
- [ ] At d=6, attention_factor = 0.25.
- [ ] At d=7, attention_factor = 0.25 (clamped, same as d=6).
- [ ] Wall and floor glyphs are visibly dimmer in cells far from the actor (Medium intensity).
- [ ] At Low intensity, all cells render at flat ambient, no gradient visible.

### Theme System

- [ ] Each of the 7 themes renders without JS errors or missing glyphs.
- [ ] Solver breadcrumb and path colors are recognizable in all 7 themes.
- [ ] Each theme's lifecycle events fire in correct order: MAZE_READY → (per solver: SOLVER_START, SOLVER_SOLVED or SOLVER_TIMEOUT, SOLVER_FADE_COMPLETE) → CYCLE_RESET.
- [ ] Fade from fully visible to targetFadeOpacity completes in 1500ms (measured with devtools timeline).
- [ ] At `targetFadeOpacity = 0`, all solver markings are fully invisible after fade.
- [ ] At `targetFadeOpacity = 1`, all solver markings remain at full opacity after fade.

### Cycle and Run Loop

- [ ] Full cycle (generation + 4 solvers + reset) runs without deadlock or hang on a fresh browser page.
- [ ] PATH_HOLD_MS of 2500ms elapses before fade begins (measured for a solved run).
- [ ] Solved runs and timeout runs both enter FADING phase and fade correctly.
- [ ] INTER_SOLVER_MS pause is 500ms between solver 1→2, 2→3, 3→4; 0ms before solver 1.

### Wallpaper Engine Integration

- [ ] All 7 properties appear in Wallpaper Engine's properties panel with correct labels and default values.
- [ ] Changing `stepInterval` in WE updates solver step cadence without restarting the current solver.
- [ ] Changing `theme` or `scale` restarts the cycle.
- [ ] Changing `fadeOpacity` takes effect on the next solver fade.
- [ ] Wallpaper runs correctly in plain Chrome/Edge with no WE present.

### Performance

- [ ] No `console.error` or uncaught exceptions during a 10-minute run.
- [ ] Memory usage (Chrome devtools heap snapshot) does not grow between successive cycles.
- [ ] No per-frame allocations visible in Chrome devtools memory profiler during steady-state solving.

---

## Open Items

**O-1: Bundled font name.**
The spec references `'AmazeMono'` as the font family name in Canvas 2D draw calls. The actual bundled monospace font (file `assets/font.woff2`) and its declared family name are not yet decided. Implementation must load the font via `FontFace` API before the first render frame. The font must include at minimum: all printable ASCII, `█ ░ ▒ ▓ · ≈ ≋ ╬ ║ ×`. If any required glyph is absent from the chosen font, a fallback must be identified.

**O-2: Wallpaper Engine `project.json` property schema encoding.**
The property declarations in §10.1 use a representative schema. The exact field names, type strings, and nesting structure required by Wallpaper Engine's web wallpaper runtime must be verified against current WE documentation before implementation. The behavioral contract (which properties trigger restart vs. live update) is fixed in §10.2 regardless of schema encoding.

**O-3: Wallpaper Engine pause and resume API.**
§10.3 describes pause and throttle behavior. The exact callback names used by Wallpaper Engine to signal pause (`wallpaperPauseListener`? `window.wallpaperTogglePause`?) must be verified before implementation. The behavioral contract (cancel rAF and step interval on pause; restore on resume) is fixed regardless of API name.
