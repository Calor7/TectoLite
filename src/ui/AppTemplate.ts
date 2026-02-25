/**
 * AppTemplate - Main application HTML template.
 * Extracted from main.ts TectoLiteApp.getHTML() method.
 */

export interface AppTemplateOptions {
  globalOptions: {
    showLinks?: boolean;
    showFlowlines?: boolean;
    gridOnTop?: boolean;
    plateOpacity?: number;
    showHints?: boolean;
    customRadiusEnabled?: boolean;
    customPlanetRadius?: number;
    timelineMaxTime?: number;
    enableAutoOceanicCrust?: boolean;
    enableExpandingRifts?: boolean;
    oceanicGenerationInterval?: number;
    oceanicCrustColor?: string;
    oceanicCrustOpacity?: number;
  };
  realWorldPresetListHtml: string;
  customPresetListHtml: string;
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
                        <a href="https://github.com/Calor7/TectoLite" target="_blank" rel="noopener noreferrer" style="color: inherit; text-decoration: none;">
                            TECTOLITE
                        </a>
                        <span class="app-subtitle">by <a href="https://www.refracturedgames.com" target="_blank" rel="noopener noreferrer">RefracturedGames</a></span>
                        <span style="margin-left: 20px; font-size: 0.7em; display: inline-flex; gap: 15px; align-items: center;">
                                <a href="https://ko-fi.com/refracturedgames" target="_blank" rel="noopener noreferrer" style="color: var(--text-secondary); text-decoration: none;"><span class="coffee-icon">☕</span> Feed my coffee addiction</a>
                                <a href="https://refracturedgames.eo.page/zcyvj" target="_blank" rel="noopener noreferrer" id="link-subscribe" style="color: var(--accent-primary); text-decoration: none; font-weight: 600;">Subscribe to Updates</a>
                        </span>
                    </h1>
                    <div class="header-actions">
            <!-- Projection Selector Moved to Sidebar -->
            <button id="btn-tutorial-help" class="btn" title="Show Tutorial" style="background-color: var(--accent-danger); color: white; font-weight: bold; border-radius: 50%; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; padding: 0;">
                ?
            </button>
            
            <!-- Retro Status Info Box -->
            <div id="retro-status-box" class="retro-status-box" style="display: none;">
                <span id="retro-status-text">INFO LOADING...</span>
            </div>

            <!-- Settings Dropdown (formerly Planet) -->
            <div class="view-dropdown-container">
                <button id="btn-planet" class="btn btn-secondary" title="Application Settings">
                    <span class="icon">⚙️</span> Settings
                </button>
                <div id="planet-dropdown-menu" class="view-dropdown-menu" style="min-width: 240px;">
                    <div class="dropdown-section">
                        <div class="dropdown-header">Timeline</div>
                        <div style="padding: 8px; display: flex; flex-direction: column; gap: 8px;">
                            <label style="display: flex; justify-content: space-between; align-items: center; font-size: 11px;">
                                <span>Max Duration (Ma)</span>
                                <input type="number" id="timeline-max-time" class="property-input" value="${g.timelineMaxTime || 500}" step="100" min="100" style="width: 70px; padding: 2px 4px;">
                            </label>
                        </div>
                    </div>
                    <div class="dropdown-section" style="border-top: 1px solid var(--border-default); margin-top: 4px; padding-top: 4px;">
                        <div class="dropdown-header">Planet</div>
                        <label class="view-dropdown-item" style="display:flex; justify-content:space-between; align-items:center;">
                            <span>Custom Planet Radius</span>
                            <input type="checkbox" id="check-custom-radius">
                        </label>
                        <div style="padding: 2px 8px 4px 8px; display: flex; align-items: center; gap: 6px;">
                            <label style="font-size: 10px; color: var(--text-secondary); white-space: nowrap;">Radius (km)</label>
                            <input type="number" id="global-planet-radius" class="property-input" value="${g.customRadiusEnabled ? (g.customPlanetRadius || 6371) : 6371}" step="100" style="width: 90px;" disabled>
                        </div>
                    </div>
                    
                    <!-- Oceanic Crust Settings -->
                    <div class="dropdown-section" style="border-top: 1px solid var(--border-default); margin-top: 4px; padding-top: 4px;">
                        <div class="dropdown-header">Oceanic Crust</div>
                        
