import { describe, expect, it } from 'vitest';
import type { TectonicPlate } from '../types';
import { isMotionLinkActiveAtTime, linkPlateAtTime, wouldCreateMotionLinkCycle } from './LinkModel';

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
});
