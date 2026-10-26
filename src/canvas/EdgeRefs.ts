import type { Coordinate, Polygon, TectonicPlate, WorldState } from '../types';

/**
 * Return the two endpoints of edge `vertexIndex` in `polygons[polyIndex]`, or
 * null when that edge no longer exists. Edge references go stale whenever a
 * plate's shape changes under them: a vertex is deleted, or the timeline moves
 * to a geometry stage with fewer points.
 */
export function resolveEdgeSegment(
    polygons: readonly Polygon[],
    polyIndex: number,
    vertexIndex: number,
): [Coordinate, Coordinate] | null {
    const polygon = polygons[polyIndex];
    if (!polygon || !Number.isInteger(vertexIndex) || vertexIndex < 0) return null;
    const count = polygon.points.length;
    if (vertexIndex >= count) return null;
    const nextIndex = polygon.closed !== false ? (vertexIndex + 1) % count : vertexIndex + 1;
    if (nextIndex >= count) return null;
    return [polygon.points[vertexIndex], polygon.points[nextIndex]];
}

export interface ResolvedEdge {
    plate: TectonicPlate;
    polygon: Polygon;
    segment: [Coordinate, Coordinate];
}

/** The selected edge with its current geometry, or null if it no longer exists. */
export function resolveSelectedEdge(world: Pick<WorldState, 'plates' | 'selectedEdge'>): ResolvedEdge | null {
    const edge = world.selectedEdge;
    if (!edge) return null;
    const plate = world.plates.find(candidate => candidate.id === edge.plateId);
    if (!plate) return null;
    const segment = resolveEdgeSegment(plate.polygons, edge.polyIndex, edge.vertexIndex);
    if (!segment) return null;
    return { plate, polygon: plate.polygons[edge.polyIndex], segment };
}
