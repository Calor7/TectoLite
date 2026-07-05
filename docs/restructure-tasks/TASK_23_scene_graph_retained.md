# TASK_23 — Scene Graph / Retained Rendering

## Context
TectoLite is a tectonic plate simulation app. Repo at `c:\GIT\TectoLite`.

`src/canvas/CanvasManager.ts` uses immediate-mode rendering — every frame, it re-projects and redraws everything from scratch. There's no retained scene tree, no dirty-rect tracking, no caching of rendered geometry. The only caching is `cachedOverlayImages` for image overlays.

A scene graph would enable:
- Dirty-rect rendering (only redraw changed regions)
- Geometry caching (reuse projected vertex buffers when projection hasn't changed)
- Hierarchical transforms (parent-child plate relationships)
- Spatial culling (skip plates not visible in the current viewport)

## Task

### 1. Assess whether this task is needed
**Read this before starting.** This task is the lowest-priority of the restructure. Before implementing, verify:
- Is TASK_07 (dirty flag) done? If so, rendering is already skipped when clean — the main benefit of a scene graph (avoiding redraw) is already achieved.
- Is TASK_08 (projection cache) done? If so, projection isn't rebuilt when unchanged.
- Is TASK_09 (memoize derivation) done? If so, plate geometry isn't recomputed when cached.
- Is TASK_21 (WebGL) done? If so, the GPU handles rendering efficiently and a scene graph is less valuable.

**If TASK_07 + 08 + 09 are all done, this task may be unnecessary.** Document this finding and skip implementation if the benefits don't justify the complexity. A scene graph is a large architectural change.

### 2. If proceeding, design the scene graph
Create `src/canvas/SceneGraph.ts`:

```typescript
interface SceneNode {
    id: string;
    type: 'plate' | 'feature' | 'boundary' | 'overlay' | 'gizmo' | 'grid';
    visible: boolean;
    dirty: boolean;           // needs re-render
    bounds?: BBox;            // screen-space bounding box for dirty-rect
    children: SceneNode[];
    renderData?: any;         // cached projected geometry, buffers, etc.
}

export class SceneGraph {
    private root: SceneNode;
    private plateNodes: Map<string, SceneNode> = new Map();

    /** Rebuild the scene graph from world state. Called when plates are added/removed. */
    rebuild(world: WorldState): void { ... }

    /** Mark a plate node as dirty (geometry or color changed). */
    markDirty(plateId: string): void { ... }

    /** Mark all nodes dirty (e.g. projection changed). */
    markAllDirty(): void { ... }

    /** Collect dirty nodes, sorted by z-order. */
    getDirtyNodes(): SceneNode[] { ... }

    /** Get the dirty rectangles for partial redraw. */
    getDirtyRects(): BBox[] { ... }
}
```

### 3. Integrate with CanvasManager
In `CanvasManager.render()`:
1. `sceneGraph.sync(state.world)` — update the graph (add/remove plates, mark changed ones dirty).
2. `sceneGraph.markAllDirty()` if projection/viewport changed.
3. Get dirty nodes → render only those.
4. For dirty-rect rendering: clear only the dirty regions, redraw only nodes intersecting them. (Complex — see notes.)

### 4. Cache projected geometry
Each `SceneNode` for a plate caches its projected screen-space polygon points. When the projection hasn't changed and the plate's geometry hasn't changed, reuse the cached projection. Invalidate when:
- Projection type/scale/rotate/translate changes.
- Plate geometry changes (motion, edit, split).
- Plate is selected (stroke style changes).

### 5. Spatial culling
For each frame, compute the viewport bounds in screen space. Skip nodes whose `bounds` don't intersect the viewport. This helps when zoomed in (most plates are off-screen).

## Verification
1. `npx tsc --noEmit` — must pass
2. `npx vitest run` — must pass
3. `npx vite build` — must pass
4. **Performance test**: Create a world with 100 plates. Zoom in to see 1 plate. Frame rate should be higher than rendering all 100 (spatial culling).
5. **Visual regression**: The app should look identical to before.
6. **Manual test**: Pan/zoom/select/edit — all should work correctly with the scene graph.

## Notes
- **This is the most complex and lowest-priority task.** Only do it if TASK_07/08/09 don't provide enough benefit.
- **Dirty-rect rendering** (partial canvas redraw) is complex with Canvas2D because you need to:
  1. Track the previous bounds of each node (to clear the old position).
  2. Re-render all nodes that overlap the dirty region (not just the changed node).
  3. Handle transparency/overlap correctly.
  For WebGL (TASK_21), dirty-rect is less relevant — the GPU re-renders everything fast anyway.
- **If TASK_21 (WebGL) is done, this task is largely redundant** — WebGL's instanced rendering + buffer caching achieves the same goals more naturally. The scene graph would just be a thin layer over the WebGL renderer.
- **Recommendation**: Skip this task unless TASK_07+08+09 are insufficient AND TASK_21 is not planned. Document the decision either way.
- If you do implement it, keep it minimal — a flat list of plate nodes with dirty flags and cached projections is 80% of the benefit. Hierarchical transforms and full dirty-rect are diminishing returns.


Note out of scope at the end findings and tasks and write them to docs\restructure-tasks\out-of-scope-list