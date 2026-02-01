// Main Application - TectoLite Plate Tectonics Simulator
import './style.css';
import {
    AppState,
    TectonicPlate,
    Feature,
    Polygon,
    ToolType,
    FeatureType,
    InteractionMode,
    generateId,
    createDefaultMotion,
    createDefaultAppState,
    getNextPlateColor,
    Coordinate,
    ProjectionType,
    MotionKeyframe,
    MantlePlume,
    Landmass,
    LayerMode
} from './types';
import { CanvasManager } from './canvas/CanvasManager';
import { SimulationEngine } from './SimulationEngine';
import { exportToPNG, showPNGExportDialog } from './export';
import { splitPlate } from './SplitTool';
import { fusePlates } from './FusionTool';
import { vectorToLatLon, latLonToVector, rotateVector, Vector3 } from './utils/sphericalMath';
import { toGeoJSON } from './utils/geoHelpers';
import { HistoryManager } from './HistoryManager';
import { exportToJSON, parseImportFile, showImportDialog, showUnifiedExportDialog } from './export';
import { HeightmapGenerator } from './systems/HeightmapGenerator';
import { GeoPackageExporter } from './GeoPackageExporter';
import { TimelineSystem } from './systems/TimelineSystem';
import { geoArea } from 'd3-geo';
import { toDisplayTime, toInternalTime, parseTimeInput } from './utils/TimeTransformationUtils';

class TectoLiteApp {
    private state: AppState;
    private canvasManager: CanvasManager | null = null;
    private simulation: SimulationEngine | null = null;
    private historyManager: HistoryManager = new HistoryManager();
    private activeToolText: string = "INFO LOADING...";
    private fusionFirstPlateId: string | null = null; // Track first plate for fusion
    private activeLinkSourceId: string | null = null; // Track first plate for linking
    private momentumClipboard: { eulerPole: { position?: Coordinate; rate?: number } } | null = null; // Clipboard for momentum
    private timelineSystem: TimelineSystem | null = null;

    // UI State for Explorer Sidebar
    private explorerState: { 
        sections: { [key: string]: boolean }, 
        paintGroups: { [key: string]: boolean } 
    } = { 
        sections: { plates: true, events: false, paint: false }, 
        paintGroups: {} 
    };

    constructor() {
        this.state = createDefaultAppState();
        this.init();
    }

    private init(): void {
        document.querySelector<HTMLDivElement>('#app')!.innerHTML = this.getHTML();
        this.setupResizers();

        // Initialize canvas
        const canvas = document.getElementById('main-canvas') as HTMLCanvasElement;
        this.canvasManager = new CanvasManager(
            canvas,
            () => this.state,
            (updater) => {
                this.state = updater(this.state);
                this.updateUI(); // Centralized UI update
            },
            (points) => this.handleDrawComplete(points),
            (pos, type) => this.handleFeaturePlace(pos, type),
            (plateId, featureId, featureIds, plumeId, paintStrokeId, landmassId) => this.handleSelect(plateId, featureId, featureIds, plumeId, paintStrokeId, landmassId),
            (points) => this.handleSplitApply(points),
            (active) => this.handleSplitPreviewChange(active),
            (plateId, pole, rate) => this.handleMotionChange(plateId, pole, rate),
            (plateId, axis, angleRad) => this.handleDragTargetRequest(plateId, axis, angleRad),
            undefined,
            (active) => {
                const el = document.getElementById('motion-controls');
                if (el) el.style.display = active ? 'block' : 'none';
            },
            (count) => this.handleDrawUpdate(count),
            (rate) => {
                 const speedCmInput = document.getElementById('speed-input-cm') as HTMLInputElement;
                 const speedDegInput = document.getElementById('speed-input-deg') as HTMLInputElement;
                 if (speedDegInput) speedDegInput.value = rate.toFixed(2);
                 if (speedCmInput) speedCmInput.value = this.convertDegMaToCmYr(rate).toFixed(2);
            },
            (active) => {
                const el = document.getElementById('edit-controls');
                if (el) el.style.display = active ? 'block' : 'none';
            }
        );

        // Initialize simulation
        this.simulation = new SimulationEngine(
            () => this.state,
            (updater) => {
                this.state = updater(this.state);
                this.updateTimeDisplay();
                // Don't full re-render UI every tick, just canvas
            }
        );

        // Initialize Timeline System
        this.timelineSystem = new TimelineSystem(
            'timeline-panel',
            this.simulation!,
            this.historyManager,
            this
        );
        this.timelineSystem.setContainer(document.getElementById('timeline-panel')!);

        this.setupEventListeners();
        this.canvasManager.startRenderLoop();
        this.updateUI();
    }


    private setupResizers(): void {
        this.setupResizer('resizer-left', 'toolbar', 'width', false);
        this.setupResizer('resizer-left-inner', 'plate-sidebar', 'width', false);
        this.setupResizer('resizer-right', 'right-sidebar', 'width', true); // Inverse for right sidebar
        this.setupResizer('resizer-bottom', 'timeline-bar', 'height', true); // Inverse for bottom
    }

    private setupResizer(resizerId: string, targetId: string, dimension: 'width' | 'height', inverse: boolean): void {
        const resizer = document.getElementById(resizerId);
        const target = document.getElementById(targetId);
        if (!resizer || !target) return;

        let startVal = 0;
        let startDim = 0;

        const onMouseMove = (e: MouseEvent) => {
            let newVal;
            if (dimension === 'width') {
                const diff = inverse ? (startVal - e.clientX) : (e.clientX - startVal);
                newVal = startDim + diff;
            } else {
                const diff = inverse ? (startVal - e.clientY) : (e.clientY - startVal);
                newVal = startDim + diff;
            }
            
            // Constrain minimums
            const minSize = 50;
            if (newVal < minSize) newVal = minSize; // Allow user to make it smaller than CSS min-width if they really want, or respect it
            
            target.style[dimension] = `${newVal}px`;
            
            // If resizing changes canvas container size, we must resize canvas
            this.canvasManager?.resizeCanvas();
        };

        const onMouseUp = () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            document.body.style.cursor = '';
            // Final resize to ensure sharpness
            this.canvasManager?.resizeCanvas();
        };

