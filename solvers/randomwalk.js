// Random Walk. Spec §6.3.6.
import { SolverBase } from "./SolverBase.js";
import { SolverPhase } from "./SolverPhase.js";
import { neighborsOf, reconstructPath } from "./pathfinding.js";

export class RandomWalk extends SolverBase {
  get key() { return "randomwalk"; }

  _initAlgorithm() {
    this.parent  = new Map();
    this.visited = new Set([this.startIdx]);
    const sc = this.startIdx % this.D_cols, sr = (this.startIdx / this.D_cols) | 0;
    this.trace.actorCell = [sc, sr];
    this.trace.visited.add(this.startIdx);
    this.trace.breadcrumb.set(this.startIdx, 1);
    this.trace.movementHistory.push(this.startIdx);
  }

  _stepAlgorithm() {
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
    this.trace.breadcrumb.set(next, (this.trace.breadcrumb.get(next) ?? 0) + 1);
    if (next === this.goalIdx) {
      this.trace.path = reconstructPath(this.parent, this.startIdx, this.goalIdx);
      this.trace.phase = SolverPhase.SOLVED;
    }
  }
}
