import { BaseTheme } from "./base.js";

export class StoneTheme extends BaseTheme {
  constructor() {
    super(
      {
        bg:         "#080810",
        wall:       "#8888AA",
        wallEmerge: "#3A3A55",
        floor:      "#2A2A3A",
        start:      "#CCCCFF",
        goal:       "#AAAAFF",
        actor:      "#EEEEFF",
        generating: "#555577",
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
  _solveAccent() { return "#FFFFFF"; }
  timeoutActorGlyph() { return "+"; }
  timeoutActorColor() { return "#444455"; }
}
