import { CellType, placeStartGoal } from "../maze.js";
import { makeGenerator, pickGenerator } from "../generators/index.js";
import { makeSolver, newTrace, selectSolvers, SolverPhase } from "../solvers/index.js";
import { LifecycleEvent, makeTheme } from "../themes/index.js";

// ---------- Timing constants (spec §9.1) ----------
const PATH_HOLD_MS             = 2500;
const FADE_DURATION_MS         = 1500;
const INTER_SOLVER_MS          = 500;
const FIRST_SOLVER_DELAY       = 0;
const RESET_BEAT_MS            = 1000;
const BEAT_SHOW_MS             = 600;
const GENERATION_TARGET_FRAMES = 240;

const State = Object.freeze({
  IDLE:            "idle",
  GENERATING:      "generating",
  GENERATION_BEAT: "generation_beat",
  SOLVER_INIT:     "solver_init",
  SOLVING:         "solving",
  BEAT_PENDING:    "beat_pending",
  WALK_TO_GOAL:    "walk_to_goal",
  SOLVED_HOLD:     "solved_hold",
  TIMEOUT_HOLD:    "timeout_hold",
  FADING:          "fading",
  SOLVER_COMPLETE: "solver_complete",
  CYCLE_END:       "cycle_end",
});

function computeMaxSolveMs(D_cols, D_rows, multiplier) {
  const gridAwareSeconds = Math.min(5 * Math.sqrt(D_cols * D_rows), 600);
  return Math.round(gridAwareSeconds * multiplier * 1000);
}

export class CycleStateMachine {
  constructor({ renderer, config, hud, renderState, bus }) {
    this._renderer    = renderer;
    this._config      = config;
    this._hud         = hud;
    this._renderState = renderState;
    this._bus         = bus;

    // Per-cycle data.
    this._theme                  = null;
    this._activeThemeKey         = null;
    this._grid                   = null;
    this._generator              = null;
    this._generatorTotalSteps    = 0;
    this._generatorStepsPerFrame = 1;
    this._generatorFramesPerStep = 1;
    this._generatorFrameCounter  = 0;
    this._startIdx               = -1;
    this._goalIdx                = -1;
    this._selectedSolvers        = [];
    this._solverIndex            = 0;
    this._activeSolver           = null;
    this._trace                  = null;
    this._solverInterval         = null;
    this._walkInterval           = null;
    this._maxSolveMs             = 60000;

    // Solver timing — tracked here so fade-complete can read them.
    this._solverWallStartTime = 0;
    this._frozenMs            = -1;
    this._solverTimedOut      = false;

    // Transition timing.
    this._phaseTimer              = null;
    this._fadeStartTime           = 0;
    this._generationBeatStartTime = 0;
    this._solverInitStartTime     = 0;
    this._solverInitLerpFromCol   = -1;
    this._solverInitLerpFromRow   = -1;

    this._runState = State.IDLE;

    // React to live stepInterval changes.
    this._config.onChange("stepIntervalMs", () => this._updateSolverInterval());
  }

  get currentTheme() { return this._theme; }
  get state()        { return this._runState; }

  // ---------- Public API ----------

  start() {
    this._startCycle();
    requestAnimationFrame((now) => this.tick(now));
  }

  restart() {
    this._clearPhaseTimer();
    this._clearSolverInterval();
    this._clearWalkInterval();
    this._trace        = null;
    this._activeSolver = null;
    this._generator    = null;
    this._grid         = null;
    this._startIdx     = -1;
    this._goalIdx      = -1;
    this._runState     = State.IDLE;
    this._startCycle();
  }

