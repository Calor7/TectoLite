import { AppState, Point, Feature, FeatureType, Coordinate, EulerPole, InteractionMode, Boundary, PaintStroke, generateId, PaintMode } from '../types';
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
import { latLonToVector, vectorToLatLon, rotateVector, cross, dot, normalize, Vector3, quatFromAxisAngle, quatMultiply, axisAngleFromQuat, Quaternion, distance } from '../utils/sphericalMath';

export class CanvasManager {
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private animationId: number | null = null;
    private projectionManager: ProjectionManager;

    // Drag state
    private isDragging = false;
    private lastMousePos: Point = { x: 0, y: 0 };
    private currentMouseGeo: Coordinate | null = null; // Track current mouse for previews
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

    // Image Overlay cache
    private cachedOverlayImages: Map<string, HTMLImageElement> = new Map();

    // Motion gizmo
    private motionGizmo: MotionGizmo = new MotionGizmo();

    // Edit Tool State
    private editHoveredVertex: { plateId: string; polyIndex: number; vertexIndex: number } | null = null;
    private editHoveredEdge: { plateId: string; polyIndex: number; vertexIndex: number; pointOnEdge: Coordinate } | null = null;
    private editDragState: { 
        operation: 'move_vertex' | 'insert_vertex'; 
        plateId: string; 
        polyIndex: number; 
        vertexIndex: number; 
        startPoint: Coordinate 
    } | null = null;
    // We store the polygons being edited temporarily here
    private editTempPolygons: { plateId: string; polygons: any[] } | null = null;

    // Paint Tool State
    private isPainting = false;
    private currentPaintStroke: Coordinate[] = [];
    private paintMode: PaintMode = 'brush';
    private paintConfig = {
        color: '#ff0000',
        width: 5,
        opacity: 0.8
    };
    private polyFillPoints: Coordinate[] = [];
    private polyFillConfig = {
        color: '#ff0000',
        opacity: 0.8
    };

    constructor(
        canvas: HTMLCanvasElement,
        private getState: () => AppState,
        private setState: (updater: (state: AppState) => AppState) => void,
        private onDrawComplete: (points: Coordinate[]) => void,
        private onFeaturePlace: (position: Coordinate, type: FeatureType) => void,
        private onSelect: (plateId: string | null, featureId: string | null, featureIds?: string[], plumeId?: string | null, paintStrokeId?: string | null) => void,
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

    private distToSegmentSquared(p: {x:number, y:number}, v: {x:number, y:number}, w: {x:number, y:number}) {
        const l2 = (v.x - w.x)**2 + (v.y - w.y)**2;
        if (l2 === 0) return (p.x - v.x)**2 + (p.y - v.y)**2;
        let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
        t = Math.max(0, Math.min(1, t));
        return (p.x - (v.x + t * (w.x - v.x)))**2 + (p.y - (v.y + t * (w.y - v.y)))**2;
    }

    private getT(p: {x:number, y:number}, v: {x:number, y:number}, w: {x:number, y:number}) {
        const l2 = (v.x - w.x)**2 + (v.y - w.y)**2;
        if (l2 === 0) return 0;
        let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
        return Math.max(0, Math.min(1, t));
    }

    private findNearestBoundaryElement(mouseX: number, mouseY: number): { type: 'vertex' | 'edge', data: any } | null {
        const state = this.getState();
        const targetPlateId = state.world.selectedPlateId;
        if(!targetPlateId) return null;

        const plate = state.world.plates.find(p => p.id === targetPlateId);
        if(!plate || !plate.visible) return null;

        const polygons = this.editTempPolygons && this.editTempPolygons.plateId === plate.id 
            ? this.editTempPolygons.polygons 
            : plate.polygons;

        let closestVertex: { plateId: string; polyIndex: number; vertexIndex: number } | null = null;
        let minVertexDist = 8; // px

        let closestEdge: { plateId: string; polyIndex: number; vertexIndex: number; pointOnEdge: Coordinate } | null = null;
        let minEdgeDist = 8; // px

        // Get Mouse Geo Position for spherical calculations
        const mouseGeo = this.projectionManager.invert(mouseX, mouseY);
        const mouseVec = mouseGeo ? latLonToVector(mouseGeo) : null;

        polygons.forEach((poly: any, polyIndex: number) => {
            const points = poly.points as Coordinate[];
            const screenPoints = points.map(p => this.projectionManager.project(p));

            for(let i=0; i<screenPoints.length; i++) {
                const p = screenPoints[i];
                if(!p) continue;
                
                // Vertex check (Screen Space is accurate for user intention)
                const d = Math.sqrt((p[0]-mouseX)**2 + (p[1]-mouseY)**2);
                if(d < minVertexDist) {
                    minVertexDist = d;
                    closestVertex = { plateId: plate.id, polyIndex, vertexIndex: i };
                }

                // Edge check
                if (!closestVertex) { // Only check edge if not hovering a vertex
                    const nextIdx = (i+1) % screenPoints.length;
                    const pNext = screenPoints[nextIdx];
                    if(!pNext) continue;

                    let currentEdgeDist = 9999;
                    let currentEdgePoint: Coordinate | null = null;
                    let isGeodesicHit = false;

                    // 1. Geodesic Check (Priority for curved paths)
                    if (mouseVec) {
                        const vA = latLonToVector(points[i]);
                        const vB = latLonToVector(points[nextIdx]);
                        let N = cross(vA, vB);
                        const lenN = Math.sqrt(N.x*N.x + N.y*N.y + N.z*N.z);

                        if (lenN > 0.001) {
                            N = { x: N.x/lenN, y: N.y/lenN, z: N.z/lenN };
                            const distPlane = Math.abs(dot(mouseVec, N));

                            // Threshold: sin(2 degrees) ~= 0.035
                            if (distPlane < 0.035) {
                                const dotMN = dot(mouseVec, N);
                                let P = {
                                    x: mouseVec.x - dotMN * N.x,
                                    y: mouseVec.y - dotMN * N.y,
                                    z: mouseVec.z - dotMN * N.z
                                };
                                const lenP = Math.sqrt(P.x*P.x + P.y*P.y + P.z*P.z);
                                if (lenP > 0) {
                                    P = { x: P.x/lenP, y: P.y/lenP, z: P.z/lenP };
                                    const dA = Math.acos(Math.min(1, Math.max(-1, dot(vA, P))));
                                    const dB = Math.acos(Math.min(1, Math.max(-1, dot(P, vB))));
                                    const dAB = Math.acos(Math.min(1, Math.max(-1, dot(vA, vB))));
                                    
                                    if (Math.abs((dA + dB) - dAB) < 0.05) {
                                        currentEdgePoint = vectorToLatLon(P);
                                        currentEdgeDist = 0; // High priority (0 screen distance equivalent)
                                        isGeodesicHit = true;
                                    }
                                }
                            }
                        }
                    }

                    // 2. Screen Linear Check (Fallback & Distance metric)
                    // If we didn't hit geodesically (or even if we did, we might want to check screen dist for very zoomed cases?),
                    // actually if geodesic hit, we trust it.
                    // If NO geodesic hit, we check screen chord.
                    if (!isGeodesicHit) {
                        const dist2 = this.distToSegmentSquared({x: mouseX, y: mouseY}, {x: p[0], y: p[1]}, {x: pNext[0], y: pNext[1]});
                        const dEdge = Math.sqrt(dist2);
                        if (dEdge < minEdgeDist) { // Only worth refining if better than current global best
                            const t = this.getT({x: mouseX, y: mouseY}, {x: p[0], y: p[1]}, {x: pNext[0], y: pNext[1]});
                            const screenX = p[0] + t * (pNext[0]-p[0]);
                            const screenY = p[1] + t * (pNext[1]-p[1]);
                            const geo = this.projectionManager.invert(screenX, screenY);
                            if (geo) {
                                currentEdgePoint = geo;
                                currentEdgeDist = dEdge;
                            }
                        }
                    }

                    // Update Best Edge
                    if (currentEdgePoint && currentEdgeDist < minEdgeDist) {
                        minEdgeDist = currentEdgeDist;
                        closestEdge = { plateId: plate.id, polyIndex, vertexIndex: i, pointOnEdge: currentEdgePoint }; 
                    }
                }
            }
        });

        if(closestVertex) return { type: 'vertex', data: closestVertex };
        if(closestEdge) return { type: 'edge', data: closestEdge };
        return null;
    }

    private updateEditDrag(geoPos: Coordinate) {
        if (!this.editDragState) return;

        // Init temp if needed
        if (!this.editTempPolygons || this.editTempPolygons.plateId !== this.editDragState.plateId) {
             const state = this.getState();
             const plate = state.world.plates.find(p => p.id === this.editDragState!.plateId);
             if (plate) {
                 this.editTempPolygons = {
                     plateId: plate.id,
                     polygons: JSON.parse(JSON.stringify(plate.polygons))
                 };
             }
        }

        if (this.editTempPolygons) {
            const poly = this.editTempPolygons.polygons[this.editDragState.polyIndex];
            if (poly) {
                poly.points[this.editDragState.vertexIndex] = geoPos;
            }
        }
    }

    private startInsertDrag(edge: { plateId: string; polyIndex: number; vertexIndex: number; pointOnEdge: Coordinate }) {
        const state = this.getState();
        const plate = state.world.plates.find(p => p.id === edge.plateId);
        if (!plate) return;

        // Always ensure temp polygons exist
        if (!this.editTempPolygons || this.editTempPolygons.plateId !== plate.id) {
             this.editTempPolygons = {
                 plateId: plate.id,
                 polygons: JSON.parse(JSON.stringify(plate.polygons))
             };
        }

        const poly = this.editTempPolygons!.polygons[edge.polyIndex];
        // Insert
        let insertIdx = edge.vertexIndex + 1;
        poly.points.splice(insertIdx, 0, edge.pointOnEdge);

        this.editDragState = {
            operation: 'insert_vertex',
            plateId: edge.plateId,
            polyIndex: edge.polyIndex,
            vertexIndex: insertIdx,
            startPoint: edge.pointOnEdge
        };
    }
    
    public getEditResult(): { plateId: string, polygons: any[] } | null {
        return this.editTempPolygons;
    }

    public cancelEdit() {
        this.editTempPolygons = null;
        this.editDragState = null;
        this.render();
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



    public setTheme(_theme: string): void {
        this.render();
    }

    private setupEventListeners(): void {
        this.canvas.addEventListener('mousedown', this.handleMouseDown.bind(this));
        // Bind to window to catch drags outside canvas
        window.addEventListener('mousemove', this.handleMouseMove.bind(this));
        window.addEventListener('mouseup', this.handleMouseUp.bind(this));

        this.canvas.addEventListener('wheel', this.handleWheel.bind(this));
        this.canvas.addEventListener('dblclick', this.handleDoubleClick.bind(this));
        this.canvas.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this.handleRightClick(e);
        });

        window.addEventListener('keydown', this.handleKeyDown.bind(this));
    }

