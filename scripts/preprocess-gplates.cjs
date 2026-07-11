/**
 * Preprocess GPlates GeoJSON exports + rotation file into compact JSON
 * assets for TectoLite project templates.
 *
 * Usage: node scripts/preprocess-gplates.js
 *
 * Reads from gplates_references/ and writes to src/assets/gplates-*.json
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const GPLATES_DIR = path.join(ROOT, 'gplates_references');
const ASSETS_DIR = path.join(ROOT, 'src', 'assets');

// ── Geometry simplification (Douglas-Peucker lite) ───────────────────

/**
 * Simplify a ring of [lon, lat] points using a distance-based decimation.
 * Keeps points that deviate more than `tolerance` degrees from the line
 * between their neighbors. Cheap and good enough for visual templates.
 */
function simplifyRing(ring, tolerance = 1.0) {
    if (ring.length <= 4) return ring;

    // First pass: remove points within tolerance of the previous kept point
    const kept = [ring[0]];
    for (let i = 1; i < ring.length - 1; i++) {
        const [lon, lat] = ring[i];
        const [plon, plat] = kept[kept.length - 1];
        const d = Math.hypot(lon - plon, lat - plat);
        if (d >= tolerance) kept.push(ring[i]);
    }
    kept.push(ring[ring.length - 1]); // always keep last

    // Ensure ring is closed (first == last)
    if (kept[0][0] !== kept[kept.length - 1][0] || kept[0][1] !== kept[kept.length - 1][1]) {
        kept.push(kept[0]);
    }

    return kept;
}

// ── GeoJSON parsing ───────────────────────────────────────────────────

function loadGeoJSON(filename) {
    const raw = fs.readFileSync(path.join(GPLATES_DIR, filename), 'utf-8');
    return JSON.parse(raw);
}

/**
 * Extract outer rings from a GeoJSON feature's geometry.
 * Returns array of [lon, lat] rings.
 */
function extractRings(geometry) {
    if (geometry.type === 'Polygon') {
        // Use only the outer ring (coordinates[0])
        return [geometry.coordinates[0]];
    } else if (geometry.type === 'MultiPolygon') {
        // Use outer ring of each polygon
        return geometry.coordinates.map(poly => poly[0]);
    }
    return [];
}

/**
 * Group features by PLATEID1. Each group becomes one plate.
 * Returns Map<plateId, Array<{name, rings}>>
 */
function groupByPlate(features) {
    const plates = new Map();
    for (const feature of features) {
        const plateId = feature.properties?.PLATEID1 ?? 0;
        const name = feature.properties?.NAME || `Plate ${plateId}`;
        const rings = extractRings(feature.geometry).map(r => simplifyRing(r));

        if (!plates.has(plateId)) {
            plates.set(plateId, { plateId, names: [], rings: [] });
        }
        const plate = plates.get(plateId);
        plate.names.push(name);
        plate.rings.push(...rings);
    }
    return plates;
}

// ── Rotation file parsing ─────────────────────────────────────────────

/**
 * Parse a GPlates .rot file.
 * Format: plateId  time  eulerLat  eulerLon  angleDeg  refPlateId  ! comment
 *
 * Returns Map<plateId, Array<{time, lat, lon, angle, refPlate}>>
 */
function parseRotationFile(filename) {
    const raw = fs.readFileSync(path.join(GPLATES_DIR, filename), 'utf-8');
    const rotations = new Map();

    for (const line of raw.split('\n')) {
        // Remove comment
        const code = line.split('!')[0].trim();
        if (!code) continue;

        const parts = code.split(/\s+/);
        if (parts.length < 6) continue;

        const plateId = parseInt(parts[0], 10);
        const time = parseFloat(parts[1]);
        const lat = parseFloat(parts[2]);
        const lon = parseFloat(parts[3]);
        const angle = parseFloat(parts[4]);
        const refPlate = parseInt(parts[5], 10);

        if (isNaN(plateId) || isNaN(time) || isNaN(lat) || isNaN(lon) || isNaN(angle)) continue;

        if (!rotations.has(plateId)) {
            rotations.set(plateId, []);
        }
        rotations.get(plateId).push({ time, lat, lon, angle, refPlate });
    }

    // Sort each plate's rotations by time
    for (const entries of rotations.values()) {
        entries.sort((a, b) => a.time - b.time);
    }

    return rotations;
}

/**
 * Find the rotation entry for a plate at a target time.
 * Interpolates between bracketing entries.
 * Returns {lat, lon, angle, refPlate} or null.
 */
function getRotationAtTime(rotations, plateId, targetTime) {
    const entries = rotations.get(plateId);
    if (!entries || entries.length === 0) return null;

    // Find bracketing entries
    let before = null, after = null;
    for (const entry of entries) {
        if (entry.time <= targetTime) before = entry;
        if (entry.time >= targetTime && !after) after = entry;
    }

    if (!before && !after) return null;
    if (!before) return { ...after };
    if (!after) return { ...before };
    if (before.time === after.time) return { ...before };

    // Linear interpolation
    const t = (targetTime - before.time) / (after.time - before.time);
    return {
        lat: before.lat + t * (after.lat - before.lat),
        lon: before.lon + t * (after.lon - before.lon),
        angle: before.angle + t * (after.angle - before.angle),
        refPlate: before.refPlate,
    };
}

/**
 * Compute the absolute rotation rate (deg/Ma) for a plate at a target time.
 * Uses finite differences: finds the angle at targetTime and at
 * targetTime + deltaT, then computes (angle2 - angle1) / deltaT.
 * This gives the instantaneous angular velocity.
 */
