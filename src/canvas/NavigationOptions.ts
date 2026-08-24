import type { Coordinate, Viewport } from '../types';

export interface NavigationOptions {
    sensitivity: number;
    reverseDrag: boolean;
    keepMapReachable: boolean;
}

export function rotateViewport(viewport: Viewport, dx: number, dy: number, options: NavigationOptions): Viewport['rotate'] {
    const direction = options.reverseDrag ? -1 : 1;
    const sensitivity = ((180 / Math.PI) / (viewport.scale || 250)) * options.sensitivity * direction;
    const rotate = [...viewport.rotate] as Viewport['rotate'];
    rotate[0] += dx * sensitivity;
    rotate[1] = Math.max(-90, Math.min(90, rotate[1] - dy * sensitivity));
    return rotate;
}

export function constrainViewTranslation(
    viewport: Viewport,
    translate: Coordinate,
    keepMapReachable: boolean,
    visibleMargin = 48
): Coordinate {
    if (!keepMapReachable) return translate;
    const reach = Math.max(visibleMargin, viewport.scale);
    return [
        Math.max(visibleMargin - reach, Math.min(viewport.width - visibleMargin + reach, translate[0])),
        Math.max(visibleMargin - reach, Math.min(viewport.height - visibleMargin + reach, translate[1]))
    ];
}

export function translateViewport(viewport: Viewport, dx: number, dy: number, options: NavigationOptions): Coordinate {
    const direction = options.reverseDrag ? -1 : 1;
    const translate: Coordinate = [
        viewport.translate[0] + dx * options.sensitivity * direction,
        viewport.translate[1] + dy * options.sensitivity * direction
    ];
    return constrainViewTranslation(viewport, translate, options.keepMapReachable);
}
