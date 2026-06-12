import { describe, it, expect } from 'vitest';
import { HistoryManager } from './HistoryManager';
import { AppState } from './types';

/** Minimal stand-in state; HistoryManager only clones and stores it. */
function makeState(marker: number): AppState {
    return {
        world: { plates: [], currentTime: marker },
        viewport: { scale: 250, rotate: [0, 0, 0] },
    } as unknown as AppState;
}

const timeOf = (s: AppState | null): number | undefined => s?.world.currentTime;

describe('HistoryManager', () => {
    it('starts with nothing to undo or redo', () => {
        const h = new HistoryManager();
        expect(h.canUndo()).toBe(false);
        expect(h.canRedo()).toBe(false);
        expect(h.undo(makeState(0))).toBeNull();
        expect(h.redo(makeState(0))).toBeNull();
    });

    it('undo returns the previously pushed state', () => {
        const h = new HistoryManager();
        h.push(makeState(1));
        const restored = h.undo(makeState(2));
        expect(timeOf(restored)).toBe(1);
        expect(h.canUndo()).toBe(false);
        expect(h.canRedo()).toBe(true);
    });

    it('redo returns the state that was current before undo', () => {
        const h = new HistoryManager();
        h.push(makeState(1));
        const afterUndo = h.undo(makeState(2));
        const afterRedo = h.redo(afterUndo!);
        expect(timeOf(afterRedo)).toBe(2);
        expect(h.canUndo()).toBe(true);
        expect(h.canRedo()).toBe(false);
    });

    it('pushing a new state clears the redo stack', () => {
        const h = new HistoryManager();
        h.push(makeState(1));
        h.undo(makeState(2));
        expect(h.canRedo()).toBe(true);
        h.push(makeState(3));
        expect(h.canRedo()).toBe(false);
    });

    it('stores a deep clone — later mutation of the original does not leak in', () => {
        const h = new HistoryManager();
        const original = makeState(1);
        h.push(original);
        (original.world as { currentTime: number }).currentTime = 999;
        const restored = h.undo(makeState(2));
        expect(timeOf(restored)).toBe(1);
    });

    it('caps history at 50 entries, dropping the oldest', () => {
        const h = new HistoryManager();
        for (let i = 0; i < 55; i++) h.push(makeState(i));
        // Unwind everything: the oldest restorable state should be 5 (0..4 dropped)
        let last: AppState | null = makeState(999);
        let count = 0;
        while (h.canUndo()) {
            last = h.undo(last!);
            count++;
        }
        expect(count).toBe(50);
        expect(timeOf(last)).toBe(5);
    });

    it('clear empties both stacks', () => {
        const h = new HistoryManager();
        h.push(makeState(1));
        h.undo(makeState(2));
        h.clear();
        expect(h.canUndo()).toBe(false);
        expect(h.canRedo()).toBe(false);
    });
});
