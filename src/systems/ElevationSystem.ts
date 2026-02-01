// Elevation System - Physical mesh-based topography simulation
// Implements realistic orogeny physics: isostasy, asymmetric uplift, subduction

import { AppState, TectonicPlate, CrustVertex, Coordinate, generateId } from '../types';
import { distance } from '../utils/sphericalMath';
import { Delaunay } from 'd3-delaunay';
import { geoBounds, geoContains } from 'd3-geo';
import { toGeoJSON } from '../utils/geoHelpers';

// Physical constants
const MANTLE_DENSITY = 3.3;           // g/cm³
const CONTINENTAL_DENSITY = 2.7;      // g/cm³
const OCEANIC_DENSITY = 3.0;          // g/cm³
const REFERENCE_THICKNESS_CONT = 35;  // km - standard continental crust
const REFERENCE_THICKNESS_OCEAN = 7;  // km - standard oceanic crust
const SEA_LEVEL_OFFSET = 0;           // meters - reference datum

/**
 * Calculate minimum distance from a point to a polygon (all edges)
 * This ensures vertices along the entire boundary edge are affected, not just near vertices
 */
function distanceToPolygonEdges(point: Coordinate, polygonRings: Coordinate[][]): number {
    let minDist = Infinity;
    
    for (const ring of polygonRings) {
        if (ring.length < 2) continue;
        
        for (let i = 0; i < ring.length - 1; i++) {
            const a = ring[i];
            const b = ring[i + 1];
            const d = distanceToSegment(point, a, b);
            if (d < minDist) minDist = d;
        }
        // Close the ring
        if (ring.length > 2) {
            const d = distanceToSegment(point, ring[ring.length - 1], ring[0]);
            if (d < minDist) minDist = d;
        }
    }
    
    return minDist;
}

/**
 * Calculate distance from a point to a line segment
 */
function distanceToSegment(p: Coordinate, a: Coordinate, b: Coordinate): number {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const lengthSq = dx * dx + dy * dy;
    
    if (lengthSq === 0) {
        // Segment is a point
        return distance(p, a);
    }
    
    // Project point onto line, clamped to segment
    let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSq;
    t = Math.max(0, Math.min(1, t));
    
    const closest: Coordinate = [
        a[0] + t * dx,
        a[1] + t * dy
    ];
    
    return distance(p, closest);
}

export class ElevationSystem {
    private neighborCache: Map<string, Map<string, Set<string>>> = new Map();
    
    constructor() {}
    
    /**
     * Calculate equilibrium elevation from crustal thickness (Airy Isostasy)
     * Thicker crust floats higher on the mantle
     */
    private calculateIsostasyElevation(thickness: number, isOceanic: boolean): number {
        const density = isOceanic ? OCEANIC_DENSITY : CONTINENTAL_DENSITY;
        const refThickness = isOceanic ? REFERENCE_THICKNESS_OCEAN : REFERENCE_THICKNESS_CONT;
        
        // Isostatic equilibrium: elevation = (thickness - refThickness) * (1 - density/mantleDensity) * 1000
        const buoyancyFactor = 1 - (density / MANTLE_DENSITY);
        const elevation = (thickness - refThickness) * buoyancyFactor * 1000; // Convert km to m
        
        // Oceanic crust sits ~2.5km below sea level at reference thickness
        // Continental crust sits ~0.8km above sea level at reference thickness
        const baseElevation = isOceanic ? -2500 : 800;
        
        return baseElevation + elevation + SEA_LEVEL_OFFSET;
    }
    
