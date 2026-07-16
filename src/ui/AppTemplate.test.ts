import { describe, expect, it } from 'vitest';
import { createDefaultWorldState } from '../types';
import { getAppHTML } from './AppTemplate';

function renderSettings(strategy: 'off' | 'continuous' | 'banded' = 'off'): string {
    const world = createDefaultWorldState();
    world.globalOptions.oceanCrustStrategy = strategy;
    return getAppHTML({
        globalOptions: world.globalOptions,
        realWorldPresetListHtml: '',
        customPresetListHtml: ''
    });
}

describe('application settings template', () => {
    it('places ocean generation in a clearly warned Experimental section', () => {
        const html = renderSettings();

        expect(html).toContain('<span>Experimental</span>');
        expect(html).toContain('class="experimental-badge">May change</span>');
        expect(html).toContain('Save your project before enabling them.');
        expect(html.indexOf('<span>Experimental</span>')).toBeLessThan(html.indexOf('id="ocean-crust-strategy"'));
    });

    it('keeps experimental ocean generation off by default and selects one strategy', () => {
        const defaultHtml = renderSettings();
        const continuousHtml = renderSettings('continuous');

        expect(defaultHtml).toContain('<option value="off" selected>Off</option>');
        expect(continuousHtml).toContain('<option value="continuous" selected>Continuous Split-Rift Fill</option>');
        expect(continuousHtml).not.toContain('<option value="banded" selected>');
    });

    it('does not expose the retired independent automation toggles', () => {
        const html = renderSettings();

        expect(html).not.toContain('check-auto-oceanic');
        expect(html).not.toContain('check-expanding-rifts');
        expect(html).not.toContain('check-guided-creation');
        expect(html).not.toContain('check-show-event-icons');
    });

    it('declares accessible state for both settings menus', () => {
        const html = renderSettings();

        expect(html).toContain('id="btn-planet"');
        expect(html).toContain('aria-controls="planet-dropdown-menu" aria-expanded="false" aria-haspopup="true"');
        expect(html).toContain('aria-controls="view-dropdown-menu" aria-expanded="false" aria-haspopup="true"');
    });
});
