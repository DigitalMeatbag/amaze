// Breadth-first search. Spec §6.3.2.
import { FrontierSolverBase } from "./FrontierSolverBase.js";
import { SolverPhase } from "./SolverPhase.js";
import { neighborsOf } from "./pathfinding.js";

export class BFS extends FrontierSolverBase {
  get key() { return "bfs"; }

  _initFrontier() {
    this.queue  = [this.startIdx];
    this.head   = 0;
    this.parent = new Map();
    // visited already initialized in FrontierSolverBase._initAlgorithm()
  }

  _expandOneFrontierCell() {
    if (this.head >= this.queue.length) {
      this.trace.phase = SolverPhase.TIMEOUT;
      return;
    }
    const current = this.queue[this.head++];
    this.trace.frontier.delete(current);
    this.frontierTarget = current;
    if (current === this.goalIdx) {
      const [ac, ar] = this.trace.actorCell;
      this._finalizeFound(ar * this.D_cols + ac);
      return;
    }
    for (const n of neighborsOf(current, this.grid, this.D_cols, this.D_rows)) {
      if (this.visited.has(n)) continue;
      this.parent.set(n, current);
      this.visited.add(n);
      this.queue.push(n);
      this.trace.frontier.add(n);
    }
  }
}
