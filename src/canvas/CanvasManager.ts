import { AppState, Point, FeatureType, Coordinate, EulerPole, InteractionMode, Boundary, TectonicEvent, ToolType } from '../types';
import { ProjectionManager } from './ProjectionManager';
import { geoGraticule, geoArea } from 'd3-geo';
import { toGeoJSON } from '../utils/geoHelpers';
import { MotionGizmo } from './MotionGizmo';
import { latLonToVector, vectorToLatLon, rotateVector, cross, dot, normalize, Vector3, quatFromAxisAngle, quatMultiply, axisAngleFromQuat, Quaternion, calculateSphericalCentroid } from '../utils/sphericalMath';

import { InputTool } from './tools/InputTool';
import { PathInputTool } from './tools/PathInputTool';
import { SelectionTool } from './tools/SelectionTool';
import { PlacementTool } from './tools/PlacementTool';
import { EditTool } from './tools/EditTool';

export class CanvasManager {
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private animationId: number | null = null;
    private projectionManager: ProjectionManager;

    private tools: Map<ToolType | string, InputTool> = new Map();
    private activeInputTool: InputTool | null = null;
    private lastActiveToolType: ToolType | null = null;

    // Tools references for direct access
    private editTool!: EditTool;
    private splitTool!: PathInputTool;
    private drawTool!: PathInputTool;

    // Drag state
    private isDragging = false;
    private lastMousePos: Point = { x: 0, y: 0 };
    // private currentMouseGeo: Coordinate | null = null; // Unused
    private interactionMode: 'pan' | 'modify_velocity' | 'drag_target' | 'none' = 'none';

    // Motion state
    private dragStartGeo: Coordinate | null = null;
    private ghostPlateId: string | null = null;
    private ghostRotation: { plateId: string, axis: Vector3, angle: number } | null = null;
    private isFineTuning = false;
    private ghostSpin = 0;
    // private isSpinning = false; // Unused
    // private lastSpinAngle = 0; // Unused, logic moved to EditTool? No, drawRotationWidget uses ghostSpin.
    // EditTool handles its own spinning state. CanvasManager only handles 'drag_target' spinning.
    private dragBaseQuat: Quaternion | null = null;

    private motionGizmo: MotionGizmo = new MotionGizmo();
    private motionMode: InteractionMode = 'classic';
    // private showLinks: boolean = true; // Unused
    private cachedOverlayImages: Map<string, HTMLImageElement> = new Map();
    private shiftKeyDown = false;

    constructor(
        canvas: HTMLCanvasElement,
        private getState: () => AppState,
        private setState: (updater: (state: AppState) => AppState) => void,
        private onDrawComplete: (points: Coordinate[]) => void,
        private onFeaturePlace: (position: Coordinate, type: FeatureType) => void,
        private onSelect: (plateId: string | null, featureId: string | null, featureIds?: string[], plumeId?: string | null) => void,
        private onSplitApply: (points: Coordinate[]) => void,
        private onSplitPreviewChange: (active: boolean) => void,
        private onMotionChange: (plateId: string, pole: Coordinate, rate: number) => void,
        private onDragTargetRequest?: (plateId: string, axis: Vector3, angleRad: number) => void,
        private onPolyFeatureComplete?: (points: Coordinate[], fillColor: string) => void,
        private onMotionPreviewChange?: (active: boolean) => void,
        private onDrawUpdate?: (count: number) => void,
        private onGizmoUpdate?: (rate: number) => void,
        private onEditPending?: (active: boolean) => void
    ) {
        this.canvas = canvas;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Could not get 2D context');
        this.ctx = ctx;
        this.projectionManager = new ProjectionManager(ctx);

        this.initializeTools();
        this.setupEventListeners();

        const container = canvas.parentElement;
        if (container) new ResizeObserver(() => this.resizeCanvas()).observe(container);
        requestAnimationFrame(() => this.resizeCanvas());
    }

