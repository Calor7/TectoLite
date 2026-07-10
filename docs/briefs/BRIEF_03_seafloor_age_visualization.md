# BRIEF_03 — Seafloor age visualization (isochron age ramp)

Release: v0.3.0 "Living Oceans" · Size: S

## Goal and why

The single most iconic image in plate tectonics is the seafloor age map:
bright young crust at the ridge, fading to old dark abyss at the margins.
TectoLite already *has* the data — every derived ocean ring is built from
isochrons with known times — but renders all ocean in one flat color. This
brief turns existing data into the app's best screenshot: an opt-in "Seafloor
Age" view that colors each ocean ring by its crust age. Zero new simulation
state; render-path only. It also makes spreading history *legible*, which
pays into every later ocean mechanic (users can *see* what subduction eats
in BRIEF_04).

## The map

- Ring construction: `src/SimulationEngine.ts` — `deriveOceanRings()`
  (~line 1263) builds ephemeral `TectonicPlate` objects via
  `createEphemeralOceanPlate()`; each ring spans two isochron times.
  **Probe first:** confirm what `age` / per-ring time the ephemeral plate
  carries (`TectonicPlate.age` is documented as "Creation time (Ma) for
  oceanic slabs", `types.ts:491`). If the ring's isochron time isn't already
  on the plate, thread it through here — that is the only simulation-side
  touch allowed.
- Rendering: `src/canvas/CanvasManager.ts` — find where plate fill color is
  resolved (oceanic plates use `globalOptions.oceanicCrustColor` /
  `oceanicCrustOpacity`). The age ramp slots in exactly there.
- Toggle wiring — imitate `showVelocityArrows` end to end:
  `types.ts` `globalOptions` (+ default `false` in
  `createDefaultWorldState()`), checkbox in the View dropdown "Effects"
  section of `src/ui/AppTemplate.ts`, change handler + `syncUIToState` in
  `src/main.ts`, read in `CanvasManager`.
- Legend: `src/ui/ModalSystem.ts` has `showLegendDialog` — add the age ramp
  there, not as a new overlay.

## Work items

1. Add `showSeafloorAge?: boolean` global option (default off), wired at
   all four points per the standing convention.
2. Age → color: `ageColor(age: number, maxAge: number)` as a **pure
   function in `src/utils/colorUtils.ts`** with tests. Ramp: young `#ff4d00`
   → mid `#ffb700` → old `#1e3a8a` (perceptually ordered, dark = old), lerp
   in RGB is fine. `age = currentTime - ringTime`, `maxAge` = max ring age
   currently visible (recomputed per frame from the derived plates — cheap,
   it's one pass).
3. In `CanvasManager`, when the toggle is on and the plate is an ocean ring
   (`riftAxisId` set — wedges with `junctionId` too), replace the fill color
   with `ageColor(...)`; keep `oceanicCrustOpacity` behavior unchanged.
4. Legend entry: horizontal ramp bar with "0 Ma" and max-age labels.

## Invariants and traps

- **Toggle off must render byte-identical to today.** The `_growing` ring's
  special lighter color (`#60a5fa`) and user-set `oceanicCrustColor` apply
  when the toggle is off; the ramp *replaces* both only when on.
- Default OFF, `=== true` check, `syncUIToState`, persisted in
  `globalOptions` — all four, or the toggle will silently reset on load.
- No per-frame allocations in the color path beyond string building —
  precompute ramp stops; don't parse hex per polygon per frame.
- Ephemeral rings are re-derived each frame with fresh ids — do not key any
  cache by plate id.
- Legacy/sibling-path ocean strips (no `riftAxisId`, but `isOceanic` +
  `age`) should also ramp if their `age` is set — use the same age source
  rule: `plate.age ?? null`; plates without age keep their normal color.

## Decision log

- Ramp normalization is **relative** (to oldest visible crust), not
  absolute (fixed 200 Ma scale): small worlds stay colorful, long worlds
  don't clip. The legend shows the current max so the mapping is explicit.
- Ramp colors are fixed constants in v1 — no user-configurable stops (the
  options dropdown is crowded enough; revisit if asked).
- Wedge fills (`junctionId`) ramp like rings — they are crust of known age.

## Acceptance criteria

- [ ] Toggle on: a 100 Ma spread shows a visible young→old gradient from
      ridge to margin on both sides.
- [ ] Toggle off: rendering identical to pre-change (compare a screenshot).
- [ ] Save → reload preserves the toggle state.
- [ ] Scrubbing time back and forth re-ramps smoothly (relative max
      updates).
- [ ] `colorUtils` ramp tests green; `npm run verify` + lint green.
- [ ] Manual visual pass items listed for the user (gradient look, legend).

## Non-goals

- No absolute-age color scale option, no per-axis coloring, no contour
  lines/isochron outlines (candidate follow-up), no changes to how rings
  are derived.

## Authority boundaries

No commits without user go-ahead. If threading the ring time through
`createEphemeralOceanPlate` requires touching more than ~10 lines of
`SimulationEngine`, stop and report — the data may already be there under
another name (`slabId` encodes generation info; probe before adding fields).

## Report format

Files changed; where the ring age actually came from (probed fact, not
assumption); screenshot instructions for the user's visual pass;
out-of-scope findings → `docs/restructure-tasks/out-of-scope-list`.
