// Causality layer — derive an explicit causal graph from the links the world
// model already encodes implicitly, plus query helpers used by guided-mode UIs.
//
// Pure functions only. This module never mutates world state and is never read
// by the simulation; it produces/inspects CausalLink metadata.

import {
  WorldState,
  CausalLink,
  EntityRef,
  CausalRelation,
  EntityKind,
} from '../types';

function ref(kind: EntityKind, id: string): EntityRef {
  return { kind, id };
}

export function sameRef(a: EntityRef, b: EntityRef): boolean {
  return a.kind === b.kind && a.id === b.id;
}

/** Deterministic id for an auto-derived link so re-derivation is idempotent. */
function autoId(from: EntityRef, to: EntityRef, relation: CausalRelation): string {
  return `auto:${relation}:${from.kind}:${from.id}->${to.kind}:${to.id}`;
}

/**
 * Derive `auto` causal links from the implicit references already on the model:
 *   - plate.parentPlateId / parentPlateIds  → created-from (split/fusion ancestry)
 *   - plate.generatedBy                     → created-from (slab generation)
 *   - plate.riftAxisId / junctionId         → created-from (axis/junction origin)
 *   - event-spawned features                → caused-by the event
 *   - event.plateIds                        → caused-by the two interacting plates
 *
 * Endpoints that don't resolve to a live entity are skipped, so the result never
 * contains dangling refs. User-authored links are NOT produced here.
 */
export function deriveImplicitLinks(world: WorldState): CausalLink[] {
  const plateIds = new Set(world.plates.map((p) => p.id));
  const axisIds = new Set((world.riftAxes ?? []).map((a) => a.id));
  const junctionIds = new Set((world.tripleJunctions ?? []).map((j) => j.id));
  const eventIds = new Set((world.tectonicEvents ?? []).map((e) => e.id));

  const seen = new Set<string>();
  const links: CausalLink[] = [];

  const push = (
    from: EntityRef,
    to: EntityRef,
    relation: CausalRelation,
    time?: number
  ): void => {
    if (sameRef(from, to)) return; // never self-link
    const id = autoId(from, to, relation);
    if (seen.has(id)) return; // dedupe
    seen.add(id);
    links.push({ id, from, to, relation, time, auto: true });
  };

  for (const plate of world.plates) {
    const self = ref('plate', plate.id);

    if (plate.parentPlateId && plateIds.has(plate.parentPlateId)) {
      push(self, ref('plate', plate.parentPlateId), 'created-from', plate.birthTime);
    }
    for (const pid of plate.parentPlateIds ?? []) {
      if (plateIds.has(pid)) {
        push(self, ref('plate', pid), 'created-from', plate.birthTime);
      }
    }
    if (plate.generatedBy && plateIds.has(plate.generatedBy)) {
      push(self, ref('plate', plate.generatedBy), 'created-from', plate.age ?? plate.birthTime);
    }
    if (plate.riftAxisId && axisIds.has(plate.riftAxisId)) {
      push(self, ref('riftAxis', plate.riftAxisId), 'created-from', plate.age ?? plate.birthTime);
    }
    if (plate.junctionId && junctionIds.has(plate.junctionId)) {
      push(self, ref('tripleJunction', plate.junctionId), 'created-from', plate.age ?? plate.birthTime);
    }

    // Features spawned by guided-creation events (see EventEffectsProcessor)
    for (const feature of plate.features) {
      const props = feature.properties as Record<string, unknown> | undefined;
      if (props && props.source === 'event' && typeof props.eventId === 'string' && eventIds.has(props.eventId)) {
        push(ref('feature', feature.id), ref('event', props.eventId), 'caused-by', feature.generatedAt);
      }
    }
  }

  for (const event of world.tectonicEvents ?? []) {
    for (const pid of event.plateIds) {
      if (plateIds.has(pid)) {
        push(ref('event', event.id), ref('plate', pid), 'caused-by', event.time);
      }
    }
  }

  return links;
}

/**
 * Replace the auto-derived links in `existing` with a freshly derived set, keeping
 * all user-authored links untouched. Use after model changes to refresh the graph.
 */
export function reseedAutoLinks(world: WorldState, existing: CausalLink[]): CausalLink[] {
  const userLinks = existing.filter((l) => l.auto !== true);
  return [...userLinks, ...deriveImplicitLinks(world)];
}

/** The live entity ids in `world`, grouped by kind, for resolving EntityRefs. */
function entityIdSets(world: WorldState): Record<EntityKind, Set<string>> {
  const featureIds = new Set<string>();
  for (const plate of world.plates) {
    for (const f of plate.features) featureIds.add(f.id);
    for (const f of plate.initialFeatures ?? []) featureIds.add(f.id);
  }
  return {
    plate: new Set(world.plates.map((p) => p.id)),
    feature: featureIds,
    event: new Set((world.tectonicEvents ?? []).map((e) => e.id)),
    riftAxis: new Set((world.riftAxes ?? []).map((a) => a.id)),
    tripleJunction: new Set((world.tripleJunctions ?? []).map((j) => j.id)),
  };
}

/**
 * Drop links whose endpoints no longer resolve to a live entity in `world` and
 * shift each link's `time` by `timeOffset` (clamped at 0). Used when exporting a
 * time-shifted / filtered slice so the saved graph has no dangling refs.
 */
export function pruneCausalLinks(
  links: CausalLink[] | undefined,
  world: WorldState,
  timeOffset = 0
): CausalLink[] {
  if (!links || links.length === 0) return [];
  const sets = entityIdSets(world);
  const exists = (r: EntityRef): boolean => sets[r.kind].has(r.id);
  return links
    .filter((l) => exists(l.from) && exists(l.to))
    .map((l) => (l.time === undefined ? l : { ...l, time: Math.max(0, l.time + timeOffset) }));
}

/** All links touching `entity` (as either endpoint). */
export function linksFor(links: CausalLink[], entity: EntityRef): CausalLink[] {
  return links.filter((l) => sameRef(l.from, entity) || sameRef(l.to, entity));
}

/** Entities reachable by following links outward from `entity` (the `to` ends). */
export function ancestorsOf(links: CausalLink[], entity: EntityRef): EntityRef[] {
  return traverse(links, entity, 'forward');
}

/** Entities that point at `entity` (the `from` ends), transitively. */
export function descendantsOf(links: CausalLink[], entity: EntityRef): EntityRef[] {
  return traverse(links, entity, 'backward');
}

function traverse(
  links: CausalLink[],
  start: EntityRef,
  direction: 'forward' | 'backward'
): EntityRef[] {
  const result: EntityRef[] = [];
  const visited = new Set<string>([`${start.kind}:${start.id}`]);
  const queue: EntityRef[] = [start];

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const link of links) {
      const match = direction === 'forward' ? link.from : link.to;
      const next = direction === 'forward' ? link.to : link.from;
      if (!sameRef(match, current)) continue;
      const key = `${next.kind}:${next.id}`;
      if (visited.has(key)) continue;
      visited.add(key);
      result.push(next);
      queue.push(next);
    }
  }

  return result;
}
