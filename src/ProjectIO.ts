import { CURRENT_SAVE_VERSION, migrateSaveFile, type SaveFile } from './migration';
import {
    createDefaultWorldState,
    type CameraView,
    type Coordinate,
    type TectonicPlate,
    type Viewport,
    type WorldState,
} from './types';

/** Hard limits are intentionally generous for real projects, but finite for hostile input. */
export const PROJECT_LIMITS = Object.freeze({
    jsonBytes: 96 * 1024 * 1024,
    dataUrlBytes: 12 * 1024 * 1024,
    totalDataUrlBytes: 64 * 1024 * 1024,
    plates: 5_000,
    polygons: 100_000,
    coordinates: 2_000_000,
    features: 100_000,
    labels: 10_000,
    groups: 2_000,
    overlays: 64,
    timelineRecords: 250_000,
    cameraViews: 100,
    string: 200_000,
    name: 200,
    description: 10_000,
    id: 256,
    nestingDepth: 48,
    totalValues: 4_000_000,
});

export class ProjectFileError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ProjectFileError';
    }
}

export interface LoadedProject {
    world: WorldState;
    viewport?: Viewport;
    name: string;
    savedAt?: string;
    activeTool?: string;
    activeFeatureType?: string;
    cameraViews?: CameraView[];
}

const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const SAFE_COLOR = /^(?:#[0-9a-f]{3,8}|rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+(?:\s*,\s*[\d.]+)?\s*\))$/i;
const SAFE_IMAGE_DATA = /^data:image\/(?:png|jpeg|webp|gif);base64,/i;

function fail(path: string, message: string): never {
    throw new ProjectFileError(`${path}: ${message}`);
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'must be an object');
    return value as Record<string, unknown>;
}

function asArray(value: unknown, path: string, max: number): unknown[] {
    if (!Array.isArray(value)) fail(path, 'must be an array');
    if (value.length > max) fail(path, `contains too many items (maximum ${max.toLocaleString()})`);
    return value;
}

function requireString(value: unknown, path: string, max: number, allowEmpty = false): string {
    if (typeof value !== 'string') fail(path, 'must be text');
    if (!allowEmpty && value.length === 0) fail(path, 'must not be empty');
    if (value.length > max) fail(path, `is too long (maximum ${max.toLocaleString()} characters)`);
    return value;
}

function requireId(value: unknown, path: string): string {
    const id = requireString(value, path, PROJECT_LIMITS.id);
    if (!SAFE_ID.test(id)) fail(path, 'contains unsupported characters');
    return id;
}

function optionalString(record: Record<string, unknown>, key: string, path: string, max: number): void {
    const value = record[key];
    if (value !== undefined && value !== null) requireString(value, `${path}.${key}`, max, true);
}

function finiteNumber(value: unknown, path: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) fail(path, 'must be a finite number');
    return value;
}

function numericPair(value: unknown, path: string): [number, number] {
    const pair = asArray(value, path, 2);
    if (pair.length !== 2) fail(path, 'must contain two numbers');
    finiteNumber(pair[0], `${path}[0]`);
    finiteNumber(pair[1], `${path}[1]`);
    return pair as [number, number];
}

function coordinate(value: unknown, path: string, budget: ValidationBudget): Coordinate {
    const pair = numericPair(value, path);
    const longitude = finiteNumber(pair[0], `${path}[0]`);
    const latitude = finiteNumber(pair[1], `${path}[1]`);
    if (longitude < -180 || longitude > 180) fail(`${path}[0]`, 'longitude must be between -180 and 180');
    if (latitude < -90 || latitude > 90) fail(`${path}[1]`, 'latitude must be between -90 and 90');
    budget.coordinates++;
    if (budget.coordinates > PROJECT_LIMITS.coordinates) fail(path, 'project contains too many coordinates');
    return pair as Coordinate;
}

interface ValidationBudget {
    coordinates: number;
    polygons: number;
    features: number;
    timelineRecords: number;
    dataUrlBytes: number;
}

