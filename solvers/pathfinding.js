import { CellType, isPassableCell, DIRS4 } from "../maze.js";

export const ATTENTION_RADIUS = 6;

export function advanceActorToward(trace, targetIdx, grid, D_cols, D_rows, discovered) {
  const [ac, ar] = trace.actorCell;
  const aIdx = ar * D_cols + ac;
  if (aIdx === targetIdx) return true;

  const parent = new Map();
  parent.set(aIdx, -1);
  const queue = [aIdx];
  let head = 0;
  let found = false;
  while (head < queue.length) {
    const cur = queue[head++];
    if (cur === targetIdx) { found = true; break; }
    const cc = cur % D_cols;
    const cr = (cur / D_cols) | 0;
    for (const dir of DIRS4) {
      const nc = cc + dir.dc, nr = cr + dir.dr;
      if (nc < 0 || nc >= D_cols || nr < 0 || nr >= D_rows) continue;
      const ni = nr * D_cols + nc;
      if (parent.has(ni)) continue;
      if (!isPassableCell(grid[ni])) continue;
      if (ni !== targetIdx && !discovered.has(ni)) continue;
      parent.set(ni, cur);
      queue.push(ni);
    }
  }
  if (!found) return false;

  let cur = targetIdx;
  let prev = parent.get(cur);
  while (prev !== -1 && prev !== aIdx) {
    cur = prev;
    prev = parent.get(cur);
  }
  const nc = cur % D_cols;
  const nr = (cur / D_cols) | 0;
  trace.actorCell = [nc, nr];
  trace.movementHistory.push(cur);
  trace.visited.add(cur);
  trace.breadcrumb.set(cur, (trace.breadcrumb.get(cur) ?? 0) + 1);
  return cur === targetIdx;
}

export function reconstructPath(parent, startIdx, goalIdx) {
  const path = [];
  let cur = goalIdx;
  let guard = 0;
  while (cur !== startIdx && cur !== undefined && guard++ < 1_000_000) {
    path.push(cur);
    cur = parent.get(cur);
    if (cur === undefined) return [];
  }
  path.push(startIdx);
  path.reverse();
  return path;
}

export function neighborsOf(idx_, grid, D_cols, D_rows) {
  const c = idx_ % D_cols;
  const r = (idx_ / D_cols) | 0;
  const out = [];
  for (const dir of DIRS4) {
    const nc = c + dir.dc, nr = r + dir.dr;
    if (nc < 0 || nc >= D_cols || nr < 0 || nr >= D_rows) continue;
    const ni = nr * D_cols + nc;
    if (isPassableCell(grid[ni])) out.push(ni);
  }
  return out;
}

export function hasLOS(c1, r1, c2, r2, grid, D_cols, D_rows) {
  let x = c1, y = r1;
  const dx = Math.abs(c2 - c1), dy = Math.abs(r2 - r1);
  const sx = c1 < c2 ? 1 : -1, sy = r1 < r2 ? 1 : -1;
  let err = dx - dy;
  while (true) {
    if (x === c2 && y === r2) return true;
    if (grid[y * D_cols + x] === CellType.WALL) return false;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx)  { err += dx; y += sy; }
  }
}

export function canReach(fromIdx, toIdx, discovered, grid, D_cols, D_rows, maxSteps = 200) {
  if (fromIdx === toIdx) return true;
  const queue = [fromIdx];
  const seen = new Set([fromIdx]);
  let head = 0, steps = 0;
  while (head < queue.length && steps < maxSteps) {
    const cur = queue[head++];
    steps++;
    const cc = cur % D_cols, cr = (cur / D_cols) | 0;
    for (const dir of DIRS4) {
      const nc = cc + dir.dc, nr = cr + dir.dr;
      if (nc < 0 || nc >= D_cols || nr < 0 || nr >= D_rows) continue;
      const ni = nr * D_cols + nc;
      if (seen.has(ni)) continue;
      if (!isPassableCell(grid[ni])) continue;
      if (ni !== toIdx && !discovered.has(ni)) continue;
      if (ni === toIdx) return true;
      seen.add(ni);
      queue.push(ni);
    }
  }
  return false;
}

export function exitVisible(actorIdx, goalIdx, grid, D_cols, D_rows, discovered) {
  const ac = actorIdx % D_cols, ar = (actorIdx / D_cols) | 0;
  const gc = goalIdx % D_cols, gr = (goalIdx / D_cols) | 0;
  if (Math.max(Math.abs(ac - gc), Math.abs(ar - gr)) > ATTENTION_RADIUS) return false;
  if (!hasLOS(ac, ar, gc, gr, grid, D_cols, D_rows)) return false;
  return canReach(actorIdx, goalIdx, discovered, grid, D_cols, D_rows, 100);
}

export function computePath(fromIdx, toIdx, discovered, grid, D_cols, D_rows) {
  if (fromIdx === toIdx) return [fromIdx];
  const parent = new Map([[fromIdx, -1]]);
  const queue = [fromIdx];
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    const cc = cur % D_cols, cr = (cur / D_cols) | 0;
    for (const dir of DIRS4) {
      const nc = cc + dir.dc, nr = cr + dir.dr;
      if (nc < 0 || nc >= D_cols || nr < 0 || nr >= D_rows) continue;
      const ni = nr * D_cols + nc;
      if (parent.has(ni)) continue;
      if (!isPassableCell(grid[ni])) continue;
      if (ni !== toIdx && !discovered.has(ni)) continue;
      parent.set(ni, cur);
      if (ni === toIdx) {
        const path = [];
        let c = ni;
        while (c !== -1) { path.push(c); c = parent.get(c); }
        path.reverse();
        return path;
      }
      queue.push(ni);
    }
  }
  return [];
}
