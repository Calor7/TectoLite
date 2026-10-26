import { describe, expect, it } from 'vitest';
import { deriveMidOceanRidges, oceanDepthAtAge, ridgeAxialRelief } from './MidOceanRidgeSystem';
import type { Coordinate, Polygon, RiftAxis, TectonicPlate } from '../types';

const OPTIONS = { planetRadius: 6371, oceanicGenerationInterval: 5 };

function plate(id: string, west: number, east: number, rate: number, pole: Coordinate = [0, 90]): TectonicPlate {
    const shape: Polygon = {
        id: `${id}-shape`,
        points: [[west, -10], [east, -10], [east, 10], [west, 10]],
        closed: true,
    };
    return {
        id, name: id, color: '#4a9c6d', polygonType: 'continental_plate',
        birthTime: 0, deathTime: null, visible: true, locked: false,
        center: [(west + east) / 2, 0], polygons: [shape], initialPolygons: [shape],
        features: [], initialFeatures: [],
        motionSegments: [{ time: 0, eulerPole: { position: pole, rate } }],
        geometryStages: [{ time: 0, polygons: [shape], features: [] }],
        events: [], connectedRiftIds: [],
    };
}

function fixture(rateA = -0.2, rateB = 0.2): { plates: TectonicPlate[]; axis: RiftAxis } {
    return {
        plates: [plate('A', -10, 0, rateA), plate('B', 0, 10, rateB)],
        axis: {
            id: 'ridge', groupId: 'split', plateIdA: 'A', plateIdB: 'B',
            birthPolyline: [[0, -10], [0, 10]], birthTime: 0, state: 'active', isochrons: [],
        },
    };
}

function crust(items: TectonicPlate[]): TectonicPlate[] {
    return items.filter(item => item.midOceanRidge?.kind === 'crust');
}

function allPoints(items: TectonicPlate[]): Coordinate[] {
    return items.flatMap(item => item.polygons.flatMap(shape => shape.points));
}

function finiteGeometry(items: TectonicPlate[]): void {
    expect(allPoints(items).length).toBeGreaterThan(0);
    for (const [longitude, latitude] of allPoints(items)) {
        expect(Number.isFinite(longitude)).toBe(true);
        expect(Number.isFinite(latitude)).toBe(true);
        expect(longitude).toBeGreaterThanOrEqual(-180);
        expect(longitude).toBeLessThanOrEqual(180);
        expect(latitude).toBeGreaterThanOrEqual(-90);
        expect(latitude).toBeLessThanOrEqual(90);
    }
}

