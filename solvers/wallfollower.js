// Right-hand Wall Follower. Spec §6.3.5.
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
    this.maxSteps = this.D_cols * this.D_rows * 8;
    this.steps = 0;
  }

  _canMove(c, r, dir) {
    const d = DIR[dir];
    const nc = c + d.dc, nr = r + d.dr;
    if (nc < 0 || nc >= this.D_cols || nr < 0 || nr >= this.D_rows) return false;
    return isPassableCell(this.grid[nr * this.D_cols + nc]);
  }

  _stepAlgorithm() {
    const [c, r] = this.trace.actorCell;
    const right = TURN_RIGHT[this.facing];
    const left  = TURN_LEFT[this.facing];
    const back  = TURN_BACK[this.facing];
    const dirs  = [right, this.facing, left, back];

    if (++this.steps > this.maxSteps) {
      this.trace.phase = SolverPhase.TIMEOUT;
      return;
    }

    let chosen = null;

    for (const dir of dirs) {
      if (!this._canMove(c, r, dir)) continue;
      const { dc, dr } = DIR[dir];
      if ((this.trace.breadcrumb.get((r + dr) * this.D_cols + (c + dc)) ?? 0) === 0) {
        chosen = dir;
        break;
      }
    }

    if (chosen === null) {
      const gc = this.goalIdx % this.D_cols;
      const gr = (this.goalIdx / this.D_cols) | 0;
      const distScale = this.D_cols + this.D_rows;
      let bestScore = Infinity;
      for (const dir of dirs) {
        if (!this._canMove(c, r, dir)) continue;
        const { dc, dr } = DIR[dir];
        const nIdx = (r + dr) * this.D_cols + (c + dc);
        const visits = this.trace.breadcrumb.get(nIdx) ?? 0;
        const dist = Math.abs(c + dc - gc) + Math.abs(r + dr - gr);
        const score = visits * distScale + dist;
        if (score < bestScore) { bestScore = score; chosen = dir; }
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

    if (nIdx === this.goalIdx) {
      this.trace.path = this.trace.movementHistory.slice();
      this.trace.phase = SolverPhase.SOLVED;
    }
  }
}
