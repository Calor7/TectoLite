# BRIEF_12 — GPlates-Based Earth & Pangaea Templates

Release: v0.3.0 · Size: L

## Goal and why

Replace the crude translate/rotate Pangaea template with scientifically
accurate GPlates reconstructions. Add 5 project templates: Blank, Modern
Earth, Pangaea, Modern Earth (Advanced), Pangaea (Advanced). Advanced
templates include cratons linked to plates and plate motion derived from
the EarthByte rotation model.

## Data sources (in `gplates_references/`)

| File | What | Source |
|---|---|---|
| `shapes_continents/reconstructed_0.00Ma.geojson` | Continental polygons @ 0Ma | GPlates export (Müller et al. 2022) |
| `shapes_continents/reconstructed_200.00Ma.geojson` | Continental polygons @ 200Ma | GPlates export |
| `shapes_cratons/reconstructed_0.00Ma.geojson` | Craton polygons @ 0Ma | GPlates export |
| `shapes_cratons/reconstructed_200.00Ma.geojson` | Craton polygons @ 200Ma | GPlates export |
| `1000_0_rotfile.rot` | Rotation model (Euler poles + angles) | EarthByte Müller et al. 2022 |

## The 5 templates

| # | Template | Continents | Cratons | Plate motion |
|---|---|---|---|---|
| 1 | Blank World | — | — | — |
| 2 | Modern Earth | ✅ grouped by plate ID | — | From rotation file @ 0Ma |
| 3 | Pangaea (~200 Ma) | ✅ grouped by plate ID | — | From rotation file @ 200Ma |
| 4 | Modern Earth (Advanced) | ✅ | ✅ linked to plates | From rotation file @ 0Ma |
| 5 | Pangaea (Advanced) | ✅ | ✅ linked to plates | From rotation file @ 200Ma |

## Work items

1. **Build-time preprocessing script** (`scripts/preprocess-gplates.js`):
   - Read all 4 GeoJSON files + rotation file
   - Simplify geometries (Douglas-Peucker, tolerance ~0.5°)
   - Group continent features by PLATEID1 → one plate per group
   - Group craton features by PLATEID1 → linked to their parent plate
   - Parse rotation file: for each plate ID, find the entry at 0Ma and
     200Ma, extract Euler pole (lat, lon) and compute rate from angle
   - Output 4 compact JSON files to `src/assets/`:
     - `gplates-modern.json` (continents + motion @ 0Ma)
     - `gplates-pangaea.json` (continents + motion @ 200Ma)
     - `gplates-modern-adv.json` (continents + cratons + motion @ 0Ma)
     - `gplates-pangaea-adv.json` (continents + cratons + motion @ 200Ma)
   - Target: each file < 500KB after simplification

2. **Rotation file parser**:
   - Format: `plateId  time  eulerLat  eulerLon  angleDeg  refPlateId`
   - For each plate ID, find entries bracketing the target time (0 or 200)
   - Interpolate Euler pole position and angle
   - Convert angle to rate (deg/Ma) by differencing with the next time step
   - Handle the chain: plate 101 → refPlate 714 → refPlate 000 (anchor)
   - Compute absolute motion by following the reference chain

3. **Update `projectTemplates.ts`**:
   - Replace the current `REGIONS` + `transformRing` approach
   - Load preprocessed JSON files via `import.meta.glob` or `?raw`
   - Create plates from grouped features
   - Assign colors from a palette (hash plate ID to hue)
   - Set motion segments from extracted Euler poles
   - For advanced templates, add craton polygons as features on their
     parent plate

4. **Update New Project dialog** to show 5 options

## Acceptance criteria

1. `npx tsc --noEmit` passes
2. `npx vitest run` passes
3. `npx vite build` passes
4. All 5 templates create valid worlds with ≥ 2 plates
5. Modern Earth template produces recognizable continents
6. Pangaea template produces a supercontinent
7. Advanced templates include craton features
8. Plate motion values are non-zero for major plates
9. Preprocessed JSON files are each < 500KB