# TASK_16 — Split `main.ts` God Class into Feature Controllers

## Context
TectoLite is a tectonic plate simulation app. Repo at `c:\GIT\TectoLite`.

`src/main.ts` is **4,455 lines** — a god class (`TectoLiteApp`) that directly handles DOM wiring (~300 `getElementById` calls), state mutation, business logic, canvas calls, and simulation calls. `setupEventListeners` alone is ~1,200 lines. Every handler follows: `pushState() → mutate state → updateUI() → canvasManager.render() → simulation.setTime()`.

**Target**: no file > 800 lines (except `types.ts`).

## Task

### 1. Map the responsibilities of `main.ts`
Read `src/main.ts` and catalog every method into a responsibility bucket:
- **Plate operations**: `handleDrawComplete`, `handleSplitApply`, `handleFeaturePlace`, `duplicateSelectedPlate`, `handleLinkTool`, `handleDragTargetRequest`, `handleMotionChange`, `addMotionKeyframe`/`addMotionSegment`
- **Selection**: `handleSelect`, `updateExplorer`, `updatePropertiesPanel`, `updateEdgePropertiesPanel`
- **Toolbar/tools**: `setupEventListeners` (tool buttons, draw mode, line type, polygon type, snapping)
- **File I/O**: export/import handlers, autosave, `pushState`/`undo`/`redo`
- **Viewport/camera**: camera bookmarks, view controls
- **Timeline**: time slider, play/pause, speed inputs
- **Settings**: global options handlers (oceanic crust, line type defaults, boundary viz, etc.)
- **UI orchestration**: `init`, `updateUI`, `syncUIToState`, `updateToolbarState`

### 2. Define a shared context interface
Create `src/app/AppContext.ts`:

```typescript
export interface AppContext {
    state: AppState;
    setState(updater: (s: AppState) => AppState): void;
    pushState(): void;
    updateUI(): void;
    updateExplorer(): void;
    updatePropertiesPanel(): void;
    canvasManager: CanvasManager;
    simulation: SimulationEngine;
    historyManager: HistoryManager;
    timelineSystem: TimelineSystem;
    showModal(options: { title: string; content: string; buttons: any[] }): void;
    showToast(msg: string, duration: number): void;
    setUnsaved(value: boolean): void;
    cameraBookmarks: CameraView[];
    // ... other shared fields
}
```

### 3. Extract feature controllers
Create these files under `src/controllers/`:

- **`PlateController.ts`** — plate creation, split, fuse, duplicate, delete, link tool, drag-target, motion change. Takes `AppContext`.
- **`SelectionController.ts`** — handleSelect, updateExplorer, updateEdgePropertiesPanel. Takes `AppContext`.
- **`ToolbarController.ts`** — tool button wiring, draw mode, line/polygon type selects, snapping toggles. Takes `AppContext`.
- **`FileController.ts`** — export/import, autosave, save/load. Takes `AppContext`.
- **`CameraController.ts`** — camera bookmarks, view controls. Takes `AppContext`.
- **`TimelineController.ts`** — time slider, play/pause, speed inputs. Takes `AppContext`.
- **`SettingsController.ts`** — global options handlers. Takes `AppContext`.

Each controller:
- Receives `AppContext` in its constructor.
- Exposes public methods for the operations it owns.
- Does NOT access `document` directly for business logic — only for DOM events it owns.
- Calls `ctx.pushState()`, `ctx.setState()`, `ctx.updateUI()` etc. via the context.

### 4. Slim down `TectoLiteApp`
`main.ts` becomes a thin orchestrator:
```typescript
export class TectoLiteApp implements AppContext {
    state: AppState;
    canvasManager: CanvasManager;
    simulation: SimulationEngine;
    // ... shared fields

    private plateController: PlateController;
    private selectionController: SelectionController;
    // ... other controllers

    constructor() {
        this.state = createDefaultAppState();
        this.init();
    }

    private init() {
        // Inject HTML, create canvas/sim/timeline
        // Create controllers
        this.plateController = new PlateController(this);
        this.selectionController = new SelectionController(this);
        // ...
        // Wire canvas callbacks to controllers
        this.canvasManager = new CanvasManager(canvas, () => this.state, ...,
            { onDrawComplete: (p) => this.plateController.handleDrawComplete(p), ... });
        // Start render loop, updateUI
    }

    // AppContext implementation
    setState(updater) { this.state = updater(this.state); this.updateUI(); this.canvasManager?.markDirty(); }
    pushState() { this.historyManager.push(this.state); this.setUnsaved(true); }
    updateUI() { /* ... */ }
    // ...
}
```

### 5. Move `setupEventListeners` into controllers
The ~1,200-line `setupEventListeners` should be split: each controller has its own `setupEventListeners()` method that wires only its own DOM elements. `TectoLiteApp.init()` calls each controller's setup.

### 6. Move `updatePropertiesPanel` to SelectionController
If TASK_15 (Preact) is done, `updatePropertiesPanel` becomes a thin signal-sync. If not, move the 610-line method to `SelectionController` (it's still large but at least it's in the right module).

## Verification
1. `npx tsc --noEmit` — must pass
2. `npx vitest run` — must pass
3. `npx vite build` — must pass
4. `wc -l src/main.ts` — should be < 800 lines (target: ~300-500 lines for the orchestrator)
5. `wc -l src/controllers/*.ts` — each should be < 800 lines
6. `grep -c "getElementById" src/main.ts` — should be < 20 (down from ~300)
7. **Manual test**: All features work — draw, split, fuse, select, edit properties, export, import, undo/redo, play/pause, settings.

## Notes
- **This is the largest task**. Do it incrementally — extract one controller at a time, verify build/tests after each.
- The `AppContext` interface is the key decoupling mechanism. Controllers depend on the interface, not the concrete `TectoLiteApp` class.
- If TASK_11 (decouple TimelineSystem/CanvasManager) is done, the interfaces already exist — reuse them.
- If TASK_15 (Preact) is done, `SelectionController` is much simpler (no 610-line panel method).
- Don't extract controllers that would be < 100 lines — merge small ones into a related controller.
- The order of extraction matters: extract `PlateController` first (most self-contained), then `SelectionController`, then `ToolbarController`, etc.
- Keep `pushState`/`undo`/`redo` in `TectoLiteApp` (or a `HistoryController`) — they're cross-cutting.


Note out of scope at the end findings and tasks and write them to docs\restructure-tasks\out-of-scope-list