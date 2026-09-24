export type UiIconName =
    | 'book-open' | 'check' | 'chevron-down' | 'chevron-right' | 'clipboard' | 'coffee' | 'edit'
    | 'download' | 'external-link' | 'eye' | 'eye-off' | 'fast-forward' | 'file'
    | 'file-plus' | 'flag' | 'folder-open' | 'globe' | 'help-circle'
    | 'hexagon' | 'history' | 'image' | 'info' | 'keyboard' | 'link' | 'lock'
    | 'mail' | 'map' | 'maximize' | 'merge' | 'moon' | 'mountain'
    | 'move' | 'mouse-pointer' | 'orbit' | 'palette' | 'pause' | 'pencil'
    | 'play' | 'redo' | 'refresh' | 'rewind' | 'rotate-ccw' | 'save'
    | 'scissors' | 'settings' | 'sun' | 'trash' | 'undo' | 'unlink' | 'unlock'
    | 'upload' | 'volcano' | 'x';

const ICON_PATHS: Record<UiIconName, string> = {
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
    'book-open': '<path d="M3 5.5A3.5 3.5 0 0 1 6.5 2H11v17H6.5A3.5 3.5 0 0 0 3 22Z"/><path d="M21 5.5A3.5 3.5 0 0 0 17.5 2H13v17h4.5A3.5 3.5 0 0 1 21 22Z"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    'chevron-down': '<path d="m7 10 5 5 5-5"/>',
    'chevron-right': '<path d="m10 7 5 5-5 5"/>',
    clipboard: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V2h6v2M9 9h6M9 13h6M9 17h4"/>',
    coffee: '<path d="M4 7h13v7a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4Z"/><path d="M17 9h1.5a2.5 2.5 0 0 1 0 5H17"/><path d="M8 10.2c.8-1 2.2-.5 2.5.4.3-.9 1.7-1.4 2.5-.4 1.1 1.4-.8 2.8-2.5 4-1.7-1.2-3.6-2.6-2.5-4Z"/>',
    download: '<path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 17v4h16v-4"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/>',
    'external-link': '<path d="M15 3h6v6"/><path d="m10 14 11-11"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    eye: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="2.5"/>',
    'eye-off': '<path d="m3 3 18 18"/><path d="M10.6 6.2A9.8 9.8 0 0 1 12 6c6.5 0 10 6 10 6a18 18 0 0 1-2.1 2.8"/><path d="M6.6 6.7C3.7 8.5 2 12 2 12s3.5 6 10 6a9.8 9.8 0 0 0 3.4-.6"/>',
    'fast-forward': '<path d="m13 5 7 7-7 7Z"/><path d="m4 5 7 7-7 7Z"/>',
    file: '<path d="M6 2h8l4 4v16H6Z"/><path d="M14 2v5h5"/><path d="M9 12h6M9 16h6"/>',
    'file-plus': '<path d="M6 2h8l4 4v16H6Z"/><path d="M14 2v5h5"/><path d="M12 11v6M9 14h6"/>',
    flag: '<path d="M5 22V4"/><path d="M5 5h10l-1.5 3L15 11H5"/>',
    'folder-open': '<path d="M3 6h6l2 2h10v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="m3 18 3-7h16l-3 7"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/>',
    'help-circle': '<circle cx="12" cy="12" r="9"/><path d="M9.8 9a2.4 2.4 0 1 1 3.5 2.1c-.9.5-1.3 1-1.3 1.9"/><path d="M12 17h.01"/>',
    hexagon: '<path d="m12 2 9 5v10l-9 5-9-5V7Z"/><path d="m7.5 9 4.5 2.5L16.5 9M12 11.5V17"/>',
    history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="m21 15-5-5L5 20"/>',
    keyboard: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M7 13h10"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.1.1l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1"/><path d="M14 11a5 5 0 0 0-7.1-.1l-2 2A5 5 0 0 0 12 20l1.1-1.1"/>',
    lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    map: '<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3Z"/><path d="M9 3v15M15 6v15"/>',
    maximize: '<path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/>',
    merge: '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="12" r="2"/><path d="M8 5c5 0 3 7 8 7M8 19c5 0 3-7 8-7"/>',
    moon: '<path d="M20.5 14.5A8 8 0 0 1 9.5 3.5 8.5 8.5 0 1 0 20.5 14.5Z"/>',
    mountain: '<path d="m3 20 6-12 4 7 2-4 6 9Z"/>',
    move: '<path d="M12 2v20M2 12h20"/><path d="m8 6 4-4 4 4M8 18l4 4 4-4M6 8l-4 4 4 4M18 8l4 4-4 4"/>',
    'mouse-pointer': '<path d="m5 3 13 9-6 1-3 6Z"/>',
    orbit: '<circle cx="12" cy="12" r="2"/><path d="M5.5 5.5c-2.7 2.7-.8 9 4.2 14s11.3 6.9 14 4.2" transform="scale(.75) translate(4 4)"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(-35 12 12)"/>',
    palette: '<path d="M12 3a9 9 0 0 0 0 18h1.4a1.8 1.8 0 0 0 1.3-3l-.5-.5a1.8 1.8 0 0 1 1.3-3H18a3 3 0 0 0 3-3A9 9 0 0 0 12 3Z"/><circle cx="7.5" cy="10" r=".7"/><circle cx="10" cy="6.8" r=".7"/><circle cx="14" cy="6.8" r=".7"/>',
    pause: '<path d="M8 5v14M16 5v14"/>',
    pencil: '<path d="m4 20 4-1 11-11-3-3L5 16Z"/><path d="m14 6 3 3"/>',
    play: '<path d="m8 5 11 7-11 7Z"/>',
    redo: '<path d="m17 6 4 4-4 4"/><path d="M3 18v-2a6 6 0 0 1 6-6h12"/>',
    refresh: '<path d="M20 7v5h-5"/><path d="M4 17v-5h5"/><path d="M6.1 8a7 7 0 0 1 11.5-2.6L20 8M4 16l2.4 2.6A7 7 0 0 0 17.9 16"/>',
    rewind: '<path d="m11 5-7 7 7 7Z"/><path d="m20 5-7 7 7 7Z"/>',
    'rotate-ccw': '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
    save: '<path d="M5 3h12l3 3v15H4V3Z"/><path d="M8 3v6h8V3M8 21v-7h8v7"/>',
    scissors: '<circle cx="6" cy="7" r="3"/><circle cx="6" cy="17" r="3"/><path d="m8.5 8.5 11 7.5M8.5 15.5 19.5 8"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6"/>',
    undo: '<path d="m7 6-4 4 4 4"/><path d="M21 18v-2a6 6 0 0 0-6-6H3"/>',
    unlink: '<path d="m3 3 18 18M10.5 5.5l1-1a5 5 0 0 1 7.1 7.1l-1 1M6.4 11.4l-1 1a5 5 0 0 0 7.1 7.1l1-1M8 2v2M2 8h2M16 20v2M20 16h2"/>',
    unlock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 7.5-2"/>',
    upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 17v4h16v-4"/>',
    volcano: '<path d="m3 20 6-12 3 5 3-5 6 12Z"/><path d="M10 6c0-2 2-2 2-4M14 6c0-2 2-2 2-4"/>',
    x: '<path d="m6 6 12 12M18 6 6 18"/>'
};

export function uiIcon(name: UiIconName, className = 'ui-icon'): string {
    const safeClassName = className.replace(/[^a-zA-Z0-9_ -]/g, '').trim() || 'ui-icon';
    return `<svg class="${safeClassName}" data-ui-icon="${name}" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[name]}</svg>`;
}
