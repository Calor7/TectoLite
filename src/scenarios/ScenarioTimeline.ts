import type { Coordinate, GeologicalScenario, WorldState } from '../types';
import { activeEulerPole, activeStage, derivePlateGeometry, derivePlateFeatures, getMotionModel, pointPositionAt } from '../motion/RotationModel';
export function scenarioAge(scenario: GeologicalScenario, time: number): string {
    const age = scenario.startAge - time;
    if (Math.abs(age) < 0.05)
        return 'Present day';
    return age > 0 ? `${Number(age.toFixed(1))} Ma ago` : `+${Number((-age).toFixed(1))} million years`;
}
/** Branch into a fresh editable world at a chosen chapter without its future events. */
export function branchScenario(world: WorldState): WorldState {
    const next = structuredClone(world), time = world.currentTime;
    next.plates = world.plates.filter(p => p.birthTime <= time && (p.deathTime === null || time < p.deathTime)).map(p => {
        const geometry = derivePlateGeometry(p, world.plates, time);
        const features = geometry.features.filter(f => (f.generatedAt ?? 0) <= time && (f.deathTime === undefined || time < f.deathTime)).map(f => ({ ...f, generatedAt: 0, deathTime: undefined, originalPosition: [...f.position] as Coordinate }));
        const copy = structuredClone(p);
        if ((copy.linkTime ?? -Infinity) > time || (copy.unlinkTime ?? Infinity) <= time) {
            delete copy.linkedToPlateId;
            delete copy.relativeEulerPole;
        }
        return { ...copy, ...geometry, features, initialPolygons: geometry.polygons, initialFeatures: features, birthTime: 0, deathTime: null, parentPlateId: undefined, parentPlateIds: undefined,
            linkTime: copy.linkedToPlateId ? 0 : undefined, unlinkTime: undefined,
            motionSegments: [{ time: 0, eulerPole: structuredClone(activeEulerPole(p, time)) }], geometryStages: [{ time: 0, polygons: geometry.polygons, features }], events: [] };
    });
    const ids = new Set(next.plates.map(p => p.id));
    next.labels = world.labels.map(label => {
        const plate = world.plates.find(p => p.id === label.attachedPlateId);
        return { ...label, anchor: plate ? pointPositionAt(plate, world.plates, label.anchor, label.anchorTime, time) : label.anchor,
            anchorTime: 0, attachedPlateId: ids.has(label.attachedPlateId ?? '') ? label.attachedPlateId : undefined };
    });
    for (const p of next.plates)
        if (p.linkedToPlateId && !ids.has(p.linkedToPlateId)) {
            delete p.linkedToPlateId;
            delete p.linkTime;
            delete p.relativeEulerPole;
        }
    delete next.scenario;
    next.currentTime = 0;
    next.isPlaying = false;
    next.selectedPlateId = null;
    next.selectedPlateIds = [];
    next.selectedFeatureId = null;
    next.selectedFeatureIds = [];
    next.selectedEdge = null;
    next.selectedLabelId = null;
    next.riftAxes = [];
    next.tripleJunctions = [];
    next.globalOptions.timelineMaxTime = 500;
    return next;
}
/** Keep the remainder of a scenario, including successors that are not born yet. */
export function trimScenarioTimeline(world: WorldState): WorldState {
    const time = world.currentTime;
    const next = branchScenario(world);
    const retained = world.plates.filter(p => p.deathTime === null || p.deathTime > time);
    const ids = new Set(retained.map(p => p.id));
    next.plates = retained.map(p => {
        const copy = structuredClone(p);
        const born = p.birthTime <= time;
        const geometry = born ? derivePlateGeometry(p, world.plates, time) : {
            polygons: copy.initialPolygons, features: copy.initialFeatures, center: copy.center,
        };
        const shiftFeature = (f: typeof p.features[number]) => ({ ...f,
            generatedAt: f.generatedAt === undefined ? undefined : Math.max(0, f.generatedAt - time),
            deathTime: f.deathTime === undefined ? undefined : f.deathTime - time,
        });
        const features = geometry.features.filter(f => f.deathTime === undefined || f.deathTime > time)
            .map(f => shiftFeature({ ...f, originalPosition: [...((f.generatedAt ?? 0) > time ? f.originalPosition ?? f.position : f.position)] as Coordinate }));
        const stages = copy.geometryStages.filter(s => s.time > time).map(s => ({ ...s, time: s.time - time,
            features: derivePlateFeatures(p, world.plates, s.time).map(shiftFeature) }));
        const segments = copy.motionSegments.filter(s => s.time > time).map(s => ({ ...s, time: s.time - time }));
        if (born) {
            stages.unshift({ time: 0, polygons: geometry.polygons, features,
                interpolation: activeStage(getMotionModel(p).stages, time).interpolation });
            segments.unshift({ time: 0, eulerPole: structuredClone(activeEulerPole(p, time)) });
        }
        const linked = copy.linkedToPlateId && ids.has(copy.linkedToPlateId)
            && (copy.unlinkTime === undefined || copy.unlinkTime > time);
        return { ...copy, ...geometry, features, initialPolygons: geometry.polygons, initialFeatures: features,
            birthTime: Math.max(0, p.birthTime - time), deathTime: p.deathTime === null ? null : p.deathTime - time,
            geometryStages: stages, motionSegments: segments,
            parentPlateId: !born && ids.has(p.parentPlateId ?? '') ? p.parentPlateId : undefined,
            parentPlateIds: born ? undefined : p.parentPlateIds?.filter(id => ids.has(id)),
            linkedToPlateId: linked ? copy.linkedToPlateId : undefined,
            linkTime: linked ? Math.max(0, (copy.linkTime ?? p.birthTime) - time) : undefined,
            unlinkTime: linked && copy.unlinkTime !== undefined ? copy.unlinkTime - time : undefined,
            events: copy.events.filter(e => e.time >= time).map(e => ({ ...e, time: e.time - time })),
        };
    });
    next.labels = world.labels.map(label => {
        const plate = world.plates.find(p => p.id === label.attachedPlateId);
        const anchorTime = Math.max(time, label.anchorTime);
        return { ...structuredClone(label), anchor: plate ? pointPositionAt(plate, world.plates, label.anchor, label.anchorTime, anchorTime) : label.anchor,
            anchorTime: anchorTime - time, attachedPlateId: ids.has(label.attachedPlateId ?? '') ? label.attachedPlateId : undefined };
    });
    if (world.scenario && time < world.scenario.duration) {
        next.scenario = { ...structuredClone(world.scenario), startAge: world.scenario.startAge - time,
            duration: world.scenario.duration - time,
            chapters: [{ time: 0, title: 'Saved starting point', description: `Continues from ${scenarioAge(world.scenario, time)}.` },
                ...world.scenario.chapters.filter(c => c.time > time).map(c => ({ ...c, time: c.time - time }))],
        };
        next.globalOptions.timelineMaxTime = next.scenario.duration;
    }
    return next;
}
