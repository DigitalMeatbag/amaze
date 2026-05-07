import { SOLVER_COLORS, SOLVER_LABELS } from "../solvers/index.js";
import { GENERATOR_LABELS } from "../generators/index.js";

export class HUD {
  constructor(doc) {
    this._el         = doc.getElementById("hud");
    this._elTheme    = doc.getElementById("hud-theme");
    this._elGen      = doc.getElementById("hud-gen");
    this._elName     = doc.getElementById("hud-solver-name");
    this._elTime     = doc.getElementById("hud-solver-time");
    this._elPrev     = doc.getElementById("hud-prev");

    this._visible        = true;
    this._themeKey       = null;
    this._genKey         = null;
    this._solverKey      = null;
    this._showSolver     = false;
    this._wallStartTime  = 0;
    this._frozenMs       = -1;
    this._history        = [];  // [{solverKey, displayMs, timedOut}]
  }

  setVisible(v) {
    this._visible = v;
    if (this._el) this._el.style.display = v ? "" : "none";
  }

  applyTheme(themeKey, themeObj) {
    this._themeKey = themeKey;
    if (!this._el) return;
    const c = themeObj.hudPalette();
    this._el.style.setProperty("--hud-text",   c.text);
    this._el.style.setProperty("--hud-label",  c.label);
    this._el.style.setProperty("--hud-border", c.border);
    this._el.style.setProperty("--hud-sep",    c.sep);
    this._update();
  }

  onGenerationStart(genKey) {
    this._genKey     = genKey;
    this._history    = [];
    this._frozenMs   = -1;
    this._showSolver = false;
    this._solverKey  = null;
    this._update();
  }

  onSolverStart(solverKey) {
    this._solverKey     = solverKey;
    this._wallStartTime = performance.now();
    this._frozenMs      = -1;
    this._showSolver    = true;
    this._update();
  }

  freezeSolverTime(ms) {
    this._frozenMs = ms;
  }

  onSolverComplete(solverKey, displayMs, timedOut) {
    this._history.push({ solverKey, displayMs, timedOut });
    this._showSolver = false;
    this._solverKey  = null;
    this._frozenMs   = -1;
    this._update();
  }

  tick() {
    if (!this._visible || !this._elTime || this._frozenMs >= 0) return;
    this._elTime.textContent = this._formatMs(Math.max(0, performance.now() - this._wallStartTime));
  }

  _formatMs(ms) {
    return (ms / 1000).toFixed(1) + "s";
  }

  _update() {
    if (!this._elGen) return;

    if (this._elTheme) {
      const k = this._themeKey;
      this._elTheme.textContent = k ? k[0].toUpperCase() + k.slice(1) : "—";
    }

    this._elGen.textContent = this._genKey
      ? (GENERATOR_LABELS[this._genKey] ?? this._genKey)
      : "—";

    if (this._showSolver && this._solverKey) {
      this._elName.textContent = SOLVER_LABELS[this._solverKey] ?? this._solverKey;
      this._elName.style.color = SOLVER_COLORS[this._solverKey]?.breadcrumb ?? "#ffffff";
      const ms = this._frozenMs >= 0
        ? this._frozenMs
        : Math.max(0, performance.now() - this._wallStartTime);
      this._elTime.textContent = this._formatMs(ms);
    } else {
      this._elName.textContent = "—";
      this._elName.style.color = "";
      this._elTime.textContent = "—";
    }

    this._elPrev.innerHTML = "";
    for (const h of this._history) {
      const row = document.createElement("div");
      row.className = "hud-prev-row";
      const nameEl = document.createElement("span");
      nameEl.className = "hud-prev-name";
      nameEl.textContent = SOLVER_LABELS[h.solverKey] ?? h.solverKey;
      nameEl.style.color = SOLVER_COLORS[h.solverKey]?.breadcrumb ?? "#888";
      const timeEl = document.createElement("span");
      timeEl.className = "hud-prev-time";
      timeEl.textContent = this._formatMs(h.displayMs);
      row.appendChild(nameEl);
      row.appendChild(timeEl);
      this._elPrev.appendChild(row);
    }
  }
}
