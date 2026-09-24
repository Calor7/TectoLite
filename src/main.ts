import { generatedOperationName } from './ui/EntityNames';
import { prepareWorkspaceSurfaces, prepareExplorerKeyboard } from './ui/WorkspaceSurfaces';
import { runProjectSave } from './persistence/ProjectSave';
import { prepareFields, setFieldError } from './ui/Fields';
import { openFixedDialog, closeFixedDialog } from './ui/DialogSurface';
// Main Application - TectoLite Plate Tectonics Simulator
import './style.css';
import './ui/controls.css';
import {
    AppState,
    TectonicPlate,
    Feature,
    Polygon,
    ToolType,
    FeatureType,
    InteractionMode,
    generateId,
    createDefaultAppState,
    getNextPlateColor,
    Coordinate,
    EulerPole,
    MantlePlume,
    DrawMode,
    LineType,
    PolygonType,
    CameraView,
    DASH_PRESETS,
    resolveLineTypeDefaults,
    defaultLineTypeDefaults,
    MapLabel,
    ImageOverlay
} from './types';
import { CanvasManager } from './canvas/CanvasManager';
import { SimulationEngine } from './SimulationEngine';
import { exportToPNG, exportToJSON, parseImportFile, showImportDialog, showUnifiedExportDialog } from './export';
import { splitPlate } from './SplitTool';
import { fusePlates } from './FusionTool';
import { vectorToLatLon, Vector3 } from './utils/sphericalMath';
import { toGeoJSON } from './utils/geoHelpers';
import { HistoryManager } from './HistoryManager';
import { remapImportedWorld } from './importHelpers';
import { CURRENT_SAVE_VERSION } from './migration';
import { parseProjectText } from './ProjectIO';
import { pointPositionAt, ensureMotionModel, activeEulerPole, rewriteBirthGeometryStage } from './motion/RotationModel';
import { isMotionLinkActiveAtTime, linkPlateAtTime, motionLinkDescendantIds, unlinkPlateAtTime, wouldCreateMotionLinkCycle } from './motion/LinkModel';
import { HeightmapGenerator } from './systems/HeightmapGenerator';
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
    toggleTheme as _toggleTheme,
    type ModalOptions
} from './ui/ModalSystem';
import { getAppHTML } from './ui/AppTemplate';
import {
    FUSION_PROXY_HELP,
    LAYER_ORDER_HELP,
    LINE_COLOR_HELP,
    LINK_WINDOW_HELP,
} from './ui/workflowGuidance';
import { TutorialOverlay } from './ui/TutorialOverlay';
import { makeBenchmarkWorld } from './utils/benchmarkWorld';
import { perfMonitor } from './utils/PerfMonitor';
import { PROJECT_TEMPLATES, type ProjectTemplate } from './projectTemplates';
import { bindProjectSettings, syncProjectSettings, type ProjectSettingEffect } from './ui/SettingsBindings';
import { selectExplorerRange } from './ui/ExplorerSelection';
import { escapeHtml } from './ui/safeHtml';
import { createAutosaveStore, type AutosaveStore } from './persistence/AutosaveStore';
import { renderHotkeyGuide } from './ui/hotkeys';
import { uiIcon } from './ui/icons';
import { bindMotionLinks, renderMotionLinks } from './ui/MotionLinks';
import { bindKofiHoverAnimation } from './ui/kofiAnimation';
import { bindProgressivePropertyPanels } from './ui/ProgressiveDisclosure';
import { bindDockController, type DockController } from './ui/DockController';
import { loadToolPreferences, saveToolPreferences, type ToolPreferences } from './ui/ToolPreferences';
import { bindUiColorPreferences } from './ui/UiColorPreferences';
import { DEFAULT_MOTION_LABEL_OPTIONS, type MotionLabelOptions } from './canvas/MotionGizmo';

type UnifiedExportOptions = NonNullable<Awaited<ReturnType<typeof showUnifiedExportDialog>>>;

declare global {
    interface Window {
        __TECTOLITE_SMOKE_EXPORT__?: UnifiedExportOptions | null;
        __TECTOLITE_SMOKE_LAST_ERROR__?: string | null;
        __TECTOLITE_HAS_UNSAVED__?: boolean; // read by electron-main.cjs close guard
    }
}

