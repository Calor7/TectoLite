# TectoLite World Studio — Master Plan

Status: proposed product and engineering direction
Target: a new offline-first desktop application sharing TectoLite's world model
Primary promise: tectonic levers produce a strong first draft, while every automated result remains manually overridable

## 1. Product vision

TectoLite World Studio is an offline worldbuilding and cartography application
that turns tectonic history into a finished fantasy map. It combines procedural
terrain, automated erosion and hydrology, feature brushes, vector drawing,
layer-based compositing, labels, symbols, textures, and print-quality export.

The intended user journey is:

1. Create or import a tectonic world.
2. Generate plausible large-scale terrain from crust, plate boundaries, age,
   motion, collisions, rifts, subduction, and hotspots.
3. Automatically erode the terrain and derive drainage, rivers, lakes, climate,
   and biomes.
4. Art-direct any result with brushes, masks, parameters, and replacement layers.
5. Style the world as a complete fantasy map.
6. Export an image that can be used directly, plus editable and technical formats
   for users who want to continue in other software.

The application succeeds when a non-artist can create a coherent, attractive map
without leaving the application, while an experienced artist never feels trapped
by automation.

## 2. Non-negotiable product principles

### 2.1 Automation creates editable results

An automated operation must never silently flatten user work. It creates or
updates a named layer with recorded settings, seed, inputs, and provenance.

Every generated result supports:

- visibility, opacity, reordering, duplication, and deletion;
- masks and local regeneration;
- an editable strength control;
- conversion to a manually editable layer;
- freezing to prevent upstream changes from altering it;
- resetting to its generated state;
- comparison with the previous result.

### 2.2 Manual work wins by default

Manual corrections live above generated layers. Regenerating terrain, erosion,
rivers, or biomes updates the generated layer beneath those corrections, so the
user's edits survive.

When an upstream change conflicts with manual work, the application highlights
the affected region and offers three choices:

- keep the manual override;
- regenerate and blend;
- discard the override in the affected area.

### 2.3 Plausibility is a lever, not a cage

Tectonics controls large-scale coherence, but the user can exaggerate, suppress,
move, or replace every consequence. A realism control should range from
"illustrative fantasy" to "geologically constrained" rather than enforcing a
single correct result.

### 2.4 The final map is a first-class artifact

The application is not finished when it has a heightmap. It must provide the
cartographic tools required for a publishable map: visual hierarchy, coherent
line work, typography, symbols, textures, color grading, frames, legends, and
high-resolution export.

### 2.5 Offline-first and deterministic

Core workflows require no account or network connection. Given the same project,
seed, engine version, and settings, generation produces the same result.

## 3. Product boundary

World Studio is a new desktop application, initially developed in the same
repository as TectoLite. It shares stable tectonic, geometry, timeline,
projection, and project-interchange code, but has its own UI, rendering pipeline,
terrain engine, dependencies, and release package.

Recommended repository shape:

```text
apps/
  tectolite-web/
  world-studio/
packages/
  world-model/
  tectonics/
  projections/
  project-format/
  layer-model/
engines/
  terrain-native/
  terrain-wasm-preview/
```

The web application should not import desktop terrain modules. Separate build
entry points and dependency graphs prevent terrain engines, textures, symbols,
and native binaries from increasing the web download.

### 3.1 Research conclusions from Worldbuilding Pasta

