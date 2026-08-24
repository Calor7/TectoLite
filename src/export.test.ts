import { describe, expect, it } from 'vitest';
import { createExportViewport, createWorldFromCurrentTime } from './export';
import type { Polygon, TectonicPlate, WorldState } from './types';

describe('createExportViewport', () => {
    it('cover-crops a wider export instead of revealing extra map area', () => {
        const result = createExportViewport(
            { width: 1000, height: 800, scale: 200, rotate: [0, 0, 0], translate: [520, 390] },
            1920,
            1080
        );
        expect(result.scale).toBe(384);
        expect(result.translate).toEqual([998.4, 520.8]);
    });

    it('cover-crops a taller export and preserves the view-center offset', () => {
        const result = createExportViewport(
            { width: 1200, height: 600, scale: 250, rotate: [10, 20, 0], translate: [570, 330] },
            1200,
            1200
        );
        expect(result.scale).toBe(500);
        expect(result.translate).toEqual([540, 660]);
    });
});

function plate(id: string, overrides: Partial<TectonicPlate> = {}): TectonicPlate {
    const birth = [{ id: `${id}-birth`, points: [[0, 0], [1, 0], [1, 1]], closed: true }];
    return {
        id, name: id, type: 'continental', color: '#fff', zIndex: 0,
        birthTime: 0, deathTime: null, visible: true, locked: false, center: [0, 0],
        polygons: birth, features: [], initialPolygons: birth, initialFeatures: [],
        motionSegments: [{ time: 0, eulerPole: { position: [0, 90], rate: 1, visible: false } }],
        geometryStages: [{ time: 0, polygons: birth, features: [] }],
        events: [], connectedRiftIds: [], ...overrides,
    } as unknown as TectonicPlate;
}

describe('createWorldFromCurrentTime', () => {
    it('uses the visible geometry as the new birth snapshot and preserves only future changes', () => {
        const oldPolygons: Polygon[] = [{ id: 'old', points: [[0, 0], [1, 0], [1, 1]], closed: true }];
        const visiblePolygons: Polygon[] = [{ id: 'visible', points: [[20, 0], [21, 0], [21, 1]], closed: true }];
        const futurePolygons: Polygon[] = [{ id: 'future', points: [[30, 0], [31, 0], [31, 1]], closed: true }];
        const source = plate('a', {
            polygons: visiblePolygons,
            initialPolygons: oldPolygons,
            motionSegments: [
                { time: 0, eulerPole: { position: [0, 90], rate: 1, visible: false } },
                { time: 80, eulerPole: { position: [0, 90], rate: 2, visible: false } },
                { time: 120, eulerPole: { position: [0, 90], rate: 3, visible: false } },
            ],
            geometryStages: [
                { time: 0, polygons: oldPolygons, features: [] },
                { time: 120, polygons: futurePolygons, features: [] },
            ],
        });
        const world = { currentTime: 100, plates: [source], labels: [], riftAxes: [], tripleJunctions: [] } as unknown as WorldState;

        const result = createWorldFromCurrentTime(world);
        const exported = result.plates[0];

        expect(exported.birthTime).toBe(0);
        expect(exported.initialPolygons).toBe(visiblePolygons);
        expect(exported.geometryStages.map(stage => stage.time)).toEqual([0, 20]);
        expect(exported.geometryStages[0].polygons).toBe(visiblePolygons);
        expect(exported.motionSegments.map(segment => [segment.time, segment.eulerPole.rate])).toEqual([[0, 2], [20, 3]]);
    });

    it('rebases active link windows and removes expired or dangling links', () => {
        const parent = plate('parent');
        const linked = plate('linked', { linkedToPlateId: 'parent', linkTime: 40, unlinkTime: 140 });
        const expired = plate('expired', { linkedToPlateId: 'parent', linkTime: 20, unlinkTime: 90 });
        const dangling = plate('dangling', { linkedToPlateId: 'dead-parent', linkTime: 20 });
        const deadParent = plate('dead-parent', { deathTime: 90 });
        const world = {
            currentTime: 100,
            plates: [parent, linked, expired, dangling, deadParent],
            labels: [], riftAxes: [], tripleJunctions: [],
        } as unknown as WorldState;

        const result = createWorldFromCurrentTime(world);

        expect(result.plates.find(candidate => candidate.id === 'linked')).toEqual(expect.objectContaining({
            linkedToPlateId: 'parent', linkTime: 0, unlinkTime: 40,
        }));
        expect(result.plates.find(candidate => candidate.id === 'expired')?.linkedToPlateId).toBeUndefined();
        expect(result.plates.find(candidate => candidate.id === 'dangling')?.linkedToPlateId).toBeUndefined();
        expect(result.plates.some(candidate => candidate.id === 'dead-parent')).toBe(false);
    });
});
