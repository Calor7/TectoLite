import { describe, expect, it } from 'vitest';
import { createDefaultWorldState, type Coordinate, type Feature, type Polygon, type TectonicPlate } from '../types';
import { derivePlateGeometry, pointPositionAt } from '../motion/RotationModel';
import { branchScenario, trimScenarioTimeline } from './ScenarioTimeline';
import { CURRENT_SAVE_VERSION } from '../migration';
import { parseProjectText } from '../ProjectIO';

function plate(id: string, overrides: Partial<TectonicPlate> = {}): TectonicPlate {
    const polygons: Polygon[] = [{ id: `${id}-shape`, closed: true, points: [[-30, -20], [30, -20], [30, 20], [-30, 20], [-30, -20]] }];
    return {
        id, name: id, color: '#999999', polygons, initialPolygons: polygons,
        features: [], initialFeatures: [], center: [0, 0], birthTime: 0, deathTime: null,
        motionSegments: [{ time: 0, eulerPole: { position: [0, 90], rate: 0 } }],
        geometryStages: [{ time: 0, polygons, features: [] }],
        connectedRiftIds: [], events: [], visible: true, locked: false, ...overrides,
    };
}

function mountain(id: string, generatedAt: number): Feature {
    return { id, type: 'mountain', generatedAt, position: [0, 0], originalPosition: [0, 0], scale: 1, rotation: 0, properties: {} };
}

function expectPosition(actual: Coordinate, expected: Coordinate): void {
    expect(actual[0]).toBeCloseTo(expected[0], 8);
    expect(actual[1]).toBeCloseTo(expected[1], 8);
}

describe('scenario timeline rebasing', () => {
    it('preserves inherited features after later shape stages when their ancestor was trimmed away', () => {
        const feature = mountain('inherited', 0);
        const parent = plate('parent', { deathTime: 10, features: [feature] });
        parent.geometryStages[0].features = [feature];
        const child = plate('child', { birthTime: 10, parentPlateId: parent.id, parentPlateIds: [parent.id],
            motionSegments: [{ time: 10, eulerPole: { position: [0, 90], rate: 1 } }] });
        child.geometryStages = [10, 20].map(time => ({ time, polygons: child.initialPolygons, features: [] }));
        const world = { ...createDefaultWorldState(), currentTime: 15, plates: [parent, child] };
        const saved = trimScenarioTimeline(world);
        const restored = parseProjectText(JSON.stringify({ version: CURRENT_SAVE_VERSION, world: saved })).world;
        expect(restored.plates.map(p => p.id)).toEqual(['child']);
        for (const time of [15, 19, 20, 25]) {
            const original = derivePlateGeometry(child, world.plates, time).features;
            const resumed = derivePlateGeometry(restored.plates[0], restored.plates, time - 15).features;
            expect(resumed.map(f => f.id)).toEqual(['inherited']);
            expectPosition(resumed[0].position, original[0].position);
        }
    });

    it('keeps the birth anchor of a future dynamic feature on an already existing plate', () => {
        const moving = plate('moving', { motionSegments: [{ time: 0, eulerPole: { position: [0, 90], rate: 1 } }],
            features: [mountain('future', 20)] });
        const world = { ...createDefaultWorldState(), currentTime: 10, plates: [moving] };
        const saved = trimScenarioTimeline(world);
        expect(saved.plates[0].features[0].generatedAt).toBe(10);
        for (const time of [20, 25, 30]) {
            const original = derivePlateGeometry(moving, world.plates, time).features[0];
            const resumed = derivePlateGeometry(saved.plates[0], saved.plates, time - 10).features[0];
            expectPosition(resumed.position, original.position);
        }
        expectPosition(derivePlateGeometry(saved.plates[0], saved.plates, 10).features[0].position, [0, 0]);
    });

    it('keeps a label attached to a retained successor that has not been born yet', () => {
        const parent = plate('parent', { deathTime: 20 });
        const child = plate('child', { birthTime: 20, parentPlateId: parent.id, parentPlateIds: [parent.id],
            motionSegments: [{ time: 20, eulerPole: { position: [0, 90], rate: 1 } }] });
        child.geometryStages[0].time = 20;
        const world = { ...createDefaultWorldState(), currentTime: 10, plates: [parent, child] };
        world.labels = [{ id: 'future-label', title: 'Future successor', content: '', anchor: [3, 4], anchorTime: 30,
            attachedPlateId: child.id, offset: [10, 10], color: '#ffffff', visible: true, locked: false, expanded: false }];
        const saved = trimScenarioTimeline(world);
        const label = saved.labels[0];
        expect(label.attachedPlateId).toBe(child.id);
        expect(label.anchorTime).toBe(20);
        const resumedChild = saved.plates.find(p => p.id === child.id)!;
        expectPosition(pointPositionAt(resumedChild, saved.plates, label.anchor, label.anchorTime, 25),
            pointPositionAt(child, world.plates, world.labels[0].anchor, 30, 35));
    });

    for (const link of [
        { name: 'expired', linkTime: 0, unlinkTime: 8 },
        { name: 'future', linkTime: 20, unlinkTime: undefined },
    ]) it(`does not reactivate a ${link.name} link when branching the current world`, () => {
        const carrier = plate('carrier', { motionSegments: [{ time: 0, eulerPole: { position: [0, 90], rate: 1 } }] });
        const follower = plate('follower', { linkedToPlateId: carrier.id, linkTime: link.linkTime, unlinkTime: link.unlinkTime,
            relativeEulerPole: { position: [0, 90], rate: 0 } });
        const world = { ...createDefaultWorldState(), currentTime: 10, plates: [carrier, follower] };
        const branch = branchScenario(world), copied = branch.plates.find(p => p.id === follower.id)!;
        expect(copied.linkedToPlateId).toBeUndefined();
        expect(copied.linkTime).toBeUndefined();
        expect(copied.relativeEulerPole).toBeUndefined();
        expectPosition(derivePlateGeometry(copied, branch.plates, 5).polygons[0].points[0],
            derivePlateGeometry(follower, world.plates, 10).polygons[0].points[0]);
    });

    it('preserves a currently active link when branching', () => {
        const carrier = plate('carrier', { motionSegments: [{ time: 0, eulerPole: { position: [0, 90], rate: 1 } }] });
        const follower = plate('follower', { linkedToPlateId: carrier.id, linkTime: 5 });
        const world = { ...createDefaultWorldState(), currentTime: 10, plates: [carrier, follower] };
        const branch = branchScenario(world), copied = branch.plates.find(p => p.id === follower.id)!;
        expect(copied.linkedToPlateId).toBe(carrier.id);
        expect(copied.linkTime).toBe(0);
        expectPosition(derivePlateGeometry(copied, branch.plates, 5).polygons[0].points[0],
            derivePlateGeometry(follower, world.plates, 15).polygons[0].points[0]);
    });

    it('shows a placed feature before a later shape stage first captures it', () => {
        const feature = mountain('placed-at-20', 20);
        const moving = plate('moving', { motionSegments: [{ time: 0, eulerPole: { position: [0, 90], rate: 1 } }],
            features: [{ ...feature, position: [20, 0] }] });
        moving.geometryStages.push({ time: 30, polygons: moving.initialPolygons, features: [{ ...feature, position: [10, 0] }] });
        const features = derivePlateGeometry(moving, [moving], 25).features;
        expect(features.map(f => f.id)).toEqual(['placed-at-20']);
        expectPosition(features[0].position, [5, 0]);
        expectPosition(derivePlateGeometry(moving, [moving], 30).features[0].position, [10, 0]);
    });
});
