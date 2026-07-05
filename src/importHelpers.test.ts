import { describe, it, expect } from 'vitest';
import { remapImportedWorld } from './importHelpers';
import { TectonicPlate, WorldState, Feature, RiftAxis, MotionKeyframe } from './types';

function makeFeature(id: string, generatedAt?: number): Feature {
    return { id, type: 'mountain', position: [0, 0], generatedAt } as unknown as Feature;
}

function makePlate(id: string, overrides: Partial<TectonicPlate> = {}): TectonicPlate {
    return {
        id,
        name: `Plate ${id}`,
        type: 'continental',
        color: '#fff',
        zIndex: 0,
        birthTime: 0,
        deathTime: null,
        visible: true,
        locked: false,
        center: [0, 0],
        polygons: [{ id: `${id}-poly`, points: [[0, 0], [1, 0], [1, 1]], closed: true }],
        features: [],
        initialPolygons: [{ id: `${id}-ipoly`, points: [[0, 0], [1, 0], [1, 1]], closed: true }],
        initialFeatures: [],
        motion: { eulerPole: { position: [0, 90], rate: 0, visible: false } },
        motionKeyframes: [],
        events: [],
        connectedRiftIds: [],
        ...overrides,
    } as unknown as TectonicPlate;
}

function makeWorld(plates: TectonicPlate[], overrides: Partial<WorldState> = {}): WorldState {
    return { plates, ...overrides } as unknown as WorldState;
}

