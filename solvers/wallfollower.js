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
    // v2: (position, facing) fingerprint Set for cycle detection.
    this.stateFingerprints = new Set();
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
    const dirs  = [right, this.facing, left, back];

    // v2: (position, facing) fingerprint cycle detection.
    const fp = `${c},${r},${this.facing}`;
    if (this.stateFingerprints.has(fp)) {
      this.trace.phase = SolverPhase.TIMEOUT;
      return;
    }
    this.stateFingerprints.add(fp);

    let chosen = null;

    // Primary: right-hand rule, treating visited cells as walls.
    for (const dir of dirs) {
      if (!this._canMove(c, r, dir)) continue;
      const { dc, dr } = DIR[dir];
      if ((this.trace.breadcrumb.get((r + dr) * this.D_cols + (c + dc)) ?? 0) === 0) {
        chosen = dir;
        break;
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

    if (nIdx === this.goalIdx) {
      this.trace.path = this.trace.movementHistory.slice();
      this.trace.phase = SolverPhase.SOLVED;
    }
  }
}
