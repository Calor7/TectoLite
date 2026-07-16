/*
 * Generate the editable present-day land-cover layer from Natural Earth 1:10m
 * land geometry. Every retained continuous land component becomes exactly one
 * polygon. Plate/craton overlays are simplified elsewhere; this layer keeps
 * real coastlines so it can be split and curated by hand.
 *
 * By default the script reuses files downloaded to C:\tmp and otherwise fetches
 * the official Natural Earth vector sources. Paths can be overridden with:
 *   NATURAL_EARTH_LAND=<path>
 *   NATURAL_EARTH_COUNTRIES=<path>
 *
 * Run from the repository root:
 *   node scripts/generate-continent-covers.cjs
 */
const fs = require('fs');
const path = require('path');
const { geoArea, geoCentroid, geoContains, geoDistance } = require('d3-geo');

const root = path.resolve(__dirname, '..');
const outputPath = path.join(root, 'src', 'assets', 'gplates-modern-continent-covers.json');
const fullSphereArea = 4 * Math.PI;

// Roughly 400 km2 at Earth's surface. This retains Isle of Man-sized islands,
// the Caribbean, Mediterranean islands, and the detailed SE Asian archipelago,
// while avoiding thousands of tiny rocks that would make editing impractical.
const minimumSphericalArea = 0.00001;
const coastlineToleranceDegrees = 0.02;

const sources = {
    land: {
        environment: 'NATURAL_EARTH_LAND',
        local: 'C:\\tmp\\ne_10m_land.geojson',
        url: 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_land.geojson'
    },
    countries: {
        environment: 'NATURAL_EARTH_COUNTRIES',
        local: 'C:\\tmp\\ne_10m_admin_0_countries.geojson',
        url: 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_countries.geojson'
    }
};

const continentStyles = {
    'North America': { color: '#4a9c6d', motion: { pole: [-78, 50], rate: 0.20 } },
    'South America': { color: '#6b8c3d', motion: { pole: [-56, -60], rate: 0.15 } },
    Europe: { color: '#3d6b8c', motion: { pole: [-100, 55], rate: 0.10 } },
    Africa: { color: '#8b6914', motion: { pole: [-50, 50], rate: 0.12 } },
    Asia: { color: '#9c4a6d', motion: { pole: [-100, 55], rate: 0.10 } },
    Oceania: { color: '#8c3d6b', motion: { pole: [32, 33], rate: 0.65 } },
    Antarctica: { color: '#708090', motion: { pole: [-120, 55], rate: 0.08 } },
    Unknown: { color: '#708870', motion: { pole: [-100, 55], rate: 0.10 } }
};

// Natural Earth land polygons do not carry names. These stable geographic
// anchors give important components useful editor names. Everything else is
// still retained and receives a country-based landmass name.
const namedLandmasses = [
    ['Afro-Eurasia', 49.13, 37.36, 3],
    ['Americas', -78.05, 20.15, 3],
    ['Antarctica', 83.04, -84.68, 3],
    ['Australia', 134.21, -25.63, 3],
    ['Greenland', -41.84, 73.15, 3],
    ['New Guinea', 140.91, -5.35, 2],
    ['Borneo', 114.21, 0.86, 2],
    ['Madagascar', 46.74, -19.32, 2],
    ['Baffin Island', -73.26, 68.31, 2],
    ['Sumatra', 101.52, -0.45, 2],
    ['Honshu', 137.87, 36.63, 2],
    ['Victoria Island', -110.28, 70.85, 2],
    ['Great Britain', -2.42, 53.84, 2],
    ['Ellesmere Island', -79.27, 80.02, 2],
    ['Sulawesi', 121.12, -1.99, 2],
    ['South Island, New Zealand', 170.60, -43.96, 2],
    ['Java', 109.93, -7.30, 2],
    ['North Island, New Zealand', 175.72, -38.56, 2],
    ['Chukotka', -175.76, 66.46, 2],
    ['Newfoundland', -56.04, 48.71, 2],
    ['Cuba', -78.93, 21.63, 2],
    ['Luzon', 121.42, 15.94, 2],
    ['Iceland', -18.60, 65.00, 2],
    ['Mindanao', 124.84, 7.66, 2],
    ['Ireland', -7.91, 53.41, 2],
    ['Hokkaido', 142.57, 43.38, 2],
    ['Sakhalin', 142.71, 50.25, 2],
    ['Hispaniola', -71.26, 18.92, 2],
    ['Banks Island', -121.36, 73.02, 2],
    ['Sri Lanka', 80.71, 7.61, 2],
    ['Tasmania', 146.59, -42.01, 2],
    ['Tierra del Fuego', -68.68, -54.04, 2],
    ['Marajo', -49.71, -0.90, 1.5],
    ['Spitsbergen', 15.96, 78.56, 2],
    ['Kyushu', 130.87, 32.65, 2],
    ['New Britain', 150.65, -5.48, 2],
    ['Taiwan', 120.96, 23.75, 1.5],
    ['Hainan', 109.74, 19.20, 1.5],
    ['Vancouver Island', -125.69, 49.64, 2],
    ['Timor', 125.12, -9.25, 2],
    ['Sicily', 14.16, 37.59, 1.5],
    ['Sardinia', 9.03, 40.09, 1.5],
    ['Shikoku', 133.46, 33.65, 1.5],
    ['Halmahera', 128.02, 0.87, 1.5],
    ['Seram', 129.46, -3.20, 1.5],
    ['New Caledonia', 165.48, -21.33, 2],
    ['Sumbawa', 117.86, -8.63, 1.5],
    ['Flores', 121.16, -8.60, 1.5],
    ['Negros', 123.02, 10.03, 1.5],
    ['Samar', 125.07, 11.94, 1.5],
    ['Bangka', 105.99, -2.25, 1.5],
    ['Palawan', 118.57, 9.74, 1.5],
    ['Jamaica', -77.32, 18.16, 1.5],
    ['Fiji (Viti Levu)', 177.98, -17.82, 1.5],
    ['Hawaii', -155.52, 19.60, 1.5],
    ['Cape Breton Island', -60.73, 46.17, 1.5]
].map(([name, longitude, latitude, radius]) => ({ name, center: [longitude, latitude], radius }));

