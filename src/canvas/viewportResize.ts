export interface CenteredViewport {
    width: number;
    height: number;
    translate: [number, number];
}

export function resizeViewportAroundCanvasCenter<T extends CenteredViewport>(
    viewport: T,
    width: number,
    height: number
): T {
    return {
        ...viewport,
        width,
        height,
        translate: [
            width / 2 + (viewport.translate[0] - viewport.width / 2),
            height / 2 + (viewport.translate[1] - viewport.height / 2)
        ]
    };
}
