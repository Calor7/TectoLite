// Spherical Math Utilities for TectoLite
// Shared vector math operations for spherical coordinate calculations

import { Coordinate } from '../types';

// Vector3 interface for 3D Cartesian coordinates
export interface Vector3 {
    x: number;
    y: number;
    z: number;
}

// Degree/Radian conversions
const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;
const clamp = (v: number, min: number, max: number) => (v < min ? min : v > max ? max : v);

export function toRad(deg: number): number {
    return deg * DEG2RAD;
}

export function toDeg(rad: number): number {
    return rad * RAD2DEG;
}

// Convert [lon, lat] to 3D unit vector
export function latLonToVector(p: Coordinate): Vector3 {
    const phi = toRad(p[1]);      // Lat
    const lambda = toRad(p[0]);   // Lon
    const cosPhi = Math.cos(phi);
    return {
        x: cosPhi * Math.cos(lambda),
        y: cosPhi * Math.sin(lambda),
        z: Math.sin(phi)
    };
}

// Convert 3D unit vector to [lon, lat]
export function vectorToLatLon(v: Vector3): Coordinate {
    const phi = Math.asin(clamp(v.z, -1, 1)); // Clamp for safety
    const lambda = Math.atan2(v.y, v.x);
    return [toDeg(lambda), toDeg(phi)];
}

// Rodrigues' rotation formula: rotate vector around axis by angle
export function rotateVector(v: Vector3, axis: Vector3, angle: number): Vector3 {
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    const dot = axis.x * v.x + axis.y * v.y + axis.z * v.z;

    const crossX = axis.y * v.z - axis.z * v.y;
    const crossY = axis.z * v.x - axis.x * v.z;
    const crossZ = axis.x * v.y - axis.y * v.x;

    return {
        x: v.x * cosA + crossX * sinA + axis.x * dot * (1 - cosA),
        y: v.y * cosA + crossY * sinA + axis.y * dot * (1 - cosA),
        z: v.z * cosA + crossZ * sinA + axis.z * dot * (1 - cosA)
    };
}

// Rotate a point (lat/lon) around an Euler pole (lat/lon) by an angle (radians)
export function rotatePoint(point: Coordinate, pole: Coordinate, angleRad: number): Coordinate {
    const v = latLonToVector(point);
    const axis = latLonToVector(pole);
    const rotatedV = rotateVector(v, axis, angleRad);
    return vectorToLatLon(rotatedV);
}

// Cross product of two vectors
export function cross(a: Vector3, b: Vector3): Vector3 {
    return {
        x: a.y * b.z - a.z * b.y,
        y: a.z * b.x - a.x * b.z,
        z: a.x * b.y - a.y * b.x
    };
}

// Dot product of two vectors
export function dot(a: Vector3, b: Vector3): number {
    return a.x * b.x + a.y * b.y + a.z * b.z;
}

// Normalize a vector to unit length
export function normalize(v: Vector3): Vector3 {
    const lenSq = v.x * v.x + v.y * v.y + v.z * v.z;
    if (lenSq === 0) return { x: 0, y: 0, z: 0 };
    const inv = 1 / Math.sqrt(lenSq);
    return { x: v.x * inv, y: v.y * inv, z: v.z * inv };
}

// Scale a vector by scalar
export function scaleVector(v: Vector3, s: number): Vector3 {
    return { x: v.x * s, y: v.y * s, z: v.z * s };
}

// Subtract vectors (a - b)
export function subtractVectors(a: Vector3, b: Vector3): Vector3 {
    return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

// Calculate spherical centroid of a polygon
// This properly averages points on a sphere rather than using first point
export function calculateSphericalCentroid(points: Coordinate[]): Coordinate {
    if (points.length === 0) return [0, 0];
    if (points.length === 1) return points[0];

    // Convert all points to 3D vectors and sum
    let sumX = 0, sumY = 0, sumZ = 0;
    for (let i = 0, n = points.length; i < n; i++) {
        const v = latLonToVector(points[i]);
        sumX += v.x;
        sumY += v.y;
        sumZ += v.z;
    }

    // Normalize and convert back to lat/lon
    const centroidVec = normalize({ x: sumX, y: sumY, z: sumZ });

    // Handle edge case where points cancel out (antipodal)
    if (centroidVec.x === 0 && centroidVec.y === 0 && centroidVec.z === 0) {
        return points[0]; // Fallback to first point
    }

    return vectorToLatLon(centroidVec);
}

// Minimal Quaternion implementation for rotation composition
export interface Quaternion {
    w: number;
    x: number;
    y: number;
    z: number;
}

export function quatMultiply(q1: Quaternion, q2: Quaternion): Quaternion {
    return {
        w: q1.w * q2.w - q1.x * q2.x - q1.y * q2.y - q1.z * q2.z,
        x: q1.w * q2.x + q1.x * q2.w + q1.y * q2.z - q1.z * q2.y,
        y: q1.w * q2.y - q1.x * q2.z + q1.y * q2.w + q1.z * q2.x,
        z: q1.w * q2.z + q1.x * q2.y - q1.y * q2.x + q1.z * q2.w
    };
}

export function quatFromAxisAngle(axis: Vector3, angleRad: number): Quaternion {
    const halfAngle = angleRad / 2;
    const s = Math.sin(halfAngle);
    // Axis should be normalized
    const n = normalize(axis);
    return {
        w: Math.cos(halfAngle),
        x: n.x * s,
        y: n.y * s,
        z: n.z * s
    };
}

export function axisAngleFromQuat(q: Quaternion): { axis: Vector3, angle: number } {
    // Ensure unit quaternion?
    // angle = 2 * acos(w)
    // s = sqrt(1-w*w)
    // x,y,z / s
    const angle = 2 * Math.acos(clamp(q.w, -1, 1));
    const s = Math.sqrt(1 - q.w * q.w);

    if (s < 0.001) {
        // if s is close to 0, then angle is 0, axis can be anything
        return { axis: { x: 1, y: 0, z: 0 }, angle: 0 };
    }

    return {
        axis: {
            x: q.x / s,
            y: q.y / s,
            z: q.z / s
        },
        angle: angle
    };
}

export function distance(a: Coordinate, b: Coordinate): number {
    const v1 = latLonToVector(a);
    const v2 = latLonToVector(b);
    // Standard spherical distance: acos(dot product)
    // Clamp to [-1, 1] to avoid NaN due to FP errors
    return Math.acos(clamp(dot(v1, v2), -1, 1));
}
