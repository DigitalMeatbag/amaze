// Top-level orchestrator. Owns the run loop, state machine, and
// Wallpaper Engine / browser config integration.
//
// Spec §9 (cycle and run loop), §10 (WE integration).

import { Renderer } from "./renderer.js";
import { CellType, placeStartGoal } from "./maze.js";
import { makeGenerator, pickGenerator, GENERATOR_LABELS } from "./generators/index.js";
import {
  makeSolver, newTrace, selectSolvers, SolverPhase, SOLVER_COLORS, SOLVER_LABELS,
} from "./solvers/index.js";
import { LifecycleEvent, makeTheme, THEME_KEYS } from "./themes/index.js";

// ---------- Timing constants (spec §9.1) ----------
const PATH_HOLD_MS       = 2500;
const FADE_DURATION_MS   = 1500;
const INTER_SOLVER_MS    = 500;
const FIRST_SOLVER_DELAY = 0;
const RESET_BEAT_MS      = 1000;
const RESIZE_DEBOUNCE_MS = 150;
const GENERATION_TARGET_FRAMES = 240; // ~4s @ 60fps

// ---------- Default config (spec §10.4) ----------
const DEFAULT_CONFIG = {
  theme:             "random",
  scale:             "medium",
  intensity:         "medium",
  stepIntervalMs:    80,
  targetFadeOpacity: 0,
  maxSolveMs:        60000,
  randomWalkEnabled: false,
};

const config = { ...DEFAULT_CONFIG };

// ---------- Run state ----------
const State = Object.freeze({
  IDLE:             "idle",
  GENERATING:       "generating",
  GENERATION_BEAT:  "generation_beat",
  SOLVER_INIT:      "solver_init",
  SOLVING:          "solving",
  SOLVED_HOLD:      "solved_hold",
  TIMEOUT_HOLD:     "timeout_hold",
  FADING:           "fading",
  SOLVER_COMPLETE:  "solver_complete",
  CYCLE_END:        "cycle_end",
});

let runState = State.IDLE;
let renderer = null;

// Per-cycle data.
let activeThemeKey = "stone";
let theme = null;
let grid = null;
let generator = null;
let generatorTotalSteps = 0;
let generatorStepsPerFrame = 1;
let generatorFramesPerStep = 1;  // for CA-style generators
let generatorFrameCounter = 0;
let startIdx = -1;
let goalIdx = -1;
let selectedSolvers = [];
let solverIndex = 0;
let activeSolver = null;
let trace = null;
let solverInterval = null;
let solveBeatStartTime = 0;
let fadeStartTime = 0;
let phaseTimer = null; // setTimeout id for state transitions
let resizeDebounce = null;

// HUD state.
let generatorKey = null;
let solverHistory = [];        // [{solverKey, displayMs, timedOut}]
let solverWallStartTime = 0;   // performance.now() when current solver began
let solverFrozenMs = -1;       // frozen display ms once solver ends; -1 = live
let hudVisible = true;

// HUD DOM refs — populated in init().
let hudEl = null;
let hudTheme = null;
let hudGen = null;
let hudSolverName = null;
let hudSolverTime = null;
let hudPrev = null;

// ---------- Initialization ----------

function init() {
  const canvas = document.getElementById("canvas");
  if (!canvas) {
    console.error("amaze: missing #canvas element");
    return;
  }
  renderer = new Renderer(canvas);

  // HUD DOM refs.
  hudEl         = document.getElementById("hud");
  hudTheme      = document.getElementById("hud-theme");
  hudGen        = document.getElementById("hud-gen");
  hudSolverName = document.getElementById("hud-solver-name");
  hudSolverTime = document.getElementById("hud-solver-time");
  hudPrev       = document.getElementById("hud-prev");

  document.addEventListener("keydown", (e) => {
    if (e.key.toLowerCase() === "h") {
      hudVisible = !hudVisible;
      if (hudEl) hudEl.style.display = hudVisible ? "" : "none";
    }
  });

  applyConfig();
  attachWallpaperHooks();
  attachResize();
  // Start once font is ready (best effort).
  renderer.whenFontReady().then(() => {
    startCycle();
    requestAnimationFrame(loop);
  });
}

function attachResize() {
  window.addEventListener("resize", () => {
    if (resizeDebounce !== null) clearTimeout(resizeDebounce);
    resizeDebounce = setTimeout(() => {
      resizeDebounce = null;
      restartCycle();
    }, RESIZE_DEBOUNCE_MS);
  });
}

// ---------- Config application ----------

function applyConfig() {
  if (renderer) {
    renderer.setIntensity(config.intensity);
  }
}

