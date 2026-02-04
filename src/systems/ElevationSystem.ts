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
            // DON'T return early - continue to Step 2 to re-initialize if deltaT >= 0
            // This fixes the bug where meshes weren't re-initialized after time reset
        }
        
        // Step 2: Initialize meshes for plates without them (when moving forward OR at reset)
        // Also initialize when deltaT == 0 and meshes were just cleared (reset case)
        if (deltaT >= 0) {
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
            // === REMOVED: Automatic mesh deformation on plate contact ===
            // The following methods have been disabled as part of the Event-Driven Guided Creation system:
            // - applyCollisionPhysics() - mesh now only reacts to COMMITTED EVENTS, not continuous plate contact
            // - applyRiftingPhysics() - same as above
            // This simplifies mesh mechanics and makes them less resource-intensive.
            // Event consequences will handle mountain building, trenches, rifts, etc.
            
            // Apply thermal subsidence (oceanic crust deepens with age)
            newState = this.applyThermalSubsidence(newState, deltaT);
            
            // Apply erosion (slope-based, transfers sediment)
            newState = this.applyErosion(newState, deltaT);
            
            // Consolidate sediment in basins (convert to crustal thickness)
            newState = this.consolidateSediment(newState, deltaT);
            
            // Apply committed event consequences (Event-Driven System)
            newState = this.applyEventConsequences(newState, deltaT);
            
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
     * Apply consequences from committed tectonic events to elevation mesh
     * This replaces automatic mesh deformation with user-guided event-based creation
     */
    private applyEventConsequences(state: AppState, deltaT: number): AppState {
        const events = state.world.tectonicEvents || [];
        const committedEvents = events.filter(e => e.committed);
        
        if (committedEvents.length === 0) return state;
        
        let newPlates = [...state.world.plates];
        
        const currentTime = state.world.currentTime;
        const previousTime = currentTime - deltaT;

        // Process each committed event
        for (const event of committedEvents) {
            const startTime = event.effectStartTime ?? event.time;
            const endTime = event.effectEndTime ?? event.time;

            // Only apply when crossing into the event window
            if (currentTime < startTime || previousTime > endTime) continue;

            // Get selected consequences
            const selectedConsequences = event.consequences.filter(c => c.selected);
            if (selectedConsequences.length === 0) continue;
            
            // Apply each consequence type
            for (const consequence of selectedConsequences) {
                const params = consequence.parameters;
                
                switch (consequence.type) {
                    case 'orogeny':
                        // Thicken crust near boundary to create mountains
                        newPlates = this.applyOrogenyEffect(newPlates, event, params, deltaT);
                        break;
                        
                    case 'volcanic_arc':
                        // Create volcanic features along arc
                        // For now, just slightly thicken crust
                        newPlates = this.applyVolcanicEffect(newPlates, event, params, deltaT);
                        break;
                        
                    case 'trench':
                        // Deepen subducting plate edge
                        newPlates = this.applyTrenchEffect(newPlates, event, params, deltaT);
                        break;
                        
                    case 'rift_valley':
                        // Thin crust and create depression
                        newPlates = this.applyRiftEffect(newPlates, event, params, deltaT);
                        break;

                    case 'volcanic_chain':
                        // Volcanism along rift
                        newPlates = this.applyVolcanicChainEffect(newPlates, event, params, deltaT);
                        break;

                    case 'accretionary_wedge':
                        newPlates = this.applyAccretionaryWedgeEffect(newPlates, event, params, deltaT);
                        break;

                    case 'back_arc_basin':
                        newPlates = this.applyBackArcBasinEffect(newPlates, event, params, deltaT);
                        break;

                    case 'ophiolite_obduction':
                        newPlates = this.applyOphioliteObductionEffect(newPlates, event, params, deltaT);
                        break;

                    case 'new_ocean_basin':
                        newPlates = this.applyNewOceanBasinEffect(newPlates, event, params, deltaT);
                        break;

                    case 'flood_basalt':
                        newPlates = this.applyFloodBasaltEffect(newPlates, event, params, deltaT);
                        break;
                        
                    // Other consequence types can be added here
                    default:
                        // Unimplemented consequence types are silently skipped for now
                        break;
                }
            }
        }
        
        return { ...state, world: { ...state.world, plates: newPlates } };
    }
    
    /**
     * Apply orogeny effect: thicken crust near collision boundary
     */
    private applyOrogenyEffect(plates: TectonicPlate[], event: any, params: Record<string, number>, deltaT: number): TectonicPlate[] {
        const upliftRate = params.upliftRate || 1000; // m/Ma
        const width = params.width || 200; // km
        
        const [id1, id2] = event.plateIds;
        
        return plates.map(plate => {
            if (plate.id !== id1 && plate.id !== id2) return plate;
            if (!plate.crustMesh || plate.crustMesh.length === 0) return plate;
            
            // Find vertices near boundary and thicken them
            const updatedMesh = plate.crustMesh.map(v => {
                const distToBoundary = this.distanceToEventBoundary(v.pos, event.boundarySegment);
                
                if (distToBoundary < width) {
                    // Gaussian falloff from center
                    const factor = Math.exp(-(distToBoundary * distToBoundary) / (2 * (width / 3) * (width / 3)));
                    const thickening = (upliftRate / 1000) * deltaT * factor; // Convert m to km
                    
                    return {
                        ...v,
                        crustalThickness: v.crustalThickness + thickening
                    };
                }
                
                return v;
            });
            
            return { ...plate, crustMesh: updatedMesh };
        });
    }
    
    /**
     * Apply volcanic arc effect: slight crustal thickening
     */
    private applyVolcanicEffect(plates: TectonicPlate[], event: any, _params: Record<string, number>, deltaT: number): TectonicPlate[] {
        const width = 100; // km - narrower than orogeny
        const thickeningRate = 200; // m/Ma - less than orogeny
        
        const [id1, id2] = event.plateIds;
        
        return plates.map(plate => {
            if (plate.id !== id1 && plate.id !== id2) return plate;
            if (!plate.crustMesh) return plate;
            
            const updatedMesh = plate.crustMesh.map(v => {
                const dist = this.distanceToEventBoundary(v.pos, event.boundarySegment);
                
                if (dist < width) {
                    const factor = Math.exp(-(dist * dist) / (2 * (width / 3) * (width / 3)));
                    const thickening = (thickeningRate / 1000) * deltaT * factor;
                    
                    return {
                        ...v,
                        crustalThickness: v.crustalThickness + thickening
                    };
                }
                
                return v;
            });
            
            return { ...plate, crustMesh: updatedMesh };
        });
    }
    
    /**
     * Apply trench effect: deepen subducting plate
     */
    private applyTrenchEffect(plates: TectonicPlate[], event: any, params: Record<string, number>, deltaT: number): TectonicPlate[] {
        const depth = params.depth || -8000; // m
        const width = params.width || 100; // km
        
        // Apply to subducting plate (oceanic one in ocean-continent collision)
        const [id1, id2] = event.plateIds;
        
        return plates.map(plate => {
            if (plate.id !== id1 && plate.id !== id2) return plate;
            if (!plate.crustMesh) return plate;
            
            // Only apply to oceanic plate
            if (plate.crustType !== 'oceanic') return plate;
            
            const updatedMesh = plate.crustMesh.map(v => {
                const dist = this.distanceToEventBoundary(v.pos, event.boundarySegment);
                
                if (dist < width) {
                    const factor = Math.exp(-(dist * dist) / (2 * (width / 4) * (width / 4)));
                    const thinning = (Math.abs(depth) / 1000) * factor * 0.01 * deltaT; // Thin crust to create trench
                    
                    return {
                        ...v,
                        crustalThickness: Math.max(3, v.crustalThickness - thinning) // Don't go below 3km
                    };
                }
                
                return v;
            });
            
            return { ...plate, crustMesh: updatedMesh };
        });
    }
    
    /**
     * Apply rift valley effect: thin crust
     */
    private applyRiftEffect(plates: TectonicPlate[], event: any, params: Record<string, number>, deltaT: number): TectonicPlate[] {
        const width = params.width || 50; // km
        const depthRate = params.depth ? Math.max(200, params.depth) : 500; // m/Ma thinning rate
        
        const [id1, id2] = event.plateIds;
        
        return plates.map(plate => {
            if (plate.id !== id1 && plate.id !== id2) return plate;
            if (!plate.crustMesh) return plate;
            
            const updatedMesh = plate.crustMesh.map(v => {
                const dist = this.distanceToEventBoundary(v.pos, event.boundarySegment);
                
                if (dist < width) {
                    const factor = Math.exp(-(dist * dist) / (2 * (width / 3) * (width / 3)));
                    const thinning = (depthRate / 1000) * deltaT * factor; // Convert m to km
                    
                    return {
                        ...v,
                        crustalThickness: Math.max(15, v.crustalThickness - thinning) // Don't thin below 15km
                    };
                }
                
                return v;
            });
            
            return { ...plate, crustMesh: updatedMesh };
        });
    }

    /**
     * Apply volcanic chain effect: mild crustal thickening along rift
     */
    private applyVolcanicChainEffect(plates: TectonicPlate[], event: any, _params: Record<string, number>, deltaT: number): TectonicPlate[] {
        const width = 80; // km
        const thickeningRate = 150; // m/Ma
        const [id1, id2] = event.plateIds;

        return plates.map(plate => {
            if (plate.id !== id1 && plate.id !== id2) return plate;
            if (!plate.crustMesh) return plate;

            const updatedMesh = plate.crustMesh.map(v => {
                const dist = this.distanceToEventBoundary(v.pos, event.boundarySegment);
                if (dist < width) {
                    const factor = Math.exp(-(dist * dist) / (2 * (width / 3) * (width / 3)));
                    const thickening = (thickeningRate / 1000) * deltaT * factor;
                    return { ...v, crustalThickness: v.crustalThickness + thickening };
                }
                return v;
            });

            return { ...plate, crustMesh: updatedMesh };
        });
    }

    /**
     * Apply accretionary wedge effect: thicken crust near subduction zone
     */
    private applyAccretionaryWedgeEffect(plates: TectonicPlate[], event: any, params: Record<string, number>, deltaT: number): TectonicPlate[] {
        const width = params.width || 150; // km
        const thickness = params.thickness || 10; // km
        const thickeningRate = Math.max(0.2, thickness / 10); // km/Ma
        const [id1, id2] = event.plateIds;

        return plates.map(plate => {
            if (plate.id !== id1 && plate.id !== id2) return plate;
            if (!plate.crustMesh) return plate;
            if (plate.crustType === 'oceanic') return plate;

            const updatedMesh = plate.crustMesh.map(v => {
                const dist = this.distanceToEventBoundary(v.pos, event.boundarySegment);
                if (dist < width) {
                    const factor = Math.exp(-(dist * dist) / (2 * (width / 3) * (width / 3)));
                    return { ...v, crustalThickness: v.crustalThickness + thickeningRate * deltaT * factor };
                }
                return v;
            });

            return { ...plate, crustMesh: updatedMesh };
        });
    }

    /**
     * Apply back-arc basin effect: thin crust behind volcanic arc
     */
    private applyBackArcBasinEffect(plates: TectonicPlate[], event: any, params: Record<string, number>, deltaT: number): TectonicPlate[] {
        const width = params.width || 300; // km
        const spreadingRate = params.spreadingRate || 2; // cm/yr
        const thinningRate = Math.max(0.1, spreadingRate * 0.05); // km/Ma
        const [id1, id2] = event.plateIds;

        return plates.map(plate => {
            if (plate.id !== id1 && plate.id !== id2) return plate;
            if (!plate.crustMesh) return plate;
            if (plate.crustType === 'oceanic') return plate;

            const updatedMesh = plate.crustMesh.map(v => {
                const dist = this.distanceToEventBoundary(v.pos, event.boundarySegment);
                if (dist < width) {
                    const factor = Math.exp(-(dist * dist) / (2 * (width / 2) * (width / 2)));
                    return { ...v, crustalThickness: Math.max(10, v.crustalThickness - thinningRate * deltaT * factor) };
                }
                return v;
            });

            return { ...plate, crustMesh: updatedMesh };
        });
    }

    /**
     * Apply ophiolite obduction effect: localized thickening near boundary
     */
    private applyOphioliteObductionEffect(plates: TectonicPlate[], event: any, params: Record<string, number>, deltaT: number): TectonicPlate[] {
        const extent = params.extent || 100; // km
        const thickeningRate = 0.2; // km/Ma
        const [id1, id2] = event.plateIds;

        return plates.map(plate => {
            if (plate.id !== id1 && plate.id !== id2) return plate;
            if (!plate.crustMesh) return plate;
            if (plate.crustType === 'oceanic') return plate;

            const updatedMesh = plate.crustMesh.map(v => {
                const dist = this.distanceToEventBoundary(v.pos, event.boundarySegment);
                if (dist < extent) {
                    const factor = Math.exp(-(dist * dist) / (2 * (extent / 3) * (extent / 3)));
                    return { ...v, crustalThickness: v.crustalThickness + thickeningRate * deltaT * factor };
                }
                return v;
            });

            return { ...plate, crustMesh: updatedMesh };
        });
    }

    /**
     * Apply new ocean basin effect: thin crust and convert to oceanic near rift
     */
    private applyNewOceanBasinEffect(plates: TectonicPlate[], event: any, params: Record<string, number>, deltaT: number): TectonicPlate[] {
        const width = params.initialWidth || 100; // km
        const spreadingRate = params.spreadingRate || 2; // cm/yr
        const thinningRate = Math.max(0.2, spreadingRate * 0.08); // km/Ma
        const [id1, id2] = event.plateIds;

        return plates.map(plate => {
            if (plate.id !== id1 && plate.id !== id2) return plate;
            if (!plate.crustMesh) return plate;

            const updatedMesh = plate.crustMesh.map(v => {
                const dist = this.distanceToEventBoundary(v.pos, event.boundarySegment);
                if (dist < width) {
                    const factor = Math.exp(-(dist * dist) / (2 * (width / 3) * (width / 3)));
                    const newThickness = Math.max(7, v.crustalThickness - thinningRate * deltaT * factor);
                    return {
                        ...v,
                        crustalThickness: newThickness,
                        isOceanic: newThickness <= 10 ? true : v.isOceanic
                    };
                }
                return v;
            });

            return { ...plate, crustMesh: updatedMesh };
        });
    }

    /**
     * Apply flood basalt effect: regional thickening from massive volcanism
     */
    private applyFloodBasaltEffect(plates: TectonicPlate[], event: any, params: Record<string, number>, deltaT: number): TectonicPlate[] {
        const area = params.area || 500000; // km^2
        const thicknessMeters = params.thickness || 1000; // m
        const radius = Math.sqrt(area / Math.PI); // km
        const thickeningRate = Math.max(0.1, thicknessMeters / 1000 / 5); // km/Ma
        const [id1, id2] = event.plateIds;

        return plates.map(plate => {
            if (plate.id !== id1 && plate.id !== id2) return plate;
            if (!plate.crustMesh) return plate;

            const updatedMesh = plate.crustMesh.map(v => {
                const dist = this.distanceToEventBoundary(v.pos, event.boundarySegment);
                if (dist < radius) {
                    const factor = Math.exp(-(dist * dist) / (2 * (radius / 2) * (radius / 2)));
                    return { ...v, crustalThickness: v.crustalThickness + thickeningRate * deltaT * factor };
                }
                return v;
            });

            return { ...plate, crustMesh: updatedMesh };
        });
    }
    
    /**
     * Calculate minimum distance from point to event boundary
     */
    private distanceToEventBoundary(point: Coordinate, boundarySegments: Coordinate[][]): number {
        let minDist = Infinity;
        
        for (const segment of boundarySegments) {
            const dist = distanceToPolygonEdges(point, [segment]);
            if (dist < minDist) minDist = dist;
        }
        
        return minDist * 111; // Convert degrees to approximate km
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

    // ============================================================================
    // [REMOVED - Event-Driven System]
    // The applyCollisionPhysics and applyRiftingPhysics methods have been removed
    // as part of the Event-Driven Guided Creation system. Mesh now only reacts to
    // COMMITTED EVENTS (user-selected consequences) and EROSION/SEDIMENTS.
    // These methods can be found in git history if needed for reference.
    // ============================================================================
    
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
