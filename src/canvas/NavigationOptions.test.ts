import { describe, expect, it } from 'vitest';
import type { Viewport } from '../types';
import { constrainViewTranslation, rotateViewport, translateViewport } from './NavigationOptions';

const viewport: Viewport = {
    width: 800,
    height: 600,
    scale: 250,
    rotate: [0, 0, 0],
    translate: [400, 300]
};

describe('navigation options', () => {
    it('applies sensitivity and reverse direction consistently', () => {
        const normal = translateViewport(viewport, 20, -10, { sensitivity: 1.5, reverseDrag: false, keepMapReachable: false });
        const reversed = translateViewport(viewport, 20, -10, { sensitivity: 1.5, reverseDrag: true, keepMapReachable: false });

        expect(normal).toEqual([430, 285]);
        expect(reversed).toEqual([370, 315]);
        expect(rotateViewport(viewport, 20, 10, { sensitivity: 1, reverseDrag: true, keepMapReachable: false })[0]).toBeLessThan(0);
    });

    it('keeps part of a translated map reachable when enabled', () => {
        expect(constrainViewTranslation(viewport, [-5000, 5000], true)).toEqual([-202, 802]);
        expect(constrainViewTranslation(viewport, [-5000, 5000], false)).toEqual([-5000, 5000]);
    });
});
