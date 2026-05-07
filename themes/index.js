// Theme registry and shared semantic / lifecycle enums.
// Spec §8.

export const SemanticState = Object.freeze({
  WALL:                 "wall",
  FLOOR:                "floor",
  START:                "start",
  GOAL:                 "goal",
  ACTOR:                "actor",
  VISITED:              "visited",
  FRONTIER:             "frontier",
  PATH:                 "path",
  GENERATING:           "generating",
  // v2 additions
  ACTOR_WALK_FOUND:     "actor_walk_found",    // @ → ! during walk-to-goal beat
  ACTOR_CHANGE_OF_MIND: "actor_change_of_mind", // @ → ? during commit-to-path target change
});

export const LifecycleEvent = Object.freeze({
  MAZE_READY:           "maze_ready",
  SOLVER_START:         "solver_start",
  SOLVER_SOLVED:        "solver_solved",       // v2: fires when actor ARRIVES at goal
  SOLVER_TIMEOUT:       "solver_timeout",
  SOLVER_FADE_COMPLETE: "solver_fade_complete",
  CYCLE_RESET:          "cycle_reset",
  // v2 addition
  WALK_TO_GOAL_BEAT:    "walk_to_goal_beat",   // fires when solver finds goal, before ! beat
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
