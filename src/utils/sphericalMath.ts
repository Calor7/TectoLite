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
export function toRad(deg: number): number {
    return deg * Math.PI / 180;
}

export function toDeg(rad: number): number {
    return rad * 180 / Math.PI;
}

// Convert [lon, lat] to 3D unit vector
export function latLonToVector(p: Coordinate): Vector3 {
    const phi = toRad(p[1]);      // Lat
    const lambda = toRad(p[0]);   // Lon
    return {
        x: Math.cos(phi) * Math.cos(lambda),
        y: Math.cos(phi) * Math.sin(lambda),
        z: Math.sin(phi)
    };
}

// Convert 3D unit vector to [lon, lat]
export function vectorToLatLon(v: Vector3): Coordinate {
    const phi = Math.asin(Math.max(-1, Math.min(1, v.z))); // Clamp for safety
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
    const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
    if (len === 0) return { x: 0, y: 0, z: 0 };
    return { x: v.x / len, y: v.y / len, z: v.z / len };
}

// Calculate spherical centroid of a polygon
// This properly averages points on a sphere rather than using first point
export function calculateSphericalCentroid(points: Coordinate[]): Coordinate {
    if (points.length === 0) return [0, 0];
    if (points.length === 1) return points[0];

    // Convert all points to 3D vectors and sum
    let sumX = 0, sumY = 0, sumZ = 0;
    for (const point of points) {
        const v = latLonToVector(point);
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
    const angle = 2 * Math.acos(Math.min(1, Math.max(-1, q.w)));
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
