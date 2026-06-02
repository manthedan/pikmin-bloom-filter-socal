import { access, readFile, readdir } from 'node:fs/promises';

const TILE_INDEX_SCHEMA_VERSION = 2;

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

async function listJsonFiles(root, dir = root) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) files.push(...await listJsonFiles(root, path));
    else if (entry.isFile() && entry.name.endsWith('.json')) files.push(path.slice(root.length + 1));
  }
  return files;
}

const index = JSON.parse(await readFile('public/data/cell-tiles-index.json', 'utf8'));
if (index.schemaVersion !== TILE_INDEX_SCHEMA_VERSION) {
  throw new Error(`cell-tiles-index.json schemaVersion ${index.schemaVersion} does not match expected ${TILE_INDEX_SCHEMA_VERSION}`);
}
if (!index.tiles?.length) throw new Error('cell-tiles-index.json has no tiles');
if (index.tileCount !== index.tiles.length) {
  throw new Error(`cell-tiles-index.json tileCount ${index.tileCount} does not match ${index.tiles.length} tiles`);
}

const indexedPaths = new Set(index.tiles.map(t => t.path));
const actualPaths = new Set(await listJsonFiles('public/data/cell-tiles'));
for (const path of actualPaths) {
  if (!indexedPaths.has(path)) throw new Error(`Unindexed cell tile exists: public/data/cell-tiles/${path}`);
}
for (const path of indexedPaths) {
  if (!actualPaths.has(path)) throw new Error(`Indexed cell tile is missing: public/data/cell-tiles/${path}`);
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
