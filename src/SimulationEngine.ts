import { AppState, TectonicPlate, Coordinate, Feature, PaintStroke } from './types';
import {
    toRad,
    latLonToVector,
    vectorToLatLon,
    rotateVector,
    calculateSphericalCentroid
} from './utils/sphericalMath';
import { BoundarySystem } from './BoundarySystem';
import { GeologicalAutomationSystem } from './systems/GeologicalAutomation';
import { ElevationSystem } from './systems/ElevationSystem';
// import { SpawnerSystem } from './systems/SpawnerSystem';


export class SimulationEngine {
    private isRunning = false;
    private lastUpdate = 0;
    private animationId: number | null = null;
    private geologicalAutomation: GeologicalAutomationSystem;
    private elevationSystem: ElevationSystem;

    constructor(
        private getState: () => AppState,
        private setState: (updater: (state: AppState) => AppState) => void
    ) { 
        this.geologicalAutomation = new GeologicalAutomationSystem();
        this.elevationSystem = new ElevationSystem();
    }

    // Helper: Check if a point is inside a spherical polygon using ray casting
    private isPointInPolygon(point: Coordinate, polygon: Coordinate[]): boolean {
        if (polygon.length < 3) return false;

        let windingNumber = 0;

        for (let i = 0; i < polygon.length; i++) {
            const lat1 = polygon[i][1];
            const lat2 = polygon[(i + 1) % polygon.length][1];
            const lon1 = polygon[i][0];
            const lon2 = polygon[(i + 1) % polygon.length][0];
            const pLat = point[1];
            const pLon = point[0];

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
            // Recalculate ALL plates at the new time
            const newPlates = state.world.plates.map(plate => {
                const isBorn = time >= plate.birthTime;
                const isDead = plate.deathTime !== null && time >= plate.deathTime;

                if (!isBorn || isDead || plate.locked) return plate;

                return this.calculatePlateAtTime(plate, time, state.world.plates);
            });

            // Calculate Boundaries if enabled
            // ALWAYS update boundaries if dynamicFeatures (Orogeny) is enabled, or if visualization is on.
            // If neither is on, clear boundaries to prevent stale artifacts.
            let boundaries: any[] = [];
            
            if (state.world.globalOptions.enableBoundaryVisualization || state.world.globalOptions.enableOrogeny) {
                 boundaries = BoundarySystem.detectBoundaries(newPlates);
            } else {
                boundaries = [];
            }   

            // Phase 3: Dynamic Feature Spawning - DISABLED
            let finalPlates = newPlates;
            // Removed for lightweight performance per user request
            // if (state.world.globalOptions.enableDynamicFeatures && boundaries && boundaries.length > 0) ...
            
            // Phase 4: Geological Automation
            const tempState = {
                ...state,
                world: {
                    ...state.world,
                    plates: finalPlates,
                    boundaries: boundaries,
                    currentTime: time
                }
            };
            const postAutomationState = this.geologicalAutomation.update(tempState);
            
            // Phase 5: Elevation System (use signed deltaT to detect direction)
            const deltaT = time - state.world.currentTime;
            const finalState = this.elevationSystem.update(postAutomationState, deltaT);

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
            // ALWAYS update boundaries if dynamicFeatures (Orogeny) is enabled, or if visualization is on.
            // If neither is on, clear boundaries to prevent stale artifacts.
            let boundaries: any[] = [];
            
            if (state.world.globalOptions.enableBoundaryVisualization || state.world.globalOptions.enableOrogeny) {
                 boundaries = BoundarySystem.detectBoundaries(newPlates);
            } else {
                boundaries = [];
            }
            
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
            
            // Phase 4: Elevation System
            const deltaT = state.world.timeScale;
            const finalState = this.elevationSystem.update(postAutomationState, deltaT);

            return finalState;
        });
        this.updateFlowlines();
    }

    private calculatePlateAtTime(plate: TectonicPlate, time: number, allPlates: TectonicPlate[] = []): TectonicPlate {
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

        if (!pole || pole.rate === 0 || elapsed === 0) {
            // No motion from this keyframe, use snapshot geometry but preserve dynamic features
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

        // Rotate from the keyframe's snapshot geometry
        const axis = latLonToVector(pole.position);
        const elapsedFromKeyframe = time - activeKeyframe.time;
        const angle = toRad(pole.rate * elapsedFromKeyframe);

        const transform = (coord: Coordinate): Coordinate => {
            const v = latLonToVector(coord);
            const vRot = rotateVector(v, axis, angle);
            return vectorToLatLon(vRot);
        };

        // Transform helper: STRICTLY uses the provided startTime for rotation calculation.
        // Does NOT fall back to feat.generatedAt automatically, to prevent stale timestamps
        // (like inherited features) from causing over-rotation.
        // useOriginal: If true, uses feat.originalPosition as source (if available)
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
                originalPosition: feat.originalPosition // Explicitly preserve originalPosition
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
             const strokeElapsed = Math.max(0, time - startTime);
             const strokeAngle = toRad(pole.rate * strokeElapsed);

             if (strokeAngle === 0) return stroke;

             // Source points: use originalPoints if available and requested
             const sourcePoints = (useOriginal && stroke.originalPoints) ? stroke.originalPoints : stroke.points;
             
             // Optimize rotation: Single axis object
             const strokeAxis = axis; 

             const newPoints = sourcePoints.map(p => {
                 const v = latLonToVector(p);
                 const vRot = rotateVector(v, strokeAxis, strokeAngle);
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
        // CRITICAL: Transform from originalPos to avoid compounding rotation
        let newCrustMesh = plate.crustMesh;
        if (plate.crustMesh && plate.crustMesh.length > 0) {
            const meshElapsed = Math.max(0, time - plate.birthTime);
            const meshAngle = toRad(pole.rate * meshElapsed);
            
            if (meshAngle !== 0) {
                newCrustMesh = plate.crustMesh.map(vertex => {
                    // Use originalPos as source of truth, fallback to pos for legacy data
                    const sourcePos = vertex.originalPos || vertex.pos;
                    const v = latLonToVector(sourcePos);
                    const vRot = rotateVector(v, axis, meshAngle);
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

        const updatedPlate = {
            ...plate,
            polygons: newPolygons,
            features: newFeatures,
            crustMesh: newCrustMesh,
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
            const newPlates = plates.map(plate => {
                const flowlines = plate.features.filter(f => f.type === 'flowline');
                if (flowlines.length === 0) return plate;
                const newFeatures = plate.features.map(f => {
                    if (f.type !== 'flowline') return f;
                    const startTime = f.generatedAt || plate.birthTime;
                    const points: Coordinate[] = [];
                    const step = 5;
                    for (let t = startTime; t <= currentTime; t += step) {
                        points.push(this.getPointPositionAtTime(f.originalPosition || f.position, plate.id, t, plates));
                    }
                    points.push(this.getPointPositionAtTime(f.originalPosition || f.position, plate.id, currentTime, plates));
                    return { ...f, trail: points };
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
                currentPos = vectorToLatLon(rotateVector(latLonToVector(point), latLonToVector(pole.position), toRad(pole.rate * elapsed)));
            }
        }
        return currentPos;
    }

}
