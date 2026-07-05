# TASK_01 — Delete Dead Code: GeologicalAutomation + CausalGraph

## Context
TectoLite is a tectonic plate simulation app (TypeScript + Vite + Electron + Canvas2D). Repo at `c:\GIT\TectoLite`.

## Task
Remove two pieces of dead/vestigial code:

### 1. Delete `src/systems/GeologicalAutomation.ts`
- This file is **dead code**. Its import in `src/SimulationEngine.ts` is commented out (around line 13 and line 265). It is not called anywhere in the active code path.
- Delete the file.
- Remove any commented-out imports/references in `src/SimulationEngine.ts` (search for `GeologicalAutomation`).
- Search the entire `src/` tree for any remaining references to `GeologicalAutomation` and remove them.
- Update `DEVELOPER_README.md` if it references `GeologicalAutomation.ts`.

### 2. Remove `src/causality/CausalGraph.ts` entirely
- `CausalGraph.ts` is well-written but **vestigial** — it produces `CausalLink[]` metadata that **no UI, no simulation logic, and no visualization consumes**. The query helpers (`ancestorsOf`, `descendantsOf`, `linksFor`) are never called outside tests.
- Delete `src/causality/CausalGraph.ts` AND `src/causality/CausalGraph.test.ts`.
- Remove the `causality/` directory if it becomes empty.
- In `src/types.ts`: remove the `CausalLink` interface, the `EntityRef` type, and the `causalLinks?: CausalLink[]` field from `WorldState`. Search for `CausalLink`, `EntityRef`, `causalLinks` across all files.
- In `src/main.ts`: remove the import of `reseedAutoLinks` from `./causality/CausalGraph`. Remove all calls to `reseedAutoLinks` (search for `reseedAutoLinks` — around 2 call sites near import/merge logic, lines ~1513 and ~1552). Remove any `causalLinks` spreading in state updates (search for `causalLinks:`).
- In `src/importHelpers.ts`: remove `CausalLink` and `EntityRef` from imports. Remove the `causalLinks` remapping logic (the `remapEntityRef` function and the `causalLinks` array construction near the end of `remapImportedWorld`). Remove `causalLinks` from the `RemappedImport` interface and from the return object.
- In `src/export.ts`: remove `pruneCausalLinks` import and usage. Remove `causalLinks` from the saved world object (search for `causalLinks`).
- Search the entire `src/` tree for `causal`, `CausalLink`, `EntityRef`, `reseedAutoLinks` and remove all remaining references.

## Verification
1. `npx tsc --noEmit` — must pass with zero errors
2. `npx vitest run` — must pass (the CausalGraph.test.ts is deleted, so test count drops by ~12)
3. `npx vite build` — must pass
4. `grep -r "GeologicalAutomation" src/` — no results
5. `grep -r "CausalLink\|causalLinks\|EntityRef\|reseedAutoLinks\|CausalGraph" src/` — no results

## Notes
- Be thorough with grep — these symbols may appear in comments, type imports, or test fixtures.
- The `causalLinks` field on `WorldState` is optional (`?`) so removing it won't break save files (they just carry extra JSON that gets ignored).
- Do NOT remove `CausalLink` references from `docs/` — historical docs are fine to leave as-is.