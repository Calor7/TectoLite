import { describe, expect, it } from 'vitest';
import { selectExplorerRange } from './ExplorerSelection';

describe('selectExplorerRange', () => {
    const ids = ['a', 'b', 'c', 'd'];

    it('selects an inclusive forward range', () => {
        expect(selectExplorerRange(ids, 'b', 'd')).toEqual(['b', 'c', 'd']);
    });

    it('selects an inclusive reverse range in visible order', () => {
        expect(selectExplorerRange(ids, 'd', 'b')).toEqual(['b', 'c', 'd']);
    });

    it('falls back to the target when the anchor is not visible', () => {
        expect(selectExplorerRange(ids, 'missing', 'c')).toEqual(['c']);
    });
});
