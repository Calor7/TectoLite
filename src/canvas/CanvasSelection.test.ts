import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultAppState } from '../types';
import { dispatchSelection } from './SelectionDispatch';

beforeEach(() => vi.stubGlobal('window', { innerWidth: 1200, innerHeight: 800 }));
afterEach(() => vi.unstubAllGlobals());

describe('canvas selection notifications', () => {
    it('reports the selected plate and edge together without a second UI state update', () => {
        const edge = { plateId: 'plate', polyIndex: 0, vertexIndex: 3 };
        const onSelect = vi.fn();
        dispatchSelection(createDefaultAppState(), { plateId: 'plate', edge }, false, onSelect);
        expect(onSelect).toHaveBeenCalledExactlyOnceWith('plate', null, [], null, edge);
    });

    it('clears a selection in one notification', () => {
        const onSelect = vi.fn();
        dispatchSelection(createDefaultAppState(), null, false, onSelect);
        expect(onSelect).toHaveBeenCalledExactlyOnceWith(null, null);
    });

    it('preserves feature toggling and hotspot selection', () => {
        const state = createDefaultAppState();
        state.world.selectedPlateId = 'plate';
        state.world.selectedFeatureIds = ['first'];
        const onSelect = vi.fn();
        dispatchSelection(state, { featureId: 'second' }, true, onSelect);
        expect(onSelect).toHaveBeenLastCalledWith('plate', null, ['first', 'second']);
        dispatchSelection(state, { featureId: 'first' }, true, onSelect);
        expect(onSelect).toHaveBeenLastCalledWith('plate', null, []);
        dispatchSelection(state, { plumeId: 'hotspot' }, false, onSelect);
        expect(onSelect).toHaveBeenLastCalledWith(null, null, [], 'hotspot');
        expect(state.world.selectedFeatureIds).toEqual(['first']);
    });
});
