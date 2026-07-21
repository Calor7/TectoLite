# BRIEF 16 - Plate-relative elevation zones

Status: future / approved concept / implementation research complete

## Outcome

Let users paint altitude changes onto a plate and have those changes travel
with the owning geometry through geological time. The final field must be
exportable as a real heightmap; preview rendering is not the end product.

For the first release, authoring is plate-owned. A painted area may be limited
to a polygon-shaped mask, but independently owned landmasses/polygons require
stable entity identity and lineage that the current model does not yet have.

## Research conclusion

Use a **vector cause stack with a derived raster cache**:

- Persist compact brush paths, polygon fills, owner IDs, anchor times, altitude
  deltas, falloff, visibility, and explicit layer order.
- Transform the stored geographic control points with the existing
  `pointPositionAt()` plate-motion path.
- Evaluate those causes into a meter-valued `Float32Array` for preview and
  export. A low-resolution, dirty-tile cache accelerates the editor but is not
  saved as authoritative data.
- Export the same evaluated field as a canonical 2:1 equirectangular 16-bit
  grayscale PNG. Keep an 8-bit compatibility/preview option and add a
  meter-preserving GIS format separately.
- Keep the CPU rasterizer as the reference implementation. It is deterministic,
  testable, and fits the current Canvas 2D renderer. GPU rendering can later be
  a preview accelerator, but must not become the only export path.

This retains editability and timeline correctness without restoring the
abandoned persistent elevation mesh described in the archived elevation docs.

## Implementation options considered

| Option | Strengths | Costs and failure modes | Verdict |
| --- | --- | --- | --- |
| Vector strokes/zones, rasterized on demand | Resolution-independent saves; natural undo/layering; easy plate anchoring; one source feeds preview and export | Needs a spatial index/cache; smoothing and erasing must be defined as ordered operations | **Recommended authoritative model** |
| Per-plate raster textures/tiles | Fast brush writes and fast preview | Bakes a projection/resolution into the save; pole/seam handling; repeated resampling on split/fusion; harder high-resolution export | Use only as a disposable preview cache |
| Sparse plate elevation mesh | Natural input to erosion/uplift simulation; editable vertices | Topology generation, interpolation artifacts, expensive split/fusion transfer, and much larger runtime scope; the earlier mesh runtime is no longer present | Do not use for BRIEF 16 |
| Baked world-space heightmap per time | Simplest renderer/export | Does not move causally with plates, is expensive across the timeline, and loses authoring intent | Reject |

## Repository findings that shape the design

- `src/systems/HeightmapGenerator.ts` currently paints directly into an 8-bit
  Canvas image. It has no meter-valued intermediate field.
- Heightmap PNG and the optional GeoPackage raster both call that generator, so
  elevation-zone composition belongs below both callers rather than in UI code.
- `ToolType` still includes `paint`, and `main.ts` still toggles a paint-control
  container, but there is no active paint data model or canvas paint tool to
  extend. BRIEF 16 must supply the actual tool path.
- `pointPositionAt()` already provides the correct rigid plate-relative motion
  for a point plus its anchor time. A second rotation implementation would be a
  correctness risk.
- Split and fusion create fresh plate IDs and fresh motion/geometry stages.
  Zones therefore need an explicit transfer step; inheriting a plate field via
  object spread would silently duplicate or strand them.
- `HistoryManager` deep-clones known plate/world structures. A new top-level
  zone collection must be explicitly deep-cloned for reliable undo/redo.
- Save migration is currently version 9. Adding persisted zones requires a
  version bump, merge-import ID remapping, and `from_current_time` rebasing.
- The existing GeoPackage heightmap is an ordinary PNG tile layer. It is useful
  for visualization, but it is not yet an OGC numeric elevation coverage.

## Fixed authoring semantics

### Units and composition

- Author altitude in **meters relative to sea level**, not grayscale values.
- Slice 1 supports additive deltas only. A negative value lowers terrain and a
  positive value raises it.
- Derived tectonic/base relief is evaluated first in meters, then visible
  authored deltas are composed in ascending `(order, id)` order.
