import { describe, expect, it } from 'vitest';
import { createDefaultWorldState } from '../types';
import { getAppHTML } from './AppTemplate';

describe('workspace dock layout', () => {
    it('renders Tool Options as a sibling dock between the toolbar and Explorer', () => {
        const world = createDefaultWorldState();
        const html = getAppHTML({
            globalOptions: world.globalOptions,
            realWorldPresetListHtml: '',
            customPresetListHtml: ''
        });
        const toolbarStart = html.indexOf('id="toolbar"');
        const toolbarEnd = html.indexOf('</aside>', toolbarStart);
        const optionsDock = html.indexOf('id="tool-options-sidebar"');
        const explorerDock = html.indexOf('id="plate-sidebar"');

        expect(toolbarStart).toBeGreaterThan(-1);
        expect(toolbarEnd).toBeGreaterThan(toolbarStart);
        expect(optionsDock).toBeGreaterThan(toolbarEnd);
        expect(explorerDock).toBeGreaterThan(optionsDock);
        expect(html).toContain('id="resizer-tool-options"');
    });
});
