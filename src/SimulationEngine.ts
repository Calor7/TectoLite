import { AppState, TectonicPlate, Coordinate, Feature, generateId, createDefaultMotion } from './types';

import {
    toRad,
    latLonToVector,
    vectorToLatLon,
    rotateVector,
    rotatePoint,
    calculateSphericalCentroid,
    Vector3
} from './utils/sphericalMath';
import { BoundarySystem } from './BoundarySystem';
// import { GeologicalAutomationSystem } from './systems/GeologicalAutomation'; // DISABLED
import { EventEffectsProcessor } from './systems/EventEffectsProcessor';
import { eventSystem } from './systems/EventSystem';


export class SimulationEngine {
    private isRunning = false;
    private lastUpdate = 0;
    private animationId: number | null = null;
    // private geologicalAutomation: GeologicalAutomationSystem; // DISABLED
    private eventEffectsProcessor: EventEffectsProcessor;

    constructor(
        private getState: () => AppState,
        private setState: (updater: (state: AppState) => AppState) => void
    ) {
        // this.geologicalAutomation = new GeologicalAutomationSystem(); // DISABLED
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

            // Phase 4: Geological Automation — DISABLED (features removed)
            const tempState = {
                ...state,
                world: {
                    ...state.world,
                    plates: newPlates,
                    boundaries: boundaries,
                    currentTime: time
                }
            };
            const postAutomationState = tempState; // Bypass automation

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
            let newPlates = state.world.plates.map(plate => {
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

            // --- AUTOMATED OCEANIC CRUST "EXPANDING RIFT" GENERATION ---
            if (globalOptions.enableExpandingRifts !== false) { // Default true
                // CLEANUP: Remove old "growing" strips (active gap fillers) so they can be regenerated fresh
                // This prevents duplicates and ensures the active strip always matches current rift position
                newPlates = newPlates.filter(p => !p.slabId?.endsWith('_growing'));

                const interval = globalOptions.oceanicGenerationInterval || 25;
                const riftSlabs = this.generateRiftCrust(newPlates, newTime, interval);
                if (riftSlabs.length > 0) {
                    newPlates = [...newPlates, ...riftSlabs];
                    // Note: generateRiftCrust might mutate 'newPlates' to remove rift indices from parents
                    // But we passed newPlates by content. 
                    // To handle handover, generateRiftCrust should return modified parents OR we blindly add children 
                    // and rely on the fact that we modify the OBJECT refs in newPlates?
                    // actually map() in update() creates shallow copies.
                    // generateRiftCrust will need to modify the objects in the array OR return a "patch".
                }
            } else if (globalOptions.enableAutoOceanicCrust) {
                // --- LEGACY FLOWLINE GENERATION ---
                // (Kept as fallback if enabled and Rifts disabled, or just remove as per plan?)
                // Plan says "Remove... and its calls".
                // But user didn't explicitly say "delete the code", just "replace current... generation".
                // I'll comment it out or remove it to keep it clean.
            }

            // Calculate Boundaries if enabled
            // ALWAYS update boundaries if Visualization OR Guided Creation is enabled.
            // If none are on, clear boundaries to prevent stale artifacts.
            const boundaries = (globalOptions.enableBoundaryVisualization ||
                globalOptions.enableGuidedCreation ||
                globalOptions.pauseOnFusionSuggestion)
                ? BoundarySystem.detectBoundaries(newPlates, newTime)
                : [];

            // Phase 3: Geological Automation — DISABLED (features removed)
            const tempState = {
                ...state,
                world: {
                    ...state.world,
                    plates: newPlates,
                    boundaries: boundaries,
                    currentTime: newTime
                }
            };
            const postAutomationState = tempState; // Bypass automation

            // Phase 4: Event System (detect tectonic events for guided creation)
            const postEventState = eventSystem.update(postAutomationState);
            const finalState = this.eventEffectsProcessor.update(postEventState);

            return finalState;
        });
        this.updateFlowlines();
    }

