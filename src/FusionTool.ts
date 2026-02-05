// Fusion Tool - Merges two plates into one
import { AppState, TectonicPlate, Feature, Polygon, Coordinate, Landmass, generateId, MotionKeyframe, CrustVertex } from './types';
import { calculateSphericalCentroid, latLonToVector, vectorToLatLon, rotateVector, cross, dot, normalize, distance } from './utils/sphericalMath';
import polygonClipping from 'polygon-clipping';
import { isPointInPolygon } from './SplitTool';
import { ElevationSystem } from './systems/ElevationSystem';

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

function sampleNearestVertex(mesh: CrustVertex[], position: Coordinate): { v: CrustVertex; dist: number } | null {
    if (mesh.length === 0) return null;
    let nearest = mesh[0];
    let minDist = distance(position, nearest.pos);

    for (let i = 1; i < mesh.length; i++) {
        const candidate = mesh[i];
        const d = distance(position, candidate.pos);
        if (d < minDist) {
            minDist = d;
            nearest = candidate;
        }
    }

    return { v: nearest, dist: minDist };
}

function mergeVertexAttributes(a: { v: CrustVertex; dist: number } | null, b: { v: CrustVertex; dist: number } | null, fallback: CrustVertex): Pick<CrustVertex, 'elevation' | 'sediment' | 'crustalThickness' | 'isOceanic'> {
    // Constants for isostasy recalculation (must match ElevationSystem)
    const MANTLE_DENSITY = 3.3;
    const CONTINENTAL_DENSITY = 2.7;
    const OCEANIC_DENSITY = 3.0;
    const REFERENCE_THICKNESS_CONT = 35;
    const REFERENCE_THICKNESS_OCEAN = 7;

    const calculateIsostasyElevation = (thickness: number, isOceanic: boolean): number => {
        const density = isOceanic ? OCEANIC_DENSITY : CONTINENTAL_DENSITY;
        const refThickness = isOceanic ? REFERENCE_THICKNESS_OCEAN : REFERENCE_THICKNESS_CONT;
        const buoyancyFactor = 1 - (density / MANTLE_DENSITY);
        const elevation = (thickness - refThickness) * buoyancyFactor * 1000;
        const baseElevation = isOceanic ? -2500 : 800;
        return baseElevation + elevation;
    };

    if (!a && !b) {
        return {
            elevation: fallback.elevation,
            sediment: fallback.sediment ?? 0,
            crustalThickness: fallback.crustalThickness,
            isOceanic: fallback.isOceanic
        };
    }

    if (!a) {
        // Use parent B's attributes directly (no modification)
        return {
            elevation: b!.v.elevation,
            sediment: b!.v.sediment ?? 0,
            crustalThickness: b!.v.crustalThickness,
            isOceanic: b!.v.isOceanic
        };
    }

    if (!b) {
        // Use parent A's attributes directly (no modification)
        return {
            elevation: a.v.elevation,
            sediment: a.v.sediment ?? 0,
            crustalThickness: a.v.crustalThickness,
            isOceanic: a.v.isOceanic
        };
    }

    // Both parents have data - blend based on proximity
    const eps = 1e-6;
    const w1 = 1 / (a.dist + eps);
    const w2 = 1 / (b.dist + eps);
    const inv = 1 / (w1 + w2);

    const t1 = a.v.crustalThickness ?? (a.v.isOceanic ? 7 : 35);
    const t2 = b.v.crustalThickness ?? (b.v.isOceanic ? 7 : 35);
    const thicknessBlend = (t1 * w1 + t2 * w2) * inv;
    const sedimentBlend = ((a.v.sediment ?? 0) * w1 + (b.v.sediment ?? 0) * w2) * inv;

    const bothOceanic = a.v.isOceanic && b.v.isOceanic;
    const isOceanic = bothOceanic;

    // Adjust thickness based on collision type
    // BUT do NOT add extra thickness for fusion - that's been causing the height spike!
    // The collision physics will handle uplift over time.
    // We just preserve the blended thickness from parent plates.
    let adjustedThickness = thicknessBlend;
    
    // Only add collision thickening if plates are actually colliding at fusion point
    // This is a conservative estimate - the real uplift happens via ElevationSystem over time
    // For fusion we just want to preserve existing elevation
    // NOTE: Previous implementation added +15km or +2km unconditionally causing height spikes

    // Recalculate elevation from thickness using isostasy (don't blend parent elevations)
    const elevation = calculateIsostasyElevation(adjustedThickness, isOceanic);

    return {
        elevation: elevation,
        sediment: sedimentBlend,
        crustalThickness: adjustedThickness,
        isOceanic: isOceanic
    };
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

    // Merge paint strokes - convert from each plate's local coords to world, then to fused plate's local coords
    const sortedPlates = [plate1, plate2].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));
    const mergedPaintStrokes = [];
    
    // Calculate new center first so we can convert paint to fused plate's local coordinates
    const allPoints = mergedPolygons.flatMap(p => p.points);
    const newCenter = calculateSphericalCentroid(allPoints);

    // Merge elevation mesh (if any parent has one)
    let mergedCrustMesh: CrustVertex[] | undefined;
    if ((plate1.crustMesh && plate1.crustMesh.length > 0) || (plate2.crustMesh && plate2.crustMesh.length > 0)) {
        const resolution = state.world.globalOptions.meshResolution || 150;
        const fusedCrustType = plate1.crustType === 'oceanic' && plate2.crustType === 'oceanic' ? 'oceanic' : 'continental';
        const elevationSystem = new ElevationSystem();
        const basePlate = elevationSystem.initializePlateMesh({
            ...plate1,
            polygons: mergedPolygons,
            center: newCenter,
            crustMesh: undefined,
            elevationSimulatedTime: undefined,
            crustType: fusedCrustType
        }, resolution);

        if (basePlate.crustMesh && basePlate.crustMesh.length > 0) {
            const mesh1 = plate1.crustMesh || [];
            const mesh2 = plate2.crustMesh || [];
            mergedCrustMesh = basePlate.crustMesh.map(v => {
                const a = mesh1.length ? sampleNearestVertex(mesh1, v.pos) : null;
                const b = mesh2.length ? sampleNearestVertex(mesh2, v.pos) : null;
                const attrs = mergeVertexAttributes(a, b, v);
                return {
                    ...v,
                    elevation: attrs.elevation,
                    sediment: attrs.sediment,
                    crustalThickness: attrs.crustalThickness,
                    isOceanic: attrs.isOceanic
                };
            });
        }
    }
    
    for (const plate of sortedPlates) {
        if (plate.paintStrokes) {
            for (const stroke of plate.paintStrokes) {
                const { id, points, ...strokeMeta } = stroke;
                // Paint points are stored as World Coordinates (handled by SimulationEngine)
                const worldPoints = [...points];
                
                // Keep all points from both plates - visual clipping in CanvasManager handles interior display.
                // We reset birthTime to prevent legacy rotation compounding from 0 Ma.
                
                mergedPaintStrokes.push({
                    ...strokeMeta,
                    points: worldPoints,
                    originalPoints: worldPoints,
                    birthTime: currentTime,
                    id: generateId()
                });
            }
        }
    }

    // Generate ID for the new fused plate early to allow linking
    const fusedPlateId = generateId();

    // Transfer Landmasses from both plates (keep separate, don't merge)
    const mergedLandmasses: Landmass[] = [];
    for (const plate of sortedPlates) {
        if (plate.landmasses) {
            for (const landmass of plate.landmasses) {
                // Transfer landmass to the new fused plate with updated context
                mergedLandmasses.push({
                    ...landmass,
                    id: generateId(),
                    originalPolygon: landmass.polygon, // Reset original for the new plate
                    birthTime: currentTime,            // Reset birth time to prevent double-rotation
                    // Update link if it was linked to either of the parent plates
                    linkedToPlateId: (landmass.linkedToPlateId === plate1.id || landmass.linkedToPlateId === plate2.id) 
                        ? fusedPlateId 
                        : landmass.linkedToPlateId
                });
            }
        }
    }

    // Create initial keyframe for merged plate
    const initialKeyframe: MotionKeyframe = {
        time: currentTime,
        eulerPole: { ...plate1.motion.eulerPole },
        snapshotPolygons: mergedPolygons,
        snapshotFeatures: combinedFeatures,
        snapshotLandmasses: mergedLandmasses.length > 0 ? mergedLandmasses : undefined
    };

    // Create the new fused plate
    const fusedPlate: TectonicPlate = {
        id: fusedPlateId,
        name: `${plate1.name}-${plate2.name} (Fused)`,
        color: plate1.color,
        polygons: mergedPolygons,
        features: combinedFeatures,
        paintStrokes: mergedPaintStrokes,
        landmasses: mergedLandmasses.length > 0 ? mergedLandmasses : undefined,
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
        crustMesh: mergedCrustMesh && mergedCrustMesh.length > 0 ? mergedCrustMesh : undefined,
        elevationSimulatedTime: mergedCrustMesh && mergedCrustMesh.length > 0 ? currentTime : undefined,
        visible: true,
        locked: false
    };

    // Mark original plates as dead at current time and CLEAR their meshes
    // This prevents any lingering interaction between old meshes and new fused plate
    const updatedPlates = state.world.plates.map(p => {
        if (p.id === plate1Id || p.id === plate2Id) {
            return {
                ...p,
                deathTime: currentTime,
                crustMesh: undefined, // Clear mesh to prevent ghost interactions
                elevationSimulatedTime: undefined,
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
