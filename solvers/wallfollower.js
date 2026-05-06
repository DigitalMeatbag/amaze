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
    this.startIdx = startIdx;
    this.goalIdx = goalIdx;
    const sc = startIdx % D_cols, sr = (startIdx / D_cols) | 0;
    trace.actorCell = [sc, sr];
    trace.visited.add(startIdx);
    trace.breadcrumb.set(startIdx, 1);
    trace.movementHistory.push(startIdx);
    // Choose initial facing: first passable neighbor in N,E,S,W order.
    this.facing = "N";
    for (const f of ["N", "E", "S", "W"]) {
      if (this._canMove(sc, sr, f)) { this.facing = f; break; }
    }
  }

  _canMove(c, r, dir) {
    const d = DIR[dir];
    const nc = c + d.dc, nr = r + d.dr;
    if (nc < 0 || nc >= this.D_cols || nr < 0 || nr >= this.D_rows) return false;
    return isPassableCell(this.grid[nr * this.D_cols + nc]);
  }

  step() {
    const [c, r] = this.trace.actorCell;
    const right = TURN_RIGHT[this.facing];
    const left  = TURN_LEFT[this.facing];
    const back  = TURN_BACK[this.facing];

    let chosen = null;
    if (this._canMove(c, r, right)) {
      this.facing = right; chosen = right;
    } else if (this._canMove(c, r, this.facing)) {
      chosen = this.facing;
    } else if (this._canMove(c, r, left)) {
      this.facing = left; chosen = left;
    } else {
      this.facing = back; chosen = back;
      if (!this._canMove(c, r, chosen)) {
        // Truly stuck (isolated cell). Treat as timeout.
        this.trace.phase = SolverPhase.TIMEOUT;
        return;
      }
    }
    const d = DIR[chosen];
    const nc = c + d.dc, nr = r + d.dr;
    const nIdx = nr * this.D_cols + nc;
    this.trace.actorCell = [nc, nr];
    this.trace.movementHistory.push(nIdx);
    this.trace.visited.add(nIdx);
    const prev = this.trace.breadcrumb.get(nIdx) ?? 0;
    this.trace.breadcrumb.set(nIdx, prev + 1);

    if (nIdx === this.goalIdx) {
      this.trace.path = this.trace.movementHistory.slice();
      this.trace.phase = SolverPhase.SOLVED;
    }
  }
}
