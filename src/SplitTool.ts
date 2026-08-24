import {
    AppState, TectonicPlate,
    Polygon,
    EdgeMeta,
    EdgeKind,
    Coordinate,
    generateId,
    EulerPole,
    RiftAxis
} from './types';
import {
    Vector3,
    latLonToVector,
    vectorToLatLon,
    cross,
    dot,
    normalize,
    calculateSphericalCentroid,
    isPointInPolygon,
} from './utils/sphericalMath';
import { derivePlateGeometry, pointPositionAt, activeEulerPole } from './motion/RotationModel';
import { isMotionLinkActiveAtTime } from './motion/LinkModel';

// Legacy interface for start/end splits
interface SplitLine {
    start: Coordinate;
    end: Coordinate;
}

// For polyline splits - array of points
interface SplitPolyline {
    points: Coordinate[];
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

    // Deduplicate vertex-coincident crossings: when the cut polyline starts or ends exactly at a
    // polygon vertex, both incident edges register a crossing at the same point. This causes a
    // duplicate vertex in the output polygon (polyA[0] == polyA[1]) and an off-by-one error in
    // originalEdgeMap that mis-assigns existing rift edgeMeta to the wrong child edge.
    // Fix: when two crossings share the same polylineIdx and the same geographic point, keep only
    // the one where crossing.point â‰ˆ polygonPoints[crossing.index] (the point is the START of that
    // edge), so that `idx = crossing.index + 1` correctly skips past the shared vertex.
    const vCoincident = (a: Coordinate, b: Coordinate) => {
        const va = latLonToVector(a), vb = latLonToVector(b);
        return va.x * vb.x + va.y * vb.y + va.z * vb.z > 1 - 1e-8;
    };
    const deduped: typeof crossings = [];
    for (const c of crossings) {
        const di = deduped.findIndex(d => d.polylineIdx === c.polylineIdx && vCoincident(d.point, c.point));
        if (di !== -1) {
            // Keep the crossing where the point is at the START of its polygon edge (not the end).
            // That way, idx = index+1 starts iteration at the next distinct vertex.
            const cAtStart = vCoincident(c.point, polygonPoints[c.index]);
            if (cAtStart) deduped[di] = c;
        } else {
            deduped.push(c);
        }
    }
    const dedupedCrossings = deduped.length >= 2 ? deduped : crossings;

