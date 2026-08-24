import { describe, expect, it } from 'vitest';
import { DEFAULT_TOOL_PREFERENCES, loadToolPreferences, normalizeToolPreferences, saveToolPreferences } from './ToolPreferences';

describe('tool preferences', () => {
    it('normalizes corrupted or unsupported values to safe defaults', () => {
        expect(normalizeToolPreferences({
            navigation: { sensitivity: 99, reverseDrag: 'yes', keepMapReachable: false },
            label: { attachment: 'plate', color: 'red', expanded: true },
            split: { inheritMomentum: false, onlySelected: true }
        })).toEqual({
            navigation: { sensitivity: 1, reverseDrag: false, keepMapReachable: false },
            label: { attachment: 'auto', color: '#fbbf24', expanded: true },
            split: { inheritMomentum: false, onlySelected: true }
        });
    });

    it('round-trips preferences through storage', () => {
        let saved: string | null = null;
        const storage = {
            getItem: () => saved,
            setItem: (_key: string, value: string) => { saved = value; }
        };
        const preferences = {
            ...DEFAULT_TOOL_PREFERENCES,
            navigation: { sensitivity: 1.5, reverseDrag: true, keepMapReachable: true }
        };

        saveToolPreferences(preferences, storage);
        expect(loadToolPreferences(storage)).toEqual(preferences);
    });
});
