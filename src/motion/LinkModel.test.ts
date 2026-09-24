import { describe, expect, it } from 'vitest';
import type { Coordinate, TectonicPlate } from '../types';
import { isMotionLinkActiveAtTime, linkPlateAtTime, motionLinkDescendantIds, unlinkPlateAtTime, wouldCreateMotionLinkCycle } from './LinkModel';
import { derivePlateGeometry, pointPositionAt } from './RotationModel';

function plate(overrides: Partial<TectonicPlate> = {}): TectonicPlate {
    return {
        id: 'child', name: 'Child', center: [0, 0], polygons: [], features: [],
        initialPolygons: [], initialFeatures: [], birthTime: 0, deathTime: null,
        motionSegments: [{ time: 0, eulerPole: { position: [0, 90], rate: 0 } }],
        geometryStages: [{ time: 0, polygons: [], features: [] }], events: [],
        connectedRiftIds: [], color: '#888888', visible: true, locked: false,
        ...overrides,
    };
}

describe('motion link timeline', () => {
    it('does not expose a future link as active before its start time', () => {
        const child = plate({ linkedToPlateId: 'parent', linkTime: 264 });
        expect(isMotionLinkActiveAtTime(child, 263, 'parent')).toBe(false);
        expect(isMotionLinkActiveAtTime(child, 264, 'parent')).toBe(true);
    });

    it('reschedules a future/reversed link window without retaining momentum', () => {
        const child = plate({
            linkedToPlateId: 'parent', linkTime: 264, unlinkTime: 263,
            motionSegments: [{ time: 263, eulerPole: { position: [10, 20], rate: 0.55 } }],
        });
        const linked = linkPlateAtTime(child, 'parent', 263);

        expect(linked.linkedToPlateId).toBe('parent');
        expect(linked.linkTime).toBe(263);
        expect(linked.unlinkTime).toBeUndefined();
        expect(linked.motionSegments).toEqual([
            { time: 263, eulerPole: { position: [0, 90], rate: 0, visible: false } },
        ]);
    });

    it('rejects an overlapping multi-hop cycle, including one that begins later', () => {
        const child = plate({ id: 'child' });
        const parent = plate({ id: 'parent', linkedToPlateId: 'grandparent', linkTime: 10 });
        const grandparent = plate({ id: 'grandparent', linkedToPlateId: 'child', linkTime: 20 });

        expect(wouldCreateMotionLinkCycle([child, parent, grandparent], 'child', 'parent', 5)).toBe(true);
    });

    it('allows a new link when the historical reverse chain has already ended', () => {
        const child = plate({ id: 'child' });
        const parent = plate({ id: 'parent', linkedToPlateId: 'grandparent', linkTime: 0, unlinkTime: 10 });
        const grandparent = plate({ id: 'grandparent', linkedToPlateId: 'child', linkTime: 0, unlinkTime: 10 });

        expect(wouldCreateMotionLinkCycle([child, parent, grandparent], 'child', 'parent', 20)).toBe(false);
    });

    it('preserves the inherited position and earlier history when unlinking at 620', () => {
        // Reduced from Plate 103 and its parent in TectoLite_frtjhrfgjnrgtfj.
        const parent = plate({
            id: 'parent', birthTime: 559,
            motionSegments: [
                { time: 599, eulerPole: { position: [-144.754304167321, 13.1675234490607], rate: 0.15 } },
                { time: 600, eulerPole: { position: [173.544701644688, 18.3966705870858], rate: 0.4 } },
                { time: 611, eulerPole: { position: [-175.249124936089, 17.0497723722867], rate: 0.6 } },
                { time: 613, eulerPole: { position: [165.336068185194, 16.7538494795894], rate: 0.55 } },
            ],
        });
        const shape = {
            id: 'shape', closed: true,
            points: [[-160.42863737222135, -28.759651644386313], [-159, -28], [-160, -27]] as Coordinate[],
        };
        const child = plate({
            birthTime: 599, linkedToPlateId: parent.id, linkTime: 599,
            initialPolygons: [shape], polygons: [shape],
            geometryStages: [{ time: 599, polygons: [shape], features: [] }],
            motionSegments: [{ time: 599, eulerPole: { position: [0, 90], rate: 0 } }],
        });
        const originals = [parent, child];
        const unlinked = unlinkPlateAtTime(child, 620, parent.motionSegments.at(-1)!.eulerPole);
        const platesAfter = [parent, unlinked];

        for (const time of [599, 600, 619, 620]) {
            const before = derivePlateGeometry(child, originals, time);
            const after = derivePlateGeometry(unlinked, platesAfter, time);
            before.polygons[0].points.forEach((point, index) => {
                expect(after.polygons[0].points[index][0]).toBeCloseTo(point[0], 8);
                expect(after.polygons[0].points[index][1]).toBeCloseTo(point[1], 8);
            });
        }
        expect(isMotionLinkActiveAtTime(unlinked, 619)).toBe(true);
        expect(isMotionLinkActiveAtTime(unlinked, 620)).toBe(false);
        const at620 = derivePlateGeometry(child, originals, 620).polygons[0].points[0];
        const expected = pointPositionAt(parent, originals, at620, 620, 630);
        const actual = derivePlateGeometry(unlinked, platesAfter, 630).polygons[0].points[0];
        expect(actual[0]).toBeCloseTo(expected[0], 8);
        expect(actual[1]).toBeCloseTo(expected[1], 8);

        // Later edits to the old parent must no longer carry the child.
        const changedParent = {
            ...parent,
            motionSegments: [...parent.motionSegments, { time: 621, eulerPole: { position: [0, 90] as Coordinate, rate: 4 } }],
        };
        const independent = derivePlateGeometry(unlinked, [changedParent, unlinked], 630).polygons[0].points[0];
        expect(independent[0]).toBeCloseTo(actual[0], 8);
        expect(independent[1]).toBeCloseTo(actual[1], 8);
        expect(child.unlinkTime).toBeUndefined();
        expect(child.motionSegments).toHaveLength(1);
    });

    it('replaces motion at the unlink time while preserving authored later segments', () => {
        const child = plate({
            linkedToPlateId: 'parent', linkTime: 599,
            motionSegments: [
                { time: 599, eulerPole: { position: [0, 90], rate: 0 } },
                { time: 620, eulerPole: { position: [0, 90], rate: 0.2 } },
                { time: 638, eulerPole: { position: [10, 20], rate: 0.55 } },
            ],
        });
        const continuation = { position: [30, 40] as Coordinate, rate: 0.7 };
        const unlinked = unlinkPlateAtTime(child, 620, continuation);
        expect(unlinked.linkedToPlateId).toBe('parent');
        expect(unlinked.linkTime).toBe(599);
        expect(unlinked.unlinkTime).toBe(620);
        expect(unlinked.motionSegments).toEqual([
            child.motionSegments[0], { time: 620, eulerPole: continuation }, child.motionSegments[2],
        ]);
    });

    it('finds descendants without looping when a historical link is later reversed', () => {
        const first = plate({ id: 'first' });
        const second = plate({ id: 'second', linkedToPlateId: 'first', linkTime: 599 });
        const unlinked = unlinkPlateAtTime(second, 620, { position: [0, 90], rate: 0 });
        expect(wouldCreateMotionLinkCycle([first, unlinked], 'first', 'second', 621)).toBe(false);
        const reversed = linkPlateAtTime(first, 'second', 621);
        const descendant = plate({ id: 'descendant', linkedToPlateId: 'second', linkTime: 622 });
        const unrelated = plate({ id: 'unrelated' });
        const plates = [reversed, unlinked, descendant, unrelated];
        expect(motionLinkDescendantIds(plates, 'first').sort()).toEqual(['descendant', 'second']);
        expect(motionLinkDescendantIds(plates, 'second').sort()).toEqual(['descendant', 'first']);
        expect(motionLinkDescendantIds(plates, 'unrelated')).toEqual([]);
    });
});
