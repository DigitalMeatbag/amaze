# amaze - Foundation Document

> **Purpose:** This living document captures the intent, constraints, aesthetic direction, open questions, and early decisions for `amaze`, a Wallpaper Engine wallpaper built around ASCII maze generation and embodied solver animation. It is not yet an implementation spec; it is the upstream source that will feed one.

---

## Intent

`amaze` is a Wallpaper Engine wallpaper that continuously generates a full-screen maze, animates one or more solving algorithms traversing that maze, then resets into a new maze and repeats.

The wallpaper should be satisfying to leave running in the background and rewarding to stare at. Its value comes from the combination of:

- classic terminal roguelike visual language
- procedural maze variety
- solver behavior that feels embodied and watchable
- enough algorithmic depth that repeated runs remain interesting

The core loop is:

1. Generate a maze sized to the current wallpaper viewport.
2. Select a subset of available solver algorithms.
3. Run each selected solver sequentially on the same maze.
4. Show the solver moving through the maze as a terminal actor.
5. Show the final solved path briefly.
6. Fade the solver's markings to the configured target opacity.
7. Move to the next solver.
8. After all selected solvers have run, generate a new maze and repeat.

---

## Product Philosophy

The wallpaper should feel like watching an old-school terminal roguelike think.

The viewer should see a little symbolic actor explore a dungeon-like maze, leave breadcrumbs, reveal a solved path, disappear, and then watch another solver attack the same maze with different habits.

This is not a glossy puzzle game, not a generic neon screensaver, and not a tile-art maze. It is a living ANSI terminal artifact.

---

## Aesthetic Direction

The primary visual lineage is classic terminal roguelikes such as Angband, NetHack, and adjacent ASCII dungeon crawlers.

The wallpaper should use:

- monospaced grid layout
- ASCII-first glyphs for the main semantic map tiles
- symbolic maze, actor, trail, and path representation
- high readability at full-screen scale
- restrained but expressive color themes
- terminal-like rhythm and motion

Tiles and graphical sprites are out of scope for the primary visual language. All meaningful state should be communicated through glyphs, color, brightness, opacity, and terminal-style layout.

The main meat of the tile language should remain ASCII. Non-old-school terminal techniques are allowed as decoration and presentation support, especially for color, background treatment, light, glow, opacity, pulse, and other visual effects, as long as they reinforce the ASCII terminal identity rather than replacing it.

---

## Chekhov Rule

Every visible element should have a reason to exist.

If the wallpaper introduces a glyph, color, trail, effect, label, or transition, that element should communicate something meaningful about:

- maze structure
- solver identity
- solver state
- traversal history
- frontier or search pressure
- final solved path
- reset or transition state
- terminal atmosphere in service of the core illusion

The wallpaper should avoid decorative algorithm sludge: no meaningless particles, fake UI clutter, generic neon haze, ornamental panels, or visual conventions that do not pay off.

---

## Core Experience

### Maze Generation

Each cycle begins by generating a full-screen maze.

The maze should use a single-glyph-per-logical-cell structure. Each terminal grid position represents one meaningful map cell or state, such as wall, floor, actor, breadcrumb, frontier, start, goal, or final path.

The maze should:

- fill the available viewport cleanly
- remain legible across many screen sizes and aspect ratios
- feel like a terminal dungeon map rather than an abstract pattern
- vary over time through generator components, theme weights, parameters, and random seeds

Maze generation should be part of the show by default. The wallpaper should animate maze construction when the selected generation algorithm can expose meaningful incremental steps. Generation animation should be brisk enough that it reads as a satisfying terminal process rather than delaying the main solver sequence.

If a generation algorithm does not naturally support a useful construction animation, the renderer may use a short reveal transition instead.

Maze generation should be theme-guided. Shared generator components provide reusable construction behaviors, while the active theme provides the "lego set": preferred generator families, structural motifs, weights, parameter ranges, terrain flavor, and presentation rules. Forest should not feel like Stone with green paint; themes should influence the shape of the generated maze, not only its colors.

### Start And Goal Placement

Each maze should have a start and goal placement that creates a visually meaningful journey.

The default placement should prefer distant endpoints rather than arbitrary random cells. A good default is to choose endpoints from a farthest-pair or near-farthest-pair search over the generated maze, with enough variation that every maze does not feel like a simple corner-to-corner march.

