import { describe, expect, it } from 'vitest';
import { createDefaultWorldState } from '../types';
import { getAppHTML } from './AppTemplate';

function renderHeader(): string {
    const world = createDefaultWorldState();
    return getAppHTML({
        globalOptions: world.globalOptions,
        realWorldPresetListHtml: '',
        customPresetListHtml: '',
    });
}

describe('header menus', () => {
    it('exposes accessible File and Help dropdown state', () => {
        const html = renderHeader();
        expect(html).toContain('aria-controls="file-dropdown-menu" aria-expanded="false" aria-haspopup="true"');
        expect(html).toContain('aria-controls="help-dropdown-menu" aria-expanded="false" aria-haspopup="true"');
    });

    it('groups project actions without duplicate action ids', () => {
        const html = renderHeader();
        for (const id of ['btn-new-project', 'btn-export-json', 'btn-import-json', 'btn-export', 'btn-report-bug']) {
            expect(html.match(new RegExp(`id="${id}"`, 'g'))).toHaveLength(1);
        }
        expect(html).toContain('id="autosave-status"');
        expect(html).toContain('publisher-brand-mark');
        expect(html).toContain('href="https://www.refracturedgames.com"');
        expect(html).toContain('id="link-kofi-header"');
        expect(html).toContain('aria-label="Support TectoLite on Ko-fi"');
        expect(html).toContain('data-animated-src="./coffee-mug-flaticon.gif"');
        expect(html).toContain('id="link-download-windows"');
        expect(html).toContain('/releases/latest/download/TectoLite-Portable-');
        expect(html).toContain('aria-label="Download the portable Windows app"');
        expect(html).toContain('<span class="header-label">Download app</span>');
        expect(html.indexOf('id="link-kofi-header"')).toBeLessThan(html.indexOf('id="link-download-windows"'));
        expect(html.match(/href="https:\/\/ko-fi\.com\/refracturedgames"/g)).toHaveLength(2);
        expect(html).toContain('class="app-subtitle">by <a href="https://www.refracturedgames.com"');
        expect(html).toContain('aria-label="Support TectoLite on Ko-fi">Ko-fi</a>');
        expect(html).toContain('Ctrl+S');
        expect(html).toContain('Ctrl+O');
    });

    it('uses the monochrome SVG icon system instead of decorative emoji', () => {
        const html = renderHeader();
        expect(html).toContain('app-brand-mark');
        expect(html).toContain('data-ui-icon="coffee"');
        for (const emoji of ['☕', '📄', '📂', '📤', '⚙️', '👁️', '🌙', '🎓', '⌨️', '👆', '🔄', '✏️', '✂️', '🔗', '🧬']) {
            expect(html).not.toContain(emoji);
        }
    });

    it('gives legacy static dialogs accessible names and modal semantics', () => {
        const html = renderHeader();
        expect(html).toContain('id="time-input-modal" class="modal" role="dialog" aria-modal="true" aria-labelledby="time-input-title"');
        expect(html).toContain('id="apply-edit-modal" class="modal" role="dialog" aria-modal="true" aria-labelledby="apply-edit-title"');
        expect(html).toContain('id="drag-target-modal" class="modal" role="dialog" aria-modal="true" aria-labelledby="drag-target-title"');
    });
});
