import { AppState, TectonicPlate, Coordinate, Feature, PaintStroke } from './types';
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

        // First, check if we need to inherit features from parent plate(s)
        let inheritedFeatures: Feature[] = [];
        const parentIds = plate.parentPlateIds || (plate.parentPlateId ? [plate.parentPlateId] : []);

        for (const pid of parentIds) {
            const parentPlate = allPlates.find(p => p.id === pid);
            if (!parentPlate) continue;

            // Find features on parent that were added between parent's birth and this plate's birth (split/fusion time)
            // These features should be inherited by the appropriate child
            const candidateFeatures = parentPlate.features.filter(f =>
                f.generatedAt !== undefined &&
                f.generatedAt >= parentPlate.birthTime &&
                f.generatedAt <= plate.birthTime // Feature was added before or at the moment of the transition
            );

            // Check which features should belong to this child based on position containment
            // Use the initial polygons of this child plate for the containment test
            const featuresToInherit = candidateFeatures.filter(f => {
                // For fusion, the child covers both parents, so it will likely pick up all features.
                // For split, it correctly picks only those within its half.
                return plate.initialPolygons.some(poly =>
                    this.isPointInPolygon(f.position, poly.points)
                );
            }).filter(f => {
                // Don't add if already in plate's features (avoid duplicates if recalculating)
                return !plate.features.some(existing => existing.id === f.id) &&
                    !inheritedFeatures.some(existing => existing.id === f.id);
            });

            inheritedFeatures.push(...featuresToInherit);
        }

        // Find the active keyframe for this time (latest keyframe with time <= query time)
        const keyframes = plate.motionKeyframes || [];

        // If no keyframes, fall back to legacy motion from birth
        if (keyframes.length === 0) {
            return this.calculateWithLegacyMotion(plate, time, inheritedFeatures);
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

            return {
                ...plate,
                polygons: plate.initialPolygons,
                features: mergedFeatures,
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
            const mergedFeatures = [...activeKeyframe.snapshotFeatures, ...dynamicFeatures, ...inheritedFeatures];

            return {
                ...plate,
                polygons: activeKeyframe.snapshotPolygons,
                features: mergedFeatures,
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
        
        // Filter dynamic strokes (those created after keyframe OR legacy strokes without birthTime)
        const currentStrokes = plate.paintStrokes || [];
        const dynamicStrokes = currentStrokes.filter(s => 
            !snapshotStrokeIds.has(s.id) &&
            (s.birthTime === undefined || s.birthTime >= activeKeyframe.time)
        );

        // Transform Snapshot Strokes (From Keyframe Time, use points as source)
        const transformSnapshotStrokes = snapshotStrokes.map(s => transformStroke(s, activeKeyframe.time, false));

        // Transform Dynamic Strokes (From Birth Time, use originalPoints as source)
        // Fallback to plate birthTime or 0 for legacy strokes
        const transformDynamicStrokes = dynamicStrokes.map(s => transformStroke(s, s.birthTime !== undefined ? s.birthTime : (plate.birthTime || 0), true));

        const newPaintStrokes = [...transformSnapshotStrokes, ...transformDynamicStrokes];

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

        // --- Landmass Transformation ---
        // Transform landmass polygons to follow plate rotation (if linked to this plate)
        let newLandmasses = plate.landmasses;
        if (plate.landmasses && plate.landmasses.length > 0) {
            newLandmasses = plate.landmasses.map(landmass => {
                // Only transform if landmass is linked to this plate
                if (!landmass.linkedToPlateId || landmass.linkedToPlateId !== plate.id) {
                    // Check if linked to a different plate - then don't transform here
                    // (it will be transformed when that plate is processed)
                    // But actually landmasses are stored on their owner plate, so we should transform
                    // based on the owner plate's motion unless unlinked
                    if (landmass.linkedToPlateId && landmass.linkedToPlateId !== plate.id) {
                        return landmass; // Don't transform - linked to a different plate
                    }
                    // Unlinked landmass - don't transform (stays at original position)
                    if (!landmass.linkedToPlateId) {
                        return landmass;
                    }
                }

                const landmassStartTime = landmass.birthTime ?? plate.birthTime;
                const landmassElapsed = Math.max(0, time - landmassStartTime);

                // Get source polygon (originalPolygon if available, else polygon)
                const sourcePolygon = landmass.originalPolygon ?? landmass.polygon;

                // Calculate rotation for this landmass
                let newPolygon = sourcePolygon;

                // Apply parent motion if plate is linked to another (and landmass is linked to this plate)
                if (parentTransform.length > 0) {
                    newPolygon = newPolygon.map(pt => {
                        let result = pt;
                        for (const segment of parentTransform) {
                            if (segment.angle !== 0) {
                                result = applyRotation(result, segment.axis, segment.angle);
                            }
                        }
                        return result;
                    });
                }

                // Apply the plate's own rotation
                if (ownAxis && pole) {
                    const landmassAngle = toRad(pole.rate * landmassElapsed);
                    if (landmassAngle !== 0) {
                        newPolygon = newPolygon.map(pt => {
                            return applyRotation(pt, ownAxis!, landmassAngle);
                        });
                    }
                }

                return {
                    ...landmass,
                    polygon: newPolygon,
                    originalPolygon: landmass.originalPolygon ?? sourcePolygon // Preserve original
                };
            });
        }

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
    private calculateWithLegacyMotion(plate: TectonicPlate, time: number, inheritedFeatures: Feature[] = []): TectonicPlate {
        const pole = plate.motion?.eulerPole;
        const elapsed = time - plate.birthTime;

        if (!pole || pole.rate === 0 || elapsed === 0) {
            return {
                ...plate,
                polygons: plate.initialPolygons || plate.polygons,
                features: [...(plate.initialFeatures || plate.features), ...inheritedFeatures],
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

        const allPoints = newPolygons.flatMap(poly => poly.points);
        const newCenter = calculateSphericalCentroid(allPoints);

        // Transform landmasses (legacy motion)
        let newLandmasses = plate.landmasses;
        if (plate.landmasses && plate.landmasses.length > 0 && angle !== 0) {
            newLandmasses = plate.landmasses.map(landmass => {
                // Only transform if landmass is linked to this plate
                if (!landmass.linkedToPlateId || landmass.linkedToPlateId !== plate.id) {
                    if (!landmass.linkedToPlateId) {
                        return landmass; // Unlinked - don't transform
                    }
                    return landmass; // Linked to a different plate
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
        }

        const updatedPlate = {
            ...plate,
            polygons: newPolygons,
            features: newFeatures,
            crustMesh: newCrustMesh,
            landmasses: newLandmasses,
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
                    snapshotFeatures: currentFeatures
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

                newKeyframes.push({
                    ...kf,
                    snapshotPolygons: nextPolygons,
                    snapshotFeatures: nextFeatures
                });

                // Update for next iteration
                currentPolygons = nextPolygons;
                currentFeatures = nextFeatures;
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
