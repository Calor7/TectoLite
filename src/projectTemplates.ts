import {
    createDefaultGeometryStage,
    createDefaultMotionSegments,
    createDefaultWorldState,
    type Coordinate,
    type Polygon,
    type TectonicPlate,
    type WorldState
} from './types';

export interface ProjectTemplate {
    id: string;
    name: string;
    description: string;
    createWorld(): Promise<WorldState>;
}

type GeoJsonGeometry =
    | { type: 'Polygon'; coordinates: number[][][] }
    | { type: 'MultiPolygon'; coordinates: number[][][][] };

interface EarthFeatureCollection {
    features: Array<{
        id?: string;
        geometry: GeoJsonGeometry;
    }>;
}

type RegionId = 'north-america' | 'south-america' | 'africa' | 'eurasia' | 'india' | 'australia' | 'antarctica';

interface RegionDefinition {
    id: RegionId;
    name: string;
    color: string;
    pangaea: { translate: Coordinate; rotate: number };
    modernMotion: { pole: Coordinate; rate: number };
    pangaeaMotion: { pole: Coordinate; rate: number };
}

// Coastline geometry is the lightweight Natural Earth-derived 1:110m dataset
// distributed by johan/world.geo.json. Pangaea placement is an intentionally
// simplified authoring reconstruction informed by Seton et al. (2012), not a
// replacement for a GPlates topology/rotation model.
let earthPromise: Promise<EarthFeatureCollection> | null = null;

function loadEarth(): Promise<EarthFeatureCollection> {
    earthPromise ??= import('./assets/earth-land-110m.json?raw')
        .then(module => JSON.parse(module.default) as EarthFeatureCollection);
    return earthPromise;
}

const REGIONS: RegionDefinition[] = [
    { id: 'north-america', name: 'North America', color: '#4a9c6d', pangaea: { translate: [70, -10], rotate: -8 }, modernMotion: { pole: [-78, 50], rate: 0.20 }, pangaeaMotion: { pole: [-20, 65], rate: -0.08 } },
    { id: 'south-america', name: 'South America', color: '#6b8c3d', pangaea: { translate: [35, 15], rotate: 18 }, modernMotion: { pole: [-56, -60], rate: 0.15 }, pangaeaMotion: { pole: [-15, -55], rate: -0.07 } },
    { id: 'africa', name: 'Africa', color: '#8b6914', pangaea: { translate: [-20, -5], rotate: -4 }, modernMotion: { pole: [-50, 50], rate: 0.12 }, pangaeaMotion: { pole: [-35, 45], rate: 0.04 } },
    { id: 'eurasia', name: 'Eurasia', color: '#3d6b8c', pangaea: { translate: [-40, -10], rotate: 8 }, modernMotion: { pole: [-100, 55], rate: 0.10 }, pangaeaMotion: { pole: [-80, 55], rate: 0.03 } },
    { id: 'india', name: 'India', color: '#9c4a6d', pangaea: { translate: [-62, -25], rotate: -18 }, modernMotion: { pole: [10, 20], rate: 0.55 }, pangaeaMotion: { pole: [5, 15], rate: 0.12 } },
    { id: 'australia', name: 'Australia', color: '#8c3d6b', pangaea: { translate: [-105, 0], rotate: -25 }, modernMotion: { pole: [32, 33], rate: 0.65 }, pangaeaMotion: { pole: [25, 25], rate: 0.08 } },
    { id: 'antarctica', name: 'Antarctica', color: '#708090', pangaea: { translate: [10, 35], rotate: 5 }, modernMotion: { pole: [-120, 55], rate: 0.08 }, pangaeaMotion: { pole: [-110, 60], rate: 0.03 } }
];

const INDIA_IDS = new Set(['IND', 'PAK', 'BGD', 'LKA', 'NPL', 'BTN']);

function outerRings(geometry: GeoJsonGeometry): Coordinate[][] {
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    return polygons
        .map(polygon => polygon[0].map(([lon, lat]) => [lon, lat] as Coordinate))
        .filter(ring => ring.length >= 3);
}

function ringCenter(ring: Coordinate[]): Coordinate {
    return [
        ring.reduce((sum, point) => sum + point[0], 0) / ring.length,
        ring.reduce((sum, point) => sum + point[1], 0) / ring.length
    ];
}

