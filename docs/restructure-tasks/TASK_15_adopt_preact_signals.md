# TASK_15 — Adopt Preact + Signals for Properties Panel (Pilot)

## Context
TectoLite is a tectonic plate simulation app (TypeScript + Vite + Electron). Repo at `c:\GIT\TectoLite`.

The properties panel (`updatePropertiesPanel` in `src/main.ts`, ~610 lines) rebuilds the entire panel via `innerHTML` on every selection change / property edit, then re-binds ~35 event listeners. This causes focus loss, listener churn, and wasted work.

**This is a PILOT task**: adopt Preact + signals for the properties panel ONLY first. If it works well, the pattern can be extended to the explorer and other panels later.

## Task

### 1. Install Preact + signals
```bash
npm install preact signals
npm install -D @preact/signals
```
Add to `vite.config.ts`:
```typescript
export default defineConfig({
  // ... existing config
  resolve: {
    alias: {
      react: 'preact/compat',
      'react-dom': 'preact/compat',
    }
  }
});
```
(Only if needed — Preact can be used directly without React compat. Prefer direct Preact imports: `import { h, render } from 'preact'` and `import { signal, effect } from '@preact/signals'`.)

### 2. Create a signals-based state store
Create `src/ui/propertiesStore.ts`:

```typescript
import { signal, computed } from '@preact/signals';
import { AppState, TectonicPlate } from '../types';

// The selected plate as a signal
export const selectedPlate = signal<TectonicPlate | null>(null);

// Derived signals
export const isRift = computed(() => selectedPlate.value?.type === 'rift');
export const plateColor = computed(() => selectedPlate.value?.color ?? '#888888');
export const plateName = computed(() => selectedPlate.value?.name ?? '');

// Update functions
export function selectPlate(plate: TectonicPlate | null) {
    selectedPlate.value = plate;
}

export function updatePlate(patch: Partial<TectonicPlate>) {
    if (!selectedPlate.value) return;
    selectedPlate.value = { ...selectedPlate.value, ...patch };
    // Notify the app to pushState + render canvas
    onPlateChanged?.(selectedPlate.value);
}

let onPlateChanged: ((plate: TectonicPlate) => void) | null = null;
export function setPlateChangedHandler(fn: (plate: TectonicPlate) => void) {
    onPlateChanged = fn;
}
```

### 3. Create the Preact properties panel component
Create `src/ui/PropertiesPanel.tsx`:

```tsx
import { h } from 'preact';
import { effect } from '@preact/signals';
import { selectedPlate, isRift, plateColor, plateName, updatePlate } from './propertiesStore';

export function PropertiesPanel() {
    const plate = selectedPlate.value;
    if (!plate) return <div className="properties-empty">No plate selected</div>;

    return (
        <div className="properties-content">
            <div className="property-group">
                <label className="property-label">Name</label>
                <input
                    className="property-input"
                    value={plate.name}
                    onInput={(e) => updatePlate({ name: e.currentTarget.value })}
                />
            </div>
            <div className="property-group">
                <label className="property-label">Color</label>
                <input
                    type="color"
                    className="property-color"
                    value={plate.color}
                    onInput={(e) => updatePlate({ color: e.currentTarget.value, ...(plate.type === 'rift' ? { lineColorCustomized: true } : {}) })}
                />
            </div>
            {isRift.value && (
                <div className="property-group">
                    <label className="property-label">Line Type</label>
                    <select
                        className="property-input"
                        value={plate.lineType ?? 'generic'}
                        onChange={(e) => updatePlate({ lineType: e.currentTarget.value as any })}
                    >
                        <option value="divergent">Divergent</option>
                        <option value="convergent">Convergent</option>
                        <option value="transform">Transform</option>
                        <option value="generic">Generic</option>
                    </select>
                </div>
            )}
            {/* ... render all other property groups ... */}
        </div>
    );
}
```

