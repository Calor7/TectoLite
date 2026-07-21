import { AppState, Coordinate, ElevationZone, TectonicPlate } from '../types';
import { derivePlateGeometry, pointPositionAt } from '../motion/RotationModel';
import { geoContains } from 'd3-geo';

export interface ElevationRasterOptions { width: number; height: number; includeBase?: boolean; }
export const BACKGROUND_OCEAN_METERS = -6000;
const radians = Math.PI / 180;
const degrees = 180 / Math.PI;

function vector([lon, lat]: Coordinate): [number, number, number] {
  const λ = lon * radians, φ = lat * radians, c = Math.cos(φ);
  return [c * Math.cos(λ), c * Math.sin(λ), Math.sin(φ)];
}
export function greatCircleDistanceKm(a: Coordinate, b: Coordinate, radiusKm: number): number {
  const av = vector(a), bv = vector(b);
  return Math.acos(Math.max(-1, Math.min(1, av[0] * bv[0] + av[1] * bv[1] + av[2] * bv[2]))) * radiusKm;
}
/** Great-circle interpolation, including antimeridian and pole crossings. */
export function greatCircleInterpolate(a: Coordinate, b: Coordinate, t: number): Coordinate {
  const av = vector(a), bv = vector(b), dot = Math.max(-1, Math.min(1, av[0]*bv[0]+av[1]*bv[1]+av[2]*bv[2]));
  const angle = Math.acos(dot);
  if (angle < 1e-12) return [...a];
  const s = Math.sin(angle), w0 = Math.sin((1-t)*angle)/s, w1 = Math.sin(t*angle)/s;
  const x = av[0]*w0+bv[0]*w1, y = av[1]*w0+bv[1]*w1, z = av[2]*w0+bv[2]*w1;
  return [Math.atan2(y, x)*degrees, Math.atan2(z, Math.hypot(x,y))*degrees];
}
export function resampleGreatCirclePath(path: Coordinate[], spacingKm: number, radiusKm: number): Coordinate[] {
  if (path.length < 2) return path.map(point => [...point] as Coordinate);
  const out: Coordinate[] = [path[0]];
  for (let i=1; i<path.length; i++) {
    const a=path[i-1], b=path[i], n=Math.max(1, Math.ceil(greatCircleDistanceKm(a,b,radiusKm)/Math.max(spacingKm, 0.001)));
    for(let step=1; step<=n; step++) out.push(greatCircleInterpolate(a,b,step/n));
  }
  return out;
}
export function brushWeight(distanceKm: number, radiusKm: number, falloff: 'hard'|'smoothstep'): number {
  if (!Number.isFinite(distanceKm) || radiusKm <= 0 || distanceKm > radiusKm) return 0;
  if (falloff === 'hard') return 1;
  const x = distanceKm / radiusKm;
  return 1 - (x*x*(3-2*x));
}
function active(zone: ElevationZone, time: number): boolean { return zone.visible && zone.activeFrom <= time && (zone.activeTo === undefined || time < zone.activeTo); }
function unwrapRingLongitudes(ring:Coordinate[]):number[]{if(ring.length===0)return [];const lons:number[]=[ring[0][0]];for(let i=1;i<ring.length;i++)lons.push(lons[i-1]+((((ring[i][0]-lons[i-1])+540)%360)-180));return lons;}
function planarRingContainsPrepared(ring:Coordinate[],lons:number[],point:Coordinate):boolean{if(ring.length<3)return false;const px=lons[0]+((((point[0]-lons[0])+540)%360)-180),py=point[1];let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const yi=ring[i][1],yj=ring[j][1],xi=lons[i],xj=lons[j];if(((yi>py)!==(yj>py))&&px<(xj-xi)*(py-yi)/(yj-yi)+xi)inside=!inside;}return inside;}
function planarPolygonContainsPrepared(prepared:{ring:Coordinate[];lons:number[]}[],point:Coordinate):boolean{if(!prepared[0]||!planarRingContainsPrepared(prepared[0].ring,prepared[0].lons,point))return false;for(let i=1;i<prepared.length;i++)if(planarRingContainsPrepared(prepared[i].ring,prepared[i].lons,point))return false;return true;}
function planarRingContains(ring:Coordinate[], point:Coordinate):boolean{return planarRingContainsPrepared(ring,unwrapRingLongitudes(ring),point);}
function contains(rings: Coordinate[][][], point: Coordinate): boolean { if(rings.length===0)return false;if(Math.abs(point[1])>80)return geoContains({type:'MultiPolygon',coordinates:rings} as any,point);return rings.some(poly=>poly.length>0&&planarRingContains(poly[0],point)&&!poly.slice(1).some(ring=>planarRingContains(ring,point))); }
function transformedPoints(zone: ElevationZone, plate: TectonicPlate, plates: TectonicPlate[], time: number): Coordinate[] {
  if (zone.geometry.kind !== 'brush') return [];
  return zone.geometry.path.map(point => pointPositionAt(plate, plates, point.position, zone.anchorTime, time));
}
function transformedMasks(zone: ElevationZone, plate: TectonicPlate, plates: TectonicPlate[], time: number): Coordinate[][][][] {
  const moveMask=(mask:Coordinate[][][])=>mask.map(poly=>poly.map(ring=>ring.map(point=>pointPositionAt(plate,plates,point,zone.anchorTime,time))));
  return [...(zone.geometry.clipMasks||[]).map(moveMask),...(zone.geometry.clipMask?[moveMask(zone.geometry.clipMask)]:[])];
}
function plateMaskAt(plate: TectonicPlate, plates: TectonicPlate[], time: number): Coordinate[][][] {
  const polygons = plate.geometryStages?.length ? derivePlateGeometry(plate, plates, time).polygons : plate.polygons;
  return polygons.filter(poly => poly.points.length >= 3).map(poly => [poly.points]);
}
/** Deterministic meter-valued rasterizer used by both focused reference tests
 * and production worker exports up to 4096x2048. Plate/brush work is spatially
 * bounded; one weight/touched workspace is reused across zones. Cancellation
 * is the worker scheduling boundary (terminate the worker), not a second math
 * implementation, so synchronous callers should use appropriately bounded work. */
