import { afterEach, describe, expect, it, vi } from 'vitest';
import { SimulationEngine } from './SimulationEngine';
import { BoundarySystem } from './BoundarySystem';
import { createWorldFromCurrentTime } from './export';
import { plateHeightmapGray } from './systems/HeightmapGenerator';
import { parseProjectText } from './ProjectIO';
import { CURRENT_SAVE_VERSION } from './migration';
import { createDefaultWorldState, type AppState, type Polygon, type RiftAxis, type TectonicPlate } from './types';

function flank(id: string, west: number, east: number, rate: number): TectonicPlate {
    const shape: Polygon = {
        id: `${id}-shape`, points: [[west, -10], [east, -10], [east, 10], [west, 10]], closed: true,
    };
    return {
        id, name: id, color: '#4a9c6d', polygonType: 'continental_plate',
        birthTime: 0, deathTime: null, visible: true, locked: false,
        center: [(west + east) / 2, 0], polygons: [shape], initialPolygons: [shape],
        features: [], initialFeatures: [],
        motionSegments: [{ time: 0, eulerPole: { position: [0, 90], rate } }],
        geometryStages: [{ time: 0, polygons: [shape], features: [] }],
        events: [], connectedRiftIds: [],
    };
}

function makeState(): AppState {
    const world = createDefaultWorldState();
    world.plates = [flank('A', -10, 0, -0.2), flank('B', 0, 10, 0.2)];
    world.riftAxes = [{
        id: 'ridge', groupId: 'split', plateIdA: 'A', plateIdB: 'B',
        birthPolyline: [[0, -10], [0, 10]], birthTime: 0, state: 'active', isochrons: [],
    }];
    world.globalOptions.oceanCrustStrategy = 'continuous';
    world.globalOptions.oceanicGenerationInterval = 5;
    world.globalOptions.enableBoundaryVisualization = false;
    return {
        world, activeTool: 'select', activeFeatureType: 'mountain', drawMode: 'polygon',
        activeLineType: 'divergent', activePolygonType: 'generic',
        viewport: { width: 1200, height: 800, scale: 250, rotate: [0, 0, 0], translate: [600, 400] },
    };
}

function harness(initial = makeState()) {
    let state = initial;
    const simulation = new SimulationEngine(() => state, updater => { state = updater(state); });
    return { simulation, state: () => state };
}

