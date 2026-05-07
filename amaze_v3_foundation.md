# amaze — v3 Foundation Document

> **Purpose:** This is the v3 living foundation document for `amaze`. It captures direction, resolved tensions from v2 implementation, product changes, new features, and design decisions resolved during foundation work. It inherits the core identity, philosophy, and closed decisions of v1 and v2 foundations unless explicitly revised here.

---

## Purpose

v2 delivered behavioral depth: embodied walk-to-goal, commit-to-path momentum, random walk as a full default solver, the cursor as an interactive light source, and a suite of bug fixes that made each run feel honest and legible. The implementation is complete and the wallpaper is running.

v3 builds on that foundation with two parallel directions: visual richness and experiential surprise.

**Visual richness** addresses a persistent gap: the maze terrain is flat. All floor cells share the same glyph and color. Theme palettes are darker than they should be during active solver runs. v3 gives the ground texture — varied glyphs and subtle color micro-variation across floor cells — and brightens all themes to improve ambient legibility without destroying the dark-room aesthetic.

**Experiential surprise** introduces items: collectible objects scattered through the maze that trigger effects when the actor walks over them. Items are not a puzzle layer and they do not give the viewer control. They are chaotic events that happen to the actor — thematically aligned with the energy of a wanderer who doesn't know what they're stepping into. Items add semantic variety to runs without changing the core loop structure.

v3 does not redesign solver algorithms, the core loop structure, or the generation model. The cycle state machine and several existing systems require extension to support items, but no existing behavior is changed.

---

## Product Philosophy

v3 should make the maze feel like a place and the actor feel like a creature in it.

Floor variation and theme brightness serve the same question v2 asked: does the viewer feel like they are watching a real exploration? A real place has uneven terrain, texture, atmosphere. v3 gives the maze that texture.

Items serve a different question: does anything unexpected happen? The wallpaper has been deterministically predictable — generate, solve, reset, repeat. Items introduce genuine surprise. The actor may speed up, teleport, die, forget where it has been, or suddenly become a different kind of navigator entirely. The viewer doesn't know what's coming. That unpredictability is the point.

Both directions remain theme-aligned and watchability-first. Items do not make the wallpaper interactive for the viewer — there are no controls for items, no way to guide the actor toward or away from them. The viewer watches chaos unfold.

---

## v3 Goals

- Raise ambient brightness on all non-Void themes via per-theme palette tuning.
- Add deterministic per-cell floor glyph and color variation to all non-Void themes.
- Introduce the items system: collectible maze objects with per-type effects and theme-governed activation visuals.
- Revise Wall Follower to a two-phase seek-then-follow behavior that eliminates the degenerate open-start case.

---

## v3 Non-Goals

- Not a redesign of solver algorithms, commit-to-path, walk-to-goal, or any v2 behavioral feature. Those systems are extended to accommodate items but not changed in their existing behavior.
- Not a new solver type.
- Not viewer control of items or item placement.
- Not a puzzle layer — items are chaotic, not designed obstacles.
- Not a change to the core loop structure (generate → solve → reset → repeat).
- Not a multiplayer or competitive mode.

---

## Theme Brightness Pass

### Problem

All non-Void themes are too dark during active solver runs. Wall and floor cells receive attention-field dimming on top of already-dark base palette values, compounding into a canvas that is harder to read than intended. The dark-bar atmosphere should be preserved — this is not a request to turn the lights on — but the ambient brightness floor needs to rise.

### v3 Direction

Each non-Void theme receives a per-theme palette brightness pass targeting approximately 1.25–1.5× on mid-range channels: `wall`, `floor`, `wallEmerge`, and `generating`. Background colors (`bg`) and bright accent colors (`start`, `goal`, `actor`) are unaffected — those channels are already at appropriate brightness or are attention-exempt.

Void's brightness was addressed in a prior implementation pass and is not part of this pass. Its floor is intentional blank space; its wall provides the visual work.

