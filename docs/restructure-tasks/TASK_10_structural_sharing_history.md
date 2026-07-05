# TASK_10 — Replace structuredClone History with Structural Sharing

## Context
TectoLite is a tectonic plate simulation app. Repo at `c:\GIT\TectoLite`.

`src/HistoryManager.ts` (~95 lines) deep-clones the entire `AppState` via `structuredClone(state)` (with `JSON.parse(JSON.stringify(...))` fallback) on every `pushState()` call. The stack holds up to 50 entries. For large worlds (hundreds of plates/polygons/features), this means up to 50 full deep clones in memory — a performance cliff.

The state is already updated with immutable-spread at the top level (`this.state = { ...this.state, world: { ...this.state.world, plates: [...] } }`). This means unchanged branches share references. We can exploit this for structural sharing instead of deep cloning.

## Task

### 1. Read `src/HistoryManager.ts` and `src/HistoryManager.test.ts` fully
Understand the current API: `push(state)`, `undo()`, `redo()`, `canUndo()`, `canRedo()`, `clear()`. Understand the test expectations (deep clone isolation — undoing should not affect the current state).

### 2. Implement structural sharing
Replace `structuredClone` with a **shallow clone + reference sharing** approach:

```typescript
export class HistoryManager<T> {
    private undoStack: T[] = [];
    private redoStack: T[] = [];
    private maxSize: number;

    constructor(maxSize = 50) {
        this.maxSize = maxSize;
    }

    push(state: T): void {
        // Store a shallow clone — the top-level object is cloned, but nested
        // references are shared. This is safe because the app uses immutable-spread
        // updates: when a branch changes, a new object is created; unchanged
        // branches keep their references.
        this.undoStack.push({ ...state });
        if (this.undoStack.length > this.maxSize) {
            this.undoStack.shift();
        }
        this.redoStack = [];
    }

    undo(currentState: T): T | null {
        if (this.undoStack.length === 0) return null;
        // Push current state to redo stack (shallow clone)
        this.redoStack.push({ ...currentState });
        return this.undoStack.pop()!;
    }

    redo(currentState: T): T | null {
        if (this.redoStack.length === 0) return null;
        this.undoStack.push({ ...currentState });
        return this.redoStack.pop()!;
    }

    canUndo(): boolean { return this.undoStack.length > 0; }
    canRedo(): boolean { return this.redoStack.length > 0; }
    clear(): void { this.undoStack = []; this.redoStack = []; }
}
```

### 3. Verify immutability discipline
The structural sharing approach is **only safe if the app never mutates state in place**. Audit the state update paths:
- `src/main.ts`: most updates use `{ ...this.state, world: { ...this.state.world, ... } }` — safe.
- `src/motion/RotationModel.ts` `ensureMotionModel`: **MUTATES** plates in place. This is a problem — if a plate is mutated after being shared between history entries, undo will show the mutated state.
  - **If TASK_05 is done**: `ensureMotionModel` is only called at load time, not during state updates — safe.
  - **If TASK_05 is NOT done**: `ensureMotionModel` is called inside `addMotionKeyframe` and other update paths. You must either (a) deep-clone the plate before calling `ensureMotionModel`, or (b) defer this task until TASK_05 is done.
  - **Recommended**: check if TASK_05 is complete. If not, add a shallow clone of the plate before `ensureMotionModel` calls: `const plateClone = { ...plate, motionSegments: [...(plate.motionSegments || [])], geometryStages: [...(plate.geometryStages || [])] }; ensureMotionModel(plateClone);` then use `plateClone` in the state update.
- Search for other in-place mutations: `grep -r "plate\.\w* = " src/main.ts` and `grep -r "\.push(\|\.splice(\|\.pop(" src/main.ts` — verify these operate on new arrays, not shared references.

### 4. Update `HistoryManager.test.ts`
The existing tests verify deep-clone isolation (mutating a nested object after push should not affect the history entry). With structural sharing, this isolation no longer holds for in-place mutations. Update the tests:
- Test that **immutable-spread updates** (creating new objects) don't affect history entries — this should pass.
- Remove or rewrite tests that do **in-place mutation** of nested objects after push — those tests validated the old deep-clone behavior, which we're intentionally replacing.
- Add a test verifying memory efficiency: pushing 50 states with the same plate array should not create 50 copies of the array (check reference equality: `history.undoStack[0].world.plates === history.undoStack[1].world.plates` when plates didn't change).

### 5. Update `src/main.ts` pushState/undo/redo
The current `undo()` / `redo()` in `main.ts` (around line 4358/4374) pop a state and assign `this.state = prevState`. With structural sharing, the popped state shares references with the current state. This is fine as long as the app continues immutable-spread discipline. No changes needed to the undo/redo handlers themselves — just verify they don't mutate the popped state.

## Verification
1. `npx tsc --noEmit` — must pass
2. `npx vitest run` — must pass (HistoryManager tests updated)
3. `npx vite build` — must pass
4. **Manual test**: Create a plate, move it, undo, redo — should work correctly.
5. **Manual test**: Create 10 plates, undo 5 times, redo 5 times — should work correctly.
6. **Memory check**: With 50 history entries of a 20-plate world, memory usage should be significantly lower than before (no 50x deep clones).

## Notes
- This is an **optimization** — the behavior should be identical from the user's perspective. The only change is memory usage.
- The risk is **in-place mutation breaking undo**. If undo shows wrong state after this change, it means somewhere a plate/world object is being mutated in place instead of immutably replaced. Fix those mutation sites.
- If TASK_05 is not done, the `ensureMotionModel` mutation is the main risk. Either fix it (shallow clone before mutate) or defer this task.
- The `{ ...state }` shallow clone is O(1) for the top level — it copies field references, not deep content. `world`, `viewport`, `activeTool` etc. are shared by reference. This is correct because the app creates new `world` objects on every update.


Note out of scope at the end findings and tasks and write them to docs\restructure-tasks\out-of-scope-list