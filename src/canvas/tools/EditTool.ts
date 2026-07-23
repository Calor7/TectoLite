import { Coordinate, Point, AppState, Polygon, TectonicPlate } from '../../types';
import { InputTool } from './InputTool';
import { ProjectionManager } from '../ProjectionManager';
import { latLonToVector, rotateVector, vectorToLatLon, calculateSphericalCentroid, cross, dot, normalize } from '../../utils/sphericalMath';

export class EditTool implements InputTool {
    // Edit State
    private hoveredVertex: { plateId: string; polyIndex: number; vertexIndex: number } | null = null;
    private hoveredEdge: { plateId: string; polyIndex: number; vertexIndex: number; pointOnEdge: Coordinate } | null = null;

    private dragState: {
        operation: 'move_vertex' | 'insert_vertex' | 'move_plate' | 'rotate_plate';
        plateId: string;
        polyIndex?: number;
        vertexIndex?: number;
        startPoint: Coordinate;
        startScreenPoint?: Point;
        startRotation?: number; // screen angle in deg
        startCenter?: Coordinate;
        hasMoved?: boolean;
    } | null = null;

    private tempPolygons: { plateId: string; polygons: Polygon[] } | null = null;

    // Rotation State
    private ghostSpin: number = 0;
    private lastSpinAngle: number = 0;
    private isSpinning: boolean = false;

    // Snapping State
    public snappingEnabled: boolean = false;
    private snapCandidateProvider: (() => Coordinate[]) | null = null;
    private snapThresholdPx: number = 12;
    private lastMouseScreenPos: Point = { x: 0, y: 0 };
    private lastMouseGeo: Coordinate | null = null;

    constructor(
        private projectionManager: ProjectionManager,
        private getState: () => AppState,
        private onUpdate: (hasChanges: boolean) => void,
        private onApply: () => void,
        private getNearestElement: (x: number, y: number) => { type: 'vertex' | 'edge', data: any } | null,
        private onHoverChange: () => void,
        private onNotice?: (message: string) => void,
        // private onDragTargetRequest?: (plateId: string, axis: Vector3, angleRad: number) => void // Unused
        // _onDragTargetRequest removed as unused
    ) { }

    /** Set a function that provides all candidate vertices for snapping */
    setSnapCandidateProvider(provider: () => Coordinate[]): void {
        this.snapCandidateProvider = provider;
    }

    /** Try to snap a geo coordinate to the nearest existing vertex */
    private trySnap(geo: Coordinate, screenPos: Point): Coordinate {
        if (!this.snappingEnabled || !this.snapCandidateProvider) return geo;

        const candidates = this.snapCandidateProvider();
        let bestDist = this.snapThresholdPx;
        let bestCandidate: Coordinate | null = null;

        for (const candidate of candidates) {
            const screen = this.projectionManager.project(candidate);
            if (!screen) continue;
            const dx = screen[0] - screenPos.x;
            const dy = screen[1] - screenPos.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < bestDist) {
                bestDist = dist;
                bestCandidate = candidate;
            }
        }