Exact hex values per theme are spec-level decisions. Thematic hue identity must be preserved — the pass is not a mechanical multiply. A brighter Forest should still read as Forest; a brighter Water should still read as Water.

---

## Floor Visual Variation

### Concept

All floor cells in a given theme currently render with the same glyph and the same color. This produces flat, uniform terrain that reads as a data structure rather than a place. Classic roguelikes address this by varying floor glyph and color per cell — a small set of candidates with weighted probabilities gives terrain the feel of uneven, lived-in ground.

### v3 Direction

Each non-Void theme defines a set of floor glyph variants and a set of floor color micro-variants. On each floor cell, a deterministic hash on `(col, row)` selects which variant renders. The hash ensures the same cell always gets the same appearance — no per-frame flicker.

A simple hash of the form `(col * 31 + row * 17) % N` is sufficient. Exact formula is spec-level.

Floor variation applies only to cells in the `FLOOR` semantic state. `VISITED`, `FRONTIER`, `PATH`, and all other solver-active states override floor rendering and are unaffected — variation disappears naturally as the actor traverses the maze, creating contrast between explored and unexplored terrain.

Void is explicitly excluded. Void's floor is intentional blank space and will receive separate visual treatment in a future version.

Glyph variants must not use any glyph reserved for semantic maze state. See Inherited Closed Decisions for the full reserved glyph set.

Color micro-variation should be subtle — small brightness or hue nudges relative to the theme's base floor color, not a distinct secondary color. Exact glyph sets and color variant ranges are per-theme spec decisions.

---

## Wall Follower: Two-Phase Behavior

### Background

The v2 foundation closed the wall follower loop condition as a bug and specified the fix: state fingerprint detection on `(position, facing)` pairs. The v2 spec (§6.4.5) defined a pure right-hand rule — try right, then forward, then left, then back, unconditionally — with fingerprint cycle detection.

The v2 implementation deviated from this spec. It added a visit-avoidance condition to the movement priority (only move to unvisited cells) and a goal-distance scoring fallback when all neighbors were visited. These changes broke the wall-following algorithm identity without correctly solving the underlying problem.

### The Degenerate Open-Start Problem

The pure right-hand rule is degenerate when the actor starts in a fully open area — all four cardinal neighbors are passable. With no wall surface to follow, the right-hand rule is a pure right-turn machine: the actor spins a 4-step circle, returns to the same position and facing, and the fingerprint fires immediately. The run ends after 4 steps. This is algorithmically correct but visually useless — not an entertaining or informative run.

The visit-avoidance patch attempted to prevent this by refusing to revisit cells. It avoids the 4-step spin but replaces wall-following with a different algorithm entirely — the actor stops being a wall follower whenever it reaches a visited junction.

### v3 Direction

The Wall Follower operates in two sequential phases:

**Phase 1 — Seek**: The actor is not yet adjacent to any wall (no impassable neighbor in any cardinal direction; grid boundaries count as walls). In seek mode, the actor moves with right-hand bias, preferring unvisited cells, until it touches a wall surface. If all passable neighbors are visited (fully explored open pocket), it falls back to any passable direction in right-hand priority order. Fingerprint detection is not active during seek — the actor is navigating, not following. The goal may be found during seek; if so, the run solves normally.

**Phase 2 — Follow**: The actor is adjacent to at least one impassable cell. Pure right-hand rule applies: try right, then forward, then left, then back — pick the first passable direction, unconditionally, with no visit condition. `(position, facing)` fingerprint cycle detection is active. If the fingerprint fires, the run exits as a timeout.

**Transition**: The actor begins in seek mode unless its starting cell is already wall-adjacent, in which case it begins directly in follow mode. Transition from seek to follow is triggered at the start of the first step where the actor is wall-adjacent.

### Rationale

This preserves wall-follower identity: the actor is a wall follower that needs to find a wall before it can follow one. The seek phase is a preamble — a visible navigation toward structure — not a replacement for the algorithm. Once in follow mode, behavior is the pure algorithm the solver is named for. The degenerate open-start case produces an interesting traversal (actor navigates to the nearest wall structure, then begins following it) rather than an immediate 4-step death.

