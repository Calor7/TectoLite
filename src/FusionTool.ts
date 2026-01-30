// Fusion Tool - Merges two plates into one
import { AppState, TectonicPlate, Feature, Polygon, Coordinate, generateId, MotionKeyframe } from './types';
import { calculateSphericalCentroid } from './utils/sphericalMath';
import polygonClipping from 'polygon-clipping';

interface FuseResult {
    success: boolean;
    error?: string;
    newState?: AppState;
}

interface FuseOptions {
    addWeaknessFeatures: boolean;
    addMountains?: boolean;
    weaknessInterval: number; // degrees between weakness features
}

const DEFAULT_OPTIONS: FuseOptions = {
    addWeaknessFeatures: true,
    weaknessInterval: 1 // degrees (1 feature per degree)
};

/**
 * Find points along the fusion boundary (intersection of the two plate boundaries)
 * Returns an array of coordinates representing the fusion line(s)
 */
function findFusionBoundary(plate1: TectonicPlate, plate2: TectonicPlate): Coordinate[] {
    // Convert plate polygons to polygon-clipping format
    const polys1: [number, number][][] = plate1.polygons.map(p =>
        [...p.points.map(pt => [pt[0], pt[1]] as [number, number]), [p.points[0][0], p.points[0][1]] as [number, number]]
    );

    const polys2: [number, number][][] = plate2.polygons.map(p =>
        [...p.points.map(pt => [pt[0], pt[1]] as [number, number]), [p.points[0][0], p.points[0][1]] as [number, number]]
    );

    try {
        // Find intersection of the two polygons - this is the overlap area
        const intersection = polygonClipping.intersection(
            polys1 as any,
            polys2 as any
        );

        // If they overlap, the boundary of the intersection is the fusion line
        if (intersection.length > 0) {
            const boundaryPoints: Coordinate[] = [];
            for (const multiPoly of intersection) {
                for (const ring of multiPoly) {
                    for (const pt of ring) {
                        boundaryPoints.push([pt[0], pt[1]]);
                    }
                }
            }
            return boundaryPoints;
        }
    } catch (e) {
        console.warn('Intersection calculation failed', e);
    }

    // If no overlap, find the closest points between the plates
    return findClosestPointsPair(plate1, plate2);
}

/**
 * Find closest points between two plates (for non-overlapping plates)
 */
function findClosestPointsPair(plate1: TectonicPlate, plate2: TectonicPlate): Coordinate[] {
    let minDist = Infinity;
    let closestPt1: Coordinate = [0, 0];
    let closestPt2: Coordinate = [0, 0];

    for (const poly1 of plate1.polygons) {
        for (const pt1 of poly1.points) {
            for (const poly2 of plate2.polygons) {
                for (const pt2 of poly2.points) {
                    const dist = Math.hypot(pt1[0] - pt2[0], pt1[1] - pt2[1]);
                    if (dist < minDist) {
                        minDist = dist;
                        closestPt1 = pt1;
                        closestPt2 = pt2;
                    }
                }
            }
        }
    }

    // Return a line between the two closest points
    return [closestPt1, closestPt2];
}

/**
 * Create weakness features along the fusion boundary at specified intervals
 * Properly interpolates along all line segments, not just at vertices
 */
function createWeaknessFeatures(
    boundaryPoints: Coordinate[],
    interval: number,
    plate1Name: string,
    plate2Name: string,
    currentTime: number
): Feature[] {
    if (boundaryPoints.length === 0) return [];

    const features: Feature[] = [];

    if (boundaryPoints.length === 1) {
        features.push(createWeaknessFeature(boundaryPoints[0], plate1Name, plate2Name, currentTime));
        return features;
    }

    // Walk along all line segments and place features at regular intervals
    let distanceSinceLastFeature = 0;

    // Place first feature at start
    features.push(createWeaknessFeature(boundaryPoints[0], plate1Name, plate2Name, currentTime));

    for (let i = 1; i < boundaryPoints.length; i++) {
        const prevPt = boundaryPoints[i - 1];
        const currPt = boundaryPoints[i];
        const segmentLength = Math.hypot(currPt[0] - prevPt[0], currPt[1] - prevPt[1]);

        if (segmentLength === 0) continue;

        // Direction vector
        const dx = (currPt[0] - prevPt[0]) / segmentLength;
        const dy = (currPt[1] - prevPt[1]) / segmentLength;

        // Walk along this segment
        let distanceAlongSegment = interval - distanceSinceLastFeature;

        while (distanceAlongSegment <= segmentLength) {
            const pos: Coordinate = [
                prevPt[0] + dx * distanceAlongSegment,
                prevPt[1] + dy * distanceAlongSegment
            ];
            features.push(createWeaknessFeature(pos, plate1Name, plate2Name, currentTime));
            distanceAlongSegment += interval;
        }

        // Update distance since last feature
        distanceSinceLastFeature = segmentLength - (distanceAlongSegment - interval);
    }

    // Place final feature at end if not too close to last one
    const lastBoundaryPt = boundaryPoints[boundaryPoints.length - 1];
    const lastFeaturePos = features[features.length - 1].position;
    const distToLast = Math.hypot(
        lastBoundaryPt[0] - lastFeaturePos[0],
        lastBoundaryPt[1] - lastFeaturePos[1]
    );

    if (distToLast > interval * 0.3) {
        features.push(createWeaknessFeature(lastBoundaryPt, plate1Name, plate2Name, currentTime));
    }

    return features;
}

/**
 * Create a single weakness feature
 */
