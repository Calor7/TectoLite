// History Manager for Undo/Redo functionality
import { AppState, EntityGroup } from './types';

export class HistoryManager {
    private history: AppState[] = [];
    private future: AppState[] = [];
    private maxHistory = 50;
    private isProcessing = false;

    /**
     * Push a new state to history (called after meaningful actions)
     */
    push(state: AppState): void {
        if (this.isProcessing) return;

        // Deep clone the state to prevent mutations
        this.history.push(this.cloneState(state));

        // Clear future when new action is taken
        this.future = [];

        // Limit history size
        if (this.history.length > this.maxHistory) {
            this.history.shift();
        }
    }

    /**
     * Undo: Pop from history, push current to future
     * Returns the previous state or null if nothing to undo
     */
    undo(currentState: AppState): AppState | null {
        if (this.history.length === 0) return null;

        this.isProcessing = true;

        // Save current state to future for redo
        this.future.push(this.cloneState(currentState));

        // Pop previous state from history
        const previousState = this.history.pop()!;

        this.isProcessing = false;

        return previousState;
    }

    /**
     * Redo: Pop from future, push current to history
     * Returns the next state or null if nothing to redo
     */
    redo(currentState: AppState): AppState | null {
        if (this.future.length === 0) return null;

        this.isProcessing = true;

        // Save current state to history
        this.history.push(this.cloneState(currentState));

        // Pop next state from future
        const nextState = this.future.pop()!;

        this.isProcessing = false;

        return nextState;
    }

    /**
     * Check if undo is available
     */
    canUndo(): boolean {
        return this.history.length > 0;
    }

    /**
     * Check if redo is available
     */
    canRedo(): boolean {
        return this.future.length > 0;
    }

    /**
     * Clear all history
     */
    clear(): void {
        this.history = [];
        this.future = [];
    }

    /**
     * Structural snapshot for undo/redo.
     *
     * The app still has some live in-place mutation paths, so a one-level shallow
     * clone is not safe yet. Clone mutable owner boundaries, but keep heavy
     * geometry coordinate arrays shared to avoid the old whole-world deep clone.
     */
    private cloneState(state: AppState): AppState {
        const cloneCoord = <T extends number[] | undefined>(coord: T): T =>
            (Array.isArray(coord) ? [...coord] : coord) as T;
        const cloneFeature = (feature: any) => ({
            ...feature,
            position: cloneCoord(feature.position),
            originalPosition: cloneCoord(feature.originalPosition),
            polygon: feature.polygon ? [...feature.polygon] : feature.polygon
        });
        const clonePlate = (plate: any) => ({
            ...plate,
            relativeEulerPole: plate.relativeEulerPole ? {
                ...plate.relativeEulerPole,
                position: cloneCoord(plate.relativeEulerPole.position)
            } : plate.relativeEulerPole,
            motionSegments: plate.motionSegments?.map((segment: any) => ({
                ...segment,
                eulerPole: {
                    ...segment.eulerPole,
                    position: cloneCoord(segment.eulerPole.position)
                }
            })) ?? [],
            geometryStages: plate.geometryStages?.map((stage: any) => ({
                ...stage,
                polygons: [...(stage.polygons ?? [])],
                features: (stage.features ?? []).map(cloneFeature)
            })) ?? [],
            polygons: [...(plate.polygons ?? [])],
            features: (plate.features ?? []).map(cloneFeature),
            initialPolygons: [...(plate.initialPolygons ?? [])],
            initialFeatures: (plate.initialFeatures ?? []).map(cloneFeature),
            parentPlateIds: plate.parentPlateIds ? [...plate.parentPlateIds] : plate.parentPlateIds,
            connectedRiftIds: [...(plate.connectedRiftIds ?? [])],
            events: (plate.events ?? []).map((event: any) => ({ ...event })),
            flowlinesTrailCache: plate.flowlinesTrailCache ? plate.flowlinesTrailCache.map((trail: any) => [...trail]) : plate.flowlinesTrailCache,
            center: cloneCoord(plate.center)
        });
        const cloneRiftAxis = (axis: any) => ({
            ...axis,
            birthPolyline: axis.birthPolyline ? [...axis.birthPolyline] : axis.birthPolyline,
            isochrons: (axis.isochrons ?? []).map((isochron: any) => ({
                ...isochron,
                polyline: isochron.polyline ? [...isochron.polyline] : isochron.polyline
            }))
        });
        const cloneTripleJunction = (junction: any) => ({
            ...junction,
            axisIds: [...(junction.axisIds ?? [])],
            axisJunctionAtStart: [...(junction.axisJunctionAtStart ?? [])],
            junctionHistory: junction.junctionHistory?.map((entry: any) => ({
                ...entry,
                point: cloneCoord(entry.point)
            }))
        });
        const world: any = state.world;
        const globalOptions = world.globalOptions ?? {};

        return {
            ...state,
            viewport: {
                ...state.viewport,
                rotate: cloneCoord(state.viewport.rotate),
                translate: cloneCoord(state.viewport.translate)
            },
            world: {
                ...world,
                plates: (world.plates ?? []).map(clonePlate),
                elevationZones: (world.elevationZones ?? []).map((zone: any) => ({
                    ...zone,
                    geometry: {
                        ...zone.geometry,
                        path: zone.geometry?.path?.map((point: any) => ({ ...point, position: cloneCoord(point.position) })),
                        rings: zone.geometry?.rings?.map((ring: any) => ring.map((point: any) => cloneCoord(point))),
                        clipMask: zone.geometry?.clipMask?.map((polygon: any) => polygon.map((ring: any) => ring.map((point: any) => cloneCoord(point))))
                        ,clipMasks: zone.geometry?.clipMasks?.map((mask: any) => mask.map((polygon: any) => polygon.map((ring: any) => ring.map((point: any) => cloneCoord(point)))))
                    }
                })),
                labels: (world.labels ?? []).map((label: any) => ({
                    ...label,
                    anchor: cloneCoord(label.anchor),
                    offset: cloneCoord(label.offset)
                })),
                entityGroups: (world.entityGroups ?? []).map((group: EntityGroup) => ({ ...group })),
                selectedFeatureIds: [...(world.selectedFeatureIds ?? [])],
                globalOptions: {
                    ...globalOptions,
                    ratePresets: globalOptions.ratePresets ? [...globalOptions.ratePresets] : globalOptions.ratePresets,
                    lineTypeDefaults: globalOptions.lineTypeDefaults
                        ? Object.fromEntries(Object.entries(globalOptions.lineTypeDefaults).map(([key, value]: [string, any]) => [
                            key,
                            { ...value, dash: [...(value.dash ?? [])] }
                        ]))
                        : globalOptions.lineTypeDefaults
                },
                riftAxes: world.riftAxes?.map(cloneRiftAxis),
                tripleJunctions: world.tripleJunctions?.map(cloneTripleJunction),
                boundaries: world.boundaries?.map((boundary: any) => ({
                    ...boundary,
                    points: boundary.points ? [...boundary.points] : boundary.points,
                    plateIds: boundary.plateIds ? [...boundary.plateIds] : boundary.plateIds,
                    polygonTypes: boundary.polygonTypes ? [...boundary.polygonTypes] : boundary.polygonTypes
                })),
                mantlePlumes: world.mantlePlumes?.map((plume: any) => ({
                    ...plume,
                    position: cloneCoord(plume.position)
                })),
                imageOverlay: world.imageOverlay ? { ...world.imageOverlay } : world.imageOverlay
            }
        };
    }
}
