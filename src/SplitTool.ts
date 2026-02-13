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

export function splitPlate(
    state: AppState,
    plateId: string,
    splitLine: SplitLine | SplitPolyline,
    inheritMomentum: boolean = false
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
    const allCutPaths: Coordinate[][] = [];

    for (const poly of plateToSplit.polygons) {
        // Split polygon using the polyline
        const [res1, res2] = splitPolygonWithPolyline(poly.points, polylinePoints, poly.riftEdgeIndices);

        // If a split occurred (i.e., both results are valid polygons and not identical to original)
        if (res1.points.length >= 3 && res2.points.length >= 3 &&
            !(res1.points.length === poly.points.length && res1.points.every((p, i) => p === poly.points[i]))) {
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
        // Fallback to original polyline if no cut (shouldn't happen if split was successful)
        riftAxisPath = polylinePoints;
    }

    // Calculate the new centers
    const leftCenter = calculateSphericalCentroid(leftPolygons.length > 0 ? leftPolygons[0].points : []);
    const rightCenter = calculateSphericalCentroid(rightPolygons.length > 0 ? rightPolygons[0].points : []);

    if (leftPolygons.length === 0 || rightPolygons.length === 0) {
        return state;
    }

    // Prepare Motion for children (and Rift Plate)
    // Inherit parent motion, but centered on new centroid?
    // Actually, physically, if they split, they initially share the parent's Euler pole/rate.
    // TectoLite usually keeps the same pole unless changed.
    const newMotion = inheritMomentum ? { ...plateToSplit.motion } : createDefaultMotion();

    // --- Create RIFT PLATE Entity ---
    // Instead of a Feature, we create a TectonicPlate that acts as the "Oceanic Crust" generator/recipient.
    // It starts as a thin polygon along the split line?
    // Or just empty initially? 
    // If it's empty, it's hard to visualize.
    // We'll create a very thin polygon along the split line to represent the "Rift Axis".

    // Construct a thin polygon from the polyline
    // We need to offset points slightly left and right
    // Simple approach: Use the cut points.

    const riftPlateId = generateId();



    // Use the rift axis path directly as the polygon (Line Entity)
    const riftPolyPoints = riftAxisPath.length >= 2 ? riftAxisPath : polylinePoints;

    const riftCenter = calculateSphericalCentroid(riftPolyPoints);

    const riftPlate: TectonicPlate = {
        id: riftPlateId,
        slabId: riftPlateId,
        name: `Rift Axis ${plateToSplit.name}`,
        description: `Rift Axis formed from ${plateToSplit.name}`,
        type: 'rift', // Explicit Rift Type
        crustType: 'oceanic',
        color: '#FF0000', // Red for Axis by default
        zIndex: -1,
        // active removed
        birthTime: state.world.currentTime,
        deathTime: null,
        visible: true,
        locked: false,
        center: riftCenter,
        // Use open polygon for line representation
        polygons: [{ id: generateId(), points: riftPolyPoints, closed: false, riftEdgeIndices: [] }],
        // Store the actual axis path in a feature for generation logic
        features: [{
            id: generateId(),
            type: 'rift',
            position: riftCenter,
            rotation: 0,
            scale: 1,
            properties: {
                isAxis: true,
                path: riftAxisPath // Use the actual cut path, not the drawn polyline
            }
        }],
        initialPolygons: [{ id: generateId(), points: riftPolyPoints, closed: false, riftEdgeIndices: [] }],
        initialFeatures: [],
        motion: { ...newMotion }, // Inherit parent motion physics initially
        motionKeyframes: [],
        events: []
    };

    // Assign Features based on polygon containment
    const leftFeatures = [];
    const rightFeatures = [];

    for (const feat of plateToSplit.features) {
        // Skip Rift Features (we are doing them as Plates now)
        if (feat.type === 'rift') continue;

        // Standard Point Feature Logic
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
                // Rift Feature removed.
            } else {
                rightFeatures.push(feat);
            }
        }
    }

    // Centers calculated above.

    // Generate IDs for new plates
    const leftPlateId = generateId();
    const rightPlateId = generateId();

    const currentTime = state.world.currentTime;

    // Create start/end keyframes
    // We already have newMotion.
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

    // 4. Create the two new plates
    const leftPlate: TectonicPlate = {
        ...plateToSplit,
        id: leftPlateId,
        name: `${plateToSplit.name} (A)`,
        description: inheritedDescription,
        polygons: leftPolygons,
        features: leftFeatures,
        motion: newMotion, // Use the new motion
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
        riftGenerationMode: plateToSplit.riftGenerationMode || 'default', // Inherit or default
        connectedRiftId: riftPlateId // Link to the new Rift
    };

    const rightPlate: TectonicPlate = {
        ...plateToSplit,
        id: rightPlateId, // Use pre-generated ID for landmass linking
        description: inheritedDescription,
        name: `${plateToSplit.name} (B)`,
        polygons: rightPolygons,
        features: rightFeatures,
        motion: newMotion,
        motionKeyframes: [rightKeyframe],
        visible: true,
        locked: false,
        color: plateToSplit.color, // Inherit color for B
        zIndex: plateToSplit.zIndex, // Inherit z-index
        center: rightCenter,
        events: [],
        birthTime: currentTime,
        deathTime: null,
        parentPlateId: plateToSplit.id, // Track parent for feature propagation
        parentPlateIds: [plateToSplit.id],
        initialPolygons: rightPolygons,
        initialFeatures: rightFeatures,
        riftGenerationMode: plateToSplit.riftGenerationMode || 'default', // Inherit or default
        connectedRiftId: riftPlateId // Link to the new Rift
    };

    // Mark old plate as dead
    const updatedOldPlate = {
        ...plateToSplit,
        deathTime: state.world.currentTime,
        events: [
            ...(plateToSplit.events || []),
            {
                id: generateId(),
                time: state.world.currentTime,
                type: 'split',
                description: 'Plate split into two children'
            } as any // Cast for now as PlateEvent might need specific fields
        ]
    };

    const newPlates = state.world.plates.filter(p => p.id !== plateId);
    newPlates.push(updatedOldPlate, leftPlate, rightPlate, riftPlate); // Add Rift Plate

    return {
        ...state,
        world: {
            ...state.world,
            plates: newPlates,
            selectedPlateId: leftPlate.id
        }
    };
}