    private initializeTools() {
        this.drawTool = new PathInputTool(
            this.projectionManager,
            (c) => this.onDrawUpdate?.(c),
            (points) => this.onDrawComplete(points),
            () => this.cancelDrawing(),
            3, '#ffffff'
        );
        // Set up snap candidate provider: collects all plate polygon vertices
        this.drawTool.setSnapCandidateProvider(() => this.getAllPlateVertices());
        this.tools.set('draw', this.drawTool);

        this.splitTool = new PathInputTool(
            this.projectionManager,
            (c) => {
                this.onDrawUpdate?.(c);
                if (c >= 1) this.onSplitPreviewChange(true);
            },
            (points) => {
                this.onSplitApply(points);
                this.onSplitPreviewChange(false);
            },
            () => {
                this.onSplitPreviewChange(false);
            },
            2, '#ff4444'
        );
        this.tools.set('split', this.splitTool);

        const polyTool = new PathInputTool(
            this.projectionManager,
            (_c) => { },
            (points) => {
                const colorInput = document.getElementById('poly-feature-color') as HTMLInputElement;
                this.onPolyFeatureComplete?.(points, colorInput?.value || '#ff6b6b');
            },
            () => { },
            3, '#ff6b6b'
        );
        this.tools.set('poly_feature', polyTool);

        const selectionTool = new SelectionTool(
            this.projectionManager,
            (geo, screen, mod) => this.handleSelectionClick(geo, screen, mod),
            (start, end, mod) => this.handleBoxSelection(start, end, mod),
            (_geo, _screen) => { }
        );
        this.tools.set('select', selectionTool);
        this.tools.set('fuse', selectionTool);
        this.tools.set('link', selectionTool);

        const placementTool = new PlacementTool(
            () => this.getState().activeFeatureType,
            (geo, type) => {
                this.onFeaturePlace(geo, type);
            },
            () => { }
        );
        this.tools.set('feature', placementTool);
        this.tools.set('flowline', placementTool);

        this.editTool = new EditTool(
            this.projectionManager,
            () => this.getState(),
            (hasChanges) => { this.render(); this.onEditPending?.(hasChanges); },
            () => { document.getElementById('btn-edit-apply')?.click(); },
            (x, y) => this.findNearestBoundaryElement(x, y),
            () => this.render()
        );
        this.tools.set('edit', this.editTool);

        this.tools.set('pan', {
            onMouseDown: () => { }, onMouseMove: () => { }, onMouseUp: () => { },
            onKeyDown: () => { }, onKeyUp: () => { }, render: () => { }, cancel: () => { }
        });
    }

    private handleSelectionClick(geo: Coordinate | null, screen: Point, mod: { shift: boolean, ctrl: boolean, alt: boolean }) {
        const hit = this.hitTest(screen);
        const state = this.getState();

        if (this.motionMode === 'drag_target' && hit?.plateId && geo) {
            this.startDragTarget(hit.plateId, geo);
            return;
        }

        if (mod.ctrl && hit?.featureId) {
            const currentIds = state.world.selectedFeatureIds || [];
            if (currentIds.includes(hit.featureId)) {
                this.onSelect(hit.plateId ?? state.world.selectedPlateId, null, currentIds.filter(id => id !== hit.featureId));
            } else {
                this.onSelect(hit.plateId ?? state.world.selectedPlateId, null, [...currentIds, hit.featureId]);
            }
        } else if (state.activeTool === 'select' && hit && 'plumeId' in hit && hit.plumeId) {
            this.onSelect(null, null, [], hit.plumeId);
        } else {
            if (hit?.plateId) {
                this.onSelect(hit.plateId, hit.featureId ?? null);
            } else {
                this.onSelect(null, null);
            }
        }
    }

    private handleBoxSelection(start: Point, end: Point, _mod: { shift: boolean }) {
        const state = this.getState();
        const plateId = state.world.selectedPlateId;
        if (!plateId) return;

        const plate = state.world.plates.find(p => p.id === plateId);
        if (!plate) return;

        const x1 = Math.min(start.x, end.x);
        const x2 = Math.max(start.x, end.x);
        const y1 = Math.min(start.y, end.y);
        const y2 = Math.max(start.y, end.y);

        const selectedFeatures: string[] = [];
        for (const feature of plate.features) {
            const proj = this.projectionManager.project(feature.position);
            if (proj && proj[0] >= x1 && proj[0] <= x2 && proj[1] >= y1 && proj[1] <= y2) {
                selectedFeatures.push(feature.id);
            }
        }

        if (selectedFeatures.length > 0) {
            this.onSelect(plateId, null, selectedFeatures);
        }
    }

    private updateActiveTool() {
        const state = this.getState();
        if (state.activeTool !== this.lastActiveToolType) {
            const prevTool = this.activeInputTool;

            // Update state FIRST to prevent recursion if prevTool.cancel() triggers render()
            this.lastActiveToolType = state.activeTool;
            this.activeInputTool = this.tools.get(state.activeTool) || null;

            if (prevTool) prevTool.cancel();

            this.activeInputTool?.activate?.();
            this.cancelMotion();
        }
    }

    public setTheme(_theme: string): void {
        this.render();
    }

    // --- Public Methods for main.ts ---

    public applySplit(): void {
        this.splitTool.forceComplete();
    }

    public cancelSplit(): void {
        this.splitTool.cancel();
    }

    public cancelDrawing(): void {
        this.drawTool.cancel();
    }

    public applyDraw(): void {
        this.drawTool.forceComplete();
    }

    public applyMotion(): void {
        if (this.isFineTuning && this.ghostRotation && this.onDragTargetRequest) {
            const state = this.getState();
            const plate = state.world.plates.find(p => p.id === this.ghostRotation!.plateId);
            if (plate) {
                const vCenter = latLonToVector(plate.center);
                const vRotCenter = rotateVector(vCenter, this.ghostRotation.axis, this.ghostRotation.angle);
                const qDrag = quatFromAxisAngle(this.ghostRotation.axis, this.ghostRotation.angle);
                const spinRad = -this.ghostSpin * Math.PI / 180;
                const qSpin = quatFromAxisAngle(vRotCenter, spinRad);
                const qTotal = quatMultiply(qSpin, qDrag);
                const { axis, angle } = axisAngleFromQuat(qTotal);
                this.onDragTargetRequest(this.ghostRotation.plateId, axis, angle);
            }
        }
        this.cancelMotion();
    }

