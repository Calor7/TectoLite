# TASK_18 — Add Tests for High-Risk Untested Modules

## Context
TectoLite is a tectonic plate simulation app. Repo at `c:\GIT\TectoLite`.

The codebase has ~5% test coverage. Only pure utilities are tested (`sphericalMath`, `RotationModel`, `CausalGraph`, `importHelpers`, `HistoryManager`). The highest-risk modules with **zero tests** are:

1. `src/SplitTool.ts` (~1,391 lines) — spherical polygon splitting, edge-metadata assignment
2. `src/BoundarySystem.ts` (~254 lines) — overlap detection, convergent/divergent/transform classification
3. `src/SimulationEngine.ts` `calculatePlateAtTime` (~1,935 lines total) — the derivation core
4. `src/FusionTool.ts` (~210 lines) — polygon union, feature merging

## Task

### 1. `src/SplitTool.test.ts`
Create comprehensive tests for plate splitting:

**Test fixtures**: Create simple test plates with known geometry:
- A square plate: `[[0,0],[10,0],[10,10],[0,10]]`
- A plate spanning the antimeridian: `[[170,0],[-170,0],[-170,10],[170,10]]`
- A plate with features (mountain at center)

**Test cases**:
- Split a square vertically → two rectangles. Verify: 2 children, correct point counts, parent IDs set, edge metadata assigned.
- Split horizontally → two rectangles.
- Split along a diagonal → two triangles.
- Split a plate with features → features partitioned correctly (feature in child A's polygon goes to A, etc.).
- Split a plate spanning the antimeridian → verify antimeridian handling.
- Split with a polyline that doesn't intersect the polygon → should handle gracefully (no split or error).
- Split with a polyline that touches a vertex → deduplication fix (the subtle case mentioned around line 120-140).
- Verify `isPointInPolygon` (if TASK_03 moved it to sphericalMath, test it there instead).

### 2. `src/BoundarySystem.test.ts`
Create tests for boundary detection and classification:

**Test fixtures**: Create two plates with known positions and motion:
- Two plates side by side, moving toward each other → convergent
- Two plates side by side, moving apart → divergent (if detectable)
- Two plates side by side, sliding past each other → transform
- Two non-overlapping plates → no boundary

**Test cases**:
- `checkOverlap`: two overlapping squares → returns intersection polygon.
- `checkOverlap`: two non-overlapping squares → returns null/empty.
- `classifyBoundaryProps`: closing speed > threshold → 'convergent'.
- `classifyBoundaryProps`: closing speed < -threshold → 'divergent'.
- `classifyBoundaryProps`: closing speed ≈ 0 → 'transform'.
- `detectBoundaries`: two converging plates → one boundary with type 'convergent'.
- `detectBoundaries`: two non-overlapping plates → empty array.
- Verify the 50ms frame budget doesn't silently drop results in small worlds.

### 3. `src/SimulationEngine.test.ts`
Create tests for `calculatePlateAtTime` (the derivation core):

**Test fixtures**: Create a plate with:
- `motionSegments: [{ time: 0, eulerPole: { position: [0, 90], rate: 10 } }]` (rotation around north pole)
- `geometryStages: [{ time: 0, polygons: [{ id: 'p', points: [[0,0],[10,0],[10,10],[0,10]], closed: true }], features: [] }]`
- `birthTime: 0`, `deathTime: null`

**Test cases**:
- `calculatePlateAtTime(plate, 0, allPlates)` → geometry unchanged (at birth time).
- `calculatePlateAtTime(plate, 10, allPlates)` → geometry rotated by 100° around [0,90]. Verify a known point moves to the expected position.
- Plate with parent: child plate delegates to parent motion before `birthTime`. Verify pre-birth position matches parent.
- Plate with `linkedToPlateId`: inherits parent motion within `[linkTime, unlinkTime]`.
- Plate with features: inherited features (from parent before split) vs dynamic features (placed after stage) — verify both are positioned correctly.
- Dead plate (time > deathTime) → skipped.
- Not-yet-born plate (time < birthTime) → skipped.

**Note**: `calculatePlateAtTime` is a private method. Either (a) make it public/protected for testing, or (b) test via the public `setTime` / `update` API and verify the resulting state. Option (b) is preferred (tests the public contract).

### 4. `src/FusionTool.test.ts`
Create tests for plate fusion:

**Test fixtures**: Two overlapping plates:
- Plate A: square `[[0,0],[10,0],[10,10],[0,10]]`, color red
- Plate B: square `[[5,0],[15,0],[15,10],[5,10]]`, color blue
- Overlap region: `[[5,0],[10,0],[10,10],[5,10]]`

**Test cases**:
- Fuse A + B → one plate with union polygon `[[0,0],[15,0],[15,10],[0,10]]`.
- Fused plate has `parentPlateIds: [A.id, B.id]`.
- Fused plate color is a mix of red and blue (verify the mixing logic).
- Fused plate features = A.features + B.features.
- Fuse two non-overlapping plates → `fallbackMerge` (concatenated polygons).
- Fuse two oceanic plates → polygon type 'oceanic'.
- Fuse oceanic + continental → polygon type 'continental' (or whatever the current logic dictates).

## Verification
1. `npx tsc --noEmit` — must pass
2. `npx vitest run` — must pass (test count should increase by ~30-40)
3. `npx vite build` — must pass
4. `npx vitest run --coverage` — coverage should be ≥ 10% (up from ~5%)

## Notes
- Use the existing test style (vitest, `describe`/`it`, no external mocks).
- For `SplitTool` and `FusionTool`, the functions are pure (take inputs, return outputs) — easy to test.
- For `SimulationEngine`, you may need to mock or partially construct the engine. The `calculatePlateAtTime` logic is the key — test it in isolation if possible.
- For `BoundarySystem`, `polygon-clipping` is a real dependency — use it, don't mock it.
- Don't test edge cases you can't verify by hand — focus on cases where you can compute the expected output.
- If TASK_03 (extract isPointInPolygon) is done, import from `sphericalMath` in the test fixtures.
- If TASK_05 (motion migration) is done, use `motionSegments`/`geometryStages` in fixtures (not `motionKeyframes`).