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
const polygonClipping = require('polygon-clipping');

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

// ── Polygon union (merge subplate fragments into one landmass) ───────

/**
 * Union all rings of a plate into one or more merged polygons using
 * polygon-clipping. Returns array of outer rings (each a Coordinate[]).
 * Handles MultiPolygon results (non-contiguous landmasses after merge).
 */
function unionRings(rings) {
    if (rings.length === 0) return [];
    if (rings.length === 1) return rings;

    // polygon-clipping expects GeoJSON-style MultiPolygon:
    // [[[[lon, lat], ...]]]  (array of polygons, each = array of rings, each ring = array of points)
    const multipoly = rings.map(ring => {
        // Ensure ring is closed (first === last)
        const closed = ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
            ? ring
            : [...ring, ring[0]];
        return [closed]; // one polygon with one outer ring
    });

    try {
        const result = polygonClipping.union(...multipoly);
        // result is a MultiPolygon: [[[[lon,lat],...]], ...]
        // Extract outer ring of each polygon
        return result.map(poly => simplifyRing(poly[0], 1.0));
    } catch (e) {
        // If union fails (self-intersecting input, etc.), fall back to individual rings
        console.warn(`  Union failed for plate (${rings.length} rings): ${e.message}`);
        return rings.map(r => simplifyRing(r, 1.0));
    }
}

// ── Group by name (merge subplates with same geological name) ────────

/**
 * Group features by NAME instead of PLATEID1.
 * All fragments sharing the same name become one plate.
 * Falls back to PLATEID1 if NAME is empty.
 * Returns Map<name, {name, rings, plateIds}>
 */
function groupByName(features) {
    const plates = new Map();
    for (const feature of features) {
        const rawName = feature.properties?.NAME || '';
        const plateId = feature.properties?.PLATEID1 ?? 0;
        // Use name as key; fall back to plateId if no name
        const key = rawName || `Plate ${plateId}`;
        const rings = extractRings(feature.geometry).map(r => simplifyRing(r));

        if (!plates.has(key)) {
            plates.set(key, { name: rawName || `Plate ${plateId}`, rings: [], plateIds: new Set() });
        }
        const plate = plates.get(key);
        plate.rings.push(...rings);
        plate.plateIds.add(plateId);
    }
    return plates;
}

// ── Main processing ───────────────────────────────────────────────────

