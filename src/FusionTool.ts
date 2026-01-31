// Fusion Tool - Merges two plates into one
import { AppState, TectonicPlate, Feature, Polygon, Coordinate, generateId, MotionKeyframe } from './types';
import { calculateSphericalCentroid } from './utils/sphericalMath';
import polygonClipping from 'polygon-clipping';

interface FuseResult {
    success: boolean;
    error?: string;
    newState?: AppState;
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
        parentPlateIds: [plate1Id, plate2Id],
        initialPolygons: mergedPolygons,
        initialFeatures: combinedFeatures,
        visible: true,
        locked: false
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