  tick(now) {
    this._renderState.updateCursorFade(now);

    switch (this._runState) {
      case State.GENERATING: {
        const done = this._advanceGeneration();
        const g = this._generator ? this._generator.getGrid() : this._grid;
        this._renderer.render(
          this._renderState.buildRenderArgs(g, null, this._theme, true, 0)
        );
        if (done) this._onGenerationComplete();
        break;
      }
      case State.GENERATION_BEAT: {
        const elapsed = now - this._generationBeatStartTime;
        const floor   = Math.max(0, 1.0 - elapsed / RESET_BEAT_MS);
        this._renderer.render(
          this._renderState.buildRenderArgs(this._grid, null, this._theme, false, floor)
        );
        break;
      }
      case State.SOLVER_INIT: {
        if (this._startIdx >= 0 && this._solverInitLerpFromCol >= 0) {
          const elapsed = now - this._solverInitStartTime;
          const t       = Math.min(1.0, elapsed / INTER_SOLVER_MS);
          const tCol    = this._startIdx % this._renderer.D_cols;
          const tRow    = (this._startIdx / this._renderer.D_cols) | 0;
          this._renderState.setActorPosition(
            Math.round(this._solverInitLerpFromCol + t * (tCol - this._solverInitLerpFromCol)),
            Math.round(this._solverInitLerpFromRow + t * (tRow - this._solverInitLerpFromRow))
          );
        }
        this._renderer.render(
          this._renderState.buildRenderArgs(this._grid, null, this._theme, false, 0)
        );
        break;
      }
      case State.SOLVING: {
        this._hud.tick();
        this._renderState.syncActorFromTrace(this._trace);
        this._renderer.render(
          this._renderState.buildRenderArgs(this._grid, this._trace, this._theme, false, 0)
        );
        break;
      }
      case State.BEAT_PENDING:
      case State.WALK_TO_GOAL: {
        this._renderState.syncActorFromTrace(this._trace);
        this._renderer.render(
          this._renderState.buildRenderArgs(this._grid, this._trace, this._theme, false, 0)
        );
        break;
      }
      case State.SOLVED_HOLD:
      case State.TIMEOUT_HOLD: {
        this._renderer.render(
          this._renderState.buildRenderArgs(this._grid, this._trace, this._theme, false, 0)
        );
        break;
      }
      case State.FADING: {
        if (this._trace) {
          const elapsed  = now - this._fadeStartTime;
          const progress = Math.max(0, Math.min(1, elapsed / FADE_DURATION_MS));
          this._trace.fadeAlpha = 1.0 - progress * (1.0 - this._config.get("targetFadeOpacity"));
        }
        this._renderer.render(
          this._renderState.buildRenderArgs(this._grid, this._trace, this._theme, false, 0)
        );
        break;
      }
      case State.CYCLE_END: {
        this._renderer.render(
          this._renderState.buildRenderArgs(this._grid, this._trace, this._theme, false, 0)
        );
        break;
      }
      case State.IDLE:
      default:
        break;
    }

    requestAnimationFrame((t) => this.tick(t));
  }

  // ---------- Cycle lifecycle ----------

  _startCycle() {
    const t = makeTheme(this._config.get("theme"));
    this._theme          = t.theme;
    this._activeThemeKey = t.key;
    this._theme.setIntensity(this._config.get("intensity"));
    this._hud.applyTheme(this._activeThemeKey, this._theme);
    this._hud.setVisible(this._config.get("hudVisible"));

    const dims = this._renderer.resize(this._config.get("scale"), this._theme.backgroundColor);
    this._maxSolveMs = computeMaxSolveMs(dims.D_cols, dims.D_rows, this._config.get("maxSolveMultiplier"));

    const genKey = pickGenerator(this._activeThemeKey);
    this._generator = makeGenerator(genKey);
    this._hud.onGenerationStart(genKey);

    this._grid = new Uint8Array(dims.D_cols * dims.D_rows);
    this._grid.fill(CellType.WALL);
    this._generator.begin(this._grid, dims.D_cols, dims.D_rows, Math.random);

    this._generatorTotalSteps = Math.max(1, this._generator.totalSteps(dims.D_cols, dims.D_rows));
    const fps = this._generator.framesPerStep();
    if (fps !== null) {
      this._generatorFramesPerStep = fps;
      this._generatorStepsPerFrame = 1;
    } else {
      this._generatorFramesPerStep = 1;
      this._generatorStepsPerFrame = Math.max(1, Math.floor(this._generatorTotalSteps / GENERATION_TARGET_FRAMES));
    }
    this._generatorFrameCounter = 0;

    this._selectedSolvers = selectSolvers();
    this._solverIndex     = 0;

    this._renderState.displayActorCol = -1;
    this._renderState.displayActorRow = -1;
    this._renderState.attentionFloor  = 0;
    this._generationBeatStartTime     = 0;
    this._solverInitStartTime         = 0;
    this._solverInitLerpFromCol       = -1;
    this._solverInitLerpFromRow       = -1;

    this._runState = State.GENERATING;
  }

  _advanceGeneration() {
    if (!this._generator) return false;
    if (this._generatorFramesPerStep > 1) {
      this._generatorFrameCounter++;
      if (this._generatorFrameCounter < this._generatorFramesPerStep) return false;
      this._generatorFrameCounter = 0;
      return this._generator.step();
    }
    let done = false;
    for (let i = 0; i < this._generatorStepsPerFrame; i++) {
      done = this._generator.step();
      if (done) break;
    }
    return done;
  }

