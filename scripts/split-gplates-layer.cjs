/**
 * Split a preprocessed GPlates JSON layer into smaller independently loaded
 * chunks without changing plate order or geometry.
 *
 * Usage:
 *   node scripts/split-gplates-layer.cjs <source.json[,source-2.json]> <max-bytes>
 */
const fs = require('fs');
const path = require('path');

const sourceArg = process.argv[2];
const maxBytes = Number.parseInt(process.argv[3] || '400000', 10);
if (!sourceArg || !Number.isFinite(maxBytes) || maxBytes < 1000) {
    throw new Error('Usage: node scripts/split-gplates-layer.cjs <source.json[,source-2.json]> <max-bytes>');
}

const sourcePaths = sourceArg.split(',').map(value => path.resolve(value));
const sources = sourcePaths.map(sourcePath => JSON.parse(fs.readFileSync(sourcePath, 'utf8')));
if (sources.some(source => !Array.isArray(source.plates))) throw new Error('Every source must contain a plates array');
const source = { ...sources[0], plates: sources.flatMap(value => value.plates) };

const extension = path.extname(sourcePaths[0]);
const prefix = sourcePaths[0].slice(0, -extension.length).replace(/-\d+$/, '');
const prefixName = path.basename(prefix);
for (const filename of fs.readdirSync(path.dirname(prefix))) {
    if (new RegExp(`^${prefixName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-\\d+\\${extension}$`).test(filename)) {
        fs.unlinkSync(path.join(path.dirname(prefix), filename));
    }
}
const chunks = [];
let current = [];
let currentBytes = 0;
for (const plate of source.plates) {
    const plateBytes = Buffer.byteLength(JSON.stringify(plate), 'utf8');
    if (current.length > 0 && currentBytes + plateBytes > maxBytes) {
        chunks.push(current);
        current = [];
        currentBytes = 0;
    }
    current.push(plate);
    currentBytes += plateBytes;
}
if (current.length > 0) chunks.push(current);

for (let index = 1; index <= chunks.length; index += 1) {
    const plates = chunks[index - 1];
    const output = { ...source, plateCount: plates.length, plates };
    const outputPath = `${prefix}-${index}${extension}`;
    fs.writeFileSync(outputPath, JSON.stringify(output), 'utf8');
    console.log(`${path.basename(outputPath)}: ${plates.length} plates`);
}
