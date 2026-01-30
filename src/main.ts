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
    MotionKeyframe
} from './types';
import { CanvasManager } from './canvas/CanvasManager';
import { SimulationEngine } from './SimulationEngine';
import { exportToPNG, showPNGExportDialog } from './export';
import { splitPlate } from './SplitTool';
import { fusePlates } from './FusionTool';
import { vectorToLatLon, Vector3 } from './utils/sphericalMath';
import { HistoryManager } from './HistoryManager';
import { exportToJSON, parseImportFile, showImportDialog, showHeightmapExportDialog } from './export';
import { HeightmapGenerator } from './systems/HeightmapGenerator';
import { TimelineSystem } from './systems/TimelineSystem';

class TectoLiteApp {
    private state: AppState;
    private canvasManager: CanvasManager | null = null;
    private simulation: SimulationEngine | null = null;
    private historyManager: HistoryManager = new HistoryManager();
    private fusionFirstPlateId: string | null = null; // Track first plate for fusion
    private activeLinkSourceId: string | null = null; // Track first plate for linking
    private momentumClipboard: { eulerPole: { position: Coordinate; rate: number } } | null = null; // Clipboard for momentum
    private timelineSystem: TimelineSystem | null = null;

    constructor() {
        this.state = createDefaultAppState();
        this.init();
    }

