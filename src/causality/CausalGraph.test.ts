import { describe, it, expect } from 'vitest';
import {
  deriveImplicitLinks,
  reseedAutoLinks,
  linksFor,
  ancestorsOf,
  descendantsOf,
} from './CausalGraph';
import { TectonicPlate, WorldState, Feature, CausalLink, EntityRef } from '../types';

function makeFeature(id: string, props?: Record<string, unknown>, generatedAt?: number): Feature {
  return { id, type: 'mountain', position: [0, 0], properties: props ?? {}, generatedAt } as unknown as Feature;
}

function makePlate(id: string, overrides: Partial<TectonicPlate> = {}): TectonicPlate {
  return {
    id,
    name: `Plate ${id}`,
    color: '#fff',
    birthTime: 0,
    deathTime: null,
    visible: true,
    locked: false,
    center: [0, 0],
    polygons: [],
    features: [],
    initialPolygons: [],
    initialFeatures: [],
    motion: { eulerPole: { position: [0, 90], rate: 0, visible: false } },
    motionKeyframes: [],
    events: [],
    connectedRiftIds: [],
    ...overrides,
  } as unknown as TectonicPlate;
}

function makeWorld(plates: TectonicPlate[], overrides: Partial<WorldState> = {}): WorldState {
  return { plates, ...overrides } as unknown as WorldState;
}

const ref = (kind: EntityRef['kind'], id: string): EntityRef => ({ kind, id });

describe('deriveImplicitLinks', () => {
  it('links a split child to its parent as created-from', () => {
    const world = makeWorld([makePlate('parent'), makePlate('child', { parentPlateId: 'parent', birthTime: 50 })]);
    const links = deriveImplicitLinks(world);
    expect(links).toEqual([
      expect.objectContaining({
        from: ref('plate', 'child'),
        to: ref('plate', 'parent'),
        relation: 'created-from',
        time: 50,
        auto: true,
      }),
    ]);
  });

  it('links each fusion parent without duplicating parentPlateId', () => {
    const world = makeWorld([
      makePlate('a'),
      makePlate('b'),
      makePlate('child', { parentPlateId: 'a', parentPlateIds: ['a', 'b'] }),
    ]);
    const links = deriveImplicitLinks(world);
    const childParents = links.filter((l) => l.from.id === 'child').map((l) => l.to.id);
    expect(childParents.sort()).toEqual(['a', 'b']);
  });

  it('skips references to entities that do not exist (no dangling links)', () => {
    const world = makeWorld([makePlate('child', { parentPlateId: 'ghost', generatedBy: 'ghost', riftAxisId: 'ghost' })]);
    expect(deriveImplicitLinks(world)).toEqual([]);
  });

  it('links an event-spawned feature to its event as caused-by', () => {
    const feature = makeFeature('f1', { source: 'event', eventId: 'e1' }, 120);
    const world = makeWorld([makePlate('p', { features: [feature] })], {
      tectonicEvents: [{ id: 'e1', time: 120, plateIds: ['p', 'p'] }] as unknown as WorldState['tectonicEvents'],
    });
    const links = deriveImplicitLinks(world);
    expect(links).toContainEqual(
      expect.objectContaining({ from: ref('feature', 'f1'), to: ref('event', 'e1'), relation: 'caused-by', time: 120 })
    );
  });

  it('links an event to its interacting plates as caused-by', () => {
    const world = makeWorld([makePlate('a'), makePlate('b')], {
      tectonicEvents: [{ id: 'e1', time: 30, plateIds: ['a', 'b'] }] as unknown as WorldState['tectonicEvents'],
    });
    const links = deriveImplicitLinks(world);
    const eventLinks = links.filter((l) => l.from.kind === 'event');
    expect(eventLinks.map((l) => l.to.id).sort()).toEqual(['a', 'b']);
  });

  it('is idempotent: deterministic ids, no duplicates on re-derivation', () => {
    const world = makeWorld([makePlate('parent'), makePlate('child', { parentPlateId: 'parent' })]);
    const first = deriveImplicitLinks(world);
    const second = deriveImplicitLinks(world);
    expect(second).toEqual(first);
    expect(new Set(first.map((l) => l.id)).size).toBe(first.length);
  });
});

describe('reseedAutoLinks', () => {
  it('replaces auto links but preserves user-authored links', () => {
    const world = makeWorld([makePlate('parent'), makePlate('child', { parentPlateId: 'parent' })]);
    const userLink: CausalLink = {
      id: 'user-1',
      from: ref('plate', 'child'),
      to: ref('plate', 'parent'),
      relation: 'motivated-by',
      note: 'narrative',
    };
    const staleAuto: CausalLink = {
      id: 'auto:created-from:plate:ghost->plate:gone',
      from: ref('plate', 'ghost'),
      to: ref('plate', 'gone'),
      relation: 'created-from',
      auto: true,
    };
    const result = reseedAutoLinks(world, [userLink, staleAuto]);
    expect(result).toContainEqual(userLink);
    expect(result.find((l) => l.id === staleAuto.id)).toBeUndefined();
    expect(result.some((l) => l.auto && l.from.id === 'child')).toBe(true);
  });
});

describe('query helpers', () => {
  const world = makeWorld([
    makePlate('grandparent'),
    makePlate('parent', { parentPlateId: 'grandparent' }),
    makePlate('child', { parentPlateId: 'parent' }),
  ]);
  const links = deriveImplicitLinks(world);

  it('linksFor returns links touching the entity as either endpoint', () => {
    const found = linksFor(links, ref('plate', 'parent'));
    expect(found).toHaveLength(2); // parent->grandparent and child->parent
  });

  it('ancestorsOf walks created-from transitively', () => {
    const ancestors = ancestorsOf(links, ref('plate', 'child')).map((r) => r.id).sort();
    expect(ancestors).toEqual(['grandparent', 'parent']);
  });

  it('descendantsOf walks the reverse direction transitively', () => {
    const descendants = descendantsOf(links, ref('plate', 'grandparent')).map((r) => r.id).sort();
    expect(descendants).toEqual(['child', 'parent']);
  });
});
