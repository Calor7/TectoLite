import { describe, expect, it, vi } from 'vitest';
import { AppState, Coordinate, TectonicPlate } from '../../types';
import { ProjectionManager } from '../ProjectionManager';
import { EditTool } from './EditTool';

function createTool(plate: TectonicPlate, vertexIndex: number, polyIndex = 0) {
    const state = {
        activeTool: 'edit',
        world: {
            plates: [plate],
            selectedPlateId: plate.id
        }
    } as unknown as AppState;
    const onUpdate = vi.fn();
    const onNotice = vi.fn();
    const projection = {
        project: (coordinate: Coordinate) => coordinate
    } as unknown as ProjectionManager;
    const tool = new EditTool(
        projection,
        () => state,
        onUpdate,
        vi.fn(),
        () => ({
            type: 'vertex',
            data: { plateId: plate.id, polyIndex, vertexIndex }
        }),
        vi.fn(),
        onNotice
    );

    return { tool, onUpdate, onNotice };
}

function createPlate(): TectonicPlate {
    return {
        id: 'plate-1',
        polygons: [{
            id: 'poly-1',
            closed: true,
            points: [[0, 0], [10, 0], [10, 10], [0, 10], [-5, 5]],
            edgeMeta: [0, 1, 2, 3, 4].map(edgeIndex => ({ edgeIndex, type: 'passive' })),
            riftEdgeIndices: [0, 1, 2, 3, 4],
            edgeStyles: [0, 1, 2, 3, 4].map(edgeIndex => ({ edgeIndex, type: 'passive' }))
        }]
    } as unknown as TectonicPlate;
}

describe('EditTool vertex deletion', () => {
    it('clears the stale hover target after deleting the last vertex', () => {
        const plate = createPlate();
        const { tool, onUpdate } = createTool(plate, 4);

        tool.onMouseMove(
            { shiftKey: false, ctrlKey: false, metaKey: false } as MouseEvent,
            [0, 0],
            { x: 0, y: 0 }
        );
        expect(tool.getHoveredVertex()?.vertexIndex).toBe(4);

        tool.onMouseDown({ button: 2 } as MouseEvent, null, { x: 0, y: 0 });

        expect(tool.getTempPolygons()?.polygons[0].points).toHaveLength(4);
        expect(tool.getHoveredVertex()).toBeNull();
        expect(onUpdate).toHaveBeenCalledWith(true);
        expect(plate.polygons[0].points).toHaveLength(5);
    });

    it('removes incident edge metadata and reindexes later edges', () => {
        const plate = createPlate();
        const { tool } = createTool(plate, 2);

        tool.onMouseMove(
            { shiftKey: false, ctrlKey: false, metaKey: false } as MouseEvent,
            [0, 0],
            { x: 0, y: 0 }
        );
        tool.onMouseDown({ button: 2 } as MouseEvent, null, { x: 0, y: 0 });

        const edited = tool.getTempPolygons()!.polygons[0];
        expect(edited.edgeMeta?.map(meta => meta.edgeIndex)).toEqual([0, 2, 3]);
        expect(edited.riftEdgeIndices).toEqual([0, 2, 3]);
        expect(edited.edgeStyles?.map(style => style.edgeIndex)).toEqual([0, 2, 3]);
    });

    it('explains how to remove a component when normal deletion reaches three vertices', () => {
        const plate = createPlate();
        plate.polygons.push({
            id: 'small-poly',
            closed: true,
            points: [[20, 20], [21, 20], [20, 21]]
        });
        const { tool, onUpdate, onNotice } = createTool(plate, 2, 1);

        tool.onMouseMove(
            { shiftKey: false, ctrlKey: false, metaKey: false } as MouseEvent,
            [20, 21],
            { x: 20, y: 21 }
        );
        tool.onMouseDown({ button: 2, shiftKey: false } as MouseEvent, null, { x: 20, y: 21 });

        expect(tool.getTempPolygons()).toBeNull();
        expect(tool.getHoveredVertex()?.polyIndex).toBe(1);
        expect(onUpdate).not.toHaveBeenCalled();
        expect(onNotice).toHaveBeenCalledWith(expect.stringContaining('Shift'));
        expect(plate.polygons).toHaveLength(2);
    });

    it('removes a whole component immediately with shift-right-click', () => {
        const plate = createPlate();
        plate.polygons.push({
            id: 'small-poly',
            closed: true,
            points: [[20, 20], [21, 20], [21, 21], [20, 21]]
        });
        const { tool } = createTool(plate, 3, 1);

        tool.onMouseMove(
            { shiftKey: false, ctrlKey: false, metaKey: false } as MouseEvent,
            [20, 21],
            { x: 20, y: 21 }
        );
        tool.onMouseDown({ button: 2, shiftKey: true } as MouseEvent, null, { x: 20, y: 21 });

        expect(tool.getTempPolygons()?.polygons.map(poly => poly.id)).toEqual(['poly-1']);
    });

    it('does not remove the only polygon from a plate', () => {
        const plate = createPlate();
        const { tool, onUpdate, onNotice } = createTool(plate, 4);

        tool.onMouseMove(
            { shiftKey: false, ctrlKey: false, metaKey: false } as MouseEvent,
            [0, 0],
            { x: 0, y: 0 }
        );
        tool.onMouseDown({ button: 2, shiftKey: true } as MouseEvent, null, { x: 0, y: 0 });

        expect(tool.getTempPolygons()).toBeNull();
        expect(onUpdate).not.toHaveBeenCalled();
        expect(onNotice).toHaveBeenCalledWith(expect.stringContaining("can't be removed"));
        expect(plate.polygons).toHaveLength(1);
    });
});
