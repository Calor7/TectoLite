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
    MantlePlume
} from './types';
import { CanvasManager } from './canvas/CanvasManager';
import { SimulationEngine } from './SimulationEngine';
import { exportToPNG } from './export';
import { splitPlate } from './SplitTool';
import { fusePlates } from './FusionTool';
import { vectorToLatLon, latLonToVector, rotateVector, Vector3 } from './utils/sphericalMath';
import { toGeoJSON } from './utils/geoHelpers';
import { HistoryManager } from './HistoryManager';
import { exportToJSON, parseImportFile, showImportDialog, showUnifiedExportDialog } from './export';
import { HeightmapGenerator } from './systems/HeightmapGenerator';
import { GeoPackageExporter } from './GeoPackageExporter';
import { TimelineSystem } from './systems/TimelineSystem';
import { geoArea, geoCentroid } from 'd3-geo';
import {
    getSpeedPresetData as _getSpeedPresetData,
    generateRealWorldPresetList,
    generateCustomPresetList,
    convertCmYrToDegMa,
    convertDegMaToCmYr,
    updateSpeedInputsFromSelected as _updateSpeedInputs,
    applySpeedToSelected as _applySpeed,
    showPresetInfoDialog as _showPresetInfoDialog
} from './ui/SpeedPresets';
import {
    updatePlayButton as _updatePlayButton,
    showToast as _showToast,
    updateTimeDisplay as _updateTimeDisplay,
    confirmTimeInput as _confirmTimeInput,
    getDisplayTimeValue as _getDisplayTimeValue,
    transformInputTime as _transformInputTime
} from './ui/TimeControls';
import {
    showModal as _showModal,
    showLegendDialog as _showLegendDialog,
    toggleTheme as _toggleTheme,
    type ModalOptions
} from './ui/ModalSystem';
import { getAppHTML } from './ui/AppTemplate';



class TectoLiteApp {
    private state: AppState;
    private canvasManager: CanvasManager | null = null;
    private simulation: SimulationEngine | null = null;
    private historyManager: HistoryManager = new HistoryManager();
    private activeToolText: string = "INFO LOADING...";
    private timelineSystem: TimelineSystem | null = null;
    private fusionFirstPlateId: string | null = null; // Track first plate for fusion
    private activeLinkSourceId: string | null = null; // Track first plate for linking
    private momentumClipboard: { eulerPole: { position?: Coordinate; rate?: number } } | null = null; // Clipboard for momentum
    // timeMode removed


