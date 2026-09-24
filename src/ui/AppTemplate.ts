/**
 * AppTemplate - Main application HTML template.
 * Extracted from main.ts TectoLiteApp.getHTML() method.
 */
import {
  GlobalOptions,
  LineType,
  LINE_TYPE_LABELS,
  DASH_PRESETS,
  resolveLineTypeDefaults,
} from '../types';
import { FEATURE_TOOL_HELP, FUSE_TOOL_HELP, LINK_TOOL_HELP } from './workflowGuidance';
import { uiIcon } from './icons';
import { FEATURE_ICON_CATALOG, FEATURE_TOOL_TYPES, featureToolIcon } from '../canvas/featureIcons';

const APP_VERSION = typeof __APP_VERSION__ === 'undefined' ? 'development' : __APP_VERSION__;
const WINDOWS_PORTABLE_DOWNLOAD_URL = `https://github.com/Calor7/TectoLite/releases/latest/download/TectoLite-Portable-${APP_VERSION}-x64.exe`;

export interface AppTemplateOptions {
  globalOptions: GlobalOptions;
  realWorldPresetListHtml: string;
  customPresetListHtml: string;
}

function renderAppearanceSettings(): string {
  return `
                    <div class="dropdown-section appearance-settings">
                        <div class="dropdown-header">Appearance</div>
                        <label class="view-dropdown-item ui-default-colors-row">
                            <span>Use default UI colors</span>
                            <input type="checkbox" id="check-use-default-ui-colors" checked>
                        </label>
                        <fieldset id="ui-color-custom-fields" class="ui-color-custom-fields" disabled>
                            <label class="ui-color-row" for="ui-color-background"><span>Background</span><input type="color" id="ui-color-background" value="#13171f"></label>
                            <label class="ui-color-row" for="ui-color-surface"><span>Panels</span><input type="color" id="ui-color-surface" value="#1f303e"></label>
                            <label class="ui-color-row" for="ui-color-controls"><span>Controls</span><input type="color" id="ui-color-controls" value="#252f3e"></label>
                            <label class="ui-color-row" for="ui-color-text"><span>Text</span><input type="color" id="ui-color-text" value="#eff6fb"></label>
                            <label class="ui-color-row" for="ui-color-accent"><span>Accent</span><input type="color" id="ui-color-accent" value="#00bde3"></label>
                        </fieldset>
                        <p class="appearance-settings-note">Saved on this device. Default colors follow the Light/Dark theme.</p>
                        <div class="canvas-motion-settings">
                            <div class="appearance-subheader">Canvas motion labels</div>
                            <label class="ui-color-row" for="canvas-motion-normal-color"><span>Normal color</span><input type="color" id="canvas-motion-normal-color" value="#ffffff"></label>
                            <label class="ui-default-colors-row canvas-motion-gradient-toggle">
                                <span>Highlight speed</span>
                                <input type="checkbox" id="check-canvas-motion-speed-gradient" checked>
                            </label>
                            <fieldset id="canvas-motion-gradient-fields" class="canvas-motion-gradient-fields" disabled>
                                <label class="ui-color-row" for="canvas-motion-high-speed-color"><span>Warning color</span><input type="color" id="canvas-motion-high-speed-color" value="#ff3b30"></label>
                                <label class="ui-color-row" for="canvas-motion-normal-speed-max"><span>Color shift starts</span><span class="canvas-motion-number"><input type="number" id="canvas-motion-normal-speed-max" value="6" min="0" max="999" step="1"> cm/yr</span></label>
                                <label class="ui-color-row" for="canvas-motion-high-speed"><span>Full warning color</span><span class="canvas-motion-number"><input type="number" id="canvas-motion-high-speed" value="8" min="1" max="1000" step="1"> cm/yr</span></label>
                                <label class="ui-color-row" for="canvas-motion-outline-start-speed"><span>Outline starts</span><span class="canvas-motion-number"><input type="number" id="canvas-motion-outline-start-speed" value="15" min="1" max="1000" step="1"> cm/yr</span></label>
                                <label class="ui-color-row" for="canvas-motion-outline-full-speed"><span>Full outline</span><span class="canvas-motion-number"><input type="number" id="canvas-motion-outline-full-speed" value="20" min="2" max="1000" step="1"> cm/yr</span></label>
                            </fieldset>
                            <p class="appearance-settings-note canvas-motion-note">Color shifts from 6–8 cm/yr. Above 15 cm/yr, the warning-colored outer outline fades in until 20 cm/yr.</p>
                        </div>
                    </div>`;
}

/**
 * Generates the full application HTML template.
 */