On mazes with open areas and loops (primarily organic/CA generator), follow mode may detect a cycle and exit as a timeout. This is correct and thematically honest: the wall follower found a loop it cannot escape and dies. The fingerprint guarantees termination within one complete cycle.

### Revision to v2 Spec

The two-phase behavior supersedes §6.4.5 of the v2 spec. The v2 spec's single-phase pure right-hand rule with fingerprinting remains the correct description of follow mode only. Seek mode is new in v3. The v3 spec should replace §6.4.5 entirely.

---

## Items

### Concept

Items are collectible objects placed in the maze at generation time. When the actor walks over a tile containing an item for the first time, the item activates and its effect fires. Items are a feature of the maze terrain — not the solver — and exist to introduce surprise and semantic variety into actor runs.

Items are not interactive for the viewer. The actor does not pathfind around items and has no awareness of them. The viewer watches the actor encounter items by chance. Both outcomes — lucky and catastrophic — are valid.

### Placement

Items are placed at maze generation time, after start and goal cells are established. Placement rules:

- Any valid walkable tile the actor can enter is eligible.
- Start and goal tiles are excluded.
- Each item type may appear at most once per maze. Items are drawn without replacement from the 11 available types.
- No two items may occupy the same tile.
- Items may be placed on adjacent tiles.
- Items may be placed on the optimal start→goal path. There is no path avoidance. The actor's algorithm does not route around items and has no awareness of their positions.

### Density

Item count is grid-size-aware, following the same square-root scaling pattern as solve time:

`clamp(round(k × √(cols × rows)), 3, 11)`

where 3 is the minimum item count on the smallest practical grids and 11 is the ceiling — equal to the number of distinct item types, since each type appears at most once. Exact `k` is a spec-level decision.

### Persistence

Items are per-cycle. Items placed at generation time persist across all solver runs in a cycle. Once an item is collected by any actor, it is removed from the maze for the remainder of the cycle. Items are not reset between solver runs.

### Actor Blindness

The actor has no awareness of item positions. No solver algorithm routes around items or toward them. Encounters are purely a product of the algorithm's path through the maze.

### Walk-to-Goal Phase

Items remain live during the walk-to-goal phase. If the actor steps over an item tile while traveling to the goal after a solve, the item activates with full effect. This includes death and transformation.

The walk-to-goal phase operates at half-cadence: the actor's step interval is half the configured value. Item effects acquired during walk-to-goal are subject to the same half-cadence:

- **Step-interval effects (Speed Up, Slow Down)**: applied relative to the already-halved interval. Speed Up during walk-to-goal halves the already-halved interval; Slow Down doubles the already-halved interval.
- **Duration-based effects (Freeze, Fog, Lantern, Visual Effect)**: fire at half their rolled duration.
- Freeze during walk-to-goal pauses the walk for half the rolled Freeze duration.

This half-cadence rule applies consistently to all effects fired during walk-to-goal. Effects already active when walk-to-goal begins are unaffected — their durations continue on wall-clock time as normal.

### Effect Taxonomy

Item effects fall into three categories:

- **Temporary**: Active for a random duration of 5–60 seconds determined at pickup time. The same item type in different runs will not always have the same duration. Examples: speed up, slow down, fog, lantern, freeze.
- **Permanent**: Active for the remainder of the current run. Example: solver transformation.
- **One-time**: Apply instantly and are done. Examples: teleport, death, amnesia, solution path reveal.

All item effects are scoped to the run in which the item was collected. When the current solver run ends, all active temporary effects expire. They do not carry over to the next solver's run. Permanent effects expire at the same boundary by definition.

### Effect List

