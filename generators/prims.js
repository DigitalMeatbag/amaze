// Randomized Prim's. Spec §5.3.2.
import { CellType, roomCols, roomRows, roomToDisplay } from "../maze.js";

export class Prims {
  constructor() {
    this.grid = null;
    this.D_cols = 0;
    this.D_rows = 0;
    this.rng = Math.random;
    this.rcols = 0;
    this.rrows = 0;
    this.visited = null;
    this.frontier = [];
    this.frontierSet = null;
  }

  totalSteps(D_cols, D_rows) {
    return Math.max(1, roomCols(D_cols) * roomRows(D_rows));
  }

  _pushFrontier(rx, ry) {
    if (rx < 0 || rx >= this.rcols || ry < 0 || ry >= this.rrows) return;
    const ri = ry * this.rcols + rx;
    if (this.visited[ri]) return;
    if (this.frontierSet[ri]) return;
    this.frontierSet[ri] = 1;
    this.frontier.push([rx, ry]);
  }

  begin(grid, D_cols, D_rows, rng) {
    this.grid = grid;
    this.D_cols = D_cols;
    this.D_rows = D_rows;
    this.rng = rng || Math.random;
    this.rcols = roomCols(D_cols);
    this.rrows = roomRows(D_rows);
    this.visited = new Uint8Array(this.rcols * this.rrows);
    this.frontierSet = new Uint8Array(this.rcols * this.rrows);
    this.frontier = [];

    const sx = (this.rng() * this.rcols) | 0;
    const sy = (this.rng() * this.rrows) | 0;
    this.visited[sy * this.rcols + sx] = 1;
    const [dx, dy] = roomToDisplay(sx, sy);
    grid[dy * D_cols + dx] = CellType.FLOOR;
    this._pushFrontier(sx - 1, sy);
    this._pushFrontier(sx + 1, sy);
    this._pushFrontier(sx, sy - 1);
    this._pushFrontier(sx, sy + 1);
  }

  step() {
    if (this.frontier.length === 0) return true;
    const fi = (this.rng() * this.frontier.length) | 0;
    const [cx, cy] = this.frontier.splice(fi, 1)[0];
    const ci = cy * this.rcols + cx;
    this.frontierSet[ci] = 0;
    if (this.visited[ci]) return this.frontier.length === 0;

    // Pick a random visited neighbor to connect through.
    const visitedNbrs = [];
    const nbrs = [[0,-1],[1,0],[0,1],[-1,0]];
    for (const [dx, dy] of nbrs) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || nx >= this.rcols || ny < 0 || ny >= this.rrows) continue;
      if (this.visited[ny * this.rcols + nx]) visitedNbrs.push([nx, ny, dx, dy]);
    }
    if (visitedNbrs.length === 0) return this.frontier.length === 0;
    const [nx, ny, dx, dy] = visitedNbrs[(this.rng() * visitedNbrs.length) | 0];
    // Carve from neighbor (nx,ny) to candidate (cx,cy): passage is between them.
    const [ncx, ncy] = roomToDisplay(nx, ny);
    const passCol = ncx + (cx - nx);
    const passRow = ncy + (cy - ny);
    this.grid[passRow * this.D_cols + passCol] = CellType.FLOOR;
    const [ccx, ccy] = roomToDisplay(cx, cy);
    this.grid[ccy * this.D_cols + ccx] = CellType.FLOOR;

    this.visited[ci] = 1;
    // Add unvisited neighbors of candidate to frontier.
    this._pushFrontier(cx - 1, cy);
    this._pushFrontier(cx + 1, cy);
    this._pushFrontier(cx, cy - 1);
    this._pushFrontier(cx, cy + 1);
    return this.frontier.length === 0;
  }

  getGrid() { return this.grid; }
}
