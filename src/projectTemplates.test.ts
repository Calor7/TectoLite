import { describe, expect, it } from 'vitest';
import { PROJECT_TEMPLATES } from './projectTemplates';

describe('project templates', () => {
    it('creates fresh, internally valid worlds', async () => {
        for (const template of PROJECT_TEMPLATES) {
            const first = await template.createWorld();
            const second = await template.createWorld();
            expect(first).not.toBe(second);
            expect(first.plates.length).toBeGreaterThanOrEqual(2);
            expect(first.plates.every(plate => (plate.motionSegments?.[0].eulerPole.rate ?? 0) !== 0)).toBe(true);

            const plateIds = new Set(first.plates.map(plate => plate.id));
            expect(plateIds.size).toBe(first.plates.length);
            for (const axis of first.riftAxes ?? []) {
                expect(plateIds.has(axis.plateIdA)).toBe(true);
                expect(plateIds.has(axis.plateIdB)).toBe(true);
            }
        }
    });

    it('places Pangaea regions into a compact supercontinent arrangement', async () => {
        const pangaea = await PROJECT_TEMPLATES.find(template => template.id === 'pangaea-200ma')?.createWorld();
        expect(pangaea).toBeDefined();
        const centers = pangaea!.plates.map(plate => plate.center);
        const longitudeSpan = Math.max(...centers.map(center => center[0])) - Math.min(...centers.map(center => center[0]));
        const latitudeSpan = Math.max(...centers.map(center => center[1])) - Math.min(...centers.map(center => center[1]));
        expect(longitudeSpan).toBeLessThan(100);
        expect(latitudeSpan).toBeLessThan(100);
    });
});
