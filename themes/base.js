// BaseTheme: shared rendering machinery. Themes extend with palette + glyphs
// + lifecycle beat overrides + optional overlay.
//
// Renderer calls into a theme via:
//   theme.backgroundColor               — page background
//   theme.renderCell(args)              — one cell, every frame
//   theme.onLifecycleEvent(event, data) — semantic event hook
//   theme.renderOverlay(args)           — full-screen overlay layer
//
// All non-ASCII decoration belongs in renderOverlay or beat effects, never
// in core map glyphs.

import { SemanticState, LifecycleEvent } from "./index.js";

// Convert "#RRGGBB" → [r,g,b] (0..255).
function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

// Multiply a hex foreground by an attention factor (0..1) on RGB channels.
export function applyAttention(hex, factor) {
  if (factor >= 0.999) return hex;
  const [r, g, b] = hexToRgb(hex);
  const rr = Math.max(0, Math.min(255, Math.round(r * factor)));
  const gg = Math.max(0, Math.min(255, Math.round(g * factor)));
  const bb = Math.max(0, Math.min(255, Math.round(b * factor)));
  return "#" + ((rr << 16) | (gg << 8) | bb).toString(16).padStart(6, "0");
}

// Linearly interpolate between two hex colors. t ∈ [0,1].
export function lerpHex(a, b, t) {
  const ar = hexToRgb(a), br = hexToRgb(b);
  const r = Math.round(ar[0] + (br[0] - ar[0]) * t);
  const g = Math.round(ar[1] + (br[1] - ar[1]) * t);
  const bl = Math.round(ar[2] + (br[2] - ar[2]) * t);
  return "#" + ((r << 16) | (g << 8) | bl).toString(16).padStart(6, "0");
}

const FLICKER_PERIOD_MS = 530;

export class BaseTheme {
  constructor(palette, glyphs, opts = {}) {
    this.palette = palette;
    this.glyphs = glyphs;
    this.opts = opts;
    this.intensity = "medium";
    this.beats = [];        // [{type, t0, durationMs, data}]
    this.solveBeat = null;  // { t0, duration, color } applied to path
    this.timeoutBeat = null;
    this.mazeReadyBeat = null;
    this.cycleResetBeat = null;
  }

  setIntensity(level) { this.intensity = level; }

  get backgroundColor() { return this.palette.bg; }

  // Fire/clear beats per lifecycle event.
  onLifecycleEvent(event, data = {}) {
    const now = performance.now();
    switch (event) {
      case LifecycleEvent.MAZE_READY:
        this.mazeReadyBeat = { t0: now, durationMs: 800 };
        break;
      case LifecycleEvent.SOLVER_START:
        // Most themes: brief actor flash. Default no-op (actor flicker handles
        // emergence well enough).
        break;
      case LifecycleEvent.SOLVER_SOLVED:
        this.solveBeat = { t0: now, durationMs: 700, data };
        break;
      case LifecycleEvent.SOLVER_TIMEOUT:
        this.timeoutBeat = { t0: now, durationMs: 600, data };
        break;
      case LifecycleEvent.SOLVER_FADE_COMPLETE:
        this.solveBeat = null;
        this.timeoutBeat = null;
        break;
      case LifecycleEvent.CYCLE_RESET:
        this.cycleResetBeat = { t0: now, durationMs: 600 };
        break;
    }
  }

  // Glyph for timeout death; theme override.
  timeoutActorGlyph() { return "x"; }
  timeoutActorColor() { return "#444444"; }

  // Helpers.
  _beatProgress(beat) {
    if (!beat) return null;
    const t = (performance.now() - beat.t0) / beat.durationMs;
    if (t >= 1) return null;
    return t;
  }

