import {
    createDefaultGeometryStage,
    createDefaultMotionSegments,
    createDefaultWorldState,
    generateId,
    type Coordinate,
    type EntityGroup,
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

interface GPlatesPlate {
    plateId: number;
    name: string;
    color: string;
    center: Coordinate;
    rings: Coordinate[][];
    motion: { pole: Coordinate; rate: number };
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
            'gplates-modern-overview-covers.json': () => import('./assets/gplates-modern-overview-covers.json?raw').then(m => m.default),
            'gplates-modern-overview-plates.json': () => import('./assets/gplates-modern-overview-plates.json?raw').then(m => m.default),
            'gplates-modern-overview-cratons.json': () => import('./assets/gplates-modern-overview-cratons.json?raw').then(m => m.default),
            'gplates-pangaea-overview-covers.json': () => import('./assets/gplates-pangaea-overview-covers.json?raw').then(m => m.default),
            'gplates-pangaea-overview-plates.json': () => import('./assets/gplates-pangaea-overview-plates.json?raw').then(m => m.default),
            'gplates-pangaea-overview-cratons.json': () => import('./assets/gplates-pangaea-overview-cratons.json?raw').then(m => m.default),
        };
        const loader = loaders[filename];
        if (!loader) throw new Error(`Unknown GPlates data file: ${filename}`);
        promise = loader().then(raw => JSON.parse(raw) as GPlatesData);
        dataCache.set(filename, promise);
    }
    return promise;
}

// ── Plate construction ────────────────────────────────────────────────

