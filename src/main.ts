// Main Application - TectoLite Plate Tectonics Simulator
import './style.css';
import {
  AppState,
  TectonicPlate,
  Feature,
  Polygon,
  ToolType,
  FeatureType,
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

class TectoLiteApp {
  private state: AppState;
  private canvasManager: CanvasManager | null = null;
  private simulation: SimulationEngine | null = null;

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
      (plateId, pole, rate) => this.handleMotionChange(plateId, pole, rate)
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
            
            <button id="btn-export" class="btn btn-primary">
              <span class="icon">📥</span> Export PNG
            </button>
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
            </div>
            
            <div class="tool-group" id="split-controls" style="display: none;">
              <h3 class="tool-group-title">Split Preview</h3>
              <button class="btn btn-success" id="btn-split-apply">✓ Apply</button>
              <button class="btn btn-secondary" id="btn-split-cancel">✗ Cancel</button>
            </div>
            
            <div class="tool-group" id="feature-selector">
              <h3 class="tool-group-title">Feature Type</h3>
              <button class="feature-btn active" data-feature="mountain" title="Mountain">🏔️ Mtn</button>
              <button class="feature-btn" data-feature="volcano" title="Volcano">🌋 Volc</button>
              <button class="feature-btn" data-feature="hotspot" title="Hotspot">🔥 Hot</button>
              <button class="feature-btn" data-feature="rift" title="Rift">⚡ Rift</button>
              <button class="feature-btn" data-feature="trench" title="Trench">🌊 Trn</button>
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

    // View Options
    document.getElementById('check-grid')?.addEventListener('change', (e) => {
      this.state.world.showGrid = (e.target as HTMLInputElement).checked;
      this.canvasManager?.render();
    });

    document.getElementById('check-euler')?.addEventListener('change', (e) => {
      this.state.world.showEulerPoles = (e.target as HTMLInputElement).checked;
      this.canvasManager?.render();
    });

    // Hotkeys
    document.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      switch (e.key.toLowerCase()) {
        case 'v': this.setActiveTool('select'); break;
        case 'h': this.setActiveTool('pan'); break; // Now Rotate/Pan
        case 'd': this.setActiveTool('draw'); break;
        case 'f': this.setActiveTool('feature'); break;
        case 's': this.setActiveTool('split'); break;
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
    this.state.world.selectedPlateId = plateId;
    this.state.world.selectedFeatureId = featureId ?? null;
    this.updateUI();
  }

  private handleSplitApply(points: Coordinate[]): void {
    if (points.length < 2) return;

    let plateToSplit = this.state.world.plates.find(p => p.id === this.state.world.selectedPlateId);

    // Pass the full polyline for zig-zag splits
    if (plateToSplit) {
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
        <input type="number" id="prop-pole-rate" class="property-input" value="${pole.rate}" step="0.1">
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

    // Capture current plate geometry as snapshot for this keyframe
    const newKeyframe: MotionKeyframe = {
      time: currentTime,
      eulerPole: { ...newEulerPole },
      snapshotPolygons: plate.polygons.map(p => ({ ...p, points: [...p.points] })),
      snapshotFeatures: plate.features.map(f => ({ ...f }))
    };

    // Update state immutably
    this.state = {
      ...this.state,
      world: {
        ...this.state.world,
        plates: this.state.world.plates.map(p =>
          p.id === plateId
            ? {
              ...p,
              // Add keyframe and keep sorted by time
              motionKeyframes: [...(p.motionKeyframes || []), newKeyframe]
                .sort((a, b) => a.time - b.time),
              // Also update legacy motion for UI display
              motion: { eulerPole: { ...newEulerPole } }
            }
            : p
        )
      }
    };

    this.canvasManager?.render();
    this.updatePropertiesPanel();
  }

  private handleMotionChange(plateId: string, pole: Coordinate, rate: number): void {
    const newEulerPole = { position: pole, rate, visible: true };
    this.addMotionKeyframe(plateId, newEulerPole);
  }
}

new TectoLiteApp();
