import { Coordinate, Point, FeatureType } from '../../types';
import { InputTool } from './InputTool';

export class PlacementTool implements InputTool {
    constructor(
        private getActiveFeatureType: () => FeatureType,
        private onPlace: (geo: Coordinate, type: FeatureType) => void,
        private onCancel: () => void
    ) { }

    onMouseDown(e: MouseEvent, geo: Coordinate | null, _screenPos: Point): void {
        if (e.button === 0 && geo) {
            this.onPlace(geo, this.getActiveFeatureType());
        }
    }

    onMouseMove(_e: MouseEvent, _geo: Coordinate | null, _screenPos: Point): void { }

    onMouseUp(_e: MouseEvent, _geo: Coordinate | null, _screenPos: Point): void { }

    onKeyDown(e: KeyboardEvent): void {
        if (e.key === 'Escape') {
            this.cancel();
        }
    }

    onKeyUp(_e: KeyboardEvent): void { }

    cancel(): void {
        this.onCancel();
    }

    render(_ctx: CanvasRenderingContext2D, _width: number, _height: number): void {
        // Optional: Draw preview of feature at cursor?
        // Current implementation doesn't support it, relied on CanvasManager calling it.
        // We can add it back later.
    }
}