    public cancelMotion(): void {
        this.isFineTuning = false;
        this.ghostRotation = null;
        this.ghostPlateId = null;
        this.ghostSpin = 0;
        if (this.onMotionPreviewChange) this.onMotionPreviewChange(false);
        this.render();
    }

    public getEditResult() {
        return this.editTool.getTempPolygons();
    }

    public cancelEdit() {
        this.editTool.cancel();
    }

    public setMotionMode(mode: InteractionMode): void {
        this.motionMode = mode;
        this.motionGizmo.setMode(mode);
        this.render();
    }

    /** Switch draw tool between polygon and line modes */
    public setDrawMode(mode: 'polygon' | 'line'): void {
        if (mode === 'line') {
            this.drawTool.configureLineMode();
        } else {
            this.drawTool.configurePolygonMode();
        }
    }

    /** Toggle vertex snapping for the draw tool */
    public setSnappingEnabled(enabled: boolean): void {
        this.drawTool.snappingEnabled = enabled;
    }

    /** Collect all vertices from all visible plate polygons for snapping */
    private getAllPlateVertices(): Coordinate[] {
        const state = this.getState();
        const vertices: Coordinate[] = [];
        const currentTime = state.world.currentTime;
        for (const plate of state.world.plates) {
            if (plate.deathTime !== null && plate.deathTime <= currentTime) continue;
            if (plate.birthTime > currentTime) continue;
            if (!plate.visible) continue;
            for (const poly of plate.polygons) {
                for (const pt of poly.points) {
                    vertices.push(pt);
                }
            }
        }
        return vertices;
    }

    public resizeCanvas(): void {
        const container = this.canvas.parentElement;
        if (!container) return;
        const rect = container.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = rect.width * dpr;
        this.canvas.height = rect.height * dpr;
        this.canvas.style.width = `${rect.width}px`;
        this.canvas.style.height = `${rect.height}px`;
        this.ctx.scale(dpr, dpr);
        this.setState(s => ({
            ...s,
            viewport: {
                ...s.viewport,
                width: rect.width,
                height: rect.height,
                translate: [rect.width / 2, rect.height / 2]
            }
        }));
        this.render();
    }

    public startRenderLoop(): void {
        const loop = () => {
            this.render();
            this.animationId = requestAnimationFrame(loop);
        };
        loop();
    }

    public stopRenderLoop(): void {
        if (this.animationId !== null) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
    }

    public getViewportCenter(): Coordinate | null {
        const rect = this.canvas.getBoundingClientRect();
        return this.projectionManager.invert(rect.width / 2, rect.height / 2);
    }

    public destroy(): void {
        this.stopRenderLoop();
    }

    // --- Interaction ---

    private getGeoFromMouse(e: MouseEvent): Coordinate | null {
        const rect = this.canvas.getBoundingClientRect();
        return this.projectionManager.invert(e.clientX - rect.left, e.clientY - rect.top);
    }

