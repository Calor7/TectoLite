
import { TectonicPlate, AppState, MotionKeyframe, Coordinate, PlateEvent } from '../types';
import { SimulationEngine } from '../SimulationEngine';
import { HistoryManager } from '../HistoryManager';

// Unified Event Interface for UI
export interface TimelineEventItem {
    id: string;
    time: number;
    type: 'birth' | 'motion' | 'split' | 'fuse' | 'death';
    label: string;
    details: string;
    isEditable: boolean;
    isDeletable: boolean;
    originalRef: MotionKeyframe | PlateEvent | TectonicPlate;
}

export class TimelineSystem {
    private container: HTMLElement | null = null;
    private plate: TectonicPlate | null = null;
    private onStateChange: ((newState: Partial<AppState>) => void) | null = null;
    private simulationEngine: SimulationEngine | null = null;
    private historyManager: HistoryManager | null = null;
    private app: any = null; // Reference to main app for state access if needed

    constructor(
        containerId: string,
        simulationEngine: SimulationEngine,
        historyManager: HistoryManager,
        app: any
    ) {
        this.simulationEngine = simulationEngine;
        this.historyManager = historyManager;
        this.app = app;

        // We defer finding the element until render, or user can pass element
        // But logic usually expects an ID or we create it.
        // For now, allow external "mount" or auto-lookup
    }

    public setContainer(container: HTMLElement) {
        this.container = container;
    }

    public render(plate: TectonicPlate | null) {
        if (!this.container) return;
        this.plate = plate;
        this.container.innerHTML = '';

        if (!plate) {
            const empty = document.createElement('div');
            empty.className = 'empty-message';
            empty.textContent = 'Select a plate to view history';
            this.container.appendChild(empty);
            return;
        }

        const list = document.createElement('div');
        list.className = 'timeline-list';

        const events = this.buildEventList(plate);

        events.forEach(event => {
            const item = this.createEventItem(event);
            list.appendChild(item);
        });

        this.container.appendChild(list);
    }

    private buildEventList(plate: TectonicPlate): TimelineEventItem[] {
        const list: TimelineEventItem[] = [];

        // 1. Birth Event
        list.push({
            id: 'birth-' + plate.id,
            time: plate.birthTime,
            type: 'birth',
            label: 'Plate Formed',
            details: `Born at ${plate.birthTime} Ma`,
            isEditable: true, // Advanced usage: Shift birth time
            isDeletable: false, // Cannot delete existence (unless deleting whole plate via delete tool)
            originalRef: plate
        });

        // 2. Motion Keyframes
        if (plate.motionKeyframes) {
            plate.motionKeyframes.forEach((kf, index) => {
                list.push({
                    id: `motion-${index}`,
                    time: kf.time,
                    type: 'motion',
                    label: 'Motion Change',
                    details: `${kf.eulerPole.rate.toFixed(2)} deg/Ma`,
                    isEditable: true,
                    isDeletable: true,
                    originalRef: kf
                });
            });
        }

        // 3. Split Events (found in events array)
        if (plate.events) {
            plate.events.filter(e => e.type === 'split').forEach(evt => {
                list.push({
                    id: evt.id,
                    time: evt.time,
                    type: 'split',
                    label: 'Plate Split',
                    details: 'Sub-plates created',
                    isEditable: true,
                    isDeletable: true,
                    originalRef: evt
                });
            });
        }

        // Sort by time
        return list.sort((a, b) => a.time - b.time);
    }

