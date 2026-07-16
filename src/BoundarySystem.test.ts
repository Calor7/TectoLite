import { describe, expect, it } from 'vitest';
import { BoundarySystem } from './BoundarySystem';
import type { Coordinate, TectonicPlate } from './types';

function makePlate(id: string, points: Coordinate[], overrides: Partial<TectonicPlate> = {}): TectonicPlate {
    const polygons = [{ id: `${id}-polygon`, points, closed: true }];
    return {
        id,
        name: `Plate ${id}`,
        type: 'lithosphere',
        polygonType: 'continental_plate',
        color: '#ffffff',
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

describe('BoundarySystem.detectBoundaries', () => {
    it('detects a substantial overlap and classifies static plates as transform', () => {
        const a = makePlate('a', [[0, 0], [10, 0], [10, 10], [0, 10]], { center: [5, 5] });
        const b = makePlate('b', [[5, 0], [15, 0], [15, 10], [5, 10]], { center: [10, 5] });

        const boundaries = BoundarySystem.detectBoundaries([a, b], 0);

        expect(boundaries).toHaveLength(1);
        expect(boundaries[0].plateIds).toEqual(['a', 'b']);
        expect(boundaries[0].type).toBe('transform');
        expect(boundaries[0].overlapArea).toBeGreaterThan(40);
        expect(boundaries[0].points[0].length).toBeGreaterThanOrEqual(4);
    });

    it('returns no boundary for separated plates', () => {
        const a = makePlate('a', [[-40, 0], [-30, 0], [-30, 10], [-40, 10]]);
        const b = makePlate('b', [[30, 0], [40, 0], [40, 10], [30, 10]]);

        expect(BoundarySystem.detectBoundaries([a, b], 0)).toEqual([]);
    });

    it('ignores plates outside their lifetime', () => {
        const active = makePlate('active', [[0, 0], [10, 0], [10, 10], [0, 10]]);
        const unborn = makePlate('unborn', [[5, 0], [15, 0], [15, 10], [5, 10]], { birthTime: 10 });
        const dead = makePlate('dead', [[5, 0], [15, 0], [15, 10], [5, 10]], { deathTime: 0 });

        expect(BoundarySystem.detectBoundaries([active, unborn, dead], 0)).toEqual([]);
    });
});
