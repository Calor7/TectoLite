import { AppState, ProjectionType } from '../types';
import { geoPath, geoOrthographic, geoEquirectangular, geoMercator } from 'd3-geo';
import * as geoProjection from 'd3-geo-projection';

export interface HeightmapOptions {
    width: number;
    height: number;
    projection: ProjectionType;
    smooth: boolean;
}

export class HeightmapGenerator {

    public static async generate(state: AppState, options: HeightmapOptions): Promise<string> {
        // Create offscreen canvas
        const canvas = document.createElement('canvas');
        const { width, height, projection: projectionType } = options;
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Could not get 2d context');

        // Setup Projection
        let projection: any;
        const projectionOptions = { type: "Sphere" } as any;
        
        switch (options.projection) {
            case 'equirectangular':
                projection = geoEquirectangular().fitSize([width, height], projectionOptions);
                break;
            case 'mercator':
                projection = geoMercator().fitSize([width, height], projectionOptions);
                break;
            case 'mollweide':
                projection = (geoProjection as any).geoMollweide().fitSize([width, height], projectionOptions);
                break;
            case 'robinson':
                projection = (geoProjection as any).geoRobinson().fitSize([width, height], projectionOptions);
                break;
            case 'orthographic':
            default:
                projection = geoOrthographic().fitSize([width, height], projectionOptions);
                break;
        }

        const path = geoPath().projection(projection).context(ctx);

        // 1. Fill Background (Ocean Deep)
        ctx.fillStyle = '#0a0a0a'; // Very dark gray/black (Deep Ocean)
        ctx.fillRect(0, 0, width, height);

        // 2. Render Plates (Base Elevation)
        const currentTime = state.world.currentTime;
        const activePlates = state.world.plates.filter(p => !p.deathTime && p.birthTime <= currentTime);
        const baseVal = 120;
        const color = `rgb(${baseVal}, ${baseVal}, ${baseVal})`;
        const radiusScale = (width / 360) * 1.5;

        for (const plate of activePlates) {
            // Default to continental elevation behavior

            ctx.beginPath();
            plate.polygons.forEach(poly => {
                const geojson = {
                    type: 'Polygon',
                    coordinates: [poly.points.map(pt => [pt[0], pt[1]])] // Ring
                };
                // Ensure closed
                const ring = geojson.coordinates[0];
                if (ring.length > 0 && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])) {
                    ring.push(ring[0]);
                }

                path(geojson as any);
            });
            ctx.fillStyle = color;
            ctx.fill();

            // Overlap? If plates overlap, we might want additive blending?
            // "lighter" globalCompositeOperation
        }

        // 3. Render Features (Mountains/etc)
        // We use radial gradients for simple height bumps

        for (const plate of activePlates) {
            for (const feature of plate.features) {
                // Skip inactive
                if (feature.generatedAt && feature.generatedAt > currentTime) continue;

                const pt = projection(feature.position);
                if (!pt) continue;

                const [x, y] = pt;

                // Size: feature.scale * 10 pixels?
                // World width 4096. 1 degree ~ 11 pixels.
                // Feature scale 1 ~ 100km ~ 1 degree.
                const radius = (feature.scale || 1) * radiusScale;

                // Height Impact
                // Mountain: Add +100
                // Volcano: Add +150 (Peak)
                // Trench: Subtract -50

                let intensity = 0;
                let isSubtractive = false;

                switch (feature.type) {
                    case 'mountain': intensity = 100; break;
                    case 'volcano': intensity = 120; break;
                    case 'island': intensity = 80; break; // Rise out of ocean
                    case 'rift': intensity = -30; isSubtractive = true; break;
                    case 'trench': intensity = -60; isSubtractive = true; break;
                    default: continue;
                }

                const grad = ctx.createRadialGradient(x, y, 0, x, y, radius);

                if (!isSubtractive) {
                    // Additive (Mountain)
                    // Inner = White (High), Outer = Transparent
                    // We need to ADD to existing gray.
                    // 'screen' or 'lighter'? 'lighter' adds RGB values.
                    // If we use 'source-over' with alpha, it mixes towards color.
                    // Let's use RGB with alpha.
                    // Center: rgb(255,255,255, 0.5) adding to 120 -> brighter.

                    grad.addColorStop(0, `rgba(255, 255, 255, ${intensity / 255})`);
                    grad.addColorStop(1, 'rgba(255, 255, 255, 0)');

                    ctx.save();
                    ctx.globalCompositeOperation = 'lighter'; // Additive
                    ctx.fillStyle = grad;
                    ctx.beginPath();
                    ctx.arc(x, y, radius, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.restore();
                } else {
                    // Subtractive (Trench)
                    // We want to darken.
                    grad.addColorStop(0, `rgba(0, 0, 0, ${Math.abs(intensity) / 255})`);
                    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');

                    ctx.save();
                    // 'multiply' darkens? Or just draw black with alpha over it?
                    // source-over with black alpha = darkens.
                    ctx.globalCompositeOperation = 'source-over';
                    ctx.fillStyle = grad;
                    ctx.beginPath();
                    ctx.arc(x, y, radius, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.restore();
                }
            }
        }

        // 4. Smooth? Box blur if requested.

        return canvas.toDataURL('image/png');
    }
}
