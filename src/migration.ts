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
export const CURRENT_SAVE_VERSION = 4;

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

    return data;
}