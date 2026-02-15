import { Coordinate, Point, AppState } from '../../types';
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

    private tempPolygons: { plateId: string; polygons: any[] } | null = null;

    // Rotation State
    private ghostSpin: number = 0;
    private lastSpinAngle: number = 0;
    private isSpinning: boolean = false;

    constructor(
        private projectionManager: ProjectionManager,
        private getState: () => AppState,
        private onUpdate: (hasChanges: boolean) => void,
        private onApply: () => void,
        private getNearestElement: (x: number, y: number) => { type: 'vertex' | 'edge', data: any } | null,
        private onHoverChange: () => void,
        // private onDragTargetRequest?: (plateId: string, axis: Vector3, angleRad: number) => void // Unused
        // _onDragTargetRequest removed as unused
    ) { }

    onMouseDown(e: MouseEvent, geo: Coordinate | null, screenPos: Point): void {
        // Right Click: Delete Vertex (User Request)
        if (e.button === 2) {
            // If hovering a vertex, delete it.
            if (this.hoveredVertex) {
                this.deleteVertex(this.hoveredVertex);
            }
            return;
        }

        if (e.button !== 0 || !geo) return;

        // Shift+Click: Move/Rotate Plate
        if (e.shiftKey) {
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
        let insertIdx = edge.vertexIndex + 1;
        poly.points.splice(insertIdx, 0, edge.pointOnEdge);

        this.dragState = {
            operation: 'insert_vertex',
            plateId: edge.plateId,
            polyIndex: edge.polyIndex,
            vertexIndex: insertIdx,
            startPoint: edge.pointOnEdge
        };
    }

    private ensureTempPolygons(plate: any) {
        if (!this.tempPolygons || this.tempPolygons.plateId !== plate.id) {
            this.tempPolygons = {
                plateId: plate.id,
                polygons: JSON.parse(JSON.stringify(plate.polygons))
            };
        }
    }

    onMouseMove(e: MouseEvent, geo: Coordinate | null, screenPos: Point): void {
        const state = this.getState();

        if (this.dragState && geo) {
            const plate = state.world.plates.find(p => p.id === this.dragState!.plateId);
            if (!plate) return;
            this.ensureTempPolygons(plate);

            if (this.dragState.operation === 'move_vertex' || this.dragState.operation === 'insert_vertex') {
                if (this.dragState.polyIndex !== undefined && this.dragState.vertexIndex !== undefined) {
                    const poly = this.tempPolygons!.polygons[this.dragState.polyIndex];
                    if (poly) poly.points[this.dragState.vertexIndex] = geo;
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
            if (!e.shiftKey) {
                const nearest = this.getNearestElement(screenPos.x, screenPos.y);
                this.hoveredVertex = nearest && nearest.type === 'vertex' ? nearest.data : null;
                this.hoveredEdge = nearest && nearest.type === 'edge' ? nearest.data : null;
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
                this.deleteVertex(this.hoveredVertex);
            }
        }
    }

    private deleteVertex(vertex: { plateId: string; polyIndex: number; vertexIndex: number }) {
        const state = this.getState();
        const plate = state.world.plates.find(p => p.id === vertex.plateId);
        if (!plate) return;

        this.ensureTempPolygons(plate);
        const poly = this.tempPolygons!.polygons[vertex.polyIndex];
        if (poly && poly.points.length > 3) {
            poly.points.splice(vertex.vertexIndex, 1);
            this.onUpdate(!!this.tempPolygons);
        }
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