    private createEventItem(event: TimelineEventItem): HTMLElement {
        const item = document.createElement('div');
        item.className = `timeline-item type-${event.type}`;

        // Header
        const header = document.createElement('div');
        header.className = 'timeline-header';

        const timeBadge = document.createElement('span');
        timeBadge.className = 'timeline-time';
        timeBadge.textContent = event.time.toFixed(1);

        const label = document.createElement('span');
        label.className = 'timeline-label';
        label.textContent = event.label;

        const icon = document.createElement('span');
        icon.className = 'timeline-icon';
        icon.textContent = this.getIconForType(event.type);

        header.appendChild(icon);
        header.appendChild(timeBadge);
        header.appendChild(label);

        // Controls (Expandable)
        const content = document.createElement('div');
        content.className = 'timeline-content';

        // Time Input
        if (event.isEditable) {
            // Only show cascade option for Birth and Split and Fuse events where it matters most
            const showCascade = event.type === 'birth' || event.type === 'split' || event.type === 'fuse';

            const timeRow = this.createInputRow('Time', event.time, (val, cascade) => {
                this.updateEventTime(event, val, cascade);
            }, 1, showCascade);
            content.appendChild(timeRow);
        }

        // Specific fields based on type
        if (event.type === 'motion') {
            const kf = event.originalRef as MotionKeyframe;

            // Rate
            content.appendChild(this.createInputRow('Rate', kf.eulerPole.rate, (val) => {
                this.updateKeyframe(kf, { rate: val });
            }, 0.1));

            // Pole
            const poleRow = document.createElement('div');
            poleRow.className = 'timeline-row';

            const latInput = document.createElement('input');
            latInput.type = 'number';
            latInput.value = kf.eulerPole.position[1].toFixed(1);
            latInput.className = 'timeline-input-small';
            latInput.placeholder = 'Lat';

            const lonInput = document.createElement('input');
            lonInput.type = 'number';
            lonInput.value = kf.eulerPole.position[0].toFixed(1);
            lonInput.className = 'timeline-input-small';
            lonInput.placeholder = 'Lon';

            const updatePole = () => {
                const lat = parseFloat(latInput.value);
                const lon = parseFloat(lonInput.value);
                if (!isNaN(lat) && !isNaN(lon)) {
                    this.updateKeyframe(kf, { position: [lon, lat] });
                }
            };

            latInput.onchange = updatePole;
            lonInput.onchange = updatePole;

            poleRow.appendChild(document.createTextNode('Pole: '));
            poleRow.appendChild(latInput);
            poleRow.appendChild(lonInput);
            content.appendChild(poleRow);
        }

        // Delete Button
        if (event.isDeletable) {
            const delBtn = document.createElement('button');
            delBtn.className = 'btn-tiny-danger';
            delBtn.textContent = '×';
            delBtn.title = 'Delete Event';
            delBtn.onclick = (e) => {
                e.stopPropagation();
                this.deleteEvent(event);
            };
            header.appendChild(delBtn);
        }

        item.appendChild(header);
        item.appendChild(content);

        // Click to expand/collapse
        header.onclick = (e) => {
            if ((e.target as HTMLElement).tagName !== 'BUTTON' && (e.target as HTMLElement).tagName !== 'INPUT') {
                item.classList.toggle('expanded');
            }
        };

        return item;
    }

    private createInputRow(label: string, value: number, onChange: (val: number, cascade: boolean) => void, step = 1, showCascade = false): HTMLElement {
        const row = document.createElement('div');
        row.className = 'timeline-row';

        const lbl = document.createElement('span');
        lbl.className = 'timeline-row-label';
        lbl.textContent = label;

        const input = document.createElement('input');
        input.type = 'number';
        input.step = step.toString();
        input.value = value.toFixed(1);
        input.className = 'timeline-input';

        // Cascade Checkbox
        let cascadeCheckbox: HTMLInputElement | null = null;
        if (showCascade) {
            const cascadeWrapper = document.createElement('label');
            cascadeWrapper.style.display = 'flex';
            cascadeWrapper.style.alignItems = 'center';
            cascadeWrapper.style.marginLeft = '8px';
            cascadeWrapper.style.fontSize = '10px';
            cascadeWrapper.style.color = '#a6adc8';
            cascadeWrapper.title = 'Shift subsequent events';

            cascadeCheckbox = document.createElement('input');
            cascadeCheckbox.type = 'checkbox';
            cascadeCheckbox.checked = true; // Default to cascading
            cascadeCheckbox.style.marginRight = '4px';

            cascadeWrapper.appendChild(cascadeCheckbox);
            cascadeWrapper.appendChild(document.createTextNode('Cascade'));
            row.appendChild(lbl);
            row.appendChild(input);
            row.appendChild(cascadeWrapper);
        } else {
            row.appendChild(lbl);
            row.appendChild(input);
        }

        input.onchange = () => {
            const val = parseFloat(input.value);
            const cascade = cascadeCheckbox ? cascadeCheckbox.checked : false;
            if (!isNaN(val)) onChange(val, cascade);
        };

        return row;
    }

    private getIconForType(type: string): string {
        switch (type) {
            case 'birth': return '★';
            case 'motion': return '⟳';
            case 'split': return '✂';
            case 'fuse': return '🔗';
            case 'death': return '†';
            default: return '•';
        }
    }

    // --- Logic Handlers ---

    private pushHistory() {
        if (this.app) {
            this.app.pushState(); // Basic history hook
        }
    }

