import { readFile, writeFile } from 'node:fs/promises';
import { S2CellId, S2LatLng, S2Cell } from 'nodes2ts';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { point } from '@turf/helpers';

const LEVEL = Number(process.env.S2_LEVEL || 17);
const POLYGON_SAMPLE_METERS = Number(process.env.POLYGON_SAMPLE_METERS || 35);
const LINE_SAMPLE_METERS = Number(process.env.LINE_SAMPLE_METERS || 25);
const WATERSIDE_LINE_BUFFER_METERS = Number(process.env.WATERSIDE_LINE_BUFFER_METERS || 35);
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

function walkPositions(coords, fn) {
  if (!Array.isArray(coords)) return;
  if (typeof coords[0] === 'number') return fn(coords);
  for (const c of coords) walkPositions(c, fn);
}

function bboxOfGeometry(geometry) {
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  walkPositions(geometry.coordinates, ([lon, lat]) => {
    minLon = Math.min(minLon, lon); minLat = Math.min(minLat, lat);
    maxLon = Math.max(maxLon, lon); maxLat = Math.max(maxLat, lat);
  });
  return [minLon, minLat, maxLon, maxLat];
}

function metersToLatDegrees(m) {
  return m / 111320;
}

function metersToLonDegrees(m, lat) {
  return m / (111320 * Math.max(0.2, Math.cos(lat * Math.PI / 180)));
}

function lonLatToMeters(lon, lat, refLat) {
  return [lon * 111320 * Math.cos(refLat * Math.PI / 180), lat * 111320];
}

function metersToLonLat(x, y, refLat) {
  return [x / (111320 * Math.cos(refLat * Math.PI / 180)), y / 111320];
}

function lineStringsOfGeometry(geometry) {
  if (geometry.type === 'LineString') return [geometry.coordinates];
  if (geometry.type === 'MultiLineString') return geometry.coordinates;
  return [];
}

function samePosition(a, b) {
  return Array.isArray(a) && Array.isArray(b) && Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
}

function isClosedLineString(geometry) {
  return geometry.type === 'LineString' && geometry.coordinates.length >= 4 && samePosition(geometry.coordinates[0], geometry.coordinates.at(-1));
}

function asPolygonFeature(f) {
  return { ...f, geometry: { type: 'Polygon', coordinates: [f.geometry.coordinates] } };
}

const spots = JSON.parse(await readFile(IN, 'utf8'));
const cells = new Map();

function addCellForFeature(f, lon, lat) {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
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
  if (c.spots.length < 80 && !c.spots.some(s => s.id === f.id)) {
    c.spots.push({ id: f.id, name: f.properties.name, decors: f.properties.decors, center: f.properties.center });
  }
}

function addLineBufferedCells(f, bufferMeters) {
  for (const line of lineStringsOfGeometry(f.geometry)) {
    for (let i = 1; i < line.length; i++) {
      const [lon1, lat1] = line[i - 1];
      const [lon2, lat2] = line[i];
      const refLat = (lat1 + lat2) / 2;
      const [x1, y1] = lonLatToMeters(lon1, lat1, refLat);
      const [x2, y2] = lonLatToMeters(lon2, lat2, refLat);
      const dx = x2 - x1, dy = y2 - y1;
      const len = Math.hypot(dx, dy);
      if (!len) continue;
      const nx = -dy / len, ny = dx / len;
      const steps = Math.max(1, Math.ceil(len / LINE_SAMPLE_METERS));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const bx = x1 + dx * t;
        const by = y1 + dy * t;
        for (let off = -bufferMeters; off <= bufferMeters; off += LINE_SAMPLE_METERS) {
          const [lon, lat] = metersToLonLat(bx + nx * off, by + ny * off, refLat);
          addCellForFeature(f, lon, lat);
        }
      }
    }
  }
}

function addPolygonCells(f) {
  const [minLon, minLat, maxLon, maxLat] = bboxOfGeometry(f.geometry);
  if (![minLon, minLat, maxLon, maxLat].every(Number.isFinite)) return;

  const seenTokens = new Set();
  const addIfCellCenterInside = (lon, lat) => {
    const id = cellIdFor(lon, lat);
    const token = id.toToken();
    if (seenTokens.has(token)) return;
    seenTokens.add(token);
    const center = id.toLatLng();
    const clon = center.lngDegrees;
    const clat = center.latDegrees;
    if (booleanPointInPolygon(point([clon, clat]), f)) addCellForFeature(f, clon, clat);
  };

  // Try the representative point first, but only keep it if its S2 cell center is inside the polygon.
  if (f.properties.center) {
    const [lon, lat] = f.properties.center;
    addIfCellCenterInside(lon, lat);
  }

  const latStep = metersToLatDegrees(POLYGON_SAMPLE_METERS);
  const lonStep = metersToLonDegrees(POLYGON_SAMPLE_METERS, (minLat + maxLat) / 2);

  for (let lat = minLat; lat <= maxLat; lat += latStep) {
    for (let lon = minLon; lon <= maxLon; lon += lonStep) {
      addIfCellCenterInside(lon, lat);
    }
  }
}

for (const f of spots.features) {
  if (!f.geometry) continue;
  if (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon') {
    addPolygonCells(f);
  } else if (isClosedLineString(f.geometry)) {
    addPolygonCells(asPolygonFeature(f));
  } else if ((f.geometry.type === 'LineString' || f.geometry.type === 'MultiLineString') && f.properties.decors.includes('Waterside')) {
    addLineBufferedCells(f, WATERSIDE_LINE_BUFFER_METERS);
  } else {
    const [lon, lat] = f.properties.center || f.geometry.coordinates;
    addCellForFeature(f, lon, lat);
  }
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
  name: `Approximate decor S2 cells L${LEVEL}`,
  generatedAt: new Date().toISOString(),
  source: 'Derived from public/data/decor-spots.geojson OSM candidates',
  detectorRadiusMeters: 100,
  s2Level: LEVEL,
  polygonSampleMeters: POLYGON_SAMPLE_METERS,
  lineSampleMeters: LINE_SAMPLE_METERS,
  watersideLineBufferMeters: WATERSIDE_LINE_BUFFER_METERS,
  features,
};

await writeFile(OUT, JSON.stringify(out));
console.log(`Wrote ${features.length} S2 level ${LEVEL} cells to ${OUT.pathname}`);
