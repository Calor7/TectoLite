import { geoContains } from 'd3-geo';
import { Coordinate, ElevationZone, TectonicPlate } from '../types';
import { derivePlateGeometry, pointPositionAt } from '../motion/RotationModel';
import { greatCircleDistanceKm, resampleGreatCirclePath } from './ElevationField';

const cloneMask = (mask: Coordinate[][][]): Coordinate[][][] => mask.map(poly => poly.map(ring => ring.map(point => [...point] as Coordinate)));
const activeAt = (zone: ElevationZone, time: number) => zone.activeFrom <= time && (zone.activeTo === undefined || time < zone.activeTo);
const transferSuffix = (kind: 'split' | 'fusion', ownerId: string) => `:${kind}:${ownerId}`;

function moveCoordinate(point: Coordinate, owner: TectonicPlate, all: TectonicPlate[], from: number, to: number): Coordinate {
    return pointPositionAt(owner, all, point, from, to);
}

function atTime(zone: ElevationZone, owner: TectonicPlate, all: TectonicPlate[], time: number): ElevationZone['geometry'] {
    const move = (point: Coordinate) => moveCoordinate(point, owner, all, zone.anchorTime, time);
    const clipMask = zone.geometry.clipMask?.map(poly => poly.map(ring => ring.map(move)));
    const clipMasks = zone.geometry.clipMasks?.map(mask => mask.map(poly => poly.map(ring => ring.map(move))));
    if (zone.geometry.kind === 'brush') {
        return { ...zone.geometry, path: zone.geometry.path.map(point => ({ ...point, position: move(point.position) })), clipMask, clipMasks };
    }
    return { ...zone.geometry, rings: zone.geometry.rings.map(ring => ring.map(move)), clipMask, clipMasks };
}

function closed(ring: Coordinate[]): Coordinate[] {
    if (ring.length === 0) return [];
    const first = ring[0], last = ring[ring.length - 1];
    return first[0] === last[0] && first[1] === last[1] ? ring : [...ring, [...first] as Coordinate];
}

function childMask(child: TectonicPlate, all:TectonicPlate[], time:number): Coordinate[][][] {
    return derivePlateGeometry(child,all,time).polygons.filter(poly => poly.points.length >= 3).map(poly => [closed(poly.points.map(point => [...point] as Coordinate))]);
}

function bearing(a:Coordinate,b:Coordinate):number{const p1=a[1]*Math.PI/180,p2=b[1]*Math.PI/180,dl=(b[0]-a[0])*Math.PI/180;return Math.atan2(Math.sin(dl)*Math.cos(p2),Math.cos(p1)*Math.sin(p2)-Math.sin(p1)*Math.cos(p2)*Math.cos(dl));}
/** Exact minimum distance to the minor great-circle arc, seam/pole safe. */
export function greatCircleDistanceToSegmentKm(point:Coordinate,a:Coordinate,b:Coordinate,radiusKm:number):number{const d12=greatCircleDistanceKm(a,b,1),d13=greatCircleDistanceKm(a,point,1);if(d12<1e-12)return d13*radiusKm;const diff=bearing(a,point)-bearing(a,b),cross=Math.asin(Math.max(-1,Math.min(1,Math.sin(d13)*Math.sin(diff)))),along=Math.atan2(Math.sin(d13)*Math.cos(diff),Math.cos(d13));if(along>=0&&along<=d12)return Math.abs(cross)*radiusKm;return Math.min(d13,greatCircleDistanceKm(b,point,1))*radiusKm;}

function brushTouchesMask(zone: ElevationZone, mask: Coordinate[][][], planetRadiusKm = 6371): boolean {
    if (zone.geometry.kind !== 'brush' || zone.geometry.path.length === 0 || mask.length === 0) return false;
    const { radiusKm } = zone.geometry;
    const samples = resampleGreatCirclePath(zone.geometry.path.map(sample => sample.position), Math.max(1, radiusKm / 4), planetRadiusKm);
    const contains = (point: Coordinate) => geoContains({ type: 'MultiPolygon', coordinates: mask } as any, point);
    if(samples.some(contains))return true;
    for(const poly of mask)for(const ring of poly)for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length];if(samples.some(sample=>greatCircleDistanceToSegmentKm(sample,a,b,planetRadiusKm)<=radiusKm))return true;}
    return false;
}

function uniquePush(result: ElevationZone[], fragment: ElevationZone): void {
    const index = result.findIndex(zone => zone.id === fragment.id);
    if (index >= 0) result[index] = fragment;
    else result.push(fragment);
}

