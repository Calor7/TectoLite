import { describe, expect, it } from 'vitest';
import type { TectonicPlate } from '../types';
import { renderMotionLinks } from './MotionLinks';

function plate(id: string, overrides: Partial<TectonicPlate> = {}): TectonicPlate {
    return {
        id, name: id, birthTime: 0, deathTime: null, visible: true, locked: false,
        color: '#ffffff', center: [0, 0], polygons: [], features: [], initialPolygons: [], initialFeatures: [],
        motionSegments: [], geometryStages: [], events: [], connectedRiftIds: [], ...overrides,
    };
}

describe('selected plate motion links', () => {
    it('selects the parent but unlinks the child in a Follows row', () => {
        const parent = plate('parent');
        const child = plate('child', { linkedToPlateId: parent.id, linkTime: 599 });
        const html = renderMotionLinks(child, [parent, child], 620);
        expect(html).toContain('>Follows</div>');
        expect(html).toContain('data-select-linked-plate="parent"');
        expect(html).toContain('data-unlink-child="child"');
        expect(html).toContain('data-link-status="active"');
        expect(html).not.toContain('disabled');
    });

    it('gives each follower its own selection and unlink action', () => {
        const parent = plate('parent');
        const children = ['one', 'two'].map(id => plate(id, { linkedToPlateId: parent.id }));
        const html = renderMotionLinks(parent, [parent, ...children], 620);
        expect(html).toContain('Followed by');
        for (const child of children) {
            expect(html).toContain(`data-select-linked-plate="${child.id}"`);
            expect(html).toContain(`data-unlink-child="${child.id}"`);
        }
        expect(html).not.toContain('data-unlink-child="parent"');
    });

    it('only enables unlink inside the active lifetime and link window', () => {
        const parent = plate('parent');
        const child = plate('child', { birthTime: 620, linkedToPlateId: parent.id, linkTime: 621, unlinkTime: 630 });
        const render = (time: number) => renderMotionLinks(child, [parent, child], time);
        expect(render(620)).toContain('Starts at 621 Ma');
        expect(render(620)).toMatch(/data-unlink-child="child"\s+disabled/);
        expect(render(621)).toContain('Active · until 630 Ma');
        expect(render(621)).not.toContain('disabled');
        expect(render(630)).toContain('Ended at 630 Ma');
        expect(render(630)).toMatch(/data-unlink-child="child"\s+disabled/);

        const retired = { ...child, deathTime: 625 };
        expect(renderMotionLinks(retired, [parent, retired], 626)).toContain('Plate retired at 625 Ma');
        expect(renderMotionLinks(retired, [parent, retired], 626)).toMatch(/data-unlink-child="child"\s+disabled/);
    });

    it('escapes plate names and disables navigation to a missing source', () => {
        const parent = plate('parent', { name: '<img src=x onerror="bad()">' });
        const child = plate('child', { linkedToPlateId: parent.id });
        const html = renderMotionLinks(child, [parent, child], 620);
        expect(html).not.toContain('<img');
        expect(html).toContain('&lt;img');
        const missing = renderMotionLinks(child, [child], 620);
        expect(missing).toContain('Missing plate');
        expect(missing).toMatch(/data-select-linked-plate=""\s+disabled/);
        expect(missing).toMatch(/data-unlink-child="child"\s+disabled/);
        expect(renderMotionLinks(parent, [parent], 620)).toContain('Follow another plate…');
    });
});
