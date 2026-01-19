import { AppState, Point, Feature, FeatureType, Coordinate, EulerPole } from '../types';
import { ProjectionManager } from './ProjectionManager';
import { geoGraticule } from 'd3-geo';
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

export class CanvasManager {
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private animationId: number | null = null;
    private projectionManager: ProjectionManager;

    // Drag state
    private isDragging = false;
    private lastMousePos: Point = { x: 0, y: 0 };
    private interactionMode: 'pan' | 'modify_velocity' | 'none' = 'none';

    // Drawing state
    private currentPolygon: Coordinate[] = [];
    private isDrawing = false;

    // Split state - now supports polyline
    private splitPoints: Coordinate[] = [];
    private splitPreviewActive = false;

    // Motion gizmo
    private motionGizmo: MotionGizmo = new MotionGizmo();

    constructor(
        canvas: HTMLCanvasElement,
        private getState: () => AppState,
        private setState: (updater: (state: AppState) => AppState) => void,
        private onDrawComplete: (points: Coordinate[]) => void,
        private onFeaturePlace: (position: Coordinate, type: FeatureType) => void,
        private onSelect: (plateId: string | null, featureId: string | null) => void,
        private onSplitApply: (points: Coordinate[]) => void,
        private onSplitPreviewChange: (active: boolean) => void,
        private onMotionChange: (plateId: string, pole: Coordinate, rate: number) => void
    ) {
        this.canvas = canvas;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Could not get 2D context');
        this.ctx = ctx;

        this.projectionManager = new ProjectionManager(ctx);

        this.setupEventListeners();
        // Wait for next frame to ensure parent is sized
        requestAnimationFrame(() => this.resizeCanvas());
        window.addEventListener('resize', () => this.resizeCanvas());
    }

    private resizeCanvas(): void {
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

    private setupEventListeners(): void {
        this.canvas.addEventListener('mousedown', this.handleMouseDown.bind(this));
        this.canvas.addEventListener('mousemove', this.handleMouseMove.bind(this));
        this.canvas.addEventListener('mouseup', this.handleMouseUp.bind(this));
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

        if (e.button === 0) {
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
                    this.onSelect(hit?.plateId ?? null, hit?.featureId ?? null);
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
            }
        }
    }

    private handleMouseMove(e: MouseEvent): void {
        const geoPos = this.getGeoFromMouse(e);
        const mousePos = this.getMousePos(e);

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
        if (this.isDragging) {
            // Apply gizmo changes if we were modifying velocity
            if (this.interactionMode === 'modify_velocity') {
                const result = this.motionGizmo.endDrag();
                const plateId = this.motionGizmo.getPlateId();
                if (result && plateId) {
                    this.onMotionChange(plateId, result.polePosition, result.rate);
                }
            }

            this.isDragging = false;
            this.interactionMode = 'none';
            this.canvas.style.cursor = 'default';
        }
        // Note: Split is now applied via applySplit() method, not on mouseup
    }

    private handleDoubleClick(_e: MouseEvent): void {
        const state = this.getState();
        if (state.activeTool === 'draw' && this.isDrawing && this.currentPolygon.length >= 3) {
            this.onDrawComplete([...this.currentPolygon]);
            this.currentPolygon = [];
            this.isDrawing = false;
            this.render();
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
        this.ctx.fillStyle = '#1a3a4a';
        this.ctx.fillRect(0, 0, width, height);

        // Draw Globe Background (for orthographic)
        if (state.world.projection === 'orthographic') {
            this.ctx.beginPath();
            path({ type: 'Sphere' } as any);
            this.ctx.fillStyle = '#0f2634';
            this.ctx.fill();
        }

        // Graticule
        if (state.world.showGrid) {
            this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
            this.ctx.lineWidth = 1;
            this.ctx.beginPath();
            path(geoGraticule()());
            this.ctx.stroke();
        }

        // Draw Plates
        for (const plate of state.world.plates) {
            if (!plate.visible) continue;

            // Lifecycle check: Only render valid plates for current time
            if (state.world.currentTime < plate.birthTime) continue;
            if (plate.deathTime !== null && state.world.currentTime >= plate.deathTime) continue;

            const isSelected = plate.id === state.world.selectedPlateId;

            // Draw Polygons
            for (const poly of plate.polygons) {
                const geojson = toGeoJSON(poly);
                this.ctx.beginPath();
                path(geojson);
                this.ctx.fillStyle = plate.color;
                this.ctx.fill();

                this.ctx.strokeStyle = isSelected ? '#ffffff' : 'rgba(0,0,0,0.3)';
                this.ctx.lineWidth = isSelected ? 2 : 1;
                this.ctx.stroke();
            }

            // Draw Features
            for (const feature of plate.features) {
                this.drawFeature(feature, feature.id === state.world.selectedFeatureId);
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
    }

    private drawFeature(feature: Feature, isSelected: boolean): void {
        const proj = this.projectionManager.project(feature.position);
        if (!proj) return; // Behind globe or invalid

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

    // Public methods for split apply/cancel
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

    public destroy(): void {
        this.stopRenderLoop();
        window.removeEventListener('resize', () => this.resizeCanvas());
    }
}