function ridgeSnapshot(state: AppState) {
    return state.world.plates.filter(item => item.midOceanRidge).map(item => ({
        id: item.id, polygons: item.polygons, features: item.features,
        birthTime: item.birthTime, age: item.age, elevation: item.elevation,
        linkedToPlateId: item.linkedToPlateId, metadata: item.midOceanRidge,
    }));
}

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('continuous ridge simulation integration', () => {
    it('generates mature crust on the first direct time jump without accumulated isochrons', () => {
        const { simulation, state } = harness();
        const originalAxes = structuredClone(state().world.riftAxes);
        simulation.setTime(20);

        expect(state().world.currentTime).toBe(20);
        expect(state().world.plates.some(item => item.midOceanRidge?.kind === 'axis')).toBe(true);
        expect(state().world.plates.some(item => item.midOceanRidge?.kind === 'crust')).toBe(true);
        expect(state().world.riftAxes).toEqual(originalAxes);
    });

    it('returns the same geometry and IDs after rewind and forward scrubbing', () => {
        const { simulation, state } = harness();
        simulation.setTime(20);
        const reference = ridgeSnapshot(state());
        simulation.setTime(50);
        simulation.setTime(3);
        simulation.setTime(20);

        expect(ridgeSnapshot(state())).toEqual(reference);
        expect(new Set(state().world.plates.map(item => item.id)).size).toBe(state().world.plates.length);
        expect(state().world.plates.filter(item => !item.riftAxisId).map(item => item.id)).toEqual(['A', 'B']);
    });

    it('matches direct scrubbing when playback reaches the same time', () => {
        const direct = harness();
        direct.simulation.setTime(20);
        const playback = harness();
        playback.state().world.timeScale = 5;
        let now = 0;
        const frames: FrameRequestCallback[] = [];
        vi.spyOn(performance, 'now').mockImplementation(() => now);
        vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
            frames.push(callback);
            return frames.length;
        }));
        vi.stubGlobal('cancelAnimationFrame', vi.fn());

        playback.simulation.start();
        for (let i = 0; i < 4; i++) {
            now += 1000;
            frames.shift()!(now);
        }
        playback.simulation.stop();

        expect(playback.state().world.currentTime).toBe(20);
        expect(ridgeSnapshot(playback.state())).toEqual(ridgeSnapshot(direct.state()));
        expect(playback.state().world.riftAxes).toEqual(direct.state().world.riftAxes);
    });

    it('rebuilds edited motion at the same time and ignores stale stored isochrons', () => {
        const { simulation, state } = harness();
        simulation.setTime(20);
        const previous = ridgeSnapshot(state());
        const beforeAxes = structuredClone(state().world.riftAxes);
        state().world.riftAxes![0].isochrons = [{ time: 10, polyline: [[100, 10], [100, 30]] }];
        simulation.setTime(20);
        expect(ridgeSnapshot(state())).toEqual(previous);

        const moving = state().world.plates.find(item => item.id === 'B')!;
        moving.motionSegments.push({ time: 10, eulerPole: { position: [0, 90], rate: 0.6 } });
        simulation.setTime(20);
        const edited = ridgeSnapshot(state());
        expect(edited).not.toEqual(previous);

        const cleanState = makeState();
        cleanState.world.plates[1].motionSegments = structuredClone(moving.motionSegments);
        cleanState.world.riftAxes = beforeAxes;
        const clean = harness(cleanState);
        clean.simulation.setTime(20);
        expect(edited).toEqual(ridgeSnapshot(clean.state()));
    });

    it('regenerates equivalent ridge output after saving and loading at a mature time', () => {
        const { simulation, state } = harness();
        simulation.setTime(20);
        const reference = ridgeSnapshot(state());
        const loaded = parseProjectText(JSON.stringify({
            version: CURRENT_SAVE_VERSION, name: 'Ridge save', world: state().world,
        }));
        const restored = harness({ ...makeState(), world: loaded.world });
        restored.simulation.setTime(5);
        restored.simulation.setTime(20);

        expect(ridgeSnapshot(restored.state())).toEqual(reference);
    });

    it.each(['frozen', 'dead'] as const)('preserves crust after a %s ridge cutoff during later scrubbing', lifecycle => {
        const initial = makeState();
        const axis: RiftAxis = initial.world.riftAxes![0];
        axis.state = lifecycle;
        if (lifecycle === 'frozen') axis.frozenTime = 10;
        else axis.deathTime = 10;
        const { simulation, state } = harness(initial);
        simulation.setTime(10);
        const previousCrust = state().world.plates.filter(item => item.midOceanRidge?.kind === 'crust');
        simulation.setTime(30);
        const retainedCrust = state().world.plates.filter(item => item.midOceanRidge?.kind === 'crust');

        expect(previousCrust.length).toBeGreaterThan(0);
        expect(retainedCrust.map(item => item.id)).toEqual(previousCrust.map(item => item.id));
        expect(retainedCrust.every(item => item.midOceanRidge!.youngestBirthTime <= 10)).toBe(true);
    });

    it('removes derived output when automation is turned off and reconstructs it when enabled', () => {
        const { simulation, state } = harness();
        simulation.setTime(20);
        const reference = ridgeSnapshot(state());
        state().world.globalOptions.oceanCrustStrategy = 'off';
        simulation.setTime(20);

        expect(ridgeSnapshot(state())).toEqual([]);
        expect(state().world.plates.map(item => item.id)).toEqual(['A', 'B']);

        state().world.globalOptions.oceanCrustStrategy = 'continuous';
        simulation.setTime(20);
        expect(ridgeSnapshot(state())).toEqual(reference);
    });
});