                        <label class="view-dropdown-item" style="display:flex; justify-content:space-between; align-items:center;">
                            <span>Expanding Rifts</span>
                            <input type="checkbox" id="check-expanding-rifts" ${g.enableExpandingRifts !== false ? 'checked' : ''}>
                        </label>
                        
                        <label class="view-dropdown-item" style="display:flex; justify-content:space-between; align-items:center; opacity: 0.8;">
                            <span>Flowlines (Legacy)</span>
                            <input type="checkbox" id="check-auto-oceanic" ${g.enableAutoOceanicCrust !== false ? 'checked' : ''}>
                        </label>
                        
                        <div style="padding: 2px 8px 4px 8px; display: flex; align-items: center; justify-content: space-between;">
                            <label style="font-size: 10px; color: var(--text-secondary);">Generation Interval (Ma)</label>
                            <input type="number" id="input-oceanic-interval" class="property-input" value="${g.oceanicGenerationInterval || 25}" step="1" min="1" style="width: 50px;">
                        </div>

                         <div style="padding: 2px 8px 4px 8px; display: flex; align-items: center; justify-content: space-between;">
                            <label style="font-size: 10px; color: var(--text-secondary);">Creation Color</label>
                            <input type="color" id="input-oceanic-color" value="${g.oceanicCrustColor || '#3b82f6'}" style="width: 24px; height: 16px; border: none; padding: 0; background: none; cursor: pointer;">
                        </div>

                         <div style="padding: 2px 8px 4px 8px;">
                             <div style="display: flex; justify-content: space-between; align-items: center;">
                                <label style="font-size: 10px; color: var(--text-secondary);">Opacity</label>
                                <span id="lbl-oceanic-opacity" style="font-size: 10px;">${Math.round((g.oceanicCrustOpacity ?? 0.5) * 100)}%</span>
                             </div>
                             <input type="range" id="input-oceanic-opacity" min="0" max="100" value="${Math.round((g.oceanicCrustOpacity ?? 0.5) * 100)}" style="width: 100%; height: 4px; display:block; margin-top:4px;">
                        </div>
                    </div>
                </div>
            </div>

            <!-- View Dropdown -->
            <div class="view-dropdown-container">

                <button id="btn-view-panels" class="btn btn-secondary" title="View Options">
                    <span class="icon">👁️</span> View
                </button>
                <div id="view-dropdown-menu" class="view-dropdown-menu" style="min-width: 250px;">
                    <!-- 1. BAR SETTING (Panels) -->
                    <div class="dropdown-section">
                        <div class="dropdown-header">Bars</div>
                        <label class="view-dropdown-item">
                            <input type="checkbox" id="check-view-tools" checked> Tools
                        </label>
                        <label class="view-dropdown-item">
                            <input type="checkbox" id="check-view-plates" checked> Plates
                        </label>
                        <label class="view-dropdown-item">
                            <input type="checkbox" id="check-view-props" checked> Properties
                        </label>
                        <label class="view-dropdown-item">
                            <input type="checkbox" id="check-view-timeline" checked> Timeline
                        </label>
                    </div>

                    <!-- 2. PROJECTION SETTING -->
                    <div class="dropdown-section" style="border-top: 1px solid var(--border-default); margin-top: 4px; padding-top: 4px;">
                        <div class="dropdown-header">Projection <span class="info-icon" data-tooltip="Choose map projection">(i)</span></div>
                        <div style="padding: 4px 8px;">
                            <select id="projection-select" class="tool-select" style="width:100%;">
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
                        <div class="dropdown-header">Reference Overlay</div>
                        <label class="view-dropdown-item">
                            <input type="checkbox" id="check-show-overlay"> Show Overlay <span class="info-icon" data-tooltip="Show uploaded reference map for tracing">(i)</span>
                        </label>
                        <div style="padding: 2px 8px 4px 28px; display: flex; flex-direction: column; gap: 4px;">
                            <button id="btn-upload-overlay" class="btn btn-secondary" style="font-size: 11px; padding: 4px 8px;">
                                &#x1F4BE; Upload Map
                            </button>
                            <div style="display: flex; align-items: center; gap: 4px;">
                                <label style="font-size: 10px; color: var(--text-secondary); white-space: nowrap;">Opacity:</label>
                                <input type="range" id="overlay-opacity-slider" min="0" max="100" value="50" style="flex: 1; height: 4px;">
                                <span id="overlay-opacity-value" style="font-size: 10px; color: var(--text-secondary); min-width: 30px;">50%</span>
                            </div>
                            <button id="btn-clear-overlay" class="btn btn-secondary" style="font-size: 11px; padding: 4px 8px;">
                                &#x2717; Clear
                            </button>
                        </div>
                    </div>