    private getMousePos(e: MouseEvent): Point {
        const rect = this.canvas.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    private handleMouseDown(e: MouseEvent): void {
        const state = this.getState();
        const geo = this.getGeoFromMouse(e);
        const screen = this.getMousePos(e);
        this.lastMousePos = { x: e.clientX, y: e.clientY };

        if (e.button === 1 || (e.button === 0 && state.activeTool === 'pan')) {
            this.isDragging = true;
            this.interactionMode = 'pan';
            this.canvas.style.cursor = 'grabbing';
            return;
        }

        if (this.motionGizmo.isActive() && state.activeTool === 'select') {
            const selectedPlate = state.world.plates.find(p => p.id === state.world.selectedPlateId);
            if (selectedPlate) {
                const handle = this.motionGizmo.hitTest(screen.x, screen.y, this.projectionManager, selectedPlate.center);
                if (handle) {
                    this.motionGizmo.startDrag(handle, screen.x, screen.y);
                    this.isDragging = true;
                    this.interactionMode = 'modify_velocity';
                    this.canvas.style.cursor = 'move';
                    return;
                }
            }
        }

        if (this.activeInputTool) {
            this.activeInputTool.onMouseDown(e, geo, screen);
        }
    }

    private handleMouseMove(e: MouseEvent): void {
        const geo = this.getGeoFromMouse(e);
        const screen = this.getMousePos(e);
        // this.currentMouseGeo = geo; // Unused

        if (this.isDragging) {
            const dx = e.clientX - this.lastMousePos.x;
            const dy = e.clientY - this.lastMousePos.y;
            if (this.interactionMode === 'pan') {
                this.pan(dx, dy);
            } else if (this.interactionMode === 'modify_velocity') {
                const res = this.motionGizmo.updateDrag(screen.x, screen.y, this.projectionManager, this.getState().world.plates.find(p => p.id === this.getState().world.selectedPlateId)?.center || [0, 0]);
                if (res && this.onGizmoUpdate && res.rate !== undefined) this.onGizmoUpdate(res.rate);
            } else if (this.interactionMode === 'drag_target') {
                this.updateDragTarget(e);
            }
        }

        if (this.activeInputTool) {
            this.activeInputTool.onMouseMove(e, geo, screen);
        }
        this.lastMousePos = { x: e.clientX, y: e.clientY };
    }

    private handleMouseUp(e: MouseEvent): void {
        const geo = this.getGeoFromMouse(e);
        const screen = this.getMousePos(e);

        if (this.isDragging) {
            this.isDragging = false;
            if (this.interactionMode === 'modify_velocity') {
                const res = this.motionGizmo.endDrag();
                if (res) this.onMotionChange(this.motionGizmo.getPlateId()!, res.polePosition, res.rate);
            } else if (this.interactionMode === 'drag_target') {
                if (this.ghostRotation) {
                    this.isFineTuning = true;
                    this.ghostSpin = 0;
                    if (this.onMotionPreviewChange) this.onMotionPreviewChange(true);
                }
            }
            this.interactionMode = 'none';
            this.canvas.style.cursor = 'default';
        }

        if (this.activeInputTool) {
            this.activeInputTool.onMouseUp(e, geo, screen);
        }
    }

    private handleDoubleClick(e: MouseEvent) {
        if (this.activeInputTool?.onDoubleClick) this.activeInputTool.onDoubleClick(e, this.getGeoFromMouse(e), this.getMousePos(e));
    }

    private handleKeyDown(e: KeyboardEvent) {
        if (e.key === 'Shift') this.shiftKeyDown = true;
        if (this.activeInputTool) this.activeInputTool.onKeyDown(e);
    }

    private handleKeyUp(e: KeyboardEvent) {
        if (e.key === 'Shift') this.shiftKeyDown = false;
        if (this.activeInputTool) this.activeInputTool.onKeyUp(e);
    }

    private pan(dx: number, dy: number) {
        const state = this.getState();
        const sens = (180 / Math.PI) / (state.viewport.scale || 250);
        let newRotate = [...state.viewport.rotate] as [number, number, number];
        newRotate[0] += dx * sens;
        newRotate[1] -= dy * sens;
        newRotate[1] = Math.max(-90, Math.min(90, newRotate[1]));
        this.setState(s => ({ ...s, viewport: { ...s.viewport, rotate: newRotate } }));
    }

    private updateDragTarget(e: MouseEvent) {
        const geoPos = this.getGeoFromMouse(e);
        if (!geoPos || !this.dragStartGeo || !this.ghostPlateId) return;

        const state = this.getState();
        const p = state.world.plates.find(pl => pl.id === this.ghostPlateId);
        if (!p) return;

        const startMouseVec = latLonToVector(this.dragStartGeo);
        const currMouseVec = latLonToVector(geoPos);

        let axis = cross(startMouseVec, currMouseVec);
        const len = Math.sqrt(axis.x * axis.x + axis.y * axis.y + axis.z * axis.z);

        if (len < 0.001) return;
        axis = normalize(axis);

        let dotVal = dot(startMouseVec, currMouseVec);
        dotVal = Math.max(-1, Math.min(1, dotVal));
        const angleRad = Math.acos(dotVal);

        const qDelta = quatFromAxisAngle(axis, angleRad);
        const qBase = this.dragBaseQuat || { w: 1, x: 0, y: 0, z: 0 };
        const qFinal = quatMultiply(qDelta, qBase);
        const res = axisAngleFromQuat(qFinal);

        this.ghostRotation = { plateId: p.id, axis: res.axis, angle: res.angle };
        this.render();
    }

    private startDragTarget(plateId: string, geo: Coordinate) {
        this.ghostPlateId = plateId;
        this.ghostRotation = { plateId, axis: { x: 0, y: 0, z: 1 }, angle: 0 };
        this.dragStartGeo = geo;
        this.dragBaseQuat = { w: 1, x: 0, y: 0, z: 0 };
        this.isDragging = true;
        this.interactionMode = 'drag_target';
        this.canvas.style.cursor = 'grabbing';
    }

    public render(): void {
        this.updateActiveTool();

        const state = this.getState();
        const width = this.canvas.width / (window.devicePixelRatio || 1);
        const height = this.canvas.height / (window.devicePixelRatio || 1);

        this.projectionManager.update(state.world.projection, state.viewport);
        const path = this.projectionManager.getPathGenerator();

        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        this.ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);

        const computedStyle = getComputedStyle(document.body);
        const clearColor = computedStyle.getPropertyValue('--bg-canvas-clear').trim() || '#1a3a4a';
        this.ctx.fillStyle = clearColor;
        this.ctx.fillRect(0, 0, width, height);

        if (state.world.projection === 'orthographic') {
            this.ctx.beginPath();
            path({ type: 'Sphere' } as any);
            this.ctx.fillStyle = computedStyle.getPropertyValue('--bg-globe-ocean').trim() || '#0f2634';
            this.ctx.fill();
        }

        if (state.world.showGrid && !state.world.globalOptions.gridOnTop) {
            this.drawGraticule(path, computedStyle);
        }

        if (state.world.imageOverlay?.visible && state.world.imageOverlay.mode === 'fixed') {
            this.drawImageOverlay(state);
        }

        this.drawPlates(state, path);
        this.drawEventIcons(state);
        this.drawPlumes(state);

        if (state.world.globalOptions.showLinks !== false || state.activeTool === 'link') {
            this.drawLinks(state, path);
        }

        const selectedPlate = state.world.plates.find(p => p.id === state.world.selectedPlateId);
        if (selectedPlate && state.activeTool === 'select' && selectedPlate.visible) {
            this.motionGizmo.setPlate(selectedPlate.id, selectedPlate.motion.eulerPole);
            this.motionGizmo.render(this.ctx, this.projectionManager, selectedPlate.center, state.world.globalOptions.planetRadius || 6371);
        } else {
            this.motionGizmo.clear();
        }

        if (this.activeInputTool) {
            this.activeInputTool.render(this.ctx, width, height);
        }

        if (state.activeTool === 'edit') {
            this.drawEditHighlights();
        }

        if (this.isFineTuning && this.ghostPlateId) {
            const plate = state.world.plates.find(p => p.id === this.ghostPlateId);
            if (plate && this.ghostRotation) {
                const vCenter = latLonToVector(plate.center);
                const vRotCenter = rotateVector(vCenter, this.ghostRotation.axis, this.ghostRotation.angle);
                this.drawRotationWidget(vectorToLatLon(vRotCenter));
            }
        }

        if (state.world.showGrid && state.world.globalOptions.gridOnTop) {
            this.drawGraticule(path, computedStyle);
        }
    }

