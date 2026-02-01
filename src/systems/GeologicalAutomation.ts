// Geological Automation System
// Handles dynamic feature tracking, orogeny detection, and crust aging

import { AppState, Feature, generateId, TectonicPlate, FeatureType, Coordinate } from '../types';
import { isPointInPolygon } from '../SplitTool';
import { distance } from '../utils/sphericalMath';

export class GeologicalAutomationSystem {
    private boundaryCooldowns: Map<string, number> = new Map();

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
                    // Determine spawn rate: Prefer Plume-specific rate, fall back to Global rate
                    const rate = plume.spawnRate ?? state.world.globalOptions.hotspotSpawnRate ?? 1.0;

                    // Check if we should spawn
                    // Find the MOST RECENT feature spawned by this plume
                    const recentFeature = plate.features
                        .filter(f => 
                            f.type === 'hotspot' && 
                            f.properties?.source === 'plume' &&
                            f.properties?.plumeId === plume.id
                        )
                        .sort((a,b) => (b.generatedAt || 0) - (a.generatedAt || 0))[0];

                    const timeSinceLast = currentTime - (recentFeature?.generatedAt || 0);

                    // Allow initial spawn (recentFeature undefined) OR if time gap exceeded
                    if (!recentFeature || timeSinceLast >= rate) {
                        // Spawn new feature on the plate
                        // Position is the plume's fixed World Position converted to what it is NOW on the plate
                        // Wait, Features move with the plate. So we spawn it AT the plume's world pos.
                        // The plate will carry it away.
                        
                        const newFeature: Feature = {
                            id: generateId(),
                            type: 'hotspot',
                            position: [...plume.position],
                            originalPosition: [...plume.position], // Store original position for accurate rotation
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

    private getRandomBoundaryPoint(rings: Coordinate[][]): Coordinate | null {
        // Collect all segments with their lengths to ensure uniform distribution
        // This fixes "bunching" where areas with many small vertices (corners) got disproportionate spawns
        const segments: { p1: Coordinate, p2: Coordinate, length: number }[] = [];
        let totalLength = 0;
        
        // Safety: Limit processing of super-detailed rings to prevent loop hang
        // Downsample rings if they have excessive vertex count (> 200)
        // This is purely for performance during complex boundary interactions

        for (const ring of rings) {
            if (ring.length < 2) continue;
            
            const step = ring.length > 200 ? Math.ceil(ring.length / 100) : 1;

            for (let i = 0; i < ring.length - step; i += step) {
                const p1 = ring[i];
                const p2 = ring[i+step]; // Skip to next step
                
                // Calculate distance in radians (great circle)
                const d = distance(p1, p2);
                
                // Skip effectively zero-length segments or artifacts
                if (d > 0.000001 && !isNaN(d)) { 
                    segments.push({ p1, p2, length: d });
                    totalLength += d;
                }
            }
        }

        if (segments.length === 0 || totalLength === 0) return null;

        // Weighted Random Selection: Likelihood is proportional to physical length
        let target = Math.random() * totalLength;
        let selectedSeg = segments[segments.length - 1]; // Default to last (floating point safety)

        for (const seg of segments) {
            target -= seg.length;
            if (target <= 0) {
                selectedSeg = seg;
                break;
            }
        }

        // Interpolate along the segment
        const t = Math.random();
        // Linear interpolation for lat/lon is aproximation but sufficient for short boundary segments
        const lon = selectedSeg.p1[0] + (selectedSeg.p2[0] - selectedSeg.p1[0]) * t;
        const lat = selectedSeg.p1[1] + (selectedSeg.p2[1] - selectedSeg.p1[1]) * t;

        // Jitter (approx 0.1 - 0.5 degrees)
        const jitter = 0.5;
        const jLon = (Math.random() - 0.5) * jitter;
        const jLat = (Math.random() - 0.5) * jitter;

        return [lon + jLon, lat + jLat];
    }

    private processOrogenies(state: AppState): AppState {
        // Use existing boundaries from state if available, otherwise detect (fallback)
        let boundaries = state.world.boundaries;
        if (!boundaries || boundaries.length === 0) {
            // Only detect if truly missing and we need them (rare case if engine did its job)
             boundaries = BoundarySystem.detectBoundaries(state.world.plates);
        }
        
        // Filter for active boundaries (Convergent or Divergent)
        const collisions = boundaries.filter(b => b.type === 'convergent' || b.type === 'divergent');
        
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

             // PHYSICAL LENGTH THRESHOLD CHECK
             // Calculate the actual length of the collision/divergence boundary in radians
             let boundaryLengthRad = 0;
             for (const ring of boundary.points) {
                 for (let k = 0; k < ring.length - 1; k++) {
                     // Quick approx distance is fine for threshold check to avoid heavy trig
                     // But we use real distance to be safe
                     boundaryLengthRad += distance(ring[k], ring[k+1]);
                 }
             }

             // Threshold: 0.01 radians (~60km). 
             // If the entire interaction length is smaller than this, it's a "last frame" artifact
             // or a single point contact. Skip processing to prevent freeze/glitches.
             if (boundaryLengthRad < 0.01) continue;
             
             // Rate Limit / Existence Check
             // Avoid spamming features every tick. Check if we SPAWNED something for this boundary recently (e.g. within last 1 Ma).
             // Since features move, we can't just check generic proximity. We check metadata.
             
             // Time check: Find the MOST RECENT feature with this boundaryId
             const recentP1 = p1.features.filter(f => f.properties?.boundaryId === boundary.id).sort((a,b) => (b.generatedAt||0) - (a.generatedAt||0))[0];
             const recentP2 = p2.features.filter(f => f.properties?.boundaryId === boundary.id).sort((a,b) => (b.generatedAt||0) - (a.generatedAt||0))[0];
             
             const lastTime1 = recentP1 ? (recentP1.generatedAt || 0) : -9999;
             const lastTime2 = recentP2 ? (recentP2.generatedAt || 0) : -9999;
             
             const timeSinceLast = currentTime - Math.max(lastTime1, lastTime2);
             
             // Dynamic Density Control
             // High Velocity = Denser packing (smaller spacing)
             // Low Velocity = Sparse packing (larger spacing)
             // v is in radians/Ma. 0.001 rad/Ma ~= 0.6 cm/yr.
             const velocity = boundary.velocity || 0.001; 
             
             // Define desired spacing in km (approx) converted to radians
             // 1 degree ~ 111km.
             // Low density: 50km spacing (~0.5 deg)
             // High density: 20km spacing (~0.2 deg)
             // Velocity range: 0.0005 (0.3cm/yr) to 0.01 (6cm/yr)
             
             let minSpacingDeg = 0.5; // Default Low Density
             if (velocity > 0.005) minSpacingDeg = 0.2; // High Density (>3cm/yr)
             else if (velocity > 0.002) minSpacingDeg = 0.35; // Medium Density
             
             // Convert to radians for distance check
             const minSpacingRad = minSpacingDeg * Math.PI / 180;

             // Saturation Check: If we recently failed to find space here, skip
             const cooldown = this.boundaryCooldowns.get(boundary.id);
             if (cooldown && cooldown > currentTime) continue;

             // Reduced time lockout - Rely more on spatial density
             if (timeSinceLast < 0.05) continue; 

             // Calculate spawns based on boundary length
             let totalPoints = 0;
             boundary.points.forEach(r => totalPoints += r.length);
             
             // Reduced max attempts to avoid lag when full
             // Was 10, now 4.
             const spawnAttempts = Math.max(2, Math.min(4, Math.floor(totalPoints / 10)));
             
             let successCount = 0;
             let failCount = 0;

             for (let k = 0; k < spawnAttempts; k++) {
                 // Optimization: If we failed twice in a row, assume full
                 if (failCount >= 2) {
                     // Set cooldown
                     this.boundaryCooldowns.set(boundary.id, currentTime + 1.0); // Wait 1 Ma
                     break;
                 }

                 // Generate a distributed point
                 const seedPoint = this.getRandomBoundaryPoint(boundary.points);
                 if (!seedPoint) {
                     failCount++;
                     continue;
                 }
                 
                 // Spatial Density Check against EXISTING features on relevant plates
                 // We only check if the NEW point is too close to ANY existing mountain on that plate.
                 
                 // Check P1
                 let p1Clear = true;
                 // For rifts, we check feature type 'rift' too
                 if (t1 === 'continental' || boundary.type === 'divergent') { // Only care if we are spawning here
                     p1Clear = this.checkClearance(plates[p1Index], seedPoint, minSpacingRad);
                 }
                 
                 // Check P2
                 let p2Clear = true;
                 const isContCont = t1 === 'continental' && t2 === 'continental';
                 // For divergence, we generally want symmetry
                 if (isContCont || boundary.type === 'divergent') {
                     p2Clear = this.checkClearance(plates[p2Index], seedPoint, minSpacingRad);
                 }

                 if (!p1Clear && !p2Clear) {
                     failCount++;
                     continue; 
                 }
                 if ((isContCont || boundary.type === 'divergent') && (!p1Clear || !p2Clear)) {
                     // Strict Mode: Need space on both sides for nice shared belt/rift
                     failCount++;
                     continue; 
                 }

                 if (!p1Clear && t1 === 'continental' && boundary.type === 'convergent') { failCount++; continue; }
                 
                 // If we got here, we have clearance
                 let didSpawn = false;

                 if (boundary.type === 'convergent') {
                     if (t1 === 'continental' && t2 === 'continental') {
                         // Cont-Cont Collision -> Mountains on BOTH
                         if (p1Clear) plates[p1Index] = this.addFeature(plates[p1Index], 'mountain', seedPoint, boundary.id, currentTime, 'Orogeny Belt');
                         if (p2Clear) plates[p2Index] = this.addFeature(plates[p2Index], 'mountain', seedPoint, boundary.id, currentTime, 'Orogeny Belt');
                         didSpawn = true;
                     }
                     else if (t1 === 'oceanic' && t2 === 'oceanic') {
                         // Oce-Oce -> Older/Denser subducts.
                         const d1 = p1.density || 3.0;
                         const d2 = p2.density || 3.0;
                         const p1Denser = d1 > d2;
                         const overridingIndex = p1Denser ? p2Index : p1Index; 
                         
                         if (this.checkClearance(plates[overridingIndex], seedPoint, minSpacingRad)) {
                            plates[overridingIndex] = this.addFeature(plates[overridingIndex], 'volcano', seedPoint, boundary.id, currentTime, 'Island Arc');
                            didSpawn = true;
                         } else {
                             failCount++;
                         }
                     }
                     else {
                         // Mix -> Oceanic Subducts
                         const contIdx = t1 === 'continental' ? p1Index : p2Index;
                         
                         if (this.checkClearance(plates[contIdx], seedPoint, minSpacingRad)) {
                            plates[contIdx] = this.addFeature(plates[contIdx], 'volcano', seedPoint, boundary.id, currentTime, 'Continental Arc');
                            didSpawn = true;
                         } else {
                             failCount++;
                         }
                     }
                 } else if (boundary.type === 'divergent') {
                     // Divergence -> Spreading Center / Rift
                     // Generally symmetrical
                     const featureType = 'rift';
                     const desc = (t1 === 'oceanic' && t2 === 'oceanic') ? 'Mid-Ocean Ridge' : 'Rift Zone';

                     if (p1Clear) plates[p1Index] = this.addFeature(plates[p1Index], featureType, seedPoint, boundary.id, currentTime, desc);
                     if (p2Clear) plates[p2Index] = this.addFeature(plates[p2Index], featureType, seedPoint, boundary.id, currentTime, desc);
                     didSpawn = true;
                 }

                 if (didSpawn) {
                     modified = true;
                     successCount++;
                     failCount = 0; // Reset fail chain
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

    private checkClearance(plate: TectonicPlate, pos: Coordinate, minRad: number): boolean {
        // Simple linear scan of features. Optimization: Spatial index if needed later.
        for (const f of plate.features) {
            // Only care about orogeny features for spacing
            // FIX: include 'rift' to prevent infinite spawning loop
            if (f.type !== 'mountain' && f.type !== 'volcano' && f.type !== 'rift') continue;
            
            const d = distance(pos, f.position);
            if (d < minRad) return false;
        }
        return true;
    }

    private addFeature(plate: TectonicPlate, type: FeatureType, pos: Coordinate, boundaryId: string, time: number, desc?: string): TectonicPlate {
         const newF: Feature = {
             id: generateId(),
             type: type,
             position: [...pos], // Spread to copy
             originalPosition: [...pos], 
             rotation: 0, // Upright
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