    // Helper: Interpolate points along a polyline to a fixed resolution (e.g. 1 degree)
    private interpolatePoints(points: Coordinate[], resolution: number): Coordinate[] {
        if (points.length < 2) return points;
        const result: Coordinate[] = [points[0]];

        for (let i = 0; i < points.length - 1; i++) {
            const p1 = points[i];
            const p2 = points[i + 1];

            // Spherical distance without import loop? Using class helper or just simple approx?
            // SimulationEngine imports from sphericalMath, so we use that.
            // But 'distance' wasn't imported. Let's assume linear interpolation on lat/lon for simplicity 
            // OR proper slerp if vectors available. 
            // Given the typical scale, linear lat/lon interp is "okay" for short segments but bad for long ones.
            // Let's use a robust Vector3 slerp/nlerp approach.

            const v1 = latLonToVector(p1);
            const v2 = latLonToVector(p2);

            // Dot for angle
            // We need 'distance' equivalent. 
            // Let's just use a simple approx distance: sqrt(dx^2 + dy^2) is bad for poles.
            // Let's reuse rotatePoint logic or just simple linear fraction if segments are small.
            // Actually, we should just iterate.

            const dotProd = v1.x * v2.x + v1.y * v2.y + v1.z * v2.z;
            const angle = Math.acos(Math.max(-1, Math.min(1, dotProd)));
            const distDeg = angle * (180 / Math.PI);

            const numSteps = Math.ceil(distDeg / resolution);

            for (let s = 1; s <= numSteps; s++) {
                const t = s / numSteps;
                // Slerp
                const sinTotal = Math.sin(angle);
                // If angle is too small, linear (nlerp) is fine
                if (sinTotal < 0.001) {
                    // Linear mix
                    const x = v1.x * (1 - t) + v2.x * t;
                    const y = v1.y * (1 - t) + v2.y * t;
                    const z = v1.z * (1 - t) + v2.z * t;
                    // Normalize
                    const mag = Math.sqrt(x * x + y * y + z * z);
                    result.push(vectorToLatLon({ x: x / mag, y: y / mag, z: z / mag }));
                } else {
                    const ratioA = Math.sin((1 - t) * angle) / sinTotal;
                    const ratioB = Math.sin(t * angle) / sinTotal;
                    const x = v1.x * ratioA + v2.x * ratioB;
                    const y = v1.y * ratioA + v2.y * ratioB;
                    const z = v1.z * ratioA + v2.z * ratioB;
                    // Already unit length theoretically, but safe to normalize
                    result.push(vectorToLatLon({ x, y, z }));
                }
            }
        }
        return result;
    }