function classifyRegion(countryId: string | undefined, center: Coordinate): RegionId {
    const [lon, lat] = center;
    if (countryId === 'ATA' || lat < -60) return 'antarctica';
    if (INDIA_IDS.has(countryId ?? '')) return 'india';
    if (lon < -30) return lat < 10 ? 'south-america' : 'north-america';
    if (lat < 0 && lon > 95) return 'australia';
    if (lon < 55 && lat < 37) return 'africa';
    return 'eurasia';
}

function normalizeLongitude(lon: number): number {
    let normalized = lon;
    while (normalized > 180) normalized -= 360;
    while (normalized < -180) normalized += 360;
    return normalized;
}

function transformRing(ring: Coordinate[], center: Coordinate, transform: RegionDefinition['pangaea']): Coordinate[] {
    const angle = transform.rotate * Math.PI / 180;
    return ring.map(([lon, lat]) => {
        const x = lon - center[0];
        const y = lat - center[1];
        return [
            normalizeLongitude(center[0] + x * Math.cos(angle) - y * Math.sin(angle) + transform.translate[0]),
            Math.max(-88, Math.min(88, center[1] + x * Math.sin(angle) + y * Math.cos(angle) + transform.translate[1]))
        ];
    });
}

function regionRings(earth: EarthFeatureCollection): Map<RegionId, Coordinate[][]> {
    const regions = new Map<RegionId, Coordinate[][]>(REGIONS.map(region => [region.id, []]));
    for (const feature of earth.features) {
        for (const ring of outerRings(feature.geometry)) {
            const region = classifyRegion(feature.id, ringCenter(ring));
            regions.get(region)?.push(ring);
        }
    }
    return regions;
}

function makePlate(region: RegionDefinition, rings: Coordinate[][], pangaea: boolean): TectonicPlate {
    const regionCenter = ringCenter(rings.flat());
    const transformed = pangaea ? rings.map(ring => transformRing(ring, regionCenter, region.pangaea)) : rings;
    const polygons: Polygon[] = transformed.map((points, index) => ({
        id: `${pangaea ? 'pangaea' : 'modern'}-${region.id}-${index}`,
        points,
        closed: true,
        polygonType: 'continental_plate'
    }));
    const allPoints = transformed.flat();
    const center = ringCenter(allPoints);
    const motion = pangaea ? region.pangaeaMotion : region.modernMotion;
    const motionSegments = createDefaultMotionSegments(0);
    motionSegments[0] = {
        time: 0,
        eulerPole: { position: motion.pole, rate: motion.rate, visible: false }
    };

    return {
        id: `${pangaea ? 'pangaea' : 'modern'}-${region.id}`,
        name: region.name,
        color: region.color,
        polygonType: 'continental_plate',
        motionSegments,
        geometryStages: createDefaultGeometryStage(0, polygons),
        polygons,
        features: [],
        center,
        birthTime: 0,
        deathTime: null,
        initialPolygons: polygons,
        initialFeatures: [],
        connectedRiftIds: [],
        events: [],
        visible: true,
        locked: false
    };
}

async function createEarthWorld(pangaea: boolean): Promise<WorldState> {
    const world = createDefaultWorldState();
    const rings = regionRings(await loadEarth());
    return {
        ...world,
        plates: REGIONS.map(region => makePlate(region, rings.get(region.id) ?? [], pangaea)),
        projection: 'orthographic',
        currentTime: 0,
        globalOptions: {
            ...world.globalOptions,
            timelineMaxTime: pangaea ? 200 : 50
        }
    };
}

export const PROJECT_TEMPLATES: ProjectTemplate[] = [
    {
        id: 'modern-earth',
        name: 'Modern Earth',
        description: 'Recognizable Natural Earth coastlines grouped into seven editable continental regions.',
        createWorld: () => createEarthWorld(false)
    },
    {
        id: 'pangaea-200ma',
        name: 'Pangaea (~200 Ma)',
        description: 'Approximate Early Jurassic supercontinent arrangement for authoring and experimentation.',
        createWorld: () => createEarthWorld(true)
    }
];
