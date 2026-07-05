import { describe, it, expect } from 'vitest';
import {
    segmentsRotation,
    plateRotation,
    derivePlateGeometry,
    fromLegacyKeyframes,
    pointPositionAt,
    activeStage,
    ensureMotionModel,
} from './RotationModel';
import {
    quatFromAxisAngle,
    latLonToVector,
    rotateCoordByQuat,
    rotatePoint,
    toRad,
} from '../utils/sphericalMath';
import { Coordinate, EulerPole, TectonicPlate, MotionSegment, GeometryStage } from '../types';

const NORTH: Coordinate = [0, 90];
const SOUTH: Coordinate = [0, -90];

const pole = (position: Coordinate, rate: number): EulerPole => ({ position, rate, visible: false });
const seg = (time: number, position: Coordinate, rate: number): MotionSegment => ({ time, eulerPole: pole(position, rate) });

function makePlate(id: string, overrides: Partial<TectonicPlate> = {}): TectonicPlate {
    return {
        id,
        name: id,
        birthTime: 0,
        deathTime: null,
        center: [0, 0],
        polygons: [],
        features: [],
        initialPolygons: [],
        initialFeatures: [],
        motionSegments: [seg(0, NORTH, 0)],
        geometryStages: [{ time: 0, polygons: [], features: [] }],
        events: [],
        connectedRiftIds: [],
        ...overrides,
    } as unknown as TectonicPlate;
}

const expectCoord = (actual: Coordinate, expected: Coordinate, digits = 6) => {
    expect(actual[0]).toBeCloseTo(expected[0], digits);
    expect(actual[1]).toBeCloseTo(expected[1], digits);
};

describe('quaternion path matches Rodrigues rotation', () => {
    it('rotateCoordByQuat equals rotatePoint for the same axis/angle', () => {
        const p: Coordinate = [25, -40];
        const axis: Coordinate = [80, 30];
        const angle = toRad(37);
        const viaQuat = rotateCoordByQuat(p, quatFromAxisAngle(latLonToVector(axis), angle));
        const viaRodrigues = rotatePoint(p, axis, angle);
        expectCoord(viaQuat, viaRodrigues, 8);
    });
});

describe('segmentsRotation', () => {
    it('no segments + zero fallback = identity', () => {
        const q = segmentsRotation([], pole(NORTH, 0), 0, 100);
        expectCoord(rotateCoordByQuat([10, 20], q), [10, 20], 8);
    });

    it('no segments uses fallback pole', () => {
        const q = segmentsRotation([], pole(NORTH, 1), 0, 30);
        // 30 Ma * 1°/Ma around the north pole = +30° longitude
        expectCoord(rotateCoordByQuat([10, 0], q), [40, 0]);
    });

    it('single segment rotates at constant rate', () => {
        const q = segmentsRotation([seg(0, NORTH, 1)], undefined, 0, 25);
        expectCoord(rotateCoordByQuat([0, 0], q), [25, 0]);
    });

    it('is piecewise across segment boundaries', () => {
        // 0–10 Ma: +1°/Ma around north (+10° lon); 10–30 Ma: 1°/Ma around south (−20° lon)
        const segments = [seg(0, NORTH, 1), seg(10, SOUTH, 1)];
        const q = segmentsRotation(segments, undefined, 0, 30);
        expectCoord(rotateCoordByQuat([0, 0], q), [-10, 0]);
    });

    it('starting mid-segment only integrates the remaining span', () => {
        const segments = [seg(0, NORTH, 1), seg(10, SOUTH, 1)];
        const q = segmentsRotation(segments, undefined, 5, 15);
        // 5–10: +5°, 10–15: −5° → net 0
        expectCoord(rotateCoordByQuat([30, 10], q), [30, 10]);
    });

    it('extends the first segment backwards in time', () => {
        const segments = [seg(50, NORTH, 1)];
        const q = segmentsRotation(segments, undefined, 30, 50);
        expectCoord(rotateCoordByQuat([0, 0], q), [20, 0]);
    });

    it('backward interval is the exact inverse', () => {
        const segments = [seg(0, NORTH, 1), seg(10, SOUTH, 2), seg(40, [45, 45], 0.7)];
        const fwd = segmentsRotation(segments, undefined, 3, 77);
        const back = segmentsRotation(segments, undefined, 77, 3);
        const p: Coordinate = [12, -34];
        expectCoord(rotateCoordByQuat(rotateCoordByQuat(p, fwd), back), p, 8);
    });
});

