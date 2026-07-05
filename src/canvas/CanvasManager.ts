import { AppState, Point, FeatureType, Coordinate, EulerPole, InteractionMode, Boundary, TectonicEvent, ToolType, TectonicPlate, LineType, resolveLineTypeDefaults } from '../types';
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
    private interactionMode: 'pan' | 'modify_velocity' | 'drag_target' | 'spin_ghost' | 'none' = 'none';

    // Motion state
    private dragStartGeo: Coordinate | null = null;
    private ghostPlateId: string | null = null;
    private ghostRotation: { plateId: string, axis: Vector3, angle: number } | null = null;
    private isFineTuning = false;
    private ghostSpin = 0;
    private lastSpinAngle = 0; // screen angle (deg) of the cursor around the ghost center while spinning
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
            3, '#ffffff',
            () => this.getState().world.globalOptions.planetRadius || 6371
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
            2, '#ff4444',
            () => this.getState().world.globalOptions.planetRadius || 6371
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
            3, '#ff6b6b',
            () => this.getState().world.globalOptions.planetRadius || 6371
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
        // Set up snap candidate provider for edit tool (same as draw tool)
        this.editTool.setSnapCandidateProvider(() => this.getAllPlateVertices());
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
                this.setState(s => ({ ...s, world: { ...s.world, selectedEdge: hit.edge || null } }));
            } else {
                this.onSelect(null, null);
                this.setState(s => ({ ...s, world: { ...s.world, selectedEdge: null } }));
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

    /** Total pending ghost transform (drag + spin) as a single quaternion. */
    private getGhostTotalQuat(plateCenter: Coordinate): Quaternion | null {
        if (!this.ghostRotation) return null;
        const vCenter = latLonToVector(plateCenter);
        const vRotCenter = rotateVector(vCenter, this.ghostRotation.axis, this.ghostRotation.angle);
        const qDrag = quatFromAxisAngle(this.ghostRotation.axis, this.ghostRotation.angle);
        const qSpin = quatFromAxisAngle(vRotCenter, -this.ghostSpin * Math.PI / 180);
        return quatMultiply(qSpin, qDrag);
    }

    public applyMotion(): void {
        if (this.isFineTuning && this.ghostRotation && this.onDragTargetRequest) {
            const state = this.getState();
            const plate = state.world.plates.find(p => p.id === this.ghostRotation!.plateId);
            if (plate) {
                const qTotal = this.getGhostTotalQuat(plate.center)!;
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

    /** Toggle vertex snapping for the edit tool */
    public setEditSnappingEnabled(enabled: boolean): void {
        this.editTool.snappingEnabled = enabled;
    }

    /** Collect all vertices from all visible plate polygons for snapping */
    private getAllPlateVertices(): Coordinate[] {
        const state = this.getState();
        const vertices: Coordinate[] = [];
        const currentTime = state.world.currentTime;
        for (const plate of state.world.plates) {
            if (plate.deathTime !== null && plate.deathTime <= currentTime) continue;
            if (plate.birthTime > currentTime) continue;
            if (!plate.visible && !state.world.globalOptions.showHiddenPlates) continue;
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

        // Drag-target fine-tuning: grab the yellow rotation ring to spin the ghost.
        // Must run before the selection tool, which would otherwise restart the drag.
        if (e.button === 0 && this.isFineTuning && this.ghostRotation) {
            const center = this.getGhostCenterScreen();
            if (center) {
                const dist = Math.hypot(screen.x - center[0], screen.y - center[1]);
                if (Math.abs(dist - 60) < 12) { // ring radius 60 (see drawRotationWidget)
                    this.lastSpinAngle = Math.atan2(screen.y - center[1], screen.x - center[0]) * 180 / Math.PI;
                    this.isDragging = true;
                    this.interactionMode = 'spin_ghost';
                    this.canvas.style.cursor = 'grabbing';
                    return;
                }
            }
        }

        if (this.motionGizmo.isActive() && state.activeTool === 'select') {
            const selectedPlate = state.world.plates.find(p => p.id === state.world.selectedPlateId);
            if (selectedPlate && !selectedPlate.locked) {
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

    private cursorCoordsEl: HTMLElement | null = null;

    private updateCursorCoords(geo: Coordinate | null): void {
        if (!this.cursorCoordsEl) this.cursorCoordsEl = document.getElementById('cursor-coords');
        if (!this.cursorCoordsEl) return;
        if (geo) {
            const lat = geo[1], lon = geo[0];
            this.cursorCoordsEl.textContent =
                `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? 'N' : 'S'}  ${Math.abs(lon).toFixed(1)}°${lon >= 0 ? 'E' : 'W'}`;
        } else {
            this.cursorCoordsEl.textContent = '';
        }
    }

    // --- Hover tooltip (opt-in via showHoverTooltips) ---
    private hoverTooltipTimer: number | null = null;
    private hoverTooltipEl: HTMLElement | null = null;

    private hideHoverTooltip(): void {
        if (this.hoverTooltipTimer !== null) {
            clearTimeout(this.hoverTooltipTimer);
            this.hoverTooltipTimer = null;
        }
        if (this.hoverTooltipEl) this.hoverTooltipEl.style.display = 'none';
    }

    /** Show plate info after the cursor rests ~350ms (debounced — hitTest is not cheap). */
    private scheduleHoverTooltip(screen: Point): void {
        this.hoverTooltipTimer = window.setTimeout(() => {
            this.hoverTooltipTimer = null;
            const state = this.getState();
            if (this.isDragging) return;
            const hit = this.hitTest(screen);
            if (!hit?.plateId) return;
            const plate = state.world.plates.find(p => p.id === hit.plateId);
            if (!plate) return;

            if (!this.hoverTooltipEl) {
                this.hoverTooltipEl = document.createElement('div');
                this.hoverTooltipEl.style.cssText =
                    'position: absolute; z-index: 50; pointer-events: none; font-size: 11px; ' +
                    'background: rgba(20,20,32,0.92); color: #cdd6f4; padding: 6px 8px; border-radius: 4px; ' +
                    'border: 1px solid rgba(137,180,250,0.3); line-height: 1.5; white-space: nowrap;';
                this.canvas.parentElement?.appendChild(this.hoverTooltipEl);
            }

            const age = state.world.currentTime - plate.birthTime;
            const rate = plate.motion?.eulerPole?.rate ?? 0;
            const radiusKm = state.world.globalOptions.planetRadius || 6371;
            const cmYr = (rate * Math.PI / 180 * radiusKm) / 10;
            this.hoverTooltipEl.innerHTML =
                `<b>${plate.name}</b><br>` +
                `${plate.type ?? 'plate'} · born ${plate.birthTime.toFixed(0)} Ma (age ${age.toFixed(0)} Ma)<br>` +
                `${rate.toFixed(2)} °/Ma · ${cmYr.toFixed(2)} cm/yr`;
            this.hoverTooltipEl.style.left = `${screen.x + 14}px`;
            this.hoverTooltipEl.style.top = `${screen.y + 10}px`;
            this.hoverTooltipEl.style.display = 'block';
        }, 350);
    }

    private handleMouseMove(e: MouseEvent): void {
        const geo = this.getGeoFromMouse(e);
        const screen = this.getMousePos(e);
        // Listener is on window — blank the readout when the cursor is off-canvas
        const rect = this.canvas.getBoundingClientRect();
        const onCanvas = e.clientX >= rect.left && e.clientX <= rect.right &&
            e.clientY >= rect.top && e.clientY <= rect.bottom;
        this.updateCursorCoords(onCanvas ? geo : null);

        this.hideHoverTooltip();
        if (onCanvas && !this.isDragging &&
            this.getState().world.globalOptions.showHoverTooltips === true) {
            this.scheduleHoverTooltip(screen);
        }

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
            } else if (this.interactionMode === 'spin_ghost') {
                this.updateGhostSpin(screen);
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
        const newRotate = [...state.viewport.rotate] as [number, number, number];
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
        if (!p || p.locked) return;

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

    /** Projected screen position of the ghost plate's (rotated) center during fine-tuning. */
    private getGhostCenterScreen(): [number, number] | null {
        if (!this.ghostPlateId || !this.ghostRotation) return null;
        const plate = this.getState().world.plates.find(p => p.id === this.ghostPlateId);
        if (!plate) return null;
        const vCenter = latLonToVector(plate.center);
        const vRotCenter = rotateVector(vCenter, this.ghostRotation.axis, this.ghostRotation.angle);
        return this.projectionManager.project(vectorToLatLon(vRotCenter));
    }

    /** Accumulate spin from cursor movement around the ghost center (rotation ring drag). */
    private updateGhostSpin(screen: Point) {
        const center = this.getGhostCenterScreen();
        if (!center) return;
        const curr = Math.atan2(screen.y - center[1], screen.x - center[0]) * 180 / Math.PI;
        let delta = curr - this.lastSpinAngle;
        if (delta > 180) delta -= 360;
        if (delta < -180) delta += 360;
        this.ghostSpin += delta;
        this.lastSpinAngle = curr;
        this.render();
    }

    private startDragTarget(plateId: string, geo: Coordinate) {
        const state = this.getState();
        const plate = state.world.plates.find(p => p.id === plateId);
        if (plate?.locked) return; // Prevent dragging locked plates

        // Re-dragging while fine-tuning the same plate: continue from the current
        // ghost position (fold drag + spin into the base quaternion) instead of
        // silently resetting the adjustment back to the plate's real position.
        let baseQuat: Quaternion = { w: 1, x: 0, y: 0, z: 0 };
        if (this.isFineTuning && this.ghostPlateId === plateId && this.ghostRotation && plate) {
            const vCenter = latLonToVector(plate.center);
            const vRotCenter = rotateVector(vCenter, this.ghostRotation.axis, this.ghostRotation.angle);
            const qDrag = quatFromAxisAngle(this.ghostRotation.axis, this.ghostRotation.angle);
            const qSpin = quatFromAxisAngle(vRotCenter, -this.ghostSpin * Math.PI / 180);
            baseQuat = quatMultiply(qSpin, qDrag);
            const { axis, angle } = axisAngleFromQuat(baseQuat);
            this.ghostRotation = { plateId, axis, angle };
        } else {
            this.ghostRotation = { plateId, axis: { x: 0, y: 0, z: 1 }, angle: 0 };
        }

        this.ghostPlateId = plateId;
        this.dragStartGeo = geo;
        this.dragBaseQuat = baseQuat;
        this.ghostSpin = 0;
        this.isFineTuning = false; // re-enabled on mouseup
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
        this.drawDerivedRiftLines(state, path);
        this.drawSelectedEdge();
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

        this.drawVelocityArrows(state, path);
        this.drawPredictionFlowlines(state, path);

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
        // HELPER: Draw flowlines for a given plate
        const drawFlowlineTrails = (plate: TectonicPlate, isOnTop: boolean) => {
            if (!plate.showFlowlines || !plate.flowlinesTrailCache) return;
            if (!!plate.flowlinesOnTop !== isOnTop) return; // Only draw if it matches the current pass

            this.ctx.save();
            const fade = plate.flowlinesFade !== false;

            for (const trail of plate.flowlinesTrailCache) {
                if (trail.length < 2) continue;

                if (!fade) {
                    // Simple path render
                    const geojson = { type: 'LineString', coordinates: trail };
                    this.ctx.beginPath();
                    path(geojson);
                    this.ctx.strokeStyle = plate.color;
                    this.ctx.lineWidth = 1;
                    this.ctx.globalAlpha = 0.6;
                    this.ctx.stroke();
                } else {
                    // Segmented rendering for fade
                    // trail[0] is currentTime - duration (oldest), trail[end] is currentTime (youngest)
                    // We want youngest to be opaque, oldest to be transparent.

                    const segCount = trail.length - 1;
                    for (let i = 0; i < segCount; i++) {
                        const p1 = trail[i];
                        const p2 = trail[i + 1];

                        // Age goes from duration down to 0
                        // Since segments are linearly spaced (usually step 5), we can approximate alpha
                        // i = 0 (oldest) -> alpha 0
                        // i = segCount (youngest) -> alpha 1

                        const alphaStart = (i / segCount) * 0.8;
                        const alphaEnd = ((i + 1) / segCount) * 0.8;
                        const avgAlpha = (alphaStart + alphaEnd) / 2;

                        // Note: A true gradient is hard on spherical projections because segment lengths vary
                        // Drawing line by line with changing opacity is standard in d3-geo
                        const geojson = { type: 'LineString', coordinates: [p1, p2] };
                        this.ctx.beginPath();
                        path(geojson);
                        this.ctx.strokeStyle = plate.color;
                        this.ctx.lineWidth = 1;
                        this.ctx.globalAlpha = avgAlpha;
                        this.ctx.stroke();
                    }
                }
            }
            this.ctx.restore();
        };

        const sortedPlates = [...state.world.plates].sort((a, b) => {
            let zA = a.zIndex ?? 0;
            let zB = b.zIndex ?? 0;
            if (a.polygonType === 'continental_plate' || a.polygonType === 'continental_crust' || a.polygonType === 'craton') zA += 1;
            if (b.polygonType === 'continental_plate' || b.polygonType === 'continental_crust' || b.polygonType === 'craton') zB += 1;
            return zA - zB;
        });

        for (const plate of sortedPlates) {
            if (!plate.visible && !state.world.globalOptions.showHiddenPlates) continue;
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

            // --- RENDER FLOWLINES (UNDER) ---
            drawFlowlineTrails(plate, false);

            for (const poly of polygonsToDraw) {
                const geojson = toGeoJSON(poly);
                if (geoArea(geojson) > 2 * Math.PI) geojson.geometry.coordinates[0].reverse();

                this.ctx.beginPath();
                path(geojson);

                const globalOpacity = state.world.globalOptions.plateOpacity ?? 1.0;
                let oceanicOpacity = plate.type === 'oceanic' ? (state.world.globalOptions.oceanicCrustOpacity ?? 0.5) : 1.0;

                // Dim hidden plates slightly if they are being revealed by the global toggle
                if (!plate.visible && state.world.globalOptions.showHiddenPlates) {
                    oceanicOpacity *= 0.4;
                }

                this.ctx.globalAlpha = globalOpacity * oceanicOpacity;
                this.ctx.fillStyle = plate.color;
                if (poly.closed !== false) this.ctx.fill();
                this.ctx.globalAlpha = 1.0;

                this.ctx.strokeStyle = isSelected ? '#ffffff' : 'rgba(0,0,0,0.3)';
                this.ctx.lineWidth = isSelected ? 2 : 1;
                if (plate.type === 'rift') {
                    // Line type visual differentiation.
                    // Color: respects plate.color when the user customized it;
                    // otherwise falls back to the per-type default from
                    // globalOptions.lineTypeDefaults (settings-editable).
                    // Dash: respects plate.lineDashCustomized override;
                    // otherwise uses the per-type default.
                    const lt: LineType = (plate.lineType as LineType) || 'generic';
                    const defs = resolveLineTypeDefaults(this.getState().world.globalOptions.lineTypeDefaults);
                    const typeDefault = defs[lt] || defs.generic;
                    const strokeColor = plate.lineColorCustomized
                        ? (plate.color || typeDefault.color)
                        : typeDefault.color;
                    const dash = typeDefault.dash;
                    this.ctx.strokeStyle = isSelected ? '#ffffff' : strokeColor;
                    this.ctx.lineWidth = isSelected ? 4 : 2;
                    this.ctx.setLineDash(dash);
                }
                this.ctx.stroke();
                this.ctx.setLineDash([]); // Reset dash after each polygon stroke
            }

            // --- RENDER FLOWLINES (OVER) ---
            drawFlowlineTrails(plate, true);

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

    private drawDerivedRiftLines(state: AppState, path: any) {
        const RIFT_COLOR = '#ff4444';
        this.ctx.strokeStyle = RIFT_COLOR;
        this.ctx.lineWidth = 2;
        this.ctx.setLineDash([12, 4]);

        // ── Axis-based rift lines (new system) ──────────────────────────
        const riftAxes = state.world.riftAxes || [];
        const axisGroupIds = new Set<string>();
        for (const axis of riftAxes) {
            if (axis.state !== 'active') continue;
            axisGroupIds.add(axis.groupId);

            const plateA = state.world.plates.find(p =>
                p.id === axis.plateIdA && p.birthTime <= state.world.currentTime &&
                (p.deathTime === null || p.deathTime > state.world.currentTime)
            );
            const plateB = state.world.plates.find(p =>
                p.id === axis.plateIdB && p.birthTime <= state.world.currentTime &&
                (p.deathTime === null || p.deathTime > state.world.currentTime)
            );
            if (!plateA || !plateB) continue;

            const findEdgePts = (plate: import('../types').TectonicPlate): Coordinate[] | null => {
                for (const poly of plate.polygons) {
                    if (!poly.edgeMeta) continue;
                    const edges = poly.edgeMeta.filter(e => e.sourceId === axis.groupId && e.type === 'rift');
                    if (edges.length === 0) continue;
                    edges.sort((a, b) => a.edgeIndex - b.edgeIndex);
                    const pts: Coordinate[] = [];
                    for (const edge of edges) pts.push(poly.points[edge.edgeIndex]);
                    if (edges.length > 0) {
                        pts.push(poly.points[(edges[edges.length - 1].edgeIndex + 1) % poly.points.length]);
                    }
                    return pts;
                }
                return null;
            };

            const ptsA = findEdgePts(plateA);
            const ptsB = findEdgePts(plateB);
            if (!ptsA || !ptsB || ptsA.length < 2 || ptsB.length < 2) continue;

            const midpoints: Coordinate[] = [];
            const ptsRev = [...ptsB].reverse();
            for (let i = 0; i < Math.min(ptsA.length, ptsRev.length); i++) {
                const pV = latLonToVector(ptsA[i]);
                const qV = latLonToVector(ptsRev[i]);
                const midV = normalize({ x: (pV.x + qV.x) / 2, y: (pV.y + qV.y) / 2, z: (pV.z + qV.z) / 2 });
                midpoints.push(vectorToLatLon(midV));
            }

            if (midpoints.length >= 2) {
                // Skip degenerate midlines that collapse to a point
                const v0 = latLonToVector(midpoints[0]);
                const vN = latLonToVector(midpoints[midpoints.length - 1]);
                const span = Math.acos(Math.min(1, Math.max(-1, v0.x * vN.x + v0.y * vN.y + v0.z * vN.z)));
                if (span >= 0.01) { // >= ~0.6° arc
                    this.ctx.beginPath();
                    path({ type: 'LineString', coordinates: midpoints });
                    this.ctx.stroke();
                }
            }
        }

        // ── Legacy sibling-based rift lines (skip groups handled by axis) ──
        for (const plate of state.world.plates) {
            if (!plate.siblingSystem || (plate.deathTime !== null && state.world.currentTime >= plate.deathTime)) continue;
            
            for (const poly of plate.polygons) {
                if (!poly.edgeMeta) continue;
                 
                const activeGroupIds = new Set<string>();
                for (const meta of poly.edgeMeta) {
                    if (meta.siblings) {
                        for (const s of meta.siblings) {
                            if (!s.frozen && s.siblingPlateId) {
                                if (plate.id < s.siblingPlateId) {
                                    activeGroupIds.add(s.groupId);
                                }
                            }
                        }
                    }
                }
                 
                for (const groupId of activeGroupIds) {
                    // Skip groups handled by the RiftAxis system
                    if (axisGroupIds.has(groupId)) continue;

                    const pEdges = poly.edgeMeta.filter(m => m.siblings?.some(s => s.groupId === groupId && !s.frozen));
                    if (pEdges.length === 0) continue;

                    const qId = pEdges[0].siblings!.find(s => s.groupId === groupId && !s.frozen)!.siblingPlateId;
                    const qPlate = state.world.plates.find(p => p.id === qId);
                    if (!qPlate || (qPlate.deathTime !== null && state.world.currentTime >= qPlate.deathTime)) continue;
                      
                    let qEdges: import('../types').EdgeMeta[] = [];
                    let qPolyIndex = -1;
                    for (let qi = 0; qi < qPlate.polygons.length; qi++) {
                        if (qPlate.polygons[qi].edgeMeta) {
                            const edges = qPlate.polygons[qi].edgeMeta!.filter(m => m.siblings?.some(s => s.groupId === groupId && !s.frozen));
                            if (edges.length > 0) {
                                qEdges = edges;
                                qPolyIndex = qi;
                                break;
                            }
                        }
                    }
                      
                    if (qEdges.length === 0) continue;
                      
                    pEdges.sort((a,b) => a.edgeIndex - b.edgeIndex);
                    qEdges.sort((a,b) => a.edgeIndex - b.edgeIndex);
                      
                    const getEdgePts = (polyPts: Coordinate[], edges: import('../types').EdgeMeta[]) => {
                        const pts: Coordinate[] = [];
                        for (const edge of edges) pts.push(polyPts[edge.edgeIndex]);
                        if (edges.length > 0) {
                            pts.push(polyPts[(edges[edges.length - 1].edgeIndex + 1) % polyPts.length]);
                        }
                        return pts;
                    };
                      
                    const pPts = getEdgePts(poly.points, pEdges);
                    const qPts = getEdgePts(qPlate.polygons[qPolyIndex].points, qEdges);
                      
                    if (pPts.length < 2 || qPts.length < 2) continue;
                      
                    const midpoints: Coordinate[] = [];
                    const qPtsRev = [...qPts].reverse();
                    for(let i = 0; i < Math.min(pPts.length, qPtsRev.length); i++) {
                        const pV = latLonToVector(pPts[i]);
                        const qV = latLonToVector(qPtsRev[i]);
                        const midV = normalize({ x: (pV.x + qV.x)/2, y: (pV.y + qV.y)/2, z: (pV.z + qV.z)/2 });
                        midpoints.push(vectorToLatLon(midV));
                    }
                      
                    if (midpoints.length >= 2) {
                        // Skip degenerate midlines that collapse to a point
                        const v0 = latLonToVector(midpoints[0]);
                        const vN = latLonToVector(midpoints[midpoints.length - 1]);
                        const span = Math.acos(Math.min(1, Math.max(-1, v0.x * vN.x + v0.y * vN.y + v0.z * vN.z)));
                        if (span < 0.01) continue; // < ~0.6° arc

                        this.ctx.beginPath();
                        path({ type: 'LineString', coordinates: midpoints });
                        this.ctx.stroke();
                    }
                }
            }
        }
        this.ctx.setLineDash([]);
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
        const sum = { x: 0, y: 0, z: 0 };
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
            if (plate.linkedToPlateId && !plate.hideLinkMarker) {
                const parent = state.world.plates.find(p => p.id === plate.linkedToPlateId);
                if (parent && (!parent.hideLinkMarker || parent.id !== plate.linkedToPlateId)) {
                    this.ctx.beginPath();
                    path({ type: 'LineString', coordinates: [plate.center, parent.center] } as any);
                    this.ctx.stroke();
                }
            }
        }
        this.ctx.restore();
    }

    /**
     * Prediction flowlines for Drag Landmass mode: while dragging or fine-tuning,
     * draw the great-circle arcs that sample points of the plate will travel along
     * under the pending rotation (drag + spin composed — exactly what Apply commits).
     */
    private drawPredictionFlowlines(state: AppState, path: any): void {
        if (state.world.globalOptions.showPredictionFlowlines !== true) return; // opt-in
        if (!this.ghostPlateId || !this.ghostRotation) return;

        const plate = state.world.plates.find(p => p.id === this.ghostPlateId);
        if (!plate) return;

        const qTotal = this.getGhostTotalQuat(plate.center);
        if (!qTotal) return;
        const { axis, angle } = axisAngleFromQuat(qTotal);
        if (angle < 0.005) return; // nothing meaningful to predict yet

        // Original-position outline: faint dashed silhouette at the plate's true position
        this.ctx.save();
        this.ctx.setLineDash([4, 4]);
        this.ctx.lineWidth = 1;
        this.ctx.strokeStyle = plate.color;
        this.ctx.globalAlpha = 0.45;
        for (const poly of plate.polygons) {
            this.ctx.beginPath();
            path(toGeoJSON(poly));
            this.ctx.stroke();
        }
        this.ctx.restore();

        // Sample points: plate center + up to 7 evenly spaced boundary vertices
        const samples: Coordinate[] = [plate.center];
        const boundaryPts = plate.polygons.flatMap(p => p.points);
        if (boundaryPts.length > 0) {
            const step = Math.max(1, Math.floor(boundaryPts.length / 7));
            for (let i = 0; i < boundaryPts.length && samples.length < 8; i += step) {
                samples.push(boundaryPts[i]);
            }
        }

        const segs = 24;
        this.ctx.save();
        this.ctx.setLineDash([6, 4]);
        this.ctx.lineWidth = 1.5;
        this.ctx.strokeStyle = '#fbbf24'; // amber, distinct from plate + gizmo colors
        this.ctx.globalAlpha = 0.75;

        for (const pt of samples) {
            const v = latLonToVector(pt);
            const coords: Coordinate[] = [];
            for (let i = 0; i <= segs; i++) {
                coords.push(vectorToLatLon(rotateVector(v, axis, (angle * i) / segs)));
            }

            // Arc, projected with proper clipping
            this.ctx.beginPath();
            path({ type: 'LineString', coordinates: coords });
            this.ctx.stroke();

            // Arrowhead at the destination end (screen space)
            const end = this.projectionManager.project(coords[segs]);
            const prev = this.projectionManager.project(coords[segs - 1]);
            if (end && prev) {
                const a = Math.atan2(end[1] - prev[1], end[0] - prev[0]);
                const headLen = 7;
                this.ctx.beginPath();
                this.ctx.setLineDash([]);
                this.ctx.moveTo(end[0], end[1]);
                this.ctx.lineTo(end[0] - headLen * Math.cos(a - Math.PI / 6), end[1] - headLen * Math.sin(a - Math.PI / 6));
                this.ctx.moveTo(end[0], end[1]);
                this.ctx.lineTo(end[0] - headLen * Math.cos(a + Math.PI / 6), end[1] - headLen * Math.sin(a + Math.PI / 6));
                this.ctx.stroke();
                this.ctx.setLineDash([6, 4]);
            }
        }

        // Rotation readout next to the ghost center: total angle of the pending transform
        const ghostCenter = this.getGhostCenterScreen();
        if (ghostCenter) {
            this.ctx.setLineDash([]);
            this.ctx.globalAlpha = 1;
            this.ctx.font = 'bold 11px sans-serif';
            this.ctx.textAlign = 'center';
            this.ctx.fillStyle = '#fbbf24';
            this.ctx.fillText(`${(angle * 180 / Math.PI).toFixed(1)}°`, ghostCenter[0], ghostCenter[1] - 72);
        }

        this.ctx.restore();
    }

    /**
     * Velocity arrows (opt-in): a small arc with arrowhead at each plate's center
     * showing its current rotation path, scaled like the motion gizmo (33° arc per 1°/Ma).
     */
    private drawVelocityArrows(state: AppState, path: any): void {
        if (state.world.globalOptions.showVelocityArrows !== true) return;

        const segs = 12;
        const SCALE = 33; // visual deg of arc per deg/Ma, matches MotionGizmo
        this.ctx.save();
        this.ctx.lineWidth = 2;
        this.ctx.lineCap = 'round';

        for (const plate of state.world.plates) {
            if (!plate.visible && !state.world.globalOptions.showHiddenPlates) continue;
            if (state.world.currentTime < plate.birthTime) continue;
            if (plate.deathTime !== null && state.world.currentTime >= plate.deathTime) continue;

            const pole = plate.motion?.eulerPole;
            if (!pole || Math.abs(pole.rate) < 0.01) continue;

            const axis = latLonToVector(pole.position);
            const v = latLonToVector(plate.center);
            const totalAngle = (pole.rate * SCALE) * Math.PI / 180;

            const coords: Coordinate[] = [];
            for (let i = 0; i <= segs; i++) {
                coords.push(vectorToLatLon(rotateVector(v, axis, (totalAngle * i) / segs)));
            }

            this.ctx.strokeStyle = '#e2e8f0';
            this.ctx.globalAlpha = 0.7;
            this.ctx.beginPath();
            path({ type: 'LineString', coordinates: coords });
            this.ctx.stroke();

            const end = this.projectionManager.project(coords[segs]);
            const prev = this.projectionManager.project(coords[segs - 1]);
            if (end && prev) {
                const a = Math.atan2(end[1] - prev[1], end[0] - prev[0]);
                const headLen = 6;
                this.ctx.beginPath();
                this.ctx.moveTo(end[0], end[1]);
                this.ctx.lineTo(end[0] - headLen * Math.cos(a - Math.PI / 6), end[1] - headLen * Math.sin(a - Math.PI / 6));
                this.ctx.moveTo(end[0], end[1]);
                this.ctx.lineTo(end[0] - headLen * Math.cos(a + Math.PI / 6), end[1] - headLen * Math.sin(a + Math.PI / 6));
                this.ctx.stroke();
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

    private drawSelectedEdge(): void {
        const state = this.getState();
        const selectedEdge = state.world.selectedEdge;
        if (!selectedEdge) return;

        const plate = state.world.plates.find(p => p.id === selectedEdge.plateId);
        if (!plate) return;

        const poly = plate.polygons[selectedEdge.polyIndex];
        if (!poly) return;

        const p1 = poly.points[selectedEdge.vertexIndex];
        const isClosed = poly.closed !== false;
        const nextIdx = isClosed
            ? (selectedEdge.vertexIndex + 1) % poly.points.length
            : selectedEdge.vertexIndex + 1;

        if (nextIdx < poly.points.length) {
            const p2 = poly.points[nextIdx];
            const edgeGeo = { type: 'LineString' as const, coordinates: [p1, p2] };
            const path = this.projectionManager.getPathGenerator();

            this.ctx.save();
            this.ctx.beginPath();
            path(edgeGeo as any);
            this.ctx.strokeStyle = '#00ffff'; // Cyan color for selected edge
            this.ctx.lineWidth = 5;
            this.ctx.stroke();
            this.ctx.restore();
        }
    }

    private drawEditHighlights() {
        const state = this.getState();
        const plateId = state.world.selectedPlateId;
        if (!plateId || !this.editTool) return;
        const plate = state.world.plates.find(p => p.id === plateId);
        if (!plate) return;

        const polygons = this.editTool.getTempPolygons()?.polygons || plate.polygons;
        const path = this.projectionManager.getPathGenerator();

        // --- ELEMENT GLOW (polygon/line outline highlight on hover) ---
        const hoveredVertex = this.editTool.getHoveredVertex();
        const hoveredEdge = this.editTool.getHoveredEdge();
        const anyHover = hoveredVertex || hoveredEdge;
        if (anyHover && anyHover.plateId === plateId) {
            const hoverPolyIdx = anyHover.polyIndex;
            const poly = polygons[hoverPolyIdx];
            if (poly) {
                const geojson = toGeoJSON(poly);
                this.ctx.save();
                this.ctx.beginPath();
                path(geojson);
                this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
                this.ctx.lineWidth = 6;
                this.ctx.stroke();
                this.ctx.restore();
            }
        }

        // --- DRAW ALL VERTICES ---
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

        // --- EDGE HIGHLIGHT ---
        if (hoveredEdge && hoveredEdge.plateId === plateId) {
            const poly = polygons[hoveredEdge.polyIndex];
            if (poly) {
                const p1 = poly.points[hoveredEdge.vertexIndex];
                const isClosed = poly.closed !== false;
                const nextIdx = isClosed
                    ? (hoveredEdge.vertexIndex + 1) % poly.points.length
                    : hoveredEdge.vertexIndex + 1;
                if (nextIdx < poly.points.length) {
                    const p2 = poly.points[nextIdx];
                    // Draw highlighted edge as geodesic arc
                    const edgeGeo = { type: 'LineString' as const, coordinates: [p1, p2] };
                    this.ctx.save();
                    this.ctx.beginPath();
                    path(edgeGeo as any);
                    this.ctx.strokeStyle = '#ffaa00';
                    this.ctx.lineWidth = 4;
                    this.ctx.stroke();
                    this.ctx.restore();
                }
                // Highlight insertion point
                if (hoveredEdge.pointOnEdge) {
                    const proj = this.projectionManager.project(hoveredEdge.pointOnEdge);
                    if (proj) {
                        this.ctx.beginPath();
                        this.ctx.arc(proj[0], proj[1], 5, 0, Math.PI * 2);
                        this.ctx.fillStyle = '#ffaa00';
                        this.ctx.fill();
                    }
                }
            }
        }

        // --- HOVERED VERTEX HIGHLIGHT ---
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

    private hitTest(mousePos: Point): { plateId?: string; featureId?: string; plumeId?: string; edge?: any } | null {
        const state = this.getState();
        if (state.world.mantlePlumes) {
            for (const plume of state.world.mantlePlumes) {
                const proj = this.projectionManager.project(plume.position);
                if (proj && Math.hypot(proj[0] - mousePos.x, proj[1] - mousePos.y) < 20) return { plumeId: plume.id };
            }
        }

        for (const plate of state.world.plates) {
            if (!plate.visible || state.world.currentTime < plate.birthTime || (plate.deathTime !== null && state.world.currentTime >= plate.deathTime)) continue;
            // Locked plates can be selected, but we might want them to be selectable to UNLOCK them. 
            // So we still hit test them for selection, but tools must respect the lock.
            for (const feature of plate.features) {
                const proj = this.projectionManager.project(feature.position);
                if (proj && Math.hypot(proj[0] - mousePos.x, proj[1] - mousePos.y) < 20) return { plateId: plate.id, featureId: feature.id };
            }
        }

        const path = this.projectionManager.getPathGenerator();
        for (let i = state.world.plates.length - 1; i >= 0; i--) {
            const plate = state.world.plates[i];
            if (!plate.visible || state.world.currentTime < plate.birthTime || (plate.deathTime !== null && state.world.currentTime >= plate.deathTime)) continue;
            // Allow selecting locked plates so the user can unlock them in the properties panel
            for (let polyIndex = 0; polyIndex < plate.polygons.length; polyIndex++) {
                const poly = plate.polygons[polyIndex];

                // Edge hit test
                const points = poly.points as Coordinate[];
                const screenPoints = points.map(p => this.projectionManager.project(p));
                const isClosed = poly.closed !== false;
                for (let j = 0; j < screenPoints.length; j++) {
                    const p = screenPoints[j];
                    if (!p) continue;
                    const nextIdx = isClosed ? (j + 1) % screenPoints.length : j + 1;
                    if (nextIdx >= screenPoints.length) continue;
                    const pNext = screenPoints[nextIdx];
                    if (!pNext) continue;

                    const dist2 = this.distToSegmentSquared({ x: mousePos.x, y: mousePos.y }, { x: p[0], y: p[1] }, { x: pNext[0], y: pNext[1] });
                    if (dist2 < 25) { // 5px radius for edge selection
                        return { plateId: plate.id, edge: { plateId: plate.id, polyIndex, vertexIndex: j } };
                    }
                }

                const geojson = toGeoJSON(poly);
                if (geoArea(geojson) > 2 * Math.PI) geojson.geometry.coordinates[0].reverse();
                this.ctx.beginPath();
                path(geojson);
                if (!poly.closed) {
                    const originalLineWidth = this.ctx.lineWidth;
                    this.ctx.lineWidth = 15; // wide enough to easily click
                    const hit = this.ctx.isPointInStroke(mousePos.x, mousePos.y);
                    this.ctx.lineWidth = originalLineWidth;
                    if (hit) return { plateId: plate.id };
                } else {
                    if (this.ctx.isPointInPath(mousePos.x, mousePos.y)) return { plateId: plate.id };
                }
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

        polygons.forEach((poly: any, polyIndex: number) => {
            const points = poly.points as Coordinate[];
            const screenPoints = points.map(p => this.projectionManager.project(p));
            const isClosed = poly.closed !== false;
            for (let i = 0; i < screenPoints.length; i++) {
                const p = screenPoints[i];
                if (!p) continue;
                const d2 = (p[0] - mouseX) ** 2 + (p[1] - mouseY) ** 2;
                if (d2 < minVertexDist2) { minVertexDist2 = d2; closestVertex = { plateId: plate.id, polyIndex, vertexIndex: i }; }
                // Always check edges (previously skipped when any vertex was found)
                const nextIdx = isClosed ? (i + 1) % screenPoints.length : i + 1;
                if (nextIdx >= screenPoints.length) continue;
                const pNext = screenPoints[nextIdx];
                if (!pNext) continue;
                const dist2 = this.distToSegmentSquared({ x: mouseX, y: mouseY }, { x: p[0], y: p[1] }, { x: pNext[0], y: pNext[1] });
                if (dist2 < minEdgeDist2) {
                    const t = this.getT({ x: mouseX, y: mouseY }, { x: p[0], y: p[1] }, { x: pNext[0], y: pNext[1] });
                    const screenX = p[0] + t * (pNext[0] - p[0]);
                    const screenY = p[1] + t * (pNext[1] - p[1]);
                    const geo = this.projectionManager.invert(screenX, screenY);
                    if (geo) { minEdgeDist2 = dist2; closestEdge = { plateId: plate.id, polyIndex, vertexIndex: i, pointOnEdge: geo }; }
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
        const t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
        return Math.max(0, Math.min(1, t));
    }
}
