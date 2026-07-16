/*
 * Build the simplified overview layers from the full local GPlates exports.
 *
 * The overview is intentionally curated rather than a blind "top N":
 * - landmasses are broad editor-friendly cover polygons;
 * - plates are continental regions above a physical-area threshold, plus an
 *   explicit must-include list for important smaller landmasses;
 * - cratons are grouped by geological name, not plate ID, so unrelated
 *   cratons that share a reconstruction plate are not amalgamated;
 * - every output item is exactly one coherent editable polygon.
 *
 * Run from the repository root:
 *   node scripts/generate-overview-templates.cjs
 */
const fs = require('fs');
const path = require('path');
const { geoArea, geoCentroid, geoContains, geoDistance } = require('d3-geo');
const polygonClipping = require('polygon-clipping');

const root = path.resolve(__dirname, '..');
const references = path.join(root, 'gplates_references');
const assets = path.join(root, 'src', 'assets');
const fullSphereArea = 4 * Math.PI;
const minimumPlateArea = 0.015;

const importantPlateIds = new Set([
    // Laurentia, Greenland, Amazonia, Baltica, Siberia
    101, 102, 201, 302, 401,
    // India, Arabia, Tarim, North China, South China
    501, 503, 5011, 580, 601, 602,
    // African continental regions and Madagascar
    701, 702, 712, 714, 715, 760, 77030,
    // Australia, Antarctica, Zealandia/New Zealand
    801, 802, 803, 804, 806, 813, 8011, 80121, 8021, 8030,
    // Important South American cratonic regions
    22054
]);

const plateNameOverrides = new Map([
    [201, 'Amazonia / South America'],
    [401, 'Siberia'],
    [501, 'Peninsular India'],
    [503, 'Arabia'],
    [701, 'Central Africa / Congo'],
    [702, 'Madagascar'],
    [714, 'Northwest Africa'],
    [715, 'North Africa'],
    [801, 'Australia'],
    [802, 'Antarctic Peninsula'],
    [803, 'East Antarctica'],
    [804, 'West Antarctica'],
    [806, 'North Island, New Zealand'],
    [813, 'South Island, New Zealand'],
    [8011, 'North Australia'],
    [80121, 'Transantarctic / Ross region'],
    [8021, 'East Antarctica interior'],
    [8030, 'West Antarctica interior'],
    [22054, 'São Francisco']
]);

const oceanicName = /\b(ocean|trench|ridge|arc|sea|shelf|plateau|rise|knoll|bank)\b|bismark basin|sandwich plate|\bfiji\b|\btonga\b|kermadec|new hebrides|norfolk|vitiaz/i;

