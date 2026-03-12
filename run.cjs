
const fs = require('fs');
let code = fs.readFileSync('src/SplitTool.ts', 'utf8');
code = code.replace('        rightPlate,', '    const newPlates: TectonicPlate[] = [\n        leftPlate,\n        rightPlate,');
fs.writeFileSync('src/SplitTool.ts', code);