  _onGenerationComplete() {
    this._grid = this._generator.getGrid();
    const placement = placeStartGoal(this._grid, this._renderer.D_cols, this._renderer.D_rows);
    if (placement) {
      this._startIdx = placement.startIdx;
      this._goalIdx  = placement.goalIdx;
    } else {
      this._startIdx = this._grid.findIndex((v) => v === CellType.FLOOR);
      if (this._startIdx >= 0) {
        this._grid[this._startIdx] = CellType.START;
        for (let i = this._grid.length - 1; i >= 0; i--) {
          if (this._grid[i] === CellType.FLOOR) {
            this._goalIdx = i;
            this._grid[i] = CellType.GOAL;
            break;
          }
        }
      }
    }
    this._bus.emit(LifecycleEvent.MAZE_READY, {
      rooms:  this._generator.rooms ? this._generator.rooms.slice() : [],
      grid:   this._grid,
      D_cols: this._renderer.D_cols,
    });
    if (this._startIdx >= 0) {
      this._renderState.setActorPosition(
        this._startIdx % this._renderer.D_cols,
        (this._startIdx / this._renderer.D_cols) | 0
      );
    }
    this._renderState.attentionFloor  = 1.0;
    this._generationBeatStartTime     = performance.now();
    this._runState = State.GENERATION_BEAT;
    this._clearPhaseTimer();
    this._phaseTimer = setTimeout(() => {
      this._phaseTimer = null;
      this._runState = State.SOLVER_INIT;
      this._initNextSolver(true);
    }, RESET_BEAT_MS);
  }

  // ---------- Solver lifecycle ----------

  _initNextSolver(isFirst) {
    const delay = isFirst ? FIRST_SOLVER_DELAY : INTER_SOLVER_MS;
    this._clearPhaseTimer();
    this._phaseTimer = setTimeout(() => {
      this._phaseTimer = null;
      if (this._solverIndex >= this._selectedSolvers.length) {
        this._onCycleEnd();
        return;
      }
      const key = this._selectedSolvers[this._solverIndex];
      this._activeSolver = makeSolver(key);
      this._trace        = newTrace(key);
      if (this._startIdx < 0 || this._goalIdx < 0) {
        this._onCycleEnd();
        return;
      }
      this._activeSolver.begin(
        this._grid, this._renderer.D_cols, this._renderer.D_rows,
        this._trace, Math.random, this._startIdx, this._goalIdx
      );
      this._solverWallStartTime = performance.now();
      this._frozenMs            = -1;
      this._solverTimedOut      = false;
      this._bus.emit(LifecycleEvent.SOLVER_START, { solverKey: key });
      this._runState   = State.SOLVING;
      this._solverInterval = setInterval(() => this._stepSolverTick(), this._config.get("stepIntervalMs"));
    }, delay);
  }

  _stepSolverTick() {
    if (!this._activeSolver || !this._trace) return;
    if (this._trace.phase !== SolverPhase.SEARCHING) return;
    try {
      this._activeSolver.step();
    } catch (err) {
      console.error("amaze: solver step error", err);
      this._trace.phase = SolverPhase.TIMEOUT;
    }
    this._trace.elapsedMs += this._config.get("stepIntervalMs");
    this._trace.stepCount++;
    if (this._trace.elapsedMs >= this._maxSolveMs && this._trace.phase === SolverPhase.SEARCHING) {
      this._trace.phase = SolverPhase.TIMEOUT;
    }
    if (this._trace.phase === SolverPhase.SOLVED)   this._onSolverFound();
    else if (this._trace.phase === SolverPhase.TIMEOUT) this._onSolverTimeout();
  }

  _onSolverFound() {
    this._clearSolverInterval();
    this._frozenMs       = Math.max(0, performance.now() - this._solverWallStartTime);
    this._solverTimedOut = false;
    this._hud.freezeSolverTime(this._frozenMs);
    this._trace.beatGlyph = "!";
    this._bus.emit(LifecycleEvent.WALK_TO_GOAL_BEAT, { solverKey: this._trace.solverKey });
    this._runState = State.BEAT_PENDING;
    this._clearPhaseTimer();
    this._phaseTimer = setTimeout(() => {
      this._phaseTimer = null;
      this._beginWalkToGoal();
    }, BEAT_SHOW_MS);
  }