/** Reject dangerous object shapes, non-finite numbers, excessive nesting and oversized unknown values. */
function validateGenericTree(root: unknown): void {
    const stack: Array<{ value: unknown; path: string; depth: number }> = [{ value: root, path: 'project', depth: 0 }];
    let values = 0;
    while (stack.length) {
        const { value, path, depth } = stack.pop()!;
        if (++values > PROJECT_LIMITS.totalValues) fail(path, 'project contains too many values');
        if (depth > PROJECT_LIMITS.nestingDepth) fail(path, 'project is nested too deeply');
        if (typeof value === 'number' && !Number.isFinite(value)) fail(path, 'must be a finite number');
        const stringLimit = path.endsWith('.imageData') ? PROJECT_LIMITS.dataUrlBytes * 2 : PROJECT_LIMITS.string;
        if (typeof value === 'string' && value.length > stringLimit) fail(path, 'text value is too long');
        if (!value || typeof value !== 'object') continue;
        if (Array.isArray(value)) {
            if (value.length > PROJECT_LIMITS.totalValues) fail(path, 'array is too large');
            value.forEach((child, index) => stack.push({ value: child, path: `${path}[${index}]`, depth: depth + 1 }));
            continue;
        }
        for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
            if (FORBIDDEN_KEYS.has(key)) fail(`${path}.${key}`, 'property is not allowed');
            stack.push({ value: child, path: `${path}.${key}`, depth: depth + 1 });
        }
    }
}

function validateColor(record: Record<string, unknown>, key: string, _path: string, fallback: string): void {
    const value = record[key];
    if (typeof value !== 'string' || !SAFE_COLOR.test(value)) record[key] = fallback;
}

function validatePolygon(value: unknown, path: string, budget: ValidationBudget): void {
    const polygon = asRecord(value, path);
    requireId(polygon.id, `${path}.id`);
    const points = asArray(polygon.points, `${path}.points`, PROJECT_LIMITS.coordinates);
    points.forEach((point, index) => coordinate(point, `${path}.points[${index}]`, budget));
    if (points.length < 2) fail(`${path}.points`, 'must contain at least two coordinates');
    if (typeof polygon.closed !== 'boolean') fail(`${path}.closed`, 'must be true or false');
    budget.polygons++;
    if (budget.polygons > PROJECT_LIMITS.polygons) fail(path, 'project contains too many polygons');
}

function validateFeature(value: unknown, path: string, budget: ValidationBudget): void {
    const feature = asRecord(value, path);
    requireId(feature.id, `${path}.id`);
    requireString(feature.type, `${path}.type`, 32);
    coordinate(feature.position, `${path}.position`, budget);
    finiteNumber(feature.rotation, `${path}.rotation`);
    finiteNumber(feature.scale, `${path}.scale`);
    if (!feature.properties || typeof feature.properties !== 'object' || Array.isArray(feature.properties)) feature.properties = {};
    if (feature.originalPosition !== undefined) coordinate(feature.originalPosition, `${path}.originalPosition`, budget);
    if (feature.polygon !== undefined) {
        asArray(feature.polygon, `${path}.polygon`, PROJECT_LIMITS.coordinates)
            .forEach((point, index) => coordinate(point, `${path}.polygon[${index}]`, budget));
    }
    optionalString(feature, 'name', path, PROJECT_LIMITS.name);
    optionalString(feature, 'description', path, PROJECT_LIMITS.description);
    if (feature.fillColor !== undefined) validateColor(feature, 'fillColor', path, '#888888');
    budget.features++;
    if (budget.features > PROJECT_LIMITS.features) fail(path, 'project contains too many features');
}

function validatePolygonArray(value: unknown, path: string, budget: ValidationBudget): void {
    asArray(value, path, PROJECT_LIMITS.polygons)
        .forEach((polygon, index) => validatePolygon(polygon, `${path}[${index}]`, budget));
}

function validateFeatureArray(value: unknown, path: string, budget: ValidationBudget): void {
    asArray(value, path, PROJECT_LIMITS.features)
        .forEach((feature, index) => validateFeature(feature, `${path}[${index}]`, budget));
}

function validateStage(value: unknown, path: string, budget: ValidationBudget): void {
    const stage = asRecord(value, path);
    finiteNumber(stage.time, `${path}.time`);
    validatePolygonArray(stage.polygons, `${path}.polygons`, budget);
    validateFeatureArray(stage.features, `${path}.features`, budget);
    budget.timelineRecords++;
}

