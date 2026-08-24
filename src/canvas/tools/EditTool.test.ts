import { describe, expect, it, vi } from 'vitest';
import { AppState, Coordinate, TectonicPlate } from '../../types';
import { ProjectionManager } from '../ProjectionManager';
import { EditTool } from './EditTool';

function createTool(plate: TectonicPlate, polyIndex: number, vertexIndex: number) {
    const state = {
        activeTool: 'edit',
        world: { plates: [plate], selectedPlateId: plate.id }
    } as unknown as AppState;
    const onUpdate = vi.fn();
    const tool = new EditTool(
        { project: (coordinate: Coordinate) => coordinate } as unknown as ProjectionManager,
        () => state,
        onUpdate,
        vi.fn(),
        () => ({ type: 'vertex', data: { plateId: plate.id, polyIndex, vertexIndex } }),
        vi.fn()
    );
    tool.onMouseMove(
        { shiftKey: false, ctrlKey: false, metaKey: false } as MouseEvent,
        [0, 0],
        { x: 0, y: 0 }
    );
    return { tool, onUpdate };
}

function polygon(id: string, points: Coordinate[]) {
    return { id, closed: true, points };
}

function plateWith(polygons: ReturnType<typeof polygon>[]): TectonicPlate {
    return { id: 'plate-1', polygons } as unknown as TectonicPlate;
}

describe('EditTool vertex deletion', () => {
    it('automatically removes a three-vertex component from a multi-polygon plate', () => {
        const plate = plateWith([
            polygon('large', [[0, 0], [10, 0], [10, 10], [0, 10]]),
            polygon('small', [[20, 20], [21, 20], [20, 21]])
        ]);
        const { tool, onUpdate } = createTool(plate, 1, 2);

        tool.onMouseDown({ button: 2 } as MouseEvent, null, { x: 0, y: 0 });

        expect(tool.getTempPolygons()?.polygons.map(poly => poly.id)).toEqual(['large']);
        expect(tool.getHoveredVertex()).toBeNull();
        expect(onUpdate).toHaveBeenCalledWith(true);
        expect(plate.polygons).toHaveLength(2);
    });

    it('protects the plate\'s only polygon at three vertices', () => {
        const plate = plateWith([
            polygon('only', [[0, 0], [10, 0], [0, 10]])
        ]);
        const { tool, onUpdate } = createTool(plate, 0, 2);

        tool.onMouseDown({ button: 2 } as MouseEvent, null, { x: 0, y: 0 });

        expect(tool.getTempPolygons()).toBeNull();
        expect(onUpdate).not.toHaveBeenCalled();
        expect(plate.polygons).toHaveLength(1);
    });

    it('clears a stale last-vertex hover after a normal deletion', () => {
        const plate = plateWith([
            polygon('only', [[0, 0], [10, 0], [10, 10], [0, 10]])
        ]);
        const { tool } = createTool(plate, 0, 3);

        tool.onMouseDown({ button: 2 } as MouseEvent, null, { x: 0, y: 0 });

        expect(tool.getTempPolygons()?.polygons[0].points).toHaveLength(3);
        expect(tool.getHoveredVertex()).toBeNull();
        expect(plate.polygons[0].points).toHaveLength(4);
    });
});