    /**
     * Main update loop - runs each simulation tick
     */
    public update(state: AppState, deltaT: number): AppState {
        if (!state.world.globalOptions.enableElevationSimulation) {
            // When disabled, clear all meshes to save memory
            const hasAnyMesh = state.world.plates.some(p => p.crustMesh && p.crustMesh.length > 0);
            if (hasAnyMesh) {
                return {
                    ...state,
                    world: {
                        ...state.world,
                        plates: state.world.plates.map(plate => ({
                            ...plate,
                            crustMesh: undefined,
                            elevationSimulatedTime: undefined
                        }))
                    }
                };
            }
            return state;
        }
        
        const currentTime = state.world.currentTime;
        let newState = { ...state };
        
        // Step 1: Handle backward scrubbing - clear meshes entirely
        // They will be regenerated fresh on next forward tick with correct boundaries
        const anyNeedsClear = newState.world.plates.some(plate => {
            if (!plate.crustMesh || plate.crustMesh.length === 0) return false;
            const lastSimTime = plate.elevationSimulatedTime ?? plate.birthTime;
            return currentTime < lastSimTime;
        });
        
        if (anyNeedsClear) {
            // Clear ALL meshes on backward scrub for consistency
            // This ensures boundaries and mesh state are in sync
            newState.world.plates = newState.world.plates.map(plate => ({
                ...plate,
                crustMesh: undefined,
                elevationSimulatedTime: undefined
            }));
            this.clearAllCaches();
            return newState; // Return early - meshes will regenerate on next forward tick
        }
        
        // Step 2: Initialize meshes for plates without them (only if moving forward)
        if (deltaT > 0) {
            newState.world.plates = newState.world.plates.map(plate => {
                if (plate.visible && (!plate.crustMesh || plate.crustMesh.length === 0)) {
                    // Only create mesh if plate is born
                    if (currentTime < plate.birthTime) return plate;
                    if (plate.deathTime !== null && currentTime >= plate.deathTime) return plate;
                    
                    const resolution = state.world.globalOptions.meshResolution || 150;
                    const initializedPlate = this.initializePlateMesh(plate, resolution);
                    return {
                        ...initializedPlate,
                        elevationSimulatedTime: currentTime
                    };
                }
                return plate;
            });
        }
        // Step 3: Apply physics if moving forward
        if (deltaT > 0) {
            // Apply collision physics (asymmetric uplift, subduction)
            newState = this.applyCollisionPhysics(newState, deltaT);
            
            // Apply rifting physics (crustal thinning at divergent boundaries)
            newState = this.applyRiftingPhysics(newState, deltaT);
            
            // Apply thermal subsidence (oceanic crust deepens with age)
            newState = this.applyThermalSubsidence(newState, deltaT);
            
            // Apply erosion (slope-based, transfers sediment)
            newState = this.applyErosion(newState, deltaT);
            
            // Consolidate sediment in basins (convert to crustal thickness)
            newState = this.consolidateSediment(newState, deltaT);
            
            // Recalculate elevations from thickness (isostasy)
            newState.world.plates = newState.world.plates.map(plate => ({
                ...plate,
                crustMesh: plate.crustMesh?.map(v => ({
                    ...v,
                    elevation: this.calculateIsostasyElevation(v.crustalThickness, v.isOceanic)
                })),
                elevationSimulatedTime: currentTime
            }));
        }
        
        return newState;
    }
    
    /**
     * Initialize mesh for a plate using hex grid sampling
     */
    public initializePlateMesh(plate: TectonicPlate, resolution: number = 150): TectonicPlate {
        if (plate.polygons.length === 0) return plate;
        
        const polys = plate.polygons.map(p => toGeoJSON(p).geometry);
        const multiPoly: GeoJSON.MultiPolygon = {
            type: 'MultiPolygon',
            coordinates: polys.map(p => p.coordinates)
        };
        const feature: GeoJSON.Feature<GeoJSON.MultiPolygon> = { 
            type: 'Feature', 
            geometry: multiPoly, 
            properties: {} 
        };
        
        const [[bMinLon, bMinLat], [bMaxLon, bMaxLat]] = geoBounds(feature);
        
        const spacing = resolution / 111.0;
        const rowOffset = spacing * 0.866;
        
        const vertices: CrustVertex[] = [];
        const isOceanic = plate.crustType === 'oceanic';
        const referenceThickness = isOceanic ? REFERENCE_THICKNESS_OCEAN : REFERENCE_THICKNESS_CONT;
        const baseThickness = plate.crustalThickness !== undefined ? plate.crustalThickness : referenceThickness;
        
        // Use custom starting height if set, otherwise calculate from isostasy
        const useCustomHeight = plate.meshStartingHeight !== undefined;
        const customHeight = plate.meshStartingHeight ?? 0;
        const baseElevation = useCustomHeight ? customHeight : this.calculateIsostasyElevation(baseThickness, isOceanic);
        
        let row = 0;
        for (let lat = bMinLat; lat <= bMaxLat; lat += rowOffset) {
            const lonOffset = (row % 2) * (spacing / 2);
            const startLon = bMinLon;
            const endLon = bMinLon <= bMaxLon ? bMaxLon : bMaxLon + 360;
            
            for (let l = startLon; l <= endLon; l += spacing) {
                let lon = l + lonOffset;
                if (lon > 180) lon -= 360;
                if (lon < -180) lon += 360;
                
                const pos: Coordinate = [lon, lat];
                
                if (geoContains(feature, pos)) {
                    const elevation = baseElevation;
                    vertices.push({
                        id: generateId(),
                        pos: pos,
                        originalPos: pos,
                        elevation: elevation,
                        crustalThickness: baseThickness,
                        sediment: 0,
                        isOceanic: isOceanic
                    });
                }
            }
            row++;
        }

        // Add boundary vertices
        for (const poly of plate.polygons) {
            const minDistInfo = spacing * 0.3;
            let lastAdded: Coordinate | null = null;
            
            for (let i = 0; i < poly.points.length; i++) {
                const p = poly.points[i];
                
                if (lastAdded) {
                    const d = Math.hypot(p[0] - lastAdded[0], p[1] - lastAdded[1]);
                    if (d < minDistInfo) continue;
                }
                
                const elevation = baseElevation;
                vertices.push({
                    id: generateId(),
                    pos: p,
                    originalPos: p,
                    elevation: elevation,
                    crustalThickness: baseThickness,
                    sediment: 0,
                    isOceanic: isOceanic
                });
                lastAdded = p;
            }
        }
        
        // Limit vertices
        const maxVertices = 1000;
        if (vertices.length > maxVertices) {
            const sampled: CrustVertex[] = [];
            const step = Math.floor(vertices.length / maxVertices);
            for (let i = 0; i < vertices.length; i += step) {
                sampled.push(vertices[i]);
            }
            return { ...plate, crustMesh: sampled };
        }
        
        return { ...plate, crustMesh: vertices };
    }
    
