import { geoArea, geoContains } from 'd3-geo';
/** Mid-ocean ridges reconstructed from prescribed plate motion.
 * Worldbuilding Pasta source mapping and numerical limits:
 * docs/research/mid-ocean-ridges.md. No playback snapshots are authoritative.
 */
import { LINE_TYPE_COLORS, type Coordinate, type GlobalOptions, type Polygon, type RiftAxis, type TectonicPlate } from '../types';
import { derivePlateGeometry, plateRotation } from '../motion/RotationModel';
import {
    calculateSphericalCentroid, cross, dot, latLonToVector, normalize,
    quatConjugate, quatMultiply, QUAT_IDENTITY, rotateCoordByQuat,
    rotateVectorByQuat, subtractVectors, vectorToLatLon,
    type Quaternion, type Vector3,
} from '../utils/sphericalMath';

const EPS = 1e-8;
const MIN_OPENING_CM_YR = 0.01;
const MAX_STEPS = 256;
const MAX_POINTS = 256;
type RidgeOptions = Pick<GlobalOptions, 'planetRadius' | 'oceanicGenerationInterval' | 'oceanicCrustColor'>;
type RidgeKind = NonNullable<TectonicPlate['midOceanRidge']>['kind'];

/** Illustrative thermal subsidence, meters below sea level. */
export function oceanDepthAtAge(ageMa: number): number {
    const age = Number.isFinite(ageMa) ? Math.max(0, ageMa) : 0;
    return 2600 + 2200 * (1 - Math.exp(-Math.sqrt(age) / 5));
}

/** Relief relative to the thermal seafloor: slow valley/shoulders, fast crest.
 * These are worldbuilding profiles, not a calibrated physical DEM. */
export function ridgeAxialRelief(distanceKm: number, fullSpreadingRateCmYr: number): number {
    if (!Number.isFinite(distanceKm)) return 0;
    const d = Math.abs(distanceKm);
    const rate = Number.isFinite(fullSpreadingRateCmYr) ? Math.max(0, fullSpreadingRateCmYr) : 0;
    const slowWeight = Math.max(0, Math.min(1, (4 - rate) / 2));
    const slow = 700 * Math.exp(-(((d - 12) / 8) ** 2)) - 900 * Math.exp(-((d / 5) ** 2));
    const fast = 400 * Math.exp(-((d / 15) ** 2));
    return slowWeight * slow + (1 - slowWeight) * fast;
}

function unitQuaternion(q: Quaternion): Quaternion {
    const n = Math.hypot(q.w, q.x, q.y, q.z);
    return n > EPS ? { w: q.w / n, x: q.x / n, y: q.y / n, z: q.z / n } : QUAT_IDENTITY;
}

/** Spherical interpolation of two rotations at half stage, A * sqrt(A^-1 B).
 * Unlike averaging longitude or corresponding continental vertices this is
 * a single rigid rotation, including around the dateline and the poles. */
function halfStage(a: Quaternion, b: Quaternion): Quaternion {
    let relative = unitQuaternion(quatMultiply(quatConjugate(a), b));
    if (relative.w < 0) relative = { w: -relative.w, x: -relative.x, y: -relative.y, z: -relative.z };
    const half = unitQuaternion({ w: 1 + relative.w, x: relative.x, y: relative.y, z: relative.z });
    return unitQuaternion(quatMultiply(a, half));
}

function angle(a: Vector3, b: Vector3): number {
    return Math.atan2(Math.hypot(...Object.values(cross(a, b))), dot(a, b));
}

function validPoint(p: Coordinate): boolean {
    return p.length === 2 && p.every(Number.isFinite) && Math.abs(p[1]) <= 90;
}