function processTemplate(continentFile, cratonFile, rotations, targetTime, includeCratons, mergeRings) {
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

        // Merge subplate fragments into one landmass if requested
        const finalRings = mergeRings ? unionRings(data.rings) : data.rings;

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
            rings: finalRings,
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

// ── Full-detail processing (for manual curation) ─────────────────────

/**
 * Process with minimal simplification (0.01° tolerance) and all cratons.
 * Keeps nearly all geometric detail — heavy on FPS but allows the user
 * to manually merge/reduce in the app and save a curated version.
 */
function processTemplateFullDetail(continentFile, cratonFile, rotations, targetTime) {
    const continents = loadGeoJSON(continentFile);
    const continentPlates = groupByPlate(continents.features);

    const cratonPlates = cratonFile ? groupByPlate(loadGeoJSON(cratonFile).features) : null;

    const plates = [];

    for (const [plateId, data] of continentPlates) {
        if (plateId === 0) continue;

        // Keep all plates, even tiny ones (for manual curation)
        const totalPoints = data.rings.reduce((sum, r) => sum + r.length, 0);
        if (totalPoints < 3) continue;

        const motion = getPlateMotion(rotations, plateId, targetTime);
        const center = ringCenter(data.rings.flat());
        const name = data.names[0] || `Plate ${plateId}`;

        // Minimal simplification — keep nearly all detail
        const rings = data.rings.map(r => simplifyRing(r, 0.01));

        // Collect cratons with minimal simplification
        let cratonData = [];
        if (cratonPlates && cratonPlates.has(plateId)) {
            const cratons = cratonPlates.get(plateId);
            for (let i = 0; i < cratons.rings.length; i++) {
                const ring = cratons.rings[i];
                if (ring.length >= 4) {
                    const simplified = simplifyRing(ring, 0.01);
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
            rings,
            motion,
            cratons: cratonData
        });
    }

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

// Process 2 merged templates (union subplate fragments into one landmass per plate)
console.log('Processing merged templates...');

const modernMerged = processTemplate(
    'shapes_continents/reconstructed_0.00Ma.geojson',
    null,
    rotations, 0, false, true
);
writeJSON('gplates-modern-merged.json', modernMerged);

const pangaeaMerged = processTemplate(
    'shapes_continents/reconstructed_200.00Ma.geojson',
    null,
    rotations, 200, false, true
);
writeJSON('gplates-pangaea-merged.json', pangaeaMerged);

// Process separate per-layer full-detail files for manual curation
// Each file contains only one feature type so the user can inspect/merge
// them independently in the app.
console.log('Processing separate full-detail layers (for manual curation)...');

// Helper: extract one layer as a TectoLite-compatible world with only that feature type
function processLayerOnly(layerFile, layerType, rotations, targetTime, prefix) {
    const features = loadGeoJSON(layerFile);
    const grouped = groupByPlate(features.features);
    const plates = [];

    for (const [plateId, data] of grouped) {
        if (plateId === 0) continue;
        const totalPoints = data.rings.reduce((sum, r) => sum + r.length, 0);
        if (totalPoints < 3) continue;

        const motion = getPlateMotion(rotations, plateId, targetTime);
        const center = ringCenter(data.rings.flat());
        const name = data.names[0] || `Plate ${plateId}`;
        const rings = data.rings.map(r => simplifyRing(r, 0.01));

        plates.push({
            plateId,
            name,
            color: plateColor(plateId),
            center,
            rings,
            motion,
            cratons: [] // empty — this is a single-layer file
        });
    }

    plates.sort((a, b) => a.plateId - b.plateId);
    return { time: targetTime, plateCount: plates.length, plates };
}

// Modern Earth — 2 separate layers (continents/coastlines + cratons)
// Note: GPlates data has only one continents file (coastlines = continents).
// There is no separate coastline layer — the continent polygons ARE the coastlines.
writeJSON('gplates-modern-plates.json',
    processLayerOnly('shapes_continents/reconstructed_0.00Ma.geojson', 'plates', rotations, 0, 'modern-plates'));
writeJSON('gplates-modern-cratons.json',
    processLayerOnly('shapes_cratons/reconstructed_0.00Ma.geojson', 'cratons', rotations, 0, 'modern-cratons'));

// Pangaea — 2 separate layers
writeJSON('gplates-pangaea-plates.json',
    processLayerOnly('shapes_continents/reconstructed_200.00Ma.geojson', 'plates', rotations, 200, 'pangaea-plates'));
writeJSON('gplates-pangaea-cratons.json',
    processLayerOnly('shapes_cratons/reconstructed_200.00Ma.geojson', 'cratons', rotations, 200, 'pangaea-cratons'));

// Process auto-merged templates (group by NAME + union rings)
// Merges all subplate fragments sharing the same geological name into
// one plate with unioned geometry. Reduces 424 plates → ~250.
console.log('Processing auto-merged-by-name templates...');

function processMergedByName(continentFile, rotations, targetTime) {
    const continents = loadGeoJSON(continentFile);
    const grouped = groupByName(continents.features);
    const plates = [];

    for (const [name, data] of grouped) {
        const totalPoints = data.rings.reduce((sum, r) => sum + r.length, 0);
        if (totalPoints < 20) continue;

        // Use the first plate ID for motion lookup
        const primaryPlateId = [...data.plateIds][0];
        const motion = getPlateMotion(rotations, primaryPlateId, targetTime);
        const center = ringCenter(data.rings.flat());

        // Union all rings into clean landmasses
        const mergedRings = unionRings(data.rings);

        plates.push({
            plateId: primaryPlateId,
            name,
            color: plateColor(primaryPlateId),
            center,
            rings: mergedRings,
            motion,
            cratons: []
        });
    }

    plates.sort((a, b) => a.plateId - b.plateId);
    return { time: targetTime, plateCount: plates.length, plates };
}

writeJSON('gplates-modern-auto.json',
    processMergedByName('shapes_continents/reconstructed_0.00Ma.geojson', rotations, 0));
writeJSON('gplates-pangaea-auto.json',
    processMergedByName('shapes_continents/reconstructed_200.00Ma.geojson', rotations, 200));

console.log('Done!');