    /**
     * Apply collision physics with realistic asymmetric behavior
     */
    private applyCollisionPhysics(state: AppState, deltaT: number): AppState {
        if (!state.world.boundaries || state.world.boundaries.length === 0) {
            return state;
        }
        
        const thickeningRate = (state.world.globalOptions.upliftRate || 1000) / 1000; // Convert m/Ma to km/Ma
        const convergentBoundaries = state.world.boundaries.filter(b => b.type === 'convergent');
        
        if (convergentBoundaries.length === 0) return state;
        
        const plates = [...state.world.plates];
        
        for (const boundary of convergentBoundaries) {
            const [id1, id2] = boundary.plateIds;
            const p1Index = plates.findIndex(p => p.id === id1);
            const p2Index = plates.findIndex(p => p.id === id2);
            
            if (p1Index === -1 || p2Index === -1) continue;
            
            const plate1 = plates[p1Index];
            const plate2 = plates[p2Index];
            
            if (!plate1.crustMesh && !plate2.crustMesh) continue;
            
            // Use boundary rings (polygon edges) for proper distance calculation
            const boundaryRings = boundary.points;
            if (!boundaryRings || boundaryRings.length === 0) continue;
            if (boundaryRings.every(ring => ring.length < 3)) continue;
            
            // Determine collision type and which plate subducts
            const collision = this.classifyCollision(plate1, plate2);
            
            // Apply appropriate physics based on collision type
            const velocity = boundary.velocity || 0.001;
            const intensityFactor = Math.min(velocity / 0.005, 1.0); // Normalize: 5 cm/yr = full intensity
            const thickeningAmount = thickeningRate * deltaT * intensityFactor;
            
            if (collision.type === 'continent-continent') {
                // Both plates thicken (bilateral orogeny - Himalayas)
                this.applyBilateralThickening(plates, p1Index, p2Index, boundaryRings, thickeningAmount);
            } else if (collision.type === 'ocean-continent' || collision.type === 'ocean-ocean') {
                // Subduction: overriding plate gets volcanic arc, subducting gets trench
                this.applySubductionPhysics(plates, p1Index, p2Index, boundaryRings, thickeningAmount, collision);
            }
        }
        
        return {
            ...state,
            world: { ...state.world, plates }
        };
    }
    
