import { AppState, Coordinate, ProjectionType, TectonicPlate } from '../types';
import { geoPath, geoOrthographic, geoEquirectangular, geoMercator, geoArea, geoCircle, geoInterpolate, geoDistance, GeoProjection } from 'd3-geo';
import { geoMollweide, geoRobinson } from 'd3-geo-projection';
import type { MultiPolygon, Polygon as GeoPolygon } from 'geojson';
import { isFeatureActiveAtTime, isPlateActiveAtTime } from '../utils/timeline';
import { cross, latLonToVector, normalize, vectorToLatLon } from '../utils/sphericalMath';
import { oceanDepthAtAge, ridgeAxialRelief } from './MidOceanRidgeSystem';

export interface HeightmapOptions {
    width: number;
    height: number;
    projection: ProjectionType;
    smooth: boolean;
}

/** Relative export shades: deep water = 10, sea level = 100, continental base = 120. */
export function oceanDepthToGray(depthMeters: number): number {
    const depth = Number.isNaN(depthMeters) ? 6000 : depthMeters;
    return Math.round(Math.max(10, Math.min(100, 10 + (6000 - depth) / 6000 * 90)));
}

function isOceanSurface(plate: TectonicPlate): boolean {
    return plate.midOceanRidge?.kind === 'crust' || plate.isOceanic === true
        || plate.type === 'oceanic' || plate.polygonType === 'oceanic_plate';
}

export function plateHeightmapGray(plate: TectonicPlate, currentTime: number): number {
    if (!isOceanSurface(plate)) return 120;
    const crust = plate.midOceanRidge;
    if (crust?.kind === 'crust') {
        const meanBirthTime = (crust.oldestBirthTime + crust.youngestBirthTime) / 2;
        return oceanDepthToGray(oceanDepthAtAge(currentTime - meanBirthTime));
    }
    if (plate.age !== undefined || plate.generatedBy !== undefined) {
        return oceanDepthToGray(oceanDepthAtAge(currentTime - (plate.age ?? plate.birthTime)));
    }
    return oceanDepthToGray(plate.elevation !== undefined && plate.elevation < 0 ? -plate.elevation : 5000);
}

function smallPolygon(ring: number[][]): GeoPolygon {
    const polygon: GeoPolygon = { type: 'Polygon', coordinates: [ring] };
    if (geoArea(polygon) > 2 * Math.PI) ring.reverse();
    return polygon;
}

/** Geographic buffers keep ridge widths in km and let d3 clip seams and the hidden hemisphere. */
export function ridgeGeographicBuffer(points: Coordinate[], radiusKm: number, planetRadiusKm = 6371): MultiPolygon {
    const coordinates: number[][][][] = [];
    if (points.length < 2 || radiusKm <= 0 || planetRadiusKm <= 0) return { type: 'MultiPolygon', coordinates };
    const angularRadius = Math.min(radiusKm / planetRadiusKm, Math.PI / 2 - 1e-6);
    const sampled: Coordinate[] = [points[0]];
    for (let i = 1; i < points.length; i++) {
        const interpolate = geoInterpolate(points[i - 1], points[i]);
        // Short segments keep offset edges close to small circles even on curved ridges.
        const steps = Math.max(1, Math.ceil(geoDistance(points[i - 1], points[i]) / (Math.PI / 90)));
        for (let step = 1; step <= steps; step++) sampled.push(interpolate(step / steps) as Coordinate);
    }
    const cosine = Math.cos(angularRadius);
    const sine = Math.sin(angularRadius);
    for (let i = 1; i < sampled.length; i++) {
        const a = latLonToVector(sampled[i - 1]);
        const b = latLonToVector(sampled[i]);
        const normal = normalize(cross(a, b));
        if (normal.x === 0 && normal.y === 0 && normal.z === 0) continue;
        const offset = (point: typeof a, side: number) => vectorToLatLon({
            x: point.x * cosine + normal.x * sine * side,
            y: point.y * cosine + normal.y * sine * side,
            z: point.z * cosine + normal.z * sine * side,
        });
        const ring = [offset(a, 1), offset(b, 1), offset(b, -1), offset(a, -1)];
        coordinates.push(smallPolygon([...ring, ring[0]]).coordinates);
    }
    // Round joins and end caps also remain geographic, including near the poles.
    const circle = geoCircle().radius(angularRadius * 180 / Math.PI).precision(12);
    for (const point of sampled) coordinates.push(circle.center(point)().coordinates);
    return { type: 'MultiPolygon', coordinates };
}

