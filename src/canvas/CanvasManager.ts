import { AppState, Point, Feature, FeatureType, Coordinate, EulerPole, InteractionMode, Boundary } from '../types';
import { ProjectionManager } from './ProjectionManager';
import { geoGraticule, geoArea } from 'd3-geo';
import { toGeoJSON } from '../utils/geoHelpers';
import {
    drawMountainIcon,
    drawVolcanoIcon,
    drawHotspotIcon,
    drawRiftIcon,
    drawTrenchIcon,
    drawIslandIcon
} from './featureIcons';
import { MotionGizmo } from './MotionGizmo';
import { latLonToVector, vectorToLatLon, rotateVector, cross, dot, normalize, Vector3, quatFromAxisAngle, quatMultiply, axisAngleFromQuat, Quaternion } from '../utils/sphericalMath';

export class CanvasManager {
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private animationId: number | null = null;
    private projectionManager: ProjectionManager;

    // Drag state
    private isDragging = false;
    private lastMousePos: Point = { x: 0, y: 0 };
    private interactionMode: 'pan' | 'modify_velocity' | 'drag_target' | 'none' = 'none';
    private dragStartGeo: Coordinate | null = null;
    private ghostPlateId: string | null = null;
    private ghostRotation: { plateId: string, axis: Vector3, angle: number } | null = null;

    // Fine-tuning state
    private isFineTuning = false;
    private ghostSpin = 0; // Degrees
    private isSpinning = false;
    private lastSpinAngle = 0;
    private dragBaseQuat: Quaternion | null = null;

    // Motion Control Mode
    private motionMode: InteractionMode = 'classic';

    // Drawing state
    private currentPolygon: Coordinate[] = [];
    private isDrawing = false;

    // Split state - now supports polyline
    private splitPoints: Coordinate[] = [];
    private splitPreviewActive = false;

    // Box Selection
    private selectionBoxStart: Point | null = null;
    private selectionBoxEnd: Point | null = null;
    private isBoxSelecting = false;
    private boxSelectPlateId: string | null = null; // Plate context for box selection

    // Motion gizmo
    private motionGizmo: MotionGizmo = new MotionGizmo();

    constructor(
        canvas: HTMLCanvasElement,
        private getState: () => AppState,
        private setState: (updater: (state: AppState) => AppState) => void,
        private onDrawComplete: (points: Coordinate[]) => void,
        private onFeaturePlace: (position: Coordinate, type: FeatureType) => void,
        private onSelect: (plateId: string | null, featureId: string | null, featureIds?: string[]) => void,
        private onSplitApply: (points: Coordinate[]) => void,
        private onSplitPreviewChange: (active: boolean) => void,
        private onMotionChange: (plateId: string, pole: Coordinate, rate: number) => void,
        private onDragTargetRequest?: (plateId: string, axis: Vector3, angleRad: number) => void,
        private onPolyFeatureComplete?: (points: Coordinate[], fillColor: string) => void,
        private onMotionPreviewChange?: (active: boolean) => void
    ) {
        this.canvas = canvas;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Could not get 2D context');
        this.ctx = ctx;

        this.projectionManager = new ProjectionManager(ctx);

        this.setupEventListeners();

        // Use ResizeObserver for robust layout handling
        const container = canvas.parentElement;
        if (container) {
            const resizeObserver = new ResizeObserver(() => {
                this.resizeCanvas();
            });
            resizeObserver.observe(container);
        }

        // Initial resize
        requestAnimationFrame(() => this.resizeCanvas());
    }

