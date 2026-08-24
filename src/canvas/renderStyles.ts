import {
    LineType,
    TectonicPlate,
    resolveLineTypeDefaults,
    type Feature,
    type GlobalOptions,
} from '../types';

/** Null means hidden; a reduced value means an opt-in future/past preview. */
export function resolveFeatureTimelineOpacity(
    feature: Pick<Feature, 'generatedAt' | 'deathTime'>,
    time: number,
    showOutsideTimeline: boolean
): number | null {
    const beforeBirth = feature.generatedAt !== undefined && time < feature.generatedAt;
    const afterDeath = feature.deathTime !== undefined && time >= feature.deathTime;
    if (!beforeBirth && !afterDeath) return 1;
    return showOutsideTimeline ? 0.28 : null;
}

/**
 * Default render strata. A user can still move an entity across strata with a
 * sufficiently large positive/negative z-index, but an unconfigured line must
 * not disappear beneath an unconfigured landmass.
 */
export function plateRenderOrder(plate: TectonicPlate): number {
    let order = plate.zIndex ?? 0;
    if (plate.type === 'rift') order += 10;
    if (
        plate.polygonType === 'continental_plate'
        || plate.polygonType === 'continental_crust'
        || plate.polygonType === 'craton'
    ) order += 1;
    return order;
}

export function sortPlatesForRendering(plates: readonly TectonicPlate[]): TectonicPlate[] {
    return [...plates].sort((a, b) => plateRenderOrder(a) - plateRenderOrder(b));
}

export function resolveLineRenderStyle(
    plate: TectonicPlate,
    lineTypeDefaults?: GlobalOptions['lineTypeDefaults']
): { color: string; dash: number[] } {
    const lineType: LineType = plate.lineType || 'generic';
    const defaults = resolveLineTypeDefaults(lineTypeDefaults);
    const typeDefault = defaults[lineType] || defaults.generic;
    return {
        color: plate.lineColorCustomized ? (plate.color || typeDefault.color) : typeDefault.color,
        dash: [...typeDefault.dash],
    };
}