                    <!-- 4. EFFECTS SETTING -->
                    <div class="dropdown-section" style="border-top: 1px solid var(--border-default); margin-top: 4px; padding-top: 4px;">
                        <div class="dropdown-header">Effects</div>
                        <label class="view-dropdown-item">
                            <input type="checkbox" id="check-grid" checked> Show Grid <span class="info-icon" data-tooltip="Toggle the latitude/longitude grid">(i)</span>
                        </label>
                         <div style="padding: 2px 8px 4px 28px;">
                             <select id="grid-thickness-select" class="tool-select" style="width: 100%; font-size: 11px; padding: 2px;">
                                <option value="0.5">Thin (0.5px)</option>
                                <option value="1.0" selected>Medium (1.0px)</option>
                                <option value="2.0">Thick (2.0px)</option>
                            </select>
                        </div>

                        <label class="view-dropdown-item">
                            <input type="checkbox" id="check-features" checked> Show Features <span class="info-icon" data-tooltip="Show mountains, volcanoes, etc.">(i)</span>
                        </label>
                        <!-- Boundary Visualization moved to Automation menu -->
                        <label class="view-dropdown-item">
                            <input type="checkbox" id="check-euler-poles"> Show Euler Poles <span class="info-icon" data-tooltip="Show all rotation axes (Euler poles)">(i)</span>
                        </label>
                        <label class="view-dropdown-item">
                             <input type="checkbox" id="check-future-features"> Show Future/Past <span class="info-icon" data-tooltip="Show features not yet born">(i)</span>
                        </label>


                        <label class="view-dropdown-item">
                            <input type="checkbox" id="check-show-links" ${g.showLinks !== false ? 'checked' : ''}> Show Links <span class="info-icon" data-tooltip="Show plate-to-plate and landmass-to-plate links">(i)</span>
                        </label>
                        <label class="view-dropdown-item">
                            <input type="checkbox" id="check-show-flowlines" ${g.showFlowlines !== false ? 'checked' : ''}> Show Flowlines <span class="info-icon" data-tooltip="Show flowline motion trails">(i)</span>
                        </label>
                        <label class="view-dropdown-item">
                            <input type="checkbox" id="check-grid-on-top" ${g.gridOnTop ? 'checked' : ''}> Grid on Top <span class="info-icon" data-tooltip="Render grid above plates instead of below">(i)</span>
                        </label>
                        
                        <div style="padding: 4px 8px; border-top: 1px dotted var(--border-default); margin-top: 4px;">
                             <label style="font-size: 11px; white-space: nowrap; font-weight: 600;">Plate Opacity <span class="info-icon" data-tooltip="Adjust transparency of tectonic plates">(i)</span></label>
                             <div style="display: flex; align-items: center; gap: 4px;">
                                 <input type="range" id="plate-opacity-slider" min="0" max="100" value="${(g.plateOpacity ?? 1.0) * 100}" style="flex: 1; height: 4px;">
                                 <span id="plate-opacity-value" style="font-size: 10px; color: var(--text-secondary); min-width: 35px;">${Math.round((g.plateOpacity ?? 1.0) * 100)}%</span>
                             </div>
                        </div>

                    </div>
                </div>
            </div>



            <button id="btn-reset-camera" class="btn btn-secondary" title="Reset Camera">
                <span class="icon">⟲</span><span class="oldschool-text">RESET</span>
            </button>

            <button id="btn-fullscreen" class="btn btn-secondary" title="Toggle Fullscreen">
               <span class="icon">⛶</span><span class="oldschool-text">FULL</span>
            </button>
            <button id="btn-ui-mode" class="btn btn-secondary" title="Toggle UI Mode">
               <span class="icon">💻</span><span class="oldschool-text">UI</span>
            </button>

