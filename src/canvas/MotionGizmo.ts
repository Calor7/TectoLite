// Motion Gizmo for interactive plate rotation control
// Provides drag handles for Euler pole position and rotation rate

import { Coordinate, EulerPole, InteractionMode } from '../types';
import { ProjectionManager } from './ProjectionManager';
import { latLonToVector, cross, dot, normalize, vectorToLatLon } from '../utils/sphericalMath';

export type GizmoHandle = 'pole' | 'rate' | null;

export interface GizmoState {
    plateId: string;
    polePosition: Coordinate;  // Current Euler pole position
    rate: number;              // Current rotation rate
    isDragging: GizmoHandle;
    dragStart: { x: number; y: number } | null;
}

const HANDLE_RADIUS = 8;

export class MotionGizmo {
    private state: GizmoState | null = null;

    public setPlate(
        plateId: string,
        eulerPole: EulerPole
    ): void {
        // If this is the same plate and we're dragging, preserve drag state
        if (this.state?.plateId === plateId && this.state.isDragging) {
            // Don't reset - preserve current drag state
            return;
        }

        // If plate changed or not dragging, update fully
        this.state = {
            plateId,
            polePosition: eulerPole.position,
            rate: eulerPole.rate,
            isDragging: null,
            dragStart: null
        };
    }

    public clear(): void {
        this.state = null;
    }

    public isActive(): boolean {
        return this.state !== null;
    }

    public getPlateId(): string | null {
        return this.state?.plateId ?? null;
    }

    public render(
        ctx: CanvasRenderingContext2D,
        projectionManager: ProjectionManager,
        plateCenter: Coordinate,
        planetRadiusKm: number
    ): void {
        if (!this.state) return;

        const poleProj = projectionManager.project(this.state.polePosition);

        ctx.save();

        // Draw Euler pole handle (crosshair with circle) if visible
        if (poleProj) {
            this.drawPoleHandle(ctx, poleProj[0], poleProj[1]);
        }

        // Draw rate arrow from plate center - now on globe surface (independent of pole visibility)
        this.drawRateArrowOnGlobe(ctx, projectionManager, plateCenter, planetRadiusKm);

        ctx.restore();
    }

    private drawPoleHandle(ctx: CanvasRenderingContext2D, x: number, y: number): void {
        const isDragging = this.state?.isDragging === 'pole';

        // Outer circle
        ctx.beginPath();
        ctx.arc(x, y, HANDLE_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = isDragging ? '#ff6b6b' : '#e74c3c';
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Crosshair
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x - HANDLE_RADIUS - 5, y);
        ctx.lineTo(x + HANDLE_RADIUS + 5, y);
        ctx.moveTo(x, y - HANDLE_RADIUS - 5);
        ctx.lineTo(x, y + HANDLE_RADIUS + 5);
        ctx.stroke();

        // Label
        ctx.fillStyle = '#fff';
        ctx.font = '10px sans-serif';
        ctx.fillText('EP', x + HANDLE_RADIUS + 4, y - HANDLE_RADIUS);
    }

