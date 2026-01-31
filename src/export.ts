// PNG Export functionality
import { AppState, Feature, WorldState, ProjectionType, GeoPackageExportOptions } from './types';
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

export interface PNGExportOptions {
    projection: ProjectionType;
    waterMode: 'transparent' | 'color' | 'white';
    plateColorMode: 'native' | 'land';
    showGrid: boolean;
}

export function exportToPNG(
    state: AppState,
    options: PNGExportOptions,
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

    // Setup viewport for export
    // Use the current viewport settings but scaled to the new resolution
    const ratio = width / state.viewport.width;

    const exportViewport = {
        ...state.viewport,
        width: width,
        height: height,
        scale: state.viewport.scale * ratio,
        translate: [width / 2, height / 2] as [number, number]
    };

    // Use requested projection
    pm.update(options.projection, exportViewport);
    const path = pm.getPathGenerator();

    // 1. Background (Water)
    if (options.waterMode === 'color') {
        ctx.fillStyle = '#1a3a4a'; // Deep Ocean
        ctx.fillRect(0, 0, width, height);
    } else if (options.waterMode === 'white') {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
    }
    // If transparent, do nothing (canvas is transparent by default)

    // Globe Background (only for Orthographic if not transparent)
    if (options.projection === 'orthographic' && options.waterMode !== 'transparent') {
        ctx.beginPath();
        path({ type: 'Sphere' } as any);
        ctx.fillStyle = options.waterMode === 'white' ? '#f0f0f0' : '#0f2634';
        ctx.fill();
    }

    // 2. Graticule
    if (options.showGrid) {
        ctx.strokeStyle = options.waterMode === 'white' ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.05)';
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

            // Plate Color Logic
            if (options.plateColorMode === 'land') {
                ctx.fillStyle = '#C2B280'; // Ecru/Sand Land Color
            } else {
                ctx.fillStyle = plate.color;
            }
            ctx.fill();

            // Border
            ctx.strokeStyle = options.waterMode === 'white' ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.3)';
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

// Heightmap Export Dialog
export interface HeightmapExportOptions {
    width: number;
    height: number;
    projection: ProjectionType;
}

