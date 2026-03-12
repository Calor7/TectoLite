import {
    AppState, TectonicPlate,
    Polygon,
    EdgeMeta,
    LineType,
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
    cutEdgeIndices: number[];
    originalEdgeMap: number[];
    cutPath?: Coordinate[];
}

function splitPolygonWithPolyline(
    polygonPoints: Coordinate[],
    polylinePoints: Coordinate[],
    existingRiftIndices?: number[]
): [SplitResult, SplitResult] {
    const defaultResult: [SplitResult, SplitResult] = [
        { points: polygonPoints, riftIndices: existingRiftIndices || [], cutEdgeIndices: [], originalEdgeMap: polygonPoints.map((_,i)=>i) },
        { points: [], riftIndices: [], cutEdgeIndices: [], originalEdgeMap: [] }
    ];

    if (polylinePoints.length < 2 || polygonPoints.length < 3) return defaultResult;

    const crossings: { index: number; point: Coordinate; polylineIdx: number }[] = [];
    for (let pi = 0; pi < polylinePoints.length - 1; pi++) {
        const pStart = polylinePoints[pi];
        const pEnd = polylinePoints[pi + 1];
        for (let bi = 0; bi < polygonPoints.length; bi++) {
            const bStart = polygonPoints[bi];
            const bEnd = polygonPoints[(bi + 1) % polygonPoints.length];
            const intersection = findSegmentIntersection(pStart, pEnd, bStart, bEnd);
            if (intersection) crossings.push({ index: bi, point: intersection, polylineIdx: pi });
        }
    }

    if (crossings.length < 2) return defaultResult;
    crossings.sort((a, b) => a.polylineIdx - b.polylineIdx);
    const firstCrossing = crossings[0], secondCrossing = crossings[crossings.length - 1];

    const cutSegment: Coordinate[] = polylinePoints.slice(firstCrossing.polylineIdx + 1, secondCrossing.polylineIdx + 1);

    // POLYGON A
    const polyA: Coordinate[] = [], riftA: number[] = [], cutA: number[] = [], mapA: number[] = [];
    polyA.push(firstCrossing.point); mapA.push(firstCrossing.index); 
    let currentPolyIndex = 0;

    let idx = (firstCrossing.index + 1) % polygonPoints.length;
    if (isRiftEdge(firstCrossing.index, existingRiftIndices)) riftA.push(currentPolyIndex);

    while (idx !== (secondCrossing.index + 1) % polygonPoints.length) {
        polyA.push(polygonPoints[idx]); currentPolyIndex++; mapA.push(idx);
        if (isRiftEdge(idx, existingRiftIndices)) riftA.push(currentPolyIndex);
        idx = (idx + 1) % polygonPoints.length;
    }
    polyA.push(secondCrossing.point); currentPolyIndex++; mapA.push(secondCrossing.index);

    const cutRev = [...cutSegment].reverse();
    riftA.push(currentPolyIndex); cutA.push(currentPolyIndex);
    for (const p of cutRev) {
        polyA.push(p); currentPolyIndex++; mapA.push(-1);
        riftA.push(currentPolyIndex); cutA.push(currentPolyIndex);
    }
    riftA.push(currentPolyIndex); cutA.push(currentPolyIndex);

    // POLYGON B
    const polyB: Coordinate[] = [], riftB: number[] = [], cutB: number[] = [], mapB: number[] = [];
    polyB.push(secondCrossing.point); mapB.push(secondCrossing.index);
    let currentPolyBIndex = 0;

    if (isRiftEdge(secondCrossing.index, existingRiftIndices)) riftB.push(currentPolyBIndex);
    idx = (secondCrossing.index + 1) % polygonPoints.length;
    while (idx !== (firstCrossing.index + 1) % polygonPoints.length) {
        polyB.push(polygonPoints[idx]); currentPolyBIndex++; mapB.push(idx);
        if (isRiftEdge(idx, existingRiftIndices)) riftB.push(currentPolyBIndex);
        idx = (idx + 1) % polygonPoints.length;
    }
    polyB.push(firstCrossing.point); currentPolyBIndex++; mapB.push(firstCrossing.index);
    riftB.push(currentPolyBIndex); cutB.push(currentPolyBIndex);
    for (const p of cutSegment) {
        polyB.push(p); currentPolyBIndex++; mapB.push(-1);
        riftB.push(currentPolyBIndex); cutB.push(currentPolyBIndex);
    }
    riftB.push(currentPolyBIndex); cutB.push(currentPolyBIndex);

    const fullCutPath = [firstCrossing.point, ...cutSegment, secondCrossing.point];
    return [
        { points: polyA, riftIndices: riftA, cutEdgeIndices: cutA, originalEdgeMap: mapA, cutPath: fullCutPath },
        { points: polyB, riftIndices: riftB, cutEdgeIndices: cutB, originalEdgeMap: mapB, cutPath: fullCutPath }
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
        return {
            ...f,
            position: newPos,
            originalPosition: newPos // BAKE IT
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
        if (false) {
            const subTrails = splitTrail([], polylinePoints);

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


function assignSplitEdgeMeta(
    originalPoly: Polygon,
    resA: SplitResult,
    resB: SplitResult,
    plateIdA: string,
    plateIdB: string,
    currentTime: number,
    polyIndexA: number,
    polyIndexB: number
): { metaA: EdgeMeta[], metaB: EdgeMeta[] } {
    const groupId = generateId(); // Unique ID for this specific split cut

    const metaA: EdgeMeta[] = [];
    const metaB: EdgeMeta[] = [];

    // Map existing edges for Poly A
    for (let currentEdgIdx = 0; currentEdgIdx < resA.points.length; currentEdgIdx++) {
        const cutIdxA = resA.cutEdgeIndices.indexOf(currentEdgIdx);
        if (cutIdxA !== -1) {
            const cutIdxB = (resB.cutEdgeIndices.length - 1) - cutIdxA;
            const targetEdgIdxB = resB.cutEdgeIndices[cutIdxB];

            metaA.push({
                edgeIndex: currentEdgIdx,
                type: 'rift' as LineType,
                sourceId: groupId,
                siblings: [{
                    id: generateId(),
                    siblingPlateId: plateIdB,
                    siblingPolyIndex: polyIndexB,
                    siblingEdgeIndex: targetEdgIdxB,
                    groupId,
                    frozen: false,
                    createdAt: currentTime
                }]
            });
        } else {
            if (originalPoly.edgeMeta) {
                const origIdx = resA.originalEdgeMap[currentEdgIdx];
                if (origIdx !== -1) {
                    const existing = originalPoly.edgeMeta.find(e => e.edgeIndex === origIdx);
                    if (existing) {
                        metaA.push({
                            ...existing,
                            edgeIndex: currentEdgIdx,
                        });
                    }
                }
            }
        }
    }

    // Map existing edges for Poly B
    for (let currentEdgIdx = 0; currentEdgIdx < resB.points.length; currentEdgIdx++) {
        const cutIdxB = resB.cutEdgeIndices.indexOf(currentEdgIdx);
        if (cutIdxB !== -1) {
            const cutIdxA = (resA.cutEdgeIndices.length - 1) - cutIdxB;
            const targetEdgIdxA = resA.cutEdgeIndices[cutIdxA];

            metaB.push({
                edgeIndex: currentEdgIdx,
                type: 'rift' as LineType,
                sourceId: groupId,
                siblings: [{
                    id: generateId(),
                    siblingPlateId: plateIdA,
                    siblingPolyIndex: polyIndexA, 
                    siblingEdgeIndex: targetEdgIdxA,
                    groupId,
                    frozen: false,
                    createdAt: currentTime
                }]
            });
        } else {
            if (originalPoly.edgeMeta) {
                const origIdx = resB.originalEdgeMap[currentEdgIdx];
                if (origIdx !== -1) {
                    const existing = originalPoly.edgeMeta.find(e => e.edgeIndex === origIdx);
                    if (existing) {
                        metaB.push({
                            ...existing,
                            edgeIndex: currentEdgIdx,
                        });
                    }
                }
            }
        }
    }

    return { metaA, metaB };
}

export function splitPlate(
    state: AppState,
    plateId: string,
    splitLine: SplitLine | SplitPolyline,
    inheritMomentum: boolean = false,
    onlySelected: boolean = false
): AppState {
    const leftPlateId = generateId();
    const rightPlateId = generateId();
    let currentState = state;
    const currentTime = state.world.currentTime;

    // --- 0. PRE-PROCESS CONNECTED RIFTS (L-Shaped Junction Logic) ---
    // When the split line intersects a connected rift:
    // - The ORIGINAL rift stays unchanged (needed by the OTHER plate not being split).
    // - 2 NEW L-shaped rifts are created from: (arm of original rift) + (segment of split line).
    // - Creates a sibling link between the newly formed edges.

















































































































































































































































































































































































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
                const { metaA, metaB } = assignSplitEdgeMeta(poly, res1, res2, leftPlateId, rightPlateId, currentTime, leftPolygons.length, rightPolygons.length);
                leftPolygons.push({
                    ...poly,
                    id: generateId(),
                    points: res1.points,
                    riftEdgeIndices: res1.riftIndices,
                    edgeMeta: metaA
                });
                rightPolygons.push({
                    ...poly,
                    id: generateId(),
                    points: res2.points,
                    riftEdgeIndices: res2.riftIndices,
                    edgeMeta: metaB
                });
            } else {
                const { metaA, metaB } = assignSplitEdgeMeta(poly, res1, res2, rightPlateId, leftPlateId, currentTime, rightPolygons.length, leftPolygons.length);
                rightPolygons.push({
                    ...poly,
                    id: generateId(),
                    points: res1.points,
                    riftEdgeIndices: res1.riftIndices,
                    edgeMeta: metaA
                });
                leftPolygons.push({
                    ...poly,
                    id: generateId(),
                    points: res2.points,
                    riftEdgeIndices: res2.riftIndices,
                    edgeMeta: metaB
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








    // Calculate the new centers
    const leftCenter = calculateSphericalCentroid(leftPolygons.length > 0 ? leftPolygons[0].points : []);
    const rightCenter = calculateSphericalCentroid(rightPolygons.length > 0 ? rightPolygons[0].points : []);

    if (leftPolygons.length === 0 || rightPolygons.length === 0) {
        return currentState; // Split failed or was wholly on one side
    }

    const newMotion = inheritMomentum ? { ...plateToSplit.motion } : createDefaultMotion();

    // --- (Legacy Rift Plate Creation Removed) ---









































    // --- BAKE MOTION INTO FEATURES BEFORE SPLITTING ---
    const bakedFeatures = applyTransformToFeatures(plateToSplit, currentState.world.currentTime, currentState.world.plates);

    const { leftFeatures, rightFeatures } = getSplitFeatures(
        bakedFeatures,
        leftPolygons,
        rightPolygons,
        polylinePoints,
        overallNormal
    );



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
    // Link the newly formed edges as siblings.
    // For normal case: distribute based on side + add the new straight rift.





























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
        siblingSystem: true,


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
        siblingSystem: true,


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

        const childLeftPlateId = generateId();
        const childRightPlateId = generateId();

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
                    const { metaA, metaB } = assignSplitEdgeMeta(poly, res1, res2, childLeftPlateId, childRightPlateId, currentTime, childLeftPolys.length, childRightPolys.length);
                    childLeftPolys.push({ ...poly, id: generateId(), points: res1.points, riftEdgeIndices: res1.riftIndices, edgeMeta: metaA });
                    childRightPolys.push({ ...poly, id: generateId(), points: res2.points, riftEdgeIndices: res2.riftIndices, edgeMeta: metaB });
                } else {
                    // res1 is Right, res2 is Left
                    const { metaA, metaB } = assignSplitEdgeMeta(poly, res1, res2, childRightPlateId, childLeftPlateId, currentTime, childRightPolys.length, childLeftPolys.length);
                    childRightPolys.push({ ...poly, id: generateId(), points: res1.points, riftEdgeIndices: res1.riftIndices, edgeMeta: metaA });
                    childLeftPolys.push({ ...poly, id: generateId(), points: res2.points, riftEdgeIndices: res2.riftIndices, edgeMeta: metaB });
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



            if (childLeftPolys.length > 0) {
                processedChildren.push({
                    ...child,
                    id: childLeftPlateId,
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

                });
            }
            if (childRightPolys.length > 0) {
                processedChildren.push({
                    ...child,
                    id: childRightPlateId,
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

                });
            }
        } else {
            // Wholly on one side - Clone and re-link
            // Determine side based on ALL polygons (should all be on one side if !wasSplit, but check to be sure)
            const allPolys = childLeftPolys.concat(childRightPolys);
            if (allPolys.length > 0) {
                const side = getSide(allPolys);
                const newParentId = side === 'left' ? leftPlateId : rightPlateId;


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

                    // If it was oceanic, it likely had no independent motion (locked=true).
                    // If it had independent motion, baking it effectively "applies" it up to now.
                });
            }
        }
    }

    const newPlates: TectonicPlate[] = [

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
