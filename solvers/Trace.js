import { SolverPhase } from "./SolverPhase.js";

export function newTrace(solverKey) {
  return {
    phase: SolverPhase.SEARCHING,
    actorCell: [0, 0],
    visited: new Set(),
    frontier: new Set(),
    breadcrumb: new Map(),
    path: [],
    movementHistory: [],
    fadeAlpha: 1.0,
    solverKey,
    stepCount: 0,
    elapsedMs: 0,
    beatGlyph:  null,
    walkPath:   [],
    walkIndex:  0,
  };
}
