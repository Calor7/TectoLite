import { AppState, TectonicPlate, Coordinate, Feature } from './types';
import {
    toRad,
    latLonToVector,
    vectorToLatLon,
    rotateVector,
    calculateSphericalCentroid
} from './utils/sphericalMath';


export class SimulationEngine {
    private isRunning = false;
    private lastUpdate = 0;
    private animationId: number | null = null;

    constructor(
        private getState: () => AppState,
        private setState: (updater: (state: AppState) => AppState) => void
    ) { }

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

                return this.calculatePlateAtTime(plate, time);
            });

            return {
                ...state,
                world: {
                    ...state.world,
                    plates: newPlates,
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

                return this.calculatePlateAtTime(plate, newTime);
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

    private calculatePlateAtTime(plate: TectonicPlate, time: number): TectonicPlate {
        // Find the active keyframe for this time (latest keyframe with time <= query time)
        const keyframes = plate.motionKeyframes || [];

        // If no keyframes, fall back to legacy motion from birth
        if (keyframes.length === 0) {
            return this.calculateWithLegacyMotion(plate, time);
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
            const mergedFeatures = [...(plate.initialFeatures || []), ...dynamicFeatures];

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
            const mergedFeatures = [...activeKeyframe.snapshotFeatures, ...dynamicFeatures];

            return {
                ...plate,
                polygons: activeKeyframe.snapshotPolygons,
                features: mergedFeatures,
                center: calculateSphericalCentroid(activeKeyframe.snapshotPolygons.flatMap(p => p.points))
            };
        }

        // Rotate from the keyframe's snapshot geometry
        const axis = latLonToVector(pole.position);
        const angle = toRad(pole.rate * elapsed);

        const transform = (coord: Coordinate): Coordinate => {
            const v = latLonToVector(coord);
            const vRot = rotateVector(v, axis, angle);
            return vectorToLatLon(vRot);
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

        const allSourceFeatures = [...activeKeyframe.snapshotFeatures, ...dynamicFeatures];

        const newFeatures = allSourceFeatures.map(feat => ({
            ...feat,
            position: transform(feat.position)
        }));

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
    private calculateWithLegacyMotion(plate: TectonicPlate, time: number): TectonicPlate {
        const pole = plate.motion?.eulerPole;
        const elapsed = time - plate.birthTime;

        if (!pole || pole.rate === 0 || elapsed === 0) {
            return {
                ...plate,
                polygons: plate.initialPolygons || plate.polygons,
                features: plate.initialFeatures || plate.features,
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

        const sourcePolys = plate.initialPolygons || plate.polygons;
        // Use current features (which include dynamically added ones) instead of only initialFeatures
        const sourceFeats = plate.features;

        const newPolygons = sourcePolys.map(poly => ({
            ...poly,
            points: poly.points.map(transform)
        }));

        const newFeatures = sourceFeats.map(feat => ({
            ...feat,
            position: transform(feat.position)
        }));

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

    private checkAutoGeneration(plate: TectonicPlate, currentTime: number): TectonicPlate {
        const newFeatures = [...plate.features];
        let changed = false;

        for (const feature of plate.features) {
            if (feature.type === 'hotspot') {
                // Hotspot assumption: Creates islands.
                const lastGen = feature.generatedAt || 0;
                // Generate every 5 Ma if moving?
                // Actually if pole.rate is 0, we shouldn't gen.
                if (currentTime - lastGen > 5) {
                    const island: Feature = {
                        id: Math.random().toString(36).substring(2, 9),
                        type: 'island',
                        position: [...feature.position] as Coordinate,
                        rotation: Math.random() * 360,
                        scale: 0.5 + Math.random() * 0.5,
                        properties: {},
                        generatedAt: currentTime
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
