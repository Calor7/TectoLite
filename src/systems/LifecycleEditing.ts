import type { GeometryStage, TectonicPlate, WorldState } from '../types';
import { derivePlateGeometry } from '../motion/RotationModel';

const same = (a: number | null | undefined, b: number) => a != null && Math.abs(a - b) < 1e-7;
const parentsOf = (plate: TectonicPlate) => plate.parentPlateIds?.length
    ? plate.parentPlateIds : plate.parentPlateId ? [plate.parentPlateId] : [];

interface Transition { time: number; parents: Set<string>; children: Set<string> }

/** A lifecycle boundary includes every ancestor/successor and linked display layer. */
function transition(plates: TectonicPlate[], seedId: string, time: number): Transition {
    const result: Transition = { time, parents: new Set(), children: new Set() };
    const seed = plates.find(p => p.id === seedId);
    if (!seed) return result;
    if (same(seed.deathTime, time)) result.parents.add(seed.id);
    if (same(seed.birthTime, time) && parentsOf(seed).length) result.children.add(seed.id);
    let changed = true;
    while (changed) {
        const count = result.parents.size + result.children.size;
        for (const plate of plates) {
            if (same(plate.birthTime, time) && parentsOf(plate).some(id => result.parents.has(id))) result.children.add(plate.id);
            if (result.children.has(plate.id)) {
                for (const id of parentsOf(plate)) {
                    if (same(plates.find(p => p.id === id)?.deathTime, time)) result.parents.add(id);
                }
            }
            if (!plate.linkedToPlateId) continue;
            const linked = plates.find(p => p.id === plate.linkedToPlateId);
            for (const [set, matches] of [
                [result.parents, (p: TectonicPlate) => same(p.deathTime, time)],
                [result.children, (p: TectonicPlate) => same(p.birthTime, time)],
            ] as const) {
                if (linked && matches(plate) && matches(linked) && (set.has(plate.id) || set.has(linked.id))) {
                    set.add(plate.id); set.add(linked.id);
                }
            }
        }
        changed = count !== result.parents.size + result.children.size;
    }
    return result;
}

function movedFeature(feature: TectonicPlate['features'][number], delta: number, boundary?: number) {
    const move = (time: number | undefined) => time === undefined ? undefined
        : boundary === undefined || same(time, boundary) ? time + delta : time;
    return { ...feature, generatedAt: move(feature.generatedAt), deathTime: move(feature.deathTime) };
}

/**
 * Retimes a whole split/fusion, including its linked covers and cratons.
 * Cascade follows descendants and the complete later transitions they meet.
 * Boundary geometry is captured before mutation so both sides still meet.
 */
export function retimeLifecycleTransition(
    plates: TectonicPlate[], seedId: string, oldTime: number, newTime: number, cascade: boolean,
): boolean {
    if (!Number.isFinite(newTime) || newTime < 0) throw new Error('Enter a finite elapsed time of zero or later.');
    const first = transition(plates, seedId, oldTime);
    if (!first.parents.size || !first.children.size) return false;
    const delta = newTime - oldTime;
    if (Math.abs(delta) < 1e-7) return true;
    const transitions: Transition[] = [];
    const queued = [first];
    const visited = new Set<string>();
    while (queued.length) {
        const item = queued.shift()!;
        const key = `${item.time}:${[...item.parents].sort().join(',')}`;
        if (visited.has(key)) continue;
        visited.add(key); transitions.push(item);
        if (cascade) for (const id of item.children) {
            const child = plates.find(p => p.id === id)!;
            if (child.deathTime !== null) {
                const later = transition(plates, child.id, child.deathTime);
                if (later.children.size) queued.push(later);
            }
        }
    }
    const shifted = new Set(cascade ? transitions.flatMap(item => [...item.children]) : []);
    const starts = new Map(transitions.flatMap(item => [...item.children].map(id => [id, item.time] as const)));
    const ends = new Map(transitions.flatMap(item => [...item.parents].map(id => [id, item.time] as const)));
    for (const plate of plates) {
        const birth = starts.has(plate.id) ? plate.birthTime + delta : plate.birthTime;
        const death = ends.has(plate.id) || shifted.has(plate.id)
            ? plate.deathTime === null ? null : plate.deathTime + delta : plate.deathTime;
        if (death !== null && death <= birth) throw new Error(`This time would put ${plate.name}’s end before its birth.`);
    }
    const snapshots = new Map<string, ReturnType<typeof derivePlateGeometry>>();
    for (const item of transitions) for (const id of [...item.parents, ...item.children]) {
        snapshots.set(`${id}:${item.time}`, derivePlateGeometry(plates.find(p => p.id === id)!, plates, item.time));
    }
    for (const plate of plates) {
        const start = starts.get(plate.id), end = ends.get(plate.id), whole = shifted.has(plate.id);
        if (start === undefined && end === undefined) continue;
        const boundary = (time: number) => same(time, start ?? NaN) || same(time, end ?? NaN);
        const move = (time: number) => whole || boundary(time) ? time + delta : time;
        plate.birthTime = start === undefined ? plate.birthTime : plate.birthTime + delta;
        if (plate.deathTime !== null && (end !== undefined || whole)) plate.deathTime += delta;
        plate.motionSegments = plate.motionSegments.map(s => ({ ...s, time: move(s.time) })).sort((a, b) => a.time - b.time);
        plate.geometryStages = plate.geometryStages.map(s => ({ ...s, time: move(s.time), features: s.features.map(f => movedFeature(f, delta, whole ? undefined : start ?? end)) })).sort((a, b) => a.time - b.time);
        plate.events = plate.events.map(e => ({ ...e, time: move(e.time) }));
        if (plate.linkTime !== undefined) plate.linkTime = move(plate.linkTime);
        if (plate.unlinkTime !== undefined) plate.unlinkTime = move(plate.unlinkTime);
        plate.features = plate.features.map(f => movedFeature(f, delta, whole ? undefined : start ?? end));
        plate.initialFeatures = plate.initialFeatures.map(f => movedFeature(f, delta, whole ? undefined : start ?? end));
        // Explicit endpoint stages also cover ordinary user-created plates that
        // have no recorded death-stage geometry yet.
        for (const at of [start, end]) {
            if (at === undefined) continue;
            const captured = snapshots.get(`${plate.id}:${at}`)!;
            const target = at + delta;
            const oldStage = plate.geometryStages.find(s => same(s.time, target));
            const replacement: GeometryStage = { ...oldStage, time: target, polygons: captured.polygons,
                features: captured.features.map(f => movedFeature(f, delta, whole ? undefined : at)) };
            // The new boundary can coincide with an existing interior stage.
            // Its boundary snapshot must win rather than leaving two times and
            // letting activeStage choose the stale interior geometry.
            plate.geometryStages = plate.geometryStages.filter(s => !same(s.time, target));
            plate.geometryStages.push(replacement);
            plate.geometryStages.sort((a, b) => a.time - b.time);
            if (at === end) {
                const preceding = plate.geometryStages.filter(s => s.time < target).at(-1);
                if (preceding) preceding.interpolation = 'spherical';
            }
        }
        // A delayed birth must not select an old interior stage before its new
        // birth snapshot. Future stages survive when cascade is off.
        plate.geometryStages = plate.geometryStages.filter(s => s.time >= plate.birthTime);
        plate.motionSegments = plate.motionSegments.filter(s => s.time >= plate.birthTime);
        plate.initialPolygons = plate.geometryStages[0].polygons;
        plate.initialFeatures = plate.geometryStages[0].features;
    }
    return true;
}