describe('mid-ocean ridge kinematics', () => {
    it('creates paired oceanic crust and an axis in a symmetric opening', () => {
        const { plates, axis } = fixture();
        const result = deriveMidOceanRidges(plates, [axis], 20, OPTIONS);
        const strips = crust(result);
        const axes = result.filter(item => item.midOceanRidge?.kind === 'axis');

        expect(strips.length).toBeGreaterThan(0);
        expect(axes.length).toBeGreaterThan(0);
        expect(strips.every(item => item.isOceanic && item.polygonType === 'oceanic_plate')).toBe(true);
        expect(strips.every(item => item.riftAxisId === axis.id)).toBe(true);
        expect(strips.some(item => item.linkedToPlateId === 'A')).toBe(true);
        expect(strips.some(item => item.linkedToPlateId === 'B')).toBe(true);

        const west = allPoints(strips.filter(item => item.linkedToPlateId === 'A'));
        const east = allPoints(strips.filter(item => item.linkedToPlateId === 'B'));
        expect(west.length).toBe(east.length);
        for (const [longitude, latitude] of west) {
            expect(east.some(point => Math.abs(point[0] + longitude) < 1e-6 && Math.abs(point[1] - latitude) < 1e-6)).toBe(true);
        }
        for (const point of allPoints(axes)) expect(point[0]).toBeCloseTo(0, 6);
        finiteGeometry(result);
    });

    it('moves the axis at the half-stage motion when only one flank moves', () => {
        const { plates, axis } = fixture(0, 0.4);
        const result = deriveMidOceanRidges(plates, [axis], 20, OPTIONS);
        const axes = result.filter(item => item.midOceanRidge?.kind === 'axis');

        expect(axes.length).toBeGreaterThan(0);
        for (const point of allPoints(axes)) expect(point[0]).toBeCloseTo(4, 5);
        expect(crust(result).length).toBeGreaterThan(0);
    });

    it.each([
        { name: 'stationary flanks', rateA: 0, rateB: 0 },
        { name: 'converging flanks', rateA: 0.2, rateB: -0.2 },
    ])('does not create oceanic crust for $name', ({ rateA, rateB }) => {
        const { plates, axis } = fixture(rateA, rateB);
        expect(crust(deriveMidOceanRidges(plates, [axis], 20, OPTIONS))).toEqual([]);
    });

    it('does not turn relative motion parallel to a ridge into spreading', () => {
        const { plates, axis } = fixture();
        // At longitude zero, rotation about the equatorial east pole runs north/south.
        plates[0].motionSegments[0].eulerPole = { position: [90, 0], rate: -0.2 };
        plates[1].motionSegments[0].eulerPole = { position: [90, 0], rate: 0.2 };

        expect(crust(deriveMidOceanRidges(plates, [axis], 20, OPTIONS))).toEqual([]);
    });

    it('keeps generated geometry finite at the longitude seam and near a pole', () => {
        const seam = fixture();
        seam.plates = [plate('A', 170, 180, -0.2), plate('B', -180, -170, 0.2)];
        seam.axis.birthPolyline = [[180, -10], [180, 10]];
        const polar = fixture();
        polar.axis.birthPolyline = [[0, 80], [0, 89.9]];
        for (const item of polar.plates) {
            for (const shape of item.initialPolygons) {
                shape.points = shape.points.map(([longitude, latitude]) => [longitude, latitude < 0 ? 80 : 89.9]);
            }
        }
        for (const { plates, axis } of [seam, polar]) {
            finiteGeometry(deriveMidOceanRidges(plates, [axis], 20, OPTIONS));
        }
    });

    it('scales physical spreading speed with the planet radius', () => {
        const { plates, axis } = fixture();
        const earth = deriveMidOceanRidges(plates, [axis], 20, OPTIONS);
        const smaller = deriveMidOceanRidges(plates, [axis], 20, { ...OPTIONS, planetRadius: OPTIONS.planetRadius / 2 });
        const earthSpeed = earth.find(item => item.midOceanRidge?.kind === 'axis')!.midOceanRidge!.fullSpreadingRateCmYr;
        const smallerSpeed = smaller.find(item => item.midOceanRidge?.kind === 'axis')!.midOceanRidge!.fullSpreadingRateCmYr;

        expect(earthSpeed).toBeGreaterThan(0);
        expect(smallerSpeed).toBeCloseTo(earthSpeed / 2, 6);
    });
});

describe('ridge lifecycle and source history', () => {
    it('does not generate future crust before the ridge birth time', () => {
        const { plates, axis } = fixture();
        axis.birthTime = 10;
        expect(deriveMidOceanRidges(plates, [axis], 9, OPTIONS)).toEqual([]);
        expect(crust(deriveMidOceanRidges(plates, [axis], 10, OPTIONS))).toEqual([]);
        expect(crust(deriveMidOceanRidges(plates, [axis], 15, OPTIONS)).length).toBeGreaterThan(0);
    });

    it.each(['frozen', 'dead'] as const)('retains existing %s ridge crust without accreting beyond its cutoff', state => {
        const { plates, axis } = fixture();
        axis.state = state;
        if (state === 'frozen') axis.frozenTime = 10;
        else axis.deathTime = 10;
        const before = crust(deriveMidOceanRidges(plates, [axis], 10, OPTIONS));
        const after = crust(deriveMidOceanRidges(plates, [axis], 30, OPTIONS));

        expect(before.length).toBeGreaterThan(0);
        expect(after.map(item => item.id)).toEqual(before.map(item => item.id));
        expect(after.every(item => item.midOceanRidge!.youngestBirthTime <= 10)).toBe(true);
        expect(after.every(item => item.birthTime <= 10)).toBe(true);
        expect(allPoints(after)).not.toEqual(allPoints(before));
    });

    it('records truthful oldest/youngest birth bounds for each oceanic band', () => {
        const { plates, axis } = fixture();
        const result = crust(deriveMidOceanRidges(plates, [axis], 17, OPTIONS));
        expect(result.length).toBeGreaterThan(0);
        for (const item of result) {
            const metadata = item.midOceanRidge!;
            expect(metadata.oldestBirthTime).toBeGreaterThanOrEqual(axis.birthTime);
            expect(metadata.youngestBirthTime).toBeLessThanOrEqual(17);
            expect(metadata.youngestBirthTime).toBeGreaterThan(metadata.oldestBirthTime);
            expect(item.birthTime).toBe(metadata.oldestBirthTime);
            expect(item.elevation).toBeLessThan(0);
        }
    });

    it('derives from motion history even when stored isochrons are stale or absent', () => {
        const { plates, axis } = fixture();
        const original = structuredClone({ plates, axis });
        const first = deriveMidOceanRidges(plates, [axis], 20, OPTIONS);
        expect({ plates, axis }).toEqual(original);
        axis.isochrons = [{ time: 5, polyline: [[120, -40], [120, 40]] }];
        expect(deriveMidOceanRidges(plates, [axis], 20, OPTIONS)).toEqual(first);

        plates[1].motionSegments.push({ time: 10, eulerPole: { position: [0, 90], rate: 0.6 } });
        const edited = deriveMidOceanRidges(plates, [axis], 20, OPTIONS);
        expect(allPoints(edited)).not.toEqual(allPoints(first));
        expect(deriveMidOceanRidges(plates, [axis], 20, OPTIONS)).toEqual(edited);
    });

    it('produces the same geometry and IDs after arbitrary time visits', () => {
        const { plates, axis } = fixture();
        const reference = deriveMidOceanRidges(plates, [axis], 20, OPTIONS);
        deriveMidOceanRidges(plates, [axis], 50, OPTIONS);
        deriveMidOceanRidges(plates, [axis], 3, OPTIONS);

        expect(deriveMidOceanRidges(plates, [axis], 20, OPTIONS)).toEqual(reference);
        expect(new Set(reference.map(item => item.id)).size).toBe(reference.length);
    });

    it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1e-12])('bounds malformed or extreme generation interval %s', interval => {
        const { plates, axis } = fixture();
        const result = deriveMidOceanRidges(plates, [axis], 20, { ...OPTIONS, oceanicGenerationInterval: interval });

        expect(result.length).toBeLessThan(10_000);
        expect(crust(result).length).toBeGreaterThan(0);
        finiteGeometry(result);
    });
});

