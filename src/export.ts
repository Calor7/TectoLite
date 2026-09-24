import { mountDialogSurface } from './ui/DialogSurface';
import { setFieldError } from './ui/Fields';
import { saveProjectFile, type ProjectSaveResult } from './persistence/ProjectSave';
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
    gridOnTop?: boolean;
    showBorders?: boolean;
    includeLines?: boolean;
    includeFeatures?: boolean;
    includeLabels?: boolean;
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
    renderPNGExport(state, options, canvas);

    // Trigger download
    const link = document.createElement('a');
    link.download = `tectolite-export-${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
}

/** Shared by the preview and download so layer choices and cropping stay identical. */
export function renderPNGExport(state: AppState, options: PNGExportOptions, canvas: HTMLCanvasElement): void {
    const { width, height } = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not create the export canvas. Try a smaller resolution.');
    ctx.clearRect(0, 0, width, height);

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

    const drawGrid = () => {
        ctx.save();
        ctx.strokeStyle = waterMode === 'color' ? 'rgba(230, 240, 255, 0.4)' : 'rgba(25, 40, 55, 0.4)';
        ctx.lineWidth = (state.world.globalOptions.gridThickness || 1) * ratio;
        ctx.beginPath();
        path(geoGraticule()());
        ctx.stroke();
        ctx.restore();
    };
    if (options.showGrid && options.gridOnTop === false) drawGrid();

    const groupOpacity = new Map(state.world.entityGroups.map(group => [group.id, group.opacity ?? 1]));
    const visiblePlates = sortPlatesForRendering(state.world.plates).filter(plate =>
        plate.visible && currentTime >= plate.birthTime
        && (plate.deathTime === null || currentTime < plate.deathTime)
    );

    // 3. Plates
    for (const plate of visiblePlates) {
        const opacity = plate.groupId ? (groupOpacity.get(plate.groupId) ?? 1) : 1;
        ctx.save();

        // Polygons
        for (const polygon of plate.polygons) {
            const isLine = plate.type === 'rift' || polygon.closed === false;
            if (isLine && options.includeLines === false) continue;
            const geojson = toGeoJSON(polygon);
            if (geoArea(geojson) > 2 * Math.PI) geojson.geometry.coordinates[0].reverse();

            ctx.beginPath();
            path(geojson);

            // Plate Color Logic
            if (!isLine) {
                ctx.globalAlpha = opacity * (state.world.globalOptions.plateOpacity ?? 1)
                    * (plate.type === 'oceanic' ? (state.world.globalOptions.oceanicCrustOpacity ?? 0.5) : 1);
                if (plateColorMode === 'land') {
                    ctx.fillStyle = '#C2B280'; // Ecru/Sand Land Color
                } else {
                    ctx.fillStyle = plate.color;
                }
                ctx.fill();
            }

            ctx.globalAlpha = opacity;
            // Open geological lines are separate content, not polygon borders.
            if (!isLine && options.showBorders === false) continue;
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
        ctx.restore();
    }

    if (options.showGrid && options.gridOnTop !== false) drawGrid();

    // Symbols and annotations stay legible above the map and grid.
    for (const plate of visiblePlates) {
        if (includeFeatures !== false) {
            for (const feature of plate.features) {
                const opacity = resolveFeatureTimelineOpacity(
                    feature,
                    currentTime,
                    state.world.showFutureFeatures
                );
                if (opacity === null) continue;
                drawFeature(ctx, pm, feature, ratio, opacity * (plate.groupId ? (groupOpacity.get(plate.groupId) ?? 1) : 1));
            }
        }
    }

    // Flag labels are annotation overlays and intentionally render last.
    for (const label of options.includeLabels === false ? [] : state.world.labels ?? []) {
        if (!label.visible) continue;
        let position = label.anchor;
        if (label.attachedPlateId) {
            const plate = state.world.plates.find(candidate => candidate.id === label.attachedPlateId);
            if (!plate || currentTime < plate.birthTime || (plate.deathTime !== null && currentTime >= plate.deathTime)) continue;
            position = pointPositionAt(plate, state.world.plates, label.anchor, label.anchorTime, currentTime);
        }
        drawExportLabel(ctx, pm, label, position, ratio, label.groupId ? (groupOpacity.get(label.groupId) ?? 1) : 1);
    }
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

export function showExportDialog(currentTime = 0): Promise<ExportOptions | null> {
    return new Promise((resolve) => {
        // Create modal overlay
        const overlay = document.createElement('div');

        const dialog = document.createElement('div');
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        dialog.setAttribute('aria-labelledby', 'save-export-title');


        dialog.innerHTML = `
            <h3 id="save-export-title" style="margin: 0 0 16px 0; color: var(--text-primary); display:flex; align-items:center; gap:8px;">${uiIcon('save')} Save project</h3>
            
            <div style="margin-bottom: 16px;">
                <label style="display: block; margin-bottom: 8px; font-weight: 500;">File Name:</label>
                <input type="text" id="export-filename" value="TectoLite-${new Date().toISOString().split('T')[0]}" 
                    style="width: 100%; padding: 8px 12px; border: 1px solid var(--border-default); border-radius: var(--radius-sm);
                    background: var(--bg-elevated); color: var(--text-primary); box-sizing: border-box;">
                <p id="save-name-error" class="field-error" role="alert" hidden></p>
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
                    background: var(--accent-primary); color: var(--accent-contrast); cursor: pointer; font-weight: 500;">Save project</button>
            </div>
        `;

        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        let settled = false;
        const cancel = () => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve(null);
        };
        const cleanup = mountDialogSurface(overlay, dialog, { cancel, initialFocus: dialog.querySelector<HTMLInputElement>('#export-filename') });

        dialog.querySelector('#export-cancel')?.addEventListener('click', () => {
            cancel();
        });


        dialog.querySelector('#export-confirm')?.addEventListener('click', () => {
            if (settled) return;
            const filename = (dialog.querySelector('#export-filename') as HTMLInputElement).value.trim();
            if (!filename) {
                setFieldError(dialog.querySelector<HTMLInputElement>('#export-filename')!, dialog.querySelector<HTMLElement>('#save-name-error')!, 'Enter a project file name.');
                dialog.querySelector<HTMLInputElement>('#export-filename')!.focus();
                return;
            }
            const mode = (dialog.querySelector('input[name="export-mode"]:checked') as HTMLInputElement).value as ExportMode;
            settled = true;
            cleanup();
            resolve(filename ? { mode, filename } : null);
        });

        dialog.querySelector<HTMLInputElement>('#export-filename')?.addEventListener('input', event => {
            setFieldError(event.target as HTMLInputElement, dialog.querySelector<HTMLElement>('#save-name-error')!, '');
        });

        // Focus the filename input
        setTimeout(() => (dialog.querySelector('#export-filename') as HTMLInputElement)?.select(), 50);
    });
}

export async function exportToJSON(state: AppState, cameraViews?: CameraView[]): Promise<ProjectSaveResult> {
    const options = await showExportDialog(state.world.currentTime);
    if (!options) return 'cancelled';

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
    const sanitizedName = options.filename.replace(/[^a-zA-Z0-9_-]/g, '_');
    return saveProjectFile(json, sanitizedName + '.json');
}

export type ImportMode = 'replace_current' | 'at_beginning' | 'at_current_time';

export function showImportDialog(filename: string, plateCount: number, currentTime: number): Promise<ImportMode | null> {
    return new Promise((resolve) => {
        // Create modal overlay
        const overlay = document.createElement('div');

        const dialog = document.createElement('div');
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        dialog.setAttribute('aria-labelledby', 'save-import-title');

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
                                <span class="info-icon" title="Restore the saved file exactly. Use Import modes below to merge into the current timeline." style="font-size: 12px; color: var(--text-secondary); cursor: help;">(i)</span>
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

        let settled = false;
        const cancel = () => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve(null);
        };
        const cleanup = mountDialogSurface(overlay, dialog, { cancel, initialFocus: dialog.querySelector<HTMLInputElement>('input[name="import-mode"]:checked') });

        dialog.querySelector('#import-cancel')?.addEventListener('click', () => {
            cancel();
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
export type UnifiedExportFormat = 'png' | 'heightmap' | 'qgis' | 'project';

export interface UnifiedExportOptions {
    format: UnifiedExportFormat;
    projection?: ProjectionType;
    width?: number;
    height?: number;
    includeHeightmap?: boolean;
    showGrid?: boolean;
    gridOnTop?: boolean;
    showBorders?: boolean;
    waterMode?: PNGExportOptions['waterMode'];
    plateColorMode?: PNGExportOptions['plateColorMode'];
    includeLines?: boolean;
    includeFeatures?: boolean;
    includeLabels?: boolean;
}

export function showUnifiedExportDialog(defaults?: {
    projection?: ProjectionType;
    showGrid?: boolean;
    includeFeatures?: boolean;
}, previewState?: AppState): Promise<UnifiedExportOptions | null> {
    return new Promise((resolve) => {
        const pngDefaults = {
            projection: defaults?.projection || 'orthographic',
            showGrid: defaults?.showGrid ?? true,
            includeFeatures: defaults?.includeFeatures ?? true
        };

        const overlay = document.createElement('div');

        const dialog = document.createElement('div');
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        dialog.setAttribute('aria-labelledby', 'unified-export-title');

        dialog.innerHTML = `
            <h3 id="unified-export-title" style="margin: 0 0 20px 0; color: var(--text-primary); display:flex; align-items:center; gap:8px;">${uiIcon('upload')} Export options</h3>
            
            <!-- Format Selector -->
            <div style="margin-bottom: 20px;">
                <label style="display: block; margin-bottom: 12px; font-weight: 500;">Export Format:</label>
                <div style="display: flex; flex-wrap: wrap; gap: 8px;">
                    <button id="fmt-png" class="format-btn" style="flex: 1; padding: 10px; border: 2px solid var(--accent-primary); background: var(--bg-elevated); border-radius: var(--radius-sm); color: var(--text-primary); cursor: pointer; font-weight: 600; display:inline-flex; align-items:center; justify-content:center; gap:7px;">
                        ${uiIcon('image')} PNG image
                    </button>
                    <button id="fmt-heightmap" class="format-btn" style="flex: 1; padding: 10px; border: 2px solid var(--border-default); background: var(--bg-elevated); border-radius: var(--radius-sm); color: var(--text-primary); cursor: pointer; font-weight: 600; display:inline-flex; align-items:center; justify-content:center; gap:7px;">
                        ${uiIcon('map')} Heightmap
                    </button>
                    <button id="fmt-qgis" class="format-btn" style="flex: 1; padding: 10px; border: 2px solid var(--border-default); background: var(--bg-elevated); border-radius: var(--radius-sm); color: var(--text-primary); cursor: pointer; font-weight: 600; display:inline-flex; align-items:center; justify-content:center; gap:7px;">
                        ${uiIcon('globe')} QGIS
                    </button>
                    <button id="fmt-project" class="format-btn" style="flex: 1; padding: 10px; border: 2px solid var(--border-default); background: var(--bg-elevated); border-radius: var(--radius-sm); color: var(--text-primary); cursor: pointer; font-weight: 600;">
                        ${uiIcon('save')} Editable project
                    </button>
                </div>
            </div>

            <p id="export-format-help" style="font-size: 12px; line-height: 1.5; color: var(--text-secondary);"></p>
            <p style="font-size: 12px; color: var(--text-secondary);">Export creates a copy. Your open map stays editable.</p>

            <div class="export-png-layout">
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
                    <option value="editing">Edit in another app (transparent, no borders)</option>
                </select>
                <label style="display: block; margin-bottom: 12px; font-weight: 500;">Layers:</label>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 12px;">
                    <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
                        <input type="checkbox" id="png-show-grid" ${pngDefaults.showGrid ? 'checked' : ''}>
                        <span>Latitude / longitude grid</span>
                    </label>
                    <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
                        <input type="checkbox" id="png-include-features" ${pngDefaults.includeFeatures ? 'checked' : ''}>
                        <span>Feature symbols</span>
                    </label>
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 12px;">
                    <label><input type="checkbox" id="png-show-borders" checked> Plate outlines</label>
                    <label><input type="checkbox" id="png-include-lines" checked> Geological lines</label>
                    <label><input type="checkbox" id="png-include-labels" checked> Flag labels</label>
                </div>
                <p style="font-size: 12px; color: var(--text-secondary);">Turn off plate outlines for borderless land. Geological lines are controlled separately.</p>
                <div class="export-appearance">
                    <label>Grid placement
                        <select id="png-grid-position">
                            <option value="above">Above land and ocean</option>
                            <option value="below">Below land</option>
                        </select>
                    </label>
                    <label>Background
                        <select id="png-background">
                            <option value="color">Ocean color</option>
                            <option value="transparent">Transparent</option>
                            <option value="white">White</option>
                        </select>
                    </label>
                    <label>Land colors
                        <select id="png-colors">
                            <option value="native">Plate colors</option>
                            <option value="land">Single land color</option>
                        </select>
                    </label>
                </div>
                <label style="display: block; margin-bottom: 12px; font-weight: 500;">Resolution (pixels):</label>
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
                <button type="button" id="png-match-view" class="export-view-button" ${previewState ? '' : 'hidden'}>Match current view proportions</button>
                <div id="export-crop-guidance" role="note" style="font-size: 12px; line-height: 1.35; color: var(--text-secondary); margin-top: 8px;">${EXPORT_CROP_HELP}</div>
            </div>

            <figure id="png-preview-panel" class="export-preview-panel" ${previewState ? '' : 'hidden'}>
                <div class="export-preview-surface"><canvas id="png-preview" role="img" aria-label="PNG export preview"></canvas></div>
                <figcaption id="png-preview-caption" style="font-size: 12px; margin-top: 6px; color: var(--text-secondary);"></figcaption>
            </figure>
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

            <p id="export-error" role="alert" class="field-error" hidden></p>
            <div class="export-actions">
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
                const target = e.currentTarget as HTMLElement;
                const formatId = target.id;
                const format = formatId.replace('fmt-', '') as UnifiedExportFormat;

                selectedFormat = format;
                if (format === 'project') {
                    settled = true; cleanup(); resolve({ format: 'project' }); return;
                }

                // Update button styles
                formatBtns.forEach((b) => {
                    (b as HTMLElement).style.borderColor = 'var(--border-default)';
                });
                (target as HTMLElement).style.borderColor = 'var(--accent-primary)';

                // Show/hide option panels
                (dialog.querySelector('#options-png') as HTMLElement).style.display = format === 'png' ? 'block' : 'none';
                (dialog.querySelector('#options-heightmap') as HTMLElement).style.display = format === 'heightmap' ? 'block' : 'none';
                (dialog.querySelector('#options-qgis') as HTMLElement).style.display = format === 'qgis' ? 'block' : 'none';
                updateExportDetails();
            });
        });

        const select = dialog.querySelector('#export-projection') as HTMLSelectElement | null;
        if (select) select.value = pngDefaults.projection;

        const input = (id: string) => dialog.querySelector<HTMLInputElement>('#' + id)!;
        const choice = (id: string) => dialog.querySelector<HTMLSelectElement>('#' + id)!;
        const presetSelect = choice('png-preset');
        const confirm = dialog.querySelector<HTMLButtonElement>('#export-confirm')!;
        const error = dialog.querySelector<HTMLElement>('#export-error')!;
        const preview = dialog.querySelector<HTMLCanvasElement>('#png-preview')!;
        const readPngOptions = (): PNGExportOptions => ({
            projection: choice('export-projection').value as ProjectionType,
            waterMode: choice('png-background').value as PNGExportOptions['waterMode'],
            plateColorMode: choice('png-colors').value as PNGExportOptions['plateColorMode'],
            showGrid: input('png-show-grid').checked,
            gridOnTop: choice('png-grid-position').value === 'above',
            showBorders: input('png-show-borders').checked,
            includeLines: input('png-include-lines').checked,
            includeFeatures: input('png-include-features').checked,
            includeLabels: input('png-include-labels').checked,
        });
        const dimensions = () => {
            const prefix = selectedFormat === 'png' ? 'export' : selectedFormat === 'heightmap' ? 'hm' : 'qgis';
            return { width: Number(input(prefix + '-width').value), height: Number(input(prefix + '-height').value) };
        };
        const formatHelp: Record<UnifiedExportFormat, string> = {
            png: 'PNG is a flat image for sharing or painting. Use a transparent background for compositing. To keep plates, motion, and history editable in TectoLite, save an Editable project too.',
            heightmap: 'Heightmap is a grayscale elevation image for terrain tools. It does not preserve editable plates or timeline history.',
            qgis: 'QGIS exports a GeoPackage with geographic vector layers and an optional heightmap for GIS editing.',
            project: 'Save a TectoLite JSON project to reopen plates, features, and motion. Choose Entire Timeline in the next step to preserve all earlier history.',
        };
        const updateExportDetails = () => {
            formatBtns.forEach(button => button.setAttribute('aria-pressed', String(button.id === 'fmt-' + selectedFormat)));
            dialog.querySelector('#export-format-help')!.textContent = formatHelp[selectedFormat];
            confirm.textContent = selectedFormat === 'project' ? 'Continue to Save project' : selectedFormat === 'png' ? 'Export PNG' : selectedFormat === 'heightmap' ? 'Export heightmap' : 'Export GeoPackage';
            dialog.querySelector<HTMLElement>('#png-preview-panel')!.hidden = selectedFormat !== 'png' || !previewState;
            choice('png-grid-position').disabled = !input('png-show-grid').checked;
            const { width, height } = selectedFormat === 'project' ? { width: 1, height: 1 } : dimensions();
            const valid = Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0
                && width <= 16384 && height <= 16384 && width * height <= 67108864;
            confirm.disabled = !valid;
            error.classList.add('field-error');
            if (selectedFormat !== 'project') {
                const prefix = selectedFormat === 'png' ? 'export' : selectedFormat === 'heightmap' ? 'hm' : 'qgis';
                [input(prefix + '-width'), input(prefix + '-height')].forEach(control => {
                    const value = Number(control.value);
                    const invalid = !Number.isInteger(value) || value < 1 || value > 16384 || width * height > 67108864;
                    control.setAttribute('aria-invalid', String(invalid));
                    control.setAttribute('aria-describedby', 'export-error');
                });
            }
            if (!valid && selectedFormat === 'png') {
                dialog.querySelector('#png-preview-caption')!.textContent = 'Last valid preview — correct the dimensions to update it.';
            }
            error.hidden = valid;
            error.textContent = valid ? '' : 'Enter whole pixel dimensions from 1 to 16,384, up to 64 megapixels in total.';
            if (!valid || selectedFormat !== 'png' || !previewState) return;
            const scale = Math.min(640 / width, 240 / height, 1);
            preview.width = Math.max(1, Math.round(width * scale));
            preview.height = Math.max(1, Math.round(height * scale));
            try {
                renderPNGExport(previewState, readPngOptions(), preview);
                dialog.querySelector('#png-preview-caption')!.textContent = width + ' × ' + height + ' px · Current map view · Preview at reduced size';
            } catch (cause) {
                error.hidden = false;
                error.textContent = cause instanceof Error ? cause.message : 'Could not render the preview.';
                confirm.disabled = true;
            }
        };
        presetSelect.addEventListener('change', () => {
            const preset = presetSelect.value;
            if (preset === 'custom') return;
            input('export-width').value = preset === 'presentation' ? '1920' : '4096';
            input('export-height').value = preset === 'presentation' ? '1080' : preset === 'print' ? '2160' : '2048';
            if (preset === 'editing') {
                choice('png-background').value = 'transparent';
                for (const id of ['png-show-grid', 'png-show-borders', 'png-include-lines', 'png-include-features', 'png-include-labels']) {
                    input(id).checked = false;
                }
            }
            updateExportDetails();
        });
        dialog.querySelector('#png-match-view')?.addEventListener('click', () => {
            if (!previewState) return;
            const width = Number(input('export-width').value);
            input('export-height').value = String(Math.max(1, Math.round(width * previewState.viewport.height / previewState.viewport.width)));
            presetSelect.value = 'custom';
            updateExportDetails();
        });
        dialog.addEventListener('input', event => {
            if (event.target === presetSelect) return;
            if (selectedFormat === 'png') presetSelect.value = 'custom';
            updateExportDetails();
        });
        // Pair visible labels with their inputs, including resolution and projection.
        dialog.querySelectorAll('input[id], select[id]').forEach(control => {
            const label = control.previousElementSibling;
            if (label instanceof HTMLLabelElement) label.htmlFor = control.id;
        });
        updateExportDetails();

        let settled = false;
        const onCancel = () => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve(null);
        };
        const cleanup = mountDialogSurface(overlay, dialog, {
            cancel: onCancel, width: '980px', initialFocus: dialog.querySelector<HTMLButtonElement>('#fmt-png')
        });

        dialog.querySelector('#export-cancel')?.addEventListener('click', onCancel);

        dialog.querySelector('#export-confirm')?.addEventListener('click', () => {
            if (settled || confirm.disabled) return;
            const result: UnifiedExportOptions = selectedFormat === 'project'
                ? { format: 'project' }
                : selectedFormat === 'png'
                    ? { format: 'png', ...readPngOptions(), ...dimensions() }
                    : selectedFormat === 'heightmap'
                        ? { format: 'heightmap', projection: choice('hm-projection').value as ProjectionType, ...dimensions() }
                        : {
                            format: 'qgis',
                            projection: choice('qgis-projection').value as ProjectionType,
                            includeHeightmap: input('qgis-heightmap').checked,
                            ...dimensions(),
                        };
            settled = true;
            cleanup();
            resolve(result);
        });
        (dialog.querySelector('#fmt-png') as HTMLButtonElement | null)?.focus();
    });
}