const cratonDefinitions = [
    { name: 'Baltica', sources: ['Baltica'] },
    { name: 'East Antarctica', sources: ['East Antarctica'] },
    { name: 'Congo', sources: ['Northern Congo', 'Angola Craton'] },
    { name: 'Superior', sources: ['Superior (Hudson Bay E)'] },
    { name: 'Greenland', sources: ['Greenland'] },
    {
        name: 'Amazonia',
        sources: ['Central Amazonia', 'Rio Negro Juruena Province', 'Ventuari-Tapajos Province', 'Maroni-Itacaiunas Province']
    },
    { name: 'West African', sources: ['WAC', 'Southern WAC', 'Reguibat Inlier', 'Kénéma-Man'] },
    { name: 'Sahara', sources: ['Sahara (North Africa Plate)'] },
    { name: 'Al Kufrah', sources: ['Al Kufrah Craton'] },
    { name: 'Murzuq', sources: ['Murzuq Craton'] },
    { name: 'Chad', sources: ['Chad Craton'] },
    { name: 'Pilbara', officialName: 'Pilbara Craton' },
    { name: 'Yilgarn', officialName: 'Yilgarn Craton' },
    { name: 'Gawler', officialName: 'Gawler Craton' },
    { name: 'North Australia', sources: ['North Queensland', 'W Queensland'] },
    {
        name: 'Siberia',
        sources: ['Tungus Terrane', 'Anabar Shield', 'Magan Terrane', 'Central Aldan', 'Uchur']
    },
    { name: 'Slave', sources: ['Slave N', 'Slave E'] },
    { name: 'Rae', sources: ['Rae (Chesterfield)', 'Rae (Baffin)', 'Rae (Cumberland)', 'Rae (Repulse) (Baffin Island Plate)'] },
    { name: 'Hearne', sources: ['Hearne (covered)', 'Hearne Central', 'Hearne South'] },
    { name: 'Wyoming', sources: ['Wyoming'] },
    { name: 'São Francisco', sources: ['São Francisco', 'Sao Francisco'] },
    { name: 'Kaapvaal', sources: ['Kaapval'] },
    { name: 'Zimbabwe', sources: ['Zimbabwe Craton'] },
    {
        name: 'Tanzania',
        sources: ['Tanzania Craton', 'Tanzania Craton (Lake Victoria Block Plate)', 'Tanzania Craton (North Mozambique Plate)']
    },
    { name: 'Bangweulu', sources: ['Bangweulu Block'] },
    { name: 'Dharwar', sources: ['Dharwar Craton'] },
    { name: 'Singhbhum', sources: ['Singhbhum Craton'] },
    { name: 'Bundelkhand', sources: ['Bundlekhand Craton'] },
    { name: 'Bastar', sources: ['Bastar Craton'] },
    { name: 'North China', sources: ['North China', 'Eastern Block', 'Ordos Block'] },
    { name: 'Yangtze', sources: ['Yangtze'] },
    { name: 'Tarim', sources: ['Tarim'] },
    { name: 'Azania', sources: ['Azania (Somalia)'] },
    { name: 'Central Madagascar', sources: ['Central Madagascar', 'Antongil'] },
    { name: 'Río de la Plata', sources: ['RDLP (Parana Basin)'] },
    { name: 'Pampia', sources: ['Pampia', 'Pampia (Block west of the Parana Basin)'] }
];

const minimumCoverArea = 0.00001;

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function geometryRings(geometry) {
    if (geometry.type === 'Polygon') return [geometry.coordinates[0]];
    if (geometry.type === 'MultiPolygon') return geometry.coordinates.map(polygon => polygon[0]);
    return [];
}

function physicalRingArea(ring) {
    const sphericalArea = geoArea({ type: 'Polygon', coordinates: [ring] });
    return Math.min(sphericalArea, fullSphereArea - sphericalArea);
}

function signedArea(ring) {
    let area = 0;
    for (let index = 0; index < ring.length - 1; index++) {
        const current = ring[index];
        const next = ring[index + 1];
        area += current[0] * next[1] - next[0] * current[1];
    }
    return area / 2;
}

function clockwiseRing(ring) {
    return signedArea(ring) > 0 ? [...ring].reverse() : ring;
}

function unwrapLongitude(longitude, reference) {
    let value = longitude;
    while (value - reference > 180) value -= 360;
    while (value - reference < -180) value += 360;
    return value;
}

function normalizeLongitude(longitude) {
    let value = longitude;
    while (value > 180) value -= 360;
    while (value < -180) value += 360;
    return value;
}

function averageCenter(rings) {
    const points = rings.flat();
    const reference = points[0]?.[0] ?? 0;
    const longitude = points.reduce((sum, point) => sum + unwrapLongitude(point[0], reference), 0) / points.length;
    const latitude = points.reduce((sum, point) => sum + point[1], 0) / points.length;
    return [normalizeLongitude(longitude), latitude];
}

function convexHull(rings) {
    const sourceCenter = averageCenter(rings);
    const unique = new Map();
    for (const [longitude, latitude] of rings.flat()) {
        const point = [unwrapLongitude(longitude, sourceCenter[0]), latitude];
        unique.set(`${point[0].toFixed(6)},${point[1].toFixed(6)}`, point);
    }
    const points = [...unique.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (points.length < 3) return points;

    const cross = (origin, a, b) =>
        (a[0] - origin[0]) * (b[1] - origin[1]) - (a[1] - origin[1]) * (b[0] - origin[0]);
    const lower = [];
    for (const point of points) {
        while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop();
        lower.push(point);
    }
    const upper = [];
    for (let index = points.length - 1; index >= 0; index--) {
        const point = points[index];
        while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop();
        upper.push(point);
    }
    const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)]
        .reverse()
        .map(([longitude, latitude]) => [normalizeLongitude(longitude), latitude]);
    hull.push([...hull[0]]);
    return hull;
}