Start and goal should be stable across all solver runs for a given maze so the viewer can compare how different solvers approach the same problem.

### Solver Sequence

For each maze, the wallpaper should choose a smaller subset of solvers from a larger available pool. For example, the project may eventually offer around a dozen solver algorithms while running only three to five per maze.

Sequential solver runs are preferred over simultaneous solver racing as the default experience. Sequential runs preserve readability, allow each algorithm to have its own moment, and let the viewer compare solver behavior on the same maze without turning the display into visual mud.

### Embodied Solver

The solver should be represented as a terminal actor, likely using a roguelike-style glyph such as `@`.

The actor should appear to walk through the maze, leaving a breadcrumb trail. The point is not merely to show that a path exists, but to watch the solver inhabit the maze.

For each solver run:

1. Place the actor at the maze start.
2. Move the actor through adjacent maze cells according to that solver's behavior.
3. Leave a color-coordinated breadcrumb trail.
4. Optionally show frontier or candidate cells when useful and readable.
5. On success, display the final solved path in a brighter, cleaner style.
6. Hold the solved path briefly.
7. Fade the solver's actor and markings to the configured target opacity.
8. Start the next solver on the same maze.

### Algorithmic Truth Versus Watchability

The wallpaper should prioritize embodied watchability over strict textbook visualization of solver internals.

Algorithms should remain meaningfully distinct, but they may be adapted into a trace that keeps the `@` moving through adjacent cells. Solver implementations may compute however they need to, but the default renderer-facing trace should be an adjacent-step actor trace plus semantic state updates.

The shared solver trace model should expose states such as:

- current actor cell
- visited cells
- frontier or candidate cells
- solver attention or light field
- breadcrumb trail
- final solved path
- run phase, such as searching, solved, holding, fading, or complete

For naturally walking algorithms, the trace may be close to literal. For frontier algorithms such as BFS, A*, Dijkstra, or greedy best-first search, the trace adapter may move the actor along known parent paths between expanded nodes so the actor remains embodied. Frontier state may still be shown lightly when useful.

The default frontier visualization should be integrated with a solver attention field centered on the actor. The attention field may behave like a terminal-native light source: nearby cells become more legible or brighter, and frontier/candidate cells may glint, pulse, tint, or briefly brighten within that field. This lets the viewer see algorithmic search pressure without turning frontier state into a heavy global overlay.

If an algorithm's literal internal behavior would produce jarring jumps, unreadable clutter, or a non-embodied cursor visualization, the project may either:

- adapt the algorithm into a watchable movement trace
- show only a reduced subset of its internal state
- exclude it from the default solver pool
- reserve it for an advanced or alternate visualization mode

The wallpaper may teach by showing algorithm personality, but it is not primarily an algorithm lecture diagram.

---

## Variety Goals

Variety is a core feature, not incidental polish.

The wallpaper should support multiple dimensions of variation:

- maze generation algorithms
- maze solving algorithms
- solver color identities
- visual themes
- pacing settings
- maze density or scale
- reset and fade behavior

The viewer should periodically notice that the current run feels different from the last one.

Maze scale should be a first-class configurable option. Calibration against a 2560x1080 display showed that multiple terminal densities are visually appealing, so the project should expose scale presets rather than collapse the decision into one fixed default.

Initial scale preset names and rough metrics:

- Tiny: 12px font, 8x15px cell
- Small: 14px font, 9x17px cell
- Compact: 16px font, 10x19px cell
- Medium: 18px font, 11x22px cell
- Large: 20px font, 12x24px cell
- XL: 22px font, 14x27px cell
- Huge: 24px font, 15x30px cell
- Poster: 28px font, 17x34px cell

The exact metrics may be refined during implementation, but the user-facing concept of terminal density presets is a foundation decision.

Initial visual themes should be:

- Forest
- Desert
- Stone
- Void
- Water
- Lava
- Cold

Theme selection should default to a random pick from the available theme set, reinforcing the wallpaper's variety-first experience. Users should still be able to choose a specific theme.

---

## Maze Generation Components

The v1 generator component set consists of five shared components. Each is chosen for visual distinctiveness, animation potential, and coverage of the seven themes.

**Recursive Backtracker**
A depth-first maze carver. Dives deep, backtracks when stuck. Produces long winding corridors with many dead ends. Animation shows a tunnel snaking through the grid. Natural fit for Stone and Desert.

