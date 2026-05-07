import { BaseTheme, lerpHex } from "./base.js";
import { SemanticState } from "./index.js";

const RIPPLE_CYCLE = ["~", "≈", "≋", "≈"];

export class WaterTheme extends BaseTheme {
  constructor() {
    super(
      {
        bg:         "#040B1F",
        wall:       "#1A3A6A",
        wallEmerge: "#0D2A50",
        floor:      "#0D1F40",
        start:      "#40AAFF",
        goal:       "#00CCFF",
        actor:      "#66BBFF",
        generating: "#0D2A50",
      },
      {
        wall: "~",
        floor: ".",
        start: ">",
        goal: "O",
        actor: "@",
        generating: "~",
      }
    );
  }
  _solveAccent() { return "#AAEEFF"; }
  timeoutActorGlyph() { return "~"; }
  timeoutActorColor() { return "#0D2A50"; }

  // MAZE_READY: cycle wall glyphs ~ → ≈ → ≋ → ≈ over the beat.
  // Medium/High: sinusoidal shimmer on wall color.
  renderCell(args) {
    if (args.semantic === SemanticState.WALL) {
      const mb = this._beatProgress(this.mazeReadyBeat);
      const hasGlyphCycle = mb !== null;
      const hasShimmer = this.intensity !== "low";
      if (hasGlyphCycle || hasShimmer) {
        const glyphBackup = this.glyphs.wall;
        const palBackup = this.palette.wall;
        if (hasGlyphCycle) {
          this.glyphs.wall = RIPPLE_CYCLE[Math.min(3, (mb * 4) | 0)];
        }
        if (hasShimmer) {
          const m = 0.5 + 0.5 * Math.sin((2 * Math.PI * args.frameCount) / 80 + args.col * 0.3);
          this.palette.wall = lerpHex(palBackup, "#3D6CB0", 0.35 * m);
        }
        super.renderCell(args);
        this.glyphs.wall = glyphBackup;
        this.palette.wall = palBackup;
        return;
      }
    }
    super.renderCell(args);
  }
}
