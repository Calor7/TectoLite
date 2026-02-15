import { Coordinate } from '../../types';

export interface InputTool {
    onMouseDown(e: MouseEvent, geo: Coordinate | null, screenPos: { x: number, y: number }): void;
    onMouseMove(e: MouseEvent, geo: Coordinate | null, screenPos: { x: number, y: number }): void;
    onMouseUp(e: MouseEvent, geo: Coordinate | null, screenPos: { x: number, y: number }): void;
    onDoubleClick?(e: MouseEvent, geo: Coordinate | null, screenPos: { x: number, y: number }): void;
    onKeyDown(e: KeyboardEvent): void;
    onKeyUp(e: KeyboardEvent): void;
    render(ctx: CanvasRenderingContext2D, width: number, height: number): void;
    cancel(): void;
    activate?(): void;
    deactivate?(): void;
}
