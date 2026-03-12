const fs = require('fs');
let code = fs.readFileSync('src/SplitTool.ts', 'utf8');

code = code.replace(',\n    Polygon,', ',\n    Polygon,\n    EdgeMeta,\n    SiblingAssignment,\n    LineType,');

const insertIdx = code.indexOf('export function splitPlate');

const edgeMetaHelper = `
function assignSplitEdgeMeta(
    originalPoly: Polygon,
    resA: SplitResult,
    resB: SplitResult,
    plateIdA: string,
    plateIdB: string,
    currentTime: number,
    polyIndexA: number,
    polyIndexB: number
): { metaA: EdgeMeta[], metaB: EdgeMeta[] } {
    const groupId = generateId(); // Unique ID for this specific split cut

    const metaA: EdgeMeta[] = [];
    const metaB: EdgeMeta[] = [];

    // Map existing edges for Poly A
    for (let currentEdgIdx = 0; currentEdgIdx < resA.points.length; currentEdgIdx++) {
        const cutIdxA = resA.cutEdgeIndices.indexOf(currentEdgIdx);
        if (cutIdxA !== -1) {
            const cutIdxB = (resB.cutEdgeIndices.length - 1) - cutIdxA;
            const targetEdgIdxB = resB.cutEdgeIndices[cutIdxB];

            metaA.push({
                edgeIndex: currentEdgIdx,
                type: 'rift' as LineType,
                sourceId: groupId,
                siblings: [{
                    id: generateId(),
                    siblingPlateId: plateIdB,
                    siblingPolyIndex: polyIndexB,
                    siblingEdgeIndex: targetEdgIdxB,
                    groupId,
                    frozen: false,
                    createdAt: currentTime
                }]
            });
        } else {
            if (originalPoly.edgeMeta) {
                const origIdx = resA.originalEdgeMap[currentEdgIdx];
                if (origIdx !== -1) {
                    const existing = originalPoly.edgeMeta.find(e => e.edgeIndex === origIdx);
                    if (existing) {
                        metaA.push({
                            ...existing,
                            edgeIndex: currentEdgIdx,
                        });
                    }
                }
            }
        }
    }

    // Map existing edges for Poly B
    for (let currentEdgIdx = 0; currentEdgIdx < resB.points.length; currentEdgIdx++) {
        const cutIdxB = resB.cutEdgeIndices.indexOf(currentEdgIdx);
        if (cutIdxB !== -1) {
            const cutIdxA = (resA.cutEdgeIndices.length - 1) - cutIdxB;
            const targetEdgIdxA = resA.cutEdgeIndices[cutIdxA];

            metaB.push({
                edgeIndex: currentEdgIdx,
                type: 'rift' as LineType,
                sourceId: groupId,
                siblings: [{
                    id: generateId(),
                    siblingPlateId: plateIdA,
                    siblingPolyIndex: polyIndexA, 
                    siblingEdgeIndex: targetEdgIdxA,
                    groupId,
                    frozen: false,
                    createdAt: currentTime
                }]
            });
        } else {
            if (originalPoly.edgeMeta) {
                const origIdx = resB.originalEdgeMap[currentEdgIdx];
                if (origIdx !== -1) {
                    const existing = originalPoly.edgeMeta.find(e => e.edgeIndex === origIdx);
                    if (existing) {
                        metaB.push({
                            ...existing,
                            edgeIndex: currentEdgIdx,
                        });
                    }
                }
            }
        }
    }

    return { metaA, metaB };
}`;

code = code.substring(0, insertIdx) + edgeMetaHelper + '\n\n' + code.substring(insertIdx);
fs.writeFileSync('src/SplitTool.ts', code);
