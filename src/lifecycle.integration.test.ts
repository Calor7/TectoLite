import { describe, expect, it } from 'vitest';
import { createWorldFromCurrentTime } from './export';
import { fusePlates } from './FusionTool';
import { CURRENT_SAVE_VERSION } from './migration';
import { SimulationEngine } from './SimulationEngine';
import { linkPlateAtTime } from './motion/LinkModel';
import { derivePlateGeometry, pointPositionAt } from './motion/RotationModel';
import { parseProjectText } from './ProjectIO';
import {
    createDefaultWorldState,
    type AppState,
    type Coordinate,
    type Feature,
    type Polygon,
    type TectonicPlate,
    type WorldState,
} from './types';

function polygon(id: string, longitude: number, closed = true): Polygon {
    return {
        id,
        points: [[longitude, 0], [longitude + 4, 0], [longitude + 4, 4], [longitude, 4]],
        closed,
    };
}

function feature(id: string, type: Feature['type'], position: Coordinate): Feature {
    return { id, type, position, rotation: 0, scale: 1, properties: {}, generatedAt: 0 };
}

function plate(
    id: string,
    shape: Polygon,
    features: Feature[] = [],
    overrides: Partial<TectonicPlate> = {},
): TectonicPlate {
    return {
        id,
        name: id,
        type: 'lithosphere',
        polygonType: 'continental_plate',
        color: '#4a9c6d',
        zIndex: 0,
        birthTime: 0,
        deathTime: null,
        visible: true,
        locked: false,
        center: shape.points[0],
        polygons: [shape],
        features,
        initialPolygons: [shape],
        initialFeatures: features,
        motionSegments: [{ time: 0, eulerPole: { position: [0, 90], rate: 1, visible: false } }],
        geometryStages: [{ time: 0, polygons: [shape], features }],
        events: [],
        connectedRiftIds: [],
        ...overrides,
    };
}

function restore(world: WorldState, version = CURRENT_SAVE_VERSION): WorldState {
    return parseProjectText(JSON.stringify({ version, name: 'Lifecycle', world })).world;
}

function appState(plates: TectonicPlate[], currentTime: number): AppState {
    const world = createDefaultWorldState();
    world.plates = plates;
    world.currentTime = currentTime;
    return {
        world,
        activeTool: 'select',
        activeFeatureType: 'mountain',
        drawMode: 'polygon',
        activeLineType: 'divergent',
        activePolygonType: 'generic',
        viewport: { width: 1200, height: 800, scale: 250, rotate: [0, 0, 0], translate: [600, 400] },
    };
}

function expectCoordinateClose(actual: Coordinate, expected: Coordinate): void {
    expect(actual[0]).toBeCloseTo(expected[0], 8);
    expect(actual[1]).toBeCloseTo(expected[1], 8);
}