/** Preserve authored offsets while sampling each great-circle segment. */
function sampleLine(points: Coordinate[]): Coordinate[] {
    if (points.length < 2 || points.some(p => !validPoint(p))) return [];
    const lengths = points.slice(1).map((p, i) => angle(latLonToVector(points[i]), latLonToVector(p)));
    // Antipodal endpoints have no unique short great-circle path.
    if (lengths.some(length => length > Math.PI - 1e-4)) return [];
    const total = lengths.reduce((sum, length) => sum + length, 0);
    if (total < EPS) return [];
    // Detailed traced cut paths remain valid; coarsen them by arc length.
    if (points.length >= MAX_POINTS) {
        const sampled: Coordinate[] = [];
        let segment = 0, accumulated = 0;
        for (let i = 0; i < MAX_POINTS; i++) {
            const target = total * i / (MAX_POINTS - 1);
            while (segment < lengths.length - 1 && accumulated + lengths[segment] < target) {
                accumulated += lengths[segment++];
            }
            const length = lengths[segment];
            if (length < EPS) { sampled.push(points[segment]); continue; }
            const t = Math.max(0, Math.min(1, (target - accumulated) / length));
            const a = latLonToVector(points[segment]), b = latLonToVector(points[segment + 1]);
            const wa = Math.sin((1 - t) * length) / Math.sin(length);
            const wb = Math.sin(t * length) / Math.sin(length);
            sampled.push(vectorToLatLon(normalize({ x: wa * a.x + wb * b.x, y: wa * a.y + wb * b.y, z: wa * a.z + wb * b.z })));
        }
        return sampled;
    }
    const spacing = Math.max(Math.PI / 180, total / (MAX_POINTS - points.length));
    const sampled: Coordinate[] = [points[0]];
    for (let i = 0; i < lengths.length; i++) {
        const length = lengths[i];
        if (length < EPS) continue;
        const a = latLonToVector(points[i]);
        const b = latLonToVector(points[i + 1]);
        const count = Math.max(1, Math.ceil(length / spacing));
        for (let j = 1; j <= count; j++) {
            const t = j / count;
            const wa = Math.sin((1 - t) * length) / Math.sin(length);
            const wb = Math.sin(t * length) / Math.sin(length);
            sampled.push(vectorToLatLon(normalize({ x: wa * a.x + wb * b.x, y: wa * a.y + wb * b.y, z: wa * a.z + wb * b.z })));
        }
    }
    return sampled;
}

function rotation(plate: TectonicPlate, plates: TectonicPlate[], from: number, to: number): Quaternion {
    // A locked plate is stationary in the editor's simulation.
    return plate.locked ? QUAT_IDENTITY : plateRotation(plate, plates, from, to);
}

/** Splitting reroutes an axis to a child, which still has valid ancestral motion. */
function historicalFlank(plate: TectonicPlate, plates: TectonicPlate[], time: number): TectonicPlate | undefined {
    const visited = new Set<string>();
    let current: TectonicPlate | undefined = plate;
    while (current && time < current.birthTime) {
        if (visited.has(current.id)) return undefined;
        visited.add(current.id);
        current = current.parentPlateId ? plates.find(p => p.id === current!.parentPlateId) : undefined;
    }
    return current && (current.deathTime === null || time < current.deathTime) ? current : undefined;
}

function nearestBoundaryDirection(polygons: Polygon[], point: Vector3): Vector3 | undefined {
    let nearest: Vector3 | undefined;
    let distance = Infinity;
    const consider = (candidate: Vector3) => {
        const separation = angle(point, candidate);
        if (separation < distance) { nearest = candidate; distance = separation; }
    };
    for (const polygon of polygons) {
        if (!polygon.closed) continue;
        for (let i = 0; i < polygon.points.length; i++) {
            const a = latLonToVector(polygon.points[i]);
            const b = latLonToVector(polygon.points[(i + 1) % polygon.points.length]);
            consider(a);
            const normal = normalize(cross(a, b));
            const projection = dot(point, normal);
            const foot = normalize({ x: point.x - normal.x * projection, y: point.y - normal.y * projection, z: point.z - normal.z * projection });
            if (dot(foot, foot) > EPS && Math.abs(angle(a, foot) + angle(foot, b) - angle(a, b)) < 1e-6) consider(foot);
        }
    }
    return nearest;
}

