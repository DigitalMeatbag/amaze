import { BaseTheme, lerpHex } from "./base.js";
import { SemanticState } from "./index.js";

export class DesertTheme extends BaseTheme {
  constructor() {
    super(
      {
        bg:         "#1A120A",
        wall:       "#C87820",
        wallEmerge: "#7A4A10",
        floor:      "#6B4A14",
        start:      "#FFE080",
        goal:       "#FF6600",
        actor:      "#FFE880",
        generating: "#CC8830",
      },
      {
        wall: "#",
        floor: ".",
        start: ">",
        goal: "X",
        actor: "@",
        generating: "*",
      }
    );
    this._miragePool = [];
    this._mirageD_cols = 0;
    this._mirageD_rows = 0;
  }

  _solveAccent() { return "#FFEE99"; }
  timeoutActorGlyph() { return "%"; }
  timeoutActorColor() { return "#554422"; }

  // Heat shimmer: wall cells near the actor tint toward a pale yellow at High intensity.
  renderCell(args) {
    if (args.semantic === SemanticState.WALL && this.intensity === "high") {
      const { attentionFactor, frameCount, col, row } = args;
      if (attentionFactor > 0.8) {
        const proximity = (attentionFactor - 0.8) / 0.2;
        const flicker = 0.5 + 0.5 * Math.sin(frameCount * 0.25 + col * 0.7 + row * 0.5);
        const tinted = lerpHex(this.palette.wall, "#FFD070", 0.4 * proximity * flicker);
        const backup = this.palette.wall;
        this.palette.wall = tinted;
        super.renderCell(args);
        this.palette.wall = backup;
        return;
      }
    }
    super.renderCell(args);
  }

  // Mirage: random wall cells occasionally flicker to ║ on a staggered 180-frame cycle.
  renderOverlay(ctx, D_cols, D_rows, cw, ch, frameCount) {
    if (this.intensity !== "high") return;
    if (this._mirageD_cols !== D_cols || this._mirageD_rows !== D_rows) {
      this._mirageD_cols = D_cols;
      this._mirageD_rows = D_rows;
      const count = Math.max(4, Math.min(20, ((D_cols + D_rows) / 10) | 0));
      this._miragePool = Array.from({ length: count }, () => ({
        col: (Math.random() * D_cols) | 0,
        row: (Math.random() * D_rows) | 0,
        offset: (Math.random() * 180) | 0,
      }));
    }
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const m of this._miragePool) {
      const phase = (frameCount + m.offset) % 180;
      if (phase < 12) {
        const alpha = 0.6 * Math.sin((phase / 12) * Math.PI);
        ctx.fillStyle = `rgba(240, 200, 80, ${alpha.toFixed(3)})`;
        ctx.fillText("║", m.col * cw + cw / 2, m.row * ch + ch / 2);
      }
    }
    ctx.restore();
  }
}
