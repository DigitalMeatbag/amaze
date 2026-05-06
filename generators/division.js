// Recursive Division. Spec §5.3.3.
import { CellType } from "../maze.js";

const HORIZONTAL = 0;
const VERTICAL = 1;

export class Division {
  constructor() {
    this.grid = null;
    this.D_cols = 0;
    this.D_rows = 0;
    this.rng = Math.random;
    this.queue = [];
  }

  totalSteps(D_cols, D_rows) {
    return Math.max(1, Math.floor((D_cols * D_rows) / 4));
  }

  begin(grid, D_cols, D_rows, rng) {
    this.grid = grid;
    this.D_cols = D_cols;
    this.D_rows = D_rows;
    this.rng = rng || Math.random;
    grid.fill(CellType.FLOOR);
    // Outer border walls: keep them as walls so the maze has a frame.
    for (let c = 0; c < D_cols; c++) {
      grid[c] = CellType.WALL;
      grid[(D_rows - 1) * D_cols + c] = CellType.WALL;
    }
    for (let r = 0; r < D_rows; r++) {
      grid[r * D_cols] = CellType.WALL;
      grid[r * D_cols + (D_cols - 1)] = CellType.WALL;
    }
    // Recurse over the interior.
    this.queue = [[1, 1, D_cols - 2, D_rows - 2]];
  }

  _randEvenIn(lo, hi) {
    // returns even integer in [lo, hi]
    if (lo % 2 !== 0) lo += 1;
    if (hi % 2 !== 0) hi -= 1;
    if (hi < lo) return lo;
    const span = ((hi - lo) / 2) | 0;
    return lo + 2 * ((this.rng() * (span + 1)) | 0);
  }

  _randOddIn(lo, hi) {
    if (lo % 2 === 0) lo += 1;
    if (hi % 2 === 0) hi -= 1;
    if (hi < lo) return lo;
    const span = ((hi - lo) / 2) | 0;
    return lo + 2 * ((this.rng() * (span + 1)) | 0);
  }

  step() {
    if (this.queue.length === 0) return true;
    const [x, y, w, h] = this.queue.shift();
    if (w <= 2 || h <= 2) return this.queue.length === 0;
    let orient;
    if (h > w) orient = HORIZONTAL;
    else if (w > h) orient = VERTICAL;
    else orient = this.rng() < 0.5 ? HORIZONTAL : VERTICAL;

    if (orient === HORIZONTAL) {
      // wall_row at even offset from interior origin (y is odd typically, so even offset within means y + even).
      const wallRow = this._randEvenIn(y + 1, y + h - 2);
      const gapCol = this._randOddIn(x, x + w - 1);
      for (let c = x; c < x + w; c++) {
        if (c === gapCol) continue;
        this.grid[wallRow * this.D_cols + c] = CellType.WALL;
      }
      this.queue.push([x, y, w, wallRow - y]);
      this.queue.push([x, wallRow + 1, w, y + h - wallRow - 1]);
    } else {
      const wallCol = this._randEvenIn(x + 1, x + w - 2);
      const gapRow = this._randOddIn(y, y + h - 1);
      for (let r = y; r < y + h; r++) {
        if (r === gapRow) continue;
        this.grid[r * this.D_cols + wallCol] = CellType.WALL;
      }
      this.queue.push([x, y, wallCol - x, h]);
      this.queue.push([wallCol + 1, y, x + w - wallCol - 1, h]);
    }
    return this.queue.length === 0;
  }

  getGrid() { return this.grid; }
}
