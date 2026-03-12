const fs = require('fs');
let code = fs.readFileSync('src/SplitTool.ts', 'utf8');
const lIdx = code.indexOf('interface LRiftResult {');
const nextIdx = code.indexOf('    const plateToSplit = state.world.plates.find(p => p.id === plateId)!;', lIdx);
console.log('L-Rift removed from ' + lIdx + ' to ' + nextIdx);
let newCode = code.substring(0, lIdx) + code.substring(nextIdx);
fs.writeFileSync('src/SplitTool.ts', newCode);
