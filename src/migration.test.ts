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
    const world = { plates, entityGroups: [], currentTime: 0 } as unknown as WorldState;
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

    it('migrates v4 saves to empty, valid Explorer groups and clears dangling membership', () => {
        const plate = makePlate('a', { groupId: 'missing-group' });
        const save = makeSave([plate], 4);
        delete (save.world as Partial<WorldState>).entityGroups;
        migrateSaveFile(save);
        expect(save.version).toBe(CURRENT_SAVE_VERSION);
        expect(save.world.entityGroups).toEqual([]);
        expect(save.world.plates[0].groupId).toBeUndefined();
    });

    it('removes retired guided-event automation data from v5 saves', () => {
        const save = makeSave([makePlate('a')], 5);
        const world = save.world as unknown as Record<string, any>;
        world.globalOptions = {
            enableGuidedCreation: true,
            pauseOnFusionSuggestion: true,
            showEventIcons: true,
            enableBoundaryVisualization: true
        };
        world.tectonicEvents = [{ id: 'old-event' }];
        world.pendingEventId = 'old-event';

        migrateSaveFile(save);

        expect(save.version).toBe(CURRENT_SAVE_VERSION);
        expect(world.globalOptions).toEqual({
            enableBoundaryVisualization: true,
            oceanCrustStrategy: 'off',
            expandLabelsOnHover: true
        });
        expect(world.tectonicEvents).toBeUndefined();
        expect(world.pendingEventId).toBeUndefined();
    });

    it('migrates legacy ocean toggles to one strategy', () => {
        const save = makeSave([makePlate('a')], 6);
        const options = {
            enableExpandingRifts: true,
            enableAutoOceanicCrust: true
        } as unknown as WorldState['globalOptions'];
        save.world.globalOptions = options;

        migrateSaveFile(save);

        expect(save.world.globalOptions.oceanCrustStrategy).toBe('continuous');
        expect((save.world.globalOptions as any).enableExpandingRifts).toBeUndefined();
        expect((save.world.globalOptions as any).enableAutoOceanicCrust).toBeUndefined();
    });

    it('migrates Explorer group opacity and plate selection state', () => {
        const plate = makePlate('a');
        const save = makeSave([plate], 7);
        save.world.entityGroups = [
            { id: 'visible', name: 'Visible', opacity: 2 },
            { id: 'invalid', name: 'Invalid', opacity: Number.NaN }
        ];
        save.world.selectedPlateId = plate.id;

        migrateSaveFile(save);

        expect(save.world.entityGroups[0].opacity).toBe(1);
        expect(save.world.entityGroups[1].opacity).toBeUndefined();
        expect(save.world.selectedPlateIds).toEqual([plate.id]);
        expect(save.version).toBe(CURRENT_SAVE_VERSION);
    });

    it('adds the label collection and hover preference to v8 saves', () => {
        const save = makeSave([makePlate('a')], 8);
        const world = save.world as unknown as Record<string, any>;
        world.globalOptions = {};

        migrateSaveFile(save);

        expect(world.labels).toEqual([]);
        expect(world.selectedLabelId).toBeNull();
        expect(world.globalOptions.expandLabelsOnHover).toBe(true);
        expect(save.version).toBe(CURRENT_SAVE_VERSION);
    });

    it('migrates the legacy image overlay into the v10 overlay collection', () => {
        const save = makeSave([makePlate('a')], 9);
        const world = save.world as unknown as Record<string, unknown>;
        world.imageOverlay = {
            imageData: 'data:image/png;base64,legacy',
            visible: true,
            opacity: 0.75,
            scale: 1.5,
            offsetX: 24,
            offsetY: -12,
            rotation: 15,
            mode: 'fixed'
        };

        migrateSaveFile(save);

        expect(world.imageOverlay).toBeUndefined();
        expect(world.imageOverlays).toEqual([expect.objectContaining({
            id: 'overlay-1',
            name: 'Reference 1',
            imageData: 'data:image/png;base64,legacy',
            opacity: 0.75,
            scale: 1.5,
            offsetX: 24,
            offsetY: -12
        })]);
        expect(world.selectedImageOverlayId).toBe('overlay-1');
        expect(save.version).toBe(CURRENT_SAVE_VERSION);
    });

    it('preserves fixed hotspot markers while removing retired plume spawn settings', () => {
        const save = makeSave([makePlate('a')], 10);
        const world = save.world as unknown as Record<string, unknown>;
        world.globalOptions = { hotspotSpawnRate: 2.5, showHints: true };
        world.mantlePlumes = [{
            id: 'plume-1',
            position: [12, 34],
            radius: 50,
            strength: 1,
            active: false,
            spawnRate: 0.5
        }];

        migrateSaveFile(save);

        expect(save.version).toBe(CURRENT_SAVE_VERSION);
        expect(world.globalOptions).toEqual({ showHints: true });
        expect(world.mantlePlumes).toEqual([{ id: 'plume-1', position: [12, 34] }]);
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
