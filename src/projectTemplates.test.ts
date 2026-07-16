import { describe, expect, it } from 'vitest';
import { PROJECT_TEMPLATES } from './projectTemplates';

describe('project templates', () => {
    it('offers only the five focused starting templates', () => {
        expect(PROJECT_TEMPLATES.map(template => [template.id, template.name])).toEqual([
            ['blank', 'Blank World'],
            ['modern-earth-curation-covers', 'Earth — Covers'],
            ['pangaea-200ma-covers', 'Pangaea — Covers'],
            ['modern-earth-overview', 'Earth — Covers + Plates'],
            ['pangaea-200ma-overview', 'Pangaea — Covers + Plates']
        ]);
    });

    it('creates fresh, internally valid worlds', async () => {
        for (const template of PROJECT_TEMPLATES) {
            const first = await template.createWorld();
            const second = await template.createWorld();
            expect(first).not.toBe(second);

            if (template.id !== 'blank') expect(first.plates.length).toBeGreaterThanOrEqual(2);

            const plateIds = new Set(first.plates.map(plate => plate.id));
            expect(plateIds.size).toBe(first.plates.length);
            for (const axis of first.riftAxes ?? []) {
                expect(plateIds.has(axis.plateIdA)).toBe(true);
                expect(plateIds.has(axis.plateIdB)).toBe(true);
            }
        }
    });

    it('creates detailed cover-only Earth and Pangaea worlds with approximate motion', async () => {
        const expected = [
            {
                id: 'modern-earth-curation-covers', covers: 594, timelineMax: 50,
                names: ['Afro-Eurasia', 'Americas', 'Great Britain', 'Ireland', 'New Guinea', 'Borneo', 'Sumatra', 'Java', 'Luzon', 'Mindanao']
            },
            {
                id: 'pangaea-200ma-covers', covers: 14, timelineMax: 200,
                names: ['Pangaea']
            }
        ];

        for (const definition of expected) {
            const world = await PROJECT_TEMPLATES.find(template => template.id === definition.id)?.createWorld();
            expect(world).toBeDefined();
            expect(world!.plates).toHaveLength(definition.covers);
            expect(world!.globalOptions.timelineMaxTime).toBe(definition.timelineMax);
            expect(world!.plates.every(plate => plate.name.startsWith('Cover — '))).toBe(true);
            expect(world!.plates.every(plate => plate.polygonType === 'generic')).toBe(true);
            expect(world!.plates.every(plate => plate.polygons.length === 1)).toBe(true);
            expect(world!.plates.every(plate => plate.initialPolygons.length === 1)).toBe(true);
            expect(world!.plates.every(plate => plate.geometryStages.every(stage => stage.polygons.length === 1))).toBe(true);
            expect(world!.plates.every(plate => (plate.motionSegments[0]?.eulerPole.rate ?? 0) > 0)).toBe(true);
            for (const name of definition.names) {
                expect(world!.plates.some(plate => plate.name === `Cover — ${name}`)).toBe(true);
            }
        }

        const earth = await PROJECT_TEMPLATES.find(template => template.id === 'modern-earth-curation-covers')!.createWorld();
        for (const name of ['Great Britain', 'Ireland', 'New Guinea', 'Borneo', 'Sumatra', 'Java', 'Luzon', 'Mindanao']) {
            const cover = earth.plates.find(plate => plate.name === `Cover — ${name}`);
            expect(cover?.polygons[0].points.length).toBeGreaterThan(100);
        }
        expect(earth.plates.reduce((sum, cover) => sum + cover.polygons[0].points.length, 0)).toBeGreaterThan(70000);

        const pangaea = await PROJECT_TEMPLATES.find(template => template.id === 'pangaea-200ma-covers')!.createWorld();
        expect(pangaea.plates.find(plate => plate.name === 'Cover — Pangaea')?.polygons[0].points.length).toBeGreaterThan(4000);
    });

    it('adds simplified continental plates and cratons to the combined templates', async () => {
        const expected = [
            { id: 'modern-earth-overview', covers: 594, timelineMax: 50 },
            { id: 'pangaea-200ma-overview', covers: 14, timelineMax: 200 }
        ];

        for (const definition of expected) {
            const world = await PROJECT_TEMPLATES.find(template => template.id === definition.id)?.createWorld();
            expect(world).toBeDefined();
            const covers = world!.plates.filter(plate => plate.name.startsWith('Cover — '));
            const plates = world!.plates.filter(plate => plate.name.startsWith('Plate — '));
            const cratons = world!.plates.filter(plate => plate.name.startsWith('Craton — '));

            expect(covers).toHaveLength(definition.covers);
            expect(plates).toHaveLength(57);
            expect(cratons).toHaveLength(36);
            expect(world!.plates).toHaveLength(definition.covers + 57 + 36);
            expect(world!.globalOptions.timelineMaxTime).toBe(definition.timelineMax);

            for (const name of ['Australia', 'Madagascar', 'Peninsular India', 'South China']) {
                expect(plates.some(plate => plate.name === `Plate — ${name}`)).toBe(true);
            }
            for (const name of ['Amazonia', 'Baltica', 'Congo', 'Gawler', 'Hearne', 'Kaapvaal', 'Pilbara', 'Siberia', 'Superior', 'Yilgarn']) {
                expect(cratons.some(craton => craton.name === `Craton — ${name}`)).toBe(true);
            }

            for (const layer of [covers, plates, cratons]) {
                expect(layer.every(item => item.polygons.length === 1)).toBe(true);
                expect(layer.every(item => item.initialPolygons.length === 1)).toBe(true);
                expect(layer.every(item => item.geometryStages.every(stage => stage.polygons.length === 1))).toBe(true);
            }
            expect(covers.every(cover => (cover.zIndex ?? -1) < 100)).toBe(true);
            expect(plates.every(plate => (plate.zIndex ?? 0) >= 100 && (plate.zIndex ?? 0) < 200)).toBe(true);
            expect(cratons.every(craton => (craton.zIndex ?? 0) >= 200)).toBe(true);
            expect(world!.plates.every(plate => (plate.motionSegments[0]?.eulerPole.rate ?? 0) > 0)).toBe(true);

            const oceanicName = /\b(ocean|trench|ridge|arc|sea|shelf|plateau|rise|knoll|bank)\b|bismark basin|sandwich plate|\bfiji\b|\btonga\b|kermadec|new hebrides|norfolk|vitiaz/i;
            expect(plates.some(plate => oceanicName.test(plate.name))).toBe(false);
        }
    });
});