  _beginWalkToGoal() {
    const isRandomWalk = this._trace.solverKey === "randomwalk";
    if (isRandomWalk || !this._trace.walkPath || this._trace.walkPath.length === 0) {
      this._onSolverSolved();
      return;
    }
    this._trace.walkIndex = 0;
    this._runState = State.WALK_TO_GOAL;
    const WALK_STEP_MS = Math.max(10, Math.floor(this._config.get("stepIntervalMs") / 2));
    this._walkInterval = setInterval(() => this._stepWalkTick(), WALK_STEP_MS);
  }

  _stepWalkTick() {
    if (!this._trace || this._trace.walkIndex >= this._trace.walkPath.length) {
      this._clearWalkInterval();
      this._onSolverSolved();
      return;
    }
    const idx = this._trace.walkPath[this._trace.walkIndex];
    this._trace.actorCell = [idx % this._renderer.D_cols, (idx / this._renderer.D_cols) | 0];
    this._trace.walkIndex++;
    if (this._trace.walkIndex >= this._trace.walkPath.length) {
      this._clearWalkInterval();
      this._onSolverSolved();
    }
  }

  _onSolverSolved() {
    this._clearWalkInterval();
    this._trace.beatGlyph = null;
    this._bus.emit(LifecycleEvent.SOLVER_SOLVED, { solverKey: this._trace.solverKey });
    this._runState = State.SOLVED_HOLD;
    this._clearPhaseTimer();
    this._phaseTimer = setTimeout(() => {
      this._phaseTimer = null;
      this._beginFade();
    }, PATH_HOLD_MS);
  }

  _onSolverTimeout() {
    this._clearSolverInterval();
    this._frozenMs       = Math.max(0, performance.now() - this._solverWallStartTime);
    this._solverTimedOut = true;
    this._hud.freezeSolverTime(this._frozenMs);
    this._bus.emit(LifecycleEvent.SOLVER_TIMEOUT, { solverKey: this._trace.solverKey });
    this._runState = State.TIMEOUT_HOLD;
    this._clearPhaseTimer();
    this._phaseTimer = setTimeout(() => {
      this._phaseTimer = null;
      this._beginFade();
    }, PATH_HOLD_MS);
  }

  _beginFade() {
    this._trace.phase   = SolverPhase.FADING;
    this._fadeStartTime = performance.now();
    this._runState      = State.FADING;
    this._clearPhaseTimer();
    this._phaseTimer = setTimeout(() => {
      this._phaseTimer = null;
      this._onSolverFadeComplete();
    }, FADE_DURATION_MS);
  }

  _onSolverFadeComplete() {
    const timedOut  = this._solverTimedOut;
    const solverKey = this._trace.solverKey;
    const displayMs = this._frozenMs >= 0
      ? this._frozenMs
      : Math.max(0, performance.now() - this._solverWallStartTime);
    this._trace.phase     = SolverPhase.COMPLETE;
    this._trace.fadeAlpha = this._config.get("targetFadeOpacity");
    this._bus.emit(LifecycleEvent.SOLVER_FADE_COMPLETE, { solverKey, displayMs, timedOut });
    this._solverIndex++;
    if (this._solverIndex >= this._selectedSolvers.length) {
      this._onCycleEnd();
    } else {
      this._solverInitStartTime   = performance.now();
      this._solverInitLerpFromCol = this._renderState.displayActorCol;
      this._solverInitLerpFromRow = this._renderState.displayActorRow;
      this._runState = State.SOLVER_INIT;
      this._initNextSolver(false);
    }
  }

  _onCycleEnd() {
    this._runState = State.CYCLE_END;
    this._bus.emit(LifecycleEvent.CYCLE_RESET);
    this._clearPhaseTimer();
    this._phaseTimer = setTimeout(() => {
      this._phaseTimer = null;
      this._runState = State.IDLE;
      this._startCycle();
    }, RESET_BEAT_MS);
  }

  // ---------- Timer helpers ----------

  _clearPhaseTimer() {
    if (this._phaseTimer !== null) { clearTimeout(this._phaseTimer); this._phaseTimer = null; }
  }

  _clearSolverInterval() {
    if (this._solverInterval !== null) { clearInterval(this._solverInterval); this._solverInterval = null; }
  }

  _clearWalkInterval() {
    if (this._walkInterval !== null) { clearInterval(this._walkInterval); this._walkInterval = null; }
  }

  _updateSolverInterval() {
    if (this._solverInterval === null || !this._trace || this._trace.phase !== SolverPhase.SEARCHING) return;
    clearInterval(this._solverInterval);
    this._solverInterval = setInterval(() => this._stepSolverTick(), this._config.get("stepIntervalMs"));
  }
}