describe('current-time ridge snapshots', () => {
    it('preserves old moving crust and cooling age while rebasing the active spreading axis', () => {
        const initial = makeState();
        initial.world.plates[0].motionSegments[0].eulerPole.rate = 0;
        initial.world.plates[1].motionSegments[0].eulerPole.rate = 0.4;
        initial.world.riftAxes![0].isochrons = [{ time: 10, polyline: [[100, -20], [100, 20]] }];
        const original = harness(initial);
        original.simulation.setTime(20);
        const originalCrust = original.state().world.plates.filter(item => item.midOceanRidge?.kind === 'crust');
        const originalAxis = original.state().world.plates.find(item => item.midOceanRidge?.kind === 'axis')!;
        const rebasedWorld = createWorldFromCurrentTime(original.state().world);
        const snapshots = rebasedWorld.plates.filter(item => item.midOceanRidge?.kind === 'crust');
        const snapshotIds = new Set(snapshots.map(item => item.id));

        expect(snapshots.length).toBe(originalCrust.length);
        expect(snapshots.every(item => item.riftAxisId === undefined && item.junctionId === undefined)).toBe(true);
        expect(snapshots.every(item => !item.locked && item.birthTime === 0)).toBe(true);
        expect(snapshots.every(item => item.midOceanRidge!.oldestBirthTime < 0 && item.midOceanRidge!.youngestBirthTime <= 0)).toBe(true);
        expect(rebasedWorld.riftAxes![0].birthTime).toBe(0);
        expect(rebasedWorld.riftAxes![0].isochrons).toEqual([]);
        const rebasedPath = rebasedWorld.riftAxes![0].birthPolyline;
        const currentPath = originalAxis.polygons[0].points;
        expect(rebasedPath.length).toBe(currentPath.length);
        for (let i = 0; i < rebasedPath.length; i++) {
            expect(rebasedPath[i][0]).toBeCloseTo(currentPath[i][0], 7);
            expect(rebasedPath[i][1]).toBeCloseTo(currentPath[i][1], 7);
            expect(rebasedPath[i][0]).toBeCloseTo(4, 6);
        }
        for (let i = 0; i < snapshots.length; i++) {
            expect(plateHeightmapGray(snapshots[i], 0)).toBe(plateHeightmapGray(originalCrust[i], 20));
        }

        // Exercise the persisted form, including the negative historical birth bounds.
        const restored = parseProjectText(JSON.stringify({
            version: CURRENT_SAVE_VERSION, name: 'Rebased ridge', world: rebasedWorld,
        })).world;
        const continued = harness({ ...makeState(), world: restored });
        continued.simulation.setTime(0);
        const retainedAtZero = continued.state().world.plates.filter(item => snapshotIds.has(item.id));
        expect(retainedAtZero.length).toBe(snapshots.length);
        for (let i = 0; i < snapshots.length; i++) {
            expect(retainedAtZero[i].polygons.length).toBe(snapshots[i].polygons.length);
            for (let p = 0; p < snapshots[i].polygons.length; p++) {
                const expected = snapshots[i].polygons[p].points;
                const actual = retainedAtZero[i].polygons[p].points;
                expect(actual.length).toBe(expected.length);
                for (let vertex = 0; vertex < expected.length; vertex++) {
                    expect(actual[vertex][0]).toBeCloseTo(expected[vertex][0], 8);
                    expect(actual[vertex][1]).toBeCloseTo(expected[vertex][1], 8);
                }
            }
        }
        expect(continued.state().world.plates.some(item => item.midOceanRidge?.kind === 'axis' && item.riftAxisId === 'ridge')).toBe(true);
        expect(continued.state().world.plates.filter(item => item.midOceanRidge?.kind === 'crust' && item.riftAxisId).length).toBe(0);

        continued.simulation.setTime(5);
        const retained = continued.state().world.plates.filter(item => snapshotIds.has(item.id));
        const fresh = continued.state().world.plates.filter(item => item.midOceanRidge?.kind === 'crust' && item.riftAxisId === 'ridge');
        expect(retained.length).toBe(snapshots.length);
        expect(fresh.length).toBeGreaterThan(0);
        expect(new Set(continued.state().world.plates.map(item => item.id)).size).toBe(continued.state().world.plates.length);
        const movingBefore = snapshots.find(item => item.linkedToPlateId === 'B')!;
        const movingAfter = retained.find(item => item.id === movingBefore.id)!;
        expect(movingAfter.polygons).not.toEqual(movingBefore.polygons);
        for (const old of snapshots) {
            const evolved = retained.find(item => item.id === old.id)!;
            expect(evolved.midOceanRidge).toEqual(old.midOceanRidge);
            expect(plateHeightmapGray(evolved, 5)).toBe(plateHeightmapGray(originalCrust[snapshots.indexOf(old)], 25));
        }
    });
});