    // --- AUTOMATED RIFT CRUST GENERATION ---
    // UPDATED: Single-Slab Physics + Visual Grid Overlay (Features)
    // --- CONVEYOR BELT / ACCRETION CRUST GENERATION ---
    // Renamed logic, kept method name for compatibility with update loop
    private generateRiftCrust(currentPlates: TectonicPlate[], currentTime: number, interval: number): TectonicPlate[] {
        const newStrips: TectonicPlate[] = [];
        const RIFT_GRID_RESOLUTION = 2.0;

        // 1. Identify Rift Plates (The Generators)
        const riftPlates = currentPlates.filter(p => p.type === 'rift');

        for (const rift of riftPlates) {
            const axisPoly = rift.polygons[0];
            if (!axisPoly || !axisPoly.points || axisPoly.points.length < 2) {
                continue;
            }

            const axisPoints = this.interpolatePoints(axisPoly.points, RIFT_GRID_RESOLUTION);
            const riftBirth = rift.birthTime;

            // Skip if rift hasn't been born yet
            if (currentTime <= riftBirth) continue;

            // 2. Find Connected Plates (The Pullers)
            // We only care about plates that are explicitly connected to this rift
            // AND are "diverging" (moving away).
            const connectedPlates = currentPlates.filter(p =>
                (p.connectedRiftIds?.includes(rift.id) || p.connectedRiftId === rift.id) &&
                p.type !== 'rift' &&
                p.type !== 'oceanic' // Only attach to the main lithosphere/continent parent
            );


            for (const plate of connectedPlates) {
                if (plate.riftGenerationMode === 'never') continue;
                if (plate.deathTime !== null && currentTime > plate.deathTime) continue;

                // Growing strips (_growing suffix) are cleaned up by update() each frame.
                // We only consider permanent strips for backfill scheduling.

                const getLatestPermanentStrip = () => {
                    const candidates = [...currentPlates, ...newStrips]
                        .filter(p =>
                            p.type === 'oceanic' &&
                            p.linkedToPlateId === plate.id &&
                            p.connectedRiftIds.includes(rift.id) &&
                            !p.slabId?.endsWith('_growing') // Ignore growing strips
                        )
                        .sort((a, b) => b.birthTime - a.birthTime);
                    return candidates[0];
                };

                let lastStrip = getLatestPermanentStrip();
                let nextGenerationTime = lastStrip
                    ? lastStrip.birthTime + interval
                    : (Math.floor(riftBirth / interval) + 1) * interval;

                // Loop to backfill Permanent Strips
                while (nextGenerationTime <= currentTime) {
                    const generationTime = nextGenerationTime;
                    nextGenerationTime += interval; // Advance for next loop

                    if (generationTime <= riftBirth) continue;
                    const stripId = `${plate.id}_strip_${generationTime}`;

                    // Double check existence
                    const alreadyExists = currentPlates.some(p => p.slabId === stripId) || newStrips.some(p => p.slabId === stripId);
                    if (alreadyExists) continue;

                    // --- Generate Geometry (Permanent) ---
                    // 1. Get History of Rift at Generation Time
                    const riftAtBirth = this.calculatePlateAtTime(rift, generationTime, currentPlates);
                    const birthAxisPoly = riftAtBirth.polygons[0];
                    if (!birthAxisPoly || !birthAxisPoly.points) continue;

                    const birthAxisPoints = this.interpolatePoints(birthAxisPoly.points, RIFT_GRID_RESOLUTION);

                    // Stitching
                    lastStrip = getLatestPermanentStrip(); // Update reference

                    let oldEdge: Coordinate[] = [];
                    let isStitched = false;

                    if (lastStrip && lastStrip.polygons.length > 0) {
                        const lastPoly = lastStrip.polygons[0];
                        if (lastPoly.riftEdgeIndices && lastPoly.riftEdgeIndices.length > 0) {
                            const edgePoints = lastPoly.riftEdgeIndices.map(i => lastPoly.points[i]);
                            oldEdge = edgePoints;
                            isStitched = true;
                        }
                    }

                    // Fallback Projection from Historical Rift
                    if (!isStitched) {
                        const effectiveOldBirth = Math.max(riftBirth, generationTime - interval);
                        const riftAtOldBirth = this.calculatePlateAtTime(rift, effectiveOldBirth, currentPlates);
                        const oldBirthAxisPoly = riftAtOldBirth.polygons[0];

                        if (oldBirthAxisPoly && oldBirthAxisPoly.points) {
                            const oldBirthAxisPoints = this.interpolatePoints(oldBirthAxisPoly.points, RIFT_GRID_RESOLUTION);
                            oldEdge = oldBirthAxisPoints.map(p => {
                                return this.applyPlateMotion(p, plate, effectiveOldBirth, currentTime, currentPlates);
                            });
                        }
                    }

                    // Young Edge: Historical Rift -> Current Time
                    const youngEdge = birthAxisPoints.map(p => {
                        return this.applyPlateMotion(p, plate, generationTime, currentTime, currentPlates);
                    });

                    if (youngEdge.length < 2 || oldEdge.length < 2) continue;

                    const ring = [...youngEdge, ...[...oldEdge].reverse(), youngEdge[0]];
                    const newRiftEdgeIndices = Array.from({ length: youngEdge.length }, (_, i) => i);

                    const gridFeatures: Feature[] = [];
                    // Add isochron feature (visual line)
                    gridFeatures.push({
                        id: generateId(),
                        type: 'flowline',
                        position: oldEdge[0],
                        rotation: 0,
                        scale: 1,
                        properties: { kind: 'isochron', age: generationTime },
                        trail: [...oldEdge],
                        generatedAt: generationTime,
                        originalPosition: oldEdge[0]
                    });

                    newStrips.push({
                        id: generateId(),
                        slabId: stripId,
                        name: `${plate.name} Crust ${generationTime}Ma`,
                        type: 'oceanic',
                        crustType: 'oceanic',
                        color: this.getState().world.globalOptions.oceanicCrustColor || '#3b82f6',
                        zIndex: (plate.zIndex || 0) - 1,
                        birthTime: generationTime,
                        deathTime: null,
                        visible: true,
                        locked: false,
                        center: calculateSphericalCentroid(ring),
                        polygons: [{
                            id: generateId(),
                            points: ring,
                            closed: true,
                            riftEdgeIndices: newRiftEdgeIndices
                        }],
                        features: gridFeatures,
                        initialPolygons: [{
                            id: generateId(),
                            points: ring,
                            closed: true,
                            riftEdgeIndices: newRiftEdgeIndices
                        }],
                        initialFeatures: gridFeatures,
                        motion: createDefaultMotion(),
                        motionKeyframes: [],
                        events: [],
                        linkedToPlateId: plate.id,
                        linkTime: generationTime,
                        connectedRiftIds: [rift.id],
                        connectedRiftId: rift.id
                    });
                } // End Backfill Loop

                // --- 4. Generate "Growing" Strip (Gap Filler) ---
                // Fills the space from lastPermanentStrip to Current Rift
                // Always regenerated.

                lastStrip = getLatestPermanentStrip();
                // If we have a last strip, and there is a gap > epsilon
                // Or if we have NO last strip but we are past rift birth (first growth)

                const lastStripTime = lastStrip ? lastStrip.birthTime : riftBirth;

                if (currentTime > lastStripTime + 0.1) {
                    const growingId = `${plate.id}_${rift.id}_growing`;

                    // Old Edge: From Last Strip (or Rift Start)
                    let oldEdge: Coordinate[] = [];
                    let isStitched = false;

                    if (lastStrip && lastStrip.polygons.length > 0) {
                        const lastPoly = lastStrip.polygons[0];
                        if (lastPoly.riftEdgeIndices && lastPoly.riftEdgeIndices.length > 0) {
                            oldEdge = lastPoly.riftEdgeIndices.map(i => lastPoly.points[i]);
                            isStitched = true;
                        }
                    }

                    if (!isStitched) {
                        // Project from Rift Birth (if first strip) or Last Strip Time
                        const effectiveOldBirth = lastStripTime;
                        const riftAtOld = this.calculatePlateAtTime(rift, effectiveOldBirth, currentPlates);
                        const oldAxisPoly = riftAtOld.polygons[0];
                        if (oldAxisPoly && oldAxisPoly.points) {
                            const oldPoints = this.interpolatePoints(oldAxisPoly.points, RIFT_GRID_RESOLUTION);
                            oldEdge = oldPoints.map(p => this.applyPlateMotion(p, plate, effectiveOldBirth, currentTime, currentPlates));
                        }
                    }

                    // Young Edge: The Current Rift (No motion projection needed as it's "Now")
                    // Actually, Rift might be moving, so we just take current axisPoints (which are at currentTime)
                    const youngEdge = axisPoints.map(p => [...p] as Coordinate);

                    if (youngEdge.length >= 2 && oldEdge.length >= 2) {
                        const ring = [...youngEdge, ...[...oldEdge].reverse(), youngEdge[0]];
                        const newRiftEdgeIndices = Array.from({ length: youngEdge.length }, (_, i) => i);

                        newStrips.push({
                            id: generateId(),
                            slabId: growingId,
                            name: `${plate.name} Active Crust`,
                            type: 'oceanic',
                            crustType: 'oceanic',
                            color: '#60a5fa', // Slight lighter blue for active?
                            zIndex: (plate.zIndex || 0) - 1,
                            birthTime: currentTime, // Functionally "Now"
                            deathTime: null,
                            visible: true,
                            locked: false,
                            center: calculateSphericalCentroid(ring),
                            polygons: [{
                                id: generateId(),
                                points: ring,
                                closed: true,
                                riftEdgeIndices: newRiftEdgeIndices
                            }],
                            features: [], // No isochrons on active strip
                            initialPolygons: [{
                                id: generateId(),
                                points: ring,
                                closed: true,
                                riftEdgeIndices: newRiftEdgeIndices
                            }],
                            initialFeatures: [],
                            motion: createDefaultMotion(),
                            motionKeyframes: [],
                            events: [],
                            linkedToPlateId: plate.id,
                            linkTime: currentTime,
                            connectedRiftIds: [rift.id],
                            connectedRiftId: rift.id
                        });
                    }
                }
            }
        }
        return newStrips;
    }



