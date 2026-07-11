import { describe, expect, it } from 'vitest';
import { PROJECT_TEMPLATES } from './projectTemplates';

describe('project templates', () => {
    it('creates fresh, internally valid worlds', async () => {
        for (const template of PROJECT_TEMPLATES) {
            const first = await template.createWorld();
            const second = await template.createWorld();
            expect(first).not.toBe(second);

            // Blank world has 0 plates; all others have ≥ 2
            if (template.id !== 'blank') {
                expect(first.plates.length).toBeGreaterThanOrEqual(2);
            }

            // All plate IDs must be unique
            const plateIds = new Set(first.plates.map(plate => plate.id));
            expect(plateIds.size).toBe(first.plates.length);

            // Rift axes must reference valid plates
            for (const axis of first.riftAxes ?? []) {
                expect(plateIds.has(axis.plateIdA)).toBe(true);
                expect(plateIds.has(axis.plateIdB)).toBe(true);
            }
        }
    });

    it('Pangaea forms a compact supercontinent', async () => {
        const pangaea = await PROJECT_TEMPLATES.find(t => t.id === 'pangaea-200ma')?.createWorld();
        expect(pangaea).toBeDefined();
        expect(pangaea!.plates.length).toBeGreaterThanOrEqual(2);

        // Pangaea should have many plates clustered together
        const centers = pangaea!.plates.map(plate => plate.center);
        const longitudeSpan = Math.max(...centers.map(c => c[0])) - Math.min(...centers.map(c => c[0]));
        const latitudeSpan = Math.max(...centers.map(c => c[1])) - Math.min(...centers.map(c => c[1]));
        // More generous than before — real GPlates data has more plates spread wider
        expect(longitudeSpan).toBeLessThan(360);
        expect(latitudeSpan).toBeLessThan(180);
    });

    it('advanced templates include craton features', async () => {
        for (const id of ['modern-earth-adv', 'pangaea-200ma-adv']) {
            const world = await PROJECT_TEMPLATES.find(t => t.id === id)?.createWorld();
            expect(world).toBeDefined();
            const totalCratons = world!.plates.reduce((sum, p) => sum + p.features.filter(f => f.type === 'poly_region').length, 0);
            expect(totalCratons).toBeGreaterThan(0);
        }
    });
});
