const fs = require('fs');
let code = fs.readFileSync('src/SplitTool.ts', 'utf8');
const oldStr = \interface SplitResult {
    points: Coordinate[];
    riftIndices: number[];
    cutPath?: Coordinate[]; // The actual split line segment
}\;

const newStr = \interface SplitResult {
    points: Coordinate[];
    riftIndices: number[];
    cutEdgeIndices: number[];
    originalEdgeMap: number[];
    cutPath?: Coordinate[]; // The actual split line segment
}\;
code = code.replace(oldStr, newStr);

const sIdx = code.indexOf('function splitPolygonWithPolyline(');
const eIdx = code.indexOf('// --- HELPER: Motion Calculation');

const newFunc = \unction splitPolygonWithPolyline(
    polygonPoints: Coordinate[],
    polylinePoints: Coordinate[],
    existingRiftIndices?: number[]
): [SplitResult, SplitResult] {
    const defaultResult: [SplitResult, SplitResult] = [
        { points: polygonPoints, riftIndices: existingRiftIndices || [], cutEdgeIndices: [], originalEdgeMap: polygonPoints.map((_,i)=>i) },
        { points: [], riftIndices: [], cutEdgeIndices: [], originalEdgeMap: [] }
    ];

    if (polylinePoints.length < 2 || polygonPoints.length < 3) {
        return defaultResult;
    }

    const crossings: { index: number; point: Coordinate; polylineIdx: number }[] = [];

    for (let pi = 0; pi < polylinePoints.length - 1; pi++) {
        const pStart = polylinePoints[pi];
        const pEnd = polylinePoints[pi + 1];

        for (let bi = 0; bi < polygonPoints.length; bi++) {
            const bStart = polygonPoints[bi];
            const bEnd = polygonPoints[(bi + 1) % polygonPoints.length];

            const intersection = findSegmentIntersection(pStart, pEnd, bStart, bEnd);
            if (intersection) {
                crossings.push({ index: bi, point: intersection, polylineIdx: pi });
            }
        }
    }

    if (crossings.length < 2) {
        return defaultResult;
    }

    crossings.sort((a, b) => a.polylineIdx - b.polylineIdx);

    const firstCrossing = crossings[0];
    const secondCrossing = crossings[crossings.length - 1];

    const cutSegment: Coordinate[] = [];
    const intermediatePoints = polylinePoints.slice(
        firstCrossing.polylineIdx + 1,
        secondCrossing.polylineIdx + 1
    );
    cutSegment.push(...intermediatePoints);

    // --- CONSTRUCT POLYGON A ---
    const polyA: Coordinate[] = [];
    const riftA: number[] = [];
    const cutA: number[] = [];
    const mapA: number[] = [];

    polyA.push(firstCrossing.point);
    mapA.push(firstCrossing.index); 
    let currentPolyIndex = 0;

    let idx = (firstCrossing.index + 1) % polygonPoints.length;
    if (isRiftEdge(firstCrossing.index, existingRiftIndices)) riftA.push(currentPolyIndex);

    while (idx !== (secondCrossing.index + 1) % polygonPoints.length) {
        polyA.push(polygonPoints[idx]);
        currentPolyIndex++;
        mapA.push(idx);

        if (isRiftEdge(idx, existingRiftIndices)) riftA.push(currentPolyIndex);
        idx = (idx + 1) % polygonPoints.length;
    }

    polyA.push(secondCrossing.point);
    currentPolyIndex++;
    mapA.push(secondCrossing.index);

    const cutRev = [...cutSegment].reverse();
    riftA.push(currentPolyIndex);
    cutA.push(currentPolyIndex);

    for (const p of cutRev) {
        polyA.push(p);
        currentPolyIndex++;
        mapA.push(-1); // Cut point
        riftA.push(currentPolyIndex);
        cutA.push(currentPolyIndex);
    }
    riftA.push(currentPolyIndex); // Closing loop rift
    cutA.push(currentPolyIndex); // Closing loop cut

    // --- CONSTRUCT POLYGON B ---
    const polyB: Coordinate[] = [];
    const riftB: number[] = [];
    const cutB: number[] = [];
    const mapB: number[] = [];

    polyB.push(secondCrossing.point);
    mapB.push(secondCrossing.index);
    let currentPolyBIndex = 0;

    if (isRiftEdge(secondCrossing.index, existingRiftIndices)) riftB.push(currentPolyBIndex);

    idx = (secondCrossing.index + 1) % polygonPoints.length;
    while (idx !== (firstCrossing.index + 1) % polygonPoints.length) {
        polyB.push(polygonPoints[idx]);
        currentPolyBIndex++;
        mapB.push(idx);
        
        if (isRiftEdge(idx, existingRiftIndices)) riftB.push(currentPolyBIndex);
        idx = (idx + 1) % polygonPoints.length;
    }

    polyB.push(firstCrossing.point);
    currentPolyBIndex++;
    mapB.push(firstCrossing.index);

    riftB.push(currentPolyBIndex);
    cutB.push(currentPolyBIndex);

    for (const p of cutSegment) {
        polyB.push(p);
        currentPolyBIndex++;
        mapB.push(-1);
        riftB.push(currentPolyBIndex);
        cutB.push(currentPolyBIndex);
    }
    riftB.push(currentPolyBIndex);
    cutB.push(currentPolyBIndex);

    const fullCutPath = [firstCrossing.point, ...cutSegment, secondCrossing.point];

    return [
        { points: polyA, riftIndices: riftA, cutEdgeIndices: cutA, originalEdgeMap: mapA, cutPath: fullCutPath },
        { points: polyB, riftIndices: riftB, cutEdgeIndices: cutB, originalEdgeMap: mapB, cutPath: fullCutPath }
    ];
}
\

code = code.substring(0, sIdx) + newFunc + '\n' + code.substring(eIdx);
fs.writeFileSync('src/SplitTool.ts', code);
