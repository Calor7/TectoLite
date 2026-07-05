# TASK_03 — Extract Shared Geometry Utils

## Context
TectoLite is a tectonic plate simulation app (TypeScript + Vite + Electron + Canvas2D). Repo at `c:\GIT\TectoLite`.

`isPointInPolygon` is **duplicated verbatim** in two files:
- `src/SplitTool.ts` (around line 30-60) — ray-casting point-in-polygon on equirectangular coordinates
- `src/SimulationEngine.ts` (around line 33-60) — identical logic

Both use the same equirectangular ray-casting algorithm with antimeridian longitude wrapping.

## Task

### 1. Move `isPointInPolygon` to `src/utils/sphericalMath.ts`
- Read both implementations in `src/SplitTool.ts` and `src/SimulationEngine.ts` to confirm they're identical.
- Add `isPointInPolygon` as an exported function to `src/utils/sphericalMath.ts` (this file already has quaternion/spherical math utilities — follow its existing style).
- The function signature should be: `export function isPointInPolygon(point: Coordinate, polygon: Coordinate[]): boolean` (where `Coordinate = [number, number]` is `[lon, lat]`).
- Include a JSDoc comment explaining the equirectangular ray-casting approach and its limitations near poles/antimeridian.

### 2. Update `src/SplitTool.ts`
- Remove the local `isPointInPolygon` function definition.
- Add `isPointInPolygon` to the import from `./utils/sphericalMath` (or add a new import line if none exists).
- Verify all call sites still work (search for `isPointInPolygon` in the file).

### 3. Update `src/SimulationEngine.ts`
- Remove the local `isPointInPolygon` function definition.
- Add `isPointInPolygon` to the import from `./utils/sphericalMath` (or add a new import line).
- Verify all call sites still work.

### 4. Check for other geometry duplication
- Search `src/` for `lerpCoordinate` — if duplicated, also move to `sphericalMath.ts`.
- Search for any other duplicated spherical geometry helpers (e.g. `greatCircleDistance`, `normalizeLon`) and consolidate if found.

### 5. Add tests for `isPointInPolygon`
- Add test cases to `src/utils/sphericalMath.test.ts` (which already exists and has ~24 tests):
  - Point clearly inside a polygon
  - Point clearly outside a polygon
  - Point on the boundary (edge case)
  - Polygon spanning the antimeridian (lon ~180)
  - Degenerate polygon (2 points, should return false)
  - Empty polygon (should return false)

### 6. Document Boundary.type vs LineType distinction
- In `src/types.ts`, add a JSDoc comment on the `Boundary` interface explaining that `Boundary.type` ('convergent'|'divergent'|'transform') is **derived from plate motion** by `BoundarySystem`, while `LineType` ('divergent'|'convergent'|'transform'|'generic') is an **authored property** of line entities. They share vocabulary but are semantically independent and should not be unified.

## Verification
1. `npx tsc --noEmit` — must pass
2. `npx vitest run` — must pass (test count should increase by ~6)
3. `grep -n "isPointInPolygon" src/SplitTool.ts src/SimulationEngine.ts` — should show only imports/calls, no function definitions
4. `npx vite build` — must pass

## Notes
- `Coordinate` type is `[number, number]` (lon, lat) — defined in `src/types.ts`.
- `src/utils/sphericalMath.ts` already exports `Vector3`, `latLonToVector`, `vectorToLatLon`, etc. Follow the existing import style.
- Do NOT change the algorithm — just move it. The duplication is the problem, not the implementation.