    private drawGraticule(path: any, style: CSSStyleDeclaration) {
        const gridColor = style.getPropertyValue('--grid-color').trim() || 'rgba(255, 255, 255, 0.1)';
        this.ctx.strokeStyle = gridColor;
        this.ctx.lineWidth = this.getState().world.globalOptions.gridThickness || 1;
        this.ctx.beginPath();
        path(geoGraticule()());
        this.ctx.stroke();
    }

    private drawPlates(state: AppState, path: any) {
        const sortedPlates = [...state.world.plates].sort((a, b) => {
            let zA = a.zIndex ?? 0;
            let zB = b.zIndex ?? 0;
            if (a.crustType === 'continental') zA += 1;
            if (b.crustType === 'continental') zB += 1;
            return zA - zB;
        });

        for (const plate of sortedPlates) {
            if (!plate.visible) continue;
            if (state.world.currentTime < plate.birthTime) continue;
            if (plate.deathTime !== null && state.world.currentTime >= plate.deathTime) continue;

            const isSelected = plate.id === state.world.selectedPlateId;

            let polygonsToDraw = plate.polygons;
            if (state.activeTool === 'edit' && this.editTool.getTempPolygons()?.plateId === plate.id) {
                polygonsToDraw = this.editTool.getTempPolygons()!.polygons;
            }

            if (this.ghostRotation?.plateId === plate.id) {
                const { axis, angle } = this.ghostRotation;
                const spinRad = -this.ghostSpin * Math.PI / 180;
                const vCenter = latLonToVector(plate.center);
                const vRotCenter = rotateVector(vCenter, axis, angle);

                polygonsToDraw = polygonsToDraw.map(poly => ({
                    ...poly,
                    points: poly.points.map(pt => {
                        const v = latLonToVector(pt);
                        const v1 = rotateVector(v, axis, angle);
                        const v2 = rotateVector(v1, vRotCenter, spinRad);
                        return vectorToLatLon(v2);
                    })
                }));
            }

            for (const poly of polygonsToDraw) {
                const geojson = toGeoJSON(poly);
                if (geoArea(geojson) > 2 * Math.PI) geojson.geometry.coordinates[0].reverse();

                this.ctx.beginPath();
                path(geojson);

                const globalOpacity = state.world.globalOptions.plateOpacity ?? 1.0;
                const oceanicOpacity = plate.type === 'oceanic' ? (state.world.globalOptions.oceanicCrustOpacity ?? 0.5) : 1.0;
                this.ctx.globalAlpha = globalOpacity * oceanicOpacity;
                this.ctx.fillStyle = plate.color;
                if (poly.closed !== false) this.ctx.fill();
                this.ctx.globalAlpha = 1.0;

                this.ctx.strokeStyle = isSelected ? '#ffffff' : 'rgba(0,0,0,0.3)';
                this.ctx.lineWidth = isSelected ? 2 : 1;
                if (plate.type === 'rift') {
                    this.ctx.strokeStyle = isSelected ? '#ff3333' : '#ff0000';
                    this.ctx.lineWidth = isSelected ? 4 : 2;
                }
                this.ctx.stroke();
            }

            const showGlobalPoles = state.world.showEulerPoles;
            const gizmoActive = isSelected && state.activeTool === 'select';
            if (plate.motion.eulerPole.visible || (showGlobalPoles && !gizmoActive)) {
                this.drawEulerPole(plate.motion.eulerPole);
            }
        }

        if (state.world.globalOptions.enableBoundaryVisualization && state.world.boundaries) {
            this.drawBoundaries(state.world.boundaries, path);
        }
    }

