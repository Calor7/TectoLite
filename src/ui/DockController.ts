export interface DockController {
    setTool(tool: string): void;
    syncInspectorSelection(hasSelection: boolean): void;
    destroy(): void;
}

export interface ToolSurfaceState {
    activeTool: string;
    open: boolean;
    showToolNames: boolean;
}

export type ToolSurfaceAction =
    | { type: 'select-tool'; tool: string }
    | { type: 'toggle-surface' }
    | { type: 'set-names-visible'; value: boolean }
    | { type: 'require-actions' };

const REQUIRED_ACTION_IDS = ['split-controls', 'motion-controls', 'edit-controls'];
const TOOL_NAMES_STORAGE_KEY = 'tectolite-show-tool-names';
const TOOL_OPTIONS_STORAGE_KEY = 'tectolite-tool-options-open';

const TOOL_NAMES: Record<string, string> = {
    select: 'Select',
    draw: 'Draw',
    feature: 'Feature',
    poly_feature: 'Region Feature',
    split: 'Split',
    pan: 'Rotate',
    view_pan: 'Move View',
    fuse: 'Fuse',
    link: 'Link',
    edit: 'Edit',
    paint: 'Paint',
    label: 'Label'
};

export function reduceToolSurfaceState(state: ToolSurfaceState, action: ToolSurfaceAction): ToolSurfaceState {
    switch (action.type) {
        case 'select-tool':
            return {
                ...state,
                activeTool: action.tool
            };
        case 'toggle-surface':
            return { ...state, open: !state.open };
        case 'set-names-visible':
            return { ...state, showToolNames: action.value };
        case 'require-actions':
            return { ...state, open: true };
    }
}

export function rightDockVisible(state: { propertiesEnabled: boolean; historyOpen: boolean }): boolean {
    return state.propertiesEnabled || state.historyOpen;
}

function setPressed(button: HTMLElement | null, pressed: boolean): void {
    button?.setAttribute('aria-pressed', String(pressed));
    button?.classList.toggle('active', pressed);
}

function isInlineVisible(element: HTMLElement | null): boolean {
    return Boolean(element && element.style.display !== 'none' && !element.hidden);
}

