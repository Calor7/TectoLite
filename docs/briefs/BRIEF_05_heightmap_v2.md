# BRIEF_05 — Heightmap v2: boundary-aware relief, age-depth oceans

Release: v0.3.0 "Living Oceans" · Size: M

## Goal and why

"Every session ends in a map" is a roadmap pillar, and the heightmap is the
export worldbuilders actually feed into other tools (Wonderdraft, QGIS,
game engines). Today `HeightmapGenerator.generate()` paints every plate a
flat 120-gray and stamps radial blobs for features
(`src/systems/HeightmapGenerator.ts:48–80`) — the output reads as
paper cutouts, not terrain.

The simulation now knows enough to do far better without any new runtime
state: seafloor age (isochrons → depth via subsidence), collision zones
(committed orogeny events + mountain features → ridges, not dots),
trenches, crust classes (`polygonType`: craton high, shelf low). v2 makes
the heightmap *derive relief from history* at raster time only.

## The map

- Everything lands in `src/systems/HeightmapGenerator.ts` (+ new pure
  helper module + tests). The generator receives full `AppState` and
  already handles projections via d3-geo; keep that shell.
- Callers: `src/export.ts` (unified export dialog) and
  `src/GeoPackageExporter.ts` (`includeHeightmap` option,
  `types.ts:845–851`). Signature stability keeps both callers untouched —
  extend `HeightmapOptions` with optional fields instead of changing
  parameters.
- Data sources to raster from:
  - Ocean rings/wedges: derived plates with `riftAxisId`/`junctionId` and
    ring age (threaded by BRIEF_03 — prerequisite for the age-depth layer;
    the rest of this brief does not depend on it).
  - Features: `plate.features` / world features — `mountain`, `volcano`,
    `trench`, `rift`, `island` types (`types.ts:94`).
  - Committed tectonic events: `world.tectonicEvents` with
    `boundarySegment: Coordinate[][]` (`types.ts:194–211`) — a ready-made
    *line* to raise a mountain belt along, far better than scattered
    feature dots.
  - `polygonType` per plate (`craton`, `continental_crust`, `island`…).
- Rendering technique to imitate: the existing feature pass already draws
  radial gradients with screen-space radii scaled by `width/360` — extend
  that idiom (canvas gradients along paths) rather than per-pixel loops.

## Work items

1. **Elevation model constants** in one exported table (new
   `src/systems/elevationModel.ts`, pure):
   grayscale 0–255 mapped as — deep ocean floor by age
   (young ridge ≈ 70, old abyss ≈ 25, `depth ∝ sqrt(age)` shape),
   continental base 120, craton 135, island/continental_crust 110,
   orogeny belt peak +60 with falloff width from the event's
   `parameters.width` (km → degrees via planet radius), trench along
   convergent segments ≈ 10, rift valley dip −25 along divergent lines.
   Pure functions: `oceanDepthGray(age, maxAge)`, `beltProfile(distance,
   width)` — unit-test these, not the canvas.
2. **Layered raster passes** in `generate()` (order matters, later draws
   over earlier): background abyss → ocean rings by age → continental
   bases by `polygonType` → orogeny belts along committed event
   `boundarySegment` polylines (stroke with wide soft gradient, canvas
   `lineCap: round`) → trench/rift lines → point features (kept, smaller
   weight) → existing smooth pass.
3. **Options**: extend `HeightmapOptions` with `ageDepth?: boolean`,
   `reliefFromEvents?: boolean` (both default true — this is an export
   dialog, not a canvas overlay; the defaults-off rule governs *canvas
   visuals/automation*, and the export preview makes the effect explicit
   and reversible). Expose two checkboxes in the export dialog
   (`src/export.ts`), checked by default.
4. **Tests**: pure-function tests for the elevation model (monotonic age →
   darker; belt profile peaks at 0 and falls to ~0 at width). One
   integration smoke test that `generate()` resolves to a dataURL on a tiny
   synthetic state (jsdom canvas may be unavailable in vitest — if so, keep
   generator untested and say so; the pure module is the testable core).

## Invariants and traps

- **Raster-time only.** No new fields on plates/world; nothing persisted.
  The heightmap must remain a pure function of (state, time, options).
- Equirectangular is the format downstream tools expect — verify the 2:1
  export path produces exactly full-sphere coverage (the current
  `fitSize` + `Sphere` approach does; don't break it).
- Committed events only (`committed === true`), and respect
  `effectStartTime`/`effectEndTime` if set — an orogeny shouldn't raise
  mountains before `currentTime` reaches it; ramp belt intensity by
  progress like `EventEffectsProcessor` does (read that file for the
  progress convention before implementing).
- Winding/antimeridian: reuse the existing `geoArea` ring-reversal guard
  (already in the file at ~line 74) for every new polygon pass.
- Performance budget: 4096×2048 export in a few seconds. Canvas gradient
  strokes are fine; avoid per-pixel JS loops except the existing smooth
  pass.
- `plate.elevation?` exists on the type (`types.ts:496`) — probe whether
  anything sets it; if authored elevation exists, it should override the
  polygonType base (author intent beats derivation, always).

## Decision log

- Heightmap encodes *relative plausible relief*, not calibrated meters —
  grayscale bands chosen for downstream normalization; no metadata
  sidecar in v1.
- Orogeny belts raster from **event boundary segments**, falling back to
  mountain features when no committed event covers a range (both passes
  run; belts first, features add local peaks).
- Export-dialog options default ON (documented divergence from the
  canvas defaults-off rule, justified above and in the roadmap).
- Sea level = the boundary between ocean bands (<100) and land bands
  (≥100); documented in the elevation table so downstream users can
  threshold at gray 100.

## Acceptance criteria

- [ ] Export of a world with: 100 Ma of spreading, one committed orogeny,
      one craton → visually: ocean darkens away from ridge, a mountain
      *belt* (not dots) along the collision line, craton brighter than
      plain continent.
- [ ] Both new options off → output ≈ v1 (flat continents + feature dots).
- [ ] Elevation-model unit tests green; `npm run verify` + lint green.
- [ ] GeoPackage export with `includeHeightmap` still works.
- [ ] 4096×2048 equirect export completes without hanging the UI (async
      already; just confirm).

## Non-goals

- No runtime elevation system, no erosion, no in-canvas hypsometric
  rendering (that's a possible BRIEF_03-style follow-up), no calibrated
  meter scale, no 16-bit PNG (out-of-scope note if users need it).

## Authority boundaries

No commits without user go-ahead. If `EventEffectsProcessor`'s progress
convention is unclear or contradictory, stop and report rather than
inventing a second progress model.

## Report format

Files changed; the final elevation table (band → gray value) reproduced;
which data sources actually fed the test render (probed, with counts);
export timing at 4096×2048; manual visual checklist for the user;
out-of-scope findings → `docs/restructure-tasks/out-of-scope-list`.