export function deriveElevationField(state: AppState, time: number, options: ElevationRasterOptions): Float32Array {
  const { width, height } = options;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) throw new Error('Invalid elevation raster dimensions');
  const out = new Float32Array(width * height);
  if(options.includeBase!==false)out.fill(BACKGROUND_OCEAN_METERS);
  const radius = state.world.globalOptions.planetRadius;
  const plates = state.world.plates;
  const livePlateMasks = plates.filter(plate => plate.birthTime <= time && (plate.deathTime === null || time < plate.deathTime)).map(plate => ({
    plate,
    mask: plateMaskAt(plate, plates, time)
  }));
  // Rasterize each derived plate only inside its spherical lon/lat bounds.
  // The ownership byte preserves the prior first-plate-wins overlap rule.
  if(options.includeBase!==false){const assigned=new Uint8Array(out.length);for(const {plate,mask} of livePlateMasks){const elevation=plate.elevation??(plate.isOceanic||plate.type==='oceanic'?-4000:500);for(const poly of mask){if(!poly[0]?.length)continue;const ring=poly[0],lons=unwrapRingLongitudes(ring),prepared=poly.map(polyRing=>({ring:polyRing,lons:unwrapRingLongitudes(polyRing)})),geoPolygon={type:'Polygon',coordinates:poly} as any;let minLat=Math.min(...ring.map(point=>point[1])),maxLat=Math.max(...ring.map(point=>point[1])),minLon=Math.min(...lons),maxLon=Math.max(...lons);const north=geoContains(geoPolygon,[0,89.999]),south=geoContains(geoPolygon,[0,-89.999]);if(north){maxLat=90;minLon=-180;maxLon=180;}if(south){minLat=-90;minLon=-180;maxLon=180;}const y0=Math.max(0,Math.floor((90-maxLat)/180*height)),y1=Math.min(height-1,Math.ceil((90-minLat)/180*height)),xCount=Math.min(width,Math.ceil((maxLon-minLon)/360*width)+2),xStart=Math.floor((minLon+180)/360*width);for(let y=y0;y<=y1;y++)for(let xi=0;xi<xCount;xi++){const x=((xStart+xi)%width+width)%width,index=y*width+x;if(assigned[index])continue;const coordinate:Coordinate=[((x+.5)/width)*360-180,90-((y+.5)/height)*180],inside=Math.abs(coordinate[1])>80?geoContains(geoPolygon,coordinate):planarPolygonContainsPrepared(prepared,coordinate);if(inside){out[index]=elevation;assigned[index]=1;}}}}}
  if (options.includeBase !== false) {
    const bands: Record<string, [number, number]> = { mountain:[2500,250], volcano:[1500,140], hotspot:[800,180], island:[1000,180], rift:[-1000,220], trench:[-4000,180], seafloor:[-500,300] };
    for (const { plate } of livePlateMasks) {
      const features = plate.geometryStages?.length ? derivePlateGeometry(plate, plates, time).features : plate.features;
      for (const feature of features) {
        if ((feature.generatedAt !== undefined && time < feature.generatedAt) || (feature.deathTime !== undefined && time >= feature.deathTime)) continue;
        const band = bands[feature.type]; if (!band) continue;
        const strength = band[0] * Math.max(0.1, feature.scale || 1), radiusKm = band[1] * Math.max(0.1, feature.scale || 1);
        const latMargin = radiusKm/radius*degrees, y0=Math.max(0,Math.floor((90-feature.position[1]-latMargin)/180*height)), y1=Math.min(height-1,Math.ceil((90-feature.position[1]+latMargin)/180*height));
        const lonMargin=Math.min(180,latMargin/Math.max(.02,Math.cos(Math.min(89.9,Math.abs(feature.position[1])+latMargin)*radians))), xCount=Math.min(width,Math.ceil(2*lonMargin/360*width)+2), xStart=Math.floor((feature.position[0]-lonMargin+180)/360*width);
        for(let y=y0;y<=y1;y++) for(let xi=0;xi<xCount;xi++) { const x=((xStart+xi)%width+width)%width, coordinate:Coordinate=[((x+.5)/width)*360-180,90-((y+.5)/height)*180], weight=brushWeight(greatCircleDistanceKm(coordinate,feature.position,radius),radiusKm,'smoothstep'); if(weight) out[y*width+x]+=strength*weight; }
      }
    }
  }
  const orderedZones=[...(state.world.elevationZones||[])].filter(z=>active(z,time)).sort((a,b)=>a.order-b.order||(a.id<b.id?-1:a.id>b.id?1:0));
  const weights=orderedZones.length?new Float32Array(out.length):null,touched=orderedZones.length?new Uint32Array(out.length):null;
  for (const zone of orderedZones) {
    const plate = plates.find(candidate => candidate.id === zone.ownerPlateId);
    if (!plate || plate.birthTime > time || (plate.deathTime !== null && plate.deathTime <= time)) continue;
    if (zone.geometry.kind !== 'brush') continue; // polygon authoring is intentionally Slice 3.
    const sourcePoints = transformedPoints(zone, plate, plates, time);
    if (sourcePoints.length === 0) continue;
    const points = resampleGreatCirclePath(sourcePoints, Math.min(zone.geometry.spacingKm, zone.geometry.radiusKm/4), radius);
    if (points.length === 0) continue;
    const masks = transformedMasks(zone, plate, plates, time);
    const ownerMask = livePlateMasks.find(candidate => candidate.plate.id === plate.id)?.mask;
    if (!ownerMask || ownerMask.length === 0) continue;
    if(!weights||!touched)continue;let touchedCount=0;const latMargin=zone.geometry.radiusKm/radius*degrees;
    for(const point of points){const minLat=Math.max(-90,point[1]-latMargin),maxLat=Math.min(90,point[1]+latMargin),y0=Math.max(0,Math.floor((90-maxLat)/180*height)),y1=Math.min(height-1,Math.ceil((90-minLat)/180*height)),cap=zone.geometry.radiusKm/radius,cosCap=Math.cos(cap),pointLon=point[0]*radians,pointLat=point[1]*radians,sinPointLat=Math.sin(pointLat),cosPointLat=Math.cos(pointLat);for(let y=y0;y<=y1;y++){const lat=90-((y+.5)/height)*180,latRad=lat*radians,sinLat=Math.sin(latRad),cosLat=Math.cos(latRad),denom=cosLat*cosPointLat;let lonMargin=180;if(Math.abs(denom)>1e-12){const value=(cosCap-sinLat*sinPointLat)/denom;lonMargin=value<=-1?180:value>=1?0:Math.acos(value)*degrees;}const xCount=Math.min(width,Math.ceil(2*lonMargin/360*width)+2),xStart=Math.floor((point[0]-lonMargin+180)/360*width);for(let xi=0;xi<xCount;xi++){const x=((xStart+xi)%width+width)%width,index=y*width+x,lon=((x+.5)/width*360-180)*radians,dot=Math.max(-1,Math.min(1,sinLat*sinPointLat+cosLat*cosPointLat*Math.cos(lon-pointLon)));if(dot<cosCap)continue;const normalized=Math.acos(dot)/cap,weight=zone.geometry.falloff==='hard'?1:1-normalized*normalized*(3-2*normalized);if(weight>weights[index]){if(weights[index]===0)touched[touchedCount++]=index;weights[index]=weight;}}}}
    for(let i=0;i<touchedCount;i++){const index=touched[i],x=index%width,y=Math.floor(index/width),coordinate:Coordinate=[((x+.5)/width)*360-180,90-((y+.5)/height)*180];if(contains(ownerMask,coordinate)&&!masks.some(mask=>!contains(mask,coordinate)))out[index]+=zone.geometry.deltaMeters*weights[index];weights[index]=0;}
  }
  return out;
}

