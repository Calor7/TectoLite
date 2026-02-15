# TectoLite — Developer Guide

> **⚠️ Keep this file up to date!** When adding, moving, or removing files, update the structure below. This is the single source of truth for project architecture.

## Quick Start

```bash
npm install        # Install dependencies
npm run dev        # Start dev server (Vite)
npm run build      # Production build (tsc && vite build)
npx tsc --noEmit   # Type-check without emitting (use for quick verification)
```

---

## Project Structure

```
src/
├── main.ts                          # App entry point — TectoLiteApp class (orchestrator)
├── types.ts                         # All shared types, interfaces, ID generation, defaults
├── style.css                        # Global styles (vanilla CSS)
│
├── ui/                              # Extracted UI modules (pure functions, no class coupling)
│   ├── AppTemplate.ts               #   Full HTML template (getAppHTML)
│   ├── ModalSystem.ts               #   showModal, showLegendDialog, toggleTheme
│   ├── SpeedPresets.ts              #   Speed preset data, conversions (cm/yr ↔ deg/Ma)
│   └── TimeControls.ts             #   Play button, toast, time display & input
│
├── canvas/                          # Canvas rendering & interaction
│   ├── CanvasManager.ts             #   Main canvas controller (delegates to InputTools)
│   ├── tools/                       #   Interaction logic (InputTool implementations)
│   │   ├── InputTool.ts             #     Interface input events
│   │   ├── PathInputTool.ts         #     Draw, Split, PolyFeature
│   │   ├── EditTool.ts              #     Vertex manipulation, Plate Editing
│   │   ├── SelectionTool.ts         #     Select, Box Select
│   │   └── PlacementTool.ts         #     Feature placement
│   ├── MotionGizmo.ts               #   Euler pole drag gizmo
│   ├── ProjectionManager.ts         #   Map projections (orthographic, equirect, etc.)
│   └── featureIcons.ts              #   SVG icon definitions for geological features
│
├── systems/                         # Simulation & automation engines
│   ├── TimelineSystem.ts            #   Timeline UI + keyframe management
│   ├── EventSystem.ts               #   Geological event detection (rifts, collisions, etc.)
│   ├── EventEffectsProcessor.ts     #   Visual/state effects from geological events
│   ├── GeologicalAutomation.ts      #   Automated feature generation
│   └── HeightmapGenerator.ts        #   Heightmap rasterization for export
│
├── utils/                           # Pure utility functions
├── SimulationEngine.ts              # Time-stepping simulation (plate motion, interpolation)
├── HistoryManager.ts                # Undo/Redo state stack
├── BoundarySystem.ts                # Plate boundary detection & classification
├── GeoPackageExporter.ts            # QGIS GeoPackage export
└── export.ts                        # JSON/PNG export, import dialog, unified export dialog
```

---

## Architecture Principles

### 1. Single orchestrator pattern
`main.ts` contains the `TectoLiteApp` class which owns all state and wires everything together. Extracted modules in `ui/` are **stateless pure functions** that receive state as arguments.

### 2. How UI modules work
Each extracted module exports functions (not classes). They receive the state they need as parameters and return results or mutate DOM directly:

```ts
// SpeedPresets.ts — called from main.ts
export function applySpeedToSelected(state: AppState, rate: number, callbacks: SpeedCallbacks): void

// TimeControls.ts — called from main.ts  
export function updatePlayButton(isPlaying: boolean): void
```

The `main.ts` class methods delegate to these with thin wrappers:
```ts
private applySpeedToSelected(rate: number): void {
    _applySpeed(this.state, rate, { updatePanel: () => this.updatePropertiesPanel(), ... });
}
```

### 3. State ownership
- **`AppState`** (defined in `types.ts`) is the single source of truth
- `main.ts` owns the instance: `private state: AppState`
- Services (`CanvasManager`, `SimulationEngine`) receive state via getter callbacks `() => this.state`
- Never duplicate state — always reference from the single `AppState`

### 4. No framework dependencies
The app uses **vanilla TypeScript + Vite**. No React, no Angular, no framework. DOM manipulation is direct. CSS is vanilla.

---

## Workflows

### Adding a new tool
1. Add the tool type to `ToolType` in `types.ts`
2. Add the tool button HTML in `ui/AppTemplate.ts`
3. Add the handler method in `main.ts`
4. Wire it in `setupEventListeners()` in `main.ts`
5. **Implement `InputTool`**: Create a class in `src/canvas/tools/` implementing `InputTool`
6. **Register**: Initialize it in `CanvasManager.initializeTools()` and add to `this.tools` map
7. Add hotkey binding in the `keydown` handler in `setupEventListeners()`

### Adding a new global option
1. Add the field to `GlobalOptions` in `types.ts`
2. Add the UI control in `ui/AppTemplate.ts` (usually in the Settings dropdown)
3. Add the event listener in `setupEventListeners()` in `main.ts`
4. Read it where needed (usually `CanvasManager.ts` or `SimulationEngine.ts`)

---

## Oceanic Crust System

The application supports two modes of oceanic crust generation, toggled via **Settings > Oceanic Crust**:

### 1. Expanding Rifts (New System)
- **Logic**: `SimulationEngine.generateRiftCrust()`
- **Mechanism**: Continuously creates new "crust strips" (polygons) at divergent boundaries.
- **Behavior**: New strips push older strips away, simulating seafloor spreading.
- **Styles**: Uses `oceanicCrustColor` and `oceanicCrustOpacity` from global options.

### 2. Flowlines (Legacy)
- **Logic**: `SimulationEngine.updateFlowlines()`
- **Mechanism**: Generates crust based on flowline paths from motion history.
- **Status**: Deprecated but maintained for compatibility.

### Adding a new feature type
1. Add to `FeatureType` union in `types.ts`
2. Add icon in `canvas/featureIcons.ts`
3. Add rendering in `CanvasManager.ts`
4. Add button in `ui/AppTemplate.ts`
5. Add placement logic in `handleFeaturePlace()` in `main.ts`
6. Add properties display in `updatePropertiesPanel()` / `getFeaturePropertiesHtml()` in `main.ts`

### Building for deployment
```bash
npm run build     # Outputs to dist/
```
The `dist/` folder is the deployable static site.

### Type-checking only (no build output)
```bash
npx tsc --noEmit
```
Use this for fast verification during refactoring.

---

## Key Files to Know

| File | Lines | What it does |
|---|---|---|
| `main.ts` | ~3,460 | App orchestrator — state, event listeners, UI panels, tool handlers |
| `CanvasManager.ts` | ~2,300 | All canvas rendering, mouse/touch input, tool modes |
| `SimulationEngine.ts` | ~800 | Time-step simulation, plate motion, keyframe interpolation |
| `types.ts` | ~550 | Every interface and type in the app |
| `export.ts` | ~900 | JSON/PNG import/export, dialogs |
| `AppTemplate.ts` | ~490 | Full HTML template string |

---

## Norms

- **Always run `npx tsc --noEmit` after changes** to verify type safety
- **Keep `types.ts` as the single type source** — don't define interfaces in random files
- **Extracted modules are pure functions** — they don't hold state or reference the class
- **Update this README** when you add, move, or remove files
