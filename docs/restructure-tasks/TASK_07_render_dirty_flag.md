# TASK_07 — Add Render-Dirty Flag to CanvasManager

## Context
TectoLite is a tectonic plate simulation app. Repo at `c:\GIT\TectoLite`.

`src/canvas/CanvasManager.ts` runs a `requestAnimationFrame` loop (`startRenderLoop`, around line 362) that calls `render()` **every frame unconditionally** — even when nothing on screen has changed. This wastes CPU/GPU at 60fps when the app is idle.

## Task

### 1. Add a dirty flag
In `CanvasManager`:
- Add a private `private isDirty: boolean = true;` field (starts dirty so the first frame renders).
- Add a public `markDirty(): void` method that sets `this.isDirty = true`.
- In `startRenderLoop()` / the RAF callback: only call `this.render()` if `this.isDirty` is true. After rendering, set `this.isDirty = false`.
- Keep the RAF loop running (don't stop it) — just skip the render call when clean. This ensures we pick up the next dirty signal immediately.

### 2. Mark dirty on all state changes
The `setState` closure passed to `CanvasManager` (in `src/main.ts` around line 126) is the primary state-change path. Update it to call `this.canvasManager?.markDirty()`:

```typescript
// src/main.ts, in init(), the CanvasManager setState callback:
(updater) => {
    this.state = updater(this.state);
    this.updateUI(); // Centralized UI update
    this.canvasManager?.markDirty();
},
```

### 3. Mark dirty on viewport changes
In `CanvasManager` itself, call `this.markDirty()` in all viewport-mutation paths:
- Pan/zoom handlers (mouse wheel, drag-pan)
- `setViewport` / viewport sync methods
- `setDrawMode`, `setActiveTool`, `setSnappingEnabled`, `setEditSnappingEnabled`
- Any method that changes what's rendered

Search for all `this.setState(...)` calls inside `CanvasManager.ts` and add `this.markDirty()` after each (or better: make `setState` internally call `markDirty`).

**Cleaner approach**: Override the `setState` field to automatically mark dirty:
```typescript
// In the constructor, wrap setState:
const originalSetState = this.setState;
this.setState = (updater) => {
    originalSetState(updater);
    this.markDirty();
};
```
This way every state change automatically marks dirty. Then you only need manual `markDirty()` calls for viewport changes that DON'T go through `setState` (if any — check).

### 4. Mark dirty during playback
The `SimulationEngine` updates state via its own `setState` closure (in `src/main.ts` around line 155-161). That closure currently calls `this.updateTimeDisplay()` but NOT `this.canvasManager?.markDirty()`. Add it:
```typescript
(updater) => {
    this.state = updater(this.state);
    this.updateTimeDisplay();
    this.canvasManager?.markDirty(); // ← add this
},
```

### 5. Mark dirty during interaction
During active mouse interactions (dragging, drawing, hovering), the canvas needs to render even without state changes (e.g. hover highlights, draw preview). Add `this.markDirty()` to:
- Mouse move handlers (when a tool is active or hovering)
- Draw/split path preview updates
- Motion gizmo drag updates
- Edit tool vertex drags

Search for `mousemove`, `handleMouseMove`, `onMouseMove` in `CanvasManager.ts` and ensure `markDirty()` is called when there's active interaction.

### 6. Keep rendering during animation
If any visual animation runs independent of state (e.g. flowline trails animating, gizmo transitions), ensure `markDirty()` is called each frame during the animation. Search for any `requestAnimationFrame` or animation timing in `CanvasManager.ts` beyond the main loop.

## Verification
1. `npx tsc --noEmit` — must pass
2. `npx vitest run` — must pass
3. `npx vite build` — must pass
4. **Manual test**: Load the app, create a plate, then leave it idle. Open browser DevTools → Performance Monitor. CPU usage should drop to near-zero when idle (vs. constant 60fps rendering before).
5. **Manual test**: Pan/zoom the canvas — should be responsive (dirty flag triggers render immediately).
6. **Manual test**: Press play (simulation) — should render smoothly every frame (sim setState marks dirty each tick).

## Notes
- The RAF loop must keep running — don't stop it when clean. We need it to pick up the next dirty signal with minimal latency.
- Be generous with `markDirty()` calls — a false dirty (rendering when nothing changed) costs a bit of CPU, but a false clean (not rendering when something changed) is a visible bug. Err on the side of marking dirty.
- The `cachedOverlayImages` map is unaffected — it's a content cache, not a render-skip cache.
- If TASK_08 (cache projection) is done, the dirty flag and projection cache work together: dirty → rebuild projection if needed → render.



Note out of scope at the end findings and tasks and write them to docs\restructure-tasks\out-of-scope-list