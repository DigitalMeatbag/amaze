// Shared base for frontier-expanding solvers (BFS, A*, Greedy).
// Houses commit-to-path momentum, actor-to-frontier reconciliation,
// and exit-visibility finalization. Subclasses implement _initFrontier()
// and _expandOneFrontierCell().
import { SolverBase } from "./SolverBase.js";
import { SolverPhase } from "./SolverPhase.js";
import { advanceActorToward, exitVisible, computePath, reconstructPath } from "./pathfinding.js";

const COMMIT_MIN_STEPS = 25;

/**
 * @abstract
 * Subclasses must implement:
 *   _initFrontier()         — seed algorithm-specific data structures
 *   _expandOneFrontierCell() — dequeue/pop one cell; add neighbors; set
 *                              trace.phase = TIMEOUT if exhausted or call
 *                              this._finalizeFound(actorIdx) if goal found
 */
export class FrontierSolverBase extends SolverBase {
  constructor() {
    super();
    if (new.target === FrontierSolverBase) throw new Error("FrontierSolverBase is abstract");
    if (typeof this._initFrontier !== "function")
      throw new Error(`${new.target.name}: must implement _initFrontier()`);
    if (typeof this._expandOneFrontierCell !== "function")
      throw new Error(`${new.target.name}: must implement _expandOneFrontierCell()`);
  }

  _initAlgorithm() {
    const sc = this.startIdx % this.D_cols, sr = (this.startIdx / this.D_cols) | 0;
    this.trace.actorCell = [sc, sr];
    this.visited       = new Set([this.startIdx]);
    this.frontierTarget = this.startIdx;
    this.commitPath    = null;
    this.commitIdx     = 0;
    this.trace.visited.add(this.startIdx);
    this.trace.breadcrumb.set(this.startIdx, 1);
    this.trace.movementHistory.push(this.startIdx);
    this._initFrontier();
  }

  _tryCommit() {
    if (this.visited.size < 4) return false;
    const cells = Array.from(this.visited);
    const [ac, ar] = this.trace.actorCell;
    const aIdx = ar * this.D_cols + ac;
    let best = -1, bestDist = 0;
    for (let i = 0; i < Math.min(cells.length, 20); i++) {
      const idx = cells[(this.rng() * cells.length) | 0];
      const gc = idx % this.D_cols, gr = (idx / this.D_cols) | 0;
      const dist = Math.abs(ac - gc) + Math.abs(ar - gr);
      if (dist > bestDist) { bestDist = dist; best = idx; }
    }
    if (best < 0 || bestDist < 3) return false;
    const path = computePath(aIdx, best, this.visited, this.grid, this.D_cols, this.D_rows);
    if (path.length < 2) return false;
    const N = COMMIT_MIN_STEPS + Math.floor(this.rng() * bestDist);
    this.commitPath = path.slice(1, N + 1);
    this.commitIdx  = 0;
    return true;
  }

  _finalizeFound(fromIdx) {
    this.commitPath = null;
    this.trace.walkPath = computePath(fromIdx, this.goalIdx, this.visited, this.grid, this.D_cols, this.D_rows);
    this.trace.path = reconstructPath(this.parent, this.startIdx, fromIdx)
      .concat(this.trace.walkPath.slice(1));
    this.trace.phase = SolverPhase.SOLVED;
  }

  _stepAlgorithm() {
    // --- Commit-walk phase ---
    if (this.commitPath && this.commitIdx < this.commitPath.length) {
      const idx = this.commitPath[this.commitIdx++];
      const nc = idx % this.D_cols, nr = (idx / this.D_cols) | 0;
      this.trace.actorCell = [nc, nr];
      this.trace.movementHistory.push(idx);
      this.trace.visited.add(idx);
      this.trace.breadcrumb.set(idx, (this.trace.breadcrumb.get(idx) ?? 0) + 1);
      if (exitVisible(idx, this.goalIdx, this.grid, this.D_cols, this.D_rows, this.visited)) {
        this._finalizeFound(idx);
        return;
      }
      if (this.commitIdx >= this.commitPath.length) {
        this.trace.beatGlyph = "?";
        this.commitPath = null;
      }
      this._expandOneFrontierCell();
      return;
    }

    if (this.trace.beatGlyph === "?") this.trace.beatGlyph = null;

    const [ac, ar] = this.trace.actorCell;
    const aIdx = ar * this.D_cols + ac;

    // --- Actor-to-frontier reconciliation ---
    if (aIdx !== this.frontierTarget) {
      const reached = advanceActorToward(
        this.trace, this.frontierTarget, this.grid, this.D_cols, this.D_rows, this.visited
      );
      if (reached) {
        this._expandOneFrontierCell();
        return;
      }
    }

    // --- Main frontier expansion ---
    this._expandOneFrontierCell();
    if (this.trace.phase === SolverPhase.SEARCHING && this.rng() < 0.15) this._tryCommit();
  }
}
