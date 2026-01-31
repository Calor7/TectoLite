import { AppState } from '../types';
import { geoPath, geoOrthographic, geoEquirectangular } from 'd3-geo';

export interface HeightmapOptions {
    width: number;
    height: number;
    projection: 'equirectangular' | 'orthographic'; // Standard for export
    smooth: boolean;
}

export class HeightmapGenerator {

    public static async generate(state: AppState, options: HeightmapOptions): Promise<string> {
        // Create offscreen canvas
        const canvas = document.createElement('canvas');
        canvas.width = options.width;
        canvas.height = options.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Could not get 2d context');

        // Setup Projection
        // We typically use Equirectangular for World Map export (2:1 aspect ratio valid)
        const projection = options.projection === 'equirectangular'
            ? geoEquirectangular().fitSize([options.width, options.height], { type: "Sphere" } as any)
            : geoOrthographic().fitSize([options.width, options.height], { type: "Sphere" } as any);

        const path = geoPath().projection(projection).context(ctx);

        // 1. Fill Background (Ocean Deep)
        ctx.fillStyle = '#141414'; // Ocean Base Level (Deep)
        ctx.fillRect(0, 0, options.width, options.height);

        // 1.5 Render Ocean Age Map (Bathymetry)
        if (state.world.oceanAgeMap && state.world.oceanAgeMapRes) {
            const map = state.world.oceanAgeMap;
            const [w, h] = state.world.oceanAgeMapRes;
            const currentTime = state.world.currentTime;

            for (let y = 0; y < h; y++) {
                const lat = 90 - (y / h) * 180;
                for (let x = 0; x < w; x++) {
                    const lon = (x / w) * 360 - 180;
                    const idx = y * w + x;
                    const bt = map[idx];
                    if (bt === -1) continue;

                    const age = Math.abs(currentTime - bt);
                    // Map Age (0-200 Ma) to Elevation (80-20)
                    const elevation = Math.max(20, 80 - (age / 200) * 60);
                    ctx.fillStyle = `rgb(${elevation}, ${elevation}, ${elevation})`;

                    // Project the pixel
                    const pt = projection([lon, lat]);
                    if (pt) {
                        // Approximate pixel size
                        const pw = options.width / w + 1;
                        const ph = options.height / h + 1;
                        ctx.fillRect(pt[0] - pw / 2, pt[1] - ph / 2, pw, ph);
                    }
                }
            }
        }

        // 2. Render Plates (Base Elevation)
        const activePlates = state.world.plates.filter(p => !p.deathTime && p.birthTime <= state.world.currentTime);

        for (const plate of activePlates) {
            // Default to continental elevation behavior
            const baseVal = 120;
            const color = `rgb(${baseVal}, ${baseVal}, ${baseVal})`;

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
                if (feature.generatedAt && feature.generatedAt > state.world.currentTime) continue;

                const pt = projection(feature.position);
                if (!pt) continue;

                const [x, y] = pt;

                // Size: feature.scale * 10 pixels?
                // World width 4096. 1 degree ~ 11 pixels.
                // Feature scale 1 ~ 100km ~ 1 degree.
                const radius = (feature.scale || 1) * (options.width / 360) * 1.5;

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
