import { AppState, TectonicPlate, Coordinate, Feature, PaintStroke, Landmass, generateId } from './types';
import polygonClipping from 'polygon-clipping';
import {
    toRad,
    latLonToVector,
    vectorToLatLon,
    rotateVector,
    calculateSphericalCentroid,
    Vector3
} from './utils/sphericalMath';
import { BoundarySystem } from './BoundarySystem';
import { GeologicalAutomationSystem } from './systems/GeologicalAutomation';
import { ElevationSystem } from './systems/ElevationSystem';
import { EventEffectsProcessor } from './systems/EventEffectsProcessor';
import { eventSystem } from './systems/EventSystem';


export class SimulationEngine {
    private isRunning = false;
    private lastUpdate = 0;
    private animationId: number | null = null;
    private geologicalAutomation: GeologicalAutomationSystem;
    private elevationSystem: ElevationSystem;
    private eventEffectsProcessor: EventEffectsProcessor;

    constructor(
        private getState: () => AppState,
        private setState: (updater: (state: AppState) => AppState) => void
    ) { 
        this.geologicalAutomation = new GeologicalAutomationSystem();
        this.elevationSystem = new ElevationSystem();
        this.eventEffectsProcessor = new EventEffectsProcessor();
    }

    // Helper: Check if a point is inside a spherical polygon using ray casting
    private isPointInPolygon(point: Coordinate, polygon: Coordinate[]): boolean {
        if (polygon.length < 3) return false;

        const pLat = point[1];
        const pLon = point[0];
        let windingNumber = 0;

        let prev = polygon[polygon.length - 1];
        for (let i = 0; i < polygon.length; i++) {
            const curr = polygon[i];
            const lat1 = prev[1];
            const lat2 = curr[1];
            const lon1 = prev[0];
            const lon2 = curr[0];

            if ((lat1 <= pLat && lat2 > pLat) || (lat2 <= pLat && lat1 > pLat)) {
                const t = (pLat - lat1) / (lat2 - lat1);
                let lonAtIntersection = lon1 + t * (lon2 - lon1);

                if (Math.abs(lon2 - lon1) > 180) {
                    if (lon2 < lon1) lonAtIntersection = lon1 + t * (lon2 + 360 - lon1);
                    else lonAtIntersection = lon1 + t * (lon2 - 360 - lon1);
                }

                if (pLon < lonAtIntersection) {
                    windingNumber += (lat2 > lat1) ? 1 : -1;
                }
            }

            prev = curr;
        }

        return windingNumber !== 0;
    }

    public start(): void {
        if (!this.isRunning) {
            this.isRunning = true;
            this.lastUpdate = performance.now();
            this.tick();
        }
    }

    public stop(): void {
        this.isRunning = false;
        if (this.animationId !== null) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
    }

    public toggle(): void {
        if (this.isRunning) {
            this.stop();
        } else {
            this.start();
        }

        this.setState(state => ({
            ...state,
            world: { ...state.world, isPlaying: this.isRunning }
        }));
    }

    public setTime(time: number): void {
        this.setState(state => {
            const { globalOptions } = state.world;
            // Recalculate ALL plates at the new time
            const newPlates = state.world.plates.map(plate => {
                const isBorn = time >= plate.birthTime;
                const isDead = plate.deathTime !== null && time >= plate.deathTime;

                if (!isBorn || isDead || plate.locked) return plate;

                return this.calculatePlateAtTime(plate, time, state.world.plates);
            });

            // Calculate Boundaries if enabled
            // ALWAYS update boundaries if Orogeny OR Elevation OR Visualization OR Guided Creation is enabled.
            // If none are on, clear boundaries to prevent stale artifacts.
            const boundaries = (globalOptions.enableBoundaryVisualization || 
                globalOptions.enableOrogeny || 
                globalOptions.enableElevationSimulation ||
                globalOptions.enableGuidedCreation ||
                globalOptions.pauseOnFusionSuggestion)
                ? BoundarySystem.detectBoundaries(newPlates, time)
                : [];

            // Phase 4: Geological Automation
            const tempState = {
                ...state,
                world: {
                    ...state.world,
                    plates: newPlates,
                    boundaries: boundaries,
                    currentTime: time
                }
            };
            const postAutomationState = this.geologicalAutomation.update(tempState);
            
            // Phase 5: Event System (detect tectonic events for guided creation)
            const postEventState = eventSystem.update(postAutomationState);
            const postEffectState = this.eventEffectsProcessor.update(postEventState);
            
            // Phase 6: Elevation System (use signed deltaT to detect direction)
            const deltaT = time - state.world.currentTime;
            const finalState = this.elevationSystem.update(postEffectState, deltaT);

            return finalState;
        });
        this.updateFlowlines();
    }

    public setTimeScale(scale: number): void {
        this.setState(state => ({
            ...state,
            world: { ...state.world, timeScale: scale }
        }));
    }

    private tick(): void {
        if (!this.isRunning) return;

        const now = performance.now();
        const deltaMs = now - this.lastUpdate;
        this.lastUpdate = now;

        const state = this.getState();
        const deltaMa = (deltaMs / 1000) * state.world.timeScale;

        this.update(deltaMa);

        this.animationId = requestAnimationFrame(() => this.tick());
    }

