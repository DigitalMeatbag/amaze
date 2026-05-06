// Breadth-first search. Frontier expansion with TraceAdapter for actor movement.
import { advanceActorToward, neighborsOf, reconstructPath, SolverPhase } from "./index.js";

export class BFS {
  get key() { return "bfs"; }

  begin(grid, D_cols, D_rows, trace, rng, startIdx, goalIdx) {
    this.grid = grid;
    this.D_cols = D_cols;
    this.D_rows = D_rows;
    this.trace = trace;
    this.startIdx = startIdx;
    this.goalIdx = goalIdx;
    this.queue = [startIdx];
    this.head = 0;
    this.visited = new Set([startIdx]);
    this.parent = new Map();
    this.frontierTarget = startIdx;
    const sc = startIdx % D_cols, sr = (startIdx / D_cols) | 0;
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
      if (!reached) {
        // Could not route — fall through to expand frontier this step.
      } else {
        return;
      }
    }

    // Expand: dequeue next.
    while (this.head < this.queue.length) {
      const current = this.queue[this.head++];
      this.trace.frontier.delete(current);
      this.frontierTarget = current;
      if (current === this.goalIdx) {
        this.trace.path = reconstructPath(this.parent, this.startIdx, this.goalIdx);
        this.trace.phase = SolverPhase.SOLVED;
        return;
      }
      for (const n of neighborsOf(current, this.grid, this.D_cols, this.D_rows)) {
        if (this.visited.has(n)) continue;
        this.parent.set(n, current);
        this.visited.add(n);
        this.queue.push(n);
        this.trace.frontier.add(n);
      }
      return;
    }
    this.trace.phase = SolverPhase.TIMEOUT;
  }
}
