import { describe, expect, it } from 'vitest';
import { defaultLineTypeDefaults, type TectonicPlate } from '../types';
import { plateRenderOrder, resolveFeatureTimelineOpacity, resolveLineRenderStyle, sortPlatesForRendering } from './renderStyles';

const plate = (overrides: Partial<TectonicPlate>): TectonicPlate => ({
    id: 'plate', name: 'Plate', color: '#123456', polygons: [], features: [],
    motionSegments: [], geometryStages: [], center: [0, 0], birthTime: 0,
    deathTime: null, initialPolygons: [], initialFeatures: [], connectedRiftIds: [],
    events: [], visible: true, locked: false, ...overrides,
});

describe('canvas render styles', () => {
    it('places default lines above default continental landmasses', () => {
        const land = plate({ id: 'land', polygonType: 'continental_plate' });
        const line = plate({ id: 'line', type: 'rift' });
        expect(plateRenderOrder(line)).toBeGreaterThan(plateRenderOrder(land));
        expect(sortPlatesForRendering([line, land]).map(item => item.id)).toEqual(['land', 'line']);
    });

    it('keeps a customized line color instead of replacing it with its type default', () => {
        const defaults = defaultLineTypeDefaults();
        const line = plate({ type: 'rift', lineType: 'convergent', color: '#abcdef', lineColorCustomized: true });
        expect(resolveLineRenderStyle(line, defaults)).toEqual({ color: '#abcdef', dash: defaults.convergent.dash });
    });

    it('hides out-of-lifetime features unless preview mode is enabled', () => {
        const feature = { generatedAt: 20, deathTime: 40 };
        expect(resolveFeatureTimelineOpacity(feature, 10, false)).toBeNull();
        expect(resolveFeatureTimelineOpacity(feature, 10, true)).toBe(0.28);
        expect(resolveFeatureTimelineOpacity(feature, 30, false)).toBe(1);
        expect(resolveFeatureTimelineOpacity(feature, 40, false)).toBeNull();
        expect(resolveFeatureTimelineOpacity(feature, 40, true)).toBe(0.28);
    });
});
