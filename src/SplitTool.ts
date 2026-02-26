import {
    AppState, TectonicPlate,
    Polygon,
    Coordinate,
    generateId,
    MotionKeyframe,
    createDefaultMotion
} from './types';
import {
    Vector3,
    latLonToVector,
    vectorToLatLon,
    cross,
    dot,
    normalize,
    calculateSphericalCentroid,
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
export function isPointInPolygon(point: Coordinate, polygon: Coordinate[]): boolean {
    if (polygon.length < 3) return false;

    const pLat = point[1];
    const pLon = point[0];
    let windingNumber = 0;

    let prev = polygon[polygon.length - 1];
    for (let i = 0; i < polygon.length; i++) {
        // Check vertical crossing (simplified spherical version)
        const curr = polygon[i];
        const lat1 = prev[1];
        const lat2 = curr[1];
        const lon1 = prev[0];
        const lon2 = curr[0];

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

        prev = curr;
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
    const clamp = (val: number, min: number, max: number) => (val < min ? min : val > max ? max : val);
    const getAngle = (u: Vector3, v: Vector3) => Math.acos(clamp(dot(u, v), -1, 1));

    const isBetween = (p: Vector3, start: Vector3, end: Vector3): boolean => {
        const angTotal = getAngle(start, end);
        const ang1 = getAngle(start, p);
        const ang2 = getAngle(end, p);
        // Point is on arc if sum of angles equals total angle (within tolerance)
        return Math.abs((ang1 + ang2) - angTotal) < 1e-4;
    };

    // Try both intersection points (+/- direction)
    for (let sign = 1; sign >= -1; sign -= 2) {
        const p = { x: dir.x * sign, y: dir.y * sign, z: dir.z * sign };
        if (isBetween(p, va1, va2) && isBetween(p, vb1, vb2)) {
            return vectorToLatLon(p);
        }
    }

    return null;
}


// Helper to check if an edge index is a rift
function isRiftEdge(index: number, riftIndices?: number[]): boolean {
    return riftIndices ? riftIndices.includes(index) : false;
}

interface SplitResult {
    points: Coordinate[];
    riftIndices: number[];
    cutPath?: Coordinate[]; // The actual split line segment
}

// Split polygon using polyline - returns [leftPolygon, rightPolygon] with rift info
function splitPolygonWithPolyline(
    polygonPoints: Coordinate[],
    polylinePoints: Coordinate[],
    existingRiftIndices?: number[]
): [SplitResult, SplitResult] {
    const defaultResult: [SplitResult, SplitResult] = [
        { points: polygonPoints, riftIndices: existingRiftIndices || [] },
        { points: [], riftIndices: [] }
    ];

    if (polylinePoints.length < 2 || polygonPoints.length < 3) {
        return defaultResult;
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

    if (crossings.length < 2) {
        return defaultResult;
    }

    // Sort crossings by polyline index (first along the cut)
    crossings.sort((a, b) => a.polylineIdx - b.polylineIdx);

    const firstCrossing = crossings[0];
    const secondCrossing = crossings[crossings.length - 1];

    // Get the polyline points between crossings
    const cutSegment: Coordinate[] = [];
    const intermediatePoints = polylinePoints.slice(
        firstCrossing.polylineIdx + 1,
        secondCrossing.polylineIdx + 1
    );
    cutSegment.push(...intermediatePoints);

    // --- CONSTRUCT POLYGON A ---
    const polyA: Coordinate[] = [];
    const riftA: number[] = [];

    // 1. First Crossing Point
    polyA.push(firstCrossing.point);

    // 2. Boundary Segment: From First Crossing -> Second Crossing
    let idx = (firstCrossing.index + 1) % polygonPoints.length;

    if (isRiftEdge(firstCrossing.index, existingRiftIndices)) {
        riftA.push(polyA.length - 1);
    }

    while (idx !== (secondCrossing.index + 1) % polygonPoints.length) {
        polyA.push(polygonPoints[idx]);
        if (isRiftEdge(idx, existingRiftIndices)) {
            riftA.push(polyA.length - 1);
        }
        idx = (idx + 1) % polygonPoints.length;
    }

    polyA.push(secondCrossing.point);

    // 4. Cut Segment (Reversed) -> Closing Loop (NEW RIFT)
    const cutRev = [...cutSegment].reverse();
    riftA.push(polyA.length - 1);

    for (const p of cutRev) {
        polyA.push(p);
        riftA.push(polyA.length - 1);
    }
    riftA.push(polyA.length - 1);


    // --- CONSTRUCT POLYGON B ---
    const polyB: Coordinate[] = [];
    const riftB: number[] = [];

    // 1. Second Crossing Point
    polyB.push(secondCrossing.point);

    // 2. Boundary Segment: From Second Crossing -> First Crossing
    if (isRiftEdge(secondCrossing.index, existingRiftIndices)) {
        riftB.push(polyB.length - 1);
    }

    idx = (secondCrossing.index + 1) % polygonPoints.length;
    while (idx !== (firstCrossing.index + 1) % polygonPoints.length) {
        polyB.push(polygonPoints[idx]);
        if (isRiftEdge(idx, existingRiftIndices)) {
            riftB.push(polyB.length - 1);
        }
        idx = (idx + 1) % polygonPoints.length;
    }

    polyB.push(firstCrossing.point);

    // 4. Cut Segment (Forward) (NEW RIFT)
    riftB.push(polyB.length - 1);

    for (const p of cutSegment) {
        polyB.push(p);
        riftB.push(polyB.length - 1);
    }
    riftB.push(polyB.length - 1);

    const fullCutPath = [firstCrossing.point, ...cutSegment, secondCrossing.point];

    return [
        { points: polyA, riftIndices: riftA, cutPath: fullCutPath },
        { points: polyB, riftIndices: riftB, cutPath: fullCutPath }
    ];

}

// --- HELPER: Motion Calculation (Duplicated from SimulationEngine due to isolation) ---
// We need to bake the current position of the plate into the new "Initial State"
// so that when the new plate is born, it starts at the current visual location.

function getAccumulatedParentTransform(
    p: TectonicPlate,
    t: number,
    allPlates: TectonicPlate[],
    visited: Set<string>
): { axis: Vector3; angle: number }[] {
    if (!p.linkedToPlateId || visited.has(p.id)) return [];
    visited.add(p.id);

    const parent = allPlates.find(pl => pl.id === p.linkedToPlateId);
    if (!parent) return [];

    let transforms: { axis: Vector3; angle: number }[] = [];

    // 1. Get grandparent transforms first (recursive)
    transforms.push(...getAccumulatedParentTransform(parent, t, allPlates, visited));

    // 2. Add this parent's motion if within link window
    const isWithinLinkWindow =
        (!p.linkTime || t >= p.linkTime) &&
        (!p.unlinkTime || t < p.unlinkTime);

    if (isWithinLinkWindow) {
        const parentKeyframes = parent.motionKeyframes || [];
        // Find child current active keyframe to know from when we inherit parent motion
        const activeKF = (p.motionKeyframes || []).filter(k => k.time <= t).sort((a, b) => b.time - a.time)[0];
        const linkStartTime = p.linkTime || (parentKeyframes[0]?.time ?? 0);
        const motionStartTime = activeKF ? Math.max(linkStartTime, activeKF.time) : linkStartTime;

        const relevantKeyframes = parentKeyframes.filter(kf => kf.time <= t);

        if (relevantKeyframes.length > 0) {
            relevantKeyframes.sort((a, b) => a.time - b.time);
            let prevTime = motionStartTime;

            for (let i = 0; i < relevantKeyframes.length; i++) {
                const kf = relevantKeyframes[i];
                if (kf.eulerPole && kf.eulerPole.rate !== 0) {
                    const pole = kf.eulerPole;
                    const axis = latLonToVector(pole.position);

                    let segmentEnd = t;
                    if (i + 1 < relevantKeyframes.length) {
                        segmentEnd = Math.min(relevantKeyframes[i + 1].time, t);
                    }

                    const duration = segmentEnd - Math.max(kf.time, prevTime);
                    if (duration > 0) {
                        const angle = (pole.rate * duration) * (Math.PI / 180); // To Rad
                        transforms.push({ axis, angle });
                    }
                    prevTime = segmentEnd;
                }
            }
        }
    }
    return transforms;
}

// Helper to rotate vector by axis/angle
function rotateVector(v: Vector3, axis: Vector3, angle: number): Vector3 {
    // Rodriguez rotation formula
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    const crossProd = cross(axis, v);
    const dotProd = dot(axis, v);

    return {
        x: v.x * cosA + crossProd.x * sinA + axis.x * dotProd * (1 - cosA),
        y: v.y * cosA + crossProd.y * sinA + axis.y * dotProd * (1 - cosA),
        z: v.z * cosA + crossProd.z * sinA + axis.z * dotProd * (1 - cosA)
    };
}

function applyTransformToPolygons(plate: TectonicPlate, time: number, allPlates: TectonicPlate[]): Polygon[] {
    const parentTransform = getAccumulatedParentTransform(plate, time, allPlates, new Set());

    const keyframes = plate.motionKeyframes || [];
    const activeKF = keyframes.filter(kf => kf.time <= time).sort((a, b) => b.time - a.time)[0];

    // For Oceanic Strips (no keyframes), fall back to initialPolygons.
    const sourcePolys = activeKF ? activeKF.snapshotPolygons : (plate.initialPolygons || plate.polygons);

    // Calculate OWN motion (Differential from snapshot time to current time)
    let ownAxis: Vector3 = { x: 0, y: 1, z: 0 };
    let ownAngle = 0;

    if (activeKF && activeKF.eulerPole && activeKF.eulerPole.rate !== 0) {
        ownAxis = latLonToVector(activeKF.eulerPole.position);
        const duration = time - activeKF.time;
        // rate is usually deg/Ma. time is Ma.
        ownAngle = (activeKF.eulerPole.rate * duration) * (Math.PI / 180);
    }

    const applyRotation = (coord: Coordinate): Coordinate => {
        let v = latLonToVector(coord);

        // 1. Apply Parent Transform (Global Drift)
        for (const segment of parentTransform) {
            v = rotateVector(v, segment.axis, segment.angle);
        }

        // 2. Apply Own Motion (Local Rotation)
        if (ownAngle !== 0) {
            v = rotateVector(v, ownAxis, ownAngle);
        }

        return vectorToLatLon(v);
    };

    return sourcePolys.map(poly => ({
        ...poly,
        points: poly.points.map(p => applyRotation(p))
    }));
}

function applyTransformToFeatures(plate: TectonicPlate, time: number, allPlates: TectonicPlate[]): import('./types').Feature[] {
    const parentTransform = getAccumulatedParentTransform(plate, time, allPlates, new Set());

    const keyframes = plate.motionKeyframes || [];
    const activeKF = keyframes.filter(kf => kf.time <= time).sort((a, b) => b.time - a.time)[0];

    // Calculate OWN motion
    let ownAxis: Vector3 = { x: 0, y: 1, z: 0 };
    let ownAngle = 0;

    if (activeKF && activeKF.eulerPole && activeKF.eulerPole.rate !== 0) {
        ownAxis = latLonToVector(activeKF.eulerPole.position);
        const duration = time - activeKF.time;
        ownAngle = (activeKF.eulerPole.rate * duration) * (Math.PI / 180);
    }

    const applyRotation = (coord: Coordinate): Coordinate => {
        let v = latLonToVector(coord);

        // 1. Apply Parent Transform
        for (const segment of parentTransform) {
            v = rotateVector(v, segment.axis, segment.angle);
        }

        // 2. Apply Own Motion
        if (ownAngle !== 0) {
            v = rotateVector(v, ownAxis, ownAngle);
        }

        return vectorToLatLon(v);
    };

    // Also include dynamic features generated after the keyframe/birth
    // (SimulationEngine does extensive merging. Here we simplify: take all features that exist on the plate object)
    // Actually, `plate.features` in state *should* contain the latest features added (like islands).
    // BUT `plate.features` usually has their *original* position (if they have `originalPosition`).
    // If we want to bake the current position, we must start from `originalPosition` and apply transform.

    return plate.features.map(f => {
        const startPos = f.originalPosition || f.position;
        const newPos = applyRotation(startPos);
        const newTrail = f.trail ? f.trail.map(p => applyRotation(p)) : undefined;
        return {
            ...f,
            position: newPos,
            originalPosition: newPos, // BAKE IT
            trail: newTrail // Bake trail too
        };
    });
}

function getSplitFeatures(
    originalFeatures: import('./types').Feature[],
    leftPolygons: Polygon[],
    rightPolygons: Polygon[],
    polylinePoints: Coordinate[],
    overallNormal: Vector3
): { leftFeatures: import('./types').Feature[], rightFeatures: import('./types').Feature[] } {
    const leftFeatures: import('./types').Feature[] = [];
    const rightFeatures: import('./types').Feature[] = [];

    // Helper: Split a trail (polyline) by the cut line
    const splitTrail = (trail: Coordinate[], cutPolyline: Coordinate[]): Coordinate[][] => {
        if (trail.length < 2) return [trail];
        const segments: Coordinate[][] = [];
        let currentSegment: Coordinate[] = [trail[0]];

        for (let i = 0; i < trail.length - 1; i++) {
            const p1 = trail[i];
            const p2 = trail[i + 1];

            // Check intersection with EACH segment of the cut line
            let intersection: Coordinate | null = null;
            // Find the CLOSEST intersection if multiple (simplified: just first found for now)
            for (let j = 0; j < cutPolyline.length - 1; j++) {
                const c1 = cutPolyline[j];
                const c2 = cutPolyline[j + 1];
                const hit = findSegmentIntersection(p1, p2, c1, c2);
                if (hit) {
                    intersection = hit;
                    break;
                }
            }

            if (intersection) {
                currentSegment.push(intersection);
                segments.push(currentSegment);
                currentSegment = [intersection];
            }

            currentSegment.push(p2);
        }
        segments.push(currentSegment);
        return segments;
    };

    for (const feat of originalFeatures) {
        if (feat.type === 'rift') continue;

        // --- POLYLINE / GRID LINE HANDLING ---
        if (feat.trail && feat.trail.length >= 2) {
            const subTrails = splitTrail(feat.trail, polylinePoints);

            for (const sub of subTrails) {
                if (sub.length < 2) continue;

                // Test midpoint
                const midIdx = Math.floor(sub.length / 2);
                const testPoint = sub[midIdx];

                const inLeft = leftPolygons.some(poly => isPointInPolygon(testPoint, poly.points));
                const inRight = rightPolygons.some(poly => isPointInPolygon(testPoint, poly.points));

                const newFeat = {
                    ...feat,
                    id: generateId(), // New ID for split segment
                    trail: sub,
                    position: sub[0], // Update anchor to start of segment
                    originalPosition: sub[0]
                };

                if (inLeft) leftFeatures.push(newFeat);
                else if (inRight) rightFeatures.push(newFeat);
                else {
                    // Fallback
                    const v = latLonToVector(testPoint);
                    if (dot(v, overallNormal) > 0) leftFeatures.push(newFeat);
                    else rightFeatures.push(newFeat);
                }
            }
            continue;
        }

        // --- STANDARD POINT FEATURE LOGIC ---
        const inLeft = leftPolygons.some(poly => isPointInPolygon(feat.position, poly.points));
        const inRight = rightPolygons.some(poly => isPointInPolygon(feat.position, poly.points));

        if (inLeft && !inRight) {
            leftFeatures.push(feat);
        } else if (inRight && !inLeft) {
            rightFeatures.push(feat);
        } else if (inLeft && inRight) {
            // Edge case
            const v = latLonToVector(feat.position);
            if (dot(v, overallNormal) > 0) leftFeatures.push(feat);
            else rightFeatures.push(feat);
        } else {
            // Not in either
            const v = latLonToVector(feat.position);
            if (dot(v, overallNormal) > 0) leftFeatures.push(feat);
            else rightFeatures.push(feat);
        }
    }

    return { leftFeatures, rightFeatures };
}

export function splitPlate(
    state: AppState,
    plateId: string,
    splitLine: SplitLine | SplitPolyline,
    inheritMomentum: boolean = false,
    onlySelected: boolean = false
): AppState {
    let currentState = state;
    const currentTime = state.world.currentTime;

    // --- 0. PRE-PROCESS CONNECTED RIFTS (L-Shaped Junction Logic) ---
    // When the split line intersects a connected rift:
    // - The ORIGINAL rift stays unchanged (needed by the OTHER plate not being split).
    // - 2 NEW L-shaped rifts are created from: (arm of original rift) + (segment of split line).
    // - The plate being split is DISCONNECTED from the original rift and connected to its L-rift.

    interface LRiftResult {
        leftLRiftId: string;
        rightLRiftId: string;
        leftLRift: TectonicPlate;
        rightLRift: TectonicPlate;
        originalRiftId: string;
    }
    const lRiftResults: LRiftResult[] = [];

    if (!onlySelected) {
        const plateToCheck = currentState.world.plates.find(p => p.id === plateId);

        // Convert split line to polyline format early for intersection checks
        const splitPolyline: Coordinate[] = 'points' in splitLine
            ? splitLine.points
            : [splitLine.start, splitLine.end];

        if (plateToCheck && plateToCheck.connectedRiftIds && plateToCheck.connectedRiftIds.length > 0 && splitPolyline.length >= 2) {
            const riftsToCheck = plateToCheck.connectedRiftIds
                .map(id => currentState.world.plates.find(p => p.id === id))
                .filter((r): r is TectonicPlate => !!r && r.type === 'rift' && (r.deathTime === null || r.deathTime > currentTime));

            for (const rift of riftsToCheck) {
                // Get the rift's polyline (first polygon's points, which is an open polyline)
                if (!rift.polygons || rift.polygons.length === 0 || rift.polygons[0].points.length < 2) continue;
                const riftPolyline = rift.polygons[0].points;

                // Find intersection between split line and rift polyline
                let intersectionPoint: Coordinate | null = null;
                let riftSegIdx = -1;
                let splitSegIdx = -1;

                for (let si = 0; si < splitPolyline.length - 1 && !intersectionPoint; si++) {
                    for (let ri = 0; ri < riftPolyline.length - 1; ri++) {
                        const ix = findSegmentIntersection(
                            splitPolyline[si], splitPolyline[si + 1],
                            riftPolyline[ri], riftPolyline[ri + 1]
                        );
                        if (ix) {
                            intersectionPoint = ix;
                            riftSegIdx = ri;
                            splitSegIdx = si;
                            break;
                        }
                    }
                }

                if (!intersectionPoint || riftSegIdx < 0 || splitSegIdx < 0) continue;

                // --- Split rift polyline into 2 arms at intersection ---
                // Arm A: from rift start → intersection point
                const riftArmA: Coordinate[] = [...riftPolyline.slice(0, riftSegIdx + 1), intersectionPoint];
                // Arm B: from intersection point → rift end
                const riftArmB: Coordinate[] = [intersectionPoint, ...riftPolyline.slice(riftSegIdx + 1)];

                // --- Split the SPLIT LINE into 2 segments at intersection ---
                // Segment Left: from split start → intersection point
                const splitSegLeft: Coordinate[] = [...splitPolyline.slice(0, splitSegIdx + 1), intersectionPoint];
                // Segment Right: from intersection point → split end
                const splitSegRight: Coordinate[] = [intersectionPoint, ...splitPolyline.slice(splitSegIdx + 1)];

                // --- Determine which split segment is VALID (inside the plate) ---
                // User Feedback: "Use the longer one". 
                // A split line drawn across a plate will have a long segment inside and a short segment outside (overshoot).
                // Or if drawn from outside, the long segment is the one crossing the plate.

                const getPolylineLength = (coords: Coordinate[]): number => {
                    let totalLen = 0;
                    for (let i = 0; i < coords.length - 1; i++) {
                        const v1 = latLonToVector(coords[i]);
                        const v2 = latLonToVector(coords[i + 1]);
                        // Chord length squared is faster, but we sum segments so need actual length.
                        // Chord length: |v1 - v2|
                        const dx = v1.x - v2.x;
                        const dy = v1.y - v2.y;
                        const dz = v1.z - v2.z;
                        totalLen += Math.sqrt(dx * dx + dy * dy + dz * dz);
                    }
                    return totalLen;
                };

                const lenLeft = getPolylineLength(splitSegLeft);
                const lenRight = getPolylineLength(splitSegRight);

                // Use the longer segment
                const useLeftSeg = lenLeft >= lenRight;
                let sharedSplitSeg = useLeftSeg ? splitSegLeft : splitSegRight;

                // --- TRIM "Overarching" Segment ---
                // User Feedback: "The split should also end at the end of the split plate"
                // The split segment might extend outside the plate (from Start to Plate Boundary).
                // We need to trim it so it starts at the Plate Boundary (First Tangent).

                // Identify the "Outer" point (the one far from the rift intersection)
                // Left Seg: Start -> Int. Outer is [0].
                // Right Seg: Int -> End. Outer is [length-1].
                const outerIndex = useLeftSeg ? 0 : sharedSplitSeg.length - 1;
                const outerPoint = sharedSplitSeg[outerIndex];

                // Check if Outer Point is OUTSIDE the plate
                // If it's inside, we don't trim (split started inside).
                // Note: isPointInPolygon might return false for points ON edge, but usually okay.
                const isOuterInside = plateToCheck.polygons.some(poly => isPointInPolygon(outerPoint, poly.points));

                if (!isOuterInside) {
                    // It's outside. Find intersection with Plate Boundary.
                    // We walk the segment from Intersection TOWARDS Outer Point to find the exit?
                    // Or from Outer Point TOWARDS Intersection to find entry?
                    // User said: "earliest point is the first tangent of plate and split line"
                    // So we want the point where the line ENTERS the plate.
                    // This is the intersection closest to the Outer Point that is NOT the Rift Intersection itself.

                    let bestIntersection: Coordinate | null = null;
                    let minDistToOuter = Infinity;

                    // Flatten plate polygons into edge list
                    // Warning: optimization needed if complex.
                    for (const poly of plateToCheck.polygons) {
                        for (let i = 0; i < poly.points.length; i++) {
                            const p1 = poly.points[i];
                            const p2 = poly.points[(i + 1) % poly.points.length];

                            // Check intersection with sharedSplitSeg
                            // sharedSplitSeg is a polyline.
                            for (let j = 0; j < sharedSplitSeg.length - 1; j++) {
                                const s1 = sharedSplitSeg[j];
                                const s2 = sharedSplitSeg[j + 1];

                                const hit = findSegmentIntersection(p1, p2, s1, s2);
                                if (hit) {
                                    // Ignore if hit is exactly the Rift Intersection (we are trimming the other end)
                                    // Dist to Rift Int
                                    const dRift = Math.abs(hit[0] - intersectionPoint[0]) + Math.abs(hit[1] - intersectionPoint[1]);
                                    if (dRift < 1e-6) continue;

                                    // Check distance to Outer Point
                                    const dOuter = Math.abs(hit[0] - outerPoint[0]) + Math.abs(hit[1] - outerPoint[1]);

                                    // We want the intersection CLOSEST to the Outer Point (First Tangent from outside)
                                    // Wait, if line goes Outside -> Plate -> Outside -> Plate -> Int
                                    // We want the one closest to Int? Or furthest?
                                    // "Split should end at the end of the split plate". 
                                    // We want the segment CONNECTED to the Rift Intersection.
                                    // So we want the intersection furthest from Int (closest to Outer) that is still connected to Int via Inside path?
                                    // Actually, if we assume convex-ish or simple crossing:
                                    // There is one entry point.
                                    // We want the intersection closest to Outer Point.
                                    if (dOuter < minDistToOuter) {
                                        minDistToOuter = dOuter;
                                        bestIntersection = hit;
                                    }
                                }
                            }
                        }
                    }

                    if (bestIntersection) {
                        // Trim sharedSplitSeg

                        // Find which segment index contained the intersection
                        for (let j = 0; j < sharedSplitSeg.length - 1; j++) {
                            const s1 = sharedSplitSeg[j];
                            const s2 = sharedSplitSeg[j + 1];

                            // Check if bestIntersection is on this segment via distance check
                            // Dist(start, hit) + Dist(hit, end) == Dist(start, end)
                            const d1 = Math.sqrt(Math.pow(bestIntersection[0] - s1[0], 2) + Math.pow(bestIntersection[1] - s1[1], 2));
                            const d2 = Math.sqrt(Math.pow(bestIntersection[0] - s2[0], 2) + Math.pow(bestIntersection[1] - s2[1], 2));
                            const segLen = Math.sqrt(Math.pow(s1[0] - s2[0], 2) + Math.pow(s1[1] - s2[1], 2));

                            if (Math.abs((d1 + d2) - segLen) < 1e-5) {
                                // Found the segment containing the intersection.

                                if (useLeftSeg) {
                                    // Left Seg Order: Start(0) -> ... -> End(Int).
                                    // Outer is 0. We want to discard 0..j and start from bestIntersection.
                                    // The new segment should be: [bestIntersection, ...points from j+1 to end]
                                    sharedSplitSeg = [bestIntersection, ...sharedSplitSeg.slice(j + 1)];
                                } else {
                                    // Right Seg Order: Start(Int) -> ... -> End(length-1).
                                    // Outer is End. We want to discard j+1..end and end at bestIntersection.
                                    // The new segment should be: [...points from 0 to j, bestIntersection]
                                    sharedSplitSeg = [...sharedSplitSeg.slice(0, j + 1), bestIntersection];
                                }
                                break;
                            }
                        }
                    }
                }

                // --- Construct L-Rifts using the Shared Split Segment ---

                let lRiftAPolyline: Coordinate[];
                let lRiftBPolyline: Coordinate[];

                if (useLeftSeg) {
                    // Shared Segment goes: Start -> Intersection

                    // L-Rift A: RiftArmA (Start->Int) + Shared (Start->Int reversed -> Int->Start)
                    lRiftAPolyline = [...riftArmA, ...sharedSplitSeg.slice(0, -1).reverse()];

                    // L-Rift B: RiftArmB reversed (End->Int) + Shared reversed (Int->Start)
                    // riftArmB is Int->End. We want End->Int.
                    // sharedSplitSeg is Start->Int. We want Int->Start.
                    // But sharedSplitSeg ends at Int.
                    // So: End->Int + Int->Start.
                    lRiftBPolyline = [...riftArmB.slice(1).reverse(), intersectionPoint, ...sharedSplitSeg.slice(0, -1).reverse()];
                } else {
                    // Shared Segment goes: Intersection -> End

                    // L-Rift A: RiftArmA (Start->Int) + Shared (Int->End)
                    lRiftAPolyline = [...riftArmA, ...sharedSplitSeg.slice(1)];

                    // L-Rift B: RiftArmB reversed (End->Int) + Shared (Int->End)
                    lRiftBPolyline = [...riftArmB.slice(1).reverse(), intersectionPoint, ...sharedSplitSeg.slice(1)];
                }

                // Create L-Rift plate entities
                const lRift1Id = generateId();
                const lRift2Id = generateId();

                const createLRift = (id: string, polyline: Coordinate[], suffix: string): TectonicPlate => {
                    const center = calculateSphericalCentroid(polyline);
                    return {
                        id,
                        slabId: id,
                        name: `Rift ${rift.name || 'Axis'} ${suffix}`,
                        description: `L-shaped rift from ${rift.name || 'Axis'} + split of ${plateToCheck!.name}`,
                        type: 'rift',
                        polygonType: 'oceanic_plate',
                        color: rift.color || '#FF0000',
                        zIndex: -1,
                        birthTime: currentTime,
                        deathTime: null,
                        visible: true,
                        locked: true,
                        center,
                        polygons: [{ id: generateId(), points: polyline, closed: false, riftEdgeIndices: [] }],
                        features: [{
                            id: generateId(),
                            type: 'rift',
                            position: center,
                            rotation: 0,
                            scale: 1,
                            properties: { isAxis: true, path: polyline }
                        }],
                        initialPolygons: [{ id: generateId(), points: polyline, closed: false, riftEdgeIndices: [] }],
                        initialFeatures: [],
                        motion: { eulerPole: { position: [0, 90], rate: 0, visible: false } },
                        motionKeyframes: [],
                        events: [],
                        connectedRiftIds: []
                    };
                };

                // Helper to determine if a point is "left" of a directed polyline on a sphere
                function getSideOfSplitLine(point: Coordinate, polyline: Coordinate[]): 'left' | 'right' {
                    // Find the closest segment on the polyline to the point
                    // Then use cross product to determine side
                    // Simplified: Use the first segment to define orientation near the start?
                    // Better: Iterate segments, find closest.

                    // We enforce the convention: Side is determined by the cross product of the FIRST segment of the split line.
                    // This assumes the split line doesn't self-intersect or wrap around in a way that invalidates "Left" globally for the rift endpoints.

                    for (let i = 0; i < polyline.length - 1; i++) {
                        const p1 = latLonToVector(polyline[i]);
                        const p2 = latLonToVector(polyline[i + 1]);
                        const p = latLonToVector(point);

                        // Approximate distance to great circle arc?
                        // Let's just use the segment that is "closest" in some sense.
                        // Or simpler: The split polygon logic defines Left as the side of the Normal (cross product).
                        // n = normalize(cross(p1, p2))
                        // side = dot(n, p) > 0 ? Left : Right (or vice versa depending on convention)

                        const n = normalize(cross(p1, p2));
                        const d = dot(n, p);

                        // Check if point projects onto this segment? 
                        // If the polyline is complex, simple cross product might be ambiguous.
                        // But for a split, we usually assume the point is "near" the cut.

                        // Let's rely on the first segment for consistent "Left/Right" definition if the point is far?
                        // But for L-Rifts, the point is the end of the rift arm, which intersects the split line.
                        // So the arm starts somewhere away from the split line.

                        // We need CONSISTENCY with splitPolygonWithPolyline.
                        // splitPolygonWithPolyline typically walks the cut.

                        // Let's enforce the convention: Side is determined by the cross product of the FIRST segment of the split line.
                        if (i === 0) {
                            return d > 0 ? 'left' : 'right';
                        }
                    }
                    return 'left';
                }

                let lRift1 = createLRift(lRift1Id, lRiftAPolyline, '(1)');
                let lRift2 = createLRift(lRift2Id, lRiftBPolyline, '(2)');

                // --- Determine which L-Rift is Left/Right relative to the SPLIT LINE ---
                // Check the start point of each L-Rift's "arm" (which is the far end from the intersection)
                // lRiftA arm starts at riftArmA[0]
                // lRiftB arm starts at riftArmB[riftArmB.length-1] (since we reversed it for polyline construction, wait)
                // riftArmB was: Intersection -> End. 
                // lRiftBPolyline is: End -> Intersection -> Split.
                // So lRiftBPolyline[0] is the far end of the rift arm B.

                const p1 = lRiftAPolyline[0];
                const p2 = lRiftBPolyline[0];

                const side1 = getSideOfSplitLine(p1, splitPolyline);
                const side2 = getSideOfSplitLine(p2, splitPolyline);

                // Assign Left/Right based on calculated side
                let leftLRiftId: string, rightLRiftId: string;
                let leftLRift: TectonicPlate, rightLRift: TectonicPlate;

                if (side1 === 'left') {
                    leftLRift = lRift1; leftLRiftId = lRift1Id;
                    rightLRift = lRift2; rightLRiftId = lRift2Id;
                } else {
                    leftLRift = lRift2; leftLRiftId = lRift2Id;
                    rightLRift = lRift1; rightLRiftId = lRift1Id;

                    if (side1 === side2) {
                        // Fallback logic
                        leftLRift = lRift2; leftLRiftId = lRift2Id;
                    }
                }

                // Rename for clarity
                leftLRift.name = leftLRift.name.replace('(1)', '(L)').replace('(2)', '(L)');
                rightLRift.name = rightLRift.name.replace('(1)', '(R)').replace('(2)', '(R)');

                lRiftResults.push({
                    leftLRiftId,
                    rightLRiftId,
                    leftLRift,
                    rightLRift,
                    originalRiftId: rift.id
                });

                // Add the new L-rifts to state and DISCONNECT the plate being split from the original rift
                currentState = {
                    ...currentState,
                    world: {
                        ...currentState.world,
                        plates: [
                            ...currentState.world.plates.map(p => {
                                if (p.id === plateId) {
                                    // Remove original rift, add L-rift IDs
                                    const newIds = (p.connectedRiftIds || []).filter(id => id !== rift.id);
                                    newIds.push(leftLRiftId, rightLRiftId);
                                    return { ...p, connectedRiftIds: newIds };
                                }
                                return p;
                            }),
                            leftLRift,
                            rightLRift
                        ]
                    }
                };
            }
        }
    }

    const plateToSplit = currentState.world.plates.find(p => p.id === plateId);
    if (!plateToSplit) return currentState;

    // Convert to polyline format
    const polylinePoints: Coordinate[] = 'points' in splitLine
        ? splitLine.points
        : [splitLine.start, splitLine.end];

    if (polylinePoints.length < 2) return currentState;

    // Calculate overall normal for feature assignment (approximate)
    let overallNormal = { x: 0, y: 0, z: 0 };
    if (polylinePoints.length >= 2) {
        const vS = latLonToVector(polylinePoints[0]);
        const vE = latLonToVector(polylinePoints[polylinePoints.length - 1]);
        overallNormal = normalize(cross(vS, vE));
    }

    const leftPolygons: Polygon[] = [];
    const rightPolygons: Polygon[] = [];
    const allCutPaths: Coordinate[][] = [];

    // Helper to calculate centroid and side based on NEAREST polyline segment
    const getSide = (polys: Polygon[]): 'left' | 'right' => {
        if (polys.length === 0 || polys[0].points.length === 0) return 'left';

        const c = calculateSphericalCentroid(polys[0].points);
        const vC = latLonToVector(c);

        let minDist = Infinity;
        let nearestNormal = overallNormal;

        // Find nearest segment
        for (let i = 0; i < polylinePoints.length - 1; i++) {
            const A = latLonToVector(polylinePoints[i]);
            const B = latLonToVector(polylinePoints[i + 1]);

            // Approximate distance to segment
            const mid = normalize({ x: (A.x + B.x) / 2, y: (A.y + B.y) / 2, z: (A.z + B.z) / 2 });
            const dist = 1 - dot(vC, mid);

            if (dist < minDist) {
                minDist = dist;
                nearestNormal = normalize(cross(A, B));
            }
        }

        return dot(vC, nearestNormal) > 0 ? 'left' : 'right';
    };

    // --- BAKE MOTION INTO POLYGONS BEFORE SPLITTING ---
    const bakedPolygons = applyTransformToPolygons(plateToSplit, currentState.world.currentTime, currentState.world.plates);

    for (const poly of bakedPolygons) {
        // Split polygon using the polyline
        const [res1, res2] = splitPolygonWithPolyline(poly.points, polylinePoints, poly.riftEdgeIndices);

        // If a split occurred (i.e., both results are valid polygons and not identical to original)
        if (res1.points.length >= 3 && res2.points.length >= 3 &&
            !(res1.points.length === poly.points.length && res1.points.every((p, i) => p === poly.points[i]))) {

            // Determine side for res1
            const tempPoly1: Polygon = { ...poly, id: 'temp', points: res1.points };
            const side1 = getSide([tempPoly1]);

            if (side1 === 'left') {
                leftPolygons.push({
                    ...poly,
                    id: generateId(),
                    points: res1.points,
                    riftEdgeIndices: res1.riftIndices
                });
                rightPolygons.push({
                    ...poly,
                    id: generateId(),
                    points: res2.points,
                    riftEdgeIndices: res2.riftIndices
                });
            } else {
                rightPolygons.push({
                    ...poly,
                    id: generateId(),
                    points: res1.points,
                    riftEdgeIndices: res1.riftIndices
                });
                leftPolygons.push({
                    ...poly,
                    id: generateId(),
                    points: res2.points,
                    riftEdgeIndices: res2.riftIndices
                });
            }

            if (res1.cutPath) {
                allCutPaths.push(res1.cutPath);
            }
        } else {
            // If no split occurred for this polygon, assign it to one side based on centroid
            const centroid = calculateSphericalCentroid(poly.points);
            const vCentroid = latLonToVector(centroid);
            if (dot(vCentroid, overallNormal) > 0) {
                leftPolygons.push({ ...poly, id: generateId() });
            } else {
                rightPolygons.push({ ...poly, id: generateId() });
            }
        }
    }

    // Determine Rift Axis Geometry
    let riftAxisPath: Coordinate[] = [];
    if (allCutPaths.length > 0) {
        // For now, take the first one. TODO: Handle multiple segments (e.g., merge or take longest)
        riftAxisPath = allCutPaths[0];
    } else {
        riftAxisPath = polylinePoints;
    }

    // Calculate the new centers
    const leftCenter = calculateSphericalCentroid(leftPolygons.length > 0 ? leftPolygons[0].points : []);
    const rightCenter = calculateSphericalCentroid(rightPolygons.length > 0 ? rightPolygons[0].points : []);

    if (leftPolygons.length === 0 || rightPolygons.length === 0) {
        return currentState; // Split failed or was wholly on one side
    }

    const newMotion = inheritMomentum ? { ...plateToSplit.motion } : createDefaultMotion();

    // --- Create RIFT PLATE Entity (only if no L-rifts were created) ---
    const hasLRifts = lRiftResults.length > 0;
    let riftPlate: TectonicPlate | null = null;
    let riftPlateId: string | null = null;

    if (!hasLRifts) {
        riftPlateId = generateId();
        const riftPolyPoints = riftAxisPath.length >= 2 ? riftAxisPath : polylinePoints;
        const riftCenter = calculateSphericalCentroid(riftPolyPoints);

        riftPlate = {
            id: riftPlateId,
            slabId: riftPlateId,
            name: `Rift Axis ${plateToSplit.name}`,
            description: `Rift Axis formed from ${plateToSplit.name}`,
            type: 'rift',
            polygonType: 'oceanic_plate',
            color: '#FF0000',
            zIndex: -1,
            birthTime: state.world.currentTime,
            deathTime: null,
            visible: true,
            locked: true,
            center: riftCenter,
            polygons: [{ id: generateId(), points: riftPolyPoints, closed: false, riftEdgeIndices: [] }],
            features: [{
                id: generateId(),
                type: 'rift',
                position: riftCenter,
                rotation: 0,
                scale: 1,
                properties: { isAxis: true, path: riftAxisPath }
            }],
            initialPolygons: [{ id: generateId(), points: riftPolyPoints, closed: false, riftEdgeIndices: [] }],
            initialFeatures: [],
            motion: { eulerPole: { position: [0, 90], rate: 0, visible: false } },
            motionKeyframes: [],
            events: [],
            connectedRiftIds: []
        };
    }

    // --- BAKE MOTION INTO FEATURES BEFORE SPLITTING ---
    const bakedFeatures = applyTransformToFeatures(plateToSplit, currentState.world.currentTime, currentState.world.plates);

    const { leftFeatures, rightFeatures } = getSplitFeatures(
        bakedFeatures,
        leftPolygons,
        rightPolygons,
        polylinePoints,
        overallNormal
    );

    const leftPlateId = generateId();
    const rightPlateId = generateId();

    const leftKeyframe: MotionKeyframe = {
        time: currentTime,
        eulerPole: newMotion.eulerPole,
        snapshotPolygons: leftPolygons,
        snapshotFeatures: []
    };

    const rightKeyframe: MotionKeyframe = {
        time: currentTime,
        eulerPole: newMotion.eulerPole,
        snapshotPolygons: rightPolygons,
        snapshotFeatures: []
    };

    const inheritedDescription = `Split from ${plateToSplit.name}`;

    // --- Distribute Connected Rifts ---
    // For L-rift case: each plate half gets its matching L-rift.
    // For normal case: distribute based on side + add the new straight rift.
    const getDistributedRifts = (p: TectonicPlate, mySide: 'left' | 'right') => {
        if (!p.connectedRiftIds) return [];
        return p.connectedRiftIds.filter(rId => {
            // Skip L-rift IDs (handled separately below)
            if (lRiftResults.some(lr => lr.leftLRiftId === rId || lr.rightLRiftId === rId)) return false;
            // Skip the straight rift ID (handled separately)
            if (riftPlateId && rId === riftPlateId) return false;

            const rPlate = currentState.world.plates.find(rp => rp.id === rId);
            if (!rPlate) return false;
            return getSide(rPlate.polygons) === mySide;
        });
    };

    let leftRiftIds = getDistributedRifts(plateToSplit, 'left');
    let rightRiftIds = getDistributedRifts(plateToSplit, 'right');

    if (hasLRifts) {
        // Each plate half gets its corresponding L-rift
        for (const lr of lRiftResults) {
            leftRiftIds.push(lr.leftLRiftId);
            rightRiftIds.push(lr.rightLRiftId);
        }
    } else if (riftPlateId) {
        // Both halves connect to the new straight-line rift
        leftRiftIds.push(riftPlateId);
        rightRiftIds.push(riftPlateId);
    }

    const leftPlate: TectonicPlate = {
        ...plateToSplit,
        id: leftPlateId,
        name: `${plateToSplit.name} (A)`,
        description: inheritedDescription,
        polygons: leftPolygons,
        features: leftFeatures,
        motion: newMotion,
        motionKeyframes: [leftKeyframe],
        visible: true,
        locked: false,
        center: leftCenter,
        events: [],
        birthTime: currentTime,
        deathTime: null,
        parentPlateId: plateToSplit.id,
        parentPlateIds: [plateToSplit.id],
        initialPolygons: leftPolygons,
        initialFeatures: leftFeatures,
        riftGenerationMode: plateToSplit.riftGenerationMode || 'default',
        connectedRiftIds: leftRiftIds,
        connectedRiftId: riftPlateId || undefined
    };

    const rightPlate: TectonicPlate = {
        ...plateToSplit,
        id: rightPlateId,
        description: inheritedDescription,
        name: `${plateToSplit.name} (B)`,
        polygons: rightPolygons,
        features: rightFeatures,
        motion: newMotion,
        motionKeyframes: [rightKeyframe],
        visible: true,
        locked: false,
        color: plateToSplit.color,
        zIndex: plateToSplit.zIndex,
        center: rightCenter,
        events: [],
        birthTime: currentTime,
        deathTime: null,
        parentPlateId: plateToSplit.id,
        parentPlateIds: [plateToSplit.id],
        initialPolygons: rightPolygons,
        initialFeatures: rightFeatures,
        riftGenerationMode: plateToSplit.riftGenerationMode || 'default',
        connectedRiftIds: rightRiftIds,
        connectedRiftId: riftPlateId || undefined
    };

    // --- RECURSIVE SPLIT OF CHILD PLATES (Oceanic Strips) ---
    const processedChildren: TectonicPlate[] = [];
    const children = onlySelected ? [] : currentState.world.plates.filter(p =>
        p.linkedToPlateId === plateId &&
        (p.deathTime === null || p.deathTime > currentTime)
    );
    const originalChildIds = new Set(children.map(c => c.id));

    for (const child of children) {
        // BAKE MOTION INTO CHILD POLYGONS
        const bakedChildPolygons = applyTransformToPolygons(child, currentTime, currentState.world.plates);

        // BAKE MOTION INTO CHILD FEATURES
        const bakedChildFeatures = applyTransformToFeatures(child, currentTime, currentState.world.plates);

        let childLeftPolys: Polygon[] = [];
        let childRightPolys: Polygon[] = [];
        let wasSplit = false;

        for (const poly of bakedChildPolygons) {
            const [res1, res2] = splitPolygonWithPolyline(poly.points, polylinePoints, poly.riftEdgeIndices);

            const validSplit = res1.points.length >= 3 && res2.points.length >= 3 &&
                !(res1.points.length === poly.points.length && res1.points.every((p, i) => p === poly.points[i]));

            if (validSplit) {
                wasSplit = true;
                // Determine which side res1 is on
                const tempPoly1: Polygon = { ...poly, points: res1.points, id: 'temp' };
                const side1 = getSide([tempPoly1]);
                if (side1 === 'left') {
                    childLeftPolys.push({ ...poly, id: generateId(), points: res1.points, riftEdgeIndices: res1.riftIndices });
                    childRightPolys.push({ ...poly, id: generateId(), points: res2.points, riftEdgeIndices: res2.riftIndices });
                } else {
                    // res1 is Right, res2 is Left
                    childRightPolys.push({ ...poly, id: generateId(), points: res1.points, riftEdgeIndices: res1.riftIndices });
                    childLeftPolys.push({ ...poly, id: generateId(), points: res2.points, riftEdgeIndices: res2.riftIndices });
                }
            } else {
                const side = getSide([poly]);
                if (side === 'left') childLeftPolys.push({ ...poly, id: generateId() });
                else childRightPolys.push({ ...poly, id: generateId() });
            }
        }

        // --- SPLIT FEATURES for Child Plate ---
        const { leftFeatures: childLeftFeatures, rightFeatures: childRightFeatures } = getSplitFeatures(
            bakedChildFeatures,
            childLeftPolys,
            childRightPolys,
            polylinePoints,
            overallNormal
        );

        if (wasSplit) {
            // Filter rift connections for split children too
            const childLeftRifts = getDistributedRifts(child, 'left');
            const childRightRifts = getDistributedRifts(child, 'right');

            if (childLeftPolys.length > 0) {
                processedChildren.push({
                    ...child,
                    id: generateId(),
                    name: `${child.name} (A)`,
                    polygons: childLeftPolys,
                    initialPolygons: childLeftPolys,
                    features: childLeftFeatures,
                    initialFeatures: childLeftFeatures,
                    center: calculateSphericalCentroid(childLeftPolys[0].points),
                    linkedToPlateId: leftPlateId,
                    birthTime: currentTime,
                    parentPlateId: child.id,
                    motionKeyframes: [],
                    connectedRiftIds: childLeftRifts // Correctly assigned
                });
            }
            if (childRightPolys.length > 0) {
                processedChildren.push({
                    ...child,
                    id: generateId(),
                    name: `${child.name} (B)`,
                    polygons: childRightPolys,
                    initialPolygons: childRightPolys,
                    features: childRightFeatures,
                    initialFeatures: childRightFeatures,
                    center: calculateSphericalCentroid(childRightPolys[0].points),
                    linkedToPlateId: rightPlateId,
                    birthTime: currentTime,
                    parentPlateId: child.id,
                    motionKeyframes: [],
                    connectedRiftIds: childRightRifts // Correctly assigned
                });
            }
        } else {
            // Wholly on one side - Clone and re-link
            // Determine side based on ALL polygons (should all be on one side if !wasSplit, but check to be sure)
            const allPolys = childLeftPolys.concat(childRightPolys);
            if (allPolys.length > 0) {
                const side = getSide(allPolys);
                const newParentId = side === 'left' ? leftPlateId : rightPlateId;
                const childRifts = getDistributedRifts(child, side);

                // Note: Even if not split, we typically "re-birth" the child to update its linkage?
                // Or we could just update the parent link?
                // TectoLite split logic typically re-creates the child with a new ID to avoid mutation issues.
                // However, `initialPolygons` must be updated to the BAKED positions if we do this, 
                // OR we keep original polygons if we want to preserve relative motion?
                // `applyTransformToPolygons` bakes the motion.
                // If we create a new plate with baked polygons, we must ensure `motion` is reset or capable of handling it.
                // The new child will inherit the *new parent's* motion via `linkedToPlateId`.
                // So its own motion should be identity? Or empty?
                // `child` has `motion` and `motionKeyframes`.
                // If we bake, we effectively apply the history.
                // So we should zero out its motion or keep it as is?
                // Usually oceanic crust is locked to parent.

                const newFeatures = childLeftFeatures.concat(childRightFeatures);

                processedChildren.push({
                    ...child,
                    id: generateId(),
                    birthTime: currentTime,
                    initialPolygons: allPolys,
                    polygons: allPolys,
                    initialFeatures: newFeatures,
                    features: newFeatures,
                    motionKeyframes: [],
                    linkedToPlateId: newParentId,
                    connectedRiftIds: childRifts,
                    // If it was oceanic, it likely had no independent motion (locked=true).
                    // If it had independent motion, baking it effectively "applies" it up to now.
                });
            }
        }
    }

    const newPlates: TectonicPlate[] = [
        ...(riftPlate ? [riftPlate] : []),
        leftPlate,
        rightPlate,
        ...processedChildren
    ];

    // Update World State
    return {
        ...currentState,
        world: {
            ...currentState.world,
            plates: [
                // Mark old plate and old children as dead
                ...currentState.world.plates.map(p => {
                    if (p.id === plateId || originalChildIds.has(p.id)) {
                        return { ...p, deathTime: currentTime };
                    }
                    return p;
                }),

                // Add new plates
                ...newPlates
            ],
            selectedPlateId: rightPlate.id // Select one of the new plates
        }
    };
}
