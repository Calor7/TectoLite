import { describe, expect, it } from 'vitest';
import { EventSystem } from './EventSystem';
import { makeBenchmarkWorld } from '../utils/benchmarkWorld';
import type { AppState, Boundary } from '../types';

function makeState(): AppState {
    const world = makeBenchmarkWorld(1);
    const boundary: Boundary = {
        id: 'test-boundary',
        type: 'convergent',
        points: [[[-10, 0], [10, 0]]],
        plateIds: [world.plates[0].id, world.plates[1].id],
        velocity: 0.5
    };

    return {
        world: {
            ...world,
            boundaries: [boundary],
            currentTime: 50,
            globalOptions: {
                ...world.globalOptions,
                enableGuidedCreation: true
            }
        },
        activeTool: 'select',
        activeFeatureType: 'mountain',
        drawMode: 'polygon',
        activeLineType: 'divergent',
        activePolygonType: 'generic',
        viewport: {
            width: 800,
            height: 600,
            scale: 250,
            rotate: [0, 0, 0],
            translate: [400, 300]
        }
    };
}

describe('EventSystem reset', () => {
    it('allows the same interaction to be detected again after reset', () => {
        const system = new EventSystem();
        const initial = makeState();
        const first = system.update(initial);
        expect(first.world.tectonicEvents).toHaveLength(1);

        const withoutPending = {
            ...first,
            world: { ...first.world, pendingEventId: null }
        };
        const cached = system.update(withoutPending);
        expect(cached.world.tectonicEvents).toHaveLength(1);

        system.reset();
        const afterReset = system.update(withoutPending);
        expect(afterReset.world.tectonicEvents).toHaveLength(2);
    });

    it('keeps clearCache as a reset-compatible alias', () => {
        const system = new EventSystem();
        const first = system.update(makeState());
        const withoutPending = {
            ...first,
            world: { ...first.world, pendingEventId: null }
        };

        system.clearCache();
        expect(system.update(withoutPending).world.tectonicEvents).toHaveLength(2);
    });
});
