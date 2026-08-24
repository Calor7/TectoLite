import { describe, expect, it } from 'vitest';
import { createDefaultWorldState } from './types';
import { getAppHTML } from './ui/AppTemplate';

describe('contextual tool panels', () => {
    it('renders navigation, label, split, link, and fusion controls', () => {
        const world = createDefaultWorldState();
        const html = getAppHTML({
            globalOptions: world.globalOptions,
            realWorldPresetListHtml: '',
            customPresetListHtml: ''
        });

        expect(html).toContain('id="navigation-controls"');
        expect(html).toContain('id="label-tool-controls"');
        expect(html).toContain('id="split-controls"');
        expect(html).toContain('id="link-controls"');
        expect(html).toContain('id="fuse-controls"');
        expect(html).toContain('id="check-navigation-reachable"');
        expect(html).toContain('id="fuse-result-name"');
        expect(html).toContain('id="check-show-tool-names" checked');
        expect(html).toContain('<span>Show tool names</span>');
        expect(html).not.toContain('Show tool actions');
        expect(html).toContain('class="motion-unit">cm/yr</span>');
        expect(html).toContain('id="check-use-default-ui-colors" checked');
        expect(html).toContain('id="ui-color-background"');
        expect(html).toContain('id="ui-color-surface"');
        expect(html).toContain('id="ui-color-controls"');
        expect(html).toContain('id="ui-color-text"');
        expect(html).toContain('id="ui-color-accent"');
        expect(html).toContain('id="canvas-motion-normal-color"');
        expect(html).toContain('id="check-canvas-motion-speed-gradient" checked');
        expect(html).toContain('id="canvas-motion-high-speed-color"');
        expect(html).toContain('id="canvas-motion-normal-speed-max"');
        expect(html).toContain('id="canvas-motion-high-speed"');
        expect(html).toContain('id="canvas-motion-outline-start-speed"');
        expect(html).toContain('id="canvas-motion-outline-full-speed"');
        expect(html.indexOf('id="view-dropdown-menu"')).toBeLessThan(html.indexOf('class="dropdown-section appearance-settings"'));
        expect(html.indexOf('class="dropdown-section appearance-settings"')).toBeLessThan(html.indexOf('id="check-view-tools"'));
    });
});