    private update(deltaMa: number): void {
        this.setState(state => {
            const { globalOptions } = state.world;
            const newTime = state.world.currentTime + deltaMa;

            // Re-calculate ALL plates based on absolute time
            // This enables scrubbing/resetting.
            const newPlates = state.world.plates.map(plate => {
                // Check if plate exists at this time
                const isBorn = newTime >= plate.birthTime;
                const isDead = plate.deathTime !== null && newTime >= plate.deathTime;

                // If completely out of scope, we could mark invisible or return special state
                // But generally we just want to update valid ones.
                // For simplicity in UI, we might filter them in the View, or here.
                // Let's keep them in the array but assume Renderer filters by `visible` logic?
                // Or better: update `visible` flag based on time?
                // But `visible` is also a user toggle.
                // Let's just calculate position if valid.

                if (!isBorn) return plate; // Future plate. Keep as is (initial state)
                if (isDead) return plate;  // Past plate. Keep as is (death state). 
                // Note: Ideally dead plates should look like they did at deathTime.
                // But for now, if we scrub past death, they might just disappear (replaced by children).

                if (plate.locked) return plate;

                return this.calculatePlateAtTime(plate, newTime, state.world.plates);
            });

            // Calculate Boundaries if enabled
            // ALWAYS update boundaries if Orogeny OR Elevation OR Visualization OR Guided Creation is enabled.
            // If none are on, clear boundaries to prevent stale artifacts.
            const boundaries = (globalOptions.enableBoundaryVisualization || 
                globalOptions.enableOrogeny || 
                globalOptions.enableElevationSimulation ||
                globalOptions.enableGuidedCreation ||
                globalOptions.pauseOnFusionSuggestion)
                ? BoundarySystem.detectBoundaries(newPlates, newTime)
                : [];
            
            // Phase 3: Geological Automation (during tick)
            const tempState = {
                ...state,
                world: {
                    ...state.world,
                    plates: newPlates,
                    boundaries: boundaries,
                    currentTime: newTime
                }
            };
            const postAutomationState = this.geologicalAutomation.update(tempState);
            
            // Phase 4: Event System (detect tectonic events for guided creation)
            const postEventState = eventSystem.update(postAutomationState);
            const postEffectState = this.eventEffectsProcessor.update(postEventState);
            
            // Phase 5: Elevation System
            const finalState = this.elevationSystem.update(postEffectState, deltaMa);

            return finalState;
        });
        this.updateFlowlines();
    }

