export interface DockController {
    setTool(tool: string): void;
    syncInspectorSelection(hasSelection: boolean, selectionId?: string): void;
    showToolOptions(): void;
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

const REQUIRED_ACTION_IDS = ['split-controls', 'motion-controls', 'edit-controls', 'link-controls', 'fuse-controls'];
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
    let selectionId: string | undefined;
    const narrow = view.matchMedia('(max-width: 760px)');
    let activeSheet: 'tools' | 'explorer' | 'properties' | 'history' | null = null;
    let explorerEnabled = explorerCheck?.checked ?? false;
    let propertiesEnabled = propertiesCheck?.checked ?? false;
    let historyOpen = historyCheck?.checked ?? false;
    let restorePropertiesAfterOperation = false;
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
            && !element.classList.contains('dock-close')
        );
        const hasVisibleOptions = optionBlocks.some(isInlineVisible);
        if (toolSurfaceEmpty) toolSurfaceEmpty.hidden = hasVisibleOptions;
    };

    const renderToolState = () => {
        const wasOpen = Boolean(toolSurface && !toolSurface.classList.contains('collapsed'));
        toolbar?.classList.toggle('tool-options-open', toolState.open);
        toolbar?.classList.toggle('tool-names-hidden', !toolState.showToolNames);
        if (toolbar) toolbar.dataset.activeTool = toolState.activeTool;
        const visible = toolState.open && (!narrow.matches || activeSheet === 'tools');
        toolSurface?.classList.toggle('collapsed', !visible);
        toolSurface?.classList.toggle('context-open', visible);
        toolSurface?.setAttribute('aria-hidden', String(!visible));
        if (toolSurface) toolSurface.inert = !visible;
        setPressed(optionsButton, visible);
        if (showNamesCheck) showNamesCheck.checked = toolState.showToolNames;
        if (toolSurfaceTitle) toolSurfaceTitle.textContent = `${TOOL_NAMES[toolState.activeTool] ?? 'Tool'} Options`;
        view.requestAnimationFrame(syncToolSurfaceContent);
        if (wasOpen !== toolState.open) notifyLayout();
    };

    const dispatchToolState = (action: ToolSurfaceAction) => {
        toolState = reduceToolSurfaceState(toolState, action);
        if (action.type === 'require-actions' && narrow.matches) activeSheet = 'tools';
        renderToolState();
    };

    const setExplorer = (visible: boolean) => {
        explorerEnabled = visible;
        visible = visible && (!narrow.matches || activeSheet === 'explorer');
        const changed = explorer?.classList.contains('collapsed') === visible;
        explorer?.classList.toggle('collapsed', !visible);
        explorer?.setAttribute('aria-hidden', String(!visible));
        if (explorer) explorer.inert = !visible;
        if (explorerCheck) explorerCheck.checked = visible;
        setPressed(explorerButton, visible);
        if (changed) notifyLayout();
    };

    const setToolbar = (visible: boolean) => {
        const changed = toolbar?.classList.contains('collapsed') === visible;
        toolbar?.classList.toggle('collapsed', !visible);
        toolbar?.setAttribute('aria-hidden', String(!visible));
        if (toolbar) toolbar.inert = !visible;
        if (toolsCheck) toolsCheck.checked = visible;
        if (changed) notifyLayout();
    };

    const setTimeline = (visible: boolean) => {
        const changed = timelineBar?.classList.contains('collapsed') === visible;
        timelineBar?.classList.toggle('collapsed', !visible);
        timelineBar?.setAttribute('aria-hidden', String(!visible));
        if (timelineBar) timelineBar.inert = !visible;
        if (timelineCheck) timelineCheck.checked = visible;
        if (changed) notifyLayout();
    };

    const syncRightDock = () => {
        const wasVisible = !rightSidebar?.classList.contains('collapsed');
        const wasPropertiesEnabled = !propertiesPanel?.classList.contains('properties-dock-hidden');
        const wasHistoryOpen = !historyPanel?.classList.contains('history-collapsed');
        const showProperties = propertiesEnabled && (!narrow.matches || activeSheet === 'properties');
        const showHistory = historyOpen && (!narrow.matches || activeSheet === 'history');
        propertiesPanel?.classList.toggle('properties-dock-hidden', !showProperties);
        edgePanel?.classList.toggle('properties-dock-hidden', !showProperties);
        historyPanel?.classList.toggle('history-collapsed', !showHistory);
        const visible = rightDockVisible({ propertiesEnabled: showProperties, historyOpen: showHistory });
        rightSidebar?.classList.toggle('collapsed', !visible);
        rightSidebar?.setAttribute('aria-hidden', String(!visible));
        if (rightSidebar) rightSidebar.inert = !visible;
        if (propertiesCheck) propertiesCheck.checked = propertiesEnabled;
        if (historyCheck) historyCheck.checked = historyOpen;
        setPressed(inspectorButton, showProperties);
        setPressed(historyButton, showHistory);
        if (wasVisible !== visible || wasPropertiesEnabled !== propertiesEnabled || wasHistoryOpen !== historyOpen) {
            notifyLayout();
        }
    };

    const bind = (element: HTMLElement | null, eventName: string, handler: EventListener) => {
        element?.addEventListener(eventName, handler);
        if (element) cleanups.push(() => element.removeEventListener(eventName, handler));
    };

    const refresh = () => { renderToolState(); setExplorer(explorerEnabled); syncRightDock(); };
    const activate = (sheet: typeof activeSheet) => {
        if (!narrow.matches) return;
        activeSheet = sheet;
        refresh();
    };
    for (const [panel, label] of [[toolSurface, 'tool options'], [explorer, 'Explorer'], [rightSidebar, 'Inspector or history']] as const) {
        if (!panel) continue;
        const close = root.createElement('button');
        close.type = 'button'; close.className = 'dock-close btn btn-secondary';
        close.textContent = 'Close'; close.setAttribute('aria-label', `Close ${label} panel`);
        bind(close, 'click', () => { activate(null); (panel === toolSurface ? optionsButton : panel === explorer ? explorerButton : inspectorButton)?.focus(); });
        panel.prepend(close);
    }
    const resize = () => {
        if (narrow.matches) activeSheet = propertiesEnabled ? 'properties' : historyOpen ? 'history' : explorerEnabled ? 'explorer' : toolState.open ? 'tools' : null;
        refresh();
    };
    narrow.addEventListener('change', resize);
    cleanups.push(() => narrow.removeEventListener('change', resize));
    const revealActiveTool = () => {
        if (narrow.matches) view.requestAnimationFrame(() => root.querySelector<HTMLElement>('.tool-btn.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
    };
    view.addEventListener('resize', revealActiveTool);
    cleanups.push(() => view.removeEventListener('resize', revealActiveTool));

    bind(optionsButton, 'click', () => {
        if (narrow.matches) {
            const open = activeSheet !== 'tools';
            toolState.open = open;
            activate(open ? 'tools' : null);
            return;
        }
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
    bind(explorerButton, 'click', () => {
        const visible = Boolean(explorer?.classList.contains('collapsed'));
        if (narrow.matches) activeSheet = visible ? 'explorer' : null;
        setExplorer(visible); refresh();
    });
    bind(inspectorButton, 'click', () => {
        restorePropertiesAfterOperation = false;
        propertiesEnabled = narrow.matches ? activeSheet !== 'properties' : !propertiesEnabled;
        if (narrow.matches) activeSheet = propertiesEnabled ? 'properties' : null;
        refresh();
    });
    bind(historyButton, 'click', () => {
        historyOpen = narrow.matches ? activeSheet !== 'history' : !historyOpen;
        if (narrow.matches) activeSheet = historyOpen ? 'history' : null;
        refresh();
    });
    bind(toolsCheck, 'change', event => setToolbar((event.target as HTMLInputElement).checked));
    bind(explorerCheck, 'change', event => { const visible = (event.target as HTMLInputElement).checked; if (narrow.matches) activeSheet = visible ? 'explorer' : null; setExplorer(visible); refresh(); });
    bind(propertiesCheck, 'change', event => {
        restorePropertiesAfterOperation = false;
        propertiesEnabled = (event.target as HTMLInputElement).checked;
        if (narrow.matches) activeSheet = propertiesEnabled ? 'properties' : null;
        refresh();
    });
    bind(historyCheck, 'change', event => {
        historyOpen = (event.target as HTMLInputElement).checked;
        if (narrow.matches) activeSheet = historyOpen ? 'history' : null;
        refresh();
    });
    bind(timelineCheck, 'change', event => setTimeline((event.target as HTMLInputElement).checked));
    const actionObserver = toolSurface ? new MutationObserver(() => {
        const hasRequiredActions = REQUIRED_ACTION_IDS.some(id => isInlineVisible(root.getElementById(id)));
        if (hasRequiredActions && !toolState.open) { dispatchToolState({ type: 'require-actions' }); refresh(); }
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
    resize();

    return {
        setTool(tool: string) {
            const wasOperation = toolState.activeTool === 'link' || toolState.activeTool === 'fuse';
            const isOperation = tool === 'link' || tool === 'fuse';
            if (!wasOperation && isOperation) {
                restorePropertiesAfterOperation = propertiesEnabled;
                propertiesEnabled = false;
                if (narrow.matches && activeSheet === 'properties') activeSheet = 'tools';
            } else if (wasOperation && !isOperation) {
                if (restorePropertiesAfterOperation) propertiesEnabled = true;
                restorePropertiesAfterOperation = false;
            }
            dispatchToolState({ type: 'select-tool', tool });
            if (isOperation) dispatchToolState({ type: 'require-actions' });
            syncRightDock();
            if (narrow.matches) root.querySelector<HTMLElement>(`.tool-btn[data-tool="${tool}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        },
        showToolOptions() {
            toolState.open = true;
            if (narrow.matches) activeSheet = 'tools';
            refresh();
        },
        syncInspectorSelection(nextHasSelection: boolean, nextId?: string) {
            if (nextHasSelection && (!hasSelection || nextId !== selectionId)
                && toolState.activeTool !== 'link' && toolState.activeTool !== 'fuse') {
                propertiesEnabled = true;
                if (narrow.matches) activeSheet = 'properties';
            }
            hasSelection = nextHasSelection;
            selectionId = nextId;
            refresh();
        },
        destroy() {
            cleanups.forEach(cleanup => cleanup());
        }
    };
}
