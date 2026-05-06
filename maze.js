// Maze cell model, grid storage, passability, coordinate helpers.

export const CellType = Object.freeze({
  WALL: 0,
  FLOOR: 1,
  START: 2,
  GOAL: 3,
});

export function isPassableCell(type) {
  return type === CellType.FLOOR || type === CellType.START || type === CellType.GOAL;
}

export function makeGrid(D_cols, D_rows, fill = CellType.WALL) {
  const g = new Uint8Array(D_cols * D_rows);
  if (fill !== 0) g.fill(fill);
  return g;
}

export function idx(col, row, D_cols) {
  return row * D_cols + col;
}

export function colOf(i, D_cols) { return i % D_cols; }
export function rowOf(i, D_cols) { return (i / D_cols) | 0; }

export function cellAt(grid, col, row, D_cols) {
  return grid[row * D_cols + col];
}

export function setCell(grid, col, row, D_cols, value) {
  grid[row * D_cols + col] = value;
}

export function inBounds(col, row, D_cols, D_rows) {
  return col >= 0 && col < D_cols && row >= 0 && row < D_rows;
}

// 4-directional neighbor offsets: N, E, S, W
export const DIRS4 = [
  { dc: 0, dr: -1, name: "N" },
  { dc: 1, dr: 0, name: "E" },
  { dc: 0, dr: 1, name: "S" },
  { dc: -1, dr: 0, name: "W" },
];

export function manhattan(c1, r1, c2, r2) {
  return Math.abs(c1 - c2) + Math.abs(r1 - r2);
}

export function chebyshev(c1, r1, c2, r2) {
  return Math.max(Math.abs(c1 - c2), Math.abs(r1 - r2));
}

// Logical room grid mapping (see spec §4.4).
export function roomCols(D_cols) { return Math.max(1, Math.floor((D_cols - 1) / 2)); }
export function roomRows(D_rows) { return Math.max(1, Math.floor((D_rows - 1) / 2)); }
export function roomToDisplay(rx, ry) { return [2 * rx + 1, 2 * ry + 1]; }

// BFS distance map over passable cells from a source. Returns Int32Array of distances; -1 = unreachable.
export function bfsDistances(grid, D_cols, D_rows, srcIdx) {
  const dist = new Int32Array(D_cols * D_rows).fill(-1);
  dist[srcIdx] = 0;
  const queue = [srcIdx];
  let head = 0;
  while (head < queue.length) {
    const i = queue[head++];
    const c = i % D_cols;
    const r = (i / D_cols) | 0;
    const d = dist[i];
    for (const dir of DIRS4) {
      const nc = c + dir.dc, nr = r + dir.dr;
      if (nc < 0 || nc >= D_cols || nr < 0 || nr >= D_rows) continue;
      const ni = nr * D_cols + nc;
      if (dist[ni] !== -1) continue;
      if (!isPassableCell(grid[ni])) continue;
      dist[ni] = d + 1;
      queue.push(ni);
    }
  }
  return dist;
}

// Pick a start/goal pair preferring distant endpoints (spec §5.5).
export function placeStartGoal(grid, D_cols, D_rows, rng = Math.random) {
  const floorCells = [];
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] === CellType.FLOOR) floorCells.push(i);
  }
  if (floorCells.length < 2) return null;

  const startIdx = floorCells[(rng() * floorCells.length) | 0];
  const dist = bfsDistances(grid, D_cols, D_rows, startIdx);

  // Collect reachable floor cells (excluding start) and pick goal from upper quartile.
  const reachable = [];
  let maxD = 0;
  for (const fi of floorCells) {
    if (fi === startIdx) continue;
    if (dist[fi] === -1) continue;
    reachable.push({ i: fi, d: dist[fi] });
    if (dist[fi] > maxD) maxD = dist[fi];
  }
  if (reachable.length === 0) return null;

  reachable.sort((a, b) => a.d - b.d);
  const p75 = reachable[Math.floor(reachable.length * 0.75)].d;
  const candidates = reachable.filter((c) => c.d >= p75);
  let goalIdx;
  if (candidates.length === 0) {
    goalIdx = reachable[reachable.length - 1].i;
  } else {
    goalIdx = candidates[(rng() * candidates.length) | 0].i;
  }

  grid[startIdx] = CellType.START;
  grid[goalIdx] = CellType.GOAL;
  return { startIdx, goalIdx };
}