export class HeightmapGenerator {
    public static async generate(state: AppState, options: HeightmapOptions): Promise<string> {
        const canvas = document.createElement('canvas');
        const { width, height } = options;
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Could not get 2d context');

        let projection: GeoProjection;
        const sphere = { type: 'Sphere' } as const;
        switch (options.projection) {
            case 'equirectangular': projection = geoEquirectangular(); break;
            case 'mercator': projection = geoMercator(); break;
            case 'mollweide': projection = geoMollweide(); break;
            case 'robinson': projection = geoRobinson(); break;
            case 'orthographic':
            default: projection = geoOrthographic(); break;
        }
        projection.fitSize([width, height], sphere);
        const path = geoPath().projection(projection).context(ctx);
        ctx.fillStyle = '#0a0a0a';
        ctx.fillRect(0, 0, width, height);

        const currentTime = state.world.currentTime;
        const activePlates = state.world.plates.filter(p => p.visible && isPlateActiveAtTime(p, currentTime));
        const fillSurfaces = (plates: TectonicPlate[]) => {
            for (const plate of plates) {
                const surfaces = plate.polygons.filter(poly => poly.closed && poly.points.length >= 3);
                if (surfaces.length === 0) continue;
                ctx.beginPath();
                for (const poly of surfaces) {
                    const ring = poly.points.map(pt => [pt[0], pt[1]]);
                    if (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) ring.push([...ring[0]]);
                    path(smallPolygon(ring));
                }
                const shade = plateHeightmapGray(plate, currentTime);
                ctx.fillStyle = `rgb(${shade}, ${shade}, ${shade})`;
                ctx.fill();
            }
        };
        fillSurfaces(activePlates.filter(isOceanSurface));

        // Thermal subsidence is carried by the crust strips; the axis adds local relief.
        const widthsKm = [60, 40, 25, 18, 12, 8, 5, 3, 1];
        for (const plate of activePlates) {
            if (plate.midOceanRidge?.kind !== 'axis') continue;
            const rate = plate.midOceanRidge.fullSpreadingRateCmYr;
            if (!Number.isFinite(rate) || rate <= 0) continue;
            for (let band = 0; band < widthsKm.length; band++) {
                const sampleDistance = band === widthsKm.length - 1 ? 0 : (widthsKm[band] + widthsKm[band + 1]) / 2;
                const age = sampleDistance / (rate * 5); // half-spreading cm/yr -> km/Ma
                const depth = oceanDepthAtAge(age) - ridgeAxialRelief(sampleDistance, rate);
                const shade = oceanDepthToGray(depth);
                ctx.beginPath();
                for (const poly of plate.polygons) {
                    if (!poly.closed && poly.points.length >= 2) {
                        path(ridgeGeographicBuffer(poly.points, widthsKm[band], state.world.globalOptions.planetRadius));
                    }
                }
                ctx.fillStyle = `rgb(${shade}, ${shade}, ${shade})`;
                ctx.fill();
            }
        }
        // Land covers any nearby buffer caps at a coastline.
        fillSurfaces(activePlates.filter(plate => !isOceanSurface(plate)));

        const radiusScale = (width / 360) * 1.5;
        for (const plate of activePlates) {
            for (const feature of plate.features) {
                if (!isFeatureActiveAtTime(feature, currentTime)) continue;
                const pt = projection(feature.position);
                if (!pt) continue;
                const [x, y] = pt;
                const radius = (feature.scale || 1) * radiusScale;
                let intensity: number;
                let isSubtractive = false;
                switch (feature.type) {
                    case 'mountain': intensity = 100; break;
                    case 'volcano': intensity = 120; break;
                    case 'island': intensity = 80; break;
                    case 'rift': intensity = -30; isSubtractive = true; break;
                    case 'trench': intensity = -60; isSubtractive = true; break;
                    default: continue;
                }
                const grad = ctx.createRadialGradient(x, y, 0, x, y, radius);
                if (isSubtractive) {
                    grad.addColorStop(0, `rgba(0, 0, 0, ${Math.abs(intensity) / 255})`);
                    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
                } else {
                    grad.addColorStop(0, `rgba(255, 255, 255, ${intensity / 255})`);
                    grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
                }
                ctx.save();
                ctx.globalCompositeOperation = isSubtractive ? 'source-over' : 'lighter';
                ctx.fillStyle = grad;
                ctx.beginPath();
                ctx.arc(x, y, radius, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
            }
        }
        // This is a relative grayscale illustration, not a calibrated elevation DEM.
        return canvas.toDataURL('image/png');
    }
}