describe('plateRotation', () => {
    it('delegates pre-birth time to the parent plate', () => {
        // Parent moves +1°/Ma from 0; child born at 50 moves +2°/Ma on its own.
        const parent = makePlate('parent', {
            motionSegments: [seg(0, NORTH, 1)],
            geometryStages: [{ time: 0, polygons: [], features: [] }],
        });
        const child = makePlate('child', {
            birthTime: 50,
            parentPlateId: 'parent',
            motionSegments: [seg(50, NORTH, 2)],
            geometryStages: [{ time: 50, polygons: [], features: [] }],
        });
        const q = plateRotation(child, [parent, child], 0, 100);
        // 50 Ma of parent (+50°) + 50 Ma of child (+100°) = +150° longitude
        expectCoord(rotateCoordByQuat([0, 0], q), [150, 0]);
    });

    it('composes inherited motion within the link window', () => {
        const mover = makePlate('mover', {
            motionSegments: [seg(0, NORTH, 1)],
            geometryStages: [{ time: 0, polygons: [], features: [] }],
        });
        const strip = makePlate('strip', {
            linkedToPlateId: 'mover',
            linkTime: 20,
            motionSegments: [seg(0, NORTH, 0)],
            geometryStages: [{ time: 0, polygons: [], features: [] }],
        });
        const q = plateRotation(strip, [mover, strip], 0, 50);
        // Only [20, 50] inherits → +30° longitude
        expectCoord(rotateCoordByQuat([0, 0], q), [30, 0]);
    });

    it('adds own differential motion on top of inherited motion', () => {
        const mover = makePlate('mover', {
            motionSegments: [seg(0, NORTH, 1)],
            geometryStages: [{ time: 0, polygons: [], features: [] }],
        });
        const child = makePlate('child', {
            linkedToPlateId: 'mover',
            motionSegments: [seg(0, NORTH, 0.5)],
            geometryStages: [{ time: 0, polygons: [], features: [] }],
        });
        const q = plateRotation(child, [mover, child], 0, 40);
        // Same axis: rates simply add → +60° longitude
        expectCoord(rotateCoordByQuat([0, 0], q), [60, 0]);
    });

    it('survives link cycles without infinite recursion', () => {
        const a = makePlate('a', { linkedToPlateId: 'b', motionSegments: [seg(0, NORTH, 1)], geometryStages: [{ time: 0, polygons: [], features: [] }] });
        const b = makePlate('b', { linkedToPlateId: 'a', motionSegments: [seg(0, NORTH, 1)], geometryStages: [{ time: 0, polygons: [], features: [] }] });
        const q = plateRotation(a, [a, b], 0, 10);
        // a's own 10° + b's own 10° (cycle back to a contributes identity)
        expectCoord(rotateCoordByQuat([0, 0], q), [20, 0]);
    });
});

