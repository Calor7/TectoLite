import {
    createDefaultGeometryStage,
    createDefaultMotionSegments,
    createDefaultWorldState,
    generateId,
    type Coordinate,
    type Feature,
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

// ── Preprocessed GPlates data format ──────────────────────────────────

interface GPlatesRing {
    points: Coordinate[];
    name: string;
}

interface GPlatesPlate {
    plateId: number;
    name: string;
    color: string;
    center: Coordinate;
    rings: Coordinate[][];
    motion: { pole: Coordinate; rate: number };
    cratons: GPlatesRing[];
}

interface GPlatesData {
    time: number;
    plateCount: number;
    plates: GPlatesPlate[];
}

// ── Lazy-loaded preprocessed data ────────────────────────────────────

const dataCache = new Map<string, Promise<GPlatesData>>();

function loadGPlatesData(filename: string): Promise<GPlatesData> {
    let promise = dataCache.get(filename);
    if (!promise) {
        // Static imports for each file — avoids Vite dynamic-import warning
        const loaders: Record<string, () => Promise<string>> = {
            'gplates-modern.json': () => import('./assets/gplates-modern.json?raw').then(m => m.default),
            'gplates-pangaea.json': () => import('./assets/gplates-pangaea.json?raw').then(m => m.default),
            'gplates-modern-adv.json': () => import('./assets/gplates-modern-adv.json?raw').then(m => m.default),
            'gplates-pangaea-adv.json': () => import('./assets/gplates-pangaea-adv.json?raw').then(m => m.default),
        };
        const loader = loaders[filename];
        if (!loader) throw new Error(`Unknown GPlates data file: ${filename}`);
        promise = loader().then(raw => JSON.parse(raw) as GPlatesData);
        dataCache.set(filename, promise);
    }
    return promise;
}

// ── Plate construction ────────────────────────────────────────────────

function makePlate(data: GPlatesPlate, prefix: string, includeCratons: boolean): TectonicPlate {
    const polygons: Polygon[] = data.rings.map((points, index) => ({
        id: `${prefix}-${data.plateId}-${index}`,
        points,
        closed: true,
        polygonType: 'continental_plate' as const
    }));

    const motionSegments = createDefaultMotionSegments(0);
    motionSegments[0] = {
        time: 0,
        eulerPole: {
            position: data.motion.pole,
            rate: data.motion.rate,
            visible: false
        }
    };

    // Build craton features if advanced template
    const features: Feature[] = [];
    if (includeCratons) {
        for (const craton of data.cratons) {
            features.push({
                id: generateId(),
                type: 'poly_region',
                position: craton.points[0] ?? data.center,
                originalPosition: craton.points[0] ?? data.center,
                rotation: 0,
                scale: 1,
                properties: { name: craton.name, source: 'gplates-craton' },
                generatedAt: 0,
                polygon: craton.points,
                fillColor: data.color,
                name: craton.name
            });
        }
    }

    return {
        id: `${prefix}-${data.plateId}`,
        name: data.name,
        color: data.color,
        polygonType: 'continental_plate',
        motionSegments,
        geometryStages: createDefaultGeometryStage(0, polygons),
        polygons,
        features,
        center: data.center,
        birthTime: 0,
        deathTime: null,
        initialPolygons: polygons,
        initialFeatures: features,
        connectedRiftIds: [],
        events: [],
        visible: true,
        locked: false
    };
}

// ── Template world creation ──────────────────────────────────────────

async function createGPlatesWorld(dataFile: string, prefix: string, includeCratons: boolean, timelineMax: number): Promise<WorldState> {
    const world = createDefaultWorldState();
    const data = await loadGPlatesData(dataFile);

    return {
        ...world,
        plates: data.plates.map(plate => makePlate(plate, prefix, includeCratons)),
        projection: 'orthographic',
        currentTime: 0,
        globalOptions: {
            ...world.globalOptions,
            timelineMaxTime: timelineMax
        }
    };
}

// ── Template definitions ─────────────────────────────────────────────

export const PROJECT_TEMPLATES: ProjectTemplate[] = [
    {
        id: 'blank',
        name: 'Blank World',
        description: 'Start from scratch with an empty sphere.',
        createWorld: async () => createDefaultWorldState()
    },
    {
        id: 'modern-earth',
        name: 'Modern Earth',
        description: 'Present-day continents from GPlates (Müller et al. 2022), grouped into tectonic plates with real plate motion.',
        createWorld: () => createGPlatesWorld('gplates-modern.json', 'modern', false, 50)
    },
    {
        id: 'pangaea-200ma',
        name: 'Pangaea (~200 Ma)',
        description: 'Early Jurassic supercontinent reconstructed by GPlates from the EarthByte rotation model.',
        createWorld: () => createGPlatesWorld('gplates-pangaea.json', 'pangaea', false, 200)
    },
    {
        id: 'modern-earth-adv',
        name: 'Modern Earth (Advanced)',
        description: 'Present-day continents with cratons linked to their parent plates. Full geological detail.',
        createWorld: () => createGPlatesWorld('gplates-modern-adv.json', 'modern-adv', true, 50)
    },
    {
        id: 'pangaea-200ma-adv',
        name: 'Pangaea (Advanced)',
        description: '200 Ma supercontinent with cratons linked to their parent plates. Full geological detail.',
        createWorld: () => createGPlatesWorld('gplates-pangaea-adv.json', 'pangaea-adv', true, 200)
    }
];