// Room-and-Corridor. Spec §5.3.5.
import { CellType, roomCols, roomRows } from "../maze.js";
import { GeneratorBase } from "./GeneratorBase.js";

const PHASE_ROOMS = 0;
const PHASE_CORRIDORS = 1;

export class RoomCorridor extends GeneratorBase {
  constructor() {
    super();
    this.grid = null;
    this.D_cols = 0;
    this.D_rows = 0;
    this.rng = Math.random;
    this.rooms = [];        // [{x,y,w,h,cx,cy}]
    this.corridors = [];    // [{from, to}] room index pairs
    this.phase = PHASE_ROOMS;
    this.roomIndex = 0;
    this.corridorIndex = 0;
  }

  totalSteps(D_cols, D_rows) {
    return Math.max(2, Math.floor((roomCols(D_cols) * roomRows(D_rows)) / 8) + 6);
  }

  begin(grid, D_cols, D_rows, rng) {
    this.grid = grid;
    this.D_cols = D_cols;
    this.D_rows = D_rows;
    this.rng = rng || Math.random;
    grid.fill(CellType.WALL);

    const target = Math.max(4, Math.floor((roomCols(D_cols) * roomRows(D_rows)) / 8));
    this.rooms = [];
    let attempts = 0;
    while (this.rooms.length < target && attempts < 200) {
      attempts++;
      const wOpts = [3, 5, 7, 9];
      const hOpts = [3, 5, 7];
      const w = wOpts[(this.rng() * wOpts.length) | 0];
      const h = hOpts[(this.rng() * hOpts.length) | 0];
      if (w + 2 >= D_cols || h + 2 >= D_rows) continue;
      const x = 1 + ((this.rng() * (D_cols - w - 2)) | 0);
      const y = 1 + ((this.rng() * (D_rows - h - 2)) | 0);
      let overlaps = false;
      for (const rm of this.rooms) {
        if (x <= rm.x + rm.w && x + w >= rm.x && y <= rm.y + rm.h && y + h >= rm.y) {
          overlaps = true; break;
        }
      }
      if (overlaps) continue;
      this.rooms.push({
        x, y, w, h,
        cx: x + ((w / 2) | 0),
        cy: y + ((h / 2) | 0),
      });
    }
    this.phase = PHASE_ROOMS;
    this.roomIndex = 0;
    this.corridorIndex = 0;
    this.corridors = [];
  }

  _stampRoom(rm) {
    for (let r = rm.y; r < rm.y + rm.h; r++) {
      for (let c = rm.x; c < rm.x + rm.w; c++) {
        this.grid[r * this.D_cols + c] = CellType.FLOOR;
      }
    }
  }

  _carveCorridor(from, to) {
    // Random L-shape: horizontal then vertical, or vertical then horizontal.
    const horizFirst = this.rng() < 0.5;
    let cx = from.cx, cy = from.cy;
    if (horizFirst) {
      const stepC = to.cx > cx ? 1 : -1;
      while (cx !== to.cx) {
        this.grid[cy * this.D_cols + cx] = CellType.FLOOR;
        cx += stepC;
      }
      const stepR = to.cy > cy ? 1 : -1;
      while (cy !== to.cy) {
        this.grid[cy * this.D_cols + cx] = CellType.FLOOR;
        cy += stepR;
      }
    } else {
      const stepR = to.cy > cy ? 1 : -1;
      while (cy !== to.cy) {
        this.grid[cy * this.D_cols + cx] = CellType.FLOOR;
        cy += stepR;
      }
      const stepC = to.cx > cx ? 1 : -1;
      while (cx !== to.cx) {
        this.grid[cy * this.D_cols + cx] = CellType.FLOOR;
        cx += stepC;
      }
    }
    this.grid[cy * this.D_cols + cx] = CellType.FLOOR;
  }

  _buildCorridorList() {
    // Connect each room to the nearest unconnected room (greedy spanning).
    if (this.rooms.length < 2) return;
    const connected = new Uint8Array(this.rooms.length);
    connected[0] = 1;
    while (true) {
      let bestFrom = -1, bestTo = -1, bestD = Infinity;
      for (let i = 0; i < this.rooms.length; i++) {
        if (!connected[i]) continue;
        for (let j = 0; j < this.rooms.length; j++) {
          if (connected[j]) continue;
          const a = this.rooms[i], b = this.rooms[j];
          const d = Math.abs(a.cx - b.cx) + Math.abs(a.cy - b.cy);
          if (d < bestD) { bestD = d; bestFrom = i; bestTo = j; }
        }
      }
      if (bestFrom === -1) break;
      this.corridors.push({ from: bestFrom, to: bestTo });
      connected[bestTo] = 1;
    }
  }

  step() {
    if (this.phase === PHASE_ROOMS) {
      if (this.roomIndex < this.rooms.length) {
        this._stampRoom(this.rooms[this.roomIndex]);
        this.roomIndex++;
        if (this.roomIndex >= this.rooms.length) {
          this.phase = PHASE_CORRIDORS;
          this._buildCorridorList();
        }
        return false;
      }
      this.phase = PHASE_CORRIDORS;
      this._buildCorridorList();
    }
    if (this.phase === PHASE_CORRIDORS) {
      if (this.corridorIndex < this.corridors.length) {
        const corr = this.corridors[this.corridorIndex];
        this._carveCorridor(this.rooms[corr.from], this.rooms[corr.to]);
        this.corridorIndex++;
        return this.corridorIndex >= this.corridors.length;
      }
      return true;
    }
    return true;
  }

  getGrid() { return this.grid; }
}