/** Close historical causes and create explicit disjoint child-owned fragments. */
export function transferZonesForSplit(zones: ElevationZone[], parent: TectonicPlate, children: TectonicPlate[], all: TectonicPlate[], time: number): ElevationZone[] {
    const sources = zones.filter(zone => zone.ownerPlateId === parent.id && activeAt(zone, time));
    const result = zones.map(zone => sources.includes(zone) ? { ...zone, activeTo: time } : zone);
    for (const source of sources) {
        const geometry = atTime(source, parent, all, time);
        for (const child of children) {
            const clipMask = childMask(child,all,time);
            const previousMasks=[...(geometry.clipMasks||[]),...(geometry.clipMask?[geometry.clipMask]:[])].map(cloneMask);
            const fragmentGeometry = { ...geometry, clipMask, clipMasks: previousMasks.length?previousMasks:undefined } as ElevationZone['geometry'];
            const candidate = { ...source, geometry: fragmentGeometry };
            if (clipMask.length === 0 || (candidate.geometry.kind === 'brush' && !brushTouchesMask(candidate, clipMask))) continue;
            uniquePush(result, {
                ...source,
                id: `${source.id}${transferSuffix('split', child.id)}`,
                ownerPlateId: child.id,
                anchorTime: time,
                activeFrom: time,
                activeTo: source.activeTo,
                lineageId: source.lineageId ?? source.id,
                geometry: fragmentGeometry
            });
        }
    }
    return result;
}

/** Fusion retains layers separately and transforms both their path and mask to
 * the fusion frame. Existing split masks remain disjoint after re-anchoring. */
export function transferZonesForFusion(zones: ElevationZone[], parents: TectonicPlate[], fused: TectonicPlate, all: TectonicPlate[], time: number): ElevationZone[] {
    const parentIds = new Set(parents.map(parent => parent.id));
    const sources = zones.filter(zone => parentIds.has(zone.ownerPlateId) && activeAt(zone, time));
    const result = zones.map(zone => sources.includes(zone) ? { ...zone, activeTo: time } : zone);
    for (const source of sources) {
        const parent = parents.find(candidate => candidate.id === source.ownerPlateId)!;
        const geometry = atTime(source, parent, all, time);
        if (geometry.kind === 'brush' && geometry.path.length === 0) continue;
        uniquePush(result, {
            ...source,
            id: `${source.id}${transferSuffix('fusion', fused.id)}`,
            ownerPlateId: fused.id,
            anchorTime: time,
            activeFrom: time,
            activeTo: source.activeTo,
            lineageId: source.lineageId ?? source.id,
            geometry
        });
    }
    return result;
}

function restoreSources(zones: ElevationZone[], fragmentIds: Set<string>, oldTime: number): ElevationZone[] {
    const fragments = zones.filter(zone => fragmentIds.has(zone.id));
    const ends = new Map<string, number | undefined>();
    for (const fragment of fragments) {
        const sourceId = fragment.id.replace(/:(split|fusion):[^:]+$/, '');
        if (!ends.has(sourceId) || ends.get(sourceId) === undefined) ends.set(sourceId, fragment.activeTo);
    }
    return zones.filter(zone => !fragmentIds.has(zone.id)).map(zone => zone.activeTo === oldTime && ends.has(zone.id) ? { ...zone, activeTo: ends.get(zone.id) } : zone);
}

export function removeSplitTransfer(zones: ElevationZone[], children: TectonicPlate[], oldTime: number): ElevationZone[] {
    const suffixes = children.map(child => transferSuffix('split', child.id));
    const ids = new Set(zones.filter(zone => suffixes.some(suffix => zone.id.endsWith(suffix))).map(zone => zone.id));
    return restoreSources(zones, ids, oldTime);
}

export function recomputeSplitTransfer(zones: ElevationZone[], parent: TectonicPlate, children: TectonicPlate[], all: TectonicPlate[], oldTime: number, newTime: number): ElevationZone[] {
    return transferZonesForSplit(removeSplitTransfer(zones, children, oldTime), parent, children, all, newTime);
}

export function removeFusionTransfer(zones: ElevationZone[], fused: TectonicPlate, oldTime: number): ElevationZone[] {
    const suffix = transferSuffix('fusion', fused.id);
    const ids = new Set(zones.filter(zone => zone.id.endsWith(suffix)).map(zone => zone.id));
    return restoreSources(zones, ids, oldTime);
}

export function recomputeFusionTransfer(zones: ElevationZone[], parents: TectonicPlate[], fused: TectonicPlate, all: TectonicPlate[], oldTime: number, newTime: number): ElevationZone[] {
    return transferZonesForFusion(removeFusionTransfer(zones, fused, oldTime), parents, fused, all, newTime);
}
