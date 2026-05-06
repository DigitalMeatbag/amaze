// Solver interface, shared trace adapter, simple min-heap, registry.
// Spec §6.

import { isPassableCell, DIRS4 } from "../maze.js";

import { DFS } from "./dfs.js";
import { BFS } from "./bfs.js";
import { AStar } from "./astar.js";
import { Greedy } from "./greedy.js";
import { WallFollower } from "./wallfollower.js";
import { RandomWalk } from "./randomwalk.js";

export const SolverPhase = Object.freeze({
  SEARCHING: "searching",
  SOLVED: "solved",
  HOLDING: "holding",
  FADING: "fading",
  COMPLETE: "complete",
  TIMEOUT: "timeout",
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

export function selectSolvers(randomWalkEnabled, rng = Math.random) {
  const pool = ["dfs", "bfs", "astar", "greedy", "wallfollower"];
  if (randomWalkEnabled) pool.push("randomwalk");
  shuffle(pool, rng);
  return pool.slice(0, Math.min(4, pool.length));
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

