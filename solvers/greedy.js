// Greedy Best-First Search with TraceAdapter for actor movement.
// v2: commit-to-path momentum + exit-visibility shortcut.
import { manhattan } from "../maze.js";
import {
  advanceActorToward, MinHeap, neighborsOf, reconstructPath, SolverPhase,
  exitVisible, computePath,
} from "./index.js";

const COMMIT_MIN_STEPS = 25;

export class Greedy {
  get key() { return "greedy"; }

  begin(grid, D_cols, D_rows, trace, rng, startIdx, goalIdx) {
    this.grid = grid;
    this.D_cols = D_cols;
    this.D_rows = D_rows;
    this.trace = trace;
    this.rng = rng || Math.random;
    this.startIdx = startIdx;
    this.goalIdx = goalIdx;
    this.gc = goalIdx % D_cols;
    this.gr = (goalIdx / D_cols) | 0;
    this.parent = new Map();
    this.visited = new Set([startIdx]);
    this.open = new MinHeap();
    const sc = startIdx % D_cols, sr = (startIdx / D_cols) | 0;
    this.open.push(startIdx, manhattan(sc, sr, this.gc, this.gr));
    this.frontierTarget = startIdx;
    // v2 commit-to-path state
    this.commitPath = null;
    this.commitIdx = 0;
    trace.actorCell = [sc, sr];
    trace.visited.add(startIdx);
    trace.breadcrumb.set(startIdx, 1);
    trace.movementHistory.push(startIdx);
  }

  _tryCommit() {
    if (this.visited.size < 4) return false;
    const cells = Array.from(this.visited);
    const [ac, ar] = this.trace.actorCell;
    const aIdx = ar * this.D_cols + ac;
    let best = -1, bestDist = 0;
    for (let i = 0; i < Math.min(cells.length, 20); i++) {
      const idx = cells[(this.rng() * cells.length) | 0];
      const gc = idx % this.D_cols, gr = (idx / this.D_cols) | 0;
      const dist = Math.abs(ac - gc) + Math.abs(ar - gr);
      if (dist > bestDist) { bestDist = dist; best = idx; }
    }
    if (best < 0 || bestDist < 3) return false;
    const path = computePath(aIdx, best, this.visited, this.grid, this.D_cols, this.D_rows);
    if (path.length < 2) return false;
    const N = COMMIT_MIN_STEPS + Math.floor(this.rng() * bestDist);
    this.commitPath = path.slice(1, N + 1);
    this.commitIdx = 0;
    return true;
  }

  step() {
    if (this.commitPath && this.commitIdx < this.commitPath.length) {
      const idx = this.commitPath[this.commitIdx++];
      const nc = idx % this.D_cols, nr = (idx / this.D_cols) | 0;
      this.trace.actorCell = [nc, nr];
      this.trace.movementHistory.push(idx);
      this.trace.visited.add(idx);
      this.trace.breadcrumb.set(idx, (this.trace.breadcrumb.get(idx) ?? 0) + 1);
      if (exitVisible(idx, this.goalIdx, this.grid, this.D_cols, this.D_rows, this.visited)) {
        this.commitPath = null;
        this.trace.walkPath = computePath(idx, this.goalIdx, this.visited, this.grid, this.D_cols, this.D_rows);
        this.trace.path = reconstructPath(this.parent, this.startIdx, idx)
          .concat(this.trace.walkPath.slice(1));
        this.trace.phase = SolverPhase.SOLVED;
        return;
      }
      if (this.commitIdx >= this.commitPath.length) {
        this.trace.beatGlyph = "?";
        this.commitPath = null;
      }
      return;
    }
    if (this.trace.beatGlyph === "?") this.trace.beatGlyph = null;

    const [ac, ar] = this.trace.actorCell;
    const aIdx = ar * this.D_cols + ac;
    if (aIdx !== this.frontierTarget) {
      const reached = advanceActorToward(
        this.trace, this.frontierTarget, this.grid, this.D_cols, this.D_rows, this.visited
      );
      if (reached) return;
    }
    while (!this.open.isEmpty()) {
      const current = this.open.pop();
      if (this.visited.has(current) && current !== this.startIdx) continue;
      this.trace.frontier.delete(current);
      this.visited.add(current);
      this.frontierTarget = current;
      if (current === this.goalIdx) {
        this.trace.walkPath = [current];
        this.trace.path = reconstructPath(this.parent, this.startIdx, this.goalIdx);
        this.trace.phase = SolverPhase.SOLVED;
        return;
      }
      for (const n of neighborsOf(current, this.grid, this.D_cols, this.D_rows)) {
        if (this.visited.has(n)) continue;
        if (this.parent.has(n)) continue;
        this.parent.set(n, current);
        const nc = n % this.D_cols, nr = (n / this.D_cols) | 0;
        this.open.push(n, manhattan(nc, nr, this.gc, this.gr));
        this.trace.frontier.add(n);
      }
      if (this.rng() < 0.15) this._tryCommit();
      return;
    }
    this.trace.phase = SolverPhase.TIMEOUT;
  }
}
