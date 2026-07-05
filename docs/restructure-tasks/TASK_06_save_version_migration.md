# TASK_06 — Add Save-Version Migration Layer

## Context
TectoLite is a tectonic plate simulation app. Repo at `c:\GIT\TectoLite`.

`src/export.ts` has `SAVE_VERSION = 3` and `parseImportFile()` rejects saves with `version > SAVE_VERSION` but does **no migration** for older saves. Migrations are currently ad-hoc:
- `migrateWorldLineTypes()` in `importHelpers.ts` (handles v2→v3 line type rename)
- `migrateWorldLineTypes` is called in `main.ts` autosave restore + replace-current import paths

There's no centralized, version-gated migration pipeline. As the save format evolves, migrations will accumulate and become hard to track.

## Task

### 1. Create `src/migration.ts`
Create a dedicated migration module:

```typescript
// src/migration.ts
import { WorldState, TectonicPlate } from './types';
import { migrateWorldLineTypes } from './importHelpers';
// import { ensureMotionModel } from './motion/RotationModel'; // if TASK_05 is done

export interface SaveFile {
  version: number;
  savedAt?: string;
  name?: string;
  world: WorldState;
  viewport?: any;
  cameraViews?: any[];
  activeTool?: string;
  activeFeatureType?: string;
}

/** Current save file version. */
export const CURRENT_SAVE_VERSION = 4; // 3 → 4 if TASK_05 done, else 3

/**
 * Migrate a parsed save file to the current version.
 * Each migration step is gated by the version it upgrades FROM.
 * Returns the migrated save file (mutates in place for efficiency).
 */
export function migrateSaveFile(data: SaveFile): SaveFile {
  // v0/undefined → v1: (no known v0 saves exist, but handle gracefully)
  if (!data.version || data.version < 1) {
    data.version = 1;
  }

  // v1 → v2: (whatever changed between v1 and v2 — check git history if needed)
  if (data.version < 2) {
    // Add any v1→v2 migrations here
    data.version = 2;
  }

  // v2 → v3: line type rename (rift/trench/fault/suture → divergent/convergent/transform/generic)
  if (data.version < 3) {
    migrateWorldLineTypes(data.world);
    data.version = 3;
  }

  // v3 → v4: motion model migration (legacy keyframes → motionSegments + geometryStages)
  // Uncomment when TASK_05 is complete:
  // if (data.version < 4) {
  //   for (const plate of data.world.plates) {
  //     ensureMotionModel(plate);
  //   }
  //   data.version = 4;
  // }

  return data;
}
```

### 2. Update `src/export.ts`
- Import `migrateSaveFile`, `SaveFile`, `CURRENT_SAVE_VERSION` from `./migration`.
- Replace `const SAVE_VERSION = 3` with `import { CURRENT_SAVE_VERSION as SAVE_VERSION }`.
- In `parseImportFile()`: after `JSON.parse(text)`, call `migrateSaveFile(data)` before the validation check. Update the version check to reject only `version > CURRENT_SAVE_VERSION` (after migration, `data.version` should equal `CURRENT_SAVE_VERSION`).
- In `exportToJSON()`: use `CURRENT_SAVE_VERSION` in the save data.

### 3. Update `src/main.ts`
- In `offerAutosaveRestore()`: the `migrateWorldLineTypes(data.world)` call can be removed (now handled by `migrateSaveFile` in `parseImportFile`-equivalent path). BUT autosave doesn't go through `parseImportFile` — it reads localStorage directly. So either:
  - (a) Call `migrateSaveFile(data)` on the autosave data before assigning to state, OR
  - (b) Keep `migrateWorldLineTypes` call for autosave and add a comment that it's redundant with the migration layer for file imports.
  - **Recommended**: call `migrateSaveFile(data)` on the autosave data too (option a). Import `migrateSaveFile` from `./migration`.
- In the import handler `replace_current` path: remove the direct `migrateWorldLineTypes(importedWorld)` call — it's now handled by `parseImportFile` → `migrateSaveFile`. Verify this is the case.
- In the merge path (`remapImportedWorld`): the `migrateLineType` call inside `remapImportedWorld` can stay (it's per-plate during remapping) OR be removed if `migrateSaveFile` already ran. **Recommended**: keep it as a safety net — `migrateLineType` is idempotent.

### 4. Add tests for `src/migration.ts`
Create `src/migration.test.ts`:
- Test v2→v3 migration: a world with `lineType: 'rift'` becomes `'divergent'` after migration.
- Test v3→v4 migration (if TASK_05 done): a plate with `motionKeyframes` gets `motionSegments` after migration.
- Test idempotency: migrating a v3 save twice produces the same result.
- Test version rejection: a save with `version > CURRENT_SAVE_VERSION` is rejected.
- Test v0/undefined version: handled gracefully (migrated to current).

## Verification
1. `npx tsc --noEmit` — must pass
2. `npx vitest run` — must pass (test count increases by ~5)
3. `npx vite build` — must pass
4. Load an old v2/v3 save file — should migrate and load correctly.
5. `grep -r "SAVE_VERSION" src/` — should only appear in `export.ts` (as the imported constant) and `migration.ts`.

## Notes
- If TASK_05 is not yet complete, leave the v3→v4 block commented out and keep `CURRENT_SAVE_VERSION = 3`.
- If TASK_05 IS complete, uncomment the v3→v4 block and set `CURRENT_SAVE_VERSION = 4`.
- The migration should be **idempotent** — running it twice on the same data should be a no-op.
- `migrateSaveFile` mutates in place for efficiency (deep cloning a world is expensive). Document this in the JSDoc.



Note out of scope at the end findings and tasks and write them to docs\restructure-tasks\out-of-scope-list