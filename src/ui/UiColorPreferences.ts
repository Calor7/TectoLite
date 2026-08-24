export interface UiColors {
    background: string;
    surface: string;
    controls: string;
    text: string;
    accent: string;
}

export interface UiColorPreferences {
    useDefaults: boolean;
    colors: UiColors;
}

export interface UiColorStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}

const STORAGE_KEY = 'tectolite-ui-colors-v1';
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export const DEFAULT_UI_COLOR_PREFERENCES: UiColorPreferences = {
    useDefaults: true,
    colors: {
        background: '#13171f',
        surface: '#1f303e',
        controls: '#252f3e',
        text: '#eff6fb',
        accent: '#00bde3',
    },
};

const COLOR_INPUT_IDS: Record<keyof UiColors, string> = {
    background: 'ui-color-background',
    surface: 'ui-color-surface',
    controls: 'ui-color-controls',
    text: 'ui-color-text',
    accent: 'ui-color-accent',
};

function cloneDefaults(): UiColorPreferences {
    return {
        useDefaults: DEFAULT_UI_COLOR_PREFERENCES.useDefaults,
        colors: { ...DEFAULT_UI_COLOR_PREFERENCES.colors },
    };
}

function normalizePreferences(value: unknown): UiColorPreferences | null {
    if (!value || typeof value !== 'object') return null;
    const candidate = value as Partial<UiColorPreferences>;
    if (typeof candidate.useDefaults !== 'boolean' || !candidate.colors || typeof candidate.colors !== 'object') {
        return null;
    }

    const colors = candidate.colors as Partial<UiColors>;
    const entries = Object.keys(COLOR_INPUT_IDS) as Array<keyof UiColors>;
    if (entries.some(key => typeof colors[key] !== 'string' || !HEX_COLOR.test(colors[key]))) return null;

    return {
        useDefaults: candidate.useDefaults,
        colors: Object.fromEntries(entries.map(key => [key, colors[key]!.toLowerCase()])) as unknown as UiColors,
    };
}

export function loadUiColorPreferences(storage: Pick<UiColorStorage, 'getItem'>): UiColorPreferences {
    try {
        const raw = storage.getItem(STORAGE_KEY);
        if (!raw) return cloneDefaults();
        return normalizePreferences(JSON.parse(raw)) ?? cloneDefaults();
    } catch {
        return cloneDefaults();
    }
}

export function saveUiColorPreferences(
    storage: Pick<UiColorStorage, 'setItem'>,
    preferences: UiColorPreferences
): void {
    const normalized = normalizePreferences(preferences);
    if (!normalized) return;
    try {
        storage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    } catch {
        // Keep the live appearance when storage is unavailable.
    }
}

function contrastColor(hex: string): string {
    const rgb = [1, 3, 5].map(index => Number.parseInt(hex.slice(index, index + 2), 16) / 255);
    const luminance = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
    return luminance > 0.58 ? '#11181d' : '#ffffff';
}

export function getUiColorVariables(preferences: UiColorPreferences): Record<string, string> {
    if (preferences.useDefaults) return {};
    const { background, surface, controls, text, accent } = preferences.colors;
    return {
        '--bg-dark': background,
        '--bg-surface': surface,
        '--bg-secondary': surface,
        '--bg-elevated': controls,
        '--bg-tertiary': controls,
        '--bg-hover': `color-mix(in srgb, ${accent} 24%, ${controls})`,
        '--text-primary': text,
        '--text-secondary': text,
        '--text-muted': `color-mix(in srgb, ${text} 72%, ${background})`,
        '--accent-primary': accent,
        '--accent-contrast': contrastColor(accent),
        '--color-primary': accent,
        '--border-default': `color-mix(in srgb, ${accent} 34%, ${surface})`,
        '--border-muted': `color-mix(in srgb, ${text} 16%, ${controls})`,
        '--timeline-bg': surface,
        '--timeline-control-bg': controls,
        '--motion-unit-color': text,
    };
}

export function applyUiColorPreferences(target: HTMLElement, preferences: UiColorPreferences): void {
    const customVariables = getUiColorVariables(preferences);
    const allVariables = getUiColorVariables({ ...cloneDefaults(), useDefaults: false });
    Object.keys(allVariables).forEach(name => target.style.removeProperty(name));
    Object.entries(customVariables).forEach(([name, value]) => target.style.setProperty(name, value));
}

export function bindUiColorPreferences(
    root: Document = document,
    storage: UiColorStorage = localStorage,
    onApplied: () => void = () => undefined
): { destroy(): void } {
    const defaultCheck = root.getElementById('check-use-default-ui-colors') as HTMLInputElement | null;
    const customFields = root.getElementById('ui-color-custom-fields') as HTMLFieldSetElement | null;
    const target = root.body;
    const cleanups: Array<() => void> = [];
    let preferences = loadUiColorPreferences(storage);

    const inputs = Object.fromEntries(
        (Object.keys(COLOR_INPUT_IDS) as Array<keyof UiColors>).map(key => [
            key,
            root.getElementById(COLOR_INPUT_IDS[key]) as HTMLInputElement | null,
        ])
    ) as Record<keyof UiColors, HTMLInputElement | null>;

    const render = () => {
        if (defaultCheck) defaultCheck.checked = preferences.useDefaults;
        if (customFields) customFields.disabled = preferences.useDefaults;
        (Object.keys(inputs) as Array<keyof UiColors>).forEach(key => {
            if (inputs[key]) inputs[key]!.value = preferences.colors[key];
        });
        applyUiColorPreferences(target, preferences);
        onApplied();
    };

    const bind = (element: HTMLElement | null, event: string, listener: EventListener) => {
        element?.addEventListener(event, listener);
        if (element) cleanups.push(() => element.removeEventListener(event, listener));
    };

    bind(defaultCheck, 'change', event => {
        preferences = {
            ...preferences,
            useDefaults: (event.target as HTMLInputElement).checked,
        };
        saveUiColorPreferences(storage, preferences);
        render();
    });

    (Object.keys(inputs) as Array<keyof UiColors>).forEach(key => {
        bind(inputs[key], 'input', event => {
            const value = (event.target as HTMLInputElement).value.toLowerCase();
            if (!HEX_COLOR.test(value)) return;
            preferences = {
                useDefaults: false,
                colors: { ...preferences.colors, [key]: value },
            };
            saveUiColorPreferences(storage, preferences);
            render();
        });
    });

    render();
    return {
        destroy() {
            cleanups.forEach(cleanup => cleanup());
        },
    };
}
