# BRIEF_02 — Boundary classification v2: local edge normals + crust pairings

Release: v0.3.0 "Living Oceans" · Size: S

## Goal and why

`BoundarySystem` decides whether two touching plates converge, diverge, or
slide — the trigger for everything downstream (guided-creation events today,
subduction clipping in BRIEF_04 tomorrow). The velocity threshold was already
calibrated (`src/BoundarySystem.ts:231`, `THRESHOLD = 0.0005` rad/Ma ≈
0.3 cm/yr), but two weaknesses remain, both named in
`docs/plan_boundary_logic.md` (steps 2–3, never executed):

1. **Centroid-to-centroid direction.** Relative motion is evaluated along
   the line between plate *centroids*. For long, serpentine plates (an
   Andes-like margin) the centroid direction has little to do with the local
   collision normal → misclassification exactly where users build the most
   interesting geology.
2. **No crust pairing awareness.** A continent–ocean collision and a
   continent–continent collision report identically. BRIEF_04 (subduction)
   and the EventSystem's consequence menu both need to know *which kind* of
   convergence this is.

This brief makes classification local and pairing-aware. It is deliberately
small and lands before BRIEF_04, which consumes its output.

## The map

- `src/BoundarySystem.ts` — all changes land here plus its (new) test file.
  - `classifyBoundaryProps(p1, p2, boundaryPt)` at ~line 198 is the function
    to upgrade: it currently builds the relative velocity from each plate's
    active Euler pole and projects it onto the centroid-to-centroid
    direction.
  - Overlap detection and boundary-segment extraction happen earlier in the
    same file (the overlap threshold comment "0.2 deg²" is at ~line 135) —
    the overlap polygon segments you need for local normals already exist
    there; trace how `points: Coordinate[][]` ends up on the `Boundary`.
- `Boundary` interface: `src/types.ts:645` — already carries
  `polygonTypes: [PolygonType?, PolygonType?]`; you will add a derived
  pairing field (see decision log).
- Motion sampling: use `RotationModel` helpers (`activeEulerPole` /
  `plateRotation` in `src/motion/RotationModel.ts`) — do **not** hand-roll
  pole math; every duplicated rotation walker in this repo's history became
  a bug.
- Sibling to imitate for tests: `src/motion/RotationModel.test.ts` (golden
  scenarios with synthetic plates, pure functions, no DOM).

## Work items

1. **Weighted local normal.** For each boundary, compute the classification
   direction from the boundary geometry itself: average the outward normals
   of the overlap-polygon segments (weight by segment length), instead of
   the centroid-to-centroid vector. Evaluate relative velocity of the two
   plates *at the boundary midpoint* (already partially done — velocity is
   sampled at `boundaryPt`) and project onto that local normal.
2. **Crust pairing.** Derive
   `pairing: 'continent-continent' | 'continent-ocean' | 'ocean-ocean'`
   from the two plates. Rule: a plate is oceanic if `isOceanic === true` or
   `type === 'oceanic'` or `polygonType === 'oceanic_plate'`; otherwise
   continental. Put this rule in ONE exported pure function
   (`isOceanicPlate(plate)`) — BRIEF_04 will import it.
3. **Expose velocity in cm/yr** consistently on `Boundary.velocity`
   (convert with the current planet radius from
   `globalOptions.planetRadius` — see `src/ui/SpeedPresets.ts` for the
   existing deg/Ma ↔ cm/yr conversion; reuse, don't duplicate).
4. **Unit tests** (`src/BoundarySystem.test.ts`): synthetic two-plate
   scenarios — head-on convergence at 5 cm/yr classifies convergent with
   correct pairing; pure divergence; pure transform (motion parallel to
   boundary); the serpentine case: a long thin plate whose centroid
   direction says "transform" but whose local normal says "convergent".

## Invariants and traps

- **`Boundary.type` and `LineType` stay separate** — approved fence #6,
  documented in the `Boundary` JSDoc (`types.ts:633–644`). Do not unify.
- `BoundarySystem` runs per-frame only when `enableBoundaryVisualization`
  is on. Keep it that way; do not add unconditional per-frame work.
- The EventSystem consumes `collisionType` on `TectonicEvent.interactionInfo`
  (`types.ts:202`) with the same three-value union — reuse those literal
  strings exactly so events remain compatible.
- Ephemeral plates (ocean rings: `riftAxisId` set; wedges: `junctionId`
  set) flow through the same plate list. Classification between a ring and
  its own flanking continent is legitimate (that's subduction later), but
  ring-vs-ring boundaries are noise — skip pairs where **both** plates are
  ephemeral.
- Antimeridian and pole: build normals in 3D vector space (helpers in
  `src/utils/sphericalMath.ts`), not in lon/lat screen space.

## Decision log

- Local normal = length-weighted average of overlap segment normals (plan
  doc step 3), not per-segment classification — one boundary keeps one type
  in v1; per-segment types are a future refinement if users ask.
- Pairing lives on `Boundary` as a new optional field `pairing?:` (three-way
  union above). Optional keeps old saves/typing untouched — boundaries are
  transient state, never persisted (`WorldState.boundaries?` is runtime
  only), so no save-version bump.
- `isOceanicPlate` treats `oceanic_plate` polygonType as oceanic even
  without the flag — authored "oceanic plate" polygons should behave like
  ocean.

## Acceptance criteria

- [ ] Serpentine test passes (local normal beats centroid).
- [ ] Head-on 5 cm/yr collision → `convergent`, correct `pairing`, velocity
      ≈ 5 cm/yr (±10%).
- [ ] Both-ephemeral pairs produce no boundary.
- [ ] `npm run verify` + `npm run lint` green; new test file ≥ 6 scenarios.
- [ ] With `enableBoundaryVisualization` on, boundary colors on canvas look
      sane on a quick manual check (state this needs the user's eyes).

## Non-goals

- No geometric consequences (no clipping, no feature spawning) — BRIEF_04.
- No UI changes beyond what already renders boundaries.
- No per-segment boundary typing.

## Authority boundaries

No commits without user go-ahead. If `classifyBoundaryProps`'s callers turn
out to depend on centroid behavior in surprising ways (e.g. FusionTool
suggestions degrade), stop and report rather than tuning heuristics blind.

## Report format

Files changed with paths; test list with names; before/after classification
for the four synthetic scenarios; manual-check note for canvas colors;
out-of-scope findings → `docs/restructure-tasks/out-of-scope-list`.
