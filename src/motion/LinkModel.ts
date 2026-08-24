import type { MotionSegment, TectonicPlate } from '../types';

const EPS = 0.001;
const STATIONARY_POLE = { position: [0, 90] as [number, number], rate: 0, visible: false };

/** Whether this plate inherits motion from its saved parent at the given time. */
export function isMotionLinkActiveAtTime(
    plate: Pick<TectonicPlate, 'linkedToPlateId' | 'linkTime' | 'unlinkTime'>,
    time: number,
    expectedParentId?: string
): boolean {
    if (!plate.linkedToPlateId) return false;
    if (expectedParentId && plate.linkedToPlateId !== expectedParentId) return false;
    const startsAt = plate.linkTime ?? -Infinity;
    const endsAt = plate.unlinkTime ?? Infinity;
    return time + EPS >= startsAt && time < endsAt - EPS;
}

/**
 * Start (or reschedule) a motion link. The zero segment is intentionally
 * replaced even when a segment already exists at this exact time: otherwise a
 * child's old momentum remains active on top of the parent motion.
 */
export function linkPlateAtTime(child: TectonicPlate, parentId: string, time: number): TectonicPlate {
    const motionSegments: MotionSegment[] = child.motionSegments
        .filter(segment => Math.abs(segment.time - time) > EPS)
        .concat({ time, eulerPole: { ...STATIONARY_POLE } })
        .sort((a, b) => a.time - b.time);

    return {
        ...child,
        motionSegments,
        linkedToPlateId: parentId,
        linkTime: time,
        unlinkTime: undefined,
    };
}

/**
 * Whether a new child → parent link starting at `time` would overlap a link
 * chain that leads back to the child. Link windows are intersected as the
 * chain is followed, so an expired historical relationship does not block a
 * valid new link while a future overlapping cycle is still rejected.
 */
export function wouldCreateMotionLinkCycle(
    plates: readonly TectonicPlate[],
    childId: string,
    parentId: string,
    time: number
): boolean {
    const byId = new Map(plates.map(plate => [plate.id, plate]));
    const visited = new Set<string>();
    let currentId: string | undefined = parentId;
    let overlapStart = time;
    let overlapEnd = Infinity;

    while (currentId) {
        if (currentId === childId) return overlapStart < overlapEnd - EPS;
        if (visited.has(currentId)) return true;
        visited.add(currentId);

        const current = byId.get(currentId);
        if (!current?.linkedToPlateId) return false;

        overlapStart = Math.max(overlapStart, current.linkTime ?? -Infinity);
        overlapEnd = Math.min(overlapEnd, current.unlinkTime ?? Infinity);
        if (overlapStart >= overlapEnd - EPS) return false;
        currentId = current.linkedToPlateId;
    }

    return false;
}