    private drawRateArrowOnGlobe(
        ctx: CanvasRenderingContext2D,
        projectionManager: ProjectionManager,
        plateCenter: Coordinate,
        planetRadiusKm: number
    ): void {
        if (!this.state) return;

        const rate = this.state.rate;
        const isDragging = this.state?.isDragging === 'rate';
        const pole = this.state.polePosition;

        // Calculate arc points along the rotation path on the sphere
        // The plate rotates around the Euler pole - we show a small arc
        const arcPoints = this.calculateRotationArc(plateCenter, pole, rate);

        // Project all arc points
        const projectedPoints: [number, number][] = [];
        for (const point of arcPoints) {
            const proj = projectionManager.project(point);
            if (proj) projectedPoints.push(proj);
        }

        if (projectedPoints.length < 2) {
            // Fallback to screen-space arrow if projection fails
            return;
        }

        const centerProj = projectionManager.project(plateCenter);
        if (!centerProj) return;

        // Draw the arc on globe
        ctx.strokeStyle = isDragging ? '#3498db' : '#2980b9';
        ctx.lineWidth = 4;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(projectedPoints[0][0], projectedPoints[0][1]);
        for (let i = 1; i < projectedPoints.length; i++) {
            ctx.lineTo(projectedPoints[i][0], projectedPoints[i][1]);
        }
        ctx.stroke();

        // Draw arrowhead at the end
        const lastIdx = projectedPoints.length - 1;
        const prevIdx = Math.max(0, lastIdx - 1);
        const endX = projectedPoints[lastIdx][0];
        const endY = projectedPoints[lastIdx][1];
        const prevX = projectedPoints[prevIdx][0];
        const prevY = projectedPoints[prevIdx][1];

        const headLen = 12;
        const angle = Math.atan2(endY - prevY, endX - prevX);
        ctx.beginPath();
        ctx.moveTo(endX, endY);
        ctx.lineTo(
            endX - headLen * Math.cos(angle - Math.PI / 6),
            endY - headLen * Math.sin(angle - Math.PI / 6)
        );
        ctx.moveTo(endX, endY);
        ctx.lineTo(
            endX - headLen * Math.cos(angle + Math.PI / 6),
            endY - headLen * Math.sin(angle + Math.PI / 6)
        );
        ctx.stroke();

        // Draw handle at arrow tip
        ctx.beginPath();
        ctx.arc(endX, endY, HANDLE_RADIUS - 2, 0, Math.PI * 2);
        ctx.fillStyle = isDragging ? '#5dade2' : '#3498db';
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Rate labels around the arrow midpoint
        const midX = (centerProj[0] + endX) / 2;
        const midY = (centerProj[1] + endY) / 2;

        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = 'bold 11px sans-serif';

        // Degrees above
        ctx.fillStyle = '#fff';
        ctx.fillText(`${rate.toFixed(1)}°/Ma`, midX, midY - 10);

        // cm/yr below
        const radPerMa = rate * Math.PI / 180;
        const cmPerYr = (radPerMa * planetRadiusKm) / 10;
        ctx.fillStyle = '#a6e3a1';
        ctx.fillText(`${cmPerYr.toFixed(2)} cm/yr`, midX, midY + 10);
    }

    // Calculate points along the rotation arc on the sphere
    private calculateRotationArc(
        center: Coordinate,
        pole: Coordinate,
        rate: number
    ): Coordinate[] {
        const points: Coordinate[] = [];
        const numPoints = 10;

        // Convert to radians
        const centerLon = center[0] * Math.PI / 180;
        const centerLat = center[1] * Math.PI / 180;
        const poleLon = pole[0] * Math.PI / 180;
        const poleLat = pole[1] * Math.PI / 180;

        // Convert center to 3D vector
        const cx = Math.cos(centerLat) * Math.cos(centerLon);
        const cy = Math.cos(centerLat) * Math.sin(centerLon);
        const cz = Math.sin(centerLat);

        // Euler pole as rotation axis
        const ax = Math.cos(poleLat) * Math.cos(poleLon);
        const ay = Math.cos(poleLat) * Math.sin(poleLon);
        const az = Math.sin(poleLat);

        // Arc length proportional to rate (reduced strength)
        // Scale 33 means visual arc angle = rate * 33
        // e.g. 1 deg/Ma will show as a 33 degree arc on the globe
        const totalAngle = rate * 33 * Math.PI / 180;

        for (let i = 0; i <= numPoints; i++) {
            const angle = (i / numPoints) * totalAngle;

            // Rodrigues' rotation formula
            const cosA = Math.cos(angle);
            const sinA = Math.sin(angle);
            const dot = ax * cx + ay * cy + az * cz;

            const rx = cx * cosA + (ay * cz - az * cy) * sinA + ax * dot * (1 - cosA);
            const ry = cy * cosA + (az * cx - ax * cz) * sinA + ay * dot * (1 - cosA);
            const rz = cz * cosA + (ax * cy - ay * cx) * sinA + az * dot * (1 - cosA);

            // Convert back to lon/lat
            const lat = Math.asin(Math.max(-1, Math.min(1, rz))) * 180 / Math.PI;
            const lon = Math.atan2(ry, rx) * 180 / Math.PI;

            points.push([lon, lat]);
        }

        return points;
    }