function validatePlate(value: unknown, path: string, budget: ValidationBudget, legacy: boolean): void {
    const plate = asRecord(value, path);
    requireId(plate.id, `${path}.id`);
    requireString(plate.name, `${path}.name`, PROJECT_LIMITS.name);
    optionalString(plate, 'description', path, PROJECT_LIMITS.description);
    validateColor(plate, 'color', path, '#4a9c6d');
    coordinate(plate.center, `${path}.center`, budget);
    finiteNumber(plate.birthTime, `${path}.birthTime`);
    if (plate.deathTime !== null) finiteNumber(plate.deathTime, `${path}.deathTime`);
    if (typeof plate.visible !== 'boolean') fail(`${path}.visible`, 'must be true or false');
    if (typeof plate.locked !== 'boolean') fail(`${path}.locked`, 'must be true or false');
    validatePolygonArray(plate.polygons, `${path}.polygons`, budget);
    validateFeatureArray(plate.features, `${path}.features`, budget);
    validatePolygonArray(plate.initialPolygons ?? plate.polygons, `${path}.initialPolygons`, budget);
    validateFeatureArray(plate.initialFeatures ?? plate.features, `${path}.initialFeatures`, budget);

    if (!Array.isArray(plate.initialPolygons)) plate.initialPolygons = plate.polygons;
    if (!Array.isArray(plate.initialFeatures)) plate.initialFeatures = plate.features;
    if (!Array.isArray(plate.events)) plate.events = [];
    if (!Array.isArray(plate.connectedRiftIds)) plate.connectedRiftIds = [];
    asArray(plate.events, `${path}.events`, PROJECT_LIMITS.timelineRecords).forEach((event, index) => {
        const record = asRecord(event, `${path}.events[${index}]`);
        requireId(record.id, `${path}.events[${index}].id`);
        finiteNumber(record.time, `${path}.events[${index}].time`);
        budget.timelineRecords++;
    });

    if (Array.isArray(plate.motionSegments)) {
        if (plate.motionSegments.length === 0) fail(`${path}.motionSegments`, 'must not be empty');
        asArray(plate.motionSegments, `${path}.motionSegments`, PROJECT_LIMITS.timelineRecords).forEach((segment, index) => {
            const record = asRecord(segment, `${path}.motionSegments[${index}]`);
            finiteNumber(record.time, `${path}.motionSegments[${index}].time`);
            const pole = asRecord(record.eulerPole, `${path}.motionSegments[${index}].eulerPole`);
            coordinate(pole.position, `${path}.motionSegments[${index}].eulerPole.position`, budget);
            finiteNumber(pole.rate, `${path}.motionSegments[${index}].eulerPole.rate`);
            budget.timelineRecords++;
        });
    } else if (!legacy) {
        fail(`${path}.motionSegments`, 'must be an array');
    }
    if (Array.isArray(plate.geometryStages)) {
        if (plate.geometryStages.length === 0) fail(`${path}.geometryStages`, 'must not be empty');
        asArray(plate.geometryStages, `${path}.geometryStages`, PROJECT_LIMITS.timelineRecords)
            .forEach((stage, index) => validateStage(stage, `${path}.geometryStages[${index}]`, budget));
    } else if (!legacy) {
        fail(`${path}.geometryStages`, 'must be an array');
    }
    if (budget.timelineRecords > PROJECT_LIMITS.timelineRecords) fail(path, 'project contains too many timeline records');
}

function validateOverlay(value: unknown, path: string, budget: ValidationBudget): void {
    const overlay = asRecord(value, path);
    if (overlay.id !== undefined) requireId(overlay.id, `${path}.id`);
    optionalString(overlay, 'name', path, PROJECT_LIMITS.name);
    const imageData = requireString(overlay.imageData, `${path}.imageData`, PROJECT_LIMITS.dataUrlBytes * 2);
    if (!SAFE_IMAGE_DATA.test(imageData)) fail(`${path}.imageData`, 'must be a PNG, JPEG, WebP, or GIF data URL');
    const payload = imageData.slice(imageData.indexOf(',') + 1);
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(payload)) fail(`${path}.imageData`, 'contains invalid base64 image data');
    const bytes = Math.ceil(imageData.length * 0.75);
    if (bytes > PROJECT_LIMITS.dataUrlBytes) fail(`${path}.imageData`, 'embedded image is too large');
    budget.dataUrlBytes += bytes;
    if (budget.dataUrlBytes > PROJECT_LIMITS.totalDataUrlBytes) fail(path, 'project contains too much embedded image data');
}

