import { BaseTheme } from "./base.js";
import { SemanticState } from "./index.js";

export class VoidTheme extends BaseTheme {
  constructor() {
    super(
      {
        bg:         "#000005",
        wall:       "#220833",
        wallEmerge: "#220833",
        floor:      "#000005",   // floor renders as blank space
        start:      "#CC44FF",
        goal:       "#FF44CC",
        actor:      "#DD55FF",
        generating: "#110022",
      },
      {
        wall: "#",
        floor: " ",
        start: "*",
        goal: "*",
        actor: "@",
        generating: "*",
      }
    );
    this.twinkles = []; // {col, row, t0}
  }
  _solveAccent() { return "#FF99FF"; }
  timeoutActorGlyph() { return " "; } // vanish
  timeoutActorColor() { return "#000005"; }

  renderOverlay(ctx, D_cols, D_rows, cw, ch, frameCount) {
    if (this.intensity === "low") return;
    // Maintain up to 20 active twinkles, spawning roughly one every 8 frames.
    if (frameCount % 8 === 0 && this.twinkles.length < 20) {
      this.twinkles.push({
        col: (Math.random() * D_cols) | 0,
        row: (Math.random() * D_rows) | 0,
        t0: frameCount,
      });
    }
    ctx.save();
    ctx.font = ctx.font; // preserve
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const next = [];
    for (const tw of this.twinkles) {
      const age = frameCount - tw.t0;
      if (age < 40) {
        const a = 0.4 * Math.sin((age / 40) * Math.PI);
        ctx.fillStyle = `rgba(80, 30, 110, ${Math.max(0, a).toFixed(3)})`;
        ctx.fillText("·", tw.col * cw + cw / 2, tw.row * ch + ch / 2);
        next.push(tw);
      }
    }
    this.twinkles = next;
    ctx.restore();
  }
}