function sideNormals(line: Coordinate[], a: TectonicPlate, b: TectonicPlate, plates: TectonicPlate[], birth: number): Vector3[] {
    const geometryA = derivePlateGeometry(historicalFlank(a, plates, birth) ?? a, plates, birth);
    const geometryB = derivePlateGeometry(historicalFlank(b, plates, birth) ?? b, plates, birth);
    const towardB = subtractVectors(latLonToVector(geometryB.center), latLonToVector(geometryA.center));
    const surfaces = (polygons: Polygon[]) => polygons.filter(p => p.closed && p.points.length >= 3).map(p => {
        const ring = [...p.points, p.points[0]];
        const geometry = { type: 'Polygon' as const, coordinates: [ring] };
        if (geoArea(geometry) > 2 * Math.PI) ring.reverse();
        return geometry;
    });
    const polygonsA = surfaces(geometryA.polygons), polygonsB = surfaces(geometryB.polygons);
    return line.slice(1).map((p, i) => {
        const start = latLonToVector(line[i]), end = latLonToVector(p);
        const mid = normalize({ x: start.x + end.x, y: start.y + end.y, z: start.z + end.z });
        let normal = normalize(cross(subtractVectors(end, start), mid));
        // Local occupancy remains meaningful when a plate has remote islands or
        // fragments that put its global centroid on the wrong side of this ridge.
        const probe = (side: number): Coordinate => vectorToLatLon(normalize({ x: mid.x + normal.x * 0.0001 * side, y: mid.y + normal.y * 0.0001 * side, z: mid.z + normal.z * 0.0001 * side }));
        const plus = probe(1), minus = probe(-1);
        const inA = (point: Coordinate) => polygonsA.some(poly => geoContains(poly, point));
        const inB = (point: Coordinate) => polygonsB.some(poly => geoContains(poly, point));
        const score = Number(inB(plus)) + Number(inA(minus)) - Number(inB(minus)) - Number(inA(plus));
        let direction = score;
        if (direction === 0) {
            // After a current-time rebase the ridge is offshore, so immediate
            // probes miss the continents. Their nearest local boundaries retain
            // the side relationship even when remote fragments invert centroids.
            const nearA = nearestBoundaryDirection(geometryA.polygons, mid);
            const nearB = nearestBoundaryDirection(geometryB.polygons, mid);
            direction = nearA && nearB ? dot(normal, subtractVectors(nearB, nearA)) : dot(normal, towardB);
        }
        if (direction < 0) normal = { x: -normal.x, y: -normal.y, z: -normal.z };
        return normal;
    });
}
function segmentRate(line: Coordinate[], i: number, normal: Vector3, a: TectonicPlate, b: TectonicPlate, plates: TectonicPlate[], time: number, radius: number): { opening: number; sliding: number } {
    const v0 = latLonToVector(line[i]);
    const v1 = latLonToVector(line[i + 1]);
    const mid = normalize({ x: v0.x + v1.x, y: v0.y + v1.y, z: v0.z + v1.z });
    // A short forward sample respects linked motion and Euler-pole changes.
    const dt = 0.0001;
    const va = rotateVectorByQuat(mid, rotation(a, plates, time, time + dt));
    const vb = rotateVectorByQuat(mid, rotation(b, plates, time, time + dt));
    const relative = subtractVectors(vb, va);
    const tangent = normalize(cross(mid, normal));
    const kmMaToCmYear = radius / dt / 10;
    return { opening: dot(relative, normal) * kmMaToCmYear, sliding: dot(relative, tangent) * kmMaToCmYear };
}

/** Include motion/link handoffs; uniform samples keep large rotations unambiguous.
 * The budget coarsens extreme timelines rather than hanging the UI. */
function sampleTimes(plates: TectonicPlate[], birth: number, end: number, interval?: number): number[] {
    const requested = Number.isFinite(interval) && interval! > 0 ? Math.max(1, Math.min(5, interval!)) : 5;
    const step = Math.max(requested, (end - birth) / MAX_STEPS);
    const times = new Set<number>([birth, end]);
    for (let i = 1; i < MAX_STEPS && birth + i * step < end - EPS; i++) times.add(birth + i * step);
    for (const plate of plates) {
        for (const t of [plate.birthTime, plate.deathTime, plate.linkTime, plate.unlinkTime, ...plate.motionSegments.map(s => s.time)]) {
            if (t !== undefined && t !== null && t > birth && t < end) times.add(t);
        }
    }
    return [...times].sort((a, b) => a - b);
}

function stopTime(axis: RiftAxis, a: TectonicPlate, b: TectonicPlate): number {
    let stop = Math.min(a.deathTime ?? Infinity, b.deathTime ?? Infinity, axis.frozenTime ?? Infinity, axis.deathTime ?? Infinity);
    if (axis.state !== 'active' && !Number.isFinite(stop)) stop = axis.birthTime;
    return Math.max(axis.birthTime, stop);
}

interface AxisReconstruction {
    axis: RiftAxis;
    a: TectonicPlate;
    b: TectonicPlate;
    birth: Coordinate[];
    normals: Vector3[];
    times: number[];
    rotations: Quaternion[];
    lines: Coordinate[][];
    end: number;
    stop: number;
}

