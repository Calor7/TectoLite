export interface HotkeyDefinition {
    keys: string;
    action: string;
    group: 'Project' | 'Tools' | 'Timeline' | 'Camera' | 'Editing';
}

export const HOTKEYS: readonly HotkeyDefinition[] = [
    { keys: 'Ctrl/⌘ + S', action: 'Save project', group: 'Project' },
    { keys: 'Ctrl/⌘ + O', action: 'Load project', group: 'Project' },
    { keys: 'Ctrl/⌘ + Z', action: 'Undo', group: 'Editing' },
    { keys: 'Ctrl/⌘ + Y', action: 'Redo', group: 'Editing' },
    { keys: 'Ctrl/⌘ + D', action: 'Duplicate selected plate', group: 'Editing' },
    { keys: 'V', action: 'Select', group: 'Tools' },
    { keys: 'H', action: 'Rotate view', group: 'Tools' },
    { keys: 'P', action: 'Move view', group: 'Tools' },
    { keys: 'D', action: 'Draw / cycle draw mode', group: 'Tools' },
    { keys: 'E', action: 'Edit geometry', group: 'Tools' },
    { keys: 'F', action: 'Place feature', group: 'Tools' },
    { keys: 'A', action: 'Place label', group: 'Tools' },
    { keys: 'S', action: 'Split', group: 'Tools' },
    { keys: 'L', action: 'Link', group: 'Tools' },
    { keys: 'G', action: 'Fuse', group: 'Tools' },
    { keys: 'Enter', action: 'Finish current path', group: 'Tools' },
    { keys: 'Space', action: 'Play or pause', group: 'Timeline' },
    { keys: '← / →', action: 'Step 1 Ma', group: 'Timeline' },
    { keys: 'Shift + ← / →', action: 'Step 10 Ma', group: 'Timeline' },
    { keys: '1–9', action: 'Recall camera view', group: 'Camera' },
    { keys: 'Shift + 1–9', action: 'Save camera view', group: 'Camera' },
    { keys: '?', action: 'Show this keyboard guide', group: 'Project' },
] as const;

export function renderHotkeyGuide(): string {
    const groups: HotkeyDefinition['group'][] = ['Project', 'Tools', 'Timeline', 'Camera', 'Editing'];
    return groups.map(group => `
        <section class="hotkey-group">
            <h4>${group}</h4>
            ${HOTKEYS.filter(item => item.group === group).map(item => `
                <div class="hotkey-row"><kbd>${item.keys}</kbd><span>${item.action}</span></div>
            `).join('')}
        </section>
    `).join('');
}
