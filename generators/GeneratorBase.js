/**
 * @abstract
 * Base class for all maze generators.
 * Subclasses must implement: begin(), step(), getGrid(), totalSteps()
 */
export class GeneratorBase {
  constructor() {
    if (new.target === GeneratorBase) throw new Error("GeneratorBase is abstract");
    if (typeof this.begin !== "function")      throw new Error(`${new.target.name}: must implement begin()`);
    if (typeof this.step !== "function")       throw new Error(`${new.target.name}: must implement step()`);
    if (typeof this.getGrid !== "function")    throw new Error(`${new.target.name}: must implement getGrid()`);
    if (typeof this.totalSteps !== "function") throw new Error(`${new.target.name}: must implement totalSteps()`);
  }

  /** @abstract begin(grid, D_cols, D_rows, rng) */
  begin()  { throw new Error("abstract"); }

  /** @abstract @returns {boolean} true when generation is complete */
  step()   { throw new Error("abstract"); }

  /** @abstract @returns {Uint8Array} */
  getGrid() { throw new Error("abstract"); }

  /** @abstract @returns {number} */
  totalSteps(D_cols, D_rows) { throw new Error("abstract"); }

  /**
   * Override to step once per N frames instead of using stepsPerFrame calculation.
   * @returns {number|null}
   */
  framesPerStep() { return null; }
}