function parseRotations() {
    const rotations = new Map();
    const source = fs.readFileSync(path.join(references, '1000_0_rotfile.rot'), 'utf8');
    for (const line of source.split(/\r?\n/)) {
        const columns = line.split('!')[0].trim().split(/\s+/);
        if (columns.length < 6) continue;
        const [plateId, time, latitude, longitude, angle, referencePlate] = columns.map(Number);
        if (![plateId, time, latitude, longitude, angle, referencePlate].every(Number.isFinite)) continue;
        if (!rotations.has(plateId)) rotations.set(plateId, []);
        rotations.get(plateId).push({ time, latitude, longitude, angle, referencePlate });
    }
    for (const entries of rotations.values()) entries.sort((a, b) => a.time - b.time);
    return rotations;
}

const rotations = parseRotations();

function rotationAt(plateId, time) {
    const entries = rotations.get(plateId);
    if (!entries?.length) return null;
    let before = null;
    let after = null;
    for (const entry of entries) {
        if (entry.time <= time) before = entry;
        if (!after && entry.time >= time) after = entry;
    }
    before ??= after;
    after ??= before;
    if (!before || !after) return null;
    if (before.time === after.time) return before;
    const fraction = (time - before.time) / (after.time - before.time);
    return {
        latitude: before.latitude + fraction * (after.latitude - before.latitude),
        longitude: before.longitude + fraction * (after.longitude - before.longitude),
        angle: before.angle + fraction * (after.angle - before.angle),
        referencePlate: before.referencePlate
    };
}

function quaternionMultiply(a, b) {
    return [
        a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
        a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
        a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
        a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0]
    ];
}

function quaternionFromRotation(rotation) {
    const latitude = rotation.latitude * Math.PI / 180;
    const longitude = rotation.longitude * Math.PI / 180;
    const halfAngle = rotation.angle * Math.PI / 360;
    const sine = Math.sin(halfAngle);
    return [
        Math.cos(halfAngle),
        sine * Math.cos(latitude) * Math.cos(longitude),
        sine * Math.cos(latitude) * Math.sin(longitude),
        sine * Math.sin(latitude)
    ];
}

function normalizeQuaternion(quaternion) {
    const length = Math.hypot(...quaternion);
    return quaternion.map(value => value / length);
}

function absoluteRotation(plateId, time, visiting = new Set()) {
    if (!plateId || visiting.has(plateId)) return [1, 0, 0, 0];
    const rotation = rotationAt(plateId, time);
    if (!rotation) return [1, 0, 0, 0];
    visiting.add(plateId);
    const reference = absoluteRotation(rotation.referencePlate, time, visiting);
    visiting.delete(plateId);
    return normalizeQuaternion(quaternionMultiply(reference, quaternionFromRotation(rotation)));
}

function rotatePoint(point, quaternion) {
    const longitude = point[0] * Math.PI / 180;
    const latitude = point[1] * Math.PI / 180;
    const vector = [
        0,
        Math.cos(latitude) * Math.cos(longitude),
        Math.cos(latitude) * Math.sin(longitude),
        Math.sin(latitude)
    ];
    const inverse = [quaternion[0], -quaternion[1], -quaternion[2], -quaternion[3]];
    const rotated = quaternionMultiply(quaternionMultiply(quaternion, vector), inverse);
    return [
        Math.atan2(rotated[2], rotated[1]) * 180 / Math.PI,
        Math.asin(Math.max(-1, Math.min(1, rotated[3]))) * 180 / Math.PI
    ];
}

function reconstructRings(rings, plateId, time) {
    if (time === 0) return rings;
    const rotation = absoluteRotation(plateId, time);
    return rings.map(ring => ring.map(point => rotatePoint(point, rotation)));
}

