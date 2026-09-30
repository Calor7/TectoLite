import type { TectonicPlate } from '../types';

interface ExplorerAction {
    time: number;
    desc: string;
    plateName: string;
    plateId: string;
    type: string;
}

export function collectExplorerActions(plates: TectonicPlate[]): ExplorerAction[] {
    const actions: ExplorerAction[] = [];
    for (const plate of plates) {
        const add = (time: number | undefined, desc: string, type: string) => {
            if (time !== undefined && Number.isFinite(time)) {
                actions.push({ time, desc, type, plateId: plate.id, plateName: plate.name });
            }
        };
        for (const event of plate.events ?? []) {
            const desc = event.type === 'motion_change' ? 'Motion Change'
                : event.type === 'split' ? 'Plate Split' : event.type === 'fusion' ? 'Fusion' : event.type;
            add(event.time, desc, event.type);
        }
        add(plate.birthTime, 'Created', 'created');
        for (const feature of plate.features) {
            add(feature.generatedAt, `Feature Placed: ${feature.name || feature.type}`, 'feature');
        }
        for (const stage of plate.geometryStages.slice(1)) add(stage.time, 'Plate Edited', 'plate_edit');
    }
    return actions;
}

const FILTERS = [
    ['created', 'Created'], ['motion_change', 'Motion'], ['split', 'Split'], ['fusion', 'Fusion'],
    ['feature', 'Features'], ['landmass_create', 'Landmass+'], ['landmass_edit', 'Landmass Edit'], ['plate_edit', 'Plate Edit'],
];
const PAGE_SIZE = 50;

/** Keep action DOM bounded even when a project contains thousands of edits. */
export class ExplorerActions {
    private page = 0;

    render(container: HTMLElement, actions: ExplorerAction[], filters: Record<string, boolean>, onSelect: (plateId: string) => void): void {
        container.replaceChildren();
        const filterRow = document.createElement('div');
        filterRow.className = 'explorer-action-filters';
        for (const [key, label] of FILTERS) {
            const wrapper = document.createElement('label');
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.checked = filters[key] !== false;
            input.onchange = () => {
                filters[key] = input.checked;
                this.page = 0;
                this.render(container, actions, filters, onSelect);
            };
            const span = document.createElement('span');
            span.textContent = label;
            wrapper.append(input, span);
            filterRow.appendChild(wrapper);
        }
        container.appendChild(filterRow);
        const visible = actions.filter(action => filters[action.type] !== false).sort((a, b) => a.time - b.time);
        this.page = Math.min(this.page, Math.max(0, Math.ceil(visible.length / PAGE_SIZE) - 1));
        const start = this.page * PAGE_SIZE;
        if (visible.length > PAGE_SIZE) {
            const nav = document.createElement('nav');
            nav.className = 'timeline-pagination';
            nav.setAttribute('aria-label', 'Action pages');
            const previous = document.createElement('button');
            previous.type = 'button';
            previous.className = 'btn btn-secondary';
            previous.textContent = 'Previous';
            previous.disabled = this.page === 0;
            previous.onclick = () => { this.page--; this.render(container, actions, filters, onSelect); };
            const status = document.createElement('span');
            status.setAttribute('aria-live', 'polite');
            status.textContent = `${start + 1}–${Math.min(start + PAGE_SIZE, visible.length)} of ${visible.length}`;
            const next = document.createElement('button');
            next.type = 'button';
            next.className = 'btn btn-secondary';
            next.textContent = 'Next';
            next.disabled = start + PAGE_SIZE >= visible.length;
            next.onclick = () => { this.page++; this.render(container, actions, filters, onSelect); };
            nav.append(previous, status, next);
            container.appendChild(nav);
        }
        if (!visible.length) {
            const empty = document.createElement('p');
            empty.className = 'empty-message';
            empty.textContent = 'No actions recorded';
            container.appendChild(empty);
        }
        for (const action of visible.slice(start, start + PAGE_SIZE)) {
            const row = document.createElement('button');
            row.type = 'button';
            row.className = 'paint-stroke-item explorer-action';
            row.textContent = `${action.time.toFixed(1)} Ma: ${action.desc} (${action.plateName})`;
            row.onclick = () => onSelect(action.plateId);
            container.appendChild(row);
        }
    }
}