function normalizeAndValidateSave(raw: unknown, fallbackName: string): SaveFile {
    validateGenericTree(raw);
    const data = asRecord(raw, 'project') as unknown as SaveFile;
    const rawVersion = (data as unknown as Record<string, unknown>).version;
    if (rawVersion !== undefined && (!Number.isInteger(rawVersion) || (rawVersion as number) < 0)) {
        fail('project.version', 'must be a non-negative integer');
    }
    const version = typeof rawVersion === 'number' ? rawVersion : 0;
    if (version > CURRENT_SAVE_VERSION) {
        fail('project.version', `version ${version} is newer than this app supports (${CURRENT_SAVE_VERSION})`);
    }
    const worldRecord = asRecord(data.world, 'project.world');
    finiteNumber(worldRecord.currentTime, 'project.world.currentTime');
    if (worldRecord.timeScale !== undefined) finiteNumber(worldRecord.timeScale, 'project.world.timeScale');
    if (worldRecord.projection !== undefined && !['equirectangular', 'mollweide', 'mercator', 'robinson', 'orthographic'].includes(String(worldRecord.projection))) {
        fail('project.world.projection', 'is not a supported projection');
    }
    const options = worldRecord.globalOptions === undefined
        ? {}
        : asRecord(worldRecord.globalOptions, 'project.world.globalOptions');
    validateColor(options, 'oceanicCrustColor', 'project.world.globalOptions', '#3b82f6');
    if (options.lineTypeDefaults !== undefined) {
        const defaults = asRecord(options.lineTypeDefaults, 'project.world.globalOptions.lineTypeDefaults');
        for (const type of ['divergent', 'convergent', 'transform', 'generic']) {
            if (defaults[type] === undefined) continue;
            const style = asRecord(defaults[type], `project.world.globalOptions.lineTypeDefaults.${type}`);
            validateColor(style, 'color', `project.world.globalOptions.lineTypeDefaults.${type}`, '#95A5A6');
            if (style.dash === undefined) style.dash = [];
            asArray(style.dash, `project.world.globalOptions.lineTypeDefaults.${type}.dash`, 16)
                .forEach((number, index) => {
                    if (finiteNumber(number, `project.world.globalOptions.lineTypeDefaults.${type}.dash[${index}]`) < 0) {
                        fail(`project.world.globalOptions.lineTypeDefaults.${type}.dash[${index}]`, 'must not be negative');
                    }
                });
        }
    }
    if (options.ratePresets !== undefined) {
        asArray(options.ratePresets, 'project.world.globalOptions.ratePresets', 100)
            .forEach((number, index) => finiteNumber(number, `project.world.globalOptions.ratePresets[${index}]`));
    }
    worldRecord.globalOptions = options;
    const plates = asArray(worldRecord.plates, 'project.world.plates', PROJECT_LIMITS.plates);
    const budget: ValidationBudget = { coordinates: 0, polygons: 0, features: 0, timelineRecords: 0, dataUrlBytes: 0 };
    const ids = new Set<string>();
    plates.forEach((plate, index) => {
        validatePlate(plate, `project.world.plates[${index}]`, budget, version < 4);
        const id = (plate as TectonicPlate).id;
        if (ids.has(id)) fail(`project.world.plates[${index}].id`, 'plate IDs must be unique');
        ids.add(id);
    });

    if (!Array.isArray(worldRecord.labels)) worldRecord.labels = [];
    if (!Array.isArray(worldRecord.entityGroups)) worldRecord.entityGroups = [];
    if (!Array.isArray(worldRecord.imageOverlays)) worldRecord.imageOverlays = [];
    if (!Array.isArray(worldRecord.riftAxes)) worldRecord.riftAxes = [];
    if (!Array.isArray(worldRecord.tripleJunctions)) worldRecord.tripleJunctions = [];
    asArray(worldRecord.labels, 'project.world.labels', PROJECT_LIMITS.labels).forEach((value, index) => {
        const label = asRecord(value, `project.world.labels[${index}]`);
        requireId(label.id, `project.world.labels[${index}].id`);
        requireString(label.title, `project.world.labels[${index}].title`, PROJECT_LIMITS.name, true);
        requireString(label.content, `project.world.labels[${index}].content`, PROJECT_LIMITS.description, true);
        coordinate(label.anchor, `project.world.labels[${index}].anchor`, budget);
        numericPair(label.offset, `project.world.labels[${index}].offset`);
        validateColor(label, 'color', `project.world.labels[${index}]`, '#f59e0b');
    });
    asArray(worldRecord.entityGroups, 'project.world.entityGroups', PROJECT_LIMITS.groups).forEach((value, index) => {
        const group = asRecord(value, `project.world.entityGroups[${index}]`);
        requireId(group.id, `project.world.entityGroups[${index}].id`);
        requireString(group.name, `project.world.entityGroups[${index}].name`, PROJECT_LIMITS.name);
    });
    asArray(worldRecord.imageOverlays, 'project.world.imageOverlays', PROJECT_LIMITS.overlays)
        .forEach((overlay, index) => validateOverlay(overlay, `project.world.imageOverlays[${index}]`, budget));
    if (worldRecord.imageOverlay !== undefined) validateOverlay(worldRecord.imageOverlay, 'project.world.imageOverlay', budget);
    asArray(worldRecord.riftAxes, 'project.world.riftAxes', PROJECT_LIMITS.timelineRecords).forEach((value, index) => {
        const axis = asRecord(value, `project.world.riftAxes[${index}]`);
        requireId(axis.id, `project.world.riftAxes[${index}].id`);
        requireId(axis.plateIdA, `project.world.riftAxes[${index}].plateIdA`);
        requireId(axis.plateIdB, `project.world.riftAxes[${index}].plateIdB`);
        asArray(axis.birthPolyline, `project.world.riftAxes[${index}].birthPolyline`, PROJECT_LIMITS.coordinates)
            .forEach((point, pointIndex) => coordinate(point, `project.world.riftAxes[${index}].birthPolyline[${pointIndex}]`, budget));
        finiteNumber(axis.birthTime, `project.world.riftAxes[${index}].birthTime`);
        asArray(axis.isochrons, `project.world.riftAxes[${index}].isochrons`, PROJECT_LIMITS.timelineRecords).forEach((value, isoIndex) => {
            const isochron = asRecord(value, `project.world.riftAxes[${index}].isochrons[${isoIndex}]`);
            finiteNumber(isochron.time, `project.world.riftAxes[${index}].isochrons[${isoIndex}].time`);
            asArray(isochron.polyline, `project.world.riftAxes[${index}].isochrons[${isoIndex}].polyline`, PROJECT_LIMITS.coordinates)
                .forEach((point, pointIndex) => coordinate(point, `project.world.riftAxes[${index}].isochrons[${isoIndex}].polyline[${pointIndex}]`, budget));
            budget.timelineRecords++;
        });
    });
    asArray(worldRecord.tripleJunctions, 'project.world.tripleJunctions', PROJECT_LIMITS.timelineRecords).forEach((value, index) => {
        const junction = asRecord(value, `project.world.tripleJunctions[${index}]`);
        requireId(junction.id, `project.world.tripleJunctions[${index}].id`);
        asArray(junction.axisIds, `project.world.tripleJunctions[${index}].axisIds`, PROJECT_LIMITS.timelineRecords)
            .forEach((id, idIndex) => requireId(id, `project.world.tripleJunctions[${index}].axisIds[${idIndex}]`));
        finiteNumber(junction.birthTime, `project.world.tripleJunctions[${index}].birthTime`);
    });
    if (Array.isArray(worldRecord.mantlePlumes)) {
        asArray(worldRecord.mantlePlumes, 'project.world.mantlePlumes', PROJECT_LIMITS.features).forEach((value, index) => {
            const plume = asRecord(value, `project.world.mantlePlumes[${index}]`);
            requireId(plume.id, `project.world.mantlePlumes[${index}].id`);
            coordinate(plume.position, `project.world.mantlePlumes[${index}].position`, budget);
            // v10 and older saves may carry retired automatic-spawn settings.
            if (plume.radius !== undefined) finiteNumber(plume.radius, `project.world.mantlePlumes[${index}].radius`);
            if (plume.strength !== undefined) finiteNumber(plume.strength, `project.world.mantlePlumes[${index}].strength`);
            if (plume.spawnRate !== undefined) finiteNumber(plume.spawnRate, `project.world.mantlePlumes[${index}].spawnRate`);
        });
    }

    migrateSaveFile(data);

    // Fill harmless fields omitted by old saves while preserving all authored data.
    const defaults = createDefaultWorldState();
    data.world = {
        ...defaults,
        ...data.world,
        labels: data.world.labels ?? [],
        entityGroups: data.world.entityGroups ?? [],
        imageOverlays: data.world.imageOverlays ?? [],
        riftAxes: data.world.riftAxes ?? [],
        tripleJunctions: data.world.tripleJunctions ?? [],
        selectedPlateIds: data.world.selectedPlateIds ?? [],
        selectedFeatureIds: data.world.selectedFeatureIds ?? [],
        globalOptions: { ...defaults.globalOptions, ...(data.world.globalOptions ?? {}) },
    };
    data.name = typeof data.name === 'string' && data.name.length
        ? requireString(data.name, 'project.name', PROJECT_LIMITS.name)
        : fallbackName;
    if (data.savedAt !== undefined) requireString(data.savedAt, 'project.savedAt', 100);

    if (data.viewport !== undefined) {
        const viewport = asRecord(data.viewport, 'project.viewport');
        for (const key of ['width', 'height', 'scale'] as const) finiteNumber(viewport[key], `project.viewport.${key}`);
        numericPair(viewport.translate, 'project.viewport.translate');
        const rotate = asArray(viewport.rotate, 'project.viewport.rotate', 3);
        if (rotate.length !== 3) fail('project.viewport.rotate', 'must have three values');
        rotate.forEach((value, index) => finiteNumber(value, `project.viewport.rotate[${index}]`));
    }
    if (data.cameraViews !== undefined) {
        asArray(data.cameraViews, 'project.cameraViews', PROJECT_LIMITS.cameraViews).forEach((value, index) => {
            const view = asRecord(value, `project.cameraViews[${index}]`);
            requireString(view.name, `project.cameraViews[${index}].name`, PROJECT_LIMITS.name);
            finiteNumber(view.scale, `project.cameraViews[${index}].scale`);
            const rotate = asArray(view.rotate, `project.cameraViews[${index}].rotate`, 3);
            if (rotate.length !== 3) fail(`project.cameraViews[${index}].rotate`, 'must have three values');
            rotate.forEach((number, numberIndex) => finiteNumber(number, `project.cameraViews[${index}].rotate[${numberIndex}]`));
            if (view.offset !== undefined) numericPair(view.offset, `project.cameraViews[${index}].offset`);
        });
    }
    if (data.activeTool !== undefined && !['select', 'draw', 'feature', 'poly_feature', 'split', 'pan', 'view_pan', 'fuse', 'link', 'edit', 'paint', 'label'].includes(String(data.activeTool))) {
        data.activeTool = undefined;
    }
    if (data.activeFeatureType !== undefined && !['mountain', 'volcano', 'hotspot', 'rift', 'trench', 'island', 'weakness', 'poly_region', 'seafloor'].includes(String(data.activeFeatureType))) {
        data.activeFeatureType = undefined;
    }
    return data;
}