    private calculatePlateAtTime(plate: TectonicPlate, time: number, allPlates: TectonicPlate[] = []): TectonicPlate {
        // Check if this plate is linked to a parent plate - if so, inherit parent motion
        let parentLinkedPlate: TectonicPlate | undefined;
        
        if (plate.linkedToPlateId) {
            parentLinkedPlate = allPlates.find(p => p.id === plate.linkedToPlateId);
            
            // Prevent infinite recursion: if parent is also linked back to this plate, break the cycle
            if (parentLinkedPlate && parentLinkedPlate.linkedToPlateId === plate.id) {
                console.warn(`Circular link detected between ${plate.id} and ${parentLinkedPlate.id}, breaking link`);
                parentLinkedPlate = undefined;
            }
        }

        // First, check if we need to inherit features/landmasses/paint from parent plate(s)
        let inheritedFeatures: Feature[] = [];
        let inheritedLandmasses: Landmass[] = [];
        let inheritedPaintStrokes: PaintStroke[] = [];
        const parentIds = plate.parentPlateIds || (plate.parentPlateId ? [plate.parentPlateId] : []);

        // Build a set of existing IDs on the child plate to avoid duplicates
        const existingLandmassIds = new Set((plate.landmasses || []).map(l => l.id));
        const existingStrokeIds = new Set((plate.paintStrokes || []).map(s => s.id));
        // Track inherited source IDs to avoid inheriting the same parent item twice
        const inheritedLandmassSourceIds = new Set<string>();
        const inheritedStrokeSourceIds = new Set<string>();

        for (const pid of parentIds) {
            const parentPlate = allPlates.find(p => p.id === pid);
            if (!parentPlate) continue;

            const transitionTime = plate.birthTime;

            // 1. Inherit Features
            const candidateFeatures = parentPlate.features.filter(f =>
                f.generatedAt !== undefined &&
                f.generatedAt >= parentPlate.birthTime &&
                f.generatedAt <= transitionTime
            );

            const featuresToInherit = candidateFeatures.filter(f => {
                return plate.initialPolygons.some(poly =>
                    this.isPointInPolygon(f.position, poly.points)
                );
            }).filter(f => {
                return !plate.features.some(existing => existing.id === f.id) &&
                    !inheritedFeatures.some(existing => existing.id === f.id);
            });
            inheritedFeatures.push(...featuresToInherit);

            // 2. Inherit Landmasses (with clipping for temporal consistency)
            // Use landmass.polygon (current rotated position) for clipping since it matches parent's current frame
            const candidateLandmasses = (parentPlate.landmasses || []).filter(l =>
                l.birthTime !== undefined &&
                l.birthTime >= parentPlate.birthTime &&
                l.birthTime <= transitionTime
            );

            for (const landmass of candidateLandmasses) {
                // Skip if already inherited from this source
                if (inheritedLandmassSourceIds.has(landmass.id)) continue;
                
                // Create deterministic ID based on parent landmass ID + child plate ID
                const inheritedId = `${landmass.id}_inherit_${plate.id}`;
                
                // Skip if child already has this inherited landmass
                if (existingLandmassIds.has(inheritedId)) continue;
                
                // Use current polygon (rotated to match parent's current position) for clipping
                // This ensures the clip happens in the same reference frame as the child's initialPolygons
                const sourcePoly = landmass.polygon;
                const childPolys: any = plate.initialPolygons.map(p => [p.points.map(pt => [pt[0], pt[1]])]);
                const landmassPoly: any = [[sourcePoly.map(pt => [pt[0], pt[1]])]];
                
                try {
                    const intersected = polygonClipping.intersection(childPolys, landmassPoly);
                    if (intersected && intersected.length > 0) {
                        for (const multiPoly of intersected) {
                            for (const ring of multiPoly) {
                                const points = ring.slice(0, -1).map(pt => [pt[0], pt[1]] as Coordinate);
                                if (points.length >= 3) {
                                    inheritedLandmasses.push({
                                        ...landmass,
                                        id: inheritedId,
                                        polygon: points,
                                        originalPolygon: points, // Reset original to clipped position
                                        birthTime: transitionTime,
                                        linkedToPlateId: plate.id
                                    });
                                    inheritedLandmassSourceIds.add(landmass.id);
                                    break; // Only take first valid ring per landmass
                                }
                            }
                            if (inheritedLandmassSourceIds.has(landmass.id)) break;
                        }
                    }
                } catch (e) {
                     // Fallback to centroid check using current position
                     const centroid = calculateSphericalCentroid(sourcePoly);
                     if (plate.initialPolygons.some(poly => this.isPointInPolygon(centroid, poly.points))) {
                         inheritedLandmasses.push({
                             ...landmass,
                             id: inheritedId,
                             polygon: sourcePoly,
                             originalPolygon: sourcePoly,
                             birthTime: transitionTime,
                             linkedToPlateId: plate.id
                         });
                         inheritedLandmassSourceIds.add(landmass.id);
                     }
                }
            }

            // 3. Inherit Paint Strokes
            const candidateStrokes = (parentPlate.paintStrokes || []).filter(s =>
                s.birthTime !== undefined &&
                s.birthTime >= parentPlate.birthTime &&
                s.birthTime <= transitionTime
            );

            for (const stroke of candidateStrokes) {
                // Skip if already inherited
                if (inheritedStrokeSourceIds.has(stroke.id)) continue;
                
                const inheritedId = `${stroke.id}_inherit_${plate.id}`;
                if (existingStrokeIds.has(inheritedId)) continue;
                
                // Use originalPoints for stable reference
                const sourcePoints = stroke.originalPoints || stroke.points;
                if (sourcePoints.length > 0 && plate.initialPolygons.some(poly => this.isPointInPolygon(sourcePoints[0], poly.points))) {
                    inheritedPaintStrokes.push({
                        ...stroke,
                        id: inheritedId,
                        points: [...sourcePoints],
                        originalPoints: [...sourcePoints],
                        birthTime: transitionTime
                    });
                    inheritedStrokeSourceIds.add(stroke.id);
                }
            }
        }

        // Find the active keyframe for this time (latest keyframe with time <= query time)
        const keyframes = plate.motionKeyframes || [];

        // If no keyframes, fall back to legacy motion from birth
        if (keyframes.length === 0) {
            return this.calculateWithLegacyMotion(plate, time, inheritedFeatures, inheritedLandmasses, inheritedPaintStrokes);
        }

        // Find active keyframe (latest one that starts at or before query time)
        const activeKeyframe = keyframes
            .filter(kf => kf.time <= time)
            .sort((a, b) => b.time - a.time)[0];

        if (!activeKeyframe) {
            // Before first keyframe - use initial geometry but preserve any features added later
            // Merge initialFeatures with any dynamically added features from current plate
            const initialFeatureIds = new Set((plate.initialFeatures || []).map(f => f.id));
            const dynamicFeatures = plate.features.filter(f =>
                !initialFeatureIds.has(f.id) && f.generatedAt !== undefined
            );
            const mergedFeatures = [...(plate.initialFeatures || []), ...dynamicFeatures, ...inheritedFeatures];
            
            // Same for landmasses - filter out any that match inherited IDs to avoid duplicates
            const inheritedLandmassIds = new Set(inheritedLandmasses.map(l => l.id));
            const existingLandmasses = (plate.landmasses || []).filter(l => !inheritedLandmassIds.has(l.id));
            const mergedLandmasses = [...existingLandmasses, ...inheritedLandmasses];

            // Same for strokes
            const inheritedStrokeIds = new Set(inheritedPaintStrokes.map(s => s.id));
            const existingStrokes = (plate.paintStrokes || []).filter(s => !inheritedStrokeIds.has(s.id));
            const mergedStrokes = [...existingStrokes, ...inheritedPaintStrokes];

            return {
                ...plate,
                polygons: plate.initialPolygons,
                features: mergedFeatures,
                landmasses: mergedLandmasses,
                paintStrokes: mergedStrokes,
                center: calculateSphericalCentroid(plate.initialPolygons.flatMap(p => p.points))
            };
        }

        const pole = activeKeyframe.eulerPole;
        const elapsed = time - activeKeyframe.time;

        // Prepare parent motion if this plate is linked to another
        // The parent's rotation affects the child ONLY from linkTime onwards
        // BUT ONLY if we're within the link time window
        let parentTransform: { axis: Vector3; angle: number }[] = [];

        if (parentLinkedPlate) {
            // Check if we're within the link time window
            const isWithinLinkWindow = 
                (!plate.linkTime || time >= plate.linkTime) && 
                (!plate.unlinkTime || time < plate.unlinkTime);
            
            if (isWithinLinkWindow) {
                const parentKeyframes = parentLinkedPlate.motionKeyframes || [];
                const linkStartTime = plate.linkTime || (parentKeyframes[0]?.time ?? 0);
                const motionStartTime = Math.max(linkStartTime, activeKeyframe.time);

                // Build segment-by-segment rotations, accounting for axis changes
                const relevantKeyframes = parentKeyframes.filter(kf => kf.time <= time && kf.time >= motionStartTime);
                
                if (relevantKeyframes.length > 0) {
                    relevantKeyframes.sort((a, b) => a.time - b.time);
                    let prevTime = motionStartTime;
                    
                    for (let i = 0; i < relevantKeyframes.length; i++) {
                        const kf = relevantKeyframes[i];
                        if (kf.eulerPole && kf.eulerPole.rate !== 0) {
                            const pole = kf.eulerPole;
                            const axis = latLonToVector(pole.position);
                            
                            // Determine duration for this segment
                            let segmentEnd = time;
                            // If there's a next keyframe before our current time, stop at that keyframe
                            if (i + 1 < relevantKeyframes.length) {
                                segmentEnd = Math.min(relevantKeyframes[i + 1].time, time);
                            }
                            
                            const duration = segmentEnd - Math.max(kf.time, prevTime);
                            if (duration > 0) {
                                const angle = toRad(pole.rate * duration);
                                parentTransform.push({ axis, angle });
                            }
                            
                            prevTime = segmentEnd;
                        }
                    }
                }
            }
        }

        // Child's own motion uses its own keyframe Euler pole
        let ownAxis: Vector3 | null = null;
        let ownAngle: number = 0;
        if (pole && pole.rate !== 0 && elapsed !== 0) {
            ownAxis = latLonToVector(pole.position);
            ownAngle = toRad(pole.rate * elapsed);
        }

        // Helper to apply a single rotation
        const applyRotation = (coord: Coordinate, axis: Vector3, angle: number): Coordinate => {
            if (angle === 0) return coord;
            const v = latLonToVector(coord);
            const vRot = rotateVector(v, axis, angle);
            return vectorToLatLon(vRot);
        };

        // Helper to apply all active rotations in sequence: parent -> own
        // Parent rotation is applied segment-by-segment if axis changed, then child's own motion on top
        const applyAllRotations = (coord: Coordinate): Coordinate => {
            let result = coord;
            // 1. Apply parent's motion first (inherited motion), segment by segment
            for (const segment of parentTransform) {
                if (segment.angle !== 0) {
                    result = applyRotation(result, segment.axis, segment.angle);
                }
            }
            // 2. Apply child's own motion on top (additional/differential motion)
            if (ownAxis && ownAngle !== 0) {
                result = applyRotation(result, ownAxis, ownAngle);
            }
            return result;
        };

        // Check if we have any motion at all
        const hasParentMotion = parentTransform.length > 0;
        const hasOwnMotion = ownAxis && ownAngle !== 0;
        const hasAnyMotion = hasParentMotion || hasOwnMotion;

        // No motion case
        if (!hasAnyMotion) {
            const snapshotFeatureIds = new Set(activeKeyframe.snapshotFeatures.map(f => f.id));
            const dynamicFeatures = plate.features.filter(f =>
                !snapshotFeatureIds.has(f.id) &&
                f.generatedAt !== undefined &&
                f.generatedAt >= activeKeyframe.time
            );
            
            // Deduplicate landmasses: collect all IDs from snapshot and inherited
            const snapshotLandmassIds = new Set((activeKeyframe.snapshotLandmasses || []).map(l => l.id));
            const inheritedLandmassIds = new Set(inheritedLandmasses.map(l => l.id));
            const allKnownLandmassIds = new Set([...snapshotLandmassIds, ...inheritedLandmassIds]);
            const dynamicLandmasses = (plate.landmasses || []).filter(l => !allKnownLandmassIds.has(l.id));
            // Also filter inherited to not duplicate snapshot
            const filteredInheritedLandmasses = inheritedLandmasses.filter(l => !snapshotLandmassIds.has(l.id));

            // Same for strokes
            const snapshotStrokeIds = new Set((activeKeyframe.snapshotPaintStrokes || []).map(s => s.id));
            const inheritedStrokeIds = new Set(inheritedPaintStrokes.map(s => s.id));
            const allKnownStrokeIds = new Set([...snapshotStrokeIds, ...inheritedStrokeIds]);
            const dynamicStrokes = (plate.paintStrokes || []).filter(s => !allKnownStrokeIds.has(s.id));
            const filteredInheritedStrokes = inheritedPaintStrokes.filter(s => !snapshotStrokeIds.has(s.id));

            return {
                ...plate,
                polygons: activeKeyframe.snapshotPolygons,
                features: [...activeKeyframe.snapshotFeatures, ...dynamicFeatures, ...inheritedFeatures],
                landmasses: [...(activeKeyframe.snapshotLandmasses || []), ...dynamicLandmasses, ...filteredInheritedLandmasses],
                paintStrokes: [...(activeKeyframe.snapshotPaintStrokes || []), ...dynamicStrokes, ...filteredInheritedStrokes],
                center: calculateSphericalCentroid(activeKeyframe.snapshotPolygons.flatMap(p => p.points))
            };
        }

        // Transform with all accumulated rotations
        const transform = (coord: Coordinate): Coordinate => applyAllRotations(coord);

        // Helper: Transform feature with time-aware rotation
        // Features rotate from their creation time, not from keyframe time
        const transformFeature = (feat: Feature, startTime: number, useOriginal: boolean = false): Feature => {
            const featureElapsed = Math.max(0, time - startTime);
            
            // Calculate rotation for this specific feature based on its lifetime
            let result = (useOriginal && feat.originalPosition) ? feat.originalPosition : feat.position;
            
            // Apply parent motion if linked (for the feature's lifetime) AND within link time window
            if (parentTransform.length > 0 && parentLinkedPlate) {
                const isWithinLinkWindow = 
                    (!plate.linkTime || time >= plate.linkTime) && 
                    (!plate.unlinkTime || time < plate.unlinkTime);
                
                if (isWithinLinkWindow) {
                    // Apply parent motion segment by segment
                    for (const segment of parentTransform) {
                        if (segment.angle !== 0) {
                            result = applyRotation(result, segment.axis, segment.angle);
                        }
                    }
                }
            }
            
            // Apply child's own motion
            if (ownAxis && pole) {
                const ownFeatureAngle = toRad(pole.rate * featureElapsed);
                if (ownFeatureAngle !== 0) {
                    result = applyRotation(result, ownAxis, ownFeatureAngle);
                }
            }

            return {
                ...feat,
                position: result,
                originalPosition: feat.originalPosition
            };
        };

        const newPolygons = activeKeyframe.snapshotPolygons.map(poly => ({
            ...poly,
            points: poly.points.map(transform)
        }));

        // Get features from snapshot, then merge any dynamically added features
        // (features with generatedAt > keyframe.time that exist in current plate.features)
        const snapshotFeatureIds = new Set(activeKeyframe.snapshotFeatures.map(f => f.id));
        const dynamicFeatures = plate.features.filter(f =>
            !snapshotFeatureIds.has(f.id) &&
            f.generatedAt !== undefined &&
            f.generatedAt >= activeKeyframe.time
        );

        // Transform snapshot features: Start from Keyframe Time (snapshot state)
        // Use current position (matches snapshot) -> useOriginal = false
        const transformedSnapshotFeatures = activeKeyframe.snapshotFeatures.map(feat =>
            transformFeature(feat, activeKeyframe.time, false)
        );

        // Transform dynamic features: Start from their Creation Time
        // MUST use originalPosition to avoid compounding rotations -> useOriginal = true
        const transformedDynamicFeatures = dynamicFeatures.map(feat =>
            transformFeature(feat, feat.generatedAt!, true)
        );

        // Transform inherited features: Start from Split Time (Plate Birth Time)
        // their position is valid at split snapshot -> useOriginal = false
        const transformedInheritedFeatures = inheritedFeatures.map(feat =>
            transformFeature(feat, plate.birthTime, false)
        );

        const newFeatures = [...transformedSnapshotFeatures, ...transformedDynamicFeatures, ...transformedInheritedFeatures];

        // --- Paint Stroke Transformation ---
        // Identical logic to Features: Snapshot vs Dynamic

        // Helper for Point Arrays (Paint Strokes)
        const transformStroke = (stroke: PaintStroke, startTime: number, useOriginal: boolean = false): PaintStroke => {
             if (!ownAxis || !pole) return stroke; // No own axis or pole means no rotation to apply
             
             const strokeElapsed = Math.max(0, time - startTime);
             const strokeAngle = toRad(pole.rate * strokeElapsed);

             if (strokeAngle === 0) return stroke;

             // Source points: use originalPoints if available and requested
             const sourcePoints = (useOriginal && stroke.originalPoints) ? stroke.originalPoints : stroke.points;

             const newPoints = sourcePoints.map(p => {
                 const v = latLonToVector(p);
                 const vRot = rotateVector(v, ownAxis!, strokeAngle);
                 return vectorToLatLon(vRot);
             });

             return {
                 ...stroke,
                 points: newPoints,
                 originalPoints: stroke.originalPoints // Explicitly preserve
             };
        };

        const snapshotStrokes = activeKeyframe.snapshotPaintStrokes || [];
        const snapshotStrokeIds = new Set(snapshotStrokes.map(s => s.id));
        
        // Filter inherited to not duplicate snapshots
        const inheritedStrokeIds = new Set(inheritedPaintStrokes.map(s => s.id));
        const filteredInheritedStrokes = inheritedPaintStrokes.filter(s => !snapshotStrokeIds.has(s.id));
        const allKnownStrokeIds = new Set([...snapshotStrokeIds, ...inheritedStrokeIds]);
        
        // Filter dynamic strokes (those created after keyframe OR legacy strokes without birthTime)
        const currentStrokes = plate.paintStrokes || [];
        const dynamicStrokes = currentStrokes.filter(s => 
            !allKnownStrokeIds.has(s.id) &&
            (s.birthTime === undefined || s.birthTime >= activeKeyframe.time)
        );

        // Transform Snapshot Strokes (From Keyframe Time, use points as source)
        const transformSnapshotStrokes = snapshotStrokes.map(s => transformStroke(s, activeKeyframe.time, false));

        // Transform Dynamic Strokes (From Birth Time, use originalPoints as source)
        // Fallback to plate birthTime or 0 for legacy strokes
        const transformDynamicStrokes = dynamicStrokes.map(s => transformStroke(s, s.birthTime !== undefined ? s.birthTime : (plate.birthTime || 0), true));

        // Transform Inherited Strokes (From Transition)
        const transformInheritedStrokes = filteredInheritedStrokes.map(s => transformStroke(s, plate.birthTime, false));

        const newPaintStrokes = [...transformSnapshotStrokes, ...transformDynamicStrokes, ...transformInheritedStrokes];

        // --- Landmass Transformation ---
        // Identical logic to Features: Snapshot vs Dynamic
        const transformLandmass = (landmass: any, startTime: number, useOriginal: boolean = false): any => {
             // Only transform if landmass is linked to this plate
             if (landmass.linkedToPlateId && landmass.linkedToPlateId !== plate.id) return landmass;
             // If unlinked, don't transform
             if (!landmass.linkedToPlateId) return landmass;

             const elapsed = Math.max(0, time - startTime);
             const sourcePolygon = (useOriginal && landmass.originalPolygon) ? landmass.originalPolygon : landmass.polygon;
             let newPolygon = sourcePolygon;

             // Apply parent motion
             if (parentTransform.length > 0) {
                 newPolygon = newPolygon.map(pt => {
                     let res = pt;
                     for (const seg of parentTransform) {
                         if (seg.angle !== 0) res = applyRotation(res, seg.axis, seg.angle);
                     }
                     return res;
                 });
             }

             // Apply own motion
             if (ownAxis && pole) {
                 const angle = toRad(pole.rate * elapsed);
                 if (angle !== 0) {
                     newPolygon = newPolygon.map(pt => applyRotation(pt, ownAxis!, angle));
                 }
             }

             return { ...landmass, polygon: newPolygon, originalPolygon: landmass.originalPolygon ?? sourcePolygon };
        };

        const snapshotLandmasses = activeKeyframe.snapshotLandmasses || [];
        const snapshotLandmassIds = new Set(snapshotLandmasses.map(l => l.id));
        
        // Filter inherited to not duplicate snapshots
        const inheritedLandmassIds = new Set(inheritedLandmasses.map(l => l.id));
        const filteredInheritedLandmasses = inheritedLandmasses.filter(l => !snapshotLandmassIds.has(l.id));
        const allKnownLandmassIds = new Set([...snapshotLandmassIds, ...inheritedLandmassIds]);
        
        // Filter dynamic landmasses (those created after keyframe), excluding known IDs
        const currentLandmassesList = plate.landmasses || [];
        const dynamicLandmasses = currentLandmassesList.filter(l => 
            !allKnownLandmassIds.has(l.id) &&
            (l.birthTime === undefined || l.birthTime >= activeKeyframe.time)
        );

        // Transform Snapshots (From Keyframe Time)
        const transformedSnapshotLandmasses = snapshotLandmasses.map(l => transformLandmass(l, activeKeyframe.time, false));

        // Transform Dynamics (From Birth Time or Plate Birth Time)
        const transformedDynamicLandmasses = dynamicLandmasses.map(l => transformLandmass(l, l.birthTime !== undefined ? l.birthTime : plate.birthTime, true));

        // Transform Inherited (From Transition)
        const transformedInheritedLandmasses = filteredInheritedLandmasses.map(l => transformLandmass(l, plate.birthTime, false));

        const newLandmasses = [...transformedSnapshotLandmasses, ...transformedDynamicLandmasses, ...transformedInheritedLandmasses];

        // --- Mesh Vertex Transformation ---
        // Transform mesh vertices to follow plate rotation
        // CHANGED: Use incremental update from last simulated time to prevent history rewriting issues
        let newCrustMesh = plate.crustMesh;
        if (plate.crustMesh && plate.crustMesh.length > 0 && ownAxis && pole) {
            // Determine the time the current mesh positions are valid for
            const meshTime = plate.elevationSimulatedTime !== undefined ? plate.elevationSimulatedTime : plate.birthTime;
            
            // Calculate elapsed time since last update
            const dt = time - meshTime;
            const meshAngle = toRad(pole.rate * dt);
            
            // Only rotate if there is a time delta and a rate (and use small threshold to avoid jitter)
            if (Math.abs(meshAngle) > 1e-9) {
                newCrustMesh = plate.crustMesh.map(vertex => {
                    // Always use current 'pos' as the source for incremental update
                    const v = latLonToVector(vertex.pos);
                    const vRot = rotateVector(v, ownAxis!, meshAngle);
                    return {
                        ...vertex,
                        pos: vectorToLatLon(vRot)
                    };
                });
            }
        }

        const allPoints = newPolygons.flatMap(poly => poly.points);
        const newCenter = calculateSphericalCentroid(allPoints);

        const updatedPlate = {
            ...plate,
            polygons: newPolygons,
            features: newFeatures,
            paintStrokes: newPaintStrokes,
            crustMesh: newCrustMesh,
            landmasses: newLandmasses,
            center: newCenter
        };

        return updatedPlate;
    }

