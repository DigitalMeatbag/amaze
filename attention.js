// Attention field: per-cell brightness multiplier centered on actor + optional cursor.
// Spec §7. v2: added cursor light source with max-blend.
// v2.1: dual-layer lighting — ambient (wall-penetrating, ~2/3 intensity) + LoS (full intensity, blocked by walls).

const INTENSITY_PARAMS = {
  low:    { ambient: 0.50, range: 0.34, losRange: 0.50 },
  medium: { ambient: 0.25, range: 0.50, losRange: 0.75 },
  high:   { ambient: 0.15, range: 0.57, losRange: 0.85 },
};

let buffer = null;
let bufCols = 0;
let bufRows = 0;
let lastActorCol = -999;
let lastActorRow = -999;
let lastCursorCol = -999;
let lastCursorRow = -999;
let lastCursorAlpha = -1;
let lastIntensity = "";
let lastFloor = -1;
let dirty = true;

export function ensureBuffer(D_cols, D_rows) {
  if (!buffer || bufCols !== D_cols || bufRows !== D_rows) {
    buffer = new Float32Array(D_cols * D_rows);
    bufCols = D_cols;
    bufRows = D_rows;
    dirty = true;
  }
  return buffer;
}

export function markDirty() { dirty = true; }

export function getAmbient(intensity) {
  return (INTENSITY_PARAMS[intensity] || INTENSITY_PARAMS.medium).ambient;
}

// Ray march from (ac,ar) to (tc,tr); returns false if any intermediate cell is a wall (value 0).
function hasLoS(ac, ar, tc, tr, grid, D_cols, D_rows) {
  const dx = tc - ac, dy = tr - ar;
  const steps = Math.max(Math.abs(dx), Math.abs(dy)) * 2;
  if (steps === 0) return true;
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const c = Math.round(ac + dx * t);
    const r = Math.round(ar + dy * t);
    if (c === tc && r === tr) break;
    if (grid[r * D_cols + c] === 0) return false;
  }
  return true;
}

function cosSquareFactor(col, row, centerCol, centerRow, ambient, range) {
  const dc = Math.abs(col - centerCol);
  const dr = Math.abs(row - centerRow);
  let d = dc > dr ? dc : dr;
  if (d > 6) d = 6;
  const t = (Math.PI * d) / 12;
  const cosT = Math.cos(t);
  return ambient + range * cosT * cosT;
}

// Compute and return the attention field.
// Signature: compute(actorCol, actorRow, cursorCol, cursorRow, cursorAlpha, D_cols, D_rows, intensity, floor=0, grid=null)
// floor: per-cell minimum brightness [0..1]; used to animate generation→solve brightness fade.
// grid: when provided, enables LoS masking (non-null during solving).
export function compute(actorCol, actorRow, cursorCol, cursorRow, cursorAlpha, D_cols, D_rows, intensity, floor = 0, grid = null) {
  ensureBuffer(D_cols, D_rows);
  const { ambient, range, losRange } = INTENSITY_PARAMS[intensity] || INTENSITY_PARAMS.medium;

  // No actor (generation phase): full brightness — floor is irrelevant (1.0 ≥ any floor).
  if (actorCol < 0 || actorRow < 0) {
    if (dirty || lastIntensity !== intensity || lastActorCol !== -1 || lastActorRow !== -1 || lastFloor !== floor) {
      buffer.fill(1.0);
      lastIntensity = intensity;
      lastActorCol = -1;
      lastActorRow = -1;
      lastCursorAlpha = 0;
      lastFloor = floor;
      dirty = false;
    }
    return buffer;
  }

  // At Low intensity: flat ambient, no per-cell falloff.
  if (intensity === "low") {
    const fill = Math.max(floor, ambient);
    if (dirty || lastIntensity !== intensity || lastActorCol !== -999 || lastActorRow !== -999 || lastFloor !== floor) {
      buffer.fill(fill);
      lastIntensity = intensity;
      lastActorCol = -999;
      lastActorRow = -999;
      lastCursorAlpha = 0;
      lastFloor = floor;
      dirty = false;
    }
    return buffer;
  }

  const hasCursor = cursorAlpha > 0 && cursorCol >= 0 && cursorRow >= 0;

  // Skip recompute if nothing changed.
  if (
    !dirty &&
    lastActorCol === actorCol &&
    lastActorRow === actorRow &&
    lastIntensity === intensity &&
    lastCursorCol === (hasCursor ? cursorCol : -1) &&
    lastCursorRow === (hasCursor ? cursorRow : -1) &&
    Math.abs(lastCursorAlpha - (hasCursor ? cursorAlpha : 0)) < 0.01 &&
    Math.abs(lastFloor - floor) < 0.001
  ) {
    return buffer;
  }

  const LOS_RADIUS = 8;
  for (let r = 0; r < D_rows; r++) {
    for (let c = 0; c < D_cols; c++) {
      // Actor: ambient (wall-penetrating, reduced range) + LoS (full range, blocked by walls).
      let val = cosSquareFactor(c, r, actorCol, actorRow, ambient, range);
      if (grid && losRange > 0) {
        const cheb = Math.max(Math.abs(c - actorCol), Math.abs(r - actorRow));
        if (cheb <= LOS_RADIUS && hasLoS(actorCol, actorRow, c, r, grid, D_cols, D_rows)) {
          val = Math.max(val, cosSquareFactor(c, r, actorCol, actorRow, ambient, losRange));
        }
      }
      // Cursor: same dual-layer, max-blended with cursorAlpha.
      if (hasCursor) {
        let cursorVal = cosSquareFactor(c, r, cursorCol, cursorRow, ambient, range);
        if (grid && losRange > 0) {
          const cheb = Math.max(Math.abs(c - cursorCol), Math.abs(r - cursorRow));
          if (cheb <= LOS_RADIUS && hasLoS(cursorCol, cursorRow, c, r, grid, D_cols, D_rows)) {
            cursorVal = Math.max(cursorVal, cosSquareFactor(c, r, cursorCol, cursorRow, ambient, losRange));
          }
        }
        val = Math.max(val, cursorVal * cursorAlpha);
      }
      buffer[r * D_cols + c] = Math.max(floor, val);
    }
  }

  lastActorCol = actorCol;
  lastActorRow = actorRow;
  lastIntensity = intensity;
  lastCursorCol = hasCursor ? cursorCol : -1;
  lastCursorRow = hasCursor ? cursorRow : -1;
  lastCursorAlpha = hasCursor ? cursorAlpha : 0;
  lastFloor = floor;
  dirty = false;
  return buffer;
}