    private init(): void {
        document.querySelector<HTMLDivElement>('#app')!.innerHTML = this.getHTML();

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
            (plateId, featureId, featureIds) => this.handleSelect(plateId, featureId, featureIds),
            (points) => this.handleSplitApply(points),
            (active) => this.handleSplitPreviewChange(active),
            (plateId, pole, rate) => this.handleMotionChange(plateId, pole, rate),
            (plateId, axis, angleRad) => this.handleDragTargetRequest(plateId, axis, angleRad),
            undefined,
            (active) => {
                const el = document.getElementById('motion-controls');
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

    private getHTML(): string {
        return `
      <div class="app-container">
        <header class="app-header">
          <h1 class="app-title">
            TECTOLITE <span class="app-subtitle">by <a href="https://www.refracturedgames.com" target="_blank" rel="noopener noreferrer">RefracturedGames</a></span>
          </h1>
          <div class="header-actions">
            <!-- Projection Selector -->
            <select id="projection-select" class="projection-select">
                <option value="orthographic">Globe (Orthographic)</option>
                <option value="equirectangular">Equirectangular</option>
                <option value="mercator">Mercator</option>
                <option value="mollweide">Mollweide</option>
                <option value="robinson">Robinson</option>
            </select>
            
            <button id="btn-theme-toggle" class="btn btn-secondary" title="Toggle Theme">
              <span class="icon">🌙</span>
            </button>
            <button id="btn-undo" class="btn btn-secondary" title="Undo (Ctrl+Z)">
              <span class="icon">↶</span> Undo
            </button>
            <button id="btn-redo" class="btn btn-secondary" title="Redo (Ctrl+Y)">
              <span class="icon">↷</span> Redo
            </button>
            <button id="btn-export" class="btn btn-primary">
              <span class="icon">📥</span> Export PNG
            </button>
            <button id="btn-export-heightmap" class="btn btn-primary" title="Export Heightmap">
              <span class="icon">🗺️</span> Heightmap
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
          </div>
        </header>
        
        <div class="main-content">
          <aside class="toolbar">
            <div class="tool-group">
              <h3 class="tool-group-title">Tools</h3>
              <button class="tool-btn active" data-tool="select" title="Select (V)">
                <span class="tool-icon">👆</span>
                <span class="tool-label">Select</span>
              </button>
              <button class="tool-btn" data-tool="pan" title="Rotate/Pan (H)">
                <span class="tool-icon">🔄</span>
                <span class="tool-label">Rotate</span>
              </button>
              <button class="tool-btn" data-tool="draw" title="Draw (D)">
                <span class="tool-icon">✏️</span>
                <span class="tool-label">Draw</span>
              </button>
              <button class="tool-btn" data-tool="feature" title="Feature (F)">
                <span class="tool-icon">🏔️</span>
                <span class="tool-label">Feature</span>
              </button>
              <button class="tool-btn" data-tool="split" title="Split (S)">
                <span class="tool-icon">✂️</span>
                <span class="tool-label">Split</span>
              </button>

              <button class="tool-btn" data-tool="fuse" title="Fuse Plates (G)">
                <span class="tool-icon">🧬</span>
                <span class="tool-label">Fuse</span>
              </button>

              <button class="tool-btn" data-tool="link" title="Link Plates (L)">
                <span class="tool-icon">🔗</span>
                <span class="tool-label">Link</span>
              </button>
            </div>
            
            <div class="tool-group" id="split-controls" style="display: none;">
              <h3 class="tool-group-title">Split Preview</h3>
              <button class="btn btn-success" id="btn-split-apply">✓ Apply</button>
              <button class="btn btn-secondary" id="btn-split-cancel">✗ Cancel</button>
            </div>

            <div class="tool-group" id="motion-controls" style="display: none;">
              <h3 class="tool-group-title">Confirm Motion</h3>
              <p style="font-size: 11px; margin-bottom: 8px; color: #a6adc8; line-height: 1.2;">Drag ring to rotate.</p>
              <div style="display: flex; gap: 4px;">
                  <button class="btn btn-success" id="btn-motion-apply" style="flex: 1;">✓ Apply</button>
                  <button class="btn btn-secondary" id="btn-motion-cancel" style="flex: 1;">✗ Cancel</button>
              </div>
            </div>

            <div class="tool-group" id="fuse-controls" style="display: none;">
              <h3 class="tool-group-title">Fuse Options</h3>
              <label class="view-option">
                <input type="checkbox" id="check-add-weakness" checked> Add Weakness Features
              </label>
              <label class="view-option">
                <input type="checkbox" id="check-add-mountains"> Auto Create Mountains
              </label>
            </div>


            
            <div class="tool-group" id="feature-selector">
              <h3 class="tool-group-title">Feature Type</h3>
              <button class="feature-btn active" data-feature="mountain" title="Mountain">🏔️ Mtn</button>
              <button class="feature-btn" data-feature="volcano" title="Volcano">🌋 Volc</button>
              <button class="feature-btn" data-feature="hotspot" title="Hotspot">🔥 Hot</button>
              <button class="feature-btn" data-feature="rift" title="Rift">⚡ Rift</button>
              <button class="feature-btn" data-feature="trench" title="Trench">🌊 Trn</button>
              <button class="feature-btn" data-feature="weakness" title="Weakness">💔 Weak</button>
            </div>
            
            <div class="tool-group">
                <h3 class="tool-group-title">View Options</h3>
                <label class="view-option">
                    <input type="checkbox" id="check-grid" checked> Grid
                </label>
                <div class="property-group" style="margin-top: 4px; margin-bottom: 8px; margin-left: 20px;">
                    <label class="property-label">Thickness</label>
                    <select id="grid-thickness-select" class="tool-select" style="width: 100%;">
                        <option value="0.5">Thin (0.5px)</option>
                        <option value="1.0" selected>Medium (1.0px)</option>
                        <option value="2.0">Thick (2.0px)</option>
                    </select>
                </div>
                <label class="view-option">
                    <input type="checkbox" id="check-euler"> Euler Poles
                </label>
                <label class="view-option">
                    <input type="checkbox" id="check-features" checked> Features
                </label>
                <label class="view-option">
                    <input type="checkbox" id="check-future-features"> Future/Past Features
                </label>
            </div>

            <div class="tool-group">
                <h3 class="tool-group-title">Motion Mode</h3>
                <select id="motion-mode-select" class="tool-select">
                    <option value="classic">Classic (Fixed Pole)</option>
                    <option value="dynamic_pole">Dynamic Direction</option>
                    <option value="drag_target">Drag Landmass</option>
                </select>
            </div>

            <div class="tool-group">
                <h3 class="tool-group-title">Global Options</h3>
                <label class="view-option">
                    <input type="checkbox" id="check-speed-limit"> Enable Speed Limit
                </label>
                <div class="property-group" style="margin-top: 8px;">
                    <label class="property-label">Max Speed (deg/Ma)</label>
                    <input type="number" id="global-max-speed" class="property-input" value="1.0" step="0.1" min="0.1" max="20" style="width: 80px;">
                </div>
                <div class="property-group" style="margin-top: 8px;">
                    <label class="property-label">Max Time (Ma)</label>
                    <input type="number" id="global-max-time" class="property-input" value="500" step="100" min="100" style="width: 80px;">
                </div>
                <hr class="property-divider">
                <h4 class="tool-group-title" style="font-size: 11px;">Advanced</h4>
                <label class="view-option">
                    <input type="checkbox" id="check-boundary-vis"> Show Boundaries
                </label>
                <div class="property-group" style="margin-top: 8px;">
                    <label class="property-label">Rate Preset 1</label>
                    <input type="number" id="global-rate-1" class="property-input" step="0.1" style="width: 80px;">
                </div>
                <div class="property-group" style="margin-top: 4px;">
                    <label class="property-label">Rate Preset 2</label>
                    <input type="number" id="global-rate-2" class="property-input" step="0.1" style="width: 80px;">
                </div>
                <div class="property-group" style="margin-top: 4px;">
                    <label class="property-label">Rate Preset 3</label>
                    <input type="number" id="global-rate-3" class="property-input" step="0.1" style="width: 80px;">
                </div>
                <div class="property-group" style="margin-top: 4px;">
                    <label class="property-label">Rate Preset 4</label>
                    <input type="number" id="global-rate-4" class="property-input" step="0.1" style="width: 80px;">
                </div>
                <label class="view-option">
                    <input type="checkbox" id="check-boundary-vis"> Show Boundaries
                </label>

            </div>

            <div class="tool-group">
              <h3 class="tool-group-title">Plates</h3>
              <div id="plate-list" class="plate-list"></div>
            </div>
          </aside>
          
          <main class="canvas-container">
            <canvas id="main-canvas"></canvas>
            <div class="canvas-hint" id="canvas-hint"></div>
          </main>
          
          <div class="right-sidebar">
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
        
        <footer class="timeline-bar">
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
              <span id="current-time">0</span> Ma
            </div>
          </div>
          <button id="btn-reset-time" class="btn btn-secondary">Reset</button>
        </footer>
      </div>
    `;
    }

    private setupEventListeners(): void {
        // Tools
        document.querySelectorAll('.tool-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const tool = btn.getAttribute('data-tool') as ToolType;
                this.setActiveTool(tool);
            });
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

        document.getElementById('check-euler')?.addEventListener('change', (e) => {
            this.state.world.showEulerPoles = (e.target as HTMLInputElement).checked;
            this.canvasManager?.render();
        });

        document.getElementById('check-features')?.addEventListener('change', (e) => {
            this.state.world.showFeatures = (e.target as HTMLInputElement).checked;
            this.canvasManager?.render();
        });

        document.getElementById('check-future-features')?.addEventListener('change', (e) => {
            this.state.world.showFutureFeatures = (e.target as HTMLInputElement).checked;
            this.canvasManager?.render();
        });

        // Global Options
        document.getElementById('check-speed-limit')?.addEventListener('change', (e) => {
            this.state.world.globalOptions.speedLimitEnabled = (e.target as HTMLInputElement).checked;
        });

        // Advanced Toggles
        // Rate Preset Inputs
        const updateRatePreset = (index: number, val: number) => {
            if (!isNaN(val) && val > 0) {
                const newPresets = [...(this.state.world.globalOptions.ratePresets || [0.5, 1.0, 2.0, 5.0])];
                newPresets[index] = val;
                this.state.world.globalOptions.ratePresets = newPresets;
                this.updateUI(); // Refresh properties panel to show new values
            }
        };

        document.getElementById('global-rate-1')?.addEventListener('change', (e) => updateRatePreset(0, parseFloat((e.target as HTMLInputElement).value)));
        document.getElementById('global-rate-2')?.addEventListener('change', (e) => updateRatePreset(1, parseFloat((e.target as HTMLInputElement).value)));
        document.getElementById('global-rate-3')?.addEventListener('change', (e) => updateRatePreset(2, parseFloat((e.target as HTMLInputElement).value)));
        document.getElementById('global-rate-4')?.addEventListener('change', (e) => updateRatePreset(3, parseFloat((e.target as HTMLInputElement).value)));
        document.getElementById('check-boundary-vis')?.addEventListener('change', (e) => {
            this.state.world.globalOptions.enableBoundaryVisualization = (e.target as HTMLInputElement).checked;
        });

        document.getElementById('global-max-speed')?.addEventListener('change', (e) => {
            const val = parseFloat((e.target as HTMLInputElement).value);
            if (!isNaN(val) && val > 0) {
                this.state.world.globalOptions.maxDragSpeed = val;
            }
        });

        document.getElementById('global-max-time')?.addEventListener('change', (e) => {
            const val = parseInt((e.target as HTMLInputElement).value);
            if (!isNaN(val) && val > 0) {
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

            switch (e.key.toLowerCase()) {
                case 'v': this.setActiveTool('select'); break;
                case 'h': this.setActiveTool('pan'); break; // Now Rotate/Pan
                case 'd': this.setActiveTool('draw'); break;
                case 'f': this.setActiveTool('feature'); break;
                case 's': this.setActiveTool('split'); break;
                case 'g': this.setActiveTool('fuse'); break;
                case 'l': this.setActiveTool('link'); break;
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
            const time = parseFloat((e.target as HTMLInputElement).value);
            this.simulation?.setTime(time);
            this.updateTimeDisplay();
        });

        document.getElementById('btn-reset-time')?.addEventListener('click', () => {
            this.simulation?.setTime(0);
            this.updateTimeDisplay();
        });

        document.getElementById('btn-export')?.addEventListener('click', async () => {
            const options = await showPNGExportDialog(this.state.world.projection);
            if (options) {
                exportToPNG(this.state, options);
            }
        });

        document.getElementById('btn-export-heightmap')?.addEventListener('click', async () => {
            // Heightmap Export
            try {
                const options = await showHeightmapExportDialog();
                if (!options) return;

                const dataUrl = await HeightmapGenerator.generate(this.state, {
                    width: options.width,
                    height: options.height,
                    projection: 'equirectangular',
                    smooth: true
                });

                const link = document.createElement('a');
                link.download = `tectolite-heightmap-${Date.now()}.png`;
                link.href = dataUrl;
                link.click();
            } catch (e) {
                console.error('Heightmap generation failed', e);
                alert('Heightmap generation failed');
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
                    const { world: importedWorld, name: filename } = await parseImportFile(file);
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
                            name: `${plate.name} (imported)`,
                            birthTime: plate.birthTime + timeOffset, // Shift birth time
                            deathTime: plate.deathTime !== null ? plate.deathTime + timeOffset : null, // Shift death time if present
                            polygons: newPolygons,
                            features: newFeatures,
                            initialPolygons: newInitialPolygons,
                            initialFeatures: newInitialFeatures,
                            motionKeyframes: newKeyframes
                        };
                    });

                    // Merge with existing plates
                    this.state = {
                        ...this.state,
                        world: {
                            ...this.state.world,
                            plates: [...this.state.world.plates, ...processedPlates]
                        }
                    };

                    this.updateUI();
                    this.canvasManager?.render();

                    const modeDesc = importMode === 'at_beginning' ? 'at time 0' : `at time ${currentTime.toFixed(1)} Ma`;
                    alert(`Successfully imported ${processedPlates.length} plate(s) ${modeDesc}!`);
                } catch (err) {
                    alert('Failed to load file: ' + (err as Error).message);
                }
                (e.target as HTMLInputElement).value = ''; // Reset file input
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

        if (newTheme === 'light') {
            document.body.setAttribute('data-theme', 'light');
        } else {
            document.body.removeAttribute('data-theme');
        }

        const btn = document.getElementById('btn-theme-toggle');
        if (btn) {
            const icon = btn.querySelector('.icon');
            if (icon) icon.textContent = newTheme === 'light' ? '☀️' : '🌙';
        }

        // Force re-render of canvas to pick up new colors
        this.canvasManager?.render();
    }

    private showLegendDialog(): void {
        const overlay = document.createElement('div');
        overlay.style.cssText = `
          position: fixed; top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(0,0,0,0.7); z-index: 10000;
          display: flex; align-items: center; justify-content: center;
      `;

        const dialog = document.createElement('div');
        dialog.style.cssText = `
          background: #1e1e2e; border-radius: 12px; padding: 24px;
          min-width: 400px; color: #cdd6f4; font-family: system-ui, sans-serif;
          box-shadow: 0 8px 32px rgba(0,0,0,0.4);
      `;

        dialog.innerHTML = `
          <h3 style="margin: 0 0 16px 0; color: #89b4fa;">🗺️ Map Legend</h3>
          
          <div style="margin-bottom: 20px;">
              <h4 style="margin: 0 0 8px 0; color: #fab387;">Boundaries</h4>
              <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                  <span style="width: 20px; height: 3px; background: #ff3333; display: inline-block;"></span>
                  <span><strong>Convergent</strong> (Collision)</span>
              </div>
              <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                  <span style="width: 20px; height: 3px; background: #3333ff; display: inline-block;"></span>
                  <span><strong>Divergent</strong> (Rifting)</span>
              </div>
              <div style="display: flex; align-items: center; gap: 8px;">
                  <span style="width: 20px; height: 3px; background: #33ff33; display: inline-block;"></span>
                  <span><strong>Transform</strong> (Sliding)</span>
              </div>
              <p style="font-size: 12px; color: #a6adc8; margin-top: 4px;">
                  *Boundaries only appear when plates overlap/touch AND have velocity.
              </p>
          </div>

          <div style="margin-bottom: 20px;">
              <h4 style="margin: 0 0 8px 0; color: #a6e3a1;">Features</h4>
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                  <div>🏔️ Mountain (Cont-Cont)</div>
                  <div>🌋 Volcano (Subduction)</div>
                  <div>⚡ Rift (Div-Cont)</div>
                  <div>🏝️ Island (Hotspot/Ocean)</div>
              </div>
          </div>

          <div style="display: flex; justify-content: flex-end;">
              <button id="legend-close" style="padding: 8px 16px; border: 1px solid #45475a; border-radius: 6px; background: #313244; color: #cdd6f4; cursor: pointer;">Close</button>
          </div>
      `;

        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        const cleanup = () => document.body.removeChild(overlay);
        dialog.querySelector('#legend-close')?.addEventListener('click', cleanup);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(); });
    }