describe('remapImportedWorld', () => {
    it('assigns fresh plate IDs', () => {
        const result = remapImportedWorld(makeWorld([makePlate('a'), makePlate('b')]), 0);
        expect(result.plates).toHaveLength(2);
        expect(result.plates[0].id).not.toBe('a');
        expect(result.plates[1].id).not.toBe('b');
        expect(result.plates[0].id).not.toBe(result.plates[1].id);
    });

    it('remaps parent and link references onto the new IDs', () => {
        const world = makeWorld([
            makePlate('parent'),
            makePlate('child', { parentPlateId: 'parent', linkedToPlateId: 'parent', parentPlateIds: ['parent'] }),
        ]);
        const result = remapImportedWorld(world, 0);
        const [newParent, newChild] = result.plates;
        expect(newChild.parentPlateId).toBe(newParent.id);
        expect(newChild.linkedToPlateId).toBe(newParent.id);
        expect(newChild.parentPlateIds).toEqual([newParent.id]);
    });

    it('strips references to plates that were not imported', () => {
        const world = makeWorld([
            makePlate('child', { parentPlateId: 'missing', linkedToPlateId: 'missing', connectedRiftIds: ['missing'] }),
        ]);
        const result = remapImportedWorld(world, 0);
        expect(result.plates[0].parentPlateId).toBeUndefined();
        expect(result.plates[0].linkedToPlateId).toBeUndefined();
        expect(result.plates[0].connectedRiftIds).toEqual([]);
    });

    it('keeps feature IDs consistent across features and keyframe snapshots', () => {
        const kf: MotionKeyframe = {
            time: 10,
            eulerPole: { position: [0, 90], rate: 1, visible: false },
            snapshotPolygons: [{ id: 'sp', points: [[0, 0]], closed: true }],
            snapshotFeatures: [makeFeature('feat-1', 5)],
        } as unknown as MotionKeyframe;
        const world = makeWorld([
            makePlate('a', {
                features: [makeFeature('feat-1', 5)],
                initialFeatures: [makeFeature('feat-1', 5)],
                motionKeyframes: [kf],
            }),
        ]);
        const result = remapImportedWorld(world, 0);
        const p = result.plates[0];
        const newId = p.features[0].id;
        expect(newId).not.toBe('feat-1');
        expect(p.initialFeatures[0].id).toBe(newId);
        expect(p.motionKeyframes[0].snapshotFeatures[0].id).toBe(newId);
    });

    it('shifts keyframe and feature times by the offset', () => {
        const kf: MotionKeyframe = {
            time: 10,
            eulerPole: { position: [0, 90], rate: 1, visible: false },
            snapshotPolygons: [],
            snapshotFeatures: [],
        } as unknown as MotionKeyframe;
        const world = makeWorld([
            makePlate('a', { features: [makeFeature('f', 5)], motionKeyframes: [kf] }),
        ]);
        const result = remapImportedWorld(world, 100);
        expect(result.plates[0].motionKeyframes[0].time).toBe(110);
        expect(result.plates[0].features[0].generatedAt).toBe(105);
    });

    it('remaps sibling edge metadata and drops dangling sibling refs', () => {
        const world = makeWorld([
            makePlate('a', {
                polygons: [{
                    id: 'p', points: [[0, 0], [1, 0]], closed: true,
                    edgeMeta: [{
                        edgeIndex: 0, type: 'rift', sourceId: 'b',
                        siblings: [
                            { id: 's1', siblingPlateId: 'b', siblingPolyIndex: 0, siblingEdgeIndex: 0, groupId: 'g1', frozen: false, createdAt: 10 },
                            { id: 's2', siblingPlateId: 'missing', siblingPolyIndex: 0, siblingEdgeIndex: 0, groupId: 'g2', frozen: false, createdAt: 10 },
                        ],
                    }],
                }],
            }),
            makePlate('b'),
        ]);
        const result = remapImportedWorld(world, 50);
        const newB = result.plates[1];
        const meta = result.plates[0].polygons[0].edgeMeta![0];
        expect(meta.sourceId).toBe(newB.id);
        expect(meta.siblings).toHaveLength(1);
        expect(meta.siblings![0].siblingPlateId).toBe(newB.id);
        expect(meta.siblings![0].createdAt).toBe(60);
    });

    it('skips ephemeral axis/junction-derived plates', () => {
        const world = makeWorld([
            makePlate('a'),
            makePlate('ring', { riftAxisId: 'axis-1' }),
            makePlate('wedge', { junctionId: 'tj-1' }),
        ]);
        const result = remapImportedWorld(world, 0);
        expect(result.plates).toHaveLength(1);
    });

    it('imports rift axes with remapped plate IDs and shifted isochrons', () => {
        const axis: RiftAxis = {
            id: 'axis-1', groupId: 'g1', plateIdA: 'a', plateIdB: 'b',
            birthPolyline: [[0, 0], [1, 1]], birthTime: 10, state: 'active',
            isochrons: [{ time: 35, polyline: [[0, 0]] }],
        } as unknown as RiftAxis;
        const world = makeWorld([makePlate('a'), makePlate('b')], { riftAxes: [axis] });
        const result = remapImportedWorld(world, 100);
        expect(result.riftAxes).toHaveLength(1);
        const newAxis = result.riftAxes[0];
        expect(newAxis.id).not.toBe('axis-1');
        expect(newAxis.plateIdA).toBe(result.plates[0].id);
        expect(newAxis.plateIdB).toBe(result.plates[1].id);
        expect(newAxis.birthTime).toBe(110);
        expect(newAxis.isochrons[0].time).toBe(135);
    });

    it('drops axes whose flanking plates are missing, and junctions follow their axes', () => {
        const axis: RiftAxis = {
            id: 'axis-1', groupId: 'g1', plateIdA: 'a', plateIdB: 'gone',
            birthPolyline: [], birthTime: 0, state: 'active', isochrons: [],
        } as unknown as RiftAxis;
        const world = makeWorld([makePlate('a')], {
            riftAxes: [axis],
            tripleJunctions: [{
                id: 'tj-1', axisIds: ['axis-1'], axisJunctionAtStart: [true],
                birthTime: 0, state: 'active',
            }],
        });
        const result = remapImportedWorld(world, 0);
        expect(result.riftAxes).toHaveLength(0);
        expect(result.tripleJunctions).toHaveLength(0);
    });

    it('imports junctions with remapped axis IDs and shifted history', () => {
        const axes: RiftAxis[] = [
            { id: 'x1', groupId: 'g1', plateIdA: 'a', plateIdB: 'b', birthPolyline: [], birthTime: 0, state: 'active', isochrons: [] },
            { id: 'x2', groupId: 'g2', plateIdA: 'b', plateIdB: 'a', birthPolyline: [], birthTime: 0, state: 'active', isochrons: [] },
        ] as unknown as RiftAxis[];
        const world = makeWorld([makePlate('a'), makePlate('b')], {
            riftAxes: axes,
            tripleJunctions: [{
                id: 'tj-1', axisIds: ['x1', 'x2'], axisJunctionAtStart: [true, false],
                birthTime: 5, state: 'active',
                junctionHistory: [{ time: 20, point: [1, 2] }],
            }],
        });
        const result = remapImportedWorld(world, 100);
        expect(result.tripleJunctions).toHaveLength(1);
        const tj = result.tripleJunctions[0];
        expect(tj.axisIds).toEqual([result.riftAxes[0].id, result.riftAxes[1].id]);
        expect(tj.birthTime).toBe(105);
        expect(tj.junctionHistory![0].time).toBe(120);
    });

});