describe('ridge depth profiles', () => {
    it('deepens cooling ocean crust with age', () => {
        const ages = [0, 1, 10, 40, 80, 160];
        const depths = ages.map(oceanDepthAtAge);
        expect(depths.every(depth => Number.isFinite(depth) && depth > 0)).toBe(true);
        for (let i = 1; i < depths.length; i++) expect(depths[i]).toBeGreaterThanOrEqual(depths[i - 1]);
        expect(depths[0]).toBeGreaterThanOrEqual(2000);
        expect(depths[0]).toBeLessThanOrEqual(3500);
        expect(depths.at(-1)!).toBeLessThanOrEqual(7000);
    });

    it('makes a slow ridge axial valley and a fast ridge axial high', () => {
        expect(ridgeAxialRelief(0, 2)).toBeLessThan(0);
        expect(ridgeAxialRelief(0, 12)).toBeGreaterThan(0);
        expect(Math.abs(ridgeAxialRelief(500, 2))).toBeLessThan(Math.abs(ridgeAxialRelief(0, 2)));
        expect(Math.abs(ridgeAxialRelief(500, 12))).toBeLessThan(Math.abs(ridgeAxialRelief(0, 12)));
        expect(ridgeAxialRelief(-10, 12)).toBeCloseTo(ridgeAxialRelief(10, 12), 8);
    });
});



describe('ridge history after a flank is rerouted to a descendant', () => {
    it('reconstructs the historical axis and crust from its pre-birth ancestor', () => {
        const { plates, axis } = fixture();
        const parentA = plates[0];
        parentA.id = 'parentA';
        parentA.name = 'parentA';
        parentA.deathTime = 10;
        const childA = plate('childA', -12, -2, 1.7);
        childA.birthTime = 10;
        childA.parentPlateId = parentA.id;
        childA.motionSegments[0].time = 10;
        childA.geometryStages[0].time = 10;
        axis.plateIdA = childA.id;
        const source = [parentA, childA, plates[1]];
        const sourceBefore = structuredClone(source);
        const historical = deriveMidOceanRidges(source, [axis], 5, OPTIONS);
        const originalReference = deriveMidOceanRidges([parentA, plates[1]], [{ ...axis, plateIdA: parentA.id }], 5, OPTIONS);
        const historicalAxis = historical.filter(item => item.midOceanRidge?.kind === 'axis');

        expect(historicalAxis.length).toBeGreaterThan(0);
        expect(crust(historical).length).toBeGreaterThan(0);
        expect(allPoints(historical)).toEqual(allPoints(originalReference));
        expect(historical.map(item => item.midOceanRidge)).toEqual(originalReference.map(item => item.midOceanRidge));
        expect(source).toEqual(sourceBefore);
    });

    it.each([undefined, 'missing-parent'])('rejects pre-birth accretion without a valid ancestor (%s)', parentPlateId => {
        const { plates, axis } = fixture();
        plates[0].birthTime = 10;
        plates[0].parentPlateId = parentPlateId;
        plates[0].motionSegments[0].time = 10;
        plates[0].geometryStages[0].time = 10;

        expect(crust(deriveMidOceanRidges(plates, [axis], 5, OPTIONS))).toEqual([]);
    });
});


