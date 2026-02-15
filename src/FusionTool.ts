import { AppState, TectonicPlate, Feature, Polygon, Coordinate, generateId, MotionKeyframe } from './types';
import { calculateSphericalCentroid, latLonToVector, vectorToLatLon, rotateVector, cross, dot, normalize } from './utils/sphericalMath';
import polygonClipping from 'polygon-clipping';
import { mixColors } from './utils/colorUtils';

interface FuseResult {
    success: boolean;
    error?: string;
    newState?: AppState;
}

/**
 * Merge polygons from two plates using proper polygon union.
 * Uses a temporary coordinate rotation to move the plates to the equator
 * for robust planar clipping that avoids pole and antimeridian issues.
 */
function mergePolygons(plate1: TectonicPlate, plate2: TectonicPlate): Polygon[] {
    const allPoints = [...plate1.polygons.flatMap(p => p.points), ...plate2.polygons.flatMap(p => p.points)];
    const collectiveCentroid = calculateSphericalCentroid(allPoints);

    // Calculate rotation to Eq/Prime (lon=0, lat=0 -> vector [1, 0, 0])
    const vCentroid = latLonToVector(collectiveCentroid);
    const vTarget = { x: 1, y: 0, z: 0 };

    // Axis = centroid cross target
    let axis = cross(vCentroid, vTarget);
    let angle = Math.acos(Math.min(1, Math.max(-1, dot(vCentroid, vTarget))));

    const needsRotation = angle > 0.001;
    if (needsRotation) {
        axis = normalize(axis);
        // If axis is zero (antipodal or same), use any perpendicular axis
        if (axis.x === 0 && axis.y === 0 && axis.z === 0) {
            axis = { x: 0, z: 1, y: 0 };
        }
    }

    const rotateToSafe = (p: Coordinate): [number, number] => {
        if (!needsRotation) return [p[0], p[1]];
        const v = latLonToVector(p);
        const rotated = rotateVector(v, axis, angle);
        const lonLat = vectorToLatLon(rotated);
        return [lonLat[0], lonLat[1]];
    };

    const rotateFromSafe = (p: [number, number]): Coordinate => {
        if (!needsRotation) return [p[0], p[1]] as Coordinate;
        const v = latLonToVector([p[0], p[1]]);
        const derotated = rotateVector(v, axis, -angle);
        return vectorToLatLon(derotated);
    };

    const toRing = (points: Coordinate[]): [number, number][] => {
        const ring = points.map(rotateToSafe);
        ring.push(ring[0]);
        return ring;
    };

    const polys1: [number, number][][] = plate1.polygons.map(p => toRing(p.points));
    const polys2: [number, number][][] = plate2.polygons.map(p => toRing(p.points));

    try {
        const result = polygonClipping.union(polys1 as any, polys2 as any);

        const merged: Polygon[] = [];
        for (const multiPoly of result) {
            for (const ring of multiPoly) {
                const points: Coordinate[] = ring.slice(0, -1).map(pt => rotateFromSafe(pt));
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
 * Fuse two plates into one
 */
export function fusePlates(
    state: AppState,
    plate1Id: string,
    plate2Id: string
): FuseResult {
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

    // Combine features from both plates
    const combinedFeatures: Feature[] = [
        ...plate1.features,
        ...plate2.features
    ];

    // Mix Colors
    const mixedColor = mixColors(plate1.color, plate2.color);

    // Concatenate Descriptions
    const desc1 = plate1.description || "";
    const desc2 = plate2.description || "";
    const combinedDesc = desc1 && desc2 ? `${desc1} + ${desc2}` : (desc1 || desc2);

    // Inherit Z-Index (max or primary?)
    // Let's take the higher z-index to ensure it sits on top of whatever was below it?
    // Or just primary. Let's start with max to avoid z-fighting with other layers.
    const zIndex = Math.max(plate1.zIndex || 0, plate2.zIndex || 0);

    // Calculate new center
    const allPoints = mergedPolygons.flatMap(p => p.points);
    const newCenter = calculateSphericalCentroid(allPoints);

    const initialKeyframe: MotionKeyframe = {
        time: currentTime,
        eulerPole: { ...plate1.motion.eulerPole },
        snapshotPolygons: mergedPolygons,
        snapshotFeatures: combinedFeatures
    };

    const fusedPlate: TectonicPlate = {
        id: generateId(),
        name: `${plate1.name}-${plate2.name} (Fused)`,
        color: mixedColor,
        description: combinedDesc,
        zIndex: zIndex,
        polygons: mergedPolygons,
        features: combinedFeatures,
        center: newCenter,
        motion: plate1.motion,
        motionKeyframes: [initialKeyframe],
        events: [],
        birthTime: currentTime,
        deathTime: null,
        parentPlateIds: [plate1Id, plate2Id],
        initialPolygons: mergedPolygons,
        initialFeatures: combinedFeatures,
        crustType: plate1.crustType === 'oceanic' && plate2.crustType === 'oceanic' ? 'oceanic' : 'continental',
        visible: true,
        locked: false,
        connectedRiftIds: [...new Set([...(plate1.connectedRiftIds || []), ...(plate2.connectedRiftIds || [])])]
    };

    // Mark original plates as dead at current time
    const updatedPlates = state.world.plates.map(p => {
        if (p.id === plate1Id || p.id === plate2Id) {
            return {
                ...p,
                deathTime: currentTime,
                events: [
                    ...(p.events || []),
                    {
                        id: generateId(),
                        time: currentTime,
                        type: 'fusion',
                        description: `Plate fused with ${p.id === plate1Id ? plate2.name : plate1.name}`
                    } as any
                ]
            };
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
