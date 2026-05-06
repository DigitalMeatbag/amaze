// Greedy Best-First Search with TraceAdapter for actor movement.
import { manhattan } from "../maze.js";
import {
  advanceActorToward, MinHeap, neighborsOf, reconstructPath, SolverPhase,
} from "./index.js";

export class Greedy {
  get key() { return "greedy"; }

  begin(grid, D_cols, D_rows, trace, rng, startIdx, goalIdx) {
    this.grid = grid;
    this.D_cols = D_cols;
    this.D_rows = D_rows;
    this.trace = trace;
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
    trace.actorCell = [sc, sr];
    trace.visited.add(startIdx);
    trace.breadcrumb.set(startIdx, 1);
    trace.movementHistory.push(startIdx);
  }

  step() {
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
      return;
    }
    this.trace.phase = SolverPhase.TIMEOUT;
  }
}
