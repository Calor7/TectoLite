import { TectonicPlate, Boundary, Coordinate, Polygon } from './types';
import polygonClipping from 'polygon-clipping';
import { latLonToVector, scaleVector, subtractVectors, cross, normalize, dot } from './utils/sphericalMath';

export class BoundarySystem {

    // Detect boundaries between plates based on overlap and movement
    public static detectBoundaries(plates: TectonicPlate[]): Boundary[] {
        const boundaries: Boundary[] = [];
        const activePlates = plates.filter(p => !p.deathTime); // Only check active plates

        for (let i = 0; i < activePlates.length; i++) {
            for (let j = i + 1; j < activePlates.length; j++) {
                const p1 = activePlates[i];
                const p2 = activePlates[j];

                // 1. Check for basic Overlap (Convergent/Overlap)
                const overlap = this.checkOverlap(p1, p2);
                if (overlap) {
                    const type = this.classifyBoundaryProps(p1, p2, overlap.center);
                    boundaries.push({
                        id: `${p1.id}-${p2.id}-col`,
                        type: type.type,
                        plateIds: [p1.id, p2.id],
                        points: overlap.rings,
                        velocity: type.velocity
                    });
                }
            }
        }
        return boundaries;
    }

    private static checkOverlap(p1: TectonicPlate, p2: TectonicPlate): { rings: Coordinate[][], center: Coordinate } | null {
        // Convert to format
        const coords1 = p1.polygons.map(p => this.polyToRing(p));
        const coords2 = p2.polygons.map(p => this.polyToRing(p));

        try {
            const intersection = polygonClipping.intersection(coords1 as any, coords2 as any);
            if (intersection.length > 0) {
                // Store as list of rings for proper rendering
                const rings: Coordinate[][] = [];
                intersection.forEach(multi => multi.forEach(ring => {
                    rings.push(ring.map(pt => [pt[0], pt[1]] as Coordinate));
                }));

                // Approximate center
                if (rings.length === 0 || rings[0].length === 0) return null;
                const center = rings[0][0];

                return { rings, center };
            }
        } catch (e) {
            // Ignore clipping errors
        }
        return null;
    }

    private static polyToRing(poly: Polygon): number[][] {
        const ring = poly.points.map(pt => [pt[0], pt[1]]);
        if (ring.length > 0 && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])) {
            ring.push(ring[0]); // Close
        }
        return ring;
    }

    private static classifyBoundaryProps(p1: TectonicPlate, p2: TectonicPlate, boundaryPt: Coordinate): { type: 'convergent' | 'divergent' | 'transform', velocity: number } {
        // Calculate velocity of P1 at boundaryPt
        const v1 = this.calculatePlateVelocityAt(p1, boundaryPt);
        // Calculate velocity of P2 at boundaryPt
        const v2 = this.calculatePlateVelocityAt(p2, boundaryPt);

        // Relative velocity: Vrel = V1 - V2 (approaching?)
        // Vector from P1 center to boundary? No, just local movement.

        // If we consider P2 static, P1 is moving with V_rel = V1 - V2.
        const vRel = subtractVectors(v1, v2);
        const speed = Math.sqrt(dot(vRel, vRel));

        // Determine if approaching or separating
        // We need a normal vector to the boundary.
        // For simple overlap, the "center of overlap" relative to "center of plate" hints direction.
        // Vector Center1 -> Boundary
        const pos1 = latLonToVector(p1.center);
        // unused: const dir1 = normalize(subtractVectors(posB, pos1)); 

        // Dot product of Velocity vs Outward Dir
        // If P1 moves OUTWARD towards boundary, and P2 moves INWARD (relative), it's converging.
        // Actually, just project Vrel onto P1->P2 vector?
        // Vector P1 -> P2
        const pos2 = latLonToVector(p2.center);
        const p1p2 = normalize(subtractVectors(pos2, pos1));

        const closingSpeed = dot(vRel, p1p2);
        // If V1 moves towards P2 (positive dot), and V2 is static...
        // Vrel = V1. dot(V1, p1p2) > 0 => approaching P2 -> Convergence.

        if (closingSpeed > 0.05) return { type: 'convergent', velocity: Math.abs(closingSpeed) };
        if (closingSpeed < -0.05) return { type: 'divergent', velocity: Math.abs(closingSpeed) };

        return { type: 'transform', velocity: speed };
    }

    private static calculatePlateVelocityAt(plate: TectonicPlate, pt: Coordinate): { x: number, y: number, z: number } {
        // w = rate * axis
        // v = w x r
        // Rate is deg/Ma. Convert to rad/Ma? 
        // Just relative scale matters for classification.

        const pole = plate.motion.eulerPole;
        const rateRad = pole.rate * (Math.PI / 180);
        const axis = latLonToVector(pole.position);
        const omega = scaleVector(axis, rateRad);

        const r = latLonToVector(pt);

        return cross(omega, r);
    }
}