- Clamp only at output encoding. Do not clamp the internal field after each
  zone, because that makes results depend unnecessarily on layer order.
- Reserve an operation discriminator for later `smooth`, `erase`, and
  `replace` behavior, but do not expose modes whose semantics are not yet
  implemented.

The current BRIEF 05 grayscale constants should therefore become meter-valued
elevation constants before BRIEF 16 composition. Adding a `+500 m` zone to a
gray value such as 120 is not a valid model.

### Brush geometry

- Store a geographic path anchored at edit time, not screen pixels.
- Store radius in kilometers and strength in meters. Planet radius comes from
  `world.globalOptions.planetRadius`.
- Normalize captured input into a compact path and persist the resampling
  spacing/kernel version. During evaluation, interpolate path segments along
  great-circle arcs and stamp at deterministic spacing no greater than one
  quarter of the brush radius.
- Hard mode uses a compact step kernel. Soft mode uses compact-support
  smoothstep falloff: `1 - smoothstep(0, 1, distance / radius)`.
- Do not use Gaussian falloff in slice 1: its non-zero tail needs an arbitrary
  cutoff and makes zone bounds/caching less obvious. Linear falloff tends to
  expose a visible derivative discontinuity at the brush edge.
- Pressure-sensitive radius/strength is deferred. If later added, persist the
  normalized pressure at each control point so replay is deterministic.

### Polygon fill

- A polygon fill is a zone geometry, not a new terrain owner.
- Store its ring coordinates at `anchorTime`, an altitude delta, and either a
  hard edge or a feather distance in kilometers.
- Resample long polygon edges geodesically before preview/export. Linear
  longitude interpolation is incorrect at the antimeridian and near the poles.

### Timeline behavior

- A zone has `anchorTime` and `activeFrom`; both equal the edit time by default.
- Activity uses the half-open interval `[activeFrom, activeTo)`. An omitted
  `activeTo` remains active indefinitely; this avoids double application on the
  exact split/fusion frame.
- Moving a layer in the stack changes only `order`, not its time or geometry.
- Locking prevents authoring changes but never changes export output.
- Hiding excludes the zone from preview and export.
- Commit one history transaction on pointer-up/Apply. Pointer cancellation or
  an unfinished stroke commits nothing.

## Proposed persisted model

Keep zones in one ordered world-level collection. This avoids accidental
inheritance through plate object spreads and makes cross-owner layer order and
grouping explicit.

```ts
interface ElevationZone {
  id: string;
  name: string;
  ownerPlateId: string;
  anchorTime: number;
  activeFrom: number;
  activeTo?: number;
  order: number;
  operation: 'add'; // reserve future smooth/erase/replace variants
  geometry: ElevationBrushStroke | ElevationPolygonFill;
  visible: boolean;
  locked: boolean;
  groupId?: string;
  previewColor: string; // editor-only visualization, never altitude
  lineageId?: string;   // shared by explicit split fragments
}

interface ElevationBrushStroke {
  kind: 'brush';
  path: Array<{ position: Coordinate; pressure?: number }>;
  radiusKm: number;
  deltaMeters: number;
  falloff: 'hard' | 'smoothstep';
  spacingKm: number;
  kernelVersion: 1;
  clipMask?: Coordinate[][][]; // MultiPolygon in anchor-time coordinates
}

interface ElevationPolygonFill {
  kind: 'polygon';
  rings: Coordinate[][];
  deltaMeters: number;
  featherKm: number;
  clipMask?: Coordinate[][][]; // MultiPolygon in anchor-time coordinates
}

interface WorldState {
  elevationZones: ElevationZone[];
}
```

The final implementation may factor shared fields differently, but the saved
format must retain the owner, anchor/active time, altitude units, deterministic
kernel inputs, explicit order, and split lineage.

## Raster and preview strategy

### Authoritative evaluator

Introduce a pure core such as:

```ts
deriveElevationField(
  state: AppState,
  time: number,
  options: ElevationRasterOptions
): Float32Array
```

The evaluator owns all relief composition. `HeightmapGenerator` becomes an
adapter/encoder instead of a separate terrain implementation.