function computeRate(rotations, plateId, targetTime, deltaT = 10) {
    const r1 = getRotationAtTime(rotations, plateId, targetTime);
    const r2 = getRotationAtTime(rotations, plateId, targetTime + deltaT);
    if (!r1 || !r2) return 0;
    return (r2.angle - r1.angle) / deltaT;
}

/**
 * Get the Euler pole position and rate for a plate at a target time.
 * For the template, we use the interpolated pole position and the
 * computed rate. If the plate's rotation is zero (identity), return
 * a zero rate.
 */
function getPlateMotion(rotations, plateId, targetTime) {
    const rot = getRotationAtTime(rotations, plateId, targetTime);
    if (!rot) return { pole: [0, 90], rate: 0 };

    // If angle is ~0, plate is not moving at this time
    if (Math.abs(rot.angle) < 0.01) {
        return { pole: [rot.lon, rot.lat], rate: 0 };
    }

    const rate = computeRate(rotations, plateId, targetTime);
    return { pole: [rot.lon, rot.lat], rate };
}

// ── Color palette ─────────────────────────────────────────────────────

/**
 * Generate a color from a plate ID using a hash → HSL.
 * Produces visually distinct colors for different plate IDs.
 */
function plateColor(plateId) {
    const hue = (plateId * 137.508) % 360; // golden angle for good distribution
    const sat = 45 + (plateId % 20);
    const light = 45 + (plateId % 15);
    return hslToHex(hue, sat, light);
}

function hslToHex(h, s, l) {
    s /= 100; l /= 100;
    const a = s * Math.min(l, 1 - l);
    const f = n => {
        const k = (n + h / 30) % 12;
        const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
        return Math.round(255 * c).toString(16).padStart(2, '0');
    };
    return `#${f(0)}${f(8)}${f(4)}`;
}

// ── Ring center ───────────────────────────────────────────────────────

function ringCenter(ring) {
    let lon = 0, lat = 0;
    for (const [x, y] of ring) { lon += x; lat += y; }
    return [lon / ring.length, lat / ring.length];
}

// ── Main processing ───────────────────────────────────────────────────

function processTemplate(continentFile, cratonFile, rotations, targetTime, includeCratons) {
    const continents = loadGeoJSON(continentFile);
    const continentPlates = groupByPlate(continents.features);

    // Load cratons if advanced template
    let cratonPlates = null;
    if (includeCratons && cratonFile) {
        const cratons = loadGeoJSON(cratonFile);
        cratonPlates = groupByPlate(cratons.features);
    }

    const plates = [];

    for (const [plateId, data] of continentPlates) {
        // Skip plate 0 (anchor plate, no real geometry)
        if (plateId === 0) continue;

        // Skip plates with very few points (tiny islands)
        const totalPoints = data.rings.reduce((sum, r) => sum + r.length, 0);
        if (totalPoints < 20) continue;

        const motion = getPlateMotion(rotations, plateId, targetTime);
        const center = ringCenter(data.rings.flat());
        const name = data.names[0] || `Plate ${plateId}`;

        // Collect cratons for this plate
        let cratonData = [];
        if (cratonPlates && cratonPlates.has(plateId)) {
            const cratons = cratonPlates.get(plateId);
            for (let i = 0; i < cratons.rings.length; i++) {
                const ring = cratons.rings[i];
                if (ring.length >= 4) {
                    // Simplify cratons more aggressively
                    const simplified = simplifyRing(ring, 1.5);
                    if (simplified.length >= 4) {
                        cratonData.push({
                            points: simplified,
                            name: cratons.names[i] || 'craton'
                        });
                    }
                }
            }
        }

        plates.push({
            plateId,
            name,
            color: plateColor(plateId),
            center,
            rings: data.rings,
            motion,
            cratons: cratonData
        });
    }

    // Sort by plate ID for deterministic output
    plates.sort((a, b) => a.plateId - b.plateId);

    return {
        time: targetTime,
        plateCount: plates.length,
        plates
    };
}

function writeJSON(filename, data) {
    const json = JSON.stringify(data);
    const outPath = path.join(ASSETS_DIR, filename);
    fs.writeFileSync(outPath, json, 'utf-8');
    const sizeKB = (json.length / 1024).toFixed(1);
    console.log(`  ${filename}: ${sizeKB} KB (${data.plateCount} plates)`);
}

// ── Run ───────────────────────────────────────────────────────────────

console.log('Preprocessing GPlates data...');

// Ensure assets dir exists
fs.mkdirSync(ASSETS_DIR, { recursive: true });

// Parse rotation file
console.log('Parsing rotation file...');
const rotations = parseRotationFile('1000_0_rotfile.rot');
console.log(`  ${rotations.size} plates in rotation model`);

// Process 4 templates
console.log('Processing templates...');

const modern = processTemplate(
    'shapes_continents/reconstructed_0.00Ma.geojson',
    'shapes_cratons/reconstructed_0.00Ma.geojson',
    rotations, 0, false
);
writeJSON('gplates-modern.json', modern);

const pangaea = processTemplate(
    'shapes_continents/reconstructed_200.00Ma.geojson',
    'shapes_cratons/reconstructed_200.00Ma.geojson',
    rotations, 200, false
);
writeJSON('gplates-pangaea.json', pangaea);

const modernAdv = processTemplate(
    'shapes_continents/reconstructed_0.00Ma.geojson',
    'shapes_cratons/reconstructed_0.00Ma.geojson',
    rotations, 0, true
);
writeJSON('gplates-modern-adv.json', modernAdv);

const pangaeaAdv = processTemplate(
    'shapes_continents/reconstructed_200.00Ma.geojson',
    'shapes_cratons/reconstructed_200.00Ma.geojson',
    rotations, 200, true
);
writeJSON('gplates-pangaea-adv.json', pangaeaAdv);

console.log('Done!');