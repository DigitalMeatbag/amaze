import { BaseTheme } from "./base.js";
import { SemanticState } from "./index.js";

export class ColdTheme extends BaseTheme {
  constructor() {
    super(
      {
        bg:         "#040814",
        wall:       "#6699CC",
        wallEmerge: "#1A2A44",
        floor:      "#0A1428",
        start:      "#EEEEFF",
        goal:       "#AACCFF",
        actor:      "#FFFFFF",
        generating: "#334466",
      },
      {
        wall: "+",
        floor: ".",
        start: ">",
        goal: "X",
        actor: "@",
        generating: "+",
      }
    );
    this.frosts = []; // {col, row, t0}
    this._D_cols = 0; // cached from renderOverlay for crystallization
  }
  _solveAccent() { return "#FFFFFF"; }
  timeoutActorGlyph() { return "x"; }
  timeoutActorColor() { return "#223355"; }

  // MAZE_READY: walls crystallize · → + left to right over 40 frames (~667ms).
  renderCell(args) {
    if (args.semantic === SemanticState.WALL && this._D_cols > 0) {
      const mb = this._beatProgress(this.mazeReadyBeat);
      if (mb !== null) {
        // 40 frames at 60fps ≈ 667ms out of 800ms beat = 0.833 beat progress
        const revealedCols = Math.round(Math.min(1, mb / 0.833) * this._D_cols);
        if (args.col >= revealedCols) {
          const glyphBackup = this.glyphs.wall;
          const palBackup = this.palette.wall;
          this.glyphs.wall = "·";
          this.palette.wall = this.palette.wallEmerge || "#1A2A44";
          super.renderCell(args);
          this.glyphs.wall = glyphBackup;
          this.palette.wall = palBackup;
          return;
        }
      }
    }
    super.renderCell(args);
  }

  renderOverlay(ctx, D_cols, D_rows, cw, ch, frameCount) {
    this._D_cols = D_cols;
    if (this.intensity === "low") return;
    if (frameCount % 30 === 0 && this.frosts.length < 8) {
      this.frosts.push({
        col: (Math.random() * D_cols) | 0,
        row: (Math.random() * D_rows) | 0,
        t0: frameCount,
      });
    }
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const next = [];
    for (const f of this.frosts) {
      const age = frameCount - f.t0;
      if (age < 60) {
        const a = 0.5 * Math.sin((age / 60) * Math.PI);
        ctx.fillStyle = `rgba(60, 80, 120, ${Math.max(0, a).toFixed(3)})`;
        ctx.fillText("+", f.col * cw + cw / 2, f.row * ch + ch / 2);
        next.push(f);
      }
    }
    this.frosts = next;
    ctx.restore();
  }
}