/** Restore all ancestors and return successor/descendant IDs for normal deletion. */
export function removeLifecycleTransition(plates: TectonicPlate[], seedId: string, time: number): string[] {
    const first = transition(plates, seedId, time);
    if (!first.parents.size || !first.children.size) return [];
    const removed = new Set(first.children);
    let changed = true;
    while (changed) {
        const count = removed.size;
        for (const plate of plates) {
            if (parentsOf(plate).some(id => removed.has(id))) removed.add(plate.id);
            if (plate.linkedToPlateId && removed.has(plate.linkedToPlateId) && plate.birthTime >= time) removed.add(plate.id);
        }
        changed = count !== removed.size;
    }
    for (const child of plates.filter(p => removed.has(p.id))) {
        for (const id of parentsOf(child)) {
            const parent = plates.find(p => p.id === id);
            if (!parent || removed.has(id) || !same(parent.deathTime, child.birthTime)) continue;
            parent.deathTime = null;
            parent.events = parent.events.filter(e => !same(e.time, child.birthTime) || (e.type !== 'split' && e.type !== 'fusion'));
        }
    }
    return [...removed];
}

/** The original geological chapter claims no longer describe user-edited timing. */
export function reconcileEditedTimeline(world: WorldState, delta = 0, cascade = false): void {
    let lastRecord = 0;
    for (const plate of world.plates) {
        lastRecord = Math.max(lastRecord, plate.birthTime, plate.deathTime ?? 0);
        for (const records of [plate.geometryStages, plate.motionSegments, plate.events]) {
            for (const record of records) lastRecord = Math.max(lastRecord, record.time);
        }
    }
    const scenario = world.scenario;
    if (scenario) {
        const duration = Math.max(1, lastRecord, scenario.duration + (cascade ? delta : 0));
        const edited = scenario.title.startsWith('Edited · ');
        world.scenario = { ...scenario, duration,
            title: edited ? scenario.title : `Edited · ${scenario.title}`,
            summary: edited ? scenario.summary : `${scenario.summary} Lifecycle timing has been edited; the original chapter narrative no longer applies.`,
            chapters: [
                { time: 0, title: 'Edited timeline', description: 'This history has been edited. Geological ages retain the original time origin, but the original scenario milestones no longer describe the authored events. Inspect entity History for the current timing.' },
                { time: duration, title: 'End of edited timeline', description: 'The timeline includes the edited lifecycle history. This endpoint is authored; use the current world as a new starting point to continue.' },
            ],
        };
        world.globalOptions.timelineMaxTime = duration;
    } else {
        world.globalOptions.timelineMaxTime = Math.max(world.globalOptions.timelineMaxTime ?? 500, lastRecord);
    }
}
