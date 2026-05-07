/**
 * @abstract
 * Abstract base for all maze solvers.
 * Subclasses must implement: get key(), _initAlgorithm(), _stepAlgorithm()
 */
export class SolverBase {
  constructor() {
    if (new.target === SolverBase) throw new Error("SolverBase is abstract");
    if (typeof this.key !== "string")              throw new Error(`${new.target.name}: must implement get key()`);
    if (typeof this._initAlgorithm !== "function") throw new Error(`${new.target.name}: must implement _initAlgorithm()`);
    if (typeof this._stepAlgorithm !== "function") throw new Error(`${new.target.name}: must implement _stepAlgorithm()`);
  }

  /** @abstract @returns {string} */
  get key() { throw new Error("abstract"); }

  begin(grid, D_cols, D_rows, trace, rng, startIdx, goalIdx) {
    this.grid     = grid;
    this.D_cols   = D_cols;
    this.D_rows   = D_rows;
    this.trace    = trace;
    this.rng      = rng || Math.random;
    this.startIdx = startIdx;
    this.goalIdx  = goalIdx;
    this._initAlgorithm();
  }

  step() { this._stepAlgorithm(); }

  /** @abstract */
  _initAlgorithm() { throw new Error("abstract"); }

  /** @abstract */
  _stepAlgorithm()  { throw new Error("abstract"); }
}
