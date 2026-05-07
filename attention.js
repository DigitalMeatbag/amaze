// Attention field: per-cell brightness multiplier centered on actor + optional cursor.
// Spec §7. v2: added cursor light source with max-blend.

const INTENSITY_PARAMS = {
  low:    { ambient: 0.50, range: 0.50 },
  medium: { ambient: 0.25, range: 0.75 },
  high:   { ambient: 0.15, range: 0.85 },
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
// Signature: compute(actorCol, actorRow, cursorCol, cursorRow, cursorAlpha, D_cols, D_rows, intensity, floor=0)
// floor: per-cell minimum brightness [0..1]; used to animate generation→solve brightness fade.
export function compute(actorCol, actorRow, cursorCol, cursorRow, cursorAlpha, D_cols, D_rows, intensity, floor = 0) {
  ensureBuffer(D_cols, D_rows);
  const { ambient, range } = INTENSITY_PARAMS[intensity] || INTENSITY_PARAMS.medium;

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

  for (let r = 0; r < D_rows; r++) {
    for (let c = 0; c < D_cols; c++) {
      const actorFactor = cosSquareFactor(c, r, actorCol, actorRow, ambient, range);
      let val = actorFactor;
      if (hasCursor) {
        const cursorFactor = cosSquareFactor(c, r, cursorCol, cursorRow, ambient, range);
        val = Math.max(val, cursorFactor * cursorAlpha);
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
