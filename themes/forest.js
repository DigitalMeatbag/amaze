import { BaseTheme } from "./base.js";
import { SemanticState } from "./index.js";

export class ForestTheme extends BaseTheme {
  constructor() {
    super(
      {
        bg:         "#0A1A0A",
        wall:       "#2D6B1E",
        wallEmerge: "#0F2A0F",
        floor:      "#1A3D10",
        start:      "#90FF60",
        goal:       "#FF9900",
        actor:      "#B0FF80",
        generating: "#55CC33",
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
  _solveAccent() { return "#CCFF99"; }
  timeoutActorGlyph() { return "x"; }
  timeoutActorColor() { return "#444444"; }

  renderOverlay(ctx, D_cols, D_rows, cw, ch, frameCount, ctxData) {
    if (this.intensity === "low") return;
    if (!ctxData || !ctxData.actorCol) return;
    const ac = ctxData.actorCol, ar = ctxData.actorRow;
    if (ac < 0) return;
    ctx.save();
    const t = (frameCount % 120) / 120;
    const amp = 0.08 * Math.sin(t * Math.PI * 2);
    if (amp <= 0) { ctx.restore(); return; }
    ctx.fillStyle = `rgba(80, 200, 100, ${amp.toFixed(3)})`;
    const r0 = Math.max(0, ar - 3), r1 = Math.min(D_rows - 1, ar + 3);
    const c0 = Math.max(0, ac - 3), c1 = Math.min(D_cols - 1, ac + 3);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const dc = c - ac, dr = r - ar;
        if (dc * dc + dr * dr > 9) continue;
        ctx.fillRect(c * cw, r * ch, cw, ch);
      }
    }
    ctx.restore();
  }
}