export function showHeightmapExportDialog(defaultWidth: number = 4096, defaultHeight: number = 2048): Promise<HeightmapExportOptions | null> {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position: fixed; top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.7); z-index: 10000;
            display: flex; align-items: center; justify-content: center;
        `;

        const dialog = document.createElement('div');
        dialog.style.cssText = `
            background: #1e1e2e; border-radius: 12px; padding: 24px;
            min-width: 350px; color: #cdd6f4; font-family: system-ui, sans-serif;
            box-shadow: 0 8px 32px rgba(0,0,0,0.4);
        `;

        dialog.innerHTML = `
            <h3 style="margin: 0 0 16px 0; color: #89b4fa;">🗺️ Export Heightmap</h3>
            
            <div style="margin-bottom: 16px;">
                <label style="display: block; margin-bottom: 8px; font-weight: 500;">Projection:</label>
                <select id="hm-projection" style="width: 100%; padding: 8px 12px; border: 1px solid #45475a; border-radius: 6px; background: #313244; color: #cdd6f4;">
                    <option value="equirectangular">Equirectangular</option>
                    <option value="mercator">Mercator</option>
                    <option value="mollweide">Mollweide</option>
                    <option value="robinson">Robinson</option>
                    <option value="orthographic">Orthographic (Globe)</option>
                    <option value="qgis-note" disabled style="font-style: italic; color: #a6adc8;">QGIS: Export PNG first, then import</option>
                </select>
            </div>
            
            <div style="margin-bottom: 16px;">
                <label style="display: block; margin-bottom: 8px; font-weight: 500;">Resolution:</label>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                    <div>
                        <label style="font-size: 12px; color: #a6adc8;">Width</label>
                        <input type="number" id="hm-width" value="${defaultWidth}" 
                            style="width: 100%; padding: 8px; border: 1px solid #45475a; border-radius: 6px; background: #313244; color: #cdd6f4;">
                    </div>
                    <div>
                        <label style="font-size: 12px; color: #a6adc8;">Height</label>
                        <input type="number" id="hm-height" value="${defaultHeight}" 
                            style="width: 100%; padding: 8px; border: 1px solid #45475a; border-radius: 6px; background: #313244; color: #cdd6f4;">
                    </div>
                </div>
            </div>

            <div style="display: flex; gap: 8px; justify-content: flex-end;">
                <button id="hm-cancel" style="padding: 8px 16px; border: 1px solid #45475a; border-radius: 6px; background: #313244; color: #cdd6f4; cursor: pointer;">Cancel</button>
                <button id="hm-confirm" style="padding: 8px 16px; border: none; border-radius: 6px; background: #89b4fa; color: #1e1e2e; cursor: pointer; font-weight: 500;">Export</button>
            </div>
        `;

        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        const cleanup = () => document.body.removeChild(overlay);
        const onCancel = () => { cleanup(); resolve(null); };

        dialog.querySelector('#hm-cancel')?.addEventListener('click', onCancel);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) onCancel(); });

        dialog.querySelector('#hm-confirm')?.addEventListener('click', () => {
            const w = parseInt((dialog.querySelector('#hm-width') as HTMLInputElement).value);
            const h = parseInt((dialog.querySelector('#hm-height') as HTMLInputElement).value);
            const projection = (dialog.querySelector('#hm-projection') as HTMLSelectElement).value as ProjectionType;
            cleanup();
            if (w > 0 && h > 0) resolve({ width: w, height: h, projection });
            else resolve(null);
        });
    });
}

// PNG Export Dialog
export function showPNGExportDialog(currentProjection: ProjectionType): Promise<PNGExportOptions | null> {
    return new Promise((resolve) => {
        // Create modal overlay
        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position: fixed; top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.7); z-index: 10000;
            display: flex; align-items: center; justify-content: center;
        `;

        const dialog = document.createElement('div');
        dialog.style.cssText = `
            background: #1e1e2e; border-radius: 12px; padding: 24px;
            min-width: 350px; color: #cdd6f4; font-family: system-ui, sans-serif;
            box-shadow: 0 8px 32px rgba(0,0,0,0.4);
        `;

        dialog.innerHTML = `
            <h3 style="margin: 0 0 16px 0; color: #89b4fa;">🖼️ Export PNG Image</h3>
            
            <div style="margin-bottom: 16px;">
                <label style="display: block; margin-bottom: 8px; font-weight: 500;">Projection:</label>
                <select id="export-projection" style="width: 100%; padding: 8px 12px; border: 1px solid #45475a; border-radius: 6px; background: #313244; color: #cdd6f4;">
                    <option value="orthographic">Globe (Orthographic)</option>
                    <option value="equirectangular">Equirectangular</option>
                    <option value="mercator">Mercator</option>
                    <option value="mollweide">Mollweide</option>
                    <option value="robinson">Robinson</option>
                </select>
            </div>
            
            <div style="margin-bottom: 16px;">
                <label style="display: block; margin-bottom: 8px; font-weight: 500;">Water Color:</label>
                <div style="display: flex; gap: 12px;">
                    <label style="cursor: pointer; display: flex; align-items: center; gap: 6px;">
                        <input type="radio" name="water-mode" value="color" checked> Blue
                    </label>
                    <label style="cursor: pointer; display: flex; align-items: center; gap: 6px;">
                        <input type="radio" name="water-mode" value="white"> White
                    </label>
                    <label style="cursor: pointer; display: flex; align-items: center; gap: 6px;">
                        <input type="radio" name="water-mode" value="transparent"> None
                    </label>
                </div>
            </div>

            <div style="margin-bottom: 24px;">
                <label style="display: block; margin-bottom: 8px; font-weight: 500;">Plate Colors:</label>
                <div style="display: flex; gap: 12px;">
                    <label style="cursor: pointer; display: flex; align-items: center; gap: 6px;">
                        <input type="radio" name="plate-color" value="native" checked> Plate Colors
                    </label>
                    <label style="cursor: pointer; display: flex; align-items: center; gap: 6px;">
                        <input type="radio" name="plate-color" value="land"> Land Color
                    </label>
                </div>
            </div>

            <div style="margin-bottom: 24px;">
                <label style="cursor: pointer; display: flex; align-items: center; gap: 6px; font-weight: 500;">
                    <input type="checkbox" id="export-grid" checked> Show Grid
                </label>
            </div>
            
            <div style="display: flex; gap: 8px; justify-content: flex-end;">
                <button id="export-cancel" style="padding: 8px 16px; border: 1px solid #45475a; border-radius: 6px; background: #313244; color: #cdd6f4; cursor: pointer;">Cancel</button>
                <button id="export-confirm" style="padding: 8px 16px; border: none; border-radius: 6px; background: #89b4fa; color: #1e1e2e; cursor: pointer; font-weight: 500;">Export PNG</button>
            </div>
        `;

        // Set current projection
        const select = dialog.querySelector('#export-projection') as HTMLSelectElement;
        if (select) select.value = currentProjection;

        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        const cleanup = () => document.body.removeChild(overlay);

        const onCancel = () => {
            cleanup();
            resolve(null);
        };

        dialog.querySelector('#export-cancel')?.addEventListener('click', onCancel);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) onCancel(); });

        dialog.querySelector('#export-confirm')?.addEventListener('click', () => {
            const projection = (dialog.querySelector('#export-projection') as HTMLSelectElement).value as ProjectionType;
            const waterMode = (dialog.querySelector('input[name="water-mode"]:checked') as HTMLInputElement).value as any;
            const plateColorMode = (dialog.querySelector('input[name="plate-color"]:checked') as HTMLInputElement).value as any;
            const showGrid = (dialog.querySelector('#export-grid') as HTMLInputElement).checked;

            cleanup();
            resolve({ projection, waterMode, plateColorMode, showGrid });
        });
    });
}

