// Generator interface and registry. Spec §5.

import { GeneratorBase } from "./GeneratorBase.js";
import { Backtracker } from "./backtracker.js";
import { Prims } from "./prims.js";
import { Division } from "./division.js";
import { Organic } from "./organic.js";
import { RoomCorridor } from "./roomcorridor.js";

export const Generators = {
  backtracker: Backtracker,
  prims: Prims,
  division: Division,
  organic: Organic,
  roomcorridor: RoomCorridor,
};

// Theme weights — keys must match Generators.
export const THEME_GENERATOR_WEIGHTS = {
  stone:  { backtracker: 25, prims: 0,  division: 15, organic: 0,  roomcorridor: 60 },
  forest: { backtracker: 0,  prims: 55, division: 0,  organic: 35, roomcorridor: 10 },
  desert: { backtracker: 60, prims: 15, division: 25, organic: 0,  roomcorridor: 0 },
  cold:   { backtracker: 25, prims: 0,  division: 75, organic: 0,  roomcorridor: 0 },
  void:   { backtracker: 30, prims: 0,  division: 55, organic: 0,  roomcorridor: 15 },
  water:  { backtracker: 0,  prims: 30, division: 0,  organic: 70, roomcorridor: 0 },
  lava:   { backtracker: 15, prims: 0,  division: 30, organic: 55, roomcorridor: 0 },
};

export function pickGenerator(themeKey, rng = Math.random) {
  const w = THEME_GENERATOR_WEIGHTS[themeKey] || THEME_GENERATOR_WEIGHTS.stone;
  let total = 0;
  for (const k of Object.keys(w)) total += w[k];
  let roll = rng() * total;
  for (const k of Object.keys(w)) {
    roll -= w[k];
    if (roll <= 0) return k;
  }
  return "backtracker";
}

export const GENERATOR_LABELS = {
  backtracker:  "Backtracker",
  prims:        "Prim's",
  division:     "Division",
  organic:      "Organic/CA",
  roomcorridor: "Room-and-Corridor",
};

export function makeGenerator(key) {
  const Cls = Generators[key];
  if (!Cls) throw new Error("Unknown generator: " + key);
  const gen = new Cls();
  if (!(gen instanceof GeneratorBase)) throw new Error(`Generator "${key}" must extend GeneratorBase`);
  return gen;
}
