# TASK_12 — Consolidate EventSystem Singleton State + clearCache on New Project/Import

## Context
TectoLite is a tectonic plate simulation app. Repo at `c:\GIT\TectoLite`.

`src/systems/EventSystem.ts` exports a **stateful singleton** `eventSystem` (line 397). It has a private `processedInteractions: Map<string, { time: number; eventId: string }>` (line 31) that tracks which plate-pair interactions have already been processed. This map is **not cleared when a new project is created or a save is imported** unless `clearCache()` is explicitly called.

This means: if the user works on project A, then imports/replaces with project B, the `processedInteractions` map still has entries from project A. Since plate IDs are regenerated on import, the stale entries are mostly harmless (they reference old IDs), but they waste memory and could cause subtle bugs if IDs collide.

## Task

### 1. Find all "new project" / "replace" / "clear" entry points
Search `src/main.ts` for:
- New project / clear all (search for `plates = []` or `clearWorld` or `new project`)
- Import replace-current (around line 1465, `importMode === 'replace_current'`)
- Any "reset" or "clear" button handler

### 2. Add `eventSystem.clearCache()` calls
At every entry point found in step 1, call `eventSystem.clearCache()` before assigning the new state. Import `eventSystem` from `./systems/EventSystem` (it's the exported singleton).

Key places to add it:
- **New project / clear**: search for where `this.state.world.plates = []` or equivalent reset happens. Add `eventSystem.clearCache()` before the reset.
- **Import replace-current** (`src/main.ts` around line 1465): add `eventSystem.clearCache()` before `this.state = { ...this.state, world: importedWorld, ... }`.
- **Autosave restore** (`src/main.ts` around line 220): add `eventSystem.clearCache()` before assigning `data.world`.
- **Undo/redo** (`src/main.ts` around line 4358/4374): add `eventSystem.clearCache()` after restoring state — the event system will re-detect events on the next tick.

### 3. Make `EventSystem` reset-safe
In `src/systems/EventSystem.ts`:
- Verify `clearCache()` only clears `processedInteractions` and nothing else that shouldn't be cleared.
- Add a `reset()` method that clears ALL internal state (not just `processedInteractions` — check if there are other internal caches/maps). Call `reset()` instead of `clearCache()` at the entry points if `reset()` is more thorough.
- Add a JSDoc to `clearCache()` / `reset()` explaining when to call it.

### 4. Consider: should EventSystem be a class instance instead of a singleton?
The singleton pattern means the `eventSystem` is shared across all projects in the session. If the user switches projects, the singleton retains state. Two options:
- **Option A (minimal)**: Keep the singleton, just ensure `clearCache()` is called at all transition points (this task).
- **Option B (cleaner)**: Make `EventSystem` a class instantiated by `SimulationEngine` (not a global singleton). `SimulationEngine` creates `new EventSystem()` in its constructor and resets it when state is replaced. This eliminates the global state entirely.

**Recommended**: Option A for now (minimal risk). Document Option B as a follow-up in a code comment.

### 5. Add a test
Create or update `src/systems/EventSystem.test.ts`:
- Test that `clearCache()` empties the `processedInteractions` map (verify via a public getter or by observing behavior).
- Test that after `clearCache()`, previously-processed interactions are detected as new again.

## Verification
1. `npx tsc --noEmit` — must pass
2. `npx vitest run` — must pass (new EventSystem tests added)
3. `npx vite build` — must pass
4. **Manual test**: Create plates, trigger an event (collision), then import a new save (replace current). The event system should not show stale events from the previous project.
5. `grep -r "clearCache\|eventSystem\.reset" src/main.ts` — should show calls at all transition points.

## Notes
- `eventSystem` is imported in `src/SimulationEngine.ts` (around line 14) and used in `update()` (around line 148). It's a module-level singleton.
- The `processedInteractions` map keys are plate-pair keys (e.g. `"plateA|plateB"`). After import with ID regeneration, old keys are orphaned but not actively harmful — they just waste memory.
- If TASK_01 (delete dead code) removed `CausalGraph`, the event system's relationship to causal links is gone — verify `EventSystem` doesn't reference `CausalLink`/`causalLinks` (it shouldn't, but check).