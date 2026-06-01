import { access, readFile } from 'node:fs/promises';

const required = [
  'public/index.html',
  'public/app.js',
  'public/styles.css',
  'public/vendor/leaflet/leaflet.css',
  'public/vendor/leaflet/leaflet.js',
  'public/data/manifest.json',
  'public/data/cell-tiles-index.json',
];

for (const path of required) await access(path);

const index = JSON.parse(await readFile('public/data/cell-tiles-index.json', 'utf8'));
if (!index.tiles?.length) throw new Error('cell-tiles-index.json has no tiles');
if (index.tileCount !== index.tiles.length) {
  throw new Error(`cell-tiles-index.json tileCount ${index.tileCount} does not match ${index.tiles.length} tiles`);
}

let indexedCellCount = 0;
for (const tile of index.tiles) {
  if (!tile.path) throw new Error(`Tile ${tile.parentToken || '(unknown)'} is missing path`);
  await access(`public/data/cell-tiles/${tile.path}`);
  indexedCellCount += tile.count || 0;
}
if (indexedCellCount !== index.cellCount) {
  throw new Error(`cell-tiles-index.json cellCount ${index.cellCount} does not match tile counts ${indexedCellCount}`);
}

console.log(`Static export ready: public/ with ${index.tileCount} chunks and ${index.cellCount} cells.`);
