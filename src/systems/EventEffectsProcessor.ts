import { AppState, Coordinate, Feature, TectonicPlate, EventConsequence, FeatureType } from '../types';
import { distance } from '../utils/sphericalMath';

interface FeaturePlacementContext {
    planetRadius: number;
    currentTime: number;
}

export class EventEffectsProcessor {
    public update(state: AppState): AppState {
        const events = state.world.tectonicEvents || [];
        const committedEvents = events.filter(e => e.committed);

        if (committedEvents.length === 0) return state;


        const planetRadius = state.world.globalOptions.customRadiusEnabled
            ? (state.world.globalOptions.customPlanetRadius || state.world.globalOptions.planetRadius)
            : state.world.globalOptions.planetRadius;

        const context: FeaturePlacementContext = {
            planetRadius,
            currentTime: state.world.currentTime
        };

        let plates = [...state.world.plates];

        for (const event of committedEvents) {
            const selectedConsequences = event.consequences.filter(c => c.selected);
            if (selectedConsequences.length === 0) continue;

            for (const consequence of selectedConsequences) {
                const featureEffect = consequence.effects?.find(e => e.kind === 'feature');
                if (!featureEffect?.featureType) continue;

                const targetPlateIds = this.getTargetPlateIds(event.plateIds, plates, consequence.type);
                if (targetPlateIds.length === 0) continue;

                const points = this.getFeaturePoints(event.boundarySegment, consequence, context);
                if (points.length === 0) continue;

                plates = plates.map(plate => {
                    if (!targetPlateIds.includes(plate.id)) return plate;



                    const hasEventFeatures = plate.features.some(f => this.isEventFeature(f, event.id, consequence.id));
                    if (hasEventFeatures) return plate;

                    const newFeatures = points.map(position => this.createEventFeature(
                        featureEffect.featureType as FeatureType,
                        position,
                        consequence,
                        event.id,
                        event.effectStartTime ?? event.commitTime ?? event.time
                    ));

                    return {
                        ...plate,
                        features: [...plate.features, ...newFeatures]
                    };
                });
            }
        }

        return {
            ...state,
            world: {
                ...state.world,
                plates
            }
        };
    }

    private getTargetPlateIds(plateIds: [string, string], plates: TectonicPlate[], consequenceType: string): string[] {
        const plateLookup = new Map(plates.map(p => [p.id, p]));
        const candidates = plateIds
            .map(id => plateLookup.get(id))
            .filter((p): p is TectonicPlate => !!p);

        const nonOceanic = candidates.filter(p => p.crustType !== 'oceanic').map(p => p.id);
        const oceanic = candidates.filter(p => p.crustType === 'oceanic').map(p => p.id);

        switch (consequenceType) {
            case 'trench':
                return oceanic.length > 0 ? oceanic : plateIds;
            case 'volcanic_arc':
            case 'accretionary_wedge':
            case 'back_arc_basin':
            case 'ophiolite_obduction':
                return nonOceanic.length > 0 ? nonOceanic : plateIds;
            case 'orogeny':
                return nonOceanic.length > 0 ? nonOceanic : plateIds;
            default:
                return plateIds;
        }
    }

    private getFeaturePoints(boundarySegments: Coordinate[][], consequence: EventConsequence, context: FeaturePlacementContext): Coordinate[] {
        const spacingKm = this.getSpacingForConsequence(consequence);
        const maxCount = this.getMaxCountForConsequence(consequence);
        return this.sampleBoundaryPoints(boundarySegments, spacingKm, maxCount, context.planetRadius);
    }

    private getSpacingForConsequence(consequence: EventConsequence): number {
        if (consequence.parameters.spacing) return Math.max(10, consequence.parameters.spacing);
        if (consequence.type === 'orogeny') return 80;
        if (consequence.type === 'rift_valley') return 60;
        if (consequence.type === 'trench') return 70;
        return 90;
    }

    private getMaxCountForConsequence(consequence: EventConsequence): number | undefined {
        if (consequence.parameters.volcanoCount) return Math.max(1, Math.round(consequence.parameters.volcanoCount));
        return undefined;
    }

    private sampleBoundaryPoints(
        boundarySegments: Coordinate[][],
        spacingKm: number,
        maxCount: number | undefined,
        planetRadius: number
    ): Coordinate[] {
        const points: Coordinate[] = [];

        for (const segment of boundarySegments) {
            if (segment.length < 2) continue;

            for (let i = 0; i < segment.length - 1; i++) {
                const a = segment[i];
                const b = segment[i + 1];
                const distKm = distance(a, b) * planetRadius;
                if (distKm === 0) continue;

                const steps = Math.max(1, Math.floor(distKm / spacingKm));
                for (let s = 0; s <= steps; s++) {
                    const t = steps === 0 ? 0 : s / steps;
                    points.push(this.lerpCoordinate(a, b, t));
                }
            }
        }

        if (points.length === 0) return points;

        if (maxCount && points.length > maxCount) {
            const sampled: Coordinate[] = [];
            const step = (points.length - 1) / Math.max(1, maxCount - 1);
            for (let i = 0; i < maxCount; i++) {
                sampled.push(points[Math.round(i * step)]);
            }
            return sampled;
        }

        return points;
    }

    private lerpCoordinate(a: Coordinate, b: Coordinate, t: number): Coordinate {
        let lon1 = a[0];
        let lon2 = b[0];
        const lat1 = a[1];
        const lat2 = b[1];

        if (Math.abs(lon2 - lon1) > 180) {
            if (lon2 > lon1) lon1 += 360;
            else lon2 += 360;
        }

        let lon = lon1 + (lon2 - lon1) * t;
        if (lon > 180) lon -= 360;
        if (lon < -180) lon += 360;

        const lat = lat1 + (lat2 - lat1) * t;
        return [lon, lat];
    }

    private createEventFeature(
        type: FeatureType,
        position: Coordinate,
        consequence: EventConsequence,
        eventId: string,
        eventTime: number
    ): Feature {
        return {
            id: `${eventId}-${consequence.id}-${Math.random().toString(36).slice(2, 8)}`,
            type,
            position,
            originalPosition: position,
            rotation: 0,
            scale: 1,
            properties: {
                source: 'event',
                eventId,
                consequenceId: consequence.id,
                consequenceType: consequence.type
            },
            generatedAt: eventTime
        };
    }

    private isEventFeature(feature: Feature, eventId: string, consequenceId: string): boolean {
        const props = feature.properties as Record<string, unknown> | undefined;
        return !!props && props.source === 'event' && props.eventId === eventId && props.consequenceId === consequenceId;
    }
}
