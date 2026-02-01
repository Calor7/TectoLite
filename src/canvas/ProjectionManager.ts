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
import { latLonToVector, dot } from '../utils/sphericalMath';

export class ProjectionManager {
    private projection: GeoProjection;
    private pathGenerator: GeoPath;
    private currentProjectionType: ProjectionType = 'orthographic';

    constructor(context: CanvasRenderingContext2D) {
        this.projection = geoOrthographic()
            .clipAngle(90); // Clip features on back side of globe
        this.pathGenerator = geoPath(this.projection, context);
    }

    public update(type: ProjectionType, viewport: Viewport): void {
        this.currentProjectionType = type;
        
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

        // Set clip angle AFTER scale/translate/rotate for orthographic
        if (type === 'orthographic') {
            this.projection.clipAngle(90);
        }

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
    // For orthographic, also checks if point is visible (not on back of globe)
    public project(coord: Coordinate): [number, number] | null {
        // For orthographic projection, manually check visibility
        if (this.currentProjectionType === 'orthographic') {
            if (!this.isVisibleOnGlobe(coord)) {
                return null;
            }
        }
        return this.projection(coord);
    }

    // Check if a coordinate is visible on the front side of an orthographic globe
    private isVisibleOnGlobe(coord: Coordinate): boolean {
        // Get the current rotation
        const rotation = this.projection.rotate ? this.projection.rotate() : [0, 0, 0];
        
        // Convert the view center to a vector (opposite of rotation)
        const viewLon = -rotation[0];
        const viewLat = -rotation[1];
        const viewCenter: Coordinate = [viewLon, viewLat];
        const viewVector = latLonToVector(viewCenter);
        
        // Convert the point to a vector
        const pointVector = latLonToVector(coord);
        
        // Check if the dot product is positive (point faces the viewer)
        return dot(viewVector, pointVector) > 0;
    }

    // Invert [x, y] -> [lon, lat]
    public invert(x: number, y: number): Coordinate | null {
        return this.projection.invert ? this.projection.invert([x, y]) : null;
    }
}
