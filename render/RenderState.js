const CURSOR_FADE_MS = 500;

export class RenderState {
  constructor() {
    this.displayActorCol = -1;
    this.displayActorRow = -1;
    this.attentionFloor  = 0;
    this.cursorState     = { col: -1, row: -1, alpha: 0, fadeStart: null };

    // Pre-allocated render args object — mutated each frame, never replaced.
    this._args = {
      grid: null, trace: null, theme: null,
      isGenerating: false, cursorState: this.cursorState,
      displayActorCol: -1, displayActorRow: -1, attentionFloor: 0,
    };
  }

  clearCursor() {
    this.cursorState.alpha     = 0;
    this.cursorState.col       = -1;
    this.cursorState.row       = -1;
    this.cursorState.fadeStart = null;
  }

  setActorPosition(col, row) {
    this.displayActorCol = col;
    this.displayActorRow = row;
  }

  syncActorFromTrace(trace) {
    if (trace && trace.actorCell) {
      this.displayActorCol = trace.actorCell[0];
      this.displayActorRow = trace.actorCell[1];
    }
  }

  updateCursorFade(now) {
    const cs = this.cursorState;
    if (cs.fadeStart !== null) {
      const elapsed = now - cs.fadeStart;
      cs.alpha = Math.max(0, 1.0 - elapsed / CURSOR_FADE_MS);
      if (cs.alpha === 0) { cs.fadeStart = null; cs.col = -1; cs.row = -1; }
    }
  }

  // Mutates and returns the pre-allocated render args object.
  buildRenderArgs(grid, trace, theme, isGenerating, attentionFloor) {
    const a = this._args;
    a.grid             = grid;
    a.trace            = trace;
    a.theme            = theme;
    a.isGenerating     = isGenerating;
    a.displayActorCol  = this.displayActorCol;
    a.displayActorRow  = this.displayActorRow;
    a.attentionFloor   = attentionFloor !== undefined ? attentionFloor : this.attentionFloor;
    // cursorState is the same object reference (mutated in-place elsewhere)
    return a;
  }
}
