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
    });
});
