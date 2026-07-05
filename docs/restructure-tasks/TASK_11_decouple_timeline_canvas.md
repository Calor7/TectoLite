# TASK_11 — Decouple TimelineSystem + CanvasManager from `app: any`

## Context
TectoLite is a tectonic plate simulation app. Repo at `c:\GIT\TectoLite`.

Two subsystems are tightly coupled to the main app class via untyped back-references:

1. **`src/systems/TimelineSystem.ts`** — constructor takes `app: any` and calls back into `this.app.pushState()`, `this.app.state`, `this.app.showModal()`, `this.app.deletePlates()`, `this.app.updateUI()`. The constructor also takes `_containerId`, `_simulationEngine`, `_historyManager` params that are **all unused** (dead parameters).

2. **`src/canvas/CanvasManager.ts`** — constructor takes ~13 callback functions (onDrawComplete, onFeaturePlace, onSelect, onSplitApply, onSplitPreviewChange, onMotionChange, onDragTargetRequest, onPolyFeatureComplete, onMotionPreviewChange, onDrawUpdate, onGizmoUpdate, onEditPending). These are positional constructor args — adding/removing one requires updating the call site and risks misordering.

## Task

### Part A: Decouple TimelineSystem

#### 1. Define a `TimelineHost` interface
In `src/systems/TimelineSystem.ts` (or a new `src/systems/types.ts`):

```typescript
export interface TimelineHost {
    state: AppState;
    pushState(): void;
    updateUI(): void;
    showModal(modal: { title: string; content: string; buttons: any[] }): void;
    deletePlates(plateIds: string[]): void;
}
```

#### 2. Update TimelineSystem constructor
Replace:
```typescript
constructor(_containerId: string, _simulationEngine: SimulationEngine, _historyManager: HistoryManager, app: any)
```
With:
```typescript
constructor(host: TimelineHost)
```
Remove all dead parameters (`_containerId`, `_simulationEngine`, `_historyManager`). Replace `this.app` with `this.host` (typed as `TimelineHost`). Update all `this.app.X` calls to `this.host.X`.

#### 3. Update `src/main.ts` instantiation
Replace:
```typescript
this.timelineSystem = new TimelineSystem('timeline-panel', this.simulation!, this.historyManager, this);
this.timelineSystem.setContainer(document.getElementById('timeline-panel')!);
```
With:
```typescript
this.timelineSystem = new TimelineSystem(this);
this.timelineSystem.setContainer(document.getElementById('timeline-panel')!);
```
`TectoLiteApp` must satisfy `TimelineHost` — it already has `state`, `pushState()`, `updateUI()`, `showModal()`, `deletePlates()`. Add `implements TimelineHost` to the class (or rely on structural typing — TypeScript interfaces are structural).

### Part B: Decouple CanvasManager

#### 1. Define a `CanvasManagerCallbacks` interface
In `src/canvas/CanvasManager.ts` (or `src/canvas/types.ts`):

```typescript
export interface CanvasManagerCallbacks {
    onDrawComplete: (points: Coordinate[]) => void;
    onFeaturePlace: (position: Coordinate, type: FeatureType) => void;
    onSelect: (plateId: string | null, featureId: string | null, featureIds?: string[], plumeId?: string | null) => void;
    onSplitApply: (points: Coordinate[]) => void;
    onSplitPreviewChange: (active: boolean) => void;
    onMotionChange: (plateId: string, pole: Coordinate, rate: number) => void;
    onDragTargetRequest?: (plateId: string, axis: Vector3, angleRad: number) => void;
    onPolyFeatureComplete?: (points: Coordinate[], fillColor: string) => void;
    onMotionPreviewChange?: (active: boolean) => void;
    onDrawUpdate?: (count: number) => void;
    onGizmoUpdate?: (rate: number) => void;
    onEditPending?: (active: boolean) => void;
}
```

#### 2. Update CanvasManager constructor
Replace the ~13 positional callback params with a single callbacks object:

```typescript
constructor(
    canvas: HTMLCanvasElement,
    private getState: () => AppState,
    private setState: (updater: (state: AppState) => AppState) => void,
    private callbacks: CanvasManagerCallbacks
)
```

Update all `this.onDrawComplete(...)` → `this.callbacks.onDrawComplete(...)`, etc.

#### 3. Update `src/main.ts` instantiation
Replace the ~15 positional args with an object:

```typescript
this.canvasManager = new CanvasManager(
    canvas,
    () => this.state,
    (updater) => { this.state = updater(this.state); this.updateUI(); this.canvasManager?.markDirty(); },
    {
        onDrawComplete: (points) => this.handleDrawComplete(points),
        onFeaturePlace: (pos, type) => this.handleFeaturePlace(pos, type),
        onSelect: (plateId, featureId, featureIds, plumeId) => this.handleSelect(plateId, featureId, featureIds, plumeId),
        onSplitApply: (points) => this.handleSplitApply(points),
        onSplitPreviewChange: (active) => this.handleSplitPreviewChange(active),
        onMotionChange: (plateId, pole, rate) => this.handleMotionChange(plateId, pole, rate),
        onDragTargetRequest: (plateId, axis, angleRad) => this.handleDragTargetRequest(plateId, axis, angleRad),
        onMotionPreviewChange: (active) => { const el = document.getElementById('motion-controls'); if (el) el.style.display = active ? 'block' : 'none'; },
        onDrawUpdate: (count) => this.handleDrawUpdate(count),
        onGizmoUpdate: (rate) => { /* ... existing speed input update ... */ },
        onEditPending: (active) => { const el = document.getElementById('edit-controls'); if (el) el.style.display = active ? 'block' : 'none'; },
    }
);
```

## Verification
1. `npx tsc --noEmit` — must pass
2. `npx vitest run` — must pass
3. `npx vite build` — must pass
4. `grep -r "app: any\|app:any" src/` — no results in `TimelineSystem.ts` or `CanvasManager.ts`
5. `grep -r "_containerId\|_simulationEngine\|_historyManager" src/systems/TimelineSystem.ts` — no results (dead params removed)
6. **Manual test**: Timeline panel renders, events edit/delete work. Canvas draw/select/split/motion-gizmo all work.

## Notes
- The `TimelineHost` interface uses structural typing — `TectoLiteApp` doesn't need to explicitly `implements TimelineHost` as long as it has the right methods. But adding `implements` is good for compile-time safety.
- The `showModal` signature in `TimelineHost` should match the actual `showModal` method on `TectoLiteApp` — read its signature to get the exact type.
- The `CanvasManagerCallbacks` object pattern makes it easy to add/remove callbacks in the future without misordering.
- If TASK_07 (dirty flag) is done, include `this.canvasManager?.markDirty()` in the setState closure as shown.