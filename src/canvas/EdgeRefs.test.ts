import { afterEach, describe, expect, it, vi } from 'vitest';
import { SimulationEngine } from '../SimulationEngine';
import { createDefaultWorldState, type AppState, type Coordinate, type Polygon, type TectonicPlate } from '../types';
import { CanvasManager } from './CanvasManager';
import { resolveEdgeSegment, resolveSelectedEdge } from './EdgeRefs';

function ring(id: string, count: number, closed = true): Polygon {
    const points: Coordinate[] = Array.from({ length: count }, (_, index) => {
        const angle = (index / count) * Math.PI * 2;
        return [Math.cos(angle) * 10, Math.sin(angle) * 10];
    });
    return { id, points, closed };
}

function plateWithStages(stages: { time: number; polygon: Polygon }[]): TectonicPlate {
    const first = stages[0].polygon;
    return {
        id: 'plate', name: 'Plate', color: '#4a9c6d', polygonType: 'generic',
        birthTime: 0, deathTime: null, visible: true, locked: false,
        center: [0, 0], polygons: [first], initialPolygons: [first],
        features: [], initialFeatures: [],
        motionSegments: [{ time: 0, eulerPole: { position: [0, 90], rate: 0, visible: false } }],
        geometryStages: stages.map(stage => ({ time: stage.time, polygons: [stage.polygon], features: [] })),
        events: [], connectedRiftIds: [],
    };
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('edge references', () => {
    it('resolves closed edges, including the wrap-around edge', () => {
        const square = ring('square', 4);
        expect(resolveEdgeSegment([square], 0, 1)).toEqual([square.points[1], square.points[2]]);
        expect(resolveEdgeSegment([square], 0, 3)).toEqual([square.points[3], square.points[0]]);
    });

    it('has no edge after the last vertex of an open line', () => {
        const line = ring('line', 4, false);
        expect(resolveEdgeSegment([line], 0, 2)).toEqual([line.points[2], line.points[3]]);
        expect(resolveEdgeSegment([line], 0, 3)).toBeNull();
    });

    it('rejects references that no longer fit the geometry', () => {
        const shape = ring('shape', 61);
        // The reported save selected edge 65 on a plate that now has 61 points.
        expect(resolveEdgeSegment([shape], 0, 65)).toBeNull();
        expect(resolveEdgeSegment([shape], 0, 61)).toBeNull();
        expect(resolveEdgeSegment([shape], 0, -1)).toBeNull();
        expect(resolveEdgeSegment([shape], 0, 1.5)).toBeNull();
        expect(resolveEdgeSegment([shape], 1, 0)).toBeNull();
    });

    it('drops a selected edge once the timeline reaches a stage with fewer points', () => {
        const world = createDefaultWorldState();
        world.plates = [plateWithStages([
            { time: 0, polygon: ring('shape', 73) },
            { time: 10, polygon: ring('shape', 61) },
        ])];
        world.selectedPlateId = 'plate';
        world.selectedPlateIds = ['plate'];
        world.selectedEdge = { plateId: 'plate', polyIndex: 0, vertexIndex: 65 };
        let state: AppState = {
            world, activeTool: 'select', activeFeatureType: 'mountain', drawMode: 'polygon',
            activeLineType: 'divergent', activePolygonType: 'generic',
            viewport: { width: 1200, height: 800, scale: 250, rotate: [0, 0, 0], translate: [600, 400] },
        };
        const simulation = new SimulationEngine(() => state, updater => { state = updater(state); });

        simulation.setTime(5);
        expect(resolveSelectedEdge(state.world)?.segment).toHaveLength(2);

        simulation.setTime(10);
        expect(state.world.plates[0].polygons[0].points).toHaveLength(61);
        expect(state.world.selectedEdge).not.toBeNull();
        expect(resolveSelectedEdge(state.world)).toBeNull();
    });

    it('ignores a selected edge whose plate is gone', () => {
        const world = createDefaultWorldState();
        world.selectedEdge = { plateId: 'missing', polyIndex: 0, vertexIndex: 0 };
        expect(resolveSelectedEdge(world)).toBeNull();
    });
});

describe('map rendering', () => {
    it('reports a failed frame instead of throwing out of the render loop', () => {
        const report = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const manager = Object.create(CanvasManager.prototype) as CanvasManager;
        (manager as unknown as { updateActiveTool: () => void }).updateActiveTool = () => {
            throw new Error('draw failed');
        };

        expect(() => manager.render()).not.toThrow();
        expect(() => manager.render()).not.toThrow();
        // The same failure repeats every frame, so it is logged once.
        expect(report).toHaveBeenCalledTimes(1);
    });
});