    private drawImageOverlay(state: AppState): void {
        const overlay = state.world.imageOverlay;
        if (!overlay || !overlay.imageData) return;

        let img = this.cachedOverlayImages.get(overlay.imageData);
        if (!img) {
            img = new Image();
            img.onload = () => { this.render(); };
            img.src = overlay.imageData;
            this.cachedOverlayImages.set(overlay.imageData, img);
            return;
        }

        if (!img.complete) return;

        this.ctx.save();
        this.ctx.globalAlpha = overlay.opacity;
        const canvasWidth = this.canvas.width;
        const canvasHeight = this.canvas.height;
        const scaledWidth = img.width * overlay.scale;
        const scaledHeight = img.height * overlay.scale;
        const x = (canvasWidth - scaledWidth) / 2 + overlay.offsetX;
        const y = (canvasHeight - scaledHeight) / 2 + overlay.offsetY;

        if (overlay.rotation !== 0) {
            this.ctx.translate(canvasWidth / 2, canvasHeight / 2);
            this.ctx.rotate((overlay.rotation * Math.PI) / 180);
            this.ctx.translate(-canvasWidth / 2, -canvasHeight / 2);
        }

        this.ctx.drawImage(img, x, y, scaledWidth, scaledHeight);
        this.ctx.restore();
    }

