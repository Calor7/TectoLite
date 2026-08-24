import { describe, expect, it } from 'vitest';
import { HOTKEYS, renderHotkeyGuide } from './hotkeys';

describe('keyboard guide', () => {
    it('keeps file, tool, timeline, and camera shortcuts discoverable from one source', () => {
        expect(HOTKEYS).toEqual(expect.arrayContaining([
            expect.objectContaining({ keys: 'Ctrl/⌘ + S', action: 'Save project' }),
            expect.objectContaining({ keys: 'F', action: 'Place feature' }),
            expect.objectContaining({ keys: 'Space', action: 'Play or pause' }),
            expect.objectContaining({ keys: 'Shift + 1–9', action: 'Save camera view' }),
        ]));
        const html = renderHotkeyGuide();
        expect(html).toContain('Save project');
        expect(html).toContain('Play or pause');
    });
});
