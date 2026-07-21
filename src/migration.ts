// Centralized save-file migration pipeline.
//
// Each save file carries a `version` integer. As the save format evolves,
// older saves are upgraded to the current version by a sequence of
// version-gated migration steps. The pipeline is **idempotent**: running it
// twice on the same data is a no-op (each step only fires when
// `data.version < N`).
//
// `migrateSaveFile` mutates the save object **in place** for efficiency —
// deep-cloning a world (with its polygons, features, motion segments, and
// geometry stages) is expensive and unnecessary for a one-way upgrade.

import { WorldState } from './types';
import { migrateWorldLineTypes, migrateWorldMotion } from './importHelpers';

export interface SaveFile {
    version: number;
    savedAt?: string;
    name?: string;
    world: WorldState;
    viewport?: any;
    cameraViews?: any[];
    activeTool?: string;
    activeFeatureType?: string;
    [key: string]: any;
}

/** Current save file version. Bump this whenever the on-disk format changes. */
export const CURRENT_SAVE_VERSION = 9;

/**
 * Migrate a parsed save file to {@link CURRENT_SAVE_VERSION}.
 *
 * Each migration step is gated by the version it upgrades FROM. Steps run in
 * ascending order and bump `data.version` as they complete, so a v1 save is
 * walked through v2 → v3 → v4 in a single call.
 *
 * **Mutates `data` in place** — deep-cloning a world is expensive and the
 * upgrade is one-way. Callers that need to preserve the original should clone
 * before calling this function.
 *
 * The pipeline is idempotent: a save already at {@link CURRENT_SAVE_VERSION}
 * is returned unchanged, and the underlying migration helpers
 * (`migrateWorldLineTypes`, `migrateWorldMotion`) are themselves idempotent.
 */
export function migrateSaveFile(data: SaveFile): SaveFile {
    // v0 / undefined → v1: no known v0 saves exist, but handle gracefully so
    // a malformed file doesn't crash the load path.
    if (!data.version || data.version < 1) {
        data.version = 1;
    }

    // v1 → v2: no structural change is known between v1 and v2 (the line-type
    // rename and motion-model migration both landed at v3 / v4). Bump the
    // version so older saves flow through the later steps.
    if (data.version < 2) {
        data.version = 2;
    }

    // v2 → v3: line type rename
    // (rift/trench/fault/suture → divergent/convergent/transform/generic)
    if (data.version < 3) {
        migrateWorldLineTypes(data.world);
        data.version = 3;
    }

    // v3 → v4: motion model migration
    // (legacy motion/motionKeyframes → motionSegments + geometryStages)
    if (data.version < 4) {
        migrateWorldMotion(data.world);
        data.version = 4;
    }

    // v4 → v5: persistent, non-mechanical Explorer entity groups.
    if (data.version < 5) {
        const groups = Array.isArray(data.world.entityGroups) ? data.world.entityGroups : [];
        const uniqueGroups = groups.filter((group, index) =>
            group && typeof group.id === 'string' && typeof group.name === 'string'
            && groups.findIndex(candidate => candidate?.id === group.id) === index
        );
        data.world.entityGroups = uniqueGroups;
        const validIds = new Set(uniqueGroups.map(group => group.id));
        for (const plate of data.world.plates) {
            if (plate.groupId && !validIds.has(plate.groupId)) delete plate.groupId;
        }
        data.version = 5;
    }

    // v5 → v6: remove the retired guided-event automation prototype.
    // Use loose records here so old JSON remains accepted even though these
    // properties no longer exist in the current WorldState types.
    if (data.version < 6) {
        const world = data.world as unknown as Record<string, any>;
        const options = world.globalOptions as Record<string, any> | undefined;
        if (options) {
            for (const key of [
                'enableDynamicFeatures',
                'pauseOnFusionSuggestion',
                'enableHotspots',
                'enableGuidedCreation',
                'repopupCommittedEvents',
                'eventDetectionThreshold',
                'showEventIcons'
            ]) {
                delete options[key];
            }
        }
        delete world.tectonicEvents;
        delete world.pendingEventId;
        data.version = 6;
    }

    // v6 → v7: replace two independent ocean-generation flags with one
    // mutually exclusive strategy. Prefer the newer continuous mode if an old
    // project had both flags enabled.
    if (data.version < 7) {
        const world = data.world as unknown as Record<string, any>;
        const options = (world.globalOptions ??= {}) as Record<string, any>;
        if (options.enableExpandingRifts === true) options.oceanCrustStrategy = 'continuous';
        else if (options.enableAutoOceanicCrust === true) options.oceanCrustStrategy = 'banded';
        else options.oceanCrustStrategy = 'off';
        delete options.enableExpandingRifts;
        delete options.enableAutoOceanicCrust;
        data.version = 7;
    }

    // v7 → v8: groups can carry a visual opacity multiplier, and Explorer
    // plate multi-selection is represented explicitly in project state.
    if (data.version < 8) {
        const groups = Array.isArray(data.world.entityGroups) ? data.world.entityGroups : [];
        for (const group of groups) {
            if (typeof group.opacity === 'number' && Number.isFinite(group.opacity)) {
                group.opacity = Math.min(1, Math.max(0, group.opacity));
            } else {
                delete group.opacity;
            }
        }
        data.world.selectedPlateIds = data.world.selectedPlateId
            ? [data.world.selectedPlateId]
            : [];
        data.version = 8;
    }

    // v8 → v9: first-class map labels and their selection/hover settings.
    if (data.version < 9) {
        const world = data.world as unknown as Record<string, any>;
        world.labels = Array.isArray(world.labels) ? world.labels : [];
        world.selectedLabelId = null;
        const options = (world.globalOptions ??= {}) as Record<string, any>;
        if (typeof options.expandLabelsOnHover !== 'boolean') options.expandLabelsOnHover = true;
        data.version = 9;
    }

    return data;
}
