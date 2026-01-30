import { AppState, TectonicPlate, Coordinate, Feature } from './types';
import {
    toRad,
    latLonToVector,
    vectorToLatLon,
    rotateVector,
    calculateSphericalCentroid
} from './utils/sphericalMath';
import { BoundarySystem } from './BoundarySystem';
// import { SpawnerSystem } from './systems/SpawnerSystem';


export class SimulationEngine {
    private isRunning = false;
    private lastUpdate = 0;
    private animationId: number | null = null;

    constructor(
        private getState: () => AppState,
        private setState: (updater: (state: AppState) => AppState) => void
    ) { }

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
            let boundaries = state.world.boundaries;
            if (state.world.globalOptions.enableBoundaryVisualization || state.world.globalOptions.enableDynamicFeatures) {
                boundaries = BoundarySystem.detectBoundaries(newPlates);
            }

            // Phase 3: Dynamic Feature Spawning - DISABLED
            let finalPlates = newPlates;
            // Removed for lightweight performance per user request
            // if (state.world.globalOptions.enableDynamicFeatures && boundaries && boundaries.length > 0) ...

            return {
                ...state,
                world: {
                    ...state.world,
                    plates: finalPlates,
                    boundaries: boundaries,
                    currentTime: time
                }
            };
        });
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

            return {
                ...state,
                world: {
                    ...state.world,
                    plates: newPlates,
                    currentTime: newTime
                }
            };
        });
    }

    private calculatePlateAtTime(plate: TectonicPlate, time: number, allPlates: TectonicPlate[] = []): TectonicPlate {
        // First, check if we need to inherit features from parent plate
        let inheritedFeatures: Feature[] = [];
        if (plate.parentPlateId) {
            const parentPlate = allPlates.find(p => p.id === plate.parentPlateId);
            if (parentPlate) {
                // Find features on parent that were added between parent's birth and this plate's birth (split time)
                // These features should be inherited by the appropriate child
                const candidateFeatures = parentPlate.features.filter(f =>
                    f.generatedAt !== undefined &&
                    f.generatedAt >= parentPlate.birthTime &&
                    f.generatedAt < plate.birthTime // Feature was added before the split
                );

                // Check which features should belong to this child based on position containment
                // Use the initial polygons of this child plate for the containment test
                inheritedFeatures = candidateFeatures.filter(f => {
                    return plate.initialPolygons.some(poly =>
                        this.isPointInPolygon(f.position, poly.points)
                    );
                }).filter(f => {
                    // Don't add if already in plate's features
                    return !plate.features.some(existing => existing.id === f.id);
                });
            }
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

        const allPoints = newPolygons.flatMap(poly => poly.points);
        const newCenter = calculateSphericalCentroid(allPoints);

        const updatedPlate = {
            ...plate,
            polygons: newPolygons,
            features: newFeatures,
            center: newCenter
        };

        return this.checkAutoGeneration(updatedPlate, time);
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

        const allPoints = newPolygons.flatMap(poly => poly.points);
        const newCenter = calculateSphericalCentroid(allPoints);

        const updatedPlate = {
            ...plate,
            polygons: newPolygons,
            features: newFeatures,
            center: newCenter
        };

        return this.checkAutoGeneration(updatedPlate, time);
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

    private checkAutoGeneration(plate: TectonicPlate, currentTime: number): TectonicPlate {
        const newFeatures = [...plate.features];
        let changed = false;

        const state = this.getState(); // Need access to globalOptions
        const enableHotspots = state.world.globalOptions.enableHotspotIslands ?? true;

        for (const feature of plate.features) {
            if (feature.type === 'hotspot') {
                // Hotspot assumption: Creates islands.
                const lastGen = feature.generatedAt || 0;
                // Generate every 5 Ma if moving?
                // Actually if pole.rate is 0, we shouldn't gen.
                if (enableHotspots && currentTime - lastGen > 5) {
                    const island: Feature = {
                        id: Math.random().toString(36).substring(2, 9),
                        type: 'island',
                        position: [...feature.position] as Coordinate,
                        rotation: Math.random() * 360,
                        scale: 0.5 + Math.random() * 0.5,
                        properties: {},
                        generatedAt: currentTime,
                        originalPosition: [...feature.position] as Coordinate // Set source of truth
                    };
                    newFeatures.push(island);

                    const idx = newFeatures.indexOf(feature);
                    if (idx !== -1) {
                        newFeatures[idx] = { ...feature, generatedAt: currentTime };
                    }
                    changed = true;
                }
            }
        }

        if (changed) {
            return {
                ...plate,
                features: newFeatures
            };
        }

        return plate;
    }
}
