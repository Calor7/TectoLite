import { AppState, TectonicPlate, Coordinate, Feature } from './types';

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
import { EventEffectsProcessor } from './systems/EventEffectsProcessor';
import { eventSystem } from './systems/EventSystem';


export class SimulationEngine {
    private isRunning = false;
    private lastUpdate = 0;
    private animationId: number | null = null;
    private geologicalAutomation: GeologicalAutomationSystem;
    private eventEffectsProcessor: EventEffectsProcessor;

    constructor(
        private getState: () => AppState,
        private setState: (updater: (state: AppState) => AppState) => void
    ) {
        this.geologicalAutomation = new GeologicalAutomationSystem();
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
            // ALWAYS update boundaries if Visualization OR Guided Creation is enabled.
            // If none are on, clear boundaries to prevent stale artifacts.
            const boundaries = (globalOptions.enableBoundaryVisualization ||
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

            // Phase 6: Elevation System - REMOVED
            // const deltaT = time - state.world.currentTime;
            // const finalState = this.elevationSystem.update(postEffectState, deltaT);

            return postEffectState;
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
            // ALWAYS update boundaries if Visualization OR Guided Creation is enabled.
            // If none are on, clear boundaries to prevent stale artifacts.
            const boundaries = (globalOptions.enableBoundaryVisualization ||
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
            const finalState = this.eventEffectsProcessor.update(postEventState);

            return finalState;
        });
        this.updateFlowlines();
    }

