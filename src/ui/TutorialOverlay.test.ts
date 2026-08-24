import { describe, expect, it } from 'vitest';
import { placeTutorialTooltip } from './TutorialOverlay';

describe('placeTutorialTooltip', () => {
    it('keeps a right-sidebar tooltip out of the tutorial manual', () => {
        const position = placeTutorialTooltip({
            target: { left: 997, right: 1267, top: 56, bottom: 652, width: 270, height: 596 },
            manual: { left: 428, right: 996, top: 56, bottom: 652, width: 568, height: 596 },
            tooltipWidth: 250,
            tooltipHeight: 88,
            viewportWidth: 1280,
            viewportHeight: 720,
            pointerX: 1140,
            pointerY: 354,
        });

        expect(position.left).toBeGreaterThanOrEqual(1006);
        expect(position.left + 250).toBeLessThanOrEqual(1270);
        expect(position.top).toBeGreaterThanOrEqual(10);
        expect(position.top + 88).toBeLessThanOrEqual(710);
    });
});
