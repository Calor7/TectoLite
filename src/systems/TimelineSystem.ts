
import { TectonicPlate, MotionKeyframe, Coordinate, PlateEvent } from '../types';
import { SimulationEngine } from '../SimulationEngine';
import { HistoryManager } from '../HistoryManager';
// import toDisplayTime, toInternalTime removed


// Unified Event Interface for UI
export interface TimelineEventItem {
    id: string;
    plateId: string;
    plateName: string;
    time: number;
    type: 'birth' | 'motion' | 'split' | 'fuse' | 'death' | 'shape';
    label: string;
    details: string;
    isEditable: boolean;
    isDeletable: boolean;
    originalRef: MotionKeyframe | PlateEvent | TectonicPlate;
}

const EVENT_ICONS: Record<string, string> = {
    birth: '★',
    motion: '⟳',
    split: '✂',
    fuse: '🔗',
    death: '†'
};

export class TimelineSystem {
    private container: HTMLElement | null = null;
    private plate: TectonicPlate | null = null;
    private simulationEngine: SimulationEngine | null = null;
    private app: any = null; // Reference to main app for state access if needed

    constructor(
        _containerId: string,
        simulationEngine: SimulationEngine,
        _historyManager: HistoryManager,
        app: any
    ) {
        this.simulationEngine = simulationEngine;
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

        const list = document.createElement('div');
        list.className = 'timeline-list';

        let events: TimelineEventItem[] = [];
        if (plate) {
            events = this.buildEventList(plate);
        } else if (this.app?.state?.world?.plates) {
            // Show all events from all plates
            const allPlates = this.app.state.world.plates as TectonicPlate[];
            allPlates.forEach((p: TectonicPlate) => {
                events.push(...this.buildEventList(p));
            });
            events.sort((a, b) => a.time - b.time);
        }

        if (events.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'empty-message';
            empty.textContent = 'No events recorded.';
            this.container.appendChild(empty);
            return;
        }

        events.forEach(event => {
            const item = this.createEventItem(event);
            list.appendChild(item);
        });

        this.container.appendChild(list);
    }