function plateMotion(plateId, time) {
    // Compose the plate's full reference hierarchy before differencing.
    // This preserves drift for plates recorded as stationary relative to a
    // moving parent, which the old single-rotation calculation lost.
    const interval = 1;
    const start = absoluteRotation(plateId, time);
    const end = absoluteRotation(plateId, time + interval);
    const inverseStart = [start[0], -start[1], -start[2], -start[3]];
    let delta = normalizeQuaternion(quaternionMultiply(end, inverseStart));
    if (delta[0] < 0) delta = delta.map(value => -value);
    const halfSine = Math.hypot(delta[1], delta[2], delta[3]);
    if (halfSine < 1e-10) return { pole: [0, 90], rate: 0 };
    const angle = 2 * Math.atan2(halfSine, Math.min(1, delta[0]));
    const axis = [delta[1] / halfSine, delta[2] / halfSine, delta[3] / halfSine];
    const longitude = Math.atan2(axis[1], axis[0]) * 180 / Math.PI;
    const latitude = Math.asin(Math.max(-1, Math.min(1, axis[2]))) * 180 / Math.PI;
    return {
        pole: [longitude, latitude],
        rate: Math.round((angle * 180 / Math.PI / interval) * 1e6) / 1e6
    };
}

function colorFor(id) {
    const hue = (id * 137.508) % 360;
    const saturation = 45 + (id % 20);
    const lightness = 45 + (id % 15);
    const s = saturation / 100;
    const l = lightness / 100;
    const a = s * Math.min(l, 1 - l);
    const channel = n => {
        const k = (n + hue / 30) % 12;
        const value = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
        return Math.round(value * 255).toString(16).padStart(2, '0');
    };
    return `#${channel(0)}${channel(8)}${channel(4)}`;
}

function makeItem({ plateId, motionPlateId = plateId, name, color, rings, time }) {
    const ring = convexHull(rings);
    return {
        plateId,
        name,
        color: color ?? colorFor(plateId),
        center: geoCentroid({ type: 'Polygon', coordinates: [ring] }),
        rings: [ring],
        motion: plateMotion(motionPlateId, time),
        cratons: []
    };
}

function groupByPlate(features) {
    const groups = new Map();
    for (const feature of features) {
        const plateId = feature.properties?.PLATEID1 ?? 0;
        if (!plateId) continue;
        if (!groups.has(plateId)) groups.set(plateId, { plateId, names: [], rings: [], area: 0 });
        const group = groups.get(plateId);
        group.names.push(feature.properties?.NAME || `Plate ${plateId}`);
        for (const ring of geometryRings(feature.geometry)) {
            group.rings.push(ring);
            group.area += physicalRingArea(ring);
        }
    }
    return groups;
}

function createPlateLayer(features, time) {
    const items = [];
    for (const group of groupByPlate(features).values()) {
        const sourceName = group.names[0];
        const required = importantPlateIds.has(group.plateId);
        if (!required && (group.area < minimumPlateArea || oceanicName.test(sourceName))) continue;
        const item = makeItem({
            plateId: group.plateId,
            name: plateNameOverrides.get(group.plateId) ?? sourceName,
            rings: group.rings,
            time
        });
        if (physicalRingArea(item.rings[0]) < 0.75) items.push(item);
    }
    return items.sort((a, b) => a.plateId - b.plateId);
}

function createCratonLayer(features, time) {
    const byName = new Map();
    for (const feature of features) {
        const name = feature.properties?.NAME;
        if (!name) continue;
        if (!byName.has(name)) byName.set(name, []);
        byName.get(name).push(feature);
    }
    const officialFeatures = readJson(path.join(assets, 'geoscience-australia-major-cratons.geojson')).features;
    const officialByName = new Map(officialFeatures.map(feature => [feature.properties.name, feature]));
    return cratonDefinitions.map((definition, index) => {
        let rings;
        let plateId;
        if (definition.officialName) {
            const official = officialByName.get(definition.officialName);
            if (!official) throw new Error(`Missing official craton source for ${definition.name}`);
            plateId = official.properties.motionPlateId;
            rings = reconstructRings(geometryRings(official.geometry), plateId, time);
        } else {
            const matched = definition.sources.flatMap(name => byName.get(name) ?? []);
            if (!matched.length) throw new Error(`Missing craton source for ${definition.name}`);
            rings = matched.flatMap(feature => geometryRings(feature.geometry));
            plateId = matched[0].properties.PLATEID1;
        }
        return makeItem({
            plateId: 920000 + index,
            motionPlateId: plateId,
            name: definition.name,
            color: colorFor(plateId),
            rings,
            time
        });
    });
}

