// Solver interface, shared trace adapter, simple min-heap, registry.
// Spec §6.

import { CellType, isPassableCell, DIRS4 } from "../maze.js";

import { DFS } from "./dfs.js";
import { BFS } from "./bfs.js";
import { AStar } from "./astar.js";
import { Greedy } from "./greedy.js";
import { WallFollower } from "./wallfollower.js";
import { RandomWalk } from "./randomwalk.js";

export const SolverPhase = Object.freeze({
  SEARCHING:    "searching",
  SOLVED:       "solved",
  WALK_TO_GOAL: "walk_to_goal",
  HOLDING:      "holding",
  FADING:       "fading",
  COMPLETE:     "complete",
  TIMEOUT:      "timeout",
});

export const Solvers = {
  dfs: DFS,
  bfs: BFS,
  astar: AStar,
  greedy: Greedy,
  wallfollower: WallFollower,
  randomwalk: RandomWalk,
};

export const SOLVER_COLORS = {
  dfs:          { breadcrumb: "#FF5533", path: "#FF7755" },
  bfs:          { breadcrumb: "#33CCFF", path: "#66DDFF" },
  astar:        { breadcrumb: "#33FF66", path: "#66FF99" },
  greedy:       { breadcrumb: "#FFCC33", path: "#FFE066" },
  wallfollower: { breadcrumb: "#CC66FF", path: "#DD99FF" },
  randomwalk:   { breadcrumb: "#AAAAAA", path: "#CCCCCC" },
};

export const SOLVER_LABELS = {
  dfs:          "DFS",
  bfs:          "BFS",
  astar:        "A*",
  greedy:       "Greedy",
  wallfollower: "Wall Follower",
  randomwalk:   "Random Walk",
};

export function newTrace(solverKey) {
  return {
    phase: SolverPhase.SEARCHING,
    actorCell: [0, 0],
    visited: new Set(),
    frontier: new Set(),
    breadcrumb: new Map(),
    path: [],
    movementHistory: [],
    fadeAlpha: 1.0,
    solverKey,
    stepCount: 0,
    elapsedMs: 0,
    // v2 additions
    beatGlyph:  null,       // null | "?" | "!"
    walkPath:   [],         // pre-computed path from actorCell to goal (walk_to_goal phase)
    walkIndex:  0,          // current position in walkPath
  };
}

// Shuffle in-place.
export function shuffle(arr, rng = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (rng() * (i + 1)) | 0;
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}

// v2: random walk always included; always pick 4 from 6.
export function selectSolvers(rng = Math.random) {
  const pool = ["dfs", "bfs", "astar", "greedy", "wallfollower", "randomwalk"];
  shuffle(pool, rng);
  return pool.slice(0, 4);
}

export function makeSolver(key) {
  const Cls = Solvers[key];
  if (!Cls) throw new Error("Unknown solver: " + key);
  return new Cls();
}

// ---------- Min-heap ----------

export class MinHeap {
  constructor() {
    this.data = []; // [{ value, priority }]
  }
  get size() { return this.data.length; }
  isEmpty() { return this.data.length === 0; }
  push(value, priority) {
    this.data.push({ value, priority });
    this._siftUp(this.data.length - 1);
  }
  pop() {
    if (this.data.length === 0) return null;
    const top = this.data[0];
    const last = this.data.pop();
    if (this.data.length > 0) {
      this.data[0] = last;
      this._siftDown(0);
    }
    return top.value;
  }
  _siftUp(i) {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.data[parent].priority <= this.data[i].priority) break;
      const t = this.data[i]; this.data[i] = this.data[parent]; this.data[parent] = t;
      i = parent;
    }
  }
  _siftDown(i) {
    const n = this.data.length;
    while (true) {
      const l = 2 * i + 1;
      const r = 2 * i + 2;
      let smallest = i;
      if (l < n && this.data[l].priority < this.data[smallest].priority) smallest = l;
      if (r < n && this.data[r].priority < this.data[smallest].priority) smallest = r;
      if (smallest === i) break;
      const t = this.data[i]; this.data[i] = this.data[smallest]; this.data[smallest] = t;
      i = smallest;
    }
  }
}

// ---------- TraceAdapter ----------
//
// Frontier solvers (BFS/A*/Greedy) compute on their own data structures, but
// the actor must walk between adjacent discovered passable cells. The adapter
// performs a BFS over the visited set + target cell to find the next adjacent
// step toward the current target.
//
// `discovered` is a Set of cell indices that the solver has already discovered
// and confirmed passable. `target` should be reachable from `actor` through this
// set (typically: the just-popped frontier cell whose parent is in visited).

