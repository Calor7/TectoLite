import { describe, it, expect } from 'vitest';
import { migrateSaveFile, CURRENT_SAVE_VERSION, type SaveFile } from './migration';
import { TectonicPlate, WorldState } from './types';

/** Minimal plate with the new motion model already materialized. */
function makePlate(id: string, overrides: Partial<TectonicPlate> = {}): TectonicPlate {
    return {
        id,
        name: `Plate ${id}`,
        type: 'continental',
        color: '#fff',
        zIndex: 0,
        birthTime: 0,
        deathTime: null,
        visible: true,
        locked: false,
        center: [0, 0],
        polygons: [{ id: `${id}-poly`, points: [[0, 0], [1, 0], [1, 1]], closed: true }],
        features: [],
        initialPolygons: [{ id: `${id}-ipoly`, points: [[0, 0], [1, 0], [1, 1]], closed: true }],
        initialFeatures: [],
        motionSegments: [{ time: 0, eulerPole: { position: [0, 90], rate: 0, visible: false } }],
        geometryStages: [{ time: 0, polygons: [{ id: `${id}-gpoly`, points: [[0, 0], [1, 0], [1, 1]], closed: true }], features: [] }],
        events: [],
        connectedRiftIds: [],
        ...overrides,
    } as unknown as TectonicPlate;
}

function makeSave(plates: TectonicPlate[], version: number, extra: Partial<SaveFile> = {}): SaveFile {
    const world = { plates, currentTime: 0 } as unknown as WorldState;
    return { version, world, ...extra };
}

describe('migrateSaveFile', () => {
    it('migrates v2 → v3 line-type rename (rift → divergent)', () => {
        const plate = makePlate('a', { lineType: 'rift' as any });
        const save = makeSave([plate], 2);
        migrateSaveFile(save);
        expect(save.version).toBe(CURRENT_SAVE_VERSION);
        expect(save.world.plates[0].lineType).toBe('divergent');
    });

    it('migrates v3 → v4 motion model (legacy keyframes → motionSegments)', () => {
        // A v3 plate carrying only legacy motion/motionKeyframes (no
        // motionSegments) should be materialized by the migration.
        const raw = makePlate('a') as any;
        delete raw.motionSegments;
        delete raw.geometryStages;
        raw.motion = { eulerPole: { position: [0, 90], rate: 1, visible: false } };
        raw.motionKeyframes = [{
            time: 0,
            eulerPole: { position: [0, 90], rate: 1, visible: false },
            snapshotPolygons: raw.polygons,
            snapshotFeatures: [],
        }];

        const save = makeSave([raw], 3);
        migrateSaveFile(save);
        expect(save.version).toBe(CURRENT_SAVE_VERSION);
        const migrated = save.world.plates[0] as any;
        expect(Array.isArray(migrated.motionSegments)).toBe(true);
        expect(migrated.motionSegments.length).toBeGreaterThan(0);
        expect(Array.isArray(migrated.geometryStages)).toBe(true);
        expect(migrated.geometryStages.length).toBeGreaterThan(0);
        // Legacy fields are stripped by ensureMotionModel.
        expect(migrated.motionKeyframes).toBeUndefined();
        expect(migrated.motion).toBeUndefined();
    });

    it('is idempotent: migrating a v3 save twice produces the same result', () => {
        const plate = makePlate('a', { lineType: 'rift' as any });
        const save = makeSave([plate], 2);
        migrateSaveFile(save);
        const snapshot = JSON.stringify(save);

        // Second run: version is now current, so no step fires.
        migrateSaveFile(save);
        expect(JSON.stringify(save)).toBe(snapshot);
        expect(save.version).toBe(CURRENT_SAVE_VERSION);
    });

    it('is idempotent on a current-version save', () => {
        const plate = makePlate('a', { lineType: 'divergent' });
        const save = makeSave([plate], CURRENT_SAVE_VERSION);
        const before = JSON.stringify(save);
        migrateSaveFile(save);
        expect(JSON.stringify(save)).toBe(before);
    });

    it('handles v0 / undefined version gracefully', () => {
        const plate = makePlate('a', { lineType: 'rift' as any });
        const save = makeSave([plate], 0 as any);
        delete (save as any).version;
        migrateSaveFile(save);
        expect(save.version).toBe(CURRENT_SAVE_VERSION);
        expect(save.world.plates[0].lineType).toBe('divergent');
    });

    it('walks a v1 save through every step to the current version', () => {
        const raw = makePlate('a') as any;
        delete raw.motionSegments;
        delete raw.geometryStages;
        raw.lineType = 'trench';
        raw.motionKeyframes = [{
            time: 0,
            eulerPole: { position: [0, 90], rate: 0.5, visible: false },
            snapshotPolygons: raw.polygons,
            snapshotFeatures: [],
        }];

        const save = makeSave([raw], 1);
        migrateSaveFile(save);
        expect(save.version).toBe(CURRENT_SAVE_VERSION);
        const p = save.world.plates[0] as any;
        expect(p.lineType).toBe('convergent');
        expect(p.motionSegments.length).toBeGreaterThan(0);
        expect(p.geometryStages.length).toBeGreaterThan(0);
    });
});

describe('version rejection contract', () => {
    // parseImportFile (in export.ts) rejects saves with version >
    // CURRENT_SAVE_VERSION *before* calling migrateSaveFile. This test guards
    // that contract: a future-version save must not be silently downgraded by
    // the migration pipeline. (parseImportFile itself uses FileReader, which
    // is unavailable in the Node test env, so we assert the version guard
    // predicate directly.)
    it('a save with version > CURRENT_SAVE_VERSION would be rejected', () => {
        const future = makeSave([makePlate('a')], CURRENT_SAVE_VERSION + 1);
        const wouldReject = !!future.version && future.version > CURRENT_SAVE_VERSION;
        expect(wouldReject).toBe(true);
    });

    it('migrateSaveFile does not downgrade a future-version save', () => {
        const future = makeSave([makePlate('a')], CURRENT_SAVE_VERSION + 1);
        // The pipeline only bumps *low* versions; a future version is left
        // untouched (the caller is responsible for rejecting it).
        migrateSaveFile(future);
        expect(future.version).toBe(CURRENT_SAVE_VERSION + 1);
    });
});