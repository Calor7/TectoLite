import { Coordinate } from '../../types';
import { InputTool } from './InputTool';
import { ProjectionManager } from '../ProjectionManager';
import { distance } from '../../utils/sphericalMath';

export class PathInputTool implements InputTool {
    private points: Coordinate[] = [];
    private isDrawing: boolean = false;
    private mouseGeo: Coordinate | null = null;

    // Configurable modes
    public isLineMode: boolean = false;
    public snappingEnabled: boolean = false;

    // Snapping: external provider for candidate vertices
    private snapCandidateProvider: (() => Coordinate[]) | null = null;
    private snapThresholdPx: number = 12; // pixel distance to snap

    constructor(
        private projectionManager: ProjectionManager,
        private onUpdate: (count: number) => void,
        private onComplete: (points: Coordinate[]) => void,
        private onCancel: () => void,
        public minPoints: number = 2,
        private previewColor: string = '#ffffff'
    ) { }

    /** Set a function that provides all candidate vertices for snapping */
    setSnapCandidateProvider(provider: () => Coordinate[]): void {
        this.snapCandidateProvider = provider;
    }

    activate() {
        this.points = [];
        this.isDrawing = false;
        this.onUpdate(0);
    }

    deactivate() {
        this.cancel();
    }

    /** Configure for polygon mode (closed shape, min 3 points) */
    configurePolygonMode(): void {
        this.isLineMode = false;
        this.minPoints = 3;
        this.previewColor = '#ffffff';
    }

    /** Configure for line mode (open path, min 2 points) */
    configureLineMode(): void {
        this.isLineMode = true;
        this.minPoints = 2;
        this.previewColor = '#ff8844';
    }

    /** Try to snap a geo coordinate to the nearest existing vertex */
    private trySnap(geo: Coordinate, screenPos: { x: number; y: number }): Coordinate {
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

    onMouseDown(e: MouseEvent, geo: Coordinate | null, screenPos: { x: number, y: number }): void {
        if (!geo) return;

        // Right Click: Remove last point (Undo) - User Request
        if (e.button === 2) {
            if (this.points.length > 0) {
                this.points.pop();
                if (this.points.length === 0) this.isDrawing = false;
                this.onUpdate(this.points.length);
            }
            return;
        }

        if (e.button !== 0) return;

        // Apply snapping
        const snapped = this.trySnap(geo, screenPos);

        if (!this.isDrawing) {
            this.isDrawing = true;
            this.points = [snapped];
        } else {
            this.points.push(snapped);
        }

        this.onUpdate(this.points.length);
    }

    onMouseMove(_e: MouseEvent, geo: Coordinate | null, _screenPos: { x: number, y: number }): void {
        if (geo && this.snappingEnabled) {
            this.mouseGeo = this.trySnap(geo, _screenPos);
        } else {
            this.mouseGeo = geo;
        }
    }

    onMouseUp(_e: MouseEvent, _geo: Coordinate | null, _screenPos: { x: number, y: number }): void {
        // No-op for path tool
    }

    onDoubleClick(_e: MouseEvent, _geo: Coordinate | null, _screenPos: { x: number, y: number }): void {
        if (this.isDrawing && this.points.length >= this.minPoints) {
            this.forceComplete();
        }
    }

    onKeyDown(e: KeyboardEvent): void {
        if (e.key === 'Enter') {
            this.forceComplete();
        } else if (e.key === 'Escape') {
            this.cancel();
        } else if (e.key === 'Backspace' && this.points.length > 0) {
            this.points.pop();
            if (this.points.length === 0) this.isDrawing = false;
            this.onUpdate(this.points.length);
        }
    }

    onKeyUp(_e: KeyboardEvent): void { }

    cancel(): void {
        if (this.isDrawing || this.points.length > 0) {
            this.isDrawing = false;
            this.points = [];
            this.onUpdate(0);
            this.onCancel();
        }
    }

    forceComplete(): void {
        if (this.isDrawing && this.points.length >= this.minPoints) {
            this.onComplete([...this.points]);
            this.points = [];
            this.isDrawing = false;
            this.onUpdate(0);
        }
    }

    render(ctx: CanvasRenderingContext2D, _width: number, _height: number): void {
        if (!this.isDrawing && this.points.length === 0) return;

        ctx.save();
        ctx.strokeStyle = this.previewColor;
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';

        // Use dashed line for line mode to visually distinguish from polygon
        if (this.isLineMode) {
            ctx.setLineDash([8, 4]);
        }

        let totalDistance = 0;

        // Draw established segments
        if (this.points.length > 0) {
            ctx.beginPath();
            let started = false;
            let lastPt: Coordinate | null = null;

            for (const pt of this.points) {
                const screen = this.projectionManager.project(pt);
                if (screen) {
                    if (!started) {
                        ctx.moveTo(screen[0], screen[1]);
                        started = true;
                    } else {
                        ctx.lineTo(screen[0], screen[1]);
                        if (lastPt) {
                            totalDistance += distance(lastPt, pt) * 6371; // Earth radius in km
                        }
                    }
                    lastPt = pt;
                }
            }

            // Draw elastic line to cursor
            if (this.mouseGeo && lastPt) {
                const screen = this.projectionManager.project(this.mouseGeo);
                if (screen) {
                    ctx.lineTo(screen[0], screen[1]);
                    // Show distance of CURRENT segment only (User Request)
                    const segmentDist = distance(lastPt, this.mouseGeo) * 6371;

                    ctx.fillStyle = '#ffffff';
                    ctx.font = '12px Sans-Serif';
                    ctx.shadowColor = 'rgba(0,0,0,0.8)';
                    ctx.shadowBlur = 4;
                    ctx.fillText(`${Math.round(segmentDist).toLocaleString()} km`, screen[0] + 15, screen[1] - 15);
                    ctx.shadowBlur = 0;
                }
            }

            ctx.stroke();

            // Draw vertices
            ctx.fillStyle = this.previewColor;
            for (const pt of this.points) {
                const screen = this.projectionManager.project(pt);
                if (screen) {
                    ctx.beginPath();
                    ctx.arc(screen[0], screen[1], 4, 0, Math.PI * 2);
                    ctx.fill();
                }
            }

            // Draw snap indicator on cursor if snapping is active
            if (this.snappingEnabled && this.mouseGeo) {
                const cursorScreen = this.projectionManager.project(this.mouseGeo);
                if (cursorScreen) {
                    ctx.strokeStyle = '#00ff88';
                    ctx.lineWidth = 2;
                    ctx.setLineDash([]);
                    ctx.beginPath();
                    ctx.arc(cursorScreen[0], cursorScreen[1], 8, 0, Math.PI * 2);
                    ctx.stroke();
                }
            }
        }
        ctx.restore();
    }
}