**Randomized Prim's**
A frontier-expansion generator. Grows the maze by randomly adding cells from a candidate set. Produces bushy, branchy mazes with shorter corridors and frequent junctions. Animation shows a spreading frontier organism. Natural fit for Forest and Water.

**Recursive Division**
Carves the grid by recursively splitting space with walls, then punching single passages through each wall. Produces boxy, angular, room-like structures with crisp rectangular geometry. Animation shows walls appearing in sequence. Natural fit for Cold and Void.

**Organic / Cellular Automata**
Generates cave-like irregular spaces through CA rules: seed random noise, iterate with birth/survival thresholds, post-process to ensure connectivity. Produces flowing natural chambers with no right angles. Animation shows terrain evolving from noise. Natural fit for Water and Lava.

**Room-and-Corridor**
Places rectangular rooms, then connects them with corridors using a secondary generator. Produces the classic dungeon layout familiar from roguelikes. Animation shows rooms stamped onto the grid, then corridors connecting them. Natural fit for Stone; weaker fit for natural themes.

**Deferred**
Wilson's algorithm, Aldous-Broder, and Eller's are deferred from v1. Wilson's and Aldous-Broder produce uniform spanning trees and have watchable animations but can be slow on large grids. Eller's row-wise generation personality is a later candidate if a terminal-printer construction style is wanted.

**Theme Weights**

Each theme provides a weighted preference over the generator components. Primary means most likely to run for that theme; secondary gets meaningful weight; tertiary can occasionally color the output. Exact probabilities are spec-level detail.

| Theme  | Primary              | Secondary      | Tertiary           |
|--------|----------------------|----------------|--------------------|
| Stone  | Room-and-Corridor    | Backtracker    | Division           |
| Forest | Prim's               | Organic/CA     | Room-and-Corridor  |
| Desert | Backtracker          | Division       | Prim's             |
| Cold   | Division             | Backtracker    | —                  |
| Void   | Division             | Backtracker    | —                  |
| Water  | Organic/CA           | Prim's         | —                  |
| Lava   | Organic/CA           | Division       | Backtracker        |

---

## Possible Solver Algorithms

Candidate solver algorithms include:

- depth-first search
- breadth-first search
- A*
- Dijkstra
- greedy best-first search
- random walk
- wall follower
- dead-end filling
- bidirectional breadth-first search

Not every algorithm needs to be included in the default cycle. Preference should go to solvers that produce distinct, watchable movement personalities.

Candidate solvers must be screened for fit with the embodied solver principle before being promoted into the default set.

The v1 default solver pool should include:

- depth-first search
- breadth-first search
- A*
- greedy best-first search
- wall follower

Random walk should be implemented as an optional solver that can be included or excluded from the v1 solver pool by user configuration. If enabled, random walk participates like any other enabled solver and is governed by the same maximum solve time.

Dijkstra, dead-end filling, and bidirectional breadth-first search should be deferred from the v1 solver pool.

Deferred solvers should remain visible as future design candidates rather than being treated as rejected. Bidirectional breadth-first search is an especially interesting v2 candidate because it could support a two-actor or meeting-point visualization once the shared actor-trace model is proven.

Known caveats:

- Dijkstra behaves similarly to breadth-first search on an unweighted maze unless the project introduces meaningful traversal weights.
- Random walk can be visually charming but may take dramatically longer than directed solvers, so it must be governed by the user-configurable maximum solve time.
- Wall-following behavior depends on maze topology and may be incomplete or visually repetitive in some maze classes.
- Dead-end filling is naturally a pruning algorithm rather than a little actor walking the maze; it may need a special visualization mode or may belong outside the embodied default set.
- Bidirectional search may require two actors, alternating actor movement, or a special meeting-point visualization to remain readable.

---

## Visual State Model

The renderer should distinguish at least:

- maze walls, likely with `#` or theme-specific wall glyphs
- open floor, likely with `.`, space, or muted theme-specific floor glyphs
- start cell
- goal cell
- current actor position
- visited cells or breadcrumb trail
- frontier or candidate cells, when applicable
- final solved path
- fade or clearing state

Solver-specific coloring should make each run feel identifiable. For example, DFS might use red while A* might use green. Exact mappings are not yet fixed.

