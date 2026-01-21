import { AppState, TectonicPlate, Polygon, Coordinate, generateId, createDefaultMotion } from './types';
import {
    Vector3,
    latLonToVector,
    vectorToLatLon,
    cross,
    dot,
    normalize
} from './utils/sphericalMath';

// Legacy interface for start/end splits
interface SplitLine {
    start: Coordinate;
    end: Coordinate;
}

// For polyline splits - array of points
interface SplitPolyline {
    points: Coordinate[];
}

// Check if a point is inside a spherical polygon using ray casting
function isPointInPolygon(point: Coordinate, polygon: Coordinate[]): boolean {
    if (polygon.length < 3) return false;

    let windingNumber = 0;

    for (let i = 0; i < polygon.length; i++) {
        // Check vertical crossing (simplified spherical version)
        const lat1 = polygon[i][1];
        const lat2 = polygon[(i + 1) % polygon.length][1];
        const lon1 = polygon[i][0];
        const lon2 = polygon[(i + 1) % polygon.length][0];
        const pLat = point[1];
        const pLon = point[0];

        // Ray casting using longitude
        if ((lat1 <= pLat && lat2 > pLat) || (lat2 <= pLat && lat1 > pLat)) {
            // Compute longitude at intersection
            const t = (pLat - lat1) / (lat2 - lat1);
            let lonAtIntersection = lon1 + t * (lon2 - lon1);

            // Handle wrap-around
            if (Math.abs(lon2 - lon1) > 180) {
                if (lon2 < lon1) lonAtIntersection = lon1 + t * (lon2 + 360 - lon1);
                else lonAtIntersection = lon1 + t * (lon2 - 360 - lon1);
            }

            if (pLon < lonAtIntersection) {
                windingNumber += (lat2 > lat1) ? 1 : -1;
            }
        }
    }

    return windingNumber !== 0;
}

// Find intersection of two line segments on sphere (great circle arcs)
function findSegmentIntersection(
    a1: Coordinate, a2: Coordinate,
    b1: Coordinate, b2: Coordinate
): Coordinate | null {
    const va1 = latLonToVector(a1);
    const va2 = latLonToVector(a2);
    const vb1 = latLonToVector(b1);
    const vb2 = latLonToVector(b2);

    // Normal of plane containing great circle A
    const nA = normalize(cross(va1, va2));
    // Normal of plane containing great circle B
    const nB = normalize(cross(vb1, vb2));

    // Check for parallel planes (same great circle)
    const crossN = cross(nA, nB);
    const len = Math.sqrt(crossN.x ** 2 + crossN.y ** 2 + crossN.z ** 2);
    if (len < 1e-6) return null;

    // Intersection line direction
    const dir = { x: crossN.x / len, y: crossN.y / len, z: crossN.z / len };

    // Angle validation helper
    const getAngle = (u: Vector3, v: Vector3) => Math.acos(Math.max(-1, Math.min(1, dot(u, v))));

    const isBetween = (p: Vector3, start: Vector3, end: Vector3): boolean => {
        const angTotal = getAngle(start, end);
        const ang1 = getAngle(start, p);
        const ang2 = getAngle(end, p);
        // Point is on arc if sum of angles equals total angle (within tolerance)
        return Math.abs((ang1 + ang2) - angTotal) < 1e-4;
    };

    // Try both intersection points (+/- direction)
    for (const sign of [1, -1]) {
        const p = { x: dir.x * sign, y: dir.y * sign, z: dir.z * sign };
        if (isBetween(p, va1, va2) && isBetween(p, vb1, vb2)) {
            return vectorToLatLon(p);
        }
    }

    return null;
}

// Clip polygon against a plane (Great Circle)
function clipPolygonToPlane(points: Coordinate[], normal: Vector3): Coordinate[] {
    const output: Coordinate[] = [];
    if (points.length === 0) return [];

    for (let i = 0; i < points.length; i++) {
        const curr = points[i];
        const prev = points[(i + points.length - 1) % points.length];

        const vCurr = latLonToVector(curr);
        const vPrev = latLonToVector(prev);

        const distCurr = dot(vCurr, normal);
        const distPrev = dot(vPrev, normal);

        // Check if crossing plane
        if (distCurr >= 0) {
            if (distPrev < 0) {
                // Entering positive half-space intersection
                const t = -distPrev / (distCurr - distPrev);
                const lerpVec = {
                    x: vPrev.x + (vCurr.x - vPrev.x) * t,
                    y: vPrev.y + (vCurr.y - vPrev.y) * t,
                    z: vPrev.z + (vCurr.z - vPrev.z) * t
                };
                const p = normalize(lerpVec);
                output.push(vectorToLatLon(p));
            }
            output.push(curr);
        } else if (distPrev >= 0) {
            // Exiting positive half-space
            const t = -distPrev / (distCurr - distPrev);
            const lerpVec = {
                x: vPrev.x + (vCurr.x - vPrev.x) * t,
                y: vPrev.y + (vCurr.y - vPrev.y) * t,
                z: vPrev.z + (vCurr.z - vPrev.z) * t
            };
            const p = normalize(lerpVec);
            output.push(vectorToLatLon(p));
        }
    }

    return output;
}

