import { afterEach, describe, expect, it, vi } from 'vitest';
import { derivationStateSignature } from './DerivationSignature';
import type { TectonicPlate } from '../types';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function setup() {
    const polygons = [{ id: 'coast', closed: true, points: [[0, 0], [10, 0], [10, 10]] as [number, number][] }];
    const plate: TectonicPlate = {
        id: 'land', name: 'Land', color: '#abcdef', visible: true, locked: false, center: [0, 0],
        birthTime: 0, deathTime: null, polygons, initialPolygons: polygons, features: [], initialFeatures: [],
        geometryStages: [{ time: 0, polygons, features: [] }],
        motionSegments: [{ time: 0, eulerPole: { position: [0, 90], rate: 0 } }], connectedRiftIds: [], events: [],
    };
    return { plate, signature: () => derivationStateSignature([plate]) };
}

describe('derivation cache signatures on large histories', () => {
    it('keeps unchanged geometry stable but invalidates even sub-decimal-place edits', () => {
        const { plate, signature } = setup();
        const original = signature();
        expect(signature()).toBe(original);
        // Timeline edits can mutate authored arrays in place, including very small changes.
        plate.geometryStages[0].polygons[0].points[0][0] = 0.00001;
        const edited = signature();
        expect(edited).not.toBe(original);
        plate.motionSegments[0].eulerPole.rate = 0.00001;
        expect(signature()).not.toBe(edited);
        plate.geometryStages[0].polygons[0].points[0][0] = 0;
        plate.motionSegments[0].eulerPole.rate = 0;
        expect(signature()).toBe(original); // Undo can reuse the earlier geometry.
    });

    it('does not allocate formatted strings for every coordinate on every scrub', () => {
        const { signature, plate } = setup();
        plate.geometryStages = Array.from({ length: 1000 }, (_, time) => ({ ...plate.geometryStages[0], time }));
        const format = vi.spyOn(Number.prototype, 'toFixed');
        const first = signature();
        expect(signature()).toBe(first);
        expect(format.mock.calls.length).toBeLessThan(100);
    });

    it('invalidates linked motion, interpolation and anchored features', () => {
        const { plate, signature } = setup();
        const edits: Array<() => void> = [
            () => { plate.linkedToPlateId = 'leader'; plate.linkTime = 5; },
            () => { plate.geometryStages[0].interpolation = 'spherical'; },
            () => { plate.features = [{ id: 'peak', type: 'mountain', position: [5, 6], originalPosition: [1, 2], generatedAt: 3, scale: 1, rotation: 0, properties: {} }]; },
            () => { plate.features[0].position[0] += 0.00001; },
            () => { plate.geometryStages[0].features = plate.features; },
        ];
        for (const edit of edits) {
            const before = signature();
            edit();
            expect(signature()).not.toBe(before);
        }
    });
});
