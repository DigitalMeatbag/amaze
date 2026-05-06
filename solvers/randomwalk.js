// Random Walk. Adjacent-step. Disabled by default; included only when
// randomWalkEnabled = true.
import { neighborsOf, reconstructPath, SolverPhase } from "./index.js";

export class RandomWalk {
  get key() { return "randomwalk"; }

  begin(grid, D_cols, D_rows, trace, rng, startIdx, goalIdx) {
    this.grid = grid;
    this.D_cols = D_cols;
    this.D_rows = D_rows;
    this.trace = trace;
    this.startIdx = startIdx;
    this.goalIdx = goalIdx;
    this.rng = rng || Math.random;
    this.parent = new Map();
    this.visited = new Set([startIdx]);
    const sc = startIdx % D_cols, sr = (startIdx / D_cols) | 0;
    trace.actorCell = [sc, sr];
    trace.visited.add(startIdx);
    trace.breadcrumb.set(startIdx, 1);
    trace.movementHistory.push(startIdx);
  }

  step() {
    const [ac, ar] = this.trace.actorCell;
    const aIdx = ar * this.D_cols + ac;
    const nbrs = neighborsOf(aIdx, this.grid, this.D_cols, this.D_rows);
    if (nbrs.length === 0) {
      this.trace.phase = SolverPhase.TIMEOUT;
      return;
    }
    const unvisited = nbrs.filter((n) => !this.visited.has(n));
    const pool = unvisited.length > 0 ? unvisited : nbrs;
    const next = pool[(this.rng() * pool.length) | 0];
    if (!this.parent.has(next)) this.parent.set(next, aIdx);
    const nc = next % this.D_cols, nr = (next / this.D_cols) | 0;
    this.trace.actorCell = [nc, nr];
    this.trace.movementHistory.push(next);
    this.visited.add(next);
    this.trace.visited.add(next);
    const prev = this.trace.breadcrumb.get(next) ?? 0;
    this.trace.breadcrumb.set(next, prev + 1);
    if (next === this.goalIdx) {
      this.trace.path = reconstructPath(this.parent, this.startIdx, this.goalIdx);
      this.trace.phase = SolverPhase.SOLVED;
    }
  }
}
