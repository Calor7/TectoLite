import { describe, it, expect } from 'vitest';
import {
    toRad,
    toDeg,
    latLonToVector,
    vectorToLatLon,
    rotatePoint,
    normalize,
    cross,
    dot,
    distance,
    nlerpCoord,
    calculateSphericalCentroid,
    quatFromAxisAngle,
    quatMultiply,
    axisAngleFromQuat,
} from './sphericalMath';
import { Coordinate } from '../types';

describe('angle conversions', () => {
    it('toRad and toDeg are inverses', () => {
        expect(toDeg(toRad(123.45))).toBeCloseTo(123.45, 10);
        expect(toRad(180)).toBeCloseTo(Math.PI, 10);
    });
});

describe('latLonToVector / vectorToLatLon', () => {
    it('round-trips arbitrary coordinates', () => {
        const pts: Coordinate[] = [[0, 0], [90, 0], [-120, 45], [179, -89], [13.37, 42.42]];
        for (const p of pts) {
            const [lon, lat] = vectorToLatLon(latLonToVector(p));
            expect(lon).toBeCloseTo(p[0], 8);
            expect(lat).toBeCloseTo(p[1], 8);
        }
    });

    it('maps the equator/prime-meridian intersection to +x', () => {
        const v = latLonToVector([0, 0]);
        expect(v.x).toBeCloseTo(1, 10);
        expect(v.y).toBeCloseTo(0, 10);
        expect(v.z).toBeCloseTo(0, 10);
    });

    it('maps the north pole to +z', () => {
        const v = latLonToVector([0, 90]);
        expect(v.z).toBeCloseTo(1, 10);
    });
});

describe('rotatePoint', () => {
    it('rotates a point on the equator around the north pole', () => {
        const result = rotatePoint([0, 0], [0, 90], toRad(90));
        expect(result[0]).toBeCloseTo(90, 8);
        expect(result[1]).toBeCloseTo(0, 8);
    });

    it('leaves the rotation axis fixed', () => {
        const result = rotatePoint([0, 90], [0, 90], toRad(123));
        // FP precision near the pole limits accuracy to ~1e-6 degrees
        expect(result[1]).toBeCloseTo(90, 5);
    });

    it('rotating by 0 is the identity', () => {
        const result = rotatePoint([12, 34], [56, 78], 0);
        expect(result[0]).toBeCloseTo(12, 8);
        expect(result[1]).toBeCloseTo(34, 8);
    });
});

describe('vector helpers', () => {
    it('normalize returns a unit vector', () => {
        const n = normalize({ x: 3, y: 4, z: 0 });
        expect(Math.hypot(n.x, n.y, n.z)).toBeCloseTo(1, 10);
    });

    it('normalize of the zero vector stays zero', () => {
        expect(normalize({ x: 0, y: 0, z: 0 })).toEqual({ x: 0, y: 0, z: 0 });
    });

    it('cross of x and y is z', () => {
        const c = cross({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
        expect(c).toEqual({ x: 0, y: 0, z: 1 });
    });

    it('dot of orthogonal vectors is 0', () => {
        expect(dot({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 })).toBe(0);
    });
});

describe('distance', () => {
    it('is 0 for identical points', () => {
        expect(distance([10, 20], [10, 20])).toBeCloseTo(0, 10);
    });

    it('is pi/2 for a quarter circle on the equator', () => {
        expect(distance([0, 0], [90, 0])).toBeCloseTo(Math.PI / 2, 10);
    });

    it('is pi for antipodal points', () => {
        expect(distance([0, 0], [180, 0])).toBeCloseTo(Math.PI, 10);
    });
});

describe('nlerpCoord', () => {
    it('returns the endpoints at alpha 0 and 1', () => {
        const a: Coordinate = [10, 20];
        const b: Coordinate = [50, -30];
        expect(nlerpCoord(a, b, 0)[0]).toBeCloseTo(10, 8);
        expect(nlerpCoord(a, b, 0)[1]).toBeCloseTo(20, 8);
        expect(nlerpCoord(a, b, 1)[0]).toBeCloseTo(50, 8);
        expect(nlerpCoord(a, b, 1)[1]).toBeCloseTo(-30, 8);
    });

    it('returns the great-circle midpoint at alpha 0.5', () => {
        const mid = nlerpCoord([0, 0], [90, 0], 0.5);
        expect(mid[0]).toBeCloseTo(45, 8);
        expect(mid[1]).toBeCloseTo(0, 8);
    });

    it('stays on the unit sphere', () => {
        const p = nlerpCoord([-120, 60], [30, -45], 0.3);
        const v = latLonToVector(p);
        expect(Math.hypot(v.x, v.y, v.z)).toBeCloseTo(1, 10);
    });
});

describe('calculateSphericalCentroid', () => {
    it('returns the single point for a 1-point input', () => {
        expect(calculateSphericalCentroid([[12, 34]])).toEqual([12, 34]);
    });

    it('returns the midpoint of two symmetric points', () => {
        const c = calculateSphericalCentroid([[-30, 0], [30, 0]]);
        expect(c[0]).toBeCloseTo(0, 8);
        expect(c[1]).toBeCloseTo(0, 8);
    });

    it('averages a symmetric ring to its center', () => {
        const c = calculateSphericalCentroid([[10, 50], [-10, 50], [10, 30], [-10, 30]]);
        expect(c[0]).toBeCloseTo(0, 6);
        expect(c[1]).toBeCloseTo(40, 0); // spherical average is close to, not exactly, 40
    });
});

describe('quaternions', () => {
    it('axis/angle round-trips through a quaternion', () => {
        const axis = normalize({ x: 1, y: 2, z: 3 });
        const angle = toRad(73);
        const q = quatFromAxisAngle(axis, angle);
        const back = axisAngleFromQuat(q);
        expect(back.angle).toBeCloseTo(angle, 8);
        expect(back.axis.x).toBeCloseTo(axis.x, 8);
        expect(back.axis.y).toBeCloseTo(axis.y, 8);
        expect(back.axis.z).toBeCloseTo(axis.z, 8);
    });

    it('composing two rotations about the same axis adds their angles', () => {
        const axis = { x: 0, y: 0, z: 1 };
        const q1 = quatFromAxisAngle(axis, toRad(30));
        const q2 = quatFromAxisAngle(axis, toRad(45));
        const combined = axisAngleFromQuat(quatMultiply(q2, q1));
        expect(toDeg(combined.angle)).toBeCloseTo(75, 8);
    });
});