export interface HeightScale { minMeters: number; maxMeters: number; }
export const DEFAULT_HEIGHT_SCALE: HeightScale = { minMeters: -11000, maxMeters: 9000 };
export function validateHeightScale(scale: HeightScale): void {
  if (!Number.isFinite(scale.minMeters) || !Number.isFinite(scale.maxMeters) || scale.minMeters >= scale.maxMeters) throw new Error('Heightmap minimum must be less than maximum');
}
export function metersToUInt16(meters: number, scale: HeightScale = DEFAULT_HEIGHT_SCALE): number {
  validateHeightScale(scale);
  return Math.round(Math.max(0, Math.min(1, (meters-scale.minMeters)/(scale.maxMeters-scale.minMeters))) * 65535);
}
export function encodeHeightSamples16(field: Float32Array, scale: HeightScale = DEFAULT_HEIGHT_SCALE): Uint16Array {
  validateHeightScale(scale);
  const samples=new Uint16Array(field.length),span=scale.maxMeters-scale.minMeters;for(let i=0;i<field.length;i++)samples[i]=Math.round(Math.max(0,Math.min(1,(field[i]-scale.minMeters)/span))*65535);return samples;
}
export function metersToUInt8(meters:number,scale:HeightScale=DEFAULT_HEIGHT_SCALE):number{validateHeightScale(scale);return Math.round(Math.max(0,Math.min(1,(meters-scale.minMeters)/(scale.maxMeters-scale.minMeters)))*255);}
export function encodeHeightSamples8(field:Float32Array,scale:HeightScale=DEFAULT_HEIGHT_SCALE):Uint8Array{validateHeightScale(scale);const samples=new Uint8Array(field.length),span=scale.maxMeters-scale.minMeters;for(let i=0;i<field.length;i++)samples[i]=Math.round(Math.max(0,Math.min(1,(field[i]-scale.minMeters)/span))*255);return samples;}

