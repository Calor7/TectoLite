const fs = require('fs');
let code = fs.readFileSync('src/SplitTool.ts', 'utf8');

// 1. Update SplitResult interface
const splitResultOld = \interface SplitResult {
    points: Coordinate[];
    riftIndices: number[];
    cutPath?: Coordinate[]; // The actual split line segment
}\;
const splitResultNew = \interface SplitResult {
    points: Coordinate[];
    riftIndices: number[];          // DEPRECATED
    cutEdgeIndices: number[];       // NEW: indices of edges that are part of the cut
    originalEdgeMap: number[];      // NEW: for each output vertex i, which input edge it came from (-1 = new)
    cutPath?: Coordinate[]; // The actual split line segment
}\;
code = code.replace(splitResultOld, splitResultNew);
fs.writeFileSync('src/SplitTool.ts', code);
