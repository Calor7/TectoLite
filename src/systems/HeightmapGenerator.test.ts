import { afterEach, describe, expect, it, vi } from 'vitest';
import { geoArea, geoDistance } from 'd3-geo';
import { createDefaultWorldState, type AppState, type Coordinate, type ProjectionType, type TectonicPlate } from '../types';
import { HeightmapGenerator, oceanDepthToGray, plateHeightmapGray, ridgeGeographicBuffer } from './HeightmapGenerator';

function plate(overrides: Partial<TectonicPlate> = {}): TectonicPlate {
    const polygons = [{ id: 'polygon', points: [[0, 0], [10, 0], [10, 10], [0, 10]] as Coordinate[], closed: true }];
    return {
        id: 'plate', name: 'Plate', color: '#fff', visible: true, locked: false,
        birthTime: 0, deathTime: null, center: [5, 5], polygons, features: [],
        initialPolygons: polygons, initialFeatures: [], motionSegments: [], geometryStages: [],
        connectedRiftIds: [], events: [], ...overrides,
    };
}

async function render(plates: TectonicPlate[], projection: ProjectionType = 'equirectangular') {
    const fills: { shade: string; points: [number, number][] }[] = [];
    let points: [number, number][] = [];
    let longestSegment = 0;
    let previous: [number, number] | undefined;
    const context = {
        fillStyle: '',
        beginPath() { points = []; previous = undefined; },
        moveTo(x: number, y: number) { points.push([x, y]); previous = [x, y]; },
        lineTo(x: number, y: number) {
            if (previous) longestSegment = Math.max(longestSegment, Math.hypot(x - previous[0], y - previous[1]));
            points.push([x, y]); previous = [x, y];
        },
        closePath() {}, arc() {},
        fillRect() {},
        fill() { fills.push({ shade: this.fillStyle, points: [...points] }); },
    };
    vi.stubGlobal('document', {
        createElement: () => ({ width: 0, height: 0, getContext: () => context, toDataURL: () => 'data:image/png;base64,heightmap' }),
    });
    const state: AppState = {
        world: { ...createDefaultWorldState(), currentTime: 20, plates },
        viewport: { width: 720, height: 360, scale: 100, rotate: [0, 0, 0], translate: [360, 180] },
        activeTool: 'select', activeFeatureType: 'mountain', drawMode: 'polygon',
        activeLineType: 'divergent', activePolygonType: 'generic',
    };
    const before = structuredClone(state);
    const result = await HeightmapGenerator.generate(state, { width: 720, height: 360, projection, smooth: false });
    expect(result).toContain('data:image/png');
    expect(state).toEqual(before);
    return { fills, longestSegment };
}

afterEach(() => vi.unstubAllGlobals());

describe('heightmap ocean surfaces', () => {
    it('keeps ocean shades below the continental base and clamps depth to the export range', () => {
        expect(oceanDepthToGray(6000)).toBe(10);
        expect(oceanDepthToGray(3000)).toBe(55);
        expect(oceanDepthToGray(0)).toBe(100);
        expect(oceanDepthToGray(-1000)).toBe(100);
        expect(oceanDepthToGray(10000)).toBe(10);
        expect(oceanDepthToGray(Number.NaN)).toBe(10);
        expect(plateHeightmapGray(plate(), 0)).toBe(120);
        expect(plateHeightmapGray(plate({ polygonType: 'oceanic_plate' }), 0)).toBeLessThan(100);
    });

    it('uses the mean birth date for generated crust and deepens it as the timeline advances', () => {
        const crust = plate({ midOceanRidge: {
            kind: 'crust', fullSpreadingRateCmYr: 3, oldestBirthTime: 5, youngestBirthTime: 15,
        } });
        expect(plateHeightmapGray(crust, 10)).toBe(61); // zero-age crust at 2600 m
        expect(plateHeightmapGray(crust, 30)).toBeLessThan(plateHeightmapGray(crust, 15));
        expect(plateHeightmapGray(crust, 10)).toBe(plateHeightmapGray(plate({
            isOceanic: true, age: 10,
        }), 10));
    });

    it('does not fill an open geological line as a continent', async () => {
        const result = await render([plate({ polygons: [{ id: 'open', closed: false, points: [[0, 0], [10, 10], [0, 10]] }] })]);
        expect(result.fills).toEqual([]);
    });

    it('does not add spreading relief to transform lines', async () => {
        const result = await render([plate({
            polygons: [{ id: 'transform', closed: false, points: [[0, 0], [10, 10]] }],
            midOceanRidge: { kind: 'transform', fullSpreadingRateCmYr: 3, oldestBirthTime: 0, youngestBirthTime: 20 },
        })]);
        expect(result.fills).toEqual([]);
    });

    it('renders young ocean below continental surfaces without changing the project', async () => {
        const result = await render([
            plate({ id: 'land' }),
            plate({ id: 'ocean', isOceanic: true, age: 20 }),
        ]);
        expect(result.fills.map(fill => fill.shade)).toEqual(['rgb(61, 61, 61)', 'rgb(120, 120, 120)']);
    });
});

describe('ridge relief geography', () => {
    const axis = (rate: number, points: Coordinate[]): TectonicPlate => plate({
        polygons: [{ id: 'axis', closed: false, points }],
        midOceanRidge: { kind: 'axis', fullSpreadingRateCmYr: rate, oldestBirthTime: 0, youngestBirthTime: 20 },
    });

    it('places a dark central valley inside slow ridge shoulders and a crest at fast ridges', async () => {
        const slow = await render([axis(2, [[0, -10], [0, 10]])]);
        const fast = await render([axis(6, [[0, -10], [0, 10]])]);
        const shade = (fill: { shade: string }) => Number(fill.shade.match(/rgb\((\d+)/)?.[1]);
        expect(slow.fills.every(fill => fill.points.length > 0 && shade(fill) < 100)).toBe(true);
        expect(shade(slow.fills.at(-1)!)).toBeLessThan(Math.max(...slow.fills.map(shade)));
        expect(shade(fast.fills.at(-1)!)).toBe(Math.max(...fast.fills.map(shade)));
    });

    it('clips relief on the hidden hemisphere instead of drawing wide pixel strokes across the globe', async () => {
        const result = await render([axis(3, [[140, -10], [160, 10]])], 'orthographic');
        expect(result.fills.every(fill => fill.points.length === 0)).toBe(true);
    });

    it('keeps antimeridian ridge buffers small and projection paths close to their respective map edges', async () => {
        const points: Coordinate[] = [[179, 0], [-179, 0]];
        const buffer = ridgeGeographicBuffer(points, 12);
        expect(geoArea(buffer)).toBeLessThan(0.01);
        const firstVertex = buffer.coordinates[0][0][0];
        const corner: Coordinate = [firstVertex[0], firstVertex[1]];
        expect(geoDistance(points[0], corner) * 6371).toBeCloseTo(12, 5);
        const result = await render([axis(3, points)]);
        expect(result.longestSegment).toBeLessThan(50);
        expect(result.fills.flatMap(fill => fill.points).every(([x]) => x < 10 || x > 710)).toBe(true);
    });
});