    public setMotionMode(mode: InteractionMode): void {
        this.motionMode = mode;
        this.motionGizmo.setMode(mode);
        this.render();
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

        // Update viewport dimensions
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



    public setTheme(theme: string): void {
        this.render();
    }

    private setupEventListeners(): void {
        this.canvas.addEventListener('mousedown', this.handleMouseDown.bind(this));
        // Bind to window to catch drags outside canvas
        window.addEventListener('mousemove', this.handleMouseMove.bind(this));
        window.addEventListener('mouseup', this.handleMouseUp.bind(this));

        this.canvas.addEventListener('wheel', this.handleWheel.bind(this));
        this.canvas.addEventListener('dblclick', this.handleDoubleClick.bind(this));
        this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    // Helper to get [lon, lat] from mouse
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
        const geoPos = this.getGeoFromMouse(e);
        const mousePos = this.getMousePos(e);
        this.lastMousePos = { x: e.clientX, y: e.clientY };

        if (e.button === 1 || (e.button === 0 && state.activeTool === 'pan')) {
            this.isDragging = true;
            this.interactionMode = 'pan';
            this.canvas.style.cursor = 'grabbing';
            return;
        }

        // Shift+Click triggers box selection (requires a plate to be selected)
        if (state.activeTool === 'select' && e.shiftKey && e.button === 0) {
            if (!state.world.selectedPlateId) {
                // No plate selected, cannot box select features
                return;
            }
            this.isBoxSelecting = true;
            this.selectionBoxStart = mousePos;
            this.selectionBoxEnd = mousePos;
            this.boxSelectPlateId = state.world.selectedPlateId; // Capture plate context
            return;
        }

        if (e.button === 0) {
            // Check for Fine-Tuning Ring Hit
            if (this.isFineTuning) {
                // If clicking anywhere on canvas, assume spinning if not hitting UI?
                // Or robust hit test on ring.
                // Let's assume broad interaction: dragging anywhere rotates relative to center?
                // Typically Ring requires clicking on Ring.
                // Let's implement robust visual ring hit test.
                // Center is not stored? We calculate it in render. We need it here.
                // Re-calculate transformed center.
                const plate = state.world.plates.find(p => p.id === this.ghostPlateId);
                if (plate && this.ghostRotation) {
                    const vCenter = latLonToVector(plate.center);
                    const vRotCenter = rotateVector(vCenter, this.ghostRotation.axis, this.ghostRotation.angle);
                    const center = vectorToLatLon(vRotCenter);

                    const proj = this.projectionManager.project(center);
                    if (proj) {
                        const dist = Math.hypot(mousePos.x - proj[0], mousePos.y - proj[1]);
                        // Ring radius 60, handle width ~10
                        if (Math.abs(dist - 60) < 15) {
                            this.isSpinning = true;
                            const angle = Math.atan2(mousePos.y - proj[1], mousePos.x - proj[0]);
                            this.lastSpinAngle = angle * 180 / Math.PI;
                            this.lastMousePos = { x: e.clientX, y: e.clientY };
                            return;
                        }
                    }
                }
            }

            // Check for gizmo handle hit first
            if (this.motionGizmo.isActive() && state.activeTool === 'select') {
                const selectedPlate = state.world.plates.find(p => p.id === state.world.selectedPlateId);
                if (selectedPlate) {
                    const handle = this.motionGizmo.hitTest(
                        mousePos.x, mousePos.y,
                        this.projectionManager,
                        selectedPlate.center
                    );
                    if (handle) {
                        this.motionGizmo.startDrag(handle, mousePos.x, mousePos.y);
                        this.isDragging = true;
                        this.interactionMode = 'modify_velocity';
                        this.canvas.style.cursor = 'move';
                        return;
                    }
                }
            }

            if (!geoPos && state.activeTool !== 'select') return;

            switch (state.activeTool) {
                case 'draw':
                    if (geoPos) {
                        if (!this.isDrawing) {
                            this.isDrawing = true;
                            this.currentPolygon = [geoPos];
                        } else {
                            this.currentPolygon.push(geoPos);
                        }
                        this.render();
                    }
                    break;

                case 'feature':
                    if (geoPos) this.onFeaturePlace(geoPos, state.activeFeatureType);
                    break;

                case 'select':
                    const hit = this.hitTest(mousePos);

                    if (this.motionMode === 'drag_target' && hit?.plateId && geoPos) {
                        this.onSelect(hit.plateId, hit.featureId ?? null);

                        // Initialize or Capture Base Drag State
                        if (this.ghostPlateId === hit.plateId && this.ghostRotation) {
                            this.dragBaseQuat = quatFromAxisAngle(this.ghostRotation.axis, this.ghostRotation.angle);
                        } else {
                            // New plate or reset
                            this.ghostPlateId = hit.plateId;
                            this.ghostRotation = { plateId: hit.plateId, axis: { x: 0, y: 0, z: 1 }, angle: 0 };
                            this.ghostSpin = 0;
                            this.lastSpinAngle = 0;
                            this.dragBaseQuat = { w: 1, x: 0, y: 0, z: 0 };
                        }

                        this.isDragging = true;
                        this.interactionMode = 'drag_target';
                        this.dragStartGeo = geoPos;
                        this.isFineTuning = true; // Ensure Widget Visible
                        if (this.onMotionPreviewChange) this.onMotionPreviewChange(true); // Show UI

                        this.canvas.style.cursor = 'grabbing';
                    } else if (e.ctrlKey && hit?.featureId) {
                        // Ctrl+Click: Additive selection (toggle feature in/out of selection)
                        const currentIds = state.world.selectedFeatureIds || [];
                        const isAlreadySelected = currentIds.includes(hit.featureId);

                        if (isAlreadySelected) {
                            // Remove from selection
                            const newIds = currentIds.filter(id => id !== hit.featureId);
                            this.onSelect(hit.plateId ?? state.world.selectedPlateId, null, newIds);
                        } else {
                            // Add to selection
                            const newIds = [...currentIds, hit.featureId];
                            this.onSelect(hit.plateId ?? state.world.selectedPlateId, null, newIds);
                        }
                    } else {
                        // Single click selection (clears previous selection)
                        this.onSelect(hit?.plateId ?? null, hit?.featureId ?? null);
                    }
                    break;

                case 'split':
                    if (geoPos) {
                        // Add point to split polyline
                        this.splitPoints.push(geoPos);
                        if (!this.splitPreviewActive && this.splitPoints.length >= 1) {
                            this.splitPreviewActive = true;
                            this.onSplitPreviewChange(true);
                        }
                        this.render();
                    }
                    break;

                case 'poly_feature':
                    // Poly feature uses same drawing logic as draw tool
                    if (geoPos) {
                        if (!this.isDrawing) {
                            this.isDrawing = true;
                            this.currentPolygon = [geoPos];
                        } else {
                            this.currentPolygon.push(geoPos);
                        }
                        this.render();
                    }
                    break;

                case 'fuse':
                    // Fuse tool: click to select plates
                    const fuseHit = this.hitTest(mousePos);
                    if (fuseHit?.plateId) {
                        this.onSelect(fuseHit.plateId, null);
                    }
                    break;

                case 'link':
                    // Link tool: click to select plates
                    const linkHit = this.hitTest(mousePos);
                    if (linkHit?.plateId) {
                        this.onSelect(linkHit.plateId, null);
                    }
                    break;
            }
        }
    }

    private handleMouseMove(e: MouseEvent): void {
        const geoPos = this.getGeoFromMouse(e);
        const mousePos = this.getMousePos(e);

        if (this.isBoxSelecting) {
            this.selectionBoxEnd = mousePos;
            this.render();
            return;
        }

        if (this.isSpinning && this.isFineTuning && this.ghostPlateId) {
            const state = this.getState();
            const plate = state.world.plates.find(p => p.id === this.ghostPlateId);
            if (plate && this.ghostRotation) {
                const vCenter = latLonToVector(plate.center);
                const vRotCenter = rotateVector(vCenter, this.ghostRotation.axis, this.ghostRotation.angle);
                const center = vectorToLatLon(vRotCenter);

                const proj = this.projectionManager.project(center);
                if (proj) {
                    // Calculate angle delta
                    const angle = Math.atan2(mousePos.y - proj[1], mousePos.x - proj[0]);
                    const angleDeg = angle * 180 / Math.PI;
                    let delta = angleDeg - this.lastSpinAngle;

                    // Handle wrap around
                    if (delta > 180) delta -= 360;
                    if (delta < -180) delta += 360;

                    this.ghostSpin += delta;
                    this.lastSpinAngle = angleDeg;
                }
            }
            this.lastMousePos = { x: e.clientX, y: e.clientY };
            this.render();
            return;
        }

        if (this.isDragging) {
            const dx = e.clientX - this.lastMousePos.x;
            const dy = e.clientY - this.lastMousePos.y;

            if (this.interactionMode === 'pan') {
                this.setState(state => {
                    // Sensitivity: 0.25 degrees per pixel
                    const sens = 0.25;

                    let newRotate = [...state.viewport.rotate] as [number, number, number];

                    // For orthographic, we rotate the globe
                    // Dx -> Rotate Lambda (axis 0)
                    // Dy -> Rotate Phi (axis 1) - clamped to +-90 usually

                    newRotate[0] += dx * sens;
                    newRotate[1] -= dy * sens;

                    // Clamp phi
                    newRotate[1] = Math.max(-90, Math.min(90, newRotate[1]));

                    return {
                        ...state,
                        viewport: {
                            ...state.viewport,
                            rotate: newRotate
                        }
                    };
                });
            } else if (this.interactionMode === 'modify_velocity') {
                // Handle gizmo drag
                const state = this.getState();
                const selectedPlate = state.world.plates.find(p => p.id === state.world.selectedPlateId);
                if (selectedPlate) {
                    this.motionGizmo.updateDrag(
                        mousePos.x, mousePos.y,
                        this.projectionManager,
                        selectedPlate.center
                    );
                }
            } else if (this.interactionMode === 'drag_target') {
                this.updateDragTarget(e);
            }

            this.lastMousePos = { x: e.clientX, y: e.clientY };
            this.render();
        } else if (this.isDrawing && geoPos) {
            this.render();
            const projPos = this.projectionManager.project(geoPos);
            if (projPos) this.drawCurrentPolygonPreview(projPos);
        } else if (this.splitPreviewActive && this.splitPoints.length > 0 && geoPos) {
            this.render();
            // Draw the split polyline with current mouse position as temporary end
            this.drawSplitPolyline([...this.splitPoints, geoPos]);
        }
    }

    private handleMouseUp(_e: MouseEvent): void {
        const state = this.getState();

        // 1. Handle Box Selection (Explicit check, independent of dragging)
        if (this.isBoxSelecting && this.selectionBoxStart && this.selectionBoxEnd && this.boxSelectPlateId) {
            // Finalize box selection
            const x1 = Math.min(this.selectionBoxStart.x, this.selectionBoxEnd.x);
            const x2 = Math.max(this.selectionBoxStart.x, this.selectionBoxEnd.x);
            const y1 = Math.min(this.selectionBoxStart.y, this.selectionBoxEnd.y);
            const y2 = Math.max(this.selectionBoxStart.y, this.selectionBoxEnd.y);

            const selectedFeatures: string[] = [];

            // Only iterate the captured plate's features
            const targetPlate = state.world.plates.find(p => p.id === this.boxSelectPlateId);
            if (targetPlate && targetPlate.visible) {
                for (const feature of targetPlate.features) {
                    const proj = this.projectionManager.project(feature.position);
                    if (proj) {
                        if (proj[0] >= x1 && proj[0] <= x2 && proj[1] >= y1 && proj[1] <= y2) {
                            selectedFeatures.push(feature.id);
                        }
                    }
                }
            }

            if (selectedFeatures.length > 0) {
                this.onSelect(this.boxSelectPlateId, null, selectedFeatures);
            }

            this.isBoxSelecting = false;
            this.selectionBoxStart = null;
            this.selectionBoxEnd = null;
            this.boxSelectPlateId = null;
            this.render();
            return;
        }

        // 2. Handle Dragging
        if (this.isDragging) {
            // Apply gizmo changes if we were modifying velocity
            if (this.interactionMode === 'modify_velocity') {
                const result = this.motionGizmo.endDrag();
                const plateId = this.motionGizmo.getPlateId();
                if (result && plateId) {
                    this.onMotionChange(plateId, result.polePosition, result.rate);
                }
            } else if (this.interactionMode === 'drag_target') {
                if (this.ghostRotation) {
                    // Don't apply immediately. Enter fine-tuning mode.
                    this.isFineTuning = true;
                    this.ghostSpin = 0;
                    if (this.onMotionPreviewChange) this.onMotionPreviewChange(true);
                }
            }

        }

        this.isDragging = false;
        this.interactionMode = 'none';
        this.canvas.style.cursor = 'default';
        this.dragStartGeo = null;

        if (!this.isFineTuning) {
            this.ghostPlateId = null;
            this.ghostRotation = null;
        }

        if (this.isSpinning) {
            this.isSpinning = false;
        }
    }

    private handleDoubleClick(e: MouseEvent): void {
        const state = this.getState();
        if (state.activeTool === 'draw' && this.isDrawing && this.currentPolygon.length >= 3) {
            this.onDrawComplete([...this.currentPolygon]);
            this.currentPolygon = [];
            this.isDrawing = false;
            this.render();
        } else if (state.activeTool === 'poly_feature' && this.isDrawing && this.currentPolygon.length >= 3) {
            // Get the current poly color from the color picker
            const colorInput = document.getElementById('poly-feature-color') as HTMLInputElement;
            const fillColor = colorInput?.value || '#ff6b6b';
            if (this.onPolyFeatureComplete) {
                this.onPolyFeatureComplete([...this.currentPolygon], fillColor);
            }
            this.currentPolygon = [];
            this.isDrawing = false;
            this.render();
        } else if (state.activeTool === 'select') {
            // Handle Feature Multi-Select via Double-Click
            // Use the currently selected plate (don't require direct hit on feature)
            const selectedPlateId = state.world.selectedPlateId;
            if (!selectedPlateId) return; // No plate selected, nothing to do

            const mousePos = this.getMousePos(e);
            const hit = this.hitTest(mousePos);

            // Get the selected plate
            const plate = state.world.plates.find(p => p.id === selectedPlateId);
            if (!plate) return;

            // If we hit a feature, select all features of that type on this plate
            if (hit?.featureId) {
                const targetFeature = plate.features.find(f => f.id === hit.featureId);
                if (targetFeature) {
                    const featuresOfType = plate.features
                        .filter(f => f.type === targetFeature.type)
                        .map(f => f.id);

                    this.onSelect(selectedPlateId, hit.featureId, featuresOfType);
                }
            }
        }
    }

    private handleWheel(e: WheelEvent): void {
        e.preventDefault();
        const state = this.getState();

        // Zoom (Scale)
        const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
        const newScale = Math.max(50, Math.min(10000, state.viewport.scale * zoomFactor));

        this.setState(s => ({
            ...s,
            viewport: {
                ...s.viewport,
                scale: newScale
            }
        }));
        this.render();
    }

    private hitTest(mousePos: Point): { plateId: string; featureId?: string } | null {
        const state = this.getState();
        // Naive hit test using Project -> Distance for features
        // For polygons, d3-geo doesn't expose easy "contains" without importing d3-geo
        // Note: Using d3.geoContains is ideal but requires complex import setup if not using modules perfectly.
        // Let's rely on visual approximation:
        // Project polygon vertexes to screen, use pointInPolygon on screen.
        // This fails if polygon wraps around backside of globe.
        // But for MVP spherical update, it's okay.

        // Check features first
        for (const plate of state.world.plates) {
            if (!plate.visible) continue;
            for (const feature of plate.features) {
                const proj = this.projectionManager.project(feature.position);
                if (proj) {
                    const dist = Math.hypot(proj[0] - mousePos.x, proj[1] - mousePos.y);
                    if (dist < 20) return { plateId: plate.id, featureId: feature.id };
                }
            }
        }

        // Check Plates centroids? Or screen polygon
        // Checking screen polygon is risky with clipping.
        // Let's iterate plates, converting to GeoJSON and projecting.
        // Actually rendering using .isPointInPath() is the standard canvas way!

        // We can use the path generator to test!
        const path = this.projectionManager.getPathGenerator();

        // Iterate in reverse render order (top first)
        for (let i = state.world.plates.length - 1; i >= 0; i--) {
            const plate = state.world.plates[i];
            if (!plate.visible) continue;

            for (const poly of plate.polygons) {
                const geojson = toGeoJSON(poly);

                // Fix Winding for Hit Test
                if (geoArea(geojson) > 2 * Math.PI) {
                    geojson.geometry.coordinates[0].reverse();
                }

                this.ctx.beginPath();
                path(geojson);
                if (this.ctx.isPointInPath(mousePos.x, mousePos.y)) {
                    return { plateId: plate.id };
                }
            }
        }

        return null;
    }

    public render(): void {
        const state = this.getState();
        const width = this.canvas.width / (window.devicePixelRatio || 1);
        const height = this.canvas.height / (window.devicePixelRatio || 1);

        this.projectionManager.update(state.world.projection, state.viewport);
        const path = this.projectionManager.getPathGenerator();

        // Clear
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        const dpr = window.devicePixelRatio || 1;
        this.ctx.scale(dpr, dpr);

        // Dynamic Theme Colors
        const computedStyle = getComputedStyle(document.body);
        const clearColor = computedStyle.getPropertyValue('--bg-canvas-clear').trim() || '#1a3a4a';
        const oceanColor = computedStyle.getPropertyValue('--bg-globe-ocean').trim() || '#0f2634';

        this.ctx.fillStyle = clearColor;
        this.ctx.fillRect(0, 0, width, height);

        // Draw Globe Background (for orthographic)
        if (state.world.projection === 'orthographic') {
            this.ctx.beginPath();
            path({ type: 'Sphere' } as any);
            this.ctx.fillStyle = oceanColor;
            this.ctx.fill();
        }

        // Graticule
        if (state.world.showGrid) {
            const gridColor = computedStyle.getPropertyValue('--grid-color').trim() || 'rgba(255, 255, 255, 0.1)';
            this.ctx.strokeStyle = gridColor;
            this.ctx.lineWidth = state.world.globalOptions.gridThickness || 1;
            this.ctx.beginPath();
            path(geoGraticule()());
            this.ctx.stroke();
        }

        // Draw Plates
        // Sort plates by zIndex (default to 0 if undefined)
        const sortedPlates = [...state.world.plates].sort((a, b) => {
            const zA = a.zIndex ?? 0;
            const zB = b.zIndex ?? 0;
            return zA - zB;
        });

        for (const plate of sortedPlates) {
            if (!plate.visible) continue;

            // Lifecycle check: Only render valid plates for current time
            if (state.world.currentTime < plate.birthTime) continue;
            if (plate.deathTime !== null && state.world.currentTime >= plate.deathTime) continue;

            const isSelected = plate.id === state.world.selectedPlateId;

            let polygonsToDraw = plate.polygons;
            let transformedCenter = plate.center;

            if (this.ghostRotation?.plateId === plate.id) {
                const { axis, angle } = this.ghostRotation;
                const spinRad = -this.ghostSpin * Math.PI / 180; // Negative for CW alignment

                // Calculate transformed center for spin axis and widget
                const vCenter = latLonToVector(plate.center);
                const vRotCenter = rotateVector(vCenter, axis, angle);
                transformedCenter = vectorToLatLon(vRotCenter);

                polygonsToDraw = plate.polygons.map(poly => {
                    const newPoints = poly.points.map(pt => {
                        const v = latLonToVector(pt);
                        // 1. Drag Rotation
                        const v1 = rotateVector(v, axis, angle);
                        // 2. Spin Rotation (around transformed center)
                        const v2 = rotateVector(v1, vRotCenter, spinRad);
                        return vectorToLatLon(v2);
                    });
                    return { ...poly, points: newPoints };
                });
            }

            // Draw Polygons
            for (const poly of polygonsToDraw) {
                const geojson = toGeoJSON(poly);

                // Fix Winding: If area > Hemisphere, invert winding
                // This fixes pole-enclosure inversion issues.
                if (geoArea(geojson) > 2 * Math.PI) {
                    geojson.geometry.coordinates[0].reverse();
                }

                this.ctx.beginPath();
                path(geojson);
                this.ctx.fillStyle = plate.color;
                this.ctx.fill();

                this.ctx.strokeStyle = isSelected ? '#ffffff' : 'rgba(0,0,0,0.3)';
                this.ctx.lineWidth = isSelected ? 2 : 1;
                this.ctx.stroke();
            }

            // Draw Features (if visible)
            if (state.world.showFeatures) {
                const currentTime = state.world.currentTime;
                const showFuture = state.world.showFutureFeatures;

                for (const feature of plate.features) {
                    // Check if feature is within timeline
                    const isBorn = feature.generatedAt === undefined || feature.generatedAt <= currentTime;
                    const isDead = feature.deathTime !== undefined && feature.deathTime <= currentTime;
                    const isInTimeline = isBorn && !isDead;

                    // Skip if not in timeline and not showing future/past features
                    if (!isInTimeline && !showFuture) continue;

                    const isFeatureSelected = feature.id === state.world.selectedFeatureId ||
                        (state.world.selectedFeatureIds && state.world.selectedFeatureIds.includes(feature.id));

                    // Draw with reduced opacity if outside timeline
                    this.drawFeature(feature, isFeatureSelected, !isInTimeline);
                }
            }

            // Euler Pole Visualization
            if (state.world.showEulerPoles && plate.motion.eulerPole.visible) {
                this.drawEulerPole(plate.motion.eulerPole);
            }

            // Update/render motion gizmo for selected plate
            if (isSelected && state.activeTool === 'select') {
                this.motionGizmo.setPlate(plate.id, plate.motion.eulerPole);
                this.motionGizmo.render(this.ctx, this.projectionManager, plate.center);
            }

            // Draw Fine-Tuning Rotation Widget
            if (this.isFineTuning && this.ghostPlateId === plate.id) {
                this.drawRotationWidget(transformedCenter);
            }
        }

        // Draw Boundaries
        if (state.world.globalOptions.enableBoundaryVisualization && state.world.boundaries) {
            this.drawBoundaries(state.world.boundaries, path);
        }

        // Draw Links (if tool active or always?)
        // Let's draw if Link tool is active OR if a linked plate is selected
        if (state.activeTool === 'link' || (state.world.selectedPlateId && state.world.plates.find(p => p.id === state.world.selectedPlateId)?.linkedPlateIds?.length)) {
            this.drawLinks(state, path);
        }

        // Clear gizmo if no plate selected
        const selectedPlate = state.world.plates.find(p => p.id === state.world.selectedPlateId);
        if (!selectedPlate || state.activeTool !== 'select') {
            this.motionGizmo.clear();
        }

        // Current Drawing
        if (this.isDrawing && this.currentPolygon.length > 0) {
            this.ctx.beginPath();
            // LineString
            path({
                type: 'LineString',
                coordinates: this.currentPolygon
            } as any);
            this.ctx.strokeStyle = '#ffffff';
            this.ctx.lineWidth = 2;
            this.ctx.setLineDash([5, 5]);
            this.ctx.stroke();
            this.ctx.setLineDash([]);
        }

        // Split polyline preview
        if (this.splitPreviewActive && this.splitPoints.length > 0) {
            this.drawSplitPolyline(this.splitPoints);
        }

        // Render Selection Box
        if (this.isBoxSelecting && this.selectionBoxStart && this.selectionBoxEnd) {
            const x = Math.min(this.selectionBoxStart.x, this.selectionBoxEnd.x);
            const y = Math.min(this.selectionBoxStart.y, this.selectionBoxEnd.y);
            const w = Math.abs(this.selectionBoxEnd.x - this.selectionBoxStart.x);
            const h = Math.abs(this.selectionBoxEnd.y - this.selectionBoxStart.y);

            this.ctx.save();
            this.ctx.strokeStyle = '#00a8ff';
            this.ctx.lineWidth = 1;
            this.ctx.setLineDash([5, 3]);
            this.ctx.fillStyle = 'rgba(0, 168, 255, 0.1)';
            this.ctx.fillRect(x, y, w, h);
            this.ctx.strokeRect(x, y, w, h);
            this.ctx.restore();
        }
    }

    private drawLinks(state: AppState, path: any): void {
        const drawnPairs = new Set<string>();
        this.ctx.save();
        this.ctx.strokeStyle = '#00ffcc'; // Cyan/Teal for links
        this.ctx.lineWidth = 2;
        this.ctx.setLineDash([8, 4]);

        for (const plate of state.world.plates) {
            if (!plate.linkedPlateIds || plate.linkedPlateIds.length === 0) continue;

            for (const linkedId of plate.linkedPlateIds) {
                const partner = state.world.plates.find(p => p.id === linkedId);
                if (partner) {
                    // Unique key for pair
                    const key = [plate.id, linkedId].sort().join('-');
                    if (drawnPairs.has(key)) continue;
                    drawnPairs.add(key);

                    // Draw line
                    this.ctx.beginPath();
                    path({
                        type: 'LineString',
                        coordinates: [plate.center, partner.center]
                    } as any);
                    this.ctx.stroke();

                    // Draw Link Icon at midpoint?
                    // Maybe just the line is enough for now.
                }
            }
        }
        this.ctx.restore();
    }

    private drawBoundaries(boundaries: Boundary[], path: any): void {
        this.ctx.save();
        for (const b of boundaries) {
            // Determine color based on type
            if (b.type === 'convergent') {
                this.ctx.strokeStyle = '#ff3333'; // Red
                this.ctx.lineWidth = 3;
            } else if (b.type === 'divergent') {
                this.ctx.strokeStyle = '#3333ff'; // Blue
                this.ctx.lineWidth = 2;
            } else {
                this.ctx.strokeStyle = '#33ff33'; // Green
                this.ctx.lineWidth = 2;
            }

            // Draw points as a line?
            // Usually boundaries from collision are polygons (areas).
            // We can draw the outline
            if (b.points.length > 0) {
                const geojson = {
                    type: 'MultiLineString',
                    coordinates: b.points
                };
                this.ctx.beginPath();
                path(geojson as any);
                this.ctx.stroke();
            }
        }
        this.ctx.restore();
    }

    private drawFeature(feature: Feature, isSelected: boolean, isGhosted: boolean = false): void {
        // Set reduced opacity for features outside timeline
        if (isGhosted) {
            this.ctx.globalAlpha = 0.3;
        }

        // Handle poly_region features specially - they have their own polygon
        if (feature.type === 'poly_region' && feature.polygon && feature.polygon.length >= 3) {
            const path = this.projectionManager.getPathGenerator();
            const geojson = {
                type: 'Polygon' as const,
                coordinates: [[...feature.polygon, feature.polygon[0]]] // Close the polygon
            };

            // Fix Winding for Poly Features
            if (geoArea(geojson as any) > 2 * Math.PI) {
                geojson.coordinates[0].reverse();
            }

            this.ctx.beginPath();
            path(geojson as any);
            this.ctx.fillStyle = feature.fillColor || '#ff6b6b';
            this.ctx.globalAlpha = isGhosted ? 0.2 : 0.7; // Semi-transparent
            this.ctx.fill();
            this.ctx.globalAlpha = 1.0;

            if (isSelected) {
                this.ctx.strokeStyle = '#ffffff';
                this.ctx.lineWidth = 2;
                this.ctx.stroke();
            }

            if (isGhosted) this.ctx.globalAlpha = 1.0;
            return;
        }

        // Handle weakness feature
        if (feature.type === 'weakness') {
            const proj = this.projectionManager.project(feature.position);
            if (!proj) {
                if (isGhosted) this.ctx.globalAlpha = 1.0;
                return;
            }

            this.ctx.save();
            this.ctx.translate(proj[0], proj[1]);

            // Draw a jagged crack pattern
            this.ctx.strokeStyle = isSelected ? '#ffffff' : '#8b4513';
            this.ctx.lineWidth = isSelected ? 3 : 2;
            this.ctx.beginPath();
            this.ctx.moveTo(-8, -4);
            this.ctx.lineTo(-3, 2);
            this.ctx.lineTo(0, -2);
            this.ctx.lineTo(4, 4);
            this.ctx.lineTo(8, 0);
            this.ctx.stroke();

            this.ctx.restore();
            if (isGhosted) this.ctx.globalAlpha = 1.0;
            return;
        }

        const proj = this.projectionManager.project(feature.position);
        if (!proj) {
            if (isGhosted) this.ctx.globalAlpha = 1.0;
            return; // Behind globe or invalid
        }

        const size = 12 * feature.scale;
        this.ctx.save();
        this.ctx.translate(proj[0], proj[1]);
        this.ctx.rotate(feature.rotation * Math.PI / 180);

        const options = { isSelected };
        switch (feature.type) {
            case 'mountain': drawMountainIcon(this.ctx, size, options); break;
            case 'volcano': drawVolcanoIcon(this.ctx, size, options); break;
            case 'hotspot': drawHotspotIcon(this.ctx, size, options); break;
            case 'rift': drawRiftIcon(this.ctx, size, options); break;
            case 'trench': drawTrenchIcon(this.ctx, size, options); break;
            case 'island': drawIslandIcon(this.ctx, size, options); break;
        }
        this.ctx.restore();

        if (isGhosted) this.ctx.globalAlpha = 1.0;
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

        // Draw little rotation arrows?
        this.ctx.strokeStyle = 'white';
        this.ctx.beginPath();
        this.ctx.arc(0, 0, 8, 0, Math.PI * 1.5);
        this.ctx.stroke();

        this.ctx.restore();
    }

    private drawSplitPolyline(points: Coordinate[]): void {
        if (points.length < 2) return;

        this.ctx.beginPath();
        for (let i = 0; i < points.length; i++) {
            const proj = this.projectionManager.project(points[i]);
            if (!proj) continue;

            if (i === 0) {
                this.ctx.moveTo(proj[0], proj[1]);
            } else {
                this.ctx.lineTo(proj[0], proj[1]);
            }
        }

        this.ctx.strokeStyle = '#ff4444';
        this.ctx.lineWidth = 3;
        this.ctx.setLineDash([8, 4]);
        this.ctx.stroke();
        this.ctx.setLineDash([]);

        // Draw points as circles
        for (const point of points) {
            const proj = this.projectionManager.project(point);
            if (proj) {
                this.ctx.beginPath();
                this.ctx.arc(proj[0], proj[1], 5, 0, Math.PI * 2);
                this.ctx.fillStyle = '#ff4444';
                this.ctx.fill();
                this.ctx.strokeStyle = '#fff';
                this.ctx.lineWidth = 2;
                this.ctx.stroke();
            }
        }
    }

    private drawRotationWidget(center: Coordinate): void {
        const proj = this.projectionManager.project(center);
        if (!proj) return;

        const [cx, cy] = proj;
        const radius = 60; // Pixels

        this.ctx.save();

        // Draw Ring
        this.ctx.beginPath();
        this.ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        this.ctx.strokeStyle = '#ffff00';
        this.ctx.lineWidth = 2;
        this.ctx.stroke();

        // Handle position logic
        const handleAngle = (this.ghostSpin - 90) * Math.PI / 180;
        const hx = cx + Math.cos(handleAngle) * radius;
        const hy = cy + Math.sin(handleAngle) * radius;

        this.ctx.beginPath();
        this.ctx.arc(hx, hy, 8, 0, Math.PI * 2);
        this.ctx.fillStyle = this.isSpinning ? '#ffffff' : '#ffff00';
        this.ctx.fill();
        this.ctx.stroke();

        this.ctx.restore();
    }

    // Public methods for motion apply/cancel
    public applyMotion(): void {
        const state = this.getState();
        if (this.isFineTuning && this.ghostRotation && this.onDragTargetRequest) {
            const plate = state.world.plates.find(p => p.id === this.ghostRotation!.plateId);
            if (plate) {
                // Calculate Transformed Center (after drag)
                const vCenter = latLonToVector(plate.center);
                const vCenterRot = rotateVector(vCenter, this.ghostRotation.axis, this.ghostRotation.angle);

                // Q_drag
                const qDrag = quatFromAxisAngle(this.ghostRotation.axis, this.ghostRotation.angle);

                // Q_spin (around transformed center)
                const spinRad = -this.ghostSpin * Math.PI / 180;
                const qSpin = quatFromAxisAngle(vCenterRot, spinRad);

                // Q_total = Q_spin * Q_drag
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

    public applySplit(): void {
        if (this.splitPoints.length >= 2) {
            this.onSplitApply([...this.splitPoints]);
        }
        this.cancelSplit();
    }

    public cancelSplit(): void {
        this.splitPoints = [];
        this.splitPreviewActive = false;
        this.onSplitPreviewChange(false);
        this.render();
    }

    public isSplitPreviewActive(): boolean {
        return this.splitPreviewActive;
    }

    private drawCurrentPolygonPreview(projPos: [number, number]): void {
        const lastGeo = this.currentPolygon[this.currentPolygon.length - 1];
        const lastProj = this.projectionManager.project(lastGeo);
        if (lastProj) {
            this.ctx.beginPath();
            this.ctx.moveTo(lastProj[0], lastProj[1]);
            this.ctx.lineTo(projPos[0], projPos[1]);
            this.ctx.strokeStyle = 'white';
            this.ctx.setLineDash([2, 2]);
            this.ctx.stroke();
            this.ctx.setLineDash([]);
        }
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

    public cancelDrawing(): void {
        this.currentPolygon = [];
        this.isDrawing = false;
        this.render();
    }

    private updateDragTarget(e: MouseEvent): void {
        const geoPos = this.getGeoFromMouse(e);
        if (!geoPos || !this.dragStartGeo || !this.ghostPlateId) return;

        const state = this.getState();
        const p = state.world.plates.find(pl => pl.id === this.ghostPlateId);
        if (!p) return;

        // 1. Calculate Drag Rotation Axis & Angle (StartMouse -> CurrMouse)
        const startMouseVec = latLonToVector(this.dragStartGeo);
        const currMouseVec = latLonToVector(geoPos);

        let axis = cross(startMouseVec, currMouseVec);
        const len = Math.sqrt(axis.x * axis.x + axis.y * axis.y + axis.z * axis.z);

        if (len < 0.001) return;
        axis = normalize(axis);

        let dotVal = dot(startMouseVec, currMouseVec);
        dotVal = Math.max(-1, Math.min(1, dotVal));
        const angleRad = Math.acos(dotVal);

        // Calculate Delta Quaternion
        const qDelta = quatFromAxisAngle(axis, angleRad);
        const qBase = this.dragBaseQuat || { w: 1, x: 0, y: 0, z: 0 };

        // Combine: Q_final = Q_delta * Q_base
        const qFinal = quatMultiply(qDelta, qBase);

        const res = axisAngleFromQuat(qFinal);

        // 2. Set Ghost Rotation
        this.ghostRotation = { plateId: p.id, axis: res.axis, angle: res.angle };
        this.render();
    }

    public destroy(): void {
        this.stopRenderLoop();
        window.removeEventListener('resize', () => this.resizeCanvas());
    }
}