For a canonical equirectangular field:

1. Evaluate the base/tectonic relief in meters.
2. Select visible zones active at `time` whose owner exists over that time.
3. Transform each path/ring/mask point from `anchorTime` to `time` with
   `pointPositionAt()`.
4. Rasterize the transformed zone in deterministic layer order into a float
   altitude buffer.
5. Encode that buffer for the requested destination.

Use spherical distance, not projected pixel distance, for brush influence. A
practical CPU stamp evaluates only affected latitude rows. For each row, derive
the longitude span of the spherical cap, wrap writes at `x +/- width`, and use
the spherical dot product for the final radius/falloff test. This gives a round
geodesic brush at the antimeridian and poles without scanning the whole image.

### Interactive preview

- Start with a 1024x512 or smaller equirectangular float cache split into dirty
  tiles (for example 128x128 or 256x256).
- While dragging, render the transient current stroke over cached committed
  zones. On commit, invalidate only tiles touched by the stroke support.
- Project the preview texture/contours onto the current map as an optional
  overlay. Full-resolution terrain geometry is not kept in runtime state.
- Rebuild asynchronously after timeline/layer changes. Use a module Web Worker;
  `OffscreenCanvas` is also available to workers if image conversion is useful.
- Keep a synchronous pure evaluator for tests and small fields. The worker is a
  scheduling boundary, not a second algorithm.

WebGL may later accelerate the overlay, particularly after TASK 21, but exported
pixels must continue to match the reference evaluator within a documented
rounding tolerance.

## Heightmap export is a required delivery path

### Canonical export

The primary terrain export is:

- 2:1 equirectangular full-sphere coverage;
- single-channel 16-bit grayscale PNG;
- configurable fixed meter range, defaulting to `-11000 m .. +9000 m`;
- sea level and the exact scale/offset shown in the export UI and recorded in a
  small companion JSON file.

Encoding is:

```ts
sample = round(clamp((meters - minMeters) / (maxMeters - minMeters), 0, 1) * 65535)
meters = minMeters + sample / 65535 * (maxMeters - minMeters)
```

At the default range, one 16-bit step is about 0.305 m. The current 8-bit path
would provide only about 78.4 m per step over the same range, which is visibly
coarse for authored altitude.

Do not rely on the ordinary 8-bit Canvas `ImageData` path to produce this file.
Use a dedicated, tested 16-bit grayscale encoder (or a verified float16-canvas
path only after Electron compatibility tests). PNG itself supports 16-bit
grayscale, and common terrain tooling such as Unreal imports 16-bit grayscale
PNG/R16 heightmaps.

Keep 8-bit PNG as a clearly labeled compatibility/quick-preview option. It must
use the same float field and scale/offset, not a second renderer.

### Projection policy

Only equirectangular is the canonical global heightmap in slice 1. Mercator,
Mollweide, Robinson, and orthographic outputs are rendered relief images, not
regular full-sphere terrain grids: they crop, curve, or non-uniformly scale the
domain. The existing heightmap dialog should separate those visual projections
from the heightmap export rather than implying interchangeability.

### GIS outputs

- Prefer a single-band Float32 GeoTIFF with EPSG:4326, meter units, bounds, and
  NoData for an exact GIS DEM. `geotiff.js` can write an `ArrayBuffer`, but its
  writer is documented as beta/uncompressed, so benchmark file size before
  selecting it.
- If elevation stays in GeoPackage, implement the OGC Tiled Gridded Coverage
  extension. It defines 16-bit PNG plus scale/offset and 32-bit TIFF encodings
  with required ancillary tables. Do not describe a plain image tile as a
  standards-compliant numeric elevation coverage.
- Both standalone and GIS exports must call the same `deriveElevationField()`
  function at the same time and resolution.

## Split, fusion, and shape-edit rules

### Split

At split time:

1. Transform every affected parent zone and its mask to the split time.
2. Intersect its influence with each child geometry by assigning explicit,
   disjoint child masks.
