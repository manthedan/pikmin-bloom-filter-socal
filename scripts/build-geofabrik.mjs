import { existsSync } from 'node:fs';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { DECOR_MAPPINGS } from './decor-mappings.mjs';

const ROOT = new URL('../', import.meta.url);
const WORK = new URL('../data/osm/', import.meta.url);
const OUT_DIR = new URL('../public/data/', import.meta.url);
const GEOFABRIK_URL = process.env.GEOFABRIK_URL || 'https://download.geofabrik.de/north-america/us/california/socal-latest.osm.pbf';
const REGION = process.env.REGION || 'oc-play-areas';
const BBOX = process.env.BBOX || '-118.06,33.52,-117.66,33.80'; // W,S,E,N: Huntington/Newport/Irvine/Santa Ana/Costa Mesa
const PBF = new URL('socal-latest.osm.pbf', WORK);
const EXTRACT = new URL(`${REGION}.osm.pbf`, WORK);
const FILTERS = new URL('decor-tags-filter.txt', WORK);
const MATCHED = new URL(`${REGION}-decor.osm.pbf`, WORK);
const RAW_GEOJSON = new URL(`${REGION}-decor.raw.geojson`, WORK);

function run(cmd, args, opts = {}) {
  console.log(`$ ${cmd} ${args.join(' ')}`);
  const res = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (res.status !== 0) throw new Error(`${cmd} exited ${res.status}`);
}

function parseTag(tag) {
  const idx = tag.indexOf('=');
  return [tag.slice(0, idx), tag.slice(idx + 1)];
}

function splitValues(value) {
  return String(value ?? '').split(';').map(v => v.trim()).filter(Boolean);
}

function tagsContain(tags, wanted) {
  const [key, val] = parseTag(wanted);
  return splitValues(tags[key]).includes(val);
}

function matchDecors(tags = {}) {
  return DECOR_MAPPINGS.filter(decor => {
    const simple = (decor.tags || []).some(tag => tagsContain(tags, tag));
    const grouped = (decor.tagGroups || []).some(group => group.every(tag => tagsContain(tags, tag)));
    return simple || grouped;
  }).map(({ name, color }) => ({ name, color }));
}

function centerOfCoords(coords) {
  let sx = 0, sy = 0, n = 0;
  const walk = c => {
    if (typeof c[0] === 'number') { sx += c[0]; sy += c[1]; n++; return; }
    for (const x of c) walk(x);
  };
  walk(coords);
  return n ? [sx / n, sy / n] : null;
}

function osmId(props) {
  const type = props['@type'] || props.type || props.osm_type || 'object';
  const id = props['@id'] || props.id || props.osm_id;
  return { type, id, key: `${type}/${id}` };
}

function filterExpressions() {
  const expr = new Set();
  const add = tag => {
    const [k, v] = parseTag(tag);
    for (const p of ['n', 'w', 'r']) expr.add(`${p}/${k}=${v}`);
  };
  for (const decor of DECOR_MAPPINGS) {
    for (const t of decor.tags || []) add(t);
    for (const g of decor.tagGroups || []) for (const t of g) add(t);
  }
  return [...expr].sort().join('\n') + '\n';
}

async function main() {
  await mkdir(WORK, { recursive: true });
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(FILTERS, filterExpressions());

  if (!existsSync(PBF)) {
    run('curl', ['-L', '-C', '-', '--fail', '--show-error', '-o', PBF.pathname, GEOFABRIK_URL]);
  }

  run('osmium', ['extract', '-b', BBOX, '-s', 'complete_ways', '-O', '-o', EXTRACT.pathname, PBF.pathname]);
  run('osmium', ['tags-filter', '-e', FILTERS.pathname, '-O', '-o', MATCHED.pathname, EXTRACT.pathname]);
  run('osmium', ['export', '-a', 'type,id', '-O', '-o', RAW_GEOJSON.pathname, MATCHED.pathname]);

  const raw = JSON.parse(await readFile(RAW_GEOJSON, 'utf8'));
  const features = [];
  const seen = new Set();
  for (const f of raw.features || []) {
    const tags = { ...f.properties };
    delete tags['@type']; delete tags['@id']; delete tags.type; delete tags.id;
    const decors = matchDecors(tags);
    if (!decors.length) continue;
    const center = centerOfCoords(f.geometry.coordinates);
    if (!center) continue;
    const { type, id, key } = osmId(f.properties);
    if (seen.has(key)) continue;
    seen.add(key);
    features.push({
      type: 'Feature',
      id: key,
      geometry: f.geometry,
      properties: {
        id: key,
        osmType: type,
        osmId: id,
        name: tags.name || tags['name:en'] || tags.brand || '(unnamed)',
        decors: decors.map(d => d.name),
        decorColors: Object.fromEntries(decors.map(d => [d.name, d.color])),
        tags,
        center,
      },
    });
  }

  const counts = Object.fromEntries(DECOR_MAPPINGS.map(d => [d.name, 0]));
  for (const f of features) for (const d of f.properties.decors) counts[d]++;
  const manifest = {
    generatedAt: new Date().toISOString(),
    source: GEOFABRIK_URL,
    region: REGION,
    bbox: BBOX.split(',').map(Number),
    featureCount: features.length,
    counts,
    categories: DECOR_MAPPINGS.map(({ name, color }) => ({ name, color, count: counts[name] || 0 })),
  };
  const collection = {
    type: 'FeatureCollection',
    name: `${REGION} Pikmin Bloom decor candidates from Geofabrik OSM`,
    generatedAt: manifest.generatedAt,
    bbox: manifest.bbox,
    attribution: '© OpenStreetMap contributors; derived from OSM tags; unofficial Pikmin Bloom companion data',
    features,
  };
  await writeFile(new URL('decor-spots.geojson', OUT_DIR), JSON.stringify(collection));
  await writeFile(new URL('manifest.json', OUT_DIR), JSON.stringify(manifest, null, 2));
  console.log(`Wrote ${features.length} features from Geofabrik extract`);
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
