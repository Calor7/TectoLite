import type { AppState, OceanCrustStrategy, ProjectionType } from '../types';

export type ProjectSettingEffect = 'render' | 'recalculate' | 'explorer' | 'hint';

export interface ProjectSettingsHost {
    getState(): AppState;
    changed(effects: readonly ProjectSettingEffect[]): void;
}

interface CheckboxSetting {
    id: string;
    read(state: AppState): boolean;
    write(state: AppState, value: boolean): void;
    effects: readonly ProjectSettingEffect[];
}

const CHECKBOX_SETTINGS: readonly CheckboxSetting[] = [
    { id: 'check-show-hints', read: s => s.world.globalOptions.showHints !== false, write: (s, v) => { s.world.globalOptions.showHints = v; }, effects: ['hint'] },
    { id: 'check-grid', read: s => s.world.showGrid, write: (s, v) => { s.world.showGrid = v; }, effects: ['render'] },
    { id: 'check-features', read: s => s.world.showFeatures, write: (s, v) => { s.world.showFeatures = v; }, effects: ['render'] },
    { id: 'check-euler-poles', read: s => s.world.showEulerPoles, write: (s, v) => { s.world.showEulerPoles = v; }, effects: ['render'] },
    { id: 'check-future-features', read: s => s.world.showFutureFeatures, write: (s, v) => { s.world.showFutureFeatures = v; }, effects: ['render'] },
    { id: 'check-show-links', read: s => s.world.globalOptions.showLinks !== false, write: (s, v) => { s.world.globalOptions.showLinks = v; }, effects: ['render'] },
    { id: 'check-prediction-flowlines', read: s => s.world.globalOptions.showPredictionFlowlines === true, write: (s, v) => { s.world.globalOptions.showPredictionFlowlines = v; }, effects: ['render'] },
    { id: 'check-velocity-arrows', read: s => s.world.globalOptions.showVelocityArrows === true, write: (s, v) => { s.world.globalOptions.showVelocityArrows = v; }, effects: ['render'] },
    { id: 'check-hover-tooltips', read: s => s.world.globalOptions.showHoverTooltips === true, write: (s, v) => { s.world.globalOptions.showHoverTooltips = v; }, effects: ['render'] },
    { id: 'check-label-hover', read: s => s.world.globalOptions.expandLabelsOnHover !== false, write: (s, v) => { s.world.globalOptions.expandLabelsOnHover = v; }, effects: ['render'] },
    { id: 'check-show-hidden-plates', read: s => s.world.globalOptions.showHiddenPlates === true, write: (s, v) => { s.world.globalOptions.showHiddenPlates = v; }, effects: ['explorer', 'render'] },
    { id: 'check-grid-on-top', read: s => s.world.globalOptions.gridOnTop === true, write: (s, v) => { s.world.globalOptions.gridOnTop = v; }, effects: ['render'] },
    { id: 'check-boundary-viz', read: s => s.world.globalOptions.enableBoundaryVisualization === true, write: (s, v) => { s.world.globalOptions.enableBoundaryVisualization = v; }, effects: ['recalculate'] }
];

function bindSelect(
    id: string,
    host: ProjectSettingsHost,
    write: (state: AppState, value: string) => void,
    effects: readonly ProjectSettingEffect[]
): void {
    document.getElementById(id)?.addEventListener('change', event => {
        write(host.getState(), (event.target as HTMLSelectElement).value);
        host.changed(effects);
    });
}

export function bindProjectSettings(host: ProjectSettingsHost): void {
    for (const setting of CHECKBOX_SETTINGS) {
        document.getElementById(setting.id)?.addEventListener('change', event => {
            setting.write(host.getState(), (event.target as HTMLInputElement).checked);
            host.changed(setting.effects);
        });
    }

    bindSelect('projection-select', host, (state, value) => {
        state.world.projection = value as ProjectionType;
    }, ['render']);

    bindSelect('grid-thickness-select', host, (state, value) => {
        state.world.globalOptions.gridThickness = Number.parseFloat(value);
    }, ['render']);

    bindSelect('ocean-crust-strategy', host, (state, value) => {
        state.world.globalOptions.oceanCrustStrategy = value as OceanCrustStrategy;
    }, ['recalculate']);
}

export function syncProjectSettings(state: AppState): void {
    for (const setting of CHECKBOX_SETTINGS) {
        const input = document.getElementById(setting.id) as HTMLInputElement | null;
        if (input) input.checked = setting.read(state);
    }

    const projection = document.getElementById('projection-select') as HTMLSelectElement | null;
    if (projection) projection.value = state.world.projection;

    const gridThickness = document.getElementById('grid-thickness-select') as HTMLSelectElement | null;
    if (gridThickness) gridThickness.value = String(state.world.globalOptions.gridThickness);

    const oceanStrategy = document.getElementById('ocean-crust-strategy') as HTMLSelectElement | null;
    if (oceanStrategy) oceanStrategy.value = state.world.globalOptions.oceanCrustStrategy ?? 'off';
}
