# TASK_09 — Memoize `calculatePlateAtTime`

## Context
TectoLite is a tectonic plate simulation app. Repo at `c:\GIT\TectoLite`.

`src/SimulationEngine.ts` has `calculatePlateAtTime(plate, time, allPlates)` (around line 1772-1855) which is called for **every plate every tick**. It's a pure function (deterministic given same inputs) that:
- Resolves the motion model (`getMotionModel` + `activeStage` + `plateRotation`)
- Computes rotated polygon geometry
- Resolves inherited/dynamic features
- Returns `{ ...plate, polygons, features, center }`

During **time scrubbing** (dragging the time slider), the same `(plateId, time)` is often recomputed repeatedly. There's no memoization.

## Task

### 1. Read `calculatePlateAtTime` fully
Read `src/SimulationEngine.ts` around lines 1772-1855. Understand all inputs and outputs. Confirm it's pure (no side effects, no mutation of inputs).

### 2. Add a memoization cache
Add a per-plate-derivation cache in `SimulationEngine`:

```typescript
private derivationCache: Map<string, { time: number; plate: TectonicPlate; inputHash: string }> = new Map();

private getDerivationCacheKey(plate: TectonicPlate, time: number): string {
    // Hash the inputs that affect derivation: plate id, time, and motion model version.
    // The motion model is defined by motionSegments + geometryStages.
    // If these change (e.g. user edits motion), the cache must invalidate.
    return `${plate.id}:${time}:${plate.motionSegments?.length ?? 0}:${plate.geometryStages?.length ?? 0}:${plate.motionKeyframes?.length ?? 0}`;
}
```

### 3. Wrap `calculatePlateAtTime` with cache check
```typescript
private calculatePlateAtTimeCached(plate: TectonicPlate, time: number, allPlates: TectonicPlate[]): TectonicPlate {
    const key = this.getDerivationCacheKey(plate, time);
    const cached = this.derivationCache.get(plate.id);
    if (cached && cached.time === time && cached.inputHash === key) {
        return cached.plate;
    }
    const result = this.calculatePlateAtTime(plate, time, allPlates);
    this.derivationCache.set(plate.id, { time, plate: result, inputHash: key });
    return result;
}
```

### 4. Invalidate cache on state mutation
The cache must be invalidated whenever a plate's motion model or geometry changes. Add a `invalidateDerivationCache(plateId?: string)` method:
- If `plateId` given: delete that plate's cache entry.
- If no `plateId`: clear the entire cache.

Call `invalidateDerivationCache()` from the `setState` closure in `SimulationEngine` — whenever state is updated, clear the cache (conservative but safe). This is in `src/SimulationEngine.ts` around line 155-161 (the setState closure).

**Better approach**: Only invalidate when the plates array or motion data actually changes. But detecting this requires deep comparison. The conservative approach (clear on every setState) is safe and the cache still helps during scrubbing (where setState is called once per scrub, but calculatePlateAtTime is called for all plates at the new time).

**Even better**: During scrubbing (`setTime`), the cache is the most valuable. `setTime` calls `calculatePlateAtTime` for all plates at the new time. If the user scrubs back and forth, the cache hits. So:
- In `setTime()`: do NOT clear the cache before computing — let it accumulate entries for different times.
- In `update()` (playback tick): the time always advances, so cache hits are rare, but the cache doesn't hurt.
- Clear the cache only when plates are structurally modified (motion edit, split, fuse, draw, delete). Add `invalidateDerivationCache()` calls in `src/main.ts` after these operations (via a method on SimulationEngine).

### 5. Expose cache stats (optional)
Add `getDerivationCacheStats(): { hits: number; misses: number; size: number }` for debugging.

### 6. Bound the cache
The cache could grow unbounded if the user scrubs to many different times. Bound it:
- Max 100 entries per plate (LRU eviction), OR
- Max total 500 entries across all plates, OR
- Simple approach: clear the cache when it exceeds 1000 entries (not LRU, but prevents memory leak).

Choose the simple approach (clear when > 1000 entries) for now.

## Verification
1. `npx tsc --noEmit` — must pass
2. `npx vitest run` — must pass
3. `npx vite build` — must pass
4. **Manual test**: Scrub the time slider back and forth rapidly. Should be smoother than before (cache hits on repeated times).
5. **Manual test**: Edit a plate's motion (change Euler pole). The plate should update immediately (cache invalidated). Scrubbing after the edit should show the new motion (not stale cached results).
6. Verify `calculatePlateAtTime` is still pure — the cache stores the returned object, which must not be mutated downstream. Check that `update()` / `setTime()` don't mutate the returned plates (they should spread/replace, not mutate in place).

## Notes
- The cache key includes `motionSegments.length` / `geometryStages.length` / `motionKeyframes.length` — this detects structural changes (adding/removing segments) but NOT value changes (e.g. changing a pole's rate). For value changes, rely on the explicit `invalidateDerivationCache()` calls.
- If TASK_05 (motion migration) is done, `motionKeyframes` won't exist — remove it from the cache key.
- The cache stores `TectonicPlate` objects which contain arrays of polygons/features. These can be large. The 1000-entry bound prevents unbounded memory growth.
- Do NOT cache during playback (`update()`) if it causes stale renders — the time always advances so cache misses are the norm. The cache is primarily for scrubbing.