function reconstruct(plates: TectonicPlate[], axis: RiftAxis, time: number, interval?: number): AxisReconstruction | null {
    if (!Number.isFinite(time) || !Number.isFinite(axis.birthTime) || time < axis.birthTime) return null;
    const a = plates.find(p => p.id === axis.plateIdA);
    const b = plates.find(p => p.id === axis.plateIdB);
    if (!a || !b || a.id === b.id || !historicalFlank(a, plates, axis.birthTime) || !historicalFlank(b, plates, axis.birthTime)) return null;
    const birth = sampleLine(axis.birthPolyline);
    if (birth.length < 2) return null;
    const stop = stopTime(axis, a, b);
    const end = Math.min(time, stop);
    const times = sampleTimes(plates, axis.birthTime, end, interval);
    const rotations: Quaternion[] = [QUAT_IDENTITY];
    for (let i = 1; i < times.length; i++) {
        const previous = times[i - 1];
        const next = times[i];
        rotations.push(unitQuaternion(quatMultiply(halfStage(rotation(a, plates, previous, next), rotation(b, plates, previous, next)), rotations[i - 1])));
    }
    const lines = rotations.map(q => birth.map(p => rotateCoordByQuat(p, q)));
    return { axis, a, b, birth, normals: sideNormals(birth, a, b, plates, axis.birthTime), times, rotations, lines, end, stop };
}

/** Public reconstruction used when rebasing a project at the current time. */
export function ridgePolylineAtTime(plates: TectonicPlate[], axis: RiftAxis, time: number, axes: RiftAxis[] = [axis], interval?: number): Coordinate[] | null {
    const reconstruction = reconstructTogether(plates, axes, time, interval).find(r => r.axis.id === axis.id);
    return reconstruction?.lines.at(-1) ?? null;
}

function makePlate(id: string, points: Coordinate[], parent: TectonicPlate, axis: RiftAxis, kind: RidgeKind, oldest: number, youngest: number, rate: number, time: number, color: string): TectonicPlate {
    const isCrust = kind === 'crust';
    const polygon: Polygon = { id: `${id}-geometry`, points, closed: isCrust };
    return {
        id, slabId: id, riftAxisId: axis.id,
        name: isCrust ? `${parent.name} Seafloor ${oldest.toFixed(1)}-${youngest.toFixed(1)} Ma` : kind === 'axis' ? 'Mid-ocean ridge' : 'Ridge transform fault',
        description: isCrust ? 'Derived seafloor advected with its flanking plate.' : 'Derived from adjacent plate motion. Full spreading rate measures opening normal to this segment.',
        type: isCrust ? 'oceanic' : 'rift', polygonType: isCrust ? 'oceanic_plate' : undefined,
        isOceanic: true, generatedBy: parent.id, age: youngest,
        lineType: isCrust ? undefined : kind === 'axis' ? 'divergent' : 'transform',
        color, lineColorCustomized: !isCrust, lineDashCustomized: !isCrust,
        zIndex: isCrust ? (parent.zIndex ?? 0) - 1 : Math.max(parent.zIndex ?? 0, 0) + 1,
        birthTime: oldest, deathTime: null, visible: parent.visible, locked: true,
        center: calculateSphericalCentroid(points), polygons: [polygon], initialPolygons: [polygon],
        features: [], initialFeatures: [], motionSegments: [{ time, eulerPole: { position: [0, 90], rate: 0 } }],
        geometryStages: [{ time, polygons: [polygon], features: [] }],
        connectedRiftIds: [], events: [], hideLinkMarker: true, linkedToPlateId: parent.id, linkTime: time,
        elevation: isCrust ? -oceanDepthAtAge(time - (oldest + youngest) / 2) : undefined,
        midOceanRidge: { kind, fullSpreadingRateCmYr: rate, oldestBirthTime: oldest, youngestBirthTime: youngest },
    };
}

function ring(outer: Coordinate[], inner: Coordinate[]): Coordinate[] | null {
    if (outer.length < 2 || inner.length !== outer.length) return null;
    // Reject zero-area slivers using actual three-dimensional displacement.
    if (outer.every((p, i) => angle(latLonToVector(p), latLonToVector(inner[i])) < EPS)) return null;
    const points = [...outer, ...[...inner].reverse(), outer[0]];
    return points.every(validPoint) ? points : null;
}

/** Shared samples include later branch births, frozen endpoints and motion
 * handoffs. Rebuild rotations on the same schedule before joining endpoints. */
