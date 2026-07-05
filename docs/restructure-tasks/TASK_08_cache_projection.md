# TASK_08 — Cache Projection in ProjectionManager

## Context
TectoLite is a tectonic plate simulation app. Repo at `c:\GIT\TectoLite`.

`src/canvas/ProjectionManager.ts` (~107 lines) wraps d3-geo projections. Its `update()` method is called every frame from `CanvasManager.render()` and **rebuilds the d3 projection from scratch** every time — even when the projection type, scale, translate, and rotate haven't changed. This is wasteful.

## Task

### 1. Read `src/canvas/ProjectionManager.ts` fully
Understand the current structure: what `update()` does, what `project()` / `invert()` do, what state is stored.

### 2. Add projection caching
Add a cache keyed by the projection parameters:

```typescript
private cachedProjection: any = null;
private cachedKey: string = '';

update(projection: ProjectionType, viewport: Viewport): void {
    const key = `${projection}|${viewport.scale}|${viewport.translate[0]}|${viewport.translate[1]}|${viewport.rotate[0]}|${viewport.rotate[1]}|${viewport.rotate[2]}`;
    if (key === this.cachedKey && this.cachedProjection) {
        // Projection unchanged — reuse cache
        this.projection = this.cachedProjection;
        this.path = this.cachedPath; // if path is cached too
        return;
    }
    // Rebuild projection
    this.projection = this.buildProjection(projection, viewport);
    this.path = geoPath(this.projection, this.ctx);
    this.cachedProjection = this.projection;
    this.cachedPath = this.path;
    this.cachedKey = key;
}
```

### 3. Cache the `geoPath` too
`geoPath(projection, ctx)` is called every frame and creates a new path generator. Cache it alongside the projection (it only changes when the projection changes). Store `this.cachedPath` and reuse it.

### 4. Invalidate cache on context loss
If the canvas context is lost/restored (rare but possible), the cached path's context reference could be stale. Add a `invalidateCache()` method and call it if the context changes. In practice, the context doesn't change in this app, but add the method for safety.

### 5. Expose cache stats (optional, for debugging)
Add a `getCacheStats()` method that returns `{ hits: number, misses: number }` for debugging. Reset on `update()`. This helps verify the cache is working during manual testing.

## Verification
1. `npx tsc --noEmit` — must pass
2. `npx vitest run` — must pass
3. `npx vite build` — must pass
4. **Manual test**: Load the app, don't pan/zoom. Open DevTools → Performance. The render loop should be faster (or skipped entirely if TASK_07 dirty flag is done). Panning/zooming should still work smoothly (cache misses on viewport change, hits when stable).
5. Verify `ProjectionManager.update()` does NOT rebuild when called with identical params (add a `console.log` temporarily, or check cache stats).

## Notes
- `ProjectionType` is a string union (`'orthographic' | 'mercator' | 'equirectangular' | 'mollweide' | 'robinson'`) — safe to use in a cache key.
- `Viewport` has `scale: number`, `translate: [number, number]`, `rotate: [number, number, number]` — all primitives, safe in a cache key.
- The cache key string concatenation is cheap (a few number→string conversions) vs. rebuilding a d3 projection (object allocation + function closures).
- If TASK_07 (dirty flag) is done, this cache is less critical (render is skipped when clean), but it still helps when rendering IS needed but viewport hasn't changed (e.g. selection change).


Note out of scope at the end findings and tasks and write them to docs\restructure-tasks\out-of-scope-list