    public hitTest(
        mouseX: number,
        mouseY: number,
        projectionManager: ProjectionManager,
        plateCenter: Coordinate
    ): GizmoHandle {
        if (!this.state) return null;

        const poleProj = projectionManager.project(this.state.polePosition);
        const centerProj = projectionManager.project(plateCenter);

        if (!poleProj || !centerProj) return null;

        // Check pole handle
        const poleDist = Math.sqrt(
            Math.pow(mouseX - poleProj[0], 2) + Math.pow(mouseY - poleProj[1], 2)
        );
        if (poleDist <= HANDLE_RADIUS + 4) {
            return 'pole';
        }

        // Check rate handle (at end of arc on globe)
        const arcPoints = this.calculateRotationArc(plateCenter, this.state.polePosition, this.state.rate);
        if (arcPoints.length > 0) {
            const lastPoint = arcPoints[arcPoints.length - 1];
            const lastProj = projectionManager.project(lastPoint);
            if (lastProj) {
                const rateDist = Math.sqrt(Math.pow(mouseX - lastProj[0], 2) + Math.pow(mouseY - lastProj[1], 2));
                if (rateDist <= HANDLE_RADIUS + 4) {
                    return 'rate';
                }
            }
        }

        return null;
    }

    public startDrag(handle: GizmoHandle, mouseX: number, mouseY: number): void {
        if (!this.state || !handle) return;
        this.state.isDragging = handle;
        this.state.dragStart = { x: mouseX, y: mouseY };
    }

    private mode: InteractionMode = 'classic';

    public setMode(mode: InteractionMode): void {
        this.mode = mode;
    }

    public updateDrag(
        mouseX: number,
        mouseY: number,
        projectionManager: ProjectionManager,
        plateCenter: Coordinate
    ): { polePosition?: Coordinate; rate?: number } | null {
        if (!this.state || !this.state.isDragging) return null;

        if (this.state.isDragging === 'pole') {
            // Convert mouse position to geo coordinates
            const geoPos = projectionManager.invert(mouseX, mouseY);
            if (geoPos) {
                this.state.polePosition = geoPos;
                return { polePosition: geoPos };
            }
        } else if (this.state.isDragging === 'rate') {
            const mouseGeo = projectionManager.invert(mouseX, mouseY);

            if (mouseGeo) {
                if (this.mode === 'dynamic_pole') {
                    // Dynamic Pole: Pole = Cross(Center, Mouse), Rate > 0
                    const C = latLonToVector(plateCenter);
                    const M = latLonToVector(mouseGeo);

                    let poleVec = cross(C, M);
                    const len = Math.sqrt(poleVec.x ** 2 + poleVec.y ** 2 + poleVec.z ** 2);

                    if (len > 0.01) {
                        poleVec = normalize(poleVec);
                        // Angle between Center and Mouse
                        const dotProd = dot(C, M);
                        const angleRad = Math.acos(Math.max(-1, Math.min(1, dotProd)));
                        const angleDeg = angleRad * 180 / Math.PI;

                        // Set new state
                        const newPole = vectorToLatLon(poleVec);
                        // Rate is always positive magnitude, direction determined by pole
                        // Division by 33 to match visual scale (33 deg arc = 1 deg/Ma)
                        const newRate = angleDeg / 33;

                        this.state.polePosition = newPole;
                        this.state.rate = Math.round(newRate * 20) / 20;

                        return { polePosition: newPole, rate: this.state.rate };
                    }
                } else {
                    // Geographic drag: Calculate rate based on angle around Euler pole
                    const P = latLonToVector(this.state.polePosition);
                    const C = latLonToVector(plateCenter);
                    const M = latLonToVector(mouseGeo);

                    const N1 = normalize(cross(P, C));
                    const N2 = normalize(cross(P, M));

                    if ((N1.x !== 0 || N1.y !== 0 || N1.z !== 0) &&
                        (N2.x !== 0 || N2.y !== 0 || N2.z !== 0)) {

                        let dotProd = dot(N1, N2);
                        dotProd = Math.max(-1, Math.min(1, dotProd));
                        const angleRad = Math.acos(dotProd);
                        const angleDeg = angleRad * 180 / Math.PI;

                        const crossN = cross(N1, N2);
                        const sign = dot(crossN, P) >= 0 ? 1 : -1;

                        // Division by 33 to match visual scale
                        const newRate = sign * angleDeg / 33;

                        this.state.rate = Math.round(newRate * 20) / 20;
                        return { rate: this.state.rate };
                    }
                }
            }
        }

        return null;
    }

    public endDrag(): { polePosition: Coordinate; rate: number } | null {
        if (!this.state) return null;

        const result = {
            polePosition: this.state.polePosition,
            rate: this.state.rate
        };

        this.state.isDragging = null;
        this.state.dragStart = null;

        return result;
    }

    public isDragging(): boolean {
        return this.state?.isDragging !== null;
    }
}
