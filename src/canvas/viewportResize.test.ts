import { describe, expect, it } from 'vitest';
import { resizeViewportAroundCanvasCenter } from './viewportResize';

describe('resizeViewportAroundCanvasCenter', () => {
    it('keeps the same view offset from the center while docks change the canvas size', () => {
        const before = { width: 1200, height: 800, translate: [640, 370] as [number, number], scale: 240 };
        const after = resizeViewportAroundCanvasCenter(before, 860, 620);

        expect(after.translate[0] - after.width / 2).toBe(before.translate[0] - before.width / 2);
        expect(after.translate[1] - after.height / 2).toBe(before.translate[1] - before.height / 2);
        expect(after.scale).toBe(240);
    });
});
