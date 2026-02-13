// GeoJSON Helper utilities for TectoLite

import { Polygon, Coordinate } from '../types';

// Calculate signed area to determine winding order
// Positive = counter-clockwise, Negative = clockwise
function calculateSignedArea(coords: Coordinate[]): number {
    let area = 0;
    const n = coords.length;
    if (n) {
        // Use lon as x, lat as y for 2D signed area approximation
        let prev = coords[n - 1];
        for (let i = 0; i < n; i++) {
            const curr = coords[i];
            area += prev[0] * curr[1] - curr[0] * prev[1];
            prev = curr;
        }
    }
    return area / 2;
}

// Ensure polygon has clockwise winding (d3-geo expects clockwise for exterior rings)
function ensureClockwise(coords: Coordinate[]): Coordinate[] {
    const signedArea = calculateSignedArea(coords);
    // If positive (counter-clockwise), reverse to make clockwise
    return signedArea > 0 ? coords.reverse() : coords;
}

// Convert internal Polygon type to GeoJSON Feature
export function toGeoJSON(polygon: Polygon): GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.LineString> {
    // If explicitly open, return LineString
    if (polygon.closed === false) {
        return {
            type: 'Feature',
            properties: {},
            geometry: {
                type: 'LineString',
                coordinates: polygon.points
            }
        };
    }

    // Ensure clockwise winding for exterior ring (d3-geo convention)
    const coords = ensureClockwise(polygon.points.slice());

    // Ensure closure - GeoJSON polygons must have first === last point
    if (coords.length > 0) {
        const first = coords[0];
        const last = coords[coords.length - 1];
        if (first[0] !== last[0] || first[1] !== last[1]) {
            coords.push(first);
        }
    }
    return {
        type: 'Feature',
        properties: {},
        geometry: {
            type: 'Polygon',
            coordinates: [coords]
        }
    };
}