    private buildEventList(plate: TectonicPlate): TimelineEventItem[] {
        const list: TimelineEventItem[] = [];
        const prefix = !this.plate ? `[${plate.name}] ` : '';

        // 1. Birth Event
        list.push({
            id: 'birth-' + plate.id,
            plateId: plate.id,
            plateName: plate.name,
            time: plate.birthTime,
            type: 'birth',
            label: prefix + 'Plate Formed',
            details: `Born at ${plate.birthTime} Ma`,
            isEditable: true, // Advanced usage: Shift birth time
            isDeletable: true, // Allow deleting plate via its birth event
            originalRef: plate
        });

        // 2. Motion/Shape Keyframes
        if (plate.motionKeyframes) {
            plate.motionKeyframes.forEach((kf, index) => {
                // Determine if this is primarily a motion change or just a shape snapshot
                // Heuristic: If it has user-defined name or type, use it. 
                // For now, assume it's "Motion Change" if rate > 0 ?? Not reliable.
                // Or check if this keyframe was created by the Edit tool which might flag it?
                // Actually, every keyframe defines motion and shape.
                // Let's call it "Motion & Shape" or just "Keyframe".
                // But user asked for specific distinction if it's an "Event". 

                let label = kf.label || `Keyframe #${index + 1}`;
                let type: 'motion' | 'shape' = 'motion';

                if (kf.label === 'Edit') {
                    type = 'shape';
                }

                list.push({
                    id: `motion-${kf.time}-${plate.id}`,
                    plateId: plate.id,
                    plateName: plate.name,
                    time: kf.time,
                    type: type, // Or 'shape' if we can detect
                    label: prefix + label,
                    details: `${kf.eulerPole?.rate.toFixed(2)} deg/Ma`,
                    isEditable: true,
                    isDeletable: true,
                    originalRef: kf
                });
            });
        }

        // 3. Split Events (found in events array)
        if (plate.events) {
            plate.events.forEach(evt => {
                if (evt.type === 'split') {
                    list.push({
                        id: evt.id,
                        plateId: plate.id,
                        plateName: plate.name,
                        time: evt.time,
                        type: 'split',
                        label: prefix + 'Plate Split',
                        details: 'Sub-plates created',
                        isEditable: true,
                        isDeletable: true,
                        originalRef: evt
                    });
                } else if (evt.type === 'fusion') {
                    list.push({
                        id: evt.id,
                        plateId: plate.id,
                        plateName: plate.name,
                        time: evt.time,
                        type: 'fuse',
                        label: prefix + 'Plate Fusion',
                        details: 'Plate fused',
                        isEditable: true,
                        isDeletable: true,
                        originalRef: evt
                    });
                }
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

        // Apply display transformation based on app's time mode
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
                this.updateKeyframe(kf, event, { rate: val });
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
                    this.updateKeyframe(kf, event, { position: [lon, lat] });
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
        return EVENT_ICONS[type] || '•';
    }

    // --- Logic Handlers ---

    private pushHistory() {
        if (this.app) {
            this.app.pushState(); // Basic history hook
        }
    }

    private updateEventTime(event: TimelineEventItem, newTime: number, cascade: boolean) {
        const internalTime = newTime;

        if (!this.app?.state) return;
        const targetPlate = this.app.state.world.plates.find((p: TectonicPlate) => p.id === event.plateId);
        if (!targetPlate) return;

        this.pushHistory();

        let oldInternalTime = internalTime;
        if (event.type === 'birth') {
            oldInternalTime = (event.originalRef as TectonicPlate).birthTime;
            const delta = internalTime - targetPlate.birthTime;
            targetPlate.birthTime = internalTime;

            if (cascade) {
                // Shift all keyframes
                targetPlate.motionKeyframes.forEach((kf: MotionKeyframe) => kf.time += delta);

                // Shift all events
                targetPlate.events.forEach((evt: PlateEvent) => evt.time += delta);
            }

            // BIDIRECTIONAL: If this plate is a child of a split, update parent and sibling
            if (targetPlate.parentPlateId) {
                const plates = this.app.state.world.plates as TectonicPlate[];
                const parent = plates.find((p: TectonicPlate) => p.id === targetPlate.parentPlateId);
                if (parent) {
                    // 1. Update Parent's Death Time
                    parent.deathTime = internalTime;

                    // 2. Update Parent's Split Event
                    const splitEvt = (parent.events || []).find(e => e.type === 'split' && Math.abs(e.time - (internalTime - delta)) < 0.1);
                    if (splitEvt) {
                        splitEvt.time = internalTime;
                    }

                    // 3. Update Sibling
                    const sibling = plates.find((p: TectonicPlate) => p.id !== targetPlate.id && p.parentPlateId === parent.id && Math.abs(p.birthTime - (internalTime - delta)) < 0.1);
                    if (sibling) {
                        sibling.birthTime = internalTime;
                        if (cascade) {
                            sibling.motionKeyframes.forEach((skf: MotionKeyframe) => skf.time += delta);
                            sibling.events.forEach((sevt: PlateEvent) => sevt.time += delta);
                        }
                    }
                }
            }
        }
        else if (event.type === 'motion') {
            const kf = event.originalRef as MotionKeyframe;
            oldInternalTime = kf.time;
            kf.time = newTime;
            // Sort keyframes after time change
            targetPlate.motionKeyframes.sort((a: MotionKeyframe, b: MotionKeyframe) => a.time - b.time);
        }
        else if (event.type === 'split') {
            const evt = event.originalRef as PlateEvent;
            oldInternalTime = evt.time;
            const delta = newTime - evt.time;
            evt.time = newTime;

            // Update Parent's Death Time to match Split Time
            targetPlate.deathTime = newTime;

            // BIDIRECTIONAL: Update all children born from this split
            const plates = this.app.state.world.plates as TectonicPlate[];
            const children = plates.filter((p: TectonicPlate) => p.parentPlateId === targetPlate.id && Math.abs(p.birthTime - (newTime - delta)) < 0.1);

            children.forEach((child: TectonicPlate) => {
                child.birthTime = newTime;
                if (cascade) {
                    child.motionKeyframes.forEach(ckf => ckf.time += delta);
                    child.events.forEach(cevt => cevt.time += delta);
                }
            });
        }
        else if (event.type === 'fuse') {
            const evt = event.originalRef as PlateEvent;
            oldInternalTime = evt.time;
            evt.time = newTime;
        }

        // Invalidate history from the earlier of the two times (old or new)
        const invalidationTime = Math.min(oldInternalTime, internalTime);
        this.triggerUpdate(invalidationTime, targetPlate);
    }

    private updateKeyframe(kf: MotionKeyframe, event: TimelineEventItem, changes: Partial<{ rate: number, position: Coordinate }>) {
        this.pushHistory();

        if (changes.rate !== undefined) kf.eulerPole.rate = changes.rate;
        if (changes.position !== undefined) kf.eulerPole.position = changes.position;

        const targetPlate = this.app?.state.world.plates.find((p: TectonicPlate) => p.id === event.plateId);
        this.triggerUpdate(kf.time, targetPlate);
    }

    private deleteEvent(event: TimelineEventItem) {
        if (!this.app || !this.app.showModal) {
            if (confirm('Delete this event?')) {
                this.performDeleteEvent(event);
            }
            return;
        }

        this.app.showModal({
            title: 'Delete Event',
            content: 'Are you sure you want to delete this event?',
            buttons: [
                {
                    text: 'Delete',
                    subtext: 'This action cannot be undone.',
                    onClick: () => {
                        this.performDeleteEvent(event);
                    }
                },
                {
                    text: 'Cancel',
                    isSecondary: true,
                    onClick: () => { }
                }
            ]
        });
    }

    private performDeleteEvent(event: TimelineEventItem) {
        this.pushHistory();

        const targetPlate = this.app?.state?.world?.plates.find((p: TectonicPlate) => p.id === event.plateId);
        if (!targetPlate && event.type !== 'birth') return;

        if (event.type === 'birth') {
            const p = event.originalRef as TectonicPlate;
            this.app.deletePlates([p.id]);
            return; // Early return as the plate (and this timeline) is gone
        }

        if (event.type === 'motion') {
            const kf = event.originalRef as MotionKeyframe;
            targetPlate.motionKeyframes = targetPlate.motionKeyframes.filter((k: MotionKeyframe) => k !== kf);
        }
        else if (event.type === 'split') {
            // Delete split event
            const evt = event.originalRef as PlateEvent;
            targetPlate.events = targetPlate.events.filter((e: PlateEvent) => e !== evt);

            // Reset parent's deathTime if it matches the split event
            if (targetPlate.deathTime === evt.time) {
                targetPlate.deathTime = null;
            }

            // Delete children born from this split
            if (this.app && this.app.state) {
                const plates = this.app.state.world.plates as TectonicPlate[];
                // Identify children: Parent matches AND birthTime matches split time
                const children = plates.filter((p: TectonicPlate) => p.parentPlateId === targetPlate.id && Math.abs(p.birthTime - evt.time) < 0.1);

                this.app.deletePlates(children.map((c: TectonicPlate) => c.id));
            }
        }

        this.triggerUpdate(event.time, targetPlate);
    }

    private triggerUpdate(invalidationTime: number = 0, targetPlate?: TectonicPlate) {
        const plateToUpdate = targetPlate || this.plate;
        if (plateToUpdate && this.simulationEngine && this.app && this.app.state) {
            const plates = this.app.state.world.plates as TectonicPlate[];
            const affectedPlates: TectonicPlate[] = [plateToUpdate];

            // If we are a child, parent and sibling are affected
            if (plateToUpdate.parentPlateId) {
                const parent = plates.find((p: TectonicPlate) => p.id === plateToUpdate.parentPlateId);
                if (parent) affectedPlates.push(parent);

                const sibling = plates.find((p: TectonicPlate) => p.id !== plateToUpdate.id && p.parentPlateId === plateToUpdate.parentPlateId);
                if (sibling) affectedPlates.push(sibling);
            }

            // If we have children (from split), they are affected
            const children = plates.filter((p: TectonicPlate) => p.parentPlateId === plateToUpdate.id);
            affectedPlates.push(...children);

            // 1. Recalculate Physics for all affected
            affectedPlates.forEach((p: TectonicPlate) => {
                const updated = this.simulationEngine!.recalculateMotionHistory(p);
                // 2. Update Main State (replace plate)
                // Also pass invalidationTime to prune future orogeny strokes from this point onward
                if (this.app.replacePlate) {
                    this.app.replacePlate(updated, invalidationTime);
                }
            });

            this.render(this.plate); // Re-render the UI for current plate
        }
    }

}
