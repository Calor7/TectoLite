import {
    Coordinate,
    TectonicPlate,
    WorldState,
    createDefaultGeometryStage,
    createDefaultMotionSegments,
    createDefaultWorldState,
    generateId,
    RiftAxis
} from '../types';

function platePolygon(index: number, total: number): Coordinate[] {
    const cols = Math.ceil(Math.sqrt(total * 2));
    const rows = Math.ceil(total / cols);
    const col = index % cols;
    const row = Math.floor(index / cols);
    const lonStep = 340 / cols;
    const latStep = 140 / rows;
    const lon = -170 + col * lonStep;
    const lat = -70 + row * latStep;
    const padLon = lonStep * 0.08;
    const padLat = latStep * 0.08;
    return [
        [lon + padLon, lat + padLat],
        [lon + lonStep - padLon, lat + padLat],
        [lon + lonStep - padLon, lat + latStep - padLat],
        [lon + padLon, lat + latStep - padLat]
    ];
}

function centroid(points: Coordinate[]): Coordinate {
    const sums = points.reduce(
        (acc, point) => {
            acc.lon += point[0];
            acc.lat += point[1];
            return acc;
        },
        { lon: 0, lat: 0 }
    );
    return [sums.lon / points.length, sums.lat / points.length];
}

function makePlate(index: number, total: number): TectonicPlate {
    const points = platePolygon(index, total);
    const polygon = { id: generateId(), points, closed: true };
    const birthTime = index % 5 === 0 ? 25 : 0;
    const baseRate = 0.25 + (index % 7) * 0.08;
    const poleLon = ((index * 47) % 360) - 180;
    const poleLat = -60 + ((index * 31) % 120);
    const motionSegments = createDefaultMotionSegments(birthTime);
    motionSegments[0] = {
        time: birthTime,
        eulerPole: { position: [poleLon, poleLat], rate: index % 2 === 0 ? baseRate : -baseRate, visible: false }
    };
    motionSegments.push({
        time: 100,
        eulerPole: { position: [poleLon * -0.5, poleLat * 0.75], rate: baseRate * 1.4, visible: false }
    });
    motionSegments.push({
        time: 200,
        eulerPole: { position: [poleLon * 0.35, poleLat * -0.5], rate: baseRate * 0.7, visible: false }
    });

    return {
        id: `bench_plate_${index}`,
        name: `Benchmark Plate ${index + 1}`,
        color: `hsl(${(index * 37) % 360}, 56%, 48%)`,
        polygonType: index % 4 === 0 ? 'oceanic_plate' : 'continental_plate',
        motionSegments,
        geometryStages: createDefaultGeometryStage(birthTime, [polygon]),
        polygons: [polygon],
        features: [],
        center: centroid(points),
        birthTime,
        deathTime: null,
        initialPolygons: [polygon],
        initialFeatures: [],
        connectedRiftIds: [],
        events: [],
        visible: true,
        locked: false
    };
}

function makeRiftAxes(plates: TectonicPlate[], scale: number): RiftAxis[] {
    const axes: RiftAxis[] = [];
    const axisCount = 4 * scale;
    for (let index = 0; index < axisCount; index++) {
        const a = plates[index * 2];
        const b = plates[index * 2 + 1];
        if (!a || !b) continue;
        const birthTime = 0;
        const lon = -150 + index * (300 / Math.max(1, axisCount - 1));
        const polyline: Coordinate[] = [
            [lon - 8, -50],
            [lon - 2, -20],
            [lon + 4, 10],
            [lon + 8, 45]
        ];
        axes.push({
            id: `bench_rift_${index}`,
            groupId: `bench_group_${index}`,
            plateIdA: a.id,
            plateIdB: b.id,
            birthPolyline: polyline,
            birthTime,
            state: 'active',
            isochrons: Array.from({ length: 9 }, (_, step) => ({
                time: step * 25,
                polyline: polyline.map(([x, y]) => [x + step * 0.7, y])
            }))
        });
    }
    return axes;
}

export function makeBenchmarkWorld(scale: number): WorldState {
    const world = createDefaultWorldState();
    const plateCount = 30 * scale;
    const plates = Array.from({ length: plateCount }, (_, index) => makePlate(index, plateCount));

    for (let index = 1; index < plates.length; index += 6) {
        plates[index] = {
            ...plates[index],
            linkedToPlateId: plates[index - 1].id,
            linkTime: 50,
            relativeEulerPole: { position: [25 + index, 65 - index * 0.5], rate: 0.12 }
        };
    }

    return {
        ...world,
        plates,
        currentTime: 200,
        timeScale: 8,
        projection: 'orthographic',
        showGrid: true,
        riftAxes: makeRiftAxes(plates, scale),
        tripleJunctions: [],
        globalOptions: {
            ...world.globalOptions,
            timelineMaxTime: 250,
            oceanCrustStrategy: 'continuous',
            enableBoundaryVisualization: true,
            oceanicGenerationInterval: 25,
            showLinks: false,
            showVelocityArrows: false,
            showPredictionFlowlines: false,
            showHoverTooltips: false
        }
    };
}