    // Legacy fallback for plates without keyframes
    private calculateWithLegacyMotion(
        plate: TectonicPlate, 
        time: number, 
        inheritedFeatures: Feature[] = [],
        inheritedLandmasses: Landmass[] = [],
        inheritedPaintStrokes: PaintStroke[] = []
    ): TectonicPlate {
        const pole = plate.motion?.eulerPole;
        const elapsed = time - plate.birthTime;

        if (!pole || pole.rate === 0 || elapsed === 0) {
            return {
                ...plate,
                polygons: plate.initialPolygons || plate.polygons,
                features: [...(plate.initialFeatures || plate.features), ...inheritedFeatures],
                landmasses: [...(plate.landmasses || []), ...inheritedLandmasses],
                paintStrokes: [...(plate.paintStrokes || []), ...inheritedPaintStrokes],
                center: plate.center
            };
        }

        const axis = latLonToVector(pole.position);
        const angle = toRad(pole.rate * elapsed);

        const transform = (coord: Coordinate): Coordinate => {
            const v = latLonToVector(coord);
            const vRot = rotateVector(v, axis, angle);
            return vectorToLatLon(vRot);
        };

        // Transform helper: STRICTLY uses the provided startTime.
        const transformFeature = (feat: Feature, startTime: number, useOriginal: boolean = false): Feature => {
            const featureElapsed = Math.max(0, time - startTime);
            const featureAngle = toRad(pole.rate * featureElapsed);

            if (featureAngle === 0) {
                return feat;
            }

            const sourcePos = (useOriginal && feat.originalPosition) ? feat.originalPosition : feat.position;
            const v = latLonToVector(sourcePos);
            const vRot = rotateVector(v, axis, featureAngle);
            return {
                ...feat,
                position: vectorToLatLon(vRot),
                originalPosition: feat.originalPosition
            };
        };

        const sourcePolys = plate.initialPolygons || plate.polygons;
        // Use current features (which include dynamically added ones) instead of only initialFeatures
        const sourceFeats = plate.features;

        const newPolygons = sourcePolys.map(poly => ({
            ...poly,
            points: poly.points.map(transform)
        }));

        // Transform plate features: Use their own generatedAt (or plate birth if missing)
        // Dynamic features use originalPosition (true)
        const transformedPlateFeatures = sourceFeats.map(feat =>
            transformFeature(feat, feat.generatedAt ?? plate.birthTime, true)
        );

        // Transform inherited features: Use Plate Birth Time (Split Time)
        // Position is valid at split. useOriginal = false
        const transformedInheritedFeatures = inheritedFeatures.map(feat =>
            transformFeature(feat, plate.birthTime, false)
        );

        const newFeatures = [...transformedPlateFeatures, ...transformedInheritedFeatures];

        // Transform mesh vertices from originalPos to avoid compounding
        let newCrustMesh = plate.crustMesh;
        if (plate.crustMesh && plate.crustMesh.length > 0 && angle !== 0) {
            newCrustMesh = plate.crustMesh.map(vertex => {
                // Use originalPos as source of truth, fallback to pos for legacy data
                const sourcePos = vertex.originalPos || vertex.pos;
                const v = latLonToVector(sourcePos);
                const vRot = rotateVector(v, axis, angle);
                return {
                    ...vertex,
                    pos: vectorToLatLon(vRot)
                };
            });
        }

        // Transform landmasses (legacy motion)
        // First, filter out inherited IDs from plate's existing landmasses to avoid duplicates
        const inheritedLandmassIds = new Set(inheritedLandmasses.map(l => l.id));
        let newLandmassesList = (plate.landmasses || []).filter(l => !inheritedLandmassIds.has(l.id));
        let transformedLandmasses = newLandmassesList.map(landmass => {
            // Only transform if landmass is linked to this plate
            if (!landmass.linkedToPlateId || landmass.linkedToPlateId !== plate.id) {
                return landmass;
            }

            const landmassStartTime = landmass.birthTime ?? plate.birthTime;
            const landmassElapsed = Math.max(0, time - landmassStartTime);
            const landmassAngle = toRad(pole.rate * landmassElapsed);

            if (landmassAngle === 0) return landmass;

            const sourcePolygon = landmass.originalPolygon ?? landmass.polygon;
            const newPolygon = sourcePolygon.map(pt => {
                const v = latLonToVector(pt);
                const vRot = rotateVector(v, axis, landmassAngle);
                return vectorToLatLon(vRot);
            });

            return {
                ...landmass,
                polygon: newPolygon,
                originalPolygon: landmass.originalPolygon ?? sourcePolygon
            };
        });

        // Add transformed inherited landmasses
        const transformedInheritedLandmasses = inheritedLandmasses.map(l => {
             const lElapsed = Math.max(0, time - plate.birthTime);
             const lAngle = toRad(pole.rate * lElapsed);
             if (lAngle === 0) return l;
             const newPoly = l.polygon.map(pt => {
                 const v = latLonToVector(pt);
                 const vRot = rotateVector(v, axis, lAngle);
                 return vectorToLatLon(vRot);
             });
             return { ...l, polygon: newPoly };
        });
        
        const finalLandmasses = [...transformedLandmasses, ...transformedInheritedLandmasses];

        // Transform paint strokes (legacy motion)
        // First, filter out inherited IDs from plate's existing strokes to avoid duplicates
        const inheritedStrokeIds = new Set(inheritedPaintStrokes.map(s => s.id));
        let sourceStrokes = (plate.paintStrokes || []).filter(s => !inheritedStrokeIds.has(s.id));
        let transformedStrokes = sourceStrokes.map(stroke => {
             const sElapsed = Math.max(0, time - (stroke.birthTime ?? plate.birthTime));
             const sAngle = toRad(pole.rate * sElapsed);
             if (sAngle === 0) return stroke;
             const srcPoints = stroke.originalPoints ?? stroke.points;
             const nPoints = srcPoints.map(pt => {
                 const v = latLonToVector(pt);
                 const vRot = rotateVector(v, axis, sAngle);
                 return vectorToLatLon(vRot);
             });
             return { ...stroke, points: nPoints, originalPoints: srcPoints };
        });

        // Add transformed inherited strokes
        const transformedInheritedStrokes = inheritedPaintStrokes.map(s => {
             const sElapsed = Math.max(0, time - plate.birthTime);
             const sAngle = toRad(pole.rate * sElapsed);
             if (sAngle === 0) return s;
             const nPoints = s.points.map(pt => {
                 const v = latLonToVector(pt);
                 const vRot = rotateVector(v, axis, sAngle);
                 return vectorToLatLon(vRot);
             });
             return { ...s, points: nPoints };
        });

        const finalStrokes = [...transformedStrokes, ...transformedInheritedStrokes];

        const allPoints = newPolygons.flatMap(poly => poly.points);
        const newCenter = calculateSphericalCentroid(allPoints);

        const updatedPlate = {
            ...plate,
            polygons: newPolygons,
            features: newFeatures,
            crustMesh: newCrustMesh,
            landmasses: finalLandmasses,
            paintStrokes: finalStrokes,
            center: newCenter
        };

        return updatedPlate;
    }