function geometryRings(geometry) {
    if (geometry.type === 'Polygon') return [geometry.coordinates[0]];
    if (geometry.type === 'MultiPolygon') return geometry.coordinates.map(polygon => polygon[0]);
    return [];
}

function physicalArea(ring) {
    const area = geoArea({ type: 'Polygon', coordinates: [ring] });
    return Math.min(area, fullSphereArea - area);
}

function longitudeDistance(a, b) {
    const raw = Math.abs(a - b) % 360;
    return Math.min(raw, 360 - raw);
}

function anchorDistance(center, anchor) {
    return Math.hypot(longitudeDistance(center[0], anchor[0]), center[1] - anchor[1]);
}

function distanceToSegment(point, start, end) {
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    if (dx === 0 && dy === 0) return Math.hypot(point[0] - start[0], point[1] - start[1]);
    const t = Math.max(0, Math.min(1,
        ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / (dx * dx + dy * dy)
    ));
    return Math.hypot(point[0] - (start[0] + t * dx), point[1] - (start[1] + t * dy));
}

function simplifyOpen(points, tolerance) {
    if (points.length <= 2) return points;
    let maxDistance = 0;
    let splitIndex = 0;
    for (let index = 1; index < points.length - 1; index++) {
        const distance = distanceToSegment(points[index], points[0], points[points.length - 1]);
        if (distance > maxDistance) {
            maxDistance = distance;
            splitIndex = index;
        }
    }
    if (maxDistance <= tolerance) return [points[0], points[points.length - 1]];
    const left = simplifyOpen(points.slice(0, splitIndex + 1), tolerance);
    const right = simplifyOpen(points.slice(splitIndex), tolerance);
    return [...left.slice(0, -1), ...right];
}

function simplifyClosed(ring, tolerance) {
    const points = ring.slice(0, -1);
    if (points.length <= 4) return ring;
    let oppositeIndex = 1;
    let farthest = 0;
    for (let index = 1; index < points.length; index++) {
        const distance = Math.hypot(
            longitudeDistance(points[index][0], points[0][0]),
            points[index][1] - points[0][1]
        );
        if (distance > farthest) {
            farthest = distance;
            oppositeIndex = index;
        }
    }
    const firstArc = simplifyOpen(points.slice(0, oppositeIndex + 1), tolerance);
    const secondArc = simplifyOpen([...points.slice(oppositeIndex), points[0]], tolerance);
    const simplified = [...firstArc.slice(0, -1), ...secondArc.slice(0, -1)];
    simplified.push([...simplified[0]]);
    return simplified;
}

