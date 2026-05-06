// Depth-first search. The actor follows the stack: visits forward to a new
// neighbor or backtracks one step on dead-ends, keeping movement adjacent.
import { CellType, DIRS4 } from "../maze.js";
import { reconstructPath, SolverPhase } from "./index.js";

export class DFS {
  get key() { return "dfs"; }

  begin(grid, D_cols, D_rows, trace, rng, startIdx, goalIdx) {
    this.grid = grid;
    this.D_cols = D_cols;
    this.D_rows = D_rows;
    this.trace = trace;
    this.rng = rng || Math.random;
    this.startIdx = startIdx;
    this.goalIdx = goalIdx;
    this.stack = [startIdx];
    this.visited = new Set([startIdx]);
    this.parent = new Map();
    const sc = startIdx % D_cols, sr = (startIdx / D_cols) | 0;
    trace.actorCell = [sc, sr];
    trace.visited.add(startIdx);
    trace.breadcrumb.set(startIdx, 1);
    trace.movementHistory.push(startIdx);
  }

  step() {
    if (this.stack.length === 0) {
      this.trace.phase = SolverPhase.TIMEOUT;
      return;
    }
    const current = this.stack[this.stack.length - 1];
    if (current === this.goalIdx) {
      this.trace.path = reconstructPath(this.parent, this.startIdx, this.goalIdx);
      this.trace.phase = SolverPhase.SOLVED;
      return;
    }
    // Find first unvisited passable neighbor.
    const cc = current % this.D_cols;
    const cr = (current / this.D_cols) | 0;
    let next = -1;
    for (const dir of DIRS4) {
      const nc = cc + dir.dc, nr = cr + dir.dr;
      if (nc < 0 || nc >= this.D_cols || nr < 0 || nr >= this.D_rows) continue;
      const ni = nr * this.D_cols + nc;
      if (this.visited.has(ni)) continue;
      if (this.grid[ni] === CellType.WALL) continue;
      next = ni;
      break;
    }
    if (next === -1) {
      // Backtrack one step.
      this.stack.pop();
      if (this.stack.length === 0) {
        this.trace.phase = SolverPhase.TIMEOUT;
        return;
      }
      const back = this.stack[this.stack.length - 1];
      const bc = back % this.D_cols;
      const br = (back / this.D_cols) | 0;
      this.trace.actorCell = [bc, br];
      this.trace.movementHistory.push(back);
    } else {
      this.parent.set(next, current);
      this.stack.push(next);
      this.visited.add(next);
      const nc = next % this.D_cols;
      const nr = (next / this.D_cols) | 0;
      this.trace.actorCell = [nc, nr];
      this.trace.visited.add(next);
      this.trace.breadcrumb.set(next, this.stack.length);
      this.trace.movementHistory.push(next);
      if (next === this.goalIdx) {
        this.trace.path = reconstructPath(this.parent, this.startIdx, this.goalIdx);
        this.trace.phase = SolverPhase.SOLVED;
      }
    }
  }
}