function attachWallpaperHooks() {
  // Defensive: only attach if running inside Wallpaper Engine.
  const listener = {
    applyUserProperties(props) {
      let needsRestart = false;
      try {
        if (props.theme && props.theme.value !== undefined) {
          config.theme = props.theme.value; needsRestart = true;
        }
        if (props.scale && props.scale.value !== undefined) {
          config.scale = props.scale.value; needsRestart = true;
        }
        if (props.intensity && props.intensity.value !== undefined) {
          config.intensity = props.intensity.value;
          if (renderer) renderer.setIntensity(config.intensity);
          if (theme) theme.setIntensity(config.intensity);
        }
        if (props.stepInterval && props.stepInterval.value !== undefined) {
          config.stepIntervalMs = props.stepInterval.value;
          updateSolverInterval();
        }
        if (props.fadeOpacity && props.fadeOpacity.value !== undefined) {
          config.targetFadeOpacity = props.fadeOpacity.value;
        }
        if (props.maxSolveTime && props.maxSolveTime.value !== undefined) {
          config.maxSolveMs = props.maxSolveTime.value * 1000;
        }
        if (props.randomWalk && props.randomWalk.value !== undefined) {
          config.randomWalkEnabled = props.randomWalk.value;
          needsRestart = true;
        }
      } catch (err) {
        console.warn("amaze: error applying WE properties", err);
      }
      if (needsRestart) restartCycle();
    },
    applyGeneralProperties(props) {
      // FPS limits etc. — accept silently if present.
      try {
        if (props && props.fps) {
          // No special handling: rAF naturally adapts.
        }
      } catch (_) {}
    },
  };
  if (typeof window !== "undefined") {
    window.wallpaperPropertyListener = listener;
  }
}

// ---------- HUD ----------

function formatHudMs(ms) {
  return (ms / 1000).toFixed(1) + "s";
}

function updateHud() {
  if (!hudGen) return;

  if (hudTheme) hudTheme.textContent = activeThemeKey
    ? activeThemeKey[0].toUpperCase() + activeThemeKey.slice(1)
    : "—";

  hudGen.textContent = generatorKey
    ? (GENERATOR_LABELS[generatorKey] ?? generatorKey)
    : "—";

  const showSolver = trace
    && runState !== State.IDLE
    && runState !== State.GENERATING
    && runState !== State.GENERATION_BEAT
    && runState !== State.SOLVER_INIT;

  if (showSolver) {
    hudSolverName.textContent = SOLVER_LABELS[trace.solverKey] ?? trace.solverKey;
    hudSolverName.style.color = SOLVER_COLORS[trace.solverKey]?.breadcrumb ?? "#ffffff";
    const ms = solverFrozenMs >= 0
      ? solverFrozenMs
      : Math.max(0, performance.now() - solverWallStartTime);
    hudSolverTime.textContent = formatHudMs(ms);
  } else {
    hudSolverName.textContent = "—";
    hudSolverName.style.color = "";
    hudSolverTime.textContent = "—";
  }

  hudPrev.innerHTML = "";
  for (const h of solverHistory) {
    const row = document.createElement("div");
    row.className = "hud-prev-row";
    const nameEl = document.createElement("span");
    nameEl.className = "hud-prev-name";
    nameEl.textContent = SOLVER_LABELS[h.solverKey] ?? h.solverKey;
    nameEl.style.color = SOLVER_COLORS[h.solverKey]?.breadcrumb ?? "#888";
    const timeEl = document.createElement("span");
    timeEl.className = "hud-prev-time";
    timeEl.textContent = formatHudMs(h.displayMs);
    row.appendChild(nameEl);
    row.appendChild(timeEl);
    hudPrev.appendChild(row);
  }
}

function refreshHudTime() {
  if (!hudVisible || !hudSolverTime || solverFrozenMs >= 0) return;
  hudSolverTime.textContent = formatHudMs(
    Math.max(0, performance.now() - solverWallStartTime)
  );
}

// ---------- Cycle control ----------

function clearPhaseTimer() {
  if (phaseTimer !== null) { clearTimeout(phaseTimer); phaseTimer = null; }
}

function clearSolverInterval() {
  if (solverInterval !== null) { clearInterval(solverInterval); solverInterval = null; }
}

function updateSolverInterval() {
  // Only useful while a solver is actively stepping; otherwise no-op.
  if (solverInterval === null || trace === null || trace.phase !== SolverPhase.SEARCHING) return;
  clearInterval(solverInterval);
  solverInterval = setInterval(stepSolverTick, config.stepIntervalMs);
}