function createWeaknessFeature(
    position: Coordinate,
    plate1Name: string,
    plate2Name: string,
    currentTime: number
): Feature {
    return {
        id: generateId(),
        type: 'weakness',
        position,
        rotation: 0,
        scale: 1,
        properties: {
            fusedFrom: [plate1Name, plate2Name],
            fusedAt: currentTime
        }
    };
}

/**
 * Merge polygons from two plates using proper polygon union
 */
function mergePolygons(plate1: TectonicPlate, plate2: TectonicPlate): Polygon[] {
    const polys1: [number, number][][] = plate1.polygons.map(p =>
        [...p.points.map(pt => [pt[0], pt[1]] as [number, number]), [p.points[0][0], p.points[0][1]] as [number, number]]
    );

    const polys2: [number, number][][] = plate2.polygons.map(p =>
        [...p.points.map(pt => [pt[0], pt[1]] as [number, number]), [p.points[0][0], p.points[0][1]] as [number, number]]
    );

    try {
        const result = polygonClipping.union(polys1 as any, polys2 as any);

        const merged: Polygon[] = [];
        for (const multiPoly of result) {
            for (const ring of multiPoly) {
                const points: Coordinate[] = ring.slice(0, -1).map(pt => [pt[0], pt[1]] as Coordinate);
                if (points.length >= 3) {
                    merged.push({
                        id: generateId(),
                        points,
                        closed: true
                    });
                }
            }
        }

        return merged.length > 0 ? merged : fallbackMerge(plate1, plate2);
    } catch (e) {
        console.warn('Polygon union failed, using fallback', e);
        return fallbackMerge(plate1, plate2);
    }
}

function fallbackMerge(plate1: TectonicPlate, plate2: TectonicPlate): Polygon[] {
    const merged: Polygon[] = [];
    for (const poly of plate1.polygons) {
        merged.push({ id: generateId(), points: [...poly.points], closed: true });
    }
    for (const poly of plate2.polygons) {
        merged.push({ id: generateId(), points: [...poly.points], closed: true });
    }
    return merged;
}

/**
 * Fuse two plates into one, optionally creating weakness features along the fusion line
 */
export function fusePlates(
    state: AppState,
    plate1Id: string,
    plate2Id: string,
    options: Partial<FuseOptions> = {}
): FuseResult {
    const opts = { ...DEFAULT_OPTIONS, ...options };

    const plate1 = state.world.plates.find(p => p.id === plate1Id);
    const plate2 = state.world.plates.find(p => p.id === plate2Id);

    if (!plate1 || !plate2) {
        return { success: false, error: 'One or both plates not found' };
    }

    if (plate1.id === plate2.id) {
        return { success: false, error: 'Cannot fuse a plate with itself' };
    }

    const currentTime = state.world.currentTime;

    // Merge polygons using proper union
    const mergedPolygons = mergePolygons(plate1, plate2);

    // Create weakness features along fusion boundary if enabled
    let weaknessFeatures: Feature[] = [];
    if (opts.addWeaknessFeatures) {
        const fusionBoundary = findFusionBoundary(plate1, plate2);
        weaknessFeatures = createWeaknessFeatures(
            fusionBoundary,
            opts.weaknessInterval,
            plate1.name,
            plate2.name,
            currentTime
        );
    }

    let mountainFeatures: Feature[] = [];
    if (opts.addMountains) {
        // Reuse fusion boundary calculation (or calculate if not done)
        const fusionBoundary = findFusionBoundary(plate1, plate2);
        // Create mountains along the boundary
        mountainFeatures = createWeaknessFeatures(
            fusionBoundary,
            0.5, // denser for mountains
            plate1.name,
            plate2.name,
            currentTime
        ).map(f => ({
            ...f,
            type: 'mountain' as FeatureType, // Cast to avoid type error if strictly typed
            id: generateId(),
            properties: { ...f.properties, generatedBy: 'fusion' }
        }));
    }

    // Combine features from both plates
    const combinedFeatures: Feature[] = [
        ...plate1.features,
        ...plate2.features,
        ...weaknessFeatures,
        ...mountainFeatures
    ];

    // Calculate new center
    const allPoints = mergedPolygons.flatMap(p => p.points);
    const newCenter = calculateSphericalCentroid(allPoints);

    // Create initial keyframe for merged plate
    const initialKeyframe: MotionKeyframe = {
        time: currentTime,
        eulerPole: { ...plate1.motion.eulerPole },
        snapshotPolygons: mergedPolygons,
        snapshotFeatures: combinedFeatures
    };

    // Create the new fused plate
    const fusedPlate: TectonicPlate = {
        id: generateId(),
        name: `${plate1.name}-${plate2.name} (Fused)`,
        color: plate1.color,
        polygons: mergedPolygons,
        features: combinedFeatures,
        center: newCenter,
        motion: plate1.motion,
        motionKeyframes: [initialKeyframe],
        events: [],
        birthTime: currentTime,
        deathTime: null,
        initialPolygons: mergedPolygons,
        initialFeatures: combinedFeatures,
        visible: true,
        locked: false
    };

    // Mark original plates as dead at current time
    const updatedPlates = state.world.plates.map(p => {
        if (p.id === plate1Id || p.id === plate2Id) {
            return { ...p, deathTime: currentTime };
        }
        return p;
    });

    const newPlates = [...updatedPlates, fusedPlate];

    const newState: AppState = {
        ...state,
        world: {
            ...state.world,
            plates: newPlates,
            selectedPlateId: fusedPlate.id
        }
    };

    return { success: true, newState };
}
