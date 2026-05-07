# amaze - v2 Foundation Document

> **Purpose:** This is the v2 living foundation document for `amaze`. It captures direction, resolved tensions from v1 implementation, product changes, new features, and known bugs that must be addressed before the v2 specification is drafted. It inherits the core identity, philosophy, and closed decisions of the v1 foundation unless explicitly revised here.

---

## Purpose

v1 proved the `amaze` core loop: generate a full-screen maze, run a sequential set of embodied solvers against it, display the solved path, fade, and repeat. The implementation is post-spec and the wallpaper is running.

v2 should build on that working foundation without changing the project's identity. `amaze` remains a terminal roguelike wallpaper built around maze generation and embodied solver animation. The purpose of v2 is to address a set of known behavioral defects, promote underused features, deepen algorithmic personality, and extend the visual and interactivity model in directions that remain theme-aligned.

The known v2 pressure points come from two sources: behavioral observations made during v1 implementation, and product decisions that were deferred or left open in the v1 foundation.

---

## Product Philosophy

Keep the core loop intact, but make each solver run feel more alive and more honest.

v2 should not expand into a different product. The wallpaper still generates mazes, runs embodied solvers, and resets. Improvements should concentrate on:

- the quality and personality of solver traversal behavior
- the honesty of the solver lifecycle (walk to the finish, not just find it)
- the depth and variety of the light model
- the visual richness of themes
- the correction of known generation and solver bugs

The guiding question for v2 is:

> Does the viewer feel like they are watching a real exploration, or does it look like an animation playing over a data structure?

---

## v2 Goals

- Promote random walk to a first-class default solver with full behavioral completeness.
- Require the `@` actor to physically walk to the goal cell before the solution animation begins.
- Raise the default maximum solve time and make it grid-size-aware.
- Add the mouse cursor as an independent, viewer-controlled light source.
- Introduce light-source-aware navigation shortcuts for the `@` actor.
- Mitigate the wiggle behavior in frontier-based solvers (BFS, A*).
- Expand per-theme decorative elements to better differentiate themes visually.
- Fix the backtracker double-thick wall edge bug.
- Fix the wall follower loop condition that causes it to cycle on enclosed open areas.
- Fix the organic/CA generator behavior on small grid sizes.
- Formally legitimize the HUD as a first-class, theme-aligned UI element.

---

## v2 Non-Goals

- Not a change to the core loop structure.
- Not a new solver type beyond what v2 scope demands.
- Not a multiplayer or competitive mode.
- Not a general-purpose maze puzzle game.
- Not a major overhaul of the attention/light system architecture.
- Not an interactive player-controlled wallpaper.
- Not a solver speed-comparison racing mode.
- Not removal of any v1 theme.

---

## HUD: First-Class Theme-Aligned Element

### Decision Reversal

The v1 foundation treated a HUD with skepticism — it did not appear in the closed decisions or the Wallpaper Engine property surface as a first-class element. The implementation introduced one and it has proven its worth. v2 formally adopts the HUD.

### Rationale

The HUD communicates meta-state that the maze itself cannot: which theme is active, which generator ran, which solvers have run and how long they took, and which solver is currently live. This information:

- helps the viewer understand what they are watching without interrupting the experience
- reinforces the terminal roguelike identity through its visual form
- is meaningfully aligned with the Chekhov Rule — every field communicates real state

### v2 HUD Direction

The HUD should:

