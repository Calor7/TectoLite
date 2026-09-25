export interface CenteredViewport {
    width: number;
    height: number;
    translate: [number, number];
}

interface ResizableCanvas {
    width: number;
    height: number;
    style: { width: string; height: string };
    parentElement: { getBoundingClientRect(): { width: number; height: number } } | null;
}

/** Reconcile both canvas pixels and a saved viewport with the current layout. */
export function resizeCanvasToViewport<T extends CenteredViewport>(
    canvas: ResizableCanvas,
    context: { scale(x: number, y: number): void },
    viewport: T,
    pixelRatio: number
): T | null {
    if (!canvas.parentElement) return null;
    const rect = canvas.parentElement.getBoundingClientRect();
    const nextWidth = Math.max(1, Math.floor(rect.width * pixelRatio));
    const nextHeight = Math.max(1, Math.floor(rect.height * pixelRatio));
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    // Assigning a canvas dimension clears its pixels, even for the same value.
    // A loaded viewport may need adapting without clearing the backing store.
    const pixelsChanged = canvas.width !== nextWidth || canvas.height !== nextHeight;
    const viewportChanged = viewport.width !== rect.width || viewport.height !== rect.height;
    if (!pixelsChanged && !viewportChanged) return null;
    if (pixelsChanged) {
        canvas.width = nextWidth;
        canvas.height = nextHeight;
        context.scale(pixelRatio, pixelRatio);
    }
    return viewportChanged
        ? resizeViewportAroundCanvasCenter(viewport, rect.width, rect.height)
        : viewport;
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
