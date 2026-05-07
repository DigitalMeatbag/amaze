import { BaseTheme, lerpHex } from "./base.js";
import { SemanticState, LifecycleEvent } from "./index.js";
import { CellType } from "../maze.js";

export class StoneTheme extends BaseTheme {
  constructor() {
    super(
      {
        bg:         "#080810",
        wall:       "#8888AA",
        wallEmerge: "#3A3A55",
        floor:      "#2A2A3A",
        start:      "#CCCCFF",
        goal:       "#AAAAFF",
        actor:      "#EEEEFF",
        generating: "#555577",
      },
      {
        wall: "#",
        floor: ".",
        start: ">",
        goal: "X",
        actor: "@",
        generating: "*",
      }
    );
    this._rooms = [];
    this._roomForCell = null; // Int8Array indexed by row*D_cols+col; value = room index or -1
    this._mazeGrid = null;
    this._mazeD_cols = 0;
  }

  _solveAccent() { return "#FFFFFF"; }
  timeoutActorGlyph() { return "+"; }
  timeoutActorColor() { return "#444455"; }

  onLifecycleEvent(event, data = {}) {
    super.onLifecycleEvent(event, data);
    if (event === LifecycleEvent.MAZE_READY) {
      this._rooms = data.rooms || [];
      this._mazeGrid = data.grid || null;
      this._mazeD_cols = data.D_cols || 0;
      if (this._mazeGrid && this._mazeD_cols > 0 && this._rooms.length > 0) {
        const D_rows = (this._mazeGrid.length / this._mazeD_cols) | 0;
        this._buildRoomForCell(this._mazeD_cols, D_rows);
      }
    } else if (event === LifecycleEvent.CYCLE_RESET) {
      this._rooms = [];
      this._roomForCell = null;
      this._mazeGrid = null;
      this._mazeD_cols = 0;
    }
  }

  _buildRoomForCell(D_cols, D_rows) {
    const arr = new Int8Array(D_cols * D_rows).fill(-1);
    for (let i = 0; i < this._rooms.length && i < 127; i++) {
      const { x, y, w, h } = this._rooms[i];
      for (let r = Math.max(0, y); r < y + h && r < D_rows; r++) {
        for (let c = Math.max(0, x); c < x + w && c < D_cols; c++) {
          arr[r * D_cols + c] = i;
        }
      }
    }
    this._roomForCell = arr;
  }

  // Room-stamp: FLOOR cells inside rooms flash #AAAACC on their stamp beat, then
  // settle permanently to palette.wall for the rest of the cycle.
  renderCell(args) {
    if (args.semantic === SemanticState.FLOOR && this._roomForCell && this._mazeD_cols > 0) {
      const { col, row } = args;
      const roomIdx = this._roomForCell[row * this._mazeD_cols + col];
      if (roomIdx >= 0) {
        const mb = this._beatProgress(this.mazeReadyBeat);
        if (mb !== null) {
          const N = this._rooms.length;
          const tAppear = N > 1 ? (roomIdx / N) * 0.75 : 0;
          if (mb >= tAppear) {
            // Flash: #AAAACC → palette.wall over ~0.2 beat progress.
            const localT = Math.min(1.0, (mb - tAppear) / 0.2);
            const flashColor = lerpHex("#AAAACC", this.palette.wall, localT);
            const backup = this.palette.floor;
            this.palette.floor = flashColor;
            super.renderCell(args);
            this.palette.floor = backup;
            return;
          }
          // Before stamp: dark floor, no override.
        } else {
          // Beat done: room floors stay wall-colored permanently for this cycle.
          const backup = this.palette.floor;
          this.palette.floor = this.palette.wall;
          super.renderCell(args);
          this.palette.floor = backup;
          return;
        }
      }
    }
    super.renderCell(args);
  }

  // Drip: `·` glyphs fall one row per 4 frames on WALL cells, one per 300 frames per column.
  renderOverlay(ctx, D_cols, D_rows, cw, ch, frameCount) {
    if (this.intensity === "low") return;
    if (!this._mazeGrid || this._mazeD_cols !== D_cols) return;
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const maxPhase = D_rows * 4;
    for (let c = 0; c < D_cols; c++) {
      const phase = (frameCount + c * 47) % 300;
      if (phase >= maxPhase) continue;
      const row = (phase / 4) | 0;
      if (this._mazeGrid[row * D_cols + c] !== CellType.WALL) continue;
      const alpha = 0.55 * Math.sin((phase / maxPhase) * Math.PI);
      if (alpha <= 0) continue;
      ctx.fillStyle = `rgba(136,136,170,${alpha.toFixed(3)})`;
      ctx.fillText("·", c * cw + cw / 2, row * ch + ch / 2);
    }
    ctx.restore();
  }
}
