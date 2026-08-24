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
        };

        applyUiColorPreferences(target, custom);
        expect(values.get('--bg-dark')).toBe('#101820');
        expect(values.get('--motion-unit-color')).toBe('#ffffff');
        expect(values.get('--accent-contrast')).toBe('#ffffff');

        applyUiColorPreferences(target, DEFAULT_UI_COLOR_PREFERENCES);
        expect(values.size).toBe(0);
    });
});