| Effect | Category | Description |
|---|---|---|
| Speed Up | Temporary | Actor step interval decreases; actor moves faster |
| Slow Down | Temporary | Actor step interval increases; actor moves slower |
| Fog | Temporary | Attention field light radius shrinks; actor goes half-blind |
| Lantern | Temporary | Attention field light radius expands; wider terrain reveal |
| Freeze | Temporary | Actor stops moving; solve timer continues running |
| Visual Effect | Temporary | Global theme-governed visual effect plays for its duration |
| Solver Transformation | Permanent | Actor undergoes a brain-swap to a new solver (see below) |
| Teleport | One-time | Actor teleports to a random valid floor tile (excludes start, goal, and item-occupied tiles) |
| Solution Path Reveal | One-time | Triggers the standard walk-to-goal pipeline immediately |
| Death | One-time | Run ends; actor receives death treatment |
| Amnesia | One-time | Visited and breadcrumb state is cleared from the algorithm and display |

### Teleport

When the actor picks up a teleport item, it is immediately moved to a randomly selected floor tile. The destination pool excludes start, goal, and any tile currently occupied by an item. Any active temporary effects continue uninterrupted from the new position.

### Effect Stacking

Multiple item effects of different types may be active simultaneously. Since each item type appears at most once per maze, same-type effects cannot stack. Each active effect's duration runs independently — picking up a new item does not reset or interrupt any currently active effect.

When opposing effect types are simultaneously active, they cancel for net behavior:

- **Speed Up + Slow Down**: net step interval is normal (1.0×). Both durations tick independently. Whichever expires first leaves the other in sole effect.
- **Fog + Lantern**: net light radius is the default. Both durations tick independently.
- **Speed Up + Freeze**: Freeze overrides movement regardless of Speed Up. The actor is frozen; the Speed Up duration continues ticking silently. If Freeze expires while Speed Up is still active, the actor resumes at the sped-up rate for Speed Up's remaining duration. If Speed Up expires while the actor is frozen, it expires with no visible effect — there is no speed effect upon thaw.

### Solver Transformation

When the actor picks up a transformation item:

- The current solver's algorithm is replaced by a new solver drawn at random from solvers not yet run this cycle. The current solver is ineligible. Since the solver pool contains 6 solvers and each cycle runs 4, there are always at least 2 eligible candidates regardless of position in the cycle. The edge case of zero available solvers cannot occur.
- The actor does not change position.
- The solve timer carries over. There is no reset. The new solver inherits the remaining time budget.
- Visited tile state and breadcrumb display remain in the maze.
- The new solver initializes its algorithm from the actor's current position using the inherited visited state where applicable.
- As a persistent visual indicator, the actor's glyph color cycles smoothly between the pre-transformation solver's path color and the new solver's path color using a sinusoidal oscillation driven by wall-clock time, independent of the step interval. Exact period is a spec-level decision. Since only one transformation item exists per maze, a second transformation within the same run is not possible.
- Transformation does not end the current run. The run continues and concludes normally (solve, DNF, or death). The HUD updates to show the new solver name.

Inheriting a nearly-exhausted timer is an intended consequence. Picking up a transformation item late in a run is risky — the new solver may not have enough time to reach the goal. This is thematically honest.

### Solution Path Reveal

Activating the solution path reveal item triggers the standard SOLVED → WALK_TO_GOAL pipeline immediately, regardless of what the current solver has computed.

The walk-to-goal path is derived from a precomputed solution stored at generation time. After maze generation completes — before any solver runs begin — the system computes and stores a complete navigational solution for the maze (a data structure sufficient to walk any actor from any reachable position to the goal via an optimal path). This precomputed solution is held for the full cycle and is independent of all solver state.

When Solution Path Reveal fires, the walk-to-goal uses the precomputed solution rather than the current solver's parent map. The actor walks to the goal, the solution path animation follows, and the run exits as a solve. The exact precomputation algorithm (reverse BFS from goal, full distance field, etc.) is a spec-level decision.

- The `!` beat fires.
- The actor walks to the goal at half the configured step interval.
- The solution path animation follows upon arrival.

This is indistinguishable from a natural solve from that point forward.

If Solution Path Reveal fires during the walk-to-goal phase (the pipeline is already running), the item is consumed with no effect.

