import { describe, expect, it } from 'vitest';
import {
    reduceToolSurfaceState,
    rightDockVisible,
    type ToolSurfaceState,
} from './DockController';

const initialState: ToolSurfaceState = {
    activeTool: 'select',
    open: true,
    showToolNames: true
};

describe('tool surface state', () => {
    it('keeps a manually opened dock visible when Move View is selected', () => {
        const result = reduceToolSurfaceState(initialState, {
            type: 'select-tool',
            tool: 'view_pan'
        });

        expect(result).toEqual({
            activeTool: 'view_pan',
            open: true,
            showToolNames: true
        });
    });

    it('tool selection never changes the manually controlled options dock', () => {
        const closed = reduceToolSurfaceState({ ...initialState, open: false }, {
            type: 'select-tool',
            tool: 'draw'
        });
        expect(closed.open).toBe(false);
    });

    it('show tool names changes labels without changing the options dock', () => {
        const hiddenNames = reduceToolSurfaceState(initialState, { type: 'set-names-visible', value: false });
        expect(hiddenNames).toEqual({ ...initialState, showToolNames: false });
    });

    it('allows required apply and cancel actions to open the surface', () => {
        const hidden = { ...initialState, open: false, showToolNames: false };
        expect(reduceToolSurfaceState(hidden, { type: 'require-actions' }).open).toBe(true);
    });

    it('keeps Properties visible when it is enabled even without a selection', () => {
        expect(rightDockVisible({ propertiesEnabled: true, historyOpen: false })).toBe(true);
        expect(rightDockVisible({ propertiesEnabled: false, historyOpen: false })).toBe(false);
        expect(rightDockVisible({ propertiesEnabled: false, historyOpen: true })).toBe(true);
    });
});