function startCycle() {
  // Pick theme (random honored).
  const t = makeTheme(config.theme);
  theme = t.theme;
  activeThemeKey = t.key;
  theme.setIntensity(config.intensity);

  // Resize canvas + body bg with new theme.
  const dims = renderer.resize(config.scale, theme.backgroundColor);

  // Pick generator weighted by theme.
  const genKey = pickGenerator(activeThemeKey);
  generator = makeGenerator(genKey);
  generatorKey = genKey;
  solverHistory = [];
  solverFrozenMs = -1;
  updateHud();

  grid = new Uint8Array(dims.D_cols * dims.D_rows);
  grid.fill(CellType.WALL);
  generator.begin(grid, dims.D_cols, dims.D_rows, Math.random);
  // After begin, generator may have replaced its internal grid (e.g., CA copies);
  // always read from generator.getGrid() during generation.

  generatorTotalSteps = Math.max(1, generator.totalSteps(dims.D_cols, dims.D_rows));
  if (typeof generator.framesPerStep === "function") {
    generatorFramesPerStep = generator.framesPerStep();
    generatorStepsPerFrame = 1;
  } else {
    generatorFramesPerStep = 1;
    generatorStepsPerFrame = Math.max(1, Math.floor(generatorTotalSteps / GENERATION_TARGET_FRAMES));
  }
  generatorFrameCounter = 0;

  selectedSolvers = selectSolvers(config.randomWalkEnabled);
  solverIndex = 0;

  runState = State.GENERATING;
}

function restartCycle() {
  clearPhaseTimer();
  clearSolverInterval();
  // Discard everything.
  trace = null;
  activeSolver = null;
  generator = null;
  grid = null;
  startIdx = -1;
  goalIdx = -1;
  generatorKey = null;
  solverHistory = [];
  solverFrozenMs = -1;
  runState = State.IDLE;
  updateHud();
  startCycle();
}

// ---------- Generation phase ----------

function advanceGeneration() {
  if (!generator) return false;
  if (generatorFramesPerStep > 1) {
    generatorFrameCounter++;
    if (generatorFrameCounter < generatorFramesPerStep) return false;
    generatorFrameCounter = 0;
    return generator.step();
  }
  let done = false;
  for (let i = 0; i < generatorStepsPerFrame; i++) {
    done = generator.step();
    if (done) break;
  }
  return done;
}

function onGenerationComplete() {
  // Ensure grid alias is up-to-date.
  grid = generator.getGrid();
  // Place start / goal preferring far-apart endpoints.
  const placement = placeStartGoal(grid, renderer.D_cols, renderer.D_rows);
  if (placement) {
    startIdx = placement.startIdx;
    goalIdx  = placement.goalIdx;
  } else {
    // Degenerate maze: fall back to whatever cells we can find.
    startIdx = grid.findIndex((v) => v === CellType.FLOOR);
    if (startIdx >= 0) {
      grid[startIdx] = CellType.START;
      // pick any other floor cell
      for (let i = grid.length - 1; i >= 0; i--) {
        if (grid[i] === CellType.FLOOR) { goalIdx = i; grid[i] = CellType.GOAL; break; }
      }
    }
  }
  theme.onLifecycleEvent(LifecycleEvent.MAZE_READY);
  runState = State.GENERATION_BEAT;
  clearPhaseTimer();
  phaseTimer = setTimeout(() => {
    phaseTimer = null;
    runState = State.SOLVER_INIT;
    initNextSolver(true);
  }, RESET_BEAT_MS);
}

// ---------- Solver phase ----------

function initNextSolver(isFirst) {
  const delay = isFirst ? FIRST_SOLVER_DELAY : INTER_SOLVER_MS;
  clearPhaseTimer();
  phaseTimer = setTimeout(() => {
    phaseTimer = null;
    if (solverIndex >= selectedSolvers.length) {
      onCycleEnd();
      return;
    }
    const key = selectedSolvers[solverIndex];
    activeSolver = makeSolver(key);
    trace = newTrace(key);
    if (startIdx < 0 || goalIdx < 0) {
      onCycleEnd();
      return;
    }
    activeSolver.begin(grid, renderer.D_cols, renderer.D_rows, trace, Math.random, startIdx, goalIdx);
    theme.onLifecycleEvent(LifecycleEvent.SOLVER_START, { solverKey: key });
    solverWallStartTime = performance.now();
    solverFrozenMs = -1;
    runState = State.SOLVING;
    updateHud();
    solverInterval = setInterval(stepSolverTick, config.stepIntervalMs);
  }, delay);
}

function stepSolverTick() {
  if (!activeSolver || !trace) return;
  if (trace.phase !== SolverPhase.SEARCHING) return;
  try {
    activeSolver.step();
  } catch (err) {
    console.error("amaze: solver step error", err);
    trace.phase = SolverPhase.TIMEOUT;
  }
  trace.elapsedMs += config.stepIntervalMs;
  trace.stepCount++;
  if (trace.elapsedMs >= config.maxSolveMs && trace.phase === SolverPhase.SEARCHING) {
    trace.phase = SolverPhase.TIMEOUT;
  }
  if (trace.phase === SolverPhase.SOLVED) onSolverSolved();
  else if (trace.phase === SolverPhase.TIMEOUT) onSolverTimeout();
}