The logical solver state and the visual treatment of that state should remain separate. Solver runs produce semantic states such as run start, current actor, visited, frontier, final path, victory, timeout/death, and faded residue. The active visual theme decides how those states are expressed through glyphs, foreground color, background color, brightness, opacity, or other terminal-style treatments.

Color should be the primary breadcrumb and path identity signal. Theme-specific glyph changes or background changes may reinforce that signal, especially in sparse themes that use empty space for floor cells, but they should not replace the solver color identity as the main cue.

---

## Wallpaper Engine Context

The project is intended for Wallpaper Engine.

The implementation direction is a web wallpaper using local HTML, CSS, and JavaScript, because that gives direct control over a custom terminal renderer and can integrate with Wallpaper Engine web wallpaper user properties.

The primary renderer should be Canvas 2D. The wallpaper should render a terminal grid by drawing monospaced glyphs into a canvas rather than constructing the maze as thousands of DOM nodes. This keeps the implementation straightforward, browser-portable, and performant enough for full-screen animation while preserving the ASCII terminal aesthetic.

The renderer may later use a glyph atlas or WebGL path if Canvas 2D proves insufficient, but that should be treated as an optimization path rather than the v1 foundation.

Wallpaper Engine integration should support the following user-configurable properties for v1:

- visual theme (specific selection or random)
- terminal scale or density preset
- solver step interval
- completed-solver fade target opacity
- maximum solve time
- random walk solver inclusion
- visual/effect intensity

The implementation should still run cleanly in a normal browser during development when possible.

---

## Display Constraints

Wallpaper Engine may run the wallpaper across many resolutions, aspect ratios, DPI/scaling contexts, and monitor configurations.

The renderer must be resolution-aware.

The maze grid should derive from the available viewport and chosen terminal cell metrics. The system should avoid awkward partial edge cells and should respond sanely to resize events.

If the viewport size changes, the wallpaper should restart the current cycle completely. It does not need to preserve the current maze, solver, trace, or visual state across resize events. This is a desktop wallpaper, not an application workflow.

The wallpaper should remain legible rather than cramming the maximum possible number of cells onto every display.

Important display cases include:

- 16:9 desktop
- 16:10 desktop
- ultrawide
- portrait
- small Wallpaper Engine preview windows
- high-DPI screens

---

## Performance Posture

`amaze` is a wallpaper, so it must remain polite to the machine it lives on.

The wallpaper should favor steady, bounded animation work over maximum visual throughput. It should avoid unbounded per-frame allocation, excessive canvas overdraw, runaway solver stepping, and resolution-dependent animation cost spikes.

The implementation should support configurable visual/effect intensity and should be able to throttle, pause, or reduce work when Wallpaper Engine or the browser environment indicates that the wallpaper is not actively visible.

Performance should be judged by sustained behavior, not only by whether the wallpaper can render one impressive full-speed run.

---

## Non-Goals

- Not a tile-art wallpaper.
- Not a sprite-based game.
- Not a glossy modern maze game UI.
- Not a generic neon maze screensaver.
- Not an interactive puzzle game by default.
- Not a strict algorithm textbook visualization.
- Not a display of every internal data structure operation.
- Not decorative visual sludge.
- Not dependent on a single fixed resolution or aspect ratio.

---


---

## Closed Decisions

### Primary Form

`amaze` is a Wallpaper Engine wallpaper.

### Core Loop

The wallpaper generates a maze, runs several solvers sequentially against that maze, then resets into a new maze.

### Implementation Form

The wallpaper should be implemented as a Wallpaper Engine web wallpaper using local HTML, CSS, and JavaScript.

### Renderer

The v1 renderer should use Canvas 2D to draw a terminal glyph grid. WebGL and glyph-atlas approaches remain possible future optimizations if Canvas 2D is not sufficient.

### Visual Style

The primary aesthetic is colored ANSI ASCII terminal, rooted in classic roguelike visual language.

### ASCII-First Tile Language

The core semantic map tiles should use ASCII glyphs. Themes may use modern browser-rendered decoration, color, background, opacity, glow, pulse, and light effects around those glyphs, but those effects should not replace the ASCII tile language as the primary visual identity.

### Maze Generation Visibility

Maze generation should be part of the visual performance by default. Algorithms that expose meaningful incremental construction steps should animate them briskly; algorithms that do not may use a short reveal transition.