function reconstructTogether(plates: TectonicPlate[], axes: RiftAxis[], time: number, interval?: number): AxisReconstruction[] {
    const reconstructions = axes.map(axis => reconstruct(plates, axis, time, interval)).filter((r): r is AxisReconstruction => r !== null);
    const sharedTimes = [...new Set(reconstructions.flatMap(r => r.times))].sort((a, b) => a - b);
    for (const r of reconstructions) {
        r.times = sharedTimes.filter(t => t >= r.axis.birthTime && t <= r.end);
        r.rotations = [QUAT_IDENTITY];
        for (let i = 1; i < r.times.length; i++) {
            const previous = r.times[i - 1], next = r.times[i];
            r.rotations.push(unitQuaternion(quatMultiply(halfStage(rotation(r.a, plates, previous, next), rotation(r.b, plates, previous, next)), r.rotations[i - 1])));
        }
        r.lines = r.rotations.map(q => r.birth.map(p => rotateCoordByQuat(p, q)));
    }
    joinEndpoints(reconstructions, sharedTimes);
    return reconstructions;
}

/** Extend old ridge ends when new branches are born. Coincidence is tested
 * at the branch's birth in the reconstructed frame, not at the old ridge birth.
 * Tangent-plane intersections approximate ordinary RRR junction kinematics. */
function joinEndpoints(reconstructions: AxisReconstruction[], sharedTimes: number[]): void {
    type Endpoint = { reconstruction: AxisReconstruction; start: boolean };
    type Cluster = { endpoints: Endpoint[]; birth: number };
    const lineAt = (r: AxisReconstruction, t: number): Coordinate[] | undefined => r.lines[r.times.indexOf(t)];
    const pointAt = (e: Endpoint, t: number): Coordinate | undefined => {
        const line = lineAt(e.reconstruction, t);
        return line?.[e.start ? 0 : line.length - 1];
    };
    const clusters: Cluster[] = [];
    const endpoints = reconstructions.flatMap(reconstruction => [true, false].map(start => ({ reconstruction, start })));
    for (let i = 0; i < endpoints.length; i++) {
        for (let j = i + 1; j < endpoints.length; j++) {
            const a = endpoints[i], b = endpoints[j];
            if (a.reconstruction === b.reconstruction) continue;
            const birth = Math.max(a.reconstruction.axis.birthTime, b.reconstruction.axis.birthTime);
            const pa = pointAt(a, birth), pb = pointAt(b, birth);
            if (!pa || !pb || angle(latLonToVector(pa), latLonToVector(pb)) > 0.5 * Math.PI / 180) continue;
            let cluster = clusters.find(c => c.endpoints.includes(a) || c.endpoints.includes(b));
            if (!cluster) { cluster = { endpoints: [], birth }; clusters.push(cluster); }
            if (!cluster.endpoints.includes(a)) cluster.endpoints.push(a);
            if (!cluster.endpoints.includes(b)) cluster.endpoints.push(b);
            cluster.birth = Math.max(cluster.birth, birth);
        }
    }
    for (const cluster of clusters) {
        for (const time of sharedTimes) {
            if (time < cluster.birth) continue;
            const active = cluster.endpoints.filter(e => lineAt(e.reconstruction, time));
            if (active.length < 2) continue;
            const points = active.map(e => pointAt(e, time)!);
            const origin = latLonToVector(calculateSphericalCentroid(points));
            const east = normalize(cross({ x: 0, y: 0, z: 1 }, origin));
            const basisX = dot(east, east) > EPS ? east : { x: 1, y: 0, z: 0 };
            const basisY = normalize(cross(origin, basisX));
            let xx = 0, xy = 0, yy = 0, bx = 0, by = 0;
            for (const { reconstruction, start } of active) {
                const line = lineAt(reconstruction, time)!;
                const p = latLonToVector(line[start ? 0 : line.length - 1]);
                const neighbor = latLonToVector(line[start ? 1 : line.length - 2]);
                const normal = normalize(cross(p, neighbor));
                const nx = dot(normal, basisX), ny = dot(normal, basisY);
                const rhs = -dot(normal, origin);
                xx += nx * nx; xy += nx * ny; yy += ny * ny; bx += nx * rhs; by += ny * rhs;
            }
            const determinant = xx * yy - xy * xy;
            let junction = vectorToLatLon(origin);
            if (determinant > EPS) {
                const x = (bx * yy - by * xy) / determinant;
                const y = (by * xx - bx * xy) / determinant;
                if (Math.hypot(x, y) < 0.1) junction = vectorToLatLon(normalize({ x: origin.x + x * basisX.x + y * basisY.x, y: origin.y + x * basisX.y + y * basisY.y, z: origin.z + x * basisX.z + y * basisY.z }));
            }
            for (const { reconstruction, start } of active) {
                const line = lineAt(reconstruction, time)!;
                line[start ? 0 : line.length - 1] = junction;
            }
        }
    }
}
/** Stateless seafloor production and active ridge/transform lines.
 * Existing isochrons are compatibility data only. Scrubbing and motion edits
 * always reconstruct the same geometry, without mutating any input records. */
