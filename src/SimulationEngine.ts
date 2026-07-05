import { AppState, TectonicPlate, Coordinate, Feature, generateId, createDefaultMotion, RiftAxis, Isochron, TripleJunction } from './types';

import {
    latLonToVector,
    vectorToLatLon,
    normalize,
    calculateSphericalCentroid,
    nlerpCoord,
    rotateCoordByQuat,
    isPointInPolygon,
} from './utils/sphericalMath';
import { getMotionModel, activeStage, plateRotation, pointPositionAt } from './motion/RotationModel';
import { BoundarySystem } from './BoundarySystem';
import { EventEffectsProcessor } from './systems/EventEffectsProcessor';
import { eventSystem } from './systems/EventSystem';


export class SimulationEngine {
    private isRunning = false;
    private lastUpdate = 0;
    private animationId: number | null = null;
    private eventEffectsProcessor: EventEffectsProcessor;

    constructor(
        private getState: () => AppState,
        private setState: (updater: (state: AppState) => AppState) => void
    ) {
        this.eventEffectsProcessor = new EventEffectsProcessor();
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
            let newPlates = state.world.plates.map(plate => {
                const isBorn = time >= plate.birthTime;
                const isDead = plate.deathTime !== null && time >= plate.deathTime;

                if (!isBorn || isDead || plate.locked) return plate;

                return this.calculatePlateAtTime(plate, time, state.world.plates);
            });

            // Re-derive axis-based ocean rings and junction wedges (same pipeline as update loop,
            // but without recording: isochron/junction history is already stored in state)
            const updatedRiftAxes = [...(state.world.riftAxes || [])];
            let updatedJunctions: TripleJunction[] = [...(state.world.tripleJunctions || [])];
            if (globalOptions.enableExpandingRifts === true) { // Opt-in automation
                const res = this.deriveAxisGeometry(newPlates, updatedRiftAxes, updatedJunctions, time);
                updatedJunctions = res.junctions;
                newPlates = [...res.basePlates, ...res.derived];
            } else {
                // Automation off: still strip stale ephemeral plates from earlier frames
                newPlates = newPlates.filter(p => !p.riftAxisId && !p.junctionId);
            }

            // Calculate Boundaries if enabled
            // ALWAYS update boundaries if Visualization OR Guided Creation is enabled.
            // If none are on, clear boundaries to prevent stale artifacts.
            const boundaries = (globalOptions.enableBoundaryVisualization ||
                globalOptions.enableGuidedCreation ||
                globalOptions.pauseOnFusionSuggestion)
                ? BoundarySystem.detectBoundaries(newPlates, time)
                : [];

            // Phase 4: Geological Automation â€” DISABLED (features removed)
            const tempState = {
                ...state,
                world: {
                    ...state.world,
                    plates: newPlates,
                    riftAxes: updatedRiftAxes,
                    tripleJunctions: updatedJunctions,
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
            const updatedRiftAxes: RiftAxis[] = [...(state.world.riftAxes || [])];
            let updatedJunctions: TripleJunction[] = [...(state.world.tripleJunctions || [])];
            {
                const interval = globalOptions.oceanicGenerationInterval || 25;
                const newSlabs: TectonicPlate[] = [];

                // ISOCHRON PATH (RiftAxis-based) â€” opt-in automation.
                // The ephemeral-plate filter runs even when disabled so geometry
                // derived before the option was switched off doesn't linger.
                if (globalOptions.enableExpandingRifts === true) {
                    const res = this.deriveAxisGeometry(newPlates, updatedRiftAxes, updatedJunctions, newTime, interval);
                    updatedJunctions = res.junctions;
                    newPlates = res.basePlates;
                    newSlabs.push(...res.derived);
                } else {
                    newPlates = newPlates.filter(p => !p.riftAxisId && !p.junctionId);
                }

                // SIBLING + LEGACY PATHS ("Auto Generate") â€” opt-in automation.
                // Previously this checkbox was never read and these paths ran whenever
                // expanding rifts were on; they are now gated independently.
                if (globalOptions.enableAutoOceanicCrust === true) {
                    // Remove old sibling growing strips so they can be regenerated fresh
                    newPlates = newPlates.filter(p => !p.slabId?.endsWith('_growing'));
                    newSlabs.push(...this.generateSiblingCrust(newPlates, newTime, interval, updatedRiftAxes));
                    // LEGACY PATH: rift-based (for old plates without siblingSystem flag)
                    newSlabs.push(...this.generateRiftCrust(
                        newPlates.filter(p => !p.siblingSystem), newTime, interval
                    ));
                }

                if (newSlabs.length > 0) {
                    newPlates = [...newPlates, ...newSlabs];
                }
            }

            // Calculate Boundaries if enabled
            // ALWAYS update boundaries if Visualization OR Guided Creation is enabled.
            // If none are on, clear boundaries to prevent stale artifacts.
            const boundaries = (globalOptions.enableBoundaryVisualization ||
                globalOptions.enableGuidedCreation ||
                globalOptions.pauseOnFusionSuggestion)
                ? BoundarySystem.detectBoundaries(newPlates, newTime)
                : [];

            // Phase 3: Geological Automation â€” DISABLED (features removed)
            const tempState = {
                ...state,
                world: {
                    ...state.world,
                    plates: newPlates,
                    riftAxes: updatedRiftAxes,
                    tripleJunctions: updatedJunctions,
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

    // Resample a polyline to exactly N equally-spaced points via spherical interpolation
    private resamplePolyline(pts: Coordinate[], n: number): Coordinate[] {
        if (pts.length === n) return pts;
        if (pts.length < 2 || n < 2) return pts;
        const arcLengths = [0];
        for (let i = 1; i < pts.length; i++) {
            const v1 = latLonToVector(pts[i - 1]);
            const v2 = latLonToVector(pts[i]);
            const dot = Math.min(1, Math.max(-1, v1.x * v2.x + v1.y * v2.y + v1.z * v2.z));
            arcLengths.push(arcLengths[i - 1] + Math.acos(dot));
        }
        const totalLen = arcLengths[arcLengths.length - 1];
        if (totalLen < 1e-10) return pts.slice(0, n);
        const result: Coordinate[] = [];
        for (let i = 0; i < n; i++) {
            const targetLen = (i / (n - 1)) * totalLen;
            let seg = 0;
            while (seg < arcLengths.length - 2 && arcLengths[seg + 1] < targetLen) seg++;
            const segLen = arcLengths[seg + 1] - arcLengths[seg];
            const t = segLen > 1e-10 ? (targetLen - arcLengths[seg]) / segLen : 0;
            const v1 = latLonToVector(pts[seg]);
            const v2 = latLonToVector(pts[seg + 1]);
            const interp = normalize({
                x: v1.x * (1 - t) + v2.x * t,
                y: v1.y * (1 - t) + v2.y * t,
                z: v1.z * (1 - t) + v2.z * t
            });
            result.push(vectorToLatLon(interp));
        }
        return result;
    }

    // Build a closed ring polygon from outer and inner boundary polylines.
    // Resamples both to the same count so ring edges connect cleanly.
    private buildRing(outer: Coordinate[], inner: Coordinate[]): Coordinate[] | null {
        const n = Math.min(outer.length, inner.length);
        if (n < 2) return null;
        const outerR = this.resamplePolyline(outer, n);
        const innerR = this.resamplePolyline(inner, n);
        return [...outerR, ...[...innerR].reverse(), outerR[0]];
    }

    // Quick spherical area estimate (excess-angle method, returns steradians).
    // Used to reject degenerate sliver polygons that cause visual artifacts.
    private sphericalArea(pts: Coordinate[]): number {
        if (pts.length < 3) return 0;
        const vecs = pts.map(p => latLonToVector(p));
        let sum = 0;
        const n = vecs.length;
        for (let i = 0; i < n; i++) {
            const a = vecs[(i + n - 1) % n];
            const b = vecs[i];
            const c = vecs[(i + 1) % n];
            // Cross products for normals of great-circle planes
            const ab = normalize({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
            const bc = normalize({ x: b.y * c.z - b.z * c.y, y: b.z * c.x - b.x * c.z, z: b.x * c.y - b.y * c.x });
            const dot = Math.min(1, Math.max(-1, ab.x * bc.x + ab.y * bc.y + ab.z * bc.z));
            sum += Math.PI - Math.acos(dot);
        }
        return Math.abs(sum - (n - 2) * Math.PI);
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
                    gridFeatures.push({
                        id: generateId(),
                        type: 'seafloor',
                        position: oldEdge[0],
                        rotation: 0,
                        scale: 1,
                        properties: { kind: 'isochron', age: generationTime },
                        generatedAt: generationTime,
                        originalPosition: oldEdge[0]
                    });

                    newStrips.push({
                        id: generateId(),
                        slabId: stripId,
                        name: `${plate.name} Crust ${generationTime}Ma`,
                        type: 'oceanic',
                        polygonType: 'oceanic_plate',
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
                        linkTime: currentTime,
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
                            polygonType: 'oceanic_plate',
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

    private generateSiblingCrust(currentPlates: TectonicPlate[], currentTime: number, interval: number, riftAxes: RiftAxis[] = []): TectonicPlate[] {
        const newStrips: TectonicPlate[] = [];
        const RIFT_GRID_RESOLUTION = 2.0;

        // Pure helpers â€” hoisted so both the rift-strip pass and the junction-fill pass can use them.
        const getEdgePoints = (polygon: import('./types').Polygon, edges: import('./types').EdgeMeta[]): Coordinate[] => {
            const pts: Coordinate[] = [];
            for (const edge of edges) pts.push(polygon.points[edge.edgeIndex]);
            if (edges.length > 0) {
                const lastEdge = edges[edges.length - 1].edgeIndex;
                pts.push(polygon.points[(lastEdge + 1) % polygon.points.length]);
            }
            return this.interpolatePoints(pts, RIFT_GRID_RESOLUTION);
        };
        const computeMidlinePts = (pts1: Coordinate[], pts2: Coordinate[]): Coordinate[] => {
            const n = Math.min(pts1.length, pts2.length);
            return Array.from({ length: n }, (_, i) => {
                const v1 = latLonToVector(pts1[i]);
                const v2 = latLonToVector(pts2[n - 1 - i]);
                return vectorToLatLon(normalize({ x: (v1.x + v2.x) / 2, y: (v1.y + v2.y) / 2, z: (v1.z + v2.z) / 2 }));
            });
        };

        // Rift arm data collected during Pass 1, keyed by plate.id (the corner plate).
        // Used in Pass 2 to detect junction pairs and generate triangular fills.
        type RiftArmInfo = {
            groupId: string; plate: TectonicPlate; polyIdx: number;
            pEdges: import('./types').EdgeMeta[]; qPlate: TectonicPlate;
            qPolyIndex: number; qEdges: import('./types').EdgeMeta[];
            groupBirth: number; currentEdgePts: Coordinate[]; currentMidline: Coordinate[];
        };
        const riftArmsByPlate = new Map<string, RiftArmInfo[]>();

        const activePlates = currentPlates.filter(p =>
            p.siblingSystem &&
            p.type !== 'oceanic' &&
            p.birthTime <= currentTime &&
            (p.deathTime === null || p.deathTime > currentTime)
        );

        for (const plate of activePlates) {
            for (let polyIdx = 0; polyIdx < plate.polygons.length; polyIdx++) {
                const poly = plate.polygons[polyIdx];
                if (!poly.edgeMeta) continue;

                const activeGroupIds = new Set<string>();
                for (const meta of poly.edgeMeta) {
                    if (meta.siblings) {
                        for (const s of meta.siblings) {
                            if (!s.frozen && s.siblingPlateId) {
                                activeGroupIds.add(s.groupId);
                            }
                        }
                    }
                }

                for (const groupId of activeGroupIds) {
                    // Skip groups handled by the RiftAxis system
                    if (riftAxes.some(a => a.groupId === groupId && a.state !== 'dead')) continue;

                    const pEdges = poly.edgeMeta.filter(m => m.siblings?.some(s => s.groupId === groupId && !s.frozen));
                    if (pEdges.length === 0) continue;
                    
                    pEdges.sort((a, b) => a.edgeIndex - b.edgeIndex);

                    const firstSibling = pEdges[0].siblings!.find(s => s.groupId === groupId && !s.frozen)!;
                    const qId = firstSibling.siblingPlateId;
                    const qPlate = currentPlates.find(p => p.id === qId);
                    if (!qPlate || (qPlate.deathTime !== null && qPlate.deathTime <= currentTime)) continue;

                    let qEdges: import('./types').EdgeMeta[] = [];
                    let qPolyIndex = -1;
                    
                    for (let qi = 0; qi < qPlate.polygons.length; qi++) {
                        const qp = qPlate.polygons[qi];
                        if (qp.edgeMeta) {
                            const edges = qp.edgeMeta.filter(m => m.siblings?.some(s => s.groupId === groupId && !s.frozen));
                            if (edges.length > 0) {
                                qEdges = edges;
                                qPolyIndex = qi;
                                break;
                            }
                        }
                    }
                    if (qEdges.length === 0 || qPolyIndex === -1) continue;
                    const qPoly = qPlate.polygons[qPolyIndex];

                    qEdges.sort((a, b) => a.edgeIndex - b.edgeIndex);

                    // Process each sibling pair only once (from the plate with the smaller id)
                    if (plate.id >= qPlate.id) continue;

                    const getLatestPermanentStrip = () => {
                        const candidates = [...currentPlates, ...newStrips]
                            .filter(p =>
                                p.type === 'oceanic' &&
                                p.linkedToPlateId === plate.id &&
                                p.slabId && p.slabId.includes(`_${groupId}_`) &&
                                !p.slabId.endsWith('_growing')
                            )
                            .sort((a, b) => b.birthTime - a.birthTime);
                        return candidates[0];
                    };

                    const groupBirth = firstSibling.createdAt;

                    let lastStrip = getLatestPermanentStrip();
                    let nextGenerationTime = lastStrip
                        ? lastStrip.birthTime + interval
                        : (Math.floor(groupBirth / interval) + 1) * interval;

                    // Returns the previous strip's midline moved to currentTime for both plates.
                    // forQ is reversed so it matches the top-to-bottom winding needed by strip B.
                    const getPrevMidline = (prevGenTime: number): { forP: Coordinate[], forQ: Coordinate[] } | null => {
                        const pAtPrev = this.calculatePlateAtTime(plate, prevGenTime, currentPlates);
                        const qAtPrev = this.calculatePlateAtTime(qPlate, prevGenTime, currentPlates);
                        const pPrevPoly = pAtPrev.polygons[polyIdx];
                        const qPrevPoly = qAtPrev.polygons[qPolyIndex];
                        if (!pPrevPoly || !qPrevPoly) return null;
                        const rawPEdgePrev = getEdgePoints(pPrevPoly, pEdges);
                        const rawQEdgePrev = getEdgePoints(qPrevPoly, qEdges);
                        const rawMidlinePrev = computeMidlinePts(rawPEdgePrev, rawQEdgePrev);
                        return {
                            forP: rawMidlinePrev.map(p => this.applyPlateMotion(p, plate, prevGenTime, currentTime, currentPlates)),
                            forQ: [...rawMidlinePrev.map(p => this.applyPlateMotion(p, qPlate, prevGenTime, currentTime, currentPlates))].reverse()
                        };
                    };

                    while (nextGenerationTime <= currentTime) {
                        const generationTime = nextGenerationTime;
                        nextGenerationTime += interval;

                        if (generationTime <= groupBirth) continue;
                        const stripIdA = `${plate.id}_${groupId}_strip_${generationTime}`;
                        // Use semantic check: match by parent plate, rift group, and age â€” not by the
                        // slabId prefix (which changes after a re-split re-links strips to a new plate).
                        const alreadyExists = [...currentPlates, ...newStrips].some(p =>
                            p.type === 'oceanic' &&
                            p.linkedToPlateId === plate.id &&
                            p.slabId?.includes(`_${groupId}_`) &&
                            p.birthTime === generationTime
                        );
                        if (alreadyExists) continue;

                        lastStrip = getLatestPermanentStrip();

                        const pAtBirth = this.calculatePlateAtTime(plate, generationTime, currentPlates);
                        const qAtBirth = this.calculatePlateAtTime(qPlate, generationTime, currentPlates);
                        const pBirthPoly = pAtBirth.polygons[polyIdx];
                        const qBirthPoly = qAtBirth.polygons[qPolyIndex];
                        if (!pBirthPoly || !qBirthPoly) continue;

                        const rawPEdge = getEdgePoints(pBirthPoly, pEdges);
                        const rawQEdge = getEdgePoints(qBirthPoly, qEdges);
                        if (rawPEdge.length < 2 || rawQEdge.length < 2) continue;

                        // Inner boundary: rift midline at generationTime
                        const rawMidline = computeMidlinePts(rawPEdge, rawQEdge);
                        const midlinePCurr = rawMidline.map(p => this.applyPlateMotion(p, plate, generationTime, currentTime, currentPlates));
                        const midlineQCurr = rawMidline.map(p => this.applyPlateMotion(p, qPlate, generationTime, currentTime, currentPlates));

                        // Outer boundary: previous strip's midline if one exists, else the plate's rift edge
                        let outerA: Coordinate[];
                        let outerB: Coordinate[];
                        if (lastStrip) {
                            const prev = getPrevMidline(lastStrip.birthTime);
                            outerA = prev?.forP ?? rawPEdge.map(p => this.applyPlateMotion(p, plate, generationTime, currentTime, currentPlates));
                            outerB = prev?.forQ ?? rawQEdge.map(p => this.applyPlateMotion(p, qPlate, generationTime, currentTime, currentPlates));
                        } else {
                            outerA = rawPEdge.map(p => this.applyPlateMotion(p, plate, generationTime, currentTime, currentPlates));
                            outerB = rawQEdge.map(p => this.applyPlateMotion(p, qPlate, generationTime, currentTime, currentPlates));
                        }

                        const stripIdB = `${qPlate.id}_${groupId}_strip_${generationTime}`;
                        const ringA = this.buildRing(outerA, midlinePCurr);
                        const ringB = this.buildRing(outerB, [...midlineQCurr].reverse());
                        if (!ringA || !ringB) continue;

                        const crustColor = this.getState().world.globalOptions.oceanicCrustColor || '#3b82f6';

                        newStrips.push({
                            id: generateId(),
                            slabId: stripIdA,
                            name: `${plate.name} Crust ${generationTime}Ma`,
                            type: 'oceanic',
                            polygonType: 'oceanic_plate',
                            color: crustColor,
                            zIndex: (plate.zIndex || 0) - 1,
                            birthTime: generationTime,
                            deathTime: null,
                            visible: true,
                            locked: false,
                            center: calculateSphericalCentroid(ringA),
                            polygons: [{ id: generateId(), points: ringA, closed: true, edgeMeta: [] }],
                            features: [],
                            initialPolygons: [{ id: generateId(), points: ringA, closed: true }],
                            initialFeatures: [],
                            motion: createDefaultMotion(),
                            motionKeyframes: [],
                            events: [],
                            linkedToPlateId: plate.id,
                            linkTime: currentTime,
                            connectedRiftIds: [],
                            siblingSystem: true
                        });

                        newStrips.push({
                            id: generateId(),
                            slabId: stripIdB,
                            name: `${qPlate.name} Crust ${generationTime}Ma`,
                            type: 'oceanic',
                            polygonType: 'oceanic_plate',
                            color: crustColor,
                            zIndex: (qPlate.zIndex || 0) - 1,
                            birthTime: generationTime,
                            deathTime: null,
                            visible: true,
                            locked: false,
                            center: calculateSphericalCentroid(ringB),
                            polygons: [{ id: generateId(), points: ringB, closed: true, edgeMeta: [] }],
                            features: [],
                            initialPolygons: [{ id: generateId(), points: ringB, closed: true }],
                            initialFeatures: [],
                            motion: createDefaultMotion(),
                            motionKeyframes: [],
                            events: [],
                            linkedToPlateId: qPlate.id,
                            linkTime: currentTime,
                            connectedRiftIds: [],
                            siblingSystem: true
                        });
                    }

                    // Growing strips â€” from last permanent midline (or rift edge) to the live midline
                    const pCurrentPts = getEdgePoints(poly, pEdges);
                    const qCurrentPts = getEdgePoints(qPoly, qEdges);

                    if (pCurrentPts.length >= 2 && qCurrentPts.length >= 2) {
                        const midlineCurrent = computeMidlinePts(pCurrentPts, qCurrentPts);

                        // Collect for junction fill Pass 2 (both plates are corners of this rift).
                        for (const cornerId of [plate.id, qPlate.id]) {
                            if (!riftArmsByPlate.has(cornerId)) riftArmsByPlate.set(cornerId, []);
                            riftArmsByPlate.get(cornerId)!.push({
                                groupId, plate, polyIdx, pEdges,
                                qPlate, qPolyIndex, qEdges, groupBirth,
                                currentEdgePts: cornerId === plate.id ? pCurrentPts : qCurrentPts,
                                currentMidline: midlineCurrent,
                            });
                        }

                        const latestPerm = getLatestPermanentStrip();
                        let growOuterA: Coordinate[];
                        let growOuterB: Coordinate[];
                        if (latestPerm) {
                            const prev = getPrevMidline(latestPerm.birthTime);
                            growOuterA = prev?.forP ?? pCurrentPts;
                            growOuterB = prev?.forQ ?? qCurrentPts;
                        } else {
                            growOuterA = pCurrentPts;
                            growOuterB = qCurrentPts;
                        }

                        const ringGA = this.buildRing(growOuterA, midlineCurrent);
                        const ringGB = this.buildRing(growOuterB, [...midlineCurrent].reverse());

                        if (ringGA && ringGB) {
                        newStrips.push({
                            id: generateId(),
                            slabId: `${plate.id}_${groupId}_growing`,
                            name: `${plate.name} Active Rift`,
                            type: 'oceanic',
                            polygonType: 'oceanic_plate',
                            color: '#60a5fa',
                            zIndex: (plate.zIndex || 0) - 1,
                            birthTime: currentTime,
                            deathTime: null,
                            visible: true,
                            locked: false,
                            center: calculateSphericalCentroid(ringGA),
                            polygons: [{ id: generateId(), points: ringGA, closed: true, edgeMeta: [] }],
                            features: [],
                            initialPolygons: [{ id: generateId(), points: ringGA, closed: true }],
                            initialFeatures: [],
                            motion: createDefaultMotion(),
                            motionKeyframes: [],
                            events: [],
                            linkedToPlateId: plate.id,
                            linkTime: currentTime,
                            connectedRiftIds: [],
                            siblingSystem: true
                        });

                        newStrips.push({
                            id: generateId(),
                            slabId: `${qPlate.id}_${groupId}_growing`,
                            name: `${qPlate.name} Active Rift`,
                            type: 'oceanic',
                            polygonType: 'oceanic_plate',
                            color: '#60a5fa',
                            zIndex: (qPlate.zIndex || 0) - 1,
                            birthTime: currentTime,
                            deathTime: null,
                            visible: true,
                            locked: false,
                            center: calculateSphericalCentroid(ringGB),
                            polygons: [{ id: generateId(), points: ringGB, closed: true, edgeMeta: [] }],
                            features: [],
                            initialPolygons: [{ id: generateId(), points: ringGB, closed: true }],
                            initialFeatures: [],
                            motion: createDefaultMotion(),
                            motionKeyframes: [],
                            events: [],
                            linkedToPlateId: qPlate.id,
                            linkTime: currentTime,
                            connectedRiftIds: [],
                            siblingSystem: true
                        });
                        } // end if (ringGA && ringGB)
                    }
                }
            }
        }

        // â”€â”€ Pass 2: Junction fills â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        // For each plate that is a corner of 2+ active rifts, detect shared rift-edge endpoints
        // (within ~0.5Â° tolerance) and generate triangular oceanic fill for the fan-shaped gap.
        const JUNCTION_TOL = 1 - Math.cos(0.5 * Math.PI / 180); // dot-product threshold â‰ˆ 0.5Â°
        const dotCoord = (a: Coordinate, b: Coordinate) => {
            const va = latLonToVector(a); const vb = latLonToVector(b);
            return va.x * vb.x + va.y * vb.y + va.z * vb.z;
        };

        for (const [pid, arms] of riftArmsByPlate) {
            if (arms.length < 2) continue;
            const cornerPlate = currentPlates.find(p => p.id === pid);
            if (!cornerPlate) continue;
            const crustColor = this.getState().world.globalOptions.oceanicCrustColor || '#3b82f6';

            for (let i = 0; i < arms.length; i++) {
                for (let j = i + 1; j < arms.length; j++) {
                    const armA = arms[i];
                    const armB = arms[j];
                    if (armA.groupId === armB.groupId) continue; // same rift, different corner

                    // Find which endpoint of each arm's rift edge is the shared junction vertex.
                    type Ep = { pt: Coordinate; midEnd: Coordinate; atStart: boolean };
                    const epsA: Ep[] = [
                        { pt: armA.currentEdgePts[0], midEnd: armA.currentMidline[0], atStart: true },
                        { pt: armA.currentEdgePts[armA.currentEdgePts.length - 1], midEnd: armA.currentMidline[armA.currentMidline.length - 1], atStart: false },
                    ];
                    const epsB: Ep[] = [
                        { pt: armB.currentEdgePts[0], midEnd: armB.currentMidline[0], atStart: true },
                        { pt: armB.currentEdgePts[armB.currentEdgePts.length - 1], midEnd: armB.currentMidline[armB.currentMidline.length - 1], atStart: false },
                    ];

                    let junctionPt: Coordinate | null = null;
                    let midEndA: Coordinate | null = null;
                    let midEndB: Coordinate | null = null;
                    let junctionAtStartA = true;
                    let junctionAtStartB = true;

                    outer: for (const epA of epsA) {
                        for (const epB of epsB) {
                            if (dotCoord(epA.pt, epB.pt) > 1 - JUNCTION_TOL) {
                                junctionPt = epA.pt; midEndA = epA.midEnd; midEndB = epB.midEnd;
                                junctionAtStartA = epA.atStart; junctionAtStartB = epB.atStart;
                                break outer;
                            }
                        }
                    }
                    if (!junctionPt || !midEndA || !midEndB) continue;

                    // Helper: midline endpoint for arm at a past time, advanced to currentTime.
                    const getMidEndAtTime = (arm: RiftArmInfo, atStart: boolean, time: number): Coordinate | null => {
                        const pAtT = this.calculatePlateAtTime(arm.plate, time, currentPlates);
                        const qAtT = this.calculatePlateAtTime(arm.qPlate, time, currentPlates);
                        const pPoly = pAtT.polygons[arm.polyIdx];
                        const qPoly = qAtT.polygons[arm.qPolyIndex];
                        if (!pPoly || !qPoly) return null;
                        const pPts = getEdgePoints(pPoly, arm.pEdges);
                        const qPts = getEdgePoints(qPoly, arm.qEdges);
                        if (pPts.length < 2 || qPts.length < 2) return null;
                        const mid = computeMidlinePts(pPts, qPts);
                        const rawEnd = atStart ? mid[0] : mid[mid.length - 1];
                        return this.applyPlateMotion(rawEnd, arm.plate, time, currentTime, currentPlates);
                    };

                    // Canonical slabId prefix â€” sort groupIds so A-B and B-A produce the same key.
                    const [gMin, gMax] = [armA.groupId, armB.groupId].sort();
                    const jPrefix = `${pid}_junction_${gMin}_${gMax}`;
                    const groupBirthJ = Math.max(armA.groupBirth, armB.groupBirth);

                    // Find last existing permanent junction fill.
                    const existingPerms = [...currentPlates, ...newStrips]
                        .filter(p => p.type === 'oceanic' && p.linkedToPlateId === pid &&
                            p.slabId?.startsWith(jPrefix) && !p.slabId.endsWith('_growing'))
                        .sort((a, b) => b.birthTime - a.birthTime);
                    let lastPermTime: number | null = existingPerms.length > 0 ? existingPerms[0].birthTime : null;

                    let nextPermTime = lastPermTime !== null
                        ? lastPermTime + interval
                        : (Math.floor(groupBirthJ / interval) + 1) * interval;

                    // Permanent banded junction fills.
                    while (nextPermTime <= currentTime) {
                        const T = nextPermTime;
                        nextPermTime += interval;
                        if (T <= groupBirthJ) continue;
                        const already = [...currentPlates, ...newStrips].some(p =>
                            p.type === 'oceanic' && p.linkedToPlateId === pid &&
                            p.slabId?.startsWith(jPrefix) && p.birthTime === T && !p.slabId.endsWith('_growing')
                        );
                        if (already) continue;

                        const midEndA_curr = getMidEndAtTime(armA, junctionAtStartA, T);
                        const midEndB_curr = getMidEndAtTime(armB, junctionAtStartB, T);
                        if (!midEndA_curr || !midEndB_curr) continue;

                        let ring: Coordinate[];
                        if (lastPermTime === null) {
                            // First band: triangle from junction vertex at T to both midline endpoints.
                            const pAtT = this.calculatePlateAtTime(armA.plate, T, currentPlates);
                            const pPoly = pAtT.polygons[armA.polyIdx];
                            if (!pPoly) continue;
                            const pPtsAtT = getEdgePoints(pPoly, armA.pEdges);
                            const rawJ = junctionAtStartA ? pPtsAtT[0] : pPtsAtT[pPtsAtT.length - 1];
                            const jMoved = this.applyPlateMotion(rawJ, armA.plate, T, currentTime, currentPlates);
                            ring = [jMoved, midEndA_curr, midEndB_curr, jMoved];
                        } else {
                            // Subsequent bands: quad between previous and current midline endpoints.
                            const midEndA_prev = getMidEndAtTime(armA, junctionAtStartA, lastPermTime);
                            const midEndB_prev = getMidEndAtTime(armB, junctionAtStartB, lastPermTime);
                            if (!midEndA_prev || !midEndB_prev) continue;
                            ring = [midEndA_prev, midEndA_curr, midEndB_curr, midEndB_prev, midEndA_prev];
                        }
                        lastPermTime = T;

                        newStrips.push({
                            id: generateId(), slabId: `${jPrefix}_${T}`,
                            name: `Junction Crust ${T}Ma`, type: 'oceanic', polygonType: 'oceanic_plate',
                            color: crustColor, zIndex: (cornerPlate.zIndex || 0) - 1,
                            birthTime: T, deathTime: null, visible: true, locked: false,
                            center: calculateSphericalCentroid(ring),
                            polygons: [{ id: generateId(), points: ring, closed: true, edgeMeta: [] }],
                            features: [], initialPolygons: [{ id: generateId(), points: ring, closed: true }],
                            initialFeatures: [], motion: createDefaultMotion(), motionKeyframes: [],
                            events: [], linkedToPlateId: pid, linkTime: currentTime,
                            connectedRiftIds: [], siblingSystem: true,
                        });
                    }

                    // Growing junction fill â€” from last permanent boundary to current live midline endpoints.
                    const latestPermJ = [...currentPlates, ...newStrips]
                        .filter(p => p.type === 'oceanic' && p.linkedToPlateId === pid &&
                            p.slabId?.startsWith(jPrefix) && !p.slabId.endsWith('_growing'))
                        .sort((a, b) => b.birthTime - a.birthTime)[0];

                    let growRing: Coordinate[];
                    if (latestPermJ) {
                        const outerA = getMidEndAtTime(armA, junctionAtStartA, latestPermJ.birthTime);
                        const outerB = getMidEndAtTime(armB, junctionAtStartB, latestPermJ.birthTime);
                        growRing = (outerA && outerB)
                            ? [outerA, midEndA, midEndB, outerB, outerA]
                            : [junctionPt, midEndA, midEndB, junctionPt];
                    } else {
                        growRing = [junctionPt, midEndA, midEndB, junctionPt];
                    }

                    newStrips.push({
                        id: generateId(), slabId: `${jPrefix}_growing`,
                        name: `Junction Active`, type: 'oceanic', polygonType: 'oceanic_plate',
                        color: '#60a5fa', zIndex: (cornerPlate.zIndex || 0) - 1,
                        birthTime: currentTime, deathTime: null, visible: true, locked: false,
                        center: calculateSphericalCentroid(growRing),
                        polygons: [{ id: generateId(), points: growRing, closed: true, edgeMeta: [] }],
                        features: [], initialPolygons: [{ id: generateId(), points: growRing, closed: true }],
                        initialFeatures: [], motion: createDefaultMotion(), motionKeyframes: [],
                        events: [], linkedToPlateId: pid, linkTime: currentTime,
                        connectedRiftIds: [], siblingSystem: true,
                    });
                }
            }
        }
        // â”€â”€ End Pass 2 â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

        return newStrips;
    }

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // ISOCHRON-BASED OCEAN GENERATION â€” GPlates-inspired derived geometry
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

    private readonly RIFT_GRID_RESOLUTION = 2.0;

    /** Extract rift-edge points from a plate polygon by groupId. */
    private getAxisEdgePoints(polygon: import('./types').Polygon, edges: import('./types').EdgeMeta[]): Coordinate[] {
        const pts: Coordinate[] = [];
        for (const edge of edges) pts.push(polygon.points[edge.edgeIndex]);
        if (edges.length > 0) {
            const lastEdge = edges[edges.length - 1].edgeIndex;
            pts.push(polygon.points[(lastEdge + 1) % polygon.points.length]);
        }
        return this.interpolatePoints(pts, this.RIFT_GRID_RESOLUTION);
    }

    /** Compute midline between two edge-point arrays (second array is reversed for correspondence). */
    private computeAxisMidline(pts1: Coordinate[], pts2: Coordinate[]): Coordinate[] {
        const n = Math.min(pts1.length, pts2.length);
        return Array.from({ length: n }, (_, i) => {
            const v1 = latLonToVector(pts1[i]);
            const v2 = latLonToVector(pts2[n - 1 - i]);
            return vectorToLatLon(normalize({ x: (v1.x + v2.x) / 2, y: (v1.y + v2.y) / 2, z: (v1.z + v2.z) / 2 }));
        });
    }

    /** Find rift edges on a plate by groupId (no edge index references). */
    private findAxisRiftEdges(plate: TectonicPlate, groupId: string): { poly: import('./types').Polygon; edges: import('./types').EdgeMeta[] } | null {
        for (const poly of plate.polygons) {
            if (!poly.edgeMeta) continue;
            const edges = poly.edgeMeta.filter(e => e.sourceId === groupId && e.type === 'rift');
            if (edges.length > 0) {
                edges.sort((a, b) => a.edgeIndex - b.edgeIndex);
                return { poly, edges };
            }
        }
        return null;
    }

    /** Find a plate alive at a given time. */
    private findAliveAt(plates: TectonicPlate[], plateId: string, time: number): TectonicPlate | undefined {
        return plates.find(p =>
            p.id === plateId && p.birthTime <= time &&
            (p.deathTime === null || p.deathTime > time)
        );
    }

    /**
     * Record new isochrons on active rift axes.
     * Each isochron is a midline snapshot stored in absolute coordinates at creation time.
     */
    private recordIsochrons(
        axes: RiftAxis[],
        currentPlates: TectonicPlate[],
        currentTime: number,
        interval: number
    ): void {
        for (const axis of axes) {
            if (axis.state !== 'active') continue;

            const plateA = this.findAliveAt(currentPlates, axis.plateIdA, currentTime);
            const plateB = this.findAliveAt(currentPlates, axis.plateIdB, currentTime);
            if (!plateA || !plateB) {
                axis.state = 'dead';
                axis.deathTime = currentTime;
                continue;
            }

            const lastTime = axis.isochrons.length > 0
                ? axis.isochrons[axis.isochrons.length - 1].time
                : axis.birthTime;

            let nextTime = lastTime + interval;
            while (nextTime <= currentTime) {
                // When isochron time predates a child plate's birth (after re-split),
                // use the parent plate that was alive at that time instead.
                const resolveForTime = (plate: TectonicPlate, t: number): TectonicPlate | undefined => {
                    if (t >= plate.birthTime) return plate;
                    if (plate.parentPlateId) {
                        const parent = currentPlates.find(p => p.id === plate.parentPlateId);
                        if (parent) return resolveForTime(parent, t);
                    }
                    return undefined;
                };
                const effectiveA = resolveForTime(plateA, nextTime);
                const effectiveB = resolveForTime(plateB, nextTime);
                if (!effectiveA || !effectiveB) { nextTime += interval; continue; }

                // Compute plate positions at the isochron time
                const plateAatT = this.calculatePlateAtTime(effectiveA, nextTime, currentPlates);
                const plateBatT = this.calculatePlateAtTime(effectiveB, nextTime, currentPlates);

                const infoA = this.findAxisRiftEdges(plateAatT, axis.groupId);
                const infoB = this.findAxisRiftEdges(plateBatT, axis.groupId);
                if (!infoA || !infoB) { nextTime += interval; continue; }

                const ptsA = this.getAxisEdgePoints(infoA.poly, infoA.edges);
                const ptsB = this.getAxisEdgePoints(infoB.poly, infoB.edges);
                if (ptsA.length < 2 || ptsB.length < 2) { nextTime += interval; continue; }

                const midline = this.computeAxisMidline(ptsA, ptsB);
                axis.isochrons.push({ time: nextTime, polyline: midline });
                nextTime += interval;
            }
        }
    }

    /**
     * Record the official junction position at each isochron interval by averaging the
     * junction-end midline points of all axes meeting at the junction.
     * Must be called AFTER recordIsochrons so the freshly-recorded isochrons are available.
     */
    private recordJunctionHistory(
        junctions: TripleJunction[],
        axes: RiftAxis[],
        currentTime: number,
        interval: number
    ): void {
        for (const junction of junctions) {
            if (junction.state === 'dead') continue;
            if (!junction.junctionHistory) junction.junctionHistory = [];

            const history = junction.junctionHistory;
            const lastTime = history.length > 0 ? history[history.length - 1].time : junction.birthTime;
            let nextTime = lastTime + interval;

            while (nextTime <= currentTime) {
                // Average the junction-end midline points of all axes at nextTime
                const pts: Coordinate[] = [];
                for (let ai = 0; ai < junction.axisIds.length; ai++) {
                    const axis = axes.find(a => a.id === junction.axisIds[ai]);
                    if (!axis || axis.state === 'dead') continue;
                    const atStart = junction.axisJunctionAtStart[ai];
                    // Use the most recent isochron at or before nextTime
                    const iso = [...axis.isochrons].reverse().find(i => i.time <= nextTime);
                    if (iso) {
                        pts.push(atStart ? iso.polyline[0] : iso.polyline[iso.polyline.length - 1]);
                    } else {
                        // Fall back to birth polyline endpoint
                        const birth = this.interpolatePoints(axis.birthPolyline, this.RIFT_GRID_RESOLUTION);
                        pts.push(atStart ? birth[0] : birth[birth.length - 1]);
                    }
                }
                if (pts.length >= 1) {
                    history.push({ time: nextTime, point: calculateSphericalCentroid(pts) });
                }
                nextTime += interval;
            }
        }
    }

    /**
     * Derive ephemeral ocean ring TectonicPlate objects from isochron history.
     * These are destroyed and recreated each frame â€” no persistent state.
     *
     * When junctions are provided, the junction-end of each ring boundary polyline is
     * clipped to the official junction position stored in `junctionHistory`. This ensures
     * the ring's junction corner matches the wedge fill's corner exactly (Rec 6).
     */
    private deriveOceanRings(
        axes: RiftAxis[],
        currentPlates: TectonicPlate[],
        currentTime: number,
        junctions: TripleJunction[] = []
    ): TectonicPlate[] {
        const rings: TectonicPlate[] = [];
        const crustColor = this.getState().world.globalOptions.oceanicCrustColor || '#3b82f6';
        const MIN_AREA = 1e-4;

        // Build per-axis clip lookup from junctionHistory
        // Maps axisId -> { atStart: whether junction is at polyline[0], history: sorted time->point }
        type ClipEntry = { atStart: boolean; history: { time: number; pt: Coordinate }[] };
        const axisClip = new Map<string, ClipEntry>();
        for (const junction of junctions) {
            const jh = junction.junctionHistory;
            if (!jh || jh.length === 0) continue;
            for (let ai = 0; ai < junction.axisIds.length; ai++) {
                const axisId = junction.axisIds[ai];
                if (axisClip.has(axisId)) continue; // first junction found wins
                axisClip.set(axisId, {
                    atStart: junction.axisJunctionAtStart[ai],
                    history: jh.map(jv => ({ time: jv.time, pt: jv.point })),
                });
            }
        }

        // Replace the junction-end point of a polyline with the official average position
        const clipJunctionEnd = (polyline: Coordinate[], axisId: string, time: number): Coordinate[] => {
            const clip = axisClip.get(axisId);
            if (!clip) return polyline;
            const jPt = this.interpolateTimedPoint(clip.history, time);
            if (!jPt) return polyline;
            const clipped = [...polyline];
            if (clip.atStart) clipped[0] = jPt;
            else clipped[clipped.length - 1] = jPt;
            return clipped;
        };

        for (const axis of axes) {
            // Skip dead axes with no isochrons (nothing to render)
            if (axis.isochrons.length === 0 && axis.state === 'dead') continue;

            const plateA = this.findAliveAt(currentPlates, axis.plateIdA, currentTime);
            const plateB = this.findAliveAt(currentPlates, axis.plateIdB, currentTime);
            // Need at least one plate to derive rings (the other side may have been subducted)
            if (!plateA && !plateB) continue;

            // Build the boundary chain: birthPolyline, isochrons, [current midline]
            // Each polyline has its junction end clipped to the official junction position.
            const boundaries: Isochron[] = [
                {
                    time: axis.birthTime,
                    polyline: clipJunctionEnd(
                        this.interpolatePoints(axis.birthPolyline, this.RIFT_GRID_RESOLUTION),
                        axis.id,
                        axis.birthTime
                    ),
                }
            ];
            for (const iso of axis.isochrons) {
                if (iso.time <= currentTime) {
                    boundaries.push({
                        time: iso.time,
                        polyline: clipJunctionEnd(iso.polyline, axis.id, iso.time),
                    });
                }
            }

            // If active, add current live midline as the final boundary
            let isGrowingRing = false;
            if (axis.state === 'active' && plateA && plateB) {
                const currentMidline = this.computeCurrentAxisMidline(axis, currentPlates, currentTime);
                if (currentMidline) {
                    boundaries.push({
                        time: currentTime,
                        polyline: clipJunctionEnd(currentMidline, axis.id, currentTime),
                    });
                    isGrowingRing = true;
                }
            }

            // Build rings between consecutive boundaries
            for (let i = 1; i < boundaries.length; i++) {
                const outer = boundaries[i - 1]; // older, further from axis
                const inner = boundaries[i];      // younger, closer to axis
                const isGrowing = isGrowingRing && i === boundaries.length - 1;
                const ringColor = isGrowing ? '#60a5fa' : crustColor;

                // Side A
                if (plateA) {
                    const outerA = outer.polyline.map(p => this.applyPlateMotion(p, plateA, outer.time, currentTime, currentPlates));
                    const innerA = inner.polyline.map(p => this.applyPlateMotion(p, plateA, inner.time, currentTime, currentPlates));
                    const ringPoly = this.buildRing(outerA, innerA);
                    if (ringPoly && this.sphericalArea(ringPoly) >= MIN_AREA) {
                        rings.push(this.createEphemeralOceanPlate(ringPoly, plateA, axis, inner.time, currentTime, ringColor, 'A', isGrowing));
                    }
                }

                // Side B
                if (plateB) {
                    const outerB = [...outer.polyline].reverse().map(p => this.applyPlateMotion(p, plateB, outer.time, currentTime, currentPlates));
                    const innerB = [...inner.polyline].reverse().map(p => this.applyPlateMotion(p, plateB, inner.time, currentTime, currentPlates));
                    const ringPoly = this.buildRing(outerB, innerB);
                    if (ringPoly && this.sphericalArea(ringPoly) >= MIN_AREA) {
                        rings.push(this.createEphemeralOceanPlate(ringPoly, plateB, axis, inner.time, currentTime, ringColor, 'B', isGrowing));
                    }
                }
            }
        }

        return rings;
    }

    /** Create an ephemeral TectonicPlate for an ocean ring (destroyed each frame). */
    private createEphemeralOceanPlate(
        ringPoly: Coordinate[],
        parentPlate: TectonicPlate,
        axis: RiftAxis,
        ringTime: number,
        currentTime: number,
        color: string,
        side: 'A' | 'B',
        isGrowing: boolean
    ): TectonicPlate {
        const suffix = isGrowing ? `_${side}_growing` : `_${side}_${ringTime}`;
        return {
            id: generateId(),
            slabId: `${axis.id}_${axis.groupId}_iso${suffix}`,
            riftAxisId: axis.id,
            name: isGrowing ? `${parentPlate.name} Active Rift` : `${parentPlate.name} Crust ${ringTime}Ma`,
            type: 'oceanic',
            polygonType: 'oceanic_plate',
            color,
            zIndex: (parentPlate.zIndex || 0) - 1,
            birthTime: ringTime,
            deathTime: null,
            visible: true,
            locked: false,
            center: calculateSphericalCentroid(ringPoly),
            polygons: [{ id: generateId(), points: ringPoly, closed: true, edgeMeta: [] }],
            features: [],
            initialPolygons: [{ id: generateId(), points: ringPoly, closed: true }],
            initialFeatures: [],
            motion: createDefaultMotion(),
            motionKeyframes: [],
            events: [],
            linkedToPlateId: parentPlate.id,
            linkTime: currentTime,
            connectedRiftIds: [],
            siblingSystem: true,
        };
    }

    // (generateAxisCrust removed â€” replaced by isochron-based recordIsochrons + deriveOceanRings)

    /**
     * Shared isochron-path pipeline used by both update() and setTime().
     * Strips last frame's ephemeral axis/junction-derived plates, optionally records
     * new isochron + junction history (pass recordInterval only when advancing the
     * simulation â€” never when scrubbing), then derives fresh ocean rings and wedges.
     */
    private deriveAxisGeometry(
        plates: TectonicPlate[],
        axes: RiftAxis[],
        junctions: TripleJunction[],
        time: number,
        recordInterval?: number
    ): { basePlates: TectonicPlate[]; junctions: TripleJunction[]; derived: TectonicPlate[] } {
        const basePlates = plates.filter(p => !p.riftAxisId && !p.junctionId);
        if (recordInterval !== undefined) {
            this.recordIsochrons(axes, basePlates, time, recordInterval);
        }
        const updatedJunctions = this.detectAndUpdateTripleJunctions(axes, basePlates, time, junctions);
        if (recordInterval !== undefined) {
            this.recordJunctionHistory(updatedJunctions, axes, time, recordInterval);
        }
        const rings = this.deriveOceanRings(axes, basePlates, time, updatedJunctions);
        const wedges = this.deriveJunctionWedges(updatedJunctions, axes, basePlates, time);
        return { basePlates, junctions: updatedJunctions, derived: [...rings, ...wedges] };
    }

    // â”€â”€ Triple Junction system â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    /**
     * Interpolate a position from a time-sorted point history using normalized
     * linear interpolation on the sphere. Times outside the recorded range clamp
     * to the first/last entry. Returns null for an empty history.
     */
    private interpolateTimedPoint(history: { time: number; pt: Coordinate }[], t: number): Coordinate | null {
        if (history.length === 0) return null;
        if (t <= history[0].time) return history[0].pt;
        if (t >= history[history.length - 1].time) return history[history.length - 1].pt;
        const nextIdx = history.findIndex(p => p.time > t);
        if (nextIdx <= 0) return null;
        const prev = history[nextIdx - 1];
        const next = history[nextIdx];
        return nlerpCoord(prev.pt, next.pt, (t - prev.time) / (next.time - prev.time));
    }

    /**
     * Compute the current live midline of a rift axis from its two flanking plates.
     * Returns null when either plate is gone or the rift edges can't be resolved.
     */
    private computeCurrentAxisMidline(
        axis: RiftAxis,
        currentPlates: TectonicPlate[],
        currentTime: number
    ): Coordinate[] | null {
        const plateA = this.findAliveAt(currentPlates, axis.plateIdA, currentTime);
        const plateB = this.findAliveAt(currentPlates, axis.plateIdB, currentTime);
        if (!plateA || !plateB) return null;
        const infoA = this.findAxisRiftEdges(plateA, axis.groupId);
        const infoB = this.findAxisRiftEdges(plateB, axis.groupId);
        if (!infoA || !infoB) return null;
        const ptsA = this.getAxisEdgePoints(infoA.poly, infoA.edges);
        const ptsB = this.getAxisEdgePoints(infoB.poly, infoB.edges);
        if (ptsA.length < 2 || ptsB.length < 2) return null;
        const mid = this.computeAxisMidline(ptsA, ptsB);
        return mid.length >= 2 ? mid : null;
    }

    /**
     * Detect and update TripleJunction objects by comparing current midline endpoints
     * of all active RiftAxes. Junctions are identified when two or more axes share an
     * endpoint within ~0.5Â° tolerance. Returns an updated (possibly enlarged) junctions array.
     */
    private detectAndUpdateTripleJunctions(
        axes: RiftAxis[],
        currentPlates: TectonicPlate[],
        currentTime: number,
        junctions: TripleJunction[]
    ): TripleJunction[] {
        const JUNCTION_TOL = 1 - Math.cos(0.5 * Math.PI / 180);
        const dotCoord = (a: Coordinate, b: Coordinate) => {
            const va = latLonToVector(a); const vb = latLonToVector(b);
            return va.x * vb.x + va.y * vb.y + va.z * vb.z;
        };

        // Compute current midline endpoint pair for each active axis
        type AxisEndpoint = { axisId: string; atStart: boolean; point: Coordinate };
        const endpoints: AxisEndpoint[] = [];
        for (const axis of axes) {
            if (axis.state === 'dead') continue;
            const mid = this.computeCurrentAxisMidline(axis, currentPlates, currentTime);
            if (!mid) continue;
            endpoints.push({ axisId: axis.id, atStart: true,  point: mid[0] });
            endpoints.push({ axisId: axis.id, atStart: false, point: mid[mid.length - 1] });
        }

        // Cluster nearby endpoints (each cluster = one junction candidate)
        type Cluster = { axisIds: string[]; atStart: boolean[]; center: Coordinate };
        const clusters: Cluster[] = [];
        for (const ep of endpoints) {
            let merged = false;
            for (const cl of clusters) {
                if (cl.axisIds.includes(ep.axisId)) continue; // one endpoint per axis per cluster
                if (dotCoord(ep.point, cl.center) > 1 - JUNCTION_TOL) {
                    cl.axisIds.push(ep.axisId);
                    cl.atStart.push(ep.atStart);
                    // Update center: spherical average of all axis endpoints in cluster
                    const pts = cl.axisIds.map((id, i) => {
                        const e = endpoints.find(e2 => e2.axisId === id && e2.atStart === cl.atStart[i]);
                        return e ? e.point : cl.center;
                    });
                    cl.center = calculateSphericalCentroid(pts);
                    merged = true;
                    break;
                }
            }
            if (!merged) clusters.push({ axisIds: [ep.axisId], atStart: [ep.atStart], center: ep.point });
        }

        // Only keep clusters with 2+ distinct axes (real junctions)
        const junctionClusters = clusters.filter(cl => cl.axisIds.length >= 2);

        const result: TripleJunction[] = [...junctions];
        for (const cl of junctionClusters) {
            const sortedIds = [...cl.axisIds].sort();
            const existing = result.find(j => {
                const jSorted = [...j.axisIds].sort();
                return jSorted.length === sortedIds.length && jSorted.every((id, i) => id === sortedIds[i]);
            });
            if (existing) {
                // Update atStart flags in case a re-split changed the axis ID ordering
                existing.axisIds = cl.axisIds;
                existing.axisJunctionAtStart = cl.atStart;
                if (existing.state === 'dead') existing.state = 'active';
            } else {
                // Find the axis that was born latest â€” that determines the junction birth time
                const birthTime = Math.max(
                    ...cl.axisIds.map(id => axes.find(a => a.id === id)?.birthTime ?? 0)
                );
                result.push({
                    id: generateId(),
                    axisIds: cl.axisIds,
                    axisJunctionAtStart: cl.atStart,
                    birthTime,
                    state: 'active',
                });
            }
        }

        // Mark junctions dead only when ALL their axes are dead.
        // Do NOT kill a junction because its midline endpoints drifted apart â€” diverging
        // plates spread continuously so endpoints always separate after birth. The junction
        // was geometrically real when first detected; it stays alive until its rifts close.
        for (const j of result) {
            if (j.state === 'dead') continue;
            const allDead = j.axisIds.every(id => axes.find(a => a.id === id)?.state === 'dead');
            if (allDead) {
                j.state = 'dead';
            }
        }

        return result;
    }

    /**
     * For each active junction, derive ephemeral wedge-fill TectonicPlate objects.
     *
     * OPTIMAL APPROACH: Instead of only generating fills at times present in BOTH axes
     * (which leaves coverage gaps when axes have different isochron schedules), this
     * implementation collects the UNION of all isochron times from both axes and uses
     * spherical linear interpolation to compute the junction-end position for any axis
     * at a time it doesn't have an exact isochron for.
     *
     * This guarantees continuous coverage from junction birth to current time with no gaps.
     */
    private deriveJunctionWedges(
        junctions: TripleJunction[],
        axes: RiftAxis[],
        currentPlates: TectonicPlate[],
        currentTime: number
    ): TectonicPlate[] {
        const wedges: TectonicPlate[] = [];
        const crustColor = this.getState().world.globalOptions.oceanicCrustColor || '#3b82f6';
        const MIN_AREA = 1e-5;

        // Build the full junction-end history for an axis (absolute coords at each recorded time)
        const getAxisEndHistory = (axis: RiftAxis, atStart: boolean): { time: number; pt: Coordinate }[] => {
            const result: { time: number; pt: Coordinate }[] = [];
            const birth = this.interpolatePoints(axis.birthPolyline, this.RIFT_GRID_RESOLUTION);
            result.push({ time: axis.birthTime, pt: atStart ? birth[0] : birth[birth.length - 1] });
            for (const iso of axis.isochrons) {
                if (iso.time <= currentTime) {
                    result.push({ time: iso.time, pt: atStart ? iso.polyline[0] : iso.polyline[iso.polyline.length - 1] });
                }
            }
            return result; // sorted ascending by time (birthTime first, then isochrons in order)
        };

        // Interpolate the junction-end point at an arbitrary time (history is never empty:
        // getAxisEndHistory always includes the birth entry, so the fallback never fires).
        const interpolateEndAt = (pts: { time: number; pt: Coordinate }[], t: number): Coordinate =>
            this.interpolateTimedPoint(pts, t) ?? pts[0].pt;

        for (const junction of junctions) {
            if (junction.state === 'dead') continue;
            if (junction.axisIds.length < 2) continue;

            for (let ai = 0; ai < junction.axisIds.length; ai++) {
                for (let bi = ai + 1; bi < junction.axisIds.length; bi++) {
                    const axisAB = axes.find(a => a.id === junction.axisIds[ai]);
                    const axisBC = axes.find(a => a.id === junction.axisIds[bi]);
                    if (!axisAB || !axisBC) continue;

                    const atStartAB = junction.axisJunctionAtStart[ai];
                    const atStartBC = junction.axisJunctionAtStart[bi];

                    // Find the plate shared between the two axes (the "wedge plate")
                    const sharedPlateId = [axisAB.plateIdA, axisAB.plateIdB].find(
                        id => id === axisBC.plateIdA || id === axisBC.plateIdB
                    );
                    if (!sharedPlateId) continue;
                    const sharedPlate = this.findAliveAt(currentPlates, sharedPlateId, currentTime);
                    if (!sharedPlate) continue;

                    const startTime = Math.max(axisAB.birthTime, axisBC.birthTime);

                    // Full endpoint history for each axis
                    const abHistory = getAxisEndHistory(axisAB, atStartAB);
                    const bcHistory = getAxisEndHistory(axisBC, atStartBC);

                    // UNION of all recorded times from both axes, clamped to [startTime, currentTime]
                    const allTimes = [
                        ...new Set([...abHistory.map(p => p.time), ...bcHistory.map(p => p.time)])
                    ].filter(t => t >= startTime && t <= currentTime).sort((a, b) => a - b);

                    if (allTimes.length === 0) continue;
                    if (allTimes[0] > startTime) allTimes.unshift(startTime);

                    // Current live midline endpoints (growing boundary â€” always recomputed)
                    let currentEndAB: Coordinate | null = null;
                    let currentEndBC: Coordinate | null = null;

                    if (axisAB.state === 'active') {
                        const mid = this.computeCurrentAxisMidline(axisAB, currentPlates, currentTime);
                        if (mid) currentEndAB = atStartAB ? mid[0] : mid[mid.length - 1];
                    }
                    if (axisBC.state === 'active') {
                        const mid = this.computeCurrentAxisMidline(axisBC, currentPlates, currentTime);
                        if (mid) currentEndBC = atStartBC ? mid[0] : mid[mid.length - 1];
                    }

                    // Build boundary list: interpolated position at each union time step
                    type WedgeBoundary = { time: number; pAB: Coordinate; pBC: Coordinate; isGrowing: boolean };
                    const boundaries: WedgeBoundary[] = allTimes.map(t => ({
                        time: t,
                        pAB: this.applyPlateMotion(interpolateEndAt(abHistory, t), sharedPlate, t, currentTime, currentPlates),
                        pBC: this.applyPlateMotion(interpolateEndAt(bcHistory, t), sharedPlate, t, currentTime, currentPlates),
                        isGrowing: false,
                    }));

                    // Append growing boundary when both axes have a live midline
                    const hasGrowing = currentEndAB !== null && currentEndBC !== null;
                    if (hasGrowing) {
                        boundaries.push({ time: currentTime, pAB: currentEndAB!, pBC: currentEndBC!, isGrowing: true });
                    }

                    if (boundaries.length < 2) continue;

                    // Build wedge quad for each consecutive boundary pair
                    for (let k = 1; k < boundaries.length; k++) {
                        const outer = boundaries[k - 1];
                        const inner = boundaries[k];
                        // Wedge quad: outer.pAB â†’ outer.pBC â†’ inner.pBC â†’ inner.pAB
                        // (pAB-side edge is shared with axis AB ring; pBC-side edge with axis BC ring)
                        const ring = [outer.pAB, outer.pBC, inner.pBC, inner.pAB, outer.pAB];
                        if (this.sphericalArea(ring) < MIN_AREA) continue;

                        const color = inner.isGrowing ? '#60a5fa' : crustColor;
                        wedges.push({
                            id: generateId(),
                            slabId: `${junction.id}_wedge_${axisAB.id}_${axisBC.id}_${inner.time}${inner.isGrowing ? '_growing' : ''}`,
                            junctionId: junction.id,
                            name: inner.isGrowing ? 'Junction Wedge Active' : `Junction Wedge ${inner.time}Ma`,
                            type: 'oceanic',
                            polygonType: 'oceanic_plate',
                            color,
                            zIndex: (sharedPlate.zIndex || 0) - 1,
                            birthTime: inner.time,
                            deathTime: null,
                            visible: true,
                            locked: false,
                            center: calculateSphericalCentroid(ring),
                            polygons: [{ id: generateId(), points: ring, closed: true, edgeMeta: [] }],
                            features: [],
                            initialPolygons: [{ id: generateId(), points: ring, closed: true }],
                            initialFeatures: [],
                            motion: createDefaultMotion(),
                            motionKeyframes: [],
                            events: [],
                            linkedToPlateId: sharedPlate.id,
                            linkTime: currentTime,
                            connectedRiftIds: [],
                        });
                    }
                }
            }
        }
        return wedges;
    }

    // Helper to move a point forward (or backward) in time according to a plate's
    // motion. Delegates to the rotation model: own piecewise segments, pre-birth
    // history through the parent plate, and linked motion within the link window.
    private applyPlateMotion(point: Coordinate, plate: TectonicPlate, fromTime: number, toTime: number, allPlates: TectonicPlate[]): Coordinate {
        return pointPositionAt(plate, allPlates, point, fromTime, toTime);
    }

    public calculatePlateAtTime(plate: TectonicPlate, time: number, allPlates: TectonicPlate[] = []): TectonicPlate {
        // KEYFRAME-LESS MODEL (docs/PLAN_rotation_model.md): geometry is DERIVED â€”
        // the active geometry stage rotated by the composed rotation from the stage
        // time to t (own segments + parent chain + link window). Plates still
        // carrying legacy keyframes are converted on the fly by getMotionModel().

        // Feature inheritance (legacy behavior preserved): features placed on a
        // parent before the split, inside this plate's birth geometry, render here.
        const inheritedFeatures: Feature[] = [];
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
                    isPointInPolygon(f.position, poly.points)
                );
            }).filter(f => {
                return !plate.features.some(existing => existing.id === f.id) &&
                    !inheritedFeatures.some(existing => existing.id === f.id);
            });
            inheritedFeatures.push(...featuresToInherit);
        }

        const { stages } = getMotionModel(plate);
        const stage = activeStage(stages, time);
        const qStage = plateRotation(plate, allPlates, stage.time, time);

        const newPolygons = stage.polygons.map(poly => ({
            ...poly,
            points: poly.points.map(p => rotateCoordByQuat(p, qStage))
        }));

        // Stage features are anchored at the stage time, unless they were placed
        // later â€” then their placement position/time is the anchor.
        const stageFeatureIds = new Set(stage.features.map(f => f.id));
        const transformedStageFeatures = stage.features.map(f => {
            const anchor = f.generatedAt !== undefined ? Math.max(f.generatedAt, stage.time) : stage.time;
            if (anchor === stage.time) {
                return { ...f, position: rotateCoordByQuat(f.position, qStage) };
            }
            const src = f.originalPosition ?? f.position;
            return { ...f, position: pointPositionAt(plate, allPlates, src, anchor, time) };
        });

        // Features placed after the stage (live additions not yet part of any
        // stage): anchored at creation time, from their placement position.
        const dynamicFeatures = plate.features.filter(f =>
            !stageFeatureIds.has(f.id) &&
            f.generatedAt !== undefined &&
            f.generatedAt >= stage.time
        );
        const transformedDynamicFeatures = dynamicFeatures.map(f => {
            const src = f.originalPosition ?? f.position;
            return { ...f, position: pointPositionAt(plate, allPlates, src, f.generatedAt!, time) };
        });

        // Inherited features: anchored at the split time from their current
        // position (legacy semantics preserved).
        const transformedInheritedFeatures = inheritedFeatures.map(f => ({
            ...f,
            position: pointPositionAt(plate, allPlates, f.position, plate.birthTime, time)
        }));

        const newFeatures = [...transformedStageFeatures, ...transformedDynamicFeatures, ...transformedInheritedFeatures];
        const allPoints = newPolygons.flatMap(poly => poly.points);
        const newCenter = allPoints.length > 0 ? calculateSphericalCentroid(allPoints) : plate.center;

        return {
            ...plate,
            polygons: newPolygons,
            features: newFeatures,
            center: newCenter
        };
    }

    private updateFlowlines(): void {
        this.setState(state => {
            const plates = state.world.plates;
            const currentTime = state.world.currentTime;

            const newPlates = plates.map(plate => {
                if (!plate.showFlowlines) {
                    return { ...plate, flowlinesTrailCache: undefined };
                }

                const duration = plate.flowlinesDuration || 50;
                const startTime = Math.max(plate.birthTime, currentTime - duration);
                const step = 5;

                const allTrails: Coordinate[][] = [];

                // Helper to generate a trail for a single coordinate
                // We trace BACKWARDS in time from the current position. 
                // However, `getPointPositionAtTime` usually takes an *original* position
                // and a time `t` to find where it *was*.
                // Wait, `getPointPositionAtTime` calculates the position of a point *originating* at `plate.birthTime` 
                // (or rather, it assumes the `point` parameter is the spatial coordinate at `plate.birthTime`).
                // To trace backwards from a current vertex, we actually need to know its position at `time t`.
                // For a rigidly moving plate, calculating the history of a current vertex means applying the INVERSE motion.
                // An easier way that works for TectoLite's current data model:
                // Extract the "original" positions from `initialPolygons` and trace them FORWARD.

                // Collect "source" points that need trails
                // To keep the trails attached to the *current* vertices (which is what looks best),
                // we'll trace the initial/original points from `startTime` to `currentTime`.

                // Let's use the `initialPolygons` for the stable reference points of the plate's crust.
                const sourcePoints: Coordinate[] = [];
                if (plate.initialPolygons) {
                    plate.initialPolygons.forEach(poly => {
                        sourcePoints.push(...poly.points);
                    });
                } else {
                    plate.polygons.forEach(poly => {
                        sourcePoints.push(...poly.points);
                    });
                }

                if (plate.lineType === 'divergent' && plate.initialFeatures) {
                    plate.initialFeatures.forEach(f => {
                        if (f.properties?.path && Array.isArray(f.properties.path)) {
                            sourcePoints.push(...f.properties.path);
                        }
                    });
                }

                // Generate trail for each source point
                sourcePoints.forEach(origin => {
                    const points: Coordinate[] = [];
                    // Trace forward from startTime to currentTime
                    for (let t = startTime; t <= currentTime; t += step) {
                        points.push(this.getPointPositionAtTime(origin, plate.id, t, plates));
                    }
                    if (currentTime % step !== 0) {
                        points.push(this.getPointPositionAtTime(origin, plate.id, currentTime, plates));
                    }
                    allTrails.push(points);
                });

                return { ...plate, flowlinesTrailCache: allTrails };
            });

            return { ...state, world: { ...state.world, plates: newPlates } };
        });
    }

    private getPointPositionAtTime(point: Coordinate, plateId: string, time: number, allPlates: TectonicPlate[]): Coordinate {
        // Keyframe-less model: delegate to the rotation model (the legacy
        // keyframe walk here also had a broken fallback that discarded the walk)
        const plate = allPlates.find(p => p.id === plateId);
        if (!plate || time <= plate.birthTime) return point;
        return this.applyPlateMotion(point, plate, plate.birthTime, time, allPlates);
    }

}
