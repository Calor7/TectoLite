import { describe, expect, it, vi } from 'vitest';
import { resizeCanvasToViewport, resizeViewportAroundCanvasCenter } from './viewportResize';

describe('resizeViewportAroundCanvasCenter', () => {
    it('centers a view saved on a larger canvas without changing zoom or rotation', () => {
        const saved = { width: 1600, height: 900, translate: [800, 450] as [number, number], scale: 280, rotate: [12, -25, 0] };
        const loaded = resizeViewportAroundCanvasCenter(saved, 800, 600);

        expect(loaded).toEqual({ ...saved, width: 800, height: 600, translate: [400, 300] });
        expect(saved.translate).toEqual([800, 450]);
        expect(resizeViewportAroundCanvasCenter(loaded, 800, 600)).toEqual(loaded);
    });

    it('keeps the same view offset from the center while docks change the canvas size', () => {
        const before = { width: 1200, height: 800, translate: [640, 370] as [number, number], scale: 240 };
        const after = resizeViewportAroundCanvasCenter(before, 860, 620);

        expect(after.translate[0] - after.width / 2).toBe(before.translate[0] - before.width / 2);
        expect(after.translate[1] - after.height / 2).toBe(before.translate[1] - before.height / 2);
        expect(after.scale).toBe(240);
    });
});

describe('resizeCanvasToViewport', () => {
    it('reconciles a loaded camera without clearing an already sized canvas or accumulating drift', () => {
        const viewport = { width: 1600, height: 900, translate: [800, 450] as [number, number], scale: 280, rotate: [12, -25, 0] };
        const clearWidth = vi.fn();
        const clearHeight = vi.fn();
        const context = { scale: vi.fn() };
        const canvas = {
            parentElement: { getBoundingClientRect: () => ({ width: 800, height: 600 }) },
            style: { width: '', height: '' },
            get width() { return 1600; }, set width(n: number) { clearWidth(n); },
            get height() { return 1200; }, set height(n: number) { clearHeight(n); }
        };

        const loaded = resizeCanvasToViewport(canvas, context, viewport, 2)!;
        expect(loaded).toEqual({ ...viewport, width: 800, height: 600, translate: [400, 300] });
        expect(clearWidth).not.toHaveBeenCalled();
        expect(clearHeight).not.toHaveBeenCalled();
        expect(context.scale).not.toHaveBeenCalled();
        expect(resizeCanvasToViewport(canvas, context, loaded, 2)).toBeNull();

        const panned = resizeCanvasToViewport(canvas, context, { ...viewport, translate: [835, 420] }, 2)!;
        expect(panned.translate).toEqual([435, 270]);
        expect(resizeCanvasToViewport(canvas, context, panned, 1)).toBe(panned);
        expect(clearWidth).toHaveBeenCalledWith(800);
        expect(clearHeight).toHaveBeenCalledWith(600);
        expect(context.scale).toHaveBeenCalledWith(1, 1);
    });

    it('waits for a canvas container before adapting the viewport', () => {
        const canvas = { width: 1, height: 1, style: { width: '', height: '' }, parentElement: null };
        expect(resizeCanvasToViewport(canvas, { scale: vi.fn() }, { width: 800, height: 600, translate: [400, 300] }, 1)).toBeNull();
    });
});
