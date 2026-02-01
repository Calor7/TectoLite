// Elevation System - Physical mesh-based topography simulation
// Replaces visual paint-based orogeny with actual elevation data

import { AppState, TectonicPlate, CrustVertex, Coordinate, generateId } from '../types';
import { distance } from '../utils/sphericalMath';
import { isPointInPolygon } from '../SplitTool';
import { Delaunay } from 'd3-delaunay';

export class ElevationSystem {
    private neighborCache: Map<string, Map<string, Set<string>>> = new Map(); // plateId -> neighborGraph
    
    constructor() {}
    
    /**
     * Main update loop - runs each simulation tick
     */
    public update(state: AppState, deltaT: number): AppState {
        if (!state.world.globalOptions.enableElevationSimulation) {
            return state;
        }
        
        let newState = { ...state };
        
        // Step 1: Initialize meshes for plates without them
        newState.world.plates = newState.world.plates.map(plate => {
            if (plate.visible && (!plate.crustMesh || plate.crustMesh.length === 0)) {
                const resolution = state.world.globalOptions.meshResolution || 150;
                return this.initializePlateMesh(plate, resolution);
            }
            return plate;
        });
        
        // Step 2: Apply uplift at boundaries
        newState = this.applyUplift(newState, deltaT);
        
        // Step 3: Apply erosion
        newState = this.applyErosion(newState, deltaT);
        
        // Step 4: Apply global decay (0.1% per Ma)
        newState.world.plates = newState.world.plates.map(plate => ({
            ...plate,
            crustMesh: plate.crustMesh?.map(v => ({
                ...v,
                elevation: v.elevation * 0.999
            }))
        }));
        
        return newState;
    }
    
    /**
     * Initialize mesh for a plate using hex grid sampling
     */
    public initializePlateMesh(plate: TectonicPlate, resolution: number = 150): TectonicPlate {
        if (plate.polygons.length === 0) return plate;
        
        // Calculate bounding box
        const allPoints = plate.polygons.flatMap(poly => poly.points);
        if (allPoints.length === 0) return plate;
        
        const lons = allPoints.map(p => p[0]);
        const lats = allPoints.map(p => p[1]);
        const minLon = Math.min(...lons);
        const maxLon = Math.max(...lons);
        const minLat = Math.min(...lats);
        const maxLat = Math.max(...lats);
        
        // Convert resolution from km to degrees (approximate)
        const spacing = resolution / 111.0; // 1 degree ≈ 111 km
        
        // Generate hex grid points
        const vertices: CrustVertex[] = [];
        const rowOffset = spacing * 0.866; // sqrt(3)/2 for hex pattern
        
        let row = 0;
        for (let lat = minLat; lat <= maxLat; lat += rowOffset) {
            const lonOffset = (row % 2) * (spacing / 2); // Offset every other row
            for (let lon = minLon + lonOffset; lon <= maxLon; lon += spacing) {
                const pos: Coordinate = [lon, lat];
                
                // Check if point is inside any of the plate's polygons
                let inside = false;
                for (const poly of plate.polygons) {
                    if (isPointInPolygon(pos, poly.points)) {
                        inside = true;
                        break;
                    }
                }
                
                if (inside) {
                    vertices.push({
                        id: generateId(),
                        pos: pos,
                        elevation: 0, // Start at sea level
                        sediment: 0
                    });
                }
            }
            row++;
        }
        
        // Enforce minimum vertex count for small plates
        if (vertices.length < 10 && allPoints.length > 0) {
            // Fallback: sample from polygon vertices
            for (let i = 0; i < Math.min(10, allPoints.length); i++) {
                vertices.push({
                    id: generateId(),
                    pos: allPoints[i],
                    elevation: 0,
                    sediment: 0
                });
            }
        }
        
        // Enforce maximum vertex count for performance
        const maxVertices = 500;
        if (vertices.length > maxVertices) {
            // Randomly sample to reduce count
            const sampled: CrustVertex[] = [];
            const step = Math.floor(vertices.length / maxVertices);
            for (let i = 0; i < vertices.length; i += step) {
                sampled.push(vertices[i]);
            }
            return {
                ...plate,
                crustMesh: sampled
            };
        }
        
        return {
            ...plate,
            crustMesh: vertices
        };
    }
    