### Attention Field and Light Behavior

Items are exempt from attention field dimming. They render at full theme color regardless of actor proximity, consistent with start and goal cells. Items are visible from across the maze at all times — even though the actor cannot act on that information.

The cursor light source illuminates items the same way it illuminates walls and floor cells.

### Visual Representation

Each item type has a unique glyph drawn from the Unicode character set. Item glyphs are chosen for a magical, unnatural, powerful aesthetic — distinct from the ASCII maze language. Exact glyph assignments per item type are spec-level decisions.

Item glyphs must not conflict with any glyph in the reserved semantic glyph set. See Inherited Closed Decisions.

### Theme-Governed Activation Effects

When an item activates, a theme-governed item-specific visual effect plays. Themes implement this via a new lifecycle hook — `onItemActivated(itemType, position)` — analogous to the existing `onLifecycleEvent` hook. Each theme defines the visual expression (color, animation style, spread) for each item type in its own palette and aesthetic.

The combination space is 11 effect types × 7 themes. Exact per-theme per-item visual behavior is a spec-level decision.

### HUD Integration

The HUD displays all currently active item effects as a list. Each entry shows:

- **Temporary effects**: effect name + countdown timer.
- **Permanent effects**: effect name + a dramatic label in place of a countdown. Exact label is spec-level; "FOREVER" or equivalent is the direction.
- **One-time effects**: no persistent HUD entry; they apply and are done.

Since multiple effects may be simultaneously active, the HUD list may contain more than one entry. Layout and ordering of the list are spec-level decisions.

The HUD tracks run outcome with the following exit states:

| Outcome | HUD Display |
|---|---|
| Solved | Elapsed time |
| Timeout (solve time exceeded) | DNF |
| Death by item | ☠ |

Death during the walk-to-goal phase (triggered by a live item) overrides the prior solve state. The run exits as ☠, not as a solved run.

### Wallpaper Engine Property

| Property | Type | Default |
|---|---|---|
| Items enabled | Toggle | On |

---

## v3 Wallpaper Engine Property Surface

| Property | Type | Default | Change From v2 |
|---|---|---|---|
| Visual theme | Selection + random | Random | Unchanged |
| Terminal scale preset | Selection | Medium | Unchanged |
| Visual/effect intensity | Low / Medium / High | Medium | Unchanged |
| Solver step interval | Slider / ms | 80ms | Unchanged |
| Completed-solver fade opacity | Slider | 0 (full fade) | Unchanged |
| Maximum solve time | Slider / multiplier | Grid-aware default | Unchanged |
| Mouse cursor light | Toggle | On | Unchanged |
| HUD visibility | Toggle | On | Unchanged |
| Items enabled | Toggle | On | **New** |

---

## Inherited Closed Decisions

The following decisions from v1 and v2 carry forward unchanged into v3.

**From v1:**
- Primary form: Wallpaper Engine web wallpaper (HTML/CSS/JS)
- Core loop: generate → solve (sequential) → reset → repeat
- Renderer: Canvas 2D; WebGL remains deferred optimization path
- Visual style: colored ANSI ASCII terminal, roguelike aesthetic
- ASCII-first tile language: core semantic tiles use ASCII glyphs; theme effects decorate but do not replace
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
- Solver runtime bound (grid-aware default from v2)
- Seven themes: Forest, Desert, Stone, Void, Water, Lava, Cold
- Theme-guided generation weights
- Performance posture: polite, bounded, supports intensity throttling
- Resize triggers full cycle restart