describe('project lifecycle integration', () => {
    it.each(['divergent', 'convergent', 'transform', 'generic'] as const)('keeps a %s line and polygon together in either follow direction', lineType => {
        for (const lineIsLeader of [false, true]) {
            const line = plate('line', polygon('line-shape', 0, false), [], { type: 'rift', lineType });
            const land = plate('land', polygon('land-shape', 0));
            const leader = lineIsLeader ? line : land;
            const follower = lineIsLeader ? land : line;
            follower.motionSegments = [{ time: 0, eulerPole: { position: [0, 90], rate: 2 } }];
            const linked = linkPlateAtTime(follower, leader.id, 5);
            let state = appState([leader, linked], 5);
            const simulation = new SimulationEngine(() => state, updater => { state = updater(state); });
            const position = (id: string): Coordinate => state.world.plates.find(candidate => candidate.id === id)!.polygons[0].points[0];

            // Linking preserves the follower's earlier independent history and position.
            simulation.setTime(3);
            expectCoordinateClose(position(follower.id), [6, 0]);
            simulation.setTime(5);
            expectCoordinateClose(position(follower.id), [10, 0]);
            simulation.setTime(15);
            expectCoordinateClose(position(leader.id), [15, 0]);
            expectCoordinateClose(position(follower.id), [20, 0]);

            // A later leader edit carries both shapes, including after save/load.
            state.world.plates.find(candidate => candidate.id === leader.id)!.motionSegments.push({
                time: 20, eulerPole: { position: [0, 90], rate: 3 },
            });
            state.world = restore(state.world);
            simulation.setTime(25);
            expectCoordinateClose(position(leader.id), [35, 0]);
            expectCoordinateClose(position(follower.id), [40, 0]);
            expect(state.world.plates.find(candidate => candidate.id === 'line')!.polygons[0].closed).toBe(false);
        }
    });

    it('preserves a linked orogeny, custom line styling, features, and fused motion through save migration', () => {
        const mountain = feature('mountain-a', 'mountain', [2, 2]);
        const island = feature('island-b', 'island', [5, 2]);
        const parentA = plate('parent-a', polygon('parent-a-shape', 0), [mountain]);
        const parentB = plate('parent-b', polygon('parent-b-shape', 3), [island], {
            color: '#3969ac',
            motionSegments: [{ time: 0, eulerPole: { position: [0, 90], rate: 2, visible: false } }],
        });
        const originalLine = plate('orogeny', polygon('orogeny-line', 1, false), [], {
            type: 'rift',
            polygonType: 'generic',
            lineType: 'convergent',
            color: '#a020f0',
            lineColorCustomized: true,
            motionSegments: [{ time: 0, eulerPole: { position: [0, 90], rate: 0, visible: false } }],
        });
        const linkedLine = linkPlateAtTime(originalLine, parentA.id, 5);
        const state = appState([parentA, parentB, linkedLine], 20);

        const fusedWorld = fusePlates(state, parentA.id, parentB.id).newState!.world;
        const fused = fusedWorld.plates.find(candidate => candidate.id === fusedWorld.selectedPlateId)!;
        fused.motionSegments.push({
            time: 30,
            eulerPole: { position: [0, 90], rate: 3, visible: false },
        });
        fusedWorld.currentTime = 40;

        for (const current of fusedWorld.plates) {
            if (current.birthTime <= 40 && (current.deathTime === null || current.deathTime > 40)) {
                Object.assign(current, derivePlateGeometry(current, fusedWorld.plates, 40));
            }
        }

        const beforeSaveLine = fusedWorld.plates.find(candidate => candidate.id === 'orogeny')!;
        const beforeSavePosition = pointPositionAt(beforeSaveLine, fusedWorld.plates, [1, 0], 5, 40);
        const restored = restore(fusedWorld, 9);
        const restoredLine = restored.plates.find(candidate => candidate.id === 'orogeny')!;
        const restoredParent = restored.plates.find(candidate => candidate.id === 'parent-a')!;
        const restoredFused = restored.plates.find(candidate => candidate.id === fused.id)!;

        expect(restoredLine).toEqual(expect.objectContaining({
            linkedToPlateId: 'parent-a',
            linkTime: 5,
            lineType: 'convergent',
            color: '#a020f0',
            lineColorCustomized: true,
        }));
        expect(restoredFused.parentPlateIds).toEqual(['parent-a', 'parent-b']);
        expect(restoredFused.motionSegments.at(-1)?.eulerPole.rate).toBe(3);
        expect(restoredFused.features.map(item => item.id)).toEqual(['mountain-a', 'island-b']);
        expect(restoredFused.geometryStages[0].features.map(item => item.id)).toEqual(['mountain-a', 'island-b']);

        expectCoordinateClose(
            pointPositionAt(restoredLine, restored.plates, [1, 0], 5, 40),
            beforeSavePosition,
        );
        expectCoordinateClose(
            pointPositionAt(restoredLine, restored.plates, [1, 0], 5, 40),
            pointPositionAt(restoredParent, restored.plates, [1, 0], 5, 40),
        );
    });

    it('rebases a historical parent link to its fused successor in a current-time save', () => {
        const parentA = plate('parent-a', polygon('parent-a-shape', 0), [feature('mountain-a', 'mountain', [2, 2])]);
        const parentB = plate('parent-b', polygon('parent-b-shape', 3));
        const linkedLine = linkPlateAtTime(plate('orogeny', polygon('orogeny-line', 1, false), [], {
            type: 'rift',
            lineType: 'convergent',
            color: '#ff22aa',
            lineColorCustomized: true,
            motionSegments: [{ time: 0, eulerPole: { position: [0, 90], rate: 0, visible: false } }],
        }), parentA.id, 5);
        const state = appState([parentA, parentB, linkedLine], 20);

        const world = fusePlates(state, parentA.id, parentB.id).newState!.world;
        const fused = world.plates.find(candidate => candidate.id === world.selectedPlateId)!;
        fused.motionSegments.push({ time: 30, eulerPole: { position: [0, 90], rate: 3, visible: false } });
        world.currentTime = 40;
        for (const current of world.plates) {
            if (current.birthTime <= 40 && (current.deathTime === null || current.deathTime > 40)) {
                Object.assign(current, derivePlateGeometry(current, world.plates, 40));
            }
        }

        const resetWorld = createWorldFromCurrentTime(world);
        const restored = restore(resetWorld);
        const restoredLine = restored.plates.find(candidate => candidate.id === 'orogeny')!;
        const restoredFused = restored.plates.find(candidate => candidate.id === fused.id)!;

        expect(restored.plates.map(candidate => candidate.id).sort()).toEqual([fused.id, 'orogeny'].sort());
        expect(restoredLine).toEqual(expect.objectContaining({
            linkedToPlateId: fused.id,
            linkTime: 0,
            lineType: 'convergent',
            color: '#ff22aa',
            lineColorCustomized: true,
        }));
        expect(restoredFused.motionSegments[0].eulerPole.rate).toBe(3);
        expect(restoredFused.features.map(item => item.id)).toEqual(['mountain-a']);
        expect(restoredFused.geometryStages[0].features.map(item => item.id)).toEqual(['mountain-a']);
        expectCoordinateClose(
            pointPositionAt(restoredLine, restored.plates, [10, 0], 0, 10),
            pointPositionAt(restoredFused, restored.plates, [10, 0], 0, 10),
        );
    });
});
