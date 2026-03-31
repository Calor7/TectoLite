# TectoLite — Developer Guide

> Keep this file up to date when the active architecture changes. Historical delivery docs in the repo may describe earlier states that no longer match the current runtime.

## Quick Start

```bash
npm install        # Install dependencies
npm run dev        # Start dev server (Vite)
npm run typecheck  # Fast TypeScript verification
npm run build      # Production build (tsc && vite build)
npm run verify     # Type-check + production build
```

---

## Project Structure

```text
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
├── systems/                         # Simulation and export support systems
│   ├── TimelineSystem.ts            #   Timeline UI + keyframe management
│   ├── EventSystem.ts               #   Geological event model and event creation hooks
│   ├── EventEffectsProcessor.ts     #   Visual/state effects from geological events
│   ├── GeologicalAutomation.ts      #   Legacy hotspot automation path, partially retired
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

## Current state notes

- The current app is a canvas-heavy Electron/Vite desktop application with a single central `AppState`.
- Historical docs mention additional systems such as `ElevationSystem.ts` and `TimeTransformationUtils.ts`; those files are not present in the current `src/` tree.
- `TimeControls.ts` still exposes wrapper functions for display/input time handling, but the active behavior is effectively direct internal time handling.
- `GeologicalAutomation.ts` remains in the repo, but the main simulation loop has retired parts of the older automation flow.
- Heightmap and GeoPackage exports are active code paths.

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

## Simulation notes

The simulation layer contains a mix of active systems and legacy compatibility paths.

### Oceanic crust behavior

- `SimulationEngine.ts` still contains seafloor spreading and flowline-related logic.
- Legacy comments and compatibility branches exist, so confirm behavior in code before relying on historical docs.

### Automation status

- `GeologicalAutomation.ts` is not the primary simulation driver.
- Hotspot-related behavior remains, while older orogeny-oriented automation is marked deprecated.

### Elevation status

- `HeightmapGenerator.ts` is active for export generation.
- A mesh-editing runtime path is not currently wired into the app.

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
| --- | --- | --- |
| `main.ts` | ~3,476 | App orchestrator — state, event listeners, UI panels, tool handlers |
| `CanvasManager.ts` | ~1,209 | Canvas rendering, mouse/touch input, tool modes |
| `SimulationEngine.ts` | ~1,645 | Time-step simulation, plate motion, crust/event logic |
| `types.ts` | ~592 | Shared interfaces, unions, defaults, and state models |
| `SplitTool.ts` | ~1,270 | Complex polygon splitting, Rift Triple Junctions, L-Rift logic |
| `export.ts` | ~900 | JSON/PNG import/export, dialogs |
| `AppTemplate.ts` | ~490 | Full HTML template string |

---

## Norms

- **Always run `npm run typecheck` after changes** to verify type safety
- **Keep `types.ts` as the single type source** — don't define interfaces in random files
- **Extracted modules are pure functions** — they don't hold state or reference the class
- **Update this README** when the active code architecture changes

---

## Technical Appendix: Triple Junction Logic (Split Tool)

The `SplitTool.ts` implements advanced logic for creating geological triple junctions.

### 1. L-Shaped Rifts

When a User splits a plate connected to a Rift, the tool detects the intersection and splits the Rift itself into two "arms".

- **Old Rift** becomes two new L-shaped rifts.
- **Each L-Rift** consists of one arm of the original Rift plus a segment of the new Split Line (shared boundary).

### 2. Heuristics

Because valid geometry input can be varied (drawing lines from outside, crossing borders), the tool uses robust heuristics:

- **"First Tangent" Trimming**: If a split line starts outside the plate, the tool trims the segment to start exactly at the plate boundary (First Tangent).
- **"Longest Segment" Selection**: When a split line crosses a plate, it creates an "inside" segment and an "overshoot" segment. The tool automatically detects and uses the **longer** segment as the valid boundary for the new rift.
- **Side Determination**: `getSideOfSplitLine` uses cross-product logic relative to the first segment of the split line to correctly assign L-Rifts to the new plate halves.

### 3. Conveyor Belt Crust

The new Oceanic Crust system (`oceanic-strip` type plates) works by "accretion":

- **Trigger**: Every X million years (configurable).
- **Action**: New strip is created at the Rift Axis.
- **Motion**: Strip is linked to the diverging continent, moving with it.
- **Result**: Old strips naturally move away, creating a conveyor belt effect without complex gap-filling logic.