    /**
     * Classify collision type based on crust types
     */
    private classifyCollision(p1: TectonicPlate, p2: TectonicPlate): {
        type: 'continent-continent' | 'ocean-continent' | 'ocean-ocean';
        subductingPlateId: string;
        overridingPlateId: string;
    } {
        const p1Oceanic = p1.crustType === 'oceanic';
        const p2Oceanic = p2.crustType === 'oceanic';
        
        if (!p1Oceanic && !p2Oceanic) {
            // Continent-Continent: slower/smaller plate "loses" (arbitrary)
            const p1Rate = Math.abs(p1.motion.eulerPole.rate);
            const p2Rate = Math.abs(p2.motion.eulerPole.rate);
            return {
                type: 'continent-continent',
                subductingPlateId: p1Rate > p2Rate ? p1.id : p2.id,
                overridingPlateId: p1Rate > p2Rate ? p2.id : p1.id
            };
        } else if (p1Oceanic && p2Oceanic) {
            // Ocean-Ocean: older/denser plate subducts
            return {
                type: 'ocean-ocean',
                subductingPlateId: p1.birthTime < p2.birthTime ? p1.id : p2.id,
                overridingPlateId: p1.birthTime < p2.birthTime ? p2.id : p1.id
            };
        } else {
            // Ocean-Continent: ocean always subducts
            return {
                type: 'ocean-continent',
                subductingPlateId: p1Oceanic ? p1.id : p2.id,
                overridingPlateId: p1Oceanic ? p2.id : p1.id
            };
        }
    }
    
    /**
     * Apply bilateral thickening for continent-continent collisions (Himalaya model)
     */
    private applyBilateralThickening(
        plates: TectonicPlate[],
        p1Index: number,
        p2Index: number,
        boundaryRings: Coordinate[][],
        thickeningAmount: number
    ): void {
        const proximityThreshold = 5.0 / 111.0; // ~5 degrees
        
        for (const pIndex of [p1Index, p2Index]) {
            if (!plates[pIndex].crustMesh) continue;
            
            plates[pIndex] = {
                ...plates[pIndex],
                crustMesh: plates[pIndex].crustMesh!.map(vertex => {
                    // Calculate distance to boundary polygon edges (not just vertices)
                    const minDist = distanceToPolygonEdges(vertex.pos, boundaryRings);
                    
                    if (minDist < proximityThreshold) {
                        // Gaussian falloff for natural mountain profile
                        const falloff = Math.exp(-(minDist / proximityThreshold) * 2);
                        const newThickness = vertex.crustalThickness + thickeningAmount * falloff;
                        
                        // Cap at realistic maximum (~70km for Himalayas/Tibet)
                        return {
                            ...vertex,
                            crustalThickness: Math.min(newThickness, 70)
                        };
                    }
                    return vertex;
                })
            };
        }
    }
    
    /**
     * Apply subduction physics (volcanic arc on overriding, trench on subducting)
     */
    private applySubductionPhysics(
        plates: TectonicPlate[],
        p1Index: number,
        p2Index: number,
        boundaryRings: Coordinate[][],
        thickeningAmount: number,
        collision: { subductingPlateId: string; overridingPlateId: string }
    ): void {
        const trenchProximity = 1.5 / 111.0;  // ~1.5 degrees - immediate boundary
        const arcProximity = 3.0 / 111.0;     // ~3 degrees - volcanic arc zone
        const arcInnerLimit = 1.0 / 111.0;    // Inner edge of arc
        
        for (const pIndex of [p1Index, p2Index]) {
            const plate = plates[pIndex];
            if (!plate.crustMesh) continue;
            
            const isSubducting = plate.id === collision.subductingPlateId;
            
            plates[pIndex] = {
                ...plate,
                crustMesh: plate.crustMesh.map(vertex => {
                    // Calculate distance to boundary polygon edges
                    const minDist = distanceToPolygonEdges(vertex.pos, boundaryRings);
                    
                    if (isSubducting) {
                        // Subducting plate: create trench (thin the crust near boundary)
                        if (minDist < trenchProximity) {
                            const falloff = 1 - (minDist / trenchProximity);
                            const thinning = thickeningAmount * 0.5 * falloff;
                            return {
                                ...vertex,
                                crustalThickness: Math.max(vertex.crustalThickness - thinning, 5)
                            };
                        }
                    } else {
                        // Overriding plate: volcanic arc inland from boundary
                        if (minDist > arcInnerLimit && minDist < arcProximity) {
                            const normalizedDist = (minDist - arcInnerLimit) / (arcProximity - arcInnerLimit);
                            const arcProfile = Math.sin(normalizedDist * Math.PI);
                            const newThickness = vertex.crustalThickness + thickeningAmount * arcProfile * 0.7;
                            
                            return {
                                ...vertex,
                                crustalThickness: Math.min(newThickness, 55)
                            };
                        }
                    }
                    return vertex;
                })
            };
        }
    }
    
