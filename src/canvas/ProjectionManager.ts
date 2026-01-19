import {
    geoOrthographic,
    geoMercator,
    geoEquirectangular,
    GeoProjection,
    GeoPath,
    geoPath
} from 'd3-geo';
import {
    geoMollweide,
    geoRobinson
} from 'd3-geo-projection';
import { ProjectionType, Viewport, Coordinate } from '../types';

export class ProjectionManager {
    private projection: GeoProjection;
    private pathGenerator: GeoPath;

    constructor(context: CanvasRenderingContext2D) {
        this.projection = geoOrthographic();
        this.pathGenerator = geoPath(this.projection, context);
    }

    public update(type: ProjectionType, viewport: Viewport): void {
        // 1. Select Projection
        switch (type) {
            case 'orthographic':
                this.projection = geoOrthographic();
                break;
            case 'mercator':
                this.projection = geoMercator();
                break;
            case 'equirectangular':
                this.projection = geoEquirectangular();
                break;
            case 'mollweide':
                this.projection = geoMollweide();
                break;
            case 'robinson':
                this.projection = geoRobinson();
                break;
            default:
                this.projection = geoOrthographic();
        }

        // 2. Apply Viewport State
        // D3 projections typically use:
        // .scale() -> zoom
        // .translate() -> [width/2, height/2] usually, or panning
        // .rotate() -> [lambda, phi, gamma] spherical rotation

        // For TectoLite:
        // - Rotate is the primary way to "pan" around the globe (lon/lat rotation).
        // - Translate handles centering on screen.
        // - Scale handles zoom.

        this.projection
            .scale(viewport.scale)
            .translate(viewport.translate)
            .rotate(viewport.rotate);

        // Update the path generator to use this new projection instance
        this.pathGenerator.projection(this.projection);
    }

    public getProjection(): GeoProjection {
        return this.projection;
    }

    public getPathGenerator(): GeoPath {
        return this.pathGenerator;
    }

    // Project [lon, lat] -> [x, y]
    public project(coord: Coordinate): [number, number] | null {
        return this.projection(coord);
    }

    // Invert [x, y] -> [lon, lat]
    public invert(x: number, y: number): Coordinate | null {
        return this.projection.invert ? this.projection.invert([x, y]) : null;
    }
}