    private drawEulerPole(pole: EulerPole): void {
        const proj = this.projectionManager.project(pole.position);
        if (!proj) return;
        this.ctx.save();
        this.ctx.translate(proj[0], proj[1]);
        this.ctx.fillStyle = 'red';
        this.ctx.beginPath();
        this.ctx.arc(0, 0, 5, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.fillStyle = 'white';
        this.ctx.font = '10px Sans-Serif';
        this.ctx.fillText("EP", 8, 4);
        this.ctx.restore();
    }

    private drawBoundaries(boundaries: Boundary[], path: any): void {
        this.ctx.save();
        for (const b of boundaries) {
            if (b.type === 'convergent') {
                this.ctx.strokeStyle = '#ff3333'; this.ctx.lineWidth = 3;
            } else if (b.type === 'divergent') {
                this.ctx.strokeStyle = '#3333ff'; this.ctx.lineWidth = 2;
            } else {
                this.ctx.strokeStyle = '#33ff33'; this.ctx.lineWidth = 2;
            }
            if (b.points.length > 0) {
                const geojson = { type: 'MultiLineString', coordinates: b.points };
                this.ctx.beginPath(); path(geojson as any); this.ctx.stroke();
            }
        }
        this.ctx.restore();
    }

    private drawEventIcons(state: AppState): void {
        if (!state.world.globalOptions.showEventIcons) return;
        const events = state.world.tectonicEvents || [];
        if (events.length === 0) return;
        const currentTime = state.world.currentTime;
        const showFuture = state.world.showFutureFeatures;

        for (const event of events) {
            const isInTimeline = event.time <= currentTime;
            if (!isInTimeline && !showFuture) continue;
            const anchor = this.getEventAnchor(event);
            if (!anchor) continue;
            const proj = this.projectionManager.project(anchor);
            if (!proj) continue;

            const isPending = state.world.pendingEventId === event.id;
            const isCommitted = event.committed;
            const color = event.eventType === 'collision' ? '#ef4444' : '#3b82f6';
            const fill = isCommitted ? color : '#f59e0b';

            this.ctx.save();
            this.ctx.translate(proj[0], proj[1]);
            const radius = isPending ? 9 : 7;
            this.ctx.beginPath();
            this.ctx.arc(0, 0, radius, 0, Math.PI * 2);
            this.ctx.fillStyle = fill;
            this.ctx.fill();
            this.ctx.strokeStyle = isPending ? '#ffffff' : 'rgba(0,0,0,0.6)';
            this.ctx.lineWidth = isPending ? 2 : 1;
            this.ctx.stroke();
            this.ctx.restore();
        }
    }

    private getEventAnchor(event: TectonicEvent): Coordinate | null {
        const points = event.boundarySegment.flat();
        if (points.length === 0) return null;
        let sum = { x: 0, y: 0, z: 0 };
        for (const p of points) { const v = latLonToVector(p); sum.x += v.x; sum.y += v.y; sum.z += v.z; }
        const len = Math.sqrt(sum.x * sum.x + sum.y * sum.y + sum.z * sum.z);
        if (len === 0) return points[0];
        return vectorToLatLon({ x: sum.x / len, y: sum.y / len, z: sum.z / len });
    }

    private drawPlumes(state: AppState) {
        if (state.world.mantlePlumes) {
            for (const plume of state.world.mantlePlumes) {
                const proj = this.projectionManager.project(plume.position);
                if (proj) {
                    const isSelected = plume.id === state.world.selectedFeatureId; // plumeId check
                    this.ctx.save();
                    this.ctx.translate(proj[0], proj[1]);
                    this.ctx.beginPath();
                    this.ctx.arc(0, 0, 8, 0, Math.PI * 2);
                    this.ctx.fillStyle = plume.active ? '#ff00aa' : '#888888';
                    this.ctx.fill();
                    this.ctx.strokeStyle = isSelected ? '#ffffff' : (plume.active ? '#550033' : '#333333');
                    this.ctx.lineWidth = isSelected ? 3 : 2;
                    this.ctx.stroke();
                    this.ctx.restore();
                }
            }
        }
    }

    private drawLinks(state: AppState, path: any): void {
        this.ctx.save();
        this.ctx.strokeStyle = '#00ffcc';
        this.ctx.lineWidth = 2;
        this.ctx.setLineDash([8, 4]);

        for (const plate of state.world.plates) {
            if (plate.linkedToPlateId) {
                const parent = state.world.plates.find(p => p.id === plate.linkedToPlateId);
                if (parent) {
                    this.ctx.beginPath();
                    path({ type: 'LineString', coordinates: [plate.center, parent.center] } as any);
                    this.ctx.stroke();
                }
            }
        }
        this.ctx.restore();
    }

    private drawRotationWidget(center: Coordinate): void {
        const proj = this.projectionManager.project(center);
        if (!proj) return;
        const [cx, cy] = proj;
        const radius = 60;
        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        this.ctx.strokeStyle = '#ffff00';
        this.ctx.lineWidth = 2;
        this.ctx.stroke();
        const handleAngle = (this.ghostSpin - 90) * Math.PI / 180;
        const hx = cx + Math.cos(handleAngle) * radius;
        const hy = cy + Math.sin(handleAngle) * radius;
        this.ctx.beginPath();
        this.ctx.arc(hx, hy, 8, 0, Math.PI * 2);
        // Use isFineTuning or ghostRotation existence to determine highlight
        this.ctx.fillStyle = this.isFineTuning ? '#ffffff' : '#ffff00';
        this.ctx.fill();
        this.ctx.stroke();
        this.ctx.restore();
    }

    private drawEditHighlights() {
        const state = this.getState();
        const plateId = state.world.selectedPlateId;
        if (!plateId || !this.editTool) return;
        const plate = state.world.plates.find(p => p.id === plateId);
        if (!plate) return;

        const polygons = this.editTool.getTempPolygons()?.polygons || plate.polygons;

        this.ctx.fillStyle = '#ffffff';
        this.ctx.strokeStyle = '#000000';
        this.ctx.lineWidth = 1;

        for (const poly of polygons) {
            for (const pt of poly.points) {
                const proj = this.projectionManager.project(pt);
                if (proj) {
                    this.ctx.beginPath();
                    this.ctx.arc(proj[0], proj[1], 3, 0, Math.PI * 2);
                    this.ctx.fill(); this.ctx.stroke();
                }
            }
        }

        const hoveredVertex = this.editTool.getHoveredVertex();
        if (hoveredVertex && hoveredVertex.plateId === plateId) {
            const poly = polygons[hoveredVertex.polyIndex];
            if (poly) {
                const pt = poly.points[hoveredVertex.vertexIndex];
                const proj = this.projectionManager.project(pt);
                if (proj) {
                    this.ctx.beginPath();
                    this.ctx.arc(proj[0], proj[1], 6, 0, Math.PI * 2);
                    this.ctx.fillStyle = '#ff4444';
                    this.ctx.fill(); this.ctx.stroke();
                }
            }
        }

        if (this.shiftKeyDown) {
            let currentCenter = plate.center;
            if (this.editTool.getTempPolygons()?.plateId === plate.id) {
                const all = this.editTool.getTempPolygons()!.polygons.flatMap((p: any) => p.points);
                if (all.length > 0) currentCenter = calculateSphericalCentroid(all);
            }
            this.drawRotationWidget(currentCenter);
        }
    }

    private setupEventListeners(): void {
        this.canvas.addEventListener('mousedown', this.handleMouseDown.bind(this));
        window.addEventListener('mousemove', this.handleMouseMove.bind(this));
        window.addEventListener('mouseup', this.handleMouseUp.bind(this));
        this.canvas.addEventListener('dblclick', this.handleDoubleClick.bind(this));
        window.addEventListener('keydown', this.handleKeyDown.bind(this));
        window.addEventListener('keyup', this.handleKeyUp.bind(this));
        this.canvas.addEventListener('contextmenu', (e) => {
            if (this.activeInputTool instanceof PathInputTool || this.activeInputTool instanceof EditTool) {
                e.preventDefault();
            }
        });
        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const state = this.getState();
            const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
            const newScale = Math.max(50, Math.min(10000, state.viewport.scale * zoomFactor));
            this.setState(s => ({ ...s, viewport: { ...s.viewport, scale: newScale } }));
            this.render();
        });
    }

    private hitTest(mousePos: Point): { plateId?: string; featureId?: string; plumeId?: string } | null {
        const state = this.getState();
        if (state.world.mantlePlumes) {
            for (const plume of state.world.mantlePlumes) {
                const proj = this.projectionManager.project(plume.position);
                if (proj && Math.hypot(proj[0] - mousePos.x, proj[1] - mousePos.y) < 20) return { plumeId: plume.id };
            }
        }

        for (const plate of state.world.plates) {
            if (!plate.visible || state.world.currentTime < plate.birthTime || (plate.deathTime !== null && state.world.currentTime >= plate.deathTime)) continue;
            for (const feature of plate.features) {
                const proj = this.projectionManager.project(feature.position);
                if (proj && Math.hypot(proj[0] - mousePos.x, proj[1] - mousePos.y) < 20) return { plateId: plate.id, featureId: feature.id };
            }
        }

        const path = this.projectionManager.getPathGenerator();
        for (let i = state.world.plates.length - 1; i >= 0; i--) {
            const plate = state.world.plates[i];
            if (!plate.visible || state.world.currentTime < plate.birthTime || (plate.deathTime !== null && state.world.currentTime >= plate.deathTime)) continue;
            for (const poly of plate.polygons) {
                const geojson = toGeoJSON(poly);
                if (geoArea(geojson) > 2 * Math.PI) geojson.geometry.coordinates[0].reverse();
                this.ctx.beginPath();
                path(geojson);
                if (this.ctx.isPointInPath(mousePos.x, mousePos.y)) return { plateId: plate.id };
            }
        }
        return null;
    }

    private findNearestBoundaryElement(mouseX: number, mouseY: number): { type: 'vertex' | 'edge', data: any } | null {
        const state = this.getState();
        const targetPlateId = state.world.selectedPlateId;
        if (!targetPlateId) return null;
        const plate = state.world.plates.find(p => p.id === targetPlateId);
        if (!plate || !plate.visible) return null;

        const polygons = this.editTool.getTempPolygons()?.plateId === plate.id ? this.editTool.getTempPolygons()!.polygons : plate.polygons;

        let closestVertex: any = null, minVertexDist2 = 64;
        let closestEdge: any = null, minEdgeDist2 = 64;
        // const mouseVec = this.projectionManager.invert(mouseX, mouseY) ? latLonToVector(this.projectionManager.invert(mouseX, mouseY)!) : null; // Unused

        polygons.forEach((poly: any, polyIndex: number) => {
            const points = poly.points as Coordinate[];
            const screenPoints = points.map(p => this.projectionManager.project(p));
            for (let i = 0; i < screenPoints.length; i++) {
                const p = screenPoints[i];
                if (!p) continue;
                const d2 = (p[0] - mouseX) ** 2 + (p[1] - mouseY) ** 2;
                if (d2 < minVertexDist2) { minVertexDist2 = d2; closestVertex = { plateId: plate.id, polyIndex, vertexIndex: i }; }
                if (!closestVertex) {
                    const nextIdx = (i + 1) % screenPoints.length;
                    const pNext = screenPoints[nextIdx];
                    if (!pNext) continue;
                    // Simplified edge check
                    const dist2 = this.distToSegmentSquared({ x: mouseX, y: mouseY }, { x: p[0], y: p[1] }, { x: pNext[0], y: pNext[1] });
                    if (dist2 < minEdgeDist2) {
                        const t = this.getT({ x: mouseX, y: mouseY }, { x: p[0], y: p[1] }, { x: pNext[0], y: pNext[1] });
                        const screenX = p[0] + t * (pNext[0] - p[0]);
                        const screenY = p[1] + t * (pNext[1] - p[1]);
                        const geo = this.projectionManager.invert(screenX, screenY);
                        if (geo) { minEdgeDist2 = dist2; closestEdge = { plateId: plate.id, polyIndex, vertexIndex: i, pointOnEdge: geo }; }
                    }
                }
            }
        });
        if (closestVertex) return { type: 'vertex', data: closestVertex };
        if (closestEdge) return { type: 'edge', data: closestEdge };
        return null;
    }

    private distToSegmentSquared(p: { x: number, y: number }, v: { x: number, y: number }, w: { x: number, y: number }) {
        const l2 = (v.x - w.x) ** 2 + (v.y - w.y) ** 2;
        if (l2 === 0) return (p.x - v.x) ** 2 + (p.y - v.y) ** 2;
        let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
        t = Math.max(0, Math.min(1, t));
        return (p.x - (v.x + t * (w.x - v.x))) ** 2 + (p.y - (v.y + t * (w.y - v.y))) ** 2;
    }

    private getT(p: { x: number, y: number }, v: { x: number, y: number }, w: { x: number, y: number }) {
        const l2 = (v.x - w.x) ** 2 + (v.y - w.y) ** 2;
        if (l2 === 0) return 0;
        let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
        return Math.max(0, Math.min(1, t));
    }
}
