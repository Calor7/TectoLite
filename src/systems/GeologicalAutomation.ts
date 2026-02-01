// Geological Automation System
// Handles dynamic feature tracking, orogeny detection, and crust aging

import { AppState, Feature, generateId, TectonicPlate, FeatureType, Coordinate, PaintStroke } from '../types';
import { isPointInPolygon } from '../SplitTool';
import { distance } from '../utils/sphericalMath';

export class GeologicalAutomationSystem {
    private boundaryCooldowns: Map<string, number> = new Map();
    private paintCooldowns: Map<string, number> = new Map(); // Cooldown for paint strokes per boundary

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
        
        // AGGRESSIVE SAFETY LIMITS
        const MAX_RINGS = 10;
        const MAX_SEGMENTS = 100;
        let segmentCount = 0;

        const ringsToProcess = rings.slice(0, MAX_RINGS);

        for (const ring of ringsToProcess) {
            if (ring.length < 2) continue;
            if (segmentCount >= MAX_SEGMENTS) break;
            
            const step = ring.length > 50 ? Math.ceil(ring.length / 25) : 1;

            for (let i = 0; i < ring.length - step && segmentCount < MAX_SEGMENTS; i += step) {
                const p1 = ring[i];
                const p2 = ring[i+step];
                
                // Validate coordinates
                if (!p1 || !p2) continue;
                if (isNaN(p1[0]) || isNaN(p1[1]) || isNaN(p2[0]) || isNaN(p2[1])) continue;
                
                // Calculate distance in radians (great circle)
                const d = distance(p1, p2);
                
                // Skip effectively zero-length segments or artifacts
                if (d > 0.000001 && !isNaN(d) && isFinite(d)) { 
                    segments.push({ p1, p2, length: d });
                    totalLength += d;
                    segmentCount++;
                }
            }
        }

