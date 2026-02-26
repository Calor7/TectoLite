// Event System - Event-Driven Guided Creation
// Detects significant plate interactions and generates TectonicEvents for user decision

import {
    AppState,
    TectonicEvent,
    TectonicEventType,
    EventConsequence,
    PlateSnapshot,
    Boundary,
    Coordinate,
    generateId,
    COLLISION_CONSEQUENCES,
    RIFT_CONSEQUENCES,
    TectonicPlate
} from '../types';

// Velocity conversion: rad/Ma to cm/yr (approximate)
const RAD_MA_TO_CM_YR = 60; // 1 rad/Ma ≈ 60 cm/yr at surface

/**
 * EventSystem: Detects and manages tectonic events for guided creation workflow
 * 
 * Philosophy:
 * - Events are SNAPSHOTS - once committed, they don't recalculate
 * - Mesh only reacts to EVENTS + EROSION, not continuous plate contact
 * - User chooses consequences via popup (guided creation mode)
 */
export class EventSystem {
    // Track which plate pairs have active events at which times to avoid duplicates
    private processedInteractions: Map<string, { time: number; eventId: string }> = new Map();

    constructor() { }

    /**
     * Main update - detect new events from boundary changes
     * Only triggers when guided creation is enabled AND significant changes occur
     */
    public update(state: AppState): AppState {
        const { globalOptions, boundaries, tectonicEvents = [], pendingEventId } = state.world;

        // Skip if guided creation disabled OR if there's already a pending popup
        if (!globalOptions.enableGuidedCreation || pendingEventId) {
            return state;
        }

        // Need boundaries to detect events
        if (!boundaries || boundaries.length === 0) {
            return state;
        }

        const currentTime = state.world.currentTime;
        const threshold = globalOptions.eventDetectionThreshold || 20;

        let newState = { ...state };
        let newEvents = [...tectonicEvents];
        let newPendingEventId: string | null = null;

        // Check each boundary for significant interaction
        for (const boundary of boundaries) {
            // Skip transform boundaries (no major geological consequences)
            if (boundary.type === 'transform') continue;

            const pairKey = this.getPairKey(boundary.plateIds[0], boundary.plateIds[1]);
            const existing = this.processedInteractions.get(pairKey);

            // Check if this is a NEW significant interaction
            const isNewInteraction = !existing || this.isSignificantChange(existing, boundary, threshold, currentTime);

            if (isNewInteraction) {
                // Get plates for snapshot
                const plate1 = state.world.plates.find(p => p.id === boundary.plateIds[0]);
                const plate2 = state.world.plates.find(p => p.id === boundary.plateIds[1]);

                if (!plate1 || !plate2) continue;

                // Determine event type
                const eventType: TectonicEventType = boundary.type === 'convergent' ? 'collision' : 'rift';

                // Create the event
                const event = this.createEvent(
                    eventType,
                    plate1,
                    plate2,
                    boundary,
                    currentTime
                );

                newEvents.push(event);
                this.processedInteractions.set(pairKey, { time: currentTime, eventId: event.id });

                // Set as pending for popup (only first event)
                if (!newPendingEventId) {
                    newPendingEventId = event.id;
                }
            }
        }

        // Update state if new events were created
        if (newEvents.length !== tectonicEvents.length) {
            newState = {
                ...newState,
                world: {
                    ...newState.world,
                    tectonicEvents: newEvents,
                    pendingEventId: newPendingEventId
                }
            };
        }

        return newState;
    }