    /**
     * Apply rifting physics at divergent boundaries
     * Thins continental crust, creates new thin oceanic crust
     */
    private applyRiftingPhysics(state: AppState, deltaT: number): AppState {
        if (!state.world.boundaries || state.world.boundaries.length === 0) {
            return state;
        }
        
        const thinningRate = (state.world.globalOptions.upliftRate || 1000) / 2000; // Half of convergent rate
        const divergentBoundaries = state.world.boundaries.filter(b => b.type === 'divergent');
        
        if (divergentBoundaries.length === 0) return state;
        
        const plates = [...state.world.plates];
        
        for (const boundary of divergentBoundaries) {
            const boundaryRings = boundary.points;
            if (!boundaryRings || boundaryRings.length === 0) continue;
            
            const velocity = boundary.velocity || 0.001;
            const intensityFactor = Math.min(velocity / 0.005, 1.0);
            const thinningAmount = thinningRate * deltaT * intensityFactor;
            
            // Affect both plates at the boundary
            for (const plateId of boundary.plateIds) {
                const pIndex = plates.findIndex(p => p.id === plateId);
                if (pIndex === -1 || !plates[pIndex].crustMesh) continue;
                
                const plate = plates[pIndex];
                const riftProximity = 2.0 / 111.0; // ~2 degrees from boundary
                
                plates[pIndex] = {
                    ...plate,
                    crustMesh: plate.crustMesh!.map(vertex => {
                        // Calculate distance to boundary polygon edges
                        const minDist = distanceToPolygonEdges(vertex.pos, boundaryRings);
                        
                        if (minDist < riftProximity) {
                            const falloff = 1 - (minDist / riftProximity);
                            
                            if (!vertex.isOceanic) {
                                // Continental rift: thin the crust (East African Rift model)
                                const newThickness = vertex.crustalThickness - thinningAmount * falloff;
                                
                                // If thinned below ~20km, transition to oceanic crust
                                if (newThickness < 20) {
                                    return {
                                        ...vertex,
                                        crustalThickness: REFERENCE_THICKNESS_OCEAN,
                                        isOceanic: true // Continental breakup -> new ocean basin
                                    };
                                }
                                
                                return {
                                    ...vertex,
                                    crustalThickness: Math.max(newThickness, 20)
                                };
                            } else {
                                // Oceanic spreading center: maintain thin new crust
                                // New oceanic crust is created at ~7km thickness
                                // Very close to ridge = hotter = slightly elevated
                                return vertex; // Already at oceanic baseline
                            }
                        }
                        return vertex;
                    })
                };
            }
        }
        
        return {
            ...state,
            world: { ...state.world, plates }
        };
    }
    
    /**
     * Apply thermal subsidence - oceanic crust deepens as it ages and cools
     * Based on half-space cooling model: depth ∝ √age
     */
    private applyThermalSubsidence(state: AppState, deltaT: number): AppState {
        const subsidenceRate = 0.001; // km per sqrt(Ma) - tuned for realism
        const plates = [...state.world.plates];
        const currentTime = state.world.currentTime;
        
        for (let i = 0; i < plates.length; i++) {
            const plate = plates[i];
            if (!plate.crustMesh) continue;
            
            // Only apply to oceanic plates
            if (plate.crustType !== 'oceanic') continue;
            
            const plateAge = currentTime - plate.birthTime;
            if (plateAge <= 0) continue;
            
            // Thermal subsidence follows √t relationship
            // Older oceanic crust has cooled more and subsides
            const subsidenceFactor = Math.sqrt(plateAge) * subsidenceRate * deltaT;
            
            plates[i] = {
                ...plate,
                crustMesh: plate.crustMesh.map(vertex => {
                    if (!vertex.isOceanic) return vertex;
                    
                    // Slightly thin oceanic crust over time (thermal contraction)
                    // This indirectly lowers elevation via isostasy
                    const newThickness = vertex.crustalThickness - subsidenceFactor;
                    
                    return {
                        ...vertex,
                        crustalThickness: Math.max(newThickness, 5) // Min 5km oceanic crust
                    };
                })
            };
        }
        
        return {
            ...state,
            world: { ...state.world, plates }
        };
    }
    
