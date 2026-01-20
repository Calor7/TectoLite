// PNG Export functionality
import { AppState, Feature, WorldState } from './types';
import { ProjectionManager } from './canvas/ProjectionManager';
import { geoGraticule } from 'd3-geo';
import { toGeoJSON } from './utils/geoHelpers';
import {
    drawMountainIcon,
    drawVolcanoIcon,
    drawHotspotIcon,
    drawRiftIcon,
    drawTrenchIcon,
    drawIslandIcon
} from './canvas/featureIcons';

export function exportToPNG(
    state: AppState,
    width: number = 1920,
    height: number = 1080
): void {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Use a temporary ProjectionManager for rendering
    const pm = new ProjectionManager(ctx);

    // Setup viewport for export: Center the view, fit width?
    // User expects WYSIWYG roughly.
    // Let's use the current viewport settings but scaled to the new resolution.
    // ratio = exportWidth / viewportWidth
    const ratio = width / state.viewport.width;

    const exportViewport = {
        ...state.viewport,
        width: width,
        height: height,
        scale: state.viewport.scale * ratio,
        translate: [width / 2, height / 2] as [number, number]
    };

    pm.update(state.world.projection, exportViewport);
    const path = pm.getPathGenerator();

    // 1. Background
    ctx.fillStyle = '#1a3a4a';
    ctx.fillRect(0, 0, width, height);

    // Globe Background
    if (state.world.projection === 'orthographic') {
        ctx.beginPath();
        path({ type: 'Sphere' } as any);
        ctx.fillStyle = '#0f2634';
        ctx.fill();
    }

    // 2. Graticule
    if (state.world.showGrid) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
        ctx.lineWidth = 1 * ratio;
        ctx.beginPath();
        path(geoGraticule()());
        ctx.stroke();
    }

    // 3. Plates
    for (const plate of state.world.plates) {
        if (!plate.visible) continue;
        if (state.world.currentTime < plate.birthTime) continue;
        if (plate.deathTime !== null && state.world.currentTime >= plate.deathTime) continue;

        // Polygons
        for (const polygon of plate.polygons) {
            const geojson = toGeoJSON(polygon);
            ctx.beginPath();
            path(geojson);
            ctx.fillStyle = plate.color;
            ctx.fill();

            ctx.strokeStyle = 'rgba(0,0,0,0.3)';
            ctx.lineWidth = 1 * ratio;
            ctx.stroke();
        }

        // Features
        for (const feature of plate.features) {
            drawFeature(ctx, pm, feature, ratio);
        }
    }

    // Trigger download
    const link = document.createElement('a');
    link.download = `tectolite-export-${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
}

function drawFeature(
    ctx: CanvasRenderingContext2D,
    pm: ProjectionManager,
    feature: Feature,
    scaleRatio: number
): void {
    const proj = pm.project(feature.position);
    if (!proj) return;

    const size = 12 * feature.scale * scaleRatio;

    ctx.save();
    ctx.translate(proj[0], proj[1]);
    ctx.rotate(feature.rotation * Math.PI / 180);

    switch (feature.type) {
        case 'mountain': drawMountainIcon(ctx, size); break;
        case 'volcano': drawVolcanoIcon(ctx, size); break;
        case 'hotspot': drawHotspotIcon(ctx, size); break;
        case 'rift': drawRiftIcon(ctx, size); break;
        case 'trench': drawTrenchIcon(ctx, size); break;
        case 'island': drawIslandIcon(ctx, size); break;
    }

    ctx.restore();
}

// JSON Export functionality
const SAVE_VERSION = 1;

export function exportToJSON(state: AppState): void {
    const saveData = {
        version: SAVE_VERSION,
        savedAt: new Date().toISOString(),
        world: state.world
    };

    const json = JSON.stringify(saveData, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const link = document.createElement('a');
    link.download = `tectolite-save-${Date.now()}.json`;
    link.href = URL.createObjectURL(blob);
    link.click();
    URL.revokeObjectURL(link.href);
}

export function importFromJSON(file: File): Promise<WorldState> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const text = e.target?.result as string;
                const data = JSON.parse(text);

                // Validate version
                if (!data.version || data.version > SAVE_VERSION) {
                    throw new Error('Unsupported save file version');
                }

                // Validate world data exists
                if (!data.world || !Array.isArray(data.world.plates)) {
                    throw new Error('Invalid save file format');
                }

                resolve(data.world as WorldState);
            } catch (err) {
                reject(err);
            }
        };
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsText(file);
    });
}


