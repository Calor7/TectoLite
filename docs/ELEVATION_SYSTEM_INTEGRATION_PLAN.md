# Elevation System Integration Plan
## Physical Mesh-Based Topography System

**Version:** 1.0  
**Date:** February 1, 2026  
**Status:** Planning Phase

---

## Executive Summary

This document outlines the comprehensive integration plan for replacing the current visual "Paint Stroke" orogeny system with a physical "Elevation Simulation" system based on a sparse internal mesh. The new system will simulate uplift from plate overlap, transport-based erosion, and provide interactive mesh inspection/editing tools.

---

## 1. Architecture Overview

### Current System (To Be Replaced)
- **Location:** `systems/GeologicalAutomation.ts`
- **Approach:** Visual paint strokes painted along boundaries
- **Data:** `PaintStroke[]` attached to plates
- **Issues:** Non-physical, purely visual, no actual elevation data

### New System (Target)
- **Location:** `systems/ElevationSystem.ts` (new file)
- **Approach:** Physical mesh with vertex-based elevation simulation
- **Data:** `CrustVertex[]` mesh attached to plates
- **Benefits:** Physical simulation, editable, exportable, basis for future terrain features

---

## 2. Implementation Phases

### **Phase 1: Data Model Refactoring** ⚙️
**Estimated Time:** 30 minutes  
**Risk Level:** Low  
**Files Affected:** `src/types.ts`

#### Tasks:
1. **Add New Interfaces:**
   ```typescript
   export interface CrustVertex {
     id: string;
     pos: Coordinate;      // [lon, lat] in degrees
     elevation: number;     // meters above sea level
     sediment: number;      // sediment thickness (future use)
   }
   
   export type ElevationViewMode = 'off' | 'overlay' | 'absolute';
   ```

2. **Extend TectonicPlate Interface:**
   ```typescript
   export interface TectonicPlate {
     // ... existing fields ...
     crustMesh?: CrustVertex[];  // NEW: Sparse elevation mesh
   }
   ```

3. **Extend GlobalOptions:**
   ```typescript
   export interface GlobalOptions {
     // ... existing fields ...
     
     // Elevation System
     elevationViewMode?: ElevationViewMode;  // Default: 'off'
     enableElevationSimulation?: boolean;    // Default: false
     upliftRate?: number;                    // Default: 1000 m/Ma
     erosionRate?: number;                   // Default: 0.001 (transport fraction)
     meshResolution?: number;                // Default: 150 km
   }
   ```

4. **Add Mesh Edit Tool:**
   ```typescript
   export type ToolType = 'select' | 'draw' | 'feature' | 'poly_feature' | 
                          'split' | 'pan' | 'fuse' | 'link' | 'flowline' | 
                          'edit' | 'paint' | 'mesh_edit';  // NEW
   ```

5. **Remove Legacy Fields (Later Phase):**
   - Keep `orogenyMode` for now (Phase 4 cleanup)
   - Deprecate but don't remove `PaintStroke` interface yet

**Dependencies:** None  
**Testing:** Type compilation check

---

### **Phase 2: Cleanup Legacy Orogeny System** 🧹
**Estimated Time:** 45 minutes  
**Risk Level:** Medium (affects existing feature)  
**Files Affected:** 
- `src/systems/GeologicalAutomation.ts`
- `src/canvas/CanvasManager.ts`
- `src/main.ts`

#### Tasks:

1. **GeologicalAutomation.ts:**
   - Comment out `processOrogeniesPaint()` method
   - Add deprecation warning in `processOrogenies()`
   - Keep `processHotspots()` unchanged (unrelated feature)
   
   ```typescript
   private processOrogenies(state: AppState): AppState {
       // DEPRECATED: Paint-based orogeny system disabled
       // New elevation mesh system in ElevationSystem.ts
       console.warn('Paint orogeny system deprecated');
       return state;
   }
   ```

2. **CanvasManager.ts:**
   - Locate paint stroke rendering code (~line 1900-2000)
   - Wrap in conditional: `if (!state.world.globalOptions.elevationViewMode || state.world.globalOptions.elevationViewMode === 'off')`
   - Keep rendering functional for backwards compatibility