    private updateUI(): void {
        this.updateToolbarState();
        this.updatePlateList();
        this.updatePropertiesPanel();
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



        const fuseControls = document.getElementById('fuse-controls');
        if (fuseControls) {
            fuseControls.style.display = tool === 'fuse' ? 'block' : 'none';
        }
    }

    private setActiveFeature(feature: FeatureType): void {
        this.state.activeFeatureType = feature;
        document.querySelectorAll('.feature-btn').forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('data-feature') === feature);
        });
    }

    private updateToolbarState(): void {
        document.querySelectorAll('.tool-btn').forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('data-tool') === this.state.activeTool);
        });
    }

    private handleDrawComplete(points: Coordinate[]): void {
        if (points.length < 3) return;
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

    private handleFeaturePlace(position: Coordinate, type: FeatureType): void {
        // Find plate that contains this position or use selected plate
        const plateId = this.state.world.selectedPlateId ??
            (this.state.world.plates.length > 0 ? this.state.world.plates[0].id : null);

        if (!plateId) return;
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

    private handleSelect(plateId: string | null, featureId: string | null, featureIds: string[] = []): void {
        // Legacy fusion logic removed


        // Reset fusion state if switching away from fuse tool
        // Reset fusion/link state if switching away
        if (this.state.activeTool !== 'fuse') this.fusionFirstPlateId = null;
        if (this.state.activeTool !== 'link') this.activeLinkSourceId = null;

        if (this.state.activeTool === 'fuse') {
            if (plateId) this.handleFuseTool(plateId);
            return;
        }

        if (this.state.activeTool === 'link') {
            if (plateId) this.handleLinkTool(plateId);
            return;
        }

        const hint = document.getElementById('canvas-hint');
        if (hint && this.state.activeTool !== 'select') hint.textContent = '';

        this.state.world.selectedPlateId = plateId;
        this.state.world.selectedFeatureId = featureId ?? null;

        // Handle multi-selection
        if (featureIds.length > 0) {
            this.state.world.selectedFeatureIds = featureIds;
        } else if (featureId) {
            this.state.world.selectedFeatureIds = [featureId];
        } else {
            this.state.world.selectedFeatureIds = [];
        }

        this.updateUI();
        this.canvasManager?.render();
    }



    private handleFuseTool(plateId: string): void {
        if (!this.fusionFirstPlateId) {
            this.fusionFirstPlateId = plateId;
            const hint = document.getElementById('canvas-hint');
            if (hint) hint.textContent = `Click another plate to fuse with "${this.state.world.plates.find(p => p.id === plateId)?.name || 'Plate'}"`;
        } else if (this.fusionFirstPlateId !== plateId) {
            // Second click - fuse plates
            this.pushState(); // Save state for undo
            // Read options
            const addWeakness = (document.getElementById('check-add-weakness') as HTMLInputElement)?.checked ?? true;
            const addMountains = (document.getElementById('check-add-mountains') as HTMLInputElement)?.checked ?? false;

            const result = fusePlates(this.state, this.fusionFirstPlateId, plateId, {
                addWeaknessFeatures: addWeakness,
                addMountains: addMountains
            });

            if (result.success && result.newState) {
                this.state = result.newState;
                this.updateUI();
                this.canvasManager?.render();
                // Clear hint and reset
                const hint = document.getElementById('canvas-hint');
                if (hint) hint.textContent = '';
            } else {
                alert(result.error || 'Failed to fuse plates');
            }

            // Reset fusion state
            this.fusionFirstPlateId = null;
            this.setActiveTool('select');
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

            const hint = document.getElementById('canvas-hint');
            if (hint) {
                hint.textContent = `Selected ${plate.name}. Now click another plate to link.`;
                hint.style.display = 'block';
            }

            this.updateUI();
            this.canvasManager?.render();
            return;
        }

        // Step 2: Select second plate
        if (this.activeLinkSourceId === plateId) {
            // Deselect if clicking same plate
            this.activeLinkSourceId = null;
            this.state.world.selectedPlateId = null;
            const hint = document.getElementById('canvas-hint');
            if (hint) {
                hint.textContent = '';
                hint.style.display = 'none';
            }
            this.updateUI();
            this.canvasManager?.render();
            return;
        }

        // Apply Link
        const sourceId = this.activeLinkSourceId;
        const targetId = plateId;
        const sourcePlate = this.state.world.plates.find(p => p.id === sourceId);

        if (sourcePlate && sourcePlate.linkedPlateIds?.includes(targetId)) {
            // Already linked - Ask to unlink
            if (confirm(`Unlink ${sourcePlate.name} and ${plate.name}?`)) {
                this.pushState();
                this.state.world.plates = this.state.world.plates.map(p => {
                    // Remove link ID from both plates
                    if (p.id === sourceId) {
                        return { ...p, linkedPlateIds: (p.linkedPlateIds || []).filter(id => id !== targetId) };
                    }
                    if (p.id === targetId) {
                        return { ...p, linkedPlateIds: (p.linkedPlateIds || []).filter(id => id !== sourceId) };
                    }
                    return p;
                });
                const hint = document.getElementById('canvas-hint');
                if (hint) {
                    hint.textContent = `Unlinked ${sourcePlate.name} and ${plate.name}`;
                    setTimeout(() => { if (hint) hint.style.display = 'none'; }, 2000);
                }
            }
        } else {
            // Create Link
            this.pushState();
            this.state.world.plates = this.state.world.plates.map(p => {
                if (p.id === sourceId) {
                    return { ...p, linkedPlateIds: [...(p.linkedPlateIds || []), targetId] };
                }
                if (p.id === targetId) {
                    return { ...p, linkedPlateIds: [...(p.linkedPlateIds || []), sourceId] };
                }
                return p;
            });
            const hint = document.getElementById('canvas-hint');
            if (hint) {
                hint.textContent = `Linked ${sourcePlate?.name} and ${plate.name}`;
                setTimeout(() => { if (hint) hint.style.display = 'none'; }, 2000);
            }
        }

        // Reset
        this.activeLinkSourceId = null;
        this.state.world.selectedPlateId = plateId; // Select the target
        this.updateUI();
        this.canvasManager?.render();
    }

    private handleSplitApply(points: Coordinate[]): void {
        if (points.length < 2) return;

        let plateToSplit = this.state.world.plates.find(p => p.id === this.state.world.selectedPlateId);

        // Pass the full polyline for zig-zag splits
        if (plateToSplit) {
            if (confirm('Inherit momentum from parent plate?')) {
                this.pushState(); // Save state for undo
                this.state = splitPlate(this.state, plateToSplit.id, { points }, true);
            } else {
                this.pushState(); // Save state for undo
                this.state = splitPlate(this.state, plateToSplit.id, { points }, false);
            }
            this.updateUI();
            this.simulation?.setTime(this.state.world.currentTime);
            this.canvasManager?.render();
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

        if (selectedFeatureId || (selectedFeatureIds && selectedFeatureIds.length > 0)) {
            // Build set of all feature IDs to delete
            const idsToDelete = new Set<string>();
            if (selectedFeatureId) idsToDelete.add(selectedFeatureId);
            if (selectedFeatureIds) selectedFeatureIds.forEach(id => idsToDelete.add(id));

            // Remove these features from all plates
            this.state.world.plates = this.state.world.plates.map(p => ({
                ...p,
                features: p.features.filter(f => !idsToDelete.has(f.id))
            }));

            this.state.world.selectedFeatureId = null;
            this.state.world.selectedFeatureIds = [];
        } else if (selectedPlateId) {
            this.state.world.plates = this.state.world.plates.filter(p => p.id !== selectedPlateId);
            this.state.world.selectedPlateId = null;
        }
        this.updateUI();
        this.simulation?.setTime(this.state.world.currentTime);
        this.canvasManager?.render();
    }

    private updatePlateList(): void {
        const list = document.getElementById('plate-list');
        if (!list) return;

        if (this.state.world.plates.length === 0) {
            list.innerHTML = '<p class="empty-message">Draw a landmass to create a plate</p>';
            return;
        }

        list.innerHTML = this.state.world.plates.map(plate => `
      <div class="plate-item ${plate.id === this.state.world.selectedPlateId ? 'selected' : ''}" 
           data-plate-id="${plate.id}">
        <span class="plate-color" style="background: ${plate.color}"></span>
        <span class="plate-name">${plate.name}</span>
        <button class="plate-visibility" data-visible="${plate.visible}">
          ${plate.visible ? '👁️' : '🚫'}
        </button>
      </div>
    `).join('');

        list.querySelectorAll('.plate-item').forEach(item => {
            item.addEventListener('click', (e) => {
                if ((e.target as HTMLElement).classList.contains('plate-visibility')) return;
                const plateId = item.getAttribute('data-plate-id');
                this.handleSelect(plateId, null);
            });
        });

        // Visibility toggle
        list.querySelectorAll('.plate-visibility').forEach(btn => {
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
        this.updatePlateList();
        this.canvasManager?.render();
    }

    private updatePropertiesPanel(): void {
        const content = document.getElementById('properties-content');
        if (!content) return;

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
        <label class="property-label">Layer (Z-Index)</label>
        <input type="number" id="prop-z-index" class="property-input" value="${plate.zIndex || 0}" step="1" style="width: 60px;">
      </div>

      <div class="property-group">
        <label class="property-label">Timeline (Ma)</label>
        <div style="display: flex; gap: 4px;">
             <input type="number" id="prop-birth-time" class="property-input" title="Start Time" value="${plate.birthTime}" step="5" style="flex:1">
             <span style="align-self: center;">-</span>
             <input type="number" id="prop-death-time" class="property-input" title="End Time" value="${plate.deathTime ?? ''}" placeholder="Active" step="5" style="flex:1">
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
        <label class="property-label">Rate (deg/Ma)</label>
        <input type="number" id="prop-pole-rate" class="property-input" value="${pole.rate}" step="0.1" style="width: 70px;">
        <select id="rate-presets" class="tool-select" style="margin-left: 8px; width: auto;">
          <option value="">Presets...</option>
          ${(this.state.world.globalOptions.ratePresets || [0.5, 1.0, 2.0, 5.0]).map(r => `
             <option value="${r}">${r.toFixed(1)}</option>
          `).join('')}
        </select>
      </div>
      <div class="property-group">
        <label class="property-label">
           <input type="checkbox" id="prop-pole-vis" ${pole.visible ? 'checked' : ''}> Show Pole
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
            this.updatePlateList();
        });

        document.getElementById('prop-description')?.addEventListener('change', (e) => {
            plate.description = (e.target as HTMLTextAreaElement).value;
        });

        document.getElementById('prop-inherit')?.addEventListener('change', (e) => {
            plate.inheritDescription = (e.target as HTMLInputElement).checked;
        });

        document.getElementById('prop-color')?.addEventListener('change', (e) => {
            plate.color = (e.target as HTMLInputElement).value;
            this.updatePlateList();
            this.canvasManager?.render();
        });

        document.getElementById('prop-z-index')?.addEventListener('change', (e) => {
            const val = parseInt((e.target as HTMLInputElement).value);
            if (!isNaN(val)) {
                plate.zIndex = val;
                this.canvasManager?.render();
            }
        });

        document.getElementById('prop-birth-time')?.addEventListener('change', (e) => {
            plate.birthTime = parseFloat((e.target as HTMLInputElement).value);
            this.canvasManager?.render();
        });

        document.getElementById('prop-death-time')?.addEventListener('change', (e) => {
            const val = (e.target as HTMLInputElement).value;
            plate.deathTime = val ? parseFloat(val) : null;
            this.canvasManager?.render();
        });

        document.getElementById('prop-pole-lon')?.addEventListener('change', (e) => {
            const newLon = parseFloat((e.target as HTMLInputElement).value);
            this.addMotionKeyframe(plate.id, { ...pole, position: [newLon, pole.position[1]] });
        });
        document.getElementById('prop-pole-lat')?.addEventListener('change', (e) => {
            const newLat = parseFloat((e.target as HTMLInputElement).value);
            this.addMotionKeyframe(plate.id, { ...pole, position: [pole.position[0], newLat] });
        });
        document.getElementById('prop-pole-rate')?.addEventListener('change', (e) => {
            const newRate = parseFloat((e.target as HTMLInputElement).value);
            this.addMotionKeyframe(plate.id, { ...pole, rate: newRate });
        });
        document.getElementById('prop-pole-vis')?.addEventListener('change', (e) => {
            pole.visible = (e.target as HTMLInputElement).checked;
            this.canvasManager?.render();
        });

        document.getElementById('rate-presets')?.addEventListener('change', (e) => {
            const val = (e.target as HTMLSelectElement).value;
            if (val) {
                const newRate = parseFloat(val);
                (document.getElementById('prop-pole-rate') as HTMLInputElement).value = val;
                this.addMotionKeyframe(plate.id, { ...pole, rate: newRate });
                (e.target as HTMLSelectElement).value = ''; // Reset dropdown
            }
        });

        document.getElementById('btn-copy-momentum')?.addEventListener('click', () => {
            this.momentumClipboard = {
                eulerPole: {
                    position: [...plate.motion.eulerPole.position],
                    rate: plate.motion.eulerPole.rate
                }
            };
            const pasteBtn = document.getElementById('btn-paste-momentum') as HTMLButtonElement;
            if (pasteBtn) pasteBtn.disabled = false;
            alert('Momentum copied to clipboard');
        });

        document.getElementById('btn-paste-momentum')?.addEventListener('click', () => {
            if (!this.momentumClipboard) return;

            // Apply clipboard to current plate
            const newPole = this.momentumClipboard.eulerPole;
            this.addMotionKeyframe(plate.id, {
                position: newPole.position,
                rate: newPole.rate
            });

            this.updatePropertiesPanel(); // Refresh UI to show new values
            alert('Momentum pasted');
        });

        document.getElementById('btn-delete-plate')?.addEventListener('click', () => {
            this.deleteSelected();
        });

        // Bind feature property events
        this.bindFeatureEvents(plate);

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
            if (selectedFeatureIds.length > 1) {
                return `
          <hr class="property-divider">
          <h4 class="property-section-title">Features</h4>
          <p class="empty-message">${selectedFeatureIds.length} features selected</p>
        `;
            }
            return '';
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
        <input type="number" id="feature-created-at" class="property-input" value="${createdAt.toFixed(1)}" step="0.1" style="width: 80px;">
        <span class="property-hint" style="margin-left: 8px; color: #888;">Age: ${age} Ma</span>
      </div>
      <div class="property-group">
        <label class="property-label">Ends At(Ma)</label>
        <input type="number" id="feature-death-time" class="property-input" value="${feature.deathTime?.toFixed(1) ?? ''}" step="0.1" style="width: 80px;" placeholder="Never">
      </div>
      <div class="property-group">
        <label class="property-label">Name</label>
        <input type="text" id="feature-name" class="property-input" value="${displayName}" placeholder="Feature name...">
      </div>
      <div class="property-group">
        <label class="property-label">Description</label>
        <textarea id="feature-description" class="property-input" rows="2" placeholder="Description...">${description}</textarea>
      </div>
    `;
    }

    private bindFeatureEvents(plate: TectonicPlate): void {
        const { selectedFeatureId, selectedFeatureIds } = this.state.world;
        const singleFeatureId = selectedFeatureIds.length === 1
            ? selectedFeatureIds[0]
            : (selectedFeatureIds.length === 0 ? selectedFeatureId : null);

        if (!singleFeatureId) return;

        const feature = plate.features.find(f => f.id === singleFeatureId);
        if (!feature) return;

        document.getElementById('feature-name')?.addEventListener('change', (e) => {
            feature.name = (e.target as HTMLInputElement).value;
        });

        document.getElementById('feature-description')?.addEventListener('change', (e) => {
            feature.description = (e.target as HTMLTextAreaElement).value;
        });

        document.getElementById('feature-created-at')?.addEventListener('change', (e) => {
            const val = parseFloat((e.target as HTMLInputElement).value);
            if (!isNaN(val)) {
                feature.generatedAt = val;
                this.updatePropertiesPanel(); // Refresh to show updated age
            }
        });

        document.getElementById('feature-death-time')?.addEventListener('change', (e) => {
            const val = (e.target as HTMLInputElement).value;
            if (val === '' || val === null) {
                feature.deathTime = undefined; // Clear death time
            } else {
                const num = parseFloat(val);
                if (!isNaN(num)) {
                    feature.deathTime = num;
                }
            }
            this.canvasManager?.render(); // Refresh to show/hide if outside timeline
        });
    }

    private getFeatureTypeName(type: FeatureType): string {
        const names: Record<FeatureType, string> = {
            mountain: 'Mountain',
            volcano: 'Volcano',
            hotspot: 'Hotspot',
            rift: 'Rift',
            trench: 'Trench',
            island: 'Island',
            weakness: 'Weakness'
        };
        return names[type] || type;
    }

    private updatePlayButton(): void {
        const btn = document.getElementById('btn-play');
        if (btn) btn.textContent = this.state.world.isPlaying ? '⏸️' : '▶️';
    }

    private updateTimeDisplay(): void {
        const display = document.getElementById('current-time');
        const slider = document.getElementById('time-slider') as HTMLInputElement;
        if (display) display.textContent = this.state.world.currentTime.toFixed(1);
        if (slider) slider.value = String(this.state.world.currentTime);
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
                    snapshotFeatures: p.features
                };

                const otherKeyframes = (p.motionKeyframes || []).filter(k => Math.abs(k.time - currentTime) > 0.001);
                updated.motionKeyframes = [...otherKeyframes, newKeyframe].sort((a, b) => a.time - b.time);

                return updated;
            }
            return p;
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
        const current = this.state.world.currentTime;
        const promptText = `Target Time(Ma) ? (Current: ${current})`;
        const input = window.prompt(promptText);
        if (!input) return;

        const targetTime = parseFloat(input);
        if (isNaN(targetTime)) return;

        const dt = targetTime - current;
        if (Math.abs(dt) < 0.001) {
            alert("Time difference too small!");
            return;
        }

        const angleDeg = angleRad * 180 / Math.PI;
        const rate = angleDeg / dt;

        const pole = vectorToLatLon(axis);
        this.handleMotionChange(plateId, pole, rate);
    }

    private handleMotionChange(plateId: string, pole: Coordinate, rate: number): void {
        this.pushState();
        const newEulerPole = { position: pole, rate, visible: true };

        // Find linked plates
        const plate = this.state.world.plates.find(p => p.id === plateId);
        const linkedIds = plate?.linkedPlateIds || [];
        const allIds = [plateId, ...linkedIds];
        // Deduplicate
        const uniqueIds = Array.from(new Set(allIds));

        uniqueIds.forEach(id => this.addMotionKeyframe(id, newEulerPole));
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
    public replacePlate(plate: TectonicPlate): void {
        const index = this.state.world.plates.findIndex(p => p.id === plate.id);
        if (index !== -1) {
            const newPlates = [...this.state.world.plates];
            newPlates[index] = plate;

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
        this.state = {
            ...this.state,
            world: {
                ...this.state.world,
                plates: this.state.world.plates.filter(p => !idSet.has(p.id))
            }
        };
        this.updateUI();
        this.canvasManager?.render();
    }
}

new TectoLiteApp();
