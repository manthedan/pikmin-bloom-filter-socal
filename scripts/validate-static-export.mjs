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
await access(`public/data/cell-tiles/${index.tiles[0].path}`);

console.log(`Static export ready: public/ with ${index.tileCount} chunks and ${index.cellCount} cells.`);