    // Helper to get [lon, lat] from mouse
    private getGeoFromMouse(e: MouseEvent): Coordinate | null {
        const rect = this.canvas.getBoundingClientRect();
        return this.projectionManager.invert(e.clientX - rect.left, e.clientY - rect.top);
    }

    private handleRightClick(e: MouseEvent): void {
        const state = this.getState();
        const mousePos = this.getMousePos(e);

        if (state.activeTool === 'edit') {
            // Check if we clicked on a vertex
            const nearest = this.findNearestBoundaryElement(mousePos.x, mousePos.y);
            if (nearest && nearest.type === 'vertex') {
                this.deleteVertex(nearest.data);
                this.render();
            }
            return;
        }

        if ((state.activeTool === 'draw' || state.activeTool === 'poly_feature') && this.isDrawing) {
            if (this.currentPolygon.length > 0) {
                this.currentPolygon.pop();
                if (this.currentPolygon.length === 0) this.isDrawing = false;
                if (this.onDrawUpdate) this.onDrawUpdate(this.currentPolygon.length);
                this.render();
            }
        } else if (state.activeTool === 'split' && this.splitPoints.length > 0) {
            this.splitPoints.pop();
            if (this.onDrawUpdate && state.activeTool === 'split') this.onDrawUpdate(this.splitPoints.length);
            this.render();
        } else if (state.activeTool === 'paint') {
            // Paint tool undo
            if (this.paintMode === 'brush' && this.currentPaintStroke.length > 0) {
                // Undo last brush point (while painting)
                this.currentPaintStroke.pop();
                this.render();
            } else if (this.paintMode === 'poly_fill' && this.polyFillPoints.length > 0) {
                // Undo last placed polygon point
                this.polyFillPoints.pop();
                this.render();
            } else if (this.paintMode === 'brush' && this.isPainting === false && state.world.selectedPlateId) {
                // Undo last committed brush stroke
                const plate = state.world.plates.find(p => p.id === state.world.selectedPlateId);
                if (plate && plate.paintStrokes && plate.paintStrokes.length > 0) {
                    plate.paintStrokes.pop();
                    this.render();
                }
            }
        }
    }