3. **main.ts UI:**
   - Add "LEGACY" label to orogeny checkbox
   - Add info tooltip: "Deprecated - Use Elevation System instead"
   - Don't remove UI yet (Phase 4)

**Dependencies:** Phase 1  
**Testing:** 
- Verify existing paint strokes still render when elevation system is off
- Verify no new paint strokes are generated during simulation

---

### **Phase 3: Implement Core Elevation System** 🏗️
**Estimated Time:** 3-4 hours  
**Risk Level:** High (new complex system)  
**Files Affected:**
- `src/systems/ElevationSystem.ts` (NEW)
- `src/SimulationEngine.ts`

#### Sub-Tasks:

#### 3A: Create ElevationSystem Class
**File:** `src/systems/ElevationSystem.ts`

```typescript
import { AppState, TectonicPlate, CrustVertex, Coordinate, Boundary } from '../types';
import { distance, latLonToVector, vectorToLatLon, rotateVector } from '../utils/sphericalMath';
import { isPointInPolygon } from '../SplitTool';

export class ElevationSystem {
    private neighborCache: Map<string, Set<string>> = new Map();
    
    constructor() {}
    
    /**
     * Initialize mesh for a plate if it doesn't exist
     */
    public initializePlateMesh(plate: TectonicPlate, resolution: number = 150): TectonicPlate {
        // Implementation in 3B
    }
    
    /**
     * Update elevation based on plate tectonics
     */
    public update(state: AppState, deltaT: number): AppState {
        // Implementation in 3C
    }
    
    /**
     * Apply uplift in collision zones
     */
    private applyUplift(state: AppState, deltaT: number): AppState {
        // Implementation in 3D
    }
    
    /**
     * Apply erosion via neighbor transport
     */
    private applyErosion(state: AppState, deltaT: number): AppState {
        // Implementation in 3E
    }
    
    /**
     * Build Delaunay neighbor graph
     */
    private buildNeighborGraph(vertices: CrustVertex[]): Map<string, Set<string>> {
        // Implementation in 3F
    }
}
```

#### 3B: Mesh Generation (Hex Grid)
**Method:** `initializePlateMesh()`

**Algorithm:**
1. Calculate plate bounding box from polygons
2. Generate hex grid points within box
3. Filter points to keep only those inside plate polygons
4. Create `CrustVertex` for each point with:
   - `id`: generated UUID
   - `pos`: [lon, lat]
   - `elevation`: 0 (sea level)
   - `sediment`: 0

**Resolution:** 
- Default: 150km spacing
- Formula: `spacing_deg = resolution_km / 111.0`
- Expected density: 150-300 vertices per Earth-sized plate

**Edge Cases:**
- Small plates (<500km²): Minimum 10 vertices
- Large plates: Cap at 500 vertices for performance
- Irregular shapes: Use polygon containment test

#### 3C: Main Update Loop
**Method:** `update()`

```typescript
public update(state: AppState, deltaT: number): AppState {
    if (!state.world.globalOptions.enableElevationSimulation) {
        return state;
    }
    
    let newState = { ...state };
    
    // Step 1: Initialize meshes for plates without them
    newState.world.plates = newState.world.plates.map(plate => {
        if (!plate.crustMesh || plate.crustMesh.length === 0) {
            const resolution = state.world.globalOptions.meshResolution || 150;
            return this.initializePlateMesh(plate, resolution);
        }
        return plate;
    });
    
    // Step 2: Apply uplift at boundaries
    newState = this.applyUplift(newState, deltaT);
    
    // Step 3: Apply erosion
    newState = this.applyErosion(newState, deltaT);
    
    // Step 4: Apply global decay
    newState.world.plates = newState.world.plates.map(plate => ({
        ...plate,
        crustMesh: plate.crustMesh?.map(v => ({
            ...v,
            elevation: v.elevation * 0.999  // 0.1% decay per Ma
        }))
    }));
    
    return newState;
}
```

#### 3D: Uplift Implementation
**Method:** `applyUplift()`

**Algorithm:**
1. Get convergent boundaries from `state.world.boundaries`
2. For each boundary:
   - Extract overlap polygons
   - Find all vertices from both plates inside overlap
   - Apply uplift: `elevation += upliftRate * deltaT * collisionIntensity`