// JSON Export functionality
const SAVE_VERSION = 1;

export type ExportMode = 'entire_timeline' | 'from_current_time';

export interface ExportOptions {
    mode: ExportMode;
    filename: string;
}

export function showExportDialog(): Promise<ExportOptions | null> {
    return new Promise((resolve) => {
        // Create modal overlay
        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position: fixed; top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.7); z-index: 10000;
            display: flex; align-items: center; justify-content: center;
        `;

        const dialog = document.createElement('div');
        dialog.style.cssText = `
            background: #1e1e2e; border-radius: 12px; padding: 24px;
            min-width: 350px; color: #cdd6f4; font-family: system-ui, sans-serif;
            box-shadow: 0 8px 32px rgba(0,0,0,0.4);
        `;

        const currentTime = (window as any).__tectoLiteCurrentTime ?? 0;

        dialog.innerHTML = `
            <h3 style="margin: 0 0 16px 0; color: #89b4fa;">💾 Export Save File</h3>
            
            <div style="margin-bottom: 16px;">
                <label style="display: block; margin-bottom: 8px; font-weight: 500;">File Name:</label>
                <input type="text" id="export-filename" value="TectoLite-${new Date().toISOString().split('T')[0]}" 
                    style="width: 100%; padding: 8px 12px; border: 1px solid #45475a; border-radius: 6px;
                    background: #313244; color: #cdd6f4; box-sizing: border-box;">
            </div>
            
            <div style="margin-bottom: 20px;">
                <label style="display: block; margin-bottom: 8px; font-weight: 500;">Timeline Mode:</label>
                <div style="display: flex; flex-direction: column; gap: 8px;">
                    <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; padding: 8px; 
                        background: #313244; border-radius: 6px; border: 1px solid #45475a;">
                        <input type="radio" name="export-mode" value="entire_timeline" checked>
                        <div>
                            <div style="font-weight: 500;">📚 Entire Timeline</div>
                            <div style="font-size: 12px; color: #a6adc8;">Save everything from time 0 onwards</div>
                        </div>
                    </label>
                    <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; padding: 8px;
                        background: #313244; border-radius: 6px; border: 1px solid #45475a;">
                        <input type="radio" name="export-mode" value="from_current_time">
                        <div>
                            <div style="font-weight: 500;">⏩ From Current Time (${currentTime.toFixed(1)} Ma)</div>
                            <div style="font-size: 12px; color: #a6adc8;">Save from now, reset timeline to 0</div>
                        </div>
                    </label>
                </div>
            </div>
            
            <div style="display: flex; gap: 8px; justify-content: flex-end;">
                <button id="export-cancel" style="padding: 8px 16px; border: 1px solid #45475a; border-radius: 6px;
                    background: #313244; color: #cdd6f4; cursor: pointer;">Cancel</button>
                <button id="export-confirm" style="padding: 8px 16px; border: none; border-radius: 6px;
                    background: #89b4fa; color: #1e1e2e; cursor: pointer; font-weight: 500;">Export</button>
            </div>
        `;

        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        const cleanup = () => {
            document.body.removeChild(overlay);
        };

        dialog.querySelector('#export-cancel')?.addEventListener('click', () => {
            cleanup();
            resolve(null);
        });

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                cleanup();
                resolve(null);
            }
        });

        dialog.querySelector('#export-confirm')?.addEventListener('click', () => {
            const filename = (dialog.querySelector('#export-filename') as HTMLInputElement).value.trim();
            const mode = (dialog.querySelector('input[name="export-mode"]:checked') as HTMLInputElement).value as ExportMode;
            cleanup();
            resolve(filename ? { mode, filename } : null);
        });

        // Focus the filename input
        setTimeout(() => (dialog.querySelector('#export-filename') as HTMLInputElement)?.select(), 50);
    });
}

export async function exportToJSON(state: AppState): Promise<void> {
    // Store current time for dialog access
    (window as any).__tectoLiteCurrentTime = state.world.currentTime;

    const options = await showExportDialog();
    if (!options) return; // User cancelled

    let worldToSave = state.world;

    // If exporting from current time, shift all timestamps so currentTime becomes 0
    if (options.mode === 'from_current_time') {
        const timeOffset = -state.world.currentTime;

        worldToSave = {
            ...state.world,
            currentTime: 0,
            plates: state.world.plates
                .filter(plate => {
                    // Only include plates that are alive at current time
                    const isBorn = state.world.currentTime >= plate.birthTime;
                    const isDead = plate.deathTime !== null && state.world.currentTime >= plate.deathTime;
                    return isBorn && !isDead;
                })
                .map(plate => ({
                    ...plate,
                    birthTime: Math.max(0, plate.birthTime + timeOffset),
                    deathTime: plate.deathTime !== null ? plate.deathTime + timeOffset : null,
                    motionKeyframes: plate.motionKeyframes
                        .filter(kf => kf.time <= state.world.currentTime) // Only keyframes up to current time
                        .map(kf => ({
                            ...kf,
                            time: Math.max(0, kf.time + timeOffset),
                            snapshotFeatures: kf.snapshotFeatures.map(f => ({
                                ...f,
                                generatedAt: f.generatedAt !== undefined ? Math.max(0, f.generatedAt + timeOffset) : undefined,
                                deathTime: f.deathTime !== undefined ? f.deathTime + timeOffset : undefined
                            }))
                        })),
                    features: plate.features.map(f => ({
                        ...f,
                        generatedAt: f.generatedAt !== undefined ? Math.max(0, f.generatedAt + timeOffset) : undefined,
                        deathTime: f.deathTime !== undefined ? f.deathTime + timeOffset : undefined
                    })),
                    initialFeatures: plate.initialFeatures.map(f => ({
                        ...f,
                        generatedAt: f.generatedAt !== undefined ? Math.max(0, f.generatedAt + timeOffset) : undefined,
                        deathTime: f.deathTime !== undefined ? f.deathTime + timeOffset : undefined
                    }))
                }))
        };
    }

    const saveData = {
        version: SAVE_VERSION,
        savedAt: new Date().toISOString(),
        name: options.filename,
        exportMode: options.mode,
        exportedAtTime: state.world.currentTime,
        world: worldToSave,
        viewport: state.viewport
    };

    const json = JSON.stringify(saveData, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const link = document.createElement('a');
    const sanitizedName = options.filename.replace(/[^a-zA-Z0-9_-]/g, '_');
    link.download = `${sanitizedName}.json`;
    link.href = URL.createObjectURL(blob);
    link.click();
    URL.revokeObjectURL(link.href);
}

export type ImportMode = 'at_beginning' | 'at_current_time';

export interface ImportResult {
    world: WorldState;
    viewport?: any;
    mode: ImportMode;
    filename: string;
}

export function showImportDialog(filename: string, plateCount: number, currentTime: number): Promise<ImportMode | null> {
    return new Promise((resolve) => {
        // Create modal overlay
        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position: fixed; top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.7); z-index: 10000;
            display: flex; align-items: center; justify-content: center;
        `;

        const dialog = document.createElement('div');
        dialog.style.cssText = `
            background: #1e1e2e; border-radius: 12px; padding: 24px;
            min-width: 350px; color: #cdd6f4; font-family: system-ui, sans-serif;
            box-shadow: 0 8px 32px rgba(0,0,0,0.4);
        `;

        dialog.innerHTML = `
            <h3 style="margin: 0 0 16px 0; color: #a6e3a1;">📂 Import Save File</h3>
            
            <div style="margin-bottom: 16px; padding: 12px; background: #313244; border-radius: 6px;">
                <div style="font-weight: 500; margin-bottom: 4px;">${filename}</div>
                <div style="font-size: 12px; color: #a6adc8;">${plateCount} plate(s) found</div>
            </div>
            
            <div style="margin-bottom: 20px;">
                <label style="display: block; margin-bottom: 8px; font-weight: 500;">Import Location:</label>
                <div style="display: flex; flex-direction: column; gap: 8px;">
                    <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; padding: 8px; 
                        background: #313244; border-radius: 6px; border: 1px solid #45475a;">
                        <input type="radio" name="import-mode" value="at_beginning" checked>
                        <div>
                            <div style="font-weight: 500;">⏮️ At Beginning (Time 0)</div>
                            <div style="font-size: 12px; color: #a6adc8;">Add plates starting from the beginning</div>
                        </div>
                    </label>
                    <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; padding: 8px;
                        background: #313244; border-radius: 6px; border: 1px solid #45475a;">
                        <input type="radio" name="import-mode" value="at_current_time">
                        <div>
                            <div style="font-weight: 500;">⏩ At Current Time (${currentTime.toFixed(1)} Ma)</div>
                            <div style="font-size: 12px; color: #a6adc8;">Add plates at the current simulation time</div>
                        </div>
                    </label>
                </div>
            </div>
            
            <div style="display: flex; gap: 8px; justify-content: flex-end;">
                <button id="import-cancel" style="padding: 8px 16px; border: 1px solid #45475a; border-radius: 6px;
                    background: #313244; color: #cdd6f4; cursor: pointer;">Cancel</button>
                <button id="import-confirm" style="padding: 8px 16px; border: none; border-radius: 6px;
                    background: #a6e3a1; color: #1e1e2e; cursor: pointer; font-weight: 500;">Import</button>
            </div>
        `;

        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        const cleanup = () => {
            document.body.removeChild(overlay);
        };

        dialog.querySelector('#import-cancel')?.addEventListener('click', () => {
            cleanup();
            resolve(null);
        });

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                cleanup();
                resolve(null);
            }
        });

        dialog.querySelector('#import-confirm')?.addEventListener('click', () => {
            const mode = (dialog.querySelector('input[name="import-mode"]:checked') as HTMLInputElement).value as ImportMode;
            cleanup();
            resolve(mode);
        });
    });
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

