// PNG Export functionality
import { AppState, Feature, WorldState, ProjectionType, CameraView, MapLabel, type Viewport } from './types';
import { CURRENT_SAVE_VERSION as SAVE_VERSION } from './migration';
import { assertProjectFileSize, parseProjectText } from './ProjectIO';
import { ProjectionManager } from './canvas/ProjectionManager';
import { geoGraticule, geoArea } from 'd3-geo';
import { toGeoJSON } from './utils/geoHelpers';
import { activeEulerPole, pointPositionAt } from './motion/RotationModel';
import { FEATURE_ICON_DRAWERS } from './canvas/featureIcons';
import {
    resolveFeatureTimelineOpacity,
    resolveLineRenderStyle,
    sortPlatesForRendering,
} from './canvas/renderStyles';
import {
    EXPORT_CROP_HELP,
    JSON_ENTIRE_TIMELINE_HELP,
    JSON_FROM_CURRENT_HELP,
} from './ui/workflowGuidance';
import { escapeHtml } from './ui/safeHtml';
import { uiIcon } from './ui/icons';

export interface PNGExportOptions {
    projection: ProjectionType;
    waterMode: 'transparent' | 'color' | 'white';
    plateColorMode: 'native' | 'land';
    showGrid: boolean;
    includeFeatures?: boolean;
}

/**
 * Scale the current map as a cover, not a contain. This guarantees that an
 * export with a different aspect ratio never reveals geographic area outside
 * the live canvas; the surplus dimension is cropped symmetrically instead.
 */