    // UI State for Explorer Sidebar
    private explorerState: {
        sections: { [key: string]: boolean },
        actionFilters: { [key: string]: boolean }
    } = {
            sections: { plates: true, events: false },
            actionFilters: {
                created: true,
                motion_change: true,
                split: true,
                fusion: true,
                feature: true,
                plate_edit: true
            }
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
            (plateId, featureId, featureIds, plumeId) => this.handleSelect(plateId, featureId, featureIds, plumeId),
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

        const isWidth = dimension === 'width';

        let startVal = 0;
        let startDim = 0;

        const onMouseMove = (e: MouseEvent) => {
            let newVal;
            const cursorVal = isWidth ? e.clientX : e.clientY;
            const diff = inverse ? (startVal - cursorVal) : (cursorVal - startVal);
            newVal = startDim + diff;

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
            if (isWidth) {
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
        return getAppHTML({
            globalOptions: {
                showLinks: this.state.world.globalOptions.showLinks,
                showFlowlines: this.state.world.globalOptions.showFlowlines,
                gridOnTop: this.state.world.globalOptions.gridOnTop,
                plateOpacity: this.state.world.globalOptions.plateOpacity,
                showHints: this.state.world.globalOptions.showHints,
                customRadiusEnabled: this.state.world.globalOptions.customRadiusEnabled,
                customPlanetRadius: this.state.world.globalOptions.customPlanetRadius,
                timelineMaxTime: this.state.world.globalOptions.timelineMaxTime,
                enableAutoOceanicCrust: this.state.world.globalOptions.enableAutoOceanicCrust,
                oceanicGenerationInterval: this.state.world.globalOptions.oceanicGenerationInterval,
                enableExpandingRifts: this.state.world.globalOptions.enableExpandingRifts
            },
            realWorldPresetListHtml: this.generateRealWorldPresetList(),
            customPresetListHtml: this.generateCustomPresetList()
        });
    }


    public showModal(options: ModalOptions): void {
        _showModal(options);
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
        if (!hint) return;
        if (showHints && text) {
            hint.textContent = text;
            hint.style.display = 'block';
        } else {
            hint.style.display = 'none';
        }
    }

    private setupEventListeners(): void {
        const getIsRetro = () => !!document.querySelector('.app-container')?.classList.contains('oldschool-mode');
        const getTooltipText = (el: Element): string | null => {
            const childIcon = el.querySelector('.info-icon');
            return childIcon?.getAttribute('data-tooltip') || el.getAttribute('data-tooltip');
        };

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



        viewBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            viewMenu?.classList.toggle('show');
            planetMenu?.classList.remove('show');
        });

        planetBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            planetMenu?.classList.toggle('show');
            viewMenu?.classList.remove('show');
        });


        // Close on outside click
        document.addEventListener('click', (e) => {
            if (viewMenu?.classList.contains('show') && !viewMenu.contains(e.target as Node) && e.target !== viewBtn) {
                viewMenu.classList.remove('show');
            }
            if (planetMenu?.classList.contains('show') && !planetMenu.contains(e.target as Node) && e.target !== planetBtn) {
                planetMenu.classList.remove('show');
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
        const tooltipTargetSelector = '[data-tooltip], [title], .info-icon, .tool-btn, .feature-btn, button, input, select, label, h3, .view-dropdown-item';

        const updateTooltipPos = (e: MouseEvent) => {
            if (tooltip) {
                const x = e.clientX;
                const y = e.clientY;
                const xOffset = x + 15;
                const yOffset = y + 15;

                // Prevent overflow
                const rect = tooltip.getBoundingClientRect();
                const winWidth = window.innerWidth;
                const winHeight = window.innerHeight;

                let finalX = xOffset;
                let finalY = yOffset;

                if (xOffset + rect.width > winWidth) {
                    finalX = x - rect.width - 10;
                }
                if (yOffset + rect.height > winHeight) {
                    finalY = y - rect.height - 10;
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
            const element = target.closest(tooltipTargetSelector);

            if (!element) return;

            const isRetro = getIsRetro();

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
            const element = target.closest(tooltipTargetSelector);

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

            const isRetro = getIsRetro();

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
            const isRetro = getIsRetro();

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
            this.state.world.globalOptions.showHints = (e.target as HTMLInputElement).checked;
            this.updateHint(this.activeToolText);
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
                const text = getTooltipText(btn);

                if (text) {
                    this.activeToolText = text;
                    // Always update logic, even if not in retro mode, so state is correct when switching
                    if (getIsRetro()) {
                        this.updateRetroStatusBox(this.activeToolText);
                    }
                }
            });

            // Initial Check for active tool
            if (btn.classList.contains('active')) {
                // Initialize text based on default active button
                const text = getTooltipText(btn);

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



        document.getElementById('check-show-links')?.addEventListener('change', (e) => {
            this.state.world.globalOptions.showLinks = (e.target as HTMLInputElement).checked;
            this.canvasManager?.render();
        });

        document.getElementById('check-show-flowlines')?.addEventListener('change', (e) => {
            this.state.world.globalOptions.showFlowlines = (e.target as HTMLInputElement).checked;
            this.canvasManager?.render();
        });

        document.getElementById('check-grid-on-top')?.addEventListener('change', (e) => {
            this.state.world.globalOptions.gridOnTop = (e.target as HTMLInputElement).checked;
            this.canvasManager?.render();
        });

        // Flowline Duration
        document.getElementById('flowline-fade-duration')?.addEventListener('change', (e) => {
            const val = parseInt((e.target as HTMLInputElement).value);
            if (!isNaN(val)) {
                this.state.world.globalOptions.flowlineFadeDuration = val;
            }
        });

        document.getElementById('check-flowline-auto-delete')?.addEventListener('change', (e) => {
            this.state.world.globalOptions.flowlineAutoDelete = (e.target as HTMLInputElement).checked;
        });

        // Plate Opacity Slider
        const plateOpacitySlider = document.getElementById('plate-opacity-slider');
        const plateOpacityValue = document.getElementById('plate-opacity-value');
        plateOpacitySlider?.addEventListener('input', (e) => {
            const value = parseInt((e.target as HTMLInputElement).value);
            this.state.world.globalOptions.plateOpacity = value / 100;
            if (plateOpacityValue) plateOpacityValue.textContent = `${value}%`;
            this.canvasManager?.render();
        });

        // Automated Oceanic Crust
        document.getElementById('check-auto-oceanic')?.addEventListener('change', (e) => {
            this.state.world.globalOptions.enableAutoOceanicCrust = (e.target as HTMLInputElement).checked;
        });

        document.getElementById('check-expanding-rifts')?.addEventListener('change', (e) => {
            this.state.world.globalOptions.enableExpandingRifts = (e.target as HTMLInputElement).checked;
        });

        document.getElementById('input-oceanic-interval')?.addEventListener('change', (e) => {
            const val = parseFloat((e.target as HTMLInputElement).value);
            if (!isNaN(val) && val > 0) {
                this.state.world.globalOptions.oceanicGenerationInterval = val;
            }
        });

        document.getElementById('input-oceanic-color')?.addEventListener('input', (e) => {
            this.state.world.globalOptions.oceanicCrustColor = (e.target as HTMLInputElement).value;
        });

        document.getElementById('input-oceanic-opacity')?.addEventListener('input', (e) => {
            const val = parseInt((e.target as HTMLInputElement).value);
            const opacity = val / 100;
            this.state.world.globalOptions.oceanicCrustOpacity = opacity;

            const lbl = document.getElementById('lbl-oceanic-opacity');
            if (lbl) lbl.textContent = `${val}%`;

            this.canvasManager?.render();
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

            // Plate edit
            const result = this.canvasManager.getEditResult();
            if (result) {
                this.state.world.plates = this.state.world.plates.map(p => {
                    if (p.id === result.plateId) {
                        const copy = { ...p };
                        copy.polygons = result.polygons; // Update current visual state immediately

                        // Recalculate center based on new geometry
                        const geoJson = {
                            type: "FeatureCollection",
                            features: copy.polygons.map(p => toGeoJSON(p))
                        };
                        // @ts-ignore
                        copy.center = geoCentroid(geoJson);

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
                            copy.motionKeyframes.sort((a, b) => a.time - b.time);
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
                case 'e': this.setActiveTool('edit'); break;
                case 'f': this.setActiveTool('feature'); break;
                case 's': this.setActiveTool('split'); break;
                case 'g': this.setActiveTool('fuse'); break;
                case 'l': this.setActiveTool('link'); break;
                case 't': this.setActiveTool('flowline'); break;

                case 'enter':
                    if (this.state.activeTool === 'draw') {
                        this.canvasManager?.applyDraw();
                    } else if (this.state.activeTool === 'split') {
                        this.canvasManager?.applySplit();
                    }
                    break;
                case 'escape':
                    this.canvasManager?.cancelDrawing();
                    this.canvasManager?.cancelSplit();
                    this.canvasManager?.cancelMotion();
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
            const newTime = parseFloat((e.target as HTMLInputElement).value);




            this.simulation?.setTime(newTime);
            this.updateTimeDisplay();
        });

        document.getElementById('btn-reset-time')?.addEventListener('click', () => {
            this.simulation?.setTime(0);
            this.updateTimeDisplay();
        });

        // Time mode toggle removed


        // NEW: Clickable current time to set value
        document.getElementById('current-time')?.addEventListener('click', () => {
            const modal = document.getElementById('time-input-modal');
            const input = document.getElementById('time-input-field') as HTMLInputElement;
            if (modal && input) {
                modal.style.display = 'flex';

                // Pre-populate with current internal time
                const displayTime = this.state.world.currentTime;
                input.value = displayTime.toFixed(1);
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

        // Unified Export Handler
        document.getElementById('btn-export')?.addEventListener('click', async () => {
            try {
                const options = await showUnifiedExportDialog({
                    projection: this.state.world.projection,
                    showGrid: this.state.world.showGrid,
                    includeFeatures: this.state.world.showFeatures
                });
                if (!options) return;

                if (options.format === 'png') {
                    // PNG Export
                    const pngOptions = {
                        projection: options.projection || 'orthographic',
                        waterMode: 'color' as const,
                        plateColorMode: 'native' as const,
                        showGrid: options.showGrid ?? this.state.world.showGrid,
                        includeFeatures: options.includeFeatures ?? this.state.world.showFeatures
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
                    const { world: importedWorld, viewport: importedViewport, name: filename, activeTool, activeFeatureType } = await parseImportFile(file);
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

                    this.pushState(); // Save current state before adding/restoring

                    if (importMode === 'replace_current') {
                        this.state = {
                            ...this.state,
                            world: importedWorld,
                            viewport: importedViewport || this.state.viewport,
                            activeTool: (activeTool as ToolType) ?? this.state.activeTool,
                            activeFeatureType: (activeFeatureType as FeatureType) ?? this.state.activeFeatureType
                        };

                        this.updateExplorer();
                        this.updateUI();
                        this.syncUIToState();
                        this.simulation?.setTime(this.state.world.currentTime);
                        this.canvasManager?.render();

                        alert(`Successfully restored ${importedWorld.plates.length} plate(s) from ${filename}!`);

                        (e.target as HTMLInputElement).value = '';
                        return;
                    }

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
        _toggleTheme({
            setTheme: (theme: string) => this.canvasManager?.setTheme(theme),
            render: () => this.canvasManager?.render()
        });
    }

    private showLegendDialog(): void {
        _showLegendDialog();
    }

    private getSpeedPresetData() {
        return _getSpeedPresetData();
    }

    private generateRealWorldPresetList(): string {
        return generateRealWorldPresetList();
    }

    private generateCustomPresetList(): string {
        return generateCustomPresetList(this.state.world.globalOptions.ratePresets);
    }

    private applySpeedToSelected(rate: number): void {
        // Fix: Use addMotionKeyframe to ensure history preservation and oceanic crust pruning
        // instead of effectively bypassing it with helper utilities that mutate state directly.
        const plateId = this.state.world.selectedPlateId;
        if (!plateId) {
            alert('Please select a plate first.');
            return;
        }

        const plate = this.state.world.plates.find(p => p.id === plateId);
        if (plate) {
            this.pushState(); // Save state for undo
            const currentPole = plate.motion.eulerPole;
            // Apply new rate
            this.addMotionKeyframe(plate.id, { ...currentPole, rate: rate });

            // Update UI
            this.updatePropertiesPanel();
            this.updateSpeedInputsFromSelected();
            this.canvasManager?.render();
        }
    }

    private convertCmYrToDegMa(cmPerYr: number): number {
        return convertCmYrToDegMa(cmPerYr, this.state.world.globalOptions.planetRadius);
    }

    private convertDegMaToCmYr(degPerMa: number): number {
        return convertDegMaToCmYr(degPerMa, this.state.world.globalOptions.planetRadius);
    }

    private updateSpeedInputsFromSelected(): void {
        _updateSpeedInputs(
            this.state.world.selectedPlateId,
            this.state.world.plates,
            this.state.world.globalOptions.planetRadius
        );
    }

    private showPresetInfoDialog(idx: number): void {
        _showPresetInfoDialog(idx, {
            convertCmYrToDegMa: (cmPerYr: number) => this.convertCmYrToDegMa(cmPerYr),
            getSelectedPlate: () => {
                return this.state.world.selectedPlateId
                    ? this.state.world.plates.find(p => p.id === this.state.world.selectedPlateId) || null
                    : null;
            },
            applyRate: (rate: number) => this.applySpeedToSelected(rate),
            updatePropertiesPanel: () => this.updatePropertiesPanel(),
            render: () => this.canvasManager?.render(),
            pushState: () => this.pushState()
        });
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
        const checkShowEventIcons = document.getElementById('check-show-event-icons') as HTMLInputElement | null;
        if (checkShowEventIcons) checkShowEventIcons.checked = w.globalOptions.showEventIcons === true;

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
                hintText = "Select a plate or landmass to link it with another.";
                break;
            case 'paint':
                hintText = "Select a plate, then draw on it with the brush. Adjust size and color in Tool Options.";
                break;
            case 'flowline':
                hintText = "Click on a plate to place a flowline seed.";
                break;

        }

        this.updateHint(hintText);
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
            connectedRiftIds: [],
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

    private handleSelect(plateId: string | null, featureId: string | null, featureIds: string[] = [], plumeId: string | null = null): void {
        // Reset fusion/link state if switching away
        if (this.state.activeTool !== 'fuse') this.fusionFirstPlateId = null;
        if (this.state.activeTool !== 'link') {
            this.activeLinkSourceId = null;
        }

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
            if (plateId) {
                const plate = this.state.world.plates.find(p => p.id === plateId);
                this.updateHint(`Selected ${plate?.name || 'Plate'}.`);
            } else if (plumeId) {
                this.updateHint("Selected Mantle Plume.");
            } else {
                this.updateHint(null);
            }
        }

        if (plumeId) {
            this.state.world.selectedPlateId = null;
            this.state.world.selectedFeatureId = plumeId;
            this.state.world.selectedFeatureIds = [plumeId];
        } else {
            this.state.world.selectedPlateId = plateId;
            this.state.world.selectedFeatureId = featureId ?? null;
            this.state.world.selectedFeatureIds = featureIds.length > 0 ? featureIds : (featureId ? [featureId] : []);
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
            return;
        }
    }

    private handleLinkTool(plateId: string): void {
        const plate = this.state.world.plates.find(p => p.id === plateId);
        if (!plate) return;

        // Step 1: Select parent/anchor plate
        if (!this.activeLinkSourceId) {
            this.activeLinkSourceId = plateId;
            this.state.world.selectedPlateId = plateId;

            this.updateHint(`Selected PARENT (Anchor) ${plate.name} - now select child plate to link to it`);

            this.updateUI();
            this.canvasManager?.render();
            return;
        }

        // Step 2: Select child plate
        if (this.activeLinkSourceId === plateId) {
            // Deselect if clicking same plate
            this.activeLinkSourceId = null;
            this.state.world.selectedPlateId = null;
            this.updateHint("Select parent (anchor) plate");
            this.updateUI();
            this.canvasManager?.render();
            return;
        }

        // Apply Link: source is PARENT, target is CHILD
        const parentId = this.activeLinkSourceId;
        const childId = plateId;
        const parentPlate = this.state.world.plates.find(p => p.id === parentId);

        if (!parentPlate) {
            this.activeLinkSourceId = null;
            return;
        }

        // --- NEW: Rift Connection Logic ---
        // Check if either the "Parent" (Source) or "Child" (Target) is a Rift
        // Case A: Source is Rift, Target is Plate -> Connect Plate to Rift
        // Case B: Source is Plate, Target is Rift -> Connect Plate to Rift

        const isParentRift = parentPlate.type === 'rift';
        const isChildRift = plate.type === 'rift';

        if (isParentRift || isChildRift) {
            // Validate: One must be rift, one must be plate (not rift-rift or plate-plate)
            if (isParentRift && isChildRift) {
                this.showToast("Cannot link two Rifts directly.");
                this.activeLinkSourceId = null;
                this.updateHint("Select parent (anchor) plate");
                return;
            }

            // Identify which is the Rift and which is the Plate
            const rift = isParentRift ? parentPlate : plate;
            const tectonicPlate = isParentRift ? plate : parentPlate; // The non-rift one

            // Check if already connected
            const currentConnections = tectonicPlate.connectedRiftIds || [];
            const isConnected = currentConnections.includes(rift.id);

            if (isConnected) {
                // Disconnect
                this.showModal({
                    title: `Disconnect Rift`,
                    content: `Disconnect <strong>${tectonicPlate.name}</strong> from Rift <strong>${rift.name}</strong>?<br><br>
                    <small>Oceanic crust generation will stop for this plate at this rift.</small>`,
                    buttons: [
                        {
                            text: "Disconnect",
                            onClick: () => {
                                this.pushState();
                                const newConnections = currentConnections.filter(id => id !== rift.id);
                                this.state.world.plates = this.state.world.plates.map(p =>
                                    p.id === tectonicPlate.id
                                        ? { ...p, connectedRiftIds: newConnections }
                                        : p
                                );
                                this.updateHint(`Disconnected ${tectonicPlate.name} from ${rift.name}`);
                                setTimeout(() => { if (this.state.activeTool !== 'link') this.updateHint(null); }, 2000);
                                this.activeLinkSourceId = null;
                                this.state.world.selectedPlateId = tectonicPlate.id; // Select the plate
                                this.updateUI();
                                this.canvasManager?.render();
                            }
                        },
                        {
                            text: 'Cancel',
                            isSecondary: true,
                            onClick: () => {
                                this.activeLinkSourceId = null;
                                this.updateHint("Select first plate/rift");
                            }
                        }
                    ]
                });
            } else {
                // Connect
                this.showModal({
                    title: `Connect to Rift`,
                    content: `Connect <strong>${tectonicPlate.name}</strong> to Rift <strong>${rift.name}</strong>?<br><br>
                    <small>This enables <strong>Oceanic Crust Generation</strong> between them. Motion is NOT inherited.</small>`,
                    buttons: [
                        {
                            text: "Connect",
                            onClick: () => {
                                this.pushState();
                                const newConnections = [...currentConnections, rift.id];
                                this.state.world.plates = this.state.world.plates.map(p =>
                                    p.id === tectonicPlate.id
                                        ? { ...p, connectedRiftIds: newConnections }
                                        : p
                                );
                                this.updateHint(`Connected ${tectonicPlate.name} to ${rift.name}`);
                                setTimeout(() => { if (this.state.activeTool !== 'link') this.updateHint(null); }, 2000);
                                this.activeLinkSourceId = null;
                                this.state.world.selectedPlateId = tectonicPlate.id;
                                this.updateUI();
                                this.canvasManager?.render();
                            }
                        },
                        {
                            text: 'Cancel',
                            isSecondary: true,
                            onClick: () => {
                                this.activeLinkSourceId = null;
                                this.updateHint("Select first plate/rift");
                            }
                        }
                    ]
                });
            }
            return;
        }

        // --- END NEW LOGIC (Standard Plate Linking continues below) ---

        // Check if already linked
        const isLinked = plate.linkedToPlateId === parentId;

        // Check for circular link
        if (!isLinked && parentPlate.linkedToPlateId === childId) {
            this.showToast("Cannot create circular link! Parent is already linked to child.");
            this.activeLinkSourceId = null;
            this.updateHint("Select parent (anchor) plate");
            this.updateUI();
            this.canvasManager?.render();
            return;
        }

        if (isLinked) {
            // Unlink
            this.showModal({
                title: `Unlink Plates`,
                content: `Do you want to <strong>unlink</strong> child plate <strong>${plate.name}</strong> from parent <strong>${parentPlate.name}</strong>?<br><br>
                    <small>${plate.name} will move independently with the combined motion it currently has.</small>`,
                buttons: [
                    {
                        text: "Unlink",
                        onClick: () => {
                            this.pushState();

                            const currentTime = this.state.world.currentTime;

                            // Get parent's current Euler pole
                            const parentKeyframes = parentPlate.motionKeyframes || [];
                            const parentActiveKeyframe = parentKeyframes
                                .filter(kf => kf.time <= currentTime)
                                .sort((a, b) => b.time - a.time)[0];

                            const parentPole = parentActiveKeyframe?.eulerPole || { position: [0, 90], rate: 0 };

                            this.state.world.plates = this.state.world.plates.map(p => {
                                if (p.id === childId) {
                                    // Bake in the parent's motion as the child's new base motion
                                    const childKeyframes = p.motionKeyframes || [];

                                    // Add a new keyframe with parent's pole (the combined motion at unlink time)
                                    const newKeyframes = [...childKeyframes];

                                    // Find if there's already a keyframe at this time
                                    const existingIndex = newKeyframes.findIndex(kf => Math.abs(kf.time - currentTime) < 0.001);

                                    if (existingIndex >= 0) {
                                        // Update existing keyframe to use parent's pole
                                        newKeyframes[existingIndex] = {
                                            ...newKeyframes[existingIndex],
                                            eulerPole: parentPole
                                        };
                                    } else {
                                        // Create new keyframe with parent's pole
                                        newKeyframes.push({
                                            time: currentTime,
                                            eulerPole: parentPole,
                                            snapshotPolygons: p.polygons, // Current position becomes the snapshot
                                            snapshotFeatures: p.features
                                        });
                                    }

                                    return {
                                        ...p,
                                        linkedToPlateId: undefined,
                                        unlinkTime: currentTime,  // Mark when link ended
                                        motionKeyframes: newKeyframes
                                    };
                                }
                                return p;
                            });

                            this.updateHint(`Unlinked ${plate.name} from ${parentPlate.name} at ${currentTime.toFixed(1)} Ma - motion baked in`);
                            setTimeout(() => { if (this.state.activeTool !== 'link') this.updateHint(null); }, 2000);

                            this.activeLinkSourceId = null;
                            this.state.world.selectedPlateId = childId;
                            this.updateUI();
                            this.canvasManager?.render();
                        }
                    },
                    {
                        text: 'Cancel',
                        isSecondary: true,
                        onClick: () => {
                            this.activeLinkSourceId = null;
                            this.updateHint("Select parent (anchor) plate");
                            this.updateUI();
                            this.canvasManager?.render();
                        }
                    }
                ]
            });
        } else {
            // Check if this exact pair is already linked
            const isAlreadyLinked = plate.linkedToPlateId === parentId;

            if (isAlreadyLinked) {
                // Auto-unlink: if you try to link an already-linked pair, unlink them instead
                this.showModal({
                    title: `Unlink Plates`,
                    content: `<strong>${plate.name}</strong> is already linked to <strong>${parentPlate.name}</strong>.<br><br>
                        Do you want to <strong>unlink</strong> them? Motion will be baked in.`,
                    buttons: [
                        {
                            text: "Unlink",
                            onClick: () => {
                                this.pushState();

                                const currentTime = this.state.world.currentTime;

                                // Get parent's current Euler pole
                                const parentKeyframes = parentPlate.motionKeyframes || [];
                                const parentActiveKeyframe = parentKeyframes
                                    .filter(kf => kf.time <= currentTime)
                                    .sort((a, b) => b.time - a.time)[0];

                                const parentPole = parentActiveKeyframe?.eulerPole || { position: [0, 90], rate: 0 };

                                this.state.world.plates = this.state.world.plates.map(p => {
                                    if (p.id === childId) {
                                        // Bake in the parent's motion as the child's new base motion
                                        const childKeyframes = p.motionKeyframes || [];

                                        // Add a new keyframe with parent's pole (the combined motion at unlink time)
                                        const newKeyframes = [...childKeyframes];

                                        // Find if there's already a keyframe at this time
                                        const existingIndex = newKeyframes.findIndex(kf => Math.abs(kf.time - currentTime) < 0.001);

                                        if (existingIndex >= 0) {
                                            // Update existing keyframe to use parent's pole
                                            newKeyframes[existingIndex] = {
                                                ...newKeyframes[existingIndex],
                                                eulerPole: parentPole
                                            };
                                        } else {
                                            // Create new keyframe with parent's pole
                                            newKeyframes.push({
                                                time: currentTime,
                                                eulerPole: parentPole,
                                                snapshotPolygons: p.polygons, // Current position becomes the snapshot
                                                snapshotFeatures: p.features,

                                            });
                                        }

                                        return {
                                            ...p,
                                            linkedToPlateId: undefined,
                                            motionKeyframes: newKeyframes
                                        };
                                    }
                                    return p;
                                });

                                this.updateHint(`Unlinked ${plate.name} from ${parentPlate.name} - motion baked in`);
                                setTimeout(() => { if (this.state.activeTool !== 'link') this.updateHint(null); }, 2000);

                                this.activeLinkSourceId = null;
                                this.state.world.selectedPlateId = childId;
                                this.updateUI();
                                this.canvasManager?.render();
                            }
                        },
                        {
                            text: 'Cancel',
                            isSecondary: true,
                            onClick: () => {
                                this.activeLinkSourceId = null;
                                this.updateHint("Select parent (anchor) plate");
                                this.updateUI();
                                this.canvasManager?.render();
                            }
                        }
                    ]
                });
            } else {
                // Link child to parent
                this.showModal({
                    title: `Link Plates`,
                    content: `Link <strong>${plate.name}</strong> (child) to <strong>${parentPlate.name}</strong> (parent/anchor).<br><br>
                        <small>Child inherits parent motion. Add relative rotation in properties panel later if needed (e.g., Somalia relative to Africa).</small>`,
                    buttons: [
                        {
                            text: "Link",
                            onClick: () => {
                                this.pushState();
                                const currentTime = this.state.world.currentTime;

                                this.state.world.plates = this.state.world.plates.map(p => {
                                    if (p.id === childId) {
                                        // Create a keyframe at link time with zero motion (default pole)
                                        // This prevents the child from "teleporting" when linked
                                        const childKeyframes = p.motionKeyframes || [];
                                        const newKeyframes = [...childKeyframes];

                                        // Check if there's already a keyframe at this time
                                        const existingIndex = newKeyframes.findIndex(kf => Math.abs(kf.time - currentTime) < 0.001);

                                        if (existingIndex < 0) {
                                            // Add new keyframe with zero rate (child stops moving on its own while linked)
                                            newKeyframes.push({
                                                time: currentTime,
                                                eulerPole: { position: [0, 90], rate: 0 },
                                                snapshotPolygons: p.polygons,
                                                snapshotFeatures: p.features,

                                            });
                                        }

                                        return {
                                            ...p,
                                            linkedToPlateId: parentId,
                                            linkTime: currentTime,
                                            unlinkTime: undefined, // Clear any previous unlink time
                                            motionKeyframes: newKeyframes
                                        };
                                    }
                                    return p;
                                });

                                this.updateHint(`Linked ${plate.name} to ${parentPlate.name} starting at ${currentTime.toFixed(1)} Ma`);
                                setTimeout(() => { if (this.state.activeTool !== 'link') this.updateHint(null); }, 2000);

                                this.activeLinkSourceId = null;
                                this.state.world.selectedPlateId = childId;
                                this.updateUI();
                                this.canvasManager?.render();
                            }
                        },
                        {
                            text: 'Cancel',
                            isSecondary: true,
                            onClick: () => {
                                this.activeLinkSourceId = null;
                                this.updateHint("Select parent (anchor) plate");
                                this.updateUI();
                                this.canvasManager?.render();
                            }
                        }
                    ]
                });
            }
        }
    }



    private handleSplitApply(points: Coordinate[]): void {
        if (points.length < 2) return;

        let plateToSplit = this.state.world.plates.find(p => p.id === this.state.world.selectedPlateId);

        if (plateToSplit) {
            this.showModal({
                title: 'Split Plate Configuration',
                content: `
                    <p>You are about to split <strong>${plateToSplit.name}</strong> along the drawn boundary. How should the new plates behave?</p>
                    <div style="margin-top:15px; padding:10px; background:var(--bg-elevated); border-radius:4px;">
                        <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
                            <input type="checkbox" id="chk-split-selected-only"> 
                            <span><strong>Split Only Selected Plate</strong><br><span style="font-size:0.9em; opacity:0.8;">Do not split intersecting features or children</span></span>
                        </label>
                    </div>
                `,
                buttons: [
                    {
                        text: 'Inherit Momentum',
                        subtext: 'New plates will keep the parent\'s current velocity and rotation.',
                        onClick: () => {
                            const onlySelected = (document.getElementById('chk-split-selected-only') as HTMLInputElement)?.checked || false;
                            this.pushState();
                            this.state = splitPlate(this.state, plateToSplit!.id, { points }, true, onlySelected);
                            this.updateUI();
                            this.simulation?.setTime(this.state.world.currentTime);
                            this.canvasManager?.render();
                        }
                    },
                    {
                        text: 'Reset Momentum',
                        subtext: 'New plates will start stationary (0 velocity).',
                        onClick: () => {
                            const onlySelected = (document.getElementById('chk-split-selected-only') as HTMLInputElement)?.checked || false;
                            this.pushState();
                            this.state = splitPlate(this.state, plateToSplit!.id, { points }, false, onlySelected);
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
        } else if (selectedPlateId) {
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
        // Aggregate all plate events + user actions
        let allEvents: { time: number, desc: string, plateName: string, plateId: string, type: string }[] = [];

        const addAction = (time: number | undefined, desc: string, plate: TectonicPlate, type: string) => {
            if (time === undefined || isNaN(time)) return;
            allEvents.push({ time, desc, plateName: plate.name, plateId: plate.id, type });
        };

        this.state.world.plates.forEach(p => {
            if (p.events) {
                p.events.forEach(ev => {
                    let desc: string = ev.type;
                    if (ev.type === 'motion_change') desc = 'Motion Change';
                    if (ev.type === 'split') desc = 'Plate Split';
                    if (ev.type === 'fusion') desc = 'Fusion';
                    addAction(ev.time, desc, p, ev.type);
                });
            }
            // Also add creation time as event
            addAction(p.birthTime, 'Created', p, 'created');

            // Feature placements
            p.features.forEach(f => {
                if (typeof f.generatedAt === 'number') {
                    const label = f.name ? `Feature Placed: ${f.name}` : `Feature Placed: ${f.type}`;
                    addAction(f.generatedAt, label, p, 'feature');
                }
            });

            // Plate edits captured as explicit Edit keyframes
            p.motionKeyframes?.forEach(kf => {
                if (kf.label === 'Edit') {
                    addAction(kf.time, 'Plate Edited', p, 'plate_edit');
                }
            });


        });

        // Sort by time
        allEvents.sort((a, b) => a.time - b.time);

        const actionSection = this.createExplorerSection('Actions', 'events', allEvents.length);
        list.appendChild(actionSection.header);

        if (this.explorerState.sections['events']) {
            const actionContent = actionSection.content;
            const filters = this.explorerState.actionFilters;
            const filterRow = document.createElement('div');
            filterRow.style.display = 'grid';
            filterRow.style.gridTemplateColumns = '1fr 1fr';
            filterRow.style.gap = '4px';
            filterRow.style.marginBottom = '6px';

            const createFilter = (key: string, label: string) => {
                const wrapper = document.createElement('label');
                wrapper.style.display = 'flex';
                wrapper.style.alignItems = 'center';
                wrapper.style.gap = '6px';
                wrapper.style.cursor = 'pointer';
                wrapper.style.fontSize = '11px';

                const input = document.createElement('input');
                input.type = 'checkbox';
                input.checked = !!filters[key];
                input.addEventListener('change', () => {
                    this.explorerState.actionFilters[key] = input.checked;
                    this.updateExplorer();
                });

                const span = document.createElement('span');
                span.textContent = label;

                wrapper.appendChild(input);
                wrapper.appendChild(span);
                filterRow.appendChild(wrapper);
            };

            createFilter('created', 'Created');
            createFilter('motion_change', 'Motion');
            createFilter('split', 'Split');
            createFilter('fusion', 'Fusion');
            createFilter('feature', 'Features');
            createFilter('landmass_create', 'Landmass+');
            createFilter('landmass_edit', 'Landmass Edit');
            createFilter('plate_edit', 'Plate Edit');

            actionContent.appendChild(filterRow);

            const filteredEvents = allEvents.filter(ev => filters[ev.type] !== false);
            if (filteredEvents.length === 0) {
                const empty = document.createElement('p');
                empty.className = 'empty-message';
                empty.textContent = 'No actions recorded';
                actionContent.appendChild(empty);
            } else {
                filteredEvents.forEach(ev => {
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

    }


    private createExplorerSection(title: string, key: string, count: number): { header: HTMLElement, content: HTMLElement } {
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
        if (key === 'plates') content.classList.add('plate-list');
        return { header, content };
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


    /**
     * Adjust selected vertex elevation by delta (for keyboard shortcuts)
     */


    private updatePropertiesPanel(): void {
        const content = document.getElementById('properties-content');
        if (!content) return;





        // Check for Mesh Vertex Selection


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
                        <span class="property-value">${plume.id.substring(0, 6)}</span>
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

        // Update Panel Title
        const titleEl = document.getElementById('properties-panel-title');
        if (titleEl) {
            if (!plate) titleEl.textContent = 'Properties';
            else if (plate.type === 'rift') titleEl.textContent = 'Rift Axis';
            else titleEl.textContent = 'Plate Properties';
        }

        if (!plate) {
            content.innerHTML = '<p class="empty-message">Select a plate to edit properties</p>';
            return;
        }

        const isRift = plate.type === 'rift';

        // Euler Pole UI
        const motion = plate.motion;
        const pole = motion.eulerPole;
        const description = plate.description || '';

        content.innerHTML = `
      <div class="property-group">
        <label class="property-label">${isRift ? 'Axis Name' : 'Name'}</label>
        <input type="text" id="prop-name" class="property-input" value="${plate.name}">
      </div>
      <div class="property-group">
        <label class="property-label">Description</label>
        <textarea id="prop-description" class="property-input" rows="3" placeholder="${isRift ? 'Rift description...' : 'Plate description...'}">${description}</textarea>
      </div>
      
      <div class="property-group">
        <label class="property-label">Color</label>
        <input type="color" id="prop-color" class="property-color" value="${plate.color}">
      </div>
      
      ${!isRift ? `
      <div class="property-group">
        <label class="property-label">Rift Generation</label>
        <select id="prop-rift-mode" class="property-input">
            <option value="default" ${(!plate.riftGenerationMode || plate.riftGenerationMode === 'default') ? 'selected' : ''}>Default</option>
            <option value="always" ${plate.riftGenerationMode === 'always' ? 'selected' : ''}>Always</option>
            <option value="never" ${plate.riftGenerationMode === 'never' ? 'selected' : ''}>Never</option>
        </select>
      </div>

      <div class="property-group">
        <label class="property-label">Crust Type</label>
        <select id="prop-crust-type" class="property-input">
            <option value="continental" ${plate.crustType === 'continental' ? 'selected' : ''}>Continental</option>
            <option value="oceanic" ${plate.crustType === 'oceanic' ? 'selected' : ''}>Oceanic</option>
        </select>
      </div>
      ` : ''}

      <div class="property-group">
        <label class="property-label">Density (g/cm³)</label>
        <input type="number" id="prop-density" class="property-input" value="${plate.density || (plate.crustType === 'oceanic' ? 3.0 : 2.7)}" step="0.1">
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
                        <span style="color:var(--text-secondary);">${p.id.substring(0, 6)}</span>
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
        _updatePlayButton(this.state.world.isPlaying);
    }

    /**
     * Show a brief toast notification
     */
    private showToast(message: string, duration: number = 2000): void {
        _showToast(message, duration);
    }

    private updateTimeDisplay(): void {
        _updateTimeDisplay(this.state.world.currentTime);
    }


    private confirmTimeInput(): void {
        _confirmTimeInput({
            setTime: (time: number) => this.simulation?.setTime(time),
            updateTimeDisplay: () => this.updateTimeDisplay()
        });
    }

    /**
     * Get display value for a time based on current time mode
     * Used for showing time in property fields and attributes
     * @param internalTime - Internal positive time value
     * @returns Display value (positive or negative based on mode)
     */
    private getDisplayTimeValue(internalTime: number | null | undefined): number | null {
        return _getDisplayTimeValue(internalTime);
    }

    private transformInputTime(userInputTime: number): number {
        return _transformInputTime(userInputTime);
    }



    private addMotionKeyframe(plateId: string, newEulerPole: { position: Coordinate; rate: number; visible?: boolean }): void {
        const currentTime = this.state.world.currentTime;
        const plate = this.state.world.plates.find(p => p.id === plateId);
        if (!plate) return;

        // --- 1. Identify Affected Plates (Current & Children) ---
        // We need to know which plates are downstream of this motion change
        // so we can invalidate their generated crust.
        const getDescendants = (pid: string, allPlates: TectonicPlate[]): string[] => {
            const children = allPlates.filter(p => p.linkedToPlateId === pid);
            let descendants = children.map(c => c.id);
            children.forEach(c => {
                descendants = [...descendants, ...getDescendants(c.id, allPlates)];
            });
            return descendants;
        };

        const descendantIds = getDescendants(plateId, this.state.world.plates);
        const affectedPlateIds = new Set([plateId, ...descendantIds]);


        const plates = this.state.world.plates.map(p => {
            let processedPlate = p;

            // 1. Apply Motion Change if this is the target plate
            if (p.id === plateId) {
                const updated = { ...p };
                const oldMotion = { ...p.motion }; // Capture old motion

                // Update Motion to NEW values
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
                const currentKeyframes = p.motionKeyframes || [];

                // HISTORICAL INTEGRITY:
                // If we are adding a keyframe at T > Birth, and there are NO prior keyframes,
                // we must "bake" the old motion as the base motion from Birth -> T.
                // Otherwise, the new 'updated.motion' will retrospectively apply to T=0, rewriting history.
                let newKeyframes = [...currentKeyframes];

                const hasPriorKeyframe = currentKeyframes.some(k => k.time < currentTime);
                if (!hasPriorKeyframe && currentTime > p.birthTime) {
                    newKeyframes.push({
                        time: p.birthTime,
                        eulerPole: oldMotion.eulerPole, // Use OLD motion for the past
                        snapshotPolygons: p.initialPolygons || p.polygons, // Best guess for past state
                        snapshotFeatures: p.initialFeatures || p.features
                    });
                }

                // Now add the NEW keyframe at Current Time
                const newKeyframe: MotionKeyframe = {
                    time: currentTime,
                    eulerPole: updated.motion.eulerPole, // Use NEW motion for the future
                    snapshotPolygons: p.polygons,
                    snapshotFeatures: p.features
                };

                // Remove any existing keyframe exactly at current time to replace it
                newKeyframes = newKeyframes.filter(k => Math.abs(k.time - currentTime) > 0.001);
                newKeyframes.push(newKeyframe);
                updated.motionKeyframes = newKeyframes.sort((a, b) => a.time - b.time);

                // Record motion change event for Actions timeline
                const existingEvents = updated.events || [];
                const existingIndex = existingEvents.findIndex(e => e.type === 'motion_change' && Math.abs(e.time - currentTime) < 0.001);
                const motionEvent = {
                    id: existingIndex >= 0 ? existingEvents[existingIndex].id : generateId(),
                    time: currentTime,
                    type: 'motion_change',
                    description: 'Motion Change'
                } as any;
                const nextEvents = [...existingEvents];
                if (existingIndex >= 0) nextEvents[existingIndex] = { ...existingEvents[existingIndex], ...motionEvent };
                else nextEvents.push(motionEvent);
                updated.events = nextEvents;

                processedPlate = updated;
            }

            // 2. TIMELINE INTEGRITY: Prune "Future" Oceanic Crust
            // If this plate is oceanic AND linked to one of the affected plates (e.g. it was generated by them)
            // AND it was born AT OR AFTER the current time, it is now invalid "future history".
            // It must be deleted so the simulation can regenerate it correctly with the new motion.

            // Check if this plate should be deleted
            const isOceanic = processedPlate.type === 'oceanic';
            // Use >= to include the plate currently being born/active at this exact timestep
            const isFuture = processedPlate.birthTime >= currentTime;

            if (isOceanic && isFuture) {
                // Check if linked to an affected plate (directly or indirectly)
                // Note: 'linkedToPlateId' usually points to the continent it accreted to.
                if (processedPlate.linkedToPlateId && affectedPlateIds.has(processedPlate.linkedToPlateId)) {
                    return null; // DELETE THIS PLATE
                }
            }

            return processedPlate;
        }).filter(p => p !== null) as TectonicPlate[];  // Filter out the nulls

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
        const displayCurrent = current;

        lblCurrent.textContent = displayCurrent.toFixed(1);
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

        // Only update this plate's motion (linked children inherit automatically)
        this.addMotionKeyframe(plateId, newEulerPole);

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
    public replacePlate(plate: TectonicPlate): void {
        const index = this.state.world.plates.findIndex(p => p.id === plate.id);
        if (index !== -1) {
            let newPlates = [...this.state.world.plates];
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
