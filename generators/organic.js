// Organic / Cellular Automata. Spec §5.3.4.
// Seeds N well-separated noisy blobs explicitly, then smooths with shrink-only
// CA (no birth rule = walls never erode, blobs never merge), then connects
// survivors with MST corridors.
import { CellType } from "../maze.js";
import { Prims } from "./prims.js";

const AREA_HARD_MIN   = 100;  // v2: grids smaller than this delegate to Prim's
const AREA_MIN_VIABLE = 400;  // v2: grids smaller than this use reduced CA params

export class Organic {
  constructor() {
    this.grid       = null;
    this.scratch    = null;
    this.D_cols     = 0;
    this.D_rows     = 0;
    this.rng        = Math.random;
    this.iter       = 0;
    this.iterations = 4;
  }

  _computeR(D_cols, D_rows) {
    return Math.max(4, Math.floor(Math.min(D_cols, D_rows) / 5));
  }

  // Fewer CA passes when R is small so tiny blobs don't shrink to nothing.
  _computeIter(D_cols, D_rows) {
    const R = this._computeR(D_cols, D_rows);
    return Math.max(2, Math.min(4, Math.floor(R / 3)));
  }

  totalSteps(D_cols, D_rows)  {
    return (D_cols && D_rows) ? this._computeIter(D_cols, D_rows) : 4;
  }
  framesPerStep() { return 16; }

  begin(grid, D_cols, D_rows, rng) {
    this.grid       = grid;
    this.D_cols     = D_cols;
    this.D_rows     = D_rows;
    this.rng        = rng || Math.random;
    this.scratch    = new Uint8Array(D_cols * D_rows);
    this.iter       = 0;

    const area = D_cols * D_rows;

    // v2: very small grids — delegate entirely to Prim's (spec §5.3.4).
    if (area < AREA_HARD_MIN) {
      this._delegate = new Prims();
      this._delegate.begin(grid, D_cols, D_rows, rng);
      this.iterations = 0;
      return;
    }

    // v2: small-but-viable grids — use reduced parameters.
    const small = area < AREA_MIN_VIABLE;
    this.iterations = small
      ? Math.max(1, Math.min(2, this._computeIter(D_cols, D_rows)))
      : this._computeIter(D_cols, D_rows);
    this._delegate = null;

    grid.fill(CellType.WALL);

    const R = small
      ? Math.max(3, Math.floor(this._computeR(D_cols, D_rows) * 0.65))
      : this._computeR(D_cols, D_rows);
    const N = Math.max(2, Math.min(small ? 4 : 6, Math.floor(area / 1200)));
    const minSep = R * 2 + 2;

    // Place N blob centers, enforcing minimum separation.
    const centers = [];
    for (let b = 0; b < N; b++) {
      let c, r, ok, attempts = 0;
      do {
        c = R + 2 + Math.floor(rng() * Math.max(1, D_cols - 2 * R - 4));
        r = R + 2 + Math.floor(rng() * Math.max(1, D_rows - 2 * R - 4));
        ok = centers.every(([ec, er]) => Math.hypot(c - ec, r - er) >= minSep);
      } while (!ok && ++attempts < 60);
      if (ok || centers.length === 0) centers.push([c, r]);
    }

    // Seed each blob with a noisy circle (per-cell random radius → organic edge).
    for (const [bc, br] of centers) {
      for (let dr = -R; dr <= R; dr++) {
        for (let dc = -R; dc <= R; dc++) {
          const nr = br + dr, nc = bc + dc;
          if (nc <= 0 || nc >= D_cols - 1 || nr <= 0 || nr >= D_rows - 1) continue;
          const dist = Math.sqrt(dc * dc + dr * dr);
          if (dist <= R * (0.55 + 0.45 * rng())) {
            grid[nr * D_cols + nc] = CellType.FLOOR;
          }
        }
      }
    }

    this._forceBorder(grid);
  }

  _forceBorder(g) {
    const { D_cols, D_rows } = this;
    for (let c = 0; c < D_cols; c++) {
      g[c] = CellType.WALL;
      g[(D_rows - 1) * D_cols + c] = CellType.WALL;
    }
    for (let r = 0; r < D_rows; r++) {
      g[r * D_cols] = CellType.WALL;
      g[r * D_cols + (D_cols - 1)] = CellType.WALL;
    }
  }