    public recalculateMotionHistory(plate: TectonicPlate): TectonicPlate {
        // 1. Sort Keyframes
        const keyframes = [...(plate.motionKeyframes || [])].sort((a, b) => a.time - b.time);

        // 2. Start from Initial State (Birth)
        // Ensure we strictly use the Source of Truth: initialPolygons
        let currentPolygons = plate.initialPolygons;
        let currentFeatures = plate.initialFeatures || [];
        let currentLandmasses = plate.landmasses || [];

        // Also need to handle inherited features if we want to be perfect, 
        // but typically initialFeatures includes them if the plate was properly initialized.
        // For recalculation, we assume initialFeatures + initialPolygons is the text-book definition at birthTime.

        const newKeyframes: import('./types').MotionKeyframe[] = [];

        // 3. Iterate to rebuild snapshots
        for (let i = 0; i < keyframes.length; i++) {
            const kf = keyframes[i];

            // Calculate state AT this keyframe's time
            // Based on PREVIOUS keyframe's motion

            if (i === 0) {
                // First keyframe.
                // If it starts exactly at birth, snapshot is initial state.
                // If it starts later, and there was NO previous motion, it's still initial state.
                // (Assumes no "implicit" motion before first keyframe).

                newKeyframes.push({
                    ...kf,
                    snapshotPolygons: currentPolygons,
                    snapshotFeatures: currentFeatures,
                    snapshotLandmasses: currentLandmasses.length > 0 ? currentLandmasses : undefined
                });
            } else {
                // Subsequent keyframe
                const prevKf = newKeyframes[i - 1];
                const delta = kf.time - prevKf.time;

                if (delta < 0) {
                    console.warn(`Negative time delta in plate ${plate.id}`);
                    continue;
                }

                // Rotate from Previous Snapshot using Previous Pole
                const axis = latLonToVector(prevKf.eulerPole.position);
                const angle = toRad(prevKf.eulerPole.rate * delta);

                const transform = (coord: Coordinate): Coordinate => {
                    const v = latLonToVector(coord);
                    const vRot = rotateVector(v, axis, angle);
                    return vectorToLatLon(vRot);
                };

                // Rotate Polygons
                const nextPolygons = prevKf.snapshotPolygons.map(poly => ({
                    ...poly,
                    points: poly.points.map(transform)
                }));

                // Rotate Features (Only those present in snapshot)
                const transformFeature = (f: Feature): Feature => {
                    const fV = latLonToVector(f.position);
                    const fRot = rotateVector(fV, axis, angle);
                    return { ...f, position: vectorToLatLon(fRot) };
                };

                const nextFeatures = prevKf.snapshotFeatures.map(transformFeature);

                // Rotate Landmasses
                const transformLandmass = (l: Landmass): Landmass => {
                    const nextPolygon = l.polygon.map(transform);
                    return { ...l, polygon: nextPolygon };
                };
                const nextLandmasses = (prevKf.snapshotLandmasses || []).map(transformLandmass);

                newKeyframes.push({
                    ...kf,
                    snapshotPolygons: nextPolygons,
                    snapshotFeatures: nextFeatures,
                    snapshotLandmasses: nextLandmasses.length > 0 ? nextLandmasses : undefined
                });

                // Update for next iteration
                currentPolygons = nextPolygons;
                currentFeatures = nextFeatures;
                currentLandmasses = nextLandmasses;
            }
        }

        return {
            ...plate,
            motionKeyframes: newKeyframes
        };
    }

