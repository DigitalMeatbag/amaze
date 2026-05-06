import { BaseTheme } from "./base.js";

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
  }
  _solveAccent() { return "#FFEE99"; }
  timeoutActorGlyph() { return "%"; }
  timeoutActorColor() { return "#554422"; }
}