export function createExportViewport(viewport: Viewport, width: number, height: number): Viewport {
    const ratio = Math.max(width / viewport.width, height / viewport.height);
    return {
        ...viewport,
        width,
        height,
        scale: viewport.scale * ratio,
        translate: [
            width / 2 + (viewport.translate[0] - viewport.width / 2) * ratio,
            height / 2 + (viewport.translate[1] - viewport.height / 2) * ratio,
        ],
    };
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
    const ratio = Math.max(width / state.viewport.width, height / state.viewport.height);
    const currentTime = state.world.currentTime;
    const { waterMode, plateColorMode, includeFeatures } = options;

    const exportViewport = createExportViewport(state.viewport, width, height);

    // Use requested projection
    pm.update(options.projection, exportViewport);
    const path = pm.getPathGenerator();

    // 1. Background (Water)
    if (waterMode === 'color') {
        ctx.fillStyle = '#1a3a4a'; // Deep Ocean
        ctx.fillRect(0, 0, width, height);
    } else if (waterMode === 'white') {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
    }
    // If transparent, do nothing (canvas is transparent by default)

    // Globe Background (only for Orthographic if not transparent)
    if (options.projection === 'orthographic' && waterMode !== 'transparent') {
        ctx.beginPath();
        path({ type: 'Sphere' } as any);
        ctx.fillStyle = waterMode === 'white' ? '#f0f0f0' : '#0f2634';
        ctx.fill();
    }

    // 2. Graticule
    if (options.showGrid) {
        ctx.strokeStyle = waterMode === 'white' ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.05)';
        ctx.lineWidth = 1 * ratio;
        ctx.beginPath();
        path(geoGraticule()());
        ctx.stroke();
    }

    // 3. Plates
    for (const plate of sortPlatesForRendering(state.world.plates)) {
        if (!plate.visible) continue;
        if (currentTime < plate.birthTime) continue;
        if (plate.deathTime !== null && currentTime >= plate.deathTime) continue;

        // Polygons
        for (const polygon of plate.polygons) {
            const geojson = toGeoJSON(polygon);
            if (geoArea(geojson) > 2 * Math.PI) geojson.geometry.coordinates[0].reverse();

            ctx.beginPath();
            path(geojson);

            // Plate Color Logic
            if (polygon.closed !== false) {
                if (plateColorMode === 'land') {
                    ctx.fillStyle = '#C2B280'; // Ecru/Sand Land Color
                } else {
                    ctx.fillStyle = plate.color;
                }
                ctx.fill();
            }

            // Border
            if (plate.type === 'rift') {
                const style = resolveLineRenderStyle(plate, state.world.globalOptions.lineTypeDefaults);
                ctx.strokeStyle = style.color;
                ctx.lineWidth = 2 * ratio;
                ctx.setLineDash(style.dash.map(value => value * ratio));
            } else {
                ctx.strokeStyle = waterMode === 'white' ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.3)';
                ctx.lineWidth = 1 * ratio;
            }
            ctx.stroke();
            ctx.setLineDash([]);
        }



        // Features
        if (includeFeatures !== false) {
            for (const feature of plate.features) {
                const opacity = resolveFeatureTimelineOpacity(
                    feature,
                    currentTime,
                    state.world.showFutureFeatures
                );
                if (opacity === null) continue;
                drawFeature(ctx, pm, feature, ratio, opacity);
            }
        }


    }

    // 4. Flag labels are annotation overlays and intentionally render last.
    const groupOpacity = new Map(state.world.entityGroups.map(group => [group.id, group.opacity ?? 1]));
    for (const label of state.world.labels ?? []) {
        if (!label.visible) continue;
        let position = label.anchor;
        if (label.attachedPlateId) {
            const plate = state.world.plates.find(candidate => candidate.id === label.attachedPlateId);
            if (!plate || currentTime < plate.birthTime || (plate.deathTime !== null && currentTime >= plate.deathTime)) continue;
            position = pointPositionAt(plate, state.world.plates, label.anchor, label.anchorTime, currentTime);
        }
        drawExportLabel(ctx, pm, label, position, ratio, label.groupId ? (groupOpacity.get(label.groupId) ?? 1) : 1);
    }

    // Trigger download
    const link = document.createElement('a');
    link.download = `tectolite-export-${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
}

function drawExportLabel(
    ctx: CanvasRenderingContext2D,
    pm: ProjectionManager,
    label: MapLabel,
    position: [number, number],
    ratio: number,
    opacity: number
): void {
    const projected = pm.project(position);
    if (!projected) return;
    const padding = 7 * ratio;
    const titleHeight = 26 * ratio;
    const maxTextWidth = 220 * ratio;
    const x = projected[0] + label.offset[0] * ratio;
    const y = projected[1] + label.offset[1] * ratio;
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.font = `600 ${12 * ratio}px system-ui, sans-serif`;
    const titleWidth = Math.min(maxTextWidth, Math.max(44 * ratio, ctx.measureText(label.title).width));
    ctx.font = `${11 * ratio}px system-ui, sans-serif`;
    const lines: string[] = [];
    if (label.expanded && label.content) {
        for (const paragraph of label.content.split(/\r?\n/)) {
            let line = '';
            for (const word of paragraph.split(/\s+/).filter(Boolean)) {
                const candidate = line ? `${line} ${word}` : word;
                if (!line || ctx.measureText(candidate).width <= maxTextWidth) line = candidate;
                else { lines.push(line); line = word; }
            }
            if (line) lines.push(line);
        }
    }
    const contentWidth = lines.reduce((width, line) => Math.max(width, ctx.measureText(line).width), 0);
    const width = Math.max(titleWidth, contentWidth) + padding * 2;
    const height = titleHeight + (lines.length ? lines.length * 15 * ratio + padding : 0);
    ctx.strokeStyle = label.color;
    ctx.fillStyle = label.color;
    ctx.lineWidth = 2 * ratio;
    ctx.beginPath(); ctx.arc(projected[0], projected[1], 3.5 * ratio, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(projected[0], projected[1]); ctx.lineTo(x, y + titleHeight / 2); ctx.stroke();
    ctx.fillStyle = 'rgba(20, 24, 36, 0.94)';
    ctx.beginPath(); ctx.roundRect(x, y, width, height, 5 * ratio); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#f3f4f6';
    ctx.font = `600 ${12 * ratio}px system-ui, sans-serif`;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(label.title, x + padding, y + titleHeight / 2, maxTextWidth);
    if (lines.length) {
        ctx.fillStyle = '#d1d5db'; ctx.font = `${11 * ratio}px system-ui, sans-serif`; ctx.textBaseline = 'top';
        lines.slice(0, 10).forEach((line, index) => ctx.fillText(line, x + padding, y + titleHeight + 5 * ratio + index * 15 * ratio, maxTextWidth));
    }
    ctx.restore();
}

function drawFeature(
    ctx: CanvasRenderingContext2D,
    pm: ProjectionManager,
    feature: Feature,
    scaleRatio: number,
    opacity: number = 1
): void {
    const proj = pm.project(feature.position);
    if (!proj) return;

    const size = 12 * feature.scale * scaleRatio;

    ctx.save();
    ctx.globalAlpha *= opacity;
    ctx.translate(proj[0], proj[1]);
    ctx.rotate(feature.rotation * Math.PI / 180);

    const draw = FEATURE_ICON_DRAWERS[feature.type];
    if (draw) draw(ctx, size);

    ctx.restore();
}



// JSON Export functionality
// Save version history:
//   v10: multiple independently positioned reference-image overlays.
//   v9: first-class flag labels with fixed or plate-relative anchors.
//   v8: Explorer range selection and persistent group opacity.
//   v7: ocean-crust automation uses one mutually exclusive strategy.
//   v6: retired guided-event automation fields removed from project state.
//   v5: persistent Explorer entity groups
//   v4: motion model migration — plates carry motionSegments/geometryStages
//       only (legacy motion/motionKeyframes removed from the type; old saves
//       are migrated at load time via migrateSaveFile → ensureMotionModel).
//   v3: line type rename (rift/trench/fault/suture → divergent/convergent/
//       transform/generic).
//   v1/v2: motionKeyframes-only model; converted lazily by the migration
//       pipeline at load time.
// The current version lives in src/migration.ts (CURRENT_SAVE_VERSION).

export type ExportMode = 'entire_timeline' | 'from_current_time';

export interface ExportOptions {
    mode: ExportMode;
    filename: string;
}

/**
 * Create the timeline-reset world used by "From Current Time" saves.
 *
 * The visible plate geometry is the new birth snapshot at t=0. Historical
 * motion/stages are discarded (not collapsed onto the same timestamp), while
 * genuinely future changes keep their relative time. Link windows and plate
 * events follow the same rule.
 */
export function createWorldFromCurrentTime(world: WorldState): WorldState {
    const currentTime = world.currentTime;
    const activePlates = world.plates.filter(plate =>
        plate.birthTime <= currentTime
        && (plate.deathTime === null || plate.deathTime > currentTime)
    );
    const activePlateIds = new Set(activePlates.map(plate => plate.id));

    // A motion link intentionally keeps pointing at its historical parent
    // after fusion so the full-timeline model can compose pre- and post-fusion
    // motion. A current-time export removes retired plates, so follow the
    // persisted fusion lineage and rebase that link to the active successor.
    const resolveActiveLinkTarget = (targetId: string): string | undefined => {
        const visited = new Set<string>();
        let target = world.plates.find(plate => plate.id === targetId);

        while (target && !activePlateIds.has(target.id)) {
            if (visited.has(target.id)) return undefined;
            visited.add(target.id);
            if (target.deathTime === null) return undefined;

            target = world.plates.find(candidate =>
                candidate.parentPlateIds?.includes(target!.id)
                && Math.abs(candidate.birthTime - target!.deathTime!) < 0.001
            );
        }

        return target && activePlateIds.has(target.id) ? target.id : undefined;
    };

    const shiftFeature = (feature: Feature): Feature => ({
        ...feature,
        generatedAt: feature.generatedAt !== undefined
            ? Math.max(0, feature.generatedAt - currentTime)
            : undefined,
        deathTime: feature.deathTime !== undefined
            ? feature.deathTime - currentTime
            : undefined,
    });

    const plates = activePlates.map(plate => {
        const featuresAtStart = plate.features
            .filter(feature => feature.deathTime === undefined || feature.deathTime === null || feature.deathTime > currentTime)
            .map(shiftFeature);
        const futureSegments = plate.motionSegments
            .filter(segment => segment.time > currentTime)
            .map(segment => ({ ...segment, time: segment.time - currentTime }))
            .sort((left, right) => left.time - right.time);
        const futureStages = plate.geometryStages
            .filter(stage => stage.time > currentTime)
            .map(stage => ({
                ...stage,
                time: stage.time - currentTime,
                features: stage.features.map(shiftFeature),
            }))
            .sort((left, right) => left.time - right.time);
        const activeLinkTarget = plate.linkedToPlateId
            ? resolveActiveLinkTarget(plate.linkedToPlateId)
            : undefined;
        const linkStillExists = !!activeLinkTarget
            && (plate.unlinkTime === undefined || plate.unlinkTime > currentTime);

        return {
            ...plate,
            birthTime: 0,
            deathTime: plate.deathTime !== null ? plate.deathTime - currentTime : null,
            linkedToPlateId: linkStillExists ? activeLinkTarget : undefined,
            linkTime: linkStillExists
                ? Math.max(0, (plate.linkTime ?? currentTime) - currentTime)
                : undefined,
            unlinkTime: linkStillExists && plate.unlinkTime !== undefined
                ? plate.unlinkTime - currentTime
                : undefined,
            polygons: plate.polygons,
            features: featuresAtStart,
            initialPolygons: plate.polygons,
            initialFeatures: featuresAtStart,
            motionSegments: [
                { time: 0, eulerPole: activeEulerPole(plate, currentTime) },
                ...futureSegments,
            ],
            geometryStages: [
                { time: 0, polygons: plate.polygons, features: featuresAtStart },
                ...futureStages,
            ],
            events: plate.events
                .filter(event => event.time >= currentTime)
                .map(event => ({ ...event, time: event.time - currentTime }))
                .sort((left, right) => left.time - right.time),
        };
    });

    const riftAxes = (world.riftAxes || [])
        .filter(axis => axis.birthTime <= currentTime
            && axis.state !== 'dead'
            && (axis.deathTime === undefined || axis.deathTime > currentTime)
            && activePlateIds.has(axis.plateIdA)
            && activePlateIds.has(axis.plateIdB))
        .map(axis => {
            const latestRecorded = [...axis.isochrons]
                .filter(isochron => isochron.time <= currentTime)
                .sort((left, right) => right.time - left.time)[0];
            return {
                ...axis,
                birthPolyline: latestRecorded?.polyline ?? axis.birthPolyline,
                birthTime: 0,
                frozenTime: axis.frozenTime !== undefined ? Math.max(0, axis.frozenTime - currentTime) : undefined,
                deathTime: axis.deathTime !== undefined ? axis.deathTime - currentTime : undefined,
                isochrons: axis.isochrons
                    .filter(isochron => isochron.time > currentTime)
                    .map(isochron => ({ ...isochron, time: isochron.time - currentTime }))
                    .sort((left, right) => left.time - right.time),
            };
        });
    const activeAxisIds = new Set(riftAxes.map(axis => axis.id));

    return {
        ...world,
        currentTime: 0,
        plates,
        labels: world.labels.map(label => {
            if (!label.attachedPlateId || !activePlateIds.has(label.attachedPlateId)) {
                return { ...label, attachedPlateId: undefined, anchorTime: 0 };
            }
            const plate = world.plates.find(candidate => candidate.id === label.attachedPlateId)!;
            return {
                ...label,
                anchor: pointPositionAt(plate, world.plates, label.anchor, label.anchorTime, currentTime),
                anchorTime: 0,
            };
        }),
        riftAxes,
        tripleJunctions: (world.tripleJunctions || [])
            .filter(junction => junction.birthTime <= currentTime
                && junction.state !== 'dead'
                && junction.axisIds.every(id => activeAxisIds.has(id)))
            .map(junction => {
                const latestRecorded = [...(junction.junctionHistory || [])]
                    .filter(vertex => vertex.time <= currentTime)
                    .sort((left, right) => right.time - left.time)[0];
                return {
                    ...junction,
                    birthTime: 0,
                    junctionHistory: [
                        ...(latestRecorded ? [{ ...latestRecorded, time: 0 }] : []),
                        ...(junction.junctionHistory || [])
                            .filter(vertex => vertex.time > currentTime)
                            .map(vertex => ({ ...vertex, time: vertex.time - currentTime })),
                    ].sort((left, right) => left.time - right.time),
                };
            }),
    };
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
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        dialog.setAttribute('aria-labelledby', 'save-export-title');
        dialog.style.cssText = `
            background: var(--bg-surface); border: 1px solid var(--border-default); border-radius: var(--radius-lg); padding: 24px;
            min-width: 350px; color: var(--text-primary); font-family: var(--font-family);
            box-shadow: 0 8px 32px rgba(0,0,0,0.4);
        `;

        const currentTime = (window as any).__tectoLiteCurrentTime ?? 0;

        dialog.innerHTML = `
            <h3 id="save-export-title" style="margin: 0 0 16px 0; color: var(--text-primary); display:flex; align-items:center; gap:8px;">${uiIcon('save')} Export save file</h3>
            
            <div style="margin-bottom: 16px;">
                <label style="display: block; margin-bottom: 8px; font-weight: 500;">File Name:</label>
                <input type="text" id="export-filename" value="TectoLite-${new Date().toISOString().split('T')[0]}" 
                    style="width: 100%; padding: 8px 12px; border: 1px solid var(--border-default); border-radius: var(--radius-sm);
                    background: var(--bg-elevated); color: var(--text-primary); box-sizing: border-box;">
            </div>
            
            <div style="margin-bottom: 20px;">
                <label style="display: block; margin-bottom: 8px; font-weight: 500;">Timeline Mode:</label>
                <div style="display: flex; flex-direction: column; gap: 8px;">
                    <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; padding: 8px; 
                        background: var(--bg-elevated); border-radius: var(--radius-sm); border: 1px solid var(--border-default);">
                        <input type="radio" name="export-mode" value="entire_timeline" checked>
                        <div>
                            <div style="font-weight: 500; display:flex; align-items:center; gap:7px;">${uiIcon('history')} Entire timeline</div>
                            <div style="font-size: 12px; color: var(--text-secondary);">${JSON_ENTIRE_TIMELINE_HELP}</div>
                        </div>
                    </label>
                    <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; padding: 8px;
                        background: var(--bg-elevated); border-radius: var(--radius-sm); border: 1px solid var(--border-default);">
                        <input type="radio" name="export-mode" value="from_current_time">
                        <div>
                            <div style="font-weight: 500; display:flex; align-items:center; gap:7px;">${uiIcon('fast-forward')} From current time (${currentTime.toFixed(1)} Ma)</div>
                            <div style="font-size: 12px; color: var(--text-secondary);">${JSON_FROM_CURRENT_HELP}</div>
                        </div>
                    </label>
                </div>
            </div>
            
            <div style="display: flex; gap: 8px; justify-content: flex-end;">
                <button id="export-cancel" style="padding: 8px 16px; border: 1px solid var(--border-default); border-radius: var(--radius-sm);
                    background: var(--bg-elevated); color: var(--text-primary); cursor: pointer;">Cancel</button>
                <button id="export-confirm" style="padding: 8px 16px; border: none; border-radius: 6px;
                    background: var(--accent-primary); color: var(--accent-contrast); cursor: pointer; font-weight: 500;">Export</button>
            </div>
        `;

        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        let settled = false;
        const cleanup = () => {
            window.removeEventListener('keydown', onKeyDown);
            overlay.remove();
            previousFocus?.focus();
        };
        const cancel = () => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve(null);
        };
        const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') cancel(); };
        window.addEventListener('keydown', onKeyDown);

        dialog.querySelector('#export-cancel')?.addEventListener('click', () => {
            cancel();
        });

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                cancel();
            }
        });

        dialog.querySelector('#export-confirm')?.addEventListener('click', () => {
            if (settled) return;
            const filename = (dialog.querySelector('#export-filename') as HTMLInputElement).value.trim();
            const mode = (dialog.querySelector('input[name="export-mode"]:checked') as HTMLInputElement).value as ExportMode;
            settled = true;
            cleanup();
            resolve(filename ? { mode, filename } : null);
        });

        // Focus the filename input
        setTimeout(() => (dialog.querySelector('#export-filename') as HTMLInputElement)?.select(), 50);
    });
}

export async function exportToJSON(state: AppState, cameraViews?: CameraView[]): Promise<void> {
    // Store current time for dialog access
    (window as any).__tectoLiteCurrentTime = state.world.currentTime;

    const options = await showExportDialog();
    if (!options) return; // User cancelled

    let worldToSave = state.world;

    // If exporting from current time, shift all timestamps so currentTime becomes 0
    if (options.mode === 'from_current_time') {
        worldToSave = createWorldFromCurrentTime(state.world);

    }

    const saveData = {
        version: SAVE_VERSION,
        savedAt: new Date().toISOString(),
        name: options.filename,
        exportMode: options.mode,
        exportedAtTime: state.world.currentTime,
        world: worldToSave,
        viewport: state.viewport,
        cameraViews: cameraViews && cameraViews.length > 0 ? cameraViews : undefined,
        activeTool: state.activeTool,
        activeFeatureType: state.activeFeatureType
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

export type ImportMode = 'replace_current' | 'at_beginning' | 'at_current_time';

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
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        dialog.setAttribute('aria-labelledby', 'save-import-title');
        dialog.style.cssText = `
            background: var(--bg-surface); border: 1px solid var(--border-default); border-radius: var(--radius-lg); padding: 24px;
            min-width: 350px; color: var(--text-primary); font-family: var(--font-family);
            box-shadow: 0 8px 32px rgba(0,0,0,0.4);
        `;

        dialog.innerHTML = `
            <h3 id="save-import-title" style="margin: 0 0 16px 0; color: var(--text-primary); display:flex; align-items:center; gap:8px;">${uiIcon('folder-open')} Import save file</h3>
            
            <div style="margin-bottom: 16px; padding: 12px; background: var(--bg-elevated); border-radius: var(--radius-sm);">
                <div style="font-weight: 500; margin-bottom: 4px;">${escapeHtml(filename)}</div>
                <div style="font-size: 12px; color: var(--text-secondary);">${plateCount} plate(s) found</div>
            </div>
            
            <div style="margin-bottom: 20px;">
                <label style="display: block; margin-bottom: 8px; font-weight: 500;">Import Location:</label>
                <div style="display: flex; flex-direction: column; gap: 8px;">
                    <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; padding: 8px; 
                        background: var(--bg-elevated); border-radius: var(--radius-sm); border: 1px solid var(--border-default);">
                        <input type="radio" name="import-mode" value="replace_current" checked>
                        <div>
                            <div style="font-weight: 500; display: flex; align-items: center; gap: 6px;">
                                ${uiIcon('refresh')} Replace current simulation
                                <span title="Restore the saved file exactly. Use Import modes below to merge into the current timeline." style="font-size: 11px; color: var(--text-secondary); cursor: help;">(i)</span>
                            </div>
                            <div style="font-size: 12px; color: var(--text-secondary);">Fully restore the saved state</div>
                        </div>
                    </label>
                    <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; padding: 8px; 
                        background: var(--bg-elevated); border-radius: var(--radius-sm); border: 1px solid var(--border-default);">
                        <input type="radio" name="import-mode" value="at_beginning">
                        <div>
                            <div style="font-weight: 500; display:flex; align-items:center; gap:7px;">${uiIcon('rewind')} At beginning (time 0)</div>
                            <div style="font-size: 12px; color: var(--text-secondary);">Add plates starting from the beginning</div>
                        </div>
                    </label>
                    <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; padding: 8px;
                        background: var(--bg-elevated); border-radius: var(--radius-sm); border: 1px solid var(--border-default);">
                        <input type="radio" name="import-mode" value="at_current_time">
                        <div>
                            <div style="font-weight: 500; display:flex; align-items:center; gap:7px;">${uiIcon('fast-forward')} At current time (${currentTime.toFixed(1)} Ma)</div>
                            <div style="font-size: 12px; color: var(--text-secondary);">Add plates at the current simulation time</div>
                        </div>
                    </label>
                </div>
            </div>
            
            <div style="display: flex; gap: 8px; justify-content: flex-end;">
                <button id="import-cancel" style="padding: 8px 16px; border: 1px solid var(--border-default); border-radius: var(--radius-sm);
                    background: var(--bg-elevated); color: var(--text-primary); cursor: pointer;">Cancel</button>
                <button id="import-confirm" style="padding: 8px 16px; border: none; border-radius: 6px;
                    background: var(--accent-success); color: var(--accent-contrast); cursor: pointer; font-weight: 500;">Import</button>
            </div>
        `;

        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        let settled = false;
        const cleanup = () => {
            window.removeEventListener('keydown', onKeyDown);
            overlay.remove();
            previousFocus?.focus();
        };
        const cancel = () => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve(null);
        };
        const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') cancel(); };
        window.addEventListener('keydown', onKeyDown);

        dialog.querySelector('#import-cancel')?.addEventListener('click', () => {
            cancel();
        });

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                cancel();
            }
        });

        dialog.querySelector('#import-confirm')?.addEventListener('click', () => {
            if (settled) return;
            const mode = (dialog.querySelector('input[name="import-mode"]:checked') as HTMLInputElement).value as ImportMode;
            settled = true;
            cleanup();
            resolve(mode);
        });
        (dialog.querySelector('input[name="import-mode"]:checked') as HTMLInputElement | null)?.focus();
    });
}

// Parse file to get metadata without full import
export function parseImportFile(file: File): Promise<{ world: WorldState; viewport?: any; name: string; activeTool?: string; activeFeatureType?: string; cameraViews?: CameraView[] }> {
    return new Promise((resolve, reject) => {
        try {
            assertProjectFileSize(file.size);
        } catch (error) {
            reject(error);
            return;
        }
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const text = e.target?.result as string;
                resolve(parseProjectText(text, file.name));
            } catch (err) {
                reject(err);
            }
        };
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsText(file);
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
    showGrid?: boolean;
    includePaint?: boolean;
    includeFeatures?: boolean;
    includeLandmasses?: boolean;
}

export function showUnifiedExportDialog(defaults?: {
    projection?: ProjectionType;
    showGrid?: boolean;
    includeFeatures?: boolean;
}): Promise<UnifiedExportOptions | null> {
    return new Promise((resolve) => {
        const pngDefaults = {
            projection: defaults?.projection || 'orthographic',
            showGrid: defaults?.showGrid ?? true,
            includeFeatures: defaults?.includeFeatures ?? true
        };

        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position: fixed; top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.7); z-index: 10000;
            display: flex; align-items: center; justify-content: center;
        `;

        const dialog = document.createElement('div');
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        dialog.setAttribute('aria-labelledby', 'unified-export-title');
        dialog.style.cssText = `
            background: var(--bg-surface); border: 1px solid var(--border-default); border-radius: var(--radius-lg); padding: 24px;
            min-width: 450px; color: var(--text-primary); font-family: var(--font-family);
            box-shadow: 0 8px 32px rgba(0,0,0,0.4);
            max-height: 80vh; overflow-y: auto;
        `;

        dialog.innerHTML = `
            <h3 id="unified-export-title" style="margin: 0 0 20px 0; color: var(--text-primary); display:flex; align-items:center; gap:8px;">${uiIcon('upload')} Export options</h3>
            
            <!-- Format Selector -->
            <div style="margin-bottom: 20px;">
                <label style="display: block; margin-bottom: 12px; font-weight: 500;">Export Format:</label>
                <div style="display: flex; gap: 8px;">
                    <button id="fmt-png" class="format-btn" style="flex: 1; padding: 10px; border: 2px solid var(--accent-primary); background: var(--bg-elevated); border-radius: var(--radius-sm); color: var(--text-primary); cursor: pointer; font-weight: 600; display:inline-flex; align-items:center; justify-content:center; gap:7px;">
                        ${uiIcon('image')} PNG image
                    </button>
                    <button id="fmt-heightmap" class="format-btn" style="flex: 1; padding: 10px; border: 2px solid var(--border-default); background: var(--bg-elevated); border-radius: var(--radius-sm); color: var(--text-primary); cursor: pointer; font-weight: 600; display:inline-flex; align-items:center; justify-content:center; gap:7px;">
                        ${uiIcon('map')} Heightmap
                    </button>
                    <button id="fmt-qgis" class="format-btn" style="flex: 1; padding: 10px; border: 2px solid var(--border-default); background: var(--bg-elevated); border-radius: var(--radius-sm); color: var(--text-primary); cursor: pointer; font-weight: 600; display:inline-flex; align-items:center; justify-content:center; gap:7px;">
                        ${uiIcon('globe')} QGIS
                    </button>
                </div>
            </div>

            <!-- PNG Options -->
            <div id="options-png" style="display: block; margin-bottom: 20px; padding: 16px; background: var(--bg-elevated); border-radius: var(--radius-sm); border-left: 3px solid var(--accent-primary);">
                <label style="display: block; margin-bottom: 12px; font-weight: 500;">Projection:</label>
                <select id="export-projection" style="width: 100%; padding: 8px 12px; border: 1px solid var(--border-default); border-radius: var(--radius-sm); background: var(--bg-dark); color: var(--text-primary); margin-bottom: 12px;">
                    <option value="orthographic">Globe (Orthographic)</option>
                    <option value="equirectangular">Flat Map (Equirectangular)</option>
                    <option value="mercator">Mercator</option>
                    <option value="mollweide">Mollweide</option>
                    <option value="robinson">Robinson</option>
                </select>
                <label style="display: block; margin-bottom: 8px; font-weight: 500;">Preset:</label>
                <select id="png-preset" style="width: 100%; padding: 8px 12px; border: 1px solid var(--border-default); border-radius: var(--radius-sm); background: var(--bg-dark); color: var(--text-primary); margin-bottom: 12px;">
                    <option value="custom" selected>Custom</option>
                    <option value="presentation">Presentation (1920×1080)</option>
                    <option value="print">Print (4096×2160)</option>
                    <option value="gis">GIS Clean (4096×2048)</option>
                </select>
                <label style="display: block; margin-bottom: 12px; font-weight: 500;">Layers:</label>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 12px;">
                    <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
                        <input type="checkbox" id="png-show-grid" ${pngDefaults.showGrid ? 'checked' : ''}>
                        <span>Show Grid</span>
                    </label>
                    <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
                        <input type="checkbox" id="png-include-features" ${pngDefaults.includeFeatures ? 'checked' : ''}>
                        <span>Features</span>
                    </label>
                </div>
                <label style="display: block; margin-bottom: 12px; font-weight: 500;">Resolution:</label>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                    <div>
                        <label style="font-size: 12px; color: var(--text-secondary);">Width</label>
                        <input type="number" id="export-width" value="1920" style="width: 100%; padding: 8px; border: 1px solid var(--border-default); border-radius: var(--radius-sm); background: var(--bg-dark); color: var(--text-primary);">
                    </div>
                    <div>
                        <label style="font-size: 12px; color: var(--text-secondary);">Height</label>
                        <input type="number" id="export-height" value="1080" style="width: 100%; padding: 8px; border: 1px solid var(--border-default); border-radius: var(--radius-sm); background: var(--bg-dark); color: var(--text-primary);">
                    </div>
                </div>
                <div id="export-crop-guidance" role="note" style="font-size: 10px; line-height: 1.35; color: var(--text-secondary); margin-top: 8px;">${EXPORT_CROP_HELP}</div>
            </div>

            <!-- Heightmap Options -->
            <div id="options-heightmap" style="display: none; margin-bottom: 20px; padding: 16px; background: var(--bg-elevated); border-radius: var(--radius-sm); border-left: 3px solid var(--accent-primary);">
                <label style="display: block; margin-bottom: 12px; font-weight: 500;">Projection:</label>
                <select id="hm-projection" style="width: 100%; padding: 8px 12px; border: 1px solid var(--border-default); border-radius: var(--radius-sm); background: var(--bg-dark); color: var(--text-primary); margin-bottom: 12px;">
                    <option value="equirectangular">Equirectangular</option>
                    <option value="mercator">Mercator</option>
                    <option value="mollweide">Mollweide</option>
                    <option value="robinson">Robinson</option>
                    <option value="orthographic">Orthographic (Globe)</option>
                </select>
                <label style="display: block; margin-bottom: 12px; font-weight: 500;">Resolution:</label>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                    <div>
                        <label style="font-size: 12px; color: var(--text-secondary);">Width</label>
                        <input type="number" id="hm-width" value="4096" style="width: 100%; padding: 8px; border: 1px solid var(--border-default); border-radius: var(--radius-sm); background: var(--bg-dark); color: var(--text-primary);">
                    </div>
                    <div>
                        <label style="font-size: 12px; color: var(--text-secondary);">Height</label>
                        <input type="number" id="hm-height" value="2048" style="width: 100%; padding: 8px; border: 1px solid var(--border-default); border-radius: var(--radius-sm); background: var(--bg-dark); color: var(--text-primary);">
                    </div>
                </div>
            </div>

            <!-- QGIS Options -->
            <div id="options-qgis" style="display: none; margin-bottom: 20px; padding: 16px; background: var(--bg-elevated); border-radius: var(--radius-sm); border-left: 3px solid var(--accent-primary);">
                <label style="display: block; margin-bottom: 12px; font-weight: 500;">Projection:</label>
                <select id="qgis-projection" style="width: 100%; padding: 8px 12px; border: 1px solid var(--border-default); border-radius: var(--radius-sm); background: var(--bg-dark); color: var(--text-primary); margin-bottom: 12px;">
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
                        <label style="font-size: 12px; color: var(--text-secondary);">Width</label>
                        <input type="number" id="qgis-width" value="2048" style="width: 100%; padding: 8px; border: 1px solid var(--border-default); border-radius: var(--radius-sm); background: var(--bg-dark); color: var(--text-primary);">
                    </div>
                    <div>
                        <label style="font-size: 12px; color: var(--text-secondary);">Height</label>
                        <input type="number" id="qgis-height" value="1024" style="width: 100%; padding: 8px; border: 1px solid var(--border-default); border-radius: var(--radius-sm); background: var(--bg-dark); color: var(--text-primary);">
                    </div>
                </div>
            </div>

            <div style="display: flex; gap: 8px; justify-content: flex-end;">
                <button id="export-cancel" style="padding: 10px 20px; border: 1px solid var(--border-default); border-radius: var(--radius-sm); background: var(--bg-elevated); color: var(--text-primary); cursor: pointer; font-weight: 500;">Cancel</button>
                <button id="export-confirm" style="padding: 10px 20px; border: none; border-radius: var(--radius-sm); background: var(--accent-primary); color: var(--accent-contrast); cursor: pointer; font-weight: 600;">Export</button>
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
                    (b as HTMLElement).style.borderColor = 'var(--border-default)';
                });
                (target as HTMLElement).style.borderColor = 'var(--accent-primary)';

                // Show/hide option panels
                (dialog.querySelector('#options-png') as HTMLElement).style.display = format === 'png' ? 'block' : 'none';
                (dialog.querySelector('#options-heightmap') as HTMLElement).style.display = format === 'heightmap' ? 'block' : 'none';
                (dialog.querySelector('#options-qgis') as HTMLElement).style.display = format === 'qgis' ? 'block' : 'none';
            });
        });

        const select = dialog.querySelector('#export-projection') as HTMLSelectElement | null;
        if (select) select.value = pngDefaults.projection;

        const applyPngPreset = (preset: string) => {
            const width = dialog.querySelector('#export-width') as HTMLInputElement;
            const height = dialog.querySelector('#export-height') as HTMLInputElement;
            const grid = dialog.querySelector('#png-show-grid') as HTMLInputElement;
            const features = dialog.querySelector('#png-include-features') as HTMLInputElement;

            if (!width || !height || !grid || !features) return;

            if (preset === 'presentation') {
                width.value = '1920';
                height.value = '1080';
                grid.checked = false;
                features.checked = true;
            } else if (preset === 'print') {
                width.value = '4096';
                height.value = '2160';
                grid.checked = false;
                features.checked = true;
            } else if (preset === 'gis') {
                width.value = '4096';
                height.value = '2048';
                grid.checked = true;
                features.checked = false;
            }
        };

        const presetSelect = dialog.querySelector('#png-preset') as HTMLSelectElement | null;
        presetSelect?.addEventListener('change', () => {
            applyPngPreset(presetSelect.value);
        });

        const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        let settled = false;
        const cleanup = () => {
            window.removeEventListener('keydown', onKeyDown);
            overlay.remove();
            previousFocus?.focus();
        };
        const onCancel = () => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve(null);
        };
        const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onCancel(); };
        window.addEventListener('keydown', onKeyDown);

        dialog.querySelector('#export-cancel')?.addEventListener('click', onCancel);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) onCancel(); });

        dialog.querySelector('#export-confirm')?.addEventListener('click', () => {
            if (settled) return;
            let result: UnifiedExportOptions | null = null;

            if (selectedFormat === 'png') {
                const w = parseInt((dialog.querySelector('#export-width') as HTMLInputElement).value);
                const h = parseInt((dialog.querySelector('#export-height') as HTMLInputElement).value);
                const proj = (dialog.querySelector('#export-projection') as HTMLSelectElement).value as ProjectionType;
                const showGrid = (dialog.querySelector('#png-show-grid') as HTMLInputElement).checked;
                const includeFeatures = (dialog.querySelector('#png-include-features') as HTMLInputElement).checked;
                if (w > 0 && h > 0) {
                    result = {
                        format: 'png',
                        projection: proj,
                        width: w,
                        height: h,
                        showGrid,
                        includeFeatures
                    };
                }
            } else if (selectedFormat === 'heightmap') {
                const w = parseInt((dialog.querySelector('#hm-width') as HTMLInputElement).value);
                const h = parseInt((dialog.querySelector('#hm-height') as HTMLInputElement).value);
                const proj = (dialog.querySelector('#hm-projection') as HTMLSelectElement).value as ProjectionType;
                if (w > 0 && h > 0) {
                    result = { format: 'heightmap', projection: proj, width: w, height: h };
                }
            } else if (selectedFormat === 'qgis') {
                const w = parseInt((dialog.querySelector('#qgis-width') as HTMLInputElement).value);
                const h = parseInt((dialog.querySelector('#qgis-height') as HTMLInputElement).value);
                const proj = (dialog.querySelector('#qgis-projection') as HTMLSelectElement).value as ProjectionType;
                const hm = (dialog.querySelector('#qgis-heightmap') as HTMLInputElement).checked;
                if (w > 0 && h > 0) {
                    result = { format: 'qgis', projection: proj, width: w, height: h, includeHeightmap: hm };
                }
            }
            if (!result) return;
            settled = true;
            cleanup();
            resolve(result);
        });
        (dialog.querySelector('#fmt-png') as HTMLButtonElement | null)?.focus();
    });
}
