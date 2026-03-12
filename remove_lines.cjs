@
const fs = require('fs');
let code = fs.readFileSync('src/SplitTool.ts', 'utf8');
let lines = code.split(/\r?\n/);

function removeLines(start, end) {
   for(let i=start-1; i <= end-1; i++) {
        lines[i] = '';
   }
}

removeLines(545, 912); // LRift
removeLines(1041, 1080); // Rift plate creation
lines[1330] = ''; // ...(riftPlate...)

lines[1021] = ''; // let riftAxisPath
lines[1163] = ''; // connectedRiftIds
lines[1164] = ''; // connectedRiftId
lines[1189] = ''; 
lines[1190] = ''; 

removeLines(1115, 1143); 

lines[1128] = ''; 
lines[1129] = ''; 
lines[1249] = ''; 
lines[1250] = ''; 
lines[1266] = ''; 
lines[1283] = ''; 
lines[1293] = ''; 
lines[1321] = ''; 

lines[1162] = lines[1162] + '\n        siblingSystem: true,'; 
lines[1188] = lines[1188] + '\n        siblingSystem: true,';

fs.writeFileSync('src/SplitTool.ts', lines.join('\n'));
console.log('Removed successfully.');
@
