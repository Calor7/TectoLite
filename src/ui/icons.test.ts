import { describe, expect, it } from 'vitest';
import { uiIcon } from './icons';

describe('uiIcon', () => {
    it('renders a monochrome decorative SVG with a stable identifier', () => {
        const icon = uiIcon('coffee');
        expect(icon).toContain('data-ui-icon="coffee"');
        expect(icon).toContain('aria-hidden="true"');
        expect(icon).toContain('stroke="currentColor"');
        for (const emoji of ['☕', '📄', '⚙️']) expect(icon).not.toContain(emoji);
    });

    it('sanitizes the internal class name', () => {
        expect(uiIcon('file', 'tool-icon" onclick="bad')).toContain('class="tool-icon onclickbad"');
    });

    it('provides the normalized download icon used by the web installer link', () => {
        expect(uiIcon('download')).toContain('data-ui-icon="download"');
    });
});
