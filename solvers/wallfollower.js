// Right-hand Wall Follower. Spec §6.4.5.
//
// Two-phase behavior:
//   Seek  — actor not yet adjacent to any wall; moves with right-hand bias,
//            preferring unvisited cells, until it touches a wall surface.
//   Follow — pure right-hand rule (right → forward → left → back) with
//            (position, facing) fingerprint cycle detection.
import { isPassableCell } from "../maze.js";
import { SolverBase } from "./SolverBase.js";
import { SolverPhase } from "./SolverPhase.js";

const DIR = {
  N: { dc: 0, dr: -1 },
  E: { dc: 1, dr: 0 },
  S: { dc: 0, dr: 1 },
  W: { dc: -1, dr: 0 },
};
const TURN_RIGHT = { N: "E", E: "S", S: "W", W: "N" };
const TURN_LEFT  = { N: "W", W: "S", S: "E", E: "N" };
const TURN_BACK  = { N: "S", S: "N", E: "W", W: "E" };

export class WallFollower extends SolverBase {
  get key() { return "wallfollower"; }

  _initAlgorithm() {
    const sc = this.startIdx % this.D_cols, sr = (this.startIdx / this.D_cols) | 0;
    this.trace.actorCell = [sc, sr];
    this.trace.visited.add(this.startIdx);
    this.trace.breadcrumb.set(this.startIdx, 1);
    this.trace.movementHistory.push(this.startIdx);
    this.facing = "N";
    for (const f of ["N", "E", "S", "W"]) {
      if (this._canMove(sc, sr, f)) { this.facing = f; break; }
    }
    this.stateFingerprints = new Set();
    this.seekPhase = !this._isWallAdjacent(sc, sr);
  }

  _canMove(c, r, dir) {
    const { dc, dr } = DIR[dir];
    const nc = c + dc, nr = r + dr;
    if (nc < 0 || nc >= this.D_cols || nr < 0 || nr >= this.D_rows) return false;
    return isPassableCell(this.grid[nr * this.D_cols + nc]);
  }

  _isWallAdjacent(c, r) {
    return ["N", "E", "S", "W"].some(dir => !this._canMove(c, r, dir));
  }

  _move(dir, c, r) {
    this.facing = dir;
    const { dc, dr } = DIR[dir];
    const nc = c + dc, nr = r + dr;
    const nIdx = nr * this.D_cols + nc;
    this.trace.actorCell = [nc, nr];
    this.trace.movementHistory.push(nIdx);
    this.trace.visited.add(nIdx);
    this.trace.breadcrumb.set(nIdx, (this.trace.breadcrumb.get(nIdx) ?? 0) + 1);
    return nIdx;
  }

  _stepAlgorithm() {
    const [c, r] = this.trace.actorCell;
    if (this.seekPhase && this._isWallAdjacent(c, r)) this.seekPhase = false;
    if (this.seekPhase) this._seekStep(c, r);
    else                this._followStep(c, r);
  }

  _seekStep(c, r) {
    const dirs = [TURN_RIGHT[this.facing], this.facing, TURN_LEFT[this.facing], TURN_BACK[this.facing]];

    // Prefer unvisited passable neighbors, right-hand bias.
    let chosen = null;
    for (const dir of dirs) {
      if (!this._canMove(c, r, dir)) continue;
      const { dc, dr } = DIR[dir];
      if ((this.trace.breadcrumb.get((r + dr) * this.D_cols + (c + dc)) ?? 0) === 0) {
        chosen = dir; break;
      }
    }

    // Fallback: any passable direction (fully-explored open pocket).
    if (chosen === null) {
      for (const dir of dirs) {
        if (this._canMove(c, r, dir)) { chosen = dir; break; }
      }
    }

    if (chosen === null) { this.trace.phase = SolverPhase.TIMEOUT; return; }

    const nIdx = this._move(chosen, c, r);
    if (nIdx === this.goalIdx) {
      this.trace.path = this.trace.movementHistory.slice();
      this.trace.phase = SolverPhase.SOLVED;
    }
  }

  _followStep(c, r) {
    const dirs = [TURN_RIGHT[this.facing], this.facing, TURN_LEFT[this.facing], TURN_BACK[this.facing]];

    let chosen = null;
    for (const dir of dirs) {
      if (this._canMove(c, r, dir)) { chosen = dir; break; }
    }

    if (chosen === null) { this.trace.phase = SolverPhase.TIMEOUT; return; }

    const nIdx = this._move(chosen, c, r);

    // Cycle detection: same (position, facing) means a closed loop — terminate.
    const fp = `${this.trace.actorCell[0]},${this.trace.actorCell[1]},${this.facing}`;
    if (this.stateFingerprints.has(fp)) { this.trace.phase = SolverPhase.TIMEOUT; return; }
    this.stateFingerprints.add(fp);

    if (nIdx === this.goalIdx) {
      this.trace.path = this.trace.movementHistory.slice();
      this.trace.phase = SolverPhase.SOLVED;
    }
  }
}
