/**
 * RotationModel — pure core of the keyframe-less motion model.
 * See docs/PLAN_rotation_model.md.
 *
 * A plate's position at time t is DERIVED, never stored:
 *
 *   plateAtTime(t) = activeStage(t).geometry rotated by rotation(stage.time → t)
 *
 * where rotation() composes the plate's own piecewise-constant pole segments with
 * the rotations of its ancestors (pre-birth history through `parentPlateId`,
 * inherited motion through `linkedToPlateId` within the link window).
 *
 * Linked-motion composition is R_parent · R_own (own rotation in its original
 * frame, then carried by the parent). This is algebraically identical to the
 * legacy "Lock Motion" behavior of rotating the child's axis by the parent
 * transform, and — unlike the legacy snapshot path — it applies over the entire
 * link window, which fixes the historical "plates jump after timeline edits"
 * inconsistency (gap 3).
 *
 * Everything here is pure: no state, no caching, no mutation of inputs.
 */

import {
    Coordinate,
    EulerPole,
    Feature,
    GeometryStage,
    MotionSegment,
    Polygon,
    TectonicPlate,
} from '../types';
import {
    Quaternion,
    QUAT_IDENTITY,
    latLonToVector,
    quatConjugate,
    quatFromAxisAngle,
    quatMultiply,
    rotateCoordByQuat,
    toRad,
    calculateSphericalCentroid,
} from '../utils/sphericalMath';

const EPS = 1e-9;

export interface MotionModel {
    segments: MotionSegment[];
    stages: GeometryStage[];
}

/**
 * The Euler pole currently active at time `t` (the last segment with time ≤ t).
 * Falls back to the first segment if `t` is before the first segment. Returns
 * a zero-rate pole if the plate has no segments. Replaces the legacy
 * `plate.motion.eulerPole` access pattern.
 */
export function activeEulerPole(plate: TectonicPlate, t: number = plate.birthTime): EulerPole {
    const segments = plate.motionSegments;
    if (!segments || segments.length === 0) {
        return { position: [0, 90], rate: 0, visible: false };
    }
    const sorted = [...segments].sort((a, b) => a.time - b.time);
    let active = sorted[0];
    for (const seg of sorted) {
        if (seg.time <= t + EPS) active = seg;
        else break;
    }
    return active.eulerPole;
}

/**
 * Resolve a plate's motion model. After the v4 flag-day migration every
 * in-memory plate carries motionSegments + geometryStages, so this just reads
 * them directly. (Legacy keyframe fallback is handled once at load time by
 * ensureMotionModel / fromLegacyKeyframes — never here.)
 */
export function getMotionModel(plate: TectonicPlate): MotionModel {
    return {
        segments: plate.motionSegments,
        stages: plate.geometryStages,
    };
}

/**
 * Convert legacy snapshot-baking keyframes into the derived model.
 *
 * Used only for save-file migration. Not called for in-memory plates — after
 * the v4 flag day, ensureMotionModel runs once at load/import time and every
 * plate in state carries motionSegments + geometryStages.
 *
 * - Every keyframe contributes a motion segment (time + pole). A plate without
 *   keyframes gets a single segment at birth from its current `motion`.
 * - Stage 0 is the birth geometry (`initialPolygons`/`initialFeatures` — the
 *   legacy source of truth for a plate's birth geometry).
 * - Keyframes labelled 'Edit' are genuine geometry changes: their snapshots are
 *   absolute coordinates at the keyframe time, which is exactly a GeometryStage.
 *   All other snapshots are derived data and are dropped — that is the point.
 *
 * Accepts a legacy-shaped plate (the raw JSON from old saves carries
 * `motion`/`motionKeyframes` as extra fields not present on the current
 * `TectonicPlate` type).
 */