const crcTable = (() => { const table = new Uint32Array(256); for (let n=0;n<256;n++) { let c=n; for(let k=0;k<8;k++) c=(c&1)?0xedb88320^(c>>>1):c>>>1; table[n]=c>>>0; } return table; })();
function crc32(bytes: Uint8Array): number { let c=0xffffffff; for(const b of bytes)c=crcTable[(c^b)&255]^(c>>>8); return (c^0xffffffff)>>>0; }
function u32(n: number): Uint8Array { return new Uint8Array([(n>>>24)&255,(n>>>16)&255,(n>>>8)&255,n&255]); }
function chunk(type: string, data: Uint8Array): Uint8Array { const name=new TextEncoder().encode(type), all=new Uint8Array(name.length+data.length); all.set(name);all.set(data,name.length); const result=new Uint8Array(12+data.length); result.set(u32(data.length));result.set(all,4);result.set(u32(crc32(all)),8+data.length);return result; }
/** Standards-compliant, uncompressed 16-bit grayscale PNG. PNG samples are
 * network byte order; its stored DEFLATE blocks avoid platform dependencies. */
export function encodeGray16Png(samples: Uint16Array, width: number, height: number): Uint8Array {
  if (samples.length !== width*height) throw new Error('PNG sample dimensions do not match');
  const raw=new Uint8Array(height*(1+width*2));
  for(let y=0;y<height;y++) { const row=y*(1+width*2); for(let x=0;x<width;x++){const v=samples[y*width+x];raw[row+1+x*2]=v>>>8;raw[row+2+x*2]=v&255;} }
  // zlib stream with stored blocks, then Adler-32.
  const blockCount=Math.ceil(raw.length/65535), blocks=new Uint8Array(2 + raw.length + blockCount*5 + 4); blocks[0]=0x78;blocks[1]=1; let offset=0, write=2;
  while(offset<raw.length){const size=Math.min(65535,raw.length-offset), final=offset+size===raw.length?1:0;blocks[write++]=final;blocks[write++]=size&255;blocks[write++]=size>>>8;blocks[write++]=(~size)&255;blocks[write++]=(~size)>>>8;blocks.set(raw.subarray(offset,offset+size),write);write+=size;offset+=size;}
  let a=1,b=0;for(const value of raw){a=(a+value)%65521;b=(b+a)%65521;}blocks.set([(b>>>8)&255,b&255,(a>>>8)&255,a&255],write);
  const ihdr=new Uint8Array(13);ihdr.set(u32(width));ihdr.set(u32(height),4);ihdr[8]=16;ihdr[9]=0;
  const signature=new Uint8Array([137,80,78,71,13,10,26,10]), idat=chunk('IDAT',blocks), head=chunk('IHDR',ihdr), end=chunk('IEND',new Uint8Array());
  const png=new Uint8Array(signature.length+head.length+idat.length+end.length);let at=0;for(const part of [signature,head,idat,end]){png.set(part,at);at+=part.length;}return png;
}
