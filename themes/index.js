// Theme registry and shared semantic / lifecycle enums.
// Spec §8.

export const SemanticState = Object.freeze({
  WALL:       "wall",
  FLOOR:      "floor",
  START:      "start",
  GOAL:       "goal",
  ACTOR:      "actor",
  VISITED:    "visited",
  FRONTIER:   "frontier",
  PATH:       "path",
  GENERATING: "generating",
});

export const LifecycleEvent = Object.freeze({
  MAZE_READY:           "maze_ready",
  SOLVER_START:         "solver_start",
  SOLVER_SOLVED:        "solver_solved",
  SOLVER_TIMEOUT:       "solver_timeout",
  SOLVER_FADE_COMPLETE: "solver_fade_complete",
  CYCLE_RESET:          "cycle_reset",
});

import { ForestTheme } from "./forest.js";
import { DesertTheme } from "./desert.js";
import { StoneTheme } from "./stone.js";
import { VoidTheme } from "./void.js";
import { WaterTheme } from "./water.js";
import { LavaTheme } from "./lava.js";
import { ColdTheme } from "./cold.js";

export const Themes = {
  forest: ForestTheme,
  desert: DesertTheme,
  stone:  StoneTheme,
  void:   VoidTheme,
  water:  WaterTheme,
  lava:   LavaTheme,
  cold:   ColdTheme,
};

export const THEME_KEYS = Object.keys(Themes);

export function makeTheme(key, rng = Math.random) {
  let resolved = key;
  if (key === "random" || !Themes[key]) {
    resolved = THEME_KEYS[(rng() * THEME_KEYS.length) | 0];
  }
  return { theme: new Themes[resolved](), key: resolved };
}
