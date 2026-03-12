const fs = require('fs');
let code = fs.readFileSync('src/SplitTool.ts', 'utf8');

// remove old 
code = code.replace('    const leftPlateId = generateId();\n    const rightPlateId = generateId();', '');

// insert near the start of splitPlate
const insertT = code.indexOf('let currentState = state;');
code = code.substring(0, insertT) + 'const leftPlateId = generateId();\n    const rightPlateId = generateId();\n    ' + code.substring(insertT);

fs.writeFileSync('src/SplitTool.ts', code);