3. **Collision Intensity:** Based on relative velocity and angle
   - Normal collision (angle < 30°): 100% uplift
   - Oblique (30-60°): 50% uplift
   - Transform (>60°): 0% uplift

**Parameters:**
- `upliftRate`: Default 1000 m/Ma (1 km per million years)
- `deltaT`: Time step in Ma (typically 0.001 - 1.0)

#### 3E: Erosion Implementation
**Method:** `applyErosion()`

**Algorithm - Transport Model:**
1. Build neighbor graph (Delaunay triangulation)
2. For each vertex:
   - Find neighbors via graph
   - Calculate elevation difference to each neighbor
   - Transport fraction of elevation to lower neighbors
   - Formula: `transfer = (elevDiff * erosionRate * deltaT) / numLowerNeighbors`
3. Apply transfers (two-pass to avoid order dependency)

**Parameters:**
- `erosionRate`: Default 0.001 (0.1% of difference per Ma)
- Stability: Use small timesteps or smooth transfer

#### 3F: Neighbor Graph (Delaunay)
**Method:** `buildNeighborGraph()`

**Implementation:**
```typescript
import { Delaunay } from 'd3-delaunay';

private buildNeighborGraph(vertices: CrustVertex[]): Map<string, Set<string>> {
    // Project to flat space for Delaunay
    const points: [number, number][] = vertices.map(v => [v.pos[0], v.pos[1]]);
    
    // Build Delaunay triangulation
    const delaunay = Delaunay.from(points);
    const neighbors = new Map<string, Set<string>>();
    
    // Initialize
    vertices.forEach(v => neighbors.set(v.id, new Set()));
    
    // Extract edges from triangles
    for (let i = 0; i < delaunay.triangles.length; i += 3) {
        const v0 = vertices[delaunay.triangles[i]];
        const v1 = vertices[delaunay.triangles[i + 1]];
        const v2 = vertices[delaunay.triangles[i + 2]];
        
        neighbors.get(v0.id)!.add(v1.id);
        neighbors.get(v0.id)!.add(v2.id);
        neighbors.get(v1.id)!.add(v0.id);
        neighbors.get(v1.id)!.add(v2.id);
        neighbors.get(v2.id)!.add(v0.id);
        neighbors.get(v2.id)!.add(v1.id);
    }
    
    return neighbors;
}
```

**Caching:** Cache per plate, invalidate on mesh changes

#### 3G: Integration with SimulationEngine
**File:** `src/SimulationEngine.ts`

```typescript
import { ElevationSystem } from './systems/ElevationSystem';

class SimulationEngine {
    private elevationSystem: ElevationSystem;
    
    constructor(...) {
        this.elevationSystem = new ElevationSystem();
    }
    
    public tick(): void {
        // ... existing code ...
        
        // Update elevation system (after GeologicalAutomation)
        if (this.getCurrentState().world.globalOptions.enableElevationSimulation) {
            const deltaT = this.getCurrentState().world.timeScale; // Ma
            this.state = this.elevationSystem.update(this.state, deltaT);
        }
    }
}
```

**Dependencies:** Phase 1, Phase 2  
**Testing:**
- Unit test: Mesh generation for simple square plate
- Unit test: Uplift calculation
- Unit test: Erosion transfer logic
- Integration test: Run simulation, verify elevation changes

---

### **Phase 4: Visualization** 🎨
**Estimated Time:** 2-3 hours  
**Risk Level:** Medium  
**Files Affected:** `src/canvas/CanvasManager.ts`

#### Tasks:

#### 4A: Mesh Rendering Setup
**Location:** `CanvasManager.ts` - Add to `render()` method

```typescript
private renderElevationMesh(state: AppState): void {
    const mode = state.world.globalOptions.elevationViewMode;
    if (!mode || mode === 'off') return;
    
    for (const plate of state.world.plates) {
        if (!plate.crustMesh || plate.crustMesh.length === 0) continue;
        if (!plate.visible) continue;
        
        this.renderPlateMesh(plate, mode);
    }
}

private renderPlateMesh(plate: TectonicPlate, mode: ElevationViewMode): void {
    // Implementation in 4B
}
```

#### 4B: Delaunay Triangle Rendering

