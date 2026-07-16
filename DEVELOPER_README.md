# TectoLite — Developer Guide

> Keep this file up to date when the active architecture changes. Historical delivery docs in the repo may describe earlier states that no longer match the current runtime.

## Quick Start

```bash
npm install        # Install dependencies
npm run dev        # Start dev server (Vite)
npm run typecheck  # Fast TypeScript verification
npm run build      # Production build (tsc && vite build)
npm run verify     # Lint + type-check + Electron syntax + tests + production build
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
│   ├── SettingsBindings.ts          #   Typed persistent-setting bindings and UI sync
│   ├── TimeControls.ts              #   Play button, toast, time display & input
│   ├── TutorialOverlay.ts           #   First-run tutorial overlay
│   └── TutorialManual.html          #   In-app reference manual content
│
├── canvas/                          # Canvas rendering & interaction
│   ├── CanvasManager.ts             #   Main canvas controller (delegates to InputTools)
│   ├── tools/                       #   Interaction logic (InputTool implementations)
│   │   ├── InputTool.ts             #     Interface for input events
│   │   ├── PathInputTool.ts         #     Draw, Split, PolyFeature
│   │   ├── EditTool.ts              #     Vertex manipulation, Plate Editing
│   │   ├── SelectionTool.ts         #     Select, Box Select
│   │   └── PlacementTool.ts         #     Feature placement
│   ├── MotionGizmo.ts               #   Euler pole drag gizmo
│   ├── ProjectionManager.ts         #   Map projections (orthographic, equirect, etc.)
│   └── featureIcons.ts              #   SVG icon definitions for geological features
│
├── systems/                         # Simulation and export support systems
│   ├── TimelineSystem.ts            #   Plate-history UI + keyframe management
│   └── HeightmapGenerator.ts        #   Heightmap rasterization for export
│
├── motion/                          # Plate motion model
│   ├── RotationModel.ts             #   Euler pole / rotation segment derivation
│   └── RotationModel.test.ts        #   Unit tests for the rotation model
│
├── utils/                           # Pure utility functions
│   ├── colorUtils.ts                #   Color helpers
│   ├── geoHelpers.ts                #   Geographic / projection helpers
│   ├── sphericalMath.ts             #   Spherical geometry primitives
│   └── sphericalMath.test.ts        #   Unit tests for spherical math
│
├── SimulationEngine.ts              # Time-stepping simulation and plate derivation
├── HistoryManager.ts                # Undo/Redo state stack
├── HistoryManager.test.ts           # HistoryManager unit tests
├── BoundarySystem.ts                # Plate boundary detection & classification
├── importHelpers.ts                 # Save-file import / merge migration
├── importHelpers.test.ts            # importHelpers unit tests
├── FusionTool.ts                    # Plate fusion logic
├── GeoPackageExporter.ts            # QGIS GeoPackage export
└── export.ts                        # JSON/PNG export, import dialog, unified export dialog
```

---

## Current state notes

- The current app is a canvas-heavy Electron/Vite desktop application with a single central `AppState`.
- `GeologicalAutomation.ts` and the guided-event automation prototype have been deleted. Neither has an active runtime or UI path.
- `ElevationSystem.ts` and `TimeTransformationUtils.ts` are absent from `src/`. Historical docs in `docs/archive/` still reference them — treat those as snapshots, not current architecture.
- Oceanic crust generation is the only remaining opt-in geometry automation. It is mutually exclusive, disabled by default, and presented under **Settings → Experimental**.
- `TimeControls.ts` handles display/input time; the legacy "Ago" checkbox and `TimeMode` toggle have been removed from the UI (a deprecated `TimeMode` union remains in `types.ts` for save-file migration only).
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
3. Add the typed binding in `ui/SettingsBindings.ts` (or a focused listener in `main.ts` when the control has custom behavior)
4. Read it where needed (usually `CanvasManager.ts` or `SimulationEngine.ts`)

---

## Simulation notes

The simulation layer contains a mix of active systems and legacy compatibility paths.

### Oceanic crust behavior

- `SimulationEngine.ts` contains two mutually exclusive strategies: continuous split-rift fill and time-banded rift crust.
- The strategy defaults to `off` and is intentionally labeled Experimental in the Settings menu.
- Save migration v7 maps the retired independent toggles to the new strategy.

### Automation status

- The guided geological event system and its effects processor have been removed.
- The former hotspot-volcanism automation has been removed.
- Derived boundary visualization remains an optional View overlay; it does not mutate project geometry.
- Experimental oceanic crust generation is the only active opt-in geometry automation.

### Elevation status