describe('joined ridge current-time export', () => {
    it('captures the actual joined endpoint positions of staggered ridge births', () => {
        const initial = makeState();
        const c = flank('C', -10, 10, -0.4);
        const shape: Polygon = { id: 'C-shape', points: [[-10, 0], [10, 0], [0, 15]], closed: true };
        c.center = [0, 5];
        c.motionSegments[0].eulerPole.position = [90, 0];
        c.polygons = [shape];
        c.initialPolygons = [shape];
        c.geometryStages = [{ time: 0, polygons: [shape], features: [] }];
        initial.world.plates.push(c);
        initial.world.riftAxes = [
            { id: 'AB', groupId: 'AB', plateIdA: 'A', plateIdB: 'B', birthTime: 0, birthPolyline: [[0, -10], [0, 0]], state: 'active', isochrons: [] },
            { id: 'AC', groupId: 'AC', plateIdA: 'A', plateIdB: 'C', birthTime: 10, birthPolyline: [[0, 0], [-10, 10]], state: 'active', isochrons: [] },
            { id: 'BC', groupId: 'BC', plateIdA: 'B', plateIdB: 'C', birthTime: 10, birthPolyline: [[0, 0], [10, 10]], state: 'active', isochrons: [] },
        ];
        const original = harness(initial);
        original.simulation.setTime(20);
        const rebased = createWorldFromCurrentTime(original.state().world);
        expect(rebased.riftAxes).toHaveLength(3);
        const captures = rebased.riftAxes!.map(axis => {
            const originalLine = original.state().world.plates.find(item => item.riftAxisId === axis.id && item.midOceanRidge?.kind === 'axis')!;
            const sourcePoints = originalLine.polygons[0].points;
            const sourceEndpoint = axis.id === 'AB' ? sourcePoints.at(-1)! : sourcePoints[0];
            const savedEndpoint = axis.id === 'AB' ? axis.birthPolyline.at(-1)! : axis.birthPolyline[0];
            expect(savedEndpoint[0]).toBeCloseTo(sourceEndpoint[0], 7);
            expect(savedEndpoint[1]).toBeCloseTo(sourceEndpoint[1], 7);
            return savedEndpoint;
        });
        for (const endpoint of captures.slice(1)) {
            expect(endpoint[0]).toBeCloseTo(captures[0][0], 7);
            expect(endpoint[1]).toBeCloseTo(captures[0][1], 7);
        }
    });
});



describe('fragmented plate ridge snapshots', () => {
    it('continues offshore spreading after capture even when remote fragments reverse plate centroids', () => {
        const initial = makeState();
        const fragments = [
            [[115, 120], [125, 130], [135, 140]],
            [[-120, -115], [-130, -125], [-140, -135]],
        ];
        for (let side = 0; side < initial.world.plates.length; side++) {
            const current = initial.world.plates[side];
            const shapes = [
                ...current.initialPolygons,
                ...fragments[side].map(([west, east], index) => flank(`${current.id}-remote-${index}`, west, east, 0).polygons[0]),
            ];
            current.polygons = shapes;
            current.initialPolygons = shapes;
            current.geometryStages[0].polygons = shapes;
        }
        const original = harness(initial);
        original.simulation.setTime(20);
        const oldCrust = original.state().world.plates.filter(item => item.midOceanRidge?.kind === 'crust');
        expect(oldCrust.length).toBeGreaterThan(0);
        const rebased = createWorldFromCurrentTime(original.state().world);
        const captured = rebased.plates.filter(item => item.midOceanRidge?.kind === 'crust');
        const capturedIds = new Set(captured.map(item => item.id));
        const restored = parseProjectText(JSON.stringify({
            version: CURRENT_SAVE_VERSION, name: 'Fragmented offshore ridge', world: rebased,
        })).world;
        const continued = harness({ ...makeState(), world: restored });
        continued.simulation.setTime(5);
        const retained = continued.state().world.plates.filter(item => capturedIds.has(item.id));
        const newCrust = continued.state().world.plates.filter(item => item.riftAxisId === 'ridge' && item.midOceanRidge?.kind === 'crust');
        const activeAxes = continued.state().world.plates.filter(item => item.riftAxisId === 'ridge' && item.midOceanRidge?.kind === 'axis');

        expect(retained.length).toBe(captured.length);
        expect(retained.length).toBe(oldCrust.length);
        expect(newCrust.length).toBeGreaterThan(0);
        expect(activeAxes.length).toBeGreaterThan(0);
        expect(activeAxes.every(item => item.midOceanRidge!.fullSpreadingRateCmYr > 0)).toBe(true);
        expect(new Set(continued.state().world.plates.map(item => item.id)).size).toBe(continued.state().world.plates.length);
        for (const old of captured) {
            const evolved = retained.find(item => item.id === old.id)!;
            expect(evolved.midOceanRidge).toEqual(old.midOceanRidge);
        }
    });
});