            <button id="btn-theme-toggle" class="btn btn-secondary" title="Toggle Theme">
              <span class="icon">🌙</span><span class="oldschool-text">THEME</span>
            </button>
            <button id="btn-undo" class="btn btn-secondary" title="Undo (Ctrl+Z)">
              <span class="icon">↶</span> Undo
            </button>
            <button id="btn-redo" class="btn btn-secondary" title="Redo (Ctrl+Y)">
              <span class="icon">↷</span> Redo
            </button>
            <button id="btn-export" class="btn btn-primary" title="Export (PNG, Heightmap, QGIS)">
              <span class="icon">📤</span> Export
            </button>
            <button id="btn-export-json" class="btn btn-secondary" title="Export JSON">
              <span class="icon">💾</span> Save
            </button>
            <button id="btn-import-json" class="btn btn-secondary" title="Import JSON">
              <span class="icon">📂</span> Load
            </button>
            <button id="btn-legend" class="btn btn-secondary" title="Legend">
              <span class="icon">❓</span> Legend
            </button>
            <input type="file" id="file-import" accept=".json" style="display: none;">
            <input type="file" id="file-overlay-upload" accept="image/*" style="display: none;">
          </div>
        </header>
        
        <div class="main-content">
          <aside class="toolbar" id="toolbar">
            <!-- 1. TOOLS GROUP -->
            <div class="tool-group">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                <h3 class="tool-group-title" style="margin: 0;">Interaction</h3>
                <label style="font-size: 10px; display: flex; align-items: center; gap: 4px; cursor: pointer; color: var(--text-secondary);" title="Toggle on-canvas tooltips">
                  <input type="checkbox" id="check-show-hints" ${g.showHints !== false ? 'checked' : ''}> Hints
                </label>
              </div>
              
              <!-- Layer Mode Removed -->
              
              <div style="display: flex; gap: 4px; flex-wrap: wrap;">
                  <button class="tool-btn active" data-tool="select" style="flex:1;">
                    <span class="tool-icon">👆</span>
                    <span class="tool-label">Select</span>
                    <span class="info-icon" data-tooltip="Select plates/features to edit (Hotkey: V)">(i)</span>
                  </button>
                  <button class="tool-btn" data-tool="pan" style="flex:1;">
                    <span class="tool-icon">🔄</span>
                    <span class="tool-label">Rotate</span>
                    <span class="info-icon" data-tooltip="Move camera or rotate globe (Hotkey: H)">(i)</span>
                  </button>
              </div>
              <div style="display: flex; gap: 4px; flex-wrap: wrap;">
                  <button class="tool-btn" data-tool="draw" style="flex:1;">
                    <span class="tool-icon">✏️</span>
                    <span class="tool-label">Draw</span>
                    <span class="info-icon" data-tooltip="Draw new plate boundaries (Hotkey: D)">(i)</span>
                  </button>
                  <button class="tool-btn" data-tool="edit" style="flex:1;">
                    <span class="tool-icon">✎</span>
                    <span class="tool-label">Edit</span>
                    <span class="info-icon" data-tooltip="Modify plate geometry (Hotkey: E)">(i)</span>
                  </button>

              </div>
              <div style="display: flex; gap: 4px; flex-wrap: wrap;">
                  <button class="tool-btn" data-tool="split" style="flex:1;">
                    <span class="tool-icon">✂️</span>
                    <span class="tool-label">Split</span>
                    <span class="info-icon" data-tooltip="Divide a plate in two (Hotkey: S)">(i)</span>
                  </button>
                   <button class="tool-btn" data-tool="link" style="flex:1;">
                    <span class="tool-icon">🔗</span>
                    <span class="tool-label">Link</span>
                    <span class="info-icon" data-tooltip="Group plates to move together (Hotkey: L)">(i)</span>
                  </button>
                  <button class="tool-btn" data-tool="fuse" style="flex:1;">
                    <span class="tool-icon">🧬</span>
                    <span class="tool-label">Fuse</span>
                    <span class="info-icon" data-tooltip="Merge two plates (Hotkey: G)">(i)</span>
                  </button>



              </div>
            </div>
            
            <!-- 2. CONTEXT / OPTIONS GROUP -->
            <div class="tool-group">
                 <h3 class="tool-group-title">Tool Options</h3>
                 
                 <!-- Dynamic Controls Stack -->


                 <div id="split-controls" style="display: none; flex-direction:column; gap:4px;">
                     <div style="align-self: center; font-size: 11px; color: var(--text-secondary);">Confirm Split?</div>
                     <button class="btn btn-success" id="btn-split-apply">✓ Apply</button>
                     <button class="btn btn-secondary" id="btn-split-cancel">✗ Cancel</button>
                 </div>