**Algorithm:**
1. Get all vertices for plate
2. Project to screen coordinates
3. Build Delaunay triangulation
4. For each triangle:
   - Calculate average elevation
   - Map elevation to color
   - Fill triangle with color
   - Optional: Draw edges for wireframe view

**Color Scale:**
```typescript
private elevationToColor(elevation: number): string {
    if (elevation < 0) {
        // Ocean: Dark blue -> Light blue
        const depth = Math.abs(elevation);
        const intensity = Math.max(0, 1 - depth / 4000);
        const blue = Math.floor(100 + intensity * 155);
        return `rgb(0, 50, ${blue})`;
    } else if (elevation < 1000) {
        // Land: Green -> Yellow
        const t = elevation / 1000;
        const r = Math.floor(34 + t * 186);  // 34 -> 220
        const g = Math.floor(139 + t * 61);  // 139 -> 200
        return `rgb(${r}, ${g}, 34)`;
    } else if (elevation < 3000) {
        // Hills: Brown
        const t = (elevation - 1000) / 2000;
        const r = Math.floor(139 + t * 50);  // Brown -> Grey
        const g = Math.floor(90 + t * 50);
        const b = Math.floor(43 + t * 87);
        return `rgb(${r}, ${g}, ${b})`;
    } else if (elevation < 5000) {
        // Mountains: Grey
        const t = (elevation - 3000) / 2000;
        const intensity = Math.floor(130 + t * 70);
        return `rgb(${intensity}, ${intensity}, ${intensity})`;
    } else {
        // Peaks: White
        return '#ffffff';
    }
}
```

#### 4C: View Mode Handling

**Overlay Mode:**
- Render with alpha = 0.7
- Draw AFTER plate polygons but BEFORE features
- Blend with plate color

**Absolute Mode:**
- Render with alpha = 1.0
- Replace plate polygon rendering entirely
- Draw at same z-index as plates

**Implementation:**
```typescript
// In main render loop
if (state.world.globalOptions.elevationViewMode === 'absolute') {
    // Skip normal plate fill, only draw borders
    this.renderPlateBorders(plate);
} else {
    this.renderPlatePolygons(plate);
}

// Then render mesh
this.renderElevationMesh(state);
```

#### 4D: Performance Optimization

**Strategies:**
1. **Mesh Caching:** Cache Delaunay triangulation per plate
2. **Viewport Culling:** Only render visible plates
3. **LOD (Optional):** Reduce vertex density for distant plates
4. **Batch Rendering:** Use Path2D for multiple triangles

**Expected Performance:**
- 10 plates × 200 vertices = 2000 vertices
- ~6000 triangles total
- Target: 60 FPS at 2K resolution

**Dependencies:** Phase 3  
**Testing:**
- Visual test: Verify color scale
- Visual test: Overlay vs absolute modes
- Performance test: 10 plates with active simulation

---

### **Phase 5: Mesh Interaction & Editing** 🖱️
**Estimated Time:** 2-3 hours  
**Risk Level:** Medium  
**Files Affected:**
- `src/canvas/CanvasManager.ts`
- `src/main.ts`

#### Tasks:

#### 5A: Hit Testing
**Location:** `CanvasManager.ts` - `handleMouseDown()`

```typescript
private handleMeshEditClick(screenPos: Point): void {
    const state = this.getState();
    const geoPos = this.projectionManager.invert(screenPos);
    if (!geoPos) return;
    
    let closestVertex: CrustVertex | null = null;
    let closestPlateId: string | null = null;
    let minDistance = Infinity;
    
    // Find nearest vertex across all plates
    for (const plate of state.world.plates) {
        if (!plate.visible || !plate.crustMesh) continue;
        
        for (const vertex of plate.crustMesh) {
            const dist = distance(geoPos, vertex.pos);
            const screenDist = this.geoDistanceToScreen(dist);
            
            if (screenDist < 20 && dist < minDistance) { // 20px threshold
                minDistance = dist;
                closestVertex = vertex;
                closestPlateId = plate.id;
            }
        }
    }
    
    if (closestVertex && closestPlateId) {
        this.selectVertex(closestPlateId, closestVertex.id);
    }
}

private geoDistanceToScreen(geoDistance: number): number {
    // Approximate conversion based on current zoom
    const scale = this.projectionManager.getProjection().scale();
    return geoDistance * scale;
}
```