    private deleteVertex(vertexData: { plateId: string; polyIndex: number; vertexIndex: number }) {
        const state = this.getState();
        const plate = state.world.plates.find(p => p.id === vertexData.plateId);
        if (!plate) return;

        // Ensure Temp Polygons (Copy-on-write)
        if (!this.editTempPolygons || this.editTempPolygons.plateId !== plate.id) {
             this.editTempPolygons = {
                 plateId: plate.id,
                 polygons: JSON.parse(JSON.stringify(plate.polygons))
             };
        }

        const poly = this.editTempPolygons!.polygons[vertexData.polyIndex];
        if (poly && poly.points.length > 3) {
            poly.points.splice(vertexData.vertexIndex, 1);
            // Notify change
            if (this.onEditPending) this.onEditPending(true);
        } else {
             console.warn("Cannot delete vertex: Polygon too small or not found");
        }
    }

    private handleKeyDown(e: KeyboardEvent): void {
        const state = this.getState();
        if (e.key === 'Enter') {
            if (state.activeTool === 'draw' && this.isDrawing && this.currentPolygon.length >= 3) {
                this.onDrawComplete([...this.currentPolygon]);
                this.currentPolygon = [];
                this.isDrawing = false;
                this.render();
            } else if (state.activeTool === 'split' && this.splitPoints.length >= 2) {
                this.onSplitApply([...this.splitPoints]);
                this.splitPoints = [];
                this.splitPreviewActive = false;
                this.onSplitPreviewChange(false);
                this.render();
            } else if (state.activeTool === 'edit' && this.editTempPolygons) {
                // Trigger Apply
                document.getElementById('btn-edit-apply')?.click();
            }
        } else if (e.key === 'Escape') {
            // Cancel drawing/splitting
            if (this.isDrawing) {
                this.isDrawing = false;
                this.currentPolygon = [];
                this.render();
            }
            if (this.splitPoints.length > 0) {
                this.splitPoints = [];
                this.splitPreviewActive = false;
                this.onSplitPreviewChange(false);
                this.render();
            }
        }
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
                        if (this.onDrawUpdate) this.onDrawUpdate(this.currentPolygon.length);
                        this.render();
                    }
                    break;

                case 'edit':
                    if (this.editHoveredVertex) {
                         // Click on vertex - Start Move
                         // Check for Modifier (Alt) for delete?
                         // For now, simple drag
                         this.editDragState = {
                             operation: 'move_vertex',
                             plateId: this.editHoveredVertex.plateId,
                             polyIndex: this.editHoveredVertex.polyIndex,
                             vertexIndex: this.editHoveredVertex.vertexIndex,
                             startPoint: geoPos!
                         };
                         this.isDragging = true;
                    } else if (this.editHoveredEdge) {
                        this.startInsertDrag(this.editHoveredEdge);
                        this.isDragging = true;
                    }
                    break;

                case 'feature':
                    if (geoPos) this.onFeaturePlace(geoPos, state.activeFeatureType);
                    break;

