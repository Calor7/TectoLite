import { describe, expect, it } from 'vitest';
import {
    applyUiColorPreferences,
    DEFAULT_UI_COLOR_PREFERENCES,
    getUiColorVariables,
    loadUiColorPreferences,
    saveUiColorPreferences,
    type UiColorPreferences,
} from './UiColorPreferences';

function memoryStorage(initial?: string) {
    let value = initial ?? null;
    return {
        getItem: () => value,
        setItem: (_key: string, next: string) => { value = next; },
        value: () => value,
    };
}

describe('UI color preferences', () => {
    it('uses built-in theme colors by default', () => {
        expect(loadUiColorPreferences(memoryStorage())).toEqual(DEFAULT_UI_COLOR_PREFERENCES);
        expect(getUiColorVariables(DEFAULT_UI_COLOR_PREFERENCES)).toEqual({});
    });

    it('round-trips saved custom colors', () => {
        const storage = memoryStorage();
        const preferences: UiColorPreferences = {
            useDefaults: false,
            colors: {
                background: '#101820',
                surface: '#203040',
                controls: '#304050',
                text: '#ffffff',
                accent: '#26c6da',
            },
            canvasMotion: {
                normalColor: '#f8f8f8',
                useSpeedGradient: true,
                highSpeedColor: '#ff2244',
                normalSpeedMaxCmYr: 12,
                highSpeedCmYr: 28,
                outlineFullSpeedCmYr: 33,
            },
        };

        saveUiColorPreferences(storage, preferences);
        expect(loadUiColorPreferences(storage)).toEqual(preferences);
        expect(getUiColorVariables(preferences)).toMatchObject({
            '--bg-dark': '#101820',
            '--bg-surface': '#203040',
            '--bg-elevated': '#304050',
            '--text-primary': '#ffffff',
            '--accent-primary': '#26c6da',
        });
    });

    it('rejects malformed saved colors instead of injecting CSS values', () => {
        const storage = memoryStorage(JSON.stringify({
            useDefaults: false,
            colors: { background: 'red; display:none' },
        }));

        expect(loadUiColorPreferences(storage)).toEqual(DEFAULT_UI_COLOR_PREFERENCES);
    });

    it('applies custom variables and clears them when defaults take precedence', () => {
        const values = new Map<string, string>();
        const target = {
            style: {
                setProperty: (name: string, value: string) => values.set(name, value),
                removeProperty: (name: string) => values.delete(name),
            },
        } as unknown as HTMLElement;
        const custom: UiColorPreferences = {
            useDefaults: false,
            colors: {
                background: '#101820',
                surface: '#203040',
                controls: '#304050',
                text: '#ffffff',
                accent: '#263238',
            },
            canvasMotion: DEFAULT_UI_COLOR_PREFERENCES.canvasMotion,
        };

        applyUiColorPreferences(target, custom);
        expect(values.get('--bg-dark')).toBe('#101820');
        expect(values.get('--motion-unit-color')).toBe('#ffffff');
        expect(values.get('--accent-contrast')).toBe('#ffffff');

        applyUiColorPreferences(target, DEFAULT_UI_COLOR_PREFERENCES);
        expect(values.size).toBe(0);
    });

    it('adds default canvas-label settings when loading an older saved palette', () => {
        const storage = memoryStorage(JSON.stringify({
            useDefaults: false,
            colors: {
                background: '#101820',
                surface: '#203040',
                controls: '#304050',
                text: '#ffffff',
                accent: '#26c6da',
            },
        }));

        expect(loadUiColorPreferences(storage).canvasMotion).toEqual(
            DEFAULT_UI_COLOR_PREFERENCES.canvasMotion
        );
    });

    it('rejects malformed canvas-label colors and speed ranges', () => {
        const base = {
            useDefaults: false,
            colors: { ...DEFAULT_UI_COLOR_PREFERENCES.colors },
            canvasMotion: { ...DEFAULT_UI_COLOR_PREFERENCES.canvasMotion },
        };
        const invalidCanvasSettings = [
            { ...base.canvasMotion, normalColor: 'white' },
            { ...base.canvasMotion, highSpeedColor: 'rgb(255, 0, 0)' },
            { ...base.canvasMotion, useSpeedGradient: 'yes' },
            { ...base.canvasMotion, normalSpeedMaxCmYr: -1 },
            { ...base.canvasMotion, highSpeedCmYr: base.canvasMotion.normalSpeedMaxCmYr },
            { ...base.canvasMotion, highSpeedCmYr: 1001 },
            { ...base.canvasMotion, outlineFullSpeedCmYr: base.canvasMotion.highSpeedCmYr },
            { ...base.canvasMotion, outlineFullSpeedCmYr: 1001 },
        ];

        for (const canvasMotion of invalidCanvasSettings) {
            const storage = memoryStorage(JSON.stringify({ ...base, canvasMotion }));
            expect(loadUiColorPreferences(storage)).toEqual(DEFAULT_UI_COLOR_PREFERENCES);
        }
    });
});
