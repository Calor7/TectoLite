import { describe, expect, it } from 'vitest';
import { HINT_MINIMIZED_STORAGE_KEY, hintView, loadHintMinimized, saveHintMinimized } from './CanvasHint';

function memoryStorage(initial: Record<string, string> = {}) {
    const values = new Map(Object.entries(initial));
    return {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => { values.set(key, value); },
    };
}

describe('canvas hint', () => {
    it('shows the full hint with a minimize button by default', () => {
        expect(hintView('Drag vertices to move.', true, false)).toEqual({
            visible: true,
            minimized: false,
            buttonLabel: 'Minimize hint',
            buttonTitle: 'Minimize hint',
        });
    });

    it('keeps a minimized hint available and previews its text on hover', () => {
        expect(hintView('Drag vertices to move.', true, true)).toEqual({
            visible: true,
            minimized: true,
            buttonLabel: 'Show hint',
            buttonTitle: 'Drag vertices to move.',
        });
    });

    it('hides when hints are turned off or there is nothing to say', () => {
        expect(hintView('Drag vertices to move.', false, false).visible).toBe(false);
        expect(hintView(null, true, true).visible).toBe(false);
        expect(hintView('', true, false).visible).toBe(false);
    });

    it('remembers the minimized choice', () => {
        const storage = memoryStorage();
        expect(loadHintMinimized(storage)).toBe(false);
        saveHintMinimized(true, storage);
        expect(storage.getItem(HINT_MINIMIZED_STORAGE_KEY)).toBe('true');
        expect(loadHintMinimized(storage)).toBe(true);
        saveHintMinimized(false, storage);
        expect(loadHintMinimized(storage)).toBe(false);
    });

    it('falls back to an expanded hint when storage is unavailable', () => {
        const broken = {
            getItem: () => { throw new Error('blocked'); },
            setItem: () => { throw new Error('blocked'); },
        };
        expect(loadHintMinimized(broken)).toBe(false);
        expect(() => saveHintMinimized(true, broken)).not.toThrow();
        expect(loadHintMinimized(null)).toBe(false);
    });
});
