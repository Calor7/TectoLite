# TASK_02 — Fix/Remove Misleading Docs

## Context
TectoLite is a tectonic plate simulation app. Repo at `c:\GIT\TectoLite`. Several documentation files are stale or actively misleading relative to the current codebase.

## Task

### 1. Move misleading docs to `docs/archive/`
- `FEATURE_QUICK_REFERENCE.md` (root) — references `src/utils/TimeTransformationUtils.ts` which **does not exist**, and describes an "Ago" checkbox feature that was removed. Move to `docs/archive/FEATURE_QUICK_REFERENCE.md`.
- `TESTING_CHECKLIST.md` (root) — tests the "Ago" checkbox and time-mode toggle, both removed. Move to `docs/archive/TESTING_CHECKLIST.md`.

### 2. Update `README.md`
- Currently says "Automation Removed" but `EventSystem` and `EventEffectsProcessor` are **active** in `SimulationEngine.ts` (called every tick). Update the automation section to reflect reality:
  - `EventSystem` (guided creation events) — **active**
  - `EventEffectsProcessor` (applies committed event effects) — **active**
  - `GeologicalAutomation` (hotspot volcanism) — **removed** (if TASK_01 is already done) or "disabled" (if not)
  - `ElevationSystem` — removed (file doesn't exist)
- Remove any references to "Mesh System Removed" if the mesh system is genuinely gone (verify by searching `src/` for `mesh`/`Mesh`).
- Ensure the feature list matches what actually exists in `src/`.

### 3. Update `DEVELOPER_README.md`
- Verify the file structure tree matches the actual `src/` directory (run `ls src/` or equivalent).
- Remove references to `GeologicalAutomation.ts` if TASK_01 deleted it.
- Remove references to `ElevationSystem.ts` and `TimeTransformationUtils.ts` (both absent).
- Ensure the architecture description is current.

### 4. Update `DOCUMENTATION_INDEX.md`
- Update the "last reviewed" date to today (2026-07-05).
- Mark `FEATURE_QUICK_REFERENCE.md` and `TESTING_CHECKLIST.md` as moved to archive.
- Verify all doc paths listed still exist.

### 5. Verify `docs/` subdirectory
- `docs/ELEVATION_SYSTEM_PROGRESS.md` — already marked historical, leave as-is.
- `docs/PLAN_rotation_model.md` — current (matches `MotionSegment`/`GeometryStage`), leave as-is.
- `docs/plan_advanced_motion.md` — current, leave as-is.
- `docs/feature_drag_to_time.md` — current, leave as-is.
- `docs/plan_boundary_logic.md` — partially current, leave as-is.
- `docs/TUTORIAL_PROMPT.md` — leave as-is unless clearly stale.

## Verification
1. No file in root references `TimeTransformationUtils.ts` or "Ago checkbox" as current features.
2. `README.md` automation section matches `SimulationEngine.ts` active code paths.
3. `DEVELOPER_README.md` file tree matches actual `src/` structure.
4. `DOCUMENTATION_INDEX.md` date is updated and all listed paths exist.
5. `npx tsc --noEmit` still passes (docs don't affect build, but verify no accidental code edits).

## Notes
- Do NOT modify any `.ts` files in this task — docs only.
- Use `grep -r "TimeTransformationUtils\|Ago checkbox\|Ago mode" .` to find all stale references.