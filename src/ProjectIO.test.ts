import { describe, expect, it } from 'vitest';
import { CURRENT_SAVE_VERSION } from './migration';
import { assertProjectFileSize, parseProjectText, PROJECT_LIMITS, ProjectFileError } from './ProjectIO';
import { createDefaultWorldState, type TectonicPlate } from './types';
import { escapeHtml } from './ui/safeHtml';

function makePlate(name = 'Safe plate'): TectonicPlate {
    const polygon = { id: 'poly-1', points: [[0, 0], [2, 0], [1, 1]] as [number, number][], closed: true };
    return {
        id: 'plate-1',
        name,
        color: '#4a9c6d',
        center: [1, 0.3],
        birthTime: 0,
        deathTime: null,
        visible: true,
        locked: false,
        polygons: [polygon],
        initialPolygons: [polygon],
        features: [],
        initialFeatures: [],
        motionSegments: [{ time: 0, eulerPole: { position: [0, 90], rate: 0 } }],
        geometryStages: [{ time: 0, polygons: [polygon], features: [] }],
        connectedRiftIds: [],
        events: [],
    } as TectonicPlate;
}

function project(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    const world = createDefaultWorldState();
    world.plates = [makePlate()];
    return { version: CURRENT_SAVE_VERSION, name: 'Project', world, ...overrides };
}

describe('ProjectIO', () => {
    it('keeps untrusted display text as literal data and provides safe HTML interpolation', () => {
        const malicious = '<img src=x onerror="globalThis.pwned=true">';
        const raw = project();
        (raw.world as ReturnType<typeof createDefaultWorldState>).plates[0].name = malicious;

        const loaded = parseProjectText(JSON.stringify(raw));

        expect(loaded.world.plates[0].name).toBe(malicious);
        expect(escapeHtml(loaded.world.plates[0].name)).toBe('&lt;img src=x onerror=&quot;globalThis.pwned=true&quot;&gt;');
    });

    it('rejects future versions before migration', () => {
        expect(() => parseProjectText(JSON.stringify(project({ version: CURRENT_SAVE_VERSION + 1 }))))
            .toThrow(/newer than this app supports/);
    });

    it('rejects malformed and non-finite coordinates', () => {
        const raw = JSON.stringify(project()).replace('[[0,0],[2,0],[1,1]]', '[[0,0],[2,1e400],[1,1]]');
        expect(() => parseProjectText(raw)).toThrow(/finite number/);
    });

    it('rejects excessive entity counts', () => {
        const raw = project();
        (raw.world as ReturnType<typeof createDefaultWorldState>).entityGroups = Array.from(
            { length: PROJECT_LIMITS.groups + 1 },
            (_, index) => ({ id: `group-${index}`, name: `Group ${index}` }),
        );
        expect(() => parseProjectText(JSON.stringify(raw))).toThrow(/too many items/);
    });

    it('rejects oversized files and display strings before use', () => {
        expect(() => assertProjectFileSize(PROJECT_LIMITS.jsonBytes + 1)).toThrow(/safety limit/);
        const raw = project();
        (raw.world as ReturnType<typeof createDefaultWorldState>).plates[0].name = 'x'.repeat(PROJECT_LIMITS.name + 1);
        expect(() => parseProjectText(JSON.stringify(raw))).toThrow(/too long/);
    });

    it('repairs oversized automatic operation names from older saves', () => {
        const raw = project();
        const plate = (raw.world as ReturnType<typeof createDefaultWorldState>).plates[0];
        plate.name = `${'x'.repeat(PROJECT_LIMITS.name)} (Fused)`;

        const loaded = parseProjectText(JSON.stringify(raw));

        expect(loaded.world.plates[0].name).toHaveLength(PROJECT_LIMITS.name);
        expect(loaded.world.plates[0].name).toMatch(/ \(Fused\)$/);
    });

    it('rejects executable or oversized embedded image formats', () => {
        const raw = project();
        (raw.world as ReturnType<typeof createDefaultWorldState>).imageOverlays = [{
            id: 'overlay-1', name: 'SVG', imageData: 'data:image/svg+xml;base64,PHN2Zy8+',
            visible: true, opacity: 1, scale: 1, offsetX: 0, offsetY: 0, rotation: 0, mode: 'fixed',
        }];
        expect(() => parseProjectText(JSON.stringify(raw))).toThrow(/PNG, JPEG, WebP, or GIF/);
    });

    it('rejects prototype-pollution keys', () => {
        const text = JSON.stringify(project()).replace('"name":"Project"', '"__proto__":{"polluted":true},"name":"Project"');
        expect(() => parseProjectText(text)).toThrow(/property is not allowed/);
        expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
    });

    it('migrates a valid legacy save and fills current harmless defaults', () => {
        const raw = project({ version: 3 });
        const plate = (raw.world as ReturnType<typeof createDefaultWorldState>).plates[0];
        const plateRecord = plate as unknown as Record<string, unknown>;
        delete plateRecord.motionSegments;
        delete plateRecord.geometryStages;
        plateRecord.motionKeyframes = [{
            time: 0,
            eulerPole: { position: [0, 90], rate: 0 },
            snapshotPolygons: plate.polygons,
            snapshotFeatures: [],
        }];
        delete (raw.world as Record<string, unknown>).labels;

        const loaded = parseProjectText(JSON.stringify(raw));

        expect(loaded.world.labels).toEqual([]);
        expect(loaded.world.plates[0].motionSegments).toHaveLength(1);
        expect(loaded.world.plates[0].geometryStages).toHaveLength(1);
    });

    it('uses actionable project errors', () => {
        expect(() => parseProjectText('{nope')).toThrow(ProjectFileError);
        expect(() => parseProjectText('{nope')).toThrow(/not valid JSON/);
    });
});
