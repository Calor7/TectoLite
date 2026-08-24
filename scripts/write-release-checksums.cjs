const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const releaseDir = path.resolve(process.argv[2] || 'release');
const { productName = 'TectoLite', version } = require('../package.json');
if (typeof version !== 'string' || !version) throw new Error('package.json has no release version');

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

if (!fs.existsSync(releaseDir)) throw new Error(`Release directory does not exist: ${releaseDir}`);

const prefix = `${escapeRegex(productName)}-${escapeRegex(version)}`;
const expectedPatterns = process.platform === 'win32'
  ? [new RegExp(`^${escapeRegex(productName)}-Portable-${escapeRegex(version)}-[^.]+\\.exe$`), new RegExp(`^${escapeRegex(productName)}-Setup-${escapeRegex(version)}-[^.]+\\.exe$`)]
  : process.platform === 'darwin'
    ? [new RegExp(`^${prefix}-[^.]+\\.dmg$`), new RegExp(`^${prefix}-[^.]+\\.zip$`)]
    : [new RegExp(`^${prefix}-[^.]+\\.AppImage$`), new RegExp(`^${prefix}-[^.]+\\.deb$`)];

const releaseFiles = fs.readdirSync(releaseDir, { withFileTypes: true }).filter(entry => entry.isFile());
const artifacts = [];
for (const pattern of expectedPatterns) {
  const matches = releaseFiles.filter(entry => pattern.test(entry.name));
  if (matches.length === 0) throw new Error(`Missing expected release artifact matching ${pattern}`);
  artifacts.push(...matches.map(entry => path.join(releaseDir, entry.name)));
}
artifacts.sort((left, right) => left.localeCompare(right));

const checksumLines = artifacts.map(artifactPath => {
  const stats = fs.statSync(artifactPath);
  if (stats.size === 0) throw new Error(`Release artifact is empty: ${artifactPath}`);
  const digest = crypto.createHash('sha256').update(fs.readFileSync(artifactPath)).digest('hex');
  const relativePath = path.relative(releaseDir, artifactPath).split(path.sep).join('/');
  return `${digest}  ${relativePath}`;
});

const outputPath = path.join(releaseDir, `SHA256SUMS-${process.platform}.txt`);
fs.writeFileSync(outputPath, `${checksumLines.join('\n')}\n`, 'utf8');
console.log(`[checksums] wrote ${checksumLines.length} SHA-256 checksums to ${outputPath}`);