- `HeightmapGenerator.ts` is active for export generation.
- `ElevationSystem.ts` is absent — a mesh-editing runtime path is not wired into the app.

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
| `main.ts` | ~4,447 | App orchestrator — state, event listeners, UI panels, tool handlers |
| `CanvasManager.ts` | ~1,661 | Canvas rendering, mouse/touch input, tool modes |
| `SimulationEngine.ts` | ~1,932 | Time-step simulation, plate motion, event effects |
| `types.ts` | ~843 | Shared interfaces, unions, defaults, and state models |
| `SplitTool.ts` | ~1,391 | Complex polygon splitting, Rift Triple Junctions, L-Rift logic |
| `export.ts` | ~766 | JSON/PNG import/export, dialogs |
| `AppTemplate.ts` | ~636 | Full HTML template string |

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


---

# CLAUDE.md — TectoLite working guidelines

Distilled from how this codebase has actually been worked. Follow these unless the
user says otherwise.

## What this is

TectoLite is a tectonic-plate simulation editor: TypeScript + Vite, vanilla DOM UI,
shipped as a web app and an Electron desktop app. No framework. The heavy logic lives in
a few large files (`src/main.ts`, `src/SimulationEngine.ts`, `src/canvas/CanvasManager.ts`,
`src/SplitTool.ts`); pure helpers live in `src/utils/`, `src/motion/`, `src/importHelpers.ts`.

## Verification discipline (non-negotiable)

After **every** change, before claiming anything is done:

```
npm run verify     # = lint + typecheck + Electron syntax + test + build
npm run lint       # = eslint src   (run --quiet to see errors only)
```

- `tsconfig` is strict with `noUnusedLocals`/`noUnusedParameters` — removing the last
  caller of a helper will surface orphaned imports; that's the signal to delete the dead
  code, not silence the warning.
- Run long checks in the background and wait for the result. Never report "green"
  without having seen the exit code / test count.
- State outcomes plainly and honestly: if something is unverified (e.g. canvas visuals),
  say so explicitly rather than implying it works.

## What I cannot verify — flag it, don't fake it

This is a visual, interactive app. Typecheck/tests/build prove the code is *consistent*,
not that the *canvas looks right*. When a change affects rendering, dragging, or any
on-screen behavior, say clearly that it needs a manual visual pass and give a focused
checklist of what to look at. Do not claim visual correctness from a green build.

## Principles used here

- **Investigate before asserting.** Read the actual current code; don't trust comments,
  variable names, or memory. Several bugs here were stale comments promising behavior the
  code no longer had. Memory notes are point-in-time — re-verify file/function references
  against the live tree before relying on them.
- **Root cause, not symptom.** When a tool "doesn't work," find the *class* of bug and fix
  every instance, then add a regression test that pins it. (e.g. one broken split exposed
  a spread-clone hazard at five sites.)
- **Behavior-preserving refactors keep signatures.** Replace an implementation under the
  same public surface, verify green, and the blast radius stays small.
- **Make logic pure so it can be tested.** Extract decision/transform logic into pure
  functions/modules (`RotationModel`, `importHelpers`, `sphericalMath`) and unit-test it —
  golden scenarios for math, regression tests for fixed bugs.
- **Big/architectural changes go in phases with a written plan.** Drop a `docs/PLAN_*.md`,
  define phases each independently green-verifiable, and keep its status table current.
- **Delete dead code aggressively, but keep back-compat seams deliberately.** Old save
  files (v1) must still load — lazy-migrate on import rather than dropping the parser.
- **Comments explain *why*, not *what*** — especially the non-obvious invariant a line
  protects (e.g. why a clone must reset a field).
- **Track multi-step work with TodoWrite**; keep one item in progress.

## UI / feature conventions

- **New visual overlays and automation default OFF**, exposed as opt-in toggles (View
  dropdown for visuals, Settings for automation). The canvas is information-dense; keep it
  uncluttered. Use `=== true` checks (not `!== false`) so missing/undefined means off, add
  the toggle to `syncUIToState`, and default `false` in `createDefaultWorldState()`.
- Prefer non-blocking **toasts** over `alert()` for informational/empty-state feedback;
  reserve `alert()` for genuine errors.
- When adding an option, wire all four points: template (`AppTemplate.ts`), the change
  handler (`main.ts`), `syncUIToState` (load reflects state), and persistence if it belongs
  in a save file.

## Persistence & save files

- Bump `SAVE_VERSION` when the serialized shape changes; migrate older versions on import,
  never write them back in the old shape.
- Merge-import must remap **all** cross-references (plate/parent/link/sibling/axis IDs) and
  shift all timestamps; dangling refs should be stripped, not left pointing at nothing.
- Camera views and similar session/document state that isn't world-geometry live **outside**
  `AppState` so undo (which clones the whole world) doesn't clobber them.

## Memory & handover

Keep `~/.claude/.../memory/` current: handover notes for ongoing multi-session work,
discovered pitfalls (with the "check this first" symptom), and confirmed user preferences.
Convert relative dates to absolute. This is what lets a cold session continue the work.

## Out-of-scope log

While working toward a goal, keep a running list of issues noticed but out of scope, and
surface it in the final report rather than silently expanding scope or losing the finding.
