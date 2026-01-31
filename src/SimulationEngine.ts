import { AppState, TectonicPlate, Coordinate, Feature } from './types';
import {
    toRad,
    latLonToVector,
    vectorToLatLon,
    rotateVector,
    calculateSphericalCentroid
} from './utils/sphericalMath';
import { BoundarySystem } from './BoundarySystem';
import polygonClipping from 'polygon-clipping';

export class SimulationEngine {
    private isRunning = false;
    private lastUpdate = 0;
    private animationId: number | null = null;
    private ageMapRes = [512, 256];

    constructor(
        private getState: () => AppState,
        private setState: (updater: (state: AppState) => AppState) => void
    ) { }

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
            const newPlates = state.world.plates.map(plate => {
                const isBorn = time >= plate.birthTime;
                const isDead = plate.deathTime !== null && time >= plate.deathTime;
                if (!isBorn || isDead || plate.locked) return plate;
                return this.calculatePlateAtTime(plate, time, state.world.plates);
            });
            let boundaries = state.world.boundaries;
            if (state.world.globalOptions.enableBoundaryVisualization || state.world.globalOptions.enableDynamicFeatures) {
                boundaries = BoundarySystem.detectBoundaries(newPlates);
            }
            return {
                ...state,
                world: {
                    ...state.world,
                    plates: newPlates,
                    boundaries: boundaries,
                    currentTime: time
                }
            };
        });
        this.updateOceanAgeMap();
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
            const newPlates = state.world.plates.map(plate => {
                const isBorn = newTime >= plate.birthTime;
                const isDead = plate.deathTime !== null && newTime >= plate.deathTime;
                if (!isBorn) return plate;
                if (isDead) return plate;
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

        this.updateOceanAgeMap();
        this.updateTrailingSeafloor(deltaMa);
        this.updateFlowlines();
    }

    private calculatePlateAtTime(plate: TectonicPlate, time: number, allPlates: TectonicPlate[] = []): TectonicPlate {
        let inheritedFeatures: Feature[] = [];
        const parentIds = plate.parentPlateIds || (plate.parentPlateId ? [plate.parentPlateId] : []);
        for (const pid of parentIds) {
            const parentPlate = allPlates.find(p => p.id === pid);
            if (!parentPlate) continue;
            const candidateFeatures = parentPlate.features.filter(f =>
                f.generatedAt !== undefined && f.generatedAt >= parentPlate.birthTime && f.generatedAt <= plate.birthTime
            );
            const featuresToInherit = candidateFeatures.filter(f => {
                return plate.initialPolygons.some(poly => this.isPointInPolygon(f.position, poly.points));
            }).filter(f => {
                return !plate.features.some(existing => existing.id === f.id) && !inheritedFeatures.some(existing => existing.id === f.id);
            });
            inheritedFeatures.push(...featuresToInherit);
        }

        const keyframes = plate.motionKeyframes || [];
        if (keyframes.length === 0) {
            return this.calculateWithLegacyMotion(plate, time, inheritedFeatures);
        }

        const activeKeyframe = keyframes.filter(kf => kf.time <= time).sort((a, b) => b.time - a.time)[0];
        if (!activeKeyframe) {
            const initialFeatureIds = new Set((plate.initialFeatures || []).map(f => f.id));
            const dynamicFeatures = plate.features.filter(f => !initialFeatureIds.has(f.id) && f.generatedAt !== undefined);
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
            const snapshotFeatureIds = new Set(activeKeyframe.snapshotFeatures.map(f => f.id));
            const dynamicFeatures = plate.features.filter(f => !snapshotFeatureIds.has(f.id) && f.generatedAt !== undefined && f.generatedAt >= activeKeyframe.time);
            const mergedFeatures = [...activeKeyframe.snapshotFeatures, ...dynamicFeatures, ...inheritedFeatures];
            return {
                ...plate,
                polygons: activeKeyframe.snapshotPolygons,
                features: mergedFeatures,
                center: calculateSphericalCentroid(activeKeyframe.snapshotPolygons.flatMap(p => p.points))
            };
        }

        const axis = latLonToVector(pole.position);
        const elapsedFromKeyframe = time - activeKeyframe.time;
        const angle = toRad(pole.rate * elapsedFromKeyframe);

        const transform = (coord: Coordinate): Coordinate => {
            const v = latLonToVector(coord);
            const vRot = rotateVector(v, axis, angle);
            return vectorToLatLon(vRot);
        };

        const transformFeature = (feat: Feature, startTime: number, useOriginal: boolean = false): Feature => {
            const featureElapsed = Math.max(0, time - startTime);
            const featureAngle = toRad(pole.rate * featureElapsed);
            if (featureAngle === 0) return feat;
            const sourcePos = (useOriginal && feat.originalPosition) ? feat.originalPosition : feat.position;
            const v = latLonToVector(sourcePos);
            const vRot = rotateVector(v, axis, featureAngle);
            return {
                ...feat,
                position: vectorToLatLon(vRot),
                originalPosition: feat.originalPosition
            };
        };

        const newPolygons = activeKeyframe.snapshotPolygons.map(poly => ({
            ...poly,
            points: poly.points.map(transform)
        }));

        const snapshotFeatureIds = new Set(activeKeyframe.snapshotFeatures.map(f => f.id));
        const dynamicFeatures = plate.features.filter(f => !snapshotFeatureIds.has(f.id) && f.generatedAt !== undefined && f.generatedAt >= activeKeyframe.time);

        const transformedSnapshotFeatures = activeKeyframe.snapshotFeatures.map(feat => transformFeature(feat, activeKeyframe.time, false));
        const transformedDynamicFeatures = dynamicFeatures.map(feat => transformFeature(feat, feat.generatedAt!, true));
        const transformedInheritedFeatures = inheritedFeatures.map(feat => transformFeature(feat, plate.birthTime, false));

        const newFeatures = [...transformedSnapshotFeatures, ...transformedDynamicFeatures, ...transformedInheritedFeatures];
        const newCenter = calculateSphericalCentroid(newPolygons.flatMap(poly => poly.points));

        return {
            ...plate,
            polygons: newPolygons,
            features: newFeatures,
            center: newCenter
        };
    }

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
        const transformFeature = (feat: Feature, startTime: number, useOriginal: boolean = false): Feature => {
            const featureElapsed = Math.max(0, time - startTime);
            const featureAngle = toRad(pole.rate * featureElapsed);
            if (featureAngle === 0) return feat;
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
        const sourceFeats = plate.features;
        const newPolygons = sourcePolys.map(poly => ({
            ...poly,
            points: poly.points.map(transform)
        }));
        const transformedPlateFeatures = sourceFeats.map(feat => transformFeature(feat, feat.generatedAt ?? plate.birthTime, true));
        const transformedInheritedFeatures = inheritedFeatures.map(feat => transformFeature(feat, plate.birthTime, false));
        const newFeatures = [...transformedPlateFeatures, ...transformedInheritedFeatures];
        const newCenter = calculateSphericalCentroid(newPolygons.flatMap(poly => poly.points));
        return {
            ...plate,
            polygons: newPolygons,
            features: newFeatures,
            center: newCenter
        };
    }

    public recalculateMotionHistory(plate: TectonicPlate): TectonicPlate {
        const keyframes = [...(plate.motionKeyframes || [])].sort((a, b) => a.time - b.time);
        let currentPolygons = plate.initialPolygons;
        let currentFeatures = plate.initialFeatures || [];
        const newKeyframes: import('./types').MotionKeyframe[] = [];

        for (let i = 0; i < keyframes.length; i++) {
            const kf = keyframes[i];
            if (i === 0) {
                newKeyframes.push({
                    ...kf,
                    snapshotPolygons: currentPolygons,
                    snapshotFeatures: currentFeatures
                });
            } else {
                const prevKf = newKeyframes[i - 1];
                const delta = kf.time - prevKf.time;
                if (delta < 0) continue;
                const axis = latLonToVector(prevKf.eulerPole.position);
                const angle = toRad(prevKf.eulerPole.rate * delta);
                const transform = (coord: Coordinate): Coordinate => {
                    const v = latLonToVector(coord);
                    const vRot = rotateVector(v, axis, angle);
                    return vectorToLatLon(vRot);
                };
                const nextPolygons = prevKf.snapshotPolygons.map(poly => ({
                    ...poly,
                    points: poly.points.map(transform)
                }));
                const nextFeatures = prevKf.snapshotFeatures.map(f => {
                    const fV = latLonToVector(f.position);
                    const fRot = rotateVector(fV, axis, angle);
                    return { ...f, position: vectorToLatLon(fRot) };
                });
                newKeyframes.push({
                    ...kf,
                    snapshotPolygons: nextPolygons,
                    snapshotFeatures: nextFeatures
                });
                currentPolygons = nextPolygons;
                currentFeatures = nextFeatures;
            }
        }
        return { ...plate, motionKeyframes: newKeyframes };
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

    private updateOceanAgeMap(): void {
        const state = this.getState();
        let map = state.world.oceanAgeMap;
        const res = this.ageMapRes;
        if (!map || !state.world.oceanAgeMapRes) {
            map = new Float32Array(res[0] * res[1]);
            map.fill(-1);
            this.setState(s => ({
                ...s,
                world: { ...s.world, oceanAgeMap: map, oceanAgeMapRes: [res[0], res[1]] }
            }));
        }
        const currentTime = state.world.currentTime;
        const plates = state.world.plates.filter(p => !p.deathTime && p.birthTime <= currentTime);
        const newMap = new Float32Array(map);
        let changed = false;

        for (let y = 0; y < res[1]; y++) {
            const lat = 90 - (y / res[1]) * 180;
            for (let x = 0; x < res[0]; x++) {
                const lon = (x / res[0]) * 360 - 180;
                const idx = y * res[0] + x;
                const point: Coordinate = [lon, lat];
                let isCovered = false;
                for (const plate of plates) {
                    for (const poly of plate.polygons) {
                        if (this.isPointInPolygon(point, poly.points)) {
                            isCovered = true;
                            break;
                        }
                    }
                    if (isCovered) break;
                }
                if (!isCovered) {
                    if (newMap[idx] === -1) {
                        newMap[idx] = currentTime;
                        changed = true;
                    }
                }
            }
        }
        if (changed) {
            this.setState(s => ({
                ...s,
                world: { ...s.world, oceanAgeMap: newMap }
            }));
        }
    }

    private updateTrailingSeafloor(deltaMa: number): void {
        const state = this.getState();

        const currentTime = state.world.currentTime;
        const plates = state.world.plates;
        const activePlates = plates.filter(p => !p.deathTime && p.birthTime <= currentTime && p.id !== 'plate-seafloor');

        this.setState(s => {
            const nextPlates = [...s.world.plates];
            let targetIdx = nextPlates.findIndex(p => p.id === 'plate-seafloor');

            if (targetIdx === -1) {
                const targetPlate: TectonicPlate = {
                    id: 'plate-seafloor',
                    name: 'Oceanic Mantle',
                    color: '#1a1a1a',
                    visible: true,
                    locked: true,
                    polygons: [],
                    features: [],
                    center: [0, 0],
                    birthTime: -1000,
                    deathTime: null,
                    initialPolygons: [],
                    initialFeatures: [],
                    motionKeyframes: [{
                        time: -1000,
                        eulerPole: { position: [0, 0], rate: 0, visible: false },
                        snapshotPolygons: [],
                        snapshotFeatures: []
                    }],
                    motion: { eulerPole: { position: [0, 0], rate: 0, visible: false } },
                    events: [],
                    generateSeafloor: false,
                    zIndex: -1000  // Very low zIndex to be below all other plates
                };
                nextPlates.push(targetPlate);
                targetIdx = nextPlates.length - 1;
            }

            const newSeafloorFeatures: Feature[] = [];
            for (const plate of activePlates) {
                if (plate.generateSeafloor === false) continue;
                const pole = plate.motion.eulerPole;
                const invRate = -pole.rate * deltaMa;
                for (const poly of plate.polygons) {
                    const prevPoints = poly.points.map(pt => {
                        const v = latLonToVector(pt);
                        const vPrev = rotateVector(v, latLonToVector(pole.position), invRate);
                        return vectorToLatLon(vPrev);
                    });
                    const sPrev: any = [prevPoints.map(p => [p[0], p[1]])];
                    const sCurr: any = [poly.points.map(p => [p[0], p[1]])];
                    try {
                        const diff = polygonClipping.difference(sPrev, sCurr);
                        for (const geom of diff) {
                            for (const ring of geom) {
                                if (ring.length < 3) continue;
                                const coords: Coordinate[] = ring.map((p: any) => [p[0], p[1]]);
                                newSeafloorFeatures.push({
                                    id: `sf-${Date.now()}-${Math.random()}`,
                                    type: 'seafloor',
                                    position: coords[0],
                                    polygon: coords,
                                    age: currentTime,
                                    generatedAt: currentTime,
                                    rotation: 0,
                                    scale: 1,
                                    properties: { birthTime: currentTime }
                                });
                            }
                        }
                    } catch (e) { }
                }
            }

            if (newSeafloorFeatures.length > 0) {
                nextPlates[targetIdx] = {
                    ...nextPlates[targetIdx],
                    features: [...nextPlates[targetIdx].features, ...newSeafloorFeatures]
                };
                return { ...s, world: { ...s.world, plates: nextPlates } };
            }
            return s;
        });
    }
}