  // Drawing core cell. ctx.font + textBaseline are pre-set by renderer.
  renderCell(args) {
    const {
      col, row, semantic, solverColor, attentionFactor, fadeAlpha,
      ctx, cw, ch, frameCount, isActor, isTimeout,
    } = args;

    const palette = this.palette;
    const glyphs = this.glyphs;
    let glyph = glyphs.floor;
    let fg = palette.floor;
    let bg = palette.bg;
    let useAttention = true;
    let useGlow = false;
    let alpha = 1.0;

    switch (semantic) {
      case SemanticState.WALL: {
        glyph = glyphs.wall;
        fg = palette.wall;
        break;
      }
      case SemanticState.FLOOR: {
        glyph = glyphs.floor;
        fg = palette.floor;
        break;
      }
      case SemanticState.START: {
        glyph = glyphs.start;
        fg = palette.start;
        useAttention = false;
        break;
      }
      case SemanticState.GOAL: {
        glyph = glyphs.goal;
        fg = palette.goal;
        useAttention = false;
        break;
      }
      case SemanticState.ACTOR: {
        if (isTimeout) {
          glyph = this.timeoutActorGlyph();
          const tb = this._beatProgress(this.timeoutBeat);
          fg = tb !== null ? lerpHex(palette.actor, this.timeoutActorColor(), tb) : this.timeoutActorColor();
          alpha = fadeAlpha;
          useAttention = false;
          useGlow = false;
        } else {
          glyph = glyphs.actor;
          fg = solverColor ? solverColor.path : palette.actor;
          useAttention = false;
          useGlow = true;
          // Cursor flicker: 530ms cycle, 50% on.
          const phase = (performance.now() % FLICKER_PERIOD_MS) / FLICKER_PERIOD_MS;
          alpha = phase < 0.5 ? 1.0 : 0.55;
        }
        break;
      }
      case SemanticState.VISITED: {
        glyph = glyphs.floor; // breadcrumb is colored, not glyph-changed by default
        fg = solverColor ? solverColor.breadcrumb : palette.floor;
        useAttention = false;
        alpha = fadeAlpha;
        break;
      }
      case SemanticState.FRONTIER: {
        glyph = glyphs.floor;
        fg = solverColor ? solverColor.breadcrumb : palette.floor;
        useAttention = false;
        alpha = 0.45 * fadeAlpha;
        break;
      }
      case SemanticState.PATH: {
        glyph = glyphs.floor;
        fg = solverColor ? solverColor.path : palette.floor;
        useAttention = false;
        useGlow = true;
        alpha = fadeAlpha;
        // Solve beat: pulse path color toward a bright accent.
        const sb = this._beatProgress(this.solveBeat);
        if (sb !== null && solverColor) {
          // Two-pulse curve.
          const pulse = Math.abs(Math.sin(sb * Math.PI * 2));
          fg = lerpHex(solverColor.path, this._solveAccent(), 0.6 * pulse);
        }
        break;
      }
      case SemanticState.GENERATING: {
        glyph = glyphs.generating || glyphs.wall;
        fg = palette.generating || palette.wall;
        break;
      }
      default: {
        glyph = glyphs.floor;
        fg = palette.floor;
      }
    }

    // Maze-ready beat: tint walls from a darker shade up to the normal wall.
    if (semantic === SemanticState.WALL) {
      const mb = this._beatProgress(this.mazeReadyBeat);
      if (mb !== null && palette.wallEmerge) {
        fg = lerpHex(palette.wallEmerge, palette.wall, mb);
      }
    }

    // Cycle-reset beat: darken everything.
    const cb = this._beatProgress(this.cycleResetBeat);
    if (cb !== null) {
      // Gentle dim: linear toward black.
      const dimT = 1.0 - 0.55 * (1.0 - cb);
      fg = applyAttention(fg, dimT);
    }

    // Attention dimming on map cells.
    if (useAttention) {
      fg = applyAttention(fg, attentionFactor);
    }

    // Background fill.
    ctx.fillStyle = bg;
    ctx.fillRect(col * cw, row * ch, cw, ch);

    // Glyph draw.
    ctx.globalAlpha = alpha;
    if (useGlow && this.intensity !== "low") {
      ctx.shadowBlur = this.intensity === "high" ? 12 : 6;
      ctx.shadowColor = fg;
    } else {
      ctx.shadowBlur = 0;
    }
    ctx.fillStyle = fg;
    // Centered text.
    ctx.fillText(glyph, col * cw + cw / 2, row * ch + ch / 2);
    if (useGlow) {
      ctx.shadowBlur = 0;
    }
    ctx.globalAlpha = 1.0;
  }

  _solveAccent() { return "#FFFFFF"; }

  // Optional overlay layer drawn after all cells.
  renderOverlay(ctx, D_cols, D_rows, cw, ch, frameCount) {
    // default: no-op
  }
}
