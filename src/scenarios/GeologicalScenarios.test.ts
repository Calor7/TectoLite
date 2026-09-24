import { describe, expect, it, vi } from 'vitest';
import { trimScenarioTimeline } from './ScenarioTimeline';
import { branchScenario, createGeologicalScenario, scenarioAge } from './GeologicalScenarios';
import { derivePlateGeometry, insertGeometryEdit } from '../motion/RotationModel';
import { parseProjectText } from '../ProjectIO';
import { CURRENT_SAVE_VERSION } from '../migration';
import { type AppState, type TectonicPlate } from '../types';
import { SimulationEngine } from '../SimulationEngine';
describe('editable geological scenarios', () => {
    for (const kind of ['reconstruction', 'future'] as const)
        for (const details of [false, true]) {
            it(`${kind}/${details}: persists a complete, bounded native history with continuous lifecycle transitions`, async () => {
                const world = await createGeologicalScenario(kind, details);
                const json = JSON.stringify({ version: CURRENT_SAVE_VERSION, name: 'Scenario', world });
                const restored = parseProjectText(json).world;
                expect(restored.scenario).toEqual(world.scenario);
                expect(json.length).toBeLessThan(12000000);
                const ids = new Set(world.plates.map(p => p.id));
                expect(ids.size).toBe(world.plates.length);
                for (const p of world.plates) {
                    expect(p.parentPlateIds?.every(id => ids.has(id)) ?? true).toBe(true);
                    if (p.linkedToPlateId)
                        expect(ids.has(p.linkedToPlateId)).toBe(true);
                    for (const stage of p.geometryStages)
                        for (const poly of stage.polygons)
                            for (const coord of poly.points) {
                                expect(Number.isFinite(coord[0]) && Number.isFinite(coord[1]) && Math.abs(coord[0]) <= 180 && Math.abs(coord[1]) <= 90).toBe(true);
                            }
                }
                const covers = world.plates.filter(p => p.groupId === 'scenario-covers');
                for (const parent of covers.filter(p => p.deathTime !== null)) {
                    const t = parent.deathTime!;
                    const before = derivePlateGeometry(parent, world.plates, t).polygons;
                    const after = covers.filter(p => p.parentPlateIds?.includes(parent.id)).flatMap(p => derivePlateGeometry(p, world.plates, t).polygons);
                    for (const poly of before) {
                        const next = after.find(p => p.id === poly.id);
                        expect(next, `${parent.name}: missing successor polygon`).toBeDefined();
                        const maxError = Math.max(...next!.points.flatMap((p, i) => p.map((n, j) => Math.abs(n - poly.points[i][j]))));
                        expect(maxError).toBeLessThan(1e-8);
                    }
                }
                expect(covers.some(p => p.events.some(e => e.type === 'split'))).toBe(true);
                expect(covers.some(p => p.events.some(e => e.type === 'fusion'))).toBe(true);
                expect(world.plates.some(p => p.motionSegments.some(s => s.eulerPole.rate > 0))).toBe(true);
                expect(world.plates.some(p => p.polygonType === 'island' && p.birthTime > 0)).toBe(true);
            }, 30000);
        }
    it('direct jumps and reverse scrubs agree, and detail covers follow the same carriers', async () => {
        let state: AppState = { world: await createGeologicalScenario('future', true), activeTool: 'select', activeFeatureType: 'mountain', drawMode: 'polygon', activeLineType: 'divergent', activePolygonType: 'generic', viewport: { width: 1280, height: 720, scale: 250, rotate: [0, 0, 0], translate: [640, 360] } };
        const engine = new SimulationEngine(() => state, update => { state = update(state); });
        const snapshot = () => state.world.plates.filter(p => p.birthTime <= state.world.currentTime && (p.deathTime === null || state.world.currentTime < p.deathTime)).map(p => ({ id: p.id, polygons: p.polygons, features: p.features }));
        for (const time of [0, 24.999, 25, 25.001, 60, 150, 299.999, 300, 300.001, 379.999, 380, 380.001, 500]) {
            engine.setTime(time);
            const direct = snapshot();
            engine.setTime(500);
            engine.setTime(0);
            engine.setTime(time);
            expect(snapshot()).toEqual(direct);
            for (const cover of state.world.plates.filter(p => p.groupId === 'scenario-covers' && p.birthTime <= time && (p.deathTime === null || time < p.deathTime))) {
                const carrier = state.world.plates.find(p => p.id === cover.linkedToPlateId)!;
                const a = cover.polygons.flatMap(p => p.points).flat(), b = carrier.polygons.flatMap(p => p.points).flat();
                expect(Math.max(...a.map((n, i) => Math.abs(n - b[i])))).toBeLessThan(1e-8);
            }
        }
    }, 30000);
    it('branches the current chapter into an editable start without future history', async () => {
        const world = await createGeologicalScenario('future', true);
        world.currentTime = 325;
        const branch = branchScenario(world);
        expect(branch.scenario).toBeUndefined();
        expect(branch.currentTime).toBe(0);
        expect(branch.plates.some(p => p.name.includes('Amasia'))).toBe(true);
        expect(branch.plates.every(p => p.birthTime === 0 && p.deathTime === null && p.geometryStages.length === 1 && p.events.length === 0)).toBe(true);
        expect(() => parseProjectText(JSON.stringify({ version: CURRENT_SAVE_VERSION, world: branch }))).not.toThrow();
    });
    it('keeps future successors and geological ages when saving from the middle', async () => {
        for (const kind of ['reconstruction', 'future'] as const) {
            const world = await createGeologicalScenario(kind, true);
            world.currentTime = kind === 'future' ? 112.5 : 62.5;
            const trimmed = trimScenarioTimeline(world);
            const restored = parseProjectText(JSON.stringify({ version: CURRENT_SAVE_VERSION, world: trimmed })).world;
            expect(restored.scenario!.startAge).toBe(world.scenario!.startAge - world.currentTime);
            expect(restored.scenario!.duration).toBe(world.scenario!.duration - world.currentTime);
            for (const time of [world.currentTime, world.currentTime + 3, world.scenario!.duration]) {
                for (const p of world.plates.filter(p => p.birthTime <= time && (p.deathTime === null || p.deathTime > time))) {
                    const survivor = restored.plates.find(s => s.id === p.id)!;
                    expect(survivor).toBeDefined();
                    const original = derivePlateGeometry(p, world.plates, time).polygons.flatMap(p => p.points).flat();
                    const resumed = derivePlateGeometry(survivor, restored.plates, time - world.currentTime).polygons.flatMap(p => p.points).flat();
                    // Trimming preserves the same great-circle interpolation path.
                    expect(Math.max(...original.map((v, i) => Math.abs(v - resumed[i])))).toBeLessThan(1e-6);
                }
            }
        }
    });
    it('pauses at the endpoint without scheduling another animation frame', async () => {
        const world = await createGeologicalScenario('future', false);
        world.currentTime = 499.999;
        world.isPlaying = true;
        let state: AppState = { world, activeTool: 'select', activeFeatureType: 'mountain', drawMode: 'polygon', activeLineType: 'divergent', activePolygonType: 'generic', viewport: { width: 1280, height: 720, scale: 250, rotate: [0, 0, 0], translate: [640, 360] } };
        const engine = new SimulationEngine(() => state, update => { state = update(state); });
        let frame: FrameRequestCallback | undefined;
        const request = vi.fn((callback: FrameRequestCallback) => { frame = callback; return 1; });
        vi.stubGlobal('requestAnimationFrame', request);
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
        const now = vi.spyOn(performance, 'now').mockReturnValue(0);
        try {
            engine.start();
            now.mockReturnValue(1000);
            frame!(1000);
            expect(state.world.currentTime).toBe(500);
            expect(state.world.isPlaying).toBe(false);
            expect(request).toHaveBeenCalledTimes(1);
        }
        finally {
            engine.stop();
            now.mockRestore();
            vi.unstubAllGlobals();
        }
    });
    it('interpolates deformation in the moving frame and preserves it before a user shape edit', async () => {
        const world = await createGeologicalScenario('future', false);
        const plate = world.plates.find(p => p.id === 'scenario-emergent-island')!;
        const at70 = derivePlateGeometry(plate, world.plates, 70);
        expect(at70.polygons[0].points[0][0]).toBeGreaterThan(155.12);
        expect(at70.polygons[0].points[0][0]).toBeLessThan(158);
        const edited = structuredClone(at70.polygons);
        edited[0].points[0][0] += 1;
        const before = derivePlateGeometry(plate, world.plates, 65);
        const changed: TectonicPlate = { ...plate, geometryStages: insertGeometryEdit(plate, world.plates, 70, edited, []) };
        // Inserting a snapshot preserves the original great-circle path.
        expect(derivePlateGeometry(changed, world.plates, 65).polygons[0].points[0][0]).toBeCloseTo(before.polygons[0].points[0][0], 3);
        expect(derivePlateGeometry(changed, world.plates, 70).polygons[0].points).toEqual(edited[0].points);
    });
    it('keeps time meaning and import metadata explicit', async () => {
        const world = await createGeologicalScenario('reconstruction', false);
        expect(scenarioAge(world.scenario!, 0)).toBe('200 Ma ago');
        expect(scenarioAge(world.scenario!, 200)).toBe('Present day');
        world.scenario!.sources[0].url = 'javascript:alert(1)';
        expect(() => parseProjectText(JSON.stringify({ version: CURRENT_SAVE_VERSION, world }))).toThrow('HTTPS');
    });
});
