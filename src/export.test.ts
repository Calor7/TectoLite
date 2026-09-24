import { describe, expect, it } from 'vitest';
import { createExportViewport, createWorldFromCurrentTime, renderPNGExport, type PNGExportOptions } from './export';
import { createDefaultWorldState, type AppState, type Polygon, type TectonicPlate, type WorldState } from './types';

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

// Record drawing operations while exercising the real projection and export renderer.
function renderMap(options: Partial<PNGExportOptions> = {}, worldOverrides: Partial<WorldState> = {}) {
    const operations: { kind: string; color: string; alpha: number; width: number }[] = [];
    const saved: { fillStyle: string; strokeStyle: string; globalAlpha: number; lineWidth: number }[] = [];
    const ctx = {
        fillStyle: '', strokeStyle: '', globalAlpha: 1, lineWidth: 1,
        save() { saved.push({ fillStyle: this.fillStyle, strokeStyle: this.strokeStyle, globalAlpha: this.globalAlpha, lineWidth: this.lineWidth }); },
        restore() { Object.assign(this, saved.pop()); },
        beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, arc() {}, roundRect() {},
        translate() {}, rotate() {}, setLineDash() {}, clearRect() {},
        measureText() { return { width: 40 }; },
        fillText() { operations.push({ kind: 'text', color: this.fillStyle, alpha: this.globalAlpha, width: 0 }); },
        fill() { operations.push({ kind: 'fill', color: this.fillStyle, alpha: this.globalAlpha, width: 0 }); },
        fillRect() { operations.push({ kind: 'background', color: this.fillStyle, alpha: this.globalAlpha, width: 0 }); },
        stroke() { operations.push({ kind: 'stroke', color: this.strokeStyle, alpha: this.globalAlpha, width: this.lineWidth }); },
    };
    const state: AppState = {
        world: { ...createDefaultWorldState(), plates: [plate('land', { color: '#80aa60' })], ...worldOverrides },
        viewport: { width: 800, height: 400, scale: 120, rotate: [0, 0, 0], translate: [400, 200] },
        activeTool: 'select', activeFeatureType: 'mountain', drawMode: 'polygon',
        activeLineType: 'divergent', activePolygonType: 'generic',
    };
    const before = structuredClone(state);
    renderPNGExport(state, {
        projection: 'equirectangular', waterMode: 'transparent', plateColorMode: 'native',
        showGrid: false, ...options,
    }, { width: 1600, height: 800, getContext: () => ctx } as unknown as HTMLCanvasElement);
    expect(state).toEqual(before);
    return operations;
}

describe('PNG export layers', () => {
    it('draws a visible grid above opaque land by default and honors grid thickness', () => {
        const operations = renderMap({ showGrid: true, showBorders: false }, {
            globalOptions: { ...createDefaultWorldState().globalOptions, gridThickness: 3 },
        });
        expect(operations.map(op => op.kind)).toEqual(['fill', 'stroke']);
        expect(operations[1]).toMatchObject({ color: 'rgba(25, 40, 55, 0.4)', width: 6, alpha: 1 });
    });

    it('can put the grid below land or omit it entirely', () => {
        expect(renderMap({ showGrid: true, gridOnTop: false, showBorders: false }).map(op => op.kind))
            .toEqual(['stroke', 'fill']);
        expect(renderMap({ showGrid: false, showBorders: false }).map(op => op.kind)).toEqual(['fill']);
    });

    it('exports borderless fills without erasing independent geological lines', () => {
        const line = plate('line', { type: 'rift', polygons: [{ id: 'line-path', points: [[0, 0], [10, 10]], closed: false }] });
        const world = { plates: [plate('land'), line] };
        expect(renderMap({ showBorders: false }, world).map(op => op.kind)).toEqual(['fill', 'stroke']);
        expect(renderMap({ showBorders: false, includeLines: false }, world).map(op => op.kind)).toEqual(['fill']);
        expect(renderMap({ includeLines: false }, world).map(op => op.kind)).toEqual(['fill', 'stroke']);
    });

    it('leaves both ocean and globe background transparent for compositing', () => {
        expect(renderMap({ projection: 'orthographic', waterMode: 'transparent', showBorders: false }).map(op => op.kind))
            .toEqual(['fill']);
        expect(renderMap({ waterMode: 'white', showBorders: false })[0]).toMatchObject({ kind: 'background', color: '#ffffff' });
    });

    it('honors plate and group opacity without changing the editable project', () => {
        const operations = renderMap({ showBorders: false }, {
            plates: [plate('land', { groupId: 'group' })],
            entityGroups: [{ id: 'group', name: 'Group', opacity: 0.5 }],
            globalOptions: { ...createDefaultWorldState().globalOptions, plateOpacity: 0.6 },
        });
        expect(operations[0].alpha).toBeCloseTo(0.3);
    });

    it('exports only visible plates alive at the current time', () => {
        expect(renderMap({ showBorders: false }, {
            currentTime: 100,
            plates: [plate('active'), plate('hidden', { visible: false }), plate('future', { birthTime: 101 }), plate('dead', { deathTime: 100 })],
        }).map(op => op.kind)).toEqual(['fill']);
    });

    it('omits flag labels when requested', () => {
        const world: Partial<WorldState> = {
            labels: [{ id: 'label', title: 'Example', content: '', anchor: [0, 0], anchorTime: 0, offset: [10, 10], color: '#ff0', visible: true, locked: false, expanded: false }],
        };
        expect(renderMap({ includeLabels: true }, world).some(op => op.kind === 'text')).toBe(true);
        expect(renderMap({ includeLabels: false }, world).some(op => op.kind === 'text')).toBe(false);
    });
});