3. Create only non-empty child fragments, each with a new ID, the child owner,
   `anchorTime = splitTime`, and the parent's `lineageId` (or parent zone ID).
4. Preserve altitude, falloff, visibility, group, and relative layer order.
5. Keep the original zone on the historical parent for times before the split;
   set its `activeTo` to the split time.

The two child fragments may retain the same source path, but their masks must
be disjoint and their lineage explicit. That is clipping/reparenting, not silent
duplication. A just-before/just-after raster comparison must be continuous
within edge-sampling tolerance.

### Fusion

At fusion time, transform each active parent zone to that time and re-anchor it
to the new fused plate. Preserve separate layers and ordering rather than
merging their geometry. Close the historical parent zones at the fusion time.
This is necessary because the fused plate uses a fresh motion model and only
stores `parentPlateIds` for lineage.

### Timeline edits and undo

Retiming/deleting a split or fusion must recompute/remove its transferred
fragments in the same state transaction. Otherwise zones retain stale anchors
or owners. The transfer result should be derivable from lineage metadata and
tested through `TimelineSystem`, not repaired opportunistically by the renderer.

A normal plate shape edit does not rewrite zone paths. The active owner geometry
and any fragment mask clip the transformed influence at evaluation time.

## Suggested delivery slices

### Slice 1 - causal altitude plus real heightmap

1. Add types, `world.elevationZones`, save v10 migration, merge-import remap,
   from-current-time rebase, and HistoryManager cloning.
2. Add pure geodesic kernel/path resampling and a meter-valued elevation-field
   evaluator with small synthetic-field tests.
3. Add a plate-owned hard/smoothstep circular brush, transient draft, one-step
   undo/redo, visibility/lock, layer order, and a low-resolution overlay.
4. Refactor HeightmapGenerator to encode the shared float field and add the
   canonical 16-bit equirectangular PNG export plus scale/offset metadata.
5. Wire explicit split/fusion transfer and continuity tests.

This slice is not complete if the brush works visually but its contribution is
missing from standalone heightmap and GeoPackage/GIS export paths.

### Slice 2 - editing depth and performance

- Localized eraser as an ordered mask operation affecting authored contribution,
  never the underlying procedural base.
- Smoothing as an explicit ordered filter operation with defined radius,
  strength, target field, and iteration count.
- Strength/radius controls, pressure samples, groups/colors, dirty-tile cache,
  worker progress/cancellation, and 4096x2048 benchmark tuning.

### Slice 3 - polygon workflow and interoperability

- Polygon fill/feather UI, stable fragment inspection, lineage-aware retiming,
  Float32 GeoTIFF, OGC-compliant GeoPackage coverage, and optional terrain-engine
  presets/cropped regional exports.
- Expand owner kinds only after landmass/polygon IDs have explicit lifecycle and
  split/fusion lineage.

## Required tests

- Kernel: hard boundary, smoothstep center/edge, negative delta, no NaN values.
- Spherical geometry: antimeridian stamp, north/south polar stamp, great-circle
  interpolation, and planet-radius conversion.
- Motion: zone control points match `pointPositionAt()` through multiple motion
  segments and linked motion.
- Composition: explicit order/id tie break, hidden exclusion, lock neutrality,
  activeFrom/activeTo boundaries, and deterministic repeat render.
- Lifecycle: split/fusion continuity, disjoint fragments, lineage, retime/delete,
  and no mutation of historical parent output.
- Persistence: v9 migration, save round-trip, undo deep clone, merge-import ID
  remap, and from-current-time coordinate/time rebasing.
- Encoding: known meter values map to exact UInt16 samples; width/height and 2:1
  coverage; sea-level scale/offset round-trip; 8-bit and 16-bit encoders consume
  the same float field.
- Integration: the same synthetic zone appears in standalone PNG and GIS export.

## Performance and memory gates

- Preview should remain responsive while drawing; measure p50/p95 brush-frame
  time on the existing benchmark world rather than relying on visual judgment.
- A 4096x2048 `Float32Array` is about 32 MiB. Keep the export pipeline to a small
  bounded number of full-size buffers and reuse them.
