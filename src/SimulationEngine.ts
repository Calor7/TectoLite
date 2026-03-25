import { AppState, TectonicPlate, Coordinate, Feature, generateId, createDefaultMotion, RiftAxis } from './types';

import {
    toRad,
    latLonToVector,
    vectorToLatLon,
    rotateVector,
    rotatePoint,
    normalize,
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
            let updatedRiftAxes = state.world.riftAxes || [];
            if (globalOptions.enableExpandingRifts !== false) { // Default true
                // CLEANUP: Remove old "growing" strips (active gap fillers) so they can be regenerated fresh
                // This prevents duplicates and ensures the active strip always matches current rift position
                newPlates = newPlates.filter(p => !p.slabId?.endsWith('_growing'));

                const interval = globalOptions.oceanicGenerationInterval || 25;
                const currentRiftAxes = state.world.riftAxes || [];

                // AXIS PATH: rift-axis-based (for rifts that have a RiftAxis entity)
                const axisResult = this.generateAxisCrust(newPlates, currentRiftAxes, newTime, interval);
                updatedRiftAxes = axisResult.updatedAxes;

                // SIBLING PATH: sibling-based (skip groups that have a RiftAxis)
                const siblingSlabs = this.generateSiblingCrust(newPlates, newTime, interval, currentRiftAxes);

                // LEGACY PATH: rift-based (for old plates without siblingSystem flag)
                const legacySlabs = this.generateRiftCrust(
                    newPlates.filter(p => !p.siblingSystem), newTime, interval
                );

                const allNewSlabs = [...axisResult.newStrips, ...siblingSlabs, ...legacySlabs];
                if (allNewSlabs.length > 0) {
                    newPlates = [...newPlates, ...allNewSlabs];
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

            // Phase 3: Geological Automation — DISABLED (features removed)
            const tempState = {
                ...state,
                world: {
                    ...state.world,
                    plates: newPlates,
                    riftAxes: updatedRiftAxes,
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

        // Pure helpers — hoisted so both the rift-strip pass and the junction-fill pass can use them.
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
                        // Use semantic check: match by parent plate, rift group, and age — not by the
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

                    // Growing strips — from last permanent midline (or rift edge) to the live midline
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

        // ── Pass 2: Junction fills ────────────────────────────────────────────────────────────────
        // For each plate that is a corner of 2+ active rifts, detect shared rift-edge endpoints
        // (within ~0.5° tolerance) and generate triangular oceanic fill for the fan-shaped gap.
        const JUNCTION_TOL = 1 - Math.cos(0.5 * Math.PI / 180); // dot-product threshold ≈ 0.5°
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

                    // Canonical slabId prefix — sort groupIds so A-B and B-A produce the same key.
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

                    // Growing junction fill — from last permanent boundary to current live midline endpoints.
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
        // ── End Pass 2 ───────────────────────────────────────────────────────────────────────────

        return newStrips;
    }

    // ══════════════════════════════════════════════════════════════════════════════════════════
    // RIFT-AXIS-BASED OCEAN GENERATION — "Tree Ring" model
    // ══════════════════════════════════════════════════════════════════════════════════════════

    private generateAxisCrust(
        currentPlates: TectonicPlate[],
        riftAxes: RiftAxis[],
        currentTime: number,
        interval: number
    ): { newStrips: TectonicPlate[]; updatedAxes: RiftAxis[] } {
        const newStrips: TectonicPlate[] = [];
        const updatedAxes = riftAxes.map(a => ({ ...a })); // shallow copy for mutation
        const RIFT_GRID_RESOLUTION = 2.0;

        // Helpers (same logic as generateSiblingCrust)
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

        // Find rift edges on a plate by groupId (no edge index references!)
        const findRiftEdges = (plate: TectonicPlate, groupId: string): { poly: import('./types').Polygon; polyIdx: number; edges: import('./types').EdgeMeta[] } | null => {
            for (let pi = 0; pi < plate.polygons.length; pi++) {
                const poly = plate.polygons[pi];
                if (!poly.edgeMeta) continue;
                const edges = poly.edgeMeta.filter(e => e.sourceId === groupId && e.type === 'rift');
                if (edges.length > 0) {
                    edges.sort((a, b) => a.edgeIndex - b.edgeIndex);
                    return { poly, polyIdx: pi, edges };
                }
            }
            return null;
        };

        const crustColor = this.getState().world.globalOptions.oceanicCrustColor || '#3b82f6';

        for (const axis of updatedAxes) {
            if (axis.state !== 'active') continue;

            // Find both plates alive at currentTime
            const plateA = currentPlates.find(p =>
                p.id === axis.plateIdA && p.birthTime <= currentTime &&
                (p.deathTime === null || p.deathTime > currentTime)
            );
            const plateB = currentPlates.find(p =>
                p.id === axis.plateIdB && p.birthTime <= currentTime &&
                (p.deathTime === null || p.deathTime > currentTime)
            );
            if (!plateA || !plateB) {
                // Auto-death: one of the plates no longer exists
                axis.state = 'dead';
                axis.deathTime = currentTime;
                continue;
            }

            // Find rift edges via groupId
            const infoA = findRiftEdges(plateA, axis.groupId);
            const infoB = findRiftEdges(plateB, axis.groupId);
            if (!infoA || !infoB) continue;

            // Current edge points and midline (live positions at currentTime)
            const ptsA = getEdgePoints(infoA.poly, infoA.edges);
            const ptsB = getEdgePoints(infoB.poly, infoB.edges);
            if (ptsA.length < 2 || ptsB.length < 2) continue;
            const currentMidline = computeMidlinePts(ptsA, ptsB);

            // Helper: compute midline at a given time, then advect to currentTime for each plate side
            const getMidlineAtTime = (genTime: number): { midlineForA: Coordinate[]; midlineForB: Coordinate[] } | null => {
                const pAtT = this.calculatePlateAtTime(plateA, genTime, currentPlates);
                const qAtT = this.calculatePlateAtTime(plateB, genTime, currentPlates);
                const infoAatT = findRiftEdges(pAtT, axis.groupId);
                const infoBatT = findRiftEdges(qAtT, axis.groupId);
                if (!infoAatT || !infoBatT) return null;
                const rawPtsA = getEdgePoints(infoAatT.poly, infoAatT.edges);
                const rawPtsB = getEdgePoints(infoBatT.poly, infoBatT.edges);
                if (rawPtsA.length < 2 || rawPtsB.length < 2) return null;
                const rawMidline = computeMidlinePts(rawPtsA, rawPtsB);
                return {
                    midlineForA: rawMidline.map(p => this.applyPlateMotion(p, plateA, genTime, currentTime, currentPlates)),
                    midlineForB: [...rawMidline.map(p => this.applyPlateMotion(p, plateB, genTime, currentTime, currentPlates))].reverse(),
                };
            };

            // Helper: get outer boundary for the first ring (birth polyline advected by plate)
            const getBirthEdge = (): { forA: Coordinate[]; forB: Coordinate[] } => {
                const birth = this.interpolatePoints(axis.birthPolyline, RIFT_GRID_RESOLUTION);
                return {
                    forA: birth.map(p => this.applyPlateMotion(p, plateA, axis.birthTime, currentTime, currentPlates)),
                    forB: [...birth.map(p => this.applyPlateMotion(p, plateB, axis.birthTime, currentTime, currentPlates))].reverse(),
                };
            };

            // Find latest existing permanent strip for this axis (or sibling-generated for same group)
            const getLatestPermStrip = (): TectonicPlate | undefined => {
                return [...currentPlates, ...newStrips]
                    .filter(p =>
                        p.type === 'oceanic' &&
                        !p.slabId?.endsWith('_growing') &&
                        (p.riftAxisId === axis.id || p.slabId?.includes(`_${axis.groupId}_`))
                    )
                    .sort((a, b) => b.birthTime - a.birthTime)[0];
            };

            // ── Generate permanent rings ──────────────────────────────────────
            let nextGenTime = axis.lastGenerationTime + interval;

            while (nextGenTime <= currentTime) {
                const genTime = nextGenTime;
                nextGenTime += interval;
                if (genTime <= axis.birthTime) continue;

                // Check if already exists (axis-generated OR sibling-generated for same group)
                const alreadyExists = [...currentPlates, ...newStrips].some(p =>
                    p.type === 'oceanic' &&
                    !p.slabId?.endsWith('_growing') &&
                    Math.abs(p.birthTime - genTime) < 0.01 &&
                    (p.riftAxisId === axis.id || p.slabId?.includes(`_${axis.groupId}_`))
                );
                if (alreadyExists) continue;

                // Inner boundary: midline at genTime, advected to currentTime
                const inner = getMidlineAtTime(genTime);
                if (!inner) continue;

                // Outer boundary: previous midline or birth edge
                const latestPerm = getLatestPermStrip();
                let outerA: Coordinate[];
                let outerB: Coordinate[];
                if (latestPerm) {
                    const prev = getMidlineAtTime(latestPerm.birthTime);
                    if (prev) {
                        outerA = prev.midlineForA;
                        outerB = prev.midlineForB;
                    } else {
                        const birth = getBirthEdge();
                        outerA = birth.forA;
                        outerB = birth.forB;
                    }
                } else {
                    const birth = getBirthEdge();
                    outerA = birth.forA;
                    outerB = birth.forB;
                }

                const ringA = this.buildRing(outerA, inner.midlineForA);
                const ringB = this.buildRing(outerB, inner.midlineForB);
                if (!ringA || !ringB) continue;
                // Reject degenerate slivers (< ~0.01 sr ≈ 0.03% of sphere)
                const MIN_AREA = 1e-4;
                if (this.sphericalArea(ringA) < MIN_AREA || this.sphericalArea(ringB) < MIN_AREA) continue;

                const stripIdA = `${axis.id}_${axis.groupId}_axis_${genTime}`;
                const stripIdB = `${axis.id}_${axis.groupId}_axis_B_${genTime}`;

                newStrips.push({
                    id: generateId(),
                    slabId: stripIdA,
                    riftAxisId: axis.id,
                    name: `${plateA.name} Crust ${genTime}Ma`,
                    type: 'oceanic',
                    polygonType: 'oceanic_plate',
                    color: crustColor,
                    zIndex: (plateA.zIndex || 0) - 1,
                    birthTime: genTime,
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
                    linkedToPlateId: plateA.id,
                    linkTime: currentTime,
                    connectedRiftIds: [],
                    siblingSystem: true,
                });

                newStrips.push({
                    id: generateId(),
                    slabId: stripIdB,
                    riftAxisId: axis.id,
                    name: `${plateB.name} Crust ${genTime}Ma`,
                    type: 'oceanic',
                    polygonType: 'oceanic_plate',
                    color: crustColor,
                    zIndex: (plateB.zIndex || 0) - 1,
                    birthTime: genTime,
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
                    linkedToPlateId: plateB.id,
                    linkTime: currentTime,
                    connectedRiftIds: [],
                    siblingSystem: true,
                });

                axis.lastGenerationTime = genTime;
            }

            // ── Growing ring (active spreading) ──────────────────────────────
            // The growing ring fills from the last permanent ring's INNER edge to the live midline.
            // A permanent ring's inner boundary = midline at its own genTime (= its birthTime).
            const latestPerm2 = getLatestPermStrip();
            let growOuterA: Coordinate[];
            let growOuterB: Coordinate[];
            if (latestPerm2) {
                const permInner = getMidlineAtTime(latestPerm2.birthTime);
                growOuterA = permInner?.midlineForA ?? ptsA;
                growOuterB = permInner?.midlineForB ?? [...ptsB].reverse();
            } else {
                const birth = getBirthEdge();
                growOuterA = birth.forA;
                growOuterB = birth.forB;
            }

            // Inner boundary is the current live midline — but each side needs its "half"
            // Side A: from outerA to midline (midline is already at current positions)
            // Side B: from outerB to midline (reversed for correct winding)
            const growRingA = this.buildRing(growOuterA, currentMidline);
            const growRingB = this.buildRing(growOuterB, [...currentMidline].reverse());
            if (!growRingA || !growRingB) continue;

            newStrips.push({
                id: generateId(),
                slabId: `${axis.id}_${axis.groupId}_axis_growing`,
                riftAxisId: axis.id,
                name: `${plateA.name} Active Rift`,
                type: 'oceanic',
                polygonType: 'oceanic_plate',
                color: '#60a5fa',
                zIndex: (plateA.zIndex || 0) - 1,
                birthTime: currentTime,
                deathTime: null,
                visible: true,
                locked: false,
                center: calculateSphericalCentroid(growRingA),
                polygons: [{ id: generateId(), points: growRingA, closed: true, edgeMeta: [] }],
                features: [],
                initialPolygons: [{ id: generateId(), points: growRingA, closed: true }],
                initialFeatures: [],
                motion: createDefaultMotion(),
                motionKeyframes: [],
                events: [],
                linkedToPlateId: plateA.id,
                linkTime: currentTime,
                connectedRiftIds: [],
                siblingSystem: true,
            });

            newStrips.push({
                id: generateId(),
                slabId: `${axis.id}_${axis.groupId}_axis_B_growing`,
                riftAxisId: axis.id,
                name: `${plateB.name} Active Rift`,
                type: 'oceanic',
                polygonType: 'oceanic_plate',
                color: '#60a5fa',
                zIndex: (plateB.zIndex || 0) - 1,
                birthTime: currentTime,
                deathTime: null,
                visible: true,
                locked: false,
                center: calculateSphericalCentroid(growRingB),
                polygons: [{ id: generateId(), points: growRingB, closed: true, edgeMeta: [] }],
                features: [],
                initialPolygons: [{ id: generateId(), points: growRingB, closed: true }],
                initialFeatures: [],
                motion: createDefaultMotion(),
                motionKeyframes: [],
                events: [],
                linkedToPlateId: plateB.id,
                linkTime: currentTime,
                connectedRiftIds: [],
                siblingSystem: true,
            });
        }

        return { newStrips, updatedAxes };
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

    public calculatePlateAtTime(plate: TectonicPlate, time: number, allPlates: TectonicPlate[] = []): TectonicPlate {
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
                            prevTime = Math.max(prevTime, segmentEnd);
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

                if (plate.lineType === 'rift' && plate.initialFeatures) {
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
