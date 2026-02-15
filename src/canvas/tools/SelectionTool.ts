import { Coordinate, Point } from '../../types';
import { InputTool } from './InputTool';
import { ProjectionManager } from '../ProjectionManager';

export class SelectionTool implements InputTool {
    private isBoxSelecting: boolean = false;
    private boxStart: Point | null = null;
    private boxCurrent: Point | null = null;

    constructor(
        // Removing 'private' makes it just an argument, avoiding TS6138 property unused error.
        // Prepending with _ avoids TS6133 unused local variable error.
        _projectionManager: ProjectionManager,
        private onSelect: (geo: Coordinate | null, screenPos: Point, modifiers: { shift: boolean, ctrl: boolean, alt: boolean }) => void,
        private onBoxSelect: (start: Point, end: Point, modifiers: { shift: boolean, ctrl: boolean, alt: boolean }) => void,
        private onHover: (geo: Coordinate | null, screenPos: Point) => void
    ) { }

    onMouseDown(e: MouseEvent, geo: Coordinate | null, screenPos: Point): void {
        if (e.button !== 0) return;

        if (e.shiftKey) {
            this.isBoxSelecting = true;
            this.boxStart = screenPos;
            this.boxCurrent = screenPos;
        } else {
            this.onSelect(geo, screenPos, { shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey });
        }
    }

    onMouseMove(_e: MouseEvent, geo: Coordinate | null, screenPos: Point): void {
        if (this.isBoxSelecting) {
            this.boxCurrent = screenPos;
        } else {
            this.onHover(geo, screenPos);
        }
    }

    onMouseUp(e: MouseEvent, _geo: Coordinate | null, _screenPos: Point): void {
        if (this.isBoxSelecting && this.boxStart && this.boxCurrent) {
            const dx = this.boxCurrent.x - this.boxStart.x;
            const dy = this.boxCurrent.y - this.boxStart.y;
            if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
                this.onBoxSelect(this.boxStart, this.boxCurrent, { shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey });
            } else {
                this.onSelect(_geo, _screenPos, { shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey });
            }
            this.isBoxSelecting = false;
            this.boxStart = null;
            this.boxCurrent = null;
        }
    }

    onKeyDown(_e: KeyboardEvent): void { }
    onKeyUp(_e: KeyboardEvent): void { }

    cancel(): void {
        this.isBoxSelecting = false;
        this.boxStart = null;
        this.boxCurrent = null;
    }

    render(ctx: CanvasRenderingContext2D, _width: number, _height: number): void {
        if (this.isBoxSelecting && this.boxStart && this.boxCurrent) {
            const x = Math.min(this.boxStart.x, this.boxCurrent.x);
            const y = Math.min(this.boxStart.y, this.boxCurrent.y);
            const w = Math.abs(this.boxCurrent.x - this.boxStart.x);
            const h = Math.abs(this.boxCurrent.y - this.boxStart.y);

            ctx.save();
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1;
            ctx.setLineDash([5, 3]);
            ctx.strokeRect(x, y, w, h);
            ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
            ctx.fillRect(x, y, w, h);
            ctx.restore();
        }
    }
}