**From v2:**
- HUD: first-class, theme-aligned canvas overlay; separate from display grid; not subject to attention field dimming; togglable via WE property and `H` keyboard shortcut; initializes from WE property each cycle
- Random walk: unconditional full member of solver pool; no user toggle; always runs in every cycle
- Walk-to-goal: actor must physically arrive at goal before solution animation; `!` beat fires for all solvers; actor walks at half the configured step interval; random walk transitions directly to solution animation after the `!` beat
- Grid-aware solve time: `min(5 × √(cols × rows), 600)` seconds; user property is a multiplier on this default
- Commit-to-path: BFS, A*, Greedy, and DFS commit to a walking target for a randomized step window (~2 seconds wall time) before reconsidering; change-of-mind `?` beat fires when target changes
- Exit-visibility shortcut: DFS, BFS, A*, and Greedy recognize a visible unobstructed goal within light radius and walk directly toward it; Random Walk and Wall Follower are explicitly excluded
- Cursor light: independent light source; same cos² falloff formula and radius as the solver attention field; max-blend with solver field; always-on while cursor is over canvas; 500ms fade out on canvas leave; purely visual, no solver interaction
- Theme decorative depth: each theme has at least one unique decorative element class governed by the intensity setting
- Reserved semantic glyph set: `@` (actor), `!` (walk-to-goal beat), `?` (change-of-mind beat); theme wall, floor, start, goal, and generating glyphs are theme-reserved; none may be used for decorative elements or items
- Bug fixes closed: backtracker double-thick wall edge; organic/CA small grid fallback
- Wall follower cycle detection via state fingerprint: closed in v2 spec §6.4.5 — **superseded by v3 two-phase behavior**; follow mode retains fingerprint detection, seek mode is new

---

## Closed Open Questions

The following questions were resolved during v3 foundation work:

