
import { TectonicPlate, MotionKeyframe, MotionSegment, GeometryStage, Coordinate, PlateEvent } from '../types';
import { ensureMotionModel } from '../motion/RotationModel';
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
    originalRef: MotionSegment | GeometryStage | MotionKeyframe | PlateEvent | TectonicPlate;
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

        // 2. Motion segments & shape stages (keyframe-less model).
        // ensureMotionModel materializes legacy keyframes once, so edits made
        // through the timeline always hit the authoritative arrays.
        const model = ensureMotionModel(plate);

        model.segments.forEach((segment, index) => {
            list.push({
                id: `motion-${segment.time}-${plate.id}`,
                plateId: plate.id,
                plateName: plate.name,
                time: segment.time,
                type: 'motion',
                label: prefix + `Motion #${index + 1}`,
                details: `${segment.eulerPole?.rate.toFixed(2)} deg/Ma`,
                isEditable: true,
                isDeletable: true,
                originalRef: segment
            });
        });

        model.stages.forEach((stage, index) => {
            if (index === 0) return; // birth geometry is represented by the Birth event
            list.push({
                id: `shape-${stage.time}-${plate.id}`,
                plateId: plate.id,
                plateName: plate.name,
                time: stage.time,
                type: 'shape',
                label: prefix + 'Shape Edit',
                details: `${stage.polygons.length} polygon(s)`,
                isEditable: true,
                isDeletable: true,
                originalRef: stage
            });
        });

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
            const kf = event.originalRef as MotionSegment;

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
                // Shift all motion segments and geometry stages
                const m = ensureMotionModel(targetPlate);
                m.segments.forEach((s: MotionSegment) => s.time += delta);
                m.stages.forEach((s: GeometryStage) => s.time += delta);

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
                            const sm = ensureMotionModel(sibling);
                            sm.segments.forEach((s: MotionSegment) => s.time += delta);
                            sm.stages.forEach((s: GeometryStage) => s.time += delta);
                            sibling.events.forEach((sevt: PlateEvent) => sevt.time += delta);
                        }
                    }
                }
            }
        }
        else if (event.type === 'motion') {
            const seg = event.originalRef as MotionSegment;
            oldInternalTime = seg.time;
            seg.time = newTime;
            ensureMotionModel(targetPlate).segments.sort((a: MotionSegment, b: MotionSegment) => a.time - b.time);
        }
        else if (event.type === 'shape') {
            const stage = event.originalRef as GeometryStage;
            oldInternalTime = stage.time;
            stage.time = newTime;
            ensureMotionModel(targetPlate).stages.sort((a: GeometryStage, b: GeometryStage) => a.time - b.time);
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
                    const cm = ensureMotionModel(child);
                    cm.segments.forEach(s => s.time += delta);
                    cm.stages.forEach(s => s.time += delta);
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

    private updateKeyframe(kf: MotionSegment, event: TimelineEventItem, changes: Partial<{ rate: number, position: Coordinate }>) {
        this.pushHistory();

        if (changes.rate !== undefined) kf.eulerPole.rate = changes.rate;
        if (changes.position !== undefined) kf.eulerPole.position = changes.position;

        const targetPlate = this.app?.state.world.plates.find((p: TectonicPlate) => p.id === event.plateId);

        // Keep plate.motion (speed inputs, gizmo, properties panel) in sync when
        // the edited segment is the one currently active
        if (targetPlate) {
            const t = this.app.state.world.currentTime;
            const active = [...ensureMotionModel(targetPlate).segments]
                .filter((s: MotionSegment) => s.time <= t)
                .sort((a: MotionSegment, b: MotionSegment) => b.time - a.time)[0];
            if (active === kf) {
                targetPlate.motion = { ...targetPlate.motion, eulerPole: { ...kf.eulerPole } };
            }
        }

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
            const seg = event.originalRef as MotionSegment;
            const m = ensureMotionModel(targetPlate);
            targetPlate.motionSegments = m.segments.filter((s: MotionSegment) => s !== seg);
        }
        else if (event.type === 'shape') {
            const stage = event.originalRef as GeometryStage;
            const m = ensureMotionModel(targetPlate);
            targetPlate.geometryStages = m.stages.filter((s: GeometryStage) => s !== stage);
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

    private triggerUpdate(_invalidationTime: number = 0, _targetPlate?: TectonicPlate) {
        // Keyframe-less model: geometry is derived, so timeline edits need no
        // rebaking — re-derive the world at the current time and re-render.
        if (this.simulationEngine && this.app?.state) {
            this.simulationEngine.setTime(this.app.state.world.currentTime);
        }
        this.render(this.plate);
    }

}
