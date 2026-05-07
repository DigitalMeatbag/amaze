// A* search. Spec §6.3.3.
import { manhattan } from "../maze.js";
import { FrontierSolverBase } from "./FrontierSolverBase.js";
import { SolverPhase } from "./SolverPhase.js";
import { MinHeap } from "./MinHeap.js";
import { neighborsOf } from "./pathfinding.js";

export class AStar extends FrontierSolverBase {
  get key() { return "astar"; }

  _initFrontier() {
    this.gc     = this.goalIdx % this.D_cols;
    this.gr     = (this.goalIdx / this.D_cols) | 0;
    this.gScore = new Map([[this.startIdx, 0]]);
    this.parent = new Map();
    this.open   = new MinHeap();
    const sc = this.startIdx % this.D_cols, sr = (this.startIdx / this.D_cols) | 0;
    this.open.push(this.startIdx, manhattan(sc, sr, this.gc, this.gr));
  }

  _expandOneFrontierCell() {
    while (!this.open.isEmpty()) {
      const current = this.open.pop();
      if (this.visited.has(current) && current !== this.startIdx) continue;
      this.trace.frontier.delete(current);
      this.visited.add(current);
      this.frontierTarget = current;
      if (current === this.goalIdx) {
        const [ac, ar] = this.trace.actorCell;
        this._finalizeFound(ar * this.D_cols + ac);
        return;
      }
      const cg = this.gScore.get(current);
      for (const n of neighborsOf(current, this.grid, this.D_cols, this.D_rows)) {
        const tentative = cg + 1;
        const prev = this.gScore.get(n);
        if (prev === undefined || tentative < prev) {
          this.parent.set(n, current);
          this.gScore.set(n, tentative);
          const nc = n % this.D_cols, nr = (n / this.D_cols) | 0;
          this.open.push(n, tentative + manhattan(nc, nr, this.gc, this.gr));
          this.trace.frontier.add(n);
        }
      }
      return;
    }
    this.trace.phase = SolverPhase.TIMEOUT;
  }
}
