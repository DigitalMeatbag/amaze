// Canvas 2D renderer. Owns the canvas element. Spec §3.

import { CellType } from "./maze.js";
import { SemanticState } from "./themes/index.js";
import { compute as computeAttention, markDirty as markAttentionDirty } from "./attention.js";
import { SOLVER_COLORS, SolverPhase } from "./solvers/index.js";

export const SCALE_PRESETS = [
  { key: "tiny",    fontSize: 12, cw: 8,  ch: 15 },
  { key: "small",   fontSize: 14, cw: 9,  ch: 17 },
  { key: "compact", fontSize: 16, cw: 10, ch: 19 },
  { key: "medium",  fontSize: 18, cw: 11, ch: 22 },
  { key: "large",   fontSize: 20, cw: 12, ch: 24 },
  { key: "xl",      fontSize: 22, cw: 14, ch: 27 },
  { key: "huge",    fontSize: 24, cw: 15, ch: 30 },
  { key: "poster",  fontSize: 28, cw: 17, ch: 34 },
];

export const FONT_FAMILY = `'Cascadia Mono', Consolas, 'Courier New', monospace`;
const MIN_DIM = 5;

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false });
    this.D_cols = 0;
    this.D_rows = 0;
    this.cw = 11;
    this.ch = 22;
    this.fontSize = 18;
    this.scaleKey = "medium";
    this.intensity = "medium";
    this.dpr = window.devicePixelRatio || 1;
    this.frameCount = 0;
    this._fontReadyPromise = this._waitForFont();
  }

  async _waitForFont() {
    if (document.fonts && document.fonts.ready) {
      try { await document.fonts.ready; } catch (_) {}
    }
  }

  setIntensity(level) {
    this.intensity = level;
    markAttentionDirty();
  }

  // Find the largest preset (starting from desired) whose grid is at least
  // MIN_DIM × MIN_DIM. Falls back smaller until it fits.
  _resolveScale(desiredKey, vw, vh) {
    let idx = SCALE_PRESETS.findIndex((p) => p.key === desiredKey);
    if (idx === -1) idx = 3; // medium
    while (idx >= 0) {
      const p = SCALE_PRESETS[idx];
      const cols = Math.floor(vw / p.cw);
      const rows = Math.floor(vh / p.ch);
      if (cols >= MIN_DIM && rows >= MIN_DIM) return p;
      idx--;
    }
    return SCALE_PRESETS[0];
  }

  // Recompute grid dimensions and resize canvas. Returns true if dimensions changed.
  resize(scaleKey, themeBgColor) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const dpr = window.devicePixelRatio || 1;
    const preset = this._resolveScale(scaleKey, vw, vh);
    const D_cols = Math.max(MIN_DIM, Math.floor(vw / preset.cw));
    const D_rows = Math.max(MIN_DIM, Math.floor(vh / preset.ch));

    const cssW = D_cols * preset.cw;
    const cssH = D_rows * preset.ch;
    this.canvas.width = Math.max(1, Math.floor(cssW * dpr));
    this.canvas.height = Math.max(1, Math.floor(cssH * dpr));
    this.canvas.style.width = cssW + "px";
    this.canvas.style.height = cssH + "px";
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    this.D_cols = D_cols;
    this.D_rows = D_rows;
    this.cw = preset.cw;
    this.ch = preset.ch;
    this.fontSize = preset.fontSize;
    this.scaleKey = preset.key;
    this.dpr = dpr;

    document.body.style.background = themeBgColor || "#000";
    markAttentionDirty();
    return { D_cols, D_rows, presetKey: preset.key };
  }

  // Build per-cell semantic decisions in one pass. Returns an object describing
  // which cells are special so we don't recompute lookups per cell.
  _buildSemanticOverlay(grid, trace) {
    // trace may be null during generation.
    const D = this.D_cols * this.D_rows;
    const overlay = new Int8Array(D); // 0 = base, 1 = visited, 2 = frontier, 3 = path, 4 = actor
    if (!trace) return overlay;
    if (trace.visited) {
      for (const i of trace.visited) overlay[i] = 1;
    }
    if (trace.frontier) {
      for (const i of trace.frontier) {
        if (overlay[i] === 0) overlay[i] = 2;
      }
    }
    if (trace.path && trace.path.length) {
      for (const i of trace.path) overlay[i] = 3;
    }
    if (trace.actorCell) {
      const [ac, ar] = trace.actorCell;
      if (ac >= 0 && ac < this.D_cols && ar >= 0 && ar < this.D_rows) {
        overlay[ar * this.D_cols + ac] = 4;
      }
    }
    return overlay;
  }

  // Render one frame. `state` shape:
  //   { grid, trace?, theme, isGenerating, cursorState?, displayActorCol?, displayActorRow?, attentionFloor? }
  render(state) {
    this.frameCount++;
    const { grid, trace, theme, isGenerating, cursorState,
            displayActorCol, displayActorRow, attentionFloor = 0 } = state;
    const ctx = this.ctx;
    const cw = this.cw, ch = this.ch;

    if (!grid) return;

    // Background fill (whole canvas first).
    ctx.fillStyle = theme.backgroundColor;
    ctx.fillRect(0, 0, this.D_cols * cw, this.D_rows * ch);

    // Font setup.
    ctx.font = `${this.fontSize}px ${FONT_FAMILY}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    // Solver color identity.
    const solverColor = trace ? SOLVER_COLORS[trace.solverKey] : null;

    // Attention field — use display actor position (smoothed) when available.
    let actorCol = (displayActorCol !== undefined && displayActorCol >= 0) ? displayActorCol : -1;
    let actorRow = (displayActorRow !== undefined && displayActorRow >= 0) ? displayActorRow : -1;
    if (actorCol < 0 && !isGenerating && trace && trace.actorCell) {
      actorCol = trace.actorCell[0];
      actorRow = trace.actorCell[1];
    }
    const cs = cursorState;
    const cursorActive = cs && cs.alpha > 0 && cs.col >= 0;
    const attention = computeAttention(
      actorCol, actorRow,
      cursorActive ? cs.col : -1,
      cursorActive ? cs.row : -1,
      cursorActive ? cs.alpha : 0,
      this.D_cols, this.D_rows,
      this.intensity,
      attentionFloor,
      grid
    );

    // Semantic overlay map (visited/frontier/path/actor lookups).
    const overlay = this._buildSemanticOverlay(grid, trace);

    const fadeAlpha = trace ? trace.fadeAlpha : 1.0;
    const isTimeout = trace && trace.phase === SolverPhase.TIMEOUT;

    // v2: actor semantic derived from beatGlyph.
    const beatGlyph = trace ? trace.beatGlyph : null;

    // Per-cell render.
    for (let r = 0; r < this.D_rows; r++) {
      const rowOffset = r * this.D_cols;
      for (let c = 0; c < this.D_cols; c++) {
        const i = rowOffset + c;
        const cellType = grid[i];
        const ov = overlay[i];

        let semantic;
        if (isGenerating) {
          if (cellType === CellType.WALL) {
            semantic = SemanticState.WALL;
          } else if (cellType === CellType.START) {
            semantic = SemanticState.START;
          } else if (cellType === CellType.GOAL) {
            semantic = SemanticState.GOAL;
          } else {
            semantic = SemanticState.FLOOR;
          }
        } else if (ov === 4) {
          // v2: actor beat state.
          if (beatGlyph === "!") {
            semantic = SemanticState.ACTOR_WALK_FOUND;
          } else if (beatGlyph === "?") {
            semantic = SemanticState.ACTOR_CHANGE_OF_MIND;
          } else {
            semantic = SemanticState.ACTOR;
          }
        } else if (cellType === CellType.START) {
          semantic = SemanticState.START;
        } else if (cellType === CellType.GOAL) {
          semantic = SemanticState.GOAL;
        } else if (ov === 3) {
          semantic = SemanticState.PATH;
        } else if (ov === 1) {
          semantic = SemanticState.VISITED;
        } else if (ov === 2) {
          semantic = SemanticState.FRONTIER;
        } else if (cellType === CellType.WALL) {
          semantic = SemanticState.WALL;
        } else {
          semantic = SemanticState.FLOOR;
        }

        theme.renderCell({
          col: c, row: r,
          semantic,
          solverColor,
          attentionFactor: attention[i],
          fadeAlpha,
          ctx, cw, ch,
          frameCount: this.frameCount,
          isActor: ov === 4,
          isTimeout,
          // v2: suppress flicker while beat glyph is showing
          suppressFlicker: beatGlyph !== null,
        });
      }
    }

    // Theme overlay layer.
    ctx.save();
    ctx.font = `${this.fontSize}px ${FONT_FAMILY}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    theme.renderOverlay(ctx, this.D_cols, this.D_rows, cw, ch, this.frameCount, {
      actorCol, actorRow,
    });
    ctx.restore();
  }

  // Dim entire canvas overlay (used between cycles, optional).
  fadeBlack(alpha) {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = `rgba(0,0,0,${alpha})`;
    ctx.fillRect(0, 0, this.D_cols * this.cw, this.D_rows * this.ch);
    ctx.restore();
  }

  whenFontReady() { return this._fontReadyPromise; }
}
