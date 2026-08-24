import { DEFAULT_MOTION_LABEL_OPTIONS, type MotionLabelOptions } from '../canvas/MotionGizmo';

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
    canvasMotion: MotionLabelOptions;
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
    canvasMotion: { ...DEFAULT_MOTION_LABEL_OPTIONS },
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
        canvasMotion: { ...DEFAULT_UI_COLOR_PREFERENCES.canvasMotion },
    };
}

function normalizeCanvasMotion(value: unknown): MotionLabelOptions | null {
    if (value === undefined) return { ...DEFAULT_MOTION_LABEL_OPTIONS };
    if (!value || typeof value !== 'object') return null;
    const candidate = value as Partial<MotionLabelOptions>;
    const validColors = typeof candidate.normalColor === 'string'
        && HEX_COLOR.test(candidate.normalColor)
        && typeof candidate.highSpeedColor === 'string'
        && HEX_COLOR.test(candidate.highSpeedColor);
    const usesKnownLegacyDefaults = candidate.outlineStartSpeedCmYr === undefined
        && ((candidate.normalSpeedMaxCmYr === 18
            && candidate.highSpeedCmYr === 20
            && candidate.outlineFullSpeedCmYr === 25)
            || (candidate.normalSpeedMaxCmYr === 6
                && candidate.highSpeedCmYr === 15
                && candidate.outlineFullSpeedCmYr === 20));
    if (validColors && typeof candidate.useSpeedGradient === 'boolean' && usesKnownLegacyDefaults) {
        return {
            ...DEFAULT_MOTION_LABEL_OPTIONS,
            normalColor: candidate.normalColor!.toLowerCase(),
            useSpeedGradient: candidate.useSpeedGradient,
            highSpeedColor: candidate.highSpeedColor!.toLowerCase(),
        };
    }
    const outlineFullSpeedCmYr = candidate.outlineFullSpeedCmYr
        ?? (typeof candidate.highSpeedCmYr === 'number' ? candidate.highSpeedCmYr + 5 : undefined);
    const outlineStartSpeedCmYr = candidate.outlineStartSpeedCmYr
        ?? candidate.highSpeedCmYr;
    const validSpeeds = typeof candidate.normalSpeedMaxCmYr === 'number'
        && Number.isFinite(candidate.normalSpeedMaxCmYr)
        && candidate.normalSpeedMaxCmYr >= 0
        && typeof candidate.highSpeedCmYr === 'number'
        && Number.isFinite(candidate.highSpeedCmYr)
        && candidate.highSpeedCmYr > candidate.normalSpeedMaxCmYr
        && candidate.highSpeedCmYr <= 1000
        && typeof outlineFullSpeedCmYr === 'number'
        && Number.isFinite(outlineFullSpeedCmYr)
        && typeof outlineStartSpeedCmYr === 'number'
        && Number.isFinite(outlineStartSpeedCmYr)
        && outlineStartSpeedCmYr >= candidate.highSpeedCmYr
        && outlineStartSpeedCmYr < outlineFullSpeedCmYr
        && outlineFullSpeedCmYr <= 1000;
    if (!validColors || typeof candidate.useSpeedGradient !== 'boolean' || !validSpeeds) return null;
    return {
        normalColor: candidate.normalColor!.toLowerCase(),
        useSpeedGradient: candidate.useSpeedGradient,
        highSpeedColor: candidate.highSpeedColor!.toLowerCase(),
        normalSpeedMaxCmYr: candidate.normalSpeedMaxCmYr!,
        highSpeedCmYr: candidate.highSpeedCmYr!,
        outlineStartSpeedCmYr: outlineStartSpeedCmYr!,
        outlineFullSpeedCmYr: outlineFullSpeedCmYr!,
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
    const canvasMotion = normalizeCanvasMotion(candidate.canvasMotion);
    if (!canvasMotion) return null;

    return {
        useDefaults: candidate.useDefaults,
        colors: Object.fromEntries(entries.map(key => [key, colors[key]!.toLowerCase()])) as unknown as UiColors,
        canvasMotion,
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
    onApplied: (preferences: UiColorPreferences) => void = () => undefined
): { destroy(): void } {
    const defaultCheck = root.getElementById('check-use-default-ui-colors') as HTMLInputElement | null;
    const customFields = root.getElementById('ui-color-custom-fields') as HTMLFieldSetElement | null;
    const canvasNormalColor = root.getElementById('canvas-motion-normal-color') as HTMLInputElement | null;
    const canvasGradientCheck = root.getElementById('check-canvas-motion-speed-gradient') as HTMLInputElement | null;
    const canvasGradientFields = root.getElementById('canvas-motion-gradient-fields') as HTMLFieldSetElement | null;
    const canvasHighSpeedColor = root.getElementById('canvas-motion-high-speed-color') as HTMLInputElement | null;
    const canvasNormalSpeedMax = root.getElementById('canvas-motion-normal-speed-max') as HTMLInputElement | null;
    const canvasHighSpeed = root.getElementById('canvas-motion-high-speed') as HTMLInputElement | null;
    const canvasOutlineStartSpeed = root.getElementById('canvas-motion-outline-start-speed') as HTMLInputElement | null;
    const canvasOutlineFullSpeed = root.getElementById('canvas-motion-outline-full-speed') as HTMLInputElement | null;
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
        if (canvasNormalColor) canvasNormalColor.value = preferences.canvasMotion.normalColor;
        if (canvasGradientCheck) canvasGradientCheck.checked = preferences.canvasMotion.useSpeedGradient;
        if (canvasGradientFields) canvasGradientFields.disabled = !preferences.canvasMotion.useSpeedGradient;
        if (canvasHighSpeedColor) canvasHighSpeedColor.value = preferences.canvasMotion.highSpeedColor;
        if (canvasNormalSpeedMax) canvasNormalSpeedMax.value = String(preferences.canvasMotion.normalSpeedMaxCmYr);
        if (canvasHighSpeed) canvasHighSpeed.value = String(preferences.canvasMotion.highSpeedCmYr);
        if (canvasOutlineStartSpeed) canvasOutlineStartSpeed.value = String(preferences.canvasMotion.outlineStartSpeedCmYr);
        if (canvasOutlineFullSpeed) canvasOutlineFullSpeed.value = String(preferences.canvasMotion.outlineFullSpeedCmYr);
        (Object.keys(inputs) as Array<keyof UiColors>).forEach(key => {
            if (inputs[key]) inputs[key]!.value = preferences.colors[key];
        });
        applyUiColorPreferences(target, preferences);
        onApplied(preferences);
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
                canvasMotion: preferences.canvasMotion,
            };
            saveUiColorPreferences(storage, preferences);
            render();
        });
    });

    const updateCanvasMotion = (patch: Partial<MotionLabelOptions>, restoreInvalid = true): boolean => {
        const normalized = normalizePreferences({
            ...preferences,
            canvasMotion: { ...preferences.canvasMotion, ...patch },
        });
        if (!normalized) {
            if (restoreInvalid) render();
            return false;
        }
        preferences = normalized;
        saveUiColorPreferences(storage, preferences);
        render();
        return true;
    };

    bind(canvasNormalColor, 'input', event => {
        updateCanvasMotion({ normalColor: (event.target as HTMLInputElement).value.toLowerCase() });
    });
    bind(canvasGradientCheck, 'change', event => {
        updateCanvasMotion({ useSpeedGradient: (event.target as HTMLInputElement).checked });
    });
    bind(canvasHighSpeedColor, 'input', event => {
        updateCanvasMotion({ highSpeedColor: (event.target as HTMLInputElement).value.toLowerCase() });
    });
    const updateCanvasMotionSpeeds = (restoreInvalid: boolean) => updateCanvasMotion({
        normalSpeedMaxCmYr: Number(canvasNormalSpeedMax?.value),
        highSpeedCmYr: Number(canvasHighSpeed?.value),
        outlineStartSpeedCmYr: Number(canvasOutlineStartSpeed?.value),
        outlineFullSpeedCmYr: Number(canvasOutlineFullSpeed?.value),
    }, restoreInvalid);
    bind(canvasNormalSpeedMax, 'input', () => { updateCanvasMotionSpeeds(false); });
    bind(canvasHighSpeed, 'input', () => { updateCanvasMotionSpeeds(false); });
    bind(canvasOutlineStartSpeed, 'input', () => { updateCanvasMotionSpeeds(false); });
    bind(canvasOutlineFullSpeed, 'input', () => { updateCanvasMotionSpeeds(false); });
    bind(canvasNormalSpeedMax, 'change', () => { updateCanvasMotionSpeeds(true); });
    bind(canvasHighSpeed, 'change', () => { updateCanvasMotionSpeeds(true); });
    bind(canvasOutlineStartSpeed, 'change', () => { updateCanvasMotionSpeeds(true); });
    bind(canvasOutlineFullSpeed, 'change', () => { updateCanvasMotionSpeeds(true); });

    render();
    return {
        destroy() {
            cleanups.forEach(cleanup => cleanup());
        },
    };
}