- Target 4096x2048 export in under five seconds on the documented baseline
  machine, with progress/cancel and without multi-second main-thread blocking.
- Benchmark antimeridian and polar strokes separately because their projected
  bounding ranges are worst cases.

## Acceptance criteria

- [ ] Raising/lowering a zone changes the canonical exported heightmap by the
      expected meter-to-sample delta.
- [ ] The same zone remains attached through plate motion with no seam at the
      antimeridian and no shape distortion at the poles.
- [ ] Scrubbing before/after `activeFrom` is deterministic; undo/redo and save
      reload preserve identical field hashes.
- [ ] A split/fusion produces explicit correctly owned fragments and preserves
      the field across the lifecycle boundary within raster tolerance.
- [ ] Standalone 16-bit PNG is 2:1 equirectangular, reports its scale/offset, and
      is verified as 16-bit grayscale by decoding it in a test.
- [ ] 8-bit preview/compatibility, 16-bit PNG, and GIS paths are encodings of one
      meter-valued float field.
- [ ] 4096x2048 performance and memory gates are recorded.
- [ ] `npm run verify` passes.

## Non-goals

No erosion/uplift physics simulation, persistent runtime terrain mesh, volumetric
crust, automatic biome generation, projection-specific painting semantics,
global GPU renderer rewrite, or silently baked per-timeline rasters.

## Risks and guardrails

- **Projection drift:** Geographic radius and altitude are authoritative; screen
  pixels are presentation only.
- **Antimeridian/poles:** Use spherical math and wrapped raster writes. Do not
  pass raw crossing rings to planar clipping without seam normalization.
- **Save bloat:** Simplify captured paths within a radius-relative tolerance and
  version the replay kernel; never downsample the authoritative altitude field
  because no authoritative raster is saved.
- **Order-dependent tools:** `smooth`, `erase`, or future absolute modes require
  explicit stack semantics and tests before UI exposure.
- **Export precision:** A visually smooth Canvas preview does not prove a usable
  heightmap. Decode and inspect bit depth and exact samples in tests.

## Research references

- [D3 Geo](https://d3js.org/d3-geo) documents spherical GeoJSON, great-circle
  edge resampling, projection, rotation, and antimeridian clipping concerns.
- [W3C PNG Specification, Third Edition](https://www.w3.org/TR/png-3/)
  specifies 16-bit grayscale samples.
- [WHATWG Canvas serialization](https://html.spec.whatwg.org/multipage/canvas.html)
  requires serialization to preserve the underlying bitmap's bit depth, while
  [MDN ImageData pixel formats](https://developer.mozilla.org/en-US/docs/Web/API/ImageData/pixelFormat)
  marks float16 ImageData support as experimental; a dedicated encoder is the
  safer initial compatibility choice.
- [Unreal Engine Landscape Technical Guide](https://dev.epicgames.com/documentation/unreal-engine/landscape-technical-guide-in-unreal-engine)
  lists 16-bit grayscale PNG and R16 as supported heightmap inputs.
- [MDN OffscreenCanvas](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas)
  documents worker availability for moving expensive raster work off the UI
  thread.
- [OGC GeoPackage Tiled Gridded Coverage Extension](https://docs.ogc.org/is/17-066r2/17-066r2.html)
  defines numeric gridded coverage storage using 16-bit PNG with scale/offset or
  32-bit TIFF plus ancillary tables.
- [geotiff.js](https://geotiffjs.github.io/geotiff.js/) documents browser-side
  GeoTIFF writing and the current uncompressed beta writer limitation.

## Authority boundaries

No new terrain/GIS dependency, save-format change, or reinterpretation of
BRIEF 05 grayscale values lands without review. If BRIEF 15 is implemented
first, the brush must use its pointer-event tool protocol rather than adding a
parallel mouse listener path.

## Report format

Files changed; final data model and kernel versions; meter bands and export
scale/offset; test inventory and field hashes; split/fusion continuity result;
decoded PNG bit depth; 4096x2048 timing/memory; GIS conformance status; manual
visual checklist; unrelated findings appended to the out-of-scope list.