#### 5B: Selection State
**Location:** `src/types.ts` - Add to `WorldState`

```typescript
export interface WorldState {
    // ... existing fields ...
    selectedVertexPlateId?: string | null;
    selectedVertexId?: string | null;
}
```

#### 5C: Visual Highlight
**Location:** `CanvasManager.ts` - Add to render loop

```typescript
private renderSelectedVertex(state: AppState): void {
    if (!state.world.selectedVertexPlateId || !state.world.selectedVertexId) return;
    
    const plate = state.world.plates.find(p => p.id === state.world.selectedVertexPlateId);
    if (!plate || !plate.crustMesh) return;
    
    const vertex = plate.crustMesh.find(v => v.id === state.world.selectedVertexId);
    if (!vertex) return;
    
    const screenPos = this.projectionManager.project(vertex.pos);
    if (!screenPos) return;
    
    // Draw bright cyan highlight
    this.ctx.save();
    this.ctx.fillStyle = '#00ffff';
    this.ctx.strokeStyle = '#ffffff';
    this.ctx.lineWidth = 3;
    this.ctx.beginPath();
    this.ctx.arc(screenPos.x, screenPos.y, 8, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.stroke();
    this.ctx.restore();
}
```

#### 5D: Vertex Inspector UI
**Location:** `main.ts` - Add to sidebar

```typescript
// In getHTML() method, after feature inspector:
private getVertexInspectorHTML(): string {
    if (!this.state.world.selectedVertexId) return '';
    
    const plate = this.state.world.plates.find(
        p => p.id === this.state.world.selectedVertexPlateId
    );
    if (!plate || !plate.crustMesh) return '';
    
    const vertex = plate.crustMesh.find(v => v.id === this.state.world.selectedVertexId);
    if (!vertex) return '';
    
    return `
        <div class="inspector-section">
            <h3>🗻 Vertex Inspector</h3>
            <div class="inspector-row">
                <label>Position:</label>
                <span>${vertex.pos[0].toFixed(2)}°, ${vertex.pos[1].toFixed(2)}°</span>
            </div>
            <div class="inspector-row">
                <label>Elevation (m):</label>
                <input 
                    type="number" 
                    id="vertex-elevation-input" 
                    value="${Math.round(vertex.elevation)}"
                    step="100"
                />
            </div>
            <div class="inspector-row">
                <label>Sediment:</label>
                <span>${vertex.sediment.toFixed(1)} m</span>
            </div>
            <button id="btn-deselect-vertex" class="btn btn-secondary">Deselect</button>
        </div>
    `;
}
```

#### 5E: Edit Handlers
**Location:** `main.ts` - Add event listeners

```typescript
private setupVertexEditHandlers(): void {
    const elevationInput = document.getElementById('vertex-elevation-input') as HTMLInputElement;
    if (elevationInput) {
        elevationInput.addEventListener('change', () => {
            this.handleVertexElevationChange(parseFloat(elevationInput.value));
        });
    }
    
    const deselectBtn = document.getElementById('btn-deselect-vertex');
    if (deselectBtn) {
        deselectBtn.addEventListener('click', () => {
            this.state.world.selectedVertexId = null;
            this.state.world.selectedVertexPlateId = null;
            this.updateUI();
        });
    }
}

private handleVertexElevationChange(newElevation: number): void {
    if (!this.state.world.selectedVertexId || !this.state.world.selectedVertexPlateId) return;
    
    const plateIndex = this.state.world.plates.findIndex(
        p => p.id === this.state.world.selectedVertexPlateId
    );
    if (plateIndex === -1) return;
    
    const plate = this.state.world.plates[plateIndex];
    if (!plate.crustMesh) return;
    
    const vertexIndex = plate.crustMesh.findIndex(
        v => v.id === this.state.world.selectedVertexId
    );
    if (vertexIndex === -1) return;
    
    // Update vertex
    const newPlates = [...this.state.world.plates];
    const newMesh = [...plate.crustMesh];
    newMesh[vertexIndex] = {
        ...newMesh[vertexIndex],
        elevation: newElevation
    };
    newPlates[plateIndex] = {
        ...plate,
        crustMesh: newMesh
    };
    
    this.state.world.plates = newPlates;
    this.historyManager.saveState(this.state);
    this.updateUI();
}
```