                 <div id="motion-controls" style="display: none; flex-direction:column; gap:4px;">
                      <div style="font-size: 11px; color: var(--text-secondary);">Confirm Motion?</div>
                      <button class="btn btn-success" id="btn-motion-apply">✓ Apply</button>
                      <button class="btn btn-secondary" id="btn-motion-cancel">✗ Cancel</button>
                 </div>

                 <div id="edit-controls" style="display: none; flex-direction:column; gap:4px; margin-top: 8px; border-top: 1px solid var(--border-default); padding-top: 8px;">
                     <div style="align-self: center; font-size: 11px; color: var(--text-secondary); font-weight: bold;">Apply Changes?</div>
                     <div style="display:flex; gap: 4px;">
                         <button class="btn btn-success" id="btn-edit-apply" style="flex:1;">✓ Apply</button>
                         <button class="btn btn-secondary" id="btn-edit-cancel" style="flex:1;">✗ Cancel</button>
                     </div>
                 </div>



                 <!-- Motion Mode Specifics -->
                 <div style="margin-top: 8px;">
                    <label class="property-label" style="font-size:11px;">Interaction Mode <span class="info-icon" data-tooltip="Classic (Pole) vs Dragging">(i)</span></label>
                    <select id="motion-mode-select" class="tool-select" style="width:100%;">
                        <option value="classic">Classic (Fixed Pole)</option>
                        <option value="dynamic_pole">Dynamic Direction</option>
                        <option value="drag_target">Drag Landmass</option>
                    </select>
                 </div>
            </div>

            <!-- 3. VIEW GROUP -->

            
            <!-- 4. GLOBAL / SIMULATION GROUP -->
            <div class="tool-group">
                <h3 class="tool-group-title">Simulation</h3>
                <hr class="property-divider" style="margin: 8px 0;">
                <div style="margin-bottom:6px;">
                    <div style="font-size:11px; font-weight:600; color:var(--text-secondary); margin-bottom:4px;">Speed</div>
                    <div style="display:flex; flex-direction:column; gap:6px;">
                        <div style="display:flex; align-items:center; gap:6px;">
                            <input type="number" id="speed-input-cm" class="property-input" step="0.05" style="width:70px;" disabled>
                            <span style="font-size:10px; color:var(--text-secondary);">cm/yr</span>
                        </div>
                        <div style="display:flex; align-items:center; gap:6px;">
                            <input type="number" id="speed-input-deg" class="property-input" step="0.05" style="width:70px;" disabled>
                            <span style="font-size:10px; color:var(--text-secondary);">deg/Ma</span>
                        </div>
                    </div>
                    <div style="margin-top: 6px; display: flex; flex-direction: column; gap: 4px;">
                        <button id="btn-reposition-pole-north" class="btn btn-secondary" style="width:100%; font-size:10px;">Reposition Pole to North</button>
                        <button id="btn-reposition-pole-south" class="btn btn-secondary" style="width:100%; font-size:10px;">Reposition Pole to South</button>
                    </div>
                </div>
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                  <div style="font-size:11px; font-weight:600; color:var(--text-secondary);">
                    Speed Presets
                  </div>
                  <label style="display:flex; align-items:center; gap:4px; font-size:10px; cursor:pointer;" title="Switch between real-world examples and custom preset values">
                      <input type="checkbox" id="check-use-custom-presets"> Custom 
                  </label>
                </div>
                
                <!-- Real World List -->
                <div id="preset-container-realworld" style="display:flex; flex-direction:column; gap:6px; max-height:300px; overflow-y:auto; padding-right:4px;">
                    ${opts.realWorldPresetListHtml}
                </div>

                <!-- Custom List -->
                <div id="preset-container-custom" style="display:none; flex-direction:column; gap:6px;">
                    ${opts.customPresetListHtml}
                </div>

                <!-- Oceanic Crust Settings moved to Settings Modal -->
                <div style="margin-top: 8px; border-top: 1px dotted var(--border-default); padding-top: 8px;">
                     <div style="font-size:11px; color:var(--text-secondary); font-style:italic;">
                        Use <span class="icon">⚙️</span> for global settings
                     </div>
                </div>
            </div>

            <!-- 5. PLATES LIST -->

          </aside>
          
          <div class="resizer-x" id="resizer-left" style="position: relative; width: 4px; cursor: col-resize; background-color: var(--bg-tertiary); z-index: 10;"></div>
          