    private updateFlowlines(): void {
        this.setState(state => {
            const plates = state.world.plates;
            const currentTime = state.world.currentTime;
            const fadeDuration = state.world.globalOptions.flowlineFadeDuration || 100;
            const autoDelete = state.world.globalOptions.flowlineAutoDelete !== false;
            
            const newPlates = plates.map(plate => {
                const flowlines = plate.features.filter(f => f.type === 'flowline');
                if (flowlines.length === 0) return plate;
                const newFeatures = plate.features.map(f => {
                    if (f.type !== 'flowline') return f;
                    const startTime = f.generatedAt || plate.birthTime;
                    const origin = f.originalPosition || f.position;
                    const points: Coordinate[] = [];
                    const step = 5;
                    for (let t = startTime; t <= currentTime; t += step) {
                        points.push(this.getPointPositionAtTime(origin, plate.id, t, plates));
                    }
                    points.push(this.getPointPositionAtTime(origin, plate.id, currentTime, plates));
                    
                    // Calculate age and set death time if auto-delete is enabled
                    const age = currentTime - startTime;
                    let updatedFeature = { ...f, trail: points };
                    
                    // If auto-delete is enabled and flowline has reached full transparency, set death time
                    if (autoDelete && age >= fadeDuration && !updatedFeature.deathTime) {
                        updatedFeature = { ...updatedFeature, deathTime: currentTime };
                    }
                    
                    return updatedFeature;
                });
                return { ...plate, features: newFeatures };
            });
            return { ...state, world: { ...state.world, plates: newPlates } };
        });
    }

