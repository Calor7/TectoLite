import { describe, expect, it } from 'vitest';
import { isFeatureActiveAtTime, isPlateActiveAtTime } from './timeline';

describe('timeline activity helpers', () => {
    it('keeps plates alive until their death time and excludes future plates', () => {
        expect(isPlateActiveAtTime({ birthTime: 0, deathTime: 50 }, 25)).toBe(true);
        expect(isPlateActiveAtTime({ birthTime: 0, deathTime: 50 }, 50)).toBe(false);
        expect(isPlateActiveAtTime({ birthTime: 50, deathTime: null }, 25)).toBe(false);
    });

    it('handles zero-time features and excludes expired features', () => {
        expect(isFeatureActiveAtTime({ generatedAt: 0 }, 0)).toBe(true);
        expect(isFeatureActiveAtTime({ generatedAt: 10 }, 5)).toBe(false);
        expect(isFeatureActiveAtTime({ generatedAt: 0, deathTime: 10 }, 10)).toBe(false);
    });
});
