import { describe, expect, it } from 'vitest';
import { createDefaultWorldState } from '../types';
import { getAppHTML } from './AppTemplate';
import {
    EXPORT_CROP_HELP,
    JSON_ENTIRE_TIMELINE_HELP,
    JSON_FROM_CURRENT_HELP,
} from './workflowGuidance';

const renderApp = (): string => getAppHTML({
    globalOptions: createDefaultWorldState().globalOptions,
    realWorldPresetListHtml: '',
    customPresetListHtml: '',
});

describe('workflow guidance', () => {
    it('exposes feature placement and explains link/fusion direction', () => {
        const html = renderApp();

        expect(html).toContain('data-tool="feature"');
        expect(html).toContain('id="feature-selector"');
        expect(html).toContain('class="feature-grid"');
        expect(html).toContain('data-feature="mountain"');
        expect(html).toContain('data-feature="hotspot"');
        expect(html).toContain('data-feature="seafloor"');
        expect(html).toContain('data-feature-icon="weakness"');
        expect(html).not.toMatch(/[●⌁⌣◇◎]/);
        expect(html).toContain('Choose the leader on the map or in Explorer, then the follower.');
        expect(html).toContain('The first-selected plate supplies the new plate\'s initial motion');
    });

    it('explains feature lifetime previews and default line layering', () => {
        const html = renderApp();

        expect(html).toContain('Show features outside their active lifetime as faint previews');
        expect(html).toContain('Lines render above landmasses by default.');
    });

    it('keeps export explanations explicit about history and cropping', () => {
        expect(JSON_ENTIRE_TIMELINE_HELP).toContain('earlier timeline history');
        expect(JSON_FROM_CURRENT_HELP).toContain('discards earlier history');
        expect(EXPORT_CROP_HELP).toContain('never reveals extra map area');
    });
});