#### 5F: Tool Button UI
**Location:** `main.ts` - Add to toolbar

```typescript
<button 
    id="btn-tool-mesh-edit" 
    class="btn ${this.state.activeTool === 'mesh_edit' ? 'btn-primary' : 'btn-secondary'}" 
    title="Mesh Edit Tool (M)"
>
    <span style="font-size: 18px;">⛰️</span>
</button>
```

**Keyboard Shortcut:** 'M' key

**Dependencies:** Phase 3, Phase 4  
**Testing:**
- Test: Click to select vertex
- Test: Edit elevation and verify visual update
- Test: Deselect vertex
- Test: Selection persists across tool changes

---

### **Phase 6: UI Integration & Polish** ✨
**Estimated Time:** 1-2 hours  
**Risk Level:** Low  
**Files Affected:** `src/main.ts`

#### Tasks:

#### 6A: Settings Panel
**Location:** Settings or Automation menu

```typescript
<div class="menu-section">
    <h3>⛰️ Elevation System</h3>
    <label>
        <input type="checkbox" id="check-enable-elevation" 
               ${this.state.world.globalOptions.enableElevationSimulation ? 'checked' : ''}>
        Enable Physical Elevation
    </label>
    
    <div id="elevation-settings" style="margin-left: 20px; ${...}">
        <label>
            View Mode:
            <select id="elevation-view-mode">
                <option value="off">Off</option>
                <option value="overlay">Overlay</option>
                <option value="absolute">Absolute</option>
            </select>
        </label>
        
        <label>
            Mesh Resolution:
            <input type="range" id="elevation-resolution" 
                   min="50" max="300" step="25" value="150">
            <span id="lbl-resolution">150</span> km
        </label>
        
        <label>
            Uplift Rate:
            <input type="number" id="elevation-uplift" 
                   value="1000" step="100"> m/Ma
        </label>
        
        <label>
            Erosion Rate:
            <input type="number" id="elevation-erosion" 
                   value="0.001" step="0.0001">
        </label>
    </div>
</div>
```

#### 6B: Event Listeners

```typescript
private setupElevationHandlers(): void {
    const enableCheck = document.getElementById('check-enable-elevation') as HTMLInputElement;
    if (enableCheck) {
        enableCheck.addEventListener('change', () => {
            this.state.world.globalOptions.enableElevationSimulation = enableCheck.checked;
            this.updateUI();
        });
    }
    
    const viewModeSelect = document.getElementById('elevation-view-mode') as HTMLSelectElement;
    if (viewModeSelect) {
        viewModeSelect.addEventListener('change', () => {
            this.state.world.globalOptions.elevationViewMode = 
                viewModeSelect.value as ElevationViewMode;
            this.updateUI();
        });
    }
    
    // Similar for other inputs...
}
```

#### 6C: Status Messages

Add helpful status messages:
- "Initializing elevation mesh..."
- "Elevation system active - X vertices simulated"
- "Click a vertex to inspect/edit"

#### 6D: Documentation Tooltips

Add info icons with explanations:
- **Overlay Mode:** "Renders elevation as transparent layer over plates"
- **Absolute Mode:** "Replaces plate colors with pure topographic map"
- **Mesh Resolution:** "Lower = faster, Higher = more detail"
- **Uplift Rate:** "How fast mountains grow in collision zones (m per Ma)"
- **Erosion Rate:** "How quickly elevation smooths out (0-1)"

**Dependencies:** All previous phases  
**Testing:**
- Test all UI controls
- Verify settings persistence
- Test tooltips display

---

### **Phase 7: Cleanup & Deprecation** 🗑️
**Estimated Time:** 30 minutes  
**Risk Level:** Low  
**Files Affected:** `src/types.ts`, `src/main.ts`

#### Tasks:

1. **Remove Legacy Fields:**
   - Delete `orogenyMode` from `GlobalOptions`
   - Mark `PaintStroke` interface as deprecated (keep for file compatibility)
   - Remove orogeny UI controls from main.ts