    /**
     * Create a TectonicEvent from boundary detection
     */
    private createEvent(
        eventType: TectonicEventType,
        plate1: TectonicPlate,
        plate2: TectonicPlate,
        boundary: Boundary,
        currentTime: number
    ): TectonicEvent {
        const velocity = (boundary.velocity || 0) * RAD_MA_TO_CM_YR;
        const effectDuration = this.calculateDefaultEffectDuration(eventType, velocity, boundary.overlapArea || 0);

        // Create plate snapshots
        const snapshot1 = this.createPlateSnapshot(plate1, velocity, currentTime);
        const snapshot2 = this.createPlateSnapshot(plate2, velocity, currentTime);

        // Determine collision type for collisions
        let collisionType: 'continent-continent' | 'continent-ocean' | 'ocean-ocean' | undefined;
        if (eventType === 'collision') {
            const isOcean1 = plate1.polygonType === 'oceanic_plate';
            const isOcean2 = plate2.polygonType === 'oceanic_plate';
            if (!isOcean1 && !isOcean2) collisionType = 'continent-continent';
            else if (isOcean1 && isOcean2) collisionType = 'ocean-ocean';
            else collisionType = 'continent-ocean';
        }

        // Get consequence templates based on event type
        const consequenceTemplates = eventType === 'collision'
            ? COLLISION_CONSEQUENCES
            : RIFT_CONSEQUENCES;

        // Create consequences with unique IDs and parameter defaults scaled to event
        const consequences: EventConsequence[] = consequenceTemplates.map(template => ({
            ...template,
            id: generateId(),
            // Scale default parameters based on event characteristics
            parameters: this.scaleParameters(template.defaultParameters, velocity, boundary.overlapArea || 0),
            defaultParameters: this.scaleParameters(template.defaultParameters, velocity, boundary.overlapArea || 0)
        }));

        return {
            id: generateId(),
            time: currentTime,
            eventType,
            plateIds: [plate1.id, plate2.id],
            plateSnapshots: [snapshot1, snapshot2],
            boundarySegment: boundary.points,
            interactionInfo: {
                collisionType,
                relativeVelocity: velocity,
                overlapArea: boundary.overlapArea
            },
            consequences,
            committed: false,
            effectStartTime: currentTime,
            effectEndTime: currentTime + effectDuration
        };
    }

    private calculateDefaultEffectDuration(
        eventType: TectonicEventType,
        velocity: number,
        overlapArea: number
    ): number {
        const base = eventType === 'collision' ? 5 : 8;
        const velocityFactor = Math.max(0.5, Math.min(2, 5 / Math.max(velocity, 1)));
        const areaFactor = Math.max(0.5, Math.min(2, (overlapArea || 50) / 50));
        const duration = base * velocityFactor * areaFactor;
        return Math.max(1, Math.round(duration * 10) / 10);
    }

    /**
     * Create a snapshot of plate data at event time
     */
    private createPlateSnapshot(plate: TectonicPlate, velocity: number, currentTime: number): PlateSnapshot {
        // Calculate approximate area (sum of polygon areas)
        let area = 0;
        for (const poly of plate.polygons) {
            area += this.approximatePolygonArea(poly.points);
        }

        return {
            id: plate.id,
            name: plate.name,
            polygonType: plate.polygonType,
            color: plate.color,
            velocity: velocity,
            age: currentTime - plate.birthTime,
            area: Math.round(area * 100) / 100,
            description: plate.description
        };
    }

    /**
     * Approximate polygon area using shoelace formula (degrees²)
     */
    private approximatePolygonArea(points: Coordinate[]): number {
        if (points.length < 3) return 0;
        let area = 0;
        for (let i = 0; i < points.length; i++) {
            const j = (i + 1) % points.length;
            area += points[i][0] * points[j][1];
            area -= points[j][0] * points[i][1];
        }
        return Math.abs(area / 2);
    }

    /**
     * Scale consequence parameters based on event characteristics
     */
    private scaleParameters(
        defaults: Record<string, number>,
        velocity: number,
        overlapArea: number
    ): Record<string, number> {
        const scaled = { ...defaults };
        const velocityFactor = Math.max(0.5, Math.min(2, velocity / 5)); // Scale around 5 cm/yr
        const areaFactor = Math.max(0.5, Math.min(2, overlapArea / 100)); // Scale around 100 deg²

        // Scale relevant parameters
        if ('upliftRate' in scaled) scaled.upliftRate *= velocityFactor;
        if ('width' in scaled) scaled.width *= areaFactor;
        if ('peakElevation' in scaled) scaled.peakElevation *= velocityFactor;
        if ('volcanoCount' in scaled) scaled.volcanoCount = Math.round(scaled.volcanoCount * areaFactor);
        if ('depth' in scaled) scaled.depth *= velocityFactor;

        // Round all values
        for (const key of Object.keys(scaled)) {
            scaled[key] = Math.round(scaled[key] * 100) / 100;
        }

        return scaled;
    }

