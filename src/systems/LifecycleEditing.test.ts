import { describe, expect, it } from 'vitest';
import { createGeologicalScenario } from '../scenarios/GeologicalScenarios';
import { derivePlateGeometry } from '../motion/RotationModel';
import { reconcileEditedTimeline, removeLifecycleTransition, retimeLifecycleTransition } from './LifecycleEditing';
import { parseProjectText } from '../ProjectIO';
import { CURRENT_SAVE_VERSION } from '../migration';
import type { Polygon } from '../types';

function expectGeometry(actual: Polygon[], expected: Polygon[]) {
    expect(actual.map(p => p.id)).toEqual(expected.map(p => p.id));
    const a = actual.flatMap(p => p.points).flat(), b = expected.flatMap(p => p.points).flat();
    expect(a.length).toBe(b.length);
    expect(Math.max(...a.map((value, i) => Math.abs(value - b[i])))).toBeLessThan(1e-8);
}

describe('editing scenario lifecycle transitions', () => {
    it('retimes fusion from either parent, moves every linked layer, and preserves the joining geometry', async () => {
        const world = await createGeologicalScenario('future', true);
        const parent = world.plates.find(p => p.name === 'Cover — North America')!;
        const at300 = new Map(world.plates.map(p => [p.id, derivePlateGeometry(p, world.plates, 300).polygons]));
        expect(retimeLifecycleTransition(world.plates, parent.id, 300, 320, false)).toBe(true);
        const children = world.plates.filter(p => p.name.endsWith('Amasia — illustrative assembly'));
        expect(children).toHaveLength(3);
        for (const child of children) {
            expect(child.birthTime).toBe(320);
            expect(child.deathTime).toBe(380);
            expectGeometry(derivePlateGeometry(child, world.plates, 320).polygons, at300.get(child.id)!);
            for (const parentId of child.parentPlateIds!) {
                const ending = world.plates.find(p => p.id === parentId)!;
                expect(ending.deathTime).toBe(320);
                expect(ending.events.find(e => e.type === 'fusion')?.time).toBe(320);
                expectGeometry(derivePlateGeometry(ending, world.plates, 320).polygons, at300.get(parentId)!);
            }
        }
        const cover = children.find(p => p.groupId === 'scenario-covers')!;
        const carrier = world.plates.find(p => p.id === cover.linkedToPlateId)!;
        const coverPoints = derivePlateGeometry(cover, world.plates, 335).polygons.flatMap(p => p.points).flat();
        const carrierPoints = derivePlateGeometry(carrier, world.plates, 335).polygons.flatMap(p => p.points).flat();
        expect(Math.max(...coverPoints.map((p, i) => Math.abs(p - carrierPoints[i])))).toBeLessThan(1e-8);
        expect(() => parseProjectText(JSON.stringify({ version: CURRENT_SAVE_VERSION, world }))).not.toThrow();
    });

    it('retimes a fusion through the successor birth and cascades later split histories', async () => {
        const world = await createGeologicalScenario('future', true);
        const child = world.plates.find(p => p.name === 'Cover — Amasia — illustrative assembly')!;
        const successors = world.plates.filter(p => p.parentPlateIds?.includes(child.id));
        const before = successors.map(p => derivePlateGeometry(p, world.plates, 420).polygons);
        expect(retimeLifecycleTransition(world.plates, child.id, 300, 320, true)).toBe(true);
        reconcileEditedTimeline(world, 20, true);
        expect(world.scenario!.duration).toBe(520);
        expect(world.globalOptions.timelineMaxTime).toBe(520);
        expect(world.scenario!.title).toMatch(/^Edited · /);
        expect(world.scenario!.chapters.map(chapter => chapter.time)).toEqual([0, 520]);
        expect(world.scenario!.startAge).toBe(0);
        expect(child.deathTime).toBe(400);
        for (const [i, successor] of successors.entries()) {
            expect(successor.birthTime).toBe(400);
            expectGeometry(derivePlateGeometry(successor, world.plates, 440).polygons, before[i]);
            const linked = world.plates.find(p => p.id === successor.linkedToPlateId)!;
            expect(linked.birthTime).toBe(400);
            expect(successor.linkTime).toBe(400);
        }
    });

    it('keeps both split successors and all display layers at a moved historical boundary', async () => {
        const world = await createGeologicalScenario('reconstruction', true);
        const parent = world.plates.find(p => p.name === 'Cover — Laurasia')!;
        expect(retimeLifecycleTransition(world.plates, parent.id, 20, 25, false)).toBe(true);
        for (const ending of world.plates.filter(p => p.name.endsWith(' — Laurasia'))) {
            expect(ending.deathTime).toBe(25);
            for (const child of world.plates.filter(p => p.parentPlateIds?.includes(ending.id))) expect(child.birthTime).toBe(25);
        }
    });

    it('keeps the joining snapshot when the new boundary coincides with another shape stage', async () => {
        const world = await createGeologicalScenario('future', false);
        const parent = world.plates.find(p => p.name === 'Cover — North America')!;
        const child = world.plates.find(p => p.name === 'Cover — Amasia — illustrative assembly')!;
        const before = derivePlateGeometry(child, world.plates, 300).polygons;
        retimeLifecycleTransition(world.plates, parent.id, 300, 325, false);
        expectGeometry(derivePlateGeometry(child, world.plates, 325).polygons, before);
        expect(child.geometryStages.filter(s => s.time === 325)).toHaveLength(1);
        const beforeBoundary = derivePlateGeometry(parent, world.plates, 325 - 1e-7).polygons;
        const afterBoundary = derivePlateGeometry(child, world.plates, 325).polygons;
        for (const polygon of beforeBoundary) {
            const successor = afterBoundary.find(p => p.id === polygon.id)!;
            const a = polygon.points.flat(), b = successor.points.flat();
            expect(Math.max(...a.map((value, i) => Math.abs(value - b[i])))).toBeLessThan(1e-5);
        }
    });

    it('rejects a boundary beyond the successor death without mutating the world', async () => {
        const world = await createGeologicalScenario('future', true);
        const parent = world.plates.find(p => p.name === 'Cover — North America')!;
        const before = JSON.stringify(world);
        expect(() => retimeLifecycleTransition(world.plates, parent.id, 300, 390, false)).toThrow('before its birth');
        expect(JSON.stringify(world)).toBe(before);
    });

    it('deleting fusion restores every ancestor and removes later descendants and linked layers', async () => {
        const world = await createGeologicalScenario('future', true);
        const parent = world.plates.find(p => p.name === 'Cover — North America')!;
        const ancestorIds = new Set(world.plates.filter(p => p.name.endsWith('Amasia — illustrative assembly')).flatMap(p => p.parentPlateIds!));
        const removed = new Set(removeLifecycleTransition(world.plates, parent.id, 300));
        expect(removed.size).toBe(9);
        const remaining = world.plates.filter(p => !removed.has(p.id));
        for (const plate of remaining.filter(p => ancestorIds.has(p.id))) {
            expect(plate.deathTime).toBeNull();
        }
        expect(remaining.some(p => p.name.includes('Amasia'))).toBe(false);
        expect(remaining.every(p => !p.linkedToPlateId || !removed.has(p.linkedToPlateId))).toBe(true);
    });
});
