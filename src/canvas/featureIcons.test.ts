import { describe, expect, it } from 'vitest';
import {
    FEATURE_ICON_CATALOG,
    FEATURE_ICON_DRAWERS,
    FEATURE_TOOL_TYPES,
    featureToolIcon,
} from './featureIcons';

describe('feature icon registry', () => {
    it('covers every point feature exposed by the feature tool', () => {
        const expected = [
            'hotspot',
            'island',
            'mountain',
            'rift',
            'seafloor',
            'trench',
            'volcano',
            'weakness',
        ];
        expect([...FEATURE_TOOL_TYPES].sort()).toEqual(expected);
        expect(Object.keys(FEATURE_ICON_CATALOG).sort()).toEqual(expected);
        expect(Object.keys(FEATURE_ICON_DRAWERS).sort()).toEqual(expected);
    });

    it('renders every toolbar glyph through the same normalized SVG contract', () => {
        for (const type of FEATURE_TOOL_TYPES) {
            const icon = featureToolIcon(type);
            expect(icon).toContain('class="feature-icon"');
            expect(icon).toContain('viewBox="0 0 24 24"');
            expect(icon).toContain('stroke-width="1.8"');
            expect(icon).toContain(`data-feature-icon="${type}"`);
            expect(icon).not.toMatch(/[●⌁⌣◇◎]/);
        }
    });
});
