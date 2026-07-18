import { access, readFile, readdir } from 'node:fs/promises';
import { DECOR_MAPPINGS } from './decor-mappings.mjs';

const TILE_INDEX_SCHEMA_VERSION = 3;

const required = [
  'public/index.html',
  'public/app.js',
  'public/app-core.js',
  'public/styles.css',
  'public/manifest.webmanifest',
  'public/sw.js',
  'public/icons/icon-192.png',
  'public/icons/icon-512.png',
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

const appSource = await readFile('public/app.js', 'utf8');
const appSchema = appSource.match(/TILE_INDEX_SCHEMA_VERSION = (\d+)/)?.[1];
if (Number(appSchema) !== TILE_INDEX_SCHEMA_VERSION) {
  throw new Error(`public/app.js TILE_INDEX_SCHEMA_VERSION ${appSchema} does not match expected ${TILE_INDEX_SCHEMA_VERSION}`);
}
// Decor names are hand-mirrored across DECOR_MAPPINGS, the exported manifest, and the
// app's DECOR_EMOJI / FILTER_GROUPS lists; fail the build when they drift. Retired
// entries only hold bitmask slots — they appear in the tile legend but nowhere else.
const legendNames = DECOR_MAPPINGS.map(d => d.name);
if (JSON.stringify(index.decorTypes) !== JSON.stringify(legendNames)) {
  throw new Error('cell-tiles-index.json decorTypes does not match DECOR_MAPPINGS order — rebuild the dataset');
}
const mappingNames = new Set(DECOR_MAPPINGS.filter(d => !d.retired).map(d => d.name));
const manifest = JSON.parse(await readFile('public/data/manifest.json', 'utf8'));
const manifestNames = new Set((manifest.categories || []).map(c => c.name));
for (const name of mappingNames) {
  if (!manifestNames.has(name)) throw new Error(`manifest.json is stale: missing category '${name}' — rebuild the dataset`);
}
for (const name of manifestNames) {
  if (!mappingNames.has(name)) throw new Error(`manifest.json is stale: has removed category '${name}' — rebuild the dataset`);
}
const emojiBlock = appSource.match(/const DECOR_EMOJI = \{([\s\S]*?)\};/)?.[1] ?? '';
const emojiNames = new Set([...emojiBlock.matchAll(/'([^']+)':/g)].map(m => m[1]));
const groupsBlock = appSource.match(/const FILTER_GROUPS = \[([\s\S]*?)\n\];/)?.[1] ?? '';
const groupNames = new Set([...groupsBlock.matchAll(/'([^']+)'/g)].map(m => m[1]));
for (const name of mappingNames) {
  if (!emojiNames.has(name)) throw new Error(`public/app.js DECOR_EMOJI is missing '${name}'`);
  if (!groupNames.has(name)) throw new Error(`public/app.js FILTER_GROUPS is missing '${name}'`);
}
for (const name of emojiNames) {
  if (!mappingNames.has(name)) throw new Error(`public/app.js DECOR_EMOJI has unknown decor '${name}'`);
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