// Fallback to great circle split
function fallbackGreatCircleSplit(
    polygonPoints: Coordinate[],
    polylinePoints: Coordinate[]
): [Coordinate[], Coordinate[]] {
    const segStart = polylinePoints[0];
    const segEnd = polylinePoints[polylinePoints.length - 1];

    const vStart = latLonToVector(segStart);
    const vEnd = latLonToVector(segEnd);
    let normal = cross(vStart, vEnd);
    normal = normalize(normal);

    if (normal.x === 0 && normal.y === 0 && normal.z === 0) {
        return [polygonPoints, []];
    }

    const leftPoints = clipPolygonToPlane(polygonPoints, normal);
    const rightPoints = clipPolygonToPlane(polygonPoints, { x: -normal.x, y: -normal.y, z: -normal.z });

    return [leftPoints, rightPoints];
}

// Split polygon using polyline - returns [leftPolygon, rightPolygon]
function splitPolygonWithPolyline(
    polygonPoints: Coordinate[],
    polylinePoints: Coordinate[]
): [Coordinate[], Coordinate[]] {
    if (polylinePoints.length < 2 || polygonPoints.length < 3) {
        return [polygonPoints, []];
    }

    // Find entry and exit points where polyline crosses polygon boundary
    const crossings: { index: number; point: Coordinate; polylineIdx: number }[] = [];

    for (let pi = 0; pi < polylinePoints.length - 1; pi++) {
        const pStart = polylinePoints[pi];
        const pEnd = polylinePoints[pi + 1];

        for (let bi = 0; bi < polygonPoints.length; bi++) {
            const bStart = polygonPoints[bi];
            const bEnd = polygonPoints[(bi + 1) % polygonPoints.length];

            const intersection = findSegmentIntersection(pStart, pEnd, bStart, bEnd);
            if (intersection) {
                crossings.push({ index: bi, point: intersection, polylineIdx: pi });
            }
        }
    }

    // Need exactly 2 crossings for a clean split
    // If more than 2, it means disjoint or complex topology - fallback for safety
    if (crossings.length !== 2) {
        return fallbackGreatCircleSplit(polygonPoints, polylinePoints);
    }

    // Sort crossings by polyline index (first along the cut)
    crossings.sort((a, b) => a.polylineIdx - b.polylineIdx);

    const firstCrossing = crossings[0];
    const secondCrossing = crossings[1];

    // Get the polyline points between crossings
    const cutSegment: Coordinate[] = [];

    // Add the first crossing point as part of the cut
    // Points from the polyline strictly between the two crossing segments
    const intermediatePoints = polylinePoints.slice(
        firstCrossing.polylineIdx + 1,
        secondCrossing.polylineIdx + 1
    );
    cutSegment.push(...intermediatePoints);

    // Construct Polygon A: 
    // From firstCrossing -> follow boundary forward -> secondCrossing -> follow cut backwards -> firstCrossing
    const polyA: Coordinate[] = [firstCrossing.point];
    let idx = (firstCrossing.index + 1) % polygonPoints.length;
    while (idx !== (secondCrossing.index + 1) % polygonPoints.length) {
        polyA.push(polygonPoints[idx]);
        idx = (idx + 1) % polygonPoints.length;
    }
    polyA.push(secondCrossing.point);
    polyA.push(...[...cutSegment].reverse());

    // Construct Polygon B:
    // From secondCrossing -> follow boundary forward -> firstCrossing -> follow cut forward -> secondCrossing
    const polyB: Coordinate[] = [secondCrossing.point];
    idx = (secondCrossing.index + 1) % polygonPoints.length;
    while (idx !== (firstCrossing.index + 1) % polygonPoints.length) {
        polyB.push(polygonPoints[idx]);
        idx = (idx + 1) % polygonPoints.length;
    }
    polyB.push(firstCrossing.point);
    polyB.push(...cutSegment);

    return [polyA, polyB];
}