describe('geometry stages', () => {
    const square = (lonOffset: number) => [{
        id: 'p1',
        points: [[lonOffset, 0], [lonOffset + 10, 0], [lonOffset + 10, 10], [lonOffset, 10]] as Coordinate[],
        closed: true,
    }];

    it('activeStage picks the last stage at or before t', () => {
        const stages: GeometryStage[] = [
            { time: 0, polygons: [], features: [] },
            { time: 50, polygons: [], features: [] },
        ];
        expect(activeStage(stages, 20).time).toBe(0);
        expect(activeStage(stages, 50).time).toBe(50);
        expect(activeStage(stages, 80).time).toBe(50);
    });

    it('derives birth-stage geometry rotated to t', () => {
        const plate = makePlate('a', {
            motionSegments: [seg(0, NORTH, 1)],
            geometryStages: [{ time: 0, polygons: square(0), features: [] }],
        });
        const g = derivePlateGeometry(plate, [plate], 30);
        expectCoord(g.polygons[0].points[0], [30, 0]);
        expectCoord(g.polygons[0].points[2], [40, 10]);
    });

    it('a shape-edit stage takes over from its time onward', () => {
        const plate = makePlate('a', {
            motionSegments: [seg(0, NORTH, 1)],
            geometryStages: [
                { time: 0, polygons: square(0), features: [] },
                { time: 50, polygons: square(100), features: [] }, // user edit at t=50
            ],
        });
        const g = derivePlateGeometry(plate, [plate], 70);
        // Edit stage geometry (lon 100) advected 20 Ma → lon 120
        expectCoord(g.polygons[0].points[0], [120, 0]);
    });

    it('retroactive motion edits are correct with no re-baking', () => {
        const plate = makePlate('a', {
            motionSegments: [seg(0, NORTH, 1)],
            geometryStages: [
                { time: 0, polygons: square(0), features: [] },
                { time: 50, polygons: square(100), features: [] },
            ],
        });
        // User retroactively doubles the early motion: only the array changes.
        plate.motionSegments = [seg(0, NORTH, 2)];
        const g = derivePlateGeometry(plate, [plate], 70);
        // Stage at 50 advected 20 Ma at 2°/Ma → lon 140 — no recalculation pass needed
        expectCoord(g.polygons[0].points[0], [140, 0]);
    });

    it('features placed after the stage are anchored at their creation time', () => {
        const plate = makePlate('a', {
            motionSegments: [seg(0, NORTH, 1)],
            geometryStages: [{
                time: 0,
                polygons: square(0),
                features: [
                    { id: 'f-birth', type: 'mountain', position: [5, 5] } as never,
                    { id: 'f-later', type: 'volcano', position: [5, 5], generatedAt: 20 } as never,
                ],
            }],
        });
        const g = derivePlateGeometry(plate, [plate], 30);
        // Placed at birth: rotated full 30°
        expectCoord(g.features[0].position, [35, 5]);
        // Placed at t=20 at [5,5]: rotated remaining 10°
        expectCoord(g.features[1].position, [15, 5]);
    });

    it('pointPositionAt advects an anchored point', () => {
        const plate = makePlate('a', {
            motionSegments: [seg(0, NORTH, 1)],
            geometryStages: [{ time: 0, polygons: [], features: [] }],
        });
        expectCoord(pointPositionAt(plate, [plate], [10, 20], 40, 100), [70, 20]);
    });
});

