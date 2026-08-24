import type { TectonicPlate } from '../types';

/** True when an entity exists at the requested geological time. */
export function isPlateActiveAtTime(plate: Pick<TectonicPlate, 'birthTime' | 'deathTime'>, time: number): boolean {
    return plate.birthTime <= time && (plate.deathTime === null || plate.deathTime > time);
}

export function isFeatureActiveAtTime(feature: { generatedAt?: number; deathTime?: number | null }, time: number): boolean {
    return (feature.generatedAt === undefined || feature.generatedAt <= time)
        && (feature.deathTime === undefined || feature.deathTime === null || feature.deathTime > time);
}
