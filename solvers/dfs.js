// Depth-first search. Spec §6.3.1.
import { CellType, DIRS4 } from "../maze.js";
import { SolverBase } from "./SolverBase.js";
import { SolverPhase } from "./SolverPhase.js";
import { reconstructPath, exitVisible, computePath } from "./pathfinding.js";

export class DFS extends SolverBase {
  get key() { return "dfs"; }

  _initAlgorithm() {
    this.stack = [this.startIdx];
    this.visited = new Set([this.startIdx]);
    this.parent = new Map();
    this.exitShortcutFired = false;
    const sc = this.startIdx % this.D_cols, sr = (this.startIdx / this.D_cols) | 0;
    this.trace.actorCell = [sc, sr];
    this.trace.visited.add(this.startIdx);
    this.trace.breadcrumb.set(this.startIdx, 1);
    this.trace.movementHistory.push(this.startIdx);
  }

  _stepAlgorithm() {
    if (this.stack.length === 0) {
      this.trace.phase = SolverPhase.TIMEOUT;
      return;
    }
    const current = this.stack[this.stack.length - 1];

    if (!this.exitShortcutFired && exitVisible(current, this.goalIdx, this.grid, this.D_cols, this.D_rows, this.visited)) {
      this.exitShortcutFired = true;
      this.trace.walkPath = computePath(current, this.goalIdx, this.visited, this.grid, this.D_cols, this.D_rows);
      this.trace.path = reconstructPath(this.parent, this.startIdx, current)
        .concat(this.trace.walkPath.slice(1));
      this.trace.phase = SolverPhase.SOLVED;
      return;
    }

    if (current === this.goalIdx) {
      this.trace.walkPath = [current];
      this.trace.path = reconstructPath(this.parent, this.startIdx, this.goalIdx);
      this.trace.phase = SolverPhase.SOLVED;
      return;
    }

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
        this.trace.walkPath = [next];
        this.trace.path = reconstructPath(this.parent, this.startIdx, this.goalIdx);
        this.trace.phase = SolverPhase.SOLVED;
      }
    }
  }
}
