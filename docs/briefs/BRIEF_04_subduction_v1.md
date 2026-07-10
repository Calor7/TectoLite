# BRIEF_04 — Subduction v1: convergent boundaries consume oceanic crust

Release: v0.3.0 "Living Oceans" · Size: L · **The keystone mechanic of this release**

## Goal and why

TectoLite's crust lifecycle is half-built: rifts *create* ocean crust
(isochron rings, derived each frame), but nothing ever *destroys* it. Play
any world long enough and continents plow through their own oceans while
rings pile up underneath — the simulation stops being believable exactly
when a user commits to a long history (a Wilson cycle: ocean opens, ocean
closes) — which is the core promise of the app.

Subduction v1 closes the loop with the cheapest correct mechanic: **where a
continental plate overlaps derived oceanic crust, the ocean is clipped away
under it**. Because rings are ephemeral (derived per frame from isochrons),
destruction implemented as *clipping at derivation time* is automatically
retroactive-safe: scrub backward and the ocean "returns"; change motion and
the consumption re-derives. No new persistent state. This is the
derived-not-stored pillar applied to destruction.

## The map

- **Ring derivation:** `src/SimulationEngine.ts` → `deriveAxisGeometry()`
  (~line 1425) orchestrates: `recordIsochrons` → junction detect →
  `deriveOceanRings` (~1263) → `deriveJunctionWedges` (~1592). Called from
  both `update()` (~78) and `setTime()` (~185). **The clip step slots in
  after rings+wedges are built, inside `deriveAxisGeometry`, so both paths
  get it for free.**
