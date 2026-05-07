// Recursive backtracker. Spec §5.3.1.
import { CellType, roomCols, roomRows, roomToDisplay } from "../maze.js";
import { GeneratorBase } from "./GeneratorBase.js";

export class Backtracker extends GeneratorBase {
  constructor() {
    super();
    this.grid = null;
    this.D_cols = 0;
    this.D_rows = 0;
    this.rng = Math.random;
    this.rcols = 0;
    this.rrows = 0;
    this.visited = null;
    this.stack = [];
  }

  totalSteps(D_cols, D_rows) {
    return Math.max(1, roomCols(D_cols) * roomRows(D_rows));
  }

  begin(grid, D_cols, D_rows, rng) {
    this.grid = grid;
    this.D_cols = D_cols;
    this.D_rows = D_rows;
    this.rng = rng || Math.random;
    this.rcols = roomCols(D_cols);
    this.rrows = roomRows(D_rows);
    this.visited = new Uint8Array(this.rcols * this.rrows);

    const sx = (this.rng() * this.rcols) | 0;
    const sy = (this.rng() * this.rrows) | 0;
    this.visited[sy * this.rcols + sx] = 1;
    const [dx, dy] = roomToDisplay(sx, sy);
    grid[dy * D_cols + dx] = CellType.FLOOR;
    this.stack = [[sx, sy]];
  }

  step() {
    if (this.stack.length === 0) return true;
    const [cx, cy] = this.stack[this.stack.length - 1];
    const dirs = [[0,-1],[1,0],[0,1],[-1,0]];
    // Shuffle in-place
    for (let i = dirs.length - 1; i > 0; i--) {
      const j = (this.rng() * (i + 1)) | 0;
      const t = dirs[i]; dirs[i] = dirs[j]; dirs[j] = t;
    }
    let advanced = false;
    for (const [dx, dy] of dirs) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || nx >= this.rcols || ny < 0 || ny >= this.rrows) continue;
      const ri = ny * this.rcols + nx;
      if (this.visited[ri]) continue;
      // Carve passage cell between current and next room.
      const [ccx, ccy] = roomToDisplay(cx, cy);
      const passCol = ccx + dx;
      const passRow = ccy + dy;
      this.grid[passRow * this.D_cols + passCol] = CellType.FLOOR;
      const [ncx, ncy] = roomToDisplay(nx, ny);
      this.grid[ncy * this.D_cols + ncx] = CellType.FLOOR;
      this.visited[ri] = 1;
      this.stack.push([nx, ny]);
      advanced = true;
      break;
    }
    if (!advanced) this.stack.pop();
    if (this.stack.length === 0) {
      // v2 bug fix: repair outer border — backtracker can leave FLOOR on edges.
      const { D_cols, D_rows, grid } = this;
      for (let c = 0; c < D_cols; c++) {
        if (grid[c] === CellType.FLOOR) grid[c] = CellType.WALL;
        if (grid[(D_rows - 1) * D_cols + c] === CellType.FLOOR) grid[(D_rows - 1) * D_cols + c] = CellType.WALL;
      }
      for (let r = 1; r < D_rows - 1; r++) {
        if (grid[r * D_cols] === CellType.FLOOR) grid[r * D_cols] = CellType.WALL;
        if (grid[r * D_cols + (D_cols - 1)] === CellType.FLOOR) grid[r * D_cols + (D_cols - 1)] = CellType.WALL;
      }
      return true;
    }
    return false;
  }

  getGrid() { return this.grid; }
}