### Start And Goal Placement

The default start and goal policy should prefer distant endpoints, such as farthest-pair or near-farthest-pair cells, while preserving enough variation that every run does not feel like the same corner-to-corner journey.

### Terminal Scale

Maze scale should be configurable through named terminal density presets. All calibration-page scales are valid design directions, so v1 should expose multiple presets rather than choosing one permanent cell size.

### Maze Cell Structure

The maze should use a single-glyph-per-logical-cell structure. The wallpaper should feel like a roguelike map, not a classical maze diagram with drawn wall segments between cells.

### Theme-Owned State Rendering

Solver and maze systems should emit semantic state; the active theme should decide the exact glyphs, colors, background treatments, brightness, opacity, and terminal effects used to render that state. Color remains the primary identity cue for solver breadcrumbs and paths.

Solver lifecycle beats are also theme-owned. Run start, victory, and timeout/death should be emitted as semantic events. One theme may spawn the actor with a terminal cursor blink and starve it into a skeleton; another may teleport it in, celebrate victory with a bright path pulse, and explode it on timeout; another may use quieter failure and success marks. The semantic events are shared; the theme owns the performance.

### Primary Solver Presentation

Solvers should be embodied as an actor moving through the maze, leaving breadcrumbs, then revealing a bright final solved path.

### Sequential Solver Runs

Sequential solver runs are the default comparison mode. Multiple solvers may run on the same maze, but they should each get their own readable pass.

### Watchability Over Literalism

When algorithmic literalism conflicts with embodied watchability, the wallpaper should prefer the embodied, readable experience.

### Shared Solver Trace Model

Solvers may compute using their natural internal algorithm, but the default visualization contract is an adjacent-step actor trace plus semantic state updates. Frontier-oriented algorithms should use a trace adapter when needed so the `@` remains embodied rather than becoming a teleporting cursor.

### Solver Attention Field

The active solver may project a local attention or light field centered on the actor. Frontier and candidate state should be expressed through that field by default, using theme-owned tint, pulse, brightness, reveal, or background treatment rather than a heavy global overlay.

### Shared Visualization Policy

Solvers should use the shared actor-trace and attention-field visualization model by default. Special per-solver visualization policies should be avoided in v1 unless an algorithm cannot be made readable or honest within the shared model.

### Wallpaper Performance

The wallpaper should be polite to the host machine: bounded per-frame work, configurable animation intensity, no resolution-dependent cost explosions, and support for pausing or throttling when the wallpaper is not actively visible.

### Resize Behavior

Viewport changes should trigger a full cycle restart. The wallpaper should recalculate the grid, generate a new maze, choose the next run configuration, and begin again rather than attempting to preserve in-progress state.

### Solver Step Interval

Solver actor movement should be governed by a user-configurable step interval. This controls how often the wanderer advances through the maze.

Decorative rendering should be decoupled from solver stepping. Theme effects such as water shimmer, glow, pulse, light falloff, fade interpolation, and other atmospheric animation should render at the normal visual frame cadence even when the solver moves slowly.

### Completed Solver Fade

After a solver finishes, its visual markings should fade to a configurable target opacity. The target may be zero for a complete fade-out, partial opacity for accumulated comparison, or full opacity if the user wants completed solver paths to remain fully visible.

### Solver Runtime Bound

Solver runs should support a user-configurable maximum solve time. This is required for random walk and useful for any solver that could produce an excessively long or visually repetitive run.

If a solver hits the maximum solve time before solving, the actor should die according to the active theme's timeout/death treatment. The run should end as incomplete, avoid showing a fake solved path, and then fade according to the configured completed-solver fade behavior before the next solver begins.

### Initial Theme Set

The v1 theme set should include Forest, Desert, Stone, Void, Water, Lava, and Cold.

Default theme behavior should be random selection from the available theme set, with a user option to pin a specific theme.

### Theme-Guided Generation

Maze generation should use shared generator components, but themes should provide the construction kit: preferred generator families, weights, structural motifs, parameter ranges, terrain flavor, and presentation rules. Users may eventually override generation mode, but the default experience should let the theme shape the maze structure.

### Default Cycle Timing

Default timing values for v1:

