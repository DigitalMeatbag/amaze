const DEFAULT_CONFIG = {
  theme:              "random",
  scale:              "medium",
  intensity:          "medium",
  stepIntervalMs:     80,
  targetFadeOpacity:  0,
  maxSolveMultiplier: 1.0,
  cursorLight:        true,
  hudVisible:         true,
};

export class ConfigStore {
  constructor() {
    this._config    = { ...DEFAULT_CONFIG };
    this._listeners = new Map();
  }

  get(key) {
    return this._config[key];
  }

  set(key, val) {
    this._config[key] = val;
    const fns = this._listeners.get(key);
    if (fns) for (const fn of fns) fn(val);
  }

  onChange(key, fn) {
    if (!this._listeners.has(key)) this._listeners.set(key, []);
    this._listeners.get(key).push(fn);
  }
}
