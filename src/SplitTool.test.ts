import { describe, expect, it } from 'vitest';
import { splitPlate } from './SplitTool';
import { createDefaultWorldState, type AppState, type Coordinate, type Feature, type TectonicPlate } from './types';

function makePlate(overrides: Partial<TectonicPlate> = {}): TectonicPlate {
    const points: Coordinate[] = [[-10, -10], [10, -10], [10, 10], [-10, 10]];
    const polygons = [{ id: 'plate-polygon', points, closed: true }];
    return {
        id: 'plate',
        name: 'Source',
        type: 'lithosphere',
        polygonType: 'continental_plate',
        color: '#ffffff',
        zIndex: 0,
        birthTime: 0,
        deathTime: null,
        visible: true,
        locked: false,
        center: [0, 0],
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

function makeState(plate: TectonicPlate): AppState {
    const world = createDefaultWorldState();
    world.plates = [plate];
    world.currentTime = 20;
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

const verticalCut = { points: [[0, -20], [0, 20]] as Coordinate[] };

describe('splitPlate', () => {
    it('leaves state untouched when the plate is missing or the cut does not intersect', () => {
        const state = makeState(makePlate());

        expect(splitPlate(state, 'missing', verticalCut)).toBe(state);
        expect(splitPlate(state, 'plate', { points: [[30, -20], [30, 20]] })).toBe(state);
    });

    it('retires the source and creates two fresh children plus a rift axis', () => {
        const result = splitPlate(makeState(makePlate()), 'plate', verticalCut);
        const children = result.world.plates.filter(plate => plate.parentPlateId === 'plate');

        expect(result.world.plates.find(plate => plate.id === 'plate')!.deathTime).toBe(20);
        expect(children).toHaveLength(2);
        expect(children.every(child => child.birthTime === 20 && child.deathTime === null)).toBe(true);
        expect(children.every(child => child.motionSegments.length === 1 && child.geometryStages.length === 1)).toBe(true);
        expect(children.every(child => child.polygons.every(polygon => polygon.points.length >= 3))).toBe(true);
        expect(result.world.riftAxes).toHaveLength(1);
        expect(new Set([result.world.riftAxes![0].plateIdA, result.world.riftAxes![0].plateIdB])).toEqual(new Set(children.map(child => child.id)));
        expect(children.some(child => child.id === result.world.selectedPlateId)).toBe(true);
    });

    it('partitions features between the generated children', () => {
        const left = { id: 'left-feature', type: 'mountain', position: [-5, 0] } as Feature;
        const right = { id: 'right-feature', type: 'volcano', position: [5, 0] } as Feature;
        const source = makePlate({ features: [left, right], initialFeatures: [left, right] });

        const result = splitPlate(makeState(source), 'plate', verticalCut);
        const children = result.world.plates.filter(plate => plate.parentPlateId === 'plate');
        const assignedIds = children.flatMap(child => child.features.map(feature => feature.id));

        expect(assignedIds.sort()).toEqual(['left-feature', 'right-feature']);
        expect(children.every(child => child.features.length === 1)).toBe(true);
    });
});
