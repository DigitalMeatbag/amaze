import { BaseTheme, lerpHex } from "./base.js";
import { SemanticState } from "./index.js";

export class LavaTheme extends BaseTheme {
  constructor() {
    super(
      {
        bg:         "#1A0400",
        wall:       "#CC2200",
        wallEmerge: "#FF4400",
        floor:      "#3D0A00",
        start:      "#FF8800",
        goal:       "#FF4400",
        actor:      "#FFAA00",
        generating: "#882200",
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
  }
  _solveAccent() { return "#FFDD00"; }
  timeoutActorGlyph() { return "*"; }
  timeoutActorColor() { return "#441100"; }

  renderCell(args) {
    if (args.semantic === SemanticState.FLOOR && this.intensity !== "low") {
      const m = 0.5 + 0.5 * Math.sin(
        (2 * Math.PI * args.frameCount) / 200 + args.row * 0.5 + args.col * 0.3
      );
      const tinted = lerpHex(this.palette.floor, "#8A2500", 0.35 * m);
      const backup = this.palette.floor;
      this.palette.floor = tinted;
      super.renderCell(args);
      this.palette.floor = backup;
      return;
    }
    super.renderCell(args);
  }
}