function roundRing(ring) {
    const rounded = ring.map(([longitude, latitude]) => [
        Math.round(longitude * 1e5) / 1e5,
        Math.round(latitude * 1e5) / 1e5
    ]);
    const first = rounded[0];
    const last = rounded[rounded.length - 1];
    if (first && (first[0] !== last[0] || first[1] !== last[1])) rounded.push([...first]);
    return rounded;
}

async function readSource(definition) {
    const candidates = [process.env[definition.environment], definition.local].filter(Boolean);
    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) return JSON.parse(fs.readFileSync(candidate, 'utf8'));
    }
    console.log(`Downloading ${definition.url}`);
    const response = await fetch(definition.url);
    if (!response.ok) throw new Error(`Natural Earth download failed: ${response.status} ${response.statusText}`);
    return response.json();
}

function containingCountry(countries, center) {
    const containing = countries.find(country => geoContains(country, center));
    if (containing) return containing;
    return countries.reduce((nearest, country) => {
        const properties = country.properties ?? {};
        const label = [properties.LABEL_X, properties.LABEL_Y];
        if (!label.every(Number.isFinite)) return nearest;
        const distance = geoDistance(center, label);
        return !nearest || distance < nearest.distance ? { country, distance } : nearest;
    }, null)?.country;
}

function fallbackContinent(center) {
    if (center[1] < -60) return 'Antarctica';
    if (center[0] >= 110 && center[1] < 0) return 'Oceania';
    if (center[0] < -30 && center[1] >= 8) return 'North America';
    if (center[0] < -30) return 'South America';
    if (center[0] < 60 && center[1] < 35) return 'Africa';
    if (center[0] < 60 && center[1] >= 35) return 'Europe';
    return 'Asia';
}

function uniqueName(baseName, nameCounts) {
    const count = (nameCounts.get(baseName) ?? 0) + 1;
    nameCounts.set(baseName, count);
    return count === 1 ? baseName : `${baseName} ${count}`;
}

async function main() {
    const [land, countryData] = await Promise.all([
        readSource(sources.land),
        readSource(sources.countries)
    ]);
    const countries = countryData.features;
    const components = land.features
        .flatMap(feature => geometryRings(feature.geometry))
        .map(ring => ({
            sourceRing: ring,
            area: physicalArea(ring),
            center: geoCentroid({ type: 'Polygon', coordinates: [ring] })
        }))
        .filter(component => component.area >= minimumSphericalArea)
        .sort((a, b) => b.area - a.area);

    const usedAnchors = new Set();
    const nameCounts = new Map();
    const plates = components.map((component, index) => {
        let anchor = namedLandmasses
            .filter(candidate => !usedAnchors.has(candidate.name))
            .map(candidate => ({ candidate, distance: anchorDistance(component.center, candidate.center) }))
            .filter(match => match.distance <= match.candidate.radius)
            .sort((a, b) => a.distance - b.distance)[0]?.candidate;
        if (anchor) usedAnchors.add(anchor.name);

        const country = containingCountry(countries, component.center);
        const countryName = country?.properties?.ADMIN ?? 'Unassigned';
        const name = anchor?.name ?? uniqueName(`${countryName} — landmass`, nameCounts);
        const continent = country?.properties?.CONTINENT ?? fallbackContinent(component.center);
        const style = continentStyles[continent] ?? continentStyles.Unknown;
        const ring = roundRing(simplifyClosed(component.sourceRing, coastlineToleranceDegrees));
        return {
            plateId: 910000 + index,
            name,
            color: style.color,
            center: geoCentroid({ type: 'Polygon', coordinates: [ring] }),
            rings: [ring],
            motion: style.motion,
            cratons: []
        };
    });

    const output = {
        time: 0,
        plateCount: plates.length,
        source: 'Natural Earth 1:10m land and admin-0 countries',
        minimumSphericalArea,
        coastlineToleranceDegrees,
        plates
    };
    fs.writeFileSync(outputPath, JSON.stringify(output));
    const pointCount = plates.reduce((sum, plate) => sum + plate.rings[0].length, 0);
    console.log(`Wrote ${plates.length} detailed continuous land covers (${pointCount} points) to ${outputPath}`);
    for (const name of ['Great Britain', 'Ireland', 'New Guinea', 'Borneo', 'Sumatra', 'Java', 'Luzon', 'Mindanao']) {
        const plate = plates.find(candidate => candidate.name === name);
        console.log(`${name}: ${plate?.rings[0].length ?? 'MISSING'} points`);
    }
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
