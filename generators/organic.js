// Organic / Cellular Automata. Spec §5.3.4.
// One step() call = one CA iteration. Total 15 iterations.
// The render loop should hold each iteration for ~16 frames; that pacing is
// handled by main.js using a custom fixed-rate override for this generator.
import { CellType } from "../maze.js";

const ITERATIONS = 15;
const SEED_PROB = 0.45;

export class Organic {
  constructor() {
    this.grid = null;
    this.scratch = null;
    this.D_cols = 0;
    this.D_rows = 0;
    this.rng = Math.random;
    this.iter = 0;
  }

  totalSteps() { return ITERATIONS; }

  // Custom pacing flag honored by main.js: hold each iteration for `framesPerStep` frames.
  framesPerStep() { return 16; }

  begin(grid, D_cols, D_rows, rng) {
    this.grid = grid;
    this.D_cols = D_cols;
    this.D_rows = D_rows;
    this.rng = rng || Math.random;
    this.scratch = new Uint8Array(D_cols * D_rows);
    this.iter = 0;
    for (let i = 0; i < grid.length; i++) {
      grid[i] = this.rng() < SEED_PROB ? CellType.FLOOR : CellType.WALL;
    }
    // Force border walls.
    for (let c = 0; c < D_cols; c++) {
      grid[c] = CellType.WALL;
      grid[(D_rows - 1) * D_cols + c] = CellType.WALL;
    }
    for (let r = 0; r < D_rows; r++) {
      grid[r * D_cols] = CellType.WALL;
      grid[r * D_cols + (D_cols - 1)] = CellType.WALL;
    }
  }

  _countWallNbrs(col, row) {
    let n = 0;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dc === 0 && dr === 0) continue;
        const nc = col + dc, nr = row + dr;
        if (nc < 0 || nc >= this.D_cols || nr < 0 || nr >= this.D_rows) {
          n++; // out-of-bounds counts as wall
          continue;
        }
        if (this.grid[nr * this.D_cols + nc] === CellType.WALL) n++;
      }
    }
    return n;
  }

  _floodFillConnectivity() {
    const D = this.D_cols * this.D_rows;
    const seen = new Uint8Array(D);
    let bestStart = -1;
    let bestSize = 0;
    let bestSeen = null;
    const queue = new Int32Array(D);

    for (let i = 0; i < D; i++) {
      if (seen[i] || this.grid[i] === CellType.WALL) continue;
      // BFS from i.
      let head = 0, tail = 0;
      queue[tail++] = i;
      seen[i] = 1;
      const visited = [];
      while (head < tail) {
        const idx = queue[head++];
        visited.push(idx);
        const c = idx % this.D_cols;
        const r = (idx / this.D_cols) | 0;
        const nbrs = [
          [c, r - 1], [c, r + 1], [c - 1, r], [c + 1, r],
        ];
        for (const [nc, nr] of nbrs) {
          if (nc < 0 || nc >= this.D_cols || nr < 0 || nr >= this.D_rows) continue;
          const ni = nr * this.D_cols + nc;
          if (seen[ni]) continue;
          if (this.grid[ni] === CellType.WALL) continue;
          seen[ni] = 1;
          queue[tail++] = ni;
        }
      }
      if (visited.length > bestSize) {
        bestSize = visited.length;
        bestStart = i;
        bestSeen = visited;
      }
    }
    if (bestSeen === null) return;
    // Fill non-best floor cells with WALL.
    const keep = new Uint8Array(D);
    for (const idx of bestSeen) keep[idx] = 1;
    for (let i = 0; i < D; i++) {
      if (this.grid[i] === CellType.FLOOR && !keep[i]) {
        this.grid[i] = CellType.WALL;
      }
    }
  }

  step() {
    // One CA iteration over the entire grid into scratch, then swap.
    for (let r = 0; r < this.D_rows; r++) {
      for (let c = 0; c < this.D_cols; c++) {
        const i = r * this.D_cols + c;
        const wn = this._countWallNbrs(c, r);
        if (this.grid[i] === CellType.WALL) {
          this.scratch[i] = wn >= 4 ? CellType.WALL : CellType.FLOOR;
        } else {
          this.scratch[i] = wn >= 5 ? CellType.WALL : CellType.FLOOR;
        }
      }
    }
    // Force border walls every iteration.
    for (let c = 0; c < this.D_cols; c++) {
      this.scratch[c] = CellType.WALL;
      this.scratch[(this.D_rows - 1) * this.D_cols + c] = CellType.WALL;
    }
    for (let r = 0; r < this.D_rows; r++) {
      this.scratch[r * this.D_cols] = CellType.WALL;
      this.scratch[r * this.D_cols + (this.D_cols - 1)] = CellType.WALL;
    }
    // Copy scratch back into grid (caller holds the original grid reference).
    this.grid.set(this.scratch);

    this.iter++;
    if (this.iter >= ITERATIONS) {
      this._floodFillConnectivity();
      return true;
    }
    return false;
  }

  getGrid() { return this.grid; }
}
