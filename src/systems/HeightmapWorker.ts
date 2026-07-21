/// <reference lib="webworker" />
import { AppState, GlobalOptions, ElevationZone, TectonicPlate } from '../types';
import { deriveElevationField, encodeGray16Png, encodeHeightSamples16, HeightScale, validateHeightScale } from './ElevationField';

interface Request { snapshot:{currentTime:number;globalOptions:GlobalOptions;plates:TectonicPlate[];elevationZones:ElevationZone[]}; width: number; scale: HeightScale; }

self.onmessage = (event: MessageEvent<Request>) => {
    try {
        const { snapshot, width, scale } = event.data;
        const state={world:{currentTime:snapshot.currentTime,globalOptions:snapshot.globalOptions,plates:snapshot.plates,elevationZones:snapshot.elevationZones}} as unknown as AppState;
        validateHeightScale(scale);
        if (!Number.isInteger(width) || width < 2 || width % 2 !== 0) throw new Error('Canonical heightmap width must be a positive even integer');
        const height = width / 2;
        self.postMessage({progress:'deriving'});const field = deriveElevationField(state, state.world.currentTime, { width, height });
        self.postMessage({progress:'encoding'});
        const samples = encodeHeightSamples16(field, scale);
        const png = encodeGray16Png(samples, width, height);
        self.postMessage({ width, height, scale, png }, { transfer: [png.buffer] });
    } catch (error) {
        self.postMessage({ error: error instanceof Error ? error.message : String(error) });
    }
};

export { };
