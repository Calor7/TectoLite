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

    it('isolates mutable owner objects from later mutation', () => {
        const h = new HistoryManager();
        const original = makeState(1);
        h.push(original);
        (original.world as { currentTime: number }).currentTime = 999;
        const restored = h.undo(makeState(2));
        expect(timeOf(restored)).toBe(1);
    });

    it('clones plate and motion metadata while sharing heavy geometry points', () => {
        const h = new HistoryManager();
        const points = [[0, 0], [1, 0], [1, 1]];
        const plate = {
            id: 'p1',
            name: 'Original',
            color: '#fff',
            motionSegments: [{ time: 0, eulerPole: { position: [0, 90], rate: 1 } }],
            geometryStages: [{ time: 0, polygons: [{ id: 'poly1', points, closed: true }], features: [] }],
            polygons: [{ id: 'poly1', points, closed: true }],
            features: [],
            center: [0, 0],
            birthTime: 0,
            deathTime: null,
            initialPolygons: [{ id: 'poly1', points, closed: true }],
            initialFeatures: [],
            connectedRiftIds: [],
            events: [],
            visible: true,
            locked: false
        };
        const base = makeState(1);
        const state = {
            ...base,
            world: {
                ...base.world,
                plates: [plate]
            }
        } as unknown as AppState;

        h.push(state);
        plate.name = 'Mutated';
        plate.motionSegments[0].eulerPole.rate = 9;
        const restored = h.undo(makeState(2))!;
        const restoredPlate = restored.world.plates[0] as any;

        expect(restoredPlate.name).toBe('Original');
        expect(restoredPlate.motionSegments[0].eulerPole.rate).toBe(1);
        expect(restoredPlate.polygons[0].points).toBe(points);
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