    private updateEventTime(event: TimelineEventItem, newTime: number, cascade: boolean) {
        this.pushHistory();

        if (event.type === 'birth') {
            const delta = newTime - (this.plate?.birthTime || 0);
            this.plate!.birthTime = newTime;

            if (cascade) {
                // Shift all keyframes
                this.plate!.motionKeyframes.forEach(kf => kf.time += delta);

                // Shift all events
                this.plate!.events.forEach(evt => evt.time += delta);
            }

            // BIDIRECTIONAL: If this plate is a child of a split, update parent and sibling
            if (this.plate?.parentPlateId && this.app && this.app.state) {
                const plates = this.app.state.world.plates as TectonicPlate[];
                const parent = plates.find(p => p.id === this.plate!.parentPlateId);
                if (parent) {
                    // 1. Update Parent's Death Time
                    parent.deathTime = newTime;

                    // 2. Update Parent's Split Event
                    const splitEvt = (parent.events || []).find(e => e.type === 'split' && Math.abs(e.time - (newTime - delta)) < 0.1);
                    if (splitEvt) {
                        splitEvt.time = newTime;
                    }

                    // 3. Update Sibling
                    const sibling = plates.find(p => p.id !== this.plate!.id && p.parentPlateId === parent.id && Math.abs(p.birthTime - (newTime - delta)) < 0.1);
                    if (sibling) {
                        sibling.birthTime = newTime;
                        if (cascade) {
                            sibling.motionKeyframes.forEach(skf => skf.time += delta);
                            sibling.events.forEach(sevt => sevt.time += delta);
                        }
                    }
                }
            }
        }
        else if (event.type === 'motion') {
            const kf = event.originalRef as MotionKeyframe;
            kf.time = newTime;
            // Sort keyframes after time change
            this.plate!.motionKeyframes.sort((a, b) => a.time - b.time);
        }
        else if (event.type === 'split') {
            const evt = event.originalRef as PlateEvent;
            const delta = newTime - evt.time;
            evt.time = newTime;

            // Update Parent's Death Time to match Split Time
            if (this.plate) {
                this.plate.deathTime = newTime;
            }

            // BIDIRECTIONAL: Update all children born from this split
            if (this.app && this.app.state) {
                const plates = this.app.state.world.plates as TectonicPlate[];
                const children = plates.filter(p => p.parentPlateId === this.plate!.id && Math.abs(p.birthTime - (newTime - delta)) < 0.1);

                children.forEach(child => {
                    child.birthTime = newTime;
                    if (cascade) {
                        child.motionKeyframes.forEach(ckf => ckf.time += delta);
                        child.events.forEach(cevt => cevt.time += delta);
                    }
                });
            }
        }

        else if (event.type === 'fuse') {
            const evt = event.originalRef as PlateEvent;
            evt.time = newTime;
        }

        this.triggerUpdate();
    }

    private updateKeyframe(kf: MotionKeyframe, changes: Partial<{ rate: number, position: Coordinate }>) {
        this.pushHistory();

        if (changes.rate !== undefined) kf.eulerPole.rate = changes.rate;
        if (changes.position !== undefined) kf.eulerPole.position = changes.position;

        this.triggerUpdate();
    }

    private deleteEvent(event: TimelineEventItem) {
        if (!confirm('Delete this event?')) return;
        this.pushHistory();

        if (event.type === 'motion') {
            const kf = event.originalRef as MotionKeyframe;
            this.plate!.motionKeyframes = this.plate!.motionKeyframes.filter(k => k !== kf);
        }
        else if (event.type === 'split') {
            // Delete split event
            const evt = event.originalRef as PlateEvent;
            this.plate!.events = this.plate!.events.filter(e => e !== evt);

            // Reset parent's deathTime if it matches the split event
            if (this.plate!.deathTime === evt.time) {
                this.plate!.deathTime = null;
            }

            // Delete children born from this split
            if (this.app && this.app.state) {
                const plates = this.app.state.world.plates as TectonicPlate[];
                // Identify children: Parent matches AND birthTime matches split time
                const children = plates.filter(p => p.parentPlateId === this.plate!.id && Math.abs(p.birthTime - evt.time) < 0.1);

                this.app.deletePlates(children.map(c => c.id));
            }
        }

        this.triggerUpdate();
    }

    private triggerUpdate() {
        if (this.plate && this.simulationEngine && this.app && this.app.state) {
            const plates = this.app.state.world.plates as TectonicPlate[];
            const affectedPlates: TectonicPlate[] = [this.plate];

            // If we are a child, parent and sibling are affected
            if (this.plate.parentPlateId) {
                const parent = plates.find(p => p.id === this.plate!.parentPlateId);
                if (parent) affectedPlates.push(parent);

                const sibling = plates.find(p => p.id !== this.plate!.id && p.parentPlateId === this.plate!.parentPlateId);
                if (sibling) affectedPlates.push(sibling);
            }

            // If we have children (from split), they are affected
            const children = plates.filter(p => p.parentPlateId === this.plate!.id);
            affectedPlates.push(...children);

            // 1. Recalculate Physics for all affected
            affectedPlates.forEach(p => {
                const updated = this.simulationEngine!.recalculateMotionHistory(p);
                // 2. Update Main State (replace plate)
                if (this.app.replacePlate) {
                    this.app.replacePlate(updated);
                }
            });

            this.render(this.plate); // Re-render the UI for current plate
        }
    }
}