                case 'flowline':
                    if (geoPos) {
                        const hit = this.hitTest(mousePos);
                        if (hit?.plateId) {
                            // First select the plate, then place the feature on it
                            this.onSelect(hit.plateId, null);
                            this.onFeaturePlace(geoPos, 'flowline');
                        }
                    }
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
                        if (hit && 'plumeId' in hit && hit.plumeId) {
                            this.onSelect(null, null, [], hit.plumeId);
                        } else if (hit && 'paintStrokeId' in hit && hit.paintStrokeId) {
                            // Paint stroke selected
                            this.onSelect(hit.plateId ?? null, null, [], null, hit.paintStrokeId);
                        } else {
                            this.onSelect(hit?.plateId ?? null, hit?.featureId ?? null);
                        }
                    }
                    break;

                case 'split':
                    if (geoPos) {
                        // Add point to split polyline
                        this.splitPoints.push(geoPos);
                        if (this.onDrawUpdate) this.onDrawUpdate(this.splitPoints.length);
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

                case 'paint':
                    if (state.world.selectedPlateId && geoPos) {
                        if (this.paintMode === 'brush') {
                            this.isPainting = true;
                            this.currentPaintStroke = [geoPos];
                        } else {
                            // Poly fill mode
                            this.polyFillPoints.push(geoPos);
                        }
                        this.render();
                    }
                    break;
            }
        }
    }

    private handleMouseMove(e: MouseEvent): void {
        const state = this.getState(); // Ensure state is available
        const geoPos = this.getGeoFromMouse(e);
        const mousePos = this.getMousePos(e);
        this.currentMouseGeo = geoPos; // Store for previews

        if (state.activeTool === 'draw' && this.isDrawing) {
            this.render(); // Trigger render for dynamic distance preview
        }

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

            // Handle Edit Mode Dragging
            if (this.editDragState && state.activeTool === 'edit' && geoPos) {
                 this.updateEditDrag(geoPos);
                 this.render();
                 this.lastMousePos = { x: e.clientX, y: e.clientY };
                 return;
            }

            if (this.interactionMode === 'pan') {
                this.setState(state => {
                    // Dynamic Sensitivity based on Zoom Level
                    // Scale corresponds to pixels per radian at the center of the projection
                    // We want 1 pixel drag to equal ~1 pixel surface movement
                    // degrees = pixels * (180 / (PI * scale))
                    const sens = (180 / Math.PI) / (state.viewport.scale || 250);

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
                    const result = this.motionGizmo.updateDrag(
                        mousePos.x, mousePos.y,
                        this.projectionManager,
                        selectedPlate.center
                    );
                    if (result && result.rate !== undefined && this.onGizmoUpdate) {
                        this.onGizmoUpdate(result.rate);
                    }
                }
            } else if (this.interactionMode === 'drag_target') {
                this.updateDragTarget(e);
            }

            this.lastMousePos = { x: e.clientX, y: e.clientY };
            this.render();
        } else if (this.isPainting && state.activeTool === 'paint' && geoPos) {
            this.currentPaintStroke.push(geoPos);
            this.render();
        } else if (state.activeTool === 'paint' && this.paintMode === 'poly_fill' && !this.isPainting && geoPos) {
            // Show preview of poly fill while moving mouse
            this.render();
            if (this.polyFillPoints.length > 0) {
                this.drawPolyFillPreview([...this.polyFillPoints, geoPos]);
            }
        } else if (state.activeTool === 'paint' && this.paintMode === 'brush' && !this.isPainting && geoPos) {
            // Show brush preview
            this.render();
            if (state.world.selectedPlateId) {
                this.drawBrushPreview(geoPos);
            }
        } else if (this.isDrawing && geoPos) {
            this.render();
            const projPos = this.projectionManager.project(geoPos);
            if (projPos) this.drawCurrentPolygonPreview(projPos);
        } else if (this.splitPreviewActive && this.splitPoints.length > 0 && geoPos) {
            this.render();
            // Draw the split polyline with current mouse position as temporary end
            this.drawSplitPolyline([...this.splitPoints, geoPos]);
        } else if (state.activeTool === 'edit') {
            if (this.isDragging && this.editDragState && geoPos) {
                 this.updateEditDrag(geoPos);
                 this.render();
            } else {
                 const nearest = this.findNearestBoundaryElement(mousePos.x, mousePos.y);
                 if (nearest) {
                     this.canvas.style.cursor = nearest.type === 'vertex' ? 'move' : 'copy';
                     if (nearest.type === 'vertex') {
                         this.editHoveredVertex = nearest.data;
                         this.editHoveredEdge = null;
                     } else {
                         this.editHoveredEdge = nearest.data;
                         this.editHoveredVertex = null;
                     }
                 } else {
                     this.editHoveredVertex = null;
                     this.editHoveredEdge = null;
                     this.canvas.style.cursor = 'default';
                 }
                 this.render();
            }
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
            if (this.editDragState) {
                if (this.onEditPending) this.onEditPending(true);
                this.editDragState = null;
                this.isDragging = false;
                this.render();
                return;
            }
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

        // Handle paint tool mouse up
        if (this.isPainting && state.activeTool === 'paint') {
            this.isPainting = false;
            this.commitPaintStroke();
            this.render();
            return;
        }

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
        } else if (state.activeTool === 'split' && this.splitPoints.length >= 2) {
            this.onSplitApply([...this.splitPoints]);
            this.splitPoints = [];
            this.splitPreviewActive = false;
            this.onSplitPreviewChange(false);
            this.render();
        } else if (state.activeTool === 'paint' && this.paintMode === 'poly_fill' && this.polyFillPoints.length >= 3) {
            this.applyPolyFillPaint();
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

    private hitTest(mousePos: Point): { plateId?: string; featureId?: string; plumeId?: string; paintStrokeId?: string } | null {
        const state = this.getState();
        // Naive hit test using Project -> Distance for features

        // 0. Check Plumes (Global features) - highest priority
        if (state.world.mantlePlumes) {
            for (const plume of state.world.mantlePlumes) {
                // if (!plume.active) continue; // Allow selecting inactive plumes
                const proj = this.projectionManager.project(plume.position);
                if (proj) {
                    const dist = Math.hypot(proj[0] - mousePos.x, proj[1] - mousePos.y);
                    // Plumes are large targets
                    if (dist < 20) return { plumeId: plume.id };
                }
            }
        }

        // Check features first
        for (const plate of state.world.plates) {
            if (!plate.visible) continue;
            // Lifecycle check: Only hit test valid plates for current time
            if (state.world.currentTime < plate.birthTime || (plate.deathTime !== null && state.world.currentTime >= plate.deathTime)) continue;
            for (const feature of plate.features) {
                const proj = this.projectionManager.project(feature.position);
                if (proj) {
                    const dist = Math.hypot(proj[0] - mousePos.x, proj[1] - mousePos.y);
                    if (dist < 20) return { plateId: plate.id, featureId: feature.id };
                }
            }
        }

        // Check paint strokes (before plates, after features)
        if (state.world.showPaint) {
            for (const plate of state.world.plates) {
                if (!plate.visible || !plate.paintStrokes) continue;
                if (state.world.currentTime < plate.birthTime || (plate.deathTime !== null && state.world.currentTime >= plate.deathTime)) continue;

                for (const stroke of plate.paintStrokes) {
                    // Skip strokes not yet created (future)
                    if (stroke.birthTime !== undefined && stroke.birthTime > state.world.currentTime && !state.world.showFutureFeatures) continue;

                    // Check proximity to stroke path
                    const hitDist = stroke.width + 8; // Hit margin
                    for (let i = 0; i < stroke.points.length - 1; i++) {
                        const worldP1 = this.plateLocalToWorld(stroke.points[i], plate.center);
                        const worldP2 = this.plateLocalToWorld(stroke.points[i + 1], plate.center);
                        const proj1 = this.projectionManager.project(worldP1);
                        const proj2 = this.projectionManager.project(worldP2);
                        if (!proj1 || !proj2) continue;

                        // Point-to-line-segment distance
                        const dist = this.pointToSegmentDistance(mousePos, { x: proj1[0], y: proj1[1] }, { x: proj2[0], y: proj2[1] });
                        if (dist < hitDist) {
                            return { plateId: plate.id, paintStrokeId: stroke.id };
                        }
                    }
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
            // Lifecycle check
            if (state.world.currentTime < plate.birthTime || (plate.deathTime !== null && state.world.currentTime >= plate.deathTime)) continue;

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

        // Draw Image Overlay (fixed screen mode only - simple overlay above all elements except UI)
        if (state.world.imageOverlay && state.world.imageOverlay.visible && state.world.imageOverlay.mode === 'fixed') {
            this.drawImageOverlay(state);
        }

        // Draw Plates
        // Sort plates by zIndex (default to 0 if undefined) WITH Continental Modifier (+1)
        const sortedPlates = [...state.world.plates].sort((a, b) => {
            let zA = a.zIndex ?? 0;
            let zB = b.zIndex ?? 0;
            
            // Continental plates get visually bumped up by 1 layer relative to oceanic if not manually overridden heavily
            if (a.crustType === 'continental') zA += 1;
            if (b.crustType === 'continental') zB += 1;
            
            return zA - zB;
        });

        // Collect poly_region features to render after all plates (image overlays should be on top)
        const polyRegionFeatures: { feature: Feature; isSelected: boolean; isGhosted: boolean }[] = [];

        for (const plate of sortedPlates) {
            if (!plate.visible) continue;

            // Lifecycle check: Only render valid plates for current time
            if (state.world.currentTime < plate.birthTime) continue;
            if (plate.deathTime !== null && state.world.currentTime >= plate.deathTime) continue;

            const isSelected = plate.id === state.world.selectedPlateId;

            let polygonsToDraw = plate.polygons;
            if (state.activeTool === 'edit' && this.editTempPolygons && this.editTempPolygons.plateId === plate.id) {
                polygonsToDraw = this.editTempPolygons.polygons;
            }
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

                    // Collect poly_region features to render later (on top of all plates)
                    if (feature.type === 'poly_region') {
                        polyRegionFeatures.push({ feature, isSelected: isFeatureSelected, isGhosted: !isInTimeline });
                    } else {
                        // Draw other features immediately with their plate
                        this.drawFeature(feature, isFeatureSelected, !isInTimeline);
                    }
                }
            }

            // Draw Paint Strokes (if visible)
            if (state.world.showPaint && plate.paintStrokes && plate.paintStrokes.length > 0) {
                this.renderPaintStrokes(plate.paintStrokes, plate);
            }

            // Euler Pole Visualization
            const showGlobalPoles = state.world.showEulerPoles;
            const gizmoActive = isSelected && state.activeTool === 'select';
            if (plate.motion.eulerPole.visible || (showGlobalPoles && !gizmoActive)) {
                this.drawEulerPole(plate.motion.eulerPole);
            }

            // Update/render motion gizmo for selected plate
            // MOVED OUTSIDE LOOP to render on top of all plates
            // if (isSelected && state.activeTool === 'select') { ... }

            // Draw Fine-Tuning Rotation Widget
            if (this.isFineTuning && this.ghostPlateId === plate.id) {
                this.drawRotationWidget(transformedCenter);
            }
        }

        // Draw Boundaries
        if (state.world.globalOptions.enableBoundaryVisualization && state.world.boundaries) {
            this.drawBoundaries(state.world.boundaries, path);
        }

        // Draw Mantle Plumes (Global Features)
        if (state.world.mantlePlumes) {
            for (const plume of state.world.mantlePlumes) {
                const proj = this.projectionManager.project(plume.position);
                if (proj) {
                    const isSelected = plume.id === state.world.selectedFeatureId; // Using featureID slot for plumes
                    
                    this.ctx.save();
                    this.ctx.translate(proj[0], proj[1]);
                    
                    // Draw Plume Icon (Star/Diamond)
                    this.ctx.beginPath();
                    this.ctx.arc(0, 0, 8, 0, Math.PI * 2);
                    
                    // Visual state: Inactive = Grey, Active = Magenta
                    if (plume.active) {
                        this.ctx.fillStyle = '#ff00aa'; // Magenta/Hot Pink
                    } else {
                        this.ctx.fillStyle = '#888888'; // Grey
                    }
                    this.ctx.fill();
                    
                    this.ctx.strokeStyle = isSelected ? '#ffffff' : (plume.active ? '#550033' : '#333333');
                    this.ctx.lineWidth = isSelected ? 3 : 2;
                    this.ctx.stroke();
                    
                    // Inner dot
                    this.ctx.beginPath();
                    this.ctx.arc(0, 0, 3, 0, Math.PI * 2);
                    this.ctx.fillStyle = '#ffffff';
                    this.ctx.fill();
                    
                    // Label
                    if (isSelected) {
                        this.ctx.fillStyle = 'white';
                        this.ctx.font = '12px sans-serif';
                        this.ctx.fillText(plume.active ? 'Plume' : 'Plume (Inactive)', 12, 4);
                    }
                    
                    this.ctx.restore();
                }
            }
        }

        // Draw Links (if tool active or always?)
        // Let's draw if Link tool is active OR if a linked plate is selected
        if (state.activeTool === 'link' || (state.world.selectedPlateId && state.world.plates.find(p => p.id === state.world.selectedPlateId)?.linkedPlateIds?.length)) {
            this.drawLinks(state, path);
        }

        // Draw poly_region features (image overlays) ABOVE all plates
        for (const { feature, isSelected, isGhosted } of polyRegionFeatures) {
            this.drawFeature(feature, isSelected, isGhosted);
        }

        // Render Motion Gizmo (On Top of Plates)
        const selectedPlate = state.world.plates.find(p => p.id === state.world.selectedPlateId);
        if (selectedPlate && state.activeTool === 'select' && selectedPlate.visible) {
             this.motionGizmo.setPlate(selectedPlate.id, selectedPlate.motion.eulerPole);
             const radiusKm = state.world.globalOptions.planetRadius || 6371;
             this.motionGizmo.render(this.ctx, this.projectionManager, selectedPlate.center, radiusKm);
        } else {
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

            // Draw distances for established segments
            for (let i = 0; i < this.currentPolygon.length - 1; i++) {
                this.drawDistanceLabel(this.currentPolygon[i], this.currentPolygon[i+1]);
            }

            // Draw preview line + distance to cursor
            if (this.currentMouseGeo) {
                const lastPoint = this.currentPolygon[this.currentPolygon.length - 1];
                
                this.ctx.beginPath();
                path({
                    type: 'LineString',
                    coordinates: [lastPoint, this.currentMouseGeo]
                } as any);
                this.ctx.strokeStyle = '#ffff00'; // Yellow for preview
                this.ctx.lineWidth = 1;
                this.ctx.setLineDash([2, 4]);
                this.ctx.stroke();
                this.ctx.setLineDash([]);

                this.drawDistanceLabel(lastPoint, this.currentMouseGeo, '#ffff00');
            }
        }

        if (state.activeTool === 'edit') {
            this.drawEditHighlights();
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

        // Draw poly fill gizmo on top at the very end (so it's always visible)
        if (state.activeTool === 'paint' && this.paintMode === 'poly_fill' && this.polyFillPoints.length > 0) {
            this.drawPolyFillGizmo();
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

        // Handle flowline feature
        if (feature.type === 'flowline' && feature.trail && feature.trail.length > 1) {
            const path = this.projectionManager.getPathGenerator();
            this.ctx.beginPath();
            path({
                type: 'LineString',
                coordinates: feature.trail
            } as any);
            this.ctx.strokeStyle = isSelected ? '#ffffff' : '#aaaaaa';
            this.ctx.lineWidth = isSelected ? 2 : 1;
            this.ctx.setLineDash([4, 4]);
            this.ctx.stroke();
            this.ctx.setLineDash([]);

            // Draw seed point
            const proj = this.projectionManager.project(feature.position);
            if (proj) {
                this.ctx.beginPath();
                this.ctx.arc(proj[0], proj[1], 3, 0, Math.PI * 2);
                this.ctx.fillStyle = '#ffffff';
                this.ctx.fill();
            }

            if (isGhosted) this.ctx.globalAlpha = 1.0;
            return;
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

    // Paint Tool Methods
    public setPaintColor(color: string): void {
        this.paintConfig.color = color;
    }

    public setPaintSize(size: number): void {
        this.paintConfig.width = size;
    }

    public setPaintOpacity(opacity: number): void {
        this.paintConfig.opacity = Math.max(0, Math.min(1, opacity));
    }

    public setPaintMode(mode: PaintMode): void {
        this.paintMode = mode;
        this.currentPaintStroke = [];
        this.polyFillPoints = [];
    }

    public setPolyFillColor(color: string): void {
        this.polyFillConfig.color = color;
    }

    public setPolyFillOpacity(opacity: number): void {
        this.polyFillConfig.opacity = Math.max(0, Math.min(1, opacity));
    }

    public applyPaintPolyFill(): void {
        const state = this.getState();
        if (state.activeTool === 'paint' && this.paintMode === 'poly_fill' && this.polyFillPoints.length >= 3) {
            this.applyPolyFillPaint();
        }
    }

    /**
     * Convert world coordinates to plate-local coordinates.
     * This allows paint to move with the plate as it rotates.
     */
    private worldToPlateLocal(worldCoord: Coordinate, plateCenter: Coordinate): Coordinate {
        // Store offset relative to plate center
        // This preserves paint positioning as plate rotates
        const offsetLon = worldCoord[0] - plateCenter[0];
        const offsetLat = worldCoord[1] - plateCenter[1];
        
        return [offsetLon, offsetLat];
    }

    /**
     * Convert plate-local coordinates back to world coordinates.
     * This reconstructs paint positions when rendering.
     */
    private plateLocalToWorld(localCoord: Coordinate, plateCenter: Coordinate): Coordinate {
        return [
            plateCenter[0] + localCoord[0],
            plateCenter[1] + localCoord[1]
        ];
    }

    /**
     * Calculate distance from point P to line segment AB
     */
    private pointToSegmentDistance(p: Point, a: Point, b: Point): number {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const lenSq = dx * dx + dy * dy;
        
        if (lenSq === 0) {
            // Segment is a point
            return Math.hypot(p.x - a.x, p.y - a.y);
        }
        
        // Project p onto line AB, clamped to segment
        let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
        t = Math.max(0, Math.min(1, t));
        
        const projX = a.x + t * dx;
        const projY = a.y + t * dy;
        
        return Math.hypot(p.x - projX, p.y - projY);
    }

    private commitPaintStroke(): void {
        const state = this.getState();
        if (!state.world.selectedPlateId || this.currentPaintStroke.length < 2) {
            this.currentPaintStroke = [];
            return;
        }

        const plate = state.world.plates.find(p => p.id === state.world.selectedPlateId);
        if (!plate) return;

        // Store all painted points (no filtering) - paint will be clipped at render time to plate boundaries
        // This allows painting across plate edges while only showing paint inside the plate
        const localPoints = this.currentPaintStroke.map(p => this.worldToPlateLocal(p, plate.center));

        const stroke: PaintStroke = {
            id: generateId(),
            color: this.paintConfig.color,
            width: this.paintConfig.width,
            opacity: this.paintConfig.opacity,
            points: localPoints,
            timestamp: Date.now()
        };

        if (!plate.paintStrokes) {
            plate.paintStrokes = [];
        }
        plate.paintStrokes.push(stroke);
        this.currentPaintStroke = [];
    }

    private renderPaintStrokes(strokes: PaintStroke[], plate: any): void {
        const state = this.getState();
        const currentTime = state.world.currentTime;
        const showFuture = state.world.showFutureFeatures;
        const selectedStrokeId = state.world.selectedPaintStrokeId;

        // Enable clipping to plate boundaries so paint only appears within the plate
        // Use d3-geo path generator for accurate clipping of curved plate boundaries
        this.ctx.save();
        
        // Create clipping region from projected plate polygons
        this.ctx.beginPath();
        const pathGen = this.projectionManager.getPathGenerator();
        
        for (const poly of plate.polygons) {
            const geojson = toGeoJSON(poly);

            // Fix Winding: If area > Hemisphere, invert winding
            // This ensures we clip to the plate INTERIOR, not the rest of the world
            if (geoArea(geojson) > 2 * Math.PI) {
                geojson.geometry.coordinates[0].reverse();
            }

            pathGen(geojson);
        }
        
        this.ctx.clip();

        for (const stroke of strokes) {
            if (stroke.points.length < 2) continue;

            // Time-based visibility: Only show strokes created at or before current time
            // (unless showFutureFeatures is enabled)
            if (stroke.birthTime !== undefined && stroke.birthTime > currentTime && !showFuture) {
                continue; // Skip strokes from the "future"
            }

            // Check if this stroke is selected
            const isSelected = stroke.id === selectedStrokeId;

            // Ghost strokes from the future (similar to features)
            const isFromFuture = stroke.birthTime !== undefined && stroke.birthTime > currentTime;
            const baseOpacity = isFromFuture ? stroke.opacity * 0.3 : stroke.opacity;

            this.ctx.globalAlpha = baseOpacity;

            if (stroke.isFilled) {
                // Render filled polygon
                this.ctx.fillStyle = stroke.color;
                this.ctx.beginPath();
                let isFirstPoint = true;

                for (const point of stroke.points) {
                    // Convert from plate-local to world coordinates
                    const worldCoord = this.plateLocalToWorld(point, plate.center);
                    const proj = this.projectionManager.project(worldCoord);
                    if (!proj) continue;

                    if (isFirstPoint) {
                        this.ctx.moveTo(proj[0], proj[1]);
                        isFirstPoint = false;
                    } else {
                        this.ctx.lineTo(proj[0], proj[1]);
                    }
                }

                this.ctx.closePath();
                this.ctx.fill();

                // Selection highlight for filled strokes
                if (isSelected) {
                    this.ctx.strokeStyle = '#00ffff';
                    this.ctx.lineWidth = 3;
                    this.ctx.stroke();
                }
            } else {
                // Render line stroke
                this.ctx.strokeStyle = stroke.color;
                this.ctx.lineWidth = stroke.width;
                this.ctx.lineCap = 'round';
                this.ctx.lineJoin = 'round';

                this.ctx.beginPath();
                let isFirstPoint = true;

                for (const point of stroke.points) {
                    // Convert from plate-local to world coordinates
                    const worldCoord = this.plateLocalToWorld(point, plate.center);
                    const proj = this.projectionManager.project(worldCoord);
                    if (!proj) continue; // Skip points on globe backside

                    if (isFirstPoint) {
                        this.ctx.moveTo(proj[0], proj[1]);
                        isFirstPoint = false;
                    } else {
                        this.ctx.lineTo(proj[0], proj[1]);
                    }
                }

                this.ctx.stroke();

                // Selection highlight for line strokes - draw a wider outline
                if (isSelected) {
                    this.ctx.strokeStyle = '#00ffff';
                    this.ctx.lineWidth = stroke.width + 4;
                    this.ctx.globalAlpha = 0.5;
                    this.ctx.stroke();
                }
            }
        }
        this.ctx.globalAlpha = 1.0;
        this.ctx.restore();
    }

    private applyPolyFillPaint(): void {
        const state = this.getState();
        if (!state.world.selectedPlateId || this.polyFillPoints.length < 3) {
            return;
        }

        const plate = state.world.plates.find(p => p.id === state.world.selectedPlateId);
        if (!plate) return;

        // Convert to plate-local coordinates so paint moves with the plate
        const localPoints = this.polyFillPoints.map(p => this.worldToPlateLocal(p, plate.center));

        // Create a filled polygon stroke
        const stroke: PaintStroke = {
            id: generateId(),
            color: this.polyFillConfig.color,
            width: 0, // 0 width indicates fill-only
            opacity: this.polyFillConfig.opacity,
            points: localPoints,
            timestamp: Date.now(),
            isFilled: true  // Mark as filled polygon
        };

        if (!plate.paintStrokes) {
            plate.paintStrokes = [];
        }
        plate.paintStrokes.push(stroke);
        this.polyFillPoints = [];
        this.render();
    }

    private drawBrushPreview(position: Coordinate): void {
        const proj = this.projectionManager.project(position);
        if (!proj) return;

        // Draw solid filled circle gizmo showing exact brush size and color
        this.ctx.fillStyle = this.paintConfig.color;
        this.ctx.globalAlpha = this.paintConfig.opacity * 0.6;
        this.ctx.beginPath();
        this.ctx.arc(proj[0], proj[1], this.paintConfig.width / 2, 0, Math.PI * 2);
        this.ctx.fill();
        
        // Draw outline to make it more visible
        this.ctx.strokeStyle = 'white';
        this.ctx.lineWidth = 1;
        this.ctx.globalAlpha = 1.0;
        this.ctx.stroke();
    }

    private drawPolyFillPreview(points: Coordinate[]): void {
        if (points.length < 1) return;

        // Project all points
        const projectedPoints: ([number, number] | null)[] = points.map(p => this.projectionManager.project(p));
        
        // Draw connection lines between placed points
        if (this.polyFillPoints.length >= 2) {
            this.ctx.strokeStyle = this.polyFillConfig.color;
            this.ctx.lineWidth = 2;
            this.ctx.globalAlpha = this.polyFillConfig.opacity * 0.6;
            this.ctx.setLineDash([4, 4]);
            this.ctx.beginPath();

            let isFirstPoint = true;
            for (let i = 0; i < this.polyFillPoints.length; i++) {
                const proj = projectedPoints[i];
                if (!proj) continue;

                if (isFirstPoint) {
                    this.ctx.moveTo(proj[0], proj[1]);
                    isFirstPoint = false;
                } else {
                    this.ctx.lineTo(proj[0], proj[1]);
                }
            }

            this.ctx.stroke();
            this.ctx.setLineDash([]);
        }

        // Draw preview line from last placed point to mouse cursor (white dashed)
        if (this.polyFillPoints.length > 0) {
            const lastProj = projectedPoints[this.polyFillPoints.length - 1];
            const cursorProj = projectedPoints[projectedPoints.length - 1];
            
            if (lastProj && cursorProj && (lastProj !== cursorProj)) {
                this.ctx.strokeStyle = 'white';
                this.ctx.lineWidth = 2;
                this.ctx.globalAlpha = 0.7;
                this.ctx.setLineDash([2, 2]);
                this.ctx.beginPath();
                this.ctx.moveTo(lastProj[0], lastProj[1]);
                this.ctx.lineTo(cursorProj[0], cursorProj[1]);
                this.ctx.stroke();
                this.ctx.setLineDash([]);
            }
        }

        this.ctx.globalAlpha = 1.0;

        // Draw placed vertices as large, highly visible gizmo dots
        for (let i = 0; i < this.polyFillPoints.length; i++) {
            const proj = projectedPoints[i];
            if (!proj) continue;
            
            // Large filled circle in poly fill color (fully opaque)
            this.ctx.fillStyle = this.polyFillConfig.color;
            this.ctx.globalAlpha = 1.0;
            this.ctx.beginPath();
            this.ctx.arc(proj[0], proj[1], 10, 0, Math.PI * 2);
            this.ctx.fill();
            
            // Thick white outline for maximum visibility
            this.ctx.strokeStyle = 'white';
            this.ctx.lineWidth = 3;
            this.ctx.stroke();
            
            // Inner highlight circle for depth
            this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
            this.ctx.lineWidth = 1;
            this.ctx.beginPath();
            this.ctx.arc(proj[0], proj[1], 7, 0, Math.PI * 2);
            this.ctx.stroke();
        }

        // Draw cursor/next point preview as a very large, prominent gizmo
        if (this.polyFillPoints.length > 0 && projectedPoints.length > this.polyFillPoints.length) {
            const cursorProj = projectedPoints[projectedPoints.length - 1];
            if (cursorProj) {
                // Very large circle showing next point (fully opaque)
                this.ctx.fillStyle = this.polyFillConfig.color;
                this.ctx.globalAlpha = 0.9;
                this.ctx.beginPath();
                this.ctx.arc(cursorProj[0], cursorProj[1], 14, 0, Math.PI * 2);
                this.ctx.fill();
                
                // Thick white dashed outline for visibility
                this.ctx.strokeStyle = 'white';
                this.ctx.lineWidth = 2.5;
                this.ctx.globalAlpha = 1.0;
                this.ctx.setLineDash([4, 3]);
                this.ctx.stroke();
                this.ctx.setLineDash([]);
                
                // Center dot for reference
                this.ctx.fillStyle = 'white';
                this.ctx.globalAlpha = 0.7;
                this.ctx.beginPath();
                this.ctx.arc(cursorProj[0], cursorProj[1], 3, 0, Math.PI * 2);
                this.ctx.fill();
            }
        }
    }

    private drawPolyFillGizmo(): void {
        // Draw the placed poly fill points as prominent gizmos on top of everything
        // This is called at the end of render() to ensure they're always visible
        const projectedPoints = this.polyFillPoints.map(p => this.projectionManager.project(p));

        // Draw connection lines between placed points
        if (this.polyFillPoints.length >= 2) {
            this.ctx.strokeStyle = this.polyFillConfig.color;
            this.ctx.lineWidth = 2;
            this.ctx.globalAlpha = this.polyFillConfig.opacity * 0.6;
            this.ctx.setLineDash([4, 4]);
            this.ctx.beginPath();

            let isFirstPoint = true;
            for (const proj of projectedPoints) {
                if (!proj) continue;

                if (isFirstPoint) {
                    this.ctx.moveTo(proj[0], proj[1]);
                    isFirstPoint = false;
                } else {
                    this.ctx.lineTo(proj[0], proj[1]);
                }
            }

            this.ctx.stroke();
            this.ctx.setLineDash([]);
        }

        // Draw placed vertices as large, highly visible gizmo dots
        for (const proj of projectedPoints) {
            if (!proj) continue;
            
            // Large filled circle in poly fill color (fully opaque)
            this.ctx.fillStyle = this.polyFillConfig.color;
            this.ctx.globalAlpha = 1.0;
            this.ctx.beginPath();
            this.ctx.arc(proj[0], proj[1], 10, 0, Math.PI * 2);
            this.ctx.fill();
            
            // Thick white outline for maximum visibility
            this.ctx.strokeStyle = 'white';
            this.ctx.lineWidth = 3;
            this.ctx.stroke();
            
            // Inner highlight circle for depth
            this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
            this.ctx.lineWidth = 1;
            this.ctx.beginPath();
            this.ctx.arc(proj[0], proj[1], 7, 0, Math.PI * 2);
            this.ctx.stroke();
        }

        this.ctx.globalAlpha = 1.0;
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

    private drawImageOverlay(state: AppState): void {
        const overlay = state.world.imageOverlay;
        if (!overlay || !overlay.imageData) return;

        // Check if image is already cached
        let img = this.cachedOverlayImages.get(overlay.imageData);
        
        if (!img) {
            // Create and cache the image
            img = new Image();
            img.onload = () => {
                // Trigger a re-render when image loads
                this.render();
            };
            img.src = overlay.imageData;
            this.cachedOverlayImages.set(overlay.imageData, img);
            // If image not loaded yet, skip rendering this frame
            return;
        }

        // Only draw if image is loaded
        if (!img.complete) return;

        this.ctx.save();
        this.ctx.globalAlpha = overlay.opacity;

        // For fixed mode: draw as overlay on screen space
        const canvasWidth = this.canvas.width;
        const canvasHeight = this.canvas.height;

        // Scale and position overlay
        const scaledWidth = img.width * overlay.scale;
        const scaledHeight = img.height * overlay.scale;
        const x = (canvasWidth - scaledWidth) / 2 + overlay.offsetX;
        const y = (canvasHeight - scaledHeight) / 2 + overlay.offsetY;

        // Apply rotation if needed
        if (overlay.rotation !== 0) {
            this.ctx.translate(canvasWidth / 2, canvasHeight / 2);
            this.ctx.rotate((overlay.rotation * Math.PI) / 180);
            this.ctx.translate(-canvasWidth / 2, -canvasHeight / 2);
        }

        this.ctx.drawImage(img, x, y, scaledWidth, scaledHeight);
        this.ctx.restore();
    }


    public getViewportCenter(): Coordinate | null {
        // Return screen center projected to Lon/Lat
        const rect = this.canvas.getBoundingClientRect();
        return this.projectionManager.invert(rect.width / 2, rect.height / 2);
    }
    
    public destroy(): void {
        this.stopRenderLoop();
        window.removeEventListener('resize', () => this.resizeCanvas());
    }

    private drawDistanceLabel(p1: Coordinate, p2: Coordinate, color: string = '#ffffff'): void {
        const rad = distance(p1, p2);
        const km = rad * 6371;
        
        // Midpoint for label
        // Simple linear avg is ok for short segments, but use slerp/great circle mid for accuracy?
        // Let's use simple avg of projected points to ensure screen placement is correct
        const proj1 = this.projectionManager.project(p1);
        const proj2 = this.projectionManager.project(p2);
        
        if (!proj1 || !proj2) return; // Clipped

        const mx = (proj1[0] + proj2[0]) / 2;
        const my = (proj1[1] + proj2[1]) / 2;

        let label = '';
        if (km < 1000) {
            label = `${Math.round(km)} km`;
        } else {
            label = `${(km / 1000).toFixed(1)}k km`; // 1.2k km
        }

        this.ctx.font = '11px monospace';
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        
        // Shadow/Stroke for readability
        this.ctx.lineWidth = 3;
        this.ctx.strokeStyle = 'rgba(0,0,0,0.8)';
        this.ctx.strokeText(label, mx, my);
        
        this.ctx.fillStyle = color;
        this.ctx.fillText(label, mx, my);
    }

    private drawEditHighlights() {
         const state = this.getState();
         const plateId = state.world.selectedPlateId;
         if(!plateId) return;

         const plate = state.world.plates.find(p => p.id === plateId);
         if (!plate) return;
         
         const polygons = (this.editTempPolygons && this.editTempPolygons.plateId === plate.id) ? this.editTempPolygons.polygons : plate.polygons;
         
         // 1. Draw all vertices as small gizmos
         this.ctx.fillStyle = '#ffffff'; 
         this.ctx.strokeStyle = '#000000';
         this.ctx.lineWidth = 1;

         for (const poly of polygons) {
             for (const pt of poly.points) {
                 const proj = this.projectionManager.project(pt);
                 if (proj) {
                     this.ctx.beginPath();
                     this.ctx.arc(proj[0], proj[1], 3, 0, Math.PI * 2);
                     this.ctx.fill();
                     this.ctx.stroke();
                 }
             }
         }

         // 2. Highlights for Hover
         if (this.editHoveredVertex && this.editHoveredVertex.plateId === plateId) {
             const poly = polygons[this.editHoveredVertex.polyIndex];
             if(poly) {
                 const pt = poly.points[this.editHoveredVertex.vertexIndex];
                 const proj = this.projectionManager.project(pt);
                 if (proj) {
                     this.ctx.beginPath();
                     this.ctx.arc(proj[0], proj[1], 6, 0, Math.PI * 2);
                     this.ctx.fillStyle = '#ff4444'; // Red for Vertex
                     this.ctx.fill();
                     this.ctx.strokeStyle = 'white';
                     this.ctx.lineWidth = 2;
                     this.ctx.stroke();
                 }
             }
         }
         
         if (this.editHoveredEdge && this.editHoveredEdge.plateId === plateId) {
             const proj = this.projectionManager.project(this.editHoveredEdge.pointOnEdge);
             if (proj) {
                 this.ctx.beginPath();
                 this.ctx.arc(proj[0], proj[1], 5, 0, Math.PI * 2);
                 this.ctx.fillStyle = '#44ff44'; // Green for Insert
                 this.ctx.fill();
                 this.ctx.strokeStyle = 'white';
                 this.ctx.lineWidth = 2;
                 this.ctx.stroke();
             }
         }
    }
}