/** The single project-file seam: parse, bound, validate, migrate and normalize before use. */
export function parseProjectText(text: string, fallbackName = 'Imported project'): LoadedProject {
    if (typeof text !== 'string') fail('project', 'must be JSON text');
    if (new TextEncoder().encode(text).byteLength > PROJECT_LIMITS.jsonBytes) {
        fail('project', `file exceeds the ${Math.round(PROJECT_LIMITS.jsonBytes / 1024 / 1024)} MB safety limit`);
    }
    let raw: unknown;
    try {
        raw = JSON.parse(text);
    } catch {
        throw new ProjectFileError('Project file is not valid JSON');
    }
    const data = normalizeAndValidateSave(raw, fallbackName);
    return {
        world: data.world,
        viewport: data.viewport as Viewport | undefined,
        name: data.name ?? fallbackName,
        savedAt: typeof data.savedAt === 'string' ? data.savedAt : undefined,
        activeTool: typeof data.activeTool === 'string' ? data.activeTool : undefined,
        activeFeatureType: typeof data.activeFeatureType === 'string' ? data.activeFeatureType : undefined,
        cameraViews: Array.isArray(data.cameraViews) ? data.cameraViews as CameraView[] : undefined,
    };
}

export function assertProjectFileSize(bytes: number): void {
    if (!Number.isFinite(bytes) || bytes < 0) throw new ProjectFileError('Project file size is invalid');
    if (bytes > PROJECT_LIMITS.jsonBytes) {
        throw new ProjectFileError(`Project file exceeds the ${Math.round(PROJECT_LIMITS.jsonBytes / 1024 / 1024)} MB safety limit`);
    }
}