        return bestCandidate || geo;
    }

    /** Get current snap state for rendering */
    getSnapState(): { enabled: boolean; mouseScreen: Point; mouseGeo: Coordinate | null } {
        return {
            enabled: this.snappingEnabled,
            mouseScreen: this.lastMouseScreenPos,
            mouseGeo: this.lastMouseGeo
        };
    }

    onMouseDown(e: MouseEvent, geo: Coordinate | null, screenPos: Point): void {
        // Right Click: Delete Vertex (User Request)
        if (e.button === 2) {
            // If hovering a vertex, delete it.
            if (this.hoveredVertex) {
                if (e.shiftKey) {
                    this.deletePolygon(this.hoveredVertex);
                } else {
                    this.deleteVertex(this.hoveredVertex);
                }
            }
            return;
        }

        if (e.button !== 0 || !geo) return;

        // Shift/Ctrl/Cmd+Click: Move/Rotate the whole plate instead of single vertices
        if (e.shiftKey || e.ctrlKey || e.metaKey) {
            const state = this.getState();
            const plateId = state.world.selectedPlateId;
            if (plateId) {
                const plate = state.world.plates.find(p => p.id === plateId);
                if (plate) {
                    // 1. Rotation Gizmo Hit Test
                    let currentCenter = plate.center;
                    if (this.tempPolygons && this.tempPolygons.plateId === plate.id) {
                        const allPoints = this.tempPolygons.polygons.flatMap((p: any) => p.points);
                        if (allPoints.length > 0) {
                            currentCenter = calculateSphericalCentroid(allPoints);
                        }
                    }

                    const projCenter = this.projectionManager.project(currentCenter);
                    if (projCenter) {
                        const dist = Math.hypot(screenPos.x - projCenter[0], screenPos.y - projCenter[1]);
                        // Approx Ring Hit (Radius 60 +/- 10)
                        if (Math.abs(dist - 60) < 10) {
                            const angle = Math.atan2(screenPos.y - projCenter[1], screenPos.x - projCenter[0]) * 180 / Math.PI;
                            this.dragState = {
                                operation: 'rotate_plate',
                                plateId: plate.id,
                                startPoint: geo,
                                startCenter: currentCenter,
                                startRotation: angle
                            };
                            this.isSpinning = true;
                            this.lastSpinAngle = angle;
                            return;
                        }
                    }

                    // 2. Body Hit (Move)
                    this.dragState = {
                        operation: 'move_plate',
                        plateId: plate.id,
                        startPoint: geo,
                        startScreenPoint: screenPos,
                        hasMoved: false
                    };
                    return;
                }
            }
        }

        // Vertex/Edge Interactions
        if (this.hoveredVertex) {
            this.dragState = {
                operation: 'move_vertex',
                plateId: this.hoveredVertex.plateId,
                polyIndex: this.hoveredVertex.polyIndex,
                vertexIndex: this.hoveredVertex.vertexIndex,
                startPoint: geo
            };
        } else if (this.hoveredEdge) {
            this.startInsertDrag(this.hoveredEdge);
        }
    }

    // handleRightClick helper removed as unused // Leftover from previous attempt

    private startInsertDrag(edge: { plateId: string; polyIndex: number; vertexIndex: number; pointOnEdge: Coordinate }) {
        const state = this.getState();
        const plate = state.world.plates.find(p => p.id === edge.plateId);
        if (!plate) return;

        this.ensureTempPolygons(plate);

        const poly = this.tempPolygons!.polygons[edge.polyIndex];
        const insertIdx = edge.vertexIndex + 1;
        poly.points.splice(insertIdx, 0, edge.pointOnEdge);

        this.dragState = {
            operation: 'insert_vertex',
            plateId: edge.plateId,
            polyIndex: edge.polyIndex,
            vertexIndex: insertIdx,
            startPoint: edge.pointOnEdge
        };
    }

    private ensureTempPolygons(plate: TectonicPlate) {
        if (!this.tempPolygons || this.tempPolygons.plateId !== plate.id) {
            this.tempPolygons = {
                plateId: plate.id,
                // Only polygon data can be modified by this tool. Clone it explicitly so
                // large, detailed plates do not pay the cost of JSON serialization on the
                // first edit while still keeping the pending edit isolated from app state.
                polygons: plate.polygons.map(poly => ({
                    ...poly,
                    points: poly.points.map(point => [...point] as Coordinate),
                    edgeMeta: poly.edgeMeta?.map(meta => ({
                        ...meta,
                        siblings: meta.siblings?.map(sibling => ({ ...sibling }))
                    })),
                    riftEdgeIndices: poly.riftEdgeIndices?.slice(),
                    edgeStyles: poly.edgeStyles?.map(style => ({ ...style }))
                }))
            };
        }
    }

    onMouseMove(e: MouseEvent, geo: Coordinate | null, screenPos: Point): void {
        const state = this.getState();
        this.lastMouseScreenPos = screenPos;
        this.lastMouseGeo = geo;

        if (this.dragState && geo) {
            const plate = state.world.plates.find(p => p.id === this.dragState!.plateId);
            if (!plate) return;
            this.ensureTempPolygons(plate);

            if (this.dragState.operation === 'move_vertex' || this.dragState.operation === 'insert_vertex') {
                if (this.dragState.polyIndex !== undefined && this.dragState.vertexIndex !== undefined) {
                    // Apply snapping to vertex drag destination
                    const snapped = this.trySnap(geo, screenPos);
                    const poly = this.tempPolygons!.polygons[this.dragState.polyIndex];
                    if (poly) poly.points[this.dragState.vertexIndex] = snapped;
                }
            } else if (this.dragState.operation === 'move_plate') {
                if (!this.dragState.hasMoved && this.dragState.startScreenPoint) {
                    const dist = Math.hypot(screenPos.x - this.dragState.startScreenPoint.x, screenPos.y - this.dragState.startScreenPoint.y);
                    if (dist < 5) return;
                    this.dragState.hasMoved = true;
                }

                const vStart = latLonToVector(this.dragState.startPoint);
                const vCurr = latLonToVector(geo);

                const axis = normalize(cross(vStart, vCurr));
                const angle = Math.acos(Math.max(-1, Math.min(1, dot(vStart, vCurr))));

                if (!isNaN(angle) && angle > 0.0001) {
                    this.tempPolygons!.polygons.forEach((poly: any) => {
                        poly.points = poly.points.map((pt: Coordinate) => {
                            const v = latLonToVector(pt);
                            const vNew = rotateVector(v, axis, angle);
                            return vectorToLatLon(vNew);
                        });
                    });
                    this.dragState.startPoint = geo;
                }

            } else if (this.dragState.operation === 'rotate_plate') {
                if (this.dragState.startCenter) {
                    const projCenter = this.projectionManager.project(this.dragState.startCenter);
                    if (projCenter) {
                        const currAngle = Math.atan2(screenPos.y - projCenter[1], screenPos.x - projCenter[0]) * 180 / Math.PI;
                        let delta = currAngle - this.lastSpinAngle;
                        if (delta > 180) delta -= 360;
                        if (delta < -180) delta += 360;

                        this.ghostSpin += delta;
                        this.lastSpinAngle = currAngle;

                        const rotRad = -delta * Math.PI / 180;
                        const vCenter = latLonToVector(this.dragState.startCenter);

                        this.tempPolygons!.polygons.forEach((poly: any) => {
                            poly.points = poly.points.map((pt: Coordinate) => {
                                const v = latLonToVector(pt);
                                const vNew = rotateVector(v, vCenter, rotRad);
                                return vectorToLatLon(vNew);
                            });
                        });
                    }
                }
            }

            this.onUpdate(!!this.tempPolygons);

        } else {
            // Suppress vertex/edge hover while a whole-plate modifier is held
            if (!e.shiftKey && !e.ctrlKey && !e.metaKey) {
                const nearest = this.getNearestElement(screenPos.x, screenPos.y);
                this.hoveredVertex = nearest && nearest.type === 'vertex' ? nearest.data : null;
                this.hoveredEdge = nearest && nearest.type === 'edge' ? nearest.data : null;
                this.onHoverChange();
            } else if (this.hoveredVertex || this.hoveredEdge) {
                this.hoveredVertex = null;
                this.hoveredEdge = null;
                this.onHoverChange();
            }
        }
    }

    onMouseUp(_e: MouseEvent, _geo: Coordinate | null, _screenPos: Point): void {
        this.dragState = null;
        this.isSpinning = false;
    }

    onKeyDown(e: KeyboardEvent): void {
        if (e.key === 'Enter') {
            this.onApply();
        } else if (e.key === 'Escape') {
            this.cancel();
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
            if (this.hoveredVertex) {
                e.preventDefault();
                if (e.shiftKey) {
                    this.deletePolygon(this.hoveredVertex);
                } else {
                    this.deleteVertex(this.hoveredVertex);
                }
            }
        }
    }

    private clearTopologyInteractionState(plateId: string): void {
        this.hoveredVertex = null;
        this.hoveredEdge = null;
        if (this.dragState?.plateId === plateId) {
            this.dragState = null;
        }
    }

    private deletePolygon(target: { plateId: string; polyIndex: number }): void {
        const state = this.getState();
        const plate = state.world.plates.find(candidate => candidate.id === target.plateId);
        if (!plate) return;

        const currentPolygons = this.tempPolygons?.plateId === plate.id
            ? this.tempPolygons.polygons
            : plate.polygons;
        // A plate must retain at least one polygon. Whole-component deletion is
        // intended for disconnected geometry produced by fusion and similar tools.
        if (currentPolygons.length <= 1) {
            this.onNotice?.("A plate must keep at least one polygon, so its only polygon can't be removed.");
            return;
        }
        if (!currentPolygons[target.polyIndex]) return;

        this.ensureTempPolygons(plate);
        this.tempPolygons!.polygons.splice(target.polyIndex, 1);
        this.clearTopologyInteractionState(plate.id);
        this.onUpdate(true);
    }

    private deleteVertex(vertex: { plateId: string; polyIndex: number; vertexIndex: number }) {
        const state = this.getState();
        const plate = state.world.plates.find(p => p.id === vertex.plateId);
        if (!plate) return;

        const currentPolygons = this.tempPolygons?.plateId === plate.id
            ? this.tempPolygons.polygons
            : plate.polygons;
        const currentPoly = currentPolygons[vertex.polyIndex];
        if (!currentPoly || !Number.isInteger(vertex.vertexIndex) || vertex.vertexIndex < 0 ||
            vertex.vertexIndex >= currentPoly.points.length) {
            // A topology change can make a previously valid hover index stale.
            this.hoveredVertex = null;
            this.hoveredEdge = null;
            return;
        }
        if (currentPoly.points.length <= 3) {
            // A valid closed polygon cannot be reduced below three vertices.
            // Explain the explicit whole-component action instead of silently
            // converting an ordinary vertex deletion into a larger operation.
            if (currentPolygons.length > 1) {
                this.onNotice?.('A polygon needs at least 3 vertices. Hover one of its vertices and press Shift+Delete to remove the whole polygon.');
            } else {
                this.onNotice?.("A polygon needs at least 3 vertices, and the plate's only polygon can't be removed.");
            }
            return;
        }

        this.ensureTempPolygons(plate);
        const poly = this.tempPolygons!.polygons[vertex.polyIndex];
        const oldPointCount = poly.points.length;
        const deletedIndex = vertex.vertexIndex;
        poly.points.splice(deletedIndex, 1);

        // Deleting a vertex removes both incident edges and shifts every later
        // edge index. Discard metadata for the newly joined edge because neither
        // old edge describes it accurately, then remap the unaffected edges.
        const previousEdgeIndex = deletedIndex === 0
            ? (poly.closed === false ? -1 : oldPointCount - 1)
            : deletedIndex - 1;
        const removedEdgeIndices = new Set([previousEdgeIndex, deletedIndex]);
        const remapEdgeIndex = (edgeIndex: number) => edgeIndex > deletedIndex ? edgeIndex - 1 : edgeIndex;

        poly.edgeMeta = poly.edgeMeta
            ?.filter(meta => !removedEdgeIndices.has(meta.edgeIndex))
            .map(meta => ({ ...meta, edgeIndex: remapEdgeIndex(meta.edgeIndex) }));
        poly.riftEdgeIndices = poly.riftEdgeIndices
            ?.filter(edgeIndex => !removedEdgeIndices.has(edgeIndex))
            .map(remapEdgeIndex);
        poly.edgeStyles = poly.edgeStyles
            ?.filter(style => !removedEdgeIndices.has(style.edgeIndex))
            .map(style => ({ ...style, edgeIndex: remapEdgeIndex(style.edgeIndex) }));

        // The old index may now be out of bounds (most notably when the last
        // vertex was deleted), so never let rendering consume the stale target.
        this.clearTopologyInteractionState(vertex.plateId);
        this.onUpdate(true);
    }

    onKeyUp(_e: KeyboardEvent): void { }

    cancel(): void {
        this.dragState = null;
        this.tempPolygons = null;
        // this.ghostRotation = null;
        this.ghostSpin = 0;
        this.onUpdate(false);
    }

    getTempPolygons() {
        return this.tempPolygons;
    }

    getHoveredVertex() { return this.hoveredVertex; }
    getHoveredEdge() { return this.hoveredEdge; }
    isShiftDownForGizmo() { return this.getState().activeTool === 'edit' && this.isSpinning; }

    render(ctx: CanvasRenderingContext2D, _width: number, _height: number): void {
        const state = this.getState();
        const plateId = state.world.selectedPlateId;
        if (!plateId) return;

        const plate = state.world.plates.find(p => p.id === plateId);
        if (!plate) return;

        if (this.dragState?.operation === 'rotate_plate' && this.dragState.startCenter) {
            this.drawRotationWidget(ctx, this.dragState.startCenter);
        }

        // Draw snap indicator when snapping is active
        if (this.snappingEnabled && this.lastMouseGeo) {
            const cursorScreen = this.projectionManager.project(this.lastMouseGeo);
            if (cursorScreen) {
                ctx.save();
                ctx.strokeStyle = '#00ff88';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(cursorScreen[0], cursorScreen[1], 8, 0, Math.PI * 2);
                ctx.stroke();
                ctx.restore();
            }
        }
    }

    drawRotationWidget(ctx: CanvasRenderingContext2D, center: Coordinate): void {
        const proj = this.projectionManager.project(center);
        if (!proj) return;

        const [cx, cy] = proj;
        const radius = 60;

        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.strokeStyle = '#ffff00';
        ctx.lineWidth = 2;
        ctx.stroke();

        const handleAngle = (this.ghostSpin - 90) * Math.PI / 180;
        const hx = cx + Math.cos(handleAngle) * radius;
        const hy = cy + Math.sin(handleAngle) * radius;

        ctx.beginPath();
        ctx.arc(hx, hy, 8, 0, Math.PI * 2);
        ctx.fillStyle = this.isSpinning ? '#ffffff' : '#ffff00';
        ctx.fill();
        ctx.stroke();
        ctx.restore();
    }
}