describe('ridge sampling and staggered junctions', () => {
    it.each([256, 257, 1000])('accepts and bounds a valid authored ridge with %s vertices', count => {
        const { plates, axis } = fixture();
        axis.birthPolyline = Array.from({ length: count }, (_, i) => [0, -10 + i * 20 / (count - 1)]);
        const source = structuredClone(axis.birthPolyline);
        const result = deriveMidOceanRidges(plates, [axis], 20, OPTIONS);
        const currentAxis = result.filter(item => item.midOceanRidge?.kind === 'axis');

        expect(crust(result).length).toBeGreaterThan(0);
        expect(currentAxis.length).toBeGreaterThan(0);
        expect(allPoints(currentAxis).length).toBeLessThanOrEqual(512);
        const points = allPoints(currentAxis);
        expect(points[0][1]).toBeCloseTo(-10, 6);
        expect(points.at(-1)![1]).toBeCloseTo(10, 6);
        expect(axis.birthPolyline).toEqual(source);
        finiteGeometry(result);
    });

    it('joins an older ridge endpoint to two later-born ridge endpoints', () => {
        const { plates } = fixture();
        const shape: Polygon = { id: 'C-shape', points: [[-10, 0], [10, 0], [0, 15]], closed: true };
        const c = plate('C', -10, 10, -0.4, [90, 0]);
        c.center = [0, 5];
        c.polygons = [shape];
        c.initialPolygons = [shape];
        c.geometryStages = [{ time: 0, polygons: [shape], features: [] }];
        plates.push(c);
        const axis = (id: string, a: string, b: string, birthTime: number, birthPolyline: Coordinate[]): RiftAxis => ({
            id, groupId: id, plateIdA: a, plateIdB: b, birthTime, birthPolyline, state: 'active', isochrons: [],
        });
        const axes = [
            axis('AB', 'A', 'B', 0, [[0, -10], [0, 0]]),
            axis('AC', 'A', 'C', 10, [[0, 0], [-10, 10]]),
            axis('BC', 'B', 'C', 10, [[0, 0], [10, 10]]),
        ];
        const result = deriveMidOceanRidges(plates, axes, 20, OPTIONS);
        const ab = result.filter(item => item.riftAxisId === 'AB' && item.midOceanRidge?.kind === 'axis');
        const ac = result.filter(item => item.riftAxisId === 'AC' && item.midOceanRidge?.kind === 'axis');
        const bc = result.filter(item => item.riftAxisId === 'BC' && item.midOceanRidge?.kind === 'axis');
        expect(ab.length).toBeGreaterThan(0);
        expect(ac.length).toBeGreaterThan(0);
        expect(bc.length).toBeGreaterThan(0);
        const junctionAB = allPoints(ab).at(-1)!;
        const junctionAC = allPoints(ac)[0];
        const junctionBC = allPoints(bc)[0];
        for (const endpoint of [junctionAC, junctionBC]) {
            expect(endpoint[0]).toBeCloseTo(junctionAB[0], 6);
            expect(endpoint[1]).toBeCloseTo(junctionAB[1], 6);
        }
        finiteGeometry(result);
    });
});


describe('local spreading direction on fragmented plates', () => {
    it('keeps nearby ridge geometry and rates when distant fragments reverse whole-plate centroids', () => {
        const { plates, axis } = fixture();
        const baseline = deriveMidOceanRidges(plates, [axis], 20, OPTIONS);
        const fragments = [
            [[115, 120], [125, 130], [135, 140]],
            [[-120, -115], [-130, -125], [-140, -135]],
        ];
        for (let side = 0; side < plates.length; side++) {
            const current = plates[side];
            const shapes = [
                ...current.initialPolygons,
                ...fragments[side].map(([west, east], index) => plate(`${current.id}-remote-${index}`, west, east, 0).polygons[0]),
            ];
            current.polygons = shapes;
            current.initialPolygons = shapes;
            current.geometryStages[0].polygons = shapes;
        }
        const fragmented = deriveMidOceanRidges(plates, [axis], 20, OPTIONS);

        expect(crust(fragmented).length).toBeGreaterThan(0);
        expect(allPoints(fragmented)).toEqual(allPoints(baseline));
        expect(fragmented.map(item => item.midOceanRidge)).toEqual(baseline.map(item => item.midOceanRidge));
    });
});