export function fromLegacyKeyframes(plate: TectonicPlate & {
    motion?: { eulerPole: EulerPole };
    motionKeyframes?: Array<{
        time: number;
        label?: string;
        eulerPole: EulerPole;
        snapshotPolygons: Polygon[];
        snapshotFeatures: Feature[];
    }>;
}): MotionModel {
    const kfs = [...(plate.motionKeyframes || [])].sort((a, b) => a.time - b.time);

    const segments: MotionSegment[] = kfs.map(kf => ({ time: kf.time, eulerPole: kf.eulerPole }));
    if (segments.length === 0) {
        segments.push({
            time: plate.birthTime,
            eulerPole: plate.motion?.eulerPole ?? { position: [0, 90], rate: 0, visible: false },
        });
    }

    const stages: GeometryStage[] = [{
        time: plate.birthTime,
        polygons: plate.initialPolygons ?? plate.polygons,
        features: plate.initialFeatures ?? [],
    }];
    for (const kf of kfs) {
        if (kf.label === 'Edit') {
            stages.push({ time: kf.time, polygons: kf.snapshotPolygons, features: kf.snapshotFeatures });
        }
    }

    return { segments, stages };
}

/**
 * Materialize the motion model ONTO the plate (mutating). Called only at
 * load/import time (v4 flag day). Converts legacy keyframes once if the new
 * fields are missing, writes motionSegments + geometryStages, and is
 * idempotent: a plate that already has the new model is left untouched.
 */
export function ensureMotionModel(plate: TectonicPlate & {
    motion?: { eulerPole: EulerPole };
    motionKeyframes?: Array<{
        time: number;
        label?: string;
        eulerPole: EulerPole;
        snapshotPolygons: Polygon[];
        snapshotFeatures: Feature[];
    }>;
}): MotionModel {
    if (!plate.motionSegments || plate.motionSegments.length === 0) {
        const legacy = fromLegacyKeyframes(plate);
        plate.motionSegments = legacy.segments;
    }
    if (!plate.geometryStages || plate.geometryStages.length === 0) {
        const legacy = fromLegacyKeyframes(plate);
        plate.geometryStages = legacy.stages;
    }
    // Clear legacy storage if present on the raw object (save-file migration)
    delete (plate as any).motionKeyframes;
    delete (plate as any).motion;
    return { segments: plate.motionSegments, stages: plate.geometryStages };
}

/**
 * Rotation produced by a plate's OWN motion segments from t0 to t1.
 * Piecewise-constant: the segment active at time t is the last one with
 * time ≤ t; before the first segment its pole extends backwards (matching
 * legacy behavior). t1 < t0 yields the inverse rotation.
 */
export function segmentsRotation(
    segments: MotionSegment[],
    fallbackPole: EulerPole | undefined,
    t0: number,
    t1: number
): Quaternion {
    if (t1 < t0) return quatConjugate(segmentsRotation(segments, fallbackPole, t1, t0));
    if (t1 - t0 < EPS) return QUAT_IDENTITY;

    const sorted = [...segments].sort((a, b) => a.time - b.time);
    if (sorted.length === 0) {
        if (!fallbackPole || fallbackPole.rate === 0) return QUAT_IDENTITY;
        return quatFromAxisAngle(
            latLonToVector(fallbackPole.position),
            toRad(fallbackPole.rate * (t1 - t0))
        );
    }

    let q = QUAT_IDENTITY;
    let t = t0;
    while (t < t1 - EPS) {
        // Active segment: last with time <= t (first segment extends backwards)
        let active = sorted[0];
        let next = t1;
        for (const seg of sorted) {
            if (seg.time <= t + EPS) {
                active = seg;
            } else {
                next = Math.min(next, seg.time);
                break;
            }
        }
        const dt = next - t;
        if (dt > EPS && active.eulerPole.rate !== 0) {
            const qSeg = quatFromAxisAngle(
                latLonToVector(active.eulerPole.position),
                toRad(active.eulerPole.rate * dt)
            );
            q = quatMultiply(qSeg, q); // later rotation applied after earlier
        }
        t = next;
    }
    return q;
}

/**
 * Full rotation of a plate from t0 to t1, composing:
 *  1. pre-birth history: times before `birthTime` are delegated to the
 *     (possibly dead) parent plate — children inherit where they came from;
 *  2. inherited motion from the link chain (`linkedToPlateId`), restricted to
 *     the [linkTime, unlinkTime) window;
 *  3. the plate's own segments.
 *
 * Composition order R_parent · R_own ≡ own axis carried by the parent rotation.
 */