function createMotionSources(plateFeatures, time) {
    return plateFeatures
        .filter(feature => Number.isFinite(feature.properties?.PLATEID1))
        .map(feature => ({
            feature,
            plateId: feature.properties.PLATEID1,
            name: plateNameOverrides.get(feature.properties.PLATEID1)
                ?? feature.properties?.NAME
                ?? `Plate ${feature.properties.PLATEID1}`,
            center: geoCentroid(feature),
            motion: plateMotion(feature.properties.PLATEID1, time)
        }))
        .filter(source => source.motion.rate > 0);
}

function closestMotionSource(center, sources) {
    return sources.find(source => geoContains(source.feature, center))
        ?? sources.reduce((nearest, source) => {
            const distance = geoDistance(center, source.center);
            return !nearest || distance < nearest.distance ? { ...source, distance } : nearest;
        }, null);
}

// Conventional continent boundaries for the one continuous Afro-Eurasian
// source cover. The cuts run through water where possible, then follow the
// Suez/Red Sea and Turkish Straits-Caucasus-Ural conventions on land.
const africaMask = [[[
    [-30, -45], [60, -45], [60, 11.5], [43.2, 11.5],
    [40, 15], [36, 22], [33, 28], [32.5, 31.5],
    [25, 34], [20, 35], [15, 36], [10, 38], [5, 38],
    [1, 37.2], [-2, 36.5], [-5.6, 35.95], [-8, 36],
    [-30, 36], [-30, -45]
]]];

const europeMask = [[[
    [-30, 34], [26, 34], [26, 39.8], [29, 41],
    [35, 42], [40, 43.5], [47, 41], [51, 46],
    [55, 50], [57, 51], [58, 55], [59, 60],
    [60, 66], [68, 70], [82, 90], [-30, 90], [-30, 34]
]]];

// Use the Panama-Darien convention for the Americas. The short land cut is
// deliberately placed near the Panama-Colombia border; the rest of the mask
// runs through ocean so the source coastline remains untouched.
const southAmericaMask = [[[
    [-100, -65], [-25, -65], [-25, 20], [-77, 20],
    [-77.2, 8.7], [-78.9, 7.2], [-100, 7.2], [-100, -65]
]]];

// Central America is separated at the narrow Isthmus of Tehuantepec. The
// mask includes the Yucatan and runs south to the already-defined Darien cut.
const centralAmericaMask = [[[
    [-100, 7.2], [-75, 7.2], [-75, 25], [-90, 25],
    [-94.5, 18.7], [-96.5, 15.7], [-100, 15.7], [-100, 7.2]
]]];

// Familiar Asian subregions whose coasts are already part of the continuous
// source cover. Only their short overland margins are introduced here.
const arabianPeninsulaMask = [[[
    [31, 10], [60, 10], [60, 33], [49, 33],
    [48, 30.5], [43, 31], [39, 31], [35, 29.5], [31, 28], [31, 10]
]]];

const indianSubcontinentMask = [[[
    [58, 5], [95, 5], [95, 28], [90, 29],
    [85, 31], [80, 32.5], [75, 36.5], [69, 37],
    [64, 31], [61, 26], [58, 25], [58, 5]
]]];

function clippedCoverRing(result, name) {
    const rings = result
        .map(polygon => clockwiseRing(polygon[0]))
        .filter(ring => physicalRingArea(ring) >= minimumCoverArea)
        .sort((a, b) => physicalRingArea(b) - physicalRingArea(a));
    if (!rings.length) throw new Error(`${name} split produced no cover`);
    // The source layer also contains separate island covers. Keep the largest
    // connected mainland result here so each continent remains one editable
    // polygon instead of absorbing boundary slivers or duplicate islands.
    return rings[0];
}