describe('boundary visualization inputs', () => {
    it.each(['axis', 'transform'] as const)('excludes derived open %s entities during scrubbing and playback', kind => {
        const initial = makeState();
        initial.world.globalOptions.enableBoundaryVisualization = true;
        if (kind === 'transform') {
            initial.world.plates[0].motionSegments[0].eulerPole = { position: [90, 0], rate: -0.2 };
            initial.world.plates[1].motionSegments[0].eulerPole = { position: [90, 0], rate: 0.2 };
        }
        const detect = vi.spyOn(BoundarySystem, 'detectBoundaries').mockReturnValue([]);
        const { simulation, state } = harness(initial);
        simulation.setTime(20);
        expect(state().world.plates.some(item => item.midOceanRidge?.kind === kind)).toBe(true);
        vi.spyOn(performance, 'now').mockReturnValue(0);
        vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
        simulation.start();
        simulation.stop();

        expect(detect).toHaveBeenCalledTimes(2);
        for (const [candidates] of detect.mock.calls) {
            expect(candidates.some(item => item.id === 'A')).toBe(true);
            expect(candidates.some(item => item.id === 'B')).toBe(true);
            expect(candidates.every(item => item.midOceanRidge?.kind !== 'axis' && item.midOceanRidge?.kind !== 'transform')).toBe(true);
        }
    });
});


describe('current-time snapshot before a rerouted flank birth', () => {
    it('rebases the ridge and captured crust onto the live ancestor and continues spreading', () => {
        const initial = makeState();
        const parentA = initial.world.plates[0];
        parentA.id = 'parentA';
        parentA.name = 'parentA';
        parentA.deathTime = 10;
        const childA = flank('childA', -12, -2, 1.7);
        childA.birthTime = 10;
        childA.parentPlateId = parentA.id;
        childA.motionSegments[0].time = 10;
        childA.geometryStages[0].time = 10;
        initial.world.plates.push(childA);
        initial.world.riftAxes![0].plateIdA = childA.id;
        const original = harness(initial);
        original.simulation.setTime(5);
        expect(original.state().world.plates.some(item => item.midOceanRidge?.kind === 'axis')).toBe(true);
        const rebased = createWorldFromCurrentTime(original.state().world);
        expect(rebased.riftAxes).toHaveLength(1);
        expect(rebased.riftAxes![0].plateIdA).toBe(parentA.id);
        expect(rebased.plates.some(item => item.id === childA.id)).toBe(false);
        const capturedWest = rebased.plates.filter(item => item.midOceanRidge?.kind === 'crust'
            && item.polygons.some(shape => shape.points.some(point => point[0] < -0.1)));
        expect(capturedWest.length).toBeGreaterThan(0);
        expect(capturedWest.every(item => item.linkedToPlateId === parentA.id && item.riftAxisId === undefined)).toBe(true);
        const capturedIds = new Set(capturedWest.map(item => item.id));
        const restored = parseProjectText(JSON.stringify({
            version: CURRENT_SAVE_VERSION, name: 'Rerouted historical ridge snapshot', world: rebased,
        })).world;
        const continued = harness({ ...makeState(), world: restored });
        continued.simulation.setTime(2);
        const retainedWest = continued.state().world.plates.filter(item => capturedIds.has(item.id));
        expect(retainedWest.length).toBe(capturedWest.length);
        expect(continued.state().world.plates.some(item => item.riftAxisId === 'ridge' && item.midOceanRidge?.kind === 'axis')).toBe(true);
        expect(continued.state().world.plates.some(item => item.riftAxisId === 'ridge' && item.midOceanRidge?.kind === 'crust')).toBe(true);
        for (const old of capturedWest) {
            const moving = retainedWest.find(item => item.id === old.id)!;
            expect(moving.linkedToPlateId).toBe(parentA.id);
            expect(moving.polygons[0].points[0][0]).toBeCloseTo(old.polygons[0].points[0][0] - 0.4, 7);
            expect(moving.midOceanRidge).toEqual(old.midOceanRidge);
        }
    });
});

