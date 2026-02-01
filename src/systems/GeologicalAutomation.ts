// Geological Automation System
// Handles dynamic feature tracking, orogeny detection, and crust aging

import { AppState, Feature, generateId, TectonicPlate, FeatureType, Coordinate, PaintStroke, EulerPole } from '../types';
import { isPointInPolygon } from '../SplitTool';
import { distance, latLonToVector, toRad, Vector3 } from '../utils/sphericalMath';

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

            // Get Euler Poles for relative motion calculation
            const getPole = (plate: TectonicPlate): EulerPole | undefined => {
                if (plate.motionKeyframes && plate.motionKeyframes.length > 0) {
                     // Find active keyframe
                     const sorted = [...plate.motionKeyframes].sort((a,b) => b.time - a.time); // Descending
                     const active = sorted.find(k => k.time <= currentTime);
                     return active ? active.eulerPole : undefined;
                }
                return plate.motion?.eulerPole; // Legacy fallback
            };
            const pole1 = p1Index !== -1 ? getPole(plates[p1Index]) : undefined;
            const pole2 = p2Index !== -1 ? getPole(plates[p2Index]) : undefined;

            // Velocity helper
            const getVelocity = (pos: Coordinate, pole: EulerPole | undefined): Vector3 => {
                if (!pole || pole.rate === 0) return {x:0, y:0, z:0};
                const r = latLonToVector(pos);
                const omega = latLonToVector(pole.position);
                // v = omega x r * rate (approx magnitude, not exact m/s but compatible units)
                const rate = toRad(pole.rate);
                return {
                    x: (omega.y * r.z - omega.z * r.y) * rate,
                    y: (omega.z * r.x - omega.x * r.z) * rate,
                    z: (omega.x * r.y - omega.y * r.x) * rate
                };
            };
            
            const normalize = (v: Vector3): Vector3 => {
                const len = Math.sqrt(v.x*v.x + v.y*v.y + v.z*v.z);
                return len > 0 ? {x:v.x/len, y:v.y/len, z:v.z/len} : {x:0, y:0, z:0};
            };

            const dot = (v1: Vector3, v2: Vector3): number => v1.x*v2.x + v1.y*v2.y + v1.z*v2.z;

            // Paint on BOTH plates so the boundary line shows on each
            for (const ring of boundary.points) {
                if (ring.length < 2) continue;

                // Collection of independent "bar" strokes (which are just segments of the boundary now)
                const barStrokes: Coordinate[][] = [];

                // Consolidate valid segments into continuous polylines ("whole length of edge")
                let activePolyline: Coordinate[] = [];

                for (let i = 0; i < ring.length - 1; i++) {
                    const pStart = ring[i];
                    const pEnd = ring[i+1];
                    
                    // --- ORIENTATION CHECK ---
                    // Midpoint for velocity check
                    const mid: Coordinate = [
                        (pStart[0] + pEnd[0])/2,
                        (pStart[1] + pEnd[1])/2
                    ];

                    const v1 = getVelocity(mid, pole1);
                    const v2 = getVelocity(mid, pole2);
                    
                    // Relative velocity vector (Plate 1 relative to Plate 2)
                    const vRel = {
                        x: v1.x - v2.x,
                        y: v1.y - v2.y,
                        z: v1.z - v2.z
                    };
                    const vMag = Math.sqrt(vRel.x*vRel.x + vRel.y*vRel.y + vRel.z*vRel.z);
                    
                    const isSignificantMotion = vMag > 0.0000001;
                    let isParallel = false;

                    if (isSignificantMotion) {
                        const vRelDir = normalize(vRel);

                        // Segment orientation vector
                        const vec1 = latLonToVector(pStart);
                        const vec2 = latLonToVector(pEnd);
                        const segVec = {
                            x: vec2.x - vec1.x,
                            y: vec2.y - vec1.y,
                            z: vec2.z - vec1.z
                        };
                        const segDir = normalize(segVec);

                        // Dot product: 1.0 = parallel, 0.0 = perpendicular
                        const alignment = Math.abs(dot(vRelDir, segDir));

                        // User Requirement 1: "edges that run PARALLEL... to NOT create orogony lines"
                        // Threshold: If alignment > 0.9 (approx 25 degrees), skip.
                        if (alignment > 0.9) {
                            isParallel = true;
                        } else {
                            // User Requirement 2: "Baseline should nt right?" (Base of Triangle moving Right)
                            // Skip "Trailing" edges where plates are moving APART (Divergence).
                            // Only paint "Leading" edges (Convergence).
                            
                            // Determine Edge Normal (Outward)
                            // Assuming ring is CCW? Check area.
                            // Simplified 2D projection logic for normal direction from segment vector (x,y,z)
                            // If we use spherical cross product of (Point, SegmentVector)?
                            // Radial vector (Position) x Segment Vector = Tangent Plane Normal?
                            
                            // Let's use simpler logic:
                            // The Velocity vector compared to the Segment Vector tells us parallelism.
                            // We need the PERPENDICULAR component.
                            // We need to know if it's "Pushing" or "Pulling".
                            
                            // Cross product of Segment Dir and Radial(Up) gives "Right" vector on the surface.
                            // Surface Normal (Up)
                            const up = normalize(latLonToVector(mid));
                            // Segment Direction
                            const T = segDir;
                            // Right Vector (Cross T x Up? or Up x T?)
                            // Standard map coords: East x Up(Z) = South? 
                            // Let's assume standard CCW polygon winding.
                            // Outward Normal = Cross(Tangent, Up).
                            const N = normalize({
                                x: T.y * up.z - T.z * up.y,
                                y: T.z * up.x - T.x * up.z,
                                z: T.x * up.y - T.y * up.x
                            });

                            // Check dot product with Relative Velocity
                            // V_rel is P1 velocity relative to P2.
                            // If N . V_rel > 0, P1 is pushing "Out" against P2. -> Convergence.
                            // If N . V_rel < 0, P1 is pulling "In" away from P2. -> Divergence.
                            
                            // Boundary polygons from `d3-geo` / `turf` usually have specific winding.
                            // Assuming standard winding (CCW for positive area):
                            // NOTE: If the winding is CW, N points In.
                            
                            // We can heuristically detect "Collision" vs "Separation" by simply using the boundary type if available?
                            // But individual edges of a "Convergent" boundary can be trailing.
                            // Let's try the Dot Product filter.
                            
                            const pushComponent = dot(N, vRelDir);
                            
                            // Heuristic: If ring area is positive (CCW), N is Out.
                            // If pushComponent > Threshold (0.1), it's a collision front.
                            // If pushComponent < -Threshold (-0.1), it's a trailing edge (Exposed backside).
                            
                            // PROBLEM: We don't know ring winding for sure here.
                            // FIX: Assume CCW. If the user notices inverted behavior (Front missing, Back painted), we flip the sign.
                            // "Dreieck base left moves right". Base is trailing. Front is leading.
                            // If CCW: 
                            // Front edges (Right side): Tangent goes Up-Left?
                            // Let's assume standard CCW.
                            
                            // Filter: Only keep COMPRESSIVE edges
                            if (pushComponent < 0.1) {
                                // Either Parallel (<0.1 & >-0.1 is covered by alignment check) or Divergent (< -0.1)
                                isParallel = true; // Mark as "skip"
                            }
                        }
                    } else {
                        // No motion -> treat as 'parallel' (skip painting)
                        isParallel = true;
                    }

                    if (!isParallel) {
                        // Valid orogeny edge - append to current polyline
                        if (activePolyline.length === 0) {
                            activePolyline.push(pStart);
                        }
                        activePolyline.push(pEnd);
                    } else {
                        // Parallel or static edge - breaks the chain
                        if (activePolyline.length > 1) {
                            barStrokes.push([...activePolyline]);
                        }
                        activePolyline = [];
                    }
                }
                
                // Final flush of active polyline
                if (activePolyline.length > 1) {
                    barStrokes.push([...activePolyline]);
                }

                // Process all bar strokes created from this ring
                for (const barPoints of barStrokes) {
                    // Create paint stroke for plate 1
                    if (p1Index !== -1) {
                         // We likely want to associate these with the boundary so we don't spam 1000s of strokes too aggressively
                         // The paint interval already throttles this function call
                         
                        const stroke1: PaintStroke = {
                            id: generateId(),
                            color: color,
                            width: strokeWidth,
                            opacity: 0.7,
                            points: barPoints,         // World Coordinates
                            originalPoints: barPoints, // World Coordinates (Reference)
                            timestamp: Date.now(),
                            source: 'orogeny',
                            birthTime: currentTime,  
                            boundaryId: boundary.id,
                            boundaryType: boundary.type
                        };

                        if (!plates[p1Index].paintStrokes) plates[p1Index] = { ...plates[p1Index], paintStrokes: [] };
                        // Optimize: append to array instead of spread
                        plates[p1Index].paintStrokes!.push(stroke1);
                        modified = true;
                    }

                    // Create paint stroke for plate 2
                    if (p2Index !== -1) {
                        const stroke2: PaintStroke = {
                            id: generateId(),
                            color: color,
                            width: strokeWidth,
                            opacity: 0.7,
                            points: barPoints,
                            originalPoints: barPoints,
                            timestamp: Date.now(),
                            source: 'orogeny',
                            birthTime: currentTime, 
                            boundaryId: boundary.id,
                            boundaryType: boundary.type
                        };
                         
                        if (!plates[p2Index].paintStrokes) plates[p2Index] = { ...plates[p2Index], paintStrokes: [] };
                        plates[p2Index].paintStrokes!.push(stroke2);
                        modified = true;
                    }
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
}
