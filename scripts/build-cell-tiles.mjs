import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';

const Z = Number(process.env.TILE_Z || 13);
const IN = new URL('../public/data/decor-cells-l17.geojson', import.meta.url);
const OUT_ROOT = new URL(`../public/data/cell-tiles/${Z}/`, import.meta.url);
const INDEX = new URL('../public/data/cell-tiles-index.json', import.meta.url);

function lonLatToTile(lon, lat, z) {
  const n = 2 ** z;
  const x = Math.floor((lon + 180) / 360 * n);
  const latRad = lat * Math.PI / 180;
  const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
  return [x, y];
}

const cells = JSON.parse(await readFile(IN, 'utf8'));
await rm(OUT_ROOT, { recursive: true, force: true });
const buckets = new Map();
for (const f of cells.features) {
  const [lon, lat] = f.properties.center;
  const [x, y] = lonLatToTile(lon, lat, Z);
  const key = `${x}/${y}`;
  if (!buckets.has(key)) buckets.set(key, []);
  buckets.get(key).push(f);
}

const tiles = [];
for (const [key, features] of buckets) {
  const [x, y] = key.split('/');
  const dir = new URL(`${x}/`, OUT_ROOT);
  await mkdir(dir, { recursive: true });
  const rel = `${Z}/${x}/${y}.json`;
  await writeFile(new URL(`${y}.json`, dir), JSON.stringify({ type: 'FeatureCollection', features }));
  tiles.push({ z: Z, x: Number(x), y: Number(y), path: rel, count: features.length });
}

tiles.sort((a, b) => a.x - b.x || a.y - b.y);
await writeFile(INDEX, JSON.stringify({ generatedAt: new Date().toISOString(), z: Z, tileCount: tiles.length, cellCount: cells.features.length, tiles }, null, 2));
console.log(`Wrote ${cells.features.length} cells into ${tiles.length} z${Z} chunks`);