### 4. Mount the Preact panel
In `src/main.ts`, replace the `updatePropertiesPanel()` innerHTML rebuild with a Preact render:

```typescript
import { render, h } from 'preact';
import { PropertiesPanel } from './ui/PropertiesPanel';
import { selectPlate, setPlateChangedHandler } from './ui/propertiesStore';

// In init():
const propertiesContainer = document.getElementById('properties-content')!;
render(<PropertiesPanel />, propertiesContainer);

// Wire the plate-changed handler
setPlateChangedHandler((plate) => {
    this.pushState();
    this.state = { ...this.state, world: { ...this.state.world, plates: this.state.world.plates.map(p => p.id === plate.id ? plate : p) } };
    this.updateExplorer();
    this.canvasManager?.render();
});

// Replace updatePropertiesPanel() to just sync the signal:
private updatePropertiesPanel(): void {
    const plate = this.state.world.plates.find(p => p.id === this.state.world.selectedPlateId) ?? null;
    selectPlate(plate);
    // Preact re-renders automatically via signals — no innerHTML rebuild
}
```

### 5. Port all property groups
The existing `updatePropertiesPanel` has ~250 lines of template covering: name, ID, visible/locked, description, color, line type, rift generation, polygon type, density, elevation, z-index, lineage, flowlines, timeline stats, Euler pole, copy/paste momentum, delete button, and feature properties.

Port each group to a Preact component. Break into sub-components for readability:
- `PropertiesHeader`
- `PropertiesBasics` (name, color, description, visible/locked)
- `PropertiesLineType` (line type, rift generation — rift only)
- `PropertiesPolygonType` (polygon type, density, elevation — non-rift)
- `PropertiesMotion` (Euler pole, copy/paste)
- `PropertiesStats` (area, speed, coverage)
- `PropertiesFeatures` (feature list)
- `PropertiesActions` (delete button)

### 6. Handle the mantle plume branch
The existing `updatePropertiesPanel` has a special branch for mantle plume selection (no plate selected, but `selectedFeatureId` matches a plume). Port this to a `PlumeProperties` component shown when a plume is selected instead of a plate.

### 7. Preserve focus behavior
The key benefit of Preact: typing in an input no longer destroys/recreates it. Focus and cursor position are preserved across re-renders. Verify this works — type in the name field while a signal update fires; focus should be retained.

## Verification
1. `npx tsc --noEmit` — must pass (may need `@types/preact` or JSX config in tsconfig)
2. `npx vitest run` — must pass
3. `npx vite build` — must pass
4. **Manual test**: Select a plate, edit its name — focus should be retained, no flicker.
5. **Manual test**: Change color via picker — should update live (no panel rebuild).
6. **Manual test**: Switch between plates — panel should update instantly.
7. **Manual test**: All property groups render correctly (line type for rifts, polygon type for plates, Euler pole, stats, features, delete).
8. `grep -c "innerHTML" src/main.ts` — should be reduced (the properties panel innerHTML is gone).

## Notes
- **This is a pilot** — only the properties panel. If it works, extend to explorer + timeline later.
- Preact is ~3KB gzipped — minimal bundle impact.
- `@preact/signals` provides fine-grained reactivity — only the components that read changed signals re-render.
- The `propertiesStore` signals bridge the gap between the app's immutable state and Preact's reactive rendering. The app still owns the canonical state; signals are a view-model layer.
- For the `onInput` vs `onChange` distinction: use `onInput` for text/color (live feedback), `onChange` for selects (commit on change).
- The tsconfig may need `"jsx": "preserve"` or `"jsx": "react-jsx"` + `"jsxImportSource": "preact"`. Update `tsconfig.json` accordingly.
- If TASK_14 (extract inline styles) is done, use the CSS classes in the Preact components. If not, use inline styles temporarily (they'll be cleaned up by TASK_14).


Note out of scope at the end findings and tasks and write them to docs\restructure-tasks\out-of-scope-list