- **Overriding-plate test:** `isOceanicPlate()` from BRIEF_02 (import it;
  if BRIEF_02 hasn't landed, stop — it is a prerequisite). Continental =
  not oceanic. Candidate overriders are non-ephemeral, alive
  (`birthTime <= t`, no `deathTime`), visible-in-world plates whose current
  polygons (already computed for time `t` earlier in the frame) can overlap
  a ring.
- **Clipping library:** `polygon-clipping` is already a dependency (used by
  SplitTool/FusionTool — imitate their usage for ring↔polygon conversion
  conventions, winding, and multi-polygon results).
- **Trench rendering (optional layer):** boundary segments where pairing is
  `continent-ocean` + convergent already come classified from BRIEF_02;
  drawing them as trench lines belongs to `CanvasManager` next to
  `drawDerivedRiftLines()`.
- Toggle wiring sibling: `enableExpandingRifts` (Settings → Oceanic Crust
  section in `AppTemplate.ts`, handler + sync in `main.ts`, default false in
  `types.ts`).

## Work items

1. **`clipOceanAgainstOverriders(rings, overriders): TectonicPlate[]`** —
   pure function, new file `src/systems/SubductionClip.ts`, unit-testable
   without DOM. For each ephemeral ocean plate (ring or wedge): subtract
   (`polygon-clipping` `difference`) the union of overlapping continental
   polygons; drop rings clipped to nothing; split multi-polygon results into
   the ring's `polygons[]` array (the renderer already iterates polygons).
2. **Bounding-box prefilter.** Compute lon/lat bboxes for overriders once
   per frame; skip rings whose bbox doesn't intersect any overrider bbox
   (antimeridian-aware helper — check `sphericalMath.ts`/`geoHelpers.ts`
   for an existing one before writing it).
3. **Wire into `deriveAxisGeometry`** behind
   `globalOptions.enableSubduction === true` (default false; Settings →
   Oceanic Crust section, label "Subduction (consume ocean)" with (i)
   tooltip).
4. **Trench lines:** when subduction is on AND boundary visualization is
   on, render clipped edges that coincide with a convergent continent-ocean
   boundary using the convergent line style. If coincidence-matching proves
   fiddly, ship v1 *without* trench lines and report — the clip is the
   feature; the line is garnish.
5. **Tests** (`SubductionClip.test.ts`): ring fully inside continent →
   dropped; ring half-overlapped → area roughly halved (assert vertex
   subset / area via existing helpers); non-overlapping → untouched;
   multi-polygon split result preserved; antimeridian-straddling ring
   clipped correctly.

## Invariants and traps

- **Never mutate isochrons or `RiftAxis` state.** Consumption is a
  render-derivation effect only. The moment you store "consumed" anywhere,
  retroactive editing breaks — that is the architecture line in the sand.
- Ephemeral plates are identified by `riftAxisId` / `junctionId` and are
  filtered and rebuilt every frame (`update()` ~line 78 and `setTime()`
  ~185 both do the filter-then-derive dance). Your clip runs on the freshly
  derived set only.
- The axis's own flanking plates (`RiftAxis.plateIdA/B`) **do** clip their
  own rings when they re-converge — that is the Wilson-cycle case working
  as intended. Do not special-case them away. Watch item: numeric slivers
  at the ring/continent seam while *diverging* — if slivers appear, clip
  only against overriders whose boundary with the ring is convergent
  (needs BRIEF_02 data) rather than epsilon-shrinking geometry.
- `polygon-clipping` wants closed rings with consistent winding and chokes
  on degenerate/self-intersecting input — SplitTool's existing wrappers
  handle cleanup; reuse them. Wrap calls in try/catch: **on clip failure,
  keep the unclipped ring and count the failure** (degrade to today's
  behavior, never crash the frame).
- Performance: budget = no visible hitch at ~50 rings × 5 continents with
  the prefilter. If exceeded, coarsen: clip only every Nth frame during
  playback (`setTime` always clips exactly). Note what you did in the
  report.
- Oceanic *authored* plates (user-drawn `oceanic_plate` polygons) are NOT
  overriders and NOT clipped in v1 — only derived rings/wedges get clipped,
  only continental plates clip. (Ocean-ocean is parked; see roadmap.)

## Decision log

- Continent always overrides ocean in v1; ocean-ocean deferred (needs ring
  age comparison — the data exists via BRIEF_03's work, the rules don't).
- Clip target = derived ephemeral plates only (rings + wedges); authored
  geometry is never modified by simulation. Users own what they draw.
- No slab memory, no volcanic-arc auto-spawning: arcs remain the
  EventSystem's job (`COLLISION_CONSEQUENCES` already offers volcanic arc /
  trench when guided creation is on). One suggestion path, not two.
- Toggle name `enableSubduction`, grouped under Oceanic Crust, default off
  per standing convention.

## Acceptance criteria

- [ ] Scenario: split → spread 50 Ma → reverse one plate's motion → as it
      advances, rings visibly shrink at its leading edge; scrub backward →
      ocean returns; scrub forward again → identical result.
- [ ] Toggle off → behavior byte-identical to today.
- [ ] All SubductionClip tests green; `npm run verify` + lint green.
- [ ] No frame-time cliff: playback of the test scenario stays smooth
      (state honestly if only eyeballed; BRIEF_09's harness will quantify).
- [ ] Save/load roundtrip unaffected (nothing new persisted except the
      toggle).
- [ ] Manual visual checklist for the user: leading-edge clip looks clean,
      no z-fighting slivers, junction wedges clip consistently with their
      neighbor rings.

## Non-goals

- Ocean-ocean subduction, slab pull / motion feedback, arc/trench feature
  spawning, consuming authored plates, persistent "destroyed crust"
  records, trench-line polish beyond the cheap version.

## Authority boundaries

No commits without user go-ahead. If clipping inside `deriveAxisGeometry`
turns out to require restructuring how `update()`/`setTime()` share the
pipeline, stop and report with a sketch instead of refactoring the engine
under a feature brief.

## Report format

Files changed; test list; the scenario walkthrough with what you observed;
performance note (measured or eyeballed, say which); any clip failures seen
and their inputs; out-of-scope findings →
`docs/restructure-tasks/out-of-scope-list`.
