import { describe, expect, it } from 'vitest';
import { propertySectionMode } from './ProgressiveDisclosure';

describe('property progressive disclosure', () => {
    it('collapses only explicitly advanced property sections', () => {
        expect(propertySectionMode('Lineage & Links')).toBe('disclosure');
        expect(propertySectionMode('Euler Pole Motion')).toBe('disclosure');
        expect(propertySectionMode('Flowlines')).toBe('flat');
        expect(propertySectionMode('Features')).toBe('flat');
        expect(propertySectionMode('Fixed Hotspot')).toBe('flat');
    });
});
