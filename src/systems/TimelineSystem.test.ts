import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultAppState, type TectonicPlate } from '../types';
import { TimelineSystem, type TimelineHost } from './TimelineSystem';

vi.mock('../ui/Fields', () => ({ prepareFields: vi.fn() }));

// A small DOM recorder keeps these tests in the existing Node test environment.
// It counts the actual nodes built by TimelineSystem and exposes their handlers.
class ElementRecorder {
    children: ElementRecorder[] = [];
    className = '';
    textContent = '';
    value = '';
    type = '';
    title = '';
    disabled = false;
    checked = false;
    style = {};
    attributes = new Map<string, string>();
    onclick?: (event: { target: ElementRecorder; stopPropagation(): void }) => void;
    onchange?: () => void;
    classList = { toggle: vi.fn() };
    constructor(public tagName: string) { }
    set innerHTML(_value: string) { this.children = []; }
    appendChild(child: ElementRecorder) { this.children.push(child); return child; }
    append(...children: ElementRecorder[]) { this.children.push(...children); }
    setAttribute(name: string, value: string) { this.attributes.set(name, value); }
    click() { if (!this.disabled) this.onclick?.({ target: this, stopPropagation: vi.fn() }); }
    all(predicate: (node: ElementRecorder) => boolean): ElementRecorder[] {
        return this.children.flatMap(child => [...(predicate(child) ? [child] : []), ...child.all(predicate)]);
    }
}

function plate(id: string, segmentCount: number): TectonicPlate {
    return {
        id, name: id, color: '#123456', visible: true, locked: false,
        polygons: [], features: [], initialPolygons: [], initialFeatures: [], geometryStages: [], events: [],
        center: [0, 0], birthTime: 0, deathTime: null, connectedRiftIds: [],
        motionSegments: Array.from({ length: segmentCount }, (_, time) => ({
            time, eulerPole: { position: [10, 20], rate: 0.5 },
        })),
    };
}

function setup(plates: TectonicPlate[]) {
    vi.stubGlobal('window', { innerWidth: 1200, innerHeight: 800 });
    let createdNodes = 0;
    vi.stubGlobal('document', {
        createElement: (tag: string) => {
            // Fail promptly on a regression instead of exhausting the test runner.
            if (++createdNodes > 5000) throw new Error('History rendering created an unbounded DOM');
            return new ElementRecorder(tag.toUpperCase());
        },
        createTextNode: (text: string) => Object.assign(new ElementRecorder('#text'), { textContent: text }),
    });
    const state = createDefaultAppState();
    state.world.plates = plates;
    const host: TimelineHost = {
        getState: () => state, pushState: vi.fn(), updateUI: vi.fn(),
        setTime: vi.fn(), showModal: vi.fn(), deletePlates: vi.fn(),
    };
    const timeline = new TimelineSystem(host);
    const container = new ElementRecorder('DIV');
    timeline.setContainer(container as unknown as HTMLElement);
    const rows = () => container.all(node => node.className.startsWith('timeline-item '));
    const inputs = () => container.all(node => node.tagName === 'INPUT');
    const button = (name: string) => container.all(node => node.tagName === 'BUTTON' && node.textContent === name)[0];
    const status = () => container.all(node => node.attributes.has('aria-live'))[0]?.textContent;
    return { timeline, host, state, container, rows, inputs, button, status };
}

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('large project history rendering', () => {
    it('bounds world history after clearing selection and creates no collapsed editors', () => {
        const plates = Array.from({ length: 200 }, (_, i) => plate(`plate-${i}`, 100));
        const ui = setup(plates);
        ui.timeline.render(plates[0]);
        ui.timeline.render(null);

        expect(ui.rows()).toHaveLength(50);
        expect(ui.inputs()).toHaveLength(0);
        expect(ui.status()).toBe('1–50 of 20200');
        expect(ui.button('Previous').disabled).toBe(true);
        ui.button('Next').click();
        expect(ui.rows()).toHaveLength(50);
        expect(ui.status()).toBe('51–100 of 20200');
    });

    it('keeps every event reachable, preserves the page on refresh, and resets on selection change', () => {
        const first = plate('first', 104), second = plate('second', 2);
        const ui = setup([first, second]);
        ui.timeline.render(first);
        const seen = new Set<string>();
        for (let page = 0; page < 3; page++) {
            for (const row of ui.rows()) seen.add(row.all(node => node.className === 'timeline-label')[0].textContent);
            if (page < 2) ui.button('Next').click();
        }
        expect(seen.size).toBe(105);
        expect(ui.rows()).toHaveLength(5);
        expect(ui.button('Next').disabled).toBe(true);
        ui.timeline.render({ ...first });
        expect(ui.status()).toBe('101–105 of 105');
        first.motionSegments = first.motionSegments.slice(0, 53);
        ui.timeline.render(first);
        expect(ui.status()).toBe('51–54 of 54');
        ui.timeline.render(second);
        expect(ui.rows()).toHaveLength(3);
        ui.timeline.render(first);
        expect(ui.status()).toBe('1–50 of 54');
    });

    it('creates an editor only when expanded and edits the correct segment on a later page', () => {
        const target = plate('selected', 104);
        const ui = setup([target]);
        ui.timeline.render(target);
        ui.button('Next').click();
        const header = ui.rows()[0].children[0];
        header.click();
        expect(ui.inputs()).toHaveLength(4);
        const rate = ui.inputs()[1];
        header.click();
        header.click();
        expect(ui.inputs()).toHaveLength(4);
        expect(ui.inputs()[1]).toBe(rate);
        rate.value = '1.25';
        rate.onchange?.();
        expect(target.motionSegments[49].eulerPole.rate).toBe(1.25);
        expect(target.motionSegments[48].eulerPole.rate).toBe(0.5);
        expect(ui.host.pushState).toHaveBeenCalledOnce();
        expect(ui.host.setTime).toHaveBeenCalledWith(0);
        expect(ui.host.updateUI).toHaveBeenCalledOnce();
    });

    it('deletes the chosen event from a later page without opening its editor', () => {
        const target = plate('selected', 104);
        const ui = setup([target]);
        ui.timeline.render(target);
        ui.button('Next').click();
        ui.rows()[0].all(node => node.tagName === 'BUTTON')[0].click();
        expect(ui.inputs()).toHaveLength(0);
        const dialog = vi.mocked(ui.host.showModal).mock.calls[0][0];
        dialog.buttons[0].onClick();
        expect(target.motionSegments).toHaveLength(103);
        expect(target.motionSegments.some(segment => segment.time === 49)).toBe(false);
        expect(ui.host.pushState).toHaveBeenCalledOnce();
    });
});