function splitAfroEurasiaCover(cover, motionSources) {
    const source = cover.rings.map(ring => [ring]);
    const africaResult = polygonClipping.intersection(source, africaMask);
    const outsideAfrica = polygonClipping.difference(source, africaMask);
    const europeResult = polygonClipping.intersection(outsideAfrica, europeMask);
    const asiaResult = polygonClipping.difference(outsideAfrica, europeMask);
    const arabianPeninsulaResult = polygonClipping.intersection(asiaResult, arabianPeninsulaMask);
    const indianSubcontinentResult = polygonClipping.intersection(asiaResult, indianSubcontinentMask);
    const remainingAsiaResult = polygonClipping.difference(
        asiaResult,
        arabianPeninsulaMask,
        indianSubcontinentMask
    );

    return [
        { name: 'Africa', plateId: cover.plateId, color: '#9c4a6d', result: africaResult },
        { name: 'Europe', plateId: 919000, color: '#6e79a8', result: europeResult },
        { name: 'Asia', plateId: 919001, color: '#a66f45', result: remainingAsiaResult },
        { name: 'Arabian Peninsula', plateId: 919003, color: '#b18a55', result: arabianPeninsulaResult },
        { name: 'Indian Subcontinent', plateId: 919004, color: '#8f8b4e', result: indianSubcontinentResult }
    ].map(piece => {
        const ring = clippedCoverRing(piece.result, piece.name);
        const center = geoCentroid({ type: 'Polygon', coordinates: [ring] });
        const sourcePlate = closestMotionSource(center, motionSources);
        return {
            plateId: piece.plateId,
            name: piece.name,
            color: piece.color,
            center,
            rings: [ring],
            motion: sourcePlate.motion,
            cratons: []
        };
    });
}

function splitAmericasCover(cover, motionSources) {
    const source = cover.rings.map(ring => [ring]);
    const southAmericaResult = polygonClipping.intersection(source, southAmericaMask);
    const outsideSouthAmerica = polygonClipping.difference(source, southAmericaMask);
    const centralAmericaResult = polygonClipping.intersection(outsideSouthAmerica, centralAmericaMask);
    const northAmericaResult = polygonClipping.difference(outsideSouthAmerica, centralAmericaMask);

    return [
        { name: 'North America', plateId: cover.plateId, color: '#4f83a8', result: northAmericaResult },
        { name: 'Central America', plateId: 919005, color: '#4f9a83', result: centralAmericaResult },
        { name: 'South America', plateId: 919002, color: '#8a6a3f', result: southAmericaResult }
    ].map(piece => {
        const ring = clippedCoverRing(piece.result, piece.name);
        const center = geoCentroid({ type: 'Polygon', coordinates: [ring] });
        const sourcePlate = closestMotionSource(center, motionSources);
        return {
            plateId: piece.plateId,
            name: piece.name,
            color: piece.color,
            center,
            rings: [ring],
            motion: sourcePlate.motion,
            cratons: []
        };
    });
}

function createModernCovers(time, plateFeatures) {
    const covers = readJson(path.join(assets, 'gplates-modern-continent-covers.json'));
    const motionSources = createMotionSources(plateFeatures, time);
    return covers.plates.flatMap(cover => {
        if (cover.name === 'Afro-Eurasia') return splitAfroEurasiaCover(cover, motionSources);
        if (cover.name === 'Americas') return splitAmericasCover(cover, motionSources);
        const source = closestMotionSource(cover.center, motionSources);
        return [{
            ...cover,
            // Covers deliberately ignore plate boundaries. Approximate their
            // drift using the detailed continental region at/nearest center.
            motion: source.motion
        }];
    });
}

function featurePolygons(feature) {
    if (feature.geometry.type === 'Polygon') return [feature.geometry.coordinates];
    if (feature.geometry.type === 'MultiPolygon') return feature.geometry.coordinates;
    return [];
}

