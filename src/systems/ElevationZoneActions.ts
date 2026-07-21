import { ElevationFalloff, ElevationZone } from '../types';
import { validateElevationBrush } from './ElevationBrushLimits';

export type ElevationZoneAction =
  | {type:'visible';visible:boolean}
  | {type:'locked';locked:boolean}
  | {type:'move';direction:-1|1}
  | {type:'delete'}
  | {type:'edit';radiusKm:number;deltaMeters:number;falloff:ElevationFalloff};

export function applyElevationZoneAction(zones:ElevationZone[],id:string,action:ElevationZoneAction):{zones:ElevationZone[];changed:boolean;error?:string}{
  const index=zones.findIndex(zone=>zone.id===id);if(index<0)return {zones,changed:false};const current=zones[index];
  if(action.type==='visible'){if(current.visible===action.visible)return {zones,changed:false};return {zones:zones.map(zone=>zone.id===id?{...zone,visible:action.visible}:zone),changed:true};}
  if(action.type==='locked'){if(current.locked===action.locked)return {zones,changed:false};return {zones:zones.map(zone=>zone.id===id?{...zone,locked:action.locked}:zone),changed:true};}
  if(current.locked)return {zones,changed:false};
  if(action.type==='delete')return {zones:zones.filter(zone=>zone.id!==id),changed:true};
  if(action.type==='edit'){
    if(current.geometry.kind!=='brush')return {zones,changed:false,error:'Only brush zones are editable in Slice 1.'};const error=validateElevationBrush(action.radiusKm,action.deltaMeters,action.falloff);if(error)return {zones,changed:false,error};const spacingKm=Math.max(.5,action.radiusKm/4);if(current.geometry.radiusKm===action.radiusKm&&current.geometry.deltaMeters===action.deltaMeters&&current.geometry.falloff===action.falloff&&current.geometry.spacingKm===spacingKm)return {zones,changed:false};
    return {zones:zones.map(zone=>zone.id===id?{...zone,name:`${action.deltaMeters<0?'Lower':'Raise'} ${Math.round(Math.abs(action.deltaMeters))} m`,geometry:{...zone.geometry,radiusKm:action.radiusKm,deltaMeters:action.deltaMeters,falloff:action.falloff,spacingKm}}:zone),changed:true};
  }
  const ordered=[...zones].sort((a,b)=>a.order-b.order||(a.id<b.id?-1:1)),at=ordered.findIndex(zone=>zone.id===id),to=at+action.direction;if(to<0||to>=ordered.length)return {zones,changed:false};[ordered[at],ordered[to]]=[ordered[to],ordered[at]];const orders=new Map(ordered.map((zone,order)=>[zone.id,order]));return {zones:zones.map(zone=>({...zone,order:orders.get(zone.id)!})),changed:true};
}
