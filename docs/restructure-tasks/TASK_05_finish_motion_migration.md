# TASK_05 — Finish Motion Model Migration (Flag Day)

## Context
TectoLite is a tectonic plate simulation app. Repo at `c:\GIT\TectoLite`.

The codebase has **three parallel motion representations** on `TectonicPlate`:
1. `motion: PlateMotion` + `motionKeyframes: MotionKeyframe[]` — **legacy** keyframe model
2. `motionSegments: MotionSegment[]` — **new** piecewise-constant Euler poles
3. `geometryStages: GeometryStage[]` — **new** geometry snapshots at shape-change times

`RotationModel.ts` has `fromLegacyKeyframes(plate)` (pure conversion) and `ensureMotionModel(plate)` (mutating one-way migration). The migration is half-complete — both models coexist, `FusionTool` populates all three, and `ensureMotionModel` mutates plates inside "immutable" update paths.

## Task: Complete the migration to the new model only.

### 1. Run `ensureMotionModel` at all load/import paths
Ensure every plate entering the app state has been migrated to `motionSegments` + `geometryStages`:
- In `src/main.ts` `offerAutosaveRestore()` (around line 220): after loading `data.world`, call `ensureMotionModel` on every plate in `data.world.plates`.
- In `src/main.ts` import handler (around line 1435-1475, both `replace_current` and merge modes): call `ensureMotionModel` on every imported plate.
- In `src/importHelpers.ts` `remapImportedWorld()`: call `ensureMotionModel` on each plate in the `plates` array before returning.
- Add a `migrateWorldMotion(world)` helper in `importHelpers.ts` (similar to `migrateWorldLineTypes`) that calls `ensureMotionModel` on all plates, and use it in the autosave + replace-current paths.

### 2. Remove legacy fields from `TectonicPlate` in `src/types.ts`
After step 1, all plates in state have `motionSegments` + `geometryStages`. Remove:
- `motion: PlateMotion` field
- `motionKeyframes: MotionKeyframe[]` field
- The `PlateMotion` interface (search for all usages first — if anything still references it, update to use `motionSegments`)
- The `MotionKeyframe` interface (search for all usages first)

**IMPORTANT**: Before removing, grep the entire `src/` tree for:
- `plate.motion` (not `plate.motionSegments` or `plate.motionKeyframes`)
- `motionKeyframes`
- `PlateMotion`
- `MotionKeyframe`
- `.motion.` (the legacy eulerPole access pattern)

Update every reference to use the new model. Key places to check:
- `src/main.ts` `handleDrawComplete` (creates plates — must use `motionSegments` + `geometryStages` instead of `motion` + `motionKeyframes`)
- `src/main.ts` `addMotionKeyframe` (the name is legacy — rename to `addMotionSegment` and work with `motionSegments`)
- `src/SplitTool.ts` `splitPlate` (creates child plates — must use new model)
- `src/FusionTool.ts` `fusePlates` (creates fused plate — must use new model ONLY, not all three)
- `src/SimulationEngine.ts` (any direct `plate.motion` access)
- `src/motion/RotationModel.ts` `fromLegacyKeyframes` — can be removed once no save files use keyframes (but keep it as a migration helper called at load time, then remove in a follow-up)

### 3. Update `createDefaultMotion` / plate creation
- `createDefaultMotion()` in `types.ts` returns a `PlateMotion` object. Replace with `createDefaultMotionSegments(currentTime): MotionSegment[]` that returns `[{ time: currentTime, eulerPole: { position: [0,0], rate: 0, visible: false } }]`.
- Update all plate creation sites to use `motionSegments: createDefaultMotionSegments(currentTime)` and `geometryStages: [{ time: currentTime, polygons: [polygon], features: [] }]` instead of `motion` + `motionKeyframes`.

### 4. Update `RotationModel.ts`
- `getMotionModel(plate)`: simplify — always read `plate.motionSegments` + `plate.geometryStages` directly (no more `fromLegacyKeyframes` fallback for in-memory plates).
- Keep `fromLegacyKeyframes` as a standalone function used ONLY by the load-time migration in step 1. Mark it with a JSDoc: "Used only for save-file migration. Not called for in-memory plates."
- `ensureMotionModel(plate)`: keep, but it should now be idempotent (if `motionSegments` already exists, do nothing).

### 5. Update save version
- In `src/export.ts`, bump `SAVE_VERSION` from 3 to 4.
- In `parseImportFile`, add a migration step: if `data.version < 4`, run the motion migration on all plates (call `ensureMotionModel` on each plate in `data.world.plates`).

## Verification
1. `npx tsc --noEmit` — must pass with zero errors
2. `npx vitest run` — must pass (update `RotationModel.test.ts` if tests reference legacy fields)
3. `npx vite build` — must pass
4. `grep -r "motionKeyframes\|PlateMotion\|MotionKeyframe" src/` — should only appear in `RotationModel.ts` `fromLegacyKeyframes` (the migration helper) and possibly `export.ts` migration logic. No other references.
5. `grep -r "\.motion\b" src/` — no results (the `motion` field is gone; `motionSegments`/`motionKeyframes` use different access patterns)
6. Create a test plate, save, reload — motion should be preserved.

## Notes
- This is a **breaking change** for save files — that's why `SAVE_VERSION` bumps to 4. Old saves are migrated at load time.
- The `motion` field on `TectonicPlate` is deeply woven into the codebase. Be thorough with grep — missing a reference will cause a type error (which is good, tsc will catch it).
- `ensureMotionModel` currently **mutates** plates. After this task, it should only be called at load/import time, never inside state update paths. All in-memory plates will already have the new model.
- If `RotationModel.test.ts` tests `fromLegacyKeyframes`, keep those tests — they validate the migration path.