export function plateRotation(
    plate: TectonicPlate,
    allPlates: TectonicPlate[],
    t0: number,
    t1: number,
    visited: Set<string> = new Set()
): Quaternion {
    if (t1 < t0) return quatConjugate(plateRotation(plate, allPlates, t1, t0, visited));
    if (t1 - t0 < EPS) return QUAT_IDENTITY;
    if (visited.has(plate.id)) return QUAT_IDENTITY; // cycle guard
    visited.add(plate.id);

    try {
        // 1. Pre-birth: delegate [t0, birth) to the parent plate's full rotation
        if (t0 < plate.birthTime - EPS && plate.parentPlateId) {
            const parent = allPlates.find(p => p.id === plate.parentPlateId);
            if (parent) {
                const handoff = Math.min(plate.birthTime, t1);
                const qBefore = plateRotation(parent, allPlates, t0, handoff, visited);
                // Recursing on the same plate for [handoff, t1] must not trip the
                // cycle guard — drop our own id from the copied set
                const postVisited = new Set(visited);
                postVisited.delete(plate.id);
                const qAfter = plateRotation(plate, allPlates, handoff, t1, postVisited);
                return quatMultiply(qAfter, qBefore);
            }
        }

        // 2. Own motion
        const { segments } = getMotionModel(plate);
        const qOwn = segmentsRotation(segments, undefined, t0, t1);

        // 3. Inherited motion via link chain, clamped to the link window
        if (plate.linkedToPlateId) {
            const linkParent = allPlates.find(p => p.id === plate.linkedToPlateId);
            if (linkParent) {
                const from = Math.max(t0, plate.linkTime ?? -Infinity);
                const to = Math.min(t1, plate.unlinkTime ?? Infinity);
                if (to - from > EPS) {
                    const qParent = plateRotation(linkParent, allPlates, from, to, visited);
                    return quatMultiply(qParent, qOwn);
                }
            }
        }

        return qOwn;
    } finally {
        visited.delete(plate.id);
    }
}

/** The geometry stage active at time t (the last stage with time ≤ t). */
export function activeStage(stages: GeometryStage[], t: number): GeometryStage {
    let result = stages[0];
    for (const s of stages) {
        if (s.time <= t + EPS) result = s;
        else break;
    }
    return result;
}

export interface DerivedGeometry {
    polygons: Polygon[];
    features: Feature[];
    center: Coordinate;
}

/**
 * Derive a plate's geometry at time t: active stage rotated by the full
 * rotation from the stage time to t. Pure — returns new objects.
 */
export function derivePlateGeometry(
    plate: TectonicPlate,
    allPlates: TectonicPlate[],
    t: number
): DerivedGeometry {
    const { stages } = getMotionModel(plate);
    const stage = activeStage(stages, t);
    const q = plateRotation(plate, allPlates, stage.time, t);

    const polygons = stage.polygons.map(poly => ({
        ...poly,
        points: poly.points.map(pt => rotateCoordByQuat(pt, q)),
    }));

    // Stage features are absolute at the stage time. Features created after the
    // stage (generatedAt > stage.time) are anchored at their creation time —
    // their stored position is where they were placed.
    const features = stage.features.map(f => {
        const anchor = f.generatedAt !== undefined ? Math.max(f.generatedAt, stage.time) : stage.time;
        const qf = anchor === stage.time ? q : plateRotation(plate, allPlates, anchor, t);
        return { ...f, position: rotateCoordByQuat(f.position, qf) };
    });

    const allPoints = polygons.flatMap(p => p.points);
    const center = allPoints.length > 0 ? calculateSphericalCentroid(allPoints) : plate.center;

    return { polygons, features, center };
}

/** Position at time t of a point anchored to the plate at `anchorTime`. */
export function pointPositionAt(
    plate: TectonicPlate,
    allPlates: TectonicPlate[],
    point: Coordinate,
    anchorTime: number,
    t: number
): Coordinate {
    return rotateCoordByQuat(point, plateRotation(plate, allPlates, anchorTime, t));
}