export function splitPlate(
    state: AppState,
    plateId: string,
    splitLine: SplitLine | SplitPolyline
): AppState {
    const plateToSplit = state.world.plates.find(p => p.id === plateId);
    if (!plateToSplit) return state;

    // Convert to polyline format
    const polylinePoints: Coordinate[] = 'points' in splitLine
        ? splitLine.points
        : [splitLine.start, splitLine.end];

    if (polylinePoints.length < 2) return state;

    // Calculate overall normal for feature assignment (approximate)
    let overallNormal = { x: 0, y: 0, z: 0 };
    if (polylinePoints.length >= 2) {
        const vS = latLonToVector(polylinePoints[0]);
        const vE = latLonToVector(polylinePoints[polylinePoints.length - 1]);
        overallNormal = normalize(cross(vS, vE));
    }

    const leftPolygons: Polygon[] = [];
    const rightPolygons: Polygon[] = [];

    for (const poly of plateToSplit.polygons) {
        // Split polygon using the polyline
        const [poly1, poly2] = splitPolygonWithPolyline(poly.points, polylinePoints);

        if (poly1.length >= 3) {
            leftPolygons.push({ ...poly, id: generateId(), points: poly1 });
        }
        if (poly2.length >= 3) {
            rightPolygons.push({ ...poly, id: generateId(), points: poly2 });
        }
    }

    if (leftPolygons.length === 0 || rightPolygons.length === 0) {
        return state;
    }

    // Assign Features based on polygon containment
    const leftFeatures = [];
    const rightFeatures = [];

    for (const feat of plateToSplit.features) {
        // Check which resulting polygon contains this feature
        const inLeft = leftPolygons.some(poly => isPointInPolygon(feat.position, poly.points));
        const inRight = rightPolygons.some(poly => isPointInPolygon(feat.position, poly.points));

        if (inLeft && !inRight) {
            leftFeatures.push(feat);
        } else if (inRight && !inLeft) {
            rightFeatures.push(feat);
        } else if (inLeft && inRight) {
            // Edge case: feature on boundary - use dot product as tiebreaker
            const v = latLonToVector(feat.position);
            if (dot(v, overallNormal) > 0) {
                leftFeatures.push(feat);
            } else {
                rightFeatures.push(feat);
            }
        } else {
            // Not in either polygon - use dot product fallback
            const v = latLonToVector(feat.position);
            if (dot(v, overallNormal) > 0) {
                leftFeatures.push(feat);
            } else {
                rightFeatures.push(feat);
            }
        }
    }

    // Create two new plates with default motion (0)
    const currentTime = state.world.currentTime;
    const defaultMotion = createDefaultMotion();

    const leftKeyframe = {
        time: currentTime,
        eulerPole: { ...defaultMotion.eulerPole },
        snapshotPolygons: leftPolygons,
        snapshotFeatures: leftFeatures
    };

    const rightKeyframe = {
        time: currentTime,
        eulerPole: { ...defaultMotion.eulerPole },
        snapshotPolygons: rightPolygons,
        snapshotFeatures: rightFeatures
    };

    const leftPlate: TectonicPlate = {
        ...plateToSplit,
        id: generateId(),
        name: `${plateToSplit.name} (A)`,
        polygons: leftPolygons,
        features: leftFeatures,
        motion: defaultMotion,
        motionKeyframes: [leftKeyframe],
        visible: true,
        locked: false,
        color: plateToSplit.color, // Keep original color for A
        center: polylinePoints[0],
        events: [],
        birthTime: currentTime,
        deathTime: null,
        initialPolygons: leftPolygons,
        initialFeatures: leftFeatures
    };

    const rightPlate: TectonicPlate = {
        ...plateToSplit,
        id: generateId(),
        name: `${plateToSplit.name} (B)`,
        polygons: rightPolygons,
        features: rightFeatures,
        motion: defaultMotion,
        motionKeyframes: [rightKeyframe],
        visible: true,
        locked: false,
        color: '#D4AF37', // Gold for B
        center: polylinePoints[polylinePoints.length - 1],
        events: [],
        birthTime: currentTime,
        deathTime: null,
        initialPolygons: rightPolygons,
        initialFeatures: rightFeatures
    };

    // Mark old plate as dead
    const updatedOldPlate = {
        ...plateToSplit,
        deathTime: state.world.currentTime
    };

    const newPlates = state.world.plates.filter(p => p.id !== plateId);
    newPlates.push(updatedOldPlate, leftPlate, rightPlate);

    return {
        ...state,
        world: {
            ...state.world,
            plates: newPlates,
            selectedPlateId: leftPlate.id
        }
    };
}
