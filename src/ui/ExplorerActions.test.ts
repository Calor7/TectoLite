import { afterEach, expect, it, vi } from 'vitest';
import { collectExplorerActions, ExplorerActions } from './ExplorerActions';
import type { TectonicPlate } from '../types';

class ElementRecorder {
    children: ElementRecorder[] = [];
    className = '';
    textContent = '';
    disabled = false;
    checked = false;
    type = '';
    onclick?: () => void;
    onchange?: () => void;
    constructor(public tag: string) { }
    setAttribute() { }
    replaceChildren() { this.children = []; }
    appendChild(child: ElementRecorder) { this.children.push(child); }
    append(...children: ElementRecorder[]) { this.children.push(...children); }
    click() { if (!this.disabled) this.onclick?.(); }
    all(): ElementRecorder[] { return this.children.flatMap(child => [child, ...child.all()]); }
}

afterEach(() => vi.unstubAllGlobals());

function setup(count: number) {
    let created = 0;
    vi.stubGlobal('document', { createElement: (tag: string) => {
        if (++created > 2000) throw new Error('Actions rendering created an unbounded DOM');
        return new ElementRecorder(tag);
    } });
    const container = new ElementRecorder('div');
    const actions = Array.from({ length: count }, (_, time) => ({ time, desc: 'Created', plateName: `Plate ${time}`, plateId: `p${time}`, type: time % 2 ? 'plate_edit' : 'created' }));
    const filters: Record<string, boolean> = {};
    const view = new ExplorerActions();
    const onSelect = vi.fn();
    const render = () => view.render(container as unknown as HTMLElement, actions, filters, onSelect);
    const rows = () => container.all().filter(node => node.className.split(' ').includes('explorer-action'));
    const next = () => container.all().find(node => node.textContent === 'Next')!.click();
    render();
    return { container, actions, render, rows, next, onSelect };
}

it('bounds a large Actions list and selects the correct plate on a later page', () => {
    const view = setup(20000);
    expect(view.rows()).toHaveLength(50);
    view.next();
    expect(view.rows()).toHaveLength(50);
    view.rows()[0].click();
    expect(view.onSelect).toHaveBeenCalledWith('p50');
    view.render(); // Selection refresh must preserve the page.
    expect(view.rows()[0].textContent).toContain('Plate 50');
});

it('reaches the last action, resets after filtering, and clamps after actions disappear', () => {
    const view = setup(105);
    view.next(); view.next();
    expect(view.rows()).toHaveLength(5);
    expect(view.rows()[4].textContent).toContain('Plate 104');
    const created = view.container.all().filter(node => node.tag === 'input')[0];
    created.checked = false;
    created.onchange!();
    expect(view.rows()).toHaveLength(50);
    expect(view.rows()[0].textContent).toContain('Plate 1');
    view.next();
    expect(view.rows()).toHaveLength(2);
    view.actions.splice(3);
    view.render();
    expect(view.rows()).toHaveLength(1);
    expect(view.rows()[0].textContent).toContain('Plate 1');
    view.actions.splice(0);
    view.render();
    expect(view.container.all().some(node => node.textContent === 'No actions recorded')).toBe(true);
});

it('collects authored actions without removing events from the saved model', () => {
    const plate = {
        id: 'p', name: 'Coast', birthTime: 0,
        events: [{ time: 20, type: 'split' }, { time: 10, type: 'motion_change' }],
        features: [{ generatedAt: 5, name: 'Summit', type: 'mountain' }, { type: 'volcano' }],
        geometryStages: [{ time: 0 }, { time: 30 }],
    } as TectonicPlate;
    const before = structuredClone(plate);
    expect(collectExplorerActions([plate]).map(action => [action.time, action.desc])).toEqual([
        [20, 'Plate Split'], [10, 'Motion Change'], [0, 'Created'], [5, 'Feature Placed: Summit'], [30, 'Plate Edited'],
    ]);
    expect(plate).toEqual(before);
});