describe('ensureMotionModel', () => {
    const square = (lonOffset: number) => [{
        id: 'p1',
        points: [[lonOffset, 0], [lonOffset + 10, 0], [lonOffset + 10, 10], [lonOffset, 10]] as Coordinate[],
        closed: true,
    }];

    it('materializes legacy keyframes once and clears them', () => {
        // Legacy plate: has motion/motionKeyframes but NO motionSegments/geometryStages.
        // ensureMotionModel should convert and write the new fields.
        const plate = {
            id: 'a',
            name: 'a',
            birthTime: 0,
            deathTime: null,
            center: [0, 0],
            polygons: [],
            features: [],
            initialPolygons: square(0),
            initialFeatures: [],
            motion: { eulerPole: pole(NORTH, 0) },
            motionKeyframes: [
                { time: 0, eulerPole: pole(NORTH, 1), snapshotPolygons: [], snapshotFeatures: [] },
            ],
            events: [],
            connectedRiftIds: [],
        } as unknown as TectonicPlate;
        const model = ensureMotionModel(plate);
        expect(plate.motionSegments).toHaveLength(1);
        expect(plate.motionSegments[0].eulerPole.rate).toBe(1);
        expect(plate.geometryStages).toHaveLength(1);
        expect((plate as any).motionKeyframes).toBeUndefined(); // legacy storage retired
        expect(model.segments).toBe(plate.motionSegments);
    });

    it('is idempotent and preserves already-materialized fields', () => {
        const plate = makePlate('a', {
            motionSegments: [seg(0, NORTH, 2)],
            geometryStages: [{ time: 0, polygons: [], features: [] }],
        });
        const before = plate.motionSegments;
        ensureMotionModel(plate);
        ensureMotionModel(plate);
        expect(plate.motionSegments).toBe(before);
        expect(plate.motionSegments![0].eulerPole.rate).toBe(2);
    });

    it('split regression: a clone with new geometry must reset stale stages', () => {
        // Cloning a materialized plate via spread while replacing initialPolygons
        // would silently render the OLD stages. Clone sites reset both fields —
        // this pins that the reset actually makes the new geometry win.
        const parent = makePlate('parent', {
            motionSegments: [seg(0, NORTH, 0)],
            geometryStages: [{ time: 0, polygons: square(0), features: [] }],
        });
        const child = {
            ...parent,
            id: 'child',
            initialPolygons: square(100),
            // Fresh motion model — must NOT inherit the parent's stale stages
            motionSegments: [seg(0, NORTH, 0)],
            geometryStages: [{ time: 0, polygons: square(100), features: [] }],
        } as TectonicPlate;
        const g = derivePlateGeometry(child, [child], 10);
        expectCoord(g.polygons[0].points[0], [100, 0]);
    });
});

describe('fromLegacyKeyframes', () => {
    // Helper: build a legacy-shaped plate (motion/motionKeyframes, no new fields)
    const makeLegacyPlate = (id: string, overrides: Record<string, unknown> = {}): TectonicPlate => ({
        id,
        name: id,
        birthTime: 0,
        deathTime: null,
        center: [0, 0],
        polygons: [],
        features: [],
        initialPolygons: [],
        initialFeatures: [],
        events: [],
        connectedRiftIds: [],
        motion: { eulerPole: pole(NORTH, 0) },
        motionKeyframes: [],
        ...overrides,
    } as unknown as TectonicPlate);

    it('maps keyframes to segments and keeps only Edit snapshots as stages', () => {
        const plate = makeLegacyPlate('a', {
            birthTime: 5,
            initialPolygons: [{ id: 'ip', points: [[0, 0]] as Coordinate[], closed: true }],
            initialFeatures: [],
            motionKeyframes: [
                { time: 5, eulerPole: pole(NORTH, 1), snapshotPolygons: [{ id: 's1', points: [[0, 0]], closed: true }], snapshotFeatures: [] },
                { time: 30, eulerPole: pole(SOUTH, 2), snapshotPolygons: [{ id: 's2', points: [[25, 0]], closed: true }], snapshotFeatures: [] },
                { time: 60, eulerPole: pole(NORTH, 1), label: 'Edit', snapshotPolygons: [{ id: 's3', points: [[99, 0]], closed: true }], snapshotFeatures: [] },
            ],
        });
        const model = fromLegacyKeyframes(plate);

        expect(model.segments).toHaveLength(3);
        expect(model.segments[1].eulerPole.rate).toBe(2);

        // Birth stage + the Edit stage; the t=30 snapshot is derived data and dropped
        expect(model.stages).toHaveLength(2);
        expect(model.stages[0].time).toBe(5);
        expect(model.stages[1].time).toBe(60);
        expect(model.stages[1].polygons[0].points[0][0]).toBe(99);
    });

    it('plate without keyframes gets one segment from its current motion', () => {
        const plate = makeLegacyPlate('a', { motion: { eulerPole: pole(NORTH, 3) } });
        const model = fromLegacyKeyframes(plate);
        expect(model.segments).toHaveLength(1);
        expect(model.segments[0].eulerPole.rate).toBe(3);
        expect(model.stages).toHaveLength(1);
    });
});