    // Helper to move a point forward in time according to a plate's motion history
    private applyPlateMotion(point: Coordinate, plate: TectonicPlate, fromTime: number, toTime: number, allPlates: TectonicPlate[]): Coordinate {
        let currentP = point;
        let time = fromTime;

        // Resolve linked motion (inherit from parent)
        let effectivePlate = plate;
        if (plate.linkedToPlateId) {
            let current = plate;
            const visited = new Set<string>();
            while (current.linkedToPlateId && !visited.has(current.id)) {
                visited.add(current.id);
                const parent = allPlates.find(p => p.id === current.linkedToPlateId);
                if (!parent) break;
                current = parent;
            }
            effectivePlate = current;
        }

        const keyframes = (effectivePlate.motionKeyframes || []).sort((a, b) => a.time - b.time);

        // If no keyframes, fallback to simple current motion
        if (keyframes.length === 0) {
            const pole = effectivePlate.motion.eulerPole;
            const dt = toTime - fromTime;
            if (dt > 1e-6) {
                const angle = pole.rate * dt;
                currentP = rotatePoint(currentP, pole.position, toRad(angle));
            }
            return currentP;
        }

        while (time < toTime) {
            let pole = effectivePlate.motion.eulerPole;
            let nextBoundary = toTime;

            // Find last keyframe <= time
            let activeKFIndex = -1;
            for (let i = 0; i < keyframes.length; i++) {
                if (keyframes[i].time <= time) activeKFIndex = i;
                else break;
            }

            if (activeKFIndex !== -1) {
                pole = keyframes[activeKFIndex].eulerPole;
                if (activeKFIndex + 1 < keyframes.length) {
                    nextBoundary = Math.min(toTime, keyframes[activeKFIndex + 1].time);
                }
            } else {
                // Before first keyframe: use first keyframe's pole (assume constant back in time)
                if (keyframes.length > 0) {
                    pole = keyframes[0].eulerPole;
                    nextBoundary = Math.min(toTime, keyframes[0].time);
                }
            }

            const dt = nextBoundary - time;
            if (dt > 1e-6) {
                const angle = pole.rate * dt;
                currentP = rotatePoint(currentP, pole.position, toRad(angle));
            }
            time = nextBoundary;
        }

        return currentP;
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

                const relevantKeyframes = parentKeyframes.filter(kf => kf.time <= t);

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

        // Find active keyframe OR synthesize one from initial state if none exist (e.g. oceanic strips)
        let activeKeyframe = keyframes
            .filter(kf => kf.time <= time)
            .sort((a, b) => b.time - a.time)[0];

        if (!activeKeyframe) {
            // Synthesize a keyframe closest to birth
            // For oceanic strips without keyframes, this allows them to be transformed by parent motion
            activeKeyframe = {
                time: plate.birthTime,
                eulerPole: plate.motion?.eulerPole || { position: [0, 90], rate: 0, visible: false },
                snapshotPolygons: plate.initialPolygons || plate.polygons,
                snapshotFeatures: plate.initialFeatures || []
            };
        }

        /* Legacy fallback removed - we handle static plates via synthetic keyframe above
        if (keyframes.length === 0) {
            return this.calculateWithLegacyMotion(plate, time, inheritedFeatures);
        }
        */

        if (!activeKeyframe) {
            // Fallback if something is really wrong (should cover above)
            return plate;
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