    private getPointPositionAtTime(point: Coordinate, plateId: string, time: number, allPlates: TectonicPlate[]): Coordinate {
        const plate = allPlates.find(p => p.id === plateId);
        if (!plate) return point;
        let currentPos = point;
        let currentTime = plate.birthTime;
        if (time <= currentTime) return point;
        const keyframes = [...(plate.motionKeyframes || [])].sort((a, b) => a.time - b.time);
        for (let i = 0; i < keyframes.length; i++) {
            const kf = keyframes[i];
            const nextKfTime = (i + 1 < keyframes.length) ? keyframes[i + 1].time : Infinity;
            if (kf.time > time) break;
            const intervalStart = Math.max(currentTime, kf.time);
            const intervalEnd = Math.min(time, nextKfTime);
            if (intervalEnd > intervalStart) {
                const pole = kf.eulerPole;
                if (pole && pole.rate !== 0) {
                    const elapsed = intervalEnd - kf.time;
                    const axis = latLonToVector(pole.position);
                    const angle = toRad(pole.rate * elapsed);
                    currentPos = vectorToLatLon(rotateVector(latLonToVector(currentPos), axis, angle));
                }
                currentTime = intervalEnd;
            }
        }
        if (keyframes.length === 0 || currentTime < time) {
            const pole = plate.motion?.eulerPole;
            if (pole && pole.rate !== 0) {
                const elapsed = time - plate.birthTime;
                const axis = latLonToVector(pole.position);
                const v = latLonToVector(point);
                currentPos = vectorToLatLon(rotateVector(v, axis, toRad(pole.rate * elapsed)));
            }
        }
        return currentPos;
    }

}