- be styled by the active theme (use the theme's palette, not a universal fallback)
- be togglable by the viewer via keyboard shortcut (`H` key retained) and via a Wallpaper Engine user property
- initialize its visibility state from the Wallpaper Engine property at each cycle start; keyboard toggle overrides within the current cycle
- display: active theme, active generator, current solver name and live elapsed time, and completed solver history with resolved times
- be rendered as a canvas overlay layer separate from the display grid — it does not occupy grid cells and does not participate in attention field computation. Concretely: the HUD canvas composites on top of the attention-lit maze canvas at full brightness; no attention field blending is applied to it.
- be excluded from the Wallpaper Engine solver attention field — the light source does not interact with the HUD overlay

Note: Start and goal cells, while part of the display grid, are also unaffected by attention dimming — they render at full theme color regardless of actor distance. This is a rendering exemption (a rule applied at draw time), distinct from the HUD's architectural exclusion (the HUD is not part of the grid at all). Spec authors should not conflate these two mechanisms.
- be positioned in a corner that does not compete with the maze field of view

---

## Random Walk: Promotion to Full Default Solver

### v1 Status

Random walk was implemented as an optional solver gated behind a user toggle (`randomWalkEnabled = false` by default). It participated in the solver pool like any other solver when enabled.

### v2 Direction

Random walk should be promoted to an unconditional first-class member of the solver pool. It should always run as part of every cycle with no user toggle.

Random walk is a truly random walk. The actor moves to a random adjacent open cell each step. Movement decisions are made with no heuristics and no navigation planning. Random walk does track a parent map internally (for path reconstruction when the goal is found by chance), but this map is never consulted for movement — it is only used to produce the final solved-path display. If the actor steps onto the goal cell, the run succeeds and the reconstructed path is shown; if the maximum solve time is exhausted, it dies. Both outcomes are valid and thematically honest.

Random walk produces genuinely distinct traversal personality: it revisits cells, traces irregular breadcrumb density patterns, and occasionally finds surprisingly direct paths. It is the "lost wanderer" archetype. Its unconditional presence in every cycle reinforces the variety-first identity of the wallpaper.

The maximum solve time governs random walk's runtime as it does all solvers. With the time limit raised in v2 (see below), random walk has a fair window on any grid size.

The `randomWalkEnabled` property should be removed from the Wallpaper Engine property surface entirely. There is no opt-in or opt-out for random walk.

---

## Walk-to-Goal: Honest Solver Lifecycle

### Problem

When a solver finds the goal cell, the current implementation transitions immediately to the solution-path animation without requiring the `@` actor to physically arrive at the goal tile. The solved path appears before the actor has walked to the end.

This breaks the embodied illusion. The viewer sees a solved path materialize while the actor is somewhere else in the maze. It reads as a teleport rather than a journey.

### v2 Direction

When a solver transitions to the `SOLVED` phase, the `@` actor must walk from its current position to the goal cell before the solution path animation begins. This walk should:

- follow the known best path from current actor position to goal (using the solver's computed parent map or reconstructed path)
- move the actor at half the configured step interval (e.g., 40ms at the 80ms default) — a noticeably faster cadence that reads as decisive arrival
- open with a universal `@` → `!` glyph substitution lasting one full step, accompanied by theme-controlled pulse and/or color flash, as a "found it" beat before the walk begins
- remain visually distinct from the solution-path reveal — the actor is traveling, not yet celebrating
- trigger the solution animation only once the actor occupies the goal cell

This applies to all solvers that compute a path. Random walk is exempt from the walk phase: unlike planning solvers (BFS, A*, etc.) that compute a path first and then walk the actor along it, random walk has no separation between "computed position" and "physical position" — the actor is always at its physical position. When random walk steps onto the goal cell, the actor is already there. The parent map random walk maintains is write-only for solution display reconstruction; it is never used for movement. There is no path-to-walk because there is no position gap to close. However, the `@` → `!` beat still fires for random walk — it marks the moment the goal was found, which is equally significant regardless of solver. Random walk displays the beat for one full step, then transitions immediately to solution animation.

The solution animation should begin from the goal cell position as soon as the actor arrives.

---

## Maximum Solve Time: Grid-Aware Default

### Problem

The v1 default maximum solve time is 60 seconds. This value was described as "psychologically familiar," but it does not account for the fact that grid size varies dramatically by scale preset. A tiny-preset grid may have a few hundred cells; a poster-preset grid may have tens of thousands. A fixed 60-second cap is too short for random walk on large grids and does not scale with maze complexity.

### v2 Direction

The default maximum solve time should be raised, with the effective limit scaling with grid size using square-root scaling and a cap of ten minutes (600 seconds) for the largest practical grids.

The scaling formula:

- `min(k × √(cols × rows), 600)` where `k = 5`.
- At `k = 5`, a typical 1080p Poster-preset grid (~113×32 cells) yields approximately 300 seconds; a 4K Poster-preset grid (~226×63 cells) yields approximately 595 seconds — naturally scaling to just under the cap without special-casing.
- Smaller grids receive proportionally shorter limits. Square-root scaling matches the intuition that maze path length — and therefore expected random walk solve time — grows roughly with the square root of grid area rather than linearly with cell count.
- The user-configurable maximum solve time property should remain, but its semantics become a multiplier on the grid-aware default rather than a fixed absolute value.

Exact slider range and multiplier bounds are spec-level decisions.

---

## Light-Source-Aware Navigation

### Concept

The `@` actor currently uses a strict path computation to determine its next step. The attention field (light source) is a visual effect layered on top, not a navigational input.

v2 explores whether the actor's own light source can inform navigation in ways that feel natural and make the behavior more visually interesting — without compromising solver honesty.

### Exit Visibility Shortcut

If the goal cell falls within the actor's visible light radius at its current position, the actor should recognize this and walk directly toward the goal rather than continuing to follow a computed path that would route around or away from it.

This is thematically honest: a wanderer who can see the exit should walk toward it. It is also visually satisfying — the viewer sees the actor "notice" the goal and move decisively.

Visibility is defined as unobstructed line-of-sight: a grid ray cast from the actor's cell to the goal cell that does not cross any wall cell. This check is a single Bresenham-style scan of at most `radius` cells — negligibly inexpensive. The current attention field does not perform wall-aware illumination, so this check will require access to wall data but is not a change to the attention rendering model.

Conditions:
- The goal must be within the attention field radius.
- The ray from actor to goal must not cross any wall cell.
- The actor must be able to reach the goal via adjacent walkable steps (the ray showing clear line-of-sight does not guarantee the cells between are reachable in the maze graph, but a short BFS confirms it cheaply).
- This shortcut applies during active solving, not during the walk-to-goal phase (which already has goal as target).

**Solver scope:** The exit-visibility shortcut applies to DFS, BFS, A*, and Greedy best-first only. Random walk is explicitly excluded — using a sighted shortcut would contradict its "truly random movement" identity. Wall follower is excluded — steering toward a visible goal would break its wall-following algorithm identity. DFS is included despite not being a frontier-based solver: DFS's systematic depth-first traversal benefits from noticing a visible exit, and DFS does not exhibit the frontier-target wiggle behavior that commit-to-path addresses, so these two features are orthogonal for DFS. A future v3 revision may reconsider applying this shortcut universally.

### Dead-End Detection via Light

> **Deferred to v3.** This subsection describes a feature that is explicitly out of scope for v2. It is retained here as context for the exit-visibility shortcut design. Spec authors should not attempt to spec this feature.

If the actor can see all surrounding cells within the light radius and all visible exits lead back to already-visited cells, this is a light-aware dead-end signal. The actor may treat this as a dead-end and prioritize backtracking rather than continuing forward exploration.

This does not replace the solver's own dead-end or backtracking logic. It is an enhancement: a visual behavioral cue that the actor uses what it can see, not just what its algorithm has computed.

---

## Frontier Solver Wiggle Mitigation

### Problem

BFS and A* (and to a lesser degree greedy best-first) exhibit a visible "wiggle" during active solving: the actor appears to oscillate or rapidly change direction step to step because the frontier moves and the actor path-traces to the current best frontier node every step. Each solver step may change the actor's walking target, causing the direction to flip unpredictably.

This reads as noise rather than directional intent. It is especially jarring on large, open mazes where the frontier expands quickly.

### v2 Direction

**Commit-to-path with change-of-mind beat**

Rather than recalculating the actor's walking target every solver step, the actor commits to a current target for a random number of steps before accepting a new target. The cycle is:

1. Pick a frontier target and lock it as the current walking target.
2. Walk toward the target for N steps, where N is chosen randomly such that the commitment window is approximately 2 seconds of wall time: `N = random(floor(2000 / stepIntervalMs), distance-to-target)`. At the 80ms default this yields a minimum of 25 steps; at a slower 200ms interval it yields a minimum of 10 steps. This ensures the commitment feels meaningful regardless of the user's chosen pacing, while the distance-to-target cap prevents N from exceeding the actual path length to the chosen target.
3. After N steps, re-evaluate: is there a better target?
4. If the target is unchanged (or is still the best available), start a new N-step commit to it.
5. If the target changes, play a brief "change of mind" visual beat — a theme-owned effect that signals the actor has updated its plan — then lock the new target and begin a fresh commit cycle.

The "change of mind" beat persists for exactly one full solver step (the same duration as a normal movement step at the configured step interval). The `@` glyph reverts to normal after that step and the new commit cycle begins. Theme-owned pulse and/or color flash is layered on top of the glyph substitution. The beat communicates algorithmic deliberation rather than indecision.

This gives the actor directional momentum. Movement looks purposeful rather than noisy. The randomized N within the [24, distance] window prevents the commit length from being visually predictable while ensuring the actor commits meaningfully before reconsidering.

This approach applies to BFS, A*, greedy best-first, and any other future frontier-based solver. It should not affect DFS, random walk, or wall follower, which have their own distinct movement personalities.

---

## Mouse Cursor as Independent Light Source

### Concept

The mouse cursor should project an independent light source onto the maze canvas. This gives the viewer an interactive, mouse-position-controlled illumination point that reveals maze structure in the area around the cursor.

This is a viewer affordance, not a solver control. The cursor light source:

- is purely visual — it illuminates the maze grid cells around the cursor
- does not affect any solver's computation, path, or decisions
- does not affect the actor's navigation
- does not affect the attention field of the active solver

### Direction

The cursor light source should:

- behave like a second lantern: nearby cells become brighter and more legible, cells at the falloff edge dim back to ambient
- use the same cos² falloff formula and radius as the solver attention field; visual distinction from the solver light comes through the color cast alone, which is theme-owned
- be always-on while the cursor is over the canvas; fade out over 500ms when the cursor leaves the canvas (faster than the 1.5s solver fade to match cursor responsiveness)
- blend with the solver's attention field using **max-blend**: the brighter of the two values wins at each cell, so both illuminated areas remain visible simultaneously without either source washing out the other

The cursor light source must be clearly separated from the solver attention system at the architecture level. Cursor position updates the visual light model only; they must not be passed to any solver logic.

---

## Theme Decorative Depth

### Problem

v1 themes differentiate primarily through color palette and solver color assignments. Wall glyphs may vary by theme but structural variation between themes is limited. The visual identity is mostly "same shape, different color."

### v2 Direction

Each theme should have at least one unique decorative element class that appears in the maze and is meaningless to the solver system — purely atmospheric content that reinforces the theme's physical identity.

Candidate decorative elements by theme:

| Theme  | Candidate decorations |
|--------|----------------------|
| Forest | sparse tree/foliage glyphs (`♣`, `♠`, `T`) in open floor areas; occasional root-pattern border framing |
| Desert | dune/ripple patterns along open floor stretches; cactus or rock glyphs (`Y`, `*`) in open areas |
| Stone  | scattered rubble or dust glyphs (`,`, `·`, `"`) on floor; crumbled wall corner variants |
| Void   | floating debris glyphs or faint particle marks in open space; occasional distant star glyphs |
| Water  | ripple/wave characters (`~`, `≈`) overlaid on floor areas with animation phase |
| Lava   | ember or ash glyphs (`;`, `'`) scattered on floor; occasional heat shimmer glyph substitution |
| Cold   | frost/ice crystal characters (`*`, `❄`, `+`) on floor; frozen crack lines through open areas |

Decorative elements must:

- not use any glyph reserved for semantic maze state (wall, floor, actor `@`, path, start, goal, breadcrumb, frontier, change-of-mind `?`, walk-to-goal `!`)
- not interfere with or obscure legibility of active solver traversal
- be governed by the existing visual/effect intensity setting, which is extended in v2 to cover decorative elements as a class of theme effects. Exact density at each intensity level is a per-theme spec decision — thematic appropriateness should drive density, not a universal formula. A sparse desert may have fewer decorations than a dense forest at the same intensity level.
- be static by default; subtle animation may be added per theme under High intensity

The exact glyph choices, density, placement rules, and animation behaviors are spec-level decisions per theme.

---

## Bug: Backtracker Double-Thick Wall Edge

### Observed Behavior

The recursive backtracker generator tends to produce a double-thick wall along one edge of the grid. This creates an asymmetric border that looks like a generation artifact rather than intentional maze structure.

### v2 Direction

The backtracker implementation should be reviewed and fixed so all four edges of the generated maze have consistent wall treatment. The boundary condition that causes the extra wall row or column must be identified and corrected. The fix should not change the backtracker's core DFS carving behavior, only its edge handling.

---

## Bug: Wall Follower Loop Condition

### Observed Behavior

The wall follower solver can enter an infinite cycle when it starts in or navigates into a large open area. When the open area is approximately enclosed by a spiral or square path it has already traced, the follower gets trapped cycling through a small set of tiles that all border the wall it has been following. It cannot detect that it has entered a loop.

### v2 Direction

The wall follower implementation must include a cycle-detection mechanism that fires before the solver exceeds its time limit by spinning. Candidate approaches:

- **State fingerprint detection:** Record (position, facing-direction) pairs as the actor moves. If the same pair is seen again, a loop has been completed and the run should be terminated as unsolvable (timeout/death treatment).
- **Move-count ceiling:** If the actor has taken more than K × (grid area) steps without finding the goal, treat as timeout. K is a tunable constant.

The state fingerprint approach is preferred because it detects the loop exactly rather than relying on a heuristic bound. The wall follower's timeout/death treatment should be theme-owned consistent with all other solver timeout cases.

---

## Bug: Organic/CA Small Grid Behavior

### Observed Behavior

On small grid sizes (such as the sizes produced by the Wallpaper Engine preview window and other small viewports), the organic/cellular automata generator produces a single blob room rather than an interesting cave structure. The CA rules that produce multiple chambers and corridors on large grids degenerate on small grids because there are not enough cells for the rules to produce structural variety.

### v2 Direction

The organic/CA generator should detect when the grid is below a minimum viable size threshold and adjust its behavior accordingly:

- Reduce the CA iteration count and seed density to prevent full-fill collapse.
- Fall back to a simpler generator (backtracker or Prim's) below a hard minimum grid area if the CA rules cannot produce a non-trivial result.
- The fallback should be silent — no visible artifact or seam from switching generators.

The exact threshold and fallback selection are spec-level decisions. The fix must not affect large-grid behavior, which is already working correctly.

---

## v2 Wallpaper Engine Property Surface

The v2 property surface adds, removes, and revises a small number of v1 properties:

| Property | Type | Default | Change From v1 |
|---|---|---|---|
| Visual theme | Selection + random | Random | Unchanged |
| Terminal scale preset | Selection | Medium | Unchanged |
| Visual/effect intensity | Low / Medium / High | Medium | Extended to cover decorative elements |
| Solver step interval | Slider / ms | 80ms | Unchanged |
| Completed-solver fade opacity | Slider | 0 (full fade) | Unchanged |
| Maximum solve time | Slider / multiplier | Grid-aware default | Default raised; semantics revised to grid-relative |
| Mouse cursor light | Toggle | On | **New** |
| HUD visibility | Toggle | On | **Formally added; initializes each cycle** |

Exact slider ranges, multiplier formulas, and property group ordering are spec-level decisions.

---

## Inherited Closed Decisions

The following v1 closed decisions carry forward unchanged into v2:

- Primary form: Wallpaper Engine web wallpaper (HTML/CSS/JS)
- Core loop: generate → solve (sequential) → reset → repeat
- Renderer: Canvas 2D; WebGL remains deferred optimization path
- Visual style: colored ANSI ASCII terminal, roguelike aesthetic
- ASCII-first tile language: core semantic tiles use ASCII glyphs; theme effects decorate but do not replace. v2 adds two transient actor-state glyphs: `?` (change-of-mind beat) and `!` (walk-to-goal beat). Both are reserved and must not be used for decorative elements.
- Maze generation visibility: animate construction when possible; reveal transition as fallback
- Start and goal: prefer distant endpoints; stable across all solver runs for a given maze
- Terminal scale: named density presets (Tiny → Poster)
- Single-glyph-per-logical-cell maze structure
- Theme-owned state rendering: semantic state from solvers and maze; theme decides visual expression
- Embodied solver presentation: actor moves through maze, leaves breadcrumbs, reveals final path
- Sequential solver runs as default comparison mode
- Watchability over algorithmic literalism
- Shared solver trace model: adjacent-step actor trace plus semantic state
- Solver attention field: moderate radius, smooth falloff, theme-owned expression
- Solver fade to configurable opacity after each run
- Solver runtime bound (now grid-aware default)
- Seven themes: Forest, Desert, Stone, Void, Water, Lava, Cold
- Theme-guided generation weights
- Performance posture: polite, bounded, supports intensity throttling
- Resize triggers full cycle restart

---

## Closed Open Questions

The following questions were open at the start of v2 foundation work and have been resolved:

- **Commit-to-path N range:** N is chosen randomly such that the window is ~2 seconds of wall time: `random(floor(2000 / stepIntervalMs), distance-to-target)`. Scales with step interval; distance-to-target is the natural cap.
- **Change-of-mind beat:** Universal glyph substitution `@` → `?` lasting one full solver step; theme-controlled pulse and/or color flash layered on top.
- **Walk-to-goal beat:** Universal glyph substitution `@` → `!` lasting one full solver step with theme-controlled pulse/flash as the "found it" signal. Fires for all solvers including random walk. Path-tracking solvers then walk at half the configured step interval; random walk transitions directly to solution animation.
- **Walk-to-goal pacing:** Half the configured step interval (e.g., 40ms at the 80ms default).
- **Mouse cursor light formula:** Same cos² falloff formula and radius as the solver attention field; color cast is theme-owned.
- **Mouse cursor light on canvas leave:** Fades out over 500ms (faster than 1.5s solver fade to match cursor responsiveness).
- **Mouse cursor light blend mode:** Max-blend (brighter of cursor light and solver attention field wins per cell).
- **HUD cycle persistence:** HUD visibility state is a Wallpaper Engine property; each cycle start initializes from that property value. Keyboard toggle (`H`) overrides within the current cycle.
- **HUD rendering architecture:** Canvas overlay layer, separate from the display grid. Does not participate in attention field computation.
- **Light-source query definition:** Unobstructed line-of-sight ray cast (Bresenham) from actor to goal, checking for wall cells. Single ray, bounded by attention field radius.
- **Exit-visibility solver scope:** Applies to DFS, BFS, A*, and Greedy best-first. Explicitly excluded from Random Walk and Wall Follower. DFS is included because it benefits from exit-visibility and does not exhibit frontier wiggle (the two features are orthogonal for DFS). Future v3 may reconsider universal application.
- **Light-aware dead-end detection:** Deferred. Conflicts with random walk's "truly random movement" identity; wall follower's loop fix addresses the overlapping failure mode more cleanly.
- **Decorative element density:** Per-theme spec decision. Density guidance is not imposed at the foundation level; thematic appropriateness should drive density per theme per intensity level.
- **Grid-area solve time formula:** `min(5 × √(cols × rows), 600)` seconds. Naturally yields ~300s at 1080p Poster and ~595s at 4K Poster. Cap is 10 minutes (600s).
