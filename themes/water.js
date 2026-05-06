import { BaseTheme, applyAttention, lerpHex } from "./base.js";
import { SemanticState } from "./index.js";

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

  // Water shimmer: tint wall foreground per-cell using a sin wave.
  // Implemented by overriding the wall path before delegating to base.
  renderCell(args) {
    if (args.semantic === SemanticState.WALL && this.intensity !== "low") {
      const m = 0.5 + 0.5 * Math.sin((2 * Math.PI * args.frameCount) / 80 + args.col * 0.3);
      // Blend wall color toward a brighter ripple highlight.
      const tinted = lerpHex(this.palette.wall, "#3D6CB0", 0.35 * m);
      const palBackup = this.palette.wall;
      this.palette.wall = tinted;
      super.renderCell(args);
      this.palette.wall = palBackup;
      return;
    }
    super.renderCell(args);
  }
}
