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

export function distance(a: Coordinate, b: Coordinate): number {
    const v1 = latLonToVector(a);
    const v2 = latLonToVector(b);
    // Standard spherical distance: acos(dot product)
    // Clamp to [-1, 1] to avoid NaN due to FP errors
    return Math.acos(Math.min(1, Math.max(-1, dot(v1, v2))));
}

// Find the nearest point on a polygon boundary to a given point
// Returns the closest point that lies on one of the polygon's edges
export function nearestPointOnPolygonBoundary(point: Coordinate, polygonPoints: Coordinate[]): Coordinate {
    if (polygonPoints.length < 2) return point;
    
    let nearestPoint = polygonPoints[0];
    let minDist = distance(point, nearestPoint);
    
    // Check each edge of the polygon
    for (let i = 0; i < polygonPoints.length; i++) {
        const p1 = polygonPoints[i];
        const p2 = polygonPoints[(i + 1) % polygonPoints.length];
        
        // Find nearest point on this edge
        const edgePoint = nearestPointOnGreatCircleSegment(point, p1, p2);
        const dist = distance(point, edgePoint);
        
        if (dist < minDist) {
            minDist = dist;
            nearestPoint = edgePoint;
        }
    }
    
    return nearestPoint;
}

// Find the nearest point on a great circle segment (arc between p1 and p2)
function nearestPointOnGreatCircleSegment(point: Coordinate, p1: Coordinate, p2: Coordinate): Coordinate {
    const v = latLonToVector(point);
    const v1 = latLonToVector(p1);
    const v2 = latLonToVector(p2);
    
    // Normal to the great circle plane containing p1 and p2
    const normal = normalize(cross(v1, v2));
    
    // If p1 and p2 are nearly identical or antipodal, return p1
    const dotV1V2 = dot(v1, v2);
    if (Math.abs(dotV1V2) > 0.9999) {
        return p1;
    }
    
    // Project point onto the great circle plane
    const projected = normalize(subtractVectors(v, scaleVector(normal, dot(v, normal))));
    
    // Check if projected point is between v1 and v2 on the arc
    const angle1 = Math.acos(Math.min(1, Math.max(-1, dot(v1, projected))));
    const angle2 = Math.acos(Math.min(1, Math.max(-1, dot(v2, projected))));
    const angle12 = Math.acos(Math.min(1, Math.max(-1, dotV1V2)));
    
    // If projected point is on the arc segment (angles add up approximately)
    if (Math.abs(angle1 + angle2 - angle12) < 0.001) {
        return vectorToLatLon(projected);
    }
    
    // Otherwise return the closer endpoint
    return distance(point, p1) < distance(point, p2) ? p1 : p2;
}