function makePlate(data: GPlatesPlate): TectonicPlate {
    // Use generateId for guaranteed unique plate IDs.
    const plateId = generateId();
    const polygons: Polygon[] = data.rings.map((points, index) => ({
        id: `${plateId}-${index}`,
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

    return {
        id: plateId,
        name: data.name,
        color: data.color,
        polygonType: 'continental_plate',
        motionSegments,
        geometryStages: createDefaultGeometryStage(0, polygons),
        polygons,
        features: [],
        center: data.center,
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

// ── Template world creation ──────────────────────────────────────────

function makeCurationCover(data: GPlatesPlate, index: number): TectonicPlate {
    const plate = makePlate(data);
    plate.name = `Cover — ${data.name}`;
    plate.polygonType = 'generic';
    plate.zIndex = 1000 + index;
    return plate;
}

function makeOverviewDetail(
    data: GPlatesPlate,
    layer: 'Plate' | 'Craton',
    index: number
): TectonicPlate {
    const plate = makePlate(data);
    plate.name = `${layer} — ${data.name}`;
    plate.polygonType = layer === 'Craton' ? 'craton' : 'continental_plate';
    plate.zIndex = (layer === 'Craton' ? 200 : 100) + index;
    return plate;
}

const majorModernCovers = new Set([
    'Cover — Africa', 'Cover — Europe', 'Cover — Asia',
    'Cover — North America', 'Cover — South America', 'Cover — Antarctica',
    'Cover — Australia', 'Cover — Greenland'
]);

function modernCoverRegion(plate: TectonicPlate): string {
    if (majorModernCovers.has(plate.name)) return 'modern-cover-major';
    const [longitude, latitude] = plate.center;
    const name = plate.name.toLowerCase();
    if (latitude < -60) return 'modern-cover-antarctica';
    if (/australia|tasmania|new zealand|new guinea|new caledonia|fiji|solomon|vanuatu|samoa|tonga/.test(name)
        || (longitude > 130 && latitude < 5)
        || (longitude < -130 && latitude < 5)) return 'modern-cover-oceania';
    if (longitude < -30) return latitude >= 10 ? 'modern-cover-north-america' : 'modern-cover-south-america';
    if (latitude >= 35 && longitude < 45) return 'modern-cover-europe';
    if (longitude >= 45 || (longitude >= 25 && latitude >= 30)) return 'modern-cover-asia';
    return 'modern-cover-africa';
}

function organizeTemplateEntities(
    plates: TectonicPlate[],
    key: 'modern' | 'pangaea',
    includeLayers: boolean
): { plates: TectonicPlate[]; entityGroups: EntityGroup[] } {
    const groups: EntityGroup[] = key === 'modern'
        ? [
            { id: 'modern-cover-major', name: 'Major continuous landmasses', collapsed: false },
            { id: 'modern-cover-africa', name: 'Africa & nearby islands', collapsed: true },
            { id: 'modern-cover-asia', name: 'Asia & nearby islands', collapsed: true },
            { id: 'modern-cover-europe', name: 'Europe & nearby islands', collapsed: true },
            { id: 'modern-cover-north-america', name: 'North America & Caribbean', collapsed: true },
            { id: 'modern-cover-south-america', name: 'South America & nearby islands', collapsed: true },
            { id: 'modern-cover-oceania', name: 'Oceania & Pacific islands', collapsed: true },
            { id: 'modern-cover-antarctica', name: 'Antarctica & subantarctic islands', collapsed: true },
            ...(includeLayers ? [
                { id: 'modern-plates', name: 'Continental plate regions', collapsed: true },
                { id: 'modern-cratons', name: 'Major cratons', collapsed: true }
            ] : [])
        ]
        : [
            { id: 'pangaea-main', name: 'Main Pangaea regions', collapsed: false },
            { id: 'pangaea-independent', name: 'Independent reconstructed landmasses', collapsed: true },
            ...(includeLayers ? [
                { id: 'pangaea-plates', name: 'Reconstructed continental plate regions', collapsed: true },
                { id: 'pangaea-cratons', name: 'Reconstructed major cratons', collapsed: true }
            ] : [])
        ];

    const groupedPlates = plates.map(plate => {
        let groupId: string;
        if (plate.name.startsWith('Plate — ')) groupId = `${key}-plates`;
        else if (plate.name.startsWith('Craton — ')) groupId = `${key}-cratons`;
        else if (key === 'pangaea') groupId = ['Cover — Laurasia', 'Cover — Gondwana'].includes(plate.name)
            ? 'pangaea-main'
            : 'pangaea-independent';
        else groupId = modernCoverRegion(plate);
        return { ...plate, groupId };
    });
    const usedGroupIds = new Set(groupedPlates.map(plate => plate.groupId));
    return {
        plates: groupedPlates,
        entityGroups: groups.filter(group => usedGroupIds.has(group.id))
    };
}

async function createCoverWorld(key: 'modern' | 'pangaea', timelineMax: number): Promise<WorldState> {
    const world = createDefaultWorldState();
    const covers = await loadGPlatesData(`gplates-${key}-overview-covers.json`);
    const organized = organizeTemplateEntities(
        covers.plates.map((plate, index) => makeCurationCover(plate, index)),
        key,
        false
    );
    return {
        ...world,
        ...organized,
        projection: 'orthographic',
        currentTime: 0,
        globalOptions: {
            ...world.globalOptions,
            timelineMaxTime: timelineMax
        }
    };
}

async function createOverviewWorld(key: 'modern' | 'pangaea', timelineMax: number): Promise<WorldState> {
    const world = createDefaultWorldState();
    const [covers, detailedPlates, detailedCratons] = await Promise.all([
        loadGPlatesData(`gplates-${key}-overview-covers.json`),
        loadGPlatesData(`gplates-${key}-overview-plates.json`),
        loadGPlatesData(`gplates-${key}-overview-cratons.json`)
    ]);

    const organized = organizeTemplateEntities([
            ...covers.plates.map((plate, index) => {
                const cover = makeCurationCover(plate, index);
                // Keep even a large detailed island set wholly below the
                // simplified plate (100+) and craton (200+) overlays.
                cover.zIndex = -1000 + index;
                return cover;
            }),
            ...detailedPlates.plates.map((plate, index) => makeOverviewDetail(plate, 'Plate', index)),
            ...detailedCratons.plates.map((plate, index) => makeOverviewDetail(plate, 'Craton', index))
        ], key, true);
    return {
        ...world,
        ...organized,
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
        id: 'modern-earth-curation-covers',
        name: 'Earth — Covers',
        description: 'High-detail present-day continuous landmasses and notable islands, each as one editable cover with approximate local plate motion.',
        createWorld: () => createCoverWorld('modern', 50)
    },
    {
        id: 'pangaea-200ma-covers',
        name: 'Pangaea — Covers',
        description: 'Continuous reconstructed landmasses at 200 Ma with editable coastlines and approximate local plate motion.',
        createWorld: () => createCoverWorld('pangaea', 200)
    },
    {
        id: 'modern-earth-overview',
        name: 'Earth — Covers + Plates',
        description: 'Detailed modern covers with simplified continental plates and major cratons. Oceanic plates are omitted.',
        createWorld: () => createOverviewWorld('modern', 50)
    },
    {
        id: 'pangaea-200ma-overview',
        name: 'Pangaea — Covers + Plates',
        description: 'Continuous 200 Ma covers with simplified reconstructed continental plates and major cratons. Oceanic plates are omitted.',
        createWorld: () => createOverviewWorld('pangaea', 200)
    }
];
