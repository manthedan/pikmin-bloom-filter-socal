import { writeFile, mkdir } from 'node:fs/promises';
import { DECOR_MAPPINGS, COSTA_MESA_BBOX } from './decor-mappings.mjs';

const DERIVED_DIR = new URL('../data/derived/', import.meta.url);
const OUT_DIR = new URL('../public/data/', import.meta.url);
const OVERPASS_URL = process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter';
const bbox = `${COSTA_MESA_BBOX.south},${COSTA_MESA_BBOX.west},${COSTA_MESA_BBOX.north},${COSTA_MESA_BBOX.east}`;

function parseTag(tag) {
  const idx = tag.indexOf('=');
  return [tag.slice(0, idx), tag.slice(idx + 1)];
}

function buildOverpassQueryForDecor(decor) {
  const lines = [];
  for (const tag of decor.tags || []) {
    const [key, value] = parseTag(tag);
    lines.push(`nwr["${key}"="${value}"](${bbox});`);
  }
  for (const group of decor.tagGroups || []) {
    const predicates = group.map(t => {
      const [k, v] = parseTag(t);
      return `["${k}"="${v}"]`;
    }).join('');
    lines.push(`nwr${predicates}(${bbox});`);
  }
  return `[out:json][timeout:45];\n(\n  ${lines.join('\n  ')}\n);\nout geom center tags qt;`;
}

async function fetchOverpass(query) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  let res;
  try {
    res = await fetch(OVERPASS_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'user-agent': 'costa-mesa-pikmin-map/0.1 (local static OSM decor prototype)',
      },
      body: new URLSearchParams({ data: query }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`Overpass HTTP ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (json.remark) throw new Error(`Overpass error: ${json.remark}`);
  return json.elements || [];
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

function centerOfGeometry(element) {
  if (element.center) return [element.center.lon, element.center.lat];
  if (Number.isFinite(element.lon) && Number.isFinite(element.lat)) return [element.lon, element.lat];
  const geom = element.geometry || [];
  if (geom.length) {
    const sum = geom.reduce((acc, p) => [acc[0] + p.lon, acc[1] + p.lat], [0, 0]);
    return [sum[0] / geom.length, sum[1] / geom.length];
  }
  return null;
}

function geometryFor(element, center) {
  const geom = element.geometry || [];
  if ((element.type === 'way' || element.type === 'relation') && geom.length >= 2) {
    const coords = geom.map(p => [p.lon, p.lat]);
    const first = coords[0], last = coords[coords.length - 1];
    if (first[0] === last[0] && first[1] === last[1] && coords.length >= 4) {
      return { type: 'Polygon', coordinates: [coords] };
    }
    return { type: 'LineString', coordinates: coords };
  }
  return { type: 'Point', coordinates: center };
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  console.log(`Querying ${OVERPASS_URL} for Costa Mesa OSM decor candidates...`);
  const allElements = [];
  const queryLog = [];
  for (const decor of DECOR_MAPPINGS) {
    const query = buildOverpassQueryForDecor(decor);
    queryLog.push(`// ${decor.name}\n${query}`);
    try {
      const elements = await fetchOverpass(query);
      console.log(`${decor.name}: ${elements.length}`);
      allElements.push(...elements);
    } catch (err) {
      console.warn(`${decor.name}: skipped (${err.message.slice(0, 160).replace(/\s+/g, ' ')})`);
    }
  }

  const seen = new Set();
  const features = [];
  for (const el of allElements) {
    if (!el.tags) continue;
    const decors = matchDecors(el.tags);
    if (!decors.length) continue;
    const center = centerOfGeometry(el);
    if (!center) continue;
    const id = `${el.type}/${el.id}`;
    if (seen.has(id)) continue;
    seen.add(id);
    features.push({
      type: 'Feature',
      id,
      geometry: geometryFor(el, center),
      properties: {
        id,
        osmType: el.type,
        osmId: el.id,
        name: el.tags.name || el.tags['name:en'] || el.tags.brand || '(unnamed)',
        decors: decors.map(d => d.name),
        decorColors: Object.fromEntries(decors.map(d => [d.name, d.color])),
        tags: el.tags,
        center,
      },
    });
  }

  features.sort((a, b) => String(a.properties.name).localeCompare(String(b.properties.name)));
  const counts = Object.fromEntries(DECOR_MAPPINGS.map(d => [d.name, 0]));
  for (const f of features) for (const d of f.properties.decors) counts[d]++;

  const collection = {
    type: 'FeatureCollection',
    name: 'Costa Mesa Pikmin Bloom decor candidates from OpenStreetMap',
    generatedAt: new Date().toISOString(),
    bbox: [COSTA_MESA_BBOX.west, COSTA_MESA_BBOX.south, COSTA_MESA_BBOX.east, COSTA_MESA_BBOX.north],
    attribution: '© OpenStreetMap contributors; derived from OSM tags; unofficial Pikmin Bloom companion data',
    features,
  };

  const manifest = {
    generatedAt: collection.generatedAt,
    bbox: collection.bbox,
    featureCount: features.length,
    counts,
    categories: DECOR_MAPPINGS.map(({ name, color }) => ({ name, color, count: counts[name] || 0 })),
  };

  await mkdir(DERIVED_DIR, { recursive: true });
  await writeFile(new URL('decor-spots.geojson', DERIVED_DIR), JSON.stringify(collection));
  await writeFile(new URL('manifest.json', OUT_DIR), JSON.stringify(manifest, null, 2));
  await writeFile(new URL('last-query.overpassql', DERIVED_DIR), queryLog.join('\n\n'));
  console.log(`Wrote ${features.length} features to data/derived/decor-spots.geojson`);
  console.log(Object.entries(counts).filter(([, n]) => n).sort((a,b)=>b[1]-a[1]).map(([k,v]) => `${k}: ${v}`).join('\n'));
}

main().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
