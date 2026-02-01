// Geological Automation System
// Handles dynamic feature tracking, orogeny detection, and crust aging

import { AppState, Feature, generateId, TectonicPlate, FeatureType, Coordinate } from '../types';
import { isPointInPolygon } from '../SplitTool';
import { BoundarySystem } from '../BoundarySystem';

export class GeologicalAutomationSystem {

    constructor() {}

    public update(state: AppState): AppState {
        // Run enabled systems
        // Optimization: Don't run heavy logic on every single frame if time hasn't changed much
        // For now, run every tick.

        let newState = { ...state };
        
        if (state.world.globalOptions.enableHotspots) {
            newState = this.processHotspots(newState);
        }

        if (state.world.globalOptions.enableOrogeny) {
            newState = this.processOrogenies(newState);
        }

        return newState;
    }

    private processHotspots(state: AppState): AppState {
        if (!state.world.mantlePlumes || state.world.mantlePlumes.length === 0) return state;

        const currentTime = state.world.currentTime;
        let modified = false;
        const plates = [...state.world.plates];

        for (const plume of state.world.mantlePlumes) {
            if (!plume.active) continue;

            // Simple logic: Is plume inside any plate?
            for (let i = 0; i < plates.length; i++) {
                const plate = plates[i];
                // Check inclusion
                let inside = false;
                for (const poly of plate.polygons) {
                    if (isPointInPolygon(plume.position, poly.points)) {
                        inside = true;
                        break;
                    }
                }

                if (inside) {
                    // Check if we should spawn (Rate limiting would go here, e.g. every 5 Ma)
                    // For MVP, lets just mark interaction or spawn if getting far from last usage?
                    // Let's spawn a simplistic 'Hotspot Trail' feature if none exists close by
                    
                    const recentFeature = plate.features.find(f => 
                        f.type === 'volcano' && 
                        f.properties?.source === 'plume' &&
                        f.properties?.plumeId === plume.id &&
                        (currentTime - (f.generatedAt || 0)) < 2 // 2 Ma gap
                    );

                    if (!recentFeature) {
                        // Spawn new feature on the plate
                        // Position is the plume's fixed World Position converted to what it is NOW on the plate
                        // Wait, Features move with the plate. So we spawn it AT the plume's world pos.
                        // The plate will carry it away.
                        
                        const newFeature: Feature = {
                            id: generateId(),
                            type: 'volcano',
                            position: [...plume.position],
                            rotation: 0,
                            scale: 1,
                            generatedAt: currentTime,
                            properties: {
                                source: 'plume',
                                plumeId: plume.id,
                                description: 'Hotspot Track'
                            }
                        };

                        // Immutable update of plate features
                        plates[i] = {
                            ...plate,
                            features: [...plate.features, newFeature]
                        };
                        modified = true;
                    }
                }
            }
        }

        if (!modified) return state;

        return {
            ...state,
            world: {
                ...state.world,
                plates
            }
        };
    }

    private processOrogenies(state: AppState): AppState {
        // Detect current boundaries
        const boundaries = BoundarySystem.detectBoundaries(state.world.plates);
        
        // Filter for convergent
        const collisions = boundaries.filter(b => b.type === 'convergent');
        
        if (collisions.length === 0) return state;

        let modified = false;
        let plates = [...state.world.plates];
        const currentTime = state.world.currentTime;

        for (const boundary of collisions) {
             const [id1, id2] = boundary.plateIds;
             
             const p1Index = plates.findIndex(p => p.id === id1);
             const p2Index = plates.findIndex(p => p.id === id2);
             if (p1Index === -1 || p2Index === -1) continue;

             const p1 = plates[p1Index];
             const p2 = plates[p2Index];

             // Geologic Logic
             const t1 = p1.crustType || 'continental';
             const t2 = p2.crustType || 'continental';

             // Intersection Center
             if (boundary.points.length === 0 || boundary.points[0].length === 0) continue;
             const seedPoint = boundary.points[0][0];
             
             // Rate Limit / Existence Check
             // Avoid spamming features every tick. Check if we SPAWNED something for this boundary recently (e.g. within last 1 Ma).
             // Since features move, we can't just check generic proximity. We check metadata.
             
             // Time check: Find the MOST RECENT feature with this boundaryId
             const recentP1 = p1.features.filter(f => f.properties?.boundaryId === boundary.id).sort((a,b) => (b.generatedAt||0) - (a.generatedAt||0))[0];
             const recentP2 = p2.features.filter(f => f.properties?.boundaryId === boundary.id).sort((a,b) => (b.generatedAt||0) - (a.generatedAt||0))[0];
             
             const lastTime1 = recentP1 ? (recentP1.generatedAt || 0) : -9999;
             const lastTime2 = recentP2 ? (recentP2.generatedAt || 0) : -9999;
             
             const timeSinceLast = currentTime - Math.max(lastTime1, lastTime2);
             
             if (timeSinceLast < 2.0) continue; // Rate limit: 2 Ma

             // Decide Action
             if (t1 === 'continental' && t2 === 'continental') {
                 // Cont-Cont Collision -> Mountains on BOTH
                 plates[p1Index] = this.addFeature(plates[p1Index], 'mountain', seedPoint, boundary.id, currentTime, 'Orogeny Belt');
                 plates[p2Index] = this.addFeature(plates[p2Index], 'mountain', seedPoint, boundary.id, currentTime, 'Orogeny Belt');
                 modified = true;
             }
             else if (t1 === 'oceanic' && t2 === 'oceanic') {
                 // Oce-Oce -> Older/Denser subducts.
                 const d1 = p1.density || 3.0;
                 const d2 = p2.density || 3.0;
                 // Tie-breaker: ID
                 const p1Denser = d1 > d2;
                 const overridingIndex = p1Denser ? p2Index : p1Index; // Denser subducts, Overriding stays on top

                 plates[overridingIndex] = this.addFeature(plates[overridingIndex], 'volcano', seedPoint, boundary.id, currentTime, 'Island Arc');
                 modified = true;
             }
             else {
                 // Mix -> Oceanic Subducts
                 const contIdx = t1 === 'continental' ? p1Index : p2Index;
                 
                 plates[contIdx] = this.addFeature(plates[contIdx], 'volcano', seedPoint, boundary.id, currentTime, 'Continental Arc');
                 modified = true;
             }
        }
        
        if (!modified) return state;

        return {
            ...state,
            world: {
                ...state.world,
                plates
            }
        };
    }

    private addFeature(plate: TectonicPlate, type: FeatureType, pos: Coordinate, boundaryId: string, time: number, desc?: string): TectonicPlate {
         const newF: Feature = {
             id: generateId(),
             type: type,
             position: [...pos], // Spread to copy
             rotation: Math.random() * 360,
             scale: 0.8 + Math.random() * 0.4,
             generatedAt: time,
             properties: {
                 boundaryId: boundaryId,
                 description: desc || 'Orogeny Feature'
             }
         };
         return {
             ...plate,
             features: [...plate.features, newF]
         };
    }
}