2. **Update Default State:**
   ```typescript
   globalOptions: {
       // ... existing ...
       elevationViewMode: 'off',
       enableElevationSimulation: false,
       upliftRate: 1000,
       erosionRate: 0.001,
       meshResolution: 150,
   }
   ```

3. **File Format Migration:**
   - Add version field to save format
   - Auto-convert old paint-based files to mesh-based on load (Phase 8)

**Dependencies:** All previous phases  
**Testing:**
- Load old save files
- Verify no runtime errors
- Verify UI shows no legacy options

---

## 3. Testing Strategy

### Unit Tests
1. **Mesh Generation:**
   - Test hex grid spacing
   - Test polygon filtering
   - Test edge cases (small/large plates)

2. **Physics:**
   - Test uplift calculation
   - Test erosion transfer
   - Test neighbor graph building

3. **Utilities:**
   - Test elevation-to-color mapping
   - Test screen-to-geo distance conversion

### Integration Tests
1. **Full Simulation:**
   - Create 2 plates
   - Set collision course
   - Run 10 Ma
   - Verify mountains form

2. **Editing:**
   - Select vertex
   - Edit elevation
   - Verify persistence

3. **Visualization:**
   - Toggle view modes
   - Verify rendering performance
   - Test projection changes

### User Acceptance Tests
1. **Test 1 - Mountain Formation:**
   - Create 2 continental plates
   - Move them toward collision
   - Wait for mountain range to form
   - Verify: Green lowlands -> Brown hills -> White peaks

2. **Test 2 - Manual Sculpting:**
   - Switch to mesh_edit tool
   - Click ocean vertex
   - Set elevation to 8000m
   - Verify: Instant white peak appears

3. **Test 3 - Erosion:**
   - Create isolated peak
   - Run simulation for 50 Ma
   - Verify: Peak slowly erodes and spreads

---

## 4. Risk Assessment

### High Risk Items
1. **Performance:** 
   - **Risk:** Mesh rendering slows down with many plates
   - **Mitigation:** Implement viewport culling, optimize Delaunay
   - **Fallback:** Reduce default resolution to 200km

2. **Boundary Detection:**
   - **Risk:** Complex plate interactions cause incorrect uplift zones
   - **Mitigation:** Use existing boundary system, add validation
   - **Fallback:** Allow manual uplift painting

### Medium Risk Items
1. **Mesh-Plate Sync:**
   - **Risk:** Mesh vertices don't follow plate rotation correctly
   - **Mitigation:** Store vertices in plate local space, transform on render
   - **Fallback:** Regenerate mesh periodically

2. **File Compatibility:**
   - **Risk:** Old save files don't load correctly
   - **Mitigation:** Add migration logic
   - **Fallback:** Show import warning, skip elevation data

### Low Risk Items
1. **UI Complexity:**
   - **Risk:** Too many settings confuse users
   - **Mitigation:** Use presets, hide advanced settings
   - **Fallback:** Remove non-essential options

---

## 5. Dependencies & Prerequisites

### External Libraries
- **d3-delaunay:** Already included via d3-geo
- **d3-geo:** Already in use ✅

### Code Dependencies
- `utils/sphericalMath.ts`: distance(), rotateVector() ✅
- `SplitTool.ts`: isPointInPolygon() ✅
- `BoundarySystem`: boundary detection ✅

### Knowledge Requirements
- Understanding of Delaunay triangulation
- Basic understanding of erosion models
- Canvas 2D rendering optimization

---

## 6. Timeline Estimate

| Phase | Tasks | Time | Cumulative |
|-------|-------|------|------------|
| 1     | Data Model | 0.5h | 0.5h |
| 2     | Cleanup | 0.75h | 1.25h |
| 3     | Core System | 4h | 5.25h |
| 4     | Visualization | 2.5h | 7.75h |
| 5     | Interaction | 2.5h | 10.25h |
| 6     | UI Polish | 1.5h | 11.75h |
| 7     | Cleanup | 0.5h | 12.25h |
| **Testing** | All phases | 2h | **14.25h** |

**Total Estimated Time:** 14-16 hours  
**Recommended Schedule:** 2-3 days of focused work

---

## 7. Success Criteria

### Minimum Viable Product (MVP)
- ✅ Plates have sparse elevation mesh
- ✅ Collision zones show uplift
- ✅ Erosion smooths terrain over time
- ✅ Can visualize in overlay mode
- ✅ Can select and edit vertices
- ✅ No major performance degradation