export function deriveMidOceanRidges(plates: TectonicPlate[], axes: RiftAxis[], time: number, options: RidgeOptions): TectonicPlate[] {
    const radius = Number.isFinite(options.planetRadius) && options.planetRadius > 0 ? options.planetRadius : 6371;
    const reconstructions = reconstructTogether(plates, axes, time, options.oceanicGenerationInterval);
    const result: TectonicPlate[] = [];
    for (const r of reconstructions) {
        const { a, b, axis, times, lines, rotations, normals } = r;
        for (let step = 1; step < times.length; step++) {
            const t0 = times[step - 1], t1 = times[step];
            const q = halfStage(rotation(a, plates, t0, (t0 + t1) / 2), rotation(b, plates, t0, (t0 + t1) / 2));
            const midRotation = quatMultiply(q, rotations[step - 1]);
            const midline = r.birth.map(p => rotateCoordByQuat(p, midRotation));
            const rates = normals.map((n, i) => segmentRate(midline, i, rotateVectorByQuat(n, midRotation), a, b, plates, (t0 + t1) / 2, radius).opening);
            // Group contiguous spreading segments into a single strip per side.
            for (let start = 0; start < rates.length;) {
                if (rates[start] <= MIN_OPENING_CM_YR) { start++; continue; }
                let end = start + 1;
                while (end < rates.length && rates[end] > MIN_OPENING_CM_YR) end++;
                const rate = rates.slice(start, end).reduce((sum, v) => sum + v, 0) / (end - start);
                for (const [side, parent] of [['A', a], ['B', b]] as const) {
                    const outerRotation = rotation(parent, plates, t0, time);
                    const innerRotation = rotation(parent, plates, t1, time);
                    const outer = lines[step - 1].slice(start, end + 1).map(p => rotateCoordByQuat(p, outerRotation));
                    const inner = lines[step].slice(start, end + 1).map(p => rotateCoordByQuat(p, innerRotation));
                    const points = ring(outer, inner);
                    if (!points) continue;
                    const id = `mor-${axis.id}-${side}-${t0}-${t1}-${start}`;
                    result.push(makePlate(id, points, parent, axis, 'crust', t0, t1, rate, time, options.oceanicCrustColor ?? '#3b82f6'));
                }
                start = end;
            }
        }
        if (time >= r.stop || !historicalFlank(a, plates, time) || !historicalFlank(b, plates, time)) continue;
        const current = lines.at(-1)!;
        const q = rotations.at(-1)!;
        const rates = normals.map((n, i) => segmentRate(current, i, rotateVectorByQuat(n, q), a, b, plates, time, radius));
        for (let start = 0; start < rates.length;) {
            const classify = (i: number): RidgeKind | null => rates[i].opening > MIN_OPENING_CM_YR ? 'axis' : Math.abs(rates[i].opening) <= MIN_OPENING_CM_YR && Math.abs(rates[i].sliding) > MIN_OPENING_CM_YR ? 'transform' : null;
            const kind = classify(start);
            if (!kind) { start++; continue; }
            let end = start + 1;
            while (end < rates.length && classify(end) === kind) end++;
            const rate = Math.max(0, rates.slice(start, end).reduce((sum, v) => sum + v.opening, 0) / (end - start));
            const id = `mor-${axis.id}-${kind}-${start}`;
            const line = makePlate(id, current.slice(start, end + 1), a, axis, kind, axis.birthTime, time, rate, time, kind === 'axis' ? LINE_TYPE_COLORS.divergent : LINE_TYPE_COLORS.transform);
            line.visible = a.visible || b.visible;
            result.push(line);
            start = end;
        }
    }
    return result;
}