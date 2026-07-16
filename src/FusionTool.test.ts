import { describe, expect, it } from 'vitest';
import { fusePlates } from './FusionTool';
import { createDefaultWorldState, type AppState, type Coordinate, type Feature, type TectonicPlate } from './types';

function makePlate(id: string, points: Coordinate[], overrides: Partial<TectonicPlate> = {}): TectonicPlate {
    const polygons = [{ id: `${id}-polygon`, points, closed: true }];
    return {
        id,
        name: `Plate ${id}`,
        type: 'lithosphere',
        polygonType: 'continental_plate',
        color: '#ff0000',
        zIndex: 0,
        birthTime: 0,
        deathTime: null,
        visible: true,
        locked: false,
        center: points[0],
        polygons,
        features: [],
        initialPolygons: polygons,
        initialFeatures: [],
        motionSegments: [{ time: 0, eulerPole: { position: [0, 90], rate: 0, visible: false } }],
        geometryStages: [{ time: 0, polygons, features: [] }],
        events: [],
        connectedRiftIds: [],
        ...overrides
    };
}

function makeState(plates: TectonicPlate[]): AppState {
    const world = createDefaultWorldState();
    world.plates = plates;
    world.currentTime = 25;
    return {
        world,
        activeTool: 'select',
        activeFeatureType: 'mountain',
        drawMode: 'polygon',
        activeLineType: 'divergent',
        activePolygonType: 'generic',
        viewport: { width: 1200, height: 800, scale: 250, rotate: [0, 0, 0], translate: [600, 400] }
    };
}

describe('fusePlates', () => {
    it('rejects missing plates and self-fusion without changing state', () => {
        const plate = makePlate('a', [[0, 0], [10, 0], [10, 10], [0, 10]]);
        const state = makeState([plate]);

        expect(fusePlates(state, 'a', 'missing')).toEqual({ success: false, error: 'One or both plates not found' });
        expect(fusePlates(state, 'a', 'a')).toEqual({ success: false, error: 'Cannot fuse a plate with itself' });
        expect(state.world.plates).toEqual([plate]);
    });

    it('creates one selected child, combines features, and retires both parents', () => {
        const featureA = { id: 'feature-a', type: 'mountain', position: [2, 2] } as Feature;
        const featureB = { id: 'feature-b', type: 'volcano', position: [12, 2] } as Feature;
        const a = makePlate('a', [[0, 0], [10, 0], [10, 10], [0, 10]], {
            name: 'A', features: [featureA], initialFeatures: [featureA], groupId: 'shared'
        });
        const b = makePlate('b', [[5, 0], [15, 0], [15, 10], [5, 10]], {
            name: 'B', color: '#0000ff', features: [featureB], initialFeatures: [featureB], groupId: 'shared'
        });

        const result = fusePlates(makeState([a, b]), 'a', 'b');
        expect(result.success).toBe(true);
        const world = result.newState!.world;
        const fused = world.plates.find(plate => plate.id === world.selectedPlateId)!;

        expect(fused.parentPlateIds).toEqual(['a', 'b']);
        expect(fused.birthTime).toBe(25);
        expect(fused.features.map(feature => feature.id)).toEqual(['feature-a', 'feature-b']);
        expect(fused.groupId).toBe('shared');
        expect(fused.polygons.flatMap(polygon => polygon.points).length).toBeGreaterThanOrEqual(4);
        expect(world.plates.filter(plate => plate.id === 'a' || plate.id === 'b').every(plate => plate.deathTime === 25)).toBe(true);
    });

    it('falls back to separate polygons for disjoint plates and clears conflicting groups', () => {
        const a = makePlate('a', [[-40, 0], [-30, 0], [-30, 10], [-40, 10]], { groupId: 'one' });
        const b = makePlate('b', [[30, 0], [40, 0], [40, 10], [30, 10]], { groupId: 'two' });

        const result = fusePlates(makeState([a, b]), 'a', 'b');
        const fused = result.newState!.world.plates.at(-1)!;

        expect(fused.polygons).toHaveLength(2);
        expect(fused.groupId).toBeUndefined();
    });

    it('keeps an oceanic result only when both parents are oceanic', () => {
        const pointsA: Coordinate[] = [[0, 0], [10, 0], [10, 10], [0, 10]];
        const pointsB: Coordinate[] = [[5, 0], [15, 0], [15, 10], [5, 10]];
        const oceanA = makePlate('a', pointsA, { type: 'oceanic', polygonType: 'oceanic_plate' });
        const oceanB = makePlate('b', pointsB, { type: 'oceanic', polygonType: 'oceanic_plate' });
        const continent = makePlate('c', pointsB);

        expect(fusePlates(makeState([oceanA, oceanB]), 'a', 'b').newState!.world.plates.at(-1)!.polygonType).toBe('oceanic_plate');
        expect(fusePlates(makeState([oceanA, continent]), 'a', 'c').newState!.world.plates.at(-1)!.polygonType).toBe('continental_plate');
    });
});