### Stretch Goals
- 🎯 Export heightmap as GeoTIFF
- 🎯 Implement sediment transport
- 🎯 Add visualization presets (topo, satellite, etc.)
- 🎯 LOD system for distant plates
- 🎯 GPU acceleration via WebGL

---

## 8. Rollback Plan

If critical issues arise:

1. **Immediate Rollback:**
   - Set `enableElevationSimulation: false` by default
   - Hide UI controls
   - Keep legacy paint system active

2. **Partial Rollback:**
   - Keep visualization but disable physics simulation
   - Allow manual editing only
   - Disable auto-mesh generation

3. **Full Rollback:**
   - Remove mesh rendering from CanvasManager
   - Comment out ElevationSystem integration
   - Restore orogeny paint system
   - Keep type definitions for future retry

---

## 9. Future Enhancements

After successful integration:

1. **Advanced Erosion:**
   - Fluvial erosion (river systems)
   - Glacial erosion
   - Climate-based weathering

2. **Sediment System:**
   - Track sediment transport
   - Deposit in basins
   - Form sedimentary basins

3. **Realistic Crust:**
   - Differentiate continental vs oceanic crust density
   - Implement isostatic rebound
   - Model lithosphere flexure

4. **Export Options:**
   - GeoTIFF heightmap export
   - STL export for 3D printing
   - Integration with external GIS tools

---

## 10. Open Questions & Decisions Needed

### Design Decisions:
1. **Q:** Should mesh vertices move with plate rotation?
   - **A:** Yes - Store in plate-local coordinates, transform on render

2. **Q:** What happens to mesh during plate split?
   - **A:** Distribute vertices to child plates based on containment

3. **Q:** Should erosion be time-based or continuous?
   - **A:** Time-based (runs each simulation tick with deltaT)

4. **Q:** Default elevation view mode?
   - **A:** 'off' initially, encourage users to enable

### Technical Decisions:
1. **Q:** Use Delaunay or regular grid for rendering?
   - **A:** Delaunay - More flexible for irregular spacing

2. **Q:** Cache triangulation per frame or per mesh change?
   - **A:** Per mesh change - More efficient

3. **Q:** Store mesh in global coords or plate-local?
   - **A:** Global coords - Simpler collision detection

---

## Appendix A: File Change Summary

| File | Change Type | Description |
|------|-------------|-------------|
| `types.ts` | Modify | Add CrustVertex, ElevationViewMode, mesh_edit tool |
| `GeologicalAutomation.ts` | Deprecate | Comment out paint orogeny logic |
| `CanvasManager.ts` | Extend | Add mesh rendering methods |
| `SimulationEngine.ts` | Extend | Integrate ElevationSystem |
| `main.ts` | Extend | Add UI controls, vertex inspector |
| `systems/ElevationSystem.ts` | Create | New file - core simulation logic |

**Total Files Modified:** 5  
**Total Files Created:** 1  
**Total Lines Added:** ~1200  
**Total Lines Removed:** ~50 (comments/deprecations)

---

## Appendix B: Performance Targets

| Metric | Target | Critical Threshold |
|--------|--------|-------------------|
| Mesh Generation | < 100ms per plate | < 500ms |
| Simulation Tick (10 plates) | < 16ms (60 FPS) | < 33ms (30 FPS) |
| Rendering (2000 vertices) | < 16ms (60 FPS) | < 33ms (30 FPS) |
| Memory Usage | < 50MB additional | < 200MB |
| Initial Load Time | < 500ms | < 2s |

---

## Appendix C: Glossary

- **CrustVertex:** Single point in elevation mesh with position and elevation data
- **Delaunay Triangulation:** Method to connect scattered points into triangles
- **Uplift:** Vertical elevation gain from tectonic forces
- **Transport Erosion:** Material movement from high to low elevation
- **Mesh Resolution:** Average spacing between mesh vertices (km)
- **View Mode:** How elevation is visually rendered (off/overlay/absolute)
- **Hit Testing:** Detecting which mesh vertex user clicked on

---

**Document End**

*This plan is a living document and should be updated as implementation progresses.*