export function bindDockController(
    root: Document = document,
    onLayoutChange: () => void = () => undefined
): DockController {
    const view = root.defaultView ?? window;
    const toolbar = root.getElementById('toolbar');
    const toolSurface = root.getElementById('tool-options-sidebar');
    const toolSurfaceTitle = root.getElementById('title-tool-options');
    const toolSurfaceEmpty = root.getElementById('tool-options-empty');
    const explorer = root.getElementById('plate-sidebar');
    const rightSidebar = root.getElementById('right-sidebar');
    const propertiesPanel = root.getElementById('properties-panel');
    const edgePanel = root.getElementById('edge-properties-panel');
    const historyPanel = root.getElementById('timeline-panel');
    const timelineBar = root.getElementById('timeline-bar');
    const toolsCheck = root.getElementById('check-view-tools') as HTMLInputElement | null;
    const explorerCheck = root.getElementById('check-view-plates') as HTMLInputElement | null;
    const propertiesCheck = root.getElementById('check-view-props') as HTMLInputElement | null;
    const historyCheck = root.getElementById('check-view-history') as HTMLInputElement | null;
    const timelineCheck = root.getElementById('check-view-timeline') as HTMLInputElement | null;
    const showNamesCheck = root.getElementById('check-show-tool-names') as HTMLInputElement | null;
    const optionsButton = root.getElementById('btn-toggle-tool-options');
    const explorerButton = root.getElementById('btn-toggle-explorer-dock');
    const inspectorButton = root.getElementById('btn-toggle-inspector-dock');
    const historyButton = root.getElementById('btn-toggle-history-dock');
    const cleanups: Array<() => void> = [];

    let hasSelection = false;
    let propertiesEnabled = propertiesCheck?.checked ?? false;
    let historyOpen = historyCheck?.checked ?? false;
    let savedToolOptionsOpen = false;
    let savedToolNames = true;
    try {
        savedToolOptionsOpen = view.localStorage.getItem(TOOL_OPTIONS_STORAGE_KEY) === 'true';
        const storedNames = view.localStorage.getItem(TOOL_NAMES_STORAGE_KEY);
        savedToolNames = storedNames === null ? true : storedNames !== 'false';
    } catch {
        // Storage can be unavailable in privacy-restricted browser contexts.
    }
    let toolState: ToolSurfaceState = {
        activeTool: 'select',
        open: savedToolOptionsOpen,
        showToolNames: savedToolNames
    };

    const notifyLayout = () => {
        view.requestAnimationFrame(onLayoutChange);
        view.setTimeout(onLayoutChange, 320);
    };

    const syncToolSurfaceContent = () => {
        if (!toolSurface) return;
        const optionBlocks = Array.from(toolSurface.children).filter((element): element is HTMLElement =>
            element instanceof HTMLElement
            && element !== toolSurfaceTitle
            && element !== toolSurfaceEmpty
        );
        const hasVisibleOptions = optionBlocks.some(isInlineVisible);
        if (toolSurfaceEmpty) toolSurfaceEmpty.hidden = hasVisibleOptions;
    };

    const renderToolState = () => {
        const wasOpen = Boolean(toolSurface && !toolSurface.classList.contains('collapsed'));
        toolbar?.classList.toggle('tool-options-open', toolState.open);
        toolbar?.classList.toggle('tool-names-hidden', !toolState.showToolNames);
        if (toolbar) toolbar.dataset.activeTool = toolState.activeTool;
        toolSurface?.classList.toggle('collapsed', !toolState.open);
        toolSurface?.classList.toggle('context-open', toolState.open);
        toolSurface?.setAttribute('aria-hidden', String(!toolState.open));
        setPressed(optionsButton, toolState.open);
        if (showNamesCheck) showNamesCheck.checked = toolState.showToolNames;
        if (toolSurfaceTitle) toolSurfaceTitle.textContent = `${TOOL_NAMES[toolState.activeTool] ?? 'Tool'} Options`;
        view.requestAnimationFrame(syncToolSurfaceContent);
        if (wasOpen !== toolState.open) notifyLayout();
    };

    const dispatchToolState = (action: ToolSurfaceAction) => {
        toolState = reduceToolSurfaceState(toolState, action);
        renderToolState();
    };

    const setExplorer = (visible: boolean) => {
        const changed = explorer?.classList.contains('collapsed') === visible;
        explorer?.classList.toggle('collapsed', !visible);
        explorer?.setAttribute('aria-hidden', String(!visible));
        if (explorerCheck) explorerCheck.checked = visible;
        setPressed(explorerButton, visible);
        if (changed) notifyLayout();
    };

    const setToolbar = (visible: boolean) => {
        const changed = toolbar?.classList.contains('collapsed') === visible;
        toolbar?.classList.toggle('collapsed', !visible);
        toolbar?.setAttribute('aria-hidden', String(!visible));
        if (toolsCheck) toolsCheck.checked = visible;
        if (changed) notifyLayout();
    };

    const setTimeline = (visible: boolean) => {
        const changed = timelineBar?.classList.contains('collapsed') === visible;
        timelineBar?.classList.toggle('collapsed', !visible);
        timelineBar?.setAttribute('aria-hidden', String(!visible));
        if (timelineCheck) timelineCheck.checked = visible;
        if (changed) notifyLayout();
    };

    const syncRightDock = () => {
        const wasVisible = !rightSidebar?.classList.contains('collapsed');
        const wasPropertiesEnabled = !propertiesPanel?.classList.contains('properties-dock-hidden');
        const wasHistoryOpen = !historyPanel?.classList.contains('history-collapsed');
        propertiesPanel?.classList.toggle('properties-dock-hidden', !propertiesEnabled);
        edgePanel?.classList.toggle('properties-dock-hidden', !propertiesEnabled);
        historyPanel?.classList.toggle('history-collapsed', !historyOpen);
        const visible = rightDockVisible({ propertiesEnabled, historyOpen });
        rightSidebar?.classList.toggle('collapsed', !visible);
        rightSidebar?.setAttribute('aria-hidden', String(!visible));
        if (propertiesCheck) propertiesCheck.checked = propertiesEnabled;
        if (historyCheck) historyCheck.checked = historyOpen;
        setPressed(inspectorButton, propertiesEnabled);
        setPressed(historyButton, historyOpen);
        if (wasVisible !== visible || wasPropertiesEnabled !== propertiesEnabled || wasHistoryOpen !== historyOpen) {
            notifyLayout();
        }
    };

    const bind = (element: HTMLElement | null, eventName: string, handler: EventListener) => {
        element?.addEventListener(eventName, handler);
        if (element) cleanups.push(() => element.removeEventListener(eventName, handler));
    };

    bind(optionsButton, 'click', () => {
        dispatchToolState({ type: 'toggle-surface' });
        try {
            view.localStorage.setItem(TOOL_OPTIONS_STORAGE_KEY, String(toolState.open));
        } catch {
            // Keep the in-memory dock state when persistence is unavailable.
        }
    });
    bind(showNamesCheck, 'change', event => {
        const value = (event.target as HTMLInputElement).checked;
        try {
            view.localStorage.setItem(TOOL_NAMES_STORAGE_KEY, String(value));
        } catch {
            // Keep the in-memory preference when persistence is unavailable.
        }
        dispatchToolState({ type: 'set-names-visible', value });
    });
    bind(explorerButton, 'click', () => setExplorer(Boolean(explorer?.classList.contains('collapsed'))));
    bind(inspectorButton, 'click', () => {
        propertiesEnabled = !propertiesEnabled;
        syncRightDock();
    });
    bind(historyButton, 'click', () => {
        historyOpen = !historyOpen;
        syncRightDock();
    });
    bind(toolsCheck, 'change', event => setToolbar((event.target as HTMLInputElement).checked));
    bind(explorerCheck, 'change', event => setExplorer((event.target as HTMLInputElement).checked));
    bind(propertiesCheck, 'change', event => {
        propertiesEnabled = (event.target as HTMLInputElement).checked;
        syncRightDock();
    });
    bind(historyCheck, 'change', event => {
        historyOpen = (event.target as HTMLInputElement).checked;
        syncRightDock();
    });
    bind(timelineCheck, 'change', event => setTimeline((event.target as HTMLInputElement).checked));
    const actionObserver = toolSurface ? new MutationObserver(() => {
        const hasRequiredActions = REQUIRED_ACTION_IDS.some(id => isInlineVisible(root.getElementById(id)));
        if (hasRequiredActions && !toolState.open) dispatchToolState({ type: 'require-actions' });
        else view.requestAnimationFrame(syncToolSurfaceContent);
    }) : null;
    actionObserver?.observe(toolSurface as HTMLElement, {
        attributes: true,
        attributeFilter: ['style'],
        subtree: true
    });
    cleanups.push(() => actionObserver?.disconnect());

    setToolbar(toolsCheck?.checked ?? true);
    setExplorer(explorerCheck?.checked ?? false);
    setTimeline(timelineCheck?.checked ?? true);
    syncRightDock();
    renderToolState();

    return {
        setTool(tool: string) {
            dispatchToolState({ type: 'select-tool', tool });
        },
        syncInspectorSelection(nextHasSelection: boolean) {
            if (nextHasSelection && !hasSelection) propertiesEnabled = true;
            hasSelection = nextHasSelection;
            syncRightDock();
        },
        destroy() {
            cleanups.forEach(cleanup => cleanup());
        }
    };
}
