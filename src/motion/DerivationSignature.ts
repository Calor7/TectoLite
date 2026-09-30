import type { Coordinate, Feature, TectonicPlate } from '../types';

export function derivationStateSignature(plates: TectonicPlate[]): string {
    let hash = 2166136261;
    // Hash the actual numeric bits. Formatting every historical coordinate on
    // every frame dominates large-save scrubbing and rounds away small edits.
    const numberValue = new Float64Array(1);
    const numberBits = new Uint32Array(numberValue.buffer);
    const mixText = (value: string | undefined | null) => {
        const text = value ?? '';
        for (let i = 0; i < text.length; i++) {
            hash ^= text.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }
    };
    const mixNumber = (value: number | undefined | null) => {
        numberValue[0] = value === undefined || value === null || !Number.isFinite(value) ? NaN : value;
        hash = Math.imul(hash ^ numberBits[0], 16777619);
        hash = Math.imul(hash ^ numberBits[1], 16777619);
    };
    const mixCoord = (coord: Coordinate | undefined | null) => {
        if (!coord) {
            mixText('');
            return;
        }
        mixNumber(coord[0]);
        mixNumber(coord[1]);
    };
    const mixCoords = (coords: Coordinate[] | undefined) => {
        mixNumber(coords?.length ?? 0);
        for (const coord of coords ?? []) mixCoord(coord);
    };
    const mixFeature = (feature: Feature) => {
        mixText(feature.id);
        mixText(feature.type);
        mixCoord(feature.position);
        mixCoord(feature.originalPosition);
        mixNumber(feature.generatedAt);
        mixNumber(feature.deathTime);
        mixNumber(feature.rotation);
        mixNumber(feature.scale);
        mixText(feature.fillColor);
        mixCoords(feature.polygon);
    };

    for (const plate of plates) {
        mixText(plate.id);
        mixText(plate.parentPlateId);
        for (const parentId of plate.parentPlateIds ?? []) mixText(parentId);
        mixText(plate.linkedToPlateId);
        mixNumber(plate.linkTime);
        mixNumber(plate.unlinkTime);
        mixCoord(plate.relativeEulerPole?.position);
        mixNumber(plate.relativeEulerPole?.rate);
        mixNumber(plate.birthTime);
        mixNumber(plate.deathTime);
        mixNumber(plate.motionSegments.length);
        for (const segment of plate.motionSegments) {
            mixNumber(segment.time);
            mixCoord(segment.eulerPole.position);
            mixNumber(segment.eulerPole.rate);
        }
        mixNumber(plate.geometryStages.length);
        for (const stage of plate.geometryStages) {
            mixNumber(stage.time);
            mixText(stage.interpolation);
            mixNumber(stage.polygons.length);
            for (const polygon of stage.polygons) {
                mixText(polygon.id);
                mixText(String(polygon.closed));
                mixCoords(polygon.points);
            }
            mixNumber(stage.features.length);
            for (const feature of stage.features) mixFeature(feature);
        }
        mixNumber(plate.features.length);
        for (const feature of plate.features) mixFeature(feature);
    }

    return (hash >>> 0).toString(36);
}