    /**
     * Apply slope-based erosion with sediment transport
     */
    private applyErosion(state: AppState, deltaT: number): AppState {
        const erosionRate = state.world.globalOptions.erosionRate || 0.003; // km/Ma
        const plates = [...state.world.plates];
        
        for (let i = 0; i < plates.length; i++) {
            const plate = plates[i];
            if (!plate.crustMesh || plate.crustMesh.length < 3) continue;
            
            const neighbors = this.getOrBuildNeighborGraph(plate);
            const transfers = new Map<string, { thickness: number; sediment: number }>();
            
            for (const vertex of plate.crustMesh) {
                const neighborIds = neighbors.get(vertex.id);
                if (!neighborIds || neighborIds.size === 0) continue;
                
                // Find lower neighbors and calculate slope
                const lowerNeighbors: { vertex: CrustVertex; slope: number }[] = [];
                
                for (const nId of neighborIds) {
                    const neighbor = plate.crustMesh!.find(v => v.id === nId);
                    if (!neighbor || neighbor.elevation >= vertex.elevation) continue;
                    
                    const dist = distance(vertex.pos, neighbor.pos) * 111; // Convert to km
                    const elevDiff = (vertex.elevation - neighbor.elevation) / 1000; // Convert to km
                    const slope = dist > 0 ? elevDiff / dist : 0;
                    
                    if (slope > 0.001) { // Minimum slope threshold
                        lowerNeighbors.push({ vertex: neighbor, slope });
                    }
                }
                
                if (lowerNeighbors.length === 0) continue;
                
                // Erosion rate increases with slope (steeper = faster)
                const totalSlope = lowerNeighbors.reduce((sum, n) => sum + n.slope, 0);
                const avgSlope = totalSlope / lowerNeighbors.length;
                
                // Non-linear erosion: E = k * slope^1.5 (stream power law approximation)
                const effectiveErosion = erosionRate * Math.pow(avgSlope * 10, 1.5) * deltaT;
                
                // Don't erode below minimum thickness
                const minThickness = vertex.isOceanic ? 5 : 20;
                const availableToErode = Math.max(0, vertex.crustalThickness - minThickness);
                const actualErosion = Math.min(effectiveErosion, availableToErode * 0.1);
                
                if (actualErosion <= 0) continue;
                
                // Transfer to lower neighbors proportionally
                for (const { vertex: neighbor, slope } of lowerNeighbors) {
                    const fraction = slope / totalSlope;
                    const transferAmount = actualErosion * fraction;
                    
                    // Record thickness loss from source
                    const srcTransfer = transfers.get(vertex.id) || { thickness: 0, sediment: 0 };
                    srcTransfer.thickness -= transferAmount;
                    transfers.set(vertex.id, srcTransfer);
                    
                    // Record sediment gain at destination
                    const dstTransfer = transfers.get(neighbor.id) || { thickness: 0, sediment: 0 };
                    dstTransfer.sediment += transferAmount * 1000; // Convert km to m for sediment
                    transfers.set(neighbor.id, dstTransfer);
                }
            }
            
            // Apply transfers
            plates[i] = {
                ...plate,
                crustMesh: plate.crustMesh.map(vertex => {
                    const transfer = transfers.get(vertex.id);
                    if (!transfer) return vertex;
                    
                    return {
                        ...vertex,
                        crustalThickness: vertex.crustalThickness + transfer.thickness,
                        sediment: vertex.sediment + transfer.sediment
                    };
                })
            };
        }
        
        return {
            ...state,
            world: { ...state.world, plates }
        };
    }
    
    /**
     * Build or retrieve cached neighbor graph using Delaunay triangulation
     */
    private getOrBuildNeighborGraph(plate: TectonicPlate): Map<string, Set<string>> {
        if (!plate.crustMesh || plate.crustMesh.length < 3) {
            return new Map();
        }
        
        // Check cache
        const cached = this.neighborCache.get(plate.id);
        if (cached && cached.size === plate.crustMesh.length) {
            return cached;
        }
        
        // Build new graph
        const graph = this.buildNeighborGraph(plate.crustMesh);
        this.neighborCache.set(plate.id, graph);
        return graph;
    }
    