    /**
     * Apply uplift in collision zones
     */
    private applyUplift(state: AppState, deltaT: number): AppState {
        if (!state.world.boundaries || state.world.boundaries.length === 0) {
            return state;
        }
        
        const upliftRate = state.world.globalOptions.upliftRate || 1000; // m/Ma
        const convergentBoundaries = state.world.boundaries.filter(b => b.type === 'convergent');
        
        if (convergentBoundaries.length === 0) return state;
        
        const plates = [...state.world.plates];
        
        for (const boundary of convergentBoundaries) {
            const [id1, id2] = boundary.plateIds;
            const p1Index = plates.findIndex(p => p.id === id1);
            const p2Index = plates.findIndex(p => p.id === id2);
            
            if (p1Index === -1 || p2Index === -1) continue;
            if (!plates[p1Index].crustMesh && !plates[p2Index].crustMesh) continue;
            
            // Get boundary polygon (approximate overlap zone)
            const boundaryPoints = boundary.points.flat();
            if (boundaryPoints.length < 3) continue;
            
            // Calculate collision intensity based on velocity
            const velocity = boundary.velocity || 0.001;
            const intensityFactor = Math.min(velocity / 0.01, 1.0); // Normalize to 0-1
            
            // Apply uplift to vertices near boundary
            const upliftAmount = upliftRate * deltaT * intensityFactor;
            const proximityThreshold = 5.0; // degrees (~550 km)
            
            // Update plate 1 vertices
            if (plates[p1Index].crustMesh) {
                plates[p1Index] = {
                    ...plates[p1Index],
                    crustMesh: plates[p1Index].crustMesh!.map(vertex => {
                        // Check proximity to boundary
                        const minDist = Math.min(
                            ...boundaryPoints.map(bp => distance(vertex.pos, bp))
                        );
                        
                        if (minDist < proximityThreshold / 111.0) { // Convert to radians approx
                            // Apply uplift with distance falloff
                            const falloff = 1.0 - (minDist / (proximityThreshold / 111.0));
                            return {
                                ...vertex,
                                elevation: vertex.elevation + upliftAmount * falloff
                            };
                        }
                        return vertex;
                    })
                };
            }
            
            // Update plate 2 vertices
            if (plates[p2Index].crustMesh) {
                plates[p2Index] = {
                    ...plates[p2Index],
                    crustMesh: plates[p2Index].crustMesh!.map(vertex => {
                        const minDist = Math.min(
                            ...boundaryPoints.map(bp => distance(vertex.pos, bp))
                        );
                        
                        if (minDist < proximityThreshold / 111.0) {
                            const falloff = 1.0 - (minDist / (proximityThreshold / 111.0));
                            return {
                                ...vertex,
                                elevation: vertex.elevation + upliftAmount * falloff
                            };
                        }
                        return vertex;
                    })
                };
            }
        }
        
        return {
            ...state,
            world: {
                ...state.world,
                plates
            }
        };
    }
    
    /**
     * Apply erosion via neighbor transport
     */
    private applyErosion(state: AppState, deltaT: number): AppState {
        const erosionRate = state.world.globalOptions.erosionRate || 0.001;
        const plates = [...state.world.plates];
        
        for (let i = 0; i < plates.length; i++) {
            const plate = plates[i];
            if (!plate.crustMesh || plate.crustMesh.length < 3) continue;
            
            // Build neighbor graph (cached)
            const neighbors = this.getOrBuildNeighborGraph(plate);
            
            // Calculate transfers (two-pass to avoid order dependency)
            const transfers = new Map<string, number>(); // vertexId -> net elevation change
            
            for (const vertex of plate.crustMesh) {
                const neighborIds = neighbors.get(vertex.id);
                if (!neighborIds || neighborIds.size === 0) continue;
                
                // Find lower neighbors
                const lowerNeighbors = Array.from(neighborIds)
                    .map(nId => plate.crustMesh!.find(v => v.id === nId))
                    .filter((n): n is CrustVertex => n !== undefined && n.elevation < vertex.elevation);
                
                if (lowerNeighbors.length === 0) continue;
                
                // Calculate total elevation difference
                const totalDiff = lowerNeighbors.reduce(
                    (sum, n) => sum + (vertex.elevation - n.elevation), 
                    0
                );
                
                // Transfer fraction of elevation to each lower neighbor
                for (const neighbor of lowerNeighbors) {
                    const diff = vertex.elevation - neighbor.elevation;
                    const fraction = diff / totalDiff;
                    const transferAmount = diff * erosionRate * deltaT * fraction;
                    
                    // Record transfers
                    transfers.set(vertex.id, (transfers.get(vertex.id) || 0) - transferAmount);
                    transfers.set(neighbor.id, (transfers.get(neighbor.id) || 0) + transferAmount);
                }
            }
            
            // Apply transfers
            plates[i] = {
                ...plate,
                crustMesh: plate.crustMesh.map(vertex => ({
                    ...vertex,
                    elevation: vertex.elevation + (transfers.get(vertex.id) || 0)
                }))
            };
        }
        
        return {
            ...state,
            world: {
                ...state.world,
                plates
            }
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
     * Clear cache for a specific plate (call when mesh changes)
     */
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
