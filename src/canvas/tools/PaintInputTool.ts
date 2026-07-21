import { Coordinate, ElevationFalloff } from '../../types';
import { greatCircleDistanceKm } from '../../systems/ElevationField';
import { ProjectionManager } from '../ProjectionManager';
import { InputTool } from './InputTool';

export interface PaintSettings {
    radiusKm: number;
    strengthMeters: number;
    falloff: ElevationFalloff;
    mode: 'raise' | 'lower';
}

export interface PaintOwner {
    id: string;
    valid: boolean;
    reason?: string;
}

/** Pointer-capture-free paint input. Draft coordinates remain transient and a
 * single callback is emitted only when the primary pointer is released. */
export class PaintInputTool implements InputTool {
    private drawing = false;
    private ownerId: string | null = null;
    private draft: Coordinate[] = [];

    constructor(
        private projection: ProjectionManager,
        private getOwner: () => PaintOwner | null,
        private getSettings: () => PaintSettings,
        private getPlanetRadius: () => number,
        private onCommit: (ownerId: string, path: Coordinate[], settings: PaintSettings) => void,
        private onReject: (reason: string) => void,
        private getClipMasks: () => Coordinate[][][][] = () => []
    ) { }

    onMouseDown(event: MouseEvent, geo: Coordinate | null): void {
        if (event.button !== 0 || !geo) return;
        const owner = this.getOwner();
        if (!owner?.valid) {
            this.onReject(owner?.reason || 'Select a live, unlocked plate before painting.');
            return;
        }
        this.drawing = true;
        this.ownerId = owner.id;
        this.draft = [[...geo] as Coordinate];
    }

    onMouseMove(_event: MouseEvent, geo: Coordinate | null): void {
        if (!this.drawing || !geo) return;
        const previous = this.draft[this.draft.length - 1];
        const settings = this.getSettings();
        const captureSpacing = Math.max(0.5, settings.radiusKm / 8);
        if (greatCircleDistanceKm(previous, geo, this.getPlanetRadius()) >= captureSpacing) {
            this.draft.push([...geo] as Coordinate);
        }
    }

    onMouseUp(event: MouseEvent, geo: Coordinate | null): void {
        if (event.button !== 0 || !this.drawing || !this.ownerId) return;
        if (geo) {
            const last = this.draft[this.draft.length - 1];
            if (greatCircleDistanceKm(last, geo, this.getPlanetRadius()) > 0.001) this.draft.push([...geo] as Coordinate);
        }
        const ownerId = this.ownerId;
        const path = this.draft.map(point => [...point] as Coordinate);
        const settings = this.getSettings();
        this.clear();
        if (path.length > 0) this.onCommit(ownerId, path, settings);
    }

    onKeyDown(event: KeyboardEvent): void { if (event.key === 'Escape') this.cancel(); }
    onKeyUp(): void { }
    activate(): void { this.clear(); }
    cancel(): void { this.clear(); }

    private clear(): void {
        this.drawing = false;
        this.ownerId = null;
        this.draft = [];
    }

    render(ctx: CanvasRenderingContext2D): void {
        if (this.draft.length === 0) return;
        const settings = this.getSettings();
        const path = this.projection.getPathGenerator();
        const scale = this.projection.getProjection().scale();
        const width = Math.max(2, 2 * settings.radiusKm / this.getPlanetRadius() * scale);
        ctx.save();
        ctx.strokeStyle = settings.mode === 'lower' ? 'rgba(137,180,250,.8)' : 'rgba(166,227,161,.8)';
        ctx.fillStyle = ctx.strokeStyle;
        ctx.globalAlpha = settings.falloff === 'smoothstep' ? 0.55 : 0.75;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineWidth = width;
        for(const mask of this.getClipMasks()){ctx.beginPath();path({type:'MultiPolygon',coordinates:mask} as any);ctx.clip();}
        if (this.draft.length === 1) {
            const projected = this.projection.project(this.draft[0]);
            if (projected) { ctx.beginPath(); ctx.arc(projected[0], projected[1], width / 2, 0, Math.PI * 2); ctx.fill(); }
        } else {
            ctx.beginPath();
            path({ type: 'LineString', coordinates: this.draft } as any);
            ctx.stroke();
        }
        ctx.restore();
    }
}