function createPangaeaRegions(mainRing, plateFeatures, motionSources) {
    // The reconstruction model's plate IDs retain their continental families.
    // 1/3/4/6 are the Laurasian families (Laurentia, Europe, Siberia and East
    // Asia); the remaining main-body families form Gondwana. Intersecting that
    // source distinction with the continuous cover preserves its detailed
    // external coastline while giving the editor one polygon per super-region.
    const laurasianFamilies = new Set(['1', '3', '4', '6']);
    const laurasianPolygons = plateFeatures
        .filter(feature => laurasianFamilies.has(String(feature.properties?.PLATEID1)[0]))
        .flatMap(featurePolygons);
    const laurasianUnion = polygonClipping.union(...laurasianPolygons);
    const laurasiaResult = polygonClipping.intersection([[mainRing]], laurasianUnion);
    const laurasiaRing = clippedCoverRing(laurasiaResult, 'Laurasia');
    const gondwanaResult = polygonClipping.difference([[mainRing]], [[laurasiaRing]]);
    const gondwanaRing = clippedCoverRing(gondwanaResult, 'Gondwana');

    return [
        { name: 'Laurasia', plateId: 930000, color: '#786b9d', ring: laurasiaRing },
        { name: 'Gondwana', plateId: 939000, color: '#8b6f47', ring: gondwanaRing }
    ].map(region => {
        const center = geoCentroid({ type: 'Polygon', coordinates: [region.ring] });
        const source = closestMotionSource(center, motionSources);
        return {
            plateId: region.plateId,
            name: region.name,
            color: region.color,
            center,
            rings: [region.ring],
            motion: source.motion,
            cratons: []
        };
    });
}

function createPangaeaCovers(plateFeatures, time) {
    const polygons = plateFeatures.flatMap(featurePolygons);
    const motionSources = createMotionSources(plateFeatures, time);
    const connectedRings = polygonClipping.union(...polygons)
        .map(polygon => clockwiseRing(polygon[0]))
        .filter(ring => physicalRingArea(ring) >= minimumCoverArea)
        .sort((a, b) => physicalRingArea(b) - physicalRingArea(a));
    const [mainRing, ...independentRings] = connectedRings;
    const regions = createPangaeaRegions(mainRing, plateFeatures, motionSources);
    const usedNames = new Map();
    const independent = independentRings.map((ring, index) => {
        const center = geoCentroid({ type: 'Polygon', coordinates: [ring] });
        const source = closestMotionSource(center, motionSources);
        const baseName = `${source.name} — landmass`;
        const duplicate = (usedNames.get(baseName) ?? 0) + 1;
        usedNames.set(baseName, duplicate);
        return {
            plateId: 930001 + index,
            name: duplicate === 1 ? baseName : `${baseName} ${duplicate}`,
            color: colorFor(source.plateId),
            center,
            rings: [ring],
            motion: source.motion,
            cratons: []
        };
    });
    return [...regions, ...independent];
}

function writeLayer(filename, time, plates) {
    const output = { time, plateCount: plates.length, plates };
    fs.writeFileSync(path.join(assets, filename), JSON.stringify(output));
    console.log(`${filename}: ${plates.length} regions`);
}

for (const { key, time, suffix } of [
    { key: 'modern', time: 0, suffix: '0.00Ma' },
    { key: 'pangaea', time: 200, suffix: '200.00Ma' }
]) {
    const plates = readJson(path.join(references, 'shapes_continents', `reconstructed_${suffix}.geojson`)).features;
    const cratons = readJson(path.join(references, 'shapes_cratons', `reconstructed_${suffix}.geojson`)).features;
    const covers = key === 'modern' ? createModernCovers(time, plates) : createPangaeaCovers(plates, time);
    writeLayer(`gplates-${key}-overview-covers.json`, time, covers);
    writeLayer(`gplates-${key}-overview-plates.json`, time, createPlateLayer(plates, time));
    writeLayer(`gplates-${key}-overview-cratons.json`, time, createCratonLayer(cratons, time));
}
