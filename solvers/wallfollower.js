// Right-hand Wall Follower. Already adjacent-step; no TraceAdapter.
// Uses movementHistory rather than just visited because revisits are expected.
import { CellType, isPassableCell } from "../maze.js";
import { SolverPhase } from "./index.js";

const DIR = {
  N: { dc: 0, dr: -1 },
  E: { dc: 1, dr: 0 },
  S: { dc: 0, dr: 1 },
  W: { dc: -1, dr: 0 },
};
const TURN_RIGHT = { N: "E", E: "S", S: "W", W: "N" };
const TURN_LEFT  = { N: "W", W: "S", S: "E", E: "N" };
const TURN_BACK  = { N: "S", S: "N", E: "W", W: "E" };

export class WallFollower {
  get key() { return "wallfollower"; }

  begin(grid, D_cols, D_rows, trace, rng, startIdx, goalIdx) {
    this.grid = grid;
    this.D_cols = D_cols;
    this.D_rows = D_rows;
    this.trace = trace;
    this.goalIdx = goalIdx;
    const sc = startIdx % D_cols, sr = (startIdx / D_cols) | 0;
    trace.actorCell = [sc, sr];
    trace.visited.add(startIdx);
    trace.breadcrumb.set(startIdx, 1);
    trace.movementHistory.push(startIdx);
    this.facing = "N";
    for (const f of ["N", "E", "S", "W"]) {
      if (this._canMove(sc, sr, f)) { this.facing = f; break; }
    }
    this.recentCells = [];
  }

  _canMove(c, r, dir) {
    const d = DIR[dir];
    const nc = c + d.dc, nr = r + d.dr;
    if (nc < 0 || nc >= this.D_cols || nr < 0 || nr >= this.D_rows) return false;
    return isPassableCell(this.grid[nr * this.D_cols + nc]);
  }

  // Returns the cycle length if recent history repeats, else 0.
  _cycleLen() {
    for (const len of [2, 4, 8]) {
      if (this.recentCells.length < 2 * len) continue;
      const prev = this.recentCells.slice(-2 * len, -len);
      const last = this.recentCells.slice(-len);
      if (prev.every((v, i) => v === last[i])) return len;
    }
    return 0;
  }

  step() {
    const [c, r] = this.trace.actorCell;
    const right = TURN_RIGHT[this.facing];
    const left  = TURN_LEFT[this.facing];
    const back  = TURN_BACK[this.facing];
    const dirs  = [right, this.facing, left, back];

    let chosen = null;

    // Cycle escape: if movement history repeats, find a cell outside the cycle.
    const cLen = this._cycleLen();
    if (cLen > 0) {
      const cycleSet = new Set(this.recentCells.slice(-cLen));
      for (const dir of dirs) {
        if (!this._canMove(c, r, dir)) continue;
        const { dc, dr } = DIR[dir];
        if (!cycleSet.has((r + dr) * this.D_cols + (c + dc))) {
          chosen = dir;
          break;
        }
      }
      if (chosen !== null) {
        this.recentCells = []; // reset so we don't re-trigger immediately
      } else {
        this.trace.phase = SolverPhase.TIMEOUT;
        return;
      }
    }

    // Primary: right-hand rule, treating visited cells as walls.
    if (chosen === null) {
      for (const dir of dirs) {
        if (!this._canMove(c, r, dir)) continue;
        const { dc, dr } = DIR[dir];
        if ((this.trace.breadcrumb.get((r + dr) * this.D_cols + (c + dc)) ?? 0) === 0) {
          chosen = dir;
          break;
        }
      }
    }

    // Fallback: no unvisited neighbors — head toward the goal.
    if (chosen === null) {
      const gc = this.goalIdx % this.D_cols;
      const gr = (this.goalIdx / this.D_cols) | 0;
      let bestDist = Infinity;
      for (const dir of dirs) {
        if (!this._canMove(c, r, dir)) continue;
        const { dc, dr } = DIR[dir];
        const dist = Math.abs(c + dc - gc) + Math.abs(r + dr - gr);
        if (dist < bestDist) { bestDist = dist; chosen = dir; }
      }
    }

    if (chosen === null) {
      this.trace.phase = SolverPhase.TIMEOUT;
      return;
    }

    this.facing = chosen;
    const { dc, dr } = DIR[chosen];
    const nc = c + dc, nr = r + dr;
    const nIdx = nr * this.D_cols + nc;
    this.trace.actorCell = [nc, nr];
    this.trace.movementHistory.push(nIdx);
    this.trace.visited.add(nIdx);
    this.trace.breadcrumb.set(nIdx, (this.trace.breadcrumb.get(nIdx) ?? 0) + 1);

    this.recentCells.push(nIdx);
    if (this.recentCells.length > 16) this.recentCells.shift();

    if (nIdx === this.goalIdx) {
      this.trace.path = this.trace.movementHistory.slice();
      this.trace.phase = SolverPhase.SOLVED;
    }
  }
}
