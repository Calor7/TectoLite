// Geological Automation System
// Handles dynamic feature tracking and hotspot volcanism

import { AppState, Feature, generateId } from '../types';
import { isPointInPolygon } from '../SplitTool';

export class GeologicalAutomationSystem {
    constructor() {}

    public update(state: AppState): AppState {
        let newState = { ...state };
        
        if (state.world.globalOptions.enableHotspots) {
            newState = this.processHotspots(newState);
        }

        // DEPRECATED: Orogeny feature processing disabled
        // The elevation system (ElevationSystem.ts) now handles terrain generation

        return newState;
    }

    private processHotspots(state: AppState): AppState {
        if (!state.world.mantlePlumes || state.world.mantlePlumes.length === 0) return state;

        const currentTime = state.world.currentTime;
        let modified = false;
        const plates = [...state.world.plates];

        for (const plume of state.world.mantlePlumes) {
            if (!plume.active) continue;

            for (let i = 0; i < plates.length; i++) {
                const plate = plates[i];
                let inside = false;
                for (const poly of plate.polygons) {
                    if (isPointInPolygon(plume.position, poly.points)) {
                        inside = true;
                        break;
                    }
                }

                if (inside) {
                    const rate = plume.spawnRate ?? state.world.globalOptions.hotspotSpawnRate ?? 1.0;

                    const recentFeature = plate.features
                        .filter(f => 
                            f.type === 'hotspot' && 
                            f.properties?.source === 'plume' &&
                            f.properties?.plumeId === plume.id
                        )
                        .sort((a,b) => (b.generatedAt || 0) - (a.generatedAt || 0))[0];

                    const timeSinceLast = currentTime - (recentFeature?.generatedAt || 0);

                    if (!recentFeature || timeSinceLast >= rate) {
                        const newFeature: Feature = {
                            id: generateId(),
                            type: 'hotspot',
                            position: [...plume.position],
                            originalPosition: [...plume.position],
                            rotation: 0,
                            scale: 1,
                            generatedAt: currentTime,
                            properties: {
                                source: 'plume',
                                plumeId: plume.id,
                                description: 'Hotspot Track'
                            }
                        };

                        plates[i] = {
                            ...plate,
                            features: [...plate.features, newFeature]
                        };
                        modified = true;
                    }
                }
            }
        }

        if (!modified) return state;

        return {
            ...state,
            world: {
                ...state.world,
                plates
            }
        };
    }
}
