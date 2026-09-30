import type { AppState } from '../types';

export interface SelectionHit {
    plateId?: string;
    featureId?: string;
    plumeId?: string;
    edge?: AppState['world']['selectedEdge'];
}

export type SelectEntity = (plateId: string | null, featureId: string | null, featureIds?: string[], plumeId?: string | null, edge?: AppState['world']['selectedEdge']) => void;

/** Commit the complete hit together so a click cannot trigger multiple panel rebuilds. */
export function dispatchSelection(state: AppState, hit: SelectionHit | null, ctrl: boolean, onSelect: SelectEntity): void {
    if (ctrl && hit?.featureId) {
        const currentIds = state.world.selectedFeatureIds || [];
        const featureIds = currentIds.includes(hit.featureId)
            ? currentIds.filter(id => id !== hit.featureId)
            : [...currentIds, hit.featureId];
        onSelect(hit.plateId ?? state.world.selectedPlateId, null, featureIds);
    } else if (state.activeTool === 'select' && hit?.plumeId) {
        onSelect(null, null, [], hit.plumeId);
    } else if (hit?.plateId) {
        onSelect(hit.plateId, hit.featureId ?? null, [], null, hit.edge ?? null);
    } else {
        onSelect(null, null);
    }
}