// Parse file to get metadata without full import
export function parseImportFile(file: File): Promise<{ world: WorldState; viewport?: any; name: string }> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const text = e.target?.result as string;
                const data = JSON.parse(text);

                if (!data.version || data.version > SAVE_VERSION) {
                    throw new Error('Unsupported save file version');
                }

                if (!data.world || !Array.isArray(data.world.plates)) {
                    throw new Error('Invalid save file format');
                }

                resolve({
                    world: data.world as WorldState,
                    viewport: data.viewport as any, // Optional
                    name: data.name || file.name
                });
            } catch (err) {
                reject(err);
            }
        };
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsText(file);
    });
}

// GeoPackage (QGIS) Export Dialog
export function showGeoPackageExportDialog(): Promise<GeoPackageExportOptions | null> {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position: fixed; top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.7); z-index: 10000;
            display: flex; align-items: center; justify-content: center;
        `;

        const dialog = document.createElement('div');
        dialog.style.cssText = `
            background: #1e1e2e; border-radius: 12px; padding: 24px;
            min-width: 400px; color: #cdd6f4; font-family: system-ui, sans-serif;
            box-shadow: 0 8px 32px rgba(0,0,0,0.4);
        `;

        dialog.innerHTML = `
            <h3 style="margin: 0 0 16px 0; color: #89b4fa;">🗺️ Export to QGIS (GeoPackage)</h3>
            
            <div style="margin-bottom: 16px;">
                <label style="display: block; margin-bottom: 8px; font-weight: 500;">Projection:</label>
                <select id="gpkg-projection" style="width: 100%; padding: 8px 12px; border: 1px solid #45475a; border-radius: 6px; background: #313244; color: #cdd6f4;">
                    <option value="equirectangular">Equirectangular</option>
                    <option value="mercator">Mercator</option>
                    <option value="mollweide">Mollweide</option>
                    <option value="robinson">Robinson</option>
                    <option value="orthographic">Orthographic (Globe)</option>
                </select>
            </div>

            <div style="margin-bottom: 16px;">
                <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                    <input type="checkbox" id="gpkg-heightmap" checked style="cursor: pointer;">
                    <span>Include Heightmap Raster Layer</span>
                </label>
            </div>
            
            <div style="margin-bottom: 16px;">
                <label style="display: block; margin-bottom: 8px; font-weight: 500;">Resolution:</label>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                    <div>
                        <label style="font-size: 12px; color: #a6adc8;">Width</label>
                        <input type="number" id="gpkg-width" value="2048" min="512" max="8192"
                            style="width: 100%; padding: 8px; border: 1px solid #45475a; border-radius: 6px; background: #313244; color: #cdd6f4;">
                    </div>
                    <div>
                        <label style="font-size: 12px; color: #a6adc8;">Height</label>
                        <input type="number" id="gpkg-height" value="1024" min="512" max="8192"
                            style="width: 100%; padding: 8px; border: 1px solid #45475a; border-radius: 6px; background: #313244; color: #cdd6f4;">
                    </div>
                </div>
            </div>

            <div style="background: #313244; border-left: 4px solid #89b4fa; padding: 12px; border-radius: 4px; margin-bottom: 16px; font-size: 13px; color: #a6adc8;">
                <strong style="color: #89b4fa;">ℹ️ Info:</strong> GeoPackage exports plates, features, and optional heightmap raster for use in QGIS.
            </div>

            <div style="display: flex; gap: 8px; justify-content: flex-end;">
                <button id="gpkg-cancel" style="padding: 8px 16px; border: 1px solid #45475a; border-radius: 6px; background: #313244; color: #cdd6f4; cursor: pointer;">Cancel</button>
                <button id="gpkg-confirm" style="padding: 8px 16px; border: none; border-radius: 6px; background: #89b4fa; color: #1e1e2e; cursor: pointer; font-weight: 500;">Export to QGIS</button>
            </div>
        `;

        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        const cleanup = () => document.body.removeChild(overlay);
        const onCancel = () => { cleanup(); resolve(null); };

        dialog.querySelector('#gpkg-cancel')?.addEventListener('click', onCancel);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) onCancel(); });

        dialog.querySelector('#gpkg-confirm')?.addEventListener('click', () => {
            const w = parseInt((dialog.querySelector('#gpkg-width') as HTMLInputElement).value);
            const h = parseInt((dialog.querySelector('#gpkg-height') as HTMLInputElement).value);
            const projection = (dialog.querySelector('#gpkg-projection') as HTMLSelectElement).value as ProjectionType;
            const includeHeightmap = (dialog.querySelector('#gpkg-heightmap') as HTMLInputElement).checked;
            cleanup();
            if (w > 0 && h > 0) {
                resolve({ width: w, height: h, projection, includeHeightmap });
            } else {
                resolve(null);
            }
        });
    });
}
// Unified Export Dialog (consolidates PNG, Heightmap, and QGIS options)
export type UnifiedExportFormat = 'png' | 'heightmap' | 'qgis';

export interface UnifiedExportOptions {
    format: UnifiedExportFormat;
    projection?: ProjectionType;
    width?: number;
    height?: number;
    includeHeightmap?: boolean;
}

export function showUnifiedExportDialog(): Promise<UnifiedExportOptions | null> {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position: fixed; top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.7); z-index: 10000;
            display: flex; align-items: center; justify-content: center;
        `;

        const dialog = document.createElement('div');
        dialog.style.cssText = `
            background: #1e1e2e; border-radius: 12px; padding: 24px;
            min-width: 450px; color: #cdd6f4; font-family: system-ui, sans-serif;
            box-shadow: 0 8px 32px rgba(0,0,0,0.4);
            max-height: 80vh; overflow-y: auto;
        `;

        dialog.innerHTML = `
            <h3 style="margin: 0 0 20px 0; color: #89b4fa;">📤 Export Options</h3>
            
            <!-- Format Selector -->
            <div style="margin-bottom: 20px;">
                <label style="display: block; margin-bottom: 12px; font-weight: 500;">Export Format:</label>
                <div style="display: flex; gap: 8px;">
                    <button id="fmt-png" class="format-btn" style="flex: 1; padding: 10px; border: 2px solid #89b4fa; background: #313244; border-radius: 6px; color: #cdd6f4; cursor: pointer; font-weight: 600;">
                        🖼️ PNG Image
                    </button>
                    <button id="fmt-heightmap" class="format-btn" style="flex: 1; padding: 10px; border: 2px solid #45475a; background: #313244; border-radius: 6px; color: #cdd6f4; cursor: pointer; font-weight: 600;">
                        🗺️ Heightmap
                    </button>
                    <button id="fmt-qgis" class="format-btn" style="flex: 1; padding: 10px; border: 2px solid #45475a; background: #313244; border-radius: 6px; color: #cdd6f4; cursor: pointer; font-weight: 600;">
                        🌍 QGIS
                    </button>
                </div>
            </div>

            <!-- PNG Options -->
            <div id="options-png" style="display: block; margin-bottom: 20px; padding: 16px; background: #313244; border-radius: 6px; border-left: 4px solid #89b4fa;">
                <label style="display: block; margin-bottom: 12px; font-weight: 500;">Projection:</label>
                <select id="export-projection" style="width: 100%; padding: 8px 12px; border: 1px solid #45475a; border-radius: 6px; background: #2a2a3e; color: #cdd6f4; margin-bottom: 12px;">
                    <option value="orthographic">Globe (Orthographic)</option>
                    <option value="equirectangular">Flat Map (Equirectangular)</option>
                    <option value="mercator">Mercator</option>
                    <option value="mollweide">Mollweide</option>
                    <option value="robinson">Robinson</option>
                </select>
                <label style="display: block; margin-bottom: 12px; font-weight: 500;">Resolution:</label>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                    <div>
                        <label style="font-size: 12px; color: #a6adc8;">Width</label>
                        <input type="number" id="export-width" value="1920" style="width: 100%; padding: 8px; border: 1px solid #45475a; border-radius: 6px; background: #2a2a3e; color: #cdd6f4;">
                    </div>
                    <div>
                        <label style="font-size: 12px; color: #a6adc8;">Height</label>
                        <input type="number" id="export-height" value="1080" style="width: 100%; padding: 8px; border: 1px solid #45475a; border-radius: 6px; background: #2a2a3e; color: #cdd6f4;">
                    </div>
                </div>
            </div>

            <!-- Heightmap Options -->
            <div id="options-heightmap" style="display: none; margin-bottom: 20px; padding: 16px; background: #313244; border-radius: 6px; border-left: 4px solid #89b4fa;">
                <label style="display: block; margin-bottom: 12px; font-weight: 500;">Projection:</label>
                <select id="hm-projection" style="width: 100%; padding: 8px 12px; border: 1px solid #45475a; border-radius: 6px; background: #2a2a3e; color: #cdd6f4; margin-bottom: 12px;">
                    <option value="equirectangular">Equirectangular</option>
                    <option value="mercator">Mercator</option>
                    <option value="mollweide">Mollweide</option>
                    <option value="robinson">Robinson</option>
                    <option value="orthographic">Orthographic (Globe)</option>
                </select>
                <label style="display: block; margin-bottom: 12px; font-weight: 500;">Resolution:</label>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                    <div>
                        <label style="font-size: 12px; color: #a6adc8;">Width</label>
                        <input type="number" id="hm-width" value="4096" style="width: 100%; padding: 8px; border: 1px solid #45475a; border-radius: 6px; background: #2a2a3e; color: #cdd6f4;">
                    </div>
                    <div>
                        <label style="font-size: 12px; color: #a6adc8;">Height</label>
                        <input type="number" id="hm-height" value="2048" style="width: 100%; padding: 8px; border: 1px solid #45475a; border-radius: 6px; background: #2a2a3e; color: #cdd6f4;">
                    </div>
                </div>
            </div>

            <!-- QGIS Options -->
            <div id="options-qgis" style="display: none; margin-bottom: 20px; padding: 16px; background: #313244; border-radius: 6px; border-left: 4px solid #89b4fa;">
                <label style="display: block; margin-bottom: 12px; font-weight: 500;">Projection:</label>
                <select id="qgis-projection" style="width: 100%; padding: 8px 12px; border: 1px solid #45475a; border-radius: 6px; background: #2a2a3e; color: #cdd6f4; margin-bottom: 12px;">
                    <option value="equirectangular">Equirectangular</option>
                    <option value="mercator">Mercator</option>
                    <option value="mollweide">Mollweide</option>
                    <option value="robinson">Robinson</option>
                    <option value="orthographic">Orthographic (Globe)</option>
                </select>
                <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; margin-bottom: 12px;">
                    <input type="checkbox" id="qgis-heightmap" checked style="cursor: pointer;">
                    <span>Include Heightmap Raster Layer</span>
                </label>
                <label style="display: block; margin-bottom: 12px; font-weight: 500;">Resolution:</label>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                    <div>
                        <label style="font-size: 12px; color: #a6adc8;">Width</label>
                        <input type="number" id="qgis-width" value="2048" style="width: 100%; padding: 8px; border: 1px solid #45475a; border-radius: 6px; background: #2a2a3e; color: #cdd6f4;">
                    </div>
                    <div>
                        <label style="font-size: 12px; color: #a6adc8;">Height</label>
                        <input type="number" id="qgis-height" value="1024" style="width: 100%; padding: 8px; border: 1px solid #45475a; border-radius: 6px; background: #2a2a3e; color: #cdd6f4;">
                    </div>
                </div>
            </div>

            <div style="display: flex; gap: 8px; justify-content: flex-end;">
                <button id="export-cancel" style="padding: 10px 20px; border: 1px solid #45475a; border-radius: 6px; background: #313244; color: #cdd6f4; cursor: pointer; font-weight: 500;">Cancel</button>
                <button id="export-confirm" style="padding: 10px 20px; border: none; border-radius: 6px; background: #89b4fa; color: #1e1e2e; cursor: pointer; font-weight: 600;">Export</button>
            </div>
        `;

        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        let selectedFormat: UnifiedExportFormat = 'png';

        // Format selector buttons
        const formatBtns = dialog.querySelectorAll('.format-btn');
        formatBtns.forEach((btn) => {
            btn.addEventListener('click', (e) => {
                const target = e.target as HTMLElement;
                const formatId = target.id;
                const format = formatId.replace('fmt-', '') as UnifiedExportFormat;
                
                selectedFormat = format;
                
                // Update button styles
                formatBtns.forEach((b) => {
                    (b as HTMLElement).style.borderColor = '#45475a';
                });
                (target as HTMLElement).style.borderColor = '#89b4fa';
                
                // Show/hide option panels
                (dialog.querySelector('#options-png') as HTMLElement).style.display = format === 'png' ? 'block' : 'none';
                (dialog.querySelector('#options-heightmap') as HTMLElement).style.display = format === 'heightmap' ? 'block' : 'none';
                (dialog.querySelector('#options-qgis') as HTMLElement).style.display = format === 'qgis' ? 'block' : 'none';
            });
        });

        const cleanup = () => document.body.removeChild(overlay);
        const onCancel = () => { cleanup(); resolve(null); };

        dialog.querySelector('#export-cancel')?.addEventListener('click', onCancel);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) onCancel(); });

        dialog.querySelector('#export-confirm')?.addEventListener('click', () => {
            cleanup();
            
            if (selectedFormat === 'png') {
                const w = parseInt((dialog.querySelector('#export-width') as HTMLInputElement).value);
                const h = parseInt((dialog.querySelector('#export-height') as HTMLInputElement).value);
                const proj = (dialog.querySelector('#export-projection') as HTMLSelectElement).value as ProjectionType;
                if (w > 0 && h > 0) {
                    resolve({ format: 'png', projection: proj, width: w, height: h });
                }
            } else if (selectedFormat === 'heightmap') {
                const w = parseInt((dialog.querySelector('#hm-width') as HTMLInputElement).value);
                const h = parseInt((dialog.querySelector('#hm-height') as HTMLInputElement).value);
                const proj = (dialog.querySelector('#hm-projection') as HTMLSelectElement).value as ProjectionType;
                if (w > 0 && h > 0) {
                    resolve({ format: 'heightmap', projection: proj, width: w, height: h });
                }
            } else if (selectedFormat === 'qgis') {
                const w = parseInt((dialog.querySelector('#qgis-width') as HTMLInputElement).value);
                const h = parseInt((dialog.querySelector('#qgis-height') as HTMLInputElement).value);
                const proj = (dialog.querySelector('#qgis-projection') as HTMLSelectElement).value as ProjectionType;
                const hm = (dialog.querySelector('#qgis-heightmap') as HTMLInputElement).checked;
                if (w > 0 && h > 0) {
                    resolve({ format: 'qgis', projection: proj, width: w, height: h, includeHeightmap: hm });
                }
            }
        });
    });
}