export function advanceActorToward(trace, targetIdx, grid, D_cols, D_rows, discovered) {
  const [ac, ar] = trace.actorCell;
  const aIdx = ar * D_cols + ac;
  if (aIdx === targetIdx) return true;

  // BFS from actor through discovered ∪ {target}, 4-directional, passable only.
  const parent = new Map();
  parent.set(aIdx, -1);
  const queue = [aIdx];
  let head = 0;
  let found = false;
  while (head < queue.length) {
    const cur = queue[head++];
    if (cur === targetIdx) { found = true; break; }
    const cc = cur % D_cols;
    const cr = (cur / D_cols) | 0;
    for (const dir of DIRS4) {
      const nc = cc + dir.dc, nr = cr + dir.dr;
      if (nc < 0 || nc >= D_cols || nr < 0 || nr >= D_rows) continue;
      const ni = nr * D_cols + nc;
      if (parent.has(ni)) continue;
      if (!isPassableCell(grid[ni])) continue;
      // Only traverse cells we've already discovered, or the target itself.
      if (ni !== targetIdx && !discovered.has(ni)) continue;
      parent.set(ni, cur);
      queue.push(ni);
    }
  }
  if (!found) return false;

  // Reconstruct path from target back to actor; take the cell just after actor.
  let cur = targetIdx;
  let prev = parent.get(cur);
  while (prev !== -1 && prev !== aIdx) {
    cur = prev;
    prev = parent.get(cur);
  }
  // cur is now adjacent to actor: move actor one step.
  const nc = cur % D_cols;
  const nr = (cur / D_cols) | 0;
  trace.actorCell = [nc, nr];
  trace.movementHistory.push(cur);
  trace.visited.add(cur);
  trace.breadcrumb.set(cur, (trace.breadcrumb.get(cur) ?? 0) + 1);
  return cur === targetIdx;
}

// Reconstruct path from `goal` back to `start` using a parent map.
export function reconstructPath(parent, startIdx, goalIdx) {
  const path = [];
  let cur = goalIdx;
  let guard = 0;
  while (cur !== startIdx && cur !== undefined && guard++ < 1_000_000) {
    path.push(cur);
    cur = parent.get(cur);
    if (cur === undefined) return [];
  }
  path.push(startIdx);
  path.reverse();
  return path;
}

export function neighborsOf(idx_, grid, D_cols, D_rows) {
  const c = idx_ % D_cols;
  const r = (idx_ / D_cols) | 0;
  const out = [];
  for (const dir of DIRS4) {
    const nc = c + dir.dc, nr = r + dir.dr;
    if (nc < 0 || nc >= D_cols || nr < 0 || nr >= D_rows) continue;
    const ni = nr * D_cols + nc;
    if (isPassableCell(grid[ni])) out.push(ni);
  }
  return out;
}

// ---------- Phase 2: exit-visibility utilities ----------

const ATTENTION_RADIUS = 6; // Chebyshev radius for exit-visibility check

// Bresenham line-of-sight through non-wall cells.
export function hasLOS(c1, r1, c2, r2, grid, D_cols, D_rows) {
  let x = c1, y = r1;
  const dx = Math.abs(c2 - c1), dy = Math.abs(r2 - r1);
  const sx = c1 < c2 ? 1 : -1, sy = r1 < r2 ? 1 : -1;
  let err = dx - dy;
  while (true) {
    if (x === c2 && y === r2) return true;
    if (grid[y * D_cols + x] === CellType.WALL) return false;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx)  { err += dx; y += sy; }
  }
}

// Bounded BFS over discovered set — true if toIdx reachable within maxSteps.
export function canReach(fromIdx, toIdx, discovered, grid, D_cols, D_rows, maxSteps = 200) {
  if (fromIdx === toIdx) return true;
  const queue = [fromIdx];
  const seen = new Set([fromIdx]);
  let head = 0, steps = 0;
  while (head < queue.length && steps < maxSteps) {
    const cur = queue[head++];
    steps++;
    const cc = cur % D_cols, cr = (cur / D_cols) | 0;
    for (const dir of DIRS4) {
      const nc = cc + dir.dc, nr = cr + dir.dr;
      if (nc < 0 || nc >= D_cols || nr < 0 || nr >= D_rows) continue;
      const ni = nr * D_cols + nc;
      if (seen.has(ni)) continue;
      if (!isPassableCell(grid[ni])) continue;
      if (ni !== toIdx && !discovered.has(ni)) continue;
      if (ni === toIdx) return true;
      seen.add(ni);
      queue.push(ni);
    }
  }
  return false;
}

// exitVisible: Chebyshev ≤ ATTENTION_RADIUS, Bresenham LOS, reachable via discovered.
export function exitVisible(actorIdx, goalIdx, grid, D_cols, D_rows, discovered) {
  const ac = actorIdx % D_cols, ar = (actorIdx / D_cols) | 0;
  const gc = goalIdx % D_cols, gr = (goalIdx / D_cols) | 0;
  if (Math.max(Math.abs(ac - gc), Math.abs(ar - gr)) > ATTENTION_RADIUS) return false;
  if (!hasLOS(ac, ar, gc, gr, grid, D_cols, D_rows)) return false;
  return canReach(actorIdx, goalIdx, discovered, grid, D_cols, D_rows, 100);
}

// BFS walk path from fromIdx to toIdx through discovered cells (inclusive).
export function computePath(fromIdx, toIdx, discovered, grid, D_cols, D_rows) {
  if (fromIdx === toIdx) return [fromIdx];
  const parent = new Map([[fromIdx, -1]]);
  const queue = [fromIdx];
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    const cc = cur % D_cols, cr = (cur / D_cols) | 0;
    for (const dir of DIRS4) {
      const nc = cc + dir.dc, nr = cr + dir.dr;
      if (nc < 0 || nc >= D_cols || nr < 0 || nr >= D_rows) continue;
      const ni = nr * D_cols + nc;
      if (parent.has(ni)) continue;
      if (!isPassableCell(grid[ni])) continue;
      if (ni !== toIdx && !discovered.has(ni)) continue;
      parent.set(ni, cur);
      if (ni === toIdx) {
        const path = [];
        let c = ni;
        while (c !== -1) { path.push(c); c = parent.get(c); }
        path.reverse();
        return path;
      }
      queue.push(ni);
    }
  }
  return [];
}
