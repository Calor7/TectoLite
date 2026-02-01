import { TectonicPlate, Boundary, Coordinate, Polygon } from './types';
import polygonClipping from 'polygon-clipping';
import { latLonToVector, scaleVector, subtractVectors, cross, normalize, dot } from './utils/sphericalMath';

export class BoundarySystem {

    // Detect boundaries between plates based on overlap and movement
    public static detectBoundaries(plates: TectonicPlate[]): Boundary[] {
        const boundaries: Boundary[] = [];
        const activePlates = plates.filter(p => !p.deathTime); // Only check active plates

        // FRAME BUDGET: Prevent boundary detection from blocking UI
        const startTime = performance.now();
        const MAX_DETECTION_MS = 50;

        // Pre-calculate BBoxes for performance
        const bboxes = activePlates.map(p => this.getPlateBBox(p));

        for (let i = 0; i < activePlates.length; i++) {
            for (let j = i + 1; j < activePlates.length; j++) {
                // Frame budget check
                if (performance.now() - startTime > MAX_DETECTION_MS) {
                    return boundaries; // Return what we have so far
                }

                const p1 = activePlates[i];
                const p2 = activePlates[j];
                
                // Fast BBox Overlap Check
                // If bounding boxes don't overlap, skip expensive polygon clipping
                if (!this.bboxesOverlap(bboxes[i], bboxes[j])) continue;

                // PRE-CHECK VELOCITY BEFORE EXPENSIVE GEOMETRY
                // Previously skipped diverging entirely, but visualization is fine
                // The freeze is in GeologicalAutomation, not here
                const preVelocity = this.quickVelocityCheck(p1, p2);

                // 1. Check for basic Overlap (Convergent)
                const overlap = this.checkOverlap(p1, p2);
                if (overlap) {
                    // Check relative velocity to decide if truly converging vs sliding vs purely overlapping static
                    const type = this.classifyBoundaryProps(p1, p2, overlap.center);

                    boundaries.push({
                        id: `${p1.id}-${p2.id}-col`,
                        type: type.type,
                        plateIds: [p1.id, p2.id],
                        points: overlap.rings,
                        velocity: type.velocity
                    });
                }

                // 2. Divergent Check (Simulated)
                // Real divergence leaves a gap. We might need Voronoi or expanding bounding box check.
                // For now, we skip divergence generation unless plates are "touching" but moving apart.
                // This is hard with simple polygon geometry. 
                // Worldbuilding Pasta suggests "Crust Generation" fills gaps.
            }
        }
        return boundaries;
    }

    private static checkOverlap(p1: TectonicPlate, p2: TectonicPlate): { rings: Coordinate[][], center: Coordinate } | null {
        // Convert to format AND Round Coordinates to avoid floating point 'dust'
        // Precision 4 = ~11 meters. Enough for tectonics, coarse enough to snap tiny gaps.
        const coords1 = p1.polygons.map(p => this.polyToRing(p).map(pt => [Number(pt[0].toFixed(4)), Number(pt[1].toFixed(4))]));
        const coords2 = p2.polygons.map(p => this.polyToRing(p).map(pt => [Number(pt[0].toFixed(4)), Number(pt[1].toFixed(4))]));

        try {
            const intersection = polygonClipping.intersection(coords1 as any, coords2 as any);
            if (intersection.length > 0) {
                // Store as list of rings for proper rendering
                let rings: Coordinate[][] = [];
                intersection.forEach(multi => multi.forEach(ring => {
                    // Filter "Dust": Remove tiny artifacts from clipping
                    // Minimum 4 points (triangle + closing point)
                    if (ring.length < 4) return;

                    // Area Check (Shoelace Formula approximation)
                    // Discard slivers with negligible area
                    let area = 0;
                    for (let i = 0; i < ring.length - 1; i++) {
                        area += ring[i][0] * ring[i+1][1] - ring[i+1][0] * ring[i][1];
                    }
                    area = Math.abs(area / 2);
                    
                    // Threshold: 0.2 deg^2 (approx 2500 km^2)
                    if (area < 0.2) return;

                    rings.push(ring.map(pt => [pt[0], pt[1]] as Coordinate));
                }));
                
                // Limit to top 5 largest rings
                if (rings.length > 5) {
                    rings.sort((a,b) => b.length - a.length);
                    rings = rings.slice(0, 5);
                }

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

    private static getPlateBBox(p: TectonicPlate) {
        let minX = 180, maxX = -180, minY = 90, maxY = -90;
        let hasPoints = false;
        
        for (const poly of p.polygons) {
            for (const pt of poly.points) {
                if (pt[0] < minX) minX = pt[0];
                if (pt[0] > maxX) maxX = pt[0];
                if (pt[1] < minY) minY = pt[1];
                if (pt[1] > maxY) maxY = pt[1];
                hasPoints = true;
            }
        }
        
        // Edge case handling for wrapping? (Ignored for now, standard -180/180 check)
        
        if (!hasPoints) return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
        // Expand slightly to catch edge cases
        return { minX: minX - 0.1, maxX: maxX + 0.1, minY: minY - 0.1, maxY: maxY + 0.1 };
    }

    private static bboxesOverlap(b1: any, b2: any): boolean {
        return !(b1.maxX < b2.minX || b1.minX > b2.maxX || b1.maxY < b2.minY || b1.minY > b2.maxY);
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
        
        // Threshold Tuning:
        // 1 cm/yr ~= 0.09 deg/Ma ~= 0.0016 rad/Ma
        // Previous threshold 0.05 was ~30 cm/yr (Too high!)
        // New threshold 0.0005 ~= 0.3 cm/yr (Catches most motion)
        const THRESHOLD = 0.0005;

        if (closingSpeed > THRESHOLD) return { type: 'convergent', velocity: Math.abs(closingSpeed) };
        if (closingSpeed < -THRESHOLD) return { type: 'divergent', velocity: Math.abs(closingSpeed) };

        return { type: 'transform', velocity: speed };
    }

    // Quick velocity check WITHOUT requiring intersection geometry
    // Used to pre-filter diverging plates before expensive polygon clipping
    private static quickVelocityCheck(p1: TectonicPlate, p2: TectonicPlate): 'converging' | 'diverging' | 'neutral' {
        // Use plate centers as proxy for boundary point
        const midLon = (p1.center[0] + p2.center[0]) / 2;
        const midLat = (p1.center[1] + p2.center[1]) / 2;
        const midPt: Coordinate = [midLon, midLat];

        const v1 = this.calculatePlateVelocityAt(p1, midPt);
        const v2 = this.calculatePlateVelocityAt(p2, midPt);
        const vRel = subtractVectors(v1, v2);

        const pos1 = latLonToVector(p1.center);
        const pos2 = latLonToVector(p2.center);
        const p1p2 = normalize(subtractVectors(pos2, pos1));

        const closingSpeed = dot(vRel, p1p2);

        if (closingSpeed > 0.0005) return 'converging';
        if (closingSpeed < -0.0005) return 'diverging';
        return 'neutral';
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