        resizer.addEventListener('mousedown', (e) => {
            e.preventDefault(); // Prevent text selection
            if (dimension === 'width') {
                startVal = e.clientX;
                startDim = target.getBoundingClientRect().width;
                document.body.style.cursor = 'col-resize';
            } else {
                startVal = e.clientY;
                startDim = target.getBoundingClientRect().height;
                document.body.style.cursor = 'row-resize';
            }
            
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });
    }

    private getHTML(): string {
        return `
      <div class="app-container">
        <header class="app-header">
          <h1 class="app-title">
            TECTOLITE <span class="app-subtitle">by <a href="https://www.refracturedgames.com" target="_blank" rel="noopener noreferrer">RefracturedGames</a></span>
            <span style="margin-left: 20px; font-size: 0.7em; display: inline-flex; gap: 15px; align-items: center;">
                <a href="https://ko-fi.com/refracturedgames" target="_blank" rel="noopener noreferrer" style="color: var(--text-secondary); text-decoration: none;"><span class="coffee-icon">☕</span> Feed my coffee addiction</a>
                <a href="https://refracturedgames.eo.page/zcyvj" target="_blank" rel="noopener noreferrer" id="link-subscribe" style="color: var(--accent-primary); text-decoration: none; font-weight: 600;">Subscribe to Updates</a>
            </span>
          </h1>
          <div class="header-actions">
            <!-- Projection Selector Moved to Sidebar -->
            
            <!-- Retro Status Info Box -->
            <div id="retro-status-box" class="retro-status-box" style="display: none;">
                <span id="retro-status-text">INFO LOADING...</span>
            </div>

            <!-- View Dropdown -->
            <div class="view-dropdown-container">
                <button id="btn-view-panels" class="btn btn-secondary" title="View Options">
                    <span class="icon">👁️</span> View
                </button>
                <div id="view-dropdown-menu" class="view-dropdown-menu" style="min-width: 250px;">
                    <!-- 1. BAR SETTING (Panels) -->
                    <div class="dropdown-section">
                        <div class="dropdown-header">Bars</div>
                        <label class="view-dropdown-item">
                            <input type="checkbox" id="check-view-tools" checked> Tools
                        </label>
                        <label class="view-dropdown-item">
                            <input type="checkbox" id="check-view-plates" checked> Plates
                        </label>
                        <label class="view-dropdown-item">
                            <input type="checkbox" id="check-view-props" checked> Properties
                        </label>
                        <label class="view-dropdown-item">
                            <input type="checkbox" id="check-view-timeline" checked> Timeline
                        </label>
                    </div>

                    <!-- 2. PROJECTION SETTING -->
                    <div class="dropdown-section" style="border-top: 1px solid var(--border-default); margin-top: 4px; padding-top: 4px;">
                        <div class="dropdown-header">Projection <span class="info-icon" data-tooltip="Choose map projection">(i)</span></div>
                        <div style="padding: 4px 8px;">
                            <select id="projection-select" class="tool-select" style="width:100%;">
                                <option value="orthographic">Globe (Orthographic)</option>
                                <option value="equirectangular">Equirectangular</option>
                                <option value="mercator">Mercator</option>
                                <option value="mollweide">Mollweide</option>
                                <option value="robinson">Robinson</option>
                            </select>
                        </div>
                    </div>

                    <!-- 3. IMAGE OVERLAY -->
                    <div class="dropdown-section" style="border-top: 1px solid var(--border-default); margin-top: 4px; padding-top: 4px;">
                        <div class="dropdown-header">Reference Overlay</div>
                        <label class="view-dropdown-item">
                            <input type="checkbox" id="check-show-overlay"> Show Overlay <span class="info-icon" data-tooltip="Show uploaded reference map for tracing">(i)</span>
                        </label>
                        <div style="padding: 2px 8px 4px 28px; display: flex; flex-direction: column; gap: 4px;">
                            <button id="btn-upload-overlay" class="btn btn-secondary" style="font-size: 11px; padding: 4px 8px;">
                                &#x1F4BE; Upload Map
                            </button>
                            <div style="display: flex; align-items: center; gap: 4px;">
                                <label style="font-size: 10px; color: var(--text-secondary); white-space: nowrap;">Opacity:</label>
                                <input type="range" id="overlay-opacity-slider" min="0" max="100" value="50" style="flex: 1; height: 4px;">
                                <span id="overlay-opacity-value" style="font-size: 10px; color: var(--text-secondary); min-width: 30px;">50%</span>
                            </div>
                            <button id="btn-clear-overlay" class="btn btn-secondary" style="font-size: 11px; padding: 4px 8px;">
                                &#x2717; Clear
                            </button>
                        </div>
                    </div>

                    <!-- 4. EFFECTS SETTING -->
                    <div class="dropdown-section" style="border-top: 1px solid var(--border-default); margin-top: 4px; padding-top: 4px;">
                        <div class="dropdown-header">Effects</div>
                        <label class="view-dropdown-item">
                            <input type="checkbox" id="check-grid" checked> Show Grid <span class="info-icon" data-tooltip="Toggle the latitude/longitude grid">(i)</span>
                        </label>
                         <div style="padding: 2px 8px 4px 28px;">
                             <select id="grid-thickness-select" class="tool-select" style="width: 100%; font-size: 11px; padding: 2px;">
                                <option value="0.5">Thin (0.5px)</option>
                                <option value="1.0" selected>Medium (1.0px)</option>
                                <option value="2.0">Thick (2.0px)</option>
                            </select>
                        </div>

                        <label class="view-dropdown-item">
                            <input type="checkbox" id="check-features" checked> Show Features <span class="info-icon" data-tooltip="Show mountains, volcanoes, etc.">(i)</span>
                        </label>
                        <!-- Boundary Visualization moved to Automation menu -->
                        <label class="view-dropdown-item">
                            <input type="checkbox" id="check-euler-poles"> Show Euler Poles <span class="info-icon" data-tooltip="Show all rotation axes (Euler poles)">(i)</span>
                        </label>
                        <label class="view-dropdown-item">
                             <input type="checkbox" id="check-future-features"> Show Future/Past <span class="info-icon" data-tooltip="Show features not yet born">(i)</span>
                        </label>
                        <label class="view-dropdown-item">
                             <input type="checkbox" id="check-show-paint"> Show Paint <span class="info-icon" data-tooltip="Show brush strokes on plates">(i)</span>
                        </label>
                        
                        <div style="padding: 4px 8px; border-top: 1px dotted var(--border-default); margin-top: 4px;">
                             <label style="font-size: 11px; white-space: nowrap; font-weight: 600;">Erosion Rate <span class="info-icon" data-tooltip="Global multiplier for paint fading/deletion (1.0 = Normal, 2.0 = 2x Fading Speed)">(i)</span></label>
                             <div style="display: flex; align-items: center; gap: 4px;">
                                 <input type="number" id="erosion-multiplier" class="property-input" value="1.0" min="0.1" step="0.1" style="flex: 1;">
                                 <button id="btn-reset-erosion" class="btn btn-secondary" style="font-size: 10px; padding: 2px 4px;" title="Reset to 1.0">Reset</button>
                             </div>
                        </div>
                    </div>
                </div>

                <div class="view-dropdown-container">
                    <button id="btn-automation-menu" class="btn btn-secondary" title="Geological Automation" style="${(this.state.world.globalOptions.enableHotspots || this.state.world.globalOptions.enableElevationSimulation) ? 'background-color: var(--color-success); color: white;' : ''}">
                        <span class="icon">⚙️</span> Automation
                    </button>
                    <div id="automation-dropdown-menu" class="view-dropdown-menu" style="min-width: 240px;">
                        <div class="dropdown-section">
                            <div class="dropdown-header">Automation Systems</div>
                            
                            <label class="view-dropdown-item">
                                 <input type="checkbox" id="check-enable-hotspots" ${this.state.world.globalOptions.enableHotspots ? 'checked' : ''}> Hotspot Tracking <span class="info-icon" data-tooltip="Stationary plumes create volcanic trails on moving plates">(i)</span>
                            </label>
                            
                            <label class="view-dropdown-item" style="opacity: 0.5;" title="DEPRECATED: Use Elevation System instead">
                                 <input type="checkbox" id="check-enable-orogeny" ${this.state.world.globalOptions.enableOrogeny ? 'checked' : ''} disabled> Orogeny Detection (DEPRECATED) <span class="info-icon" data-tooltip="This legacy feature is replaced by the Elevation System. Use 'Enable Elevation Simulation' instead.">(i)</span>
                            </label>
                            <div style="margin-left: 20px; padding: 8px; background: rgba(255,165,0,0.1); border-left: 2px solid orange; font-size: 10px;">
                                ⚠️ <strong>Legacy Feature</strong><br>
                                Use <strong>Elevation Simulation</strong> above for physical terrain generation.
                            </div>

                            <div style="margin-top: 6px; padding-top: 6px; border-top: 1px dotted var(--border-default);">
                                <label class="view-dropdown-item">
                                    <input type="checkbox" id="check-boundary-vis"> Visualize Boundaries <span class="info-icon" data-tooltip="Show Convergent (Red) and Divergent (Blue) lines">(i)</span>
                                </label>
                            </div>
                            
                            <!-- Elevation System -->
                            <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--border-default);">
                                <div style="font-weight: 600; color: var(--text-highlight); margin-bottom: 6px;">⛰️ Elevation System <span style="font-size: 9px; background: #2563eb; color: white; padding: 1px 4px; border-radius: 3px; margin-left: 4px;">NEW</span></div>
                                
                                <label class="view-dropdown-item">
                                    <input type="checkbox" id="check-enable-elevation" ${this.state.world.globalOptions.enableElevationSimulation ? 'checked' : ''}> Physical Elevation <span class="info-icon" data-tooltip="Simulate realistic mountain building and erosion using physics">(i)</span>
                                </label>
                                
                                <div id="elevation-options" style="margin-left: 20px; display: ${this.state.world.globalOptions.enableElevationSimulation ? 'block' : 'none'};">
                                    <div style="margin: 8px 0;">
                                        <label style="font-size: 10px; color: var(--text-secondary);">View Mode:</label>
                                        <select id="elevation-view-mode" class="property-input" style="width: 100%; padding: 4px;">
                                            <option value="off" ${this.state.world.globalOptions.elevationViewMode === 'off' ? 'selected' : ''}>Off</option>
                                            <option value="overlay" ${this.state.world.globalOptions.elevationViewMode === 'overlay' ? 'selected' : ''}>Overlay</option>
                                            <option value="absolute" ${this.state.world.globalOptions.elevationViewMode === 'absolute' ? 'selected' : ''}>Absolute</option>
                                            <option value="landmass" ${this.state.world.globalOptions.elevationViewMode === 'landmass' ? 'selected' : ''}>Landmass Only</option>
                                        </select>
                                    </div>
                                    
                                    <div style="display: flex; justify-content: space-between; align-items: center; margin: 4px 0;">
                                        <span style="font-size: 10px; color: var(--text-secondary);">Mesh Resolution:</span>
                                        <input type="number" id="elevation-resolution" class="property-input" value="${this.state.world.globalOptions.meshResolution || 150}" min="50" max="300" step="25" style="width: 70px;"> km
                                    </div>
                                    
                                    <div style="display: flex; justify-content: space-between; align-items: center; margin: 4px 0;">
                                        <span style="font-size: 10px; color: var(--text-secondary);">Uplift Rate:</span>
                                        <input type="number" id="elevation-uplift" class="property-input" value="${this.state.world.globalOptions.upliftRate || 1000}" min="100" max="5000" step="100" style="width: 70px;"> m/Ma
                                    </div>
                                    
                                    <div style="display: flex; justify-content: space-between; align-items: center; margin: 4px 0;">
                                        <span style="font-size: 10px; color: var(--text-secondary);">Erosion Rate:</span>
                                        <input type="number" id="elevation-erosion" class="property-input" value="${this.state.world.globalOptions.erosionRate || 0.001}" min="0.0001" max="0.01" step="0.0001" style="width: 70px;">
                                    </div>
                                    
                                    <div style="display: flex; justify-content: space-between; align-items: center; margin: 4px 0;">
                                        <span style="font-size: 10px; color: var(--text-secondary);">Sediment Rate:</span>
                                        <input type="number" id="elevation-sediment-rate" class="property-input" value="${this.state.world.globalOptions.sedimentConsolidationRate || 0.001}" min="0.0001" max="0.01" step="0.0001" style="width: 70px;"> km/Ma
                                    </div>
                                    
                                    <div style="display: flex; justify-content: space-between; align-items: center; margin: 4px 0;">
                                        <span style="font-size: 10px; color: var(--text-secondary);">Sediment Ratio:</span>
                                        <input type="number" id="elevation-sediment-ratio" class="property-input" value="${this.state.world.globalOptions.sedimentConsolidationRatio || 0.25}" min="0.1" max="1" step="0.05" style="width: 70px;">
                                    </div>
                                    
                                    <button id="btn-reset-elevation-defaults" class="btn" style="width: 100%; margin-top: 8px; padding: 4px; font-size: 10px; background: rgba(59, 130, 246, 0.1); border: 1px solid rgba(59, 130, 246, 0.3); color: var(--text-default); cursor: pointer; border-radius: 3px;">
                                        ↻ Reset to Defaults
                                    </button>
                                    
                                    <div style="margin-top: 8px; padding: 6px; background: rgba(37, 99, 235, 0.1); border-radius: 4px; font-size: 9px; color: var(--text-secondary);">
                                        💡 Use the Mesh Edit tool (M) to inspect and manually sculpt terrain
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Planet Dropdown -->
            <div class="view-dropdown-container">
                <button id="btn-planet" class="btn btn-secondary" title="Planet Options">
                    <span class="icon">🪐</span> Planet
                </button>
                <div id="planet-dropdown-menu" class="view-dropdown-menu" style="min-width: 240px;">
                    <div class="dropdown-section">
                        <div class="dropdown-header">Planet</div>
                        <label class="view-dropdown-item" style="display:flex; justify-content:space-between; align-items:center;">
                            <span>Custom Planet Radius</span>
                            <input type="checkbox" id="check-custom-radius">
                        </label>
                        <div style="padding: 2px 8px 4px 8px; display: flex; align-items: center; gap: 6px;">
                            <label style="font-size: 10px; color: var(--text-secondary); white-space: nowrap;">Radius (km)</label>
                            <input type="number" id="global-planet-radius" class="property-input" value="${this.state.world.globalOptions.customRadiusEnabled ? (this.state.world.globalOptions.customPlanetRadius || 6371) : 6371}" step="100" style="width: 90px;" disabled>
                        </div>
                        
                        <div style="margin-top: 12px; padding-top: 8px; border-top: 1px solid var(--border-default);">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin: 6px 0;">
                                <label style="font-size: 10px; color: var(--text-secondary);">Ocean Level Preset:</label>
                                <select id="global-ocean-level-preset" class="property-input" style="width: 110px; font-size: 10px;">
                                    <option value="0">Modern Earth (0m)</option>
                                    <option value="6">Last Interglacial (+6m)</option>
                                    <option value="25">Pliocene (+25m)</option>
                                    <option value="65">Eocene Optimum (+65m)</option>
                                    <option value="250">Cretaceous High (+250m)</option>
                                    <option value="-60">Early Holocene (-60m)</option>
                                    <option value="-120">Last Glacial Max (-120m)</option>
                                    <option value="custom">Custom</option>
                                </select>
                            </div>
                            <div style="display: flex; justify-content: space-between; align-items: center; margin: 6px 0;">
                                <label style="font-size: 10px; color: var(--text-secondary);">Custom Level:</label>
                                <input type="number" id="global-ocean-level" class="property-input" value="${this.state.world.globalOptions.oceanLevel ?? 0}" min="-6000" max="6000" step="100" style="width: 80px;"> m
                            </div>
                            <div style="font-size: 9px; color: var(--text-secondary); padding: 0 8px; margin-top: 4px;">
                                💧 Elevation mesh above this level = land (colored). Below = ocean (blue)
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <button id="btn-reset-camera" class="btn btn-secondary" title="Reset Camera">
                <span class="icon">⟲</span><span class="oldschool-text">RESET</span>
            </button>

            <button id="btn-fullscreen" class="btn btn-secondary" title="Toggle Fullscreen">
               <span class="icon">⛶</span><span class="oldschool-text">FULL</span>
            </button>
            <button id="btn-ui-mode" class="btn btn-secondary" title="Toggle UI Mode">
               <span class="icon">💻</span><span class="oldschool-text">UI</span>
            </button>

            <button id="btn-theme-toggle" class="btn btn-secondary" title="Toggle Theme">
              <span class="icon">🌙</span><span class="oldschool-text">THEME</span>
            </button>
            <button id="btn-undo" class="btn btn-secondary" title="Undo (Ctrl+Z)">
              <span class="icon">↶</span> Undo
            </button>
            <button id="btn-redo" class="btn btn-secondary" title="Redo (Ctrl+Y)">
              <span class="icon">↷</span> Redo
            </button>
            <button id="btn-export" class="btn btn-primary" title="Export (PNG, Heightmap, QGIS)">
              <span class="icon">📤</span> Export
            </button>
            <button id="btn-export-json" class="btn btn-secondary" title="Export JSON">
              <span class="icon">💾</span> Save
            </button>
            <button id="btn-import-json" class="btn btn-secondary" title="Import JSON">
              <span class="icon">📂</span> Load
            </button>
            <button id="btn-legend" class="btn btn-secondary" title="Legend">
              <span class="icon">❓</span> Legend
            </button>
            <input type="file" id="file-import" accept=".json" style="display: none;">
            <input type="file" id="file-overlay-upload" accept="image/*" style="display: none;">
          </div>
        </header>
        
        <div class="main-content">
          <aside class="toolbar" id="toolbar">
            <!-- 1. TOOLS GROUP -->
            <div class="tool-group">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                <h3 class="tool-group-title" style="margin: 0;">Interaction</h3>
                <label style="font-size: 10px; display: flex; align-items: center; gap: 4px; cursor: pointer; color: var(--text-secondary);" title="Toggle on-canvas tooltips">
                  <input type="checkbox" id="check-show-hints" ${this.state.world.globalOptions.showHints !== false ? 'checked' : ''}> Hints
                </label>
              </div>
              
              <!-- Layer Mode Toggle -->
              <div style="display: flex; gap: 4px; margin-bottom: 8px; padding: 4px; background: var(--bg-input); border-radius: 4px;">
                <button id="layer-mode-plate" class="btn ${this.state.world.layerMode === 'plate' ? 'btn-primary' : 'btn-secondary'}" style="flex:1; font-size: 11px; padding: 4px 8px;" title="Edit plates and their geometry (Hotkey: Shift+L)">
                  🌍 Plate
                </button>
                <button id="layer-mode-landmass" class="btn ${this.state.world.layerMode === 'landmass' ? 'btn-primary' : 'btn-secondary'}" style="flex:1; font-size: 11px; padding: 4px 8px;" title="Edit landmasses - artistic layer (Hotkey: Shift+L)">
                  🏝️ Landmass
                </button>
              </div>
              
              <div style="display: flex; gap: 4px; flex-wrap: wrap;">
                  <button class="tool-btn active" data-tool="select" style="flex:1;">
                    <span class="tool-icon">👆</span>
                    <span class="tool-label">Select</span>
                    <span class="info-icon" data-tooltip="Select plates/features to edit (Hotkey: V)">(i)</span>
                  </button>
                  <button class="tool-btn" data-tool="pan" style="flex:1;">
                    <span class="tool-icon">🔄</span>
                    <span class="tool-label">Rotate</span>
                    <span class="info-icon" data-tooltip="Move camera or rotate globe (Hotkey: H)">(i)</span>
                  </button>
              </div>
              <div style="display: flex; gap: 4px; flex-wrap: wrap;">
                  <button class="tool-btn" data-tool="draw" style="flex:1;">
                    <span class="tool-icon">✏️</span>
                    <span class="tool-label">Draw</span>
                    <span class="info-icon" data-tooltip="Draw new plate boundaries (Hotkey: D)">(i)</span>
                  </button>
                  <button class="tool-btn" data-tool="edit" style="flex:1;">
                    <span class="tool-icon">✎</span>
                    <span class="tool-label">Edit</span>
                    <span class="info-icon" data-tooltip="Modify plate geometry (Hotkey: E)">(i)</span>
                  </button>
                  <button class="tool-btn" data-tool="feature" style="flex:1;">
                    <span class="tool-icon">🏔️</span>
                    <span class="tool-label">Feature</span>
                    <span class="info-icon" data-tooltip="Place mountains, volcanoes, etc (Hotkey: F)">(i)</span>
                  </button>
              </div>
              <div style="display: flex; gap: 4px; flex-wrap: wrap;">
                  <button class="tool-btn" data-tool="split" style="flex:1;">
                    <span class="tool-icon">✂️</span>
                    <span class="tool-label">Split</span>
                    <span class="info-icon" data-tooltip="Divide a plate in two (Hotkey: S)">(i)</span>
                  </button>
                   <button class="tool-btn" data-tool="link" style="flex:1;">
                    <span class="tool-icon">🔗</span>
                    <span class="tool-label">Link</span>
                    <span class="info-icon" data-tooltip="Group plates to move together (Hotkey: L)">(i)</span>
                  </button>
                  <button class="tool-btn" data-tool="fuse" style="flex:1;">
                    <span class="tool-icon">🧬</span>
                    <span class="tool-label">Fuse</span>
                    <span class="info-icon" data-tooltip="Merge two plates (Hotkey: G)">(i)</span>
                  </button>
                  <button class="tool-btn" data-tool="flowline" style="flex:1;">
                    <span class="tool-icon">➤</span>
                    <span class="tool-label">Flowline</span>
                    <span class="info-icon" data-tooltip="Drop a flowline seed to trace motion (Hotkey: T)">(i)</span>
                  </button>
                  <button class="tool-btn" data-tool="paint" style="flex:1;">
                    <span class="tool-icon">🖌️</span>
                    <span class="tool-label">Paint</span>
                    <span class="info-icon" data-tooltip="Paint on plates (Hotkey: P)">(i)</span>
                  </button>
                  <button class="tool-btn" data-tool="mesh_edit" style="flex:1;">
                    <span class="tool-icon">🔺</span>
                    <span class="tool-label">Mesh</span>
                    <span class="info-icon" data-tooltip="Edit elevation mesh vertices (Hotkey: M)">(i)</span>
                  </button>
              </div>
            </div>
            
            <!-- 2. CONTEXT / OPTIONS GROUP -->
            <div class="tool-group">
                 <h3 class="tool-group-title">Tool Options</h3>
                 
                 <!-- Dynamic Controls Stack -->
                 <div id="feature-selector" style="display: none;">
                      <button class="feature-btn active" data-feature="mountain" title="Mountain">🏔️ Mtn</button>
                      <button class="feature-btn" data-feature="volcano" title="Volcano">🌋 Volc</button>
                      <button class="feature-btn" data-feature="hotspot" title="Hotspot">🔥 Hot</button>
                      <button class="feature-btn" data-feature="rift" title="Rift">⚡ Rift</button>
                      <button class="feature-btn" data-feature="trench" title="Trench">🌊 Trn</button>
                      <button class="feature-btn" data-feature="weakness" title="Weakness">💔 Weak</button>
                 </div>

                 <div id="split-controls" style="display: none; flex-direction:column; gap:4px;">
                     <div style="align-self: center; font-size: 11px; color: var(--text-secondary);">Confirm Split?</div>
                     <button class="btn btn-success" id="btn-split-apply">✓ Apply</button>
                     <button class="btn btn-secondary" id="btn-split-cancel">✗ Cancel</button>
                 </div>

                 <div id="motion-controls" style="display: none; flex-direction:column; gap:4px;">
                      <div style="font-size: 11px; color: var(--text-secondary);">Confirm Motion?</div>
                      <button class="btn btn-success" id="btn-motion-apply">✓ Apply</button>
                      <button class="btn btn-secondary" id="btn-motion-cancel">✗ Cancel</button>
                 </div>

                 <div id="edit-controls" style="display: none; flex-direction:column; gap:4px; margin-top: 8px; border-top: 1px solid var(--border-default); padding-top: 8px;">
                     <div style="align-self: center; font-size: 11px; color: var(--text-secondary); font-weight: bold;">Apply Changes?</div>
                     <div style="display:flex; gap: 4px;">
                         <button class="btn btn-success" id="btn-edit-apply" style="flex:1;">✓ Apply</button>
                         <button class="btn btn-secondary" id="btn-edit-cancel" style="flex:1;">✗ Cancel</button>
                     </div>
                 </div>

                 <div id="paint-controls" style="display: none; flex-direction:column; gap:6px; margin-top: 8px; padding: 8px; border: 1px solid var(--border-default); border-radius: 4px;">
                     <div style="font-size: 12px; font-weight: bold; color: var(--text-primary);">🖌️ Paint Tool</div>
                     
                     <div style="display: flex; gap: 4px; margin-bottom: 4px;">
                         <button id="paint-mode-brush" class="btn" style="flex:1; background: #3b82f6; color: white; cursor: default;">Brush</button>
                     </div>
                     
                     <div id="paint-brush-options" style="display: flex; flex-direction: column; gap: 6px;">
                         <div style="display: flex; flex-direction: column; gap: 4px;">
                             <label style="font-size: 11px; color: var(--text-secondary);">Brush Color:</label>
                             <input type="color" id="paint-color" value="#ff0000" style="width: 100%; height: 32px; cursor: pointer; border: 1px solid var(--border-default); border-radius: 3px;">
                         </div>
                         
                         <div style="display: flex; flex-direction: column; gap: 4px;">
                             <label style="font-size: 11px; color: var(--text-secondary);">Brush Size: <span id="paint-size-value" style="font-weight: bold;">5</span>px</label>
                             <input type="range" id="paint-size" min="1" max="50" value="5" style="width: 100%;">
                         </div>
                         
                         <div style="display: flex; flex-direction: column; gap: 4px;">
                             <label style="font-size: 11px; color: var(--text-secondary);">Opacity: <span id="paint-opacity-value" style="font-weight: bold;">80</span>%</label>
                             <input type="range" id="paint-opacity" min="0" max="100" value="80" style="width: 100%;">
                         </div>
                     </div>
                     
                     <button id="paint-clear-plate" class="btn btn-secondary" style="margin-top: 4px;">Clear Plate Paint</button>

                     <!-- Paint Ageing (Fading) Options -->
                     <hr class="property-divider" style="margin: 8px 0;">
                     <div style="display: flex; flex-direction: column; gap: 4px;">
                         <label style="display: flex; align-items: center; gap: 6px; font-size: 11px; cursor: pointer;">
                             <input type="checkbox" id="paint-ageing-enabled"> Ageing Lines (Fade)
                         </label>
                         
                         <div id="paint-ageing-options" style="display: flex; flex-direction: column; gap: 6px; margin-left: 18px;">
                             <div style="display: flex; flex-direction: column; gap: 2px;">
                                 <label style="font-size: 10px; color: var(--text-secondary);">Fade Duration (Ma):</label>
                                 <input type="number" id="paint-ageing-duration" class="property-input" min="1" step="10">
                             </div>
                             
                             <div style="display: flex; flex-direction: column; gap: 2px;">
                                 <label style="font-size: 10px; color: var(--text-secondary);">Max Transparency (%):</label>
                                 <div style="display:flex; gap: 4px;">
                                    <input type="number" id="paint-ageing-max-trans" class="property-input" min="0" max="100" step="5" style="flex:1;">
                                    <button id="paint-ageing-reset" class="btn btn-secondary" style="padding: 2px 6px;" title="Reset to Defaults">↺</button>
                                 </div>
                             </div>

                             <!-- Auto Delete Options -->
                             <div style="display: flex; flex-direction: column; gap: 4px; margin-top: 4px;">
                                <label style="display: flex; align-items: center; gap: 6px; font-size: 11px; cursor: pointer;">
                                    <input type="checkbox" id="paint-auto-delete"> Auto-Delete
                                </label>
                                <div id="paint-auto-delete-options" style="display: none; flex-direction: column; gap: 2px; margin-left: 0px;">
                                     <label style="font-size: 10px; color: var(--text-secondary);">Delete Delay (Ma):</label>
                                     <input type="number" id="paint-delete-delay" class="property-input" min="0" step="10">
                                </div>
                             </div>
                         </div>
                     </div>
                 </div>

                 <!-- Motion Mode Specifics -->
                 <div style="margin-top: 8px;">
                    <label class="property-label" style="font-size:11px;">Interaction Mode <span class="info-icon" data-tooltip="Classic (Pole) vs Dragging">(i)</span></label>
                    <select id="motion-mode-select" class="tool-select" style="width:100%;">
                        <option value="classic">Classic (Fixed Pole)</option>
                        <option value="dynamic_pole">Dynamic Direction</option>
                        <option value="drag_target">Drag Landmass</option>
                    </select>
                 </div>
            </div>

            <!-- 3. VIEW GROUP -->

            
            <!-- 4. GLOBAL / SIMULATION GROUP -->
            <div class="tool-group">
                <h3 class="tool-group-title">Simulation</h3>
                <hr class="property-divider" style="margin: 8px 0;">
                <div style="margin-bottom:6px;">
                    <div style="font-size:11px; font-weight:600; color:var(--text-secondary); margin-bottom:4px;">Speed</div>
                    <div style="display:flex; flex-direction:column; gap:6px;">
                        <div style="display:flex; align-items:center; gap:6px;">
                            <input type="number" id="speed-input-cm" class="property-input" step="0.05" style="width:70px;" disabled>
                            <span style="font-size:10px; color:var(--text-secondary);">cm/yr</span>
                        </div>
                        <div style="display:flex; align-items:center; gap:6px;">
                            <input type="number" id="speed-input-deg" class="property-input" step="0.05" style="width:70px;" disabled>
                            <span style="font-size:10px; color:var(--text-secondary);">deg/Ma</span>
                        </div>
                    </div>
                    <div style="margin-top: 6px; display: flex; flex-direction: column; gap: 4px;">
                        <button id="btn-reposition-pole-north" class="btn btn-secondary" style="width:100%; font-size:10px;">Reposition Pole to North</button>
                        <button id="btn-reposition-pole-south" class="btn btn-secondary" style="width:100%; font-size:10px;">Reposition Pole to South</button>
                    </div>
                </div>
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                  <div style="font-size:11px; font-weight:600; color:var(--text-secondary);">
                    Speed Presets
                  </div>
                  <label style="display:flex; align-items:center; gap:4px; font-size:10px; cursor:pointer;" title="Switch between real-world examples and custom preset values">
                      <input type="checkbox" id="check-use-custom-presets"> Costum 
                  </label>
                </div>
                
                <!-- Real World List -->
                <div id="preset-container-realworld" style="display:flex; flex-direction:column; gap:6px; max-height:300px; overflow-y:auto; padding-right:4px;">
                    ${this.generateRealWorldPresetList()}
                </div>

                <!-- Custom List -->
                <div id="preset-container-custom" style="display:none; flex-direction:column; gap:6px;">
                    ${this.generateCustomPresetList()}
                </div>
            </div>

            <!-- 5. PLATES LIST -->

          </aside>
          
          <div class="resizer-x" id="resizer-left" style="position: relative; width: 4px; cursor: col-resize; background-color: var(--bg-tertiary); z-index: 10;"></div>
          
          <aside class="plate-sidebar" id="plate-sidebar">
             <h3 class="tool-group-title" style="padding: 16px 16px 0 16px;">Explorer</h3>
             <div id="plate-list" class="plate-list" style="padding: 0 16px 16px 16px; overflow-y: auto; flex:1;"></div>
          </aside>
          
          <div class="resizer-x" id="resizer-left-inner" style="position: relative; width: 4px; cursor: col-resize; background-color: var(--bg-tertiary); z-index: 10;"></div>

          <main class="canvas-container" style="flex:1; display:flex;">
            <canvas id="main-canvas" style="flex:1;"></canvas>
            <div class="canvas-hint" id="canvas-hint"></div>
          </main>
          
          <div class="resizer-x" id="resizer-right" style="position: relative; width: 4px; cursor: col-resize; background-color: var(--bg-tertiary); z-index: 10;"></div>

          <div class="right-sidebar" id="right-sidebar">
            <aside class="properties-panel" id="properties-panel">
                <h3 class="panel-title">Properties</h3>
                <div id="properties-content">
                  <p class="empty-message">Select a plate to edit properties</p>
                </div>
            </aside>
            <div id="timeline-panel" class="timeline-panel">
                <div class="timeline-title">Event Timeline</div>
                <!-- Timeline items injected here -->
            </div>
          </div>
        </div>
        
        <div class="resizer-y" id="resizer-bottom" style="position: relative; height: 4px; cursor: row-resize; background-color: var(--bg-tertiary); z-index: 10;"></div>

        <footer class="timeline-bar" id="timeline-bar">
          <div class="time-controls">
            <button id="btn-play" class="btn btn-icon" title="Play/Pause">▶️</button>
            <select id="speed-select" class="speed-select">
              <option value="1">1 Ma/s</option>
              <option value="5">5 Ma/s</option>
              <option value="10">10 Ma/s</option>
              <option value="50">50 Ma/s</option>
            </select>
          </div>
          <div class="timeline">
            <input type="range" id="time-slider" class="time-slider" min="0" max="500" value="0">
            <div class="time-display">
              <div class="time-controls-row">
                <span id="current-time" class="current-time-display" style="cursor: pointer; font-weight: 600;" title="Click to set current time">0</span>
                <span id="time-mode-label">Ma</span>
                <span style="margin: 0 8px; color: var(--text-secondary);">|</span>
                <label style="display: flex; align-items: center; gap: 4px; margin: 0; font-size: 11px; cursor: pointer; color: var(--text-secondary);">
                  <input type="checkbox" id="check-time-mode" style="cursor: pointer;"> Ago
                </label>
                <span style="margin: 0 8px; color: var(--text-secondary);">|</span>
                <label style="display: flex; align-items: center; gap: 4px; margin: 0;">
                  <span style="font-size: 10px; color: var(--text-secondary);">Max:</span>
                  <input type="number" id="timeline-max-time" class="property-input" value="${this.state.world.globalOptions.timelineMaxTime || 500}" step="100" min="100" style="width: 50px; padding: 2px 4px;">
                </label>
              </div>
            </div>
          </div>
          <button id="btn-reset-time" class="btn btn-secondary">Reset</button>
        </footer>
        <div id="global-tooltip"></div>
        <!-- Time Input Modal -->
        <div id="time-input-modal" class="modal" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.6); z-index: 10000; justify-content: center; align-items: center;">
          <div class="modal-content" style="background: var(--bg-secondary); border: 2px solid var(--border-default); border-radius: 4px; padding: 16px; min-width: 300px; box-shadow: 0 4px 12px rgba(0,0,0,0.4);">
            <h3 style="margin-top: 0; color: var(--text-primary);">Set Current Time</h3>
            <input type="number" id="time-input-field" class="property-input" style="width: 100%; padding: 8px; margin-bottom: 12px; font-size: 14px;" placeholder="Enter time value">
            <div style="display: flex; gap: 8px; justify-content: flex-end;">
              <button id="btn-time-input-cancel" class="btn btn-secondary" style="padding: 6px 12px;">Cancel</button>
              <button id="btn-time-input-confirm" class="btn btn-primary" style="padding: 6px 12px;">Confirm</button>
            </div>
          </div>
        </div>
        <!-- Apply Edit Modal -->
        <div id="apply-edit-modal" class="modal" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.6); z-index: 10000; justify-content: center; align-items: center;">
          <div class="modal-content" style="background: #1e1e2e; border: 1px solid var(--border-default); border-radius: 8px; padding: 20px; min-width: 400px; box-shadow: 0 10px 40px rgba(0,0,0,0.6); display: flex; flex-direction: column; gap: 16px;">
            <h3 style="margin: 0; color: var(--text-primary); font-size: 18px; border-bottom: 1px solid var(--border-default); padding-bottom: 12px;">Apply Plate Geometry</h3>
            <div style="font-size: 13px; color: var(--text-secondary); line-height: 1.4;">Choose how to apply these changes to the timeline:</div>
            
            <div style="display: flex; flex-direction: column; gap: 8px;">
                <button id="btn-apply-generation" class="btn" style="text-align: left; padding: 12px; display: flex; flex-direction: column; background: var(--bg-tertiary); border: 1px solid var(--border-default); transition: all 0.2s;">
                    <span style="font-weight: 600; font-size: 14px; margin-bottom: 4px; color: var(--color-primary);">Apply at Generation (Rewrite History)</span>
                    <span style="font-size: 11px; opacity: 0.7; font-weight: normal; color: var(--text-secondary);">Modifies the plate's base shape from birth. The change propagates through all time.</span>
                </button>
                
                <button id="btn-apply-event" class="btn" style="text-align: left; padding: 12px; display: flex; flex-direction: column; background: var(--bg-tertiary); border: 1px solid var(--border-default); transition: all 0.2s;">
                    <span style="font-weight: 600; font-size: 14px; margin-bottom: 4px; color: var(--color-success);">Insert Event at Current Time</span>
                    <span style="font-size: 11px; opacity: 0.7; font-weight: normal; color: var(--text-secondary);">Creates a new 'Edit' event at <span id="lbl-current-time" style="color:white; font-weight:bold;">0</span> Ma. The shape changes only from this point forward.</span>
                </button>
            </div>
            
            <div style="display: flex; justify-content: flex-end; margin-top: 8px; border-top: 1px solid var(--border-default); padding-top: 16px;">
              <button id="btn-apply-cancel" class="btn btn-secondary" style="padding: 8px 16px;">Cancel</button>
            </div>
          </div>
        </div>
        
        <!-- Drag Target Modal (Dynamic Velocity Feedback) -->
        <div id="drag-target-modal" class="modal" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.6); z-index: 10000; justify-content: center; align-items: center;">
          <div class="modal-content" style="background: var(--bg-surface); border: 1px solid var(--border-default); border-radius: 8px; padding: 20px; min-width: 400px; box-shadow: 0 10px 40px rgba(0,0,0,0.6); display: flex; flex-direction: column; gap: 16px;">
            <h3 style="margin: 0; color: var(--text-primary); border-bottom: 1px solid var(--border-default); padding-bottom: 8px;">Set Motion Target</h3>
            
            <div style="display: flex; flex-direction: column; gap: 5px;">
                <label style="color: var(--text-secondary); font-size: 12px; text-transform: uppercase; font-weight: 600;">Current Time</label>
                <div id="drag-target-current-time" style="color: var(--text-primary); font-weight: bold; font-family: monospace; font-size: 14px;">0 Ma</div>
            </div>

            <div style="display: flex; flex-direction: column; gap: 5px;">
                <label style="color: var(--text-secondary); font-size: 12px; text-transform: uppercase; font-weight: 600;">Target Time (Ma)</label>
                <input type="number" id="drag-target-input" class="property-input" step="any" style="width: 100%; padding: 8px; font-size: 14px; color: var(--text-primary); background: var(--bg-dark); border: 1px solid var(--border-muted);">
            </div>

            <div style="background: var(--bg-elevated); padding: 12px; border-radius: 6px; display: flex; flex-direction: column; gap: 8px; border: 1px solid var(--border-muted);">
                 <label style="color: var(--text-muted); font-size: 10px; letter-spacing: 0.5px; font-weight: bold;">ESTIMATED VELOCITY</label>
                 
                 <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div style="display: flex; align-items: baseline; gap: 6px;">
                        <span id="drag-target-speed-deg" style="color: var(--accent-primary); font-size: 20px; font-weight: bold; font-family: monospace;">--</span>
                        <span style="color: var(--text-secondary); font-size: 12px;">deg/Ma</span>
                    </div>
                    <div style="display: flex; align-items: baseline; gap: 6px;">
                        <span id="drag-target-speed-cm" style="color: var(--accent-success); font-size: 16px; font-weight: bold; font-family: monospace;">--</span>
                        <span style="color: var(--text-secondary); font-size: 12px;">cm/yr</span>
                    </div>
                 </div>
                 <div id="drag-target-warning" style="font-size: 11px; color: var(--accent-warning); display: none;">Warning: Excessive velocity detected!</div>
            </div>

            <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 8px;">
                <button id="btn-drag-target-cancel" class="btn btn-secondary" style="min-width: 80px;">Cancel</button>
                <button id="btn-drag-target-confirm" class="btn btn-primary" style="min-width: 80px; background-color: var(--accent-primary); color: white;">Confirm</button>
            </div>
          </div>
        </div>

      </div>
    `;
    }


    public showModal(options: { 
        title: string; 
        content: string; 
        width?: string;
        buttons: { 
            text: string; 
            subtext?: string; 
            isSecondary?: boolean;
            onClick: () => void 
        }[] 
    }): void {
        const appContainer = document.querySelector('.app-container');
        const isRetro = appContainer ? appContainer.classList.contains('oldschool-mode') : false;

        // RETRO THEME POPUP
        if (isRetro) {
            // Strip HTML tags for clean alert text
            let cleanText = options.content.replace(/<[^>]*>/g, '');
            
            // Check if this is a "Confirm" style (multiple choices) or "Alert" style (OK only)
            const mainAction = options.buttons.find(b => !b.isSecondary);
            const secondaryAction = options.buttons.find(b => b.isSecondary);

            if (mainAction && secondaryAction) {
                // Bi-modal choice (OK/Cancel)
                // Append instruction to map buttons to OK/Cancel
                cleanText += `\n\n[OK] -> ${mainAction.text}\n[Cancel] -> ${secondaryAction.text}`;

                if (confirm(cleanText)) {
                    // Logic for "OK" / Main Action
                    mainAction.onClick();
                } else {
                    // Logic for "Cancel" / Secondary
                    secondaryAction.onClick();
                }
            } else if (mainAction) {
                // Only one main action - treat as alert
                alert(cleanText);
                mainAction.onClick();
            } else {
                // Just info
                alert(cleanText);
            }
            return;
        }

        // MODERN THEME MODAL (Standard TectoLite UI)
        const overlay = document.createElement('div');
        overlay.style.cssText = `
          position: fixed; top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(0,0,0,0.6); z-index: 10000;
          display: flex; align-items: center; justify-content: center;
        `;

        const dialog = document.createElement('div');
        dialog.style.cssText = `
          background: #1e1e2e; border: 1px solid var(--border-default); border-radius: 8px; padding: 20px;
          min-width: ${options.width || '400px'}; color: var(--text-primary); font-family: system-ui, sans-serif;
          box-shadow: 0 10px 40px rgba(0,0,0,0.6); display: flex; flex-direction: column; gap: 16px;
        `;

        dialog.innerHTML = `
          <h3 style="margin: 0; color: var(--text-primary); font-size: 18px; border-bottom: 1px solid var(--border-default); padding-bottom: 12px;">${options.title}</h3>
          <div style="font-size: 13px; color: var(--text-secondary); line-height: 1.4;">${options.content}</div>
          <div id="modal-btn-container" style="display: flex; flex-direction: column; gap: 8px; margin-top: 8px;"></div>
        `;
        
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        const btnContainer = dialog.querySelector('#modal-btn-container');
        if(btnContainer) {
            // Check if we have a simple cancel button to group at bottom right
            const mainButtons = options.buttons.filter(b => !b.isSecondary);
            const secondaryButtons = options.buttons.filter(b => b.isSecondary);

            mainButtons.forEach(btn => {
                const b = document.createElement('button');
                b.className = 'btn';
                b.style.cssText = `
                    text-align: left; padding: 12px; display: flex; flex-direction: column; 
                    background: var(--bg-tertiary); border: 1px solid var(--border-default); transition: all 0.2s;
                    cursor: pointer; color: var(--text-primary);
                `;
                
                let inner = `<span style="font-weight: 600; font-size: 14px; color: var(--color-primary); margin-bottom: 2px;">${btn.text}</span>`;
                if(btn.subtext) {
                    inner += `<span style="font-size: 11px; opacity: 0.7; font-weight: normal; color: var(--text-secondary);">${btn.subtext}</span>`;
                }
                b.innerHTML = inner;

                b.addEventListener('mouseenter', () => b.style.borderColor = 'var(--color-primary)');
                b.addEventListener('mouseleave', () => b.style.borderColor = 'var(--border-default)');
                
                b.addEventListener('click', () => {
                    document.body.removeChild(overlay);
                    btn.onClick();
                });
                btnContainer.appendChild(b);
            });

            if(secondaryButtons.length > 0) {
                const row = document.createElement('div');
                row.style.cssText = `display: flex; justify-content: flex-end; margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--border-default);`;
                
                secondaryButtons.forEach(btn => {
                    const b = document.createElement('button');
                    b.className = 'btn btn-secondary';
                    b.innerText = btn.text;
                    b.style.cssText = `padding: 6px 16px; margin-left: 8px;`;
                    b.addEventListener('click', () => {
                        document.body.removeChild(overlay);
                        btn.onClick();
                    });
                    row.appendChild(b);
                });
                btnContainer.appendChild(row);
            }
        }
    }

    private updateRetroStatusBox(text: string | null): void {
        const statusBox = document.getElementById('retro-status-text');
        if (statusBox) statusBox.textContent = text || this.activeToolText || "INFO LOADING...";
    }

    private updateHint(text: string | null): void {
        if (text !== null) this.activeToolText = text;

        const showHints = this.state.world.globalOptions.showHints !== false;

        // Update Retro Status Box
        this.updateRetroStatusBox(text);

        // Update Canvas Hint
        const hint = document.getElementById('canvas-hint');
        if (hint) {
            if (showHints && text) {
                hint.textContent = text;
                hint.style.display = 'block';
            } else {
                hint.style.display = 'none';
            }
        }
    }

    private setupEventListeners(): void {
        // Fullscreen Toggle
        document.getElementById('btn-fullscreen')?.addEventListener('click', () => {
            if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen().catch(err => {
                    alert(`Error attempting to enable fullscreen: ${err.message}`);
                });
            } else {
                if (document.exitFullscreen) {
                    document.exitFullscreen();
                }
            }
        });

        // Unified View Dropdown
        const viewBtn = document.getElementById('btn-view-panels');
        const viewMenu = document.getElementById('view-dropdown-menu');

        // Planet Dropdown
        const planetBtn = document.getElementById('btn-planet');
        const planetMenu = document.getElementById('planet-dropdown-menu');

        // Automation Dropdown
        const automationBtn = document.getElementById('btn-automation-menu');
        const automationMenu = document.getElementById('automation-dropdown-menu');

        // Toggle Dropdown
        viewBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            viewMenu?.classList.toggle('show');
            planetMenu?.classList.remove('show');
            automationMenu?.classList.remove('show');
        });

        planetBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            planetMenu?.classList.toggle('show');
            viewMenu?.classList.remove('show');
            automationMenu?.classList.remove('show');
        });

        automationBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            automationMenu?.classList.toggle('show');
            viewMenu?.classList.remove('show');
            planetMenu?.classList.remove('show');
        });

        // Close on outside click
        document.addEventListener('click', (e) => {
            if (viewMenu?.classList.contains('show') && !viewMenu.contains(e.target as Node) && e.target !== viewBtn) {
                viewMenu.classList.remove('show');
            }
            if (planetMenu?.classList.contains('show') && !planetMenu.contains(e.target as Node) && e.target !== planetBtn) {
                planetMenu.classList.remove('show');
            }
            if (automationMenu?.classList.contains('show') && !automationMenu.contains(e.target as Node) && e.target !== automationBtn) {
                automationMenu.classList.remove('show');
            }
        });

        // Reset Camera
        document.getElementById('btn-reset-camera')?.addEventListener('click', () => {
            this.state.viewport.scale = 250;
            this.state.viewport.rotate = [0, 0, 0];
            this.canvasManager?.resizeCanvas();
        });

        // Checkbox Logic
        interface PanelMap {
            id: string; // Checkbox ID
            target: string; // Target Selector
            toggleClass: string; // Class to toggle
            inverse: boolean; // True if 'checked' means remove class (e.g. collapsed)
        }

        const panels: PanelMap[] = [
            { id: 'check-view-tools', target: '.toolbar', toggleClass: 'collapsed', inverse: true },
            { id: 'check-view-plates', target: '.plate-sidebar', toggleClass: 'collapsed', inverse: true },
            { id: 'check-view-props', target: '.right-sidebar', toggleClass: 'collapsed', inverse: true },
            { id: 'check-view-timeline', target: '.timeline-bar', toggleClass: 'collapsed', inverse: true }
        ];

        panels.forEach(p => {
            document.getElementById(p.id)?.addEventListener('change', (e) => {
                const checked = (e.target as HTMLInputElement).checked;
                const el = document.querySelector(p.target);
                if (el) {
                    if (p.inverse) {
                        checked ? el.classList.remove(p.toggleClass) : el.classList.add(p.toggleClass);
                    } else {
                        checked ? el.classList.add(p.toggleClass) : el.classList.remove(p.toggleClass);
                    }
                }
            });
        });

        // Global Tooltip Logic
        const tooltip = document.getElementById('global-tooltip');

        const updateTooltipPos = (e: MouseEvent) => {
            if (tooltip) {
                const x = e.clientX + 15;
                const y = e.clientY + 15;

                // Prevent overflow
                const rect = tooltip.getBoundingClientRect();
                const winWidth = window.innerWidth;
                const winHeight = window.innerHeight;

                let finalX = x;
                let finalY = y;

                if (x + rect.width > winWidth) {
                    finalX = e.clientX - rect.width - 10;
                }
                if (y + rect.height > winHeight) {
                    finalY = e.clientY - rect.height - 10;
                }

                tooltip.style.left = `${finalX}px`;
                tooltip.style.top = `${finalY}px`;
            }
        };

        // Delegated Tooltip Logic
        const handleTooltipHover = (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            // Find relevant interactive ancestor
            // We want to capture the specific element that triggered it, but also check its context
            const element = target.closest('[data-tooltip], [title], .info-icon, .tool-btn, .feature-btn, button, input, select, label, h3, .view-dropdown-item');

            if (!element) return;

            const appContainer = document.querySelector('.app-container');
            const isRetro = appContainer ? appContainer.classList.contains('oldschool-mode') : false;

            // In modern mode, only allow standard tooltip behavior
            if (!isRetro && !element.classList.contains('info-icon') && !element.closest('.info-icon') && !element.hasAttribute('data-tooltip')) {
                return;
            }

            // Determine text - PRIORITY SYSTEM
            let text: string | null = null;

            // 1. If we are hovering an info-icon directly, that is supreme
            if (element.classList.contains('info-icon')) {
                text = element.getAttribute('data-tooltip');
            }

            // 2. If valid text not found yet, check if the element HAS a child info-icon (common in buttons)
            if (!text) {
                const childIcon = element.querySelector('.info-icon');
                if (childIcon) text = childIcon.getAttribute('data-tooltip');
            }

            // 3. Check the element's own data-tooltip
            if (!text) {
                text = element.getAttribute('data-tooltip');
            }

            // 4. Check sibling info icon (for labels next to icons)
            if (!text) {
                const next = element.nextElementSibling;
                if (next && next.classList.contains('info-icon')) {
                    text = next.getAttribute('data-tooltip');
                }
            }

            // 5. Check title (and archive it)
            if (!text && element.getAttribute('title')) {
                text = element.getAttribute('title');
                element.setAttribute('data-original-title', text || '');
                element.removeAttribute('title');
            }

            // 6. Retro Fallbacks
            if (!text && isRetro) {
                if (element.tagName === 'H3') text = `[ ${element.textContent} ]`;
                else if (element.tagName === 'LABEL') text = element.textContent;
                else if (element.tagName === 'BUTTON' || element.classList.contains('tool-btn')) {
                    const label = element.querySelector('.tool-label');
                    text = label ? label.textContent : element.textContent;
                }
            }

            if (text) {
                if (isRetro) {
                    // Update Retro Status Box
                    this.updateRetroStatusBox(text);
                } else if (tooltip) {
                    // Modern Tooltip
                    tooltip.textContent = text;
                    tooltip.style.display = 'block';
                    tooltip.style.opacity = '1';
                    updateTooltipPos(e);
                }
            }
        };

        const handleTooltipOut = (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            const related = e.relatedTarget as HTMLElement;

            // Find the element we are leaving
            const element = target.closest('[data-tooltip], [title], .info-icon, .tool-btn, .feature-btn, button, input, select, label, h3, .view-dropdown-item');

            // Restore title if valid
            if (element && element.hasAttribute('data-original-title')) {
                const originalTitle = element.getAttribute('data-original-title');
                if (originalTitle) {
                    element.setAttribute('title', originalTitle);
                    element.removeAttribute('data-original-title');
                }
            }

            // FLICKER PREVENTION
            // If we are moving TO a child of the element we just left (or vice versa), do not reset.
            // e.g. Button -> Icon inside Button
            if (element && related && (element.contains(related) || related.contains(element))) {
                return;
            }

            const appContainer = document.querySelector('.app-container');
            const isRetro = appContainer ? appContainer.classList.contains('oldschool-mode') : false;

            if (isRetro) {
                // Restore active tool text
                this.updateRetroStatusBox(this.activeToolText);
            } else if (tooltip) {
                tooltip.style.display = 'none';
                tooltip.style.opacity = '0';
            }
        };

        document.body.addEventListener('mouseover', handleTooltipHover);
        document.body.addEventListener('mouseout', handleTooltipOut);
        document.body.addEventListener('mousemove', (e) => {
            const appContainer = document.querySelector('.app-container');
            const isRetro = appContainer ? appContainer.classList.contains('oldschool-mode') : false;

            if (!isRetro && tooltip && tooltip.style.display === 'block') {
                updateTooltipPos(e);
            }
        });

        // Fullscreen Toggle
        document.getElementById('btn-fullscreen')?.addEventListener('click', () => {
            if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen().catch(err => {
                    console.error(`Error attempting to enable fullscreen: ${err.message}`);
                });
            } else {
                if (document.exitFullscreen) {
                    document.exitFullscreen();
                }
            }
        });

        document.getElementById('check-show-hints')?.addEventListener('change', (e) => {
            const checked = (e.target as HTMLInputElement).checked;
            this.state.world.globalOptions.showHints = checked;
            this.updateHint(this.activeToolText);
        });

        // Layer Mode Toggle (Plate vs Landmass)
        document.getElementById('layer-mode-plate')?.addEventListener('click', () => {
            this.setLayerMode('plate');
        });
        document.getElementById('layer-mode-landmass')?.addEventListener('click', () => {
            this.setLayerMode('landmass');
        });

        // UI Mode Toggle
        document.getElementById('btn-ui-mode')?.addEventListener('click', () => {
            document.querySelector('.app-container')?.classList.toggle('oldschool-mode');
        });

        // Tools
        document.querySelectorAll('.tool-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const tool = btn.getAttribute('data-tool') as ToolType;
                this.setActiveTool(tool);

                // Update Active Tool Status text
                // Check child icon FIRST (Priority)
                let text: string | null = null;
                const childIcon = btn.querySelector('.info-icon');

                if (childIcon) {
                    text = childIcon.getAttribute('data-tooltip');
                }

                // Fallback to button tooltip
                if (!text) {
                    text = btn.getAttribute('data-tooltip');
                }

                if (text) {
                    this.activeToolText = text;
                    // Always update logic, even if not in retro mode, so state is correct when switching
                    const appContainer = document.querySelector('.app-container');
                    if (appContainer && appContainer.classList.contains('oldschool-mode')) {
                        this.updateRetroStatusBox(this.activeToolText);
                    }
                }
            });

            // Initial Check for active tool
            if (btn.classList.contains('active')) {
                // Initialize text based on default active button
                let text: string | null = null;
                const childIcon = btn.querySelector('.info-icon');
                if (childIcon) text = childIcon.getAttribute('data-tooltip');
                if (!text) text = btn.getAttribute('data-tooltip');

                if (text) {
                    this.activeToolText = text;
                    this.updateRetroStatusBox(text);
                }
            }
        });

        // Features
        document.querySelectorAll('.feature-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const feature = btn.getAttribute('data-feature') as FeatureType;
                this.setActiveFeature(feature);
            });
        });

        // Projection
        document.getElementById('projection-select')?.addEventListener('change', (e) => {
            const val = (e.target as HTMLSelectElement).value as ProjectionType;
            this.state.world.projection = val;
            this.canvasManager?.render();
        });

        // Motion Mode
        document.getElementById('motion-mode-select')?.addEventListener('change', (e) => {
            const mode = (e.target as HTMLSelectElement).value as InteractionMode;
            this.canvasManager?.setMotionMode(mode);
        });

        // View Options
        document.getElementById('check-grid')?.addEventListener('change', (e) => {
            this.state.world.showGrid = (e.target as HTMLInputElement).checked;
            this.canvasManager?.render();
        });

        document.getElementById('grid-thickness-select')?.addEventListener('change', (e) => {
            const val = parseFloat((e.target as HTMLSelectElement).value);
            this.state.world.globalOptions.gridThickness = val;
            this.canvasManager?.render();
        });



        document.getElementById('check-features')?.addEventListener('change', (e) => {
            this.state.world.showFeatures = (e.target as HTMLInputElement).checked;
            this.canvasManager?.render();
        });

        document.getElementById('check-euler-poles')?.addEventListener('change', (e) => {
            this.state.world.showEulerPoles = (e.target as HTMLInputElement).checked;
            this.canvasManager?.render();
        });

        document.getElementById('check-future-features')?.addEventListener('change', (e) => {
            this.state.world.showFutureFeatures = (e.target as HTMLInputElement).checked;
            this.canvasManager?.render();
        });

        document.getElementById('check-show-paint')?.addEventListener('change', (e) => {
            this.state.world.showPaint = (e.target as HTMLInputElement).checked;
            this.canvasManager?.render();
        });

        // Erosion Multiplier
        document.getElementById('erosion-multiplier')?.addEventListener('change', (e) => {
             const val = parseFloat((e.target as HTMLInputElement).value);
             if (!isNaN(val) && val > 0) {
                 this.state.world.globalOptions.erosionMultiplier = val;
                 this.canvasManager?.render();
             }
        });

        document.getElementById('btn-reset-erosion')?.addEventListener('click', () => {
             this.state.world.globalOptions.erosionMultiplier = 1.0;
             const input = document.getElementById('erosion-multiplier') as HTMLInputElement;
             if (input) input.value = "1.0";
             this.canvasManager?.render();
        });


        // Automation Settings
        const updateAutomationBtn = () => {
             const btn = document.getElementById('btn-automation-menu');
             if (btn) {
                 const anyActive = this.state.world.globalOptions.enableHotspots || this.state.world.globalOptions.enableElevationSimulation;
                 if (anyActive) {
                     btn.style.backgroundColor = 'var(--color-success)';
                     btn.style.color = 'white';
                 } else {
                     btn.style.backgroundColor = '';
                     btn.style.color = '';
                 }
             }
        };

        document.getElementById('check-enable-hotspots')?.addEventListener('change', (e) => {
             const checked = (e.target as HTMLInputElement).checked;
             this.state.world.globalOptions.enableHotspots = checked;
             
             const subItem = (e.target as HTMLElement).closest('.view-dropdown-item')?.nextElementSibling as HTMLElement;
             if (subItem && subItem.classList.contains('view-dropdown-subitem')) {
                 subItem.style.display = checked ? 'flex' : 'none';
             }
             
             updateAutomationBtn();
             this.updateTimeDisplay();
        });

        document.getElementById('input-hotspot-rate')?.addEventListener('change', (e) => {
             const val = parseFloat((e.target as HTMLInputElement).value);
             if (!isNaN(val) && val > 0) {
                 this.state.world.globalOptions.hotspotSpawnRate = val;
             }
        });

        document.getElementById('check-enable-orogeny')?.addEventListener('change', (e) => {
             this.state.world.globalOptions.enableOrogeny = (e.target as HTMLInputElement).checked;
             // Show/hide sub-options
             const optionsDiv = document.getElementById('orogeny-options');
             if (optionsDiv) optionsDiv.style.display = (e.target as HTMLInputElement).checked ? 'block' : 'none';
             updateAutomationBtn();
             this.updateTimeDisplay();
        });

        // Elevation System controls
        document.getElementById('check-enable-elevation')?.addEventListener('change', (e) => {
            const enabled = (e.target as HTMLInputElement).checked;
            this.state.world.globalOptions.enableElevationSimulation = enabled;
            const optionsDiv = document.getElementById('elevation-options');
            if (optionsDiv) optionsDiv.style.display = enabled ? 'block' : 'none';
            updateAutomationBtn();
            
            if (!enabled) {
                // Clear all meshes immediately when disabling to save memory
                this.state.world.plates = this.state.world.plates.map(plate => ({
                    ...plate,
                    crustMesh: undefined,
                    elevationSimulatedTime: undefined
                }));
                this.showToast('Elevation meshes cleared', 1500);
            } else {
                this.showToast('Elevation simulation enabled - meshes will generate as time advances', 2500);
            }
            
            this.updateTimeDisplay();
        });

        document.getElementById('elevation-view-mode')?.addEventListener('change', (e) => {
            const value = (e.target as HTMLSelectElement).value as any;
            this.state.world.globalOptions.elevationViewMode = value;
            this.updateTimeDisplay();
        });

        document.getElementById('elevation-resolution')?.addEventListener('change', (e) => {
            const val = parseInt((e.target as HTMLInputElement).value);
            if (!isNaN(val) && val >= 50 && val <= 300) {
                this.state.world.globalOptions.meshResolution = val;
            }
        });

        document.getElementById('elevation-uplift')?.addEventListener('change', (e) => {
            const val = parseFloat((e.target as HTMLInputElement).value);
            if (!isNaN(val) && val >= 0) {
                this.state.world.globalOptions.upliftRate = val;
            }
        });

        document.getElementById('elevation-erosion')?.addEventListener('change', (e) => {
            const val = parseFloat((e.target as HTMLInputElement).value);
            if (!isNaN(val) && val >= 0) {
                this.state.world.globalOptions.erosionRate = val;
            }
        });

        document.getElementById('elevation-sediment-rate')?.addEventListener('change', (e) => {
            const val = parseFloat((e.target as HTMLInputElement).value);
            if (!isNaN(val) && val >= 0) {
                this.state.world.globalOptions.sedimentConsolidationRate = val;
            }
        });

        document.getElementById('elevation-sediment-ratio')?.addEventListener('change', (e) => {
            const val = parseFloat((e.target as HTMLInputElement).value);
            if (!isNaN(val) && val >= 0 && val <= 1) {
                this.state.world.globalOptions.sedimentConsolidationRatio = val;
            }
        });

        document.getElementById('btn-reset-elevation-defaults')?.addEventListener('click', () => {
            // Reset to default values
            this.state.world.globalOptions.meshResolution = 150;
            this.state.world.globalOptions.upliftRate = 1000;
            this.state.world.globalOptions.erosionRate = 0.001;
            this.state.world.globalOptions.sedimentConsolidationRate = 0.001;
            this.state.world.globalOptions.sedimentConsolidationRatio = 0.25;
            
            // Update UI inputs
            (document.getElementById('elevation-resolution') as HTMLInputElement).value = '150';
            (document.getElementById('elevation-uplift') as HTMLInputElement).value = '1000';
            (document.getElementById('elevation-erosion') as HTMLInputElement).value = '0.001';
            (document.getElementById('elevation-sediment-rate') as HTMLInputElement).value = '0.001';
            (document.getElementById('elevation-sediment-ratio') as HTMLInputElement).value = '0.25';
            
            this.showToast('Elevation parameters reset to defaults', 1500);
        });

        // Debug: Add Test Plume
        document.getElementById('btn-debug-spawn-plume')?.addEventListener('click', () => {
            // Add a plume at current viewport center? Or just (0,0)?
            // Let's use current center of projection
            const centerLat = this.state.viewport.rotate[1] * -1; // approx
            const centerLon = this.state.viewport.rotate[0] * -1;
            
            // For proper "Screen Center" we need inverse projection, but let's just stick to (0,0) or some random spot for now if complex.
            // Actually, let's just use (0,0) or the inverse of rotation.
            
            const newPlume = {
                id: generateId(),
                position: [centerLon, centerLat] as any, // Simple approx
                radius: 100,
                strength: 1,
                active: true
            };
            
            if (!this.state.world.mantlePlumes) {
                this.state.world.mantlePlumes = [];
            }
            this.state.world.mantlePlumes.push(newPlume);
            
            // alert(`Created Mantle Plume at [${centerLon.toFixed(1)}, ${centerLat.toFixed(1)}]. If you move a plate over this location, 'Hotspot Track' volcanoes will appear.`);
            this.canvasManager?.render();
        });

        // Paint tool controls
        document.getElementById('paint-color')?.addEventListener('change', (e) => {
            this.canvasManager?.setPaintColor((e.target as HTMLInputElement).value);
        });

        document.getElementById('paint-size')?.addEventListener('input', (e) => {
            const size = (e.target as HTMLInputElement).value;
            document.getElementById('paint-size-value')!.textContent = size;
            this.canvasManager?.setPaintSize(parseInt(size));
        });

        document.getElementById('paint-opacity')?.addEventListener('input', (e) => {
            const opacity = (e.target as HTMLInputElement).value;
            document.getElementById('paint-opacity-value')!.textContent = opacity;
            this.canvasManager?.setPaintOpacity(parseInt(opacity) / 100);
        });

        // Orogeny/Paint Ageing - Shared controls from Automation Menu
        const syncAgeingUI = () => {
             const g = this.state.world.globalOptions;
             const enabled = g.paintAgeingEnabled !== false;
             const autoDelete = g.paintAutoDelete === true;

             // Sync Paint Tool UI
             const cbPaint = document.getElementById('paint-ageing-enabled') as HTMLInputElement;
             if (cbPaint) cbPaint.checked = enabled;
             const divPaint = document.getElementById('paint-ageing-options');
             if (divPaint) {
                 divPaint.style.opacity = enabled ? '1' : '0.5';
                 divPaint.style.pointerEvents = enabled ? 'auto' : 'none';
             }
             const inPDur = document.getElementById('paint-ageing-duration') as HTMLInputElement;
             if (inPDur) inPDur.value = (g.paintAgeingDuration || 100).toString();
             const inPTrans = document.getElementById('paint-ageing-max-trans') as HTMLInputElement;
             if (inPTrans) inPTrans.value = Math.round((1.0 - (g.paintMaxWaitOpacity ?? 0.05)) * 100).toString();

             // Sync Paint Tool Auto-Delete
             const cbPaintDel = document.getElementById('paint-auto-delete') as HTMLInputElement;
             if (cbPaintDel) cbPaintDel.checked = autoDelete;
             const divPaintDel = document.getElementById('paint-auto-delete-options');
             if (divPaintDel) divPaintDel.style.display = autoDelete ? 'flex' : 'none';
             const inPaintDelDelay = document.getElementById('paint-delete-delay') as HTMLInputElement;
             if (inPaintDelDelay) inPaintDelDelay.value = (g.paintDeleteDelay || 50).toString();

             this.canvasManager?.render();
        };

        // Paint Tool Listeners (Synchronized)
        document.getElementById('paint-ageing-enabled')?.addEventListener('change', (e) => {
             const enabled = (e.target as HTMLInputElement).checked;
             if (!this.state.world.globalOptions) return;
             this.state.world.globalOptions.paintAgeingEnabled = enabled;
             syncAgeingUI();
        });

        document.getElementById('paint-ageing-duration')?.addEventListener('change', (e) => {
             const val = parseFloat((e.target as HTMLInputElement).value);
             if (!isNaN(val) && val > 0) {
                 this.state.world.globalOptions.paintAgeingDuration = val;
                 syncAgeingUI();
             }
        });

        document.getElementById('paint-ageing-max-trans')?.addEventListener('change', (e) => {
             const val = parseFloat((e.target as HTMLInputElement).value);
             if (!isNaN(val) && val >= 0 && val <= 100) {
                 this.state.world.globalOptions.paintMaxWaitOpacity = 1.0 - (val / 100.0);
                 syncAgeingUI();
             }
        });

        document.getElementById('paint-ageing-reset')?.addEventListener('click', () => {
             this.state.world.globalOptions.paintAgeingDuration = 100;
             this.state.world.globalOptions.paintMaxWaitOpacity = 0.05; // 95% trans
             // Reset delete defaults too? User didn't specify, but safer to leave alone or reset to 50
             this.state.world.globalOptions.paintAutoDelete = false;
             this.state.world.globalOptions.paintDeleteDelay = 50;
             syncAgeingUI();
        });

        document.getElementById('paint-auto-delete')?.addEventListener('change', (e) => {
             const enabled = (e.target as HTMLInputElement).checked;
             if (!this.state.world.globalOptions) return;
             this.state.world.globalOptions.paintAutoDelete = enabled;
             syncAgeingUI();
        });

        document.getElementById('paint-delete-delay')?.addEventListener('change', (e) => {
             const val = parseFloat((e.target as HTMLInputElement).value);
             if (!isNaN(val) && val >= 0) {
                 this.state.world.globalOptions.paintDeleteDelay = val;
                 syncAgeingUI();
             }
        });

        document.getElementById('paint-mode-brush')?.addEventListener('click', () => {
            this.canvasManager?.setPaintMode('brush');
            document.getElementById('paint-brush-options')!.style.display = 'flex';
            document.getElementById('paint-poly-options')!.style.display = 'none';
            document.getElementById('paint-mode-brush')!.style.background = '#3b82f6';
            document.getElementById('paint-mode-brush')!.style.color = 'white';
            document.getElementById('paint-mode-poly')!.classList.add('btn-secondary');
            document.getElementById('paint-mode-poly')!.style.background = '';
            document.getElementById('paint-mode-poly')!.style.color = '';
        });

        document.getElementById('paint-mode-poly')?.addEventListener('click', () => {
            this.canvasManager?.setPaintMode('poly_fill');
            document.getElementById('paint-brush-options')!.style.display = 'none';
            document.getElementById('paint-poly-options')!.style.display = 'flex';
            document.getElementById('paint-mode-poly')!.style.background = '#3b82f6';
            document.getElementById('paint-mode-poly')!.style.color = 'white';
            document.getElementById('paint-mode-poly')!.classList.remove('btn-secondary');
            document.getElementById('paint-mode-brush')!.style.background = '';
            document.getElementById('paint-mode-brush')!.style.color = '';
        });

        document.getElementById('paint-poly-color')?.addEventListener('change', (e) => {
            this.canvasManager?.setPolyFillColor((e.target as HTMLInputElement).value);
        });

        document.getElementById('paint-poly-opacity')?.addEventListener('input', (e) => {
            const opacity = (e.target as HTMLInputElement).value;
            document.getElementById('paint-poly-opacity-value')!.textContent = opacity;
            this.canvasManager?.setPolyFillOpacity(parseInt(opacity) / 100);
        });

        document.getElementById('paint-clear-plate')?.addEventListener('click', () => {
            if (this.state.world.selectedPlateId) {
                const plate = this.state.world.plates.find(p => p.id === this.state.world.selectedPlateId);
                if (plate) {
                    plate.paintStrokes = [];
                    this.pushState();
                    this.canvasManager?.render();
                }
            }
        });

        // Global Options
        // Advanced Toggles
        // Speed Preset Logic
        
        // 1. Toggle between Real World and Custom
        document.getElementById('check-use-custom-presets')?.addEventListener('change', (e) => {
            const isCustom = (e.target as HTMLInputElement).checked;
            const rwContainer = document.getElementById('preset-container-realworld');
            const customContainer = document.getElementById('preset-container-custom');
            if (rwContainer && customContainer) {
                rwContainer.style.display = isCustom ? 'none' : 'flex';
                customContainer.style.display = isCustom ? 'flex' : 'none';
            }
        });

        const speedCmInput = document.getElementById('speed-input-cm') as HTMLInputElement;
        const speedDegInput = document.getElementById('speed-input-deg') as HTMLInputElement;

        speedCmInput?.addEventListener('change', (e) => {
            const val = parseFloat((e.target as HTMLInputElement).value);
            if (!isNaN(val)) {
                const deg = this.convertCmYrToDegMa(val);
                if (speedDegInput) speedDegInput.value = deg.toFixed(2);
                this.applySpeedToSelected(deg);
            }
        });

        speedDegInput?.addEventListener('change', (e) => {
            const val = parseFloat((e.target as HTMLInputElement).value);
            if (!isNaN(val)) {
                const cm = this.convertDegMaToCmYr(val);
                if (speedCmInput) speedCmInput.value = cm.toFixed(2);
                this.applySpeedToSelected(val);
            }
        });

        document.getElementById('btn-reposition-pole-north')?.addEventListener('click', () => {
             const selectedPlateId = this.state.world.selectedPlateId;
             if (!selectedPlateId) {
                 alert("Please select a plate first.");
                 return;
             }
             
             const plate = this.state.world.plates.find(p => p.id === selectedPlateId);
             if (plate) {
                 this.pushState(); // Save state for undo
                 // Move pole to North Pole [0, 90]
                 const northPole: Coordinate = [0, 90];
                 this.addMotionKeyframe(plate.id, { ...plate.motion.eulerPole, position: northPole });
                 this.updatePropertiesPanel();
                 this.canvasManager?.render();
             }
        });

        document.getElementById('btn-reposition-pole-south')?.addEventListener('click', () => {
             const selectedPlateId = this.state.world.selectedPlateId;
             if (!selectedPlateId) {
                 alert("Please select a plate first.");
                 return;
             }
             
             const plate = this.state.world.plates.find(p => p.id === selectedPlateId);
             if (plate) {
                 this.pushState(); // Save state for undo
                 // Move pole to South Pole [0, -90]
                 const southPole: Coordinate = [0, -90];
                 this.addMotionKeyframe(plate.id, { ...plate.motion.eulerPole, position: southPole });
                 this.updatePropertiesPanel();
                 this.canvasManager?.render();
             }
        });

        // Edit Tool Controls
        document.getElementById('btn-edit-apply')?.addEventListener('click', () => {
             // Show Modal
             const modal = document.getElementById('apply-edit-modal');
             const lblTime = document.getElementById('lbl-current-time');
             if (modal && lblTime) {
                 lblTime.textContent = this.state.world.currentTime.toFixed(1);
                 modal.style.display = 'flex';
             }
        });

        const executeApply = (mode: 'generation' | 'event') => {
             if (!this.canvasManager) return;
             
             // Check for landmass edit first
             const landmassResult = this.canvasManager.getLandmassEditResult();
             if (landmassResult) {
                 // Apply landmass edit - GeoJSON format: coordinates are [lon, lat] tuples
                 // Remove the closing point (first = last in GeoJSON ring)
                 const coords = landmassResult.polygon.coordinates[0];
                 const newPolygon = coords.slice(0, -1) as Coordinate[];
                 
                 this.state.world.plates = this.state.world.plates.map(p => {
                     if (p.id === landmassResult.plateId && p.landmasses) {
                         return {
                             ...p,
                             landmasses: p.landmasses.map(l => {
                                 if (l.id === landmassResult.landmassId) {
                                     return { ...l, polygon: newPolygon };
                                 }
                                 return l;
                             })
                         };
                     }
                     return p;
                 });
                 
                 this.canvasManager.cancelLandmassEdit();
                 document.getElementById('edit-controls')!.style.display = 'none';
                 document.getElementById('apply-edit-modal')!.style.display = 'none';
                 this.canvasManager.render();
                 return;
             }
             
             // Plate edit
             const result = this.canvasManager.getEditResult();
             if (result) {
                 this.state.world.plates = this.state.world.plates.map(p => {
                     if (p.id === result.plateId) {
                         const copy = {...p};
                         copy.polygons = result.polygons; // Update current visual state immediately
                         
                         if (mode === 'generation') {
                             // --- REWRITE HISTORY STRATEGY ---
                             const dt = this.state.world.currentTime - p.birthTime;
                             const rate = p.motion.eulerPole.rate;
                             const angleDeg = rate * dt;
                             const angleRad = angleDeg * Math.PI / 180;
                             
                             const poleVec = latLonToVector(p.motion.eulerPole.position);
                             const invAngleRad = -angleRad;
                             
                             const newInitialPolys = result.polygons.map((poly: any) => {
                                 const newPoints = poly.points.map((pt: Coordinate) => {
                                     const v = latLonToVector(pt);
                                     const vRot = rotateVector(v, poleVec, invAngleRad);
                                     return vectorToLatLon(vRot);
                                 });
                                 return { ...poly, points: newPoints };
                             });
                             
                             copy.initialPolygons = newInitialPolys;

                             // CRITICAL: Propagate this base shape change to ALL future keyframes
                             // Keyframes store absolute snapshots. If we change the source truth, 
                             // we must update the snapshots to reflect "it was always this shape".
                             if (copy.motionKeyframes) {
                                 copy.motionKeyframes = copy.motionKeyframes.map(kf => {
                                     // Re-calculate snapshot for this keyframe time based on NEW initial polygons
                                     // Rotate from birthTime to keyframe.time
                                     const kfDt = kf.time - p.birthTime;
                                     const kfAngle = (rate * kfDt) * Math.PI / 180;
                                     // Rotate forward from new birth shape
                                     const newSnapshot = newInitialPolys.map((poly: Polygon) => ({
                                         ...poly,
                                         points: poly.points.map(pt => {
                                             const v = latLonToVector(pt);
                                             const vRot = rotateVector(v, poleVec, kfAngle);
                                             return vectorToLatLon(vRot);
                                         })
                                     }));
                                     
                                     return {
                                         ...kf,
                                         snapshotPolygons: newSnapshot
                                         // Features might need update too but let's stick to geometry first
                                     };
                                 });
                             }
                         } else {
                             // --- KEYFRAME EVENT STRATEGY ---
                             // Create a new keyframe at current time with the CURRENT polygons as snapshot
                             const newKeyframe: MotionKeyframe = {
                                 time: this.state.world.currentTime,
                                 label: 'Edit', // Explicit label for timeline
                                 eulerPole: p.motion.eulerPole, // Inherit current pole
                                 snapshotPolygons: JSON.parse(JSON.stringify(result.polygons)), // Snapshot current shape
                                 snapshotFeatures: [...p.features] // Snapshot current features
                             };
                             
                             if (!copy.motionKeyframes) copy.motionKeyframes = [];
                             copy.motionKeyframes.push(newKeyframe);
                             // Sort keyframes to be safe
                             copy.motionKeyframes.sort((a,b) => a.time - b.time);
                         }
                         return copy;
                     }
                     return p;
                 });
                 
                 this.canvasManager.cancelEdit();
                 document.getElementById('edit-controls')!.style.display = 'none';
                 document.getElementById('apply-edit-modal')!.style.display = 'none';

                 // FORCE SIMULATION UPDATE to reflect changes immediately
                 this.simulation?.setTime(this.state.world.currentTime);
                 
                 this.canvasManager.render();
             }
        };

        document.getElementById('btn-apply-generation')?.addEventListener('click', () => executeApply('generation'));
        document.getElementById('btn-apply-event')?.addEventListener('click', () => executeApply('event'));
        document.getElementById('btn-apply-cancel')?.addEventListener('click', () => {
             document.getElementById('apply-edit-modal')!.style.display = 'none';
        });

        document.getElementById('btn-edit-cancel')?.addEventListener('click', () => {
             if (this.canvasManager) {
                 this.canvasManager.cancelEdit();
                 this.canvasManager.cancelLandmassEdit();
             }
             document.getElementById('edit-controls')!.style.display = 'none';
        });

        // 2. Event Delegation for Presets
        document.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            
            // Real World Apply
            if (target.classList.contains('speed-preset-apply')) {
                const idx = parseInt(target.getAttribute('data-idx') || '0');
                const presets = this.getSpeedPresetData();
                const preset = presets[idx];
                if (preset) {
                    const rateDegMa = this.convertCmYrToDegMa(preset.speed);
                    this.applySpeedToSelected(rateDegMa);
                }
            }
            
            // Custom Preset Apply
            if (target.classList.contains('custom-preset-apply')) {
                const idx = parseInt(target.getAttribute('data-idx') || '0');
                const pList = this.state.world.globalOptions.ratePresets || [0.5, 1.0, 2.0, 5.0];
                const speedCmYr = pList[idx] || 0;
                const rateDegMa = this.convertCmYrToDegMa(speedCmYr);
                this.applySpeedToSelected(rateDegMa);
            }
            
            // Show info dialog
            // Handle clicking on the name itself which now has the class
            if (target.closest('.speed-preset-info')) {
                const el = target.closest('.speed-preset-info');
                if (el) {
                    const idx = parseInt(el.getAttribute('data-idx') || '0');
                    this.showPresetInfoDialog(idx);
                }
            }
        });
        
        // 3. Custom Preset Input Changes
        document.addEventListener('change', (e) => {
             const target = e.target as HTMLInputElement;
             if (target.classList.contains('custom-preset-input')) {
                 const idx = parseInt(target.getAttribute('data-idx') || '0');
                 const val = parseFloat(target.value);
                 if (!isNaN(val) && val >= 0) {
                     const current = [...(this.state.world.globalOptions.ratePresets || [0.5, 1.0, 2.0, 5.0])];
                     current[idx] = val;
                     this.state.world.globalOptions.ratePresets = current;
                     // We don't need to full updateUI here, just state update so it exports
                 }
             }
        });

        document.getElementById('check-boundary-vis')?.addEventListener('change', (e) => {
            this.state.world.globalOptions.enableBoundaryVisualization = (e.target as HTMLInputElement).checked;
        });

        // Image Overlay Controls
        document.getElementById('check-show-overlay')?.addEventListener('change', (e) => {
            if (this.state.world.imageOverlay) {
                this.state.world.imageOverlay.visible = (e.target as HTMLInputElement).checked;
                this.canvasManager?.render();
            }
        });

        document.getElementById('btn-upload-overlay')?.addEventListener('click', () => {
            document.getElementById('file-overlay-upload')?.click();
        });

        document.getElementById('file-overlay-upload')?.addEventListener('change', (e) => {
            const input = e.target as HTMLInputElement;
            const file = input.files?.[0];
            if (file) {
                // Check file size (max 5MB)
                const maxSize = 5 * 1024 * 1024; // 5MB
                if (file.size > maxSize) {
                    alert('Image file is too large. Maximum size is 5MB.');
                    input.value = '';
                    return;
                }

                const reader = new FileReader();
                reader.onload = (event) => {
                    const imageData = event.target?.result as string;

                    // Load image to check dimensions and potentially resize
                    const img = new Image();
                    img.onload = () => {
                        // Max dimension to balance quality with performance
                        const maxDimension = 2048;
                        let finalImageData = imageData;

                        // Scale down if image is too large
                        if (img.width > maxDimension || img.height > maxDimension) {
                            const canvas = document.createElement('canvas');
                            const ctx = canvas.getContext('2d');

                            const scale = Math.min(maxDimension / img.width, maxDimension / img.height);
                            canvas.width = img.width * scale;
                            canvas.height = img.height * scale;

                            ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);
                            finalImageData = canvas.toDataURL('image/jpeg', 0.9);

                            console.log(`Image scaled down from ${img.width}x${img.height} to ${canvas.width}x${canvas.height}`);
                        }

                        // Create overlay with fixed screen mode (as requested)
                        this.state.world.imageOverlay = {
                            imageData: finalImageData,
                            visible: true,
                            opacity: 0.5,
                            scale: 1.0,
                            offsetX: 0,
                            offsetY: 0,
                            rotation: 0,
                            mode: 'fixed'
                        };
                        const checkbox = document.getElementById('check-show-overlay') as HTMLInputElement;
                        if (checkbox) checkbox.checked = true;
                        this.canvasManager?.render();
                    };
                    img.src = imageData;
                };
                reader.readAsDataURL(file);
            }
            input.value = ''; // Reset input to allow same file re-upload
        });

        document.getElementById('overlay-opacity-slider')?.addEventListener('input', (e) => {
            const value = parseInt((e.target as HTMLInputElement).value);
            const valueLabel = document.getElementById('overlay-opacity-value');
            if (valueLabel) valueLabel.textContent = `${value}%`;
            if (this.state.world.imageOverlay) {
                this.state.world.imageOverlay.opacity = value / 100;
                this.canvasManager?.render();
            }
        });

        document.getElementById('btn-clear-overlay')?.addEventListener('click', () => {
            this.state.world.imageOverlay = undefined;
            const checkbox = document.getElementById('check-show-overlay') as HTMLInputElement;
            if (checkbox) checkbox.checked = false;
            this.canvasManager?.render();
        });

        // NEW: Timeline max-time control in footer
        document.getElementById('timeline-max-time')?.addEventListener('change', (e) => {
            const val = parseInt((e.target as HTMLInputElement).value);
            if (!isNaN(val) && val > 0) {
                this.state.world.globalOptions.timelineMaxTime = val;
                const slider = document.getElementById('time-slider') as HTMLInputElement;
                if (slider) {
                    slider.max = val.toString();
                    // If current time exceeds new max, clamp it
                    if (this.state.world.currentTime > val) {
                        this.simulation?.setTime(val);
                        this.updateTimeDisplay();
                    }
                }
            }
        });

        const radiusInput = document.getElementById('global-planet-radius') as HTMLInputElement;
        const radiusCheck = document.getElementById('check-custom-radius') as HTMLInputElement;

        radiusCheck?.addEventListener('change', (e) => {
            const checked = (e.target as HTMLInputElement).checked;
            if (radiusInput) {
                radiusInput.disabled = !checked;
                if (!checked) {
                    // Disable custom radius, show Earth default
                    this.state.world.globalOptions.customRadiusEnabled = false;
                    this.state.world.globalOptions.planetRadius = 6371;
                    radiusInput.value = "6371";
                    this.updateUI();
                } else {
                    // Enable custom radius, restore user value
                    this.state.world.globalOptions.customRadiusEnabled = true;
                    const customVal = this.state.world.globalOptions.customPlanetRadius || 6371;
                    radiusInput.value = customVal.toString();
                    this.state.world.globalOptions.planetRadius = customVal;
                    this.updateUI();
                }
            }
        });

        radiusInput?.addEventListener('change', (e) => {
            const val = parseFloat((e.target as HTMLInputElement).value);
            if (!isNaN(val) && val > 0) {
                this.state.world.globalOptions.customPlanetRadius = val;
                if (this.state.world.globalOptions.customRadiusEnabled) {
                    this.state.world.globalOptions.planetRadius = val;
                }
                this.updateUI(); // Refresh UI to update calculated stats
            }
        });

        // Ocean Level
        const oceanLevelInput = document.getElementById('global-ocean-level') as HTMLInputElement;
        const oceanLevelPreset = document.getElementById('global-ocean-level-preset') as HTMLSelectElement;
        
        oceanLevelPreset?.addEventListener('change', (e) => {
            const val = (e.target as HTMLSelectElement).value;
            if (val !== 'custom') {
                const numVal = parseFloat(val);
                this.state.world.globalOptions.oceanLevel = numVal;
                if (oceanLevelInput) {
                    oceanLevelInput.value = numVal.toString();
                }
                this.updateUI();
            }
        });
        
        oceanLevelInput?.addEventListener('change', (e) => {
            const val = parseFloat((e.target as HTMLInputElement).value);
            if (!isNaN(val)) {
                this.state.world.globalOptions.oceanLevel = val;
                // Set preset to 'custom' when manually editing
                if (oceanLevelPreset) {
                    oceanLevelPreset.value = 'custom';
                }
                this.updateUI();
            }
        });

        // Hotkeys
        document.addEventListener('keydown', (e) => {
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

            // Undo/Redo hotkeys
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
                e.preventDefault();
                if (e.shiftKey) {
                    this.redo();
                } else {
                    this.undo();
                }
                return;
            }
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
                e.preventDefault();
                this.redo();
                return;
            }

            // Layer Mode Toggle (Shift+L)
            if (e.shiftKey && e.key.toLowerCase() === 'l') {
                e.preventDefault();
                const newMode = this.state.world.layerMode === 'plate' ? 'landmass' : 'plate';
                this.setLayerMode(newMode);
                return;
            }

            switch (e.key.toLowerCase()) {
                case 'v': this.setActiveTool('select'); break;
                case 'h': this.setActiveTool('pan'); break; // Now Rotate/Pan
                case 'd': this.setActiveTool('draw'); break;
                case 'e': this.setActiveTool('edit'); break;
                case 'f': this.setActiveTool('feature'); break;
                case 's': this.setActiveTool('split'); break;
                case 'g': this.setActiveTool('fuse'); break;
                case 'l': this.setActiveTool('link'); break;
                case 't': this.setActiveTool('flowline'); break;
                case 'p': this.setActiveTool('paint'); break;
                case 'm': this.setActiveTool('mesh_edit'); break;
                case 'enter':
                    // Apply poly fill if in poly fill mode
                    this.canvasManager?.applyPaintPolyFill();
                    break;
                case 'escape':
                    this.canvasManager?.cancelDrawing();
                    break;
                case ' ':
                    e.preventDefault();
                    this.simulation?.toggle();
                    this.updatePlayButton();
                    break;
                case 'delete':
                case 'backspace':
                    this.deleteSelected();
                    break;
                case '+':
                case '=':
                    // Raise selected vertex elevation
                    if (this.state.activeTool === 'mesh_edit' && this.state.world.selectedVertexId) {
                        this.adjustSelectedVertexElevation(500);
                    }
                    break;
                case '-':
                case '_':
                    // Lower selected vertex elevation
                    if (this.state.activeTool === 'mesh_edit' && this.state.world.selectedVertexId) {
                        this.adjustSelectedVertexElevation(-500);
                    }
                    break;
            }
        });

        // Timeline
        document.getElementById('btn-play')?.addEventListener('click', () => {
            this.simulation?.toggle();
            this.updatePlayButton();
        });

        document.getElementById('speed-select')?.addEventListener('change', (e) => {
            const speed = parseFloat((e.target as HTMLSelectElement).value);
            this.simulation?.setTimeScale(speed);
        });

        document.getElementById('time-slider')?.addEventListener('input', (e) => {
            const newTime = parseFloat((e.target as HTMLInputElement).value);
            const currentTime = this.state.world.currentTime;
            
            // Show feedback when scrubbing backward with elevation enabled
            if (this.state.world.globalOptions.enableElevationSimulation && newTime < currentTime) {
                const hasAnyMesh = this.state.world.plates.some(p => p.crustMesh && p.crustMesh.length > 0);
                if (hasAnyMesh) {
                    this.showToast('Resetting elevation meshes...', 1500);
                }
            }
            
            this.simulation?.setTime(newTime);
            this.updateTimeDisplay();
        });

        document.getElementById('btn-reset-time')?.addEventListener('click', () => {
            this.simulation?.setTime(0);
            this.updateTimeDisplay();
        });

        // NEW: Time mode toggle (Positive/Negative/Ago)
        document.getElementById('check-time-mode')?.addEventListener('change', (e) => {
            const isChecked = (e.target as HTMLInputElement).checked;
            this.state.world.timeMode = isChecked ? 'negative' : 'positive';
            this.updateTimeDisplay();
            // Refresh property panels to show transformed time values
            this.updatePropertiesPanel();
            this.bindFeatureEvents();
            this.canvasManager?.render();
        });

        // NEW: Clickable current time to set value
        document.getElementById('current-time')?.addEventListener('click', () => {
            const modal = document.getElementById('time-input-modal');
            const input = document.getElementById('time-input-field') as HTMLInputElement;
            if (modal && input) {
                modal.style.display = 'flex';
                
                // Pre-populate with current display time
                const maxTimeInput = document.getElementById('timeline-max-time') as HTMLInputElement;
                const maxTime = maxTimeInput ? parseInt(maxTimeInput.value) : 500;
                const displayTime = toDisplayTime(this.state.world.currentTime, {
                    maxTime: maxTime,
                    mode: this.state.world.timeMode
                });
                input.value = displayTime.toString();
                input.focus();
                input.select();
            }
        });

        // Modal confirm button
        document.getElementById('btn-time-input-confirm')?.addEventListener('click', () => {
            this.confirmTimeInput();
        });

        // Modal cancel button
        document.getElementById('btn-time-input-cancel')?.addEventListener('click', () => {
            const modal = document.getElementById('time-input-modal');
            if (modal) modal.style.display = 'none';
        });

        // Allow Enter key to confirm
        document.getElementById('time-input-field')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                this.confirmTimeInput();
            } else if (e.key === 'Escape') {
                const modal = document.getElementById('time-input-modal');
                if (modal) modal.style.display = 'none';
            }
        });

        document.getElementById('btn-export')?.addEventListener('click', async () => {
            const options = await showPNGExportDialog(this.state.world.projection);
            if (options) {
                exportToPNG(this.state, options);
            }
        });

        // Unified Export Handler
        document.getElementById('btn-export')?.addEventListener('click', async () => {
            try {
                const options = await showUnifiedExportDialog();
                if (!options) return;

                if (options.format === 'png') {
                    // PNG Export
                    const pngOptions = {
                        projection: options.projection || 'orthographic',
                        waterMode: 'color' as const,
                        plateColorMode: 'native' as const,
                        showGrid: false
                    };
                    exportToPNG(this.state, pngOptions, options.width || 1920, options.height || 1080);
                } else if (options.format === 'heightmap') {
                    // Heightmap Export
                    const dataUrl = await HeightmapGenerator.generate(this.state, {
                        width: options.width || 4096,
                        height: options.height || 2048,
                        projection: options.projection || 'equirectangular',
                        smooth: true
                    });
                    const link = document.createElement('a');
                    link.download = `tectolite-heightmap-${Date.now()}.png`;
                    link.href = dataUrl;
                    link.click();
                } else if (options.format === 'qgis') {
                    // GeoPackage (QGIS) Export
                    const exporter = new GeoPackageExporter(this.state, {
                        width: options.width || 2048,
                        height: options.height || 1024,
                        projection: options.projection || 'equirectangular',
                        includeHeightmap: options.includeHeightmap ?? true
                    });
                    await exporter.export();
                }
            } catch (e) {
                console.error('Export failed', e);
                alert(`Export failed: ${e instanceof Error ? e.message : 'Unknown error'}`);
            }
        });

        // Split control buttons
        document.getElementById('btn-split-apply')?.addEventListener('click', () => {
            this.canvasManager?.applySplit();
        });

        document.getElementById('btn-split-cancel')?.addEventListener('click', () => {
            this.canvasManager?.cancelSplit();
        });

        // Motion control buttons
        document.getElementById('btn-motion-apply')?.addEventListener('click', () => {
            this.canvasManager?.applyMotion();
        });

        document.getElementById('btn-motion-cancel')?.addEventListener('click', () => {
            this.canvasManager?.cancelMotion();
        });

        // Undo/Redo buttons
        document.getElementById('btn-undo')?.addEventListener('click', () => {
            this.undo();
        });

        document.getElementById('btn-redo')?.addEventListener('click', () => {
            this.redo();
        });

        // Export/Import JSON buttons
        document.getElementById('btn-export-json')?.addEventListener('click', () => {
            exportToJSON(this.state);
        });

        document.getElementById('btn-import-json')?.addEventListener('click', () => {
            document.getElementById('file-import')?.click();
        });

        document.getElementById('file-import')?.addEventListener('change', async (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (file) {
                try {
                    // Parse file first to get metadata for the dialog
                    const { world: importedWorld, viewport: importedViewport, name: filename } = await parseImportFile(file);
                    const currentTime = this.state.world.currentTime;

                    // Show import dialog
                    const importMode = await showImportDialog(
                        filename,
                        importedWorld.plates.length,
                        currentTime
                    );

                    if (!importMode) {
                        // User cancelled
                        (e.target as HTMLInputElement).value = '';
                        return;
                    }

                    this.pushState(); // Save current state before adding

                    // Calculate time offset based on import mode
                    const timeOffset = importMode === 'at_current_time' ? currentTime : 0;

                    // Generate new IDs for imported plates and features to avoid collisions
                    const idMap = new Map<string, string>(); // oldId -> newId

                    const processedPlates = importedWorld.plates.map(plate => {
                        const newPlateId = generateId();
                        idMap.set(plate.id, newPlateId);

                        // Helper to adjust feature timestamps
                        const adjustFeatureTime = (f: Feature): Feature => ({
                            ...f,
                            id: generateId(),
                            generatedAt: f.generatedAt !== undefined ? f.generatedAt + timeOffset : timeOffset,
                            deathTime: f.deathTime !== undefined ? f.deathTime + timeOffset : undefined
                        });

                        // Process polygons with new IDs
                        const newPolygons = plate.polygons.map(p => ({
                            ...p,
                            id: generateId()
                        }));

                        // Process features with new IDs and adjusted times
                        const newFeatures = plate.features.map(adjustFeatureTime);

                        // Process initial polygons and features
                        const newInitialPolygons = plate.initialPolygons.map(p => ({
                            ...p,
                            id: generateId()
                        }));

                        const newInitialFeatures = plate.initialFeatures.map(adjustFeatureTime);

                        // Process motion keyframes with adjusted times
                        const newKeyframes = plate.motionKeyframes.map(kf => ({
                            ...kf,
                            time: kf.time + timeOffset, // Shift keyframe time
                            snapshotPolygons: kf.snapshotPolygons.map(p => ({ ...p, id: generateId() })),
                            snapshotFeatures: kf.snapshotFeatures.map(adjustFeatureTime)
                        }));

                        return {
                            ...plate,
                            id: newPlateId,
                            polygons: newPolygons,
                            features: newFeatures,
                            initialPolygons: newInitialPolygons,
                            initialFeatures: newInitialFeatures,
                            motionKeyframes: newKeyframes
                        };
                    });

                    // Update State
                    this.state = {
                        ...this.state,
                        world: {
                            ...this.state.world,
                            plates: importMode === 'at_beginning'
                                ? [...this.state.world.plates, ...processedPlates]
                                : [...this.state.world.plates, ...processedPlates]
                        }
                    };

                    // Restoring Settings Logic
                    if (importedWorld.globalOptions) {
                        this.state.world.globalOptions = {
                            ...this.state.world.globalOptions,
                            ...importedWorld.globalOptions
                        };
                    }
                    if (importedWorld.projection) this.state.world.projection = importedWorld.projection;
                    if (importedWorld.showGrid !== undefined) this.state.world.showGrid = importedWorld.showGrid;
                    if (importedWorld.showFeatures !== undefined) this.state.world.showFeatures = importedWorld.showFeatures;
                    if (importedWorld.showFutureFeatures !== undefined) this.state.world.showFutureFeatures = importedWorld.showFutureFeatures;

                    // Restore Camera/Viewport if exists
                    if (importedViewport) {
                        this.state.viewport = importedViewport;
                    }

                    this.updateExplorer();
                    this.updateUI();
                    this.syncUIToState();
                    this.canvasManager?.render();

                    const modeDesc = importMode === 'at_beginning' ? 'at time 0' : `at time ${currentTime.toFixed(1)} Ma`;
                    alert(`Successfully imported ${processedPlates.length} plate(s) ${modeDesc}!`);

                    // Cleanup
                    (e.target as HTMLInputElement).value = '';

                } catch (err) {
                    console.error(err);
                    alert('Failed to load file: ' + (err as Error).message);
                    (e.target as HTMLInputElement).value = '';
                }
            }
        });

        document.getElementById('btn-legend')?.addEventListener('click', () => {
            this.showLegendDialog();
        });

        document.getElementById('btn-theme-toggle')?.addEventListener('click', () => {
            this.toggleTheme();
        });
    }

    private toggleTheme(): void {
        const isDark = document.body.getAttribute('data-theme') !== 'light';
        const newTheme = isDark ? 'light' : 'dark';

        document.body.setAttribute('data-theme', newTheme);
        localStorage.setItem('theme', newTheme);

        this.canvasManager?.setTheme(newTheme);

        const btn = document.getElementById('btn-theme-toggle');
        if (btn) {
            const icon = btn.querySelector('.icon');
            if (icon) icon.textContent = newTheme === 'light' ? '☀️' : '🌙';
        }

        // Force re-render
        this.canvasManager?.render();
    }

    private showLegendDialog(): void {
        const overlay = document.createElement('div');
        overlay.style.cssText = `
          position: fixed; top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(0,0,0,0.6); z-index: 10000;
          display: flex; align-items: center; justify-content: center;
      `;

        const dialog = document.createElement('div');
        dialog.style.cssText = `
          background: #1e1e2e; border: 1px solid var(--border-default); border-radius: 8px; padding: 20px;
          min-width: 400px; color: var(--text-primary); font-family: system-ui, sans-serif;
          box-shadow: 0 10px 40px rgba(0,0,0,0.6); display: flex; flex-direction: column; gap: 16px;
      `;

        dialog.innerHTML = `
          <h3 style="margin: 0; color: var(--text-primary); font-size: 18px; border-bottom: 1px solid var(--border-default); padding-bottom: 12px;">🗺️ Map Legend</h3>
          
          <div style="margin-bottom: 10px;">
              <h4 style="margin: 0 0 8px 0; color: #fab387; font-size: 14px;">Boundaries</h4>
              <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px; font-size: 13px;">
                  <span style="width: 20px; height: 3px; background: #ff3333; display: inline-block; border-radius: 2px;"></span>
                  <span><strong>Convergent</strong> (Collision)</span>
              </div>
              <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px; font-size: 13px;">
                  <span style="width: 20px; height: 3px; background: #3333ff; display: inline-block; border-radius: 2px;"></span>
                  <span><strong>Divergent</strong> (Rifting)</span>
              </div>
              <div style="display: flex; align-items: center; gap: 8px; font-size: 13px;">
                  <span style="width: 20px; height: 3px; background: #33ff33; display: inline-block; border-radius: 2px;"></span>
                  <span><strong>Transform</strong> (Sliding)</span>
              </div>
              <div style="font-size: 11px; color: var(--text-secondary); margin-top: 8px; font-style: italic;">
                  *Boundaries only appear when plates overlap/touch AND have velocity.
              </div>
          </div>

          <div style="margin-bottom: 10px;">
              <h4 style="margin: 0 0 8px 0; color: #a6e3a1; font-size: 14px;">Features</h4>
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 13px;">
                  <div style="display:flex; align-items:center; gap:6px;"><span>🏔️</span> Mountain</div>
                  <div style="display:flex; align-items:center; gap:6px;"><span>🌋</span> Volcano</div>
                  <div style="display:flex; align-items:center; gap:6px;"><span>⚡</span> Rift</div>
                  <div style="display:flex; align-items:center; gap:6px;"><span>🏝️</span> Island</div>
              </div>
          </div>

          <div style="display: flex; justify-content: flex-end; border-top: 1px solid var(--border-default); padding-top: 16px;">
              <button id="legend-close" class="btn btn-secondary" style="padding: 8px 16px;">Close</button>
          </div>
      `;

        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        const cleanup = () => document.body.removeChild(overlay);
        dialog.querySelector('#legend-close')?.addEventListener('click', cleanup);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(); });
    }

    private getSpeedPresetData() {
        return [
            { name: 'East Pacific Rise', speed: 15, unit: 'cm/yr', type: 'Spreading Center', details: '<strong>Location:</strong> South Pacific Ocean (between the Pacific and Nazca plates).<br><br><strong>Context:</strong> This is the fastest spreading center on Earth. The plates here rip apart so quickly that the "gap" is filled by smooth volcanic domes rather than a deep valley.' },
            { name: 'Cocos Plate', speed: 8.5, unit: 'cm/yr', type: 'Absolute Motion', details: '<strong>Location:</strong> Off the west coast of Central America.<br><br><strong>Context:</strong> It is crashing into the Caribbean plate, creating the string of volcanoes in Costa Rica and Guatemala.' },
            { name: 'Australia', speed: 7.0, unit: 'cm/yr', type: 'Continental Drift', details: '<strong>Location:</strong> The entire continent of Australia.<br><br><strong>Context:</strong> Australia is the fastest-moving continent, racing north toward Asia. (GPS systems in Australia actually have to be adjusted periodically to account for this rapid drift).' },
            { name: 'India (Himalayas)', speed: 5.5, unit: 'cm/yr', type: 'Collision', details: '<strong>Location:</strong> India.<br><br><strong>Context:</strong> India is still ramming into Asia. This speed is fast for a continental collision, which is why the Himalayas are still rising today.' },
            { name: 'San Andreas Fault', speed: 3.0, unit: 'cm/yr', type: 'Transform Boundary', details: '<strong>Location:</strong> California, USA.<br><br><strong>Context:</strong> The Pacific plate sliding past the North American plate.' },
            { name: 'Mid-Atlantic Ridge', speed: 2.5, unit: 'cm/yr', type: 'Spreading (Slow)', details: '<strong>Location:</strong> Down the center of the Atlantic Ocean.' },
            { name: 'Eurasia', speed: 0.95, unit: 'cm/yr', type: 'Absolute Motion', details: '<strong>Location:</strong> Europe and Asia.<br><br><strong>Context:</strong> One of the slowest plates on Earth.' }
        ];
    }

    private generateRealWorldPresetList(): string {
        const presets = this.getSpeedPresetData();
        return presets.map((preset, idx) => `
            <div style="display:grid; grid-template-columns: 1fr auto; gap:4px; align-items:center; background:#1e1e2e; border-radius:4px; padding:4px;">
                <div style="display:flex; align-items:center; gap:4px; overflow:hidden; cursor:pointer;" class="speed-preset-info" data-idx="${idx}" title="Click for details">
                    <span style="font-size:11px; color:#89b4fa; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; text-decoration:underline; text-decoration-color: #45475a;">${preset.name}</span>
                </div>
                <button class="speed-preset-apply" data-idx="${idx}" style="
                    background:#313244; border:1px solid #45475a; border-radius:3px;
                    padding:2px 8px; cursor:pointer; color:#89b4fa; font-size:11px;
                    transition:all 0.2s; min-width:60px;
                " title="Apply speed">${preset.speed}</button>
            </div>
        `).join('');
    }

    private generateCustomPresetList(): string {
        const presets = this.state.world.globalOptions.ratePresets || [0.5, 1.0, 2.0, 5.0];
        // Ensure always 4 slots
        const slots = Array(4).fill(0).map((_, i) => presets[i] ?? (i + 1));
        
        return slots.map((val, idx) => `
            <div style="display:flex; align-items:center; gap:6px;">
                 <label style="font-size:10px; color:#a6adc8; width:15px;">#${idx + 1}</label>
                 <input type="number" class="custom-preset-input property-input" data-idx="${idx}" value="${val}" step="0.1" style="flex:1;">
                 <button class="custom-preset-apply" data-idx="${idx}" style="
                    background:#313244; border:1px solid #45475a; border-radius:4px;
                    padding:4px 8px; cursor:pointer; color:#89b4fa; font-size:10px;
                 ">Apply</button>
            </div>
        `).join('');
    }

    private applySpeedToSelected(rate: number): void {
        const plate = this.state.world.selectedPlateId 
            ? this.state.world.plates.find(p => p.id === this.state.world.selectedPlateId)
            : null;
        if (plate) {
            plate.motion.eulerPole.rate = rate;
            this.updatePropertiesPanel();
            this.updateSpeedInputsFromSelected();
            this.canvasManager?.render();
            this.pushState();
        } else {
            alert('Please select a plate first to apply this speed preset.');
        }
    }

    private convertCmYrToDegMa(cmPerYr: number): number {
        const radiusKm = this.state.world.globalOptions.planetRadius || 6371;
        const kmPerMa = cmPerYr * 10; // 1 km/Ma = 0.1 cm/yr
        const radPerMa = radiusKm > 0 ? (kmPerMa / radiusKm) : 0;
        return radPerMa * (180 / Math.PI);
    }

    private convertDegMaToCmYr(degPerMa: number): number {
        const radiusKm = this.state.world.globalOptions.planetRadius || 6371;
        const radPerMa = degPerMa * Math.PI / 180;
        const kmPerMa = radPerMa * radiusKm;
        return kmPerMa / 10; // cm/yr
    }

    private updateSpeedInputsFromSelected(): void {
        const cmInput = document.getElementById('speed-input-cm') as HTMLInputElement;
        const degInput = document.getElementById('speed-input-deg') as HTMLInputElement;
        if (!cmInput || !degInput) return;

        const plate = this.state.world.selectedPlateId 
            ? this.state.world.plates.find(p => p.id === this.state.world.selectedPlateId)
            : null;

        if (!plate) {
            cmInput.value = '';
            degInput.value = '';
            cmInput.disabled = true;
            degInput.disabled = true;
            return;
        }

        cmInput.disabled = false;
        degInput.disabled = false;
        const deg = plate.motion.eulerPole.rate || 0;
        const cm = this.convertDegMaToCmYr(deg);
        degInput.value = deg.toFixed(2);
        cmInput.value = cm.toFixed(2);
    }

    private showPresetInfoDialog(idx: number): void {
        const presets = this.getSpeedPresetData();
        const preset = presets[idx];
        if (!preset) return;

        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position: fixed; top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.7); z-index: 10000;
            display: flex; align-items: center; justify-content: center;
            padding: 20px;
        `;

        const dialog = document.createElement('div');
        dialog.style.cssText = `
            background: #1e1e2e; border-radius: 12px; padding: 24px;
            max-width: 500px; width: 100%; color: #cdd6f4; font-family: system-ui, sans-serif;
            box-shadow: 0 8px 32px rgba(0,0,0,0.4);
        `;

        dialog.innerHTML = `
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:16px;">
                <h3 style="margin:0; color:#89b4fa; font-size:18px;">${preset.name}</h3>
                <div style="font-size:16px; color:#f38ba8; font-weight:600;">${preset.speed} ${preset.unit}</div>
            </div>
            <div style="margin-bottom:12px; padding:8px 12px; background:#313244; border-radius:6px; border-left:3px solid #89b4fa;">
                <div style="font-size:11px; color:#a6adc8; text-transform:uppercase; font-weight:600; margin-bottom:4px;">Type</div>
                <div style="font-size:14px; color:#cdd6f4;">${preset.type}</div>
            </div>
            <div style="font-size:13px; color:#bac2de; line-height:1.6;">
                ${preset.details}
            </div>
            <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:20px;">
                <button id="preset-info-apply" style="padding:8px 16px; border:1px solid #89b4fa; border-radius:6px; background:#313244; color:#89b4fa; cursor:pointer; font-weight:500;">Apply Speed</button>
                <button id="preset-info-close" style="padding:8px 16px; border:1px solid #45475a; border-radius:6px; background:#313244; color:#cdd6f4; cursor:pointer;">Close</button>
            </div>
        `;

        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        const cleanup = () => document.body.removeChild(overlay);
        
        dialog.querySelector('#preset-info-close')?.addEventListener('click', cleanup);
        dialog.querySelector('#preset-info-apply')?.addEventListener('click', () => {
            const rateDegMa = this.convertCmYrToDegMa(preset.speed);
            const plate = this.state.world.selectedPlateId 
                ? this.state.world.plates.find(p => p.id === this.state.world.selectedPlateId)
                : null;
            if (plate) {
                plate.motion.eulerPole.rate = rateDegMa;
                this.updatePropertiesPanel();
                this.canvasManager?.render();
                this.pushState();
                cleanup();
            } else {
                alert('Please select a plate first to apply this speed preset.');
            }
        });
        overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(); });
    }

    private syncUIToState(): void {
        const w = this.state.world;
        const globalOptions = this.state.world.globalOptions;

        const checkShowHints = document.getElementById('check-show-hints') as HTMLInputElement;
        if (checkShowHints) checkShowHints.checked = globalOptions.showHints !== false;
        const g = w.globalOptions;

        // View Option Checkboxes
        (document.getElementById('check-grid') as HTMLInputElement).checked = w.showGrid;

        // Grid Thickness Select
        // Convert number to string for select value
        const thickSelect = document.getElementById('grid-thickness-select') as HTMLSelectElement;
        if (thickSelect) thickSelect.value = w.globalOptions.gridThickness.toString();

        (document.getElementById('check-euler-poles') as HTMLInputElement).checked = w.showEulerPoles;
        (document.getElementById('check-features') as HTMLInputElement).checked = w.showFeatures;
        (document.getElementById('check-future-features') as HTMLInputElement).checked = w.showFutureFeatures;
        (document.getElementById('check-show-paint') as HTMLInputElement).checked = w.showPaint;

        // Global Options
        const maxTimeInput = document.getElementById('timeline-max-time') as HTMLInputElement;
        if (maxTimeInput && g.timelineMaxTime) {
            maxTimeInput.value = g.timelineMaxTime.toString();
            maxTimeInput.dispatchEvent(new Event('change'));
        }
        // For now, assume it's not state-persisted or I need to add it.

        const radiusInput = document.getElementById('global-planet-radius') as HTMLInputElement;
        const radiusCheck = document.getElementById('check-custom-radius') as HTMLInputElement;
        if (radiusInput && radiusCheck) {
            const enabled = !!g.customRadiusEnabled;
            radiusCheck.checked = enabled;
            radiusInput.disabled = !enabled;
            if (enabled) {
                const customVal = g.customPlanetRadius || g.planetRadius || 6371;
                radiusInput.value = customVal.toString();
                g.planetRadius = customVal;
            } else {
                radiusInput.value = '6371';
                g.planetRadius = 6371;
            }
        }

        (document.getElementById('check-boundary-vis') as HTMLInputElement).checked = !!g.enableBoundaryVisualization;

        // Rate Presets (Custom)
        if (g.ratePresets && g.ratePresets.length === 4) {
            const inputs = document.querySelectorAll('.custom-preset-input');
            inputs.forEach((input) => {
                const idx = parseInt(input.getAttribute('data-idx') || '0');
                if (g.ratePresets && g.ratePresets[idx] !== undefined) {
                    (input as HTMLInputElement).value = g.ratePresets[idx].toString();
                }
            });
        }


        // Projection Select
        const projSelect = document.getElementById('projection-select') as HTMLSelectElement;
        if (projSelect) projSelect.value = w.projection;

        // Sync Paint Ageing Options
        const paintAgeingEnabled = g.paintAgeingEnabled !== false; // Default true
        const cbAgeing = document.getElementById('paint-ageing-enabled') as HTMLInputElement;
        if (cbAgeing) {
            cbAgeing.checked = paintAgeingEnabled;
            const optionsDiv = document.getElementById('paint-ageing-options');
            if (optionsDiv) optionsDiv.style.opacity = paintAgeingEnabled ? '1' : '0.5';
            if (optionsDiv) optionsDiv.style.pointerEvents = paintAgeingEnabled ? 'auto' : 'none';
        }

        const inputAgeingDuration = document.getElementById('paint-ageing-duration') as HTMLInputElement;
        if (inputAgeingDuration) {
             inputAgeingDuration.value = (g.paintAgeingDuration || 100).toString();
        }

        const inputAgeingTrans = document.getElementById('paint-ageing-max-trans') as HTMLInputElement;
        if (inputAgeingTrans) {
             // Convert opacity to transparency %
             const opacity = g.paintMaxWaitOpacity !== undefined ? g.paintMaxWaitOpacity : 0.05;
             const trans = Math.round((1.0 - opacity) * 100);
             inputAgeingTrans.value = trans.toString();
        }
    }

    private updateUI(): void {
        this.updateToolbarState();
        this.updateExplorer();
        this.updatePropertiesPanel();
        this.updateSpeedInputsFromSelected();
        this.updatePlayButton();
        this.updateTimeDisplay();
    }

    private setActiveTool(tool: ToolType): void {
        this.state.activeTool = tool;
        this.updateToolbarState();

        const featureSelector = document.getElementById('feature-selector');
        if (featureSelector) {
            featureSelector.style.display = tool === 'feature' ? 'block' : 'none';
        }

        const paintControls = document.getElementById('paint-controls');
        if (paintControls) {
            paintControls.style.display = tool === 'paint' ? 'flex' : 'none';
        }

        const editControls = document.getElementById('edit-controls');
        if (editControls && tool !== 'edit') {
            editControls.style.display = 'none';
            if (this.canvasManager) {
                this.canvasManager.cancelEdit();
                this.canvasManager.cancelLandmassEdit();
            }
        }

        // Set initial Stage 1 hint/tooltip
        let hintText = "";
        switch (tool) {
            case 'select':
                hintText = "Click a plate or feature to select it.";
                break;
            case 'pan':
                hintText = "Drag to rotate the globe. Scroll to zoom.";
                break;
            case 'edit':
                hintText = "Select a plate, then drag edges to add points or drag vertices to move.";
                break;
            case 'draw':
                hintText = "Click anywhere to start drawing a new plate.";
                break;
            case 'feature':
                hintText = "Pick a feature type from Tool Options.";
                break;
            case 'poly_feature':
                hintText = "Click anywhere to start drawing a custom region feature.";
                break;
            case 'split':
                hintText = "Click a plate to start splitting.";
                break;
            case 'fuse':
                hintText = "Select first plate to fuse.";
                break;
            case 'link':
                hintText = "Select first plate to link.";
                break;
            case 'paint':
                hintText = "Select a plate, then draw on it with the brush. Adjust size and color in Tool Options.";
                break;
            case 'flowline':
                hintText = "Click on a plate to place a flowline seed.";
                break;
            case 'mesh_edit':
                hintText = "Click on a vertex to select and inspect it. Use +/- keys to adjust elevation by 500m. Edit details in properties panel.";
                break;
        }

        this.updateHint(hintText);
    }

    private setLayerMode(mode: LayerMode): void {
        this.state.world.layerMode = mode;
        this.updateLayerModeUI();
        
        // Update hint based on mode
        const tool = this.state.activeTool;
        let hintText = "";
        
        if (mode === 'landmass') {
            switch (tool) {
                case 'draw':
                    hintText = "🏝️ LANDMASS MODE: Click to draw a new landmass on the selected plate.";
                    break;
                case 'edit':
                    hintText = "🏝️ LANDMASS MODE: Drag landmass vertices to reshape coastlines.";
                    break;
                case 'paint':
                    hintText = "🏝️ LANDMASS MODE: Paint will be clipped to selected landmass.";
                    break;
                case 'select':
                    hintText = "🏝️ LANDMASS MODE: Click to select a landmass polygon.";
                    break;
                default:
                    hintText = `🏝️ LANDMASS MODE active. Tool: ${tool}`;
            }
        } else {
            // Re-trigger standard hint
            this.setActiveTool(tool);
            return;
        }
        
        this.updateHint(hintText);
    }

    private updateLayerModeUI(): void {
        const plateBtn = document.getElementById('layer-mode-plate');
        const landmassBtn = document.getElementById('layer-mode-landmass');
        
        if (plateBtn && landmassBtn) {
            if (this.state.world.layerMode === 'plate') {
                plateBtn.className = 'btn btn-primary';
                landmassBtn.className = 'btn btn-secondary';
            } else {
                plateBtn.className = 'btn btn-secondary';
                landmassBtn.className = 'btn btn-primary';
            }
        }
    }

    private setActiveFeature(feature: FeatureType): void {
        this.state.activeFeatureType = feature;
        this.updateToolbarState();

        const typeLabel = feature.charAt(0).toUpperCase() + feature.slice(1);
        this.updateHint(`Click on a plate to place a ${typeLabel}.`);
        document.querySelectorAll('.feature-btn').forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('data-feature') === feature);
        });
    }

    private handleDrawUpdate(count: number): void {
        const tool = this.state.activeTool;
        if (tool === 'draw') {
            if (count > 0) {
                this.updateHint("Click to add points. Double-click/Enter to finish. Right-click to undo last placement.");
            } else {
                this.updateHint("Click anywhere to start drawing a new plate.");
            }
        } else if (tool === 'split') {
            if (count === 1) {
                this.updateHint("Click a boundary point to start split line.");
            } else if (count >= 2) {
                this.updateHint("Click another boundary point. Use 'Apply' to split.");
            } else {
                this.updateHint("Click a plate to start splitting.");
            }
        }
    }

    private updateToolbarState(): void {
        document.querySelectorAll('.tool-btn').forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('data-tool') === this.state.activeTool);
        });
    }

    private handleDrawComplete(points: Coordinate[]): void {
        if (points.length < 3) return;
        
        // Check if we're in Landmass mode
        if (this.state.world.layerMode === 'landmass') {
            this.handleLandmassDrawComplete(points);
            return;
        }
        
        this.pushState(); // Save state for undo

        // Create Polygon
        const polygon: Polygon = {
            id: generateId(),
            points: points,
            closed: true
        };

        const currentTime = this.state.world.currentTime;
        const defaultMotion = createDefaultMotion();

        // Create initial keyframe at birth time
        const initialKeyframe: MotionKeyframe = {
            time: currentTime,
            eulerPole: { ...defaultMotion.eulerPole },
            snapshotPolygons: [polygon],
            snapshotFeatures: []
        };

        const plate: TectonicPlate = {
            id: generateId(),
            name: `Plate ${this.state.world.plates.length + 1}`,
            color: getNextPlateColor(this.state.world.plates),
            polygons: [polygon],
            features: [],
            motion: defaultMotion,
            motionKeyframes: [initialKeyframe],
            visible: true,
            locked: false,
            center: points[0],
            events: [],
            birthTime: currentTime,
            deathTime: null,
            initialPolygons: [polygon],
            initialFeatures: []
        };

        // Immutable state update
        this.state = {
            ...this.state,
            world: {
                ...this.state.world,
                plates: [...this.state.world.plates, plate],
                selectedPlateId: plate.id
            }
        };

        this.updateUI();
        this.simulation?.setTime(this.state.world.currentTime);
        this.setActiveTool('select');
    }

    private handleLandmassDrawComplete(points: Coordinate[]): void {
        // Landmass mode: Add landmass to selected plate
        const plateId = this.state.world.selectedPlateId;
        
        if (!plateId) {
            alert("Please select a plate first to add a landmass to it.");
            return;
        }
        
        const plate = this.state.world.plates.find(p => p.id === plateId);
        if (!plate) return;
        
        this.pushState();
        
        const currentTime = this.state.world.currentTime;
        
        // Create new landmass
        const landmass: Landmass = {
            id: generateId(),
            polygon: points,
            originalPolygon: points,
            fillColor: '#8B4513', // Default brown (earth/land color)
            opacity: 0.9,
            name: `Landmass ${(plate.landmasses?.length || 0) + 1}`,
            birthTime: currentTime
        };
        
        // Update plate with new landmass
        this.state = {
            ...this.state,
            world: {
                ...this.state.world,
                plates: this.state.world.plates.map(p =>
                    p.id === plateId
                        ? { ...p, landmasses: [...(p.landmasses || []), landmass] }
                        : p
                ),
                selectedLandmassId: landmass.id,
                selectedLandmassIds: [landmass.id]
            }
        };
        
        this.updateUI();
        this.canvasManager?.render();
        this.setActiveTool('select');
    }

    private handleFeaturePlace(position: Coordinate, type: FeatureType): void {
        // Special case: Hotspots are effectively Mantle Plumes (Global Features)
        // If the user selects "Hotspot", they likely want to create a Mantle Plume Source.
        if (type === 'hotspot') {
            const plume: MantlePlume = {
                id: generateId(),
                position: position,
                radius: 50, // Default radius
                strength: 1.0,
                active: true,
                spawnRate: this.state.world.globalOptions.hotspotSpawnRate || 1.0
            };
            
            // Add to World State
            this.pushState();
            this.state = {
                ...this.state,
                world: {
                    ...this.state.world,
                    mantlePlumes: [...(this.state.world.mantlePlumes || []), plume],
                    // Auto-select the new plume?
                    selectedPlateId: null
                }
            };
            
            // Note: We need a way to SELECT the plume.
            // Currently selection only supports "selectedPlateId" and "selectedFeatureId".
            // We should add "selectedPlumeId" to state or handle it via UI.
            // For now, let's just render.
            this.canvasManager?.render();
            // alert(`Created Mantle Plume at [${position[0].toFixed(1)}, ${position[1].toFixed(1)}].`);
            
            return;
        }

        // Use the selected plate for feature placement
        const plateId = this.state.world.selectedPlateId;

        if (!plateId) {
             alert("For Plate features (Mountains, Volcanoes), please select a plate first.");
             return;
        }
        this.pushState(); // Save state for undo

        const feature: Feature = {
            id: generateId(),
            type: type,
            position: position,
            rotation: 0,
            scale: 1,
            properties: {},
            generatedAt: this.state.world.currentTime,
            originalPosition: position // Set source of truth for rotation
        };

        // Immutable state update
        this.state = {
            ...this.state,
            world: {
                ...this.state.world,
                plates: this.state.world.plates.map(plate =>
                    plate.id === plateId
                        ? { ...plate, features: [...plate.features, feature] }
                        : plate
                )
            }
        };

        this.simulation?.setTime(this.state.world.currentTime);
        this.canvasManager?.render();
    }

    private handleSelect(plateId: string | null, featureId: string | null, featureIds: string[] = [], plumeId: string | null = null, paintStrokeId: string | null = null, landmassId: string | null = null): void {
        // Reset fusion/link state if switching away
        if (this.state.activeTool !== 'fuse') this.fusionFirstPlateId = null;
        if (this.state.activeTool !== 'link') this.activeLinkSourceId = null;

        // Tool Logic Interception
        if (this.state.activeTool === 'fuse') {
            if (plateId) this.handleFuseTool(plateId);
            return;
        }

        if (this.state.activeTool === 'link') {
            if (plateId) this.handleLinkTool(plateId);
            return;
        }

        // Selection Logic
        if (this.state.activeTool === 'select') {
             if (landmassId) {
                 const plate = this.state.world.plates.find(p => p.id === plateId);
                 const landmass = plate?.landmasses?.find(l => l.id === landmassId);
                 this.updateHint(`Selected Landmass: ${landmass?.name || 'Unnamed'}.`);
             } else if (paintStrokeId) {
                 this.updateHint("Selected Paint Stroke.");
             } else if (plateId) {
                 const plate = this.state.world.plates.find(p => p.id === plateId);
                 this.updateHint(`Selected ${plate?.name || 'Plate'}.`);
             } else if (plumeId) {
                 this.updateHint("Selected Mantle Plume.");
             } else {
                 this.updateHint(null);
             }
        }
        
        // Handle landmass selection
        if (landmassId) {
            this.state.world.selectedLandmassId = landmassId;
            this.state.world.selectedLandmassIds = [landmassId];
            this.state.world.selectedPlateId = plateId; // Keep plate context
            this.state.world.selectedFeatureId = null;
            this.state.world.selectedFeatureIds = [];
            this.state.world.selectedPaintStrokeId = null;
            this.state.world.selectedPaintStrokeIds = [];
        } else if (paintStrokeId) {
            this.state.world.selectedPaintStrokeId = paintStrokeId;
            this.state.world.selectedPaintStrokeIds = [paintStrokeId];
            this.state.world.selectedPlateId = plateId; // Keep plate context
            this.state.world.selectedFeatureId = null;
            this.state.world.selectedFeatureIds = [];
            this.state.world.selectedLandmassId = null;
            this.state.world.selectedLandmassIds = [];
        } else if (plumeId) {
             // If plume selected, deselect others and set ID to selectedFeatureId for UI binding
             this.state.world.selectedPlateId = null;
             this.state.world.selectedFeatureId = plumeId;
             this.state.world.selectedFeatureIds = [plumeId];
             this.state.world.selectedPaintStrokeId = null;
             this.state.world.selectedPaintStrokeIds = [];
             this.state.world.selectedLandmassId = null;
             this.state.world.selectedLandmassIds = [];
        } else {
             this.state.world.selectedPlateId = plateId;
             this.state.world.selectedFeatureId = featureId ?? null;
             this.state.world.selectedPaintStrokeId = null;
             this.state.world.selectedPaintStrokeIds = [];
             this.state.world.selectedLandmassId = null;
             this.state.world.selectedLandmassIds = [];
    
             // Handle multi-selection
             if (featureIds.length > 0) {
                 this.state.world.selectedFeatureIds = featureIds;
             } else if (featureId) {
                 this.state.world.selectedFeatureIds = [featureId];
             } else {
                 this.state.world.selectedFeatureIds = [];
             }
        }

        this.updateUI();
        this.canvasManager?.render();
    }



    private handleFuseTool(plateId: string): void {
        const plate = this.state.world.plates.find(p => p.id === plateId);
        if (!plate) return;

        if (!this.fusionFirstPlateId) {
            this.fusionFirstPlateId = plateId;
            this.updateHint(`Selected Plate ${plate.name} select another plate to fuse it with`);
        } else if (this.fusionFirstPlateId !== plateId) {
            // Stage 3 - Confirmation
            const firstPlate = this.state.world.plates.find(p => p.id === this.fusionFirstPlateId);
            if (!firstPlate) {
                this.fusionFirstPlateId = null;
                return;
            }

            this.showModal({
                title: 'Confirm Fusion',
                content: `Do you want to fuse plate <strong>${firstPlate.name}</strong> and <strong>${plate.name}</strong> into a single plate?`,
                buttons: [
                    {
                        text: 'Fuse Plates',
                        subtext: 'Combine geometries and features. The new plate will inherit motion from the larger parent.',
                        onClick: () => {
                            this.pushState();
                            const result = fusePlates(this.state, this.fusionFirstPlateId!, plateId);
                            
                            if (result.success && result.newState) {
                                this.state = result.newState;
                                this.fusionFirstPlateId = null;
                                this.updatePropertiesPanel();
                                this.updateUI();
                                this.canvasManager?.render();
                                this.updateHint(`Fused plates into new plate.`);
                            } else {
                                this.updateHint(`Fusion failed: ${result.error || 'Unknown error'}`);
                                setTimeout(() => this.updateHint(null), 3000);
                            }
                        }
                    },
                    {
                        text: 'Cancel',
                        isSecondary: true,
                        onClick: () => {
                           this.fusionFirstPlateId = null;
                           this.updateHint("Select first plate to fuse");
                        }
                    }
                ]
            });
            // We exit here because modal is async
            return;
        }
    }

    private handleLinkTool(plateId: string): void {
        const plate = this.state.world.plates.find(p => p.id === plateId);
        if (!plate) return;

        // Step 1: Select first plate
        if (!this.activeLinkSourceId) {
            this.activeLinkSourceId = plateId;
            // Visual feedback - select it temporarily
            this.state.world.selectedPlateId = plateId;

            this.updateHint(`Selected Plate ${plate.name} select another plate to link it with`);

            this.updateUI();
            this.canvasManager?.render();
            return;
        }

        // Step 2: Select second plate
        if (this.activeLinkSourceId === plateId) {
            // Deselect if clicking same plate
            this.activeLinkSourceId = null;
            this.state.world.selectedPlateId = null;
            this.updateHint("Select first plate to link");
            this.updateUI();
            this.canvasManager?.render();
            return;
        }

        // Apply Link
        const sourceId = this.activeLinkSourceId;
        const targetId = plateId;
        const sourcePlate = this.state.world.plates.find(p => p.id === sourceId);

        if (!sourcePlate) {
            this.activeLinkSourceId = null;
            return;
        }

        const isLinked = sourcePlate.linkedPlateIds?.includes(targetId);
        const actionText = isLinked ? "Unlink" : "Link";

        this.showModal({
            title: `${actionText} Plates`,
            content: `Do you want to <strong>${actionText.toLowerCase()}</strong> plate <strong>${sourcePlate.name}</strong> and <strong>${plate.name}</strong>?`,
            buttons: [
                 {
                    text: actionText,
                    subtext: isLinked ? 'Plates will move independently.' : 'Plates will move together.',
                    onClick: () => {
                        // Logic
                         this.pushState();
                        this.state.world.plates = this.state.world.plates.map(p => {
                            if (p.id === sourceId) {
                                let links = p.linkedPlateIds || [];
                                if (isLinked) links = links.filter(id => id !== targetId);
                                else links = [...links, targetId];
                                return { ...p, linkedPlateIds: links };
                            }
                            if (p.id === targetId) {
                                let links = p.linkedPlateIds || [];
                                if (isLinked) links = links.filter(id => id !== sourceId);
                                else links = [...links, sourceId];
                                return { ...p, linkedPlateIds: links };
                            }
                            return p;
                        });

                        this.updateHint(`${isLinked ? 'Unlinked' : 'Linked'} ${sourcePlate.name} and ${plate.name}`);
                        setTimeout(() => { if (this.state.activeTool !== 'link') this.updateHint(null); }, 2000);

                        // Reset
                        this.activeLinkSourceId = null;
                        this.state.world.selectedPlateId = plateId; // Select the target
                        this.activeToolText = "Select first plate to link"; // Reset for next use
                        this.updateRetroStatusBox(this.activeToolText);
                        this.updateUI();
                        this.canvasManager?.render();
                    }
                 },
                 {
                    text: 'Cancel',
                    isSecondary: true,
                    onClick: () => {
                        // User cancelled - reset to Stage 1
                        this.activeLinkSourceId = null;
                        this.updateHint("Select first plate to link");
                        this.updateUI();
                        this.canvasManager?.render();
                    }
                 }
            ]
        });
    }

    private handleSplitApply(points: Coordinate[]): void {
        if (points.length < 2) return;

        let plateToSplit = this.state.world.plates.find(p => p.id === this.state.world.selectedPlateId);

        if (plateToSplit) {
            this.showModal({
                title: 'Split Plate Configuration',
                content: `You are about to split <strong>${plateToSplit.name}</strong> along the drawn boundary. How should the new plates behave?`,
                buttons: [
                    {
                        text: 'Inherit Momentum',
                        subtext: 'New plates will keep the parent\'s current velocity and rotation.',
                        onClick: () => {
                            this.pushState();
                            this.state = splitPlate(this.state, plateToSplit!.id, { points }, true);
                            this.updateUI();
                            this.simulation?.setTime(this.state.world.currentTime);
                            this.canvasManager?.render();
                        }
                    },
                    {
                        text: 'Reset Momentum',
                        subtext: 'New plates will start stationary (0 velocity).',
                        onClick: () => {
                            this.pushState();
                            this.state = splitPlate(this.state, plateToSplit!.id, { points }, false);
                            this.updateUI();
                            this.simulation?.setTime(this.state.world.currentTime);
                            this.canvasManager?.render();
                        }
                    },
                    {
                        text: 'Cancel',
                        isSecondary: true,
                        onClick: () => { /* Do nothing */ }
                    }
                ]
            });
        }
    }

    private handleSplitPreviewChange(active: boolean): void {
        // Update UI to show/hide split apply/cancel buttons
        const splitControls = document.getElementById('split-controls');
        if (splitControls) {
            splitControls.style.display = active ? 'flex' : 'none';
        }
    }

    private deleteSelected(): void {
        this.pushState(); // Save state for undo

        const { selectedFeatureId, selectedFeatureIds, selectedPlateId } = this.state.world;
        const paintIds = this.state.world.selectedPaintStrokeIds || (this.state.world.selectedPaintStrokeId ? [this.state.world.selectedPaintStrokeId] : []);

        if (paintIds.length > 0) {
            // Delete selected paint strokes
            const idSet = new Set(paintIds);
             this.state.world.plates = this.state.world.plates.map(p => {
                if(!p.paintStrokes) return p;
                return {
                    ...p,
                    paintStrokes: p.paintStrokes.filter((s:any) => !idSet.has(s.id))
                };
            });
            this.state.world.selectedPaintStrokeId = null;
            this.state.world.selectedPaintStrokeIds = [];
        }

        if (selectedFeatureId || (selectedFeatureIds && selectedFeatureIds.length > 0)) {
            // Build set of all feature IDs to delete
            const idsToDelete = new Set<string>();
            if (selectedFeatureId) idsToDelete.add(selectedFeatureId);
            if (selectedFeatureIds) selectedFeatureIds.forEach(id => idsToDelete.add(id));

            // Remove from Mantle Plumes if present
            if (this.state.world.mantlePlumes) {
                this.state.world.mantlePlumes = this.state.world.mantlePlumes.filter(p => !idsToDelete.has(p.id));
            }

            // Remove these features from all plates and their history
            this.state.world.plates = this.state.world.plates.map(p => ({
                ...p,
                features: p.features.filter(f => !idsToDelete.has(f.id)),
                initialFeatures: p.initialFeatures ? p.initialFeatures.filter(f => !idsToDelete.has(f.id)) : p.initialFeatures,
                motionKeyframes: p.motionKeyframes ? p.motionKeyframes.map(kf => ({
                    ...kf,
                    snapshotFeatures: kf.snapshotFeatures.filter(f => !idsToDelete.has(f.id))
                })) : p.motionKeyframes
            }));

            this.state.world.selectedFeatureId = null;
            this.state.world.selectedFeatureIds = [];
        } else if (selectedPlateId && paintIds.length === 0) { 
            // Only delete plate if we didn't just delete strokes using the same key press 
            // (though UI usually separates them, hotkey collision is possible)
            this.deletePlates([selectedPlateId]);
        }
        this.updateUI();
        this.simulation?.setTime(this.state.world.currentTime);
        this.canvasManager?.render();
    }

    private updateFeature(featureId: string, updates: Partial<Feature>): void {
        this.pushState();
        this.state.world.plates = this.state.world.plates.map(p => {
            const applyUpdates = (f: Feature) => (f.id === featureId ? { ...f, ...updates } : f);

            return {
                ...p,
                features: p.features.map(applyUpdates),
                initialFeatures: p.initialFeatures ? p.initialFeatures.map(applyUpdates) : p.initialFeatures,
                motionKeyframes: p.motionKeyframes ? p.motionKeyframes.map(kf => ({
                    ...kf,
                    snapshotFeatures: kf.snapshotFeatures.map(applyUpdates)
                })) : p.motionKeyframes
            };
        });

        // Re-calculate the current state of plates at current time to reflect changes
        this.simulation?.setTime(this.state.world.currentTime);
        this.updatePropertiesPanel();
        this.canvasManager?.render();
    }

    private updateExplorer(): void {
        const list = document.getElementById('plate-list');
        if (!list) return;

        list.innerHTML = '';
        
        // --- 1. PLATES SECTION ---
        const platesSection = this.createExplorerSection('Plates', 'plates', this.state.world.plates.length);
        list.appendChild(platesSection.header);
        
        if (this.explorerState.sections['plates']) {
            const content = platesSection.content;
            if (this.state.world.plates.length === 0) {
                content.innerHTML = '<p class="empty-message">Draw a landmass to create a plate</p>';
            } else {
                content.innerHTML = this.state.world.plates.map(plate => `
      <div class="plate-item ${plate.id === this.state.world.selectedPlateId ? 'selected' : ''}" 
           data-plate-id="${plate.id}">
        <span class="plate-color" style="background: ${plate.color}"></span>
        <span class="plate-name">${plate.name}</span>
        <button class="plate-visibility" data-visible="${plate.visible}">
          ${plate.visible ? '👁️' : '🚫'}
        </button>
      </div>
    `).join('');

                content.querySelectorAll('.plate-item').forEach(item => {
                    item.addEventListener('click', (e) => {
                        if ((e.target as HTMLElement).classList.contains('plate-visibility')) return;
                        const plateId = item.getAttribute('data-plate-id');
                        // Use original handleSelect which now probably needs to support modifiers in other contexts, 
                        // but here we just select the plate. 
                        // If user wants to multiselect plates, that's a different feature request not strictly asked for, 
                        // but let's be safe and check Modifier keys if we were rewriting handleSelect.
                        // For now keep standard select.
                        this.handleSelect(plateId, null);
                    });
                });

                // Visibility toggle
                content.querySelectorAll('.plate-visibility').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const item = (e.target as HTMLElement).closest('.plate-item');
                        const plateId = item?.getAttribute('data-plate-id');
                        if (plateId) {
                            this.togglePlateVisibility(plateId);
                        }
                    });
                });
            }
            list.appendChild(content);
        }

        // --- 2. ACTIONS SECTION (Previously Events) ---
        // Aggregate all plate events
        let allEvents: {time: number, desc: string, plateName: string, plateId: string}[] = [];
        this.state.world.plates.forEach(p => {
             if(p.events) {
                 p.events.forEach(ev => {
                     let desc: string = ev.type;
                     if(ev.type === 'motion_change') desc = 'Motion Change';
                     if(ev.type === 'split') desc = 'Plate Split';
                     if(ev.type === 'fusion') desc = 'Fusion';
                     allEvents.push({
                         time: ev.time, 
                         desc: desc,
                         plateName: p.name,
                         plateId: p.id
                     });
                 });
             }
             // Also add creation time as event
             allEvents.push({time: p.birthTime, desc: 'Created', plateName: p.name, plateId: p.id});
        });
        
        // Sort by time
        allEvents.sort((a,b) => a.time - b.time);
        
        const actionSection = this.createExplorerSection('Actions', 'events', allEvents.length);
        list.appendChild(actionSection.header);
        
        if (this.explorerState.sections['events']) {
             const actionContent = actionSection.content;
             if (allEvents.length === 0) {
                 actionContent.innerHTML = '<p class="empty-message">No actions recorded</p>';
             } else {
                 allEvents.forEach(ev => {
                     const row = document.createElement('div');
                     row.className = 'paint-stroke-item';
                     row.style.cursor = 'pointer';
                     row.innerText = `${ev.time.toFixed(1)} Ma: ${ev.desc} (${ev.plateName})`;
                     
                     // Click to select the plate involved in the action
                     row.onclick = () => {
                         this.handleSelect(ev.plateId, null);
                     };

                     actionContent.appendChild(row);
                 });
             }
             list.appendChild(actionContent);
        }

        // --- 3. PAINT STROKES SECTION ---
        let allStrokes: any[] = [];
        this.state.world.plates.forEach(p => {
            if (p.paintStrokes) {
                p.paintStrokes.forEach(s => allStrokes.push({...s, _plateId: p.id}));
            }
        });
        
        const paintSection = this.createExplorerSection('Paint Strokes', 'paint', allStrokes.length);
        list.appendChild(paintSection.header);
        
        if (this.explorerState.sections['paint']) {
             const paintContent = paintSection.content;
             if (allStrokes.length === 0) {
                 paintContent.innerHTML = '<p class="empty-message">No paint strokes</p>';
             } else {
                 const groups: {[key: string]: any[]} = {};
                 allStrokes.forEach(s => {
                     // Group by Plate ID to keep manual and auto strokes of a plate together
                     const k = s._plateId;
                     if(!groups[k]) groups[k] = [];
                     groups[k].push(s);
                 });
                 
                 Object.keys(groups).forEach(gid => { // gid is plateId
                     const plate = this.state.world.plates.find(p => p.id === gid);
                     const label = plate ? plate.name : 'Unknown Plate';
                     
                     const isGroupExpanded = this.explorerState.paintGroups[gid];
                     // Check if ALL in group are selected
                     const groupIds = groups[gid].map(s => s.id);
                     const allSelected = groupIds.length > 0 && groupIds.every(id => this.state.world.selectedPaintStrokeIds?.includes(id));
                     
                     const gHeader = document.createElement('div');
                     gHeader.className = `paint-group-header ${isGroupExpanded ? 'selected' : ''}`;
                     // Add checkbox-like indicator or just bold if selected
                     const selIndicator = allSelected ? '☑' : '☐';
                     
                     gHeader.innerHTML = `<span>${selIndicator} ${label} (${groups[gid].length})</span> <span>${isGroupExpanded ? '▼' : '▶'}</span>`;
                     gHeader.onclick = (_e) => {
                         // Click on header logic:
                         // Select all strokes in this group (Plate)
                         
                         const currentSelected = new Set(this.state.world.selectedPaintStrokeIds || []);
                         
                         if (allSelected) {
                             // Deselect all in group
                             groupIds.forEach(id => currentSelected.delete(id));
                         } else {
                             // Select all in group
                             groupIds.forEach(id => currentSelected.add(id));
                             // Ensure we are in paint selection mode
                             this.state.world.selectedPlateId = null;
                             this.state.world.selectedFeatureId = null;
                         }
                         
                         this.state.world.selectedPaintStrokeIds = Array.from(currentSelected);
                         // Sync single ID
                         this.state.world.selectedPaintStrokeId = this.state.world.selectedPaintStrokeIds.length > 0 ? this.state.world.selectedPaintStrokeIds[0] : null;

                         // Also toggle expansion
                         if(!allSelected) {
                            this.explorerState.paintGroups[gid] = true;
                         }
                         
                         this.updatePropertiesPanel();
                         this.updateExplorer();
                         this.canvasManager?.render();
                     };
                     
                     paintContent.appendChild(gHeader);
                     
                     if(isGroupExpanded) {
                         groups[gid].forEach(s => {
                             const row = document.createElement('div');
                             const isSel = this.state.world.selectedPaintStrokeIds?.includes(s.id);
                             row.className = `paint-stroke-item ${isSel ? 'selected' : ''}`;
                             
                             // Differentiate manual vs auto in the individual item text
                             const type = s.boundaryId ? 'Auto' : 'Manual';
                             row.innerText = `${type} - ${s.id.substring(0,4)}...`;
                             
                             row.onclick = (e) => {
                                 e.stopPropagation();
                                 const id = s.id;
                                 let newSel = new Set(this.state.world.selectedPaintStrokeIds || []);
                                 
                                 if (e.ctrlKey || e.metaKey) {
                                     if(newSel.has(id)) newSel.delete(id);
                                     else newSel.add(id);
                                 } else {
                                     newSel = new Set([id]);
                                 }
                                 
                                 this.state.world.selectedPaintStrokeIds = Array.from(newSel);
                                 this.state.world.selectedPaintStrokeId = this.state.world.selectedPaintStrokeIds.length > 0 ? this.state.world.selectedPaintStrokeIds[0] : null;

                                 this.state.world.selectedPlateId = null;
                                 this.state.world.selectedFeatureId = null;
                                 this.updatePropertiesPanel();
                                 this.updateExplorer();
                                 this.canvasManager?.render();
                             };
                             paintContent.appendChild(row);
                         });
                    }
                 });
             }
             list.appendChild(paintContent);
        }
    }

    private createExplorerSection(title: string, key: string, count: number): {header: HTMLElement, content: HTMLElement} {
        const header = document.createElement('div');
        header.className = 'explorer-header';
        header.style.marginBottom = '2px';
        const isOpen = this.explorerState.sections[key];
        header.innerHTML = `<span>${title} (${count})</span> <span>${isOpen ? '▼' : '▶'}</span>`;
        header.onclick = () => {
            this.explorerState.sections[key] = !isOpen;
            this.updateExplorer();
        };
        const content = document.createElement('div');
        content.className = 'explorer-content';
        if(key === 'plates') content.classList.add('plate-list');
        return {header, content};
    }

    private togglePlateVisibility(plateId: string): void {
        this.state = {
            ...this.state,
            world: {
                ...this.state.world,
                plates: this.state.world.plates.map(plate =>
                    plate.id === plateId
                        ? { ...plate, visible: !plate.visible }
                        : plate
                )
            }
        };
        this.updateExplorer();
        this.canvasManager?.render();
    }
    
    /**
     * Smooth vertex elevation by averaging with neighbors
     */
    private smoothVertexElevation(plate: any, vertex: any): void {
        if (!plate.crustMesh) return;
        
        // Build neighbor graph using Delaunay triangulation
        const vertices = plate.crustMesh;
        const points: [number, number][] = vertices.map((v: any) => [v.pos[0], v.pos[1]]);
        
        try {
            // Import Delaunay at runtime
            import('d3-delaunay').then(({ Delaunay }) => {
                const delaunay = Delaunay.from(points);
                
                // Find neighbors of the selected vertex
                const vertexIdx = vertices.findIndex((v: any) => v.id === vertex.id);
                if (vertexIdx === -1) return;
                
                const neighbors = new Set<number>();
                
                // Extract neighbors from triangulation
                for (let i = 0; i < delaunay.triangles.length; i += 3) {
                    const idx0 = delaunay.triangles[i];
                    const idx1 = delaunay.triangles[i + 1];
                    const idx2 = delaunay.triangles[i + 2];
                    
                    if (idx0 === vertexIdx) {
                        neighbors.add(idx1);
                        neighbors.add(idx2);
                    } else if (idx1 === vertexIdx) {
                        neighbors.add(idx0);
                        neighbors.add(idx2);
                    } else if (idx2 === vertexIdx) {
                        neighbors.add(idx0);
                        neighbors.add(idx1);
                    }
                }
                
                if (neighbors.size === 0) {
                    console.log('No neighbors found for vertex');
                    return;
                }
                
                // Calculate average elevation of neighbors
                let sum = 0;
                neighbors.forEach(idx => {
                    sum += vertices[idx].elevation;
                });
                const avgElevation = sum / neighbors.size;
                
                // Blend 50% with neighbors
                const oldElevation = vertex.elevation;
                vertex.elevation = (vertex.elevation + avgElevation) / 2;
                
                // Save to history
                this.historyManager.push(this.state);
                
                // Update UI
                this.updatePropertiesPanel();
                this.canvasManager?.render();
                
                console.log(`Smoothed vertex: ${Math.round(oldElevation)}m → ${Math.round(vertex.elevation)}m (${neighbors.size} neighbors, avg: ${Math.round(avgElevation)}m)`);
            });
        } catch (error) {
            console.error('Error smoothing elevation:', error);
        }
    }
    
    /**
     * Adjust selected vertex elevation by delta (for keyboard shortcuts)
     */
    private adjustSelectedVertexElevation(delta: number): void {
        if (!this.state.world.selectedVertexPlateId || !this.state.world.selectedVertexId) return;
        
        const plate = this.state.world.plates.find(p => p.id === this.state.world.selectedVertexPlateId);
        if (!plate || !plate.crustMesh) return;
        
        const vertex = plate.crustMesh.find(v => v.id === this.state.world.selectedVertexId);
        if (!vertex) return;
        
        const oldElevation = vertex.elevation;
        vertex.elevation += delta;
        
        // Save to history
        this.historyManager.push(this.state);
        
        // Update UI
        this.updatePropertiesPanel();
        this.canvasManager?.render();
        
        console.log(`Vertex ${vertex.id.substring(0, 8)}: Elevation ${Math.round(oldElevation)}m → ${Math.round(vertex.elevation)}m (${delta > 0 ? '+' : ''}${delta}m)`);
    }

    private updatePropertiesPanel(): void {
        const content = document.getElementById('properties-content');
        if (!content) return;

        // Check for Paint Stroke Selection
        // Support multi-select logic
        const selIds = this.state.world.selectedPaintStrokeIds || (this.state.world.selectedPaintStrokeId ? [this.state.world.selectedPaintStrokeId] : []);
        
        if (selIds.length > 0) {
            // If multiple selected, show aggregate info
            if (selIds.length > 1) {
                 content.innerHTML = `
                    <h3 class="panel-section-title">Paint Strokes (${selIds.length})</h3>
                    <div class="property-group">
                        <label class="property-label">Multiple selected</label>
                    </div>
                    <div class="property-group" style="margin-top:20px;">
                        <button id="btn-delete-stroke" class="btn btn-danger" style="width:100%">Delete Selected (${selIds.length})</button>
                    </div>
                 `;
                 
                document.getElementById('btn-delete-stroke')?.addEventListener('click', () => {
                    this.state.world.plates = this.state.world.plates.map(p => {
                        if(!p.paintStrokes) return p;
                        return {
                            ...p,
                            paintStrokes: p.paintStrokes.filter((s:any) => !selIds.includes(s.id))
                        };
                    });
                    this.state.world.selectedPaintStrokeIds = [];
                    this.state.world.selectedPaintStrokeId = null;
                    this.updateUI();
                    this.canvasManager?.render();
                });
                return;
            }

            // Single item logic
            const strokeId = selIds[0];
            let foundStroke: any = null;
            let strokePlate: any = null;

            // Find the stroke across all plates
            for (const plate of this.state.world.plates) {
                if (plate.paintStrokes) {
                    const stroke = plate.paintStrokes.find((s: any) => s.id === strokeId);
                    if (stroke) {
                        foundStroke = stroke;
                        strokePlate = plate;
                        break;
                    }
                }
            }

            if (foundStroke && strokePlate) {
                const sourceDisplay = foundStroke.source || 'user';

                content.innerHTML = `
                    <h3 class="panel-section-title">Paint Stroke</h3>
                    
                    <div class="property-group">
                        <label class="property-label">ID</label>
                        <span class="property-value">${foundStroke.id.substring(0,8)}</span>
                    </div>

                    <div class="property-group">
                        <label class="property-label">Source</label>
                        <span class="property-value">${sourceDisplay === 'orogeny' ? '⚙️ Orogeny' : '🖌️ User'}</span>
                    </div>

                    <!-- Fade Override Settings -->
                    <div class="property-group" style="padding: 6px; background: rgba(255,255,255,0.05); border-radius: 4px; margin-top: 6px;">
                        <div style="font-size: 10px; font-weight: 600; margin-bottom: 4px; color: var(--text-secondary);">Fade Override (Optional)</div>
                         <div style="display: flex; flex-direction: column; gap: 4px;">
                             <div style="display: flex; justify-content: space-between; align-items: center;">
                                <label style="font-size: 10px;">Duration (Ma):</label>
                                <input type="number" id="prop-stroke-fade-dur" class="property-input" 
                                    value="${foundStroke.ageingDuration || ''}" 
                                    placeholder="Global" style="width: 50px;">
                             </div>
                             <div style="display: flex; justify-content: space-between; align-items: center;">
                                <label style="font-size: 10px;">Max Trans (%):</label>
                                <input type="number" id="prop-stroke-fade-max" class="property-input" 
                                    value="${foundStroke.maxAgeingOpacity !== undefined ? Math.round((1.0 - foundStroke.maxAgeingOpacity) * 100) : ''}" 
                                    placeholder="Global" style="width: 50px;">
                             </div>
                             <div style="display: flex; justify-content: space-between; align-items: center;">
                                 <label style="font-size: 10px;">Auto-Delete:</label>
                                 <select id="prop-stroke-auto-delete" class="property-input" style="width: 60px; font-size: 10px; padding: 0;">
                                     <option value="" ${foundStroke.autoDelete === undefined ? 'selected' : ''}>Global</option>
                                     <option value="true" ${foundStroke.autoDelete === true ? 'selected' : ''}>Yes</option>
                                     <option value="false" ${foundStroke.autoDelete === false ? 'selected' : ''}>No</option>
                                 </select>
                             </div>
                             <div style="display: flex; justify-content: space-between; align-items: center;">
                                <label style="font-size: 10px;">Delay (Ma):</label>
                                <input type="number" id="prop-stroke-delete-delay" class="property-input" 
                                    value="${foundStroke.deleteDelay !== undefined ? foundStroke.deleteDelay : ''}" 
                                    placeholder="Global" style="width: 50px;">
                             </div>
                         </div>
                    </div>

                    <div class="property-group">
                        <label class="property-label">Timeline (Ma)</label>
                        <div style="display: flex; gap: 4px;">
                             <input type="number" id="prop-stroke-birth-time" class="property-input" title="Start Time" value="${foundStroke.birthTime !== undefined ? this.getDisplayTimeValue(foundStroke.birthTime) : ''}" step="5" style="flex:1">
                             <span style="align-self: center;">-</span>
                             <input type="number" id="prop-stroke-death-time" class="property-input" title="End Time" value="${foundStroke.deathTime !== undefined ? this.getDisplayTimeValue(foundStroke.deathTime) : ''}" placeholder="Active" step="5" style="flex:1">
                        </div>
                    </div>

                    <div class="property-group">
                        <label class="property-label">Color</label>
                        <input type="color" id="prop-stroke-color" value="${foundStroke.color}" style="width: 100%; height: 28px; cursor: pointer;">
                    </div>

                    <div class="property-group">
                        <label class="property-label">Width (px)</label>
                        <input type="number" id="prop-stroke-width" class="property-input" value="${foundStroke.width}" min="1" max="20">
                    </div>

                    <div class="property-group">
                        <label class="property-label">Opacity</label>
                        <input type="range" id="prop-stroke-opacity" min="0" max="100" value="${Math.round(foundStroke.opacity * 100)}" style="width: 100%;">
                        <span id="prop-stroke-opacity-value" style="font-size: 10px; color: var(--text-secondary);">${Math.round(foundStroke.opacity * 100)}%</span>
                    </div>

                    <div class="property-group">
                        <label class="property-label">On Plate</label>
                        <span class="property-value">${strokePlate.name}</span>
                    </div>

                    <div class="property-group" style="margin-top:20px;">
                        <button id="btn-delete-stroke" class="btn btn-danger" style="width:100%">Delete Stroke</button>
                    </div>
                `;

                // Bind events
                document.getElementById('prop-stroke-birth-time')?.addEventListener('change', (e) => {
                    const val = parseFloat((e.target as HTMLInputElement).value);
                    if (!isNaN(val)) {
                        foundStroke.birthTime = this.transformInputTime(val);
                        this.canvasManager?.render();
                        // this.updateExplorer(); // Timeline might change? Actions list uses birthTime but strokes list doesn't sort by time yet explicitly, just groups.
                    }
                });

                document.getElementById('prop-stroke-fade-dur')?.addEventListener('change', (e) => {
                    const val = (e.target as HTMLInputElement).value;
                    if (val === '') {
                        delete foundStroke.ageingDuration;
                    } else {
                        const num = parseFloat(val);
                        if (!isNaN(num) && num > 0) foundStroke.ageingDuration = num;
                    }
                    this.canvasManager?.render();
                });

                document.getElementById('prop-stroke-fade-max')?.addEventListener('change', (e) => {
                    const val = (e.target as HTMLInputElement).value;
                    if (val === '') {
                        delete foundStroke.maxAgeingOpacity;
                    } else {
                        const num = parseFloat(val);
                        if (!isNaN(num) && num >= 0 && num <= 100) {
                             foundStroke.maxAgeingOpacity = 1.0 - (num / 100.0);
                        }
                    }
                    this.canvasManager?.render();
                });

                document.getElementById('prop-stroke-auto-delete')?.addEventListener('change', (e) => {
                    const val = (e.target as HTMLSelectElement).value;
                    if (val === '') {
                        delete foundStroke.autoDelete;
                    } else {
                        foundStroke.autoDelete = val === 'true';
                    }
                    this.canvasManager?.render();
                });

                document.getElementById('prop-stroke-delete-delay')?.addEventListener('change', (e) => {
                    const val = (e.target as HTMLInputElement).value;
                    if (val === '') {
                        delete foundStroke.deleteDelay;
                    } else {
                        const num = parseFloat(val);
                        if (!isNaN(num) && num >= 0) {
                            foundStroke.deleteDelay = num;
                        }
                    }
                    this.canvasManager?.render();
                });

                document.getElementById('prop-stroke-death-time')?.addEventListener('change', (e) => {
                    const val = (e.target as HTMLInputElement).value;
                    if (val === '') {
                        delete foundStroke.deathTime;
                    } else {
                        const num = parseFloat(val);
                        if (!isNaN(num)) {
                            foundStroke.deathTime = this.transformInputTime(num);
                        }
                    }
                    this.canvasManager?.render();
                });

                document.getElementById('prop-stroke-color')?.addEventListener('input', (e) => {
                    foundStroke.color = (e.target as HTMLInputElement).value;
                    this.canvasManager?.render();
                });

                document.getElementById('prop-stroke-width')?.addEventListener('change', (e) => {
                    const val = parseInt((e.target as HTMLInputElement).value);
                    if (!isNaN(val) && val >= 1) {
                        foundStroke.width = val;
                        this.canvasManager?.render();
                    }
                });

                document.getElementById('prop-stroke-opacity')?.addEventListener('input', (e) => {
                    const val = parseInt((e.target as HTMLInputElement).value) / 100;
                    foundStroke.opacity = val;
                    const display = document.getElementById('prop-stroke-opacity-value');
                    if (display) display.textContent = `${Math.round(val * 100)}%`;
                    this.canvasManager?.render();
                });

                document.getElementById('btn-delete-stroke')?.addEventListener('click', () => {
                    strokePlate.paintStrokes = strokePlate.paintStrokes.filter((s: any) => s.id !== strokeId);
                    this.state.world.selectedPaintStrokeId = null;
                    this.state.world.selectedPaintStrokeIds = [];
                    this.updateUI();
                    this.canvasManager?.render();
                });

                return;
            }
        }

        // Check for Landmass Selection
        const landmassIds = this.state.world.selectedLandmassIds || (this.state.world.selectedLandmassId ? [this.state.world.selectedLandmassId] : []);
        
        if (landmassIds.length > 0) {
            const landmassId = landmassIds[0];
            let foundLandmass: Landmass | null = null;
            let landmassPlate: TectonicPlate | null = null;

            // Find the landmass across all plates
            for (const plate of this.state.world.plates) {
                if (plate.landmasses) {
                    const landmass = plate.landmasses.find(l => l.id === landmassId);
                    if (landmass) {
                        foundLandmass = landmass;
                        landmassPlate = plate;
                        break;
                    }
                }
            }

            if (foundLandmass && landmassPlate) {
                content.innerHTML = `
                    <h3 class="panel-section-title">🏝️ Landmass</h3>
                    
                    <div class="property-group">
                        <label class="property-label">Name</label>
                        <input type="text" id="prop-landmass-name" class="property-input" value="${foundLandmass.name || ''}" placeholder="Unnamed Landmass">
                    </div>

                    <div class="property-group">
                        <label class="property-label">Description</label>
                        <textarea id="prop-landmass-desc" class="property-input" rows="2" placeholder="Add notes...">${foundLandmass.description || ''}</textarea>
                    </div>

                    <div class="property-group">
                        <label class="property-label">Fill Color</label>
                        <input type="color" id="prop-landmass-color" value="${foundLandmass.fillColor}" style="width: 100%; height: 28px; cursor: pointer;">
                    </div>

                    <div class="property-group">
                        <label class="property-label">Stroke Color</label>
                        <div style="display: flex; gap: 4px; align-items: center;">
                            <input type="color" id="prop-landmass-stroke-color" value="${foundLandmass.strokeColor || '#000000'}" style="flex: 1; height: 28px; cursor: pointer;">
                            <button id="prop-landmass-stroke-clear" class="btn btn-secondary" style="padding: 4px 8px; font-size: 10px;">Clear</button>
                        </div>
                    </div>

                    <div class="property-group">
                        <label class="property-label">Opacity</label>
                        <input type="range" id="prop-landmass-opacity" min="0" max="100" value="${Math.round(foundLandmass.opacity * 100)}" style="width: 100%;">
                        <span id="prop-landmass-opacity-value" style="font-size: 10px; color: var(--text-secondary);">${Math.round(foundLandmass.opacity * 100)}%</span>
                    </div>

                    <div class="property-group">
                        <label class="property-label">Timeline (Ma)</label>
                        <div style="display: flex; gap: 4px;">
                             <input type="number" id="prop-landmass-birth-time" class="property-input" title="Birth Time" value="${this.getDisplayTimeValue(foundLandmass.birthTime)}" step="5" style="flex:1">
                             <span style="align-self: center;">-</span>
                             <input type="number" id="prop-landmass-death-time" class="property-input" title="Death Time" value="${foundLandmass.deathTime !== undefined ? this.getDisplayTimeValue(foundLandmass.deathTime) : ''}" placeholder="Active" step="5" style="flex:1">
                        </div>
                    </div>

                    <div class="property-group">
                        <label class="property-label">Vertices</label>
                        <span class="property-value">${foundLandmass.polygon.length}</span>
                    </div>

                    <div class="property-group">
                        <label class="property-label">On Plate</label>
                        <span class="property-value">${landmassPlate.name}</span>
                    </div>

                    <div class="property-group" style="margin-top:20px;">
                        <button id="btn-delete-landmass" class="btn btn-danger" style="width:100%">Delete Landmass</button>
                    </div>
                `;

                // Bind events
                document.getElementById('prop-landmass-name')?.addEventListener('change', (e) => {
                    foundLandmass!.name = (e.target as HTMLInputElement).value;
                });

                document.getElementById('prop-landmass-desc')?.addEventListener('change', (e) => {
                    foundLandmass!.description = (e.target as HTMLTextAreaElement).value;
                });

                document.getElementById('prop-landmass-color')?.addEventListener('input', (e) => {
                    foundLandmass!.fillColor = (e.target as HTMLInputElement).value;
                    this.canvasManager?.render();
                });

                document.getElementById('prop-landmass-stroke-color')?.addEventListener('input', (e) => {
                    foundLandmass!.strokeColor = (e.target as HTMLInputElement).value;
                    this.canvasManager?.render();
                });

                document.getElementById('prop-landmass-stroke-clear')?.addEventListener('click', () => {
                    delete foundLandmass!.strokeColor;
                    this.updatePropertiesPanel();
                    this.canvasManager?.render();
                });

                document.getElementById('prop-landmass-opacity')?.addEventListener('input', (e) => {
                    const val = parseInt((e.target as HTMLInputElement).value) / 100;
                    foundLandmass!.opacity = val;
                    const display = document.getElementById('prop-landmass-opacity-value');
                    if (display) display.textContent = `${Math.round(val * 100)}%`;
                    this.canvasManager?.render();
                });

                document.getElementById('prop-landmass-birth-time')?.addEventListener('change', (e) => {
                    const val = parseFloat((e.target as HTMLInputElement).value);
                    if (!isNaN(val)) {
                        foundLandmass!.birthTime = this.transformInputTime(val);
                        this.canvasManager?.render();
                    }
                });

                document.getElementById('prop-landmass-death-time')?.addEventListener('change', (e) => {
                    const val = (e.target as HTMLInputElement).value;
                    if (val === '') {
                        delete foundLandmass!.deathTime;
                    } else {
                        const num = parseFloat(val);
                        if (!isNaN(num)) {
                            foundLandmass!.deathTime = this.transformInputTime(num);
                        }
                    }
                    this.canvasManager?.render();
                });

                document.getElementById('btn-delete-landmass')?.addEventListener('click', () => {
                    this.pushState();
                    landmassPlate!.landmasses = landmassPlate!.landmasses!.filter(l => l.id !== landmassId);
                    this.state.world.selectedLandmassId = null;
                    this.state.world.selectedLandmassIds = [];
                    this.updateUI();
                    this.canvasManager?.render();
                });

                return;
            }
        }

        // Check for Mesh Vertex Selection
        if (this.state.world.selectedVertexPlateId && this.state.world.selectedVertexId) {
            const plateId = this.state.world.selectedVertexPlateId;
            const vertexId = this.state.world.selectedVertexId;
            
            const plate = this.state.world.plates.find(p => p.id === plateId);
            if (plate && plate.crustMesh) {
                const vertex = plate.crustMesh.find(v => v.id === vertexId);
                
                if (vertex) {
                    content.innerHTML = `
                        <h3 class="panel-section-title">Mesh Vertex</h3>
                        
                        <div class="property-group">
                            <label class="property-label">Vertex ID</label>
                            <span class="property-value">${vertex.id.substring(0,8)}</span>
                        </div>

                        <div class="property-group">
                            <label class="property-label">Position (Lon, Lat)</label>
                            <span class="property-value">${vertex.pos[0].toFixed(2)}°, ${vertex.pos[1].toFixed(2)}°</span>
                        </div>

                        <div class="property-group">
                            <label class="property-label">On Plate</label>
                            <span class="property-value">${plate.name}</span>
                        </div>

                        <div class="property-group" style="background: var(--bg-elevated); padding: 8px; border-radius: 4px; margin-bottom: 8px;">
                            <div style="font-size: 10px; color: var(--text-secondary); margin-bottom: 4px; font-weight: 600;">PLATE MESH INFO</div>
                            <div style="display: flex; justify-content: space-between; font-size: 11px;">
                                <span>Total Vertices:</span>
                                <span style="font-weight: bold; color: var(--color-primary);">${plate.crustMesh.length}</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; font-size: 11px;">
                                <span>Simulated To:</span>
                                <span style="font-weight: bold; color: var(--accent-success);">${this.getDisplayTimeValue(plate.elevationSimulatedTime || plate.birthTime)} Ma</span>
                            </div>
                        </div>

                        <div class="property-group">
                            <label class="property-label">Elevation (m)</label>
                            <input type="number" id="prop-vertex-elevation" class="property-input" value="${Math.round(vertex.elevation)}" step="100">
                        </div>
                        
                        <div class="property-group" style="margin-top: 8px;">
                            <button id="btn-smooth-elevation" class="btn btn-secondary" style="width: 100%; font-size: 11px;">
                                Smooth with Neighbors
                            </button>
                        </div>

                        <div class="property-group">
                            <label class="property-label">Sediment Thickness (m)</label>
                            <span class="property-value">${Math.round(vertex.sediment)}</span>
                        </div>

                        <div class="property-group" style="margin-top:20px;">
                            <button id="btn-deselect-vertex" class="btn btn-secondary" style="width:100%">Deselect</button>
                        </div>
                    `;

                    // Bind elevation edit event
                    document.getElementById('prop-vertex-elevation')?.addEventListener('change', (e) => {
                        const val = parseFloat((e.target as HTMLInputElement).value);
                        if (!isNaN(val)) {
                            const oldElevation = vertex.elevation;
                            vertex.elevation = val;
                            
                            // Save to history for undo/redo
                            this.historyManager.push(this.state);
                            
                            this.canvasManager?.render();
                            
                            // Log the change
                            console.log(`Vertex ${vertex.id.substring(0, 8)}: Elevation ${Math.round(oldElevation)}m → ${Math.round(val)}m`);
                        }
                    });

                    // Bind smooth elevation button
                    document.getElementById('btn-smooth-elevation')?.addEventListener('click', () => {
                        this.smoothVertexElevation(plate, vertex);
                    });

                    // Bind deselect button
                    document.getElementById('btn-deselect-vertex')?.addEventListener('click', () => {
                        this.state.world.selectedVertexPlateId = null;
                        this.state.world.selectedVertexId = null;
                        this.updateUI();
                        this.canvasManager?.render();
                    });

                    return;
                }
            }
        }

        // Check for Mantle Plume Selection (No Plate, but Feature ID set)
        if (!this.state.world.selectedPlateId && this.state.world.selectedFeatureId && this.state.world.mantlePlumes) {
            const plumeId = this.state.world.selectedFeatureId;
            const plume = this.state.world.mantlePlumes.find(p => p.id === plumeId);
            
            if (plume) {
                const globalRate = this.state.world.globalOptions.hotspotSpawnRate || 1.0;
                const isGlobal = plume.spawnRate === undefined;
                const displayRate = isGlobal ? globalRate : plume.spawnRate;

                content.innerHTML = `
                    <h3 class="panel-section-title">Mantle Plume</h3>
                    
                    <div class="property-group">
                        <label class="property-label">ID</label>
                        <span class="property-value">${plume.id.substring(0,6)}</span>
                    </div>

                    <div class="property-group">
                        <label class="property-label">Position</label>
                        <span class="property-value">[${plume.position[0].toFixed(1)}, ${plume.position[1].toFixed(1)}]</span>
                    </div>

                    <div class="property-group">
                        <label class="property-label">Active</label>
                         <input type="checkbox" id="prop-plume-active" ${plume.active ? 'checked' : ''}>
                    </div>
                    
                    <div class="property-group">
                         <label class="property-label">Spawn Rate (Ma)</label>
                         <input type="number" id="prop-plume-rate-main" class="property-input" value="${displayRate}" step="0.1" min="0.1">
                    </div>

                    <div class="property-group" style="margin-top:20px;">
                        <button id="btn-delete-plume" class="btn btn-danger" style="width:100%">Delete Plume</button>
                    </div>
                `;

                // Bind events for Plume
                document.getElementById('prop-plume-active')?.addEventListener('change', (e) => {
                    plume.active = (e.target as HTMLInputElement).checked;
                });
                
                const propPlumeRate = document.getElementById('prop-plume-rate-main') as HTMLInputElement;
                
                if (propPlumeRate) {
                     propPlumeRate.addEventListener('change', (e) => {
                         const val = parseFloat((e.target as HTMLInputElement).value);
                         if (!isNaN(val) && val > 0) plume.spawnRate = val;
                     });
                }
                
                document.getElementById('btn-delete-plume')?.addEventListener('click', () => {
                     this.state.world.mantlePlumes = this.state.world.mantlePlumes?.filter(p => p.id !== plumeId);
                     this.state.world.selectedFeatureId = null;
                     this.state.world.selectedFeatureIds = [];
                     this.updateUI();
                     this.canvasManager?.render();
                });
                
                return;
            }
        }

        const plate = this.state.world.plates.find(p => p.id === this.state.world.selectedPlateId);

        if (!plate) {
            content.innerHTML = '<p class="empty-message">Select a plate to edit properties</p>';
            return;
        }

        // Euler Pole UI
        const motion = plate.motion;
        const pole = motion.eulerPole;
        const description = plate.description || '';
        const inheritDesc = plate.inheritDescription || false;

        content.innerHTML = `
      <div class="property-group">
        <label class="property-label">Name</label>
        <input type="text" id="prop-name" class="property-input" value="${plate.name}">
      </div>
      <div class="property-group">
        <label class="property-label">Description</label>
        <textarea id="prop-description" class="property-input" rows="3" placeholder="Plate description...">${description}</textarea>
      </div>
      <div class="property-group" style="justify-content: flex-start;">
        <input type="checkbox" id="prop-inherit" style="margin-right: 8px;" ${inheritDesc ? 'checked' : ''}>
        <label for="prop-inherit" class="property-label" style="width: auto;">Children Inherit Description</label>
      </div>
      
      <div class="property-group">
        <label class="property-label">Color</label>
        <input type="color" id="prop-color" class="property-color" value="${plate.color}">
      </div>
      
      <div class="property-group">
        <label class="property-label">Crust Type</label>
        <select id="prop-crust-type" class="property-input">
            <option value="continental" ${plate.crustType === 'continental' ? 'selected' : ''}>Continental</option>
            <option value="oceanic" ${plate.crustType === 'oceanic' ? 'selected' : ''}>Oceanic</option>
        </select>
      </div>

      <div class="property-group">
        <label class="property-label">Density (g/cm³)</label>
        <input type="number" id="prop-density" class="property-input" value="${plate.density || (plate.crustType === 'oceanic' ? 3.0 : 2.7)}" step="0.1">
      </div>

      <div class="property-group">
        <label class="property-label">Mesh Starting Height (m) <span class="info-icon" data-tooltip="Initial elevation when mesh is generated. Leave blank to use isostatic calculation.">(i)</span></label>
        <input type="number" id="prop-mesh-height" class="property-input" value="${plate.meshStartingHeight ?? ''}" placeholder="Auto (isostatic)" step="100">
      </div>

      <div class="property-group">
        <label class="property-label">Crustal Thickness (km) <span class="info-icon" data-tooltip="Baseline crustal thickness for isostatic calculations. Continental: 35km, Oceanic: 7km, Thickened: 40-70km">(i)</span></label>
        <input type="number" id="prop-crustal-thickness" class="property-input" value="${plate.crustalThickness ?? ''}" placeholder="${plate.crustType === 'oceanic' ? 7 : 35}" step="1" min="5" max="100">
      </div>
      
      <div class="property-group">
        <label class="property-label">Layer (Z-Index) <span class="info-icon" data-tooltip="Visual stacking order. Continental plates get an automatic +1 bonus.">(i)</span></label>
        <input type="number" id="prop-z-index" class="property-input" value="${plate.zIndex || 0}" step="1" style="width: 60px;">
      </div>

      <div class="property-group">
        <label class="property-label">Timeline (Ma)</label>
        <div style="display: flex; gap: 4px;">
             <input type="number" id="prop-birth-time" class="property-input" title="Start Time" value="${this.getDisplayTimeValue(plate.birthTime)}" step="5" style="flex:1">
             <span style="align-self: center;">-</span>
             <input type="number" id="prop-death-time" class="property-input" title="End Time" value="${this.getDisplayTimeValue(plate.deathTime) ?? ''}" placeholder="Active" step="5" style="flex:1">
        </div>
      </div>

      <div class="property-group">
        <label class="property-label">Stats</label>
        <div style="background:var(--bg-elevated); padding:8px; border-radius:4px; font-size:11px; color:var(--text-secondary);">
           ${(() => {
                const R = this.state.world.globalOptions.planetRadius || 6371;
                // Calculate Area
                const geoJsonFeatures = {
                    type: "FeatureCollection",
                    features: plate.polygons.map(p => toGeoJSON(p))
                };

                // d3.geoArea returns steradians. Sphere is 4*PI steradians.
                let areaSteradians = 0;
                try {
                    // @ts-ignore
                    areaSteradians = geoArea(geoJsonFeatures);
                } catch (e) { console.error(e); }

                // Heuristic: If area > 2*PI, assume winding order inversion (unless plate is truly massive)
                // For a tectonic editor where we draw small plates, > 50% usually means "rest of world".
                if (areaSteradians > 2 * Math.PI) {
                    areaSteradians = 4 * Math.PI - areaSteradians;
                }

                const areaSqKm = areaSteradians * R * R;
                const percent = (areaSteradians / (4 * Math.PI)) * 100;

                // Max velocity at 90 degrees from pole
                // v = omega * R
                const omega = pole.rate * (Math.PI / 180);
                const vKmMa = omega * R; // km/Ma
                const maxSpeedCmYr = vKmMa * 0.1; // cm/yr

                return `
                 <div style="display:flex; justify-content:space-between; margin-bottom:2px;">
                    <span>Speed (Max):</span>
                    <span style="color:var(--text-primary);">${maxSpeedCmYr.toFixed(1)} cm/yr</span>
                 </div>
                 <div style="display:flex; justify-content:space-between; margin-bottom:2px;">
                    <span>Size:</span>
                    <span style="color:var(--text-primary);">${(areaSqKm / 1000000).toFixed(2)} M km²</span>
                 </div>
                 <div style="display:flex; justify-content:space-between;">
                    <span>Global Coverage:</span>
                    <span style="color:var(--text-primary);">${percent.toFixed(2)}%</span>
                 </div>
               `;
            })()}
        </div>
      </div>

      <hr class="property-divider">
      <h4 class="property-section-title">Euler Pole Motion</h4>
      
      <div class="property-group">
        <label class="property-label">Pole Lon</label>
        <input type="number" id="prop-pole-lon" class="property-input" value="${pole.position[0]}" step="1">
      </div>
      <div class="property-group">
        <label class="property-label">Pole Lat</label>
        <input type="number" id="prop-pole-lat" class="property-input" value="${pole.position[1]}" step="1">
      </div>
      <div class="property-group">
        <label class="property-label">
           <input type="checkbox" id="prop-pole-vis" ${pole.visible ? 'checked' : ''}> Show Pole
        </label>
      </div>

      <!-- Selective Copy Options -->
      <div style="font-size: 11px; margin-bottom: 4px; display:flex; gap: 8px; align-items: center;">
          <label style="display:flex; align-items:center; gap:4px; cursor:pointer;" title="Include angular rate in copy/paste">
               <input type="checkbox" id="cb-copy-speed" checked> Speed
          </label>
          <label style="display:flex; align-items:center; gap:4px; cursor:pointer;" title="Include pole location in copy/paste">
               <input type="checkbox" id="cb-copy-pole" checked> Pole/Dir
          </label>
      </div>

      <div class="property-group" style="flex-direction: row; gap: 8px;">
          <button id="btn-copy-momentum" class="btn btn-secondary" style="flex:1" title="Copy speed, direction, and pole">📋 Copy</button>
          <button id="btn-paste-momentum" class="btn btn-secondary" style="flex:1" title="Paste motion settings" ${this.momentumClipboard ? '' : 'disabled'}>📋 Paste</button>
      </div>
      
      <button id="btn-delete-plate" class="btn btn-danger">Delete Plate</button>
      ${this.getFeaturePropertiesHtml(plate)}
    `;

        // Bind events
        document.getElementById('prop-name')?.addEventListener('change', (e) => {
            plate.name = (e.target as HTMLInputElement).value;
            this.updateExplorer();
        });

        document.getElementById('prop-description')?.addEventListener('change', (e) => {
            plate.description = (e.target as HTMLTextAreaElement).value;
        });

        document.getElementById('prop-inherit')?.addEventListener('change', (e) => {
            plate.inheritDescription = (e.target as HTMLInputElement).checked;
        });

        document.getElementById('prop-color')?.addEventListener('change', (e) => {
            plate.color = (e.target as HTMLInputElement).value;
            this.updateExplorer();
            this.canvasManager?.render();
        });

        document.getElementById('prop-crust-type')?.addEventListener('change', (e) => {
            const val = (e.target as HTMLSelectElement).value as 'continental' | 'oceanic';
            plate.crustType = val;
            
            // Auto-update density defaults
            const densityInput = document.getElementById('prop-density') as HTMLInputElement;
            if (val === 'oceanic') {
                plate.density = 3.0;
                if (densityInput) densityInput.value = "3.0";
            } else {
                plate.density = 2.7;
                if (densityInput) densityInput.value = "2.7";
            }
            this.canvasManager?.render();
        });

        document.getElementById('prop-density')?.addEventListener('change', (e) => {
            const val = parseFloat((e.target as HTMLInputElement).value);
            if (!isNaN(val)) {
                plate.density = val;
            }
        });

        document.getElementById('prop-mesh-height')?.addEventListener('change', (e) => {
            const val = (e.target as HTMLInputElement).value;
            if (val === '' || val === null) {
                // Clear custom height to use isostatic calculation
                plate.meshStartingHeight = undefined;
            } else {
                const numVal = parseFloat(val);
                if (!isNaN(numVal)) {
                    plate.meshStartingHeight = numVal;
                    // If mesh already generated, clear it so it regenerates with new height
                    if (plate.crustMesh && plate.crustMesh.length > 0) {
                        plate.crustMesh = undefined;
                        plate.elevationSimulatedTime = undefined;
                        this.canvasManager?.render();
                    }
                }
            }
        });

        document.getElementById('prop-crustal-thickness')?.addEventListener('change', (e) => {
            const val = (e.target as HTMLInputElement).value;
            if (val === '' || val === null) {
                // Clear custom thickness to use reference thickness
                plate.crustalThickness = undefined;
            } else {
                const numVal = parseFloat(val);
                if (!isNaN(numVal) && numVal > 0) {
                    plate.crustalThickness = numVal;
                    // Clear mesh so it regenerates with new thickness
                    if (plate.crustMesh && plate.crustMesh.length > 0) {
                        plate.crustMesh = undefined;
                        plate.elevationSimulatedTime = undefined;
                        this.canvasManager?.render();
                    }
                }
            }
        });

        document.getElementById('prop-z-index')?.addEventListener('change', (e) => {
            const val = parseInt((e.target as HTMLInputElement).value);
            if (!isNaN(val)) {
                plate.zIndex = val;
                this.canvasManager?.render();
            }
        });

        document.getElementById('prop-birth-time')?.addEventListener('change', (e) => {
            const userInput = parseFloat((e.target as HTMLInputElement).value);
            if (!isNaN(userInput)) {
                // Transform user input (positive or negative) to internal time
                plate.birthTime = this.transformInputTime(userInput);
                this.canvasManager?.render();
            }
        });

        document.getElementById('prop-death-time')?.addEventListener('change', (e) => {
            const val = (e.target as HTMLInputElement).value;
            if (val) {
                const userInput = parseFloat(val);
                if (!isNaN(userInput)) {
                    // Transform user input (positive or negative) to internal time
                    plate.deathTime = this.transformInputTime(userInput);
                } else {
                    plate.deathTime = null;
                }
            } else {
                plate.deathTime = null;
            }
            this.canvasManager?.render();
        });

        document.getElementById('prop-pole-lon')?.addEventListener('change', (e) => {
            this.pushState(); // Save state for undo
            const newLon = parseFloat((e.target as HTMLInputElement).value);
            this.addMotionKeyframe(plate.id, { ...pole, position: [newLon, pole.position[1]] });
        });
        document.getElementById('prop-pole-lat')?.addEventListener('change', (e) => {
            this.pushState(); // Save state for undo
            const newLat = parseFloat((e.target as HTMLInputElement).value);
            this.addMotionKeyframe(plate.id, { ...pole, position: [pole.position[0], newLat] });
        });
        document.getElementById('prop-pole-vis')?.addEventListener('change', (e) => {
            pole.visible = (e.target as HTMLInputElement).checked;
            this.canvasManager?.render();
        });
        
        document.getElementById('btn-copy-momentum')?.addEventListener('click', () => {
            const cbSpeed = document.getElementById('cb-copy-speed') as HTMLInputElement;
            const cbPole = document.getElementById('cb-copy-pole') as HTMLInputElement;

            this.momentumClipboard = {
                eulerPole: {
                    position: cbPole && cbPole.checked ? [...plate.motion.eulerPole.position] : undefined,
                    rate: cbSpeed && cbSpeed.checked ? plate.motion.eulerPole.rate : undefined
                }
            };
            const pasteBtn = document.getElementById('btn-paste-momentum') as HTMLButtonElement;
            if (pasteBtn) pasteBtn.disabled = false;
            // alert('Momentum copied to clipboard');
        });

        document.getElementById('btn-paste-momentum')?.addEventListener('click', () => {
            if (!this.momentumClipboard) return;
            const cbSpeed = document.getElementById('cb-copy-speed') as HTMLInputElement;
            const cbPole = document.getElementById('cb-copy-pole') as HTMLInputElement;
            
            // Check checkboxes again for PASTE filtering (allowing user to uncheck before paste)
            // Or rely on clipboard content? 
            // User request: "add default on checkboxes ... so that the user can also only copy selective attributes"
            // Interpreting this as: Checkboxes affect what gets applied/pasted.
            
            const doPasteSpeed = cbSpeed && cbSpeed.checked;
            const doPastePole = cbPole && cbPole.checked;
            const clip = this.momentumClipboard.eulerPole;

            const newRate = (doPasteSpeed && clip.rate !== undefined) ? clip.rate : plate.motion.eulerPole.rate;
            const newPos = (doPastePole && clip.position !== undefined) ? clip.position : plate.motion.eulerPole.position;

            this.pushState(); // Save state for undo
            this.addMotionKeyframe(plate.id, {
                position: newPos,
                rate: newRate
            });

            this.updatePropertiesPanel(); // Refresh UI to show new values
            // alert('Momentum pasted');
        });

        document.getElementById('btn-delete-plate')?.addEventListener('click', () => {
            this.deleteSelected();
        });

        // Bind feature property events
        this.bindFeatureEvents();

        // Update Timeline Panel
        if (this.timelineSystem) {
            this.timelineSystem.render(plate);
        }
    }
    private getFeaturePropertiesHtml(plate: TectonicPlate): string {
        const { selectedFeatureId, selectedFeatureIds, currentTime } = this.state.world;


        // Check if exactly one feature is selected
        const singleFeatureId = selectedFeatureIds.length === 1
            ? selectedFeatureIds[0]
            : (selectedFeatureIds.length === 0 ? selectedFeatureId : null);

        if (!singleFeatureId) {
            let html = '';
            
            if (selectedFeatureIds.length > 1) {
                 html += `
                  <hr class="property-divider">
                  <h4 class="property-section-title">Features</h4>
                  <p class="empty-message">${selectedFeatureIds.length} features selected</p>
                 `;
            } else {
                 html += '<hr class="property-divider"><h4 class="property-section-title">Features</h4>';
            }
            
            // Plate Bound
            html += '<h5 style="margin:4px 0; font-size: 11px; color:var(--text-secondary);">Plate Bound</h5>';
            const features = plate.features;
            if (features.length > 0) {
                html += '<div style="max-height:150px; overflow-y:auto; display:flex; flex-direction:column; gap:2px;">';
                features.forEach(f => {
                    const name = f.name || this.getFeatureTypeName(f.type);
                    html += `<div class="feature-list-item" data-id="${f.id}" style="cursor:pointer; padding:4px; background:var(--bg-elevated); border-radius:2px; font-size:11px; display:flex; justify-content:space-between;">
                        <span>${name}</span>
                        <span style="color:var(--text-secondary);">${this.getFeatureTypeName(f.type)}</span>
                    </div>`;
                });
                html += '</div>';
            } else {
                html += '<div style="font-size:10px; color:var(--text-secondary); padding:4px;">None</div>';
            }

            // Independent (Mantle Plumes)
            const plumes = this.state.world.mantlePlumes || [];
            if (plumes.length > 0) {
                html += '<h5 style="margin:8px 0 4px 0; font-size: 11px; color:var(--text-secondary);">Independent</h5>';
                html += '<div style="max-height:100px; overflow-y:auto; display:flex; flex-direction:column; gap:2px;">';
                plumes.forEach(p => {
                    const activeColor = p.active ? '#ff00aa' : '#888888';
                    html += `<div class="plume-list-item" data-id="${p.id}" style="cursor:pointer; padding:4px; background:var(--bg-elevated); border-radius:2px; font-size:11px; border-left: 2px solid ${activeColor}; display:flex; justify-content:space-between;">
                        <span>Mantle Plume</span>
                        <span style="color:var(--text-secondary);">${p.id.substring(0,6)}</span>
                    </div>`;
                });
                html += '</div>';
            }

            return html;
        }

        const feature = plate.features.find(f => f.id === singleFeatureId);
        if (!feature) return '';

        // Calculate age for display, but allow editing generatedAt directly
        const createdAt = feature.generatedAt ?? currentTime;
        const age = (currentTime - createdAt).toFixed(1);

        // Default name to type if not set
        const displayName = feature.name || this.getFeatureTypeName(feature.type);
        const description = feature.description || '';

        return `
      <hr class="property-divider">
      <h4 class="property-section-title">Feature Properties</h4>
      <div class="property-group">
        <label class="property-label">Type</label>
        <span class="property-value">${this.getFeatureTypeName(feature.type)}</span>
      </div>
      <div class="property-group">
        <label class="property-label">Created At(Ma)</label>
        <input type="number" id="feature-created-at" class="property-input" value="${this.getDisplayTimeValue(feature.generatedAt)?.toFixed(1) ?? ''}" step="0.1" style="width: 80px;">
        <span class="property-hint" style="margin-left: 8px; color: #888;">Age: ${age} Ma</span>
      </div>
      <div class="property-group">
        <label class="property-label">Ends At(Ma)</label>
        <input type="number" id="feature-death-time" class="property-input" value="${this.getDisplayTimeValue(feature.deathTime) !== null ? this.getDisplayTimeValue(feature.deathTime)?.toFixed(1) : ''}" step="0.1" style="width: 80px;" placeholder="Never">
      </div>
      <div class="property-group">
        <label class="property-label">Name</label>
        <input type="text" id="feature-name" class="property-input" value="${displayName}" placeholder="Feature name...">
      </div>
      <div class="property-group">
        <label class="property-label">Description</label>
        <textarea id="feature-description" class="property-input" rows="2" placeholder="Description...">${description}</textarea>
      </div>
      ${(() => {
          if (feature.type === 'hotspot' && feature.properties?.source === 'plume' && feature.properties?.plumeId) {
             const plumeId = feature.properties.plumeId as string;
             const plume = this.state.world.mantlePlumes?.find(p => p.id === plumeId);
             if (plume) {
                 const currentRate = plume.spawnRate;
                 const globalRate = this.state.world.globalOptions.hotspotSpawnRate || 1.0;
                 // If define, use it. If undefined, it uses global.
                 const isGlobal = currentRate === undefined;
                 const displayRate = isGlobal ? globalRate : currentRate;
                 
                 return `
                   <hr class="property-divider">
                   <h4 class="property-section-title">Mantle Plume Source</h4>
                   <div style="background:var(--bg-elevated); padding:8px; border-radius:4px;">
                       <div class="property-group">
                         <label class="property-label">Spawn Rate (Ma)</label>
                         <input type="number" id="prop-plume-rate" class="property-input" value="${displayRate}" step="0.1" min="0.1" ${isGlobal ? 'disabled' : ''}>
                       </div>
                       <div class="property-group" style="justify-content:flex-start">
                         <input type="checkbox" id="prop-plume-use-global" style="margin-right:8px;" ${isGlobal ? 'checked' : ''}>
                         <label for="prop-plume-use-global" class="property-label" style="width:auto;">Use Global Rate</label>
                       </div>
                   </div>
                 `;
             }
          }
          return '';
      })()}
    `;
    }

    private bindFeatureEvents(): void {
        const { selectedFeatureId, selectedFeatureIds } = this.state.world;
        const singleFeatureId = selectedFeatureIds.length === 1
            ? selectedFeatureIds[0]
            : (selectedFeatureIds.length === 0 ? selectedFeatureId : null);

        if (!singleFeatureId) {
             // Bind list events
             document.querySelectorAll('.feature-list-item').forEach(el => {
                 el.addEventListener('click', () => {
                     const id = el.getAttribute('data-id');
                     if (id) {
                         this.state.world.selectedFeatureId = id;
                         this.state.world.selectedFeatureIds = [id];
                         this.updateUI();
                         this.canvasManager?.render();
                     }
                 });
             });
             document.querySelectorAll('.plume-list-item').forEach(el => {
                 el.addEventListener('click', () => {
                     const id = el.getAttribute('data-id');
                     if (id) {
                         this.state.world.selectedPlateId = null; 
                         this.state.world.selectedFeatureId = id;
                         this.state.world.selectedFeatureIds = [];
                         this.updateUI();
                         this.canvasManager?.render();
                     }
                 });
             });
             return;
        }

        document.getElementById('feature-name')?.addEventListener('change', (e) => {
            this.updateFeature(singleFeatureId, { name: (e.target as HTMLInputElement).value });
        });

        document.getElementById('feature-description')?.addEventListener('change', (e) => {
            this.updateFeature(singleFeatureId, { description: (e.target as HTMLTextAreaElement).value });
        });

        document.getElementById('feature-created-at')?.addEventListener('change', (e) => {
            const userInput = parseFloat((e.target as HTMLInputElement).value);
            if (!isNaN(userInput)) {
                // Transform user input (positive or negative) to internal time
                const internalTime = this.transformInputTime(userInput);
                this.updateFeature(singleFeatureId, { generatedAt: internalTime });
            }
        });

        document.getElementById('feature-death-time')?.addEventListener('change', (e) => {
            const val = (e.target as HTMLInputElement).value;
            if (val === '' || val === null) {
                this.updateFeature(singleFeatureId, { deathTime: undefined });
            } else {
                const userInput = parseFloat(val);
                if (!isNaN(userInput)) {
                    // Transform user input (positive or negative) to internal time
                    const internalTime = this.transformInputTime(userInput);
                    this.updateFeature(singleFeatureId, { deathTime: internalTime });
                }
            }
        });

        // Plume Override Logic
        const propPlumeRate = document.getElementById('prop-plume-rate') as HTMLInputElement;
        const propPlumeUseGlobal = document.getElementById('prop-plume-use-global') as HTMLInputElement;

        if (propPlumeRate && propPlumeUseGlobal) {
             // Find plume ID
             // We need to look up the feature again
             const plates = this.state.world.plates;
             let feature;
             for (const p of plates) {
                 feature = p.features.find(f => f.id === singleFeatureId);
                 if (feature) break;
             }

             if (feature && feature.type === 'hotspot' && feature.properties?.plumeId) {
                 const plumeId = feature.properties.plumeId;
                 const plume = this.state.world.mantlePlumes?.find(p => p.id === plumeId);

                 if (plume) {
                     propPlumeUseGlobal.addEventListener('change', (e) => {
                         const useGlobal = (e.target as HTMLInputElement).checked;
                         propPlumeRate.disabled = useGlobal;
                         
                         if (useGlobal) {
                             delete plume.spawnRate;
                             propPlumeRate.value = (this.state.world.globalOptions.hotspotSpawnRate || 1.0).toString();
                         } else {
                             plume.spawnRate = parseFloat(propPlumeRate.value) || 1.0;
                         }
                     });

                     propPlumeRate.addEventListener('change', (e) => {
                         const val = parseFloat((e.target as HTMLInputElement).value);
                         if (!isNaN(val) && val > 0) {
                             plume.spawnRate = val;
                         }
                     });
                 }
             }
        }
    }

    private getFeatureTypeName(type: FeatureType): string {
        const names: Record<FeatureType, string> = {
            mountain: 'Mountain',
            volcano: 'Volcano',
            hotspot: 'Hotspot',
            rift: 'Rift',
            trench: 'Trench',
            island: 'Island',
            weakness: 'Weakness',
            poly_region: 'Polygon Region',
            flowline: 'Flowline',
            seafloor: 'Seafloor'
        };
        return names[type] || type;
    }

    private updatePlayButton(): void {
        const btn = document.getElementById('btn-play');
        if (btn) btn.textContent = this.state.world.isPlaying ? '⏸️' : '▶️';
    }

    /**
     * Show a brief toast notification
     */
    private showToast(message: string, duration: number = 2000): void {
        // Remove existing toast if any
        const existing = document.getElementById('toast-notification');
        if (existing) existing.remove();
        
        const toast = document.createElement('div');
        toast.id = 'toast-notification';
        toast.style.cssText = `
            position: fixed;
            bottom: 80px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(30, 30, 46, 0.95);
            color: #cdd6f4;
            padding: 12px 24px;
            border-radius: 8px;
            font-size: 14px;
            z-index: 10000;
            pointer-events: none;
            animation: toastFadeIn 0.2s ease-out;
            border: 1px solid rgba(137, 180, 250, 0.3);
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        `;
        toast.textContent = message;
        
        // Add animation keyframes if not present
        if (!document.getElementById('toast-styles')) {
            const style = document.createElement('style');
            style.id = 'toast-styles';
            style.textContent = `
                @keyframes toastFadeIn {
                    from { opacity: 0; transform: translateX(-50%) translateY(10px); }
                    to { opacity: 1; transform: translateX(-50%) translateY(0); }
                }
                @keyframes toastFadeOut {
                    from { opacity: 1; transform: translateX(-50%) translateY(0); }
                    to { opacity: 0; transform: translateX(-50%) translateY(10px); }
                }
            `;
            document.head.appendChild(style);
        }
        
        document.body.appendChild(toast);
        
        setTimeout(() => {
            toast.style.animation = 'toastFadeOut 0.2s ease-in forwards';
            setTimeout(() => toast.remove(), 200);
        }, duration);
    }

    private updateTimeDisplay(): void {
        const display = document.getElementById('current-time');
        const slider = document.getElementById('time-slider') as HTMLInputElement;
        const modeLabel = document.getElementById('time-mode-label');
        
        // Get current max time from timeline input
        const maxTimeInput = document.getElementById('timeline-max-time') as HTMLInputElement;
        const maxTime = maxTimeInput ? parseInt(maxTimeInput.value) : 500;
        
        // Transform internal time to display time
        const displayTime = toDisplayTime(this.state.world.currentTime, {
            maxTime: maxTime,
            mode: this.state.world.timeMode
        });
        
        // Update display
        if (display) display.textContent = Math.abs(displayTime).toFixed(1);
        if (slider) slider.value = String(this.state.world.currentTime);
        
        // Update label
        const label = this.state.world.timeMode === 'negative' ? 'years ago' : 'Ma';
        if (modeLabel) modeLabel.textContent = label;
    }

    private confirmTimeInput(): void {
        const input = document.getElementById('time-input-field') as HTMLInputElement;
        const modal = document.getElementById('time-input-modal');
        
        if (!input || !modal) return;
        
        const displayTimeStr = input.value.trim();
        const parsedDisplayTime = parseTimeInput(displayTimeStr);
        
        if (parsedDisplayTime === null) {
            alert('Please enter a valid time value');
            return;
        }
        
        // Get max time for transformation
        const maxTimeInput = document.getElementById('timeline-max-time') as HTMLInputElement;
        const maxTime = maxTimeInput ? parseInt(maxTimeInput.value) : 500;
        
        // Transform display time to internal time
        const internalTime = toInternalTime(parsedDisplayTime, {
            maxTime: maxTime,
            mode: this.state.world.timeMode
        });
        
        // Set the time
        this.simulation?.setTime(internalTime);
        this.updateTimeDisplay();
        
        // Close modal
        modal.style.display = 'none';
    }

    /**
     * Get display value for a time based on current time mode
     * Used for showing time in property fields and attributes
     * @param internalTime - Internal positive time value
     * @returns Display value (positive or negative based on mode)
     */
    private getDisplayTimeValue(internalTime: number | null | undefined): number | null {
        if (internalTime === null || internalTime === undefined) return null;
        
        const maxTimeInput = document.getElementById('timeline-max-time') as HTMLInputElement;
        const maxTime = maxTimeInput ? parseInt(maxTimeInput.value) : 500;
        
        return toDisplayTime(internalTime, {
            maxTime: maxTime,
            mode: this.state.world.timeMode
        });
    }

    private transformInputTime(userInputTime: number): number {
        const maxTimeInput = document.getElementById('timeline-max-time') as HTMLInputElement;
        const maxTime = maxTimeInput ? parseInt(maxTimeInput.value) : 500;
        
        return toInternalTime(userInputTime, {
            maxTime: maxTime,
            mode: this.state.world.timeMode
        });
    }

    private getMaxTime(): number {
        const maxTimeInput = document.getElementById('timeline-max-time') as HTMLInputElement;
        return maxTimeInput ? parseInt(maxTimeInput.value) : 500;
    }

    private addMotionKeyframe(plateId: string, newEulerPole: { position: Coordinate; rate: number; visible?: boolean }): void {
        const currentTime = this.state.world.currentTime;
        const plate = this.state.world.plates.find(p => p.id === plateId);
        if (!plate) return;

        // If keyframe exists at exactly currentTime, update it.
        // Otherwise insert new one.
        // Simplifying assumption: We usually work with the single active keyframe for MVP
        // checking if we have keyframes...

        // For now, simple update of 'motion' property (which mimics having a keyframe)
        // AND adding to keyframes array if we support it.

        const plates = this.state.world.plates.map(p => {
            let processedPlate = p;

            // 1. Apply Motion Change if this is the target plate
            if (p.id === plateId) {
                const updated = { ...p };

                // Update Motion
                updated.motion = {
                    ...p.motion,
                    eulerPole: {
                        ...p.motion.eulerPole,
                        position: newEulerPole.position,
                        rate: newEulerPole.rate,
                        visible: newEulerPole.visible ?? p.motion.eulerPole.visible
                    }
                };

                // Add/Update Keyframe
                const newKeyframe: MotionKeyframe = {
                    time: currentTime,
                    eulerPole: updated.motion.eulerPole,
                    snapshotPolygons: p.polygons,
                    snapshotFeatures: p.features,
                    snapshotPaintStrokes: p.paintStrokes || []
                };

                const otherKeyframes = (p.motionKeyframes || []).filter(k => Math.abs(k.time - currentTime) > 0.001);
                updated.motionKeyframes = [...otherKeyframes, newKeyframe].sort((a, b) => a.time - b.time);

                processedPlate = updated;
            }

            // 2. TIMELINE INTEGRITY: Prune "Future" Orogeny strokes
            // When history is changed (motion keyframe added/modified), any Orogeny strokes 
            // generated in the future of the current time are now invalid results of a previous timeline.
            // We must prune them to avoid "ghosts" of interactions that may no longer happen.
            if (processedPlate.paintStrokes && processedPlate.paintStrokes.length > 0) {
                const prunedStrokes = processedPlate.paintStrokes.filter(s => {
                    // Keep manual strokes (user drawing)
                    if (s.source !== 'orogeny') return true;
                    
                    // Keep strokes from the past (birthTime < currentTime)
                    // We treat stroke at Exactly currentTime as "past" (keep it) or "future" (discard)?
                    // Since we are changing motion AT currentTime, the stroke generated AT currentTime 
                    // is based on the OLD motion. It should probably be discarded so it can be regenerated this frame.
                    // So: discard if birthTime >= currentTime.
                    if (s.birthTime !== undefined && s.birthTime >= currentTime) return false;
                    
                    return true;
                });

                if (prunedStrokes.length !== processedPlate.paintStrokes.length) {
                    processedPlate = {
                        ...processedPlate,
                        paintStrokes: prunedStrokes
                    };
                    
                    // If we just modified the target plate's keyframe above, we should update the snapshot too,
                    // otherwise the keyframe snapshot contains invalid future strokes.
                    // However, snapshots represent the state "at that time".
                    // If we are at T=50, the "future" strokes shouldn't exist in reality.
                    // So cleaning them is correct.
                    if (processedPlate.id === plateId && processedPlate.motionKeyframes) {
                        // Find the keyframe we just added/updated (it's at currentTime)
                        const keyframeIndex = processedPlate.motionKeyframes.findIndex(k => Math.abs(k.time - currentTime) < 0.001);
                        if (keyframeIndex !== -1) {
                            const kf = processedPlate.motionKeyframes[keyframeIndex];
                            processedPlate.motionKeyframes[keyframeIndex] = {
                                ...kf,
                                snapshotPaintStrokes: prunedStrokes
                            };
                        }
                    }
                }
            }

            return processedPlate;
        });

        this.state = {
            ...this.state,
            world: { ...this.state.world, plates }
        };
        this.updateUI();
        this.simulation?.setTime(this.state.world.currentTime);
        this.canvasManager?.render();
    }

    private handleDragTargetRequest(plateId: string, axis: Vector3, angleRad: number): void {
        const modal = document.getElementById('drag-target-modal');
        const input = document.getElementById('drag-target-input') as HTMLInputElement;
        const btnConfirm = document.getElementById('btn-drag-target-confirm');
        const btnCancel = document.getElementById('btn-drag-target-cancel');
        const lblCurrent = document.getElementById('drag-target-current-time');
        const lblSpeedDeg = document.getElementById('drag-target-speed-deg');
        const lblSpeedCm = document.getElementById('drag-target-speed-cm');
        const lblWarning = document.getElementById('drag-target-warning');

        if (!modal || !input || !btnConfirm || !btnCancel || !lblCurrent || !lblSpeedDeg || !lblSpeedCm) {
            console.error("Modal elements missing");
            return;
        }

        const current = this.state.world.currentTime;
        const displayCurrent = toDisplayTime(current, {
            maxTime: this.getMaxTime(),
            mode: this.state.world.timeMode
        });
        
        lblCurrent.textContent = String(displayCurrent);
        input.value = '';
        lblSpeedDeg.textContent = '--';
        lblSpeedCm.textContent = '--';
        if (lblWarning) lblWarning.style.display = 'none';

        // Show Modal
        modal.style.display = 'flex';
        input.focus();

        let cleanup: () => void;

        const close = () => {
            modal.style.display = 'none';
            cleanup();
        };

        const calculate = () => {
            const val = parseFloat(input.value);
            if (isNaN(val)) {
                lblSpeedDeg.textContent = '--';
                lblSpeedCm.textContent = '--';
                if (lblWarning) lblWarning.style.display = 'none';
                return null;
            }

            // Transform input time to internal time
            const targetTime = this.transformInputTime(val);
            const dt = targetTime - current;

            // Handle very small dt to avoid infinity
            if (Math.abs(dt) < 0.001) {
                lblSpeedDeg.textContent = '∞';
                lblSpeedCm.textContent = '∞';
                if (lblWarning) lblWarning.style.display = 'none';
                return null;
            }

            const angleDeg = angleRad * 180 / Math.PI;
            const rate = angleDeg / dt; 

            const speedMag = Math.abs(rate);
            lblSpeedDeg.textContent = rate.toFixed(2);
            
            const cmYr = this.convertDegMaToCmYr(speedMag);
            lblSpeedCm.textContent = cmYr.toFixed(2);

            if (cmYr > 20 && lblWarning) lblWarning.style.display = 'block';
            else if (lblWarning) lblWarning.style.display = 'none';

            return rate;
        };

        const onInput = () => calculate();

        const onConfirm = () => {
             const rate = calculate();
             if (rate === null) {
                 return;
             }
             
             const pole = vectorToLatLon(axis);
             this.handleMotionChange(plateId, pole, rate);
             close();
        };

        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Enter') onConfirm();
            if (e.key === 'Escape') close();
        };

        // Listeners
        input.addEventListener('input', onInput);
        btnConfirm.addEventListener('click', onConfirm);
        btnCancel.addEventListener('click', close);
        window.addEventListener('keydown', onKey);

        cleanup = () => {
            input.removeEventListener('input', onInput);
            btnConfirm.removeEventListener('click', onConfirm);
            btnCancel.removeEventListener('click', close);
            window.removeEventListener('keydown', onKey);
        };
    }

    private handleMotionChange(plateId: string, pole: Coordinate, rate: number): void {
        this.pushState();
        const newEulerPole = { position: pole, rate };

        // Find linked plates
        const plate = this.state.world.plates.find(p => p.id === plateId);
        const linkedIds = plate?.linkedPlateIds || [];
        const allIds = [plateId, ...linkedIds];
        // Deduplicate
        const uniqueIds = Array.from(new Set(allIds));

        uniqueIds.forEach(id => this.addMotionKeyframe(id, newEulerPole));
        
        // Refresh property panel to show updated Euler pole position
        this.updatePropertiesPanel();
        // Force a canvas render to update Euler pole visualization
        this.canvasManager?.render();
    }

    /** Push current state to history (call before meaningful changes) */
    private pushState(): void {
        this.historyManager.push(this.state);
        this.updateUndoRedoButtons();
    }

    /** Undo last action */
    private undo(): void {
        const prevState = this.historyManager.undo(this.state);
        if (prevState) {
            this.state = prevState;
            this.updateUI();
            this.canvasManager?.render();
            // Update timeline if visible
            if (this.state.world.selectedPlateId) {
                const p = this.state.world.plates.find(pl => pl.id === this.state.world.selectedPlateId);
                this.timelineSystem?.render(p || null);
            }
        }
        this.updateUndoRedoButtons();
    }

    /** Redo last undone action */
    private redo(): void {
        const nextState = this.historyManager.redo(this.state);
        if (nextState) {
            this.state = nextState;
            this.updateUI();
            this.canvasManager?.render();
            // Update timeline if visible
            if (this.state.world.selectedPlateId) {
                const p = this.state.world.plates.find(pl => pl.id === this.state.world.selectedPlateId);
                this.timelineSystem?.render(p || null);
            }
        }
        this.updateUndoRedoButtons();
    }

    /** Update undo/redo button states */
    private updateUndoRedoButtons(): void {
        const undoBtn = document.getElementById('btn-undo') as HTMLButtonElement;
        const redoBtn = document.getElementById('btn-redo') as HTMLButtonElement;
        if (undoBtn) undoBtn.disabled = !this.historyManager.canUndo();
        if (redoBtn) redoBtn.disabled = !this.historyManager.canRedo();
    }

    // Helper for TimelineSystem to replace a plate (updating state)
    public replacePlate(plate: TectonicPlate, invalidationTime?: number): void {
        const index = this.state.world.plates.findIndex(p => p.id === plate.id);
        if (index !== -1) {
            let newPlates = [...this.state.world.plates];
            newPlates[index] = plate;

            // Prune Future Orogeny Strokes if time provided
            if (invalidationTime !== undefined) {
                newPlates = newPlates.map(p => {
                    if (!p.paintStrokes) return p;
                    const pruned = p.paintStrokes.filter(s => {
                        // Keep manual strokes (user drawing)
                        if (s.source !== 'orogeny') return true;
                        // Prune if birthTime is after invalidation time
                        if (s.birthTime !== undefined && s.birthTime >= invalidationTime) return false;
                        return true;
                    });
                    
                    if (pruned.length !== p.paintStrokes.length) {
                        return { ...p, paintStrokes: pruned };
                    }
                    return p;
                });
            }

            this.state = {
                ...this.state,
                world: { ...this.state.world, plates: newPlates }
            };

            this.canvasManager?.render();
        }
    }

    // Helper for TimelineSystem to delete multiple plates
    public deletePlates(ids: string[]): void {
        const idSet = new Set(ids);

        // Find parents potentially affected by child deletion
        const parentIds = new Set<string>();
        const deletedPlates = this.state.world.plates.filter(p => idSet.has(p.id));
        deletedPlates.forEach(p => {
            if (p.parentPlateId) parentIds.add(p.parentPlateId);
            if (p.parentPlateIds) p.parentPlateIds.forEach(id => parentIds.add(id));
        });

        // 1. Initial filter
        let newPlates = this.state.world.plates.filter(p => !idSet.has(p.id));

        // 2. Cleanup parents
        if (parentIds.size > 0) {
            newPlates = newPlates.map(p => {
                if (parentIds.has(p.id)) {
                    const plateBirthTimes = deletedPlates
                        .filter(dp => dp.parentPlateId === p.id || (dp.parentPlateIds && dp.parentPlateIds.includes(p.id)))
                        .map(dp => dp.birthTime);

                    if (plateBirthTimes.length > 0) {
                        const updatedEvents = (p.events || []).filter(evt => {
                            if (evt.type === 'split' || evt.type === 'fusion') {
                                return !plateBirthTimes.some(bt => Math.abs(evt.time - bt) < 0.1);
                            }
                            return true;
                        });

                        // If all splits/fusions at deathTime are gone, resurrect parent
                        let newDeathTime = p.deathTime;
                        if (p.deathTime !== null) {
                            const stillHasEvent = updatedEvents.some(e => (e.type === 'split' || e.type === 'fusion') && Math.abs(e.time - p.deathTime!) < 0.1);
                            if (!stillHasEvent) newDeathTime = null;
                        }

                        return { ...p, events: updatedEvents, deathTime: newDeathTime };
                    }
                }
                return p;
            });
        }

        this.state = {
            ...this.state,
            world: {
                ...this.state.world,
                plates: newPlates,
                selectedPlateId: idSet.has(this.state.world.selectedPlateId || '') ? null : this.state.world.selectedPlateId
            }
        };
        this.updateUI();
        this.canvasManager?.render();
    }
}

new TectoLiteApp();