- **Brightness pass scope:** Applies to all non-Void themes. Void was addressed in a prior implementation pass and is excluded from v3.
- **Brightness pass channels:** `wall`, `floor`, `wallEmerge`, `generating` only. `bg`, `start`, `goal`, and `actor` are unaffected.
- **Brightness pass approach:** Per-theme tuning, not a mechanical multiply. Thematic hue identity must be preserved. Target: approximately 1.25–1.5× on affected channels. Exact hex values are spec-level.
- **Floor variation hash:** Deterministic `(col, row)` hash, stable per cell across frames. Exact formula is spec-level.
- **Floor variation scope:** `FLOOR` semantic state only. Solver-active states override floor rendering and are unaffected. Void is excluded.
- **Floor variation color depth:** Subtle micro-variation (brightness or hue nudge) relative to base floor color. Not a distinct secondary color. Per-theme spec decision.
- **Item persistence:** Per-cycle. Items survive across solver runs within a cycle. Once collected, removed for the remainder of the cycle.
- **Item placement:** Any valid walkable tile except start, goal, and tiles already occupied by another item. Items may be adjacent. No path avoidance. Actor is blind to item positions.
- **Item density formula:** `clamp(round(k × √(cols × rows)), 3, 11)`. Cap is 11, not 12, because each item type appears at most once and there are 11 types. Exact `k` is spec-level.
- **Effect taxonomy:** Temporary (5–60s random at pickup) / Permanent (rest of run) / One-time (instant).
- **Effects at run boundary:** All active temporary effects expire when the current solver run ends. They do not carry over to the next solver's run.
- **Items during walk-to-goal:** Items remain live and fire with full effect during the walk-to-goal phase.
- **Death during walk-to-goal:** Overrides prior solve state. Run exits as ☠ in HUD.
- **Transformation eligibility pool:** All solvers not yet run this cycle, excluding the current solver. Minimum 2 candidates always available; zero-candidate edge case cannot occur given pool size (6) vs. cycle selection count (4).
- **Transformation state inheritance:** Position unchanged. Timer carries over without reset. Visited and breadcrumb state carry over. New solver initializes from current position. Actor color cycling behavior: see Transformation color cycling entry.
- **Transformation run continuity:** Transformation does not end the run. The run continues and concludes normally. HUD updates to show the new solver name.
- **Solution path reveal behavior:** Triggers standard SOLVED → WALK_TO_GOAL pipeline. Indistinguishable from a natural solve from that point forward.
- **Item attention behavior:** Exempt from attention field dimming. Render at full theme color from any distance, consistent with start and goal cells.
- **Cursor light and items:** Cursor light illuminates items identically to walls and floor cells.
- **Item glyphs:** Unique per item type; drawn from Unicode for magical/powerful aesthetic; must not conflict with the reserved semantic glyph set.
- **Item activation effect:** Theme-governed per item type via new `onItemActivated(itemType, position)` lifecycle hook. Per-theme per-item visual behavior is spec-level.
- **HUD exit states:** Solved = elapsed time; Timeout (solve time exceeded) = DNF; Death by item = ☠.
- **HUD active effect display:** Temporary = effect name + countdown. Permanent = effect name + dramatic label (e.g. "FOREVER"). One-time effects produce no persistent HUD entry.
- **WE property surface:** One new property: items enabled toggle, on by default. No other item-related properties exposed.
- **Teleport destination pool:** Excludes start, goal, and item-occupied tiles. Chain-reaction teleports are prevented by design.
- **Effect stacking:** Multiple effects of different types may be active simultaneously. Same-type stacking is impossible by construction (one instance per type per maze). Each active effect's duration runs independently.
- **Solution Path Reveal during walk-to-goal:** No-op. Item is consumed with no effect if the walk-to-goal pipeline is already running.
- **Transformation color cycling:** Smooth sinusoidal oscillation driven by wall-clock time, independent of step interval. Double transformation within a single run is impossible (one transformation item per maze; once collected, gone for the cycle).
- **Item type uniqueness:** Each of the 11 item types appears at most once per maze. Items are drawn without replacement during placement. Effective density cap is 11.
- **Solution path precomputation:** After generation completes and before solver runs begin, the system computes and stores a navigational solution sufficient to walk any actor from any reachable position to the goal. Solution Path Reveal uses this precomputed data, not the current solver's state. Exact algorithm (reverse BFS, distance field, etc.) is spec-level.
- **HUD multiple active effects:** All currently active item effects are shown as a list. Layout and ordering are spec-level.
- **Transformation eligibility (mid-run targets):** A solver used as a transformation target mid-run is marked as used for the entire cycle. It is ineligible for subsequent transformation draws. If the solver was a future scheduled slot in the current cycle, that slot is replaced by the next unscheduled solver drawn from the pool remainder (the 2 bench solvers not originally assigned to cycle slots). Since pool size is 6 and cycle size is 4, there are always 2 bench solvers available; at most 1 transformation fires per cycle; backfill always succeeds. The no-duplicates invariant holds and the cycle continues to run 4 solver slots.
- **Opposing effect arithmetic:** Speed Up + Slow Down cancel to 1.0× net interval. Fog + Lantern cancel to default radius. Speed Up + Freeze: Freeze wins on movement; Speed Up duration ticks silently; actor resumes at sped-up rate if Freeze expires first; Speed Up expires silently if its duration runs out during freeze.
- **Effects during walk-to-goal:** Walk-to-goal is half-cadence for all item effects fired within it: step-interval effects are relative to the already-halved interval; duration-based effects (Freeze, Fog, Lantern, Visual Effect) fire at half their rolled duration. Effects already active when walk-to-goal begins continue on wall-clock time unaffected.
- **Transformation and cycle slot scheduling:** If the transformation target was a future scheduled slot, that slot is replaced by the next bench solver from the pool remainder. Cycle always runs 4 solver slots. No-duplicates invariant guaranteed by pool math (6 solvers, 4 scheduled, 2 bench, 1 max transformation per cycle).
- **Wall follower two-phase behavior:** Seek phase active when actor starts in or navigates into a fully open area (no impassable neighbor). Seek uses right-hand bias with unvisited preference until wall contact. Follow phase is pure right-hand rule with fingerprint cycle detection. Transition is immediate if start cell is already wall-adjacent. Goal may be found in either phase. Supersedes v2 spec §6.4.5 single-phase definition.
- **Wall follower degenerate open-start:** The 4-step spin and immediate fingerprint in a fully open start is the problem the seek phase solves. A DNF after 4 steps is correct but not entertaining; seek phase produces a visible navigation toward structure instead.