function onSolverSolved() {
  clearSolverInterval();
  solverFrozenMs = Math.max(0, performance.now() - solverWallStartTime);
  theme.onLifecycleEvent(LifecycleEvent.SOLVER_SOLVED, { solverKey: trace.solverKey });
  updateHud();
  runState = State.SOLVED_HOLD;
  clearPhaseTimer();
  phaseTimer = setTimeout(() => {
    phaseTimer = null;
    beginFade();
  }, PATH_HOLD_MS);
}

function onSolverTimeout() {
  clearSolverInterval();
  solverFrozenMs = Math.max(0, performance.now() - solverWallStartTime);
  theme.onLifecycleEvent(LifecycleEvent.SOLVER_TIMEOUT, { solverKey: trace.solverKey });
  updateHud();
  runState = State.TIMEOUT_HOLD;
  clearPhaseTimer();
  phaseTimer = setTimeout(() => {
    phaseTimer = null;
    beginFade();
  }, PATH_HOLD_MS);
}

function beginFade() {
  trace.phase = SolverPhase.FADING;
  fadeStartTime = performance.now();
  runState = State.FADING;
  clearPhaseTimer();
  phaseTimer = setTimeout(() => {
    phaseTimer = null;
    onSolverFadeComplete();
  }, FADE_DURATION_MS);
}

function onSolverFadeComplete() {
  const timedOut = trace.phase === SolverPhase.TIMEOUT;
  trace.phase = SolverPhase.COMPLETE;
  trace.fadeAlpha = config.targetFadeOpacity;
  theme.onLifecycleEvent(LifecycleEvent.SOLVER_FADE_COMPLETE, { solverKey: trace.solverKey });
  solverHistory.push({
    solverKey: trace.solverKey,
    displayMs: solverFrozenMs >= 0
      ? solverFrozenMs
      : Math.max(0, performance.now() - solverWallStartTime),
    timedOut,
  });
  solverIndex++;
  if (solverIndex >= selectedSolvers.length) {
    onCycleEnd();
  } else {
    runState = State.SOLVER_INIT;
    updateHud();
    initNextSolver(false);
  }
}

function onCycleEnd() {
  runState = State.CYCLE_END;
  theme.onLifecycleEvent(LifecycleEvent.CYCLE_RESET);
  clearPhaseTimer();
  phaseTimer = setTimeout(() => {
    phaseTimer = null;
    runState = State.IDLE;
    startCycle();
  }, RESET_BEAT_MS);
}

// ---------- rAF loop ----------

function loop() {
  try {
    tick();
  } catch (err) {
    console.error("amaze: loop error", err);
  }
  requestAnimationFrame(loop);
}

function tick() {
  if (!renderer) return;

  switch (runState) {
    case State.GENERATING: {
      const done = advanceGeneration();
      const g = generator ? generator.getGrid() : grid;
      renderer.render({
        grid: g,
        trace: null,
        theme,
        isGenerating: true,
      });
      if (done) onGenerationComplete();
      break;
    }
    case State.GENERATION_BEAT:
    case State.SOLVER_INIT: {
      renderer.render({
        grid,
        trace: null,
        theme,
        isGenerating: false,
      });
      break;
    }
    case State.SOLVING: {
      refreshHudTime();
      renderer.render({
        grid,
        trace,
        theme,
        isGenerating: false,
      });
      break;
    }
    case State.SOLVED_HOLD:
    case State.TIMEOUT_HOLD: {
      renderer.render({
        grid,
        trace,
        theme,
        isGenerating: false,
      });
      break;
    }
    case State.FADING: {
      // Update fadeAlpha linearly toward targetFadeOpacity.
      if (trace) {
        const elapsed = performance.now() - fadeStartTime;
        const progress = Math.max(0, Math.min(1, elapsed / FADE_DURATION_MS));
        trace.fadeAlpha = 1.0 - progress * (1.0 - config.targetFadeOpacity);
      }
      renderer.render({
        grid,
        trace,
        theme,
        isGenerating: false,
      });
      break;
    }
    case State.CYCLE_END: {
      renderer.render({
        grid,
        trace,
        theme,
        isGenerating: false,
      });
      break;
    }
    case State.IDLE:
    default:
      // Idle frame: draw nothing (or background only). Keep rAF running.
      break;
  }
}

// ---------- Bootstrap ----------

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
