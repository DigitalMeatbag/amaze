// Attention field: per-cell brightness multiplier centered on actor.
// Spec §7.

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
let lastIntensity = "";
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

// Compute and return the attention field. If no actor (e.g., during generation),
// pass actorCol = -1, actorRow = -1; the field will be flat ambient.
export function compute(actorCol, actorRow, D_cols, D_rows, intensity) {
  ensureBuffer(D_cols, D_rows);
  const { ambient, range } = INTENSITY_PARAMS[intensity] || INTENSITY_PARAMS.medium;

  // No actor (generation phase): render at full brightness so the maze
  // construction is visible. Foundation: generation is part of the show.
  if (actorCol < 0 || actorRow < 0) {
    if (dirty || lastIntensity !== intensity || lastActorCol !== -1 || lastActorRow !== -1) {
      buffer.fill(1.0);
      lastIntensity = intensity;
      lastActorCol = -1;
      lastActorRow = -1;
      dirty = false;
    }
    return buffer;
  }
  // At Low intensity, flat ambient over the whole grid (no per-cell falloff).
  if (intensity === "low") {
    if (dirty || lastIntensity !== intensity || lastActorCol !== -999 || lastActorRow !== -999) {
      buffer.fill(ambient);
      lastIntensity = intensity;
      lastActorCol = -999;
      lastActorRow = -999;
      dirty = false;
    }
    return buffer;
  }

  // Skip recompute if nothing changed.
  if (
    !dirty &&
    lastActorCol === actorCol &&
    lastActorRow === actorRow &&
    lastIntensity === intensity
  ) {
    return buffer;
  }

  for (let r = 0; r < D_rows; r++) {
    const dr = Math.abs(r - actorRow);
    for (let c = 0; c < D_cols; c++) {
      const dc = Math.abs(c - actorCol);
      let d = dc > dr ? dc : dr;
      if (d > 6) d = 6;
      const t = (Math.PI * d) / 12;
      const cosT = Math.cos(t);
      // attention_factor = ambient + range * cos²
      buffer[r * D_cols + c] = ambient + range * cosT * cosT;
    }
  }
  lastActorCol = actorCol;
  lastActorRow = actorRow;
  lastIntensity = intensity;
  dirty = false;
  return buffer;
}
