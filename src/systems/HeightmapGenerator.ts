import { AppState, ProjectionType } from '../types';
import { DEFAULT_HEIGHT_SCALE, deriveElevationField, encodeGray16Png, encodeHeightSamples16, encodeHeightSamples8, HeightScale } from './ElevationField';

export interface HeightmapOptions { width: number; height: number; projection: ProjectionType; smooth: boolean; }

/** Adapter for the legacy 8-bit API. It deliberately consumes the same meter
 * field as canonical export; non-equirectangular callers are visual-only. */
export class HeightmapGenerator {
  public static async generate(state: AppState, options: HeightmapOptions): Promise<string> {
    const canvas = document.createElement('canvas'); canvas.width = options.width; canvas.height = options.height;
    const context = canvas.getContext('2d'); if (!context) throw new Error('Could not get 2d context');
    const field = deriveElevationField(state, state.world.currentTime, options);
    const pixels = context.createImageData(options.width, options.height);
    const samples = encodeHeightSamples8(field);
    for (let i=0; i<samples.length; i++) {
      const value = samples[i], offset=i*4;
      pixels.data[offset]=pixels.data[offset+1]=pixels.data[offset+2]=value; pixels.data[offset+3]=255;
    }
    context.putImageData(pixels, 0, 0);
    return canvas.toDataURL('image/png');
  }

  /** Canonical 2:1 raster samples. The caller may pass these to a dedicated
   * PNG writer; keeping samples separate makes scale/offset explicit/testable. */
  public static deriveCanonical16(state: AppState, width = 4096, scale: HeightScale = DEFAULT_HEIGHT_SCALE) {
    if (width % 2) throw new Error('Canonical equirectangular heightmap width must be even');
    const height = width / 2;
    const field = deriveElevationField(state, state.world.currentTime, { width, height });
    const samples = encodeHeightSamples16(field, scale);
    return { width, height, field, samples, png: encodeGray16Png(samples, width, height), scale };
  }

  /** Runs the expensive canonical derivation and PNG encoding away from the UI
   * thread where module workers are available. */
  public static async deriveCanonical16Async(state: AppState, width = 4096, scale: HeightScale = DEFAULT_HEIGHT_SCALE, options: {signal?:AbortSignal;onProgress?:(phase:'deriving'|'encoding'|'done')=>void} = {}): Promise<{ width: number; height: number; png: Uint8Array; scale: HeightScale }> {
    if(options.signal?.aborted)throw new DOMException('Heightmap export cancelled','AbortError');
    if (typeof Worker === 'undefined') {
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      options.onProgress?.('deriving');const result=this.deriveCanonical16(state,width,scale);options.onProgress?.('done');return result;
    }
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./HeightmapWorker.ts', import.meta.url), { type: 'module' });
      const abort=()=>{worker.terminate();reject(new DOMException('Heightmap export cancelled','AbortError'));};options.signal?.addEventListener('abort',abort,{once:true});
      worker.onmessage = event => {
        if(event.data.progress){options.onProgress?.(event.data.progress);return;}
        worker.terminate();
        options.signal?.removeEventListener('abort',abort);
        if (event.data.error) reject(new Error(event.data.error));
        else {options.onProgress?.('done');resolve({ ...event.data, png: event.data.png as Uint8Array });}
      };
      worker.onerror = event => { worker.terminate(); reject(new Error(event.message || 'Heightmap worker failed')); };
      worker.postMessage({ snapshot:{currentTime:state.world.currentTime,globalOptions:state.world.globalOptions,plates:state.world.plates,elevationZones:state.world.elevationZones}, width, scale });
    });
  }
}