  _countWallNbrs(col, row) {
    let n = 0;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dc === 0 && dr === 0) continue;
        const nc = col + dc, nr = row + dr;
        if (nc < 0 || nc >= this.D_cols || nr < 0 || nr >= this.D_rows) { n++; continue; }
        if (this.grid[nr * this.D_cols + nc] === CellType.WALL) n++;
      }
    }
    return n;
  }

  _findRegions() {
    const { D_cols, D_rows, grid } = this;
    const D        = D_cols * D_rows;
    const assigned = new Int32Array(D).fill(-1);
    const regions  = [];
    const queue    = new Int32Array(D);

    for (let start = 0; start < D; start++) {
      if (assigned[start] >= 0 || grid[start] !== CellType.FLOOR) continue;
      const rid   = regions.length;
      const cells = [];
      let head = 0, tail = 0;
      queue[tail++]   = start;
      assigned[start] = rid;
      while (head < tail) {
        const idx = queue[head++];
        cells.push(idx);
        const c = idx % D_cols, r = (idx / D_cols) | 0;
        for (const [nc, nr] of [[c,r-1],[c,r+1],[c-1,r],[c+1,r]]) {
          if (nc < 0 || nc >= D_cols || nr < 0 || nr >= D_rows) continue;
          const ni = nr * D_cols + nc;
          if (assigned[ni] >= 0 || grid[ni] !== CellType.FLOOR) continue;
          assigned[ni] = rid;
          queue[tail++] = ni;
        }
      }
      regions.push(cells);
    }
    return regions;
  }

  _carve(c1, r1, c2, r2) {
    const { D_cols, D_rows, grid } = this;
    const set = (c, r) => {
      if (c > 0 && c < D_cols - 1 && r > 0 && r < D_rows - 1)
        grid[r * D_cols + c] = CellType.FLOOR;
    };
    const horiz = (c, r, tc) => { while (c !== tc) { set(c, r); c += c < tc ? 1 : -1; } set(c, r); };
    const vert  = (c, r, tr) => { while (r !== tr) { set(c, r); r += r < tr ? 1 : -1; } set(c, r); };
    if (this.rng() < 0.5) { horiz(c1, r1, c2); vert(c2, r1, r2); }
    else                  { vert(c1, r1, r2);  horiz(c1, r2, c2); }
  }

  _connectBlobs() {
    const { D_cols, grid } = this;

    const regions = this._findRegions();
    // Keep any region with at least 3 cells; kill true orphan singletons only.
    const alive = regions.filter(cells => {
      if (cells.length >= 3) return true;
      for (const idx of cells) grid[idx] = CellType.WALL;
      return false;
    });

    if (alive.length <= 1) return;

    const centroids = alive.map(cells => {
      let sc = 0, sr = 0;
      for (const idx of cells) { sc += idx % D_cols; sr += (idx / D_cols) | 0; }
      return [Math.round(sc / cells.length), Math.round(sr / cells.length)];
    });

    const parent = alive.map((_, i) => i);
    const find   = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    const union  = (a, b) => { parent[find(a)] = find(b); };

    const edges = [];
    for (let i = 0; i < alive.length; i++)
      for (let j = i + 1; j < alive.length; j++) {
        const dx = centroids[i][0] - centroids[j][0];
        const dy = centroids[i][1] - centroids[j][1];
        edges.push([Math.abs(dx) + Math.abs(dy), i, j]);
      }
    edges.sort((a, b) => a[0] - b[0]);

    for (const [, i, j] of edges) {
      if (find(i) === find(j)) continue;
      union(i, j);
      this._carve(...centroids[i], ...centroids[j]);
    }
  }

  step() {
    // v2: delegate to Prim's for very small grids.
    if (this._delegate) return this._delegate.step();

    const { D_cols, D_rows } = this;
    // Shrink-only: walls never become floor, so blobs never merge.
    for (let r = 0; r < D_rows; r++) {
      for (let c = 0; c < D_cols; c++) {
        const i  = r * D_cols + c;
        const wn = this._countWallNbrs(c, r);
        this.scratch[i] = (this.grid[i] === CellType.WALL || wn >= 5)
          ? CellType.WALL : CellType.FLOOR;
      }
    }
    this._forceBorder(this.scratch);
    this.grid.set(this.scratch);

    this.iter++;
    if (this.iter >= this.iterations) {
      this._connectBlobs();
      return true;
    }
    return false;
  }

  getGrid() { return this._delegate ? this._delegate.getGrid() : this.grid; }
}