class TectoLiteApp {
    private state: AppState;
    private canvasManager: CanvasManager | null = null;
    private simulation: SimulationEngine | null = null;
    private historyManager: HistoryManager = new HistoryManager();
    private activeToolText: string = "INFO LOADING...";
    private timelineSystem: TimelineSystem | null = null;
    private fusionFirstPlateId: string | null = null; // Track first plate for fusion
    private fusionSecondPlateId: string | null = null;
    private pendingFollowerId: string | null = null;
    private activeLinkSourceId: string | null = null; // Track first plate for linking
    private activeLinkTargetId: string | null = null;
    private splitPreviewActive = false;
    private momentumClipboard: { eulerPole: { position?: Coordinate; rate?: number } } | null = null; // Clipboard for momentum
    private projectRevision = 0;
    private hasUnsavedChanges: boolean = false; // Tracks edits since last save/load for the close guard
    private explorerFilter: string = ''; // Plate-name filter for the Explorer sidebar
    private explorerSelectionAnchorId: string | null = null;
    private cameraBookmarks: CameraView[] = [];
    private imageOverlayEditMode = false;
    private dockController: DockController | null = null;
    private toolPreferences: ToolPreferences = loadToolPreferences();
    private readonly autosaveStore: AutosaveStore;
    private autosaveWritePending = false;
    private autosaveGeneration = 0;
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
        this.autosaveStore = createAutosaveStore();
        this.state = createDefaultAppState();
        const benchmarkScale = perfMonitor.getBenchmarkScale();
        if (benchmarkScale !== null) {
            this.state = {
                ...this.state,
                world: makeBenchmarkWorld(benchmarkScale),
                viewport: {
                    ...this.state.viewport,
                    scale: benchmarkScale === 1 ? 230 : 180,
                    rotate: [-20, -10, 0]
                }
            };
        }
        this.init();
    }

    private init(): void {
        const savedTheme = localStorage.getItem('theme');
        if (savedTheme === 'light' || savedTheme === 'dark') {
            document.body.setAttribute('data-theme', savedTheme);
        }
        document.querySelector<HTMLDivElement>('#app')!.innerHTML = this.getHTML();
        const themeIcon = document.querySelector<HTMLElement>('#btn-theme-toggle [data-theme-icon]');
        if (themeIcon) themeIcon.innerHTML = uiIcon(savedTheme === 'light' ? 'sun' : 'moon');
        let motionLabelOptions: MotionLabelOptions = { ...DEFAULT_MOTION_LABEL_OPTIONS };
        bindUiColorPreferences(document, localStorage, preferences => {
            motionLabelOptions = preferences.canvasMotion;
            this.canvasManager?.setMotionLabelOptions(motionLabelOptions);
            this.canvasManager?.markDirty();
            this.canvasManager?.render();
        });
        const runningInElectron = navigator.userAgent.toLowerCase().includes('electron');
        document.getElementById('link-download-windows')?.toggleAttribute('hidden', runningInElectron);
        this.setupResizers();

        // Initialize canvas
        const canvas = document.getElementById('main-canvas') as HTMLCanvasElement;
        this.canvasManager = new CanvasManager(
            canvas,
            () => this.state,
            (updater) => {
                this.state = updater(this.state);
                this.updateUI(); // Centralized UI update
                this.canvasManager?.markDirty();
            },
            {
                onDrawComplete: (points) => this.handleDrawComplete(points),
                onFeaturePlace: (pos, type) => this.handleFeaturePlace(pos, type),
                onLabelPlace: (position, attachedPlateId) => this.handleLabelPlace(position, attachedPlateId),
                onLabelSelect: (labelId, toggleContent) => this.handleLabelSelect(labelId, toggleContent),
                onLabelMove: (labelId, offset) => this.handleLabelMove(labelId, offset),
                onLabelAnchorMove: (labelId, anchor) => this.handleLabelAnchorMove(labelId, anchor),
                onSelect: (plateId, featureId, featureIds, plumeId) => this.handleSelect(plateId, featureId, featureIds, plumeId),
                onSplitApply: (points) => this.handleSplitApply(points),
                onSplitPreviewChange: (active) => this.handleSplitPreviewChange(active),
                onMotionChange: (plateId, pole, rate) => this.handleMotionChange(plateId, pole, rate),
                onDragTargetRequest: (plateId, axis, angleRad) => this.handleDragTargetRequest(plateId, axis, angleRad),
                onMotionPreviewChange: (active) => {
                    const el = document.getElementById('motion-controls');
                    if (el) el.style.display = active ? 'block' : 'none';
                },
                onDrawUpdate: (count) => this.handleDrawUpdate(count),
                onGizmoUpdate: (rate) => {
                    const speedCmInput = document.getElementById('speed-input-cm') as HTMLInputElement;
                    const speedDegInput = document.getElementById('speed-input-deg') as HTMLInputElement;
                    if (speedDegInput) speedDegInput.value = rate.toFixed(2);
                    if (speedCmInput) speedCmInput.value = this.convertDegMaToCmYr(rate).toFixed(2);
                },
                onEditPending: (active) => {
                    const el = document.getElementById('edit-controls');
                    if (el) el.style.display = active ? 'block' : 'none';
                },
                isImageOverlayEditing: () => this.imageOverlayEditMode,
                onImageOverlaySelect: (overlayId) => {
                    this.state.world.selectedImageOverlayId = overlayId;
                    this.syncImageOverlayControls();
                    this.canvasManager?.markDirty();
                },
                onImageOverlayTransform: (overlayId, patch) => {
                    const overlay = this.state.world.imageOverlays.find(candidate => candidate.id === overlayId);
                    if (!overlay) return;
                    Object.assign(overlay, patch);
                    this.setUnsaved(true);
                    this.syncImageOverlayControls(false);
                    this.canvasManager?.markDirty();
                }
            }
        );
        this.canvasManager.setMotionLabelOptions(motionLabelOptions);

        bindProgressivePropertyPanels(document);
        this.dockController = bindDockController(document, () => this.canvasManager?.resizeCanvas());
        this.canvasManager.setNavigationOptions(this.toolPreferences.navigation);
        this.bindToolOptionControls();
        this.syncToolOptionControls();

        // Initialize simulation
        this.simulation = new SimulationEngine(
            () => this.state,
            (updater) => {
                this.state = updater(this.state);
                this.updateTimeDisplay();
                this.updateMotionLinks();
                this.canvasManager?.markDirty();
                // Don't full re-render UI every tick, just canvas
            }
        );

        // Initialize Timeline System
        this.timelineSystem = new TimelineSystem({
            getState: () => this.state,
            pushState: () => this.pushState(),
            updateUI: () => this.updateUI(),
            showModal: (options) => this.showModal(options),
            deletePlates: (plateIds) => this.deletePlates(plateIds),
            setTime: (time) => this.simulation?.setTime(time)
        });
        this.timelineSystem.setContainer(document.getElementById('timeline-panel')!);

        prepareWorkspaceSurfaces();
        prepareFields(document);
        this.setupEventListeners();
        this.setupHeaderMenus();
        if (perfMonitor.getBenchmarkScale() !== null) {
            this.simulation.setTime(this.state.world.currentTime);
        }
        this.canvasManager.startRenderLoop();
        this.updateUI();

        this.setupAutosave();
        void this.offerAutosaveRestore().then(offered => {
            if (!offered) this.showWelcomeIfNeeded();
        });
    }

    // --- Session autosave (crash / accidental-close recovery) ---

    private updateAutosaveStatus(message: string, failed = false): void {
        const status = document.getElementById('autosave-status');
        if (!status) return;
        status.textContent = message;
        status.classList.toggle('is-error', failed);
        status.title = failed
            ? 'Automatic recovery failed. Save the project manually to avoid losing work.'
            : `Crash recovery uses ${this.autosaveStore.kind === 'electron-file' ? 'an atomic application-data file' : this.autosaveStore.kind === 'indexeddb' ? 'browser IndexedDB' : 'limited browser storage'}.`;
    }

    private async autosaveNow(): Promise<void> {
        if (!this.hasUnsavedChanges || this.autosaveWritePending) return;
        if (this.state.world.plates.length === 0 && this.state.world.labels.length === 0
            && this.state.world.imageOverlays.length === 0) return;
        this.autosaveWritePending = true;
        const generation = this.autosaveGeneration;
        this.updateAutosaveStatus('Saving recovery…');
        try {
            await this.autosaveStore.write(JSON.stringify({
                version: CURRENT_SAVE_VERSION,
                savedAt: new Date().toISOString(),
                world: this.state.world,
                viewport: this.state.viewport,
                cameraViews: this.cameraBookmarks
            }));
            if (generation !== this.autosaveGeneration) {
                await this.autosaveStore.clear();
                return;
            }
            this.updateAutosaveStatus(`Recovery saved ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
        } catch (error) {
            console.error('Autosave failed', error);
            this.updateAutosaveStatus('Recovery failed — save manually', true);
        } finally {
            this.autosaveWritePending = false;
        }
    }

    private clearAutosave(): void {
        this.autosaveGeneration += 1;
        void this.autosaveStore.clear()
            .then(() => this.updateAutosaveStatus('No unsaved recovery'))
            .catch(error => {
                console.error('Could not clear autosave', error);
                this.updateAutosaveStatus('Could not clear recovery', true);
            });
    }

    private setupAutosave(): void {
        this.updateAutosaveStatus(`Recovery ready (${this.autosaveStore.kind === 'electron-file' ? 'app file' : this.autosaveStore.kind === 'indexeddb' ? 'browser database' : 'limited storage'})`);
        window.setInterval(() => { void this.autosaveNow(); }, 120000); // every 2 minutes
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') void this.autosaveNow();
        });
    }

    private async offerAutosaveRestore(): Promise<boolean> {
        try {
            const raw = await this.autosaveStore.read();
            if (!raw) return false;
            const data = parseProjectText(raw, 'Autosaved session');
            const autosaveEntityCount = data.world.plates.length
                + data.world.labels.length
                + data.world.imageOverlays.length;
            if (autosaveEntityCount === 0) return false;
            const when = data.savedAt ? new Date(data.savedAt).toLocaleString() : 'an earlier session';

            this.showModal({
                title: 'Restore autosaved session?',
                content: `An autosave from <b>${when}</b> with ${autosaveEntityCount} map entities was found. The current session ended without saving.`,
                buttons: [
                    {
                        text: 'Restore Autosave',
                        subtext: 'Continue where you left off',
                        onClick: () => {
                            this.state = {
                                ...this.state,
                                world: data.world,
                                viewport: data.viewport || this.state.viewport
                            };
                            if (Array.isArray(data.cameraViews)) {
                                this.cameraBookmarks = data.cameraViews;
                                this.renderCameraViews();
                            }
                            this.updateExplorer();
                            this.updateUI();
                            this.syncUIToState();
                            this.simulation?.setTime(this.state.world.currentTime);
                            this.canvasManager?.render();
                            this.setUnsaved(true); // restored content is not on disk yet
                            this.showToast('Autosaved session restored');
                        }
                    },
                    {
                        text: 'Discard',
                        isSecondary: true,
                        onClick: () => this.clearAutosave()
                    }
                ]
            });
            return true;
        } catch (error) {
            console.error('Could not restore autosave', error);
            this.updateAutosaveStatus('Recovery file needs attention', true);
            return false;
        }
    }

    private showWelcomeIfNeeded(): void {
        if (perfMonitor.getBenchmarkScale() !== null) return;
        if (this.state.world.plates.length || this.state.world.labels.length || this.state.world.imageOverlays.length) return;
        if (localStorage.getItem('tectolite-show-welcome') === 'false') return;

        const rememberPreference = () => {
            const checkbox = document.getElementById('welcome-show-startup') as HTMLInputElement | null;
            localStorage.setItem('tectolite-show-welcome', checkbox?.checked === false ? 'false' : 'true');
        };
        this.showModal({
            title: 'Welcome to TectoLite',
            content: `Choose a starting point. You can reopen these choices from <strong>File → New Project</strong>.
                <label class="welcome-preference"><input id="welcome-show-startup" type="checkbox" checked> Show this welcome screen on startup</label>`,
            buttons: [
                {
                    text: 'Create Blank World',
                    subtext: 'Start drawing on an empty sphere.',
                    onClick: () => { rememberPreference(); this.createNewProject(); }
                },
                ...PROJECT_TEMPLATES.filter(template => template.id !== 'blank').map(template => ({
                    text: template.name,
                    subtext: template.description,
                    onClick: () => { rememberPreference(); void this.createProjectFromTemplate(template); }
                })),
                {
                    text: 'Load Existing Project',
                    subtext: 'Open a TectoLite JSON save from your computer.',
                    onClick: () => {
                        rememberPreference();
                        window.setTimeout(() => document.getElementById('file-import')?.click(), 0);
                    }
                },
                { text: 'Not now', isSecondary: true, onClick: rememberPreference }
            ]
        });
    }


    private setupResizers(): void {
        this.setupResizer('resizer-left', 'toolbar', 'width', false);
        this.setupResizer('resizer-tool-options', 'tool-options-sidebar', 'width', false);
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
            globalOptions: this.state.world.globalOptions,
            realWorldPresetListHtml: this.generateRealWorldPresetList(),
            customPresetListHtml: this.generateCustomPresetList()
        });
    }

    private setupHeaderMenus(): void {
        const menus = [
            { button: document.getElementById('btn-file-menu'), menu: document.getElementById('file-dropdown-menu') },
            { button: document.getElementById('btn-view-panels'), menu: document.getElementById('view-dropdown-menu') },
            { button: document.getElementById('btn-help-menu'), menu: document.getElementById('help-dropdown-menu') },
        ];
        const headerActions = document.querySelector<HTMLElement>('.header-actions');

        const positionMenu = (button: HTMLElement | null, menu: HTMLElement | null) => {
            if (!button || !menu || !menu.classList.contains('show')) return;

            const viewportPadding = 8;
            const buttonRect = button.getBoundingClientRect();
            const menuWidth = menu.getBoundingClientRect().width;
            const maxLeft = Math.max(viewportPadding, window.innerWidth - menuWidth - viewportPadding);

            menu.style.left = `${Math.min(Math.max(buttonRect.left, viewportPadding), maxLeft)}px`;
            menu.style.top = `${buttonRect.bottom + 4}px`;
        };

        const positionOpenMenus = () => {
            for (const entry of menus) positionMenu(entry.button, entry.menu);
        };

        const closeMenus = () => {
            for (const entry of menus) {
                entry.menu?.classList.remove('show');
                entry.button?.setAttribute('aria-expanded', 'false');
            }
        };

        for (const entry of menus) {
            entry.button?.addEventListener('click', event => {
                event.stopPropagation();
                const willOpen = !entry.menu?.classList.contains('show');
                closeMenus();
                if (willOpen) {
                    entry.menu?.classList.add('show');
                    positionMenu(entry.button, entry.menu);
                }
                entry.button?.setAttribute('aria-expanded', String(willOpen));
            });
        }

        window.addEventListener('resize', positionOpenMenus);
        headerActions?.addEventListener('scroll', positionOpenMenus);

        document.addEventListener('click', event => {
            const target = event.target;
            if (!(target instanceof Element)) return;
            const containingMenu = menus.find(entry => entry.menu?.contains(target));
            if (containingMenu && !target.closest('.header-menu-action')) return;
            closeMenus();
        });
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape') closeMenus();
        });
    }


    public showModal(options: ModalOptions): void {
        _showModal(options);
    }

    private showHotkeyGuide(): void {
        this.showModal({
            title: 'Keyboard Shortcuts',
            content: `<div class="hotkey-guide">${renderHotkeyGuide()}</div>`,
            width: '620px',
            buttons: [{ text: 'Close', isSecondary: true, onClick: () => { } }]
        });
    }


    private updateHint(text: string | null): void {
        if (text !== null) this.activeToolText = text;

        const showHints = this.state.world.globalOptions.showHints !== false;

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

    private async saveProject(): Promise<void> {
        // Snapshot before the dialog: later edits must remain unsaved.
        const revision = this.projectRevision;
        const snapshot = structuredClone(this.state);
        const cameraViews = structuredClone(this.cameraBookmarks);
        await runProjectSave({
            save: () => exportToJSON(snapshot, cameraViews),
            saved: () => {
                if (revision === this.projectRevision) { this.setUnsaved(false); this.clearAutosave(); }
            },
            notify: message => this.showToast(message, 4000)
        });
    }

    private async handleUnifiedExport(): Promise<void> {
        try {
            const smokeOptions = window.__TECTOLITE_SMOKE_EXPORT__ ?? null;
            if (smokeOptions) {
                window.__TECTOLITE_SMOKE_EXPORT__ = null;
            }

            // Freeze the PNG scene so playback cannot change it between preview and download.
            const pngState = structuredClone(this.state);
            const options = smokeOptions ?? await showUnifiedExportDialog({
                projection: pngState.world.projection,
                showGrid: pngState.world.showGrid,
                includeFeatures: pngState.world.showFeatures
            }, pngState);
            if (!options) return;

            if (options.format === 'project') {
                await this.saveProject();
                return;
            }

            if (options.format === 'png') {
                const pngOptions = {
                    projection: options.projection || 'orthographic',
                    waterMode: options.waterMode ?? 'color',
                    plateColorMode: options.plateColorMode ?? 'native',
                    gridOnTop: options.gridOnTop,
                    showBorders: options.showBorders,
                    includeLines: options.includeLines,
                    includeLabels: options.includeLabels,
                    showGrid: options.showGrid ?? this.state.world.showGrid,
                    includeFeatures: options.includeFeatures ?? this.state.world.showFeatures
                };
                exportToPNG(pngState, pngOptions, options.width || 1920, options.height || 1080);
                return;
            }

            if (options.format === 'heightmap') {
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
                return;
            }

            await this.exportGeoPackage(options);
            window.__TECTOLITE_SMOKE_LAST_ERROR__ = null;
        } catch (e) {
            console.error('Export failed', e);
            window.__TECTOLITE_SMOKE_LAST_ERROR__ = e instanceof Error ? e.message : 'Unknown error';
            alert(`Export failed: ${e instanceof Error ? e.message : 'Unknown error'}`);
        }
    }

    private async exportGeoPackage(options: UnifiedExportOptions): Promise<void> {
        const { GeoPackageExporter } = await import('./GeoPackageExporter');
        const exporter = new GeoPackageExporter(this.state, {
            width: options.width || 2048,
            height: options.height || 1024,
            projection: options.projection || 'equirectangular',
            includeHeightmap: options.includeHeightmap ?? true
        });
        await exporter.export();
    }

    private getSelectedImageOverlay(): ImageOverlay | undefined {
        const overlays = this.state.world.imageOverlays ?? [];
        const selected = overlays.find(overlay => overlay.id === this.state.world.selectedImageOverlayId);
        return selected ?? overlays.at(-1);
    }

    private async addImageOverlayFile(file: File): Promise<{ optimized: boolean }> {
        // Decoding still needs the original file in memory. Keep a generous
        // emergency ceiling for pathological inputs, but optimize ordinary
        // large images instead of rejecting them at the old 5 MB boundary.
        const maxDecodeSize = 100 * 1024 * 1024;
        if (file.size > maxDecodeSize) throw new Error(`${file.name} exceeds the 100 MB safety limit`);

        const imageData = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = event => resolve(event.target?.result as string);
            reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
            reader.readAsDataURL(file);
        });
        const image = await new Promise<HTMLImageElement>((resolve, reject) => {
            const candidate = new Image();
            candidate.onload = () => resolve(candidate);
            candidate.onerror = () => reject(new Error(`${file.name} is not a readable image`));
            candidate.src = imageData;
        });

        const optimizationThreshold = 5 * 1024 * 1024;
        const targetStoredBytes = 3 * 1024 * 1024;
        const maxDimension = 2048;
        let finalImageData = imageData;
        const shouldOptimize = file.size > optimizationThreshold
            || image.width > maxDimension
            || image.height > maxDimension;
        if (shouldOptimize) {
            const canvas = document.createElement('canvas');
            const scale = Math.min(maxDimension / image.width, maxDimension / image.height);
            let width = Math.max(1, Math.round(image.width * Math.min(1, scale)));
            let height = Math.max(1, Math.round(image.height * Math.min(1, scale)));
            const context = canvas.getContext('2d');
            if (!context) throw new Error(`Could not optimize ${file.name}`);

            let smallestData = imageData;
            let smallestBytes = file.size;
            for (let attempt = 0; attempt < 5; attempt++) {
                canvas.width = width;
                canvas.height = height;
                context.clearRect(0, 0, width, height);
                context.drawImage(image, 0, 0, width, height);

                for (const quality of [0.9, 0.8, 0.7, 0.6]) {
                    const candidate = canvas.toDataURL('image/webp', quality);
                    const payloadLength = candidate.length - candidate.indexOf(',') - 1;
                    const candidateBytes = Math.ceil(payloadLength * 3 / 4);
                    if (candidateBytes < smallestBytes) {
                        smallestData = candidate;
                        smallestBytes = candidateBytes;
                    }
                    if (candidateBytes <= targetStoredBytes) break;
                }

                if (smallestBytes <= targetStoredBytes || (width <= 256 && height <= 256)) break;
                const shrink = Math.min(0.85, Math.sqrt(targetStoredBytes / smallestBytes) * 0.92);
                const longestSide = Math.max(width, height);
                const nextLongestSide = Math.max(256, Math.round(longestSide * shrink));
                const dimensionScale = nextLongestSide / longestSide;
                width = Math.max(1, Math.round(width * dimensionScale));
                height = Math.max(1, Math.round(height * dimensionScale));
            }
            finalImageData = smallestData;
        }

        const overlay: ImageOverlay = {
            id: generateId(),
            name: file.name,
            imageData: finalImageData,
            visible: true,
            opacity: 0.5,
            scale: 1,
            offsetX: 0,
            offsetY: 0,
            rotation: 0,
            mode: 'fixed'
        };
        this.state.world.imageOverlays.push(overlay);
        this.state.world.selectedImageOverlayId = overlay.id;
        this.setUnsaved(true);
        this.syncImageOverlayControls();
        this.canvasManager?.markDirty();
        return { optimized: shouldOptimize };
    }

    private updateSelectedImageOverlay(patch: Partial<ImageOverlay>): void {
        const overlay = this.getSelectedImageOverlay();
        if (!overlay) return;
        Object.assign(overlay, patch);
        this.state.world.selectedImageOverlayId = overlay.id;
        this.setUnsaved(true);
        this.syncImageOverlayControls(false);
        this.canvasManager?.markDirty();
    }

    private syncImageOverlayControls(rebuildSelect = true): void {
        const overlays = this.state.world.imageOverlays ?? [];
        const overlay = this.getSelectedImageOverlay();
        if (overlay && this.state.world.selectedImageOverlayId !== overlay.id) {
            this.state.world.selectedImageOverlayId = overlay.id;
        }

        const select = document.getElementById('overlay-select') as HTMLSelectElement | null;
        if (select && rebuildSelect) {
            select.replaceChildren();
            if (overlays.length === 0) {
                const option = document.createElement('option');
                option.value = '';
                option.textContent = 'No reference images';
                select.appendChild(option);
            } else {
                overlays.forEach((candidate, index) => {
                    const option = document.createElement('option');
                    option.value = candidate.id;
                    option.textContent = `${index + 1}. ${candidate.name}`;
                    select.appendChild(option);
                });
                select.value = overlay?.id ?? '';
            }
        }

        const count = document.getElementById('overlay-count');
        if (count) count.textContent = `(${overlays.length})`;
        const visible = document.getElementById('check-show-overlay') as HTMLInputElement | null;
        if (visible) visible.checked = overlay?.visible === true;
        const opacity = document.getElementById('overlay-opacity-slider') as HTMLInputElement | null;
        const opacityValue = document.getElementById('overlay-opacity-value');
        const opacityPct = Math.round((overlay?.opacity ?? 0.5) * 100);
        if (opacity) opacity.value = String(opacityPct);
        if (opacityValue) opacityValue.textContent = `${opacityPct}%`;
        const size = document.getElementById('overlay-size-slider') as HTMLInputElement | null;
        const sizeValue = document.getElementById('overlay-size-value');
        const sizePct = Math.round((overlay?.scale ?? 1) * 100);
        if (size) size.value = String(Math.min(1000, Math.max(5, sizePct)));
        if (sizeValue) sizeValue.textContent = `${sizePct}%`;
        const x = document.getElementById('overlay-x-input') as HTMLInputElement | null;
        const y = document.getElementById('overlay-y-input') as HTMLInputElement | null;
        const rotation = document.getElementById('overlay-rotation-input') as HTMLInputElement | null;
        if (x) x.value = String(Math.round(overlay?.offsetX ?? 0));
        if (y) y.value = String(Math.round(overlay?.offsetY ?? 0));
        if (rotation) rotation.value = String(Math.round(overlay?.rotation ?? 0));

        const controlIds = [
            'check-show-overlay', 'check-edit-overlay', 'overlay-opacity-slider', 'overlay-size-slider',
            'overlay-x-input', 'overlay-y-input', 'overlay-rotation-input', 'btn-overlay-back',
            'btn-overlay-front', 'btn-reset-overlay', 'btn-clear-overlay'
        ];
        controlIds.forEach(id => {
            const control = document.getElementById(id) as HTMLInputElement | HTMLButtonElement | null;
            if (control) control.disabled = !overlay;
        });
        if (!overlay) {
            this.imageOverlayEditMode = false;
            const edit = document.getElementById('check-edit-overlay') as HTMLInputElement | null;
            if (edit) edit.checked = false;
        }
    }

    private setupEventListeners(): void {
        bindKofiHoverAnimation(document.getElementById('link-kofi-header') as HTMLAnchorElement | null);

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

        document.getElementById('btn-fullscreen-menu')?.addEventListener('click', () => {
            document.getElementById('btn-fullscreen')?.click();
        });

        // Warn about unsaved changes when closing the page.
        // Browser only: in Electron, a beforeunload preventDefault silently cancels
        // window close (no dialog), which would make the app appear unclosable.
        if (!navigator.userAgent.toLowerCase().includes('electron')) {
            window.addEventListener('beforeunload', (e) => {
                if (this.hasUnsavedChanges) {
                    e.preventDefault();
                    e.returnValue = '';
                }
            });
        }

        // Reset Camera
        document.getElementById('btn-reset-camera')?.addEventListener('click', () => {
            this.state.viewport.scale = 250;
            this.state.viewport.rotate = [0, 0, 0];
            this.state.viewport.translate = [
                this.state.viewport.width / 2,
                this.state.viewport.height / 2
            ];
            this.canvasManager?.resizeCanvas();
        });

        document.getElementById('btn-reset-camera-menu')?.addEventListener('click', () => {
            document.getElementById('btn-reset-camera')?.click();
        });

        bindProjectSettings({
            getState: () => this.state,
            changed: effects => this.handleProjectSettingChange(effects)
        });

        // Global Tooltip Logic
        const tooltip = document.getElementById('global-tooltip');
        const tooltipTargetSelector = '[data-tooltip], [title], .info-icon, .tool-btn, .feature-btn, button, input, select, label, h3, .view-dropdown-item';

        document.querySelectorAll<HTMLElement>('.info-icon[data-tooltip]').forEach((icon, index) => {
            const text = icon.dataset.tooltip;
            if (!text) return;
            const describedControl = icon.closest('button') || icon.closest('label')?.querySelector<HTMLElement>('input, select, button');
            if (describedControl) {
                const description = document.createElement('span');
                description.id = `tooltip-description-${index}`;
                description.className = 'sr-only';
                description.textContent = text;
                document.body.appendChild(description);
                describedControl.setAttribute('aria-describedby', description.id);
                describedControl.setAttribute('data-tooltip', text);
                icon.setAttribute('aria-hidden', 'true');
            } else {
                icon.tabIndex = 0;
                icon.setAttribute('role', 'note');
                icon.setAttribute('aria-label', `More information: ${text}`);
            }
        });

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

        const updateTooltipElementPos = (element: Element) => {
            if (!tooltip) return;
            const anchor = element.getBoundingClientRect();
            const rect = tooltip.getBoundingClientRect();
            const left = Math.min(anchor.left, window.innerWidth - rect.width - 8);
            const top = anchor.bottom + rect.height + 8 <= window.innerHeight
                ? anchor.bottom + 6
                : Math.max(8, anchor.top - rect.height - 6);
            tooltip.style.left = `${Math.max(8, left)}px`;
            tooltip.style.top = `${top}px`;
        };

        // Delegated Tooltip Logic
        let activeTooltipElement: HTMLElement | null = null;

        const handleTooltipHover = (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            const element = target.closest(tooltipTargetSelector);

            if (!element) return;

            // Only allow standard tooltip behavior
            if (!element.classList.contains('info-icon') && !element.closest('.info-icon') && !element.hasAttribute('data-tooltip')) {
                return;
            }

            // Determine text - PRIORITY SYSTEM
            let text: string | null = null;

            if (element.classList.contains('info-icon')) {
                text = element.getAttribute('data-tooltip');
            }

            if (!text) {
                const childIcon = element.querySelector('.info-icon');
                if (childIcon) text = childIcon.getAttribute('data-tooltip');
            }

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

            if (text && tooltip) {
                activeTooltipElement = element as HTMLElement;
                tooltip.textContent = text;
                tooltip.style.display = 'block';
                // Small delay before fading in to prevent flashing
                setTimeout(() => {
                    if (activeTooltipElement === element) tooltip.style.opacity = '1';
                }, 50);

                updateTooltipPos(e);
            }
        };

        const handleTooltipOut = (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            const related = e.relatedTarget as Node | null;
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

            if (tooltip) {
                tooltip.style.display = 'none';
                tooltip.style.opacity = '0';
            }
        };

        document.body.addEventListener('mouseover', handleTooltipHover);
        document.body.addEventListener('mouseout', handleTooltipOut);
        document.body.addEventListener('mousemove', (e) => {
            if (tooltip && tooltip.style.display === 'block') {
                updateTooltipPos(e);
            }
        });
        document.body.addEventListener('focusin', event => {
            const element = (event.target as HTMLElement).closest<HTMLElement>('[data-tooltip]');
            const text = element?.dataset.tooltip;
            if (!element || !text || !tooltip) return;
            activeTooltipElement = element;
            tooltip.textContent = text;
            tooltip.style.display = 'block';
            tooltip.style.opacity = '1';
            updateTooltipElementPos(element);
        });
        document.body.addEventListener('focusout', event => {
            const next = event.relatedTarget as Node | null;
            if (activeTooltipElement && next && activeTooltipElement.contains(next)) return;
            if (tooltip) {
                tooltip.style.display = 'none';
                tooltip.style.opacity = '0';
            }
            activeTooltipElement = null;
        });
        document.body.addEventListener('keydown', event => {
            if (event.key === 'Escape' && tooltip?.style.display === 'block') {
                tooltip.style.display = 'none';
                tooltip.style.opacity = '0';
                activeTooltipElement = null;
            }
        });

        // (duplicate fullscreen listener removed — registered once above)

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
                }
            });

            // Initial Check for active tool
            if (btn.classList.contains('active')) {
                // Initialize text based on default active button
                const text = getTooltipText(btn);

                if (text) {
                    this.activeToolText = text;
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

        // Draw Mode Controls
        document.querySelectorAll('input[name="draw-mode"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                const mode = (e.target as HTMLInputElement).value as DrawMode;
                this.state.drawMode = mode;
                this.canvasManager?.setDrawMode(mode);

                const lineTypeGroup = document.getElementById('line-type-group');
                if (lineTypeGroup) lineTypeGroup.style.display = mode === 'line' ? 'block' : 'none';

                // Update hint
                this.updateHint(
                    mode === 'line'
                        ? "[Line Mode] Click to place points. Double-click/Enter to finish. Press D to switch to Polygon."
                        : "[Polygon Mode] Click to place points. Double-click/Enter to finish. Press D to switch to Line."
                );
            });
        });

        document.getElementById('draw-line-type')?.addEventListener('change', (e) => {
            this.state.activeLineType = (e.target as HTMLSelectElement).value as LineType;
        });

        // Was missing entirely: the Polygon Type select did nothing (new plates
        // always used the previous/default polygon type)
        document.getElementById('draw-polygon-type')?.addEventListener('change', (e) => {
            this.state.activePolygonType = (e.target as HTMLSelectElement).value as PolygonType;
        });

        document.getElementById('check-vertex-snap')?.addEventListener('change', (e) => {
            const enabled = (e.target as HTMLInputElement).checked;
            this.canvasManager?.setSnappingEnabled(enabled);
            this.canvasManager?.setEditSnappingEnabled(enabled);
        });

        // Motion Mode
        document.getElementById('motion-mode-select')?.addEventListener('change', (e) => {
            const mode = (e.target as HTMLSelectElement).value as InteractionMode;
            this.canvasManager?.setMotionMode(mode);
        });

        // Camera view bookmarks (View dropdown): dynamic list, no slot limit
        document.getElementById('btn-view-save-new')?.addEventListener('click', () => this.saveCameraBookmarkNew());
        this.renderCameraViews();

        // Plate Opacity Slider
        const plateOpacitySlider = document.getElementById('plate-opacity-slider');
        const plateOpacityValue = document.getElementById('plate-opacity-value');
        plateOpacitySlider?.addEventListener('input', (e) => {
            const value = parseInt((e.target as HTMLInputElement).value);
            this.state.world.globalOptions.plateOpacity = value / 100;
            this.setUnsaved(true);
            if (plateOpacityValue) plateOpacityValue.textContent = `${value}%`;
            this.canvasManager?.render();
        });

        document.getElementById('input-oceanic-interval')?.addEventListener('change', (e) => {
            const val = parseFloat((e.target as HTMLInputElement).value);
            if (!isNaN(val) && val > 0) {
                this.state.world.globalOptions.oceanicGenerationInterval = val;
                this.setUnsaved(true);
                this.simulation?.setTime(this.state.world.currentTime);
                this.canvasManager?.markDirty();
            }
        });

        document.getElementById('input-oceanic-color')?.addEventListener('input', (e) => {
            this.state.world.globalOptions.oceanicCrustColor = (e.target as HTMLInputElement).value;
            this.setUnsaved(true);
            this.canvasManager?.markDirty();
        });

        document.getElementById('input-oceanic-opacity')?.addEventListener('input', (e) => {
            const val = parseInt((e.target as HTMLInputElement).value);
            const opacity = val / 100;
            this.state.world.globalOptions.oceanicCrustOpacity = opacity;
            this.setUnsaved(true);

            const lbl = document.getElementById('lbl-oceanic-opacity');
            if (lbl) lbl.textContent = `${val}%`;

            this.canvasManager?.render();
        });

        // ── Line Entity Defaults ──────────────────────────────────────
        // Per-line-type default color + dash pattern. Changing a default
        // updates every non-customized line entity (already-placed ones whose
        // color/dash the user hasn't manually overridden) and feeds into newly
        // created ones.
        const ensureLineTypeDefaults = () => {
            if (!this.state.world.globalOptions.lineTypeDefaults) {
                this.state.world.globalOptions.lineTypeDefaults = defaultLineTypeDefaults();
            }
            return resolveLineTypeDefaults(this.state.world.globalOptions.lineTypeDefaults);
        };

        const applyLineTypeDefaultColor = (lt: LineType, color: string) => {
            const defs = ensureLineTypeDefaults();
            defs[lt].color = color;
            // Update non-customized line entities of this type.
            for (const plate of this.state.world.plates) {
                if (plate.type === 'rift' && (plate.lineType || 'generic') === lt && !plate.lineColorCustomized) {
                    plate.color = color;
                }
            }
            this.setUnsaved(true);
            this.canvasManager?.render();
        };

        const applyLineTypeDefaultDash = (lt: LineType, dash: number[]) => {
            const defs = ensureLineTypeDefaults();
            defs[lt].dash = dash;
            // Dash isn't stored per-plate (derived from the default), so no
            // per-plate update is needed — the canvas reads the default next
            // render. lineDashCustomized plates keep their override (handled
            // in CanvasManager).
            this.setUnsaved(true);
            this.canvasManager?.render();
        };

        for (const lt of ['divergent', 'convergent', 'transform', 'generic'] as LineType[]) {
            document.getElementById(`input-line-color-${lt}`)?.addEventListener('input', (e) => {
                applyLineTypeDefaultColor(lt, (e.target as HTMLInputElement).value);
            });
            document.getElementById(`select-line-dash-${lt}`)?.addEventListener('change', (e) => {
                const idx = parseInt((e.target as HTMLSelectElement).value);
                const preset = DASH_PRESETS[idx] || DASH_PRESETS[0];
                applyLineTypeDefaultDash(lt, [...preset.dash]);
            });
        }

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
                this.showToast('Select a plate first');
                return;
            }

            const plate = this.state.world.plates.find(p => p.id === selectedPlateId);
            if (plate) {
                this.pushState(); // Save state for undo
                // Move pole to North Pole [0, 90]
                const northPole: Coordinate = [0, 90];
                this.addMotionSegment(plate.id, { ...activeEulerPole(plate, this.state.world.currentTime), position: northPole });
                this.updatePropertiesPanel();
                this.canvasManager?.render();
            }
        });

        document.getElementById('btn-reposition-pole-south')?.addEventListener('click', () => {
            const selectedPlateId = this.state.world.selectedPlateId;
            if (!selectedPlateId) {
                this.showToast('Select a plate first');
                return;
            }

            const plate = this.state.world.plates.find(p => p.id === selectedPlateId);
            if (plate) {
                this.pushState(); // Save state for undo
                // Move pole to South Pole [0, -90]
                const southPole: Coordinate = [0, -90];
                this.addMotionSegment(plate.id, { ...activeEulerPole(plate, this.state.world.currentTime), position: southPole });
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
                openFixedDialog(modal, document.getElementById('btn-apply-cancel'));
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
                        // @ts-expect-error d3's GeoJSON typings don't accept our plain object literal
                        copy.center = geoCentroid(geoJson);

                        if (mode === 'generation') {
                            // --- REWRITE HISTORY STRATEGY (keyframe-less model) ---
                            // Un-rotate the edited (current-time) geometry back to birth
                            // through the FULL rotation model — every motion segment plus
                            // inherited motion — not just the current pole. The result
                            // becomes the plate's birth geometry (stage 0); the engine
                            // derives every other time from it, so no snapshot rebaking.
                            const allPlates = this.state.world.plates;
                            const t = this.state.world.currentTime;
                            const newInitialPolys = result.polygons.map((poly: Polygon) => ({
                                ...poly,
                                points: poly.points.map((pt: Coordinate) =>
                                    pointPositionAt(p, allPlates, pt, t, p.birthTime))
                            }));

                            copy.initialPolygons = newInitialPolys;
                            // Stage 0 is anchored at birth. Keeping its old edit-time
                            // timestamp would make the already-unrotated geometry get
                            // inverse-rotated a second time before that timestamp.
                            copy.geometryStages = rewriteBirthGeometryStage(copy, newInitialPolys);
                            // NOTE: later 'Edit' stages are deliberately untouched — rewriting
                            // history before an explicit shape edit must not destroy that edit
                            // (the legacy snapshot rebake used to do exactly that).
                        } else {
                            // --- SHAPE EVENT STRATEGY (keyframe-less model) ---
                            // Append a geometry stage at the current time: the edited
                            // polygons + current features ARE the absolute coordinates
                            // at this time, which is exactly a stage definition.
                            ensureMotionModel(copy);
                            const stages = [...copy.geometryStages!]
                                .filter(s => Math.abs(s.time - this.state.world.currentTime) > 0.001);
                            stages.push({
                                time: this.state.world.currentTime,
                                polygons: JSON.parse(JSON.stringify(result.polygons)),
                                features: [...p.features]
                            });
                            copy.geometryStages = stages.sort((a, b) => a.time - b.time);
                        }
                        return copy;
                    }
                    return p;
                });

                this.canvasManager.cancelEdit();
                document.getElementById('edit-controls')!.style.display = 'none';
                closeFixedDialog(document.getElementById('apply-edit-modal')!);

                // FORCE SIMULATION UPDATE to reflect changes immediately
                this.simulation?.setTime(this.state.world.currentTime);

                this.canvasManager.render();
            }
        };

        document.getElementById('btn-apply-generation')?.addEventListener('click', () => executeApply('generation'));
        document.getElementById('btn-apply-event')?.addEventListener('click', () => executeApply('event'));
        document.getElementById('btn-apply-cancel')?.addEventListener('click', () => {
            closeFixedDialog(document.getElementById('apply-edit-modal')!);
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
                    this.setUnsaved(true);
                    // We don't need to full updateUI here, just state update so it exports
                }
            }
        });



        // Image Overlay Controls
        document.getElementById('check-show-overlay')?.addEventListener('change', (e) => {
            const checkbox = e.target as HTMLInputElement;
            const overlay = this.getSelectedImageOverlay();
            if (!overlay) {
                // Was a silent no-op — explain why nothing appeared
                checkbox.checked = false;
                this.showToast('Add a reference image first');
                return;
            }
            this.updateSelectedImageOverlay({ visible: checkbox.checked });
        });

        document.getElementById('overlay-select')?.addEventListener('change', (e) => {
            this.state.world.selectedImageOverlayId = (e.target as HTMLSelectElement).value || null;
            this.syncImageOverlayControls(false);
            this.canvasManager?.markDirty();
        });

        document.getElementById('check-edit-overlay')?.addEventListener('change', (e) => {
            this.imageOverlayEditMode = (e.target as HTMLInputElement).checked;
            this.canvasManager?.markDirty();
        });

        document.getElementById('btn-upload-overlay')?.addEventListener('click', () => {
            document.getElementById('file-overlay-upload')?.click();
        });

        document.getElementById('file-overlay-upload')?.addEventListener('change', async (e) => {
            const input = e.target as HTMLInputElement;
            const files = Array.from(input.files ?? []);
            input.value = '';
            let added = 0;
            let optimized = 0;
            for (const file of files) {
                try {
                    const result = await this.addImageOverlayFile(file);
                    added++;
                    if (result.optimized) optimized++;
                } catch (error) {
                    this.showToast(error instanceof Error ? error.message : `Could not add ${file.name}`);
                }
            }
            if (added > 0) {
                const optimizedText = optimized > 0 ? `; optimized ${optimized} large image${optimized === 1 ? '' : 's'}` : '';
                this.showToast(`Added ${added} reference image${added === 1 ? '' : 's'}${optimizedText}`);
            }
        });

        document.getElementById('overlay-opacity-slider')?.addEventListener('input', (e) => {
            const value = parseInt((e.target as HTMLInputElement).value);
            this.updateSelectedImageOverlay({ opacity: value / 100 });
        });

        document.getElementById('overlay-size-slider')?.addEventListener('input', (e) => {
            const value = parseInt((e.target as HTMLInputElement).value);
            this.updateSelectedImageOverlay({ scale: value / 100 });
        });

        document.getElementById('overlay-x-input')?.addEventListener('change', (e) => {
            const value = Number((e.target as HTMLInputElement).value);
            if (Number.isFinite(value)) this.updateSelectedImageOverlay({ offsetX: value });
        });

        document.getElementById('overlay-y-input')?.addEventListener('change', (e) => {
            const value = Number((e.target as HTMLInputElement).value);
            if (Number.isFinite(value)) this.updateSelectedImageOverlay({ offsetY: value });
        });

        document.getElementById('overlay-rotation-input')?.addEventListener('change', (e) => {
            const value = Number((e.target as HTMLInputElement).value);
            if (Number.isFinite(value)) this.updateSelectedImageOverlay({ rotation: value });
        });

        document.getElementById('btn-reset-overlay')?.addEventListener('click', () => {
            this.updateSelectedImageOverlay({ scale: 1, offsetX: 0, offsetY: 0, rotation: 0 });
        });

        const moveOverlayLayer = (toFront: boolean) => {
            const overlays = this.state.world.imageOverlays;
            const selectedId = this.state.world.selectedImageOverlayId;
            const index = overlays.findIndex(overlay => overlay.id === selectedId);
            if (index < 0 || overlays.length < 2) return;
            const [overlay] = overlays.splice(index, 1);
            if (toFront) overlays.push(overlay);
            else overlays.unshift(overlay);
            this.setUnsaved(true);
            this.syncImageOverlayControls();
            this.canvasManager?.markDirty();
        };
        document.getElementById('btn-overlay-back')?.addEventListener('click', () => moveOverlayLayer(false));
        document.getElementById('btn-overlay-front')?.addEventListener('click', () => moveOverlayLayer(true));

        document.getElementById('btn-clear-overlay')?.addEventListener('click', () => {
            const overlays = this.state.world.imageOverlays;
            const index = overlays.findIndex(overlay => overlay.id === this.state.world.selectedImageOverlayId);
            if (index < 0) return;
            overlays.splice(index, 1);
            this.state.world.selectedImageOverlayId = overlays[Math.min(index, overlays.length - 1)]?.id ?? null;
            this.setUnsaved(true);
            this.syncImageOverlayControls();
            this.canvasManager?.markDirty();
        });

        // NEW: Timeline max-time control in footer
        document.getElementById('timeline-max-time')?.addEventListener('change', (e) => {
            const val = parseInt((e.target as HTMLInputElement).value);
            if (!isNaN(val) && val > 0) {
                this.state.world.globalOptions.timelineMaxTime = val;
                this.setUnsaved(true);
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
                    this.setUnsaved(true);
                    radiusInput.value = "6371";
                    this.updateUI();
                    this.canvasManager?.markDirty();
                } else {
                    // Enable custom radius, restore user value
                    this.state.world.globalOptions.customRadiusEnabled = true;
                    const customVal = this.state.world.globalOptions.customPlanetRadius || 6371;
                    radiusInput.value = customVal.toString();
                    this.state.world.globalOptions.planetRadius = customVal;
                    this.setUnsaved(true);
                    this.updateUI();
                    this.canvasManager?.markDirty();
                }
            }
        });

        radiusInput?.addEventListener('change', (e) => {
            const val = parseFloat((e.target as HTMLInputElement).value);
            if (!isNaN(val) && val > 0) {
                this.state.world.globalOptions.customPlanetRadius = val;
                this.setUnsaved(true);
                if (this.state.world.globalOptions.customRadiusEnabled) {
                    this.state.world.globalOptions.planetRadius = val;
                }
                this.updateUI(); // Refresh UI to update calculated stats
                this.canvasManager?.markDirty();
            }
        });

        // Ocean Level




        // Hotkeys
        document.addEventListener('keydown', (e) => {
            if ((e.target as HTMLElement).closest('[role="dialog"]') || document.getElementById('tutorial-overlay')) return;
            if ((e.key === ' ' || e.key === 'Enter') && (e.target as HTMLElement).closest('button, select, summary, a')) return;
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
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
                e.preventDefault();
                document.getElementById('btn-export-json')?.click();
                return;
            }
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
                e.preventDefault();
                document.getElementById('btn-import-json')?.click();
                return;
            }
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
                e.preventDefault();
                this.duplicateSelectedPlate();
                return;
            }

            // Camera bookmarks: digit 1..9 recalls the Nth saved view, Shift+digit updates
            // it (or appends a new one). The UI list in the View dropdown has no limit.
            // Uses e.code because Shift+digit produces symbols (layout-dependent) in e.key.
            if (!e.ctrlKey && !e.metaKey && !e.altKey && /^Digit[1-9]$/.test(e.code)) {
                const index = parseInt(e.code.slice(-1), 10) - 1;
                if (e.shiftKey) {
                    this.saveCameraBookmark(index);
                } else {
                    this.recallCameraBookmark(index);
                }
                return;
            }



            switch (e.key.toLowerCase()) {
                case '?': this.showHotkeyGuide(); break;
                case 'v': this.setActiveTool('select'); break;
                case 'h': this.setActiveTool('pan'); break;
                case 'p': this.setActiveTool('view_pan'); break;
                case 'd':
                    if (this.state.activeTool === 'draw') {
                        // Cycle draw mode when already in draw tool
                        this.cycleDrawMode();
                    } else {
                        this.setActiveTool('draw');
                    }
                    break;
                case 'e': this.setActiveTool('edit'); break;
                case 'f': this.setActiveTool('feature'); break;
                case 's': this.setActiveTool('split'); break;
                case 'g': this.setActiveTool('fuse'); break;
                case 'l': this.setActiveTool('link'); break;
                case 'a': this.setActiveTool('label'); break;

                case 'enter':
                    if (this.state.activeTool === 'draw') {
                        this.canvasManager?.applyDraw();
                    } else if (this.state.activeTool === 'split') {
                        this.canvasManager?.applySplit();
                    }
                    break;
                case 'escape': {
                    this.canvasManager?.cancelDrawing();
                    this.canvasManager?.cancelSplit();
                    this.canvasManager?.cancelMotion();
                    // Also dismiss open dropdown menus and the time-input modal
                    document.getElementById('file-dropdown-menu')?.classList.remove('show');
                    document.getElementById('view-dropdown-menu')?.classList.remove('show');
                    document.getElementById('planet-dropdown-menu')?.classList.remove('show');
                    document.getElementById('help-dropdown-menu')?.classList.remove('show');
                    const timeModal = document.getElementById('time-input-modal');
                    if (timeModal) closeFixedDialog(timeModal);
                    break;
                }
                case ' ':
                    e.preventDefault();
                    this.simulation?.toggle();
                    this.updatePlayButton();
                    break;
                case 'c': {
                    // Center camera on the selected plate
                    const selId = this.state.world.selectedPlateId;
                    const plate = selId ? this.state.world.plates.find(p => p.id === selId) : null;
                    if (plate) {
                        this.state.viewport.rotate = [-plate.center[0], -plate.center[1], 0];
                        this.canvasManager?.render();
                    }
                    break;
                }
                case 'arrowleft':
                case 'arrowright': {
                    // Step time with arrow keys: ±1 Ma, Shift = ±10 Ma
                    e.preventDefault();
                    const step = (e.shiftKey ? 10 : 1) * (e.key === 'ArrowRight' ? 1 : -1);
                    const maxTime = this.state.world.globalOptions.timelineMaxTime || 500;
                    const newTime = Math.min(maxTime, Math.max(0, this.state.world.currentTime + step));
                    this.simulation?.setTime(newTime);
                    this.updateTimeDisplay();
                    break;
                }
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
                // Pre-populate with current internal time
                const displayTime = this.state.world.currentTime;
                input.value = displayTime.toFixed(1);
                const error = document.getElementById('time-input-error');
                if (error) setFieldError(input, error, '');
                openFixedDialog(modal, input);
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
            if (modal) closeFixedDialog(modal);
        });

        // Allow Enter key to confirm
        document.getElementById('time-input-field')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                this.confirmTimeInput();
            } else if (e.key === 'Escape') {
                const modal = document.getElementById('time-input-modal');
                if (modal) closeFixedDialog(modal);
            }
        });

        // Unified Export Handler
        document.getElementById('btn-export')?.addEventListener('click', () => {
            void this.handleUnifiedExport();
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

        document.getElementById('btn-new-project')?.addEventListener('click', () => {
            this.requestNewProject();
        });

        // Export/Import JSON buttons
        document.getElementById('btn-export-json')?.addEventListener('click', async () => {
            await this.saveProject();
        });

        document.getElementById('btn-import-json')?.addEventListener('click', () => {
            document.getElementById('file-import')?.click();
        });

        document.getElementById('file-import')?.addEventListener('change', async (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (file) {
                try {
                    // Parse file first to get metadata for the dialog
                    const { world: importedWorld, viewport: importedViewport, name: filename, activeTool, activeFeatureType, cameraViews: importedCameraViews } = await parseImportFile(file);
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
                        // parseImportFile already ran migrateSaveFile on the
                        // imported world (line-type rename + motion-model
                        // migration), so no per-field migration is needed here.
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

                        this.cameraBookmarks = importedCameraViews || [];
                        this.renderCameraViews();
                        this.setUnsaved(false); // State now mirrors the loaded file
                        this.clearAutosave();
                        this.showToast(`Restored ${importedWorld.plates.length} plate(s) from ${filename}`, 3000);

                        (e.target as HTMLInputElement).value = '';
                        return;
                    }

                    // Calculate time offset based on import mode
                    const timeOffset = importMode === 'at_current_time' ? currentTime : 0;

                    // Regenerate IDs, remap cross-references, and shift timestamps
                    // (see importHelpers.ts for details — logic is unit-tested there)
                    const remapped = remapImportedWorld(importedWorld, timeOffset);
                    const processedPlates = remapped.plates;

                    // Update State
                    this.state = {
                        ...this.state,
                        world: {
                            ...this.state.world,
                            plates: [...this.state.world.plates, ...processedPlates],
                            labels: [...this.state.world.labels, ...remapped.labels],
                            entityGroups: [...this.state.world.entityGroups, ...remapped.entityGroups],
                            riftAxes: [...(this.state.world.riftAxes || []), ...remapped.riftAxes],
                            tripleJunctions: [...(this.state.world.tripleJunctions || []), ...remapped.tripleJunctions],
                            imageOverlays: [...this.state.world.imageOverlays, ...remapped.imageOverlays],
                            selectedImageOverlayId: remapped.imageOverlays.at(-1)?.id
                                ?? this.state.world.selectedImageOverlayId
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

                    // Merge import: append the file's camera views (cheap to delete if unwanted)
                    if (importedCameraViews && importedCameraViews.length > 0) {
                        this.cameraBookmarks.push(...importedCameraViews);
                        this.renderCameraViews();
                    }

                    const modeDesc = importMode === 'at_beginning' ? 'at time 0' : `at time ${currentTime.toFixed(1)} Ma`;
                    this.showToast(`Imported ${processedPlates.length} plate(s) ${modeDesc}`, 3000);

                    // Cleanup
                    (e.target as HTMLInputElement).value = '';

                } catch (err) {
                    console.error(err);
                    alert('Failed to load file: ' + (err as Error).message);
                    (e.target as HTMLInputElement).value = '';
                }
            }
        });

        document.getElementById('btn-theme-toggle')?.addEventListener('click', () => {
            this.toggleTheme();
        });
        document.getElementById('btn-theme-toggle-menu')?.addEventListener('click', () => {
            document.getElementById('btn-theme-toggle')?.click();
        });

        document.getElementById('btn-tutorial-help')?.addEventListener('click', () => {
            TutorialOverlay.toggle();
        });

        document.getElementById('btn-hotkey-help')?.addEventListener('click', () => {
            this.showHotkeyGuide();
        });

        document.getElementById('btn-report-bug')?.addEventListener('click', () => {
            this.showBugReportDialog();
        });
    }

    private showBugReportDialog(): void {
        const savedEmail = localStorage.getItem('tectolite-bug-email') || '';

        const formHtml = `
            <div style="display:flex;flex-direction:column;gap:12px;">
                <label style="display:flex;flex-direction:column;gap:4px;font-size:13px;color:var(--text-primary);">
                    Description <span style="color:var(--accent-danger);font-size: 12px;">(required)</span>
                    <textarea id="bug-description" required rows="4" style="background:var(--bg-tertiary);border:1px solid var(--border-default);border-radius:6px;padding:8px;color:var(--text-primary);font-size:13px;font-family:inherit;resize:vertical;" placeholder="What happened? What did you expect?"></textarea><span id="bug-description-error" class="field-error" hidden></span>
                </label>
                <label style="display:flex;flex-direction:column;gap:4px;font-size:13px;color:var(--text-primary);">
                    Steps to reproduce
                    <textarea id="bug-steps" rows="3" style="background:var(--bg-tertiary);border:1px solid var(--border-default);border-radius:6px;padding:8px;color:var(--text-primary);font-size:13px;font-family:inherit;resize:vertical;" placeholder="1. ... 2. ... 3. ..."></textarea>
                </label>
                <div style="display:flex;gap:12px;">
                    <label style="display:flex;flex-direction:column;gap:4px;font-size:13px;color:var(--text-primary);flex:1;">
                        Severity
                        <select id="bug-severity" style="background:var(--bg-tertiary);border:1px solid var(--border-default);border-radius:6px;padding:6px;color:var(--text-primary);font-size:13px;">
                            <option value="Minor">Minor</option>
                            <option value="Major">Major</option>
                            <option value="Critical">Critical</option>
                        </select>
                    </label>
                    <label style="display:flex;flex-direction:column;gap:4px;font-size:13px;color:var(--text-primary);flex:1;">
                        Your email (optional)
                        <input type="text" id="bug-email" value="${savedEmail.replace(/"/g, '&quot;')}" style="background:var(--bg-tertiary);border:1px solid var(--border-default);border-radius:6px;padding:6px;color:var(--text-primary);font-size:13px;" placeholder="you@example.com">
                    </label>
                </div>
                <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--text-primary);cursor:pointer;">
                    <input type="checkbox" id="bug-screenshot" checked style="cursor:pointer;">
                    Include screenshot of current canvas
                </label>
            </div>
        `;

        _showModal({
            title: 'Report a Bug',
            content: formHtml,
            width: '480px',
            buttons: [
                {
                    text: 'Save Report',
                    onClick: () => {
                        const descEl = document.getElementById('bug-description') as HTMLTextAreaElement | null;
                        const stepsEl = document.getElementById('bug-steps') as HTMLTextAreaElement | null;
                        const sevEl = document.getElementById('bug-severity') as HTMLSelectElement | null;
                        const emailEl = document.getElementById('bug-email') as HTMLInputElement | null;
                        const shotEl = document.getElementById('bug-screenshot') as HTMLInputElement | null;

                        const description = descEl?.value.trim() || '';
                        const steps = stepsEl?.value.trim() || '(not provided)';
                        const severity = sevEl?.value || 'Minor';
                        const email = emailEl?.value.trim() || '';
                        const includeScreenshot = shotEl?.checked ?? false;

                        if (!description) {
                            if (descEl) { setFieldError(descEl, document.getElementById('bug-description-error')!, 'Describe what happened before saving the report.'); descEl.focus(); }
                            return false;
                        }

                        // Save email for next time
                        if (email) {
                            localStorage.setItem('tectolite-bug-email', email);
                        }

                        // Build report text
                        const timestamp = new Date().toISOString();
                        const reportId = `bug-${timestamp.replace(/[:.]/g, '-')}`;
                        const reportText = [
                            `TectoLite Bug Report`,
                            `=====================`,
                            ``,
                            `Date: ${new Date().toLocaleString()}`,
                            `Severity: ${severity}`,
                            email ? `Reporter: ${email}` : `Reporter: (not provided)`,
                            ``,
                            `Description:`,
                            description,
                            ``,
                            `Steps to reproduce:`,
                            steps,
                            ``,
                            `--- App info ---`,
                            `TectoLite version: ${typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'unknown'}`,
                            `Platform: ${navigator.platform}`,
                            `User agent: ${navigator.userAgent}`,
                            ``,
                            `--- Save file (JSON) ---`,
                        ].join('\n');

                        // Attach the current project state as JSON for debugging
                        const saveJson = JSON.stringify({
                            version: 4,
                            world: this.state.world,
                            viewport: this.state.viewport,
                            cameraViews: this.cameraBookmarks
                        }, null, 2);

                        const fullReport = reportText + '\n' + saveJson + '\n';

                        // Capture screenshot if requested
                        let screenshotDataUrl: string | null = null;
                        if (includeScreenshot && this.canvasManager) {
                            try {
                                screenshotDataUrl = this.canvasManager.captureScreenshot();
                            } catch (e) {
                                console.error('Screenshot capture failed:', e);
                            }
                        }

                        // Save via Electron IPC (writes to bug-reports/ folder) or download (web)
                        this.saveBugReport(reportId, fullReport, screenshotDataUrl);
                    }
                },
                {
                    text: 'Cancel',
                    isSecondary: true,
                    onClick: () => { /* no-op, modal auto-closes */ }
                }
            ]
        });
    }

    private saveBugReport(reportId: string, reportText: string, screenshotDataUrl: string | null): void {
        const electronApi = (window as unknown as { electron?: { saveBugReport?: (id: string, text: string, screenshot: string | null) => Promise<string> } }).electron;
        if (electronApi?.saveBugReport) {
            // Electron: save to bugs/ folder via IPC
            electronApi.saveBugReport(reportId, reportText, screenshotDataUrl)
                .then((folder) => {
                    this.showBugReportSentDialog(folder, reportText);
                })
                .catch((err) => {
                    console.error('Failed to save bug report:', err);
                    this.downloadBugReportFiles(reportId, reportText, screenshotDataUrl);
                    this.showBugReportSentDialog('Downloads folder', reportText);
                });
        } else {
            // Web fallback: download files
            this.downloadBugReportFiles(reportId, reportText, screenshotDataUrl);
            this.showBugReportSentDialog('Downloads folder', reportText);
        }
    }

    private showBugReportSentDialog(savedLocation: string, reportText: string): void {
        const githubBody = encodeURIComponent(reportText.split('\n--- Save file (JSON) ---')[0].trim());
        const githubUrl = `https://github.com/Calor7/TectoLite/issues/new?title=${encodeURIComponent('Bug Report')}&body=${githubBody}`;
        const discordUrl = 'https://discord.com/channels/1463842783742922772/1477000139624284343';

        _showModal({
            title: 'Bug Report Saved',
            content: `<div style="font-size:13px;color:var(--text-secondary);line-height:1.5;">
                Your bug report has been saved to:<br>
                <code style="background:var(--bg-tertiary);padding:2px 6px;border-radius:4px;font-size:12px;">${savedLocation}</code><br><br>
                Choose how you'd like to submit it:
            </div>`,
            width: '420px',
            buttons: [
                {
                    text: 'Open GitHub Issues',
                    subtext: 'Pre-filled with your bug report text',
                    onClick: () => {
                        this.openExternalUrl(githubUrl);
                    }
                },
                {
                    text: 'Open Discord bug channel',
                    subtext: 'Paste your report into the channel',
                    onClick: () => {
                        this.openExternalUrl(discordUrl);
                    }
                },
                {
                    text: 'Close',
                    isSecondary: true,
                    onClick: () => { /* no-op */ }
                }
            ]
        });
    }

    private openExternalUrl(url: string): void {
        const electronApi = (window as unknown as { electron?: { openExternal?: (url: string) => Promise<void> } }).electron;
        if (electronApi?.openExternal) {
            electronApi.openExternal(url);
        } else {
            const link = document.createElement('a');
            link.href = url;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.style.display = 'none';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
    }

    private downloadBugReportFiles(reportId: string, reportText: string, screenshotDataUrl: string | null): void {
        // Download the text report
        const textBlob = new Blob([reportText], { type: 'text/plain' });
        const textLink = document.createElement('a');
        textLink.download = `${reportId}.txt`;
        textLink.href = URL.createObjectURL(textBlob);
        textLink.click();
        URL.revokeObjectURL(textLink.href);

        // Download the screenshot if available
        if (screenshotDataUrl) {
            const shotLink = document.createElement('a');
            shotLink.download = `${reportId}-screenshot.png`;
            shotLink.href = screenshotDataUrl;
            shotLink.click();
        }

        _showToast('Bug report downloaded. Send the files to mail@refracturedgames.com', 5000);
    }

    private toggleTheme(): void {
        _toggleTheme({
            setTheme: (theme: string) => this.canvasManager?.setTheme(theme),
            render: () => this.canvasManager?.render()
        });
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
        // Fix: Use addMotionSegment to ensure history preservation and oceanic crust pruning
        // instead of effectively bypassing it with helper utilities that mutate state directly.
        const plateId = this.state.world.selectedPlateId;
        if (!plateId) {
            this.showToast('Select a plate first');
            return;
        }

        const plate = this.state.world.plates.find(p => p.id === plateId);
        if (plate) {
            this.pushState(); // Save state for undo
            const currentPole = activeEulerPole(plate, this.state.world.currentTime);
            // Apply new rate
            this.addMotionSegment(plate.id, { ...currentPole, rate: rate });

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
            this.state.world.globalOptions.planetRadius,
            this.state.world.currentTime
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
        const g = w.globalOptions;
        syncProjectSettings(this.state);
        // Global Options
        const maxTimeInput = document.getElementById('timeline-max-time') as HTMLInputElement;
        if (maxTimeInput && g.timelineMaxTime) {
            maxTimeInput.value = g.timelineMaxTime.toString();
            const timeSlider = document.getElementById('time-slider') as HTMLInputElement | null;
            if (timeSlider) timeSlider.max = g.timelineMaxTime.toString();
        }

        // Playback speed select (was never synced from loaded state)
        const speedSelect = document.getElementById('speed-select') as HTMLSelectElement | null;
        if (speedSelect && w.timeScale) speedSelect.value = String(w.timeScale);

        this.syncImageOverlayControls();

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


        // Sync Paint Ageing Options

    }

    private updateUI(): void {
        this.updateToolbarState();
        this.updateExplorer();
        this.updatePropertiesPanel();
        this.syncToolOptionControls();
        this.syncImageOverlayControls();
        this.updateSpeedInputsFromSelected();
        this.updatePlayButton();
        this.updateTimeDisplay();
    }

    private bindToolOptionControls(): void {
        const persist = () => saveToolPreferences(this.toolPreferences);
        const syncNavigation = () => {
            this.canvasManager?.setNavigationOptions(this.toolPreferences.navigation);
            persist();
        };

        document.getElementById('navigation-sensitivity')?.addEventListener('change', event => {
            this.toolPreferences.navigation.sensitivity = Number((event.target as HTMLSelectElement).value) || 1;
            syncNavigation();
        });
        document.getElementById('check-navigation-reverse')?.addEventListener('change', event => {
            this.toolPreferences.navigation.reverseDrag = (event.target as HTMLInputElement).checked;
            syncNavigation();
        });
        document.getElementById('check-navigation-reachable')?.addEventListener('change', event => {
            this.toolPreferences.navigation.keepMapReachable = (event.target as HTMLInputElement).checked;
            syncNavigation();
        });
        document.getElementById('btn-reset-orientation')?.addEventListener('click', () => this.canvasManager?.resetViewOrientation());
        document.getElementById('btn-north-up')?.addEventListener('click', () => this.canvasManager?.resetViewOrientation(true));
        document.getElementById('btn-center-view')?.addEventListener('click', () => this.canvasManager?.centerRenderedView());
        document.getElementById('btn-center-selection')?.addEventListener('click', () => {
            const plate = this.state.world.plates.find(candidate => candidate.id === this.state.world.selectedPlateId);
            if (plate) this.canvasManager?.centerRenderedViewOn(plate.center);
        });

        document.getElementById('label-default-attachment')?.addEventListener('change', event => {
            this.toolPreferences.label.attachment = (event.target as HTMLSelectElement).value as ToolPreferences['label']['attachment'];
            persist();
        });
        document.getElementById('label-default-color')?.addEventListener('input', event => {
            this.toolPreferences.label.color = (event.target as HTMLInputElement).value;
            persist();
        });
        document.getElementById('check-label-default-expanded')?.addEventListener('change', event => {
            this.toolPreferences.label.expanded = (event.target as HTMLInputElement).checked;
            persist();
        });

        document.querySelectorAll<HTMLInputElement>('input[name="split-momentum"]').forEach(input => {
            input.addEventListener('change', () => {
                this.toolPreferences.split.inheritMomentum = input.value === 'inherit';
                persist();
            });
        });
        document.getElementById('check-split-selected-only')?.addEventListener('change', event => {
            this.toolPreferences.split.onlySelected = (event.target as HTMLInputElement).checked;
            persist();
        });

        document.getElementById('btn-clear-link-workflow')?.addEventListener('click', () => {
            this.pendingFollowerId = null;
            const workflowIds = new Set([this.activeLinkSourceId, this.activeLinkTargetId].filter(Boolean));
            this.activeLinkSourceId = null;
            this.activeLinkTargetId = null;
            if (this.state.world.selectedPlateId && workflowIds.has(this.state.world.selectedPlateId)) {
                this.state.world.selectedPlateId = null;
                this.state.world.selectedPlateIds = [];
            }
            this.updateHint('Choose the leader on the map or in Explorer');
            this.updateUI();
            this.canvasManager?.markDirty();
        });
        document.getElementById('btn-clear-fuse-workflow')?.addEventListener('click', () => {
            this.fusionFirstPlateId = null;
            this.fusionSecondPlateId = null;
            const resultName = document.getElementById('fuse-result-name') as HTMLInputElement | null;
            if (resultName) resultName.value = '';
            this.updateHint('Select the plate whose motion should be inherited');
            this.syncToolOptionControls();
            this.canvasManager?.markDirty();
        });
    }

    private syncToolOptionControls(): void {
        const setText = (id: string, value: string) => {
            const element = document.getElementById(id);
            if (element) element.textContent = value;
        };
        const setDisplay = (id: string, visible: boolean) => {
            const element = document.getElementById(id);
            if (element) element.style.display = visible ? 'flex' : 'none';
        };
        const plateName = (id: string | null) => id
            ? this.state.world.plates.find(plate => plate.id === id)?.name ?? 'Unavailable plate'
            : null;

        const sensitivity = document.getElementById('navigation-sensitivity') as HTMLSelectElement | null;
        if (sensitivity) sensitivity.value = String(this.toolPreferences.navigation.sensitivity);
        const reverse = document.getElementById('check-navigation-reverse') as HTMLInputElement | null;
        if (reverse) reverse.checked = this.toolPreferences.navigation.reverseDrag;
        const reachable = document.getElementById('check-navigation-reachable') as HTMLInputElement | null;
        if (reachable) reachable.checked = this.toolPreferences.navigation.keepMapReachable;
        const labelAttachment = document.getElementById('label-default-attachment') as HTMLSelectElement | null;
        if (labelAttachment) labelAttachment.value = this.toolPreferences.label.attachment;
        const labelColor = document.getElementById('label-default-color') as HTMLInputElement | null;
        if (labelColor && document.activeElement !== labelColor) labelColor.value = this.toolPreferences.label.color;
        const labelExpanded = document.getElementById('check-label-default-expanded') as HTMLInputElement | null;
        if (labelExpanded) labelExpanded.checked = this.toolPreferences.label.expanded;
        const inherit = document.getElementById('split-inherit-momentum') as HTMLInputElement | null;
        const reset = document.getElementById('split-reset-momentum') as HTMLInputElement | null;
        if (inherit) inherit.checked = this.toolPreferences.split.inheritMomentum;
        if (reset) reset.checked = !this.toolPreferences.split.inheritMomentum;
        const onlySelected = document.getElementById('check-split-selected-only') as HTMLInputElement | null;
        if (onlySelected) onlySelected.checked = this.toolPreferences.split.onlySelected;

        const selectedPlate = this.state.world.plates.find(plate => plate.id === this.state.world.selectedPlateId);
        const centerSelection = document.getElementById('btn-center-selection') as HTMLButtonElement | null;
        if (centerSelection) centerSelection.disabled = !selectedPlate;
        const splitNameA = document.getElementById('split-name-a') as HTMLInputElement | null;
        const splitNameB = document.getElementById('split-name-b') as HTMLInputElement | null;
        if (splitNameA) splitNameA.placeholder = selectedPlate ? generatedOperationName(selectedPlate.name, ' (A)') : 'Automatic (A)';
        if (splitNameB) splitNameB.placeholder = selectedPlate ? generatedOperationName(selectedPlate.name, ' (B)') : 'Automatic (B)';
        setText('split-workflow-status', this.splitPreviewActive
            ? `Boundary ready at ${this.state.world.currentTime.toFixed(1)} Ma. Review the options and apply.`
            : selectedPlate
                ? `Splitting ${selectedPlate.name} at ${this.state.world.currentTime.toFixed(1)} Ma. Draw a boundary across it.`
                : 'Select a plate, then draw the split boundary.');
        const splitApply = document.getElementById('btn-split-apply') as HTMLButtonElement | null;
        if (splitApply) splitApply.disabled = !this.splitPreviewActive;

        const linkSource = plateName(this.activeLinkSourceId);
        const linkTarget = plateName(this.activeLinkTargetId);
        setText('link-workflow-time', `${this.state.world.currentTime.toFixed(1)} Ma`);
        setText('link-workflow-source', linkSource ?? 'Choose on map or in Explorer');
        setText('link-workflow-target', linkTarget ?? (linkSource ? 'Choose on map or in Explorer' : 'Waiting for leader'));
        const sourcePlate = this.state.world.plates.find(plate => plate.id === this.activeLinkSourceId);
        const targetPlate = this.state.world.plates.find(plate => plate.id === this.activeLinkTargetId);
        setText('link-workflow-result', sourcePlate?.type === 'rift' || targetPlate?.type === 'rift'
            ? 'This creates or removes a rift-generation connection; it does not inherit motion.'
            : `The follower follows the leader exactly from ${this.state.world.currentTime.toFixed(1)} Ma.`);

        const fuseSource = plateName(this.fusionFirstPlateId);
        const fuseTarget = plateName(this.fusionSecondPlateId);
        setText('fuse-workflow-time', `${this.state.world.currentTime.toFixed(1)} Ma`);
        setText('fuse-workflow-source', fuseSource ?? 'Choose on map');
        setText('fuse-workflow-target', fuseTarget ?? (fuseSource ? 'Choose other plate on map' : 'Waiting for source'));
        const fuseName = document.getElementById('fuse-result-name') as HTMLInputElement | null;
        if (fuseName) fuseName.placeholder = fuseSource && fuseTarget
            ? generatedOperationName(`${fuseSource}-${fuseTarget}`, ' (Fused)')
            : 'Automatic fused name';

        setDisplay('navigation-controls', this.state.activeTool === 'pan' || this.state.activeTool === 'view_pan');
        setDisplay('rotate-navigation-actions', this.state.activeTool === 'pan');
        setDisplay('move-view-navigation-actions', this.state.activeTool === 'view_pan');
        setDisplay('label-tool-controls', this.state.activeTool === 'label');
        setDisplay('split-controls', this.state.activeTool === 'split');
        setDisplay('link-controls', this.state.activeTool === 'link');
        setDisplay('fuse-controls', this.state.activeTool === 'fuse');
    }

    private setActiveTool(tool: ToolType): void {
        this.pendingFollowerId = null;
        if (tool !== 'fuse') {
            this.fusionFirstPlateId = null;
            this.fusionSecondPlateId = null;
        }
        if (tool !== 'link') {
            this.activeLinkSourceId = null;
            this.activeLinkTargetId = null;
        }
        this.state.activeTool = tool;
        this.updateToolbarState();
        this.dockController?.setTool(tool);

        const featureSelector = document.getElementById('feature-selector');
        if (featureSelector) {
            featureSelector.style.display = tool === 'feature' ? 'block' : 'none';
        }

        const drawModeControls = document.getElementById('draw-mode-controls');
        if (drawModeControls) {
            drawModeControls.style.display = tool === 'draw' ? 'flex' : 'none';
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

        const selectControls = document.getElementById('select-mode-controls');
        if (selectControls) {
            selectControls.style.display = tool === 'select' ? 'flex' : 'none';
        }

        // Set initial Stage 1 hint/tooltip
        let hintText = "";
        switch (tool) {
            case 'select':
                hintText = "Click a plate or feature to select it.";
                break;
            case 'pan':
                hintText = "Drag to rotate the globe or map projection. Geometry is unchanged; scroll to zoom.";
                break;
            case 'view_pan':
                hintText = "Drag to move the rendered view on screen without rotating the globe or changing geometry.";
                break;
            case 'edit':
                hintText = "Select a plate, then drag edges to add points or drag vertices to move. Right-click deletes vertices; deleting from a 3-vertex component removes that whole component when the plate has others. Ctrl/Shift+drag moves the whole shape (drag the yellow ring to rotate).";
                break;
            case 'draw':
                hintText = this.state.drawMode === 'line'
                    ? "[Line Mode] Click to place points. Double-click/Enter to finish. Press D to switch to Polygon."
                    : "[Polygon Mode] Click to place points. Double-click/Enter to finish. Press D to switch to Line.";
                break;
            case 'feature':
                hintText = "Pick a feature type, then click the selected plate. Hotspots are manually placed fixed markers and do not need a selected plate.";
                break;
            case 'label':
                hintText = "Click a map point to place a label. Clicking a plate attaches the label to its motion by default.";
                break;
            case 'poly_feature':
                hintText = "Click anywhere to start drawing a custom region feature.";
                break;
            case 'split':
                hintText = "Click a plate to start splitting.";
                break;
            case 'fuse':
                hintText = "Select the plate whose motion should be inherited, then select the other plate to fuse at the current time.";
                break;
            case 'link':
                hintText = 'Choose the leader on the map or in Explorer, then the follower. The follower inherits leader motion from the current time.';
                break;
            case 'paint':
                hintText = "Select a plate, then draw on it with the brush. Adjust size and color in Tool Options.";
                break;
        }

        this.updateHint(hintText);
        this.syncToolOptionControls();
        this.canvasManager?.markDirty();
    }



    private setActiveFeature(feature: FeatureType): void {
        this.state.activeFeatureType = feature;
        this.updateToolbarState();

        const typeLabel = this.getFeatureTypeName(feature);
        this.updateHint(feature === 'hotspot'
            ? `Click the map to place a fixed ${typeLabel} marker.`
            : `Select a plate, then click it to place a ${typeLabel}.`);
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
        const isLineMode = this.state.drawMode === 'line';
        const minRequired = isLineMode ? 2 : 3;
        if (points.length < minRequired) return;

        this.pushState(); // Save state for undo

        const currentTime = this.state.world.currentTime;
        const defaultEulerPole = { position: [0, 90] as Coordinate, rate: 0, visible: false };

        if (isLineMode) {
            // --- LINE MODE: Create a line plate ---
            const polygon: Polygon = {
                id: generateId(),
                points: points,
                closed: false
            };

            const lineType = this.state.activeLineType;
            const typeLabel = lineType.charAt(0).toUpperCase() + lineType.slice(1);

            // Seed the plate color from the per-type default in settings so new
            // line entities track settings changes until the user customizes.
            const defs = resolveLineTypeDefaults(this.state.world.globalOptions.lineTypeDefaults);
            const typeDefaultColor = (defs[lineType] || defs.generic).color;

            const plate: TectonicPlate = {
                id: generateId(),
                name: `${typeLabel} ${this.state.world.plates.filter(p => p.type === 'rift').length + 1}`,
                color: typeDefaultColor,
                // lineColorCustomized / lineDashCustomized intentionally unset
                // (false) so settings-default changes propagate to this plate.
                polygons: [polygon],
                features: [],
                motionSegments: [{ time: currentTime, eulerPole: { ...defaultEulerPole } }],
                geometryStages: [{ time: currentTime, polygons: [polygon], features: [] }],
                visible: true,
                locked: false,
                center: points[0],
                events: [],
                birthTime: currentTime,
                deathTime: null,
                connectedRiftIds: [],
                initialPolygons: [polygon],
                initialFeatures: [],
                type: 'rift',
                lineType: lineType
            };

            this.state = {
                ...this.state,
                world: {
                    ...this.state.world,
                    plates: [...this.state.world.plates, plate],
                    selectedPlateId: plate.id
                }
            };
        } else {
            // --- POLYGON MODE: Create a standard plate ---
            const polygon: Polygon = {
                id: generateId(),
                points: points,
                closed: true
            };

            const plate: TectonicPlate = {
                id: generateId(),
                name: `Plate ${this.state.world.plates.length + 1}`,
                color: getNextPlateColor(this.state.world.plates),
                polygons: [polygon],
                features: [],
                motionSegments: [{ time: currentTime, eulerPole: { ...defaultEulerPole } }],
                geometryStages: [{ time: currentTime, polygons: [polygon], features: [] }],
                visible: true,
                locked: false,
                center: points[0],
                events: [],
                birthTime: currentTime,
                deathTime: null,
                connectedRiftIds: [],
                initialPolygons: [polygon],
                initialFeatures: [],
                polygonType: this.state.activePolygonType,
                type: 'lithosphere',
                density: this.state.activePolygonType === 'oceanic_plate' ? 3.0 : 2.7,
                isOceanic: this.state.activePolygonType === 'oceanic_plate',
                zIndex: this.state.activePolygonType === 'craton' ? 2 : (this.state.activePolygonType === 'island' ? 1 : 0)
            };

            this.state = {
                ...this.state,
                world: {
                    ...this.state.world,
                    plates: [...this.state.world.plates, plate],
                    selectedPlateId: plate.id
                }
            };
        }

        this.updateUI();
        this.simulation?.setTime(this.state.world.currentTime);
        this.setActiveTool('select');
    }

    /** Cycle draw mode between polygon and line */
    private cycleDrawMode(): void {
        const newMode: DrawMode = this.state.drawMode === 'polygon' ? 'line' : 'polygon';
        this.state.drawMode = newMode;
        this.canvasManager?.setDrawMode(newMode);

        // Update UI radio buttons
        const polygonRadio = document.getElementById('draw-mode-polygon') as HTMLInputElement;
        const lineRadio = document.getElementById('draw-mode-line') as HTMLInputElement;
        if (polygonRadio) polygonRadio.checked = newMode === 'polygon';
        if (lineRadio) lineRadio.checked = newMode === 'line';

        // Show/hide line type dropdown
        const lineTypeGroup = document.getElementById('line-type-group');
        if (lineTypeGroup) lineTypeGroup.style.display = newMode === 'line' ? 'block' : 'none';

        const polygonTypeGroup = document.getElementById('polygon-type-group');
        if (polygonTypeGroup) polygonTypeGroup.style.display = newMode === 'polygon' ? 'block' : 'none';

        // Update hint
        this.updateHint(
            newMode === 'line'
                ? "[Line Mode] Click to place points. Double-click/Enter to finish. Press D to switch to Polygon."
                : "[Polygon Mode] Click to place points. Double-click/Enter to finish. Press D to switch to Line."
        );
    }



    private handleFeaturePlace(position: Coordinate, type: FeatureType): void {
        // Hotspots are fixed global markers rather than plate-bound features.
        if (type === 'hotspot') {
            const plume: MantlePlume = {
                id: generateId(),
                position
            };

            // Add to World State
            this.pushState();
            this.state = {
                ...this.state,
                world: {
                    ...this.state.world,
                    mantlePlumes: [...(this.state.world.mantlePlumes || []), plume],
                    selectedPlateId: null,
                    selectedPlateIds: [],
                    selectedFeatureId: plume.id,
                    selectedFeatureIds: [plume.id]
                }
            };

            this.updatePropertiesPanel();
            this.canvasManager?.render();
            this.updateHint(`Placed a fixed hotspot marker at ${this.state.world.currentTime.toFixed(1)} Ma.`);

            return;
        }

        // Use the selected plate for feature placement
        const plateId = this.state.world.selectedPlateId;

        if (!plateId) {
            this.showToast('For plate features (mountains, volcanoes), select a plate first', 3000);
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
                ),
                selectedFeatureId: feature.id,
                selectedFeatureIds: [feature.id]
            }
        };

        this.simulation?.setTime(this.state.world.currentTime);
        this.canvasManager?.render();
        this.updatePropertiesPanel();
        this.updateHint(`Placed ${this.getFeatureTypeName(type)} on the selected plate at ${this.state.world.currentTime.toFixed(1)} Ma.`);
    }

    private handleLabelPlace(position: Coordinate, suggestedPlateId?: string): void {
        const activePlates = this.state.world.plates.filter(plate =>
            plate.birthTime <= this.state.world.currentTime
            && (plate.deathTime === null || plate.deathTime > this.state.world.currentTime)
        );
        const selectedActivePlateId = activePlates.some(plate => plate.id === this.state.world.selectedPlateId)
            ? this.state.world.selectedPlateId ?? undefined
            : undefined;
        const defaultAttachedPlateId = this.toolPreferences.label.attachment === 'fixed'
            ? undefined
            : this.toolPreferences.label.attachment === 'selected'
                ? selectedActivePlateId
                : suggestedPlateId;
        const attachmentOptions = activePlates.map(plate =>
            `<option value="${plate.id}" ${plate.id === defaultAttachedPlateId ? 'selected' : ''}>${escapeHtml(plate.name)}</option>`
        ).join('');
        this.showModal({
            title: 'Add Label',
            width: '460px',
            content: `
                <label class="property-label" for="label-title-input">Title</label>
                <input id="label-title-input" class="property-input" maxlength="120" placeholder="Label title" style="width:100%; margin:5px 0 12px;">
                <label class="property-label" for="label-content-input">Content</label>
                <textarea id="label-content-input" class="property-input" rows="5" maxlength="2000" placeholder="Optional detail shown on click or hover" style="width:100%; margin:5px 0 12px;"></textarea>
                <label class="property-label" for="label-attachment-input">Moves with</label>
                <select id="label-attachment-input" class="property-input" style="width:100%; margin:5px 0 12px;">
                    <option value="" ${defaultAttachedPlateId ? '' : 'selected'}>Nothing (fixed geographic point)</option>
                    ${attachmentOptions}
                </select>
                <label class="property-label" for="label-color-input">Color</label>
                <input id="label-color-input" type="color" value="${this.toolPreferences.label.color}" style="width:100%; height:38px; margin-top:5px;">
            `,
            buttons: [
                {
                    text: 'Create Label',
                    subtext: 'The title stays visible; use its small +/− circle to pin or collapse detail text.',
                    onClick: () => {
                        const title = (document.getElementById('label-title-input') as HTMLInputElement | null)?.value.trim();
                        if (!title) { this.showToast('Enter a label title'); return false; }
                        const content = (document.getElementById('label-content-input') as HTMLTextAreaElement | null)?.value.trim() ?? '';
                        const attachedPlateId = (document.getElementById('label-attachment-input') as HTMLSelectElement | null)?.value || undefined;
                        const color = (document.getElementById('label-color-input') as HTMLInputElement | null)?.value || this.toolPreferences.label.color;
                        const label: MapLabel = {
                            id: generateId(), title, content, color,
                            anchor: [...position] as Coordinate,
                            anchorTime: this.state.world.currentTime,
                            offset: [18, -30],
                            visible: true, locked: false, expanded: this.toolPreferences.label.expanded,
                            attachedPlateId
                        };
                        this.toolPreferences.label.color = color;
                        saveToolPreferences(this.toolPreferences);
                        this.pushState();
                        this.state.world.labels = [...this.state.world.labels, label];
                        this.state.world.selectedLabelId = label.id;
                        this.state.world.selectedPlateId = null;
                        this.state.world.selectedPlateIds = [];
                        this.state.world.selectedFeatureId = null;
                        this.state.world.selectedFeatureIds = [];
                        this.updateUI();
                        this.canvasManager?.render();
                    }
                },
                { text: 'Cancel', isSecondary: true, onClick: () => undefined }
            ]
        });
        window.setTimeout(() => (document.getElementById('label-title-input') as HTMLInputElement | null)?.focus(), 0);
    }

    private handleLabelSelect(labelId: string, toggleContent = false): void {
        const label = this.state.world.labels.find(candidate => candidate.id === labelId);
        if (!label) return;
        if (toggleContent) {
            this.pushState();
            this.state.world.labels = this.state.world.labels.map(candidate =>
                candidate.id === labelId ? { ...candidate, expanded: !candidate.expanded } : candidate
            );
        }
        this.state.world.selectedLabelId = labelId;
        this.state.world.selectedPlateId = null;
        this.state.world.selectedPlateIds = [];
        this.state.world.selectedFeatureId = null;
        this.state.world.selectedFeatureIds = [];
        this.updateHint(toggleContent
            ? `${label.title} content ${label.expanded ? 'collapsed' : 'pinned'}.`
            : `Selected ${label.title}. Use the circle on its title to pin or collapse content.`);
        this.updateUI();
        this.canvasManager?.render();
        this.timelineSystem?.render(null);
    }

    private handleLabelMove(labelId: string, offset: [number, number]): void {
        const label = this.state.world.labels.find(candidate => candidate.id === labelId);
        if (!label || label.locked) return;
        this.pushState();
        this.state.world.labels = this.state.world.labels.map(candidate =>
            candidate.id === labelId ? { ...candidate, offset } : candidate
        );
        this.state.world.selectedLabelId = labelId;
        this.state.world.selectedPlateId = null;
        this.state.world.selectedPlateIds = [];
        this.updateUI();
        this.canvasManager?.render();
    }

    private handleLabelAnchorMove(labelId: string, anchor: Coordinate): void {
        const label = this.state.world.labels.find(candidate => candidate.id === labelId);
        if (!label || label.locked) return;
        this.pushState();
        this.state.world.labels = this.state.world.labels.map(candidate =>
            candidate.id === labelId ? { ...candidate, anchor, anchorTime: this.state.world.currentTime } : candidate
        );
        this.state.world.selectedLabelId = labelId;
        this.state.world.selectedPlateId = null;
        this.state.world.selectedPlateIds = [];
        this.updateUI();
        this.canvasManager?.render();
    }

    private handleSelect(plateId: string | null, featureId: string | null, featureIds: string[] = [], plumeId: string | null = null): void {
        // Reset fusion/link state if switching away
        if (this.state.activeTool !== 'fuse') {
            this.fusionFirstPlateId = null;
            this.fusionSecondPlateId = null;
        }
        if (this.state.activeTool !== 'link') {
            this.activeLinkSourceId = null;
            this.activeLinkTargetId = null;
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
                this.updateHint("Selected fixed hotspot marker.");
            } else {
                this.updateHint(null);
            }
        }

        this.state.world.selectedLabelId = null;
        if (plumeId) {
            this.state.world.selectedPlateId = null;
            this.state.world.selectedPlateIds = [];
            this.state.world.selectedFeatureId = plumeId;
            this.state.world.selectedFeatureIds = [plumeId];
        } else {
            this.state.world.selectedPlateId = plateId;
            this.state.world.selectedPlateIds = plateId ? [plateId] : [];
            this.explorerSelectionAnchorId = plateId;
            this.state.world.selectedFeatureId = featureId ?? null;
            this.state.world.selectedFeatureIds = featureIds.length > 0 ? featureIds : (featureId ? [featureId] : []);
        }

        this.updateUI();
        this.canvasManager?.render();

        const plate = plateId ? this.state.world.plates.find(p => p.id === plateId) : null;
        if (plate) {
            this.timelineSystem?.render(plate);
        } else {
            this.timelineSystem?.render(null);
        }
    }



    private handleFuseTool(plateId: string): void {
        const plate = this.state.world.plates.find(p => p.id === plateId);
        if (!plate) return;

        if (!this.fusionFirstPlateId) {
            this.fusionFirstPlateId = plateId;
            this.fusionSecondPlateId = null;
            this.updateHint(`Selected motion source ${plate.name}. Now select the other plate to fuse at ${this.state.world.currentTime.toFixed(1)} Ma.`);
            this.syncToolOptionControls();
        } else if (this.fusionFirstPlateId !== plateId) {
            // Stage 3 - Confirmation
            const firstPlate = this.state.world.plates.find(p => p.id === this.fusionFirstPlateId);
            if (!firstPlate) {
                this.fusionFirstPlateId = null;
                this.fusionSecondPlateId = null;
                return;
            }
            this.fusionSecondPlateId = plateId;
            this.syncToolOptionControls();

            this.showModal({
                title: 'Confirm Fusion',
                content: `Do you want to fuse plate <strong>${escapeHtml(firstPlate.name)}</strong> and <strong>${escapeHtml(plate.name)}</strong> into a single plate at <strong>${this.state.world.currentTime.toFixed(1)} Ma</strong>?<br><br>
                    <small><strong>${escapeHtml(firstPlate.name)}</strong> was selected first, so it supplies the new plate's initial motion.</small><br>
                    <small>${FUSION_PROXY_HELP}</small>`,
                buttons: [
                    {
                        text: 'Fuse Plates',
                        subtext: `Combine geometries and features. Initial motion comes from ${escapeHtml(firstPlate.name)}.`,
                        onClick: () => {
                            const resultName = (document.getElementById('fuse-result-name') as HTMLInputElement | null)?.value.trim();
                            this.pushState();
                            const result = fusePlates(this.state, this.fusionFirstPlateId!, plateId, { resultName });

                            if (result.success && result.newState) {
                                this.state = result.newState;
                                this.fusionFirstPlateId = null;
                                this.fusionSecondPlateId = null;
                                const nameInput = document.getElementById('fuse-result-name') as HTMLInputElement | null;
                                if (nameInput) nameInput.value = '';
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
                        text: 'Swap Motion Source',
                        subtext: `${plate.name} will supply the fused plate's initial motion instead.`,
                        isSecondary: true,
                        onClick: () => {
                            const previousSourceId = firstPlate.id;
                            this.fusionFirstPlateId = plate.id;
                            this.fusionSecondPlateId = null;
                            this.syncToolOptionControls();
                            window.setTimeout(() => this.handleFuseTool(previousSourceId), 0);
                        }
                    },
                    {
                        text: 'Cancel',
                        isSecondary: true,
                        onClick: () => {
                            this.fusionFirstPlateId = null;
                            this.fusionSecondPlateId = null;
                            this.updateHint("Select first plate to fuse");
                            this.syncToolOptionControls();
                        }
                    }
                ]
            });
            return;
        }
    }

    private beginFollowPlate(followerId: string): void {
        this.setActiveTool('link');
        this.pendingFollowerId = followerId;
        this.activeLinkSourceId = null;
        this.activeLinkTargetId = followerId;
        this.dockController?.showToolOptions();
        this.syncToolOptionControls();
        this.updateHint('Choose the leader on the map or in Explorer. You will review the direction and time before linking.');
    }

    private handleLinkTool(plateId: string): void {
        if (this.pendingFollowerId) {
            if (this.pendingFollowerId === plateId) {
                this.showToast('Choose a different plate as the leader.');
                return;
            }
            const followerId = this.pendingFollowerId;
            this.pendingFollowerId = null;
            this.activeLinkSourceId = plateId;
            this.handleLinkTool(followerId);
            return;
        }
        const plate = this.state.world.plates.find(p => p.id === plateId);
        if (!plate) return;

        // Step 1: Select parent/anchor plate
        if (!this.activeLinkSourceId) {
            this.activeLinkSourceId = plateId;
            this.activeLinkTargetId = null;
            this.state.world.selectedPlateId = plateId;

            this.updateHint(`Selected LEADER ${plate.name} - now choose the follower on the map or in Explorer`);

            this.updateUI();
            this.canvasManager?.render();
            return;
        }

        // Step 2: Select child plate
        if (this.activeLinkSourceId === plateId) {
            // Deselect if clicking same plate
            this.activeLinkSourceId = null;
            this.activeLinkTargetId = null;
            this.state.world.selectedPlateId = null;
            this.updateHint("Choose the leader on the map or in Explorer");
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
            this.activeLinkTargetId = null;
            return;
        }
        this.activeLinkTargetId = childId;
        this.syncToolOptionControls();

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
                this.activeLinkTargetId = null;
                this.updateHint("Choose the leader on the map or in Explorer");
                this.syncToolOptionControls();
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
                    content: `Disconnect <strong>${escapeHtml(tectonicPlate.name)}</strong> from Rift <strong>${escapeHtml(rift.name)}</strong>?<br><br>
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
                                this.activeLinkTargetId = null;
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
                                this.activeLinkTargetId = null;
                                this.updateHint("Select first plate/rift");
                                this.syncToolOptionControls();
                            }
                        }
                    ]
                });
            } else {
                // Connect
                this.showModal({
                    title: `Connect to Rift`,
                    content: `Connect <strong>${escapeHtml(tectonicPlate.name)}</strong> to Rift <strong>${escapeHtml(rift.name)}</strong>?<br><br>
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
                                this.activeLinkTargetId = null;
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
                                this.activeLinkTargetId = null;
                                this.updateHint("Select first plate/rift");
                                this.syncToolOptionControls();
                            }
                        }
                    ]
                });
            }
            return;
        }

        // --- END NEW LOGIC (Standard Plate Linking continues below) ---

        const linkTime = this.state.world.currentTime;
        if ([plate, parentPlate].some(candidate => linkTime < candidate.birthTime || (candidate.deathTime !== null && linkTime >= candidate.deathTime))) {
            this.showToast('Both leader and follower must be alive at the linking time. Change the time or choose another plate.');
            return;
        }
        // Check if already linked
        const isLinked = isMotionLinkActiveAtTime(plate, this.state.world.currentTime, parentId);

        // Reject direct and multi-hop cycles whose link windows overlap the new
        // relationship. Expired historical links do not block a valid relink.
        if (!isLinked && wouldCreateMotionLinkCycle(this.state.world.plates, childId, parentId, this.state.world.currentTime)) {
            this.showToast("Cannot create link: it would form a circular motion chain during an overlapping timeline window.");
            this.activeLinkSourceId = null;
            this.activeLinkTargetId = null;
            this.updateHint("Choose the leader on the map or in Explorer");
            this.updateUI();
            this.canvasManager?.render();
            return;
        }

        if (isLinked) {
            this.confirmUnlinkPlate(childId);
        } else {
            // A saved relationship may begin later on the timeline. It is not
            // active yet, so using Link here reschedules its start instead of
            // creating an impossible unlinkTime < linkTime window.
            this.showModal({
                title: `Link Plates`,
                content: `Link <strong>${escapeHtml(plate.name)}</strong> (follower) to <strong>${escapeHtml(parentPlate.name)}</strong> (leader) starting at <strong>${linkTime.toFixed(1)} Ma</strong>?<br><br>
                    <small>The follower’s independent motion becomes zero at the link time so it follows the leader. ${plate.linkedToPlateId ? 'This replaces the saved follow relationship, including earlier linked history. Undo restores it.' : 'Earlier history is unchanged.'}</small>`,
                buttons: [
                    {
                        text: "Link",
                        onClick: () => {
                            this.pushState();
                            const currentTime = linkTime;

                            this.state.world.plates = this.state.world.plates.map(p =>
                                p.id === childId ? linkPlateAtTime(p, parentId, currentTime) : p
                            );

                            this.updateHint(`Linked ${plate.name} to ${parentPlate.name} starting at ${currentTime.toFixed(1)} Ma`);
                            setTimeout(() => { if (this.state.activeTool !== 'link') this.updateHint(null); }, 2000);

                            this.activeLinkSourceId = null;
                            this.activeLinkTargetId = null;
                            this.state.world.selectedPlateId = childId;
                            this.updateUI();
                            this.canvasManager?.render();
                        }
                    },
                    {
                        text: 'Swap leader and follower',
                        subtext: `${plate.name} becomes the leader instead.`,
                        isSecondary: true,
                        onClick: () => {
                            this.activeLinkSourceId = childId;
                            this.activeLinkTargetId = null;
                            this.syncToolOptionControls();
                            window.setTimeout(() => this.handleLinkTool(parentId), 0);
                        }
                    },
                    {
                        text: 'Cancel',
                        isSecondary: true,
                        onClick: () => {
                            this.activeLinkSourceId = null;
                            this.activeLinkTargetId = null;
                            this.updateHint("Choose the leader on the map or in Explorer");
                            this.updateUI();
                            this.canvasManager?.render();
                        }
                    }
                ]
            });
        }
    }



    private confirmUnlinkPlate(childId: string): void {
        const child = this.state.world.plates.find(plate => plate.id === childId);
        const parent = this.state.world.plates.find(plate => plate.id === child?.linkedToPlateId);
        const time = this.state.world.currentTime;
        if (!child || !parent || !isMotionLinkActiveAtTime(child, time)) return;

        this.showModal({
            title: 'Stop following',
            content: `Stop <strong>${escapeHtml(child.name)}</strong> following <strong>${escapeHtml(parent.name)}</strong> at <strong>${time.toFixed(1)} Ma</strong>?<br><br>
                <small>Earlier linked motion is preserved. From this time, the plate moves independently. You can undo this change.</small>`,
            buttons: [
                {
                    text: 'Unlink',
                    onClick: () => {
                        const currentChild = this.state.world.plates.find(plate => plate.id === childId);
                        const currentParent = this.state.world.plates.find(plate => plate.id === parent.id);
                        if (!currentChild || !currentParent || !isMotionLinkActiveAtTime(currentChild, time, parent.id)) return;
                        this.pushState();
                        const parentPole = activeEulerPole(currentParent, time);
                        this.state.world.plates = this.state.world.plates.map(plate =>
                            plate.id === childId ? unlinkPlateAtTime(plate, time, parentPole) : plate
                        );
                        this.activeLinkSourceId = null;
                        this.activeLinkTargetId = null;
                        this.simulation?.setTime(this.state.world.currentTime);
                        this.updateUI();
                        this.canvasManager?.render();
                        this.updateHint(`${child.name} stopped following ${parent.name} at ${time.toFixed(1)} Ma.`);
                    }
                },
                { text: 'Cancel', isSecondary: true, onClick: () => undefined }
            ]
        });
    }

    private handleSplitApply(points: Coordinate[]): void {
        if (points.length < 2) return;

        const plateToSplit = this.state.world.plates.find(p => p.id === this.state.world.selectedPlateId);
        if (!plateToSplit) {
            this.showToast('Select a plate before applying the split.');
            return;
        }

        const nameA = (document.getElementById('split-name-a') as HTMLInputElement | null)?.value.trim() || undefined;
        const nameB = (document.getElementById('split-name-b') as HTMLInputElement | null)?.value.trim() || undefined;
        const nextState = splitPlate(this.state, plateToSplit.id, { points }, {
            inheritMomentum: this.toolPreferences.split.inheritMomentum,
            onlySelected: this.toolPreferences.split.onlySelected,
            resultNames: [nameA, nameB]
        });
        if (nextState === this.state) {
            this.showToast('The boundary did not produce two valid plate regions.');
            return;
        }
        this.pushState();
        this.state = nextState;
        this.splitPreviewActive = false;
        const inputA = document.getElementById('split-name-a') as HTMLInputElement | null;
        const inputB = document.getElementById('split-name-b') as HTMLInputElement | null;
        if (inputA) inputA.value = '';
        if (inputB) inputB.value = '';
        this.updateUI();
        this.simulation?.setTime(this.state.world.currentTime);
        this.canvasManager?.render();
        this.updateHint(`Split ${plateToSplit.name} at ${this.state.world.currentTime.toFixed(1)} Ma.`);
    }

    private handleSplitPreviewChange(active: boolean): void {
        this.splitPreviewActive = active;
        this.syncToolOptionControls();
    }

    private deleteSelected(): void {
        this.pushState(); // Save state for undo

        const { selectedFeatureId, selectedFeatureIds, selectedPlateId, selectedLabelId } = this.state.world;

        if (selectedLabelId) {
            this.state.world.labels = this.state.world.labels.filter(label => label.id !== selectedLabelId);
            this.state.world.selectedLabelId = null;
        } else if (selectedFeatureId || (selectedFeatureIds && selectedFeatureIds.length > 0)) {
            // Build set of all feature IDs to delete
            const idsToDelete = new Set<string>();
            if (selectedFeatureId) idsToDelete.add(selectedFeatureId);
            if (selectedFeatureIds) selectedFeatureIds.forEach(id => idsToDelete.add(id));

            // Remove from fixed hotspot markers if present
            if (this.state.world.mantlePlumes) {
                this.state.world.mantlePlumes = this.state.world.mantlePlumes.filter(p => !idsToDelete.has(p.id));
            }

            // Remove these features from all plates and their history
            this.state.world.plates = this.state.world.plates.map(p => ({
                ...p,
                features: p.features.filter(f => !idsToDelete.has(f.id)),
                initialFeatures: p.initialFeatures ? p.initialFeatures.filter(f => !idsToDelete.has(f.id)) : p.initialFeatures,
                geometryStages: p.geometryStages ? p.geometryStages.map(s => ({
                    ...s,
                    features: s.features.filter(f => !idsToDelete.has(f.id))
                })) : p.geometryStages
            }));

            this.state.world.selectedFeatureId = null;
            this.state.world.selectedFeatureIds = [];
        } else if (selectedPlateId) {
            // Only delete plate if we didn't just delete strokes using the same key press 
            // (though UI usually separates them, hotkey collision is possible)
            this.deletePlates(this.getSelectedPlateIds());
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
                geometryStages: p.geometryStages ? p.geometryStages.map(s => ({
                    ...s,
                    features: s.features.map(applyUpdates)
                })) : p.geometryStages
            };
        });

        // Re-calculate the current state of plates at current time to reflect changes
        this.simulation?.setTime(this.state.world.currentTime);
        this.updatePropertiesPanel();
        this.canvasManager?.render();
    }

    private createEntityGroup(): void {
        const selectedEntityIds = this.getSelectedEntityIds();
        this.showModal({
            title: 'Create Entity Group',
            content: '<label class="property-label" for="entity-group-name-input">Group name</label><input id="entity-group-name-input" class="property-input" maxlength="80" placeholder="e.g. Northern Islands" style="width:100%; margin-top:6px;">',
            buttons: [
                {
                    text: 'Create Group',
                    subtext: selectedEntityIds.length ? `${selectedEntityIds.length} selected ${selectedEntityIds.length === 1 ? 'entity' : 'entities'} will be added automatically.` : 'You can drag entities into it afterwards.',
                    onClick: () => {
                        const name = (document.getElementById('entity-group-name-input') as HTMLInputElement | null)?.value.trim();
                        if (!name) { this.showToast('Enter a group name'); return false; }
                        if (this.state.world.entityGroups.some(group => group.name.toLowerCase() === name.toLowerCase())) {
                            this.showToast('A group with that name already exists');
                            return false;
                        }
                        this.pushState();
                        const id = generateId();
                        this.state.world.entityGroups = [...this.state.world.entityGroups, { id, name, collapsed: false }];
                        if (selectedEntityIds.length) {
                            const selectedIds = new Set(selectedEntityIds);
                            this.state.world.plates = this.state.world.plates.map(plate =>
                                selectedIds.has(plate.id) ? { ...plate, groupId: id } : plate
                            );
                            this.state.world.labels = this.state.world.labels.map(label =>
                                selectedIds.has(label.id) ? { ...label, groupId: id } : label
                            );
                        }
                        this.updateExplorer();
                        this.updatePropertiesPanel();
                    }
                },
                { text: 'Cancel', isSecondary: true, onClick: () => undefined }
            ]
        });
        window.setTimeout(() => (document.getElementById('entity-group-name-input') as HTMLInputElement | null)?.focus(), 0);
    }

    private assignEntitiesToGroup(entityIds: string[], groupId: string | null): void {
        const ids = new Set(entityIds);
        const hasChange = this.state.world.plates.some(plate => ids.has(plate.id) && (plate.groupId ?? null) !== groupId)
            || this.state.world.labels.some(label => ids.has(label.id) && (label.groupId ?? null) !== groupId);
        if (!hasChange) return;
        this.pushState();
        this.state.world.plates = this.state.world.plates.map(candidate =>
            ids.has(candidate.id) ? { ...candidate, groupId: groupId ?? undefined } : candidate
        );
        this.state.world.labels = this.state.world.labels.map(candidate =>
            ids.has(candidate.id) ? { ...candidate, groupId: groupId ?? undefined } : candidate
        );
        this.updateExplorer();
        this.updatePropertiesPanel();
    }

    private renameEntityGroup(groupId: string): void {
        const group = this.state.world.entityGroups.find(candidate => candidate.id === groupId);
        if (!group) return;
        this.showModal({
            title: 'Rename Entity Group',
            content: `<label class="property-label" for="entity-group-name-input">Group name</label><input id="entity-group-name-input" class="property-input" maxlength="80" value="${escapeHtml(group.name)}" style="width:100%; margin-top:6px;">`,
            buttons: [
                {
                    text: 'Rename Group',
                    onClick: () => {
                        const name = (document.getElementById('entity-group-name-input') as HTMLInputElement | null)?.value.trim();
                        if (!name) { this.showToast('Enter a group name'); return false; }
                        if (name === group.name) return;
                        this.pushState();
                        this.state.world.entityGroups = this.state.world.entityGroups.map(candidate =>
                            candidate.id === groupId ? { ...candidate, name } : candidate
                        );
                        this.updateExplorer();
                    }
                },
                { text: 'Cancel', isSecondary: true, onClick: () => undefined }
            ]
        });
        window.setTimeout(() => {
            const input = document.getElementById('entity-group-name-input') as HTMLInputElement | null;
            input?.focus();
            input?.select();
        }, 0);
    }

    private removeEntityGroup(groupId: string): void {
        this.pushState();
        this.state.world.entityGroups = this.state.world.entityGroups.filter(group => group.id !== groupId);
        this.state.world.plates = this.state.world.plates.map(plate =>
            plate.groupId === groupId ? { ...plate, groupId: undefined } : plate
        );
        this.state.world.labels = this.state.world.labels.map(label =>
            label.groupId === groupId ? { ...label, groupId: undefined } : label
        );
        this.updateExplorer();
        this.updatePropertiesPanel();
    }

    private toggleEntityGroupCollapsed(groupId: string): void {
        this.state.world.entityGroups = this.state.world.entityGroups.map(group =>
            group.id === groupId ? { ...group, collapsed: !group.collapsed } : group
        );
        this.updateExplorer();
    }

    private toggleEntityGroupVisibility(groupId: string): void {
        const members = [...this.state.world.plates, ...this.state.world.labels].filter(entity => entity.groupId === groupId);
        if (!members.length) return;
        const visible = !members.some(plate => plate.visible);
        this.pushState();
        this.state.world.plates = this.state.world.plates.map(plate =>
            plate.groupId === groupId ? { ...plate, visible } : plate
        );
        this.state.world.labels = this.state.world.labels.map(label =>
            label.groupId === groupId ? { ...label, visible } : label
        );
        this.updateExplorer();
        this.canvasManager?.render();
    }

    private toggleEntityGroupLocked(groupId: string): void {
        const members = [...this.state.world.plates, ...this.state.world.labels].filter(entity => entity.groupId === groupId);
        if (!members.length) return;
        const locked = !members.every(plate => plate.locked);
        this.pushState();
        this.state.world.plates = this.state.world.plates.map(plate =>
            plate.groupId === groupId ? { ...plate, locked } : plate
        );
        this.state.world.labels = this.state.world.labels.map(label =>
            label.groupId === groupId ? { ...label, locked } : label
        );
        this.updateExplorer();
        this.updatePropertiesPanel();
    }

    private recolorEntityGroup(groupId: string): void {
        const members = [...this.state.world.plates, ...this.state.world.labels].filter(entity => entity.groupId === groupId);
        if (!members.length) return;
        this.showModal({
            title: 'Recolor Group Entities',
            content: `<label class="property-label" for="entity-group-color-input">Color applied to all ${members.length} entities</label><input id="entity-group-color-input" type="color" value="${members[0].color}" style="width:100%; height:42px; margin-top:6px;">`,
            buttons: [
                {
                    text: `Apply to ${members.length} entities`,
                    onClick: () => {
                        const color = (document.getElementById('entity-group-color-input') as HTMLInputElement | null)?.value;
                        if (!color) return false;
                        this.pushState();
                        this.state.world.plates = this.state.world.plates.map(plate =>
                            plate.groupId === groupId ? { ...plate, color } : plate
                        );
                        this.state.world.labels = this.state.world.labels.map(label =>
                            label.groupId === groupId ? { ...label, color } : label
                        );
                        this.updateExplorer();
                        this.canvasManager?.render();
                    }
                },
                { text: 'Cancel', isSecondary: true, onClick: () => undefined }
            ]
        });
    }

    private deleteEntityGroupMembers(groupId: string): void {
        const group = this.state.world.entityGroups.find(candidate => candidate.id === groupId);
        const ids = this.state.world.plates.filter(plate => plate.groupId === groupId).map(plate => plate.id);
        const labelIds = this.state.world.labels.filter(label => label.groupId === groupId).map(label => label.id);
        const total = ids.length + labelIds.length;
        if (!group || !total) return;
        this.showModal({
            title: 'Delete Group Entities',
            content: `Delete all <strong>${total}</strong> entities in <strong>${escapeHtml(group.name)}</strong>? This changes the map and can be undone.`,
            buttons: [
                {
                    text: `Delete ${total} entities`,
                    onClick: () => {
                        this.pushState();
                        this.state.world.entityGroups = this.state.world.entityGroups.filter(candidate => candidate.id !== groupId);
                        this.state.world.labels = this.state.world.labels.filter(label => !labelIds.includes(label.id));
                        if (labelIds.includes(this.state.world.selectedLabelId ?? '')) this.state.world.selectedLabelId = null;
                        this.deletePlates(ids);
                    }
                },
                { text: 'Cancel', isSecondary: true, onClick: () => undefined }
            ]
        });
    }

    private getSelectedPlateIds(): string[] {
        const primaryId = this.state.world.selectedPlateId;
        if (!primaryId) return [];
        const selectedIds = this.state.world.selectedPlateIds ?? [];
        return selectedIds.includes(primaryId) ? selectedIds : [primaryId];
    }

    private getSelectedEntityIds(): string[] {
        const plateIds = this.getSelectedPlateIds();
        if (plateIds.length) return plateIds;
        return this.state.world.selectedLabelId ? [this.state.world.selectedLabelId] : [];
    }

    private selectExplorerPlateRange(targetId: string): void {
        const orderedIds = Array.from(document.querySelectorAll<HTMLElement>('#plate-list .plate-item'))
            .map(item => item.dataset.plateId)
            .filter((id): id is string => !!id);
        const anchorId = this.explorerSelectionAnchorId ?? this.state.world.selectedPlateId;
        const selectedIds = selectExplorerRange(orderedIds, anchorId, targetId);
        this.state.world.selectedPlateId = targetId;
        this.state.world.selectedPlateIds = selectedIds;
        this.state.world.selectedFeatureId = null;
        this.state.world.selectedFeatureIds = [];
        this.state.world.selectedLabelId = null;
        this.updateHint(`Selected ${selectedIds.length} entities.`);
        this.updateUI();
        this.canvasManager?.render();
        const plate = this.state.world.plates.find(candidate => candidate.id === targetId) ?? null;
        this.timelineSystem?.render(plate);
    }

    private setEntityGroupOpacity(groupId: string, opacity: number): void {
        const boundedOpacity = Math.min(1, Math.max(0, opacity));
        this.state.world.entityGroups = this.state.world.entityGroups.map(group =>
            group.id === groupId ? { ...group, opacity: boundedOpacity } : group
        );
        this.canvasManager?.render();
    }

    private renderExplorerPlateRows(container: HTMLElement, plates: TectonicPlate[]): void {
        const selectedIds = new Set(this.getSelectedPlateIds());
        container.innerHTML = plates.map(plate => `
            <div class="plate-item ${selectedIds.has(plate.id) ? 'selected' : ''}"
                 draggable="true" data-plate-id="${plate.id}" title="Shift-click to select a range; drag to another group">
              <span class="plate-color" style="background: ${plate.color}"></span>
              <button type="button" class="plate-name plate-select" data-entity-id="${escapeHtml(plate.id)}" aria-label="Select ${escapeHtml(plate.name)}">${escapeHtml(plate.name)}<span class="entity-short-id">${escapeHtml(plate.id.slice(-6))}</span></button>
              <button class="plate-visibility" data-visible="${plate.visible}" title="Toggle visibility">
                ${uiIcon(plate.visible ? 'eye' : 'eye-off')}
              </button>
            </div>
        `).join('');
        container.querySelectorAll<HTMLElement>('.plate-item').forEach(item => {
            item.addEventListener('click', event => {
                if ((event.target as HTMLElement).closest('.plate-visibility')) return;
                const plateId = item.dataset.plateId;
                if (!plateId) return;
                if (event.shiftKey) this.selectExplorerPlateRange(plateId);
                else this.handleSelect(plateId, null);
            });
            item.addEventListener('dragstart', event => {
                if (!item.dataset.plateId) return;
                event.dataTransfer?.setData('application/x-tectolite-plate', item.dataset.plateId);
                const draggedIds = selectedIds.has(item.dataset.plateId)
                    ? this.getSelectedPlateIds()
                    : [item.dataset.plateId];
                event.dataTransfer?.setData('application/x-tectolite-plates', JSON.stringify(draggedIds));
                if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
            });
        });
        container.querySelectorAll<HTMLElement>('.plate-visibility').forEach(button => {
            button.addEventListener('click', event => {
                event.stopPropagation();
                const plateId = button.closest<HTMLElement>('.plate-item')?.dataset.plateId;
                if (plateId) this.togglePlateVisibility(plateId);
            });
        });
    }

    private renderExplorerLabelRows(container: HTMLElement, labels: MapLabel[]): void {
        const wrapper = document.createElement('div');
        wrapper.innerHTML = labels.map(label => `
            <div class="plate-item ${this.state.world.selectedLabelId === label.id ? 'selected' : ''}" draggable="true" data-label-id="${label.id}" title="Label; drag to another group">
              <span class="plate-color" style="background:${label.color}"></span>
              <button type="button" class="plate-name plate-select" data-entity-id="${escapeHtml(label.id)}" aria-label="Select ${escapeHtml(label.title)}">${uiIcon('flag')} ${escapeHtml(label.title)}</button>
              <button class="plate-visibility" data-visible="${label.visible}" title="Toggle visibility">${uiIcon(label.visible ? 'eye' : 'eye-off')}</button>
            </div>
        `).join('');
        wrapper.querySelectorAll<HTMLElement>('[data-label-id]').forEach(item => {
            item.addEventListener('click', event => {
                if ((event.target as HTMLElement).closest('.plate-visibility')) return;
                if (item.dataset.labelId) this.handleLabelSelect(item.dataset.labelId, false);
            });
            item.addEventListener('dragstart', event => {
                if (!item.dataset.labelId) return;
                event.dataTransfer?.setData('application/x-tectolite-entities', JSON.stringify([item.dataset.labelId]));
                if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
            });
        });
        wrapper.querySelectorAll<HTMLElement>('.plate-visibility').forEach(button => {
            button.addEventListener('click', event => {
                event.stopPropagation();
                const labelId = button.closest<HTMLElement>('[data-label-id]')?.dataset.labelId;
                if (!labelId) return;
                this.pushState();
                this.state.world.labels = this.state.world.labels.map(label => label.id === labelId ? { ...label, visible: !label.visible } : label);
                this.updateExplorer();
                this.canvasManager?.render();
            });
        });
        while (wrapper.firstChild) container.appendChild(wrapper.firstChild);
    }

    private renderGroupedExplorer(content: HTMLElement, visiblePlates: TectonicPlate[], visibleLabels: MapLabel[], filterText: string): void {
        const groups = this.state.world.entityGroups ?? [];
        const selectedEntityIds = this.getSelectedEntityIds();
        const selectedIdSet = new Set(selectedEntityIds);
        const selectedEntities = [...this.state.world.plates, ...this.state.world.labels].filter(entity => selectedIdSet.has(entity.id));
        const selectedGroupId = selectedEntities.length > 0 && selectedEntities.every(entity => (entity.groupId ?? null) === (selectedEntities[0].groupId ?? null))
            ? (selectedEntities[0].groupId ?? '')
            : null;
        const toolbar = document.createElement('div');
        toolbar.className = 'entity-group-toolbar';
        toolbar.innerHTML = `
            <button class="entity-group-create" title="Create a group; selected entities are added automatically">+ Group</button>
            <select class="entity-group-assign" title="Move ${selectedEntityIds.length || 'the selected'} ${selectedEntityIds.length === 1 ? 'entity' : 'entities'} to a group" ${selectedEntityIds.length ? '' : 'disabled'}>
                <option value="" ${selectedGroupId === '' ? 'selected' : ''}>Ungrouped</option>
                ${groups.map(group => `<option value="${group.id}" ${selectedGroupId === group.id ? 'selected' : ''}>${escapeHtml(group.name)}</option>`).join('')}
            </select>
        `;
        toolbar.querySelector('.entity-group-create')?.addEventListener('click', () => this.createEntityGroup());
        toolbar.querySelector<HTMLSelectElement>('.entity-group-assign')?.addEventListener('change', event => {
            if (selectedEntityIds.length) this.assignEntitiesToGroup(selectedEntityIds, (event.target as HTMLSelectElement).value || null);
        });
        content.appendChild(toolbar);

        const renderGroup = (groupId: string | null, name: string, collapsed: boolean, editable: boolean) => {
            const allPlateMembers = this.state.world.plates.filter(plate => (plate.groupId ?? null) === groupId);
            const allLabelMembers = this.state.world.labels.filter(label => (label.groupId ?? null) === groupId);
            const allMembers = [...allPlateMembers, ...allLabelMembers];
            const plateMembers = visiblePlates.filter(plate => (plate.groupId ?? null) === groupId);
            const labelMembers = visibleLabels.filter(label => (label.groupId ?? null) === groupId);
            if (filterText && plateMembers.length + labelMembers.length === 0) return;

            const wrapper = document.createElement('div');
            wrapper.className = 'entity-group';
            const header = document.createElement('div');
            header.className = 'entity-group-header';
            header.dataset.groupId = groupId ?? '';
            const allVisible = allMembers.length > 0 && allMembers.every(plate => plate.visible);
            const allLocked = allMembers.length > 0 && allMembers.every(plate => plate.locked);
            const opacity = groupId ? (groups.find(group => group.id === groupId)?.opacity ?? 1) : 1;
            let opacityPopover: HTMLElement | null = null;
            header.innerHTML = `
                <span class="entity-group-chevron">${uiIcon(collapsed && !filterText ? 'chevron-right' : 'chevron-down')}</span>
                <button type="button" class="entity-group-name" aria-expanded="${!collapsed || !!filterText}" title="${escapeHtml(name)}">${escapeHtml(name)}</button>
                <span class="entity-group-count">${filterText ? `${plateMembers.length + labelMembers.length} of ` : ''}${allMembers.length}</span>
                ${editable ? `<span class="entity-group-actions">
                    <button data-action="visibility" title="Show/hide every entity in this group">${uiIcon(allVisible ? 'eye' : 'eye-off')}</button>
                    <button data-action="lock" title="Lock/unlock every entity in this group">${uiIcon(allLocked ? 'lock' : 'unlock')}</button>
                    <button data-action="opacity" title="Group transparency (${Math.round((1 - opacity) * 100)}%)">◐</button>
                    <button data-action="color" title="Set one color for every entity in this group">${uiIcon('palette')}</button>
                    <button data-action="rename" title="Rename group">${uiIcon('edit')}</button>
                    <button data-action="ungroup" title="Delete group but keep its entities">×</button>
                    <button data-action="delete" title="Delete every entity in this group">${uiIcon('trash')}</button>
                </span>` : ''}
            `;
            header.addEventListener('click', event => {
                const action = (event.target as HTMLElement).closest<HTMLButtonElement>('button')?.dataset.action;
                if (action && groupId) {
                    event.stopPropagation();
                    if (action === 'visibility') this.toggleEntityGroupVisibility(groupId);
                    if (action === 'lock') this.toggleEntityGroupLocked(groupId);
                    if (action === 'opacity') {
                        const wasOpen = opacityPopover?.classList.contains('show') ?? false;
                        content.querySelectorAll('.entity-group-opacity-popover.show').forEach(popover => popover.classList.remove('show'));
                        if (!wasOpen) opacityPopover?.classList.add('show');
                    }
                    if (action === 'color') this.recolorEntityGroup(groupId);
                    if (action === 'rename') this.renameEntityGroup(groupId);
                    if (action === 'ungroup') this.removeEntityGroup(groupId);
                    if (action === 'delete') this.deleteEntityGroupMembers(groupId);
                    return;
                }
                if (groupId) this.toggleEntityGroupCollapsed(groupId);
            });
            header.addEventListener('dragover', event => {
                event.preventDefault();
                header.classList.add('drag-over');
            });
            header.addEventListener('dragleave', () => header.classList.remove('drag-over'));
            header.addEventListener('drop', event => {
                event.preventDefault();
                header.classList.remove('drag-over');
                const plateIdsJson = event.dataTransfer?.getData('application/x-tectolite-plates');
                const plateId = event.dataTransfer?.getData('application/x-tectolite-plate');
                const entityIdsJson = event.dataTransfer?.getData('application/x-tectolite-entities');
                let plateIds: string[] = [];
                if (entityIdsJson) {
                    try {
                        const parsed = JSON.parse(entityIdsJson);
                        if (Array.isArray(parsed)) plateIds = parsed.filter((id): id is string => typeof id === 'string');
                    } catch { /* Fall back to older plate drag payloads. */ }
                }
                if (plateIdsJson) {
                    try {
                        const parsed = JSON.parse(plateIdsJson);
                        if (Array.isArray(parsed)) plateIds = parsed.filter((id): id is string => typeof id === 'string');
                    } catch { /* Fall back to the single dragged entity. */ }
                }
                if (!plateIds.length && plateId) plateIds = [plateId];
                if (plateIds.length) this.assignEntitiesToGroup(plateIds, groupId);
            });
            wrapper.appendChild(header);

            if (editable && groupId) {
                opacityPopover = document.createElement('div');
                opacityPopover.className = 'entity-group-opacity-popover';
                opacityPopover.innerHTML = `
                    <label>Transparency <span>${Math.round((1 - opacity) * 100)}%</span></label>
                    <input type="range" min="0" max="100" value="${Math.round((1 - opacity) * 100)}" aria-label="${escapeHtml(name)} transparency">
                `;
                const slider = opacityPopover.querySelector<HTMLInputElement>('input')!;
                const value = opacityPopover.querySelector<HTMLSpanElement>('span')!;
                let changeStarted = false;
                const beginChange = () => {
                    if (changeStarted) return;
                    this.pushState();
                    changeStarted = true;
                };
                slider.addEventListener('pointerdown', beginChange);
                slider.addEventListener('keydown', event => {
                    if (event.key === 'Escape') {
                        opacityPopover?.classList.remove('show');
                        return;
                    }
                    beginChange();
                });
                slider.addEventListener('input', () => {
                    beginChange();
                    value.textContent = `${slider.value}%`;
                    this.setEntityGroupOpacity(groupId, 1 - Number(slider.value) / 100);
                });
                slider.addEventListener('change', () => { changeStarted = false; });
                wrapper.appendChild(opacityPopover);
            }

            if (!collapsed || filterText) {
                const rows = document.createElement('div');
                rows.className = 'entity-group-members';
                if (plateMembers.length) this.renderExplorerPlateRows(rows, plateMembers);
                if (labelMembers.length) this.renderExplorerLabelRows(rows, labelMembers);
                if (!plateMembers.length && !labelMembers.length) rows.innerHTML = '<p class="empty-message">Empty group — drag an entity here</p>';
                wrapper.appendChild(rows);
            }
            content.appendChild(wrapper);
        };

        for (const group of groups) renderGroup(group.id, group.name, !!group.collapsed, true);
        const hasUngrouped = this.state.world.plates.some(plate => !plate.groupId) || this.state.world.labels.some(label => !label.groupId);
        if (hasUngrouped) renderGroup(null, 'Ungrouped', false, false);
        if (visiblePlates.length === 0 && visibleLabels.length === 0 && !groups.some(group => group.name.toLowerCase().includes(filterText))) {
            const empty = document.createElement('p');
            empty.className = 'empty-message';
            empty.textContent = 'No entities or groups match the filter';
            content.appendChild(empty);
        }
    }

    private updateExplorer(): void {
        const list = document.getElementById('plate-list');
        if (!list) return;

        const focusedEntityId = (document.activeElement as HTMLElement | null)?.dataset.entityId;
        // Keep the search input connected: replacing it interrupts typing, paste and IME composition.
        let searchWrap = list.querySelector<HTMLInputElement>('#plate-search')?.parentElement ?? null;
        for (const child of Array.from(list.children)) if (child !== searchWrap) child.remove();
        const filterText = this.explorerFilter.trim().toLowerCase();
        if (this.state.world.plates.length + this.state.world.labels.length > 5 || filterText) {
            if (!searchWrap) {
                searchWrap = document.createElement('div');
                searchWrap.style.cssText = 'padding: 0 0 8px 0;';
                searchWrap.innerHTML = '<input type="search" id="plate-search" class="property-input" aria-label="Filter plates" placeholder="Filter plates…" style="width:100%">';
                list.prepend(searchWrap);
                const input = searchWrap.querySelector('input')!;
                input.addEventListener('input', () => { this.explorerFilter = input.value; this.updateExplorer(); });
            }
            const input = searchWrap.querySelector('input')!;
            if (input.value !== this.explorerFilter) input.value = this.explorerFilter;
        } else { searchWrap?.remove(); }
        const matchingGroups = new Set(this.state.world.entityGroups.filter(group => group.name.toLowerCase().includes(filterText)).map(group => group.id));

        const visiblePlates = filterText
            ? this.state.world.plates.filter(p => p.name.toLowerCase().includes(filterText) || p.id.toLowerCase().includes(filterText) || (p.groupId && matchingGroups.has(p.groupId)))
            : this.state.world.plates;
        const visibleLabels = filterText
            ? this.state.world.labels.filter(label => label.title.toLowerCase().includes(filterText) || label.content.toLowerCase().includes(filterText) || (label.groupId && matchingGroups.has(label.groupId)))
            : this.state.world.labels;

        const selectedOutsideFilter = filterText && this.getSelectedEntityIds().some(id => ![...visiblePlates, ...visibleLabels].some(entity => entity.id === id));
        if (selectedOutsideFilter) {
            const notice = document.createElement('p');
            notice.className = 'explorer-filter-notice';
            notice.textContent = 'Selected entity is outside this filter. ';
            const clear = document.createElement('button');
            clear.className = 'btn btn-secondary'; clear.textContent = 'Clear filter';
            clear.addEventListener('click', () => { this.explorerFilter = ''; this.updateExplorer(); });
            notice.appendChild(clear); list.appendChild(notice);
        }
        if (filterText && !visiblePlates.length && !visibleLabels.length) {
            const empty = document.createElement('p'); empty.className = 'empty-message';
            empty.textContent = 'No entities match this filter.'; list.appendChild(empty);
        }
        // --- 1. ENTITIES / GROUPS SECTION ---
        const platesSection = this.createExplorerSection('Entities', 'plates', filterText ? `${visiblePlates.length + visibleLabels.length} of ${this.state.world.plates.length + this.state.world.labels.length}` : visiblePlates.length + visibleLabels.length);
        list.appendChild(platesSection.header);

        if (this.explorerState.sections['plates']) {
            const content = platesSection.content;
            if (this.state.world.plates.length === 0 && this.state.world.labels.length === 0) {
                content.innerHTML = '<p class="empty-message">Draw a landmass or place a label to create an entity</p>';
            } else {
                this.renderGroupedExplorer(content, visiblePlates, visibleLabels, filterText);
            }
            list.appendChild(content);
        }

        // --- 2. ACTIONS SECTION (Previously Events) ---
        // Aggregate all plate events + user actions
        const allEvents: { time: number, desc: string, plateName: string, plateId: string, type: string }[] = [];

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

            // Plate edits: geometry stages after birth (keyframe-less model)
            p.geometryStages?.slice(1).forEach(stage => {
                addAction(stage.time, 'Plate Edited', p, 'plate_edit');
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
                wrapper.style.fontSize = '12px';

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

        prepareExplorerKeyboard(list, focusedEntityId);
    }


    private createExplorerSection(title: string, key: string, count: number | string): { header: HTMLElement, content: HTMLElement } {
        const header = document.createElement('button');
        header.type = 'button';
        header.className = 'explorer-header';
        header.style.marginBottom = '2px';
        const isOpen = this.explorerState.sections[key];
        header.setAttribute('aria-expanded', String(isOpen));
        header.innerHTML = `<span>${title} (${count})</span> <span>${uiIcon(isOpen ? 'chevron-down' : 'chevron-right')}</span>`;
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
        this.pushState();
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


    private updateMotionLinks(): void {
        const container = document.getElementById('plate-motion-links');
        const plate = this.state.world.plates.find(candidate => candidate.id === this.state.world.selectedPlateId);
        if (!container || !plate) return;
        const html = renderMotionLinks(plate, this.state.world.plates, this.state.world.currentTime);
        // Keep keyboard focus and follower-list scroll position during playback.
        if (container.dataset.markup === html) return;
        const scrollTop = container.querySelector('.motion-link-followers')?.scrollTop ?? 0;
        container.innerHTML = html;
        container.dataset.markup = html;
        const followers = container.querySelector('.motion-link-followers');
        if (followers) followers.scrollTop = scrollTop;
    }

    private updatePropertiesPanel(): void {
        this.renderPropertiesPanel();
        const panel = document.getElementById('properties-panel');
        if (panel) prepareFields(panel);
    }

    private renderPropertiesPanel(): void {
        const content = document.getElementById('properties-content');
        if (!content) return;
        const panel = document.getElementById('properties-panel');
        const timelinePanel = document.getElementById('timeline-panel');
        const titleEl = document.getElementById('properties-panel-title');
        if (panel) {
            panel.style.display = 'flex';
            panel.style.flexDirection = 'column';
            panel.style.flex = '2';
        }
        if (timelinePanel) timelinePanel.style.flex = '1';

        const selectedLabel = this.state.world.labels.find(label => label.id === this.state.world.selectedLabelId);
        this.dockController?.syncInspectorSelection(Boolean(
            selectedLabel
            || this.state.world.selectedPlateId
            || this.state.world.selectedEdge
            || this.state.world.selectedFeatureId
            || this.state.world.selectedFeatureIds.length
        ), this.state.world.selectedPlateId ?? this.state.world.selectedLabelId ?? this.state.world.selectedFeatureId ?? undefined);
        if (selectedLabel) {
            if (titleEl) titleEl.textContent = 'Label Properties';
            const plateOptions = this.state.world.plates.map(plate =>
                `<option value="${plate.id}" ${selectedLabel.attachedPlateId === plate.id ? 'selected' : ''}>${escapeHtml(plate.name)}</option>`
            ).join('');
            const groupOptions = this.state.world.entityGroups.map(group =>
                `<option value="${group.id}" ${selectedLabel.groupId === group.id ? 'selected' : ''}>${escapeHtml(group.name)}</option>`
            ).join('');
            content.innerHTML = `
                <div class="property-group"><label class="property-label">Title</label><input id="prop-label-title" class="property-input" maxlength="120" value="${escapeHtml(selectedLabel.title)}"></div>
                <div class="property-group"><label class="property-label">Content</label><textarea id="prop-label-content" class="property-input" rows="6" maxlength="2000">${escapeHtml(selectedLabel.content)}</textarea></div>
                <div class="property-group"><label class="property-label">System State</label><div style="display:flex; gap:10px;">
                    <label style="font-size: 12px;"><input type="checkbox" id="prop-label-visible" ${selectedLabel.visible ? 'checked' : ''}> Visible</label>
                    <label style="font-size: 12px;"><input type="checkbox" id="prop-label-locked" ${selectedLabel.locked ? 'checked' : ''}> Locked</label>
                    <label style="font-size: 12px;"><input type="checkbox" id="prop-label-expanded" ${selectedLabel.expanded ? 'checked' : ''}> Content pinned</label>
                </div></div>
                <div class="property-group"><label class="property-label">Color</label><input id="prop-label-color" type="color" value="${selectedLabel.color}" style="width:100%; height:36px;"></div>
                <div class="property-group"><label class="property-label">Moves with</label><select id="prop-label-attachment" class="property-input">
                    <option value="" ${selectedLabel.attachedPlateId ? '' : 'selected'}>Nothing (fixed)</option>${plateOptions}
                </select></div>
                <div class="property-group"><label class="property-label">Explorer Group</label><select id="prop-label-group" class="property-input">
                    <option value="" ${selectedLabel.groupId ? '' : 'selected'}>Ungrouped</option>${groupOptions}
                </select></div>
                <div class="property-group"><label class="property-label">Flag offset (pixels)</label><div style="display:flex; gap:6px;">
                    <input id="prop-label-offset-x" type="number" class="property-input" value="${selectedLabel.offset[0]}" title="Horizontal offset">
                    <input id="prop-label-offset-y" type="number" class="property-input" value="${selectedLabel.offset[1]}" title="Vertical offset">
                </div></div>
                <button id="btn-delete-label" class="btn btn-danger">Delete Label</button>
            `;
            let labelColorEdit = false;
            const update = (changes: Partial<MapLabel>, refreshExplorer = false, record = true) => {
                if (record) this.pushState();
                this.state.world.labels = this.state.world.labels.map(label => label.id === selectedLabel.id ? { ...label, ...changes } : label);
                if (refreshExplorer) this.updateExplorer();
                this.canvasManager?.render();
            };
            document.getElementById('prop-label-title')?.addEventListener('change', event => update({ title: (event.target as HTMLInputElement).value.trim() || 'Untitled label' }, true));
            document.getElementById('prop-label-content')?.addEventListener('change', event => update({ content: (event.target as HTMLTextAreaElement).value }));
            document.getElementById('prop-label-visible')?.addEventListener('change', event => update({ visible: (event.target as HTMLInputElement).checked }, true));
            document.getElementById('prop-label-locked')?.addEventListener('change', event => update({ locked: (event.target as HTMLInputElement).checked }, true));
            document.getElementById('prop-label-expanded')?.addEventListener('change', event => update({ expanded: (event.target as HTMLInputElement).checked }));
            const labelColor = document.getElementById('prop-label-color');
            const applyLabelColor = (event: Event) => {
                update({ color: (event.target as HTMLInputElement).value }, true, !labelColorEdit);
                labelColorEdit = true;
            };
            labelColor?.addEventListener('input', applyLabelColor);
            labelColor?.addEventListener('change', event => { applyLabelColor(event); labelColorEdit = false; });
            document.getElementById('prop-label-group')?.addEventListener('change', event => update({ groupId: (event.target as HTMLSelectElement).value || undefined }, true));
            document.getElementById('prop-label-attachment')?.addEventListener('change', event => {
                let currentAnchor = selectedLabel.anchor;
                if (selectedLabel.attachedPlateId) {
                    const oldPlate = this.state.world.plates.find(plate => plate.id === selectedLabel.attachedPlateId);
                    if (oldPlate) currentAnchor = pointPositionAt(oldPlate, this.state.world.plates, selectedLabel.anchor, selectedLabel.anchorTime, this.state.world.currentTime);
                }
                update({ attachedPlateId: (event.target as HTMLSelectElement).value || undefined, anchor: currentAnchor, anchorTime: this.state.world.currentTime });
            });
            const updateOffset = () => {
                const x = Number((document.getElementById('prop-label-offset-x') as HTMLInputElement).value);
                const y = Number((document.getElementById('prop-label-offset-y') as HTMLInputElement).value);
                if (Number.isFinite(x) && Number.isFinite(y)) update({ offset: [x, y] });
            };
            document.getElementById('prop-label-offset-x')?.addEventListener('change', updateOffset);
            document.getElementById('prop-label-offset-y')?.addEventListener('change', updateOffset);
            document.getElementById('btn-delete-label')?.addEventListener('click', () => {
                this.pushState();
                this.state.world.labels = this.state.world.labels.filter(label => label.id !== selectedLabel.id);
                this.state.world.selectedLabelId = null;
                this.updateUI();
                this.canvasManager?.render();
            });
            this.updateEdgePropertiesPanel();
            return;
        }





        // Check for Mesh Vertex Selection


        // Check for fixed hotspot selection (no plate, but feature ID set)
        if (!this.state.world.selectedPlateId && this.state.world.selectedFeatureId && this.state.world.mantlePlumes) {
            const plumeId = this.state.world.selectedFeatureId;
            const plume = this.state.world.mantlePlumes.find(p => p.id === plumeId);

            if (plume) {
                if (titleEl) titleEl.textContent = 'Fixed Hotspot';
                content.innerHTML = `
                    <h3 class="panel-section-title">Fixed Hotspot</h3>
                    
                    <div class="property-group">
                        <label class="property-label">ID</label>
                        <span class="property-value">${plume.id.substring(0, 6)}</span>
                    </div>

                    <div class="property-group">
                        <label class="property-label">Position</label>
                        <span class="property-value">[${plume.position[0].toFixed(1)}, ${plume.position[1].toFixed(1)}]</span>
                    </div>

                    <div class="property-group">
                        <span class="property-hint">This marker stays fixed while plates move beneath it. It does not create features automatically.</span>
                    </div>

                    <div class="property-group" style="margin-top:20px;">
                        <button id="btn-delete-plume" class="btn btn-danger" style="width:100%">Delete Hotspot</button>
                    </div>
                `;

                document.getElementById('btn-delete-plume')?.addEventListener('click', () => {
                    this.pushState();
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
        const selectedPlateCount = this.getSelectedPlateIds().length;

        // Update Panel Title
        if (titleEl) {
            if (!plate) titleEl.textContent = 'Properties';
            else if (selectedPlateCount > 1) titleEl.textContent = `Plate Properties (${selectedPlateCount} selected)`;
            else if (plate.type === 'rift') titleEl.textContent = 'Rift Axis';
            else titleEl.textContent = 'Plate Properties';
        }

        if (panel && timelinePanel) {
            if (!plate) {
                timelinePanel.style.flex = '1';
                content.innerHTML = '<p class="empty-message">Select a plate, feature, label, or edge to edit properties.</p>';
            } else {
                timelinePanel.style.flex = '1';
            }
        }

        this.updateEdgePropertiesPanel();

        if (!plate) return;

        const isRift = plate.type === 'rift';

        // Euler Pole UI — read the active pole from the motion segments
        const pole = activeEulerPole(plate, this.state.world.currentTime);
        const description = plate.description || '';

        content.innerHTML = `
      <div class="property-group">
        <label class="property-label">${isRift ? 'Axis Name' : 'Name'}</label>
        <input type="text" id="prop-name" class="property-input" value="${escapeHtml(plate.name)}">
      </div>
      <div id="plate-motion-links"></div>
      <div class="property-group">
        <label class="property-label">ID</label>
        <input type="text" class="property-input" value="${escapeHtml(plate.id)}" readonly style="background: var(--bg-canvas-base); cursor: text;">
      </div>
      
      <div class="property-group">
        <label class="property-label">System State</label>
        <div style="display: flex; gap: 10px; align-items: center; margin-top: 5px;">
           <label style="display: flex; align-items: center; gap: 4px; font-size: 12px; cursor: pointer;">
              <input type="checkbox" id="prop-visible" ${plate.visible ? 'checked' : ''}> Visible
           </label>
           <label style="display: flex; align-items: center; gap: 4px; font-size: 12px; cursor: pointer;">
              <input type="checkbox" id="prop-locked" ${plate.locked ? 'checked' : ''}> Locked 
           </label>
        </div>
      </div>
      <div class="property-group">
        <label class="property-label">Description</label>
        <textarea id="prop-description" class="property-input" rows="3" placeholder="${isRift ? 'Rift description...' : 'Plate description...'}">${escapeHtml(description)}</textarea>
      </div>
      
      <div class="property-group">
        <label class="property-label">Color</label>
        <input type="color" id="prop-color" class="property-color" value="${plate.color}">
        ${isRift ? `<div style="font-size: 12px; line-height: 1.35; color: var(--text-secondary); margin-top: 4px;">${LINE_COLOR_HELP}</div>` : ''}
      </div>
      
      ${isRift ? `
      <div class="property-group">
        <label class="property-label">Line Type</label>
        <select id="prop-line-type" class="property-input">
            <option value="divergent" ${plate.lineType === 'divergent' || !plate.lineType ? 'selected' : ''}>Divergent</option>
            <option value="convergent" ${plate.lineType === 'convergent' ? 'selected' : ''}>Convergent</option>
            <option value="transform" ${plate.lineType === 'transform' ? 'selected' : ''}>Transform</option>
            <option value="generic" ${plate.lineType === 'generic' ? 'selected' : ''}>Generic</option>
        </select>
      </div>
      ` : ''}

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
        <label class="property-label">Polygon Type</label>
        <select id="prop-polygon-type" class="property-input">
            <option value="generic" ${plate.polygonType === 'generic' ? 'selected' : ''}>Generic</option>
            <option value="continental_crust" ${plate.polygonType === 'continental_crust' ? 'selected' : ''}>Continental Crust</option>
            <option value="island" ${plate.polygonType === 'island' ? 'selected' : ''}>Island</option>
            <option value="continental_plate" ${plate.polygonType === 'continental_plate' ? 'selected' : ''}>Continental Plate</option>
            <option value="oceanic_plate" ${plate.polygonType === 'oceanic_plate' ? 'selected' : ''}>Oceanic Plate</option>
            <option value="craton" ${plate.polygonType === 'craton' ? 'selected' : ''}>Craton</option>
        </select>
      </div>
      ` : ''}

      <div class="property-group">
        <label class="property-label">Density (g/cm³)</label>
        <input type="number" id="prop-density" class="property-input" value="${plate.density || (plate.polygonType === 'oceanic_plate' ? 3.0 : 2.7)}" step="0.1">
      </div>
      
      <div class="property-group">
        <label class="property-label">Base Elev. (m)</label>
        <input type="number" id="prop-elevation" class="property-input" value="${plate.elevation || 0}" step="100">
      </div>




      
      <div class="property-group">
        <label class="property-label">Layer (Z-Index) <span class="info-icon" data-tooltip="${LAYER_ORDER_HELP}">(i)</span></label>
        <input type="number" id="prop-z-index" class="property-input" value="${plate.zIndex || 0}" step="1" style="width: 60px;">
      </div>

      <hr class="property-divider">
      <h4 class="property-section-title">Lineage & Links</h4>
      
      ${plate.parentPlateId || plate.generatedBy ? `
      <div class="property-group">
         <label class="property-label">Origins</label>
         <div style="font-size: 12px; color: var(--text-secondary); padding-left: 5px;">
            ${plate.parentPlateId ? `Split from: <b>${escapeHtml(this.state.world.plates.find(p => p.id === plate.parentPlateId)?.name || 'Unknown')}</b><br/>` : ''}
            ${plate.generatedBy ? `Generated by: <b>${escapeHtml(this.state.world.plates.find(p => p.id === plate.generatedBy)?.name || 'Unknown')}</b> at ${plate.age} Ma<br/>` : ''}
         </div>
      </div>
      ` : ''}
      
      ${(() => {
                let linkHtml = '';
                if (plate.linkedToPlateId) {
                    const parent = this.state.world.plates.find(p => p.id === plate.linkedToPlateId);
                    linkHtml += `
                 <div style="margin-bottom: 8px; padding: 6px; background: rgba(0,0,0,0.1); border-radius: 4px;">
                     <div style="font-size: 12px; margin-bottom: 4px;">Leader: <b>${escapeHtml(parent?.name || 'Unknown')}</b></div>
                     <label style="display: flex; align-items: center; gap: 4px; font-size: 12px; cursor: pointer; margin-bottom: 4px;">
                        <input type="checkbox" id="prop-hide-link" ${plate.hideLinkMarker ? 'checked' : ''}> Hide Link Line
                     </label>
                     <div style="display: flex; gap: 4px;">
                        <input type="number" id="prop-link-time" class="property-input" title="Link Time" value="${this.getDisplayTimeValue(plate.linkTime)}" step="5" style="flex:1">
                        <span style="font-size: 12px; align-self:center;">-</span>
                        <input type="number" id="prop-unlink-time" class="property-input" title="Unlink Time" value="${this.getDisplayTimeValue(plate.unlinkTime) ?? ''}" placeholder="Active" step="5" style="flex:1">
                     </div>
                     <div style="font-size: 12px; line-height: 1.35; color: var(--text-secondary); margin-top: 4px;">${LINK_WINDOW_HELP}</div>
                 </div>
              `;
                }

                const childLinks = this.state.world.plates.filter(p => p.linkedToPlateId === plate.id);
                if (childLinks.length > 0) {
                    linkHtml += `
                 <div style="font-size: 12px; margin-bottom: 4px;">Followers:</div>
                 <div style="display: flex; flex-direction: column; gap: 4px;">
              `;
                    childLinks.forEach(child => {
                        linkHtml += `
                     <div style="display: flex; justify-content: space-between; align-items: center; font-size: 12px; padding: 4px; background: rgba(0,0,0,0.1); border-radius: 2px;">
                        <span>${escapeHtml(child.name)}</span>
                        <label style="display: flex; align-items: center; gap: 4px; cursor: pointer;">
                            <input type="checkbox" class="child-link-hide" data-id="${child.id}" ${child.hideLinkMarker ? 'checked' : ''}> Hide
                        </label>
                     </div>
                  `;
                    });
                    linkHtml += `</div>`;
                }
                return linkHtml;
            })()}

      <hr class="property-divider">
      <h4 class="property-section-title" style="display: flex; justify-content: space-between;">Flowlines <span class="info-icon" data-tooltip="Show the path a plate travels over time. Enable trails to configure their duration and fading." style="opacity: ${plate.showFlowlines ? '1' : '0.3'};">${uiIcon('move')}</span></h4>
      
      <div class="property-group">
        <label class="property-label">Enable Trails</label>
        <input type="checkbox" id="prop-flowlines-enable" ${plate.showFlowlines ? 'checked' : ''}>
      </div>
      <div id="flowline-options" class="conditional-property-options" ${plate.showFlowlines ? '' : 'hidden'}>
        <div class="property-group">
          <label class="property-label">Render Above</label>
          <input type="checkbox" id="prop-flowlines-top" ${plate.flowlinesOnTop ? 'checked' : ''}>
        </div>
        <div class="property-group">
          <label class="property-label">Fade Over Time</label>
          <input type="checkbox" id="prop-flowlines-fade" ${plate.flowlinesFade ? 'checked' : ''}>
        </div>
        <div class="property-group">
          <label class="property-label">Duration (Ma)</label>
          <input type="number" id="prop-flowlines-duration" class="property-input" value="${plate.flowlinesDuration || 50}" step="5" min="5" style="width: 60px;">
        </div>
      </div>

      <hr class="property-divider">

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
        <div style="background:var(--bg-elevated); padding:8px; border-radius:4px; font-size: 12px; color:var(--text-secondary);">
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
                    // @ts-expect-error d3's GeoJSON typings don't accept our plain object literal
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
      <div style="font-size: 12px; margin-bottom: 4px; display:flex; gap: 8px; align-items: center;">
          <label style="display:flex; align-items:center; gap:4px; cursor:pointer;" title="Include angular rate in copy/paste">
               <input type="checkbox" id="cb-copy-speed" checked> Speed
          </label>
          <label style="display:flex; align-items:center; gap:4px; cursor:pointer;" title="Include pole location in copy/paste">
               <input type="checkbox" id="cb-copy-pole" checked> Pole/Dir
          </label>
      </div>

      <div class="property-group" style="flex-direction: row; gap: 8px;">
          <button id="btn-copy-momentum" class="btn btn-secondary" style="flex:1" title="Copy speed, direction, and pole">${uiIcon('clipboard')} Copy</button>
          <button id="btn-paste-momentum" class="btn btn-secondary" style="flex:1" title="Paste motion settings" ${this.momentumClipboard ? '' : 'disabled'}>${uiIcon('clipboard')} Paste</button>
      </div>
      
      <button id="btn-delete-plate" class="btn btn-danger">Delete Plate</button>
      ${this.getFeaturePropertiesHtml(plate)}
    `;

        const motionLinks = document.getElementById('plate-motion-links');
        if (motionLinks) {
            this.updateMotionLinks();
            bindMotionLinks(motionLinks, {
                selectPlate: id => {
                    if (!this.state.world.plates.some(candidate => candidate.id === id)) return;
                    this.setActiveTool('select');
                    this.handleSelect(id, null);
                },
                unlinkPlate: id => this.confirmUnlinkPlate(id),
                followPlate: () => this.beginFollowPlate(plate.id)
            });
        }

        // Bind events
        document.getElementById('prop-name')?.addEventListener('change', (e) => {
            this.pushState();
            plate.name = (e.target as HTMLInputElement).value;
            this.updateExplorer();
            this.updateMotionLinks();
        });

        document.getElementById('prop-visible')?.addEventListener('change', (e) => {
            this.pushState();
            plate.visible = (e.target as HTMLInputElement).checked;
            this.updateExplorer();
            this.canvasManager?.render();
        });

        document.getElementById('prop-locked')?.addEventListener('change', (e) => {
            this.pushState();
            plate.locked = (e.target as HTMLInputElement).checked;
            this.updateExplorer(); // Could potentially show a lock icon here later
        });

        document.getElementById('prop-description')?.addEventListener('change', (e) => {
            this.pushState();
            plate.description = (e.target as HTMLTextAreaElement).value;
        });



        const propColor = document.getElementById('prop-color') as HTMLInputElement | null;
        let colorEditStarted = false;
        const beginColorEdit = () => { if (!colorEditStarted) { this.pushState(); colorEditStarted = true; } };
        propColor?.addEventListener('change', (e) => {
            beginColorEdit();
            colorEditStarted = false;
            plate.color = (e.target as HTMLInputElement).value;
            // Mark line entities as color-customized so subsequent settings-
            // default changes don't override the user's manual pick.
            if (plate.type === 'rift') plate.lineColorCustomized = true;
            this.updateExplorer();
            this.canvasManager?.render();
        });
        // Live feedback while dragging the color picker swatch.
        propColor?.addEventListener('input', (e) => {
            beginColorEdit();
            plate.color = (e.target as HTMLInputElement).value;
            if (plate.type === 'rift') plate.lineColorCustomized = true;
            this.canvasManager?.render();
        });

        document.getElementById('prop-line-type')?.addEventListener('change', (e) => {
            this.pushState();
            plate.lineType = (e.target as HTMLSelectElement).value as LineType;
            const typeLabel = plate.lineType.charAt(0).toUpperCase() + plate.lineType.slice(1);
            // Auto-update name if it still looks like a default name
            const nameInput = document.getElementById('prop-name') as HTMLInputElement;
            if (nameInput && /^(Divergent|Convergent|Transform|Generic|Rift|Trench|Fault|Suture|Custom) \d+$/.test(plate.name)) {
                const num = plate.name.split(' ').pop();
                plate.name = `${typeLabel} ${num}`;
                nameInput.value = plate.name;
                this.updateExplorer();
            }
            // Sync the color picker to the new line type's current default
            // color from settings. Switching type resets the customized flag
            // so the plate tracks the new type's default until manually set.
            const colorInput = document.getElementById('prop-color') as HTMLInputElement;
            if (colorInput && plate.type === 'rift') {
                const defs = resolveLineTypeDefaults(this.state.world.globalOptions.lineTypeDefaults);
                plate.color = (defs[plate.lineType] || defs.generic).color;
                plate.lineColorCustomized = false;
                colorInput.value = plate.color;
            }
            this.canvasManager?.render();
        });

        document.getElementById('prop-polygon-type')?.addEventListener('change', (e) => {
            this.pushState();
            const val = (e.target as HTMLSelectElement).value as any;
            plate.polygonType = val;

            // Auto-update density defaults
            const densityInput = document.getElementById('prop-density') as HTMLInputElement;
            if (val === 'oceanic_plate') {
                plate.density = 3.0;
                plate.isOceanic = true;
                if (densityInput) densityInput.value = "3.0";
            } else {
                plate.density = 2.7;
                plate.isOceanic = false;
                if (densityInput) densityInput.value = "2.7";
            }
            this.canvasManager?.render();
        });

        document.getElementById('prop-rift-mode')?.addEventListener('change', event => {
            const value = (event.target as HTMLSelectElement).value;
            if (value !== 'default' && value !== 'always' && value !== 'never') return;
            this.pushState();
            plate.riftGenerationMode = value;
            this.simulation?.setTime(this.state.world.currentTime);
            this.canvasManager?.render();
        });

        document.getElementById('prop-density')?.addEventListener('change', (e) => {
            this.pushState();
            const val = parseFloat((e.target as HTMLInputElement).value);
            if (!isNaN(val)) {
                plate.density = val;
            }
        });

        document.getElementById('prop-elevation')?.addEventListener('change', (e) => {
            this.pushState();
            const val = parseFloat((e.target as HTMLInputElement).value);
            if (!isNaN(val)) {
                plate.elevation = val;
            }
        }); document.getElementById('prop-z-index')?.addEventListener('change', (e) => {
            this.pushState();
            const val = parseInt((e.target as HTMLInputElement).value);
            if (!isNaN(val)) {
                plate.zIndex = val;
                this.canvasManager?.render();
            }
        });

        document.getElementById('prop-hide-link')?.addEventListener('change', (e) => {
            this.pushState();
            plate.hideLinkMarker = (e.target as HTMLInputElement).checked;
            this.canvasManager?.render();
        });

        document.getElementById('prop-link-time')?.addEventListener('change', (e) => {
            this.pushState();
            const val = parseFloat((e.target as HTMLInputElement).value);
            if (!isNaN(val)) plate.linkTime = val;
            this.simulation?.setTime(this.state.world.currentTime);
        });

        document.getElementById('prop-unlink-time')?.addEventListener('change', (e) => {
            this.pushState();
            const val = parseFloat((e.target as HTMLInputElement).value);
            plate.unlinkTime = !isNaN(val) ? val : undefined;
            this.simulation?.setTime(this.state.world.currentTime);
        });

        document.querySelectorAll('.child-link-hide').forEach(el => {
            el.addEventListener('change', (e) => {
                const target = e.target as HTMLInputElement;
                const childId = target.getAttribute('data-id');
                if (childId) {
                    const child = this.state.world.plates.find(p => p.id === childId);
                    if (child) {
                        this.pushState();
                        child.hideLinkMarker = target.checked;
                        this.canvasManager?.render();
                    }
                }
            });
        });

        document.getElementById('prop-flowlines-enable')?.addEventListener('change', (e) => {
            this.pushState();
            plate.showFlowlines = (e.target as HTMLInputElement).checked;
            const flowlineOptions = document.getElementById('flowline-options');
            if (flowlineOptions) flowlineOptions.hidden = !plate.showFlowlines;
            this.canvasManager?.render();
        });
        document.getElementById('prop-flowlines-top')?.addEventListener('change', (e) => {
            this.pushState();
            plate.flowlinesOnTop = (e.target as HTMLInputElement).checked;
            this.canvasManager?.render();
        });
        document.getElementById('prop-flowlines-fade')?.addEventListener('change', (e) => {
            this.pushState();
            plate.flowlinesFade = (e.target as HTMLInputElement).checked;
            this.canvasManager?.render();
        });
        document.getElementById('prop-flowlines-duration')?.addEventListener('change', (e) => {
            this.pushState();
            const val = parseInt((e.target as HTMLInputElement).value);
            if (!isNaN(val) && val > 0) {
                plate.flowlinesDuration = val;
                this.canvasManager?.render();
            }
        });

        document.getElementById('prop-birth-time')?.addEventListener('change', (e) => {
            this.pushState();
            const userInput = parseFloat((e.target as HTMLInputElement).value);
            if (!isNaN(userInput)) {
                // Transform user input (positive or negative) to internal time
                plate.birthTime = this.transformInputTime(userInput);
                this.canvasManager?.render();
            }
        });

        document.getElementById('prop-death-time')?.addEventListener('change', (e) => {
            this.pushState();
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
            this.addMotionSegment(plate.id, { ...pole, position: [newLon, pole.position[1]] });
        });
        document.getElementById('prop-pole-lat')?.addEventListener('change', (e) => {
            this.pushState(); // Save state for undo
            const newLat = parseFloat((e.target as HTMLInputElement).value);
            this.addMotionSegment(plate.id, { ...pole, position: [pole.position[0], newLat] });
        });
        document.getElementById('prop-pole-vis')?.addEventListener('change', (e) => {
            this.pushState();
            pole.visible = (e.target as HTMLInputElement).checked;
            this.canvasManager?.render();
        });

        document.getElementById('btn-copy-momentum')?.addEventListener('click', () => {
            const cbSpeed = document.getElementById('cb-copy-speed') as HTMLInputElement;
            const cbPole = document.getElementById('cb-copy-pole') as HTMLInputElement;

            const activePole = activeEulerPole(plate, this.state.world.currentTime);
            this.momentumClipboard = {
                eulerPole: {
                    position: cbPole && cbPole.checked ? [...activePole.position] : undefined,
                    rate: cbSpeed && cbSpeed.checked ? activePole.rate : undefined
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

            const activePole = activeEulerPole(plate, this.state.world.currentTime);
            const newRate = (doPasteSpeed && clip.rate !== undefined) ? clip.rate : activePole.rate;
            const newPos = (doPastePole && clip.position !== undefined) ? clip.position : activePole.position;

            this.pushState(); // Save state for undo
            this.addMotionSegment(plate.id, {
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

    private updateEdgePropertiesPanel(): void {
        const panel = document.getElementById('edge-properties-panel');
        const content = document.getElementById('edge-properties-content');
        if (!panel || !content) return;

        const selectedEdge = this.state.world.selectedEdge;
        if (!selectedEdge) {
            panel.style.display = 'none';
            return;
        }

        const plate = this.state.world.plates.find(p => p.id === selectedEdge.plateId);
        if (!plate) {
            panel.style.display = 'none';
            return;
        }

        const poly = plate.polygons[selectedEdge.polyIndex];
        if (!poly) {
            panel.style.display = 'none';
            return;
        }

        panel.style.display = 'flex';
        panel.style.flexDirection = 'column';

        const meta = poly.edgeMeta?.find(m => m.edgeIndex === selectedEdge.vertexIndex);

        let html = `
            <div class="property-group">
                <label class="property-label">Plate</label>
                <div class="property-value" style="font-size: 12px;">${escapeHtml(plate.name)}</div>
            </div>
            <div class="property-group">
                <label class="property-label">Edge Index</label>
                <div class="property-value" style="font-size: 12px;">${selectedEdge.vertexIndex} / ${poly.points.length}</div>
            </div>
        `;

        if (meta) {
            html += `
                <div class="property-group">
                    <label class="property-label">Edge Type</label>
                    <div class="property-value" style="font-size: 12px; text-transform: capitalize;">${meta.type || 'Generic'}</div>
                </div>
            `;
            if (meta.sourceId) {
                 html += `
                    <div class="property-group">
                        <label class="property-label">Group ID</label>
                        <div class="property-value" style="font-size: 12px; font-family: monospace;">${meta.sourceId.substring(0, 8)}...</div>
                    </div>
                `;
            }

            if (meta.siblings && meta.siblings.length > 0) {
                html += `<div style="margin-top: 10px; font-weight: 600; font-size: 12px; color: var(--text-secondary); text-transform: uppercase;">Siblings</div>`;
                meta.siblings.forEach((sib, i) => {
                     const sibPlate = this.state.world.plates.find(p => p.id === sib.siblingPlateId);
                     const sibName = sibPlate ? sibPlate.name : sib.siblingPlateId.substring(0, 8);
                     html += `
                        <div style="background: var(--bg-tertiary); padding: 6px; margin-top: 4px; border-radius: 4px; border: 1px solid var(--border-default);">
                            <div style="font-size: 12px; display: flex; justify-content: space-between; margin-bottom: 4px;">
                                <span style="font-family: monospace; color: var(--text-secondary);">${sib.groupId.substring(0,8)}...</span>
                                <span style="font-weight: bold; color: ${sib.frozen ? 'var(--accent-warning)' : 'var(--accent-success)'};">${sib.frozen ? 'FROZEN' : 'ACTIVE'}</span>
                            </div>
                            <div style="font-size: 12px; color: var(--text-primary);">
                                Plate: <b>${escapeHtml(sibName)}</b><br/>
                                Edge: ${sib.siblingEdgeIndex}
                            </div>
                            <button class="btn btn-danger btn-delete-sibling" data-meta-index="${meta.edgeIndex}" data-sib-index="${i}" style="width: 100%; margin-top: 6px; padding: 2px; font-size: 12px;">Remove</button>
                        </div>
                     `;
                });
            } else {
                 html += `<div style="margin-top: 8px; font-size: 12px; color: var(--text-secondary);">No sibling assignments.</div>`;
            }
        } else {
             html += `<div style="margin-top: 8px; font-size: 12px; color: var(--text-secondary);">No metadata for this edge.</div>`;
        }

        content.innerHTML = html;

        // Bind delete buttons
        const delBtns = content.querySelectorAll('.btn-delete-sibling');
        delBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const metaIdx = parseInt((e.target as HTMLElement).getAttribute('data-meta-index') || '-1');
                const sibIdx = parseInt((e.target as HTMLElement).getAttribute('data-sib-index') || '-1');
                if (metaIdx >= 0 && sibIdx >= 0) {
                     this.state.world.plates = this.state.world.plates.map(p => {
                         if (p.id !== plate.id) return p;
                         const updatedPolys = [...p.polygons];
                         const targetPoly = { ...updatedPolys[selectedEdge.polyIndex] };
                         if (targetPoly.edgeMeta) {
                             targetPoly.edgeMeta = targetPoly.edgeMeta.map(m => {
                                 if (m.edgeIndex !== metaIdx || !m.siblings) return m;
                                 const updatedSiblings = [...m.siblings];
                                 updatedSiblings.splice(sibIdx, 1);
                                 return { ...m, siblings: updatedSiblings };
                             });
                         }
                         updatedPolys[selectedEdge.polyIndex] = targetPoly;
                         return { ...p, polygons: updatedPolys };
                     });
                     this.updateEdgePropertiesPanel();
                     this.canvasManager?.render();
                }
            });
        });
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
            html += '<h5 style="margin:4px 0; font-size: 12px; color:var(--text-secondary);">Plate Bound</h5>';
            const features = plate.features;
            if (features.length > 0) {
                html += '<div style="max-height:150px; overflow-y:auto; display:flex; flex-direction:column; gap:2px;">';
                features.forEach(f => {
                    const name = f.name || this.getFeatureTypeName(f.type);
                    html += `<div class="feature-list-item" data-id="${f.id}" style="cursor:pointer; padding:4px; background:var(--bg-elevated); border-radius:2px; font-size: 12px; display:flex; justify-content:space-between;">
                        <span>${escapeHtml(name)}</span>
                        <span style="color:var(--text-secondary);">${this.getFeatureTypeName(f.type)}</span>
                    </div>`;
                });
                html += '</div>';
            } else {
                html += '<div style="font-size: 12px; color:var(--text-secondary); padding:4px;">None</div>';
            }

            // Independent fixed hotspots
            const plumes = this.state.world.mantlePlumes || [];
            if (plumes.length > 0) {
                html += '<h5 style="margin:8px 0 4px 0; font-size: 12px; color:var(--text-secondary);">Independent</h5>';
                html += '<div style="max-height:100px; overflow-y:auto; display:flex; flex-direction:column; gap:2px;">';
                plumes.forEach(p => {
                    html += `<div class="plume-list-item" data-id="${p.id}" style="cursor:pointer; padding:4px; background:var(--bg-elevated); border-radius:2px; font-size: 12px; border-left: 2px solid #f97316; display:flex; justify-content:space-between;">
                        <span>Fixed Hotspot</span>
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
        <input type="text" id="feature-name" class="property-input" value="${escapeHtml(displayName)}" placeholder="Feature name...">
      </div>
      <div class="property-group">
        <label class="property-label">Description</label>
        <textarea id="feature-description" class="property-input" rows="2" placeholder="Description...">${escapeHtml(description)}</textarea>
      </div>
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
        this.syncToolOptionControls();
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



    private addMotionSegment(plateId: string, newEulerPole: { position: Coordinate; rate: number; visible?: boolean }): void {
        const currentTime = this.state.world.currentTime;
        const plate = this.state.world.plates.find(p => p.id === plateId);
        if (!plate) return;

        // --- 1. Identify Affected Plates (Current & Children) ---
        // We need to know which plates are downstream of this motion change
        // so we can invalidate their generated crust.
        const descendantIds = motionLinkDescendantIds(this.state.world.plates, plateId);
        const affectedPlateIds = new Set([plateId, ...descendantIds]);

        const plates = this.state.world.plates.map(p => {
            let processedPlate = p;

            // 1. Apply Motion Change if this is the target plate
            if (p.id === plateId) {
                const updated = { ...p };
                // Capture the OLD active pole (the one currently in effect) so we
                // can pin it from birth and preserve historical integrity.
                const oldPole = activeEulerPole(p, currentTime);

                // HISTORICAL INTEGRITY: pin the OLD motion from birth if no earlier
                // segment exists, so the new pole doesn't retroactively rewrite history.
                const segments = [...updated.motionSegments];
                const hasPriorSegment = segments.some(s => s.time < currentTime);
                if (!hasPriorSegment && currentTime > p.birthTime) {
                    segments.push({ time: p.birthTime, eulerPole: oldPole });
                }

                // The new pole for the segment at the current time
                const newPole: EulerPole = {
                    position: newEulerPole.position,
                    rate: newEulerPole.rate,
                    visible: newEulerPole.visible ?? oldPole.visible
                };

                // Replace any segment exactly at the current time, then add the new one
                const filtered = segments.filter(s => Math.abs(s.time - currentTime) > 0.001);
                filtered.push({ time: currentTime, eulerPole: newPole });
                updated.motionSegments = filtered.sort((a, b) => a.time - b.time);

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
            // Skip axis-derived plates — they are ephemeral and re-derived each frame.

            // Check if this plate should be deleted
            const isOceanic = processedPlate.type === 'oceanic';
            const isAxisDerived = !!processedPlate.riftAxisId || !!processedPlate.junctionId;
            // Use >= to include the plate currently being born/active at this exact timestep
            const isFuture = processedPlate.birthTime >= currentTime;

            if (isOceanic && isFuture && !isAxisDerived) {
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
        // Reassigned to the real listener-removal below once the listeners exist;
        // close() only runs from those listeners, so it always sees the real one.
        let cleanup: () => void = () => { };

        const close = () => {
            closeFixedDialog(modal);
            cleanup();
        };

        openFixedDialog(modal, input, close);

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
        this.addMotionSegment(plateId, newEulerPole);

        // Refresh property panel to show updated Euler pole position
        this.updatePropertiesPanel();
        // Force a canvas render to update Euler pole visualization
        this.canvasManager?.render();
    }

    /** Push current state to history (call before meaningful changes) */
    /** Track whether there are edits since the last save/load.
     *  Mirrored to a window global so the Electron main process can read it
     *  in its close-confirmation guard (browsers use beforeunload instead). */
    private setUnsaved(value: boolean): void {
        if (value) this.projectRevision += 1;
        this.hasUnsavedChanges = value;
        window.__TECTOLITE_HAS_UNSAVED__ = value;
    }

    private handleProjectSettingChange(effects: readonly ProjectSettingEffect[]): void {
        this.setUnsaved(true);
        if (effects.includes('hint')) this.updateHint(this.activeToolText);
        if (effects.includes('explorer')) this.updateExplorer();
        if (effects.includes('recalculate')) {
            this.simulation?.setTime(this.state.world.currentTime);
            this.canvasManager?.markDirty();
        } else if (effects.includes('render')) {
            this.canvasManager?.render();
        }
    }

    private pushState(): void {
        this.historyManager.push(this.state);
        this.setUnsaved(true);
        this.updateUndoRedoButtons();
    }

    // --- Camera bookmarks (unlimited, nameable; hotkeys Shift+1..9 / 1..9 cover the first nine) ---

    private currentCameraSnapshot(): { rotate: [number, number, number]; scale: number; offset: [number, number] } {
        return {
            rotate: [...this.state.viewport.rotate] as [number, number, number],
            scale: this.state.viewport.scale,
            offset: [
                this.state.viewport.translate[0] - this.state.viewport.width / 2,
                this.state.viewport.translate[1] - this.state.viewport.height / 2
            ]
        };
    }

    /** Overwrite the camera of the list entry at `index`, or append a new view if it doesn't exist. */
    private saveCameraBookmark(index: number): void {
        const existing = this.cameraBookmarks[index];
        if (existing) {
            this.cameraBookmarks[index] = { ...existing, ...this.currentCameraSnapshot() };
            this.showToast(`"${existing.name}" updated`);
        } else {
            this.saveCameraBookmarkNew();
            return;
        }
        this.setUnsaved(true);
        this.renderCameraViews();
    }

    /** Append the current camera as a new named view (no limit). */
    private saveCameraBookmarkNew(): void {
        const name = `View ${this.cameraBookmarks.length + 1}`;
        this.cameraBookmarks.push({ name, ...this.currentCameraSnapshot() });
        this.setUnsaved(true);
        const idx = this.cameraBookmarks.length;
        const hint = idx <= 9 ? ` (press ${idx} to recall)` : '';
        this.showToast(`"${name}" saved${hint} — click the name to rename`);
        this.renderCameraViews();
    }

    private recallCameraBookmark(index: number): void {
        const bm = this.cameraBookmarks[index];
        if (!bm) {
            this.showToast('No view in that slot — "+ Save Current View" stores one');
            return;
        }
        this.state.viewport.rotate = [...bm.rotate] as [number, number, number];
        this.state.viewport.scale = bm.scale;
        const offset = bm.offset ?? [0, 0];
        this.state.viewport.translate = [
            this.state.viewport.width / 2 + offset[0],
            this.state.viewport.height / 2 + offset[1]
        ];
        this.canvasManager?.render();
    }

    private deleteCameraBookmark(index: number): void {
        this.cameraBookmarks.splice(index, 1);
        this.setUnsaved(true);
        this.renderCameraViews();
    }

    /** Rebuild the Camera Views rows in the View dropdown. */
    private renderCameraViews(): void {
        const container = document.getElementById('camera-views-list');
        if (!container) return;
        container.innerHTML = '';

        if (this.cameraBookmarks.length === 0) {
            container.innerHTML = '<div style="padding: 2px 8px 4px 8px; font-size: 12px; color: var(--text-secondary);">No saved views yet</div>';
            return;
        }

        this.cameraBookmarks.forEach((bm, index) => {
            const row = document.createElement('div');
            row.style.cssText = 'padding: 2px 8px; display: flex; align-items: center; gap: 6px;';

            const hotkey = document.createElement('span');
            hotkey.style.cssText = 'font-size: 12px; color: var(--text-secondary); width: 12px; text-align: right;';
            hotkey.textContent = index < 9 ? String(index + 1) : '';
            hotkey.title = index < 9 ? `Hotkey: ${index + 1} recalls, Shift+${index + 1} updates` : '';

            // Inline-editable name
            const nameInput = document.createElement('input');
            nameInput.type = 'text';
            nameInput.value = bm.name;
            nameInput.title = 'Click to rename';
            nameInput.style.cssText =
                'flex: 1; min-width: 0; font-size: 12px; background: transparent; ' +
                'border: 1px solid transparent; border-radius: 3px; color: var(--text-primary); padding: 1px 4px;';
            nameInput.addEventListener('focus', () => { nameInput.style.borderColor = 'var(--border-default)'; nameInput.select(); });
            nameInput.addEventListener('blur', () => { nameInput.style.borderColor = 'transparent'; });
            nameInput.addEventListener('change', () => {
                bm.name = nameInput.value.trim() || `View ${index + 1}`;
                nameInput.value = bm.name;
                this.setUnsaved(true);
            });
            nameInput.addEventListener('keydown', (ev) => {
                if (ev.key === 'Enter') nameInput.blur();
                ev.stopPropagation(); // keep app hotkeys out of the rename field
            });

            const goBtn = document.createElement('button');
            goBtn.className = 'btn btn-secondary';
            goBtn.style.cssText = 'font-size: 12px; padding: 2px 8px;';
            goBtn.textContent = 'Go';
            goBtn.title = `Jump to "${bm.name}"`;
            goBtn.addEventListener('click', () => this.recallCameraBookmark(index));

            const delBtn = document.createElement('button');
            delBtn.className = 'btn btn-secondary';
            delBtn.style.cssText = 'font-size: 12px; padding: 2px 6px;';
            delBtn.title = `Delete "${bm.name}"`;
            delBtn.innerHTML = uiIcon('x');
            delBtn.addEventListener('click', () => this.deleteCameraBookmark(index));

            row.appendChild(hotkey);
            row.appendChild(nameInput);
            row.appendChild(goBtn);
            row.appendChild(delBtn);
            container.appendChild(row);
        });
    }

    /** Duplicate the selected plate (Ctrl+D): fresh IDs, stripped cross-references,
     *  offset +12° longitude so the copy is visible next to the original. */
    private duplicateSelectedPlate(): void {
        const plateId = this.state.world.selectedPlateId;
        const plate = plateId ? this.state.world.plates.find(p => p.id === plateId) : null;
        if (!plate) {
            this.showToast('Select a plate first');
            return;
        }

        this.pushState();

        // Reuse the import remapper: regenerates all IDs with stable feature-ID
        // correspondence and strips parent/link/sibling refs (the clone is independent)
        const { plates } = remapImportedWorld({ plates: [plate] }, 0);
        const clone = plates[0];

        // Pure longitude shift = rotation about the planet's axis (distortion-free)
        const shiftLon = ([lon, lat]: Coordinate): Coordinate =>
            [lon + 12 > 180 ? lon + 12 - 360 : lon + 12, lat];
        const shiftPolys = (polys: TectonicPlate['polygons']): TectonicPlate['polygons'] =>
            polys.map(p => ({ ...p, points: p.points.map(shiftLon) }));
        const shiftFeature = (f: Feature): Feature => ({
            ...f,
            position: shiftLon(f.position),
            originalPosition: f.originalPosition ? shiftLon(f.originalPosition) : f.originalPosition
        });

        const dup: TectonicPlate = {
            ...clone,
            name: `${plate.name} Copy`,
            groupId: plate.groupId,
            center: shiftLon(clone.center),
            polygons: shiftPolys(clone.polygons),
            initialPolygons: shiftPolys(clone.initialPolygons),
            features: clone.features.map(shiftFeature),
            initialFeatures: clone.initialFeatures.map(shiftFeature),
            // Keyframe-less model: shift stage geometry too; motion segments copy as-is
            motionSegments: clone.motionSegments.map(s => ({ ...s })),
            geometryStages: clone.geometryStages.map(s => ({
                ...s,
                polygons: shiftPolys(s.polygons),
                features: s.features.map(shiftFeature)
            })),
            events: [] // split/fusion history belongs to the original, not the copy
        };

        this.state = {
            ...this.state,
            world: { ...this.state.world, plates: [...this.state.world.plates, dup] }
        };
        this.handleSelect(dup.id, null);
        this.updateExplorer();
        this.updateUI();
        this.canvasManager?.render();
        this.showToast(`Duplicated "${plate.name}"`);
    }

    /** Undo last action */
    private undo(): void {
        const prevState = this.historyManager.undo(this.state);
        if (prevState) {
            this.state = prevState;
            this.setUnsaved(true);
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
            this.setUnsaved(true);
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

    private requestNewProject(): void {
        const hasDocumentContent = this.state.world.plates.length > 0 || this.hasUnsavedChanges;
        this.showModal({
            title: hasDocumentContent ? 'Start a new project?' : 'Choose a starting point',
            content: hasDocumentContent
                ? 'This replaces the current world. Save it first if you want to keep your work.'
                : 'Begin with a blank sphere or a small playable example.',
            buttons: [
                {
                    text: 'Create Blank World',
                    subtext: 'Start from an empty sphere.',
                    onClick: () => this.createNewProject()
                },
                ...PROJECT_TEMPLATES.filter(template => template.id !== 'blank').map(template => ({
                    text: template.name,
                    subtext: template.description,
                    onClick: () => this.createProjectFromTemplate(template)
                })),
                {
                    text: 'Cancel',
                    isSecondary: true,
                    onClick: () => { }
                }
            ]
        });
    }

    private createNewProject(): void {
        this.replaceProject(createDefaultAppState(), [], 'New blank project created', false);
    }

    private async createProjectFromTemplate(template: ProjectTemplate): Promise<void> {
        const nextState = createDefaultAppState();
        nextState.world = await template.createWorld();
        this.replaceProject(nextState, [], `${template.name} template loaded`, true);
    }

    private replaceProject(nextState: AppState, cameraBookmarks: CameraView[], message: string, unsaved: boolean): void {
        this.simulation?.stop();
        this.historyManager.clear();
        this.clearAutosave();

        this.state = nextState;
        this.cameraBookmarks = cameraBookmarks;
        this.fusionFirstPlateId = null;
        this.activeLinkSourceId = null;
        this.fusionSecondPlateId = null;
        this.activeLinkTargetId = null;
        this.momentumClipboard = null;
        this.setUnsaved(unsaved);

        this.renderCameraViews();
        this.updateUndoRedoButtons();
        this.updateUI();
        this.syncUIToState();
        this.timelineSystem?.render(null);
        this.setActiveTool('select');
        this.canvasManager?.markDirty();
        this.simulation?.setTime(this.state.world.currentTime);
        this.showToast(message);
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

        const remainingSelectedIds = this.getSelectedPlateIds().filter(id => !idSet.has(id));
        const selectedPlateId = idSet.has(this.state.world.selectedPlateId || '')
            ? (remainingSelectedIds[0] ?? null)
            : this.state.world.selectedPlateId;
        this.state = {
            ...this.state,
            world: {
                ...this.state.world,
                plates: newPlates,
                selectedPlateId,
                selectedPlateIds: remainingSelectedIds
            }
        };
        this.updateUI();
        this.canvasManager?.render();
    }
}

new TectoLiteApp();
