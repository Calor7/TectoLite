import { createDefaultWorldState, type Coordinate, type Feature, type GeologicalScenario, type GeometryStage, type MotionSegment, type Polygon, type TectonicPlate, type WorldState, } from '../types';
import { calculateSphericalCentroid, cross, dot, latLonToVector, normalize, quatConjugate, quatMultiply, rotateCoordByQuat, vectorToLatLon, type Quaternion, } from '../utils/sphericalMath';
export { scenarioAge, branchScenario } from './ScenarioTimeline';
interface Part {
    id: string;
    name: string;
    plateId: number;
    color: string;
    rings: Coordinate[][];
    rotations: Array<{
        age: number;
        q: number[];
    }>;
}
interface Source {
    parts: Part[];
    cratons: Array<{
        name: string;
        center: Coordinate;
        rings: Coordinate[][];
    }>;
}
interface Life {
    id: string;
    name: string;
    parts: string[];
    birth: number;
    death?: number;
    parents?: string[];
}
const identity: Quaternion = { w: 1, x: 0, y: 0, z: 0 };
const qArray = ([w, x, y, z]: number[]): Quaternion => ({ w, x, y, z });
function slerp(a: Quaternion, b: Quaternion, t: number): Quaternion {
    let d = a.w * b.w + a.x * b.x + a.y * b.y + a.z * b.z;
    if (d < 0) {
        b = { w: -b.w, x: -b.x, y: -b.y, z: -b.z };
        d = -d;
    }
    const angle = Math.acos(Math.min(1, d));
    const k = angle < 1e-6 ? 1 - t : Math.sin((1 - t) * angle) / Math.sin(angle);
    const l = angle < 1e-6 ? t : Math.sin(t * angle) / Math.sin(angle);
    const q = { w: a.w * k + b.w * l, x: a.x * k + b.x * l, y: a.y * k + b.y * l, z: a.z * k + b.z * l };
    const n = Math.hypot(q.w, q.x, q.y, q.z);
    return { w: q.w / n, x: q.x / n, y: q.y / n, z: q.z / n };
}
function between(a: Coordinate, b: Coordinate): Quaternion {
    const av = latLonToVector(a), bv = latLonToVector(b), axis = cross(av, bv);
    const q = { w: 1 + dot(av, bv), x: axis.x, y: axis.y, z: axis.z };
    const n = Math.hypot(q.w, q.x, q.y, q.z);
    if (n < 1e-8)
        throw new Error('Ambiguous antipodal scenario path');
    return { w: q.w / n, x: q.x / n, y: q.y / n, z: q.z / n };
}
function segment(q0: Quaternion, q1: Quaternion, time: number, dt: number): MotionSegment {
    let q = quatMultiply(q1, quatConjugate(q0));
    if (q.w < 0)
        q = { w: -q.w, x: -q.x, y: -q.y, z: -q.z };
    const n = Math.hypot(q.x, q.y, q.z);
    return { time, eulerPole: { position: n < 1e-10 ? [0, 90] : vectorToLatLon(normalize({ x: q.x, y: q.y, z: q.z })), rate: n < 1e-10 ? 0 : 2 * Math.atan2(n, q.w) * 180 / Math.PI / dt, visible: false } };
}
const historicalLives: Life[] = [
    { id: 'laurasia', name: 'Laurasia', parts: ['north-america', 'greenland', 'europe', 'asia'], birth: 0, death: 20 },
    { id: 'gondwana', name: 'Gondwana', parts: ['africa', 'somalia', 'south-america', 'india', 'arabia', 'australia', 'antarctica', 'madagascar'], birth: 0, death: 40 },
    { id: 'northern-america', name: 'North America & Greenland', parts: ['north-america', 'greenland'], birth: 20, death: 140, parents: ['laurasia'] },
    { id: 'eurasia', name: 'Eurasia', parts: ['europe', 'asia'], birth: 20, death: 150, parents: ['laurasia'] },
    { id: 'west-gondwana', name: 'West Gondwana', parts: ['africa', 'somalia', 'south-america', 'arabia'], birth: 40, death: 90, parents: ['gondwana'] },
    { id: 'east-gondwana', name: 'East Gondwana', parts: ['india', 'australia', 'antarctica', 'madagascar'], birth: 40, death: 70, parents: ['gondwana'] },
    { id: 'india-madagascar', name: 'India & Madagascar', parts: ['india', 'madagascar'], birth: 70, death: 115, parents: ['east-gondwana'] },
    { id: 'australia-antarctica', name: 'Australia & Antarctica', parts: ['australia', 'antarctica'], birth: 70, death: 155, parents: ['east-gondwana'] },
    { id: 'africa-arabia', name: 'Africa & Arabia', parts: ['africa', 'somalia', 'arabia'], birth: 90, death: 175, parents: ['west-gondwana'] },
    { id: 'south-america', name: 'South America', parts: ['south-america'], birth: 90, parents: ['west-gondwana'] },
    { id: 'india', name: 'India', parts: ['india'], birth: 115, death: 150, parents: ['india-madagascar'] },
    { id: 'madagascar', name: 'Madagascar', parts: ['madagascar'], birth: 115, parents: ['india-madagascar'] },
    { id: 'north-america', name: 'North America', parts: ['north-america'], birth: 140, parents: ['northern-america'] },
    { id: 'greenland', name: 'Greenland', parts: ['greenland'], birth: 140, parents: ['northern-america'] },
    { id: 'eurasia-india', name: 'Eurasia–India collision', parts: ['europe', 'asia', 'india'], birth: 150, parents: ['eurasia', 'india'] },
    { id: 'australia', name: 'Australia', parts: ['australia'], birth: 155, parents: ['australia-antarctica'] },
    { id: 'antarctica', name: 'Antarctica', parts: ['antarctica'], birth: 155, parents: ['australia-antarctica'] },
    { id: 'africa', name: 'Africa', parts: ['africa', 'somalia'], birth: 175, parents: ['africa-arabia'] },
    { id: 'arabia', name: 'Arabia', parts: ['arabia'], birth: 175, parents: ['africa-arabia'] },
];
const futureTargets: Record<string, Coordinate> = {
    africa: [120, -10], somalia: [140, -20], europe: [95, 45], asia: [135, 35], india: [140, 5], arabia: [110, 10],
    'north-america': [-175, 40], 'south-america': [-175, -10], antarctica: [145, -48], australia: [155, -30], greenland: [175, 65], madagascar: [135, -35],
};
function futureLives(parts: Part[]): Life[] {
    const ids = parts.map(p => p.id);
    return [
        { id: 'africa-whole', name: 'Africa', parts: ['africa', 'somalia'], birth: 0, death: 25 },
        ...parts.filter(p => !['africa', 'somalia'].includes(p.id)).map(p => ({ id: p.id, name: p.name, parts: [p.id], birth: 0, death: 300 })),
        { id: 'africa', name: 'Africa — western block', parts: ['africa'], birth: 25, death: 300, parents: ['africa-whole'] },
        { id: 'somalia', name: 'East African rift fragment', parts: ['somalia'], birth: 25, death: 300, parents: ['africa-whole'] },
        { id: 'amasia', name: 'Amasia — illustrative assembly', parts: ids, birth: 300, death: 380, parents: ids },
        { id: 'amasia-west', name: 'Amasia — western successor', parts: ids.filter(id => !['north-america', 'south-america', 'greenland'].includes(id)), birth: 380, parents: ['amasia'] },
        { id: 'amasia-east', name: 'Amasia — eastern successor', parts: ['north-america', 'south-america', 'greenland'], birth: 380, parents: ['amasia'] },
    ];
}
const sources = [
    { title: 'GPlates reconstruction models', url: 'https://gwsdoc.gplates.org/models/' },
    { title: 'India–Asia collision (USGS)', url: 'https://pubs.usgs.gov/gip/dynamic/himalaya.html' },
    { title: 'Pacific-closure Amasia model (Huang et al., 2022)', url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC9743166/' },
];
function metadata(kind: GeologicalScenario['kind']): GeologicalScenario {
    const past = kind === 'reconstruction';
    const chapters = past ? [
        [0, 'Pangaea at 200 Ma', 'Laurasia and Gondwana contain the future continents. Their coastlines and internal deformation are curated teaching geometry.'],
        [20, 'Opening the Atlantic', 'Laurasia splits into North America–Greenland and Eurasia. Select a successor to inspect its parent and motion history.'],
        [40, 'Gondwana breaks apart', 'Western and eastern Gondwana become separate editable entities. The split is a simplified chapter boundary in a prolonged breakup.'],
        [90, 'South Atlantic separation', 'South America separates from Africa. Different finite-rotation segments carry the landmasses toward their present positions.'],
        [115, 'India travels north', 'India separates from Madagascar. Shape stages illustrate changing continental margins.'],
        [150, 'India meets Eurasia', 'A native fusion creates the collision entity; timed mountain features illustrate Himalayan growth. The geological collision was a prolonged process.'],
        [155, 'Southern ocean gateways', 'Australia and Antarctica become separate entities. These broad chapter dates simplify a longer sequence.'],
        [175, 'Arabia separates', 'Arabia leaves the African composite. The recent volcanic island is an illustrative emergence example.'],
        [200, 'Modern world — your starting point', 'Pause here, select any landmass, and continue authoring. The endpoint restores the curated modern outlines; minor islands and detailed paleocoastlines are omitted.'],
    ] : [
        [0, 'Earth today', 'An illustrative future scenario, not a forecast. Representative landmasses are editable; the later paths and event dates are authored.'],
        [25, 'An East African ocean — possibility', 'Africa splits into western and eastern successors. A growing rift and volcanic islands demonstrate new-land and shape-stage tools.'],
        [100, 'Migration and collision margins', 'Continents change direction while volcanic and mountain features emerge. These exact locations and timings are illustrative.'],
        [200, 'Pacific closure — model-inspired', 'The Amasia study motivates the broad Pacific-closure route. This app’s coast map and trajectories are not outputs from that geodynamic model.'],
        [300, 'Amasia assembly — illustrative', 'The ancestors end and one editable composite is born through native fusion. Continued shape changes illustrate compression.'],
        [380, 'A new breakup — authored extension', 'The supercontinent splits into two successors. This deliberately speculative continuation showcases authoring beyond the researched assembly concept.'],
        [500, 'Five hundred million years — continue here', 'An authored endpoint, not an accepted prediction. Save or edit this world, or jump back to any earlier chapter and change its history.'],
    ];
    return { id: past ? 'pangaea-to-present' : 'earth-next-500myr', title: past ? 'Pangaea → modern Earth' : 'Earth → Amasia and beyond', kind, duration: past ? 200 : 500, startAge: past ? 200 : 0,
        summary: past ? 'Curated reconstruction: representative GPlates rotations, simplified modern outlines, and authored breakup, coast deformation and emergence. Not a complete paleogeographic model.' : 'Illustrative future: Pacific-closure Amasia is model-inspired. Exact trajectories, new land, fusion dates and the later breakup are authored, not a consensus forecast.',
        sources: past ? sources.slice(0, 2) : [sources[2]], chapters: chapters.map(([time, title, description]) => ({ time: Number(time), title: String(title), description: String(description) })) };
}
/** Builds ordinary editable entities. No scenario machinery is needed during simulation. */
export async function createGeologicalScenario(kind: GeologicalScenario['kind'], details: boolean): Promise<WorldState> {
    const raw = (await import('../assets/geological-scenario-data.json?raw')).default;
    const data = JSON.parse(raw) as Source;
    const world = createDefaultWorldState(), scenario = metadata(kind), past = kind === 'reconstruction';
    const lives = past ? historicalLives : futureLives(data.parts);
    const parts = new Map(data.parts.map(p => [p.id, p]));
    const centers = new Map(data.parts.map(p => [p.id, calculateSphericalCentroid(p.rings.flat())]));
    function orientation(part: Part, time: number): Quaternion {
        if (past) {
            const age = Math.max(0, Math.min(200, 200 - time)), index = Math.min(39, Math.floor(age / 5)), a = part.rotations[index], b = part.rotations[index + 1];
            return slerp(qArray(a.q), qArray(b.q), (age - a.age) / 5);
        }
        const origin = centers.get(part.id)!, target = futureTargets[part.id];
        const assembled = between(origin, target);
        if (time <= 300)
            return slerp(identity, assembled, Math.pow(time / 300, 0.85));
        if (time <= 380)
            return assembled;
        const east = ['north-america', 'south-america', 'greenland'].includes(part.id);
        const destination: Coordinate = [target[0] + (east ? 45 : -35), Math.max(-80, Math.min(80, target[1] + (east ? -10 : 5)))];
        return slerp(assembled, between(origin, destination), (time - 380) / 120);
    }
    function deform(part: Part, p: Coordinate, time: number): Coordinate {
        const c = centers.get(part.id)!;
        const amount = past ? 0.035 * Math.sin(Math.PI * time / 200) : 0.09 * Math.sin(Math.PI * Math.min(time, 380) / 380);
        const lon = ((p[0] - c[0] + 540) % 360) - 180;
        const deformed: Coordinate = [((c[0] + lon * (1 - amount) + 540) % 360) - 180, Math.max(-89.8, Math.min(89.8, c[1] + (p[1] - c[1]) * (1 + amount * 0.35)))];
        return rotateCoordByQuat(deformed, orientation(part, time));
    }
    const zero = (time: number): MotionSegment => ({ time, eulerPole: { position: [0, 90], rate: 0, visible: false } });
    const plateId = (life: Life, layer: string) => `scenario-${scenario.id}-${life.id}-${layer}`;
    const plates: TectonicPlate[] = [];
    for (const life of lives) {
        const end = life.death ?? scenario.duration;
        const step = past ? 10 : 25;
        const times = Array.from(new Set([life.birth, end, ...Array.from({ length: Math.floor(scenario.duration / step) + 1 }, (_, i) => i * step).filter(t => t > life.birth && t < end)])).sort((a, b) => a - b);
        // Single landmass: true piecewise Euler motion. Composite: internal pieces
        // can deform independently via absolute shape stages until the next split.
        const single = life.parts.length === 1 ? parts.get(life.parts[0])! : null;
        const motion = single ? times.slice(0, -1).map((t, i) => segment(orientation(single, t), orientation(single, times[i + 1]), t, times[i + 1] - t)) : [zero(life.birth)];
        motion.push(zero(end));
        const makePolygons = (time: number, layer: string): Polygon[] => life.parts.flatMap(id => {
            const part = parts.get(id)!;
            const rings = layer === 'cratons' ? data.cratons.filter(c => {
                const nearest = data.parts.reduce((a, b) => {
                    const av = latLonToVector(centers.get(a.id)!), bv = latLonToVector(centers.get(b.id)!), v = latLonToVector(c.center);
                    return dot(av, v) > dot(bv, v) ? a : b;
                });
                return nearest.id === id;
            }).flatMap(c => c.rings) : part.rings;
            return rings.map((ring, index) => ({ id: `${id}-${layer}-${index}`, points: ring.map(p => deform(part, p, time).map(n => Math.round(n * 1e6) / 1e6) as Coordinate), closed: true, polygonType: layer === 'cratons' ? 'craton' : layer === 'plates' ? 'continental_plate' : 'generic' }));
        });
        const layers = details ? ['covers', 'plates', 'cratons'] : ['covers'];
        for (const layer of layers) {
            const id = plateId(life, layer);
            const stages: GeometryStage[] = times.map(time => ({ time, polygons: makePolygons(time, layer), features: [], interpolation: 'spherical' }));
            if (!stages[0].polygons.length)
                continue;
            const isCarrier = details && layer === 'plates';
            plates.push({ id, name: `${layer === 'covers' ? 'Cover' : layer === 'plates' ? 'Plate' : 'Cratons'} — ${life.name}`, description: `${scenario.summary}\nRepresentative regions: ${life.parts.map(p => `${parts.get(p)!.name} (rotation ${parts.get(p)!.plateId})`).join(', ')}. Shape stages are editable.`,
                groupId: `scenario-${layer}`, color: layer === 'cratons' ? '#ddc98b' : parts.get(life.parts[0])!.color, polygonType: layer === 'cratons' ? 'craton' : layer === 'plates' ? 'continental_plate' : 'generic',
                birthTime: life.birth, deathTime: life.death ?? null, parentPlateIds: life.parents?.map(p => plateId(lives.find(l => l.id === p)!, layer)),
                parentPlateId: life.parents?.length === 1 ? plateId(lives.find(l => l.id === life.parents![0])!, layer) : undefined,
                motionSegments: details && layer !== 'plates' ? [zero(life.birth)] : motion.map(m => ({ ...m, eulerPole: { ...m.eulerPole, position: [...m.eulerPole.position] } })),
                ...(details && layer !== 'plates' ? { linkedToPlateId: plateId(life, 'plates'), linkTime: life.birth, relativeEulerPole: { position: [0, 90] as Coordinate, rate: 0 } } : {}),
                geometryStages: stages, polygons: stages[0].polygons, initialPolygons: stages[0].polygons, features: [], initialFeatures: [], center: calculateSphericalCentroid(stages[0].polygons.flatMap(p => p.points)),
                connectedRiftIds: [], events: [], visible: true, locked: false, zIndex: layer === 'covers' ? 20 : layer === 'cratons' ? 30 : 10,
                hideLinkMarker: !isCarrier, riftGenerationMode: 'never' });
        }
    }
    // Native lineage events live on the ending parents and remain editable in History.
    const existingIds = new Set(plates.map(p => p.id));
    for (const p of plates)
        if (p.parentPlateIds)
            p.parentPlateIds = p.parentPlateIds.filter(id => existingIds.has(id));
    for (const parent of plates) {
        const children = plates.filter(p => p.parentPlateIds?.includes(parent.id));
        if (!children.length)
            continue;
        const fusion = children.length === 1 && (children[0].parentPlateIds?.length ?? 0) > 1;
        parent.events.push({ id: `${parent.id}-transition`, time: parent.deathTime!, type: fusion ? 'fusion' : 'split', data: { childPlateIds: children.map(p => p.id) } });
    }
    // Preauthored emergence avoids frame-dependent automatic generation.
    const islandBirth = past ? 180 : 60, islandEnd = scenario.duration;
    const islandCenter: Coordinate = past ? [-20, 64] : [155, 5];
    const ring = (radius: number): Coordinate[] => Array.from({ length: 17 }, (_, i) => [islandCenter[0] + Math.cos(i * Math.PI / 8) * radius, islandCenter[1] + Math.sin(i * Math.PI / 8) * radius * 0.65]);
    const islandPoly = (radius: number): Polygon[] => [{ id: 'scenario-volcanic-island-shape', points: ring(radius), closed: true }];
    const volcano: Feature = { id: 'scenario-volcano', name: 'Illustrative volcanic emergence', type: 'volcano', position: islandCenter, originalPosition: islandCenter, generatedAt: islandBirth, rotation: 0, scale: 1, properties: {} };
    plates.push({ id: 'scenario-emergent-island', name: 'Volcanic island — emergence example', description: 'Illustrative exposed land, not a prediction of crust production or sea level.', groupId: 'scenario-processes', color: '#cc8b58', polygonType: 'island', birthTime: islandBirth, deathTime: null, motionSegments: [zero(islandBirth)], geometryStages: [{ time: islandBirth, polygons: islandPoly(0.12), features: [volcano], interpolation: 'spherical' }, { time: Math.min(islandBirth + 20, islandEnd), polygons: islandPoly(past ? 1.7 : 3), features: [volcano] }], polygons: islandPoly(0.12), initialPolygons: islandPoly(0.12), features: [volcano], initialFeatures: [volcano], center: islandCenter, connectedRiftIds: [], events: [], visible: true, locked: false, zIndex: 25 });
    for (const divergent of [true, false]) {
        const birth = past ? (divergent ? 40 : 150) : (divergent ? 25 : 150);
        const end = past ? 200 : 300;
        const region = parts.get(divergent ? 'africa' : 'asia')!;
        const points: Coordinate[] = past ? (divergent ? [[-30, 35], [-28, 10], [-15, -30]] : [[70, 30], [85, 29], [100, 25]]) : (divergent ? [[34, -25], [36, -5], [42, 12]] : [[150, 50], [155, 25], [150, 0]]);
        const id = `scenario-${divergent ? 'ridge' : 'trench'}`;
        const times = Array.from(new Set([birth, end, ...Array.from({ length: Math.ceil(end / 25) }, (_, i) => i * 25).filter(t => t > birth && t < end)])).sort((a, b) => a - b);
        const stages: GeometryStage[] = times.map(time => ({ time, polygons: [{ id: `${id}-line`, points: points.map(p => deform(region, p, time)), closed: false }], features: [], interpolation: 'spherical' }));
        plates.push({ id, name: `${divergent ? 'Divergent ridge' : 'Convergent margin'} — schematic`, description: 'Authored process marker for inspecting line types; this line is not an inferred full plate boundary.', groupId: 'scenario-processes', color: divergent ? '#2ecc71' : '#e74c3c', lineType: divergent ? 'divergent' : 'convergent', birthTime: birth, deathTime: past ? null : end, motionSegments: [zero(birth)], geometryStages: stages, polygons: stages[0].polygons, initialPolygons: stages[0].polygons, features: [], initialFeatures: [], center: points[1], connectedRiftIds: [], events: [], visible: true, locked: false, zIndex: 35, riftGenerationMode: 'never' });
    }
    // Mountain / rift / trench examples are ordinary time-aware feature history.
    for (const plate of plates.filter(p => p.groupId === 'scenario-covers')) {
        const mountain = past ? plate.name.includes('Eurasia–India') : plate.name.includes('Amasia');
        if (!mountain)
            continue;
        for (const stage of plate.geometryStages) {
            const center = calculateSphericalCentroid(stage.polygons.flatMap(p => p.points));
            stage.features = Array.from({ length: 5 }, (_, i) => ({ id: `${plate.id}-mountain-${i}`, name: past ? 'Himalayan growth — illustrative' : 'Collision range — illustrative', type: 'mountain' as const, position: past ? rotateCoordByQuat([74 + i * 4, 29 + Math.sin(i)], orientation(parts.get('india')!, stage.time)) : [center[0] + i * 2 - 4, Math.max(-85, Math.min(85, center[1] + 3))] as Coordinate, generatedAt: plate.birthTime, rotation: 0, scale: 0.7 + (stage.time - plate.birthTime) / Math.max(1, scenario.duration - plate.birthTime) * 0.6, properties: {} }));
        }
        plate.features = plate.geometryStages[0].features;
        plate.initialFeatures = plate.features;
    }
    return { ...world, plates, scenario, currentTime: 0, timeScale: past ? 5 : 10, projection: 'orthographic', showGrid: true, showFeatures: true, showFutureFeatures: false,
        entityGroups: [{ id: 'scenario-covers', name: 'Landmasses & their successors', collapsed: false }, ...(details ? [{ id: 'scenario-plates', name: 'Motion carriers — follows each lifecycle', collapsed: true }, { id: 'scenario-cratons', name: 'Cratons — representative attachments', collapsed: true }] : []), { id: 'scenario-processes', name: 'Geological process examples', collapsed: true }],
        globalOptions: { ...world.globalOptions, timelineMaxTime: scenario.duration, oceanCrustStrategy: 'off', showLinks: false } };
}