    /**
     * Build Delaunay neighbor graph from vertices
     */
    private buildNeighborGraph(vertices: CrustVertex[]): Map<string, Set<string>> {
        const neighbors = new Map<string, Set<string>>();
        
        if (vertices.length < 3) return neighbors;
        
        // Initialize
        vertices.forEach(v => neighbors.set(v.id, new Set()));
        
        try {
            // Project to flat space for Delaunay
            const points: [number, number][] = vertices.map(v => [v.pos[0], v.pos[1]]);
            
            // Build Delaunay triangulation
            const delaunay = Delaunay.from(points);
            
            // Extract edges from triangles
            for (let i = 0; i < delaunay.triangles.length; i += 3) {
                const idx0 = delaunay.triangles[i];
                const idx1 = delaunay.triangles[i + 1];
                const idx2 = delaunay.triangles[i + 2];
                
                const v0 = vertices[idx0];
                const v1 = vertices[idx1];
                const v2 = vertices[idx2];
                
                // Add bidirectional edges
                neighbors.get(v0.id)!.add(v1.id);
                neighbors.get(v0.id)!.add(v2.id);
                neighbors.get(v1.id)!.add(v0.id);
                neighbors.get(v1.id)!.add(v2.id);
                neighbors.get(v2.id)!.add(v0.id);
                neighbors.get(v2.id)!.add(v1.id);
            }
        } catch (error) {
            console.error('Delaunay triangulation failed:', error);
        }
        
        return neighbors;
    }
    
    /**
     * Consolidate sediment in basins (sediment → crustal thickness via compaction)
     * Realistic approximation: sediment compacts and adds to crustal thickness
     * This causes basins to self-fill and experience isostatic uplift
     */
    private consolidateSediment(state: AppState, deltaT: number): AppState {
        const consolidationRate = 0.001; // km/Ma - how fast sediment becomes rock
        const sedimentConsolidationRatio = 0.25; // 1km sediment → 0.25km crust (4:1 compaction)
        const minSedimentThreshold = 0.5; // km - minimum to consolidate
        const plates = [...state.world.plates];
        
        for (let i = 0; i < plates.length; i++) {
            const plate = plates[i];
            if (!plate.crustMesh || plate.crustMesh.length < 3) continue;
            
            const neighbors = this.getOrBuildNeighborGraph(plate);
            const consolidations = new Map<string, { thickness: number; sediment: number }>();
            
            for (const vertex of plate.crustMesh) {
                if (vertex.sediment < minSedimentThreshold * 1000) continue; // Convert km to m
                
                const neighborIds = neighbors.get(vertex.id);
                if (!neighborIds || neighborIds.size === 0) continue;
                
                // Check if this vertex is in a basin (lower than neighbors)
                const neighbors_vertices = Array.from(neighborIds)
                    .map(nId => plate.crustMesh!.find(v => v.id === nId))
                    .filter((n): n is CrustVertex => n !== undefined);
                
                const isLowerThanAllNeighbors = neighbors_vertices.every(n => vertex.elevation <= n.elevation);
                
                if (!isLowerThanAllNeighbors) continue; // Not in a basin
                
                // Consolidate: sediment → crustal thickness
                const sedimentKm = vertex.sediment / 1000; // Convert m to km
                const consolidatedThickness = sedimentKm * sedimentConsolidationRatio * consolidationRate * deltaT;
                
                if (consolidatedThickness > 0) {
                    const consolidation = consolidations.get(vertex.id) || { thickness: 0, sediment: 0 };
                    consolidation.thickness += consolidatedThickness;
                    consolidation.sediment -= Math.min(vertex.sediment, consolidatedThickness / sedimentConsolidationRatio * 1000);
                    consolidations.set(vertex.id, consolidation);
                }
            }
            
            // Apply consolidations
            plates[i] = {
                ...plate,
                crustMesh: plate.crustMesh.map(vertex => {
                    const consolidation = consolidations.get(vertex.id);
                    if (!consolidation) return vertex;
                    
                    return {
                        ...vertex,
                        crustalThickness: vertex.crustalThickness + consolidation.thickness,
                        sediment: Math.max(0, vertex.sediment + consolidation.sediment)
                    };
                })
            };
        }
        
        return {
            ...state,
            world: { ...state.world, plates }
        };
    }
    public clearCache(plateId: string): void {
        this.neighborCache.delete(plateId);
    }
    
    /**
     * Clear all caches
     */
    public clearAllCaches(): void {
        this.neighborCache.clear();
    }
}
