// Bootstrap. Wires together all subsystems and starts the run loop.

import { Renderer } from "./renderer.js";
import { ConfigStore } from "./config/ConfigStore.js";
import { WallpaperEngineAdapter } from "./config/WallpaperEngineAdapter.js";
import { HUD } from "./hud/HUD.js";
import { RenderState } from "./render/RenderState.js";
import { CycleStateMachine } from "./cycle/CycleStateMachine.js";
import { LifecycleBus } from "./events/LifecycleBus.js";
import { LifecycleEvent } from "./themes/index.js";

const RESIZE_DEBOUNCE_MS = 150;

function init() {
  const canvas = document.getElementById("canvas");
  if (!canvas) { console.error("amaze: missing #canvas element"); return; }

  const renderer    = new Renderer(canvas);
  const config      = new ConfigStore();
  const bus         = new LifecycleBus();
  const hud         = new HUD(document);
  const renderState = new RenderState();
  const machine     = new CycleStateMachine({ renderer, config, hud, renderState, bus });
  const weAdapter   = new WallpaperEngineAdapter();

  // Wire lifecycle events through the bus. CycleStateMachine emits events;
  // themes and HUD subscribe here so the state machine has no direct knowledge of them.
  bus.on(LifecycleEvent.MAZE_READY,           (d) => machine.currentTheme.onLifecycleEvent(LifecycleEvent.MAZE_READY, d));
  bus.on(LifecycleEvent.SOLVER_START,         (d) => {
    machine.currentTheme.onLifecycleEvent(LifecycleEvent.SOLVER_START, d);
    hud.onSolverStart(d.solverKey);
  });
  bus.on(LifecycleEvent.WALK_TO_GOAL_BEAT,    (d) => machine.currentTheme.onLifecycleEvent(LifecycleEvent.WALK_TO_GOAL_BEAT, d));
  bus.on(LifecycleEvent.SOLVER_SOLVED,        (d) => machine.currentTheme.onLifecycleEvent(LifecycleEvent.SOLVER_SOLVED, d));
  bus.on(LifecycleEvent.SOLVER_TIMEOUT,       (d) => machine.currentTheme.onLifecycleEvent(LifecycleEvent.SOLVER_TIMEOUT, d));
  bus.on(LifecycleEvent.SOLVER_FADE_COMPLETE, (d) => {
    machine.currentTheme.onLifecycleEvent(LifecycleEvent.SOLVER_FADE_COMPLETE, d);
    hud.onSolverComplete(d.solverKey, d.displayMs, d.timedOut);
  });
  bus.on(LifecycleEvent.CYCLE_RESET, () => machine.currentTheme.onLifecycleEvent(LifecycleEvent.CYCLE_RESET));

  weAdapter.attach({ config, renderer, hud, renderState, cycle: machine });

  // Cursor light tracking.
  canvas.addEventListener("mousemove", (e) => {
    if (!config.get("cursorLight")) { renderState.clearCursor(); return; }
    const rect = canvas.getBoundingClientRect();
    const cs   = renderState.cursorState;
    cs.col       = Math.max(0, Math.min(renderer.D_cols - 1, Math.floor((e.clientX - rect.left) / renderer.cw)));
    cs.row       = Math.max(0, Math.min(renderer.D_rows - 1, Math.floor((e.clientY - rect.top)  / renderer.ch)));
    cs.alpha     = 1.0;
    cs.fadeStart = null;
  });
  canvas.addEventListener("mouseleave", () => {
    renderState.cursorState.fadeStart = performance.now();
  });

  // HUD toggle (h key).
  document.addEventListener("keydown", (e) => {
    if (e.key.toLowerCase() === "h") {
      const next = !config.get("hudVisible");
      config.set("hudVisible", next);
      hud.setVisible(next);
    }
  });

  // Resize debounce.
  let resizeDebounce = null;
  window.addEventListener("resize", () => {
    if (resizeDebounce !== null) clearTimeout(resizeDebounce);
    resizeDebounce = setTimeout(() => {
      resizeDebounce = null;
      machine.restart();
    }, RESIZE_DEBOUNCE_MS);
  });

  renderer.whenFontReady().then(() => machine.start());
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
