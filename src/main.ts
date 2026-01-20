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
import { exportToPNG } from './export';
import { splitPlate } from './SplitTool';
import { fusePlates } from './FusionTool';
import { vectorToLatLon, Vector3 } from './utils/sphericalMath';
import { HistoryManager } from './HistoryManager';
import { exportToJSON, importFromJSON } from './export';

class TectoLiteApp {
  private state: AppState;
  private canvasManager: CanvasManager | null = null;
  private simulation: SimulationEngine | null = null;
  private historyManager: HistoryManager = new HistoryManager();
  private fusionFirstPlateId: string | null = null; // Track first plate for fusion

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
      (plateId, featureId) => this.handleSelect(plateId, featureId),
      (points) => this.handleSplitApply(points),
      (active) => this.handleSplitPreviewChange(active),
      (plateId, pole, rate) => this.handleMotionChange(plateId, pole, rate),
      (plateId, axis, angleRad) => this.handleDragTargetRequest(plateId, axis, angleRad),
      (points, fillColor) => this.handlePolyFeatureComplete(points, fillColor)
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

    this.setupEventListeners();
    this.canvasManager.startRenderLoop();
    this.updateUI();
  }

  private getHTML(): string {
    return `
      <div class="app-container">
        <header class="app-header">
          <h1 class="app-title">TectoLite</h1>
          <div class="header-actions">
            <!-- Projection Selector -->
            <select id="projection-select" class="projection-select">
                <option value="orthographic">Globe (Orthographic)</option>
                <option value="equirectangular">Equirectangular</option>
                <option value="mercator">Mercator</option>
                <option value="mollweide">Mollweide</option>
                <option value="robinson">Robinson</option>
            </select>
            
            <button id="btn-undo" class="btn btn-secondary" title="Undo (Ctrl+Z)">
              <span class="icon">↶</span> Undo
            </button>
            <button id="btn-redo" class="btn btn-secondary" title="Redo (Ctrl+Y)">
              <span class="icon">↷</span> Redo
            </button>
            <button id="btn-export" class="btn btn-primary">
              <span class="icon">📥</span> Export PNG
            </button>
            <button id="btn-export-json" class="btn btn-secondary" title="Export JSON">
              <span class="icon">💾</span> Save
            </button>
            <button id="btn-import-json" class="btn btn-secondary" title="Import JSON">
              <span class="icon">📂</span> Load
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
              <button class="tool-btn" data-tool="poly_feature" title="Poly Feature (P)">
                <span class="tool-icon">🎨</span>
                <span class="tool-label">Poly</span>
              </button>
              <button class="tool-btn" data-tool="fuse" title="Fuse Plates (G)">
                <span class="tool-icon">🔗</span>
                <span class="tool-label">Fuse</span>
              </button>
            </div>
            
            <div class="tool-group" id="split-controls" style="display: none;">
              <h3 class="tool-group-title">Split Preview</h3>
              <button class="btn btn-success" id="btn-split-apply">✓ Apply</button>
              <button class="btn btn-secondary" id="btn-split-cancel">✗ Cancel</button>
            </div>

            <div class="tool-group" id="fuse-controls" style="display: none;">
              <h3 class="tool-group-title">Fuse Options</h3>
              <label class="view-option">
                <input type="checkbox" id="check-add-weakness" checked> Add Weakness Features
              </label>
            </div>

            <div class="tool-group" id="poly-color-picker" style="display: none;">
              <h3 class="tool-group-title">Poly Color</h3>
              <input type="color" id="poly-feature-color" value="#ff6b6b" class="property-color">
              <span class="color-label">Fill Color</span>
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
                <label class="view-option">
                    <input type="checkbox" id="check-euler"> Euler Poles
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
          
          <aside class="properties-panel" id="properties-panel">
            <h3 class="panel-title">Properties</h3>
            <div id="properties-content">
              <p class="empty-message">Select a plate to edit properties</p>
            </div>
          </aside>
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

    document.getElementById('check-euler')?.addEventListener('change', (e) => {
      this.state.world.showEulerPoles = (e.target as HTMLInputElement).checked;
      this.canvasManager?.render();
    });

    // Global Options
    document.getElementById('check-speed-limit')?.addEventListener('change', (e) => {
      this.state.world.globalOptions.speedLimitEnabled = (e.target as HTMLInputElement).checked;
    });

    document.getElementById('global-max-speed')?.addEventListener('change', (e) => {
      const val = parseFloat((e.target as HTMLInputElement).value);
      if (!isNaN(val) && val > 0) {
        this.state.world.globalOptions.maxDragSpeed = val;
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
        case 'p': this.setActiveTool('poly_feature'); break;
        case 'g': this.setActiveTool('fuse'); break;
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

    document.getElementById('btn-export')?.addEventListener('click', () => {
      exportToPNG(this.state);
    });

    // Split control buttons
    document.getElementById('btn-split-apply')?.addEventListener('click', () => {
      this.canvasManager?.applySplit();
    });

    document.getElementById('btn-split-cancel')?.addEventListener('click', () => {
      this.canvasManager?.cancelSplit();
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
          const worldState = await importFromJSON(file);
          this.pushState(); // Save current state before replacing
          this.state = {
            ...this.state,
            world: worldState
          };
          this.updateUI();
          this.canvasManager?.render();
        } catch (err) {
          alert('Failed to load file: ' + (err as Error).message);
        }
        (e.target as HTMLInputElement).value = ''; // Reset file input
      }
    });
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

    const polyColorPicker = document.getElementById('poly-color-picker');
    if (polyColorPicker) {
      polyColorPicker.style.display = tool === 'poly_feature' ? 'block' : 'none';
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
      polygons: [polygon],
      features: [],
      motion: defaultMotion,
      motionKeyframes: [initialKeyframe],
      color: getNextPlateColor(this.state.world.plates),
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
      properties: {}
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

    this.canvasManager?.render();
  }

  private handleSelect(plateId: string | null, featureId: string | null): void {
    // Handle fusion tool workflow
    if (this.state.activeTool === 'fuse' && plateId) {
      if (this.fusionFirstPlateId === null) {
        // First click - store first plate
        this.fusionFirstPlateId = plateId;
        this.state.world.selectedPlateId = plateId;
        this.updateUI();
        // Show hint in canvas
        const hint = document.getElementById('canvas-hint');
        if (hint) hint.textContent = `Click another plate to fuse with "${this.state.world.plates.find(p => p.id === plateId)?.name || 'Plate'}"`;
      } else if (this.fusionFirstPlateId !== plateId) {
        // Second click - fuse plates
        this.pushState(); // Save state for undo
        // Read weakness toggle option
        const addWeakness = (document.getElementById('check-add-weakness') as HTMLInputElement)?.checked ?? true;
        const result = fusePlates(this.state, this.fusionFirstPlateId, plateId, { addWeaknessFeatures: addWeakness });

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
      return;
    }

    // Reset fusion state if switching away from fuse tool
    if (this.state.activeTool !== 'fuse') {
      this.fusionFirstPlateId = null;
      const hint = document.getElementById('canvas-hint');
      if (hint) hint.textContent = '';
    }

    this.state.world.selectedPlateId = plateId;
    this.state.world.selectedFeatureId = featureId ?? null;
    this.updateUI();
  }

  private handlePolyFeatureComplete(points: Coordinate[], fillColor: string): void {
    // Find plate to add the poly feature to (selected plate or first plate)
    const plateId = this.state.world.selectedPlateId ??
      (this.state.world.plates.length > 0 ? this.state.world.plates[0].id : null);

    if (!plateId || points.length < 3) return;
    this.pushState(); // Save state for undo

    // Calculate centroid as the position
    const centroid: Coordinate = [
      points.reduce((sum, p) => sum + p[0], 0) / points.length,
      points.reduce((sum, p) => sum + p[1], 0) / points.length
    ];

    const feature: Feature = {
      id: generateId(),
      type: 'poly_region',
      position: centroid,
      rotation: 0,
      scale: 1,
      properties: {},
      polygon: points,
      fillColor: fillColor
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

    this.updateUI();
    this.canvasManager?.render();
    this.setActiveTool('select'); // Return to select tool after placing
  }

  private handleSplitApply(points: Coordinate[]): void {
    if (points.length < 2) return;

    let plateToSplit = this.state.world.plates.find(p => p.id === this.state.world.selectedPlateId);

    // Pass the full polyline for zig-zag splits
    if (plateToSplit) {
      this.pushState(); // Save state for undo
      this.state = splitPlate(this.state, plateToSplit.id, { points });
      this.updateUI();
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
    if (this.state.world.selectedFeatureId) {
      this.state.world.plates.forEach(p => {
        p.features = p.features.filter(f => f.id !== this.state.world.selectedFeatureId);
      });
      this.state.world.selectedFeatureId = null;
    } else if (this.state.world.selectedPlateId) {
      this.state.world.plates = this.state.world.plates.filter(p => p.id !== this.state.world.selectedPlateId);
      this.state.world.selectedPlateId = null;
    }
    this.updateUI();
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

    content.innerHTML = `
      <div class="property-group">
        <label class="property-label">Name</label>
        <input type="text" id="prop-name" class="property-input" value="${plate.name}">
      </div>
      <div class="property-group">
        <label class="property-label">Color</label>
        <input type="color" id="prop-color" class="property-color" value="${plate.color}">
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
          <option value="0.5">Slow (0.5)</option>
          <option value="1.0">Normal (1.0)</option>
          <option value="2.0">Fast (2.0)</option>
          <option value="5.0">Very Fast (5.0)</option>
        </select>
      </div>
       <div class="property-group">
        <label class="property-label">
           <input type="checkbox" id="prop-pole-vis" ${pole.visible ? 'checked' : ''}> Show Pole
        </label>
      </div>
      
      <button id="btn-delete-plate" class="btn btn-danger">Delete Plate</button>
    `;

    // Bind events
    document.getElementById('prop-name')?.addEventListener('change', (e) => {
      plate.name = (e.target as HTMLInputElement).value;
      this.updatePlateList();
    });
    document.getElementById('prop-color')?.addEventListener('change', (e) => {
      plate.color = (e.target as HTMLInputElement).value;
      this.updatePlateList();
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

    document.getElementById('btn-delete-plate')?.addEventListener('click', () => {
      this.deleteSelected();
    });
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
    this.canvasManager?.render();
  }

  private handleDragTargetRequest(plateId: string, axis: Vector3, angleRad: number): void {
    const current = this.state.world.currentTime;
    const promptText = `Target Time (Ma)? (Current: ${current})`;
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

    this.addMotionKeyframe(plateId, { position: pole, rate, visible: true });
  }

  private handleMotionChange(plateId: string, pole: Coordinate, rate: number): void {
    const newEulerPole = { position: pole, rate, visible: true };
    this.addMotionKeyframe(plateId, newEulerPole);
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
}

new TectoLiteApp();
