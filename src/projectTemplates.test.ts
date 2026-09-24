import { describe, expect, it } from 'vitest';
import { PROJECT_TEMPLATES } from './projectTemplates';

describe('project templates', () => {
    it('keeps the five static starts alongside four playable timelines', () => {
        expect(PROJECT_TEMPLATES.filter(template => !template.timeline).map(template => [template.id, template.name])).toEqual([
            ['blank', 'Blank World'],
            ['modern-earth-curation-covers', 'Earth — Covers'],
            ['pangaea-200ma-covers', 'Pangaea — Covers'],
            ['modern-earth-overview', 'Earth — Covers + Plates'],
            ['pangaea-200ma-overview', 'Pangaea — Covers + Plates']
        ]);
        expect(PROJECT_TEMPLATES.filter(template => template.timeline)).toHaveLength(4);
    });

    it('creates fresh, internally valid worlds', async () => {
        for (const template of PROJECT_TEMPLATES) {
            const first = await template.createWorld();
            const second = await template.createWorld();
            expect(first).not.toBe(second);

            if (template.id !== 'blank') expect(first.plates.length).toBeGreaterThanOrEqual(2);

            const plateIds = new Set(first.plates.map(plate => plate.id));
            expect(plateIds.size).toBe(first.plates.length);
            const groupIds = new Set(first.entityGroups.map(group => group.id));
            expect(groupIds.size).toBe(first.entityGroups.length);
            expect(first.plates.every(plate => !plate.groupId || groupIds.has(plate.groupId))).toBe(true);
            for (const axis of first.riftAxes ?? []) {
                expect(plateIds.has(axis.plateIdA)).toBe(true);
                expect(plateIds.has(axis.plateIdB)).toBe(true);
            }
        }
    });

    it('creates detailed cover-only Earth and Pangaea worlds with approximate motion', async () => {
        const expected = [
            {
                id: 'modern-earth-curation-covers', covers: 600, timelineMax: 50,
                names: ['Africa', 'Europe', 'Asia', 'Arabian Peninsula', 'Indian Subcontinent', 'North America', 'Central America', 'South America', 'Great Britain', 'Ireland', 'New Guinea', 'Borneo', 'Sumatra', 'Java', 'Luzon', 'Mindanao']
            },
            {
                id: 'pangaea-200ma-covers', covers: 15, timelineMax: 200,
                names: ['Laurasia', 'Gondwana']
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
        expect(earth.entityGroups.map(group => group.name)).toEqual(expect.arrayContaining([
            'Major continuous landmasses', 'Africa & nearby islands', 'Asia & nearby islands',
            'Europe & nearby islands', 'North America & Caribbean', 'South America & nearby islands',
            'Oceania & Pacific islands', 'Antarctica & subantarctic islands'
        ]));
        expect(earth.plates.every(plate => !!plate.groupId)).toBe(true);
        const continentalCovers = ['Africa', 'Europe', 'Asia'].map(name =>
            earth.plates.find(plate => plate.name === `Cover — ${name}`)!
        );
        expect(earth.plates.some(plate => plate.name === 'Cover — Afro-Eurasia')).toBe(false);
        expect(continentalCovers.every(cover => cover.polygons.length === 1)).toBe(true);
        expect(continentalCovers.every(cover => cover.polygons[0].points.length > 2000)).toBe(true);
        expect(continentalCovers.every(cover =>
            earth.entityGroups.find(group => group.id === cover.groupId)?.name === 'Major continuous landmasses'
        )).toBe(true);
        expect(continentalCovers[0].motionSegments[0].eulerPole.rate)
            .not.toBe(continentalCovers[1].motionSegments[0].eulerPole.rate);
        const americanCovers = ['North America', 'South America'].map(name =>
            earth.plates.find(plate => plate.name === `Cover — ${name}`)!
        );
        expect(earth.plates.some(plate => plate.name === 'Cover — Americas')).toBe(false);
        expect(americanCovers.every(cover => cover.polygons.length === 1)).toBe(true);
        expect(americanCovers.every(cover => cover.polygons[0].points.length > 3000)).toBe(true);
        expect(americanCovers.every(cover =>
            earth.entityGroups.find(group => group.id === cover.groupId)?.name === 'Major continuous landmasses'
        )).toBe(true);
        expect(americanCovers[0].motionSegments[0].eulerPole.rate)
            .not.toBe(americanCovers[1].motionSegments[0].eulerPole.rate);
        const regionalCovers = ['Central America', 'Arabian Peninsula', 'Indian Subcontinent'].map(name =>
            earth.plates.find(plate => plate.name === `Cover — ${name}`)!
        );
        expect(regionalCovers.every(cover => cover.polygons.length === 1)).toBe(true);
        expect(regionalCovers.every(cover => cover.polygons[0].points.length > 500)).toBe(true);
        expect(earth.entityGroups.find(group => group.id === regionalCovers[0].groupId)?.name)
            .toBe('North America & Caribbean');
        expect(regionalCovers.slice(1).every(cover =>
            earth.entityGroups.find(group => group.id === cover.groupId)?.name === 'Asia & nearby islands'
        )).toBe(true);
        expect(regionalCovers[1].motionSegments[0].eulerPole.rate)
            .not.toBe(regionalCovers[2].motionSegments[0].eulerPole.rate);
        for (const name of ['Great Britain', 'Ireland', 'New Guinea', 'Borneo', 'Sumatra', 'Java', 'Luzon', 'Mindanao']) {
            const cover = earth.plates.find(plate => plate.name === `Cover — ${name}`);
            expect(cover?.polygons[0].points.length).toBeGreaterThan(100);
        }
        expect(earth.plates.reduce((sum, cover) => sum + cover.polygons[0].points.length, 0)).toBeGreaterThan(70000);

        const pangaea = await PROJECT_TEMPLATES.find(template => template.id === 'pangaea-200ma-covers')!.createWorld();
        expect(pangaea.entityGroups.map(group => group.name)).toEqual([
            'Main Pangaea regions', 'Independent reconstructed landmasses'
        ]);
        const pangaeaRegions = ['Laurasia', 'Gondwana'].map(name =>
            pangaea.plates.find(plate => plate.name === `Cover — ${name}`)!
        );
        expect(pangaea.plates.some(plate => plate.name === 'Cover — Pangaea')).toBe(false);
        expect(pangaeaRegions.every(region => region.polygons.length === 1)).toBe(true);
        expect(pangaeaRegions.every(region => region.polygons[0].points.length > 1500)).toBe(true);
        expect(pangaeaRegions.every(region => region.groupId === 'pangaea-main')).toBe(true);
        expect(pangaeaRegions[0].motionSegments[0].eulerPole.rate)
            .not.toBe(pangaeaRegions[1].motionSegments[0].eulerPole.rate);
    });

    it('uses the identical curated cover set in both variants of each epoch', async () => {
        const signature = (templateId: string) => PROJECT_TEMPLATES
            .find(template => template.id === templateId)!
            .createWorld()
            .then(world => world.plates
                .filter(plate => plate.name.startsWith('Cover — '))
                .map(plate => ({
                    name: plate.name,
                    groupId: plate.groupId,
                    points: plate.polygons[0].points.length,
                    motion: plate.motionSegments[0].eulerPole
                })));

        await expect(signature('modern-earth-overview'))
            .resolves.toEqual(await signature('modern-earth-curation-covers'));
        await expect(signature('pangaea-200ma-overview'))
            .resolves.toEqual(await signature('pangaea-200ma-covers'));
    });

    it('adds simplified continental plates and cratons to the combined templates', async () => {
        const expected = [
            { id: 'modern-earth-overview', covers: 600, timelineMax: 50 },
            { id: 'pangaea-200ma-overview', covers: 15, timelineMax: 200 }
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
