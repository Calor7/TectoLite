# TASK_21 — Canvas2D → WebGL Renderer

## Context
TectoLite is a tectonic plate simulation app. Repo at `c:\GIT\TectoLite`.

`src/canvas/CanvasManager.ts` (~1,661 lines) uses immediate-mode Canvas2D. For each frame, it fills+strokes every polygon of every plate, draws features, boundaries, flowlines, gizmos, etc. For large worlds (hundreds of plates with complex polygons), this is the performance bottleneck. Canvas2D fill+stroke is CPU-bound and doesn't scale.

WebGL with instanced rendering would scale 10x+ by pushing geometry to the GPU.

## Task

### 1. Assess the current rendering pipeline
Read `src/canvas/CanvasManager.ts` fully. Catalog every render operation:
- Plate polygon fill + stroke (with per-line-type color/dash)
- Flowline trails (under + over)
- Euler poles
- Derived rift lines (midlines)
- Selected edge highlight
- Event icons
- Mantle plumes
- Plate links
- Motion gizmo
- Active tool overlay (draw/split/edit preview)
- Velocity arrows, prediction flowlines
- Ghost rotation widget
- Graticule (grid)
- Image overlay

Note which use d3-geo projections (the path generator) vs. direct canvas drawing.

### 2. Choose a WebGL approach
**Option A: regl (declarative WebGL)**
- `regl` is a lightweight declarative WebGL library (~15KB). It handles shader compilation, buffer management, and uniforms declaratively.
- Pros: much simpler than raw WebGL, good for 2D shape rendering.
- Cons: still requires writing shaders and converting polygon data to vertex buffers.

**Option B: PixiJS**
- Full 2D rendering engine with WebGL backend, Canvas2D fallback.
- Pros: handles polygons, graphics, text, interaction. Much higher-level than regl.
- Cons: larger dependency (~200KB), may be overkill.

**Option C: Raw WebGL2**
- No dependency. Full control.
- Pros: minimal bundle, maximum performance.
- Cons: most code to write, hardest to maintain.

**Option D: Hybrid — WebGL for plate fills, Canvas2D for overlays**
- Render plate polygons (the bulk of the work) via WebGL instanced rendering.
- Keep Canvas2D for thin overlays (gizmo, tool previews, text labels, icons).
- Overlay the Canvas2D canvas on top of the WebGL canvas.
- Pros: best balance — GPU acceleration where it matters, Canvas2D simplicity where it's fine.
- **Recommended**: this is the pragmatic approach.

### 3. Implement the chosen approach (recommended: Option D)

#### Phase 1: WebGL plate fill renderer
1. Install `regl`: `npm install regl`
2. Create `src/canvas/WebGLPlateRenderer.ts`:
   - Takes a WebGL context + projection.
   - Converts plate polygons to triangulated vertex buffers (use `d3-delaunay` or `earcut` for triangulation — `d3-delaunay` is already a dependency).
   - Renders filled triangles with per-plate color uniforms.
   - Handles orthographic back-face culling (discard vertices behind the globe).
3. Create a second WebGL canvas behind the existing Canvas2D canvas (or replace the Canvas2D canvas with a WebGL canvas + a Canvas2D overlay).
4. In `CanvasManager.render()`, call `WebGLPlateRenderer.render(plates, projection)` for fills, then draw strokes + overlays on the Canvas2D layer.

#### Phase 2: WebGL stroke renderer
- Render plate outlines (strokes) as WebGL line primitives with the per-line-type color/dash.
- Dash patterns require a shader (distance-based dash in fragment shader).
- This is more complex than fills — defer if needed, keep Canvas2D for strokes initially.

#### Phase 3: WebGL feature/icons renderer
- Render feature icons (volcanoes, mountains, etc.) as instanced quads with texture atlas.
- Replace `src/canvas/featureIcons.ts` Canvas2D drawing with WebGL instanced rendering.

### 4. Handle projection
d3-geo projections produce `[x, y]` screen coordinates. For WebGL:
- Project polygon points to screen coords using d3-geo (same as now).
- Pass screen coords as vertex positions to WebGL.
- The WebGL vertex shader is a simple passthrough (screen-space).
- No need for 3D camera matrices — d3-geo handles the projection.

### 5. Preserve all visual behavior
The WebGL renderer must produce visually identical output to the Canvas2D renderer:
- Same colors, opacity, blending.
- Same z-ordering (plates sorted by zIndex).
- Same back-face culling for orthographic.
- Same antimeridian handling.

## Verification
1. `npx tsc --noEmit` — must pass
2. `npx vitest run` — must pass
3. `npx vite build` — must pass
4. **Visual regression**: The app should look identical to the Canvas2D version. Compare screenshots.
5. **Performance test**: Create a world with 100+ plates with complex polygons. Frame rate should be significantly higher with WebGL (target: 60fps where Canvas2D dropped below 30).
6. **Manual test**: All interactions work — pan, zoom, select, draw, split, edit. The Canvas2D overlay must align perfectly with the WebGL layer.

## Notes
- **This is a large task** — consider doing it in phases (fills first, strokes second, features third).
- **The hybrid approach (Option D) is strongly recommended** — pure WebGL for everything (including gizmos, tool previews, text) is a massive rewrite with little benefit for those thin overlays.
- d3-geo's `geoPath` is Canvas2D-specific. For WebGL, project points manually via `projection(point)` and build vertex buffers from the resulting screen coords.
- Triangulation: `d3-delaunay` is already a dependency but it's for Delaunay triangulation (point sets), not polygon triangulation. Consider adding `earcut` (~20KB) for fast polygon triangulation, or use the GLU tessellator.
- Back-face culling: for orthographic projection, points behind the globe have negative dot product with the view direction. Implement in the vertex shader (discard clipped vertices) or in JS before uploading buffers.
- If TASK_07 (dirty flag) and TASK_08 (projection cache) are done, the WebGL renderer benefits from the same optimizations — only re-upload buffers when plates/projection change.
- **Fallback**: if WebGL context creation fails (old hardware), fall back to Canvas2D. Detect via `canvas.getContext('webgl2')` returning null.


Note out of scope at the end findings and tasks and write them to docs\restructure-tasks\out-of-scope-list