          <aside class="plate-sidebar" id="plate-sidebar">
             <h3 class="tool-group-title" style="padding: 16px 16px 0 16px;">Explorer</h3>
             <div id="plate-list" class="plate-list" style="padding: 0 16px 16px 16px; overflow-y: auto; flex:1;"></div>
          </aside>
          
          <div class="resizer-x" id="resizer-left-inner" style="position: relative; width: 4px; cursor: col-resize; background-color: var(--bg-tertiary); z-index: 10;"></div>

          <main class="canvas-container" style="flex:1; display:flex;">
            <canvas id="main-canvas" style="flex:1;"></canvas>
            <div class="canvas-hint" id="canvas-hint"></div>
          </main>
          
          <div class="resizer-x" id="resizer-right" style="position: relative; width: 4px; cursor: col-resize; background-color: var(--bg-tertiary); z-index: 10;"></div>

          <div class="right-sidebar" id="right-sidebar">
            <aside class="properties-panel" id="properties-panel">
                <h3 class="panel-title" id="properties-panel-title">Properties</h3>
                <div id="properties-content">
                  <p class="empty-message">Select a plate to edit properties</p>
                </div>
            </aside>
            <div id="timeline-panel" class="timeline-panel">
                <div class="timeline-title">Event Timeline</div>
                <!-- Timeline items injected here -->
            </div>
          </div>
        </div>
        
        <div class="resizer-y" id="resizer-bottom" style="position: relative; height: 4px; cursor: row-resize; background-color: var(--bg-tertiary); z-index: 10;"></div>

        <footer class="timeline-bar" id="timeline-bar">
          <div class="time-controls">
            <button id="btn-play" class="btn btn-icon" title="Play/Pause">▶️</button>
            <select id="speed-select" class="speed-select">
              <option value="1">1 Ma/s</option>
              <option value="5">5 Ma/s</option>
              <option value="10">10 Ma/s</option>
              <option value="50">50 Ma/s</option>
            </select>
          </div>
          <div class="timeline">
            <input type="range" id="time-slider" class="time-slider" min="0" max="500" value="0">
            <div class="time-display">
              <div class="time-controls-row">
                <span id="current-time" class="current-time-display" style="cursor: pointer; font-weight: 600;" title="Click to set current time">0</span>
                <span id="time-mode-label">Ma</span>

              </div>
            </div>
          </div>
          <button id="btn-reset-time" class="btn btn-secondary">Reset</button>
        </footer>
        <div id="global-tooltip"></div>
        <!-- Time Input Modal -->
        <div id="time-input-modal" class="modal" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.6); z-index: 10000; justify-content: center; align-items: center;">
          <div class="modal-content" style="background: var(--bg-secondary); border: 2px solid var(--border-default); border-radius: 4px; padding: 16px; min-width: 300px; box-shadow: 0 4px 12px rgba(0,0,0,0.4);">
            <h3 style="margin-top: 0; color: var(--text-primary);">Set Current Time</h3>
            <input type="number" id="time-input-field" class="property-input" style="width: 100%; padding: 8px; margin-bottom: 12px; font-size: 14px;" placeholder="Enter time value">
            <div style="display: flex; gap: 8px; justify-content: flex-end;">
              <button id="btn-time-input-cancel" class="btn btn-secondary" style="padding: 6px 12px;">Cancel</button>
              <button id="btn-time-input-confirm" class="btn btn-primary" style="padding: 6px 12px;">Confirm</button>
            </div>
          </div>
        </div>
        <!-- Apply Edit Modal -->
        <div id="apply-edit-modal" class="modal" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.6); z-index: 10000; justify-content: center; align-items: center;">
          <div class="modal-content" style="background: #1e1e2e; border: 1px solid var(--border-default); border-radius: 8px; padding: 20px; min-width: 400px; box-shadow: 0 10px 40px rgba(0,0,0,0.6); display: flex; flex-direction: column; gap: 16px;">
            <h3 style="margin: 0; color: var(--text-primary); font-size: 18px; border-bottom: 1px solid var(--border-default); padding-bottom: 12px;">Apply Plate Geometry</h3>
            <div style="font-size: 13px; color: var(--text-secondary); line-height: 1.4;">Choose how to apply these changes to the timeline:</div>
            
            <div style="display: flex; flex-direction: column; gap: 8px;">
                <button id="btn-apply-generation" class="btn" style="text-align: left; padding: 12px; display: flex; flex-direction: column; background: var(--bg-tertiary); border: 1px solid var(--border-default); transition: all 0.2s;">
                    <span style="font-weight: 600; font-size: 14px; margin-bottom: 4px; color: var(--color-primary);">Apply at Generation (Rewrite History)</span>
                    <span style="font-size: 11px; opacity: 0.7; font-weight: normal; color: var(--text-secondary);">Modifies the plate's base shape from birth. The change propagates through all time.</span>
                </button>
                
                <button id="btn-apply-event" class="btn" style="text-align: left; padding: 12px; display: flex; flex-direction: column; background: var(--bg-tertiary); border: 1px solid var(--border-default); transition: all 0.2s;">
                    <span style="font-weight: 600; font-size: 14px; margin-bottom: 4px; color: var(--color-success);">Insert Event at Current Time</span>
                    <span style="font-size: 11px; opacity: 0.7; font-weight: normal; color: var(--text-secondary);">Creates a new 'Edit' event at <span id="lbl-current-time" style="color:white; font-weight:bold;">0</span> Ma. The shape changes only from this point forward.</span>
                </button>
            </div>
            
            <div style="display: flex; justify-content: flex-end; margin-top: 8px; border-top: 1px solid var(--border-default); padding-top: 16px;">
              <button id="btn-apply-cancel" class="btn btn-secondary" style="padding: 8px 16px;">Cancel</button>
            </div>
          </div>
        </div>
        
        <!-- Drag Target Modal (Dynamic Velocity Feedback) -->
        <div id="drag-target-modal" class="modal" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.6); z-index: 10000; justify-content: center; align-items: center;">
          <div class="modal-content" style="background: var(--bg-surface); border: 1px solid var(--border-default); border-radius: 8px; padding: 20px; min-width: 400px; box-shadow: 0 10px 40px rgba(0,0,0,0.6); display: flex; flex-direction: column; gap: 16px;">
            <h3 style="margin: 0; color: var(--text-primary); border-bottom: 1px solid var(--border-default); padding-bottom: 8px;">Set Motion Target</h3>
            
            <div style="display: flex; flex-direction: column; gap: 5px;">
                <label style="color: var(--text-secondary); font-size: 12px; text-transform: uppercase; font-weight: 600;">Current Time</label>
                <div id="drag-target-current-time" style="color: var(--text-primary); font-weight: bold; font-family: monospace; font-size: 14px;">0 Ma</div>
            </div>

            <div style="display: flex; flex-direction: column; gap: 5px;">
                <label style="color: var(--text-secondary); font-size: 12px; text-transform: uppercase; font-weight: 600;">Target Time (Ma)</label>
                <input type="number" id="drag-target-input" class="property-input" step="any" style="width: 100%; padding: 8px; font-size: 14px; color: var(--text-primary); background: var(--bg-dark); border: 1px solid var(--border-muted);">
            </div>

            <div style="background: var(--bg-elevated); padding: 12px; border-radius: 6px; display: flex; flex-direction: column; gap: 8px; border: 1px solid var(--border-muted);">
                 <label style="color: var(--text-muted); font-size: 10px; letter-spacing: 0.5px; font-weight: bold;">ESTIMATED VELOCITY</label>
                 
                 <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div style="display: flex; align-items: baseline; gap: 6px;">
                        <span id="drag-target-speed-deg" style="color: var(--accent-primary); font-size: 20px; font-weight: bold; font-family: monospace;">--</span>
                        <span style="color: var(--text-secondary); font-size: 12px;">deg/Ma</span>
                    </div>
                    <div style="display: flex; align-items: baseline; gap: 6px;">
                        <span id="drag-target-speed-cm" style="color: var(--accent-success); font-size: 16px; font-weight: bold; font-family: monospace;">--</span>
                        <span style="color: var(--text-secondary); font-size: 12px;">cm/yr</span>
                    </div>
                 </div>
                 <div id="drag-target-warning" style="font-size: 11px; color: var(--accent-warning); display: none;">Warning: Excessive velocity detected!</div>
            </div>

            <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 8px;">
                <button id="btn-drag-target-cancel" class="btn btn-secondary" style="min-width: 80px;">Cancel</button>
                <button id="btn-drag-target-confirm" class="btn btn-primary" style="min-width: 80px; background-color: var(--accent-primary); color: white;">Confirm</button>
            </div>
          </div>
        </div>
        </div>

      </div>
    `;
}