The practical workflow in [Worldbuilding Pasta's *An Apple Pie From Scratch*](https://worldbuildingpasta.blogspot.com/p/blog-page.html)
should be treated as a product-requirements source. Its main lesson is that a
believable map emerges from several linked representations, not from one noise
generator. World Studio should absorb the workflow while removing its repeated
manual reprojection, file conversion, scripting, and application switching.

The findings translate into these requirements:

1. **Preserve geological provenance.** The terrain generator needs synchronized
   source layers for land/sea, crust class and age, active and extinct
   orogenies, orogeny age/type, cratons, terranes, failed rifts, transform
   structures, subduction polarity, volcanic arcs, large igneous provinces,
   hotspots, and hotspot tracks. These are the inputs used in the blog's
   [global-terrain workflow](https://worldbuildingpasta.blogspot.com/2023/03/an-apple-pie-from-scratch-part-viic.html),
   and they convey much more terrain information than present-day plate outlines.
2. **Keep a spherical master and offer low-distortion regional workspaces.** The
   blog avoids drawing and eroding directly on equirectangular maps because scale
   and shape distortion increase strongly with latitude. World Studio's
   cube-sphere master solves the storage problem, while temporary oblique Hammer,
   Lambert azimuthal, or other suitable regional views provide artist-friendly
   workspaces. Brush radii and simulation distances remain geodesic regardless
   of the display projection.
3. **Make reprojection data-aware.** Continuous elevation, categorical masks,
   vectors, labels, and line art require different sampling. Continuous fields
   get high-quality interpolation; categorical IDs and hard masks use nearest or
   majority sampling; vectors are transformed geometrically; height values are
   never gamma-corrected as image colors. Wrap padding and overlap prevent seams.
4. **Retain a high-precision master.** The blog demonstrates that 8-bit grayscale
   is inadequate for a broad planetary elevation range. Terrain and intermediate
   scientific fields remain signed integer or floating-point data internally,
   with at least 16-bit heightmap import/export and no accidental 8-bit
   conversion during projection or compositing.
5. **Separate scale levels.** Conventional local erosion filters do not scale
   cleanly to coarse global grids. The engine therefore distinguishes geological
   landscape evolution, world-scale drainage, regional landform shaping, and
   decorative micro-detail. A multiresolution recipe can establish major basins
   at low resolution, refine them progressively, and add local detail without
   widening every valley to continental scale.
6. **Treat erosion as an art-directed process.** The blog describes Wilbur as
   closer to an erosion brush than an intelligent physical model. World Studio
   should expose staged erosion recipes, slope/elevation/material selections,
   feathered masks, previews, local reruns, and before/after blending instead of
   presenting one opaque "realism" button.
7. **Model sediment destinations as well as erosion sources.** Drainage should
   create source highlands, transport reaches, floodplains, alluvial fans,
   depositional basins, deltas, and marine sediment sinks. A finished terrain is
   not just a carved noise field.
8. **Allow climate-dependent closed drainage.** Basin filling cannot always force
   every cell to the sea. Humid regions generally overflow and breach basins;
   arid regions may retain endorheic basins, seasonal lakes, playas, salt flats,
   and inland deltas based on precipitation, evaporation, basin area, depth, and
   age.
9. **Use process-specific landform modules.** Fluvial, glacial, eolian, coastal,
   karst, volcanic, and submarine terrain have different controls. The first
   release prioritizes fluvial and hillslope processes, but its layer model must
   let later modules replace generic texture with regionally appropriate forms.
10. **Generalize terrain for the output scale.** Detailed DEM relief often looks
    noisy in an atlas. Cartographic output needs a reversible terrain-
    generalization stage that suppresses small forms while retaining important
    ridges and valleys at each map scale.
11. **Offer several terrain-reading styles.** The cartography guidance combines
    continuous or stepped hypsometric color, contours, directional hillshade,
    texture/ambient shading, and scale-aware generalization. Lowland elevation
    bands need more visual resolution than high mountains; a linear color ramp is
    not a sufficient default.
12. **Keep generation and presentation independent.** A linear grayscale master
    remains machine-readable. Display ramps, contour intervals, hillshade,
    textures, and fantasy-map styling are downstream, replaceable render layers.

### 3.2 Application and library adoption strategy

Tools named by the blog fall into three categories: code we can safely evaluate
for direct use, interoperable external engines, and products that should only
serve as workflow or visual references. License review is a release requirement;
the table is engineering guidance, not legal advice.

| Tool | Useful mechanics | World Studio approach |
|---|---|---|
| [PROJ](https://proj.org/en/stable/) and [GDAL](https://gdal.org/en/stable/) | Projection APIs; high-bit-depth raster/vector conversion; GeoTIFF, GeoPackage, NetCDF and many other formats | **Direct dependency candidate.** Both use permissive MIT-style licenses and replace a large amount of risky projection and format code. Wrap them behind a versioned geospatial service. |
| [MapDesigner](https://github.com/jkunimune/Map-Projections) | Raster/vector oblique projections, distortion analysis, projection optimization, custom and mesh-based projections | **Code-study/port candidate.** MIT licensed. Prefer PROJ for standard projections; reuse or port only distinctive distortion-analysis and fantasy-world projection ideas with attribution and tests. |
| [Pyramid Shader](https://terraincartography.com/PyramidShader/) | Shaded relief, Tanaka contours, hypsometric/local/bivariate colors, slope/aspect/curvature and frequency-based generalization | **High-value code-study/port candidate.** MIT licensed. Prototype equivalent native render nodes and compare output against the reference application. |
| [Azgaar Fantasy Map Generator](https://github.com/Azgaar/Fantasy-Map-Generator) | Immediate generated map, editable-from-scratch workflow, reorderable display layers, per-layer style controls, style presets, SVG output, strict separation of data/generators/editors/renderers | **UX and architecture study; selective reuse possible.** MIT licensed. Its cartographic editing model is more relevant than its tectonics or climate simulation. |
| [goSPL](https://gospl.readthedocs.io/en/dev/) | Global spherical landscape evolution; stream-power incision/deposition; depression and marine deposition; hillslope diffusion; sediment layers/compaction; spatially varying precipitation, sea level and tectonic displacement; isostasy | **Reference model and optional external backend.** GPL-3.0 and HPC-oriented Python/MPI dependencies make direct embedding unsuitable for the default Apache-licensed app without an explicit licensing decision. Define a file/job adapter and use it to validate our native approximation. |
| [GPlates/pyGPlates](https://www.gplates.org/docs/) | Rotation hierarchies, topologies, deformation, flowlines, GPML and `.rot` plate interchange | **Interoperate first.** GPL-2.0. Implement GPML/rotation import-export and optionally drive a user-installed pyGPlates environment; do not copy or link code into the default engine without a licensing decision. |
| [ExoPlaSim](https://exoplasim.readthedocs.io/en/stable/) | Reproducible global climate model with arbitrary land/topography and planetary parameters; NetCDF/HDF5 outputs | **Optional advanced climate provider.** It is computationally heavy, low-resolution by mapmaking standards, compiler-dependent, and copyleft-licensed. Use a provider interface and import its outputs; retain a fast native climate approximation for interactive work. Audit its component/license metadata before any distribution. |
| [SAGA GIS](https://saga-gis.sourceforge.io/en/about/about.html) | Extensive hydrology, channel, morphometry, terrain-lighting and grid-analysis modules; CLI processing | **External validation/provider.** Most modules are GPL while the API is LGPL. Use documented algorithms and test datasets as references, or invoke a separately installed CLI through an explicit provider. |
| [Terrain Sculptor](https://terraincartography.com/terrainsculptor/) | DEM generalization that removes distracting detail and accentuates ridge/valley structure | **Algorithm benchmark, not default dependency.** GPL-2.0. Reimplement from published techniques or keep it as an optional external filter after license review. |
| [Wilbur](https://www.fracterra.com/software.html) | Fill-basins, incise-flow, precipiton, morphological filters, scripted multiresolution erosion | **Workflow reference and interchange target.** No suitable open-source integration license has been established. Recreate the general staged mechanics independently and support lossless heightmap exchange. |
| [G.Projector](https://www.giss.nasa.gov/tools/gprojector/) and [projectionpasta](https://github.com/hersfeldtn/projectionpasta/releases) | Broad projection choice; oblique regional maps; high-resolution and color-depth-preserving reverse projection; seam padding | **Reference/test tools.** PROJ/GDAL should power production. Do not reuse projectionpasta code unless a reusable license is confirmed. |
| [Blender](https://www.blender.org/) and [Aerialod](https://ephtracy.github.io/index.html?page=aerialod) | Orthographic 3D terrain, soft/diffuse relief lighting, path-traced presentation | **Export bridge and visual benchmark.** Provide height/color/normal exports and an optional Blender scene/script. Use an internal real-time preview; do not bundle Aerialod without explicit permission. |
| [QGIS](https://www.qgis.org/) | GIS inspection, styling, analysis and editing | **Interoperability target.** GeoPackage, GeoTIFF, CRS metadata and styles should round-trip cleanly. The app should make common fictional-world projection tasks easier than a general GIS. |
| [OpenRaster](https://www.openraster.org/) | Open layered raster interchange supported by GIMP, Krita, MyPaint and Scribus | **Required layered export.** Make `.ora` the dependable open layered output; treat PSD/PSB as an additional compatibility target rather than the only editable export. |

The adoption order should be PROJ/GDAL, OpenRaster, Pyramid Shader concepts,
MapDesigner concepts, and Azgaar UX study. goSPL, ExoPlaSim, GPlates, SAGA,
Blender, and Wilbur should first be connected through stable file/provider
boundaries. This gives users leverage without making the core application a
fragile collection of bundled research environments.

## 4. Core document and layer model

The document is a dependency graph presented to the user as a familiar layer
stack. Upstream layers provide inputs to downstream generators. Only affected
tiles are invalidated when a user makes a change.

### 4.1 Layer families

#### Source layers

- Tectonic plates and timeline
- Crust type and age
- Boundary classification, polarity, convergence/divergence rate, and age
- Cratons, terranes, continental fragments, island arcs, and accretion history
- Active and inherited orogenies with type, age, width, and intensity
- Active and failed rifts, transform structures, and passive margins
- Large igneous provinces, hotspots, and hotspot tracks
- Rock type, hardness, sediment, and soil-depth control fields
- Precipitation, evaporation, ice extent, wind, sea level, and ocean exposure
- User masks and control fields
- Imported reference images and GIS data

#### Terrain layers

- Ocean-floor base
- Continental base
- Tectonic uplift and subsidence
- Procedural macro terrain
- Procedural surface detail
- Erosion delta
- Manual elevation corrections

#### Natural-feature layers

- Drainage basins
- Rivers and lakes
- Coastlines and wetlands
- Climate fields
- Biomes and vegetation
- Glaciers, deserts, reefs, and other regional features

#### Cartographic layers

- Political regions and borders
- Settlements and points of interest
- Roads, routes, and trails
- Labels
- Symbols and illustrations
- Graticules, scale bars, legends, frames, and decorations

#### Finishing layers

- Hillshade and ambient relief
- Contours
- Land and water textures
- Ink outlines and coastal effects
- Adjustment layers for color, contrast, curves, gradients, and vignette
- Paper or parchment texture

### 4.2 Layer capabilities

Raster and vector layers should share a common set of controls where meaningful:

- name, group, visibility, lock, opacity, and ordering;
- blend mode;
- one or more non-destructive masks;
- zoom-dependent visibility;
- geographic or screen-space anchoring;
- timeline range;
- generator provenance and stale-state indicator;
- update policy: live, ask, or frozen;
- cached preview and full-resolution representations.

Raster blending should initially support normal, add, subtract, multiply, screen,
overlay, darken, lighten, minimum, maximum, replace, and height-specific combine
modes. Adjustment layers and clipping masks are required for high-quality visual
finishing.

## 5. Terrain foundation

### 5.1 Storage

Use a tiled cube-sphere heightfield rather than one global equirectangular image
or a plate-owned mesh.

- Six faces avoid severe polar distortion.
- Tiles allow regional loading, editing, caching, and regeneration.
- Signed 16-bit metres are sufficient for persisted elevation.
- Processing uses 32-bit floating-point buffers.
- A resolution pyramid supports fast whole-world previews and detailed regional
  editing.
- Tile borders include overlap/ghost samples for neighborhood operations, with
  cube-face adjacency and reconciliation tested explicitly.
- Stored values remain linear physical data; ICC/gamma transforms apply only to
  presentation layers.
- Equirectangular, orthographic, regional, and custom projections are generated
  at render or export time.

The editor offers distortion-aware regional workspaces. A workspace records its
projection, aspect, center, rotation, scale, geographic footprint, and inverse
transform. Users can edit in an oblique low-distortion view while strokes and
features are committed to the spherical master. A Tissot/distortion preview warns
when an artboard or simulation region is too distorted for its intended use.

Resampling is selected by semantic data type:

- elevation and continuous climate fields: high-quality continuous interpolation;
- categorical regions, plate IDs, biomes, and hard masks: nearest or majority;
- coverage and soft masks: area-aware filtering;
- line and polygon geometry: coordinate transformation and clipping, not raster
  resampling;
- labels and symbols: re-layout in output space from geographic anchors.

### 5.2 Non-destructive elevation stack

The evaluated elevation is composed from ordered sources:

```text
tectonic base
+ generated macro relief
+ generated surface detail
+ erosion/deposition delta
+ manual height layers
+ local feature modifiers
= final elevation
```

Generators store their recipes and seeds. Caches are disposable and rebuildable.
Manual layers and accepted baked results are durable project data.

### 5.3 Height tools

The initial height toolkit includes:

- raise and lower;
- set exact elevation;
- flatten to sampled height;
- smooth and sharpen;
- terrace;
- ridge and mountain-chain brush;
- valley and canyon brush;
- coastal shelf and cliff brush;
- noise/detail brush;
- local thermal erosion;
- local hydraulic erosion;
- river incision;
- polygon and selection fill;
- gradient and profile tools;
- erase or reduce a manual override.

Shared brush controls include radius, strength, spacing, falloff, profile,
jitter, pressure, target layer, mask, and land/ocean/elevation constraints.

## 6. Tectonics-to-terrain generation

The first terrain draft is derived in explicit stages so users can rerun or
replace one stage without regenerating everything.

1. Classify crust and establish continental, shelf, slope, ridge, and ocean-floor
   base elevations.
2. Use oceanic crust age to derive ridge height and depth through subsidence.
3. Use convergent boundary history, polarity, collision sequence, and participating
   crust types to generate Andean-style margins, continent-collision belts,
   fold-and-thrust belts, interior plateaus, foreland basins, trenches, and
   volcanic arcs as distinct controls.
4. Use divergent boundaries to generate rifts, passive margins, ridges, and
   young ocean basins.
5. Use transform boundaries and inherited structures to introduce aligned
   valleys and fault-controlled relief.
6. Preserve craton interiors as comparatively old, resistant, subdued terrain;
   use terrane accretion, failed rifts, LIPs, hotspots, and hotspot tracks to
   seed appropriate inherited and volcanic forms.
7. Decay, dissect, and broaden inactive orogenies according to age, material,
   climate history, and user-controlled exaggeration rather than age alone.
8. Add seeded, directionally conditioned macro variation without obscuring the
   tectonic structure.
9. Add material, erodibility, permeability, and sediment-source fields used by
   erosion and hydrology.

Each tectonic consequence has an intensity control and can be disabled globally,
per plate, per boundary, or with a painted mask.

Direct manipulation remains available: selecting a boundary exposes levers for
mountain width, maximum uplift, trench depth, arc offset, roughness, symmetry,
and age response. These controls update a preview without changing plate motion.

## 7. Automated erosion and hydrology

### 7.1 Erosion pipeline

Erosion is a background job with progress, pause, cancellation, deterministic
seeds, checkpointing, and before/after comparison.

The first complete pipeline contains:

1. scale-aware conditioning of the initial surface without indiscriminately
   destroying intentional basins;
2. depression analysis that classifies outlet lakes, endorheic basins, seasonal
   basins, and defects requiring repair;
3. flow-direction, catchment, divide, and precipitation-weighted accumulation;
4. stream-power channel incision and headward erosion;
5. hydraulic erosion with water, sediment capacity, transport, and deposition;
6. hillslope/thermal erosion based on material-specific stability and talus
   angles;
7. source-to-sink routing into valleys, floodplains, alluvial fans, deltas,
   submarine canyons, and marine fans;
8. lake filling, spillway incision, and flat water-surface enforcement;
9. optional repeated refinement from coarse basin structure to regional channel
   detail;
10. later process modules for glacial, eolian, coastal, karst, and submarine
    terrain.

The interactive default is a fast landscape-forming approximation, not a claim
to reproduce geological time exactly. An advanced landscape-evolution provider
may additionally consume time-varying uplift/subsidence, horizontal tectonic
displacement, precipitation, sea level, sediment properties, and isostatic load.

Two execution modes are required:

- **Preview:** reduced resolution and iteration count, intended to finish in
  seconds and update while tuning controls.
- **Final:** full selected resolution, tiled with overlap margins, resumable,
  and suitable for export.

### 7.2 Manual control over erosion

Users can paint fields that influence erosion:

- rainfall or water amount;
- evaporation and seasonal runoff;
- rock hardness and erodibility;
- permeability and underground-drainage allowance;
- sediment availability;
- erosion strength;
- protected regions;
- preferred drainage paths;
- forced outlets and lake basins.

The erosion result is stored as elevation deltas plus derived analysis layers.
Users may erase, soften, exaggerate, or locally rerun those deltas. A manual
height layer above erosion always survives regeneration.

### 7.3 Rivers and lakes

Hydrology produces editable vector features rather than permanently painting
rivers into the terrain texture.

- River paths follow derived flow but expose control points.
- Users can redraw a segment, force a source or mouth, join or split rivers,
  and lock approved segments.
- The system re-solves unlocked sections around manual edits.
- Lakes expose editable shorelines, surface elevation, inflow, and outlet.
- A river-incision operation can apply the final vector network back to a
  dedicated terrain layer.
- Ordinary upstream channels converge and do not bifurcate. Explicit exceptions
  include distributary deltas, braided reaches, anabranches, wetlands, and
  artificial canals.
- River style and geometry respond to gradient, discharge, sediment load,
  material, vegetation, and climate: steep source channels, braided transport
  reaches, meandering alluvial reaches, floodplains, fans, and deltas are
  generated as editable feature families.
- Delta form exposes river, wave, tide, current, sediment-supply, and recent
  sea-level controls instead of using one universal branching stamp.
- Endorheic behavior is solved from basin water balance. Users can force a basin
  open or closed and then lock that decision.

## 8. Feature brushes

Feature brushes place coherent, editable objects rather than decorative pixels.
The user paints intent; the application handles spacing, orientation, scale
variation, collision, terrain conformity, and style.

Initial brush families:

- mountain ranges, hills, cliffs, dunes, volcanoes, craters, and canyons;
- forests, individual trees, marshes, scrub, reefs, and glaciers;
- rivers, roads, borders, walls, coast hatching, and trade routes;
- settlements, ruins, mines, ports, forts, landmarks, and map symbols;
- clouds, waves, sea monsters, compass roses, and other decorative elements.

Every brush stroke becomes a collection or procedural path that can be selected,
restyled, reseeded, expanded, reduced, converted to individual objects, or
deleted. Brushes may respond to terrain rules—for example, forests avoid deserts
and roads prefer passes—but the user can disable constraints or force placement.

## 9. Automated integration of user actions

The application maintains a tile-level dependency graph. Actions invalidate only
the downstream products they genuinely affect.

Examples:

- Moving a plate boundary marks nearby tectonic relief, erosion, drainage,
  climate, and biome tiles stale, but leaves labels and locked manual layers
  unchanged.
- Raising a mountain marks local erosion, rivers, climate, and hillshade stale.
- Editing a river marks its incision layer and nearby water styling stale, but
  does not rerun global terrain generation.
- Painting a biome override leaves climate intact and records the local visual
  exception above the generated biome layer.

Each generated layer has one of three update policies:

- **Live:** regenerate cheap previews automatically.
- **Ask:** show affected regions and wait for confirmation.
- **Frozen:** preserve the existing result until explicitly regenerated.

The status bar reports queued and stale work. The map uses a subtle overlay to
show affected regions. Expensive operations never start unexpectedly merely
because the user moved a control point.

Undo/redo records the user's command and layer changes, not entire copies of the
world. Generator jobs commit atomically so cancellation cannot leave half-written
terrain.

## 10. Cartographic quality target

Matching strong Photoshop/GIMP fantasy maps requires a complete visual pipeline,
not only plausible terrain.

### 10.1 Styling system

- reusable map-style presets;
- per-layer stroke, fill, pattern, gradient, and texture controls;
- pressure-sensitive and textured line brushes;
- coastline casing, glow, hatching, shallows, and wave effects;
- multi-directional hillshade and configurable ambient relief;
- contours with index lines and label avoidance;
- symbol libraries with recoloring and scale variation;
- non-destructive color grading and adjustment layers;
- global and local texture controls;
- reusable style tokens so changing a palette updates the whole map.

Terrain presentation is assembled from independent render nodes:

- linear grayscale height for data export only;
- continuous or stepped hypsometric color with separate land, bathymetry,
  below-sea-level land, lake, ice, and biome-aware ramps;
- linear, manually specified, quantile, and power-law elevation stops, with a
  lowland-focused quadratic-style preset;
- regular and index contours, optional contour labels, colored contours, and
  illuminated/shadowed Tanaka contours;
- directional hillshade, multidirectional hillshade, local/ambient texture
  shading, slope, aspect, curvature, and openness;
- scale-dependent terrain generalization that retains major ridges and valleys
  while suppressing distracting high-frequency relief;
- independent bathymetric styling and submarine relief controls.

These nodes remain adjustable layers. A user can combine subtle generalized
hillshade under political colors, use stepped hypsometry for an atlas, or build a
strong illustrated-relief map without altering elevation data.

### 10.2 Labels

- point, path, and area labels;
- curved river, mountain, sea, and region text;
- hierarchy-aware typography styles;
- halos, masks, letter spacing, small caps, and ornaments;
- collision detection with manual pinning and nudging;
- optional automatic label placement that never moves pinned labels;
- font embedding or portability warnings during export.

### 10.3 Composition

- editable page/artboard size and projection;
- crop and region maps from the same world;
- inset maps;
- legend, scale bar, graticule, compass, title, border, and frame tools;
- saved camera and export presets;
- soft-proof preview for screen and print output.

## 11. Rendering and processing architecture

The UI may remain TypeScript-based, but heavy terrain work should run outside the
renderer process.

- Native Rust terrain engine for desktop generation, erosion, hydrology, tile
  compression, and high-resolution export.
- Worker or process boundary so a failed or cancelled job cannot freeze the UI.
- GPU rendering for interactive compositing and 2D/3D preview, with a deterministic
  CPU/native export path where exact reproducibility matters.
- Optional WASM preview engine only for features deliberately shared with the web
  application.
- Versioned generator recipes so projects remain reproducible after algorithms
  evolve.

Optional texture packs and symbol libraries should be installable content packs.
This keeps the base installer manageable while supporting richer art styles.

## 12. Project format, recovery, and interoperability

Use a versioned project package containing a small manifest, authored vector data,
generator recipes, durable manual tiles, and optional caches. Large projects
should not embed every asset as base64 in one JSON document.

Required reliability features:

- incremental autosave and crash recovery;
- explicit project migrations;
- missing-font and missing-asset reporting;
- portable-project packaging;
- background cache cleanup with size limits;
- checksums for durable tiles;
- human-readable metadata where practical.

Required exports:

- finished PNG, TIFF, and JPEG;
- OpenRaster (`.ora`) with layer groups, opacity, blend modes, masks where the
  interchange profile supports them, and a merged preview;
- layered PSD/PSB where supported, plus a documented interchange bundle when a
  World Studio feature has no safe Photoshop representation;
- SVG and PDF for vector-heavy cartography;
- 16-bit heightmap;
- 32-bit floating-point terrain via GeoTIFF and OpenEXR where appropriate;
- normal, slope, hillshade, biome, climate, and mask maps;
- GeoTIFF or equivalent georeferenced rasters;
- GeoPackage or GeoJSON for vector features;
- NetCDF/HDF5 import and export for climate and landscape-evolution providers;
- GPML/GPMLZ and `.rot` interchange for GPlates workflows;
- project interchange with TectoLite Web.

Export must support tiled rendering so poster-size output does not require the
entire image in memory.

## 13. User-interface layout

The default workspace consists of:

- central 2D map canvas with an optional synchronized 3D globe/terrain preview;
- left tool shelf for select, terrain, features, drawing, text, and masks;
- right inspector for the selected layer, object, brush, or generator;
- layer and generator stack;
- job/status panel for previews, stale regions, and final processing;
- timeline when tectonic history is being edited;
- overview/minimap and navigator for high-resolution regional work.

Modes should organize complexity without changing the underlying document:

- Tectonics
- Terrain
- Water and climate
- Features
- Cartography
- Export

Objects remain visible and selectable across modes when their layers are visible.

## 14. Delivery plan

Each milestone ends in a usable vertical slice and has a hard acceptance gate.

### Phase 0 — Technical prototypes

Build disposable prototypes for cube-sphere tiling, brush latency, tile seams,
native-worker communication, erosion determinism, data-aware reprojection,
provider isolation, OpenRaster output, terrain generalization, and poster-size
tiled export.

Create a benchmark corpus containing:

- equatorial, polar, antimeridian, and cube-face-spanning terrain;
- humid external drainage and arid endorheic drainage;
- young mountains, old orogenies, plateaus, broad plains, islands, and deltas;
- categorical masks adjacent to continuous elevation;
- equivalent reference runs or images from goSPL, Wilbur, Pyramid Shader,
  Terrain Sculptor, G.Projector/MapDesigner, and ExoPlaSim where licensing and
  reproducibility permit.

Gate:

- seamless terrain across tile and cube-face boundaries;
- responsive brush preview on a representative laptop;
- cancellable background job without UI stalls;
- deterministic erosion output;
- round-trip projection with no categorical bleeding, height-depth loss, or
  antimeridian seam;
- a valid layered OpenRaster file that opens correctly in GIMP and Krita;
- successful large export within a bounded memory budget.

### Phase 1 — Document, layers, and renderer

Deliver the new desktop shell, versioned project format, layer stack, masks,
blend modes, tiled storage, autosave, crash recovery, undo/redo, and 2D renderer.

Gate: a user can create, save, reopen, reorder, mask, blend, and export a
multi-layer world without data loss.

### Phase 2 — Manual terrain studio

Deliver terrain import, base height creation, core height brushes, selections,
local detail levels, hillshade, contours, 3D preview, and 16-bit export.

Gate: a user can sculpt and export a convincing terrain entirely by hand.

### Phase 3 — Tectonic terrain

Import or share TectoLite worlds and generate ocean depth, shelves, mountain
belts, old orogenies, rifts and failed rifts, trenches, arcs, terranes, craton
interiors, LIPs, hotspot tracks, basins, and macro detail as separately
controllable layers. Add GPML/GPMLZ and `.rot` interchange validation against
GPlates.

Gate: changing a plate or boundary invalidates and regenerates only the affected
terrain while preserving manual overrides.

### Phase 4 — Automated erosion and hydrology

Deliver preview/final erosion, hardness and protection masks, drainage analysis,
editable rivers and lakes, humid and endorheic basin handling, source-to-sink
sediment routing, floodplains/fans/deltas, local reruns, river incision, and
erosion delta layers. Add an experimental goSPL provider adapter for reference
comparison without making it a required runtime.

Gate: the same inputs produce the same result; users can redirect a river and
preserve that decision through later local regeneration.

### Phase 5 — Feature brushes

Deliver procedural object/path brushes, terrain-aware placement, editable brush
results, core natural and civilization symbol sets, and reusable brush presets.

Gate: brush output can be restyled, reseeded, manually rearranged, and exported
without rasterizing the source objects prematurely.

### Phase 6 — Climate, biomes, and regional automation

Deliver latitude/elevation temperature, winds, rainfall, rain shadows, biome
generation, vegetation placement, and manual climate/biome overrides. Define a
provider API for advanced models and prove it with import of at least one
ExoPlaSim NetCDF/HDF5 result; do not require ExoPlaSim for the normal workflow.

Gate: upstream terrain changes offer local climate/biome updates without erasing
painted exceptions.

### Phase 7 — Finished-map toolset

Deliver production styling, labels, symbols, textures, adjustment layers,
decorations, artboards, distortion guidance, hypsometric styles, contour families,
multidirectional/ambient relief, terrain generalization, presets, and print
preview. Use Pyramid Shader and high-quality hand-finished references as visual
benchmarks, not merely correctness checks.

Gate: bundled example projects can be exported directly at a quality suitable
for publication or gameplay without external editing.

### Phase 8 — Export, optimization, and release hardening

Deliver tiled high-resolution rendering, all interchange formats, asset packing,
content packs. Include automated round-trip checks with GIMP/Krita OpenRaster,
QGIS/GDAL geospatial formats, GPlates interchange, and optional Blender terrain
export.

Gate: complete representative worlds survive save/reopen, crash recovery,
migration, and cross-platform export tests.

## 15. Suggested first public release

Do not wait for every simulation system. The first compelling release should
include Phases 1 through 5 plus a focused subset of Phase 7:

- tectonic terrain generation;
- manual height editing;
- automatic erosion;
- editable rivers and lakes;
- feature brushes;
- layer masks and blend modes;
- hillshade, contours, land/water textures, labels, symbols, and frames;
- finished PNG/PDF export and technical height/vector exports.

Climate and biome simulation can follow if users can already paint attractive
biome and vegetation layers manually.

## 16. Quality and performance targets

Exact budgets should be fixed by Phase 0 measurements, but the product should be
designed around these goals:

- interactive tools remain responsive while background generation runs;
- previews appear quickly enough to support parameter exploration;
- all expensive work is cancellable and reports progress;
- projects scale from a whole-world overview to high-detail regional maps;
- manual edits never disappear because a generator reran;
- save and recovery are resilient to interrupted jobs;
- exported lines and labels remain sharp at target print resolution;
- bundled presets produce coherent results without requiring expert tuning.

## 17. Main risks

### Feature breadth

"All-in-one" can become a collection of shallow tools. Every phase therefore
requires a complete user journey and export result before the next simulation
system begins.

### Seam artifacts

Tiled spherical erosion can create visible boundaries. All neighborhood-based
processing must use overlap margins and reconciliation tests from the first
prototype.

### Destructive regeneration

Automated updates can undermine user trust. Generated layers, manual override
layers, stale-region previews, and atomic commits must exist before advanced
automation is introduced.

### Visual quality

Plausible terrain is not automatically attractive cartography. Finished-map
examples, style presets, label quality, and export fidelity must be treated as
release criteria rather than final polish.

### Reproducibility

Algorithm upgrades can change old worlds. Projects must record generator versions,
and frozen results must remain available until the user chooses to upgrade them.

## 18. Definition of success

World Studio has reached its goal when a user can:

1. alter tectonic history and receive a coherent terrain proposal;
2. automatically erode it and derive an editable water system;
3. override any generated decision locally or globally;
4. paint terrain, natural features, settlements, routes, regions, and decoration;
5. compose those elements with professional layer, mask, typography, texture,
   and color controls;
6. export a finished fantasy map that requires no external editor;
7. reopen or regenerate the project without losing manual art direction.

## 19. Research references and continuing review

The following sources informed the requirements added to this plan and should be
revisited when designing the relevant subsystem:

### Worldbuilding Pasta workflow

- [Series site map](https://worldbuildingpasta.blogspot.com/p/blog-page.html)
- [Constructing a Plate Tectonic History](https://worldbuildingpasta.blogspot.com/2020/01/an-apple-pie-from-scratch-part-va.html)
- [Using GPlates](https://worldbuildingpasta.blogspot.com/2020/06/an-apple-pie-from-scratch-part-v.html)
- [Climate: Global Forcings](https://worldbuildingpasta.blogspot.com/2020/03/an-apple-pie-from-scratch-part-via.html)
- [Climate: Biomes and Climate Zones](https://worldbuildingpasta.blogspot.com/2020/05/an-apple-pie-from-scratch-part-vib.html)
- [Modeling Climate with ExoPlaSim](https://worldbuildingpasta.blogspot.com/2021/11/an-apple-pie-from-scratch-part-vi.html)
- [Tectonics and Volcanism](https://worldbuildingpasta.blogspot.com/2021/07/an-apple-pie-from-scratch-part-viia.html)
- [Erosion and Deposition](https://worldbuildingpasta.blogspot.com/2022/02/an-apple-pie-from-scratch-part-viib.html)
- [Constructing Global Terrain](https://worldbuildingpasta.blogspot.com/2023/03/an-apple-pie-from-scratch-part-viic.html)
- [Cartography](https://worldbuildingpasta.blogspot.com/2026/02/an-apple-pie-from-scratch-part-viii.html)
- [Tools and Resources](https://worldbuildingpasta.blogspot.com/p/tools-and-resources.html)

### Primary application and format documentation

- [goSPL documentation](https://gospl.readthedocs.io/en/dev/)
- [GPlates and pyGPlates documentation](https://www.gplates.org/docs/)
- [ExoPlaSim documentation](https://exoplasim.readthedocs.io/en/stable/)
- [PROJ documentation](https://proj.org/en/stable/)
- [GDAL documentation](https://gdal.org/en/stable/)
- [Pyramid Shader](https://terraincartography.com/PyramidShader/)
- [Terrain Sculptor](https://terraincartography.com/terrainsculptor/)
- [SAGA GIS](https://saga-gis.sourceforge.io/en/about/about.html)
- [MapDesigner source and documentation](https://github.com/jkunimune/Map-Projections)
- [Azgaar Fantasy Map Generator source](https://github.com/Azgaar/Fantasy-Map-Generator)
- [G.Projector](https://www.giss.nasa.gov/tools/gprojector/)
- [OpenRaster specification](https://www.openraster.org/)
- [QGIS](https://www.qgis.org/)
- [Blender documentation](https://docs.blender.org/manual/en/latest/)

Before adopting code or bundling an engine, record its exact version, license,
transitive native dependencies, supported platforms, expected job duration,
input/output contract, determinism, and failure behavior in a dependency decision
record. Inspiration from a workflow does not by itself authorize copying code,
assets, presets, or documentation text.
