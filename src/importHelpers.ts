// Pure helpers for merging an imported world into an existing one.
// Extracted from the main.ts import handler so the ID/time remapping
// logic is unit-testable in isolation.

import {
    TectonicPlate,
    WorldState,
    EntityGroup,
    Feature,
    RiftAxis,
    TripleJunction,
    generateId,
    migrateLineType,
} from './types';
import { ensureMotionModel } from './motion/RotationModel';

export interface RemappedImport {
    plates: TectonicPlate[];
    entityGroups: EntityGroup[];
    riftAxes: RiftAxis[];
    tripleJunctions: TripleJunction[];
}

/**
 * Prepare an imported world for merging into the current one:
 * - regenerates all plate/polygon/feature IDs to avoid collisions,
 * - remaps cross-plate references (parent, link, siblings, rifts) onto the
 *   new IDs, stripping references to plates that weren't imported,
 * - keeps feature IDs stable across features/initialFeatures/snapshots
 *   (the engine matches these occurrences by ID),
 * - shifts all timestamps by `timeOffset`,
 * - carries rift axes and triple junctions over with remapped references.
 *
 * Ephemeral axis/junction-derived ocean plates are skipped: they are
 * re-derived each frame from the imported rift axes.
 */
export function remapImportedWorld(
    importedWorld: Pick<WorldState, 'plates'>
        & Partial<Pick<WorldState, 'entityGroups' | 'riftAxes' | 'tripleJunctions'>>,
    timeOffset: number
): RemappedImport {
    const idMap = new Map<string, string>(); // old plate id -> new plate id
    const groupIdMap = new Map<string, string>(); // old Explorer group id -> new group id
    const featureIdMap = new Map<string, string>(); // old feature id -> new feature id

    const platesToImport = importedWorld.plates.filter(p => !p.riftAxisId && !p.junctionId);

    // Pre-assign plate IDs so cross-references can be remapped below
    platesToImport.forEach(plate => idMap.set(plate.id, generateId()));
    const entityGroups = (importedWorld.entityGroups || []).map(group => {
        const id = generateId();
        groupIdMap.set(group.id, id);
        return { ...group, id };
    });

    const mapFeatureId = (oldId: string): string => {
        let newId = featureIdMap.get(oldId);
        if (!newId) { newId = generateId(); featureIdMap.set(oldId, newId); }
        return newId;
    };

    const adjustFeatureTime = (f: Feature): Feature => ({
        ...f,
        id: mapFeatureId(f.id),
        generatedAt: f.generatedAt !== undefined ? f.generatedAt + timeOffset : timeOffset,
        deathTime: f.deathTime !== undefined ? f.deathTime + timeOffset : undefined
    });

    // Regenerate polygon IDs and remap edge-metadata references.
    // Sibling assignments pointing at plates outside this import are dropped
    // (a stale siblingPlateId would silently break sibling crust generation).
    const remapPolygons = (polys: TectonicPlate['polygons']): TectonicPlate['polygons'] =>
        polys.map(poly => ({
            ...poly,
            id: generateId(),
            edgeMeta: poly.edgeMeta?.map(em => ({
                ...em,
                sourceId: em.sourceId && idMap.has(em.sourceId) ? idMap.get(em.sourceId)! : em.sourceId,
                siblings: em.siblings
                    ?.filter(s => idMap.has(s.siblingPlateId))
                    .map(s => ({
                        ...s,
                        siblingPlateId: idMap.get(s.siblingPlateId)!,
                        createdAt: s.createdAt + timeOffset
                    }))
            }))
        }));

    const remapRef = (oldId: string | undefined): string | undefined =>
        oldId ? idMap.get(oldId) : undefined;

    const plates = platesToImport.map(plate => ({
        ...plate,
        id: idMap.get(plate.id)!,
        groupId: plate.groupId ? groupIdMap.get(plate.groupId) : undefined,
        // Remap cross-plate references; dangling ones are stripped so motion
        // inheritance and parent-chain lookups don't fail on stale IDs.
        parentPlateId: remapRef(plate.parentPlateId),
        parentPlateIds: plate.parentPlateIds
            ?.map(id => idMap.get(id))
            .filter((id): id is string => id !== undefined),
        linkedToPlateId: remapRef(plate.linkedToPlateId),
        generatedBy: remapRef(plate.generatedBy),
        // Normalize legacy lineType values (rift/trench/fault/suture) to the
        // current LineType union so old saves render with the new palette.
        lineType: plate.lineType ? migrateLineType(plate.lineType) : plate.lineType,
        connectedRiftIds: (plate.connectedRiftIds || [])
            .map(id => idMap.get(id))
            .filter((id): id is string => id !== undefined),
        polygons: remapPolygons(plate.polygons),
        features: plate.features.map(adjustFeatureTime),
        initialPolygons: remapPolygons(plate.initialPolygons),
        initialFeatures: plate.initialFeatures.map(adjustFeatureTime),
        // Keyframe-less model fields (v4 saves). Shift times by the offset.
        motionSegments: plate.motionSegments?.map(s => ({ ...s, time: s.time + timeOffset })),
        geometryStages: plate.geometryStages?.map(s => ({
            ...s,
            time: s.time + timeOffset,
            polygons: remapPolygons(s.polygons),
            features: s.features.map(adjustFeatureTime)
        }))
    }));

    // Safety net: ensure every plate has the new model materialized. Old v3
    // saves that slipped through parseImportFile without migration are caught
    // here. ensureMotionModel reads legacy motion/motionKeyframes if present
    // (the raw JSON carries them as extra fields not in the type).
    for (const plate of plates) {
        ensureMotionModel(plate);
    }

    // Carry rift axes and triple junctions over. Axes whose flanking plates
    // weren't imported are skipped; junctions follow their axes.
    const axisIdMap = new Map<string, string>();
    const riftAxes: RiftAxis[] = (importedWorld.riftAxes || [])
        .filter(a => idMap.has(a.plateIdA) && idMap.has(a.plateIdB))
        .map(a => {
            const newAxisId = generateId();
            axisIdMap.set(a.id, newAxisId);
            return {
                ...a,
                id: newAxisId,
                plateIdA: idMap.get(a.plateIdA)!,
                plateIdB: idMap.get(a.plateIdB)!,
                birthTime: a.birthTime + timeOffset,
                frozenTime: a.frozenTime !== undefined ? a.frozenTime + timeOffset : undefined,
                deathTime: a.deathTime !== undefined ? a.deathTime + timeOffset : undefined,
                isochrons: a.isochrons.map(iso => ({ ...iso, time: iso.time + timeOffset }))
            };
        });

    const junctionIdMap = new Map<string, string>();
    const tripleJunctions: TripleJunction[] = (importedWorld.tripleJunctions || [])
        .filter(j => j.axisIds.every(id => axisIdMap.has(id)))
        .map(j => {
            const newJunctionId = generateId();
            junctionIdMap.set(j.id, newJunctionId);
            return {
                ...j,
                id: newJunctionId,
                axisIds: j.axisIds.map(id => axisIdMap.get(id)!),
                birthTime: j.birthTime + timeOffset,
                junctionHistory: j.junctionHistory?.map(v => ({ ...v, time: v.time + timeOffset }))
            };
        });

    return { plates, entityGroups, riftAxes, tripleJunctions };
}

/**
 * In-place migration of a world's plate.lineType values from the legacy
 * LineType union (rift/trench/fault/suture) to the current one
 * (divergent/convergent/transform/generic). Use this for load paths that
 * bypass remapImportedWorld (autosave restore, replace-current import).
 */
export function migrateWorldLineTypes(world: Pick<WorldState, 'plates'>): void {
    for (const plate of world.plates) {
        if (plate.lineType) {
            plate.lineType = migrateLineType(plate.lineType);
        }
    }
}

/**
 * In-place migration of a world's plates to the keyframe-less motion model
 * (motionSegments + geometryStages). Converts legacy motion/motionKeyframes
 * via ensureMotionModel. Use this for load paths that bypass
 * remapImportedWorld (autosave restore, replace-current import, parseImportFile).
 */
export function migrateWorldMotion(world: Pick<WorldState, 'plates'>): void {
    for (const plate of world.plates) {
        ensureMotionModel(plate);
    }
}
