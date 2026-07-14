import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { S2CellId, S2Cell, S2LatLng } from 'nodes2ts';
import { DECOR_MAPPINGS } from './decor-mappings.mjs';

const CELL_LEVEL = Number(process.env.S2_LEVEL || 17);
const PARENT_LEVEL = Number(process.env.S2_PARENT_LEVEL || 11);
const IN = new URL(`../data/derived/decor-cells-l${CELL_LEVEL}.geojson`, import.meta.url);
const OUT_ROOT = new URL('../public/data/cell-tiles/', import.meta.url);
const INDEX = new URL('../public/data/cell-tiles-index.json', import.meta.url);

function llFromPoint(p) {
  const ll = S2LatLng.fromPoint(p);
  return [Number(ll.lngDegrees.toFixed(7)), Number(ll.latDegrees.toFixed(7))];
}

function cellRing(token) {
  const cell = new S2Cell(S2CellId.fromToken(token));
  const ring = [0, 1, 2, 3].map(i => llFromPoint(cell.getVertex(i)));
  ring.push(ring[0]);
  return ring;
}

function bboxForRing(bbox, ring) {
  for (const [lon, lat] of ring) {
    bbox.minLng = Math.min(bbox.minLng, lon);
    bbox.minLat = Math.min(bbox.minLat, lat);
    bbox.maxLng = Math.max(bbox.maxLng, lon);
    bbox.maxLat = Math.max(bbox.maxLat, lat);
  }
}

function parentToken(token) {
  return S2CellId.fromToken(token).parentL(PARENT_LEVEL).toToken();
}

function maskForDecors(decors, bitByDecor) {
  // Decor bit indexes can exceed 31, so stay in float math (exact below 2^53); no 32-bit bitwise ops.
  let mask = 0;
  for (const decor of decors) mask += 2 ** bitByDecor.get(decor);
  return mask;
}

const MAX_NAMES_PER_CELL = 4;
const MAX_NAME_LENGTH = 48;

function namesForCell(spots) {
  const names = [];
  for (const spot of spots || []) {
    const name = String(spot.name || '').trim();
    if (!name || name === '(unnamed)' || names.includes(name)) continue;
    names.push(name.length > MAX_NAME_LENGTH ? `${name.slice(0, MAX_NAME_LENGTH - 1)}…` : name);
    if (names.length >= MAX_NAMES_PER_CELL) break;
  }
  return names;
}

const cells = JSON.parse(await readFile(IN, 'utf8'));
// The legend comes straight from DECOR_MAPPINGS order — including retired placeholder
// entries and zero-count categories — so bit indices are deterministic and published
// positions are never reused across deploys (retired bits simply never get set).
const decorTypes = DECOR_MAPPINGS.map(d => d.name);
const colorByDecor = Object.fromEntries(DECOR_MAPPINGS.map(d => [d.name, d.color]));
const bitByDecor = new Map(decorTypes.map((name, i) => [name, i]));

await rm(OUT_ROOT, { recursive: true, force: true });
const buckets = new Map();
for (const f of cells.features) {
  const token = f.properties.token;
  const p = parentToken(token);
  if (!buckets.has(p)) {
    buckets.set(p, {
      parentToken: p,
      bbox: { minLng: Infinity, minLat: Infinity, maxLng: -Infinity, maxLat: -Infinity },
      cellLevel: CELL_LEVEL,
      cellTokens: [],
      decorMasks: [],
      centers: [],
      rings: [],
      spotCounts: [],
      names: [],
    });
  }
  const chunk = buckets.get(p);
  const ring = cellRing(token);
  bboxForRing(chunk.bbox, ring);
  chunk.cellTokens.push(token);
  chunk.decorMasks.push(maskForDecors(f.properties.decors, bitByDecor));
  chunk.centers.push(f.properties.center.map(n => Number(n.toFixed(7))));
  chunk.rings.push(ring);
  chunk.spotCounts.push(f.properties.spotCount || 0);
  chunk.names.push(namesForCell(f.properties.spots));
}

const tiles = [];
for (const [parent, chunk] of buckets) {
  const dir = new URL(`${parent.slice(0, 3)}/`, OUT_ROOT);
  await mkdir(dir, { recursive: true });
  const path = `${parent.slice(0, 3)}/${parent}.json`;
  await writeFile(new URL(`${parent}.json`, dir), JSON.stringify(chunk));
  tiles.push({ parentToken: parent, path, count: chunk.cellTokens.length, bbox: chunk.bbox });
}

tiles.sort((a, b) => a.parentToken.localeCompare(b.parentToken));
await writeFile(INDEX, JSON.stringify({
  generatedAt: new Date().toISOString(),
  schemaVersion: 3,
  s2CellLevel: CELL_LEVEL,
  s2ChunkParentLevel: PARENT_LEVEL,
  tileCount: tiles.length,
  cellCount: cells.features.length,
  decorTypes,
  colorByDecor,
  tiles,
}, null, 2));
console.log(`Wrote ${cells.features.length} cells into ${tiles.length} S2 parent L${PARENT_LEVEL} chunks`);