    /**
     * Check if a boundary change is significant enough to warrant a new event
     */
    private isSignificantChange(
        existing: { time: number; eventId: string },
        _boundary: Boundary,
        _threshold: number,
        currentTime: number
    ): boolean {
        // If more than 10Ma has passed, allow new event for same pair
        if (currentTime - existing.time > 10) {
            return true;
        }

        // For now, don't re-trigger events for same pair within 10Ma
        // Future: could compare overlap areas for significant changes
        return false;
    }

    /**
     * Generate consistent key for plate pair (order-independent)
     */
    private getPairKey(id1: string, id2: string): string {
        return id1 < id2 ? `${id1}:${id2}` : `${id2}:${id1}`;
    }

    /**
     * Commit an event with selected consequences
     * Called from UI when user confirms popup
     */
    public commitEvent(
        state: AppState,
        eventId: string,
        selectedConsequences: EventConsequence[],
        effectTiming?: { effectStartTime?: number; effectEndTime?: number }
    ): AppState {
        const events = state.world.tectonicEvents || [];
        const eventIndex = events.findIndex(e => e.id === eventId);

        if (eventIndex === -1) return state;

        const updatedEvents = [...events];
        const baseEvent = updatedEvents[eventIndex];
        updatedEvents[eventIndex] = {
            ...baseEvent,
            consequences: selectedConsequences,
            committed: true,
            commitTime: state.world.currentTime,
            effectStartTime: effectTiming?.effectStartTime ?? baseEvent.effectStartTime ?? baseEvent.time,
            effectEndTime: effectTiming?.effectEndTime ?? baseEvent.effectEndTime ?? baseEvent.time
        };

        return {
            ...state,
            world: {
                ...state.world,
                tectonicEvents: updatedEvents,
                pendingEventId: null
            }
        };
    }

    /**
     * Dismiss an event without committing (skip)
     */
    public dismissEvent(state: AppState, _eventId: string): AppState {
        return {
            ...state,
            world: {
                ...state.world,
                pendingEventId: null
            }
        };
    }

    /**
     * Re-open a committed event for editing
     */
    public reopenEvent(state: AppState, eventId: string): AppState {
        const events = state.world.tectonicEvents || [];
        const event = events.find(e => e.id === eventId);

        if (!event || !event.committed) return state;

        // Only allow if repopup setting is enabled
        if (!state.world.globalOptions.repopupCommittedEvents) return state;

        return {
            ...state,
            world: {
                ...state.world,
                pendingEventId: eventId
            }
        };
    }

    /**
     * Get all events for a specific plate
     */
    public getEventsForPlate(state: AppState, plateId: string): TectonicEvent[] {
        const events = state.world.tectonicEvents || [];
        return events.filter(e => e.plateIds.includes(plateId));
    }

    /**
     * Get committed events that should affect elevation
     */
    public getCommittedEvents(state: AppState): TectonicEvent[] {
        const events = state.world.tectonicEvents || [];
        return events.filter(e => e.committed);
    }

    /**
     * Clear interaction cache (e.g., when loading a new project)
     */
    public clearCache(): void {
        this.processedInteractions.clear();
    }

    // ========================================================================
    // PLACEHOLDER: Manual Event Tool (Coming Soon)
    // ========================================================================

    /**
     * [PLACEHOLDER] Create a manual event at a specific location
     * This will be used by the future Event Tool for placing custom events
     * like meteorite impacts, volcanic hotspots, etc.
     * 
     * @param _state Current app state
     * @param _eventType Type of event to create
     * @param _position Geographic position for the event
     * @param _affectedPlateIds Plates that should be affected
     * @returns Updated state with new event (NOT YET IMPLEMENTED)
     */
    public createManualEvent(
        _state: AppState,
        _eventType: TectonicEventType | 'meteorite' | 'supervolcano',
        _position: Coordinate,
        _affectedPlateIds: string[]
    ): AppState {
        // TODO: Implement manual event creation
        // This placeholder establishes the architecture for the future Event Tool
        console.warn('[EventSystem] Manual event creation not yet implemented');
        return _state;
    }
}

// Export singleton instance
export const eventSystem = new EventSystem();