    const firstCrossing = dedupedCrossings[0], secondCrossing = dedupedCrossings[dedupedCrossings.length - 1];

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
// --- Motion baking (keyframe-less model) ---
// Children are born with the parent's CURRENT visual geometry as their birth
// stage, so the split position must be derived at the split time. Both helpers
// now delegate to the rotation model instead of duplicating SimulationEngine math.

function applyTransformToPolygons(plate: TectonicPlate, time: number, allPlates: TectonicPlate[]): Polygon[] {
    return derivePlateGeometry(plate, allPlates, time).polygons;
}

function applyTransformToFeatures(plate: TectonicPlate, time: number, allPlates: TectonicPlate[]): import('./types').Feature[] {
    // Each feature is anchored at its own placement time (legacy code anchored
    // everything at plate birth, which mis-placed features added mid-history).
    return plate.features.map(f => {
        const startPos = f.originalPosition || f.position;
        const anchor = f.generatedAt ?? plate.birthTime;
        const newPos = pointPositionAt(plate, allPlates, startPos, anchor, time);
        return {
            ...f,
            position: newPos,
            originalPosition: newPos // BAKE IT: children re-anchor at the split time
        };
    });
}

function getSplitFeatures(
    originalFeatures: import('./types').Feature[],
    leftPolygons: Polygon[],
    rightPolygons: Polygon[],
    _polylinePoints: Coordinate[], // kept for call-site stability; only used by the removed polyline path
    overallNormal: Vector3
): { leftFeatures: import('./types').Feature[], rightFeatures: import('./types').Feature[] } {
    const leftFeatures: import('./types').Feature[] = [];
    const rightFeatures: import('./types').Feature[] = [];

    // (dead `if (false)` polyline-splitting block and its splitTrail helper removed)

    for (const feat of originalFeatures) {
        if (feat.type === 'rift') continue;

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
): { metaA: EdgeMeta[], metaB: EdgeMeta[], groupId: string } {
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
                type: 'rift' as EdgeKind,
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
                type: 'rift' as EdgeKind,
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

    return { metaA, metaB, groupId };
}

export interface SplitPlateOptions {
    inheritMomentum?: boolean;
    onlySelected?: boolean;
    resultNames?: [string | undefined, string | undefined];
}

export function splitPlate(
    state: AppState,
    plateId: string,
    splitLine: SplitLine | SplitPolyline,
    options: SplitPlateOptions = {}
): AppState {
    const inheritMomentum = options.inheritMomentum ?? false;
    const onlySelected = options.onlySelected ?? false;
    const leftPlateId = generateId();
    const rightPlateId = generateId();
    const currentState = state;
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
    const newRiftAxes: { groupId: string; cutPath: Coordinate[] }[] = [];

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
                const { metaA, metaB, groupId } = assignSplitEdgeMeta(poly, res1, res2, leftPlateId, rightPlateId, currentTime, leftPolygons.length, rightPolygons.length);
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
                if (res1.cutPath) newRiftAxes.push({ groupId, cutPath: res1.cutPath });
            } else {
                const { metaA, metaB, groupId } = assignSplitEdgeMeta(poly, res1, res2, rightPlateId, leftPlateId, currentTime, rightPolygons.length, leftPolygons.length);
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
                if (res1.cutPath) newRiftAxes.push({ groupId, cutPath: res1.cutPath });
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

    // Inherit the parent's active pole (or default zero) for the children's
    // initial motion segment. The motion model is fresh — children do NOT
    // inherit the parent's materialized segments/stages via spread.
    const inheritedPole: EulerPole = inheritMomentum
        ? { ...activeEulerPole(plateToSplit, currentTime) }
        : { position: [0, 90], rate: 0, visible: false };

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



    const inheritedDescription = `Split from ${plateToSplit.name}`;

    // --- Distribute Connected Rifts ---
    // Link the newly formed edges as siblings.
    // For normal case: distribute based on side + add the new straight rift.





























    const leftPlate: TectonicPlate = {
        ...plateToSplit,
        id: leftPlateId,
        name: options.resultNames?.[0]?.trim() || `${plateToSplit.name} (A)`,
        description: inheritedDescription,
        polygons: leftPolygons,
        features: leftFeatures,
        // Fresh motion model — must NOT inherit the parent's materialized
        // segments/stages via the spread (stale geometry would override the split)
        motionSegments: [{ time: currentTime, eulerPole: { ...inheritedPole } }],
        geometryStages: [{ time: currentTime, polygons: leftPolygons, features: leftFeatures }],
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
        name: options.resultNames?.[1]?.trim() || `${plateToSplit.name} (B)`,
        polygons: rightPolygons,
        features: rightFeatures,
        motionSegments: [{ time: currentTime, eulerPole: { ...inheritedPole } }],
        geometryStages: [{ time: currentTime, polygons: rightPolygons, features: rightFeatures }],
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
        isMotionLinkActiveAtTime(p, currentTime, plateId) &&
        (p.deathTime === null || p.deathTime > currentTime) &&
        !p.riftAxisId  // Skip axis-derived ocean plates â€” they're ephemeral (re-derived each frame)
    );
    const originalChildIds = new Set(children.map(c => c.id));

    for (const child of children) {
        // BAKE MOTION INTO CHILD POLYGONS
        const bakedChildPolygons = applyTransformToPolygons(child, currentTime, currentState.world.plates);

        // BAKE MOTION INTO CHILD FEATURES
        const bakedChildFeatures = applyTransformToFeatures(child, currentTime, currentState.world.plates);

        const childLeftPolys: Polygon[] = [];
        const childRightPolys: Polygon[] = [];
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

                if (child.type === 'oceanic') {
                    // Oceanic strips must NOT get new rift sibling relationships on the cut edges â€”
                    // that would cause generateSiblingCrust to treat the strip halves as a new rift
                    // and generate more ocean between them. Preserve only the original edgeMeta.
                    if (side1 === 'left') {
                        childLeftPolys.push({ ...poly, id: generateId(), points: res1.points, riftEdgeIndices: res1.riftIndices, edgeMeta: poly.edgeMeta ?? [] });
                        childRightPolys.push({ ...poly, id: generateId(), points: res2.points, riftEdgeIndices: res2.riftIndices, edgeMeta: poly.edgeMeta ?? [] });
                    } else {
                        childRightPolys.push({ ...poly, id: generateId(), points: res1.points, riftEdgeIndices: res1.riftIndices, edgeMeta: poly.edgeMeta ?? [] });
                        childLeftPolys.push({ ...poly, id: generateId(), points: res2.points, riftEdgeIndices: res2.riftIndices, edgeMeta: poly.edgeMeta ?? [] });
                    }
                } else if (side1 === 'left') {
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
                    linkTime: currentTime,
                    unlinkTime: undefined,
                    birthTime: currentTime,
                    parentPlateId: child.id,
                    // Fresh motion model — linked children inherit motion from
                    // their parent via linkedToPlateId; own segments are identity.
                    motionSegments: [{ time: currentTime, eulerPole: { position: [0, 90], rate: 0, visible: false } }],
                    geometryStages: [{ time: currentTime, polygons: childLeftPolys, features: childLeftFeatures }],
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
                    linkTime: currentTime,
                    unlinkTime: undefined,
                    birthTime: currentTime,
                    parentPlateId: child.id,
                    motionSegments: [{ time: currentTime, eulerPole: { position: [0, 90], rate: 0, visible: false } }],
                    geometryStages: [{ time: currentTime, polygons: childRightPolys, features: childRightFeatures }],
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
                // If we create a new plate with baked polygons, we must ensure its motion model
                // is reset. The new child will inherit the *new parent's* motion via `linkedToPlateId`.
                // So its own segments should be identity (zero rate).
                // If we bake, we effectively apply the history.
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
                    linkedToPlateId: newParentId,
                    linkTime: currentTime,
                    unlinkTime: undefined,
                    // Fresh motion model — linked children inherit motion from
                    // their parent via linkedToPlateId; own segments are identity.
                    motionSegments: [{ time: currentTime, eulerPole: { position: [0, 90], rate: 0, visible: false } }],
                    geometryStages: [{ time: currentTime, polygons: allPolys, features: newFeatures }],

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

    // Reroute sibling pointers in OTHER plates that still reference the now-dead plateId.
    // After split, the rift edge lives on one of the new child plates; the sibling on the
    // opposite plate must be updated or generateSiblingCrust will fail to find its qPlate.
    const rerouteSiblings = (p: TectonicPlate): TectonicPlate => {
        const needsUpdate = p.polygons.some(poly =>
            poly.edgeMeta?.some(m => m.siblings?.some(s => s.siblingPlateId === plateId))
        );
        if (!needsUpdate) return p;

        return {
            ...p,
            polygons: p.polygons.map(poly => {
                if (!poly.edgeMeta?.some(m => m.siblings?.some(s => s.siblingPlateId === plateId))) return poly;
                return {
                    ...poly,
                    edgeMeta: poly.edgeMeta!.map(meta => {
                        if (!meta.siblings?.some(s => s.siblingPlateId === plateId)) return meta;
                        return {
                            ...meta,
                            siblings: meta.siblings!.map(s => {
                                if (s.siblingPlateId !== plateId) return s;
                                // Find which new plate has an active (non-frozen) rift edge for this groupId
                                const newSiblingPlate = newPlates.find(np =>
                                    np.type !== 'oceanic' &&
                                    np.polygons.some(npPoly =>
                                        npPoly.edgeMeta?.some(m2 =>
                                            m2.siblings?.some(ns => ns.groupId === s.groupId && !ns.frozen)
                                        )
                                    )
                                );
                                if (!newSiblingPlate) return s; // fallback: keep stale (deathTime guard still catches it)
                                const newPolyIdx = newSiblingPlate.polygons.findIndex(npPoly =>
                                    npPoly.edgeMeta?.some(m2 =>
                                        m2.siblings?.some(ns => ns.groupId === s.groupId && !ns.frozen)
                                    )
                                );
                                return {
                                    ...s,
                                    siblingPlateId: newSiblingPlate.id,
                                    siblingPolyIndex: Math.max(0, newPolyIdx),
                                };
                            })
                        };
                    })
                };
            })
        };
    };

    // --- CREATE RIFT AXES for the new split ---
    const createdRiftAxes: RiftAxis[] = newRiftAxes.map(({ groupId, cutPath }) => ({
        id: generateId(),
        groupId,
        plateIdA: leftPlateId,
        plateIdB: rightPlateId,
        birthPolyline: cutPath,
        birthTime: currentTime,
        state: 'active' as const,
        isochrons: [],
    }));

    // --- RE-ROUTE EXISTING RIFT AXES that reference the dying plate ---
    const existingAxes = (currentState.world.riftAxes || []);
    const reroutedAxes: RiftAxis[] = [];
    const additionalAxes: RiftAxis[] = []; // For axes that need splitting

    for (const axis of existingAxes) {
        if (axis.state === 'dead') {
            reroutedAxes.push(axis);
            continue;
        }

        const refsA = axis.plateIdA === plateId;
        const refsB = axis.plateIdB === plateId;
        if (!refsA && !refsB) {
            reroutedAxes.push(axis);
            continue;
        }

        // Find which child(ren) inherited this axis's rift edges
        const childWithEdge = (child: TectonicPlate) =>
            child.polygons.some(p => p.edgeMeta?.some(e => e.sourceId === axis.groupId && e.type === 'rift'));

        const leftHasEdge = childWithEdge(leftPlate);
        const rightHasEdge = childWithEdge(rightPlate);

        if (leftHasEdge && rightHasEdge) {
            // Split cuts ACROSS the existing rift edge â€” both children got portions.
            // Pick the child with more rift edges as the primary; reroute the axis to it.
            // Duplicating the axis with full-width birthPolyline on both copies would cause
            // geometry mismatch (full polyline paired with partial rift edges â†’ deformed rings).
            const countEdges = (plate: TectonicPlate, gId: string): number => {
                let count = 0;
                for (const poly of plate.polygons) {
                    if (poly.edgeMeta) count += poly.edgeMeta.filter(e => e.sourceId === gId && e.type === 'rift').length;
                }
                return count;
            };
            const leftCount = countEdges(leftPlate, axis.groupId);
            const rightCount = countEdges(rightPlate, axis.groupId);
            const primaryId = leftCount >= rightCount ? leftPlateId : rightPlateId;
            reroutedAxes.push({
                ...axis,
                ...(refsA ? { plateIdA: primaryId } : { plateIdB: primaryId }),
            });
        } else if (leftHasEdge) {
            reroutedAxes.push({
                ...axis,
                ...(refsA ? { plateIdA: leftPlateId } : { plateIdB: leftPlateId }),
            });
        } else if (rightHasEdge) {
            reroutedAxes.push({
                ...axis,
                ...(refsA ? { plateIdA: rightPlateId } : { plateIdB: rightPlateId }),
            });
        } else {
            // Neither child has the edge â€” mark axis dead (rift edge was lost)
            reroutedAxes.push({ ...axis, state: 'dead', deathTime: currentTime });
        }
    }

    // Update World State
    return {
        ...currentState,
        world: {
            ...currentState.world,
            plates: [
                // Mark old plate and old children as dead; reroute sibling refs in surviving plates
                ...currentState.world.plates.map(p => {
                    if (p.id === plateId || originalChildIds.has(p.id)) {
                        return { ...p, deathTime: currentTime };
                    }
                    return rerouteSiblings(p);
                }),

                // Add new plates
                ...newPlates
            ],
            riftAxes: [
                ...reroutedAxes,
                ...additionalAxes,
                ...createdRiftAxes
            ],
            selectedPlateId: rightPlate.id // Select one of the new plates
        }
    };
}
