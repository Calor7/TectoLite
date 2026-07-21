import { ElevationFalloff } from '../types';

export const MIN_ELEVATION_RADIUS_KM=1;
export const MAX_ELEVATION_RADIUS_KM=10_000;
export const MIN_ELEVATION_DELTA_METERS=1;
export const MAX_ELEVATION_DELTA_METERS=50_000;
export const ELEVATION_FALLOFFS:readonly ElevationFalloff[]=['hard','smoothstep'];

export function isElevationFalloff(value:unknown):value is ElevationFalloff{return typeof value==='string'&&(ELEVATION_FALLOFFS as readonly string[]).includes(value);}
export function validateElevationBrush(radiusKm:number,deltaMeters:number,falloff:unknown):string|null{
  if(!Number.isFinite(radiusKm)||radiusKm<MIN_ELEVATION_RADIUS_KM||radiusKm>MAX_ELEVATION_RADIUS_KM)return `Radius must be ${MIN_ELEVATION_RADIUS_KM}..${MAX_ELEVATION_RADIUS_KM} km.`;
  if(!Number.isFinite(deltaMeters)||Math.abs(deltaMeters)<MIN_ELEVATION_DELTA_METERS||Math.abs(deltaMeters)>MAX_ELEVATION_DELTA_METERS)return `Elevation delta must be between -${MAX_ELEVATION_DELTA_METERS} and ${MAX_ELEVATION_DELTA_METERS} m and cannot be zero.`;
  if(!isElevationFalloff(falloff))return 'Falloff must be hard or smoothstep.';
  return null;
}
export function clampElevationAuthoring(radiusKm:number,strengthMeters:number,falloff:unknown):{radiusKm:number;strengthMeters:number;falloff:ElevationFalloff}{return {radiusKm:Number.isFinite(radiusKm)?Math.max(MIN_ELEVATION_RADIUS_KM,Math.min(MAX_ELEVATION_RADIUS_KM,radiusKm)):250,strengthMeters:Number.isFinite(strengthMeters)?Math.max(MIN_ELEVATION_DELTA_METERS,Math.min(MAX_ELEVATION_DELTA_METERS,Math.abs(strengthMeters))):500,falloff:isElevationFalloff(falloff)?falloff:'smoothstep'};}