| Setting | Default | Configurable |
|---|---|---|
| Solver step interval | 80ms | Yes |
| Generation animation duration | ~3–6s (rate-scaled to maze size) | No |
| Final path hold | 2.5s | No |
| Solver fade duration | 1.5s | No |
| Inter-solver pause | 0.5s | No |
| Maximum solve time | 60s | Yes |
| Reset beat | 1.0s | No |

Generation animation duration is not a single fixed value but a per-frame cell rate that scales with maze size so generation completes in roughly 3–6 seconds across scale presets. Exact rates are spec-level detail per generator component.

The two user-configurable values — solver step interval and maximum solve time — are part of the Wallpaper Engine property surface.

Maximum solve time is set to 60 seconds by default. The one-minute bound is psychologically familiar and will be more legible if a solve-time display is introduced in a later version.

### Visual Effect Intensity

The wallpaper should expose a visual/effect intensity control with Low, Medium, and High settings. The default is Medium.

Medium provides atmospheric theme effects — water shimmer, attention field glow, frontier pulse, light falloff — without risking the neon-sludge failure mode or taxing the host machine. Low reduces effects to a minimal but still readable level; High enables the fullest expression of theme effects.

Frontier pulse intensity is folded into this control for v1. Separate frontier pulse intensity is a v2 consideration.

### Renderer Text Strategy

The v1 Canvas 2D renderer should draw glyphs using live text calls rather than a pre-rasterized glyph atlas. Chromium's text rendering is well-optimized for this use case and the approach works immediately with a bundled font. A glyph atlas remains the stated optimization path if Canvas 2D proves insufficient.

### Post-Processing

v1 post-processing is limited to two effects: soft glyph glow on bright elements (actor, final path, victory and death beats) and subtle cursor flicker on the `@` actor. Both reinforce the terminal identity without adding visual noise.

Scanlines are excluded by default — they reduce legibility at dense scale presets. Phosphor decay is deferred as complex and sludge-prone. Both may be revisited in a later version.

Post-processing effects are governed by the visual/effect intensity setting.

### Solver Attention Field Strength

The default attention field should have a moderate radius of roughly 5–7 cells from the actor, with a smooth brightness falloff to ambient at the edge. This reads as a lantern in a dungeon — present and atmospheric — without flooding the visible maze. Exact falloff curve and cell counts are spec-level detail.

### No Strict ANSI Palette Mode

There is no strict ANSI palette mode in v1. The ASCII-First Tile Language decision already draws the right line: core semantic tiles use ASCII glyphs, while themes may use modern browser-rendered color, background, opacity, glow, pulse, and light effects as decorative and atmospheric support. Restricting effects to a historical ANSI palette would undercut the theme system without adding meaningful identity.

### Initial Generation Component Set

The v1 generator component set is: recursive backtracker, randomized Prim's, recursive division, organic/cellular automata, and room-and-corridor. Wilson's algorithm, Aldous-Broder, and Eller's are deferred to v2.

Theme generation weights are established in the Maze Generation Components section. Exact probabilities are spec-level detail, but the relative hierarchy (primary, secondary, tertiary) is a foundation decision.

### Initial Solver Set

The v1 solver pool should be fixed except for one user option: whether to include random walk.

The default pool is depth-first search, breadth-first search, A*, greedy best-first search, and wall follower. Random walk is optional. Dijkstra, dead-end filling, and bidirectional breadth-first search are deferred.

Deferred does not mean rejected. Bidirectional breadth-first search should receive a deliberate v2 design pass, especially around whether two actors, alternating movement, or a meeting-point reveal can fit the embodied visualization model.

---

## Wallpaper Engine Property Surface

The v1 user-configurable property surface:

| Property | Type | Default | Notes |
|---|---|---|---|
| Visual theme | Selection + random | Random | Forest, Desert, Stone, Void, Water, Lava, Cold |
| Terminal scale preset | Selection | Medium | Tiny → Poster |
| Visual/effect intensity | Low / Medium / High | Medium | Governs theme effects and frontier pulse together |
| Solver step interval | Slider / ms | 80ms | Controls wanderer movement cadence only |
| Completed-solver fade opacity | Slider | 0 (full fade) | 0 = clear, 0.5 = ghost, 1 = keep |
| Maximum solve time | Slider / seconds | 60s | Applies to all solvers; required for random walk |
| Random walk inclusion | Toggle | Off | Adds random walk to the solver selection pool |