export function getAppHTML(opts: AppTemplateOptions): string {
  const g = opts.globalOptions;
  return `
            <div class="app-container">
                <header class="app-header">
                    <h1 class="app-title">
                        <a href="https://github.com/Calor7/TectoLite" target="_blank" rel="noopener noreferrer" title="TectoLite by RefracturedGames" style="color: inherit; text-decoration: none;">
                            <span class="app-brand-mark" aria-hidden="true"></span><span>TectoLite</span>
                        </a>
                        <span class="app-subtitle">by <a href="https://www.refracturedgames.com" target="_blank" rel="noopener noreferrer">RefracturedGames</a> <span aria-hidden="true">·</span> <a href="https://ko-fi.com/refracturedgames" target="_blank" rel="noopener noreferrer" aria-label="Support TectoLite on Ko-fi">Ko-fi</a></span>
                    </h1>
                    <nav class="workspace-controls" aria-label="Workspace panels">
                        <button type="button" id="btn-toggle-explorer-dock" class="workspace-control-btn" aria-pressed="false" title="Show or hide Explorer">
                            ${uiIcon('map')}<span>Explorer</span>
                        </button>
                        <button type="button" id="btn-toggle-tool-options" class="workspace-control-btn" aria-pressed="false" title="Show or hide options for the selected tool">
                            ${uiIcon('settings')}<span>Tool Options</span>
                        </button>
                        <button type="button" id="btn-toggle-inspector-dock" class="workspace-control-btn" aria-pressed="false" title="Show or hide the selected object's Properties">
                            ${uiIcon('edit')}<span>Properties</span>
                        </button>
                    </nav>
                    <div class="header-actions">
            <!-- Projection Selector Moved to Sidebar -->

            <div class="view-dropdown-container">
                <button id="btn-file-menu" class="btn btn-secondary" title="Project file actions" aria-controls="file-dropdown-menu" aria-expanded="false" aria-haspopup="true">
                    <span class="icon">${uiIcon('file')}</span><span class="header-label">File</span>
                </button>
                <div id="file-dropdown-menu" class="view-dropdown-menu header-compact-menu">
                    <button id="btn-new-project" class="view-dropdown-item header-menu-action" title="Start a new project">
                        <span>${uiIcon('file-plus')} New project</span>
                    </button>
                    <button id="btn-export-json" class="view-dropdown-item header-menu-action" title="Save project (Ctrl+S)">
                        <span>${uiIcon('save')} Save project</span><kbd>Ctrl+S</kbd>
                    </button>
                    <button id="btn-import-json" class="view-dropdown-item header-menu-action" title="Load project (Ctrl+O)">
                        <span>${uiIcon('folder-open')} Load project</span><kbd>Ctrl+O</kbd>
                    </button>
                    <button id="btn-export" class="view-dropdown-item header-menu-action" title="Export PNG, Heightmap, or QGIS data">
                        <span>${uiIcon('upload')} Export map…</span>
                    </button>
                </div>
            </div>
            <span id="autosave-status" class="autosave-status" role="status" aria-live="polite">Recovery storage ready</span>
            
            <!-- Settings Dropdown (formerly Planet) -->
            <div class="view-dropdown-container">
                <button id="btn-planet" class="btn btn-secondary" title="Application behavior and defaults" aria-label="Application Settings" aria-controls="planet-dropdown-menu" aria-expanded="false" aria-haspopup="true">
                    <span class="icon">${uiIcon('settings')}</span><span class="header-label header-collapse-label">Settings</span>
                </button>
                <div id="planet-dropdown-menu" class="view-dropdown-menu" style="min-width: 240px; max-height: calc(100vh - 64px); overflow-y: auto;">
                    <div class="dropdown-section">
                        <div class="dropdown-header">Timeline &amp; simulation</div>
                        <div style="padding: 8px; display: flex; flex-direction: column; gap: 8px;">
                            <label style="display: flex; justify-content: space-between; align-items: center; font-size: 12px;">
                                <span>Max Duration (Ma)</span>
                                <input type="number" id="timeline-max-time" class="property-input" value="${g.timelineMaxTime || 500}" step="100" min="100" style="width: 70px; padding: 2px 4px;">
                            </label>
                        </div>
                    </div>
                    <div class="dropdown-section" style="border-top: 1px solid var(--border-default); margin-top: 4px; padding-top: 4px;">
                        <div class="dropdown-header">Planet model</div>
                        <label class="view-dropdown-item" style="display:flex; justify-content:space-between; align-items:center;">
                            <span>Custom Planet Radius</span>
                            <input type="checkbox" id="check-custom-radius">
                        </label>
                        <div style="padding: 2px 8px 4px 8px; display: flex; align-items: center; gap: 6px;">
                            <label style="font-size: 12px; color: var(--text-secondary); white-space: nowrap;">Radius (km)</label>
                            <input type="number" id="global-planet-radius" class="property-input" value="${g.customRadiusEnabled ? (g.customPlanetRadius || 6371) : 6371}" step="100" style="width: 90px;" disabled>
                        </div>
                    </div>
                    
                    <!-- Experimental features -->
                    <div class="dropdown-section experimental-section">
                        <div class="dropdown-header experimental-header">
                            <span>Experimental</span>
                            <span class="experimental-badge">May change</span>
                        </div>
                        <div class="experimental-notice" role="note">
                            These features can produce large or unexpected geometry. Save your project before enabling them.
                        </div>
                        <div class="experimental-feature-title">Oceanic Crust Generation <span class="info-icon" data-tooltip="Experimental generation options for rifts created by splitting plates">(i)</span></div>
                        
                        <div style="padding: 4px 8px;">
                            <label for="ocean-crust-strategy" style="display:block; font-size: 12px; color:var(--text-secondary); margin-bottom:3px;">Strategy</label>
                            <select id="ocean-crust-strategy" class="tool-select" style="width:100%; font-size: 12px;">
                                <option value="off" ${g.oceanCrustStrategy === 'off' || !g.oceanCrustStrategy ? 'selected' : ''}>Off</option>
                                <option value="continuous" ${g.oceanCrustStrategy === 'continuous' ? 'selected' : ''}>Continuous Split-Rift Fill</option>
                                <option value="banded" ${g.oceanCrustStrategy === 'banded' ? 'selected' : ''}>Time-Banded Rift Crust</option>
                            </select>
                            <div style="font-size: 12px; color:var(--text-secondary); margin-top:3px; line-height:1.3;">Continuous uses split-created rift axes. Banded supports sibling and older rift projects and may add many polygons.</div>
                        </div>
                        
                        <div style="padding: 2px 8px 4px 8px; display: flex; align-items: center; justify-content: space-between;">
                            <label style="font-size: 12px; color: var(--text-secondary);">Generation Interval (Ma)</label>
                            <input type="number" id="input-oceanic-interval" class="property-input" value="${g.oceanicGenerationInterval || 25}" step="1" min="1" style="width: 50px;">
                        </div>

                         <div style="padding: 2px 8px 4px 8px; display: flex; align-items: center; justify-content: space-between;">
                            <label style="font-size: 12px; color: var(--text-secondary);">Creation Color</label>
                            <input type="color" id="input-oceanic-color" value="${g.oceanicCrustColor || '#3b82f6'}" style="width: 24px; height: 16px; border: none; padding: 0; background: none; cursor: pointer;">
                        </div>

                         <div style="padding: 2px 8px 4px 8px;">
                             <div style="display: flex; justify-content: space-between; align-items: center;">
                                <label style="font-size: 12px; color: var(--text-secondary);">Opacity</label>
                                <span id="lbl-oceanic-opacity" style="font-size: 12px;">${Math.round((g.oceanicCrustOpacity ?? 0.5) * 100)}%</span>
                             </div>
                             <input type="range" id="input-oceanic-opacity" aria-label="Oceanic crust opacity" min="0" max="100" value="${Math.round((g.oceanicCrustOpacity ?? 0.5) * 100)}" style="width: 100%; height: 4px; display:block; margin-top:4px;">
                        </div>
                    </div>

                    <!-- Line Entity Defaults — per-type color + dash pattern -->
                    <div class="dropdown-section" style="border-top: 1px solid var(--border-default); margin-top: 4px; padding-top: 4px;">
                        <div class="dropdown-header">Drawing defaults</div>
                        ${(() => {
                          const defs = resolveLineTypeDefaults(g.lineTypeDefaults);
                          const types: LineType[] = ['divergent', 'convergent', 'transform', 'generic'];
                          return types.map(lt => {
                            const d = defs[lt];
                            const dashIdx = DASH_PRESETS.findIndex(p =>
                              p.dash.length === d.dash.length &&
                              p.dash.every((v, i) => v === d.dash[i])
                            );
                            const sel = dashIdx >= 0 ? dashIdx : 0;
                            return `
                              <div style="padding: 2px 8px 4px 8px; display: flex; align-items: center; justify-content: space-between; gap: 6px;">
                                <label style="font-size: 12px; color: var(--text-secondary); flex: 1;">${LINE_TYPE_LABELS[lt]}</label>
                                <input type="color" id="input-line-color-${lt}" value="${d.color}" style="width: 24px; height: 16px; border: none; padding: 0; background: none; cursor: pointer;">
                                <select id="select-line-dash-${lt}" aria-label="${LINE_TYPE_LABELS[lt]} line pattern" class="tool-select" style="width: 90px; font-size: 12px; padding: 1px;">
                                  ${DASH_PRESETS.map((p, i) => `<option value="${i}" ${i === sel ? 'selected' : ''}>${p.label}</option>`).join('')}
                                </select>
                              </div>
                            `;
                          }).join('');
                        })()}
                    </div>

                </div>
            </div>

            <!-- View Dropdown -->
            <div class="view-dropdown-container">

                <button id="btn-view-panels" class="btn btn-secondary" title="Display and workspace options" aria-label="View Options" aria-controls="view-dropdown-menu" aria-expanded="false" aria-haspopup="true">
                    <span class="icon">${uiIcon('eye')}</span><span class="header-label header-collapse-label">View</span>
                </button>
                <div id="view-dropdown-menu" class="view-dropdown-menu" style="min-width: 250px; max-height: calc(100vh - 64px); overflow-y: auto;">
                    <div class="dropdown-section narrow-header-menu-actions" aria-label="Window and appearance actions">
                        <div class="dropdown-header">Window &amp; appearance</div>
                        <button id="btn-reset-camera-menu" class="view-dropdown-item header-menu-action" type="button">
                            <span>${uiIcon('rotate-ccw')} Reset view</span>
                        </button>
                        <button id="btn-fullscreen-menu" class="view-dropdown-item header-menu-action" type="button">
                            <span>${uiIcon('maximize')} Fullscreen</span>
                        </button>
                        <button id="btn-theme-toggle-menu" class="view-dropdown-item header-menu-action" type="button">
                            <span>${uiIcon('moon')} Toggle theme</span>
                        </button>
                    </div>
                    ${renderAppearanceSettings()}
                    <!-- 1. WORKSPACE PANELS -->
                    <div class="dropdown-section">
                        <div class="dropdown-header">Workspace panels</div>
                        <label class="view-dropdown-item">
                            <input type="checkbox" id="check-view-tools" checked> Tools
                        </label>
                        <label class="view-dropdown-item">
                            <input type="checkbox" id="check-view-plates"> Explorer
                        </label>
                        <label class="view-dropdown-item">
                            <input type="checkbox" id="check-view-props"> Inspector
                        </label>
                        <label class="view-dropdown-item">
                            <input type="checkbox" id="check-view-history"> Plate History
                        </label>
                        <label class="view-dropdown-item">
                            <input type="checkbox" id="check-view-timeline" checked> Timeline
                        </label>
                    </div>

                    <!-- 2. PROJECTION SETTING -->
                    <div class="dropdown-section" style="border-top: 1px solid var(--border-default); margin-top: 4px; padding-top: 4px;">
                        <div class="dropdown-header">Projection <span class="info-icon" data-tooltip="Choose map projection">(i)</span></div>
                        <div style="padding: 4px 8px;">
                            <select id="projection-select" aria-label="Projection" class="tool-select" style="width:100%;">
                                <option value="orthographic">Globe (Orthographic)</option>
                                <option value="equirectangular">Equirectangular</option>
                                <option value="mercator">Mercator</option>
                                <option value="mollweide">Mollweide</option>
                                <option value="robinson">Robinson</option>
                            </select>
                        </div>
                    </div>

                    <!-- 3. IMAGE OVERLAY -->
                    <div class="dropdown-section" style="border-top: 1px solid var(--border-default); margin-top: 4px; padding-top: 4px;">
                        <div class="dropdown-header">Reference images <span id="overlay-count" style="font-weight: normal; opacity: .7;">(0)</span></div>
                        <label class="view-dropdown-item">
                            <input type="checkbox" id="check-show-overlay"> Show selected <span class="info-icon" data-tooltip="Show or hide the selected reference image">(i)</span>
                        </label>
                        <div style="padding: 2px 8px 4px 28px; display: flex; flex-direction: column; gap: 4px;">
                            <select id="overlay-select" class="tool-select" aria-label="Selected reference image" style="width: 100%; font-size: 12px;">
                                <option value="">No reference images</option>
                            </select>
                            <button id="btn-upload-overlay" class="btn btn-secondary" title="Large images are resized and compressed automatically" style="font-size: 12px; padding: 4px 8px;">
                                + Add Image
                            </button>
                            <label style="font-size: 12px; display: flex; align-items: center; gap: 5px; cursor: pointer;">
                                <input type="checkbox" id="check-edit-overlay"> Move / resize on canvas
                            </label>
                            <div style="display: flex; align-items: center; gap: 4px;">
                                <label style="font-size: 12px; color: var(--text-secondary); white-space: nowrap;">Opacity:</label>
                                <input type="range" id="overlay-opacity-slider" min="0" max="100" value="50" style="flex: 1; height: 4px;">
                                <span id="overlay-opacity-value" style="font-size: 12px; color: var(--text-secondary); min-width: 30px;">50%</span>
                            </div>
                            <div style="display: flex; align-items: center; gap: 4px;">
                                <label style="font-size: 12px; color: var(--text-secondary); white-space: nowrap;">Size:</label>
                                <input type="range" id="overlay-size-slider" min="5" max="1000" value="100" style="flex: 1; height: 4px;">
                                <span id="overlay-size-value" style="font-size: 12px; color: var(--text-secondary); min-width: 34px;">100%</span>
                            </div>
                            <div style="display: grid; grid-template-columns: auto 1fr auto 1fr; align-items: center; gap: 3px;">
                                <label for="overlay-x-input" style="font-size: 12px; color: var(--text-secondary);">X</label>
                                <input id="overlay-x-input" type="number" value="0" step="1" class="tool-input" style="width: 54px; font-size: 12px;">
                                <label for="overlay-y-input" style="font-size: 12px; color: var(--text-secondary);">Y</label>
                                <input id="overlay-y-input" type="number" value="0" step="1" class="tool-input" style="width: 54px; font-size: 12px;">
                            </div>
                            <div style="display: flex; align-items: center; gap: 4px;">
                                <label for="overlay-rotation-input" style="font-size: 12px; color: var(--text-secondary);">Rotation</label>
                                <input id="overlay-rotation-input" type="number" value="0" step="1" class="tool-input" style="width: 58px; font-size: 12px;">
                                <span style="font-size: 12px; color: var(--text-secondary);">°</span>
                            </div>
                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px;">
                                <button id="btn-overlay-back" class="btn btn-secondary" style="font-size: 12px; padding: 3px;">Send Back</button>
                                <button id="btn-overlay-front" class="btn btn-secondary" style="font-size: 12px; padding: 3px;">Bring Front</button>
                                <button id="btn-reset-overlay" class="btn btn-secondary" style="font-size: 12px; padding: 3px;">Reset</button>
                                <button id="btn-clear-overlay" class="btn btn-secondary" style="font-size: 12px; padding: 3px;">Remove</button>
                            </div>
                        </div>
                    </div>

                    <!-- 3b. CAMERA VIEWS -->
                    <div class="dropdown-section" style="border-top: 1px solid var(--border-default); margin-top: 4px; padding-top: 4px;">
                        <div class="dropdown-header">Camera Views <span class="info-icon" data-tooltip="Store and recall camera positions (hotkeys: Shift+1..9 to save, 1..9 to recall)">(i)</span></div>
                        <div id="camera-views-list" style="max-height: 160px; overflow-y: auto;"></div>
                        <div style="padding: 2px 8px 4px 8px;">
                            <button id="btn-view-save-new" class="btn btn-secondary" style="width: 100%; font-size: 12px; padding: 3px 8px;">+ Save Current View</button>
                        </div>
                    </div>

                    <!-- 4. EFFECTS SETTING -->
                    <div class="dropdown-section" style="border-top: 1px solid var(--border-default); margin-top: 4px; padding-top: 4px;">
                        <div class="dropdown-header">Map display</div>
                        <label class="view-dropdown-item">
                            <input type="checkbox" id="check-grid" checked> Show Grid <span class="info-icon" data-tooltip="Toggle the latitude/longitude grid">(i)</span>
                        </label>
                         <div style="padding: 2px 8px 4px 28px;">
                             <select id="grid-thickness-select" class="tool-select" style="width: 100%; font-size: 12px; padding: 2px;">
                                <option value="0.5">Thin (0.5px)</option>
                                <option value="1.0" selected>Medium (1.0px)</option>
                                <option value="2.0">Thick (2.0px)</option>
                            </select>
                        </div>

                        <label class="view-dropdown-item">
                            <input type="checkbox" id="check-features" checked> Show Features <span class="info-icon" data-tooltip="Show mountains, volcanoes, etc.">(i)</span>
                        </label>
                        <label class="view-dropdown-item">
                            <input type="checkbox" id="check-boundary-viz" ${g.enableBoundaryVisualization === true ? 'checked' : ''}> Derived Boundaries <span class="info-icon" data-tooltip="Detect and highlight convergent, divergent, and transform boundaries at the current time">(i)</span>
                        </label>
                        <label class="view-dropdown-item">
                            <input type="checkbox" id="check-euler-poles"> Show Euler Poles <span class="info-icon" data-tooltip="Show all rotation axes (Euler poles)">(i)</span>
                        </label>
                        <label class="view-dropdown-item">
                             <input type="checkbox" id="check-future-features"> Show Future/Past <span class="info-icon" data-tooltip="Show features outside their active lifetime as faint previews">(i)</span>
                        </label>


                        <label class="view-dropdown-item">
                            <input type="checkbox" id="check-show-links" ${g.showLinks !== false ? 'checked' : ''}> Show Links <span class="info-icon" data-tooltip="Show plate-to-plate and landmass-to-plate links">(i)</span>
                        </label>
                        <label class="view-dropdown-item">
                            <input type="checkbox" id="check-prediction-flowlines" ${g.showPredictionFlowlines === true ? 'checked' : ''}> Drag Prediction Overlay <span class="info-icon" data-tooltip="While dragging a plate: movement arcs, rotation readout, and original-position outline">(i)</span>
                        </label>
                        <label class="view-dropdown-item">
                            <input type="checkbox" id="check-velocity-arrows" ${g.showVelocityArrows === true ? 'checked' : ''}> Velocity Arrows <span class="info-icon" data-tooltip="Draw each plate's current motion arc at its center">(i)</span>
                        </label>
                        <label class="view-dropdown-item">
                            <input type="checkbox" id="check-hover-tooltips" ${g.showHoverTooltips === true ? 'checked' : ''}> Hover Tooltips <span class="info-icon" data-tooltip="Show plate name, age and speed when hovering">(i)</span>
                        </label>
                        <label class="view-dropdown-item">
                            <input type="checkbox" id="check-label-hover" ${g.expandLabelsOnHover !== false ? 'checked' : ''}> Expand Labels on Hover <span class="info-icon" data-tooltip="Temporarily show label content while hovering its title">(i)</span>
                        </label>
                        <label class="view-dropdown-item">
                            <input type="checkbox" id="check-show-hidden-plates" ${g.showHiddenPlates ? 'checked' : ''}> Show Hidden Plates <span class="info-icon" data-tooltip="Reveal plates even if their visibility is toggled off">(i)</span>
                        </label>
                        <label class="view-dropdown-item">
                            <input type="checkbox" id="check-grid-on-top" ${g.gridOnTop ? 'checked' : ''}> Grid on Top <span class="info-icon" data-tooltip="Render grid above plates instead of below">(i)</span>
                        </label>
                        
                        <div style="padding: 4px 8px; border-top: 1px dotted var(--border-default); margin-top: 4px;">
                             <label style="font-size: 12px; white-space: nowrap; font-weight: 600;">Plate Opacity <span class="info-icon" data-tooltip="Adjust transparency of tectonic plates">(i)</span></label>
                             <div style="display: flex; align-items: center; gap: 4px;">
                                 <input type="range" id="plate-opacity-slider" min="0" max="100" value="${(g.plateOpacity ?? 1.0) * 100}" style="flex: 1; height: 4px;">
                                 <span id="plate-opacity-value" style="font-size: 12px; color: var(--text-secondary); min-width: 35px;">${Math.round((g.plateOpacity ?? 1.0) * 100)}%</span>
                             </div>
                        </div>

                    </div>
                </div>
            </div>



            <button id="btn-reset-camera" class="btn btn-secondary" title="Reset View (position, rotation, and zoom)">
                <span class="icon">${uiIcon('rotate-ccw')}</span><span class="header-label header-collapse-label">Reset</span>
            </button>

            <button id="btn-fullscreen" class="btn btn-secondary" title="Toggle Fullscreen">
               <span class="icon">${uiIcon('maximize')}</span><span class="header-label header-collapse-label">Fullscreen</span>
            </button>

            <button id="btn-theme-toggle" class="btn btn-secondary" title="Toggle Theme">
              <span class="icon" data-theme-icon>${uiIcon('moon')}</span><span class="header-label header-collapse-label">Theme</span>
            </button>
            <button id="btn-undo" class="btn btn-secondary" title="Undo (Ctrl+Z)">
              <span class="icon">${uiIcon('undo')}</span><span class="header-label header-collapse-label">Undo</span>
            </button>
            <button id="btn-redo" class="btn btn-secondary" title="Redo (Ctrl+Y)">
              <span class="icon">${uiIcon('redo')}</span><span class="header-label header-collapse-label">Redo</span>
            </button>

            <div class="view-dropdown-container">
                <button id="btn-help-menu" class="btn btn-secondary" title="Help and information" aria-controls="help-dropdown-menu" aria-expanded="false" aria-haspopup="true">
                    <span class="icon">${uiIcon('help-circle')}</span><span class="header-label">Help</span>
                </button>
                <div id="help-dropdown-menu" class="view-dropdown-menu header-compact-menu">
                    <button id="btn-tutorial-help" class="view-dropdown-item header-menu-action" title="Show Tutorial"><span>${uiIcon('book-open')} Tutorial and manual</span></button>
                    <button id="btn-hotkey-help" class="view-dropdown-item header-menu-action" title="Show keyboard shortcuts"><span>${uiIcon('keyboard')} Keyboard shortcuts</span><kbd>?</kbd></button>
                    <button id="btn-report-bug" class="view-dropdown-item header-menu-action" title="Report a Bug"><span>${uiIcon('flag')} Report a bug</span></button>
                    <a class="view-dropdown-item header-menu-action" href="https://github.com/Calor7/TectoLite" target="_blank" rel="noopener noreferrer"><span>${uiIcon('external-link')} Source and issues</span></a>
                    <a class="view-dropdown-item header-menu-action" href="https://www.refracturedgames.com" target="_blank" rel="noopener noreferrer"><span><span class="app-brand-mark publisher-brand-mark" aria-hidden="true"></span> Refractured Games</span></a>
                    <a class="view-dropdown-item header-menu-action" href="https://refracturedgames.eo.page/zcyvj" target="_blank" rel="noopener noreferrer" id="link-subscribe"><span>${uiIcon('mail')} Subscribe to updates</span></a>


            <a id="link-kofi-header" class="view-dropdown-item header-menu-action" href="https://ko-fi.com/refracturedgames" target="_blank" rel="noopener noreferrer" aria-label="Support TectoLite on Ko-fi" title="Support TectoLite on Ko-fi">
                <span class="kofi-icon-slot" aria-hidden="true">
                    ${uiIcon('coffee', 'ui-icon kofi-static-icon')}
                    <img class="kofi-animated-icon" data-kofi-animated-icon data-animated-src="./coffee-mug-flaticon.gif" alt="">
                </span>
                <span class="header-label">Support TectoLite</span>
            </a>

            <a id="link-download-windows" class="view-dropdown-item header-menu-action" href="${WINDOWS_PORTABLE_DOWNLOAD_URL}" target="_blank" rel="noopener noreferrer" aria-label="Download the portable Windows app" title="Download the portable Windows app">
                ${uiIcon('download')}
                <span class="header-label">Download app</span>
            </a>
<div class="app-version">TectoLite v${APP_VERSION}</div>
                </div>
            </div>

            <input type="file" id="file-import" accept=".json" style="display: none;">
            <input type="file" id="file-overlay-upload" accept="image/*" multiple style="display: none;">
          </div>
        </header>
        
        <div class="main-content">
          <aside class="toolbar" id="toolbar" aria-label="Map tools">
            <label class="tool-names-toggle" title="Show or hide the names beneath tool icons">
                <input type="checkbox" id="check-show-tool-names" checked>
                <span>Show tool names</span>
            </label>
            <!-- 1. TOOLS GROUP -->
            <div class="tool-group">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                <h3 id="title-interaction" class="tool-group-title" style="margin: 0;">Interaction</h3>
                <label style="font-size: 12px; display: flex; align-items: center; gap: 4px; cursor: pointer; color: var(--text-secondary);" title="Toggle on-canvas tooltips">
                  <input type="checkbox" id="check-show-hints" ${g.showHints !== false ? 'checked' : ''}> Hints
                </label>
              </div>
              
              <!-- Layer Mode Removed -->
              
              <div style="display: flex; gap: 4px; flex-wrap: wrap;">
                  <button class="tool-btn active" data-tool="select" aria-label="Select" style="flex:1;">
                    <span class="tool-icon">${uiIcon('mouse-pointer')}</span>
                    <span class="tool-label">Select</span>
                    <span class="info-icon" data-tooltip="Select plates/features to edit (Hotkey: V)">(i)</span>
                  </button>
                  <button class="tool-btn" data-tool="pan" aria-label="Rotate globe" style="flex:1;">
                    <span class="tool-icon">${uiIcon('orbit')}</span>
                    <span class="tool-label">Rotate</span>
                    <span class="info-icon" data-tooltip="Rotate the globe or projection without changing map geometry (Hotkey: H)">(i)</span>
                  </button>
                  <button class="tool-btn" data-tool="view_pan" aria-label="Move view" style="flex:1;">
                    <span class="tool-icon">${uiIcon('move')}</span>
                    <span class="tool-label">Move View</span>
                    <span class="info-icon" data-tooltip="Move the rendered view on screen without rotating the globe or changing geometry (Hotkey: P)">(i)</span>
                  </button>
              </div>
              <div style="display: flex; gap: 4px; flex-wrap: wrap;">
                  <button class="tool-btn" data-tool="draw" aria-label="Draw" style="flex:1;">
                    <span class="tool-icon">${uiIcon('pencil')}</span>
                    <span class="tool-label">Draw</span>
                    <span class="info-icon" data-tooltip="Draw new plate boundaries (Hotkey: D)">(i)</span>
                  </button>
                  <button class="tool-btn" data-tool="edit" aria-label="Edit geometry" style="flex:1;">
                    <span class="tool-icon">${uiIcon('edit')}</span>
                    <span class="tool-label">Edit</span>
                    <span class="info-icon" data-tooltip="Modify plate geometry; Ctrl+drag moves the whole shape (Hotkey: E)">(i)</span>
                  </button>
                  <button class="tool-btn" data-tool="feature" aria-label="Place feature" style="flex:1;">
                    <span class="tool-icon">${uiIcon('mountain')}</span>
                    <span class="tool-label">Feature</span>
                    <span class="info-icon" data-tooltip="${FEATURE_TOOL_HELP}">(i)</span>
                  </button>
                  <button class="tool-btn" data-tool="label" aria-label="Place label" style="flex:1;">
                    <span class="tool-icon">${uiIcon('flag')}</span>
                    <span class="tool-label">Label</span>
                    <span class="info-icon" data-tooltip="Place a flag-style title and detail annotation (Hotkey: A)">(i)</span>
                  </button>

              </div>
              <div style="display: flex; gap: 4px; flex-wrap: wrap;">
                  <button class="tool-btn" data-tool="split" aria-label="Split plate" style="flex:1;">
                    <span class="tool-icon">${uiIcon('scissors')}</span>
                    <span class="tool-label">Split</span>
                    <span class="info-icon" data-tooltip="Divide a plate in two (Hotkey: S)">(i)</span>
                  </button>
                  <button class="tool-btn" data-tool="link" aria-label="Link motion" style="flex:1;">
                    <span class="tool-icon">${uiIcon('link')}</span>
                    <span class="tool-label">Link</span>
                    <span class="info-icon" data-tooltip="${LINK_TOOL_HELP}">(i)</span>
                  </button>
                  <button class="tool-btn" data-tool="fuse" aria-label="Fuse plates" style="flex:1;">
                    <span class="tool-icon">${uiIcon('merge')}</span>
                    <span class="tool-label">Fuse</span>
                    <span class="info-icon" data-tooltip="${FUSE_TOOL_HELP}">(i)</span>
                  </button>



              </div>
            </div>

          </aside>

          <div class="resizer-x" id="resizer-left" style="position: relative; width: 4px; cursor: col-resize; background-color: var(--bg-tertiary); z-index: 10;"></div>

            <!-- 2. CONTEXT / OPTIONS GROUP -->
            <aside class="tool-options-sidebar collapsed" id="tool-options-sidebar" aria-label="Tool options" aria-hidden="true">
                 <h3 id="title-tool-options" class="tool-group-title">Tool Options</h3>
                 <p id="tool-options-empty" class="tool-options-empty" hidden>This tool has no additional options.</p>
                 
                 <!-- Dynamic Controls Stack -->

                 <div id="navigation-controls" class="tool-option-card" style="display:none; flex-direction:column; gap:8px;">
                     <div class="tool-option-card-title">Navigation</div>
                     <label class="tool-option-field">
                         <span>Drag sensitivity</span>
                         <select id="navigation-sensitivity" class="tool-select">
                             <option value="0.6">Low</option>
                             <option value="1">Normal</option>
                             <option value="1.5">High</option>
                         </select>
                     </label>
                     <label class="tool-option-check"><input type="checkbox" id="check-navigation-reverse"> Reverse drag direction</label>
                     <label class="tool-option-check"><input type="checkbox" id="check-navigation-reachable"> Keep map reachable</label>
                     <div id="rotate-navigation-actions" style="display:none; flex-direction:column; gap:4px;">
                         <button id="btn-reset-orientation" class="btn btn-secondary">${uiIcon('rotate-ccw')} Reset orientation</button>
                         <button id="btn-north-up" class="btn btn-secondary">${uiIcon('orbit')} North up</button>
                     </div>
                     <div id="move-view-navigation-actions" style="display:none; flex-direction:column; gap:4px;">
                         <button id="btn-center-view" class="btn btn-secondary">${uiIcon('maximize')} Centre view</button>
                         <button id="btn-center-selection" class="btn btn-secondary">${uiIcon('map')} Centre on selection</button>
                     </div>
                 </div>

                 <div id="label-tool-controls" class="tool-option-card" style="display:none; flex-direction:column; gap:8px;">
                     <div class="tool-option-card-title">Label defaults</div>
                     <label class="tool-option-field">
                         <span>Moves with</span>
                         <select id="label-default-attachment" class="tool-select">
                             <option value="auto">Automatic (clicked plate)</option>
                             <option value="fixed">Nothing (fixed point)</option>
                             <option value="selected">Selected plate</option>
                         </select>
                     </label>
                     <label class="tool-option-field">
                         <span>Default colour</span>
                         <input id="label-default-color" type="color" value="#fbbf24">
                     </label>
                     <label class="tool-option-check"><input type="checkbox" id="check-label-default-expanded"> Start expanded</label>
                     <div class="tool-option-note">Each label can still override these values before creation or in Properties.</div>
                 </div>

                 <div id="feature-selector" style="display: none; margin-bottom: 8px; padding: 6px; border: 1px solid var(--border-default); border-radius: 4px;">
                     <div style="font-size: 12px; font-weight: 600; color: var(--text-secondary); margin-bottom: 5px;">Feature Type</div>
                     <div class="feature-grid">
                         ${FEATURE_TOOL_TYPES.map(type => {
                           const feature = FEATURE_ICON_CATALOG[type];
                           return `<button class="feature-btn${type === 'mountain' ? ' active' : ''}" data-feature="${type}" title="${feature.description}">${featureToolIcon(type)}<span>${feature.label}</span></button>`;
                         }).join('')}
                     </div>
                     <div style="font-size: 12px; line-height: 1.35; color: var(--text-secondary); margin-top: 6px;">Select a plate before placing plate-bound features. Hotspots are manually placed fixed markers.</div>
                 </div>

                 <!-- Draw Mode Controls (visible when Draw tool is active) -->
                 <div id="draw-mode-controls" style="display: none; flex-direction: column; gap: 6px; margin-bottom: 8px; padding: 6px; border: 1px solid var(--border-default); border-radius: 4px;">
                     <div style="font-size: 12px; font-weight: 600; color: var(--text-secondary);">Draw Mode</div>
                     <div style="display: flex; gap: 8px; align-items: center;">
                         <label style="font-size: 12px; display: flex; align-items: center; gap: 3px; cursor: pointer;">
                             <input type="radio" name="draw-mode" id="draw-mode-polygon" value="polygon" checked> Polygon
                         </label>
                         <label style="font-size: 12px; display: flex; align-items: center; gap: 3px; cursor: pointer;">
                             <input type="radio" name="draw-mode" id="draw-mode-line" value="line"> Line
                         </label>
                     </div>
                     <div id="line-type-group" style="display: none;">
                         <label style="font-size: 12px; color: var(--text-secondary);">Line Type</label>
                         <select id="draw-line-type" class="tool-select" style="width: 100%; font-size: 12px; padding: 2px;">
                             <option value="divergent">Divergent</option>
                             <option value="convergent">Convergent</option>
                             <option value="transform">Transform</option>
                             <option value="generic">Generic</option>
                         </select>
                         <div style="font-size: 12px; line-height: 1.3; color: var(--text-secondary); margin-top: 3px;">Lines render above landmasses by default. Their individual color can be overridden after creation.</div>
                     </div>
                     <div id="polygon-type-group" style="display: block;">
                         <label style="font-size: 12px; color: var(--text-secondary);">Polygon Type</label>
                         <select id="draw-polygon-type" class="tool-select" style="width: 100%; font-size: 12px; padding: 2px;">
                             <option value="generic">Generic</option>
                             <option value="continental_crust">Continental Crust</option>
                             <option value="island">Island</option>
                             <option value="continental_plate">Continental Plate</option>
                             <option value="oceanic_plate">Oceanic Plate</option>
                             <option value="craton">Craton</option>
                         </select>
                     </div>
                     <label style="font-size: 12px; display: flex; align-items: center; gap: 4px; cursor: pointer; margin-top: 2px;">
                         <input type="checkbox" id="check-vertex-snap"> Vertex Snap
                         <span class="info-icon" data-tooltip="Snap to existing plate vertices while drawing">(i)</span>
                     </label>
                 </div>

                 <div id="split-controls" class="tool-option-card" style="display:none; flex-direction:column; gap:8px;">
                     <div class="tool-option-card-title">Split configuration</div>
                     <div id="split-workflow-status" class="tool-workflow-status">Select a plate, then draw the split boundary.</div>
                     <fieldset class="tool-option-fieldset">
                         <legend>New plate motion</legend>
                         <label class="tool-option-check"><input type="radio" name="split-momentum" id="split-inherit-momentum" value="inherit"> Inherit parent motion</label>
                         <label class="tool-option-check"><input type="radio" name="split-momentum" id="split-reset-momentum" value="reset"> Start stationary</label>
                     </fieldset>
                     <label class="tool-option-check"><input type="checkbox" id="check-split-selected-only"> Split selected landmass only</label>
                     <label class="tool-option-field"><span>First result name</span><input id="split-name-a" class="property-input" maxlength="120" placeholder="Automatic (A)"></label>
                     <label class="tool-option-field"><span>Second result name</span><input id="split-name-b" class="property-input" maxlength="120" placeholder="Automatic (B)"></label>
                     <button class="btn btn-success" id="btn-split-apply" disabled>${uiIcon('check')} Apply split</button>
                     <button class="btn btn-secondary" id="btn-split-cancel">${uiIcon('x')} Cancel boundary</button>
                 </div>

                 <div id="link-controls" class="tool-option-card" style="display:none; flex-direction:column; gap:8px;">
                     <div class="tool-option-card-title">Link workflow</div>
                     <div class="tool-workflow-row"><span>Starts at</span><strong id="link-workflow-time">0 Ma</strong></div>
                     <div class="tool-workflow-slot"><span>Leader</span><strong id="link-workflow-source">Choose on map</strong></div>
                     <div class="tool-workflow-slot"><span>Follower</span><strong id="link-workflow-target">Waiting for leader</strong></div>
                     <div id="link-workflow-result" class="tool-option-note">The follower follows the leader exactly from the current timeline time.</div>
                     <button id="btn-clear-link-workflow" class="btn btn-secondary">${uiIcon('x')} Clear selection</button>
                 </div>

                 <div id="fuse-controls" class="tool-option-card" style="display:none; flex-direction:column; gap:8px;">
                     <div class="tool-option-card-title">Fuse workflow</div>
                     <div class="tool-workflow-row"><span>Fusion time</span><strong id="fuse-workflow-time">0 Ma</strong></div>
                     <div class="tool-workflow-slot"><span>Motion source</span><strong id="fuse-workflow-source">Choose on map</strong></div>
                     <div class="tool-workflow-slot"><span>Other plate</span><strong id="fuse-workflow-target">Waiting for source</strong></div>
                     <label class="tool-option-field"><span>Result name</span><input id="fuse-result-name" class="property-input" maxlength="120" placeholder="Automatic fused name"></label>
                     <div class="tool-option-note">Geometry, features, and links are combined. The first plate supplies initial motion.</div>
                     <button id="btn-clear-fuse-workflow" class="btn btn-secondary">${uiIcon('x')} Clear selection</button>
                 </div>



                 <div id="motion-controls" style="display: none; flex-direction:column; gap:4px;">
                      <div style="font-size: 12px; color: var(--text-secondary);">Apply this motion?</div>
                      <button class="btn btn-success" id="btn-motion-apply">${uiIcon('check')} Apply</button>
                      <button class="btn btn-secondary" id="btn-motion-cancel">${uiIcon('x')} Cancel</button>
                 </div>

                 <div id="edit-controls" style="display: none; flex-direction:column; gap:4px; margin-top: 8px; border-top: 1px solid var(--border-default); padding-top: 8px;">
                     <div style="align-self: center; font-size: 12px; color: var(--text-secondary); font-weight: bold;">Apply Changes?</div>
                     <div style="display:flex; gap: 4px;">
                         <button class="btn btn-success" id="btn-edit-apply" style="flex:1;">${uiIcon('check')} Apply</button>
                         <button class="btn btn-secondary" id="btn-edit-cancel" style="flex:1;">${uiIcon('x')} Cancel</button>
                     </div>
                 </div>



                 <!-- Select Mode Controls (visible when Select tool is active) -->
                 <div id="select-mode-controls" style="display: flex; flex-direction: column; gap: 6px; margin-bottom: 8px; padding: 6px; border: 1px solid var(--border-default); border-radius: 4px; flex: 1; min-height: 0;">
                     
                     <div>
                        <label class="property-label" style="font-size: 12px;">Interaction Mode <span class="info-icon" data-tooltip="Classic (Pole) vs Dragging">(i)</span></label>
                        <select id="motion-mode-select" class="tool-select" style="width:100%;">
                            <option value="classic">Classic (Fixed Pole)</option>
                            <option value="dynamic_pole">Dynamic Direction</option>
                            <option value="drag_target">Drag Landmass</option>
                        </select>
                     </div>

                     <hr class="property-divider" style="margin: 4px 0;">

                     <div style="margin-bottom:6px;">
                        <div style="font-size: 12px; font-weight:600; color:var(--text-secondary); margin-bottom:4px;">Simulation Speed</div>
                        <div style="display:flex; flex-direction:column; gap:6px;">
                            <div style="display:flex; align-items:center; gap:6px;">
                                <input type="number" id="speed-input-cm" aria-label="Plate speed in centimeters per year" class="property-input" step="0.05" style="width:70px;" disabled>
                                <span class="motion-unit">cm/yr</span>
                            </div>
                            <div style="display:flex; align-items:center; gap:6px;">
                                <input type="number" id="speed-input-deg" aria-label="Plate speed in degrees per million years" class="property-input" step="0.05" style="width:70px;" disabled>
                                <span class="motion-unit">deg/Ma</span>
                            </div>
                        </div>
                        <div style="margin-top: 6px; display: flex; flex-direction: column; gap: 4px;">
                            <button id="btn-reposition-pole-north" class="btn btn-secondary" style="width:100%; font-size: 12px;">Reposition Pole to North</button>
                            <button id="btn-reposition-pole-south" class="btn btn-secondary" style="width:100%; font-size: 12px;">Reposition Pole to South</button>
                        </div>
                    </div>
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                      <div style="font-size: 12px; font-weight:600; color:var(--text-secondary);">
                        Speed Presets
                      </div>
                      <label style="display:flex; align-items:center; gap:4px; font-size: 12px; cursor:pointer;" title="Switch between real-world examples and custom preset values">
                          <input type="checkbox" id="check-use-custom-presets"> Custom 
                      </label>
                    </div>
                    
                    <!-- Real World List -->
                    <div id="preset-container-realworld" style="display:flex; flex-direction:column; gap:6px; flex: 1; overflow-y:auto; padding-right:4px;">
                        ${opts.realWorldPresetListHtml}
                    </div>

                    <!-- Custom List -->
                    <div id="preset-container-custom" style="display:none; flex-direction:column; gap:6px; flex: 1; overflow-y:auto; padding-right:4px;">
                        ${opts.customPresetListHtml}
                    </div>
                 </div>
            </aside>

            <!-- 3. VIEW GROUP -->

            <!-- 5. PLATES LIST -->

          <div class="resizer-x" id="resizer-tool-options" style="position: relative; width: 4px; cursor: col-resize; background-color: var(--bg-tertiary); z-index: 10;"></div>
          
          <aside class="plate-sidebar collapsed" id="plate-sidebar">
             <h3 class="tool-group-title" style="padding: 16px 16px 0 16px;">Explorer</h3>
             <div id="plate-list" class="plate-list" style="padding: 0 16px 16px 16px; overflow-y: auto; flex:1;"></div>
          </aside>
          
          <div class="resizer-x" id="resizer-left-inner" style="position: relative; width: 4px; cursor: col-resize; background-color: var(--bg-tertiary); z-index: 10;"></div>

          <main class="canvas-container" style="flex:1; display:flex; position: relative;">
            <canvas id="main-canvas" style="flex:1;"></canvas>
            <div class="canvas-hint" id="canvas-hint"></div>
            <div id="cursor-coords" style="position: absolute; bottom: 6px; right: 10px; font-variant-numeric: tabular-nums; font-size: 12px; color: var(--text-secondary); background: rgba(0,0,0,0.35); padding: 2px 6px; border-radius: 3px; pointer-events: none;"></div>
          </main>
          
          <div class="resizer-x" id="resizer-right" style="position: relative; width: 4px; cursor: col-resize; background-color: var(--bg-tertiary); z-index: 10;"></div>

          <div class="right-sidebar collapsed" id="right-sidebar">
            <aside class="properties-panel" id="properties-panel">
                <h3 class="panel-title" id="properties-panel-title">Plate Properties</h3>
                <div id="properties-content">
                  <p class="empty-message">Select a plate to edit properties</p>
                </div>
            </aside>
            <aside class="properties-panel" id="edge-properties-panel" style="display: none; border-top: 1px solid var(--border-default); margin-top: 8px; padding-top: 8px;">
                <h3 class="panel-title">Edge Details</h3>
                <div id="edge-properties-content">
                  <!-- JS Populated -->
                </div>
            </aside>
            <div id="timeline-panel" class="timeline-panel history-collapsed">
                <div class="timeline-title">Plate History</div>
                <!-- Timeline items injected here -->
            </div>
          </div>
        </div>
        
        <div class="resizer-y" id="resizer-bottom" style="position: relative; height: 4px; cursor: row-resize; background-color: var(--bg-tertiary); z-index: 10;"></div>

        <footer class="timeline-bar" id="timeline-bar">
          <div class="time-controls">
            <button id="btn-play" class="btn btn-icon" title="Play/Pause (Space)" aria-label="Play timeline">${uiIcon('play')}</button>
            <select id="speed-select" class="speed-select" title="Playback speed">
              <option value="0.5">0.5 Ma/s</option>
              <option value="1" selected>1 Ma/s</option>
              <option value="2">2 Ma/s</option>
              <option value="5">5 Ma/s</option>
              <option value="10">10 Ma/s</option>
              <option value="20">20 Ma/s</option>
              <option value="50">50 Ma/s</option>
            </select>
          </div>
          <div class="timeline">
            <input type="range" id="time-slider" class="time-slider" min="0" max="500" value="0" title="Scrub time (←/→ keys step ±1 Ma, Shift = ±10 Ma)">
            <div class="time-display">
              <div class="time-controls-row">
                <button type="button" id="current-time" class="current-time-display" aria-label="Set current time" title="Set current time">0</button>
                <abbr id="time-mode-label" title="Million years ago; 0 Ma is the present">Ma</abbr>

              </div>
            </div>
          </div>
          <button id="btn-toggle-history-dock" class="btn btn-icon timeline-history-toggle" type="button" title="Show or hide plate history" aria-label="Toggle plate history" aria-pressed="false">${uiIcon('history')}</button>
          <button id="btn-reset-time" class="btn btn-secondary" title="Jump back to 0 Ma">Reset</button>
        </footer>
        <div id="global-tooltip"></div>
        <!-- Time Input Modal -->
        <div id="time-input-modal" class="modal" role="dialog" aria-modal="true" aria-labelledby="time-input-title" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.6); z-index: 10000; justify-content: center; align-items: center;">
          <div class="modal-content" style="background: var(--bg-secondary); border: 2px solid var(--border-default); border-radius: 4px; padding: 16px; min-width: 300px; box-shadow: 0 4px 12px rgba(0,0,0,0.4);">
            <h3 id="time-input-title" style="margin-top: 0; color: var(--text-primary);">Set current time</h3>
            <label for="time-input-field">Time (Ma)</label><p id="time-input-error" class="field-error" hidden></p>
            <input type="number" min="0" id="time-input-field" class="property-input" style="width: 100%; padding: 8px; margin-bottom: 12px; font-size: 14px;" placeholder="Enter time value">
            <div style="display: flex; gap: 8px; justify-content: flex-end;">
              <button id="btn-time-input-cancel" class="btn btn-secondary" style="padding: 6px 12px;">Cancel</button>
              <button id="btn-time-input-confirm" class="btn btn-primary" style="padding: 6px 12px;">Set time</button>
            </div>
          </div>
        </div>
        <!-- Apply Edit Modal -->
        <div id="apply-edit-modal" class="modal" role="dialog" aria-modal="true" aria-labelledby="apply-edit-title" aria-describedby="apply-edit-description" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.6); z-index: 10000; justify-content: center; align-items: center;">
          <div class="modal-content" style="background: var(--bg-surface); border: 1px solid var(--border-default); border-radius: var(--radius-lg); padding: 20px; min-width: 400px; box-shadow: var(--shadow-lg); display: flex; flex-direction: column; gap: 16px;">
            <h3 id="apply-edit-title" style="margin: 0; color: var(--text-primary); font-size: 18px; border-bottom: 1px solid var(--border-default); padding-bottom: 12px;">Apply Plate Geometry</h3>
            <div id="apply-edit-description" style="font-size: 13px; color: var(--text-secondary); line-height: 1.4;">Choose how to apply these changes to the timeline:</div>
            
            <div style="display: flex; flex-direction: column; gap: 8px;">
                <button id="btn-apply-generation" class="btn app-modal-choice">
                    <span style="font-weight: 600;">Rewrite shape from birth</span>
                    <span class="app-modal-button-subtext">Changes the plate's base shape throughout its history.</span>
                </button>
                
                <button id="btn-apply-event" class="btn app-modal-choice">
                    <span style="font-weight: 600;">Change shape from this time</span>
                    <span class="app-modal-button-subtext">Adds an edit at <span id="lbl-current-time">0</span> Ma. Earlier geometry stays unchanged.</span>
                </button>
            </div>
            
            <div style="display: flex; justify-content: flex-end; margin-top: 8px; border-top: 1px solid var(--border-default); padding-top: 16px;">
              <button id="btn-apply-cancel" class="btn btn-secondary" style="padding: 8px 16px;">Cancel</button>
            </div>
          </div>
        </div>
        
        <!-- Drag Target Modal (Dynamic Velocity Feedback) -->
        <div id="drag-target-modal" class="modal" role="dialog" aria-modal="true" aria-labelledby="drag-target-title" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.6); z-index: 10000; justify-content: center; align-items: center;">
          <div class="modal-content" style="background: var(--bg-surface); border: 1px solid var(--border-default); border-radius: 8px; padding: 20px; min-width: 400px; box-shadow: 0 10px 40px rgba(0,0,0,0.6); display: flex; flex-direction: column; gap: 16px;">
            <h3 id="drag-target-title" style="margin: 0; color: var(--text-primary); border-bottom: 1px solid var(--border-default); padding-bottom: 8px;">Set Motion Target</h3>
            
            <div style="display: flex; flex-direction: column; gap: 5px;">
                <label style="color: var(--text-secondary); font-size: 12px; text-transform: uppercase; font-weight: 600;">Current Time</label>
                <div id="drag-target-current-time" style="color: var(--text-primary); font-weight: bold; font-variant-numeric: tabular-nums; font-size: 14px;">0 Ma</div>
            </div>

            <div style="display: flex; flex-direction: column; gap: 5px;">
                <label style="color: var(--text-secondary); font-size: 12px; text-transform: uppercase; font-weight: 600;">Target Time (Ma)</label>
                <input type="number" id="drag-target-input" class="property-input" step="any" style="width: 100%; padding: 8px; font-size: 14px; color: var(--text-primary); background: var(--bg-dark); border: 1px solid var(--border-muted);">
            </div>

            <div style="background: var(--bg-elevated); padding: 12px; border-radius: 6px; display: flex; flex-direction: column; gap: 8px; border: 1px solid var(--border-muted);">
                 <label style="color: var(--text-muted); font-size: 12px; letter-spacing: 0.5px; font-weight: bold;">ESTIMATED VELOCITY</label>
                 
                 <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div style="display: flex; align-items: baseline; gap: 6px;">
                        <span id="drag-target-speed-deg" style="color: var(--accent-primary); font-size: 20px; font-weight: bold; font-variant-numeric: tabular-nums;">--</span>
                        <span class="motion-unit motion-unit-modal">deg/Ma</span>
                    </div>
                    <div style="display: flex; align-items: baseline; gap: 6px;">
                        <span id="drag-target-speed-cm" style="color: var(--accent-success); font-size: 16px; font-weight: bold; font-variant-numeric: tabular-nums;">--</span>
                        <span class="motion-unit motion-unit-modal">cm/yr</span>
                    </div>
                 </div>
                 <div id="drag-target-warning" style="font-size: 12px; color: var(--text-danger); display: none;">Speed exceeds 20 cm/yr. Choose a target time farther from the current time to reduce it.</div>
            </div>

            <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 8px;">
                <button id="btn-drag-target-cancel" class="btn btn-secondary" style="min-width: 80px;">Cancel</button>
                <button id="btn-drag-target-confirm" class="btn btn-primary" style="min-width: 80px;">Apply motion</button>
            </div>
          </div>
        </div>
        </div>

      </div>
    `;
}
