import { readFile, writeFile } from 'node:fs/promises';
import { S2CellId, S2LatLng, S2Cell } from 'nodes2ts';

const LEVEL = Number(process.env.S2_LEVEL || 17);
const IN = new URL('../public/data/decor-spots.geojson', import.meta.url);
const OUT = new URL(`../public/data/decor-cells-l${LEVEL}.geojson`, import.meta.url);

function cellIdFor(lon, lat) {
  return S2CellId.fromPoint(S2LatLng.fromDegrees(lat, lon).toPoint()).parentL(LEVEL);
}

function llFromPoint(p) {
  const ll = S2LatLng.fromPoint(p);
  return [ll.lngDegrees, ll.latDegrees];
}

function cellPolygon(id) {
  const cell = new S2Cell(id);
  const ring = [0, 1, 2, 3].map(i => llFromPoint(cell.getVertex(i)));
  ring.push(ring[0]);
  return ring;
}

const spots = JSON.parse(await readFile(IN, 'utf8'));
const cells = new Map();
for (const f of spots.features) {
  const [lon, lat] = f.properties.center || f.geometry.coordinates;
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
  const id = cellIdFor(lon, lat);
  const token = id.toToken();
  if (!cells.has(token)) {
    const center = id.toLatLng();
    cells.set(token, {
      token,
      center: [center.lngDegrees, center.latDegrees],
      decors: new Set(),
      spots: [],
      colorByDecor: {},
    });
  }
  const c = cells.get(token);
  for (const d of f.properties.decors) {
    c.decors.add(d);
    c.colorByDecor[d] = f.properties.decorColors[d];
  }
  c.spots.push({ id: f.id, name: f.properties.name, decors: f.properties.decors, center: f.properties.center });
}

const features = [...cells.values()].map(c => ({
  type: 'Feature',
  id: c.token,
  geometry: { type: 'Polygon', coordinates: [cellPolygon(S2CellId.fromToken(c.token))] },
  properties: {
    token: c.token,
    level: LEVEL,
    center: c.center,
    decors: [...c.decors].sort(),
    colorByDecor: c.colorByDecor,
    spotCount: c.spots.length,
    spots: c.spots.slice(0, 20),
  },
}));

const out = {
  type: 'FeatureCollection',
  name: `Costa Mesa approximate decor S2 cells L${LEVEL}`,
  generatedAt: new Date().toISOString(),
  source: 'Derived from public/data/decor-spots.geojson OSM candidates',
  detectorRadiusMeters: 100,
  s2Level: LEVEL,
  features,
};

await writeFile(OUT, JSON.stringify(out));
console.log(`Wrote ${features.length} S2 level ${LEVEL} cells to ${OUT.pathname}`);