        if (segments.length === 0 || totalLength === 0 || !isFinite(totalLength)) return null;

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
        try {
            // Use existing boundaries from state if available, otherwise detect (fallback)
            let boundaries = state.world.boundaries;
            if (!boundaries || boundaries.length === 0) {
                return state; // No boundaries = no processing. Don't call detectBoundaries here.
            }
            
            // Filter for active boundaries (convergent and divergent)
            const collisions = boundaries.filter(b => b.type === 'convergent' || b.type === 'divergent');
            
            if (collisions.length === 0) return state;

            // Check mode: paint or features
            const mode = state.world.globalOptions.orogenyMode || 'features';
            if (mode === 'paint') {
                return this.processOrogeniesPaint(state, collisions);
            }

            let modified = false;
            let plates = [...state.world.plates];
            const currentTime = state.world.currentTime;

            // FRAME BUDGET: Prevent any single frame from taking too long
            const frameStartTime = performance.now();
            const MAX_FRAME_MS = 20; // Reduced to 20ms for safety

            for (const boundary of collisions) {
                 // Frame budget check - bail if we've spent too long
                 if (performance.now() - frameStartTime > MAX_FRAME_MS) {
                     break;
                 }

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

             // SAFETY: Skip boundaries with excessive vertex count (indicates problematic geometry)
             let totalVertices = 0;
             for (const ring of boundary.points) {
                 totalVertices += ring.length;
             }
             if (totalVertices > 500) continue; // Skip overly complex boundaries

             // PHYSICAL LENGTH THRESHOLD CHECK
             // Calculate the actual length of the collision/divergence boundary in radians
             // OPTIMIZATION: Limit iterations to prevent freeze on complex geometry
             let boundaryLengthRad = 0;
             let iterCount = 0;
             const MAX_ITER = 200;
             outerLoop:
             for (const ring of boundary.points) {
                 for (let k = 0; k < ring.length - 1; k++) {
                     if (++iterCount > MAX_ITER) break outerLoop;
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
                 // Frame budget check inside inner loop too
                 if (performance.now() - frameStartTime > MAX_FRAME_MS) break;

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
        } catch (e) {
            // Safety catch - if anything goes wrong, return unchanged state
            console.error('Orogeny processing error:', e);
            return state;
        }
    }

    private checkClearance(plate: TectonicPlate, pos: Coordinate, minRad: number): boolean {
        // Validate inputs to prevent NaN/Infinity issues
        if (!pos || !Array.isArray(pos) || pos.length < 2) return false;
        if (isNaN(pos[0]) || isNaN(pos[1])) return false;
        if (!isFinite(minRad) || minRad <= 0) return true; // Invalid radius = allow spawn
        
        // Limit feature scan to prevent freeze on plates with thousands of features
        const maxCheck = Math.min(plate.features.length, 500);
        
        for (let i = 0; i < maxCheck; i++) {
            const f = plate.features[i];
            // Only care about orogeny features for spacing
            // FIX: include 'rift' to prevent infinite spawning loop
            if (f.type !== 'mountain' && f.type !== 'volcano' && f.type !== 'rift') continue;
            
            // Validate feature position
            if (!f.position || isNaN(f.position[0]) || isNaN(f.position[1])) continue;
            
            const d = distance(pos, f.position);
            if (isNaN(d)) continue; // Skip invalid distance
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

    /**
     * Paint mode: Draw strokes along boundary outlines
     * Color = boundary type, Density = based on velocity (faster = more strokes)
     */
    private processOrogeniesPaint(state: AppState, boundaries: typeof state.world.boundaries): AppState {
        if (!boundaries || boundaries.length === 0) return state;

        const currentTime = state.world.currentTime;
        let modified = false;
        let plates = [...state.world.plates];

        // Get colors from settings
        const convergentColor = state.world.globalOptions.orogenyPaintConvergent || '#8B4513'; // Brown
        const divergentColor = state.world.globalOptions.orogenyPaintDivergent || '#DC143C';   // Crimson

        for (const boundary of boundaries) {
            if (!boundary.points || boundary.points.length === 0) continue;

            // Velocity-based paint rate:
            // Higher velocity = more frequent painting (denser strokes)
            // Velocity in rad/Ma: 0.001 ~= 0.6 cm/yr
            const velocity = boundary.velocity || 0.001;
            
            // Paint cooldown based on velocity:
            // Fast (>0.005): paint every 0.02 Ma
            // Medium (0.002-0.005): paint every 0.05 Ma
            // Slow (<0.002): paint every 0.1 Ma
            let paintInterval = 0.1;
            if (velocity > 0.005) paintInterval = 0.02;
            else if (velocity > 0.002) paintInterval = 0.05;

            // Check cooldown
            const cooldownKey = boundary.id;
            const lastPaint = this.paintCooldowns.get(cooldownKey) || -9999;
            if (currentTime - lastPaint < paintInterval) continue;

            // Stroke width based on velocity (1-4 pixels)
            const strokeWidth = Math.min(4, Math.max(1, Math.floor(velocity * 500)));
            
            // Color based on boundary type
            const color = boundary.type === 'convergent' ? convergentColor : divergentColor;

            // Get the two plates involved
            const [id1, id2] = boundary.plateIds;
            const p1Index = plates.findIndex(p => p.id === id1);
            const p2Index = plates.findIndex(p => p.id === id2);
            if (p1Index === -1 && p2Index === -1) continue;

            // Convert boundary points to plate-local coordinates and add as strokes
            // Paint on BOTH plates so the boundary line shows on each
            for (const ring of boundary.points) {
                if (ring.length < 2) continue;

                // Create paint stroke for plate 1
                if (p1Index !== -1) {
                    const p1 = plates[p1Index];
                    const localPoints1 = ring.map(pt => this.worldToPlateLocal(pt, p1.center));
                    
                    const stroke1: PaintStroke = {
                        id: generateId(),
                        color: color,
                        width: strokeWidth,
                        opacity: 0.7,
                        points: localPoints1,
                        timestamp: Date.now(),
                        source: 'orogeny',
                        birthTime: currentTime  // Track when this stroke was created
                    };

                    if (!plates[p1Index].paintStrokes) plates[p1Index] = { ...plates[p1Index], paintStrokes: [] };
                    plates[p1Index] = {
                        ...plates[p1Index],
                        paintStrokes: [...(plates[p1Index].paintStrokes || []), stroke1]
                    };
                    modified = true;
                }

                // Create paint stroke for plate 2
                if (p2Index !== -1) {
                    const p2 = plates[p2Index];
                    const localPoints2 = ring.map(pt => this.worldToPlateLocal(pt, p2.center));
                    
                    const stroke2: PaintStroke = {
                        id: generateId(),
                        color: color,
                        width: strokeWidth,
                        opacity: 0.7,
                        points: localPoints2,
                        timestamp: Date.now(),
                        source: 'orogeny',
                        birthTime: currentTime  // Track when this stroke was created
                    };

                    if (!plates[p2Index].paintStrokes) plates[p2Index] = { ...plates[p2Index], paintStrokes: [] };
                    plates[p2Index] = {
                        ...plates[p2Index],
                        paintStrokes: [...(plates[p2Index].paintStrokes || []), stroke2]
                    };
                    modified = true;
                }
            }

            // Update cooldown
            this.paintCooldowns.set(cooldownKey, currentTime);
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

    /**
     * Convert world coordinates to plate-local coordinates
     * (Relative to plate center for transform invariance)
     */
    private worldToPlateLocal(worldCoord: Coordinate, plateCenter: Coordinate): Coordinate {
        return [
            worldCoord[0] - plateCenter[0],
            worldCoord[1] - plateCenter[1]
        ];
    }
}

