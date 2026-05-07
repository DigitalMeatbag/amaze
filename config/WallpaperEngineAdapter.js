// Maps Wallpaper Engine property changes to ConfigStore mutations.
// Adding a new WE property = one row in WE_PROPERTIES, no if-chain edit.

const WE_PROPERTIES = {
  theme: {
    restart: true,
    apply: (v, ctx) => ctx.config.set("theme", v),
  },
  scale: {
    restart: true,
    apply: (v, ctx) => ctx.config.set("scale", v),
  },
  intensity: {
    restart: false,
    apply: (v, ctx) => {
      ctx.config.set("intensity", v);
      ctx.renderer?.setIntensity(v);
      ctx.cycle?.currentTheme?.setIntensity(v);
    },
  },
  stepInterval: {
    restart: false,
    apply: (v, ctx) => ctx.config.set("stepIntervalMs", v),
  },
  fadeOpacity: {
    restart: false,
    apply: (v, ctx) => ctx.config.set("targetFadeOpacity", v),
  },
  maxSolveTime: {
    restart: false,
    apply: (v, ctx) => ctx.config.set("maxSolveMultiplier", v),
  },
  cursorLight: {
    restart: false,
    apply: (v, ctx) => {
      ctx.config.set("cursorLight", v);
      if (!v) ctx.renderState.clearCursor();
    },
  },
  hudVisible: {
    restart: false,
    apply: (v, ctx) => {
      ctx.config.set("hudVisible", v);
      ctx.hud.setVisible(v);
    },
  },
};

export class WallpaperEngineAdapter {
  attach(ctx) {
    const listener = {
      applyUserProperties(props) {
        let needsRestart = false;
        try {
          for (const [propKey, descriptor] of Object.entries(WE_PROPERTIES)) {
            const prop = props[propKey];
            if (prop && prop.value !== undefined) {
              descriptor.apply(prop.value, ctx);
              if (descriptor.restart) needsRestart = true;
            }
          }
        } catch (err) {
          console.warn("amaze: error applying WE properties", err);
        }
        if (needsRestart) ctx.cycle.restart();
      },
      applyGeneralProperties(_props) {
        // FPS limits etc. — no special handling needed.
      },
    };
    if (typeof window !== "undefined") {
      window.wallpaperPropertyListener = listener;
    }
  }
}