    private calculatePlateAtTime(plate: TectonicPlate, time: number, allPlates: TectonicPlate[] = []): TectonicPlate {
        // Collect all parent rotations recursively (A -> B -> C)
        const getAccumulatedParentTransform = (p: TectonicPlate, t: number, visited: Set<string>): { axis: Vector3; angle: number }[] => {
            if (!p.linkedToPlateId || visited.has(p.id)) return [];
            visited.add(p.id);

            const parent = allPlates.find(pl => pl.id === p.linkedToPlateId);
            if (!parent) return [];

            let transforms: { axis: Vector3; angle: number }[] = [];

            // 1. Get grandparent transforms first (recursive)
            transforms.push(...getAccumulatedParentTransform(parent, t, visited));

            // 2. Add this parent's motion if within link window
            const isWithinLinkWindow =
                (!p.linkTime || t >= p.linkTime) &&
                (!p.unlinkTime || t < p.unlinkTime);

            if (isWithinLinkWindow) {
                const parentKeyframes = parent.motionKeyframes || [];
                // Find child current active keyframe to know from when we inherit parent motion
                const activeKF = (p.motionKeyframes || []).filter(k => k.time <= t).sort((a, b) => b.time - a.time)[0];
                const linkStartTime = p.linkTime || (parentKeyframes[0]?.time ?? 0);
                const motionStartTime = activeKF ? Math.max(linkStartTime, activeKF.time) : linkStartTime;

                const relevantKeyframes = parentKeyframes.filter(kf => kf.time <= t && kf.time >= motionStartTime);

                if (relevantKeyframes.length > 0) {
                    relevantKeyframes.sort((a, b) => a.time - b.time);
                    let prevTime = motionStartTime;

                    for (let i = 0; i < relevantKeyframes.length; i++) {
                        const kf = relevantKeyframes[i];
                        if (kf.eulerPole && kf.eulerPole.rate !== 0) {
                            const pole = kf.eulerPole;
                            const axis = latLonToVector(pole.position);

                            let segmentEnd = t;
                            if (i + 1 < relevantKeyframes.length) {
                                segmentEnd = Math.min(relevantKeyframes[i + 1].time, t);
                            }

                            const duration = segmentEnd - Math.max(kf.time, prevTime);
                            if (duration > 0) {
                                const angle = toRad(pole.rate * duration);
                                transforms.push({ axis, angle });
                            }
                            prevTime = segmentEnd;
                        }
                    }
                }
            }
            return transforms;
        };

        const parentTransform = getAccumulatedParentTransform(plate, time, new Set());

        // Inheritance of Features
        let inheritedFeatures: Feature[] = [];
        const parentIds = plate.parentPlateIds || (plate.parentPlateId ? [plate.parentPlateId] : []);

        for (const pid of parentIds) {
            const parentPlate = allPlates.find(p => p.id === pid);
            if (!parentPlate) continue;

            const transitionTime = plate.birthTime;
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
        }

        const keyframes = plate.motionKeyframes || [];
        if (keyframes.length === 0) {
            return this.calculateWithLegacyMotion(plate, time, inheritedFeatures);
        }

        const activeKeyframe = keyframes
            .filter(kf => kf.time <= time)
            .sort((a, b) => b.time - a.time)[0];

        if (!activeKeyframe) {
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

        const applyRotation = (coord: Coordinate, axis: Vector3, angle: number): Coordinate => {
            if (angle === 0) return coord;
            const v = latLonToVector(coord);
            const vRot = rotateVector(v, axis, angle);
            return vectorToLatLon(vRot);
        };

        // Rotation Logic: Global parent motions first, then differential child motion
        const transform = (coord: Coordinate, isPointSpecificLifetime: boolean = false, startTime: number = activeKeyframe.time): Coordinate => {
            let result = coord;
            // 1. Apply parent accumulated transformation
            for (const segment of parentTransform) {
                result = applyRotation(result, segment.axis, segment.angle);
            }
            // 2. Apply child differential transformation
            if (pole && pole.rate !== 0) {
                const duration = isPointSpecificLifetime ? Math.max(0, time - startTime) : elapsed;
                if (duration > 0) {
                    let currentAxis = latLonToVector(pole.position);
                    // Rotate the axis itself by the parent motion (Lock Motion)
                    for (const segment of parentTransform) {
                        currentAxis = rotateVector(currentAxis, segment.axis, segment.angle);
                    }
                    const ownAngle = toRad(pole.rate * duration);
                    result = applyRotation(result, currentAxis, ownAngle);
                }
            }
            return result;
        };

        const transformFeature = (feat: Feature, startTime: number, useOriginal: boolean = false): Feature => {
            const sourcePos = (useOriginal && feat.originalPosition) ? feat.originalPosition : feat.position;
            const finalPos = transform(sourcePos, true, startTime);
            return {
                ...feat,
                position: finalPos,
                originalPosition: feat.originalPosition
            };
        };

        const newPolygons = activeKeyframe.snapshotPolygons.map(poly => ({
            ...poly,
            points: poly.points.map(p => transform(p))
        }));

        const dynamicFeatures = plate.features.filter(f =>
            !activeKeyframe.snapshotFeatures.some(sf => sf.id === f.id) &&
            f.generatedAt !== undefined &&
            f.generatedAt >= activeKeyframe.time
        );

        const transformedSnapshotFeatures = activeKeyframe.snapshotFeatures.map(feat =>
            transformFeature(feat, activeKeyframe.time, false)
        );

        const transformedDynamicFeatures = dynamicFeatures.map(feat =>
            transformFeature(feat, feat.generatedAt!, true)
        );

        const transformedInheritedFeatures = inheritedFeatures.map(feat =>
            transformFeature(feat, plate.birthTime, false)
        );

        const newFeatures = [...transformedSnapshotFeatures, ...transformedDynamicFeatures, ...transformedInheritedFeatures];
        const newCenter = calculateSphericalCentroid(newPolygons.flatMap(poly => poly.points));

        return {
            ...plate,
            polygons: newPolygons,
            features: newFeatures,
            center: newCenter
        };
    }

    // Legacy fallback for plates without keyframes
    calculateWithLegacyMotion(
        plate: TectonicPlate,
        time: number,
        inheritedFeatures: Feature[] = []
    ): TectonicPlate {
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
