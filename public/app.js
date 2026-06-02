const COSTA_MESA_CENTER = [33.6638, -117.9047];
const map = L.map('map', { preferCanvas: true }).setView(COSTA_MESA_CENTER, 13);
window.map = map;

L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors',
}).addTo(map);

// Leaflet can render scrambled-looking tiles if it computes size before the CSS grid settles.
setTimeout(() => map.invalidateSize(), 0);
setTimeout(() => map.invalidateSize(), 250);
window.addEventListener('resize', () => map.invalidateSize());

const featureLayer = L.layerGroup().addTo(map);
const emojiLayer = L.layerGroup().addTo(map);
const detectorLayer = L.layerGroup().addTo(map);
const userLayer = L.layerGroup().addTo(map);
let allFeatures = [];
let cellFeatures = [];
let categories = [];
let active = new Set();
let searchText = '';
let lastScanLatLng = null;
let cellBuckets = new Map();
let decorToCells = new Map();
let tileIndex = null;
let tileByKey = new Map();
let loadedTileKeys = new Set();
let loadedCellTokens = new Set();
let featureLayersByToken = new Map();
let decorDataReady = false;
let loadDataPromise = null;
let currentLocation = null;
let solverInFlight = false;
let activeTileFetches = 0;
let tileFetchQueue = [];
let loadingTilePromises = new Map();
const SOLVER_K = 3;
const BUCKET_DEGREES = 0.002;
const INITIAL_TILE_PAD = 1;
const DETECTOR_TILE_PAD = 1;
const MAX_SOLVER_TILE_RING = 5;
const SOLVER_EXCLUDED_DECORS = new Set(['Park', 'Waterside', 'Roadside']);
const TILE_INDEX_SCHEMA_VERSION = 2;
const MAX_TILE_FETCHES = 6;

// These categories are real candidates, but they dominate the first view and make the map unreadable/slow.
const NOISY_BY_DEFAULT = new Set(['Bus Stop', 'Bridge', 'Park', 'Waterside', 'Restaurant', 'Clothes Store', 'Makeup Store']);
const STARTER_CATEGORIES = new Set(['Cafe', 'Bakery', 'Sweetshop', 'Movie Theater', 'Library Bookstore', 'Pharmacy', 'Supermarket', 'Post Office']);
const DECOR_EMOJI = {
  'Restaurant': '🍽️',
  'Cafe': '☕',
  'Sweetshop': '🍬',
  'Bakery': '🥐',
  'Burger Place': '🍔',
  'Sushi Restaurant': '🍣',
  'Italian Restaurant': '🍝',
  'Mexican Restaurant': '🌮',
  'Ramen Restaurant': '🍜',
  'Curry Restaurant': '🍛',
  'Corner Store': '🏪',
  'Supermarket': '🛒',
  'Pharmacy': '💊',
  'Makeup Store': '💄',
  'Clothes Store': '👕',
  'Hair Salon': '💇',
  'Appliances Store': '🔌',
  'Diy Store': '🛠️',
  'Movie Theater': '🎬',
  'Library Bookstore': '📚',
  'Art Gallery': '🖼️',
  'Hotel': '🏨',
  'Post Office': '📮',
  'University College': '🎓',
  'Park': '🍀',
  'Forest': '🌲',
  'Waterside': '💧',
  'Beach': '🏖️',
  'Mountain': '⛰️',
  'Zoo': '🦁',
  'Theme Park': '🎡',
  'Airport': '✈️',
  'Station': '🚉',
  'Bus Stop': '🚌',
  'Bridge': '🌉',
  'Stadium': '🏟️',
  'Fortune': '🔮',
};

const $ = (id) => document.getElementById(id);

function setStatus(message) {
  $('generated').textContent = message;
}

function pointStyle(color) {
  return { radius: 4, color: '#fff', weight: 1.5, fillColor: color, fillOpacity: 0.85 };
}

function selectedDecorsForFeature(feature) {
  return feature.properties.decors.filter(d => active.has(d));
}

function emojiForFeature(feature) {
  const selected = selectedDecorsForFeature(feature);
  const decors = selected.length ? selected : feature.properties.decors;
  const icons = decors.map(d => DECOR_EMOJI[d] || '📍');
  const shown = icons.slice(0, 3).join('');
  return icons.length > 3 ? `${shown}<span class="emoji-more">+${icons.length - 3}</span>` : shown;
}

function primaryColor(feature) {
  const first = selectedDecorsForFeature(feature)[0] || feature.properties.decors[0];
  const colors = feature.properties.decorColors || feature.properties.colorByDecor || {};
  return colors[first] || '#334d2f';
}

function metersBetween(aLat, aLon, bLat, bLon) {
  const R = 6371000;
  const p1 = aLat * Math.PI / 180, p2 = bLat * Math.PI / 180;
  const dp = (bLat - aLat) * Math.PI / 180;
  const dl = (bLon - aLon) * Math.PI / 180;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function offsetMeters(lat, lon, east, north) {
  return [lat + north / 111320, lon + east / (111320 * Math.cos(lat * Math.PI / 180))];
}

function googleMapsHref(lat, lon) {
  const safeLat = Number(lat);
  const safeLon = Number(lon);
  if (!Number.isFinite(safeLat) || !Number.isFinite(safeLon)) return 'https://maps.google.com/';
  return `https://maps.google.com/?q=${encodeURIComponent(`${safeLat.toFixed(6)},${safeLon.toFixed(6)}`)}`;
}

function popup(feature) {
  const p = feature.properties;
  const colors = p.decorColors || p.colorByDecor || {};
  const badges = p.decors.map(d => `<span class="badge" style="background:${colors[d] || '#555'}">${d}</span>`).join('');
  const [lon, lat] = p.center;
  const mapsHref = googleMapsHref(lat, lon);
  if (p.token) {
    const spots = (p.spots || []).map(s => `• ${escapeHtml(s.name)} (${s.decors.map(escapeHtml).join(', ')})`).join('<br>');
    return `<div class="popup-title">S2 cell ${escapeHtml(p.token)}</div>
      <div class="badges">${badges}</div>
      <div>${p.spotCount || 0} OSM candidate spot(s) in this approximate cell</div>
      <div><a target="_blank" rel="noopener" href="${mapsHref}">open center in Google Maps</a></div>
      <div class="tags">${spots}</div>`;
  }
  const tags = Object.entries(p.tags || {}).sort().map(([k, v]) => `${k}=${v}`).join('\n');
  return `<div class="popup-title">${escapeHtml(p.name)}</div>
    <div class="badges">${badges}</div>
    <div><a target="_blank" rel="noopener" href="https://www.openstreetmap.org/${p.osmType}/${p.osmId}">Open in OSM</a> · <a target="_blank" rel="noopener" href="${mapsHref}">Google Maps</a></div>
    <pre class="tags">${escapeHtml(tags)}</pre>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
}

function featureMatches(feature) {
  const p = feature.properties;
  if (!p.decors.some(d => active.has(d))) return false;
  if (!searchText) return true;
  const haystack = `${p.name || p.token || ''} ${p.decors.join(' ')} ${Object.entries(p.tags || {}).map(([k, v]) => `${k} ${v}`).join(' ')}`.toLowerCase();
  return haystack.includes(searchText);
}

function updateLoadedCounts() {
  $('total-count').textContent = `${cellFeatures.length.toLocaleString()} loaded cells${tileIndex ? ` / ${tileIndex.cellCount.toLocaleString()} total cells` : ''}`;
}

function createFeatureLayer(feature) {
  const color = primaryColor(feature);
  let layer;
  if (feature.geometry.type === 'Point') {
    const [lon, lat] = feature.geometry.coordinates;
    layer = L.circleMarker([lat, lon], pointStyle(color));
  } else {
    layer = L.geoJSON(feature, {
      style: { color, weight: 3, opacity: 0.8, fillColor: color, fillOpacity: 0.12 },
      pointToLayer: (_, latlng) => L.circleMarker(latlng, pointStyle(color)),
    });
  }
  layer.bindPopup(popup(feature));
  return layer;
}

function restyleFeatureLayer(layer, feature) {
  const color = primaryColor(feature);
  if (layer.setStyle) {
    layer.setStyle({ color, fillColor: color });
  } else if (layer.eachLayer) {
    layer.eachLayer(child => child.setStyle?.({ color, fillColor: color }));
  }
}

function draw() {
  emojiLayer.clearLayers();
  let shown = 0;
  const bounds = [];
  for (const feature of allFeatures) {
    const token = feature.properties.token || feature.id;
    let layer = featureLayersByToken.get(token);
    const matches = featureMatches(feature);
    if (!matches) {
      if (layer && featureLayer.hasLayer(layer)) featureLayer.removeLayer(layer);
      continue;
    }

    shown++;
    if (!layer) {
      layer = createFeatureLayer(feature);
      featureLayersByToken.set(token, layer);
    } else {
      restyleFeatureLayer(layer, feature);
    }
    if (!featureLayer.hasLayer(layer)) layer.addTo(featureLayer);

    if (feature.properties.token && map.getZoom() >= 13) {
      const [lon, lat] = feature.properties.center;
      L.marker([lat, lon], {
        interactive: false,
        icon: L.divIcon({
          className: 'decor-emoji-icon',
          html: emojiForFeature(feature),
          iconSize: [44, 24],
          iconAnchor: [22, 12],
        }),
      }).addTo(emojiLayer);
    }
    const [lon, lat] = feature.properties.center;
    bounds.push([lat, lon]);
  }
  $('visible-count').textContent = shown.toLocaleString();
  if (shown && shown <= 50 && searchText) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 16 });
}

function renderFilters() {
  const filters = $('filters');
  filters.innerHTML = '';
  for (const cat of categories.filter(c => c.count > 0)) {
    const label = document.createElement('label');
    label.className = 'filter';
    label.innerHTML = `<input type="checkbox" value="${escapeHtml(cat.name)}">
      <span class="swatch" style="background:${cat.color}"></span>
      <span class="filter-name">${escapeHtml(cat.name)}${NOISY_BY_DEFAULT.has(cat.name) ? ' <small>(noisy)</small>' : ''}</span>
      <span class="count">${cat.count}</span>`;
    label.querySelector('input').addEventListener('change', (e) => {
      if (e.target.checked) active.add(cat.name); else active.delete(cat.name);
      draw();
    });
    filters.appendChild(label);
  }
}

function tileBboxIntersectsBounds(tile, bounds, pad = 0) {
  const latPad = 0.01 * pad;
  const lonPad = 0.01 * pad;
  const b = tile.bbox;
  return b.minLng <= bounds.getEast() + lonPad && b.maxLng >= bounds.getWest() - lonPad &&
    b.minLat <= bounds.getNorth() + latPad && b.maxLat >= bounds.getSouth() - latPad;
}

function tileKeysForBounds(bounds, pad = 0) {
  return tileIndex.tiles.filter(t => tileBboxIntersectsBounds(t, bounds, pad)).map(t => t.parentToken);
}

function maskToDecors(mask) {
  const decors = [];
  for (let i = 0; i < tileIndex.decorTypes.length; i++) {
    if (Math.floor(mask / (2 ** i)) % 2 === 1) decors.push(tileIndex.decorTypes[i]);
  }
  return decors;
}

function compactChunkToFeatures(chunk) {
  return chunk.cellTokens.map((token, i) => {
    const decors = maskToDecors(chunk.decorMasks[i] || 0);
    return {
      type: 'Feature',
      id: token,
      geometry: { type: 'Polygon', coordinates: [chunk.rings[i]] },
      properties: {
        token,
        level: chunk.cellLevel,
        center: chunk.centers[i],
        decors,
        colorByDecor: Object.fromEntries(decors.map(d => [d, tileIndex.colorByDecor[d] || '#334d2f'])),
        spotCount: chunk.spotCounts?.[i] || 0,
        spots: [],
      },
    };
  });
}

function pumpTileFetchQueue() {
  while (activeTileFetches < MAX_TILE_FETCHES && tileFetchQueue.length) {
    const job = tileFetchQueue.shift();
    activeTileFetches++;
    job.run().then(job.resolve, job.reject).finally(() => {
      activeTileFetches--;
      pumpTileFetchQueue();
    });
  }
}

function scheduleTileFetch(key) {
  if (loadingTilePromises.has(key)) return loadingTilePromises.get(key);
  const promise = new Promise((resolve, reject) => {
    tileFetchQueue.push({
      resolve,
      reject,
      run: () => fetch(`./data/cell-tiles/${tileByKey.get(key).path}`).then(r => {
        if (!r.ok) throw new Error(`Tile ${key} failed: HTTP ${r.status}`);
        return r.json();
      }),
    });
    pumpTileFetchQueue();
  }).finally(() => loadingTilePromises.delete(key));
  loadingTilePromises.set(key, promise);
  return promise;
}

async function loadTileKeys(keys, options = {}) {
  const { redraw = true } = options;
  const wanted = [...new Set(keys)].filter(key => tileByKey.has(key) && !loadedTileKeys.has(key));
  if (!wanted.length) return 0;
  setStatus(`Loading ${wanted.length} nearby chunk(s)…`);
  const chunks = await Promise.all(wanted.map(scheduleTileFetch));
  let added = 0;
  for (const chunk of chunks) {
    for (const f of compactChunkToFeatures(chunk)) {
      const token = f.properties.token;
      if (loadedCellTokens.has(token)) continue;
      loadedCellTokens.add(token);
      cellFeatures.push(f);
      addCellToSpatialIndexes(f);
      added++;
    }
  }
  for (const key of wanted) loadedTileKeys.add(key);
  allFeatures = cellFeatures;
  updateLoadedCounts();
  setStatus(`${loadedTileKeys.size}/${tileIndex.tileCount} chunks loaded · ${cellFeatures.length.toLocaleString()} cells`);
  if (redraw) draw();
  return added;
}

async function loadTilesForCurrentView(pad = INITIAL_TILE_PAD) {
  if (!tileIndex) return 0;
  return loadTileKeys(tileKeysForBounds(map.getBounds(), pad));
}

async function loadTileRingAround(lat, lon, ring, options = {}) {
  if (!tileIndex) return 0;
  const unloaded = tileIndex.tiles
    .filter(t => !loadedTileKeys.has(t.parentToken))
    .map(t => ({
      tile: t,
      dist: metersBetween(lat, lon, (t.bbox.minLat + t.bbox.maxLat) / 2, (t.bbox.minLng + t.bbox.maxLng) / 2),
      contains: t.bbox.minLng <= lon && t.bbox.maxLng >= lon && t.bbox.minLat <= lat && t.bbox.maxLat >= lat,
    }))
    .sort((a, b) => (b.contains - a.contains) || a.dist - b.dist);
  const batchSize = ring === 0 ? 1 : 8;
  return loadTileKeys(unloaded.slice(0, batchSize).map(t => t.tile.parentToken), options);
}

async function loadDecorData() {
  if (loadDataPromise) return loadDataPromise;
  loadDataPromise = loadDecorDataInner();
  return loadDataPromise;
}

async function loadDecorDataInner() {
  setStatus('Loading decor index…');
  const [manifest, loadedIndex] = await Promise.all([
    fetch('./data/manifest.json').then(r => r.json()),
    fetch('./data/cell-tiles-index.json').then(r => r.json()),
  ]);
  if (loadedIndex.schemaVersion !== TILE_INDEX_SCHEMA_VERSION) {
    throw new Error(`Unsupported cell tile schema ${loadedIndex.schemaVersion}; expected ${TILE_INDEX_SCHEMA_VERSION}`);
  }
  tileIndex = loadedIndex;
  tileByKey = new Map(tileIndex.tiles.map(t => [t.parentToken, t]));
  categories = manifest.categories;
  active = new Set(categories.filter(c => STARTER_CATEGORIES.has(c.name)).map(c => c.name));
  decorDataReady = true;
  setStatus(`Generated ${new Date(manifest.generatedAt).toLocaleString()} · ${tileIndex.tileCount} chunks available`);
  renderFilters();
  renderTargetOptions();
  syncCheckboxes();
  await loadTilesForCurrentView(INITIAL_TILE_PAD);
}

function initBasemapOnly() {
  map.setView(COSTA_MESA_CENTER, 13);
  featureLayer.clearLayers();
  emojiLayer.clearLayers();
  detectorLayer.clearLayers();
  userLayer.clearLayers();
  $('visible-count').textContent = '0';
  $('total-count').textContent = '0';
}

function centerOnUser() {
  if (!navigator.geolocation) {
    setStatus('Geolocation is not available in this browser.');
    return Promise.resolve(false);
  }
  setStatus('Requesting location…');
  return new Promise(resolve => {
    navigator.geolocation.getCurrentPosition(async pos => {
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;
      currentLocation = L.latLng(lat, lon);
      userLayer.clearLayers();
      L.circleMarker(currentLocation, { radius: 7, color: '#fff', weight: 2, fillColor: '#e53935', fillOpacity: 1 }).addTo(userLayer);
      if (pos.coords.accuracy) {
        L.circle(currentLocation, { radius: pos.coords.accuracy, color: '#e53935', weight: 1, fillOpacity: 0.05 }).addTo(userLayer);
      }
      map.setView(currentLocation, Math.max(map.getZoom(), 16));
      lastScanLatLng = currentLocation;
      if (decorDataReady) await loadTilesForCurrentView(INITIAL_TILE_PAD);
      if (cellFeatures.length) scanDetector(currentLocation);
      resolve(true);
    }, err => {
      setStatus(`Location unavailable: ${err.message}. Showing Costa Mesa.`);
      resolve(false);
    }, { enableHighAccuracy: false, timeout: 6000, maximumAge: 120000 });
  });
}

function bucketKey(lat, lon) {
  return `${Math.floor(lat / BUCKET_DEGREES)},${Math.floor(lon / BUCKET_DEGREES)}`;
}

function addCellToSpatialIndexes(cell) {
  const [lon, lat] = cell.properties.center;
  const key = bucketKey(lat, lon);
  if (!cellBuckets.has(key)) cellBuckets.set(key, []);
  cellBuckets.get(key).push(cell);
  for (const decor of cell.properties.decors) {
    if (!decorToCells.has(decor)) decorToCells.set(decor, []);
    decorToCells.get(decor).push(cell);
  }
}

function buildSpatialIndexes() {
  cellBuckets = new Map();
  decorToCells = new Map();
  for (const cell of cellFeatures) addCellToSpatialIndexes(cell);
}

function renderTargetOptions() {
  const solverCategories = categories.filter(c => c.count > 0 && !SOLVER_EXCLUDED_DECORS.has(c.name));
  const options = solverCategories.map(c => `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>`).join('');
  const selectA = $('target-decor');
  const selectB = $('target-decor-2');
  selectA.innerHTML = options;
  selectB.innerHTML = `<option value="">— none —</option>${options}`;
  selectA.value = solverCategories.find(c => c.name === 'Sushi Restaurant')?.name || solverCategories[0]?.name || '';
  selectB.value = '';
}

function cellsWithinDetector(lat, lon) {
  const bx = Math.floor(lat / BUCKET_DEGREES);
  const by = Math.floor(lon / BUCKET_DEGREES);
  const candidates = [];
  for (let dx = -2; dx <= 2; dx++) {
    for (let dy = -2; dy <= 2; dy++) {
      const bucket = cellBuckets.get(`${bx + dx},${by + dy}`);
      if (bucket) candidates.push(...bucket);
    }
  }
  return candidates.filter(c => {
    const [clon, clat] = c.properties.center;
    return metersBetween(lat, lon, clat, clon) <= 100;
  });
}

function scanDetector(latlng) {
  if (!cellFeatures.length) return;
  lastScanLatLng = latlng;
  detectorLayer.clearLayers();
  L.circle(latlng, { radius: 100, color: '#1e88e5', weight: 2, fillColor: '#1e88e5', fillOpacity: 0.05 }).addTo(detectorLayer);
  L.circleMarker(latlng, { radius: 6, color: '#0d47a1', fillColor: '#2196f3', fillOpacity: 1 }).addTo(detectorLayer);

  const cells = cellsWithinDetector(latlng.lat, latlng.lng);
  const decorCounts = new Map();
  for (const cell of cells) for (const d of cell.properties.decors) decorCounts.set(d, (decorCounts.get(d) || 0) + 1);
  const sorted = [...decorCounts.entries()].sort((a, b) => b[1] - a[1]);
  for (const cell of cells) {
    L.geoJSON(cell, { style: { color: '#1565c0', weight: 1, fillColor: '#64b5f6', fillOpacity: 0.18 } }).addTo(detectorLayer);
  }
  $('detector-output').innerHTML = sorted.length
    ? `<strong>${cells.length}</strong> cells in range<br>${sorted.map(([d, n]) => `${escapeHtml(d)}: ${n}`).join('<br>')}`
    : 'No decor cells in range; likely Roadside-only.';
}

function scanAt(lat, lon) {
  const cells = cellsWithinDetector(lat, lon);
  const decors = new Set(cells.flatMap(c => c.properties.decors));
  return { cells, decors };
}

function decorsAt(lat, lon) {
  return scanAt(lat, lon).decors;
}

function boundsAround(lat, lon, radiusMeters) {
  const [south, west] = offsetMeters(lat, lon, -radiusMeters, -radiusMeters);
  const [north, east] = offsetMeters(lat, lon, radiusMeters, radiusMeters);
  return L.latLngBounds([south, west], [north, east]);
}

function candidateIsPure(lat, lon, target) {
  const { decors } = scanAt(lat, lon);
  return decors.has(target) && [...decors].every(d => d === target);
}

function candidateContainsAll(lat, lon, targets) {
  const { decors } = scanAt(lat, lon);
  return targets.every(t => decors.has(t));
}

function addCandidate(results, candidate, k) {
  const existing = results.find(r => metersBetween(r.lat, r.lon, candidate.lat, candidate.lon) < 8);
  if (existing) return;
  results.push(candidate);
  results.sort((a, b) => a.dist - b.dist);
  if (results.length > k) results.length = k;
}

function searchCandidatePositions(seedCells, predicate, k = SOLVER_K) {
  const origin = lastScanLatLng || map.getCenter();
  const results = [];
  const visited = new Set();
  for (const cell of seedCells) {
    const [clon, clat] = cell.properties.center;
    for (let east = -100; east <= 100; east += 10) {
      for (let north = -100; north <= 100; north += 10) {
        if (Math.hypot(east, north) > 100) continue;
        const [lat, lon] = offsetMeters(clat, clon, east, north);
        const key = `${lat.toFixed(5)},${lon.toFixed(5)}`;
        if (visited.has(key)) continue;
        visited.add(key);
        const scan = scanAt(lat, lon);
        if (!predicate(scan)) continue;
        const dist = metersBetween(origin.lat, origin.lng, lat, lon);
        addCandidate(results, { lat, lon, dist, cells: scan.cells.length, decors: [...scan.decors].sort() }, k);
      }
    }
  }
  return results;
}

function showSolverResults(results, label) {
  if (!results.length) {
    const loaded = tileIndex ? `${loadedTileKeys.size}/${tileIndex.tileCount}` : 'nearby';
    $('solver-output').textContent = `No nearby ${label} spot found in the loaded search area (${loaded} chunks searched). Try panning closer to the area you want and search again.`;
    return;
  }
  const before = lastScanLatLng;
  const best = results[0];
  scanDetector(L.latLng(best.lat, best.lon));
  map.setView([best.lat, best.lon], Math.max(map.getZoom(), 17));
  $('solver-output').innerHTML = `<strong>${results.length} closest nearby ${label} spot(s)</strong> from ${before ? 'last scan' : 'map center'}:<ol>` +
    results.map(r => `<li>${Math.round(r.dist)}m · ${r.cells} cells · <a target="_blank" rel="noopener" href="${googleMapsHref(r.lat, r.lon)}">Google Maps</a><br><small>Includes: ${r.decors.map(escapeHtml).join(', ')}</small></li>`).join('') +
    `</ol>`;
}

function selectedTargets() {
  return [$('target-decor').value, $('target-decor-2').value].filter(Boolean);
}

async function loadDetectorCoverageForSeeds(seedCells, options = {}) {
  const keys = new Set();
  for (const cell of seedCells) {
    const [lon, lat] = cell.properties.center;
    for (const key of tileKeysForBounds(boundsAround(lat, lon, 200), 0)) keys.add(key);
  }
  if (keys.size) await loadTileKeys([...keys], options);
}

async function expandSearchUntilEnough(getSeedCells, predicate) {
  const origin = lastScanLatLng || map.getCenter();
  let results = [];
  for (let ring = 0; ring <= MAX_SOLVER_TILE_RING; ring++) {
    await loadTileRingAround(origin.lat, origin.lng, ring, { redraw: false });
    let seedCells = getSeedCells();
    await loadDetectorCoverageForSeeds(seedCells, { redraw: false });
    seedCells = getSeedCells();
    results = searchCandidatePositions(seedCells, predicate, SOLVER_K);
    if (results.length >= SOLVER_K) break;
  }
  draw();
  return results;
}

function setSolverBusy(isBusy) {
  solverInFlight = isBusy;
  $('find-pure').disabled = isBusy;
  $('find-combo').disabled = isBusy;
}

async function withSolverBusy(fn) {
  if (solverInFlight) return;
  setSolverBusy(true);
  try {
    await fn();
  } finally {
    setSolverBusy(false);
  }
}

async function findPureTarget() {
  if (!decorDataReady) return;
  await withSolverBusy(async () => {
    const target = $('target-decor').value;
    if (!target) {
      $('solver-output').textContent = 'Choose a target decor first.';
      return;
    }
    $('solver-output').textContent = `Searching nearby ${target} cells…`;
    const results = await expandSearchUntilEnough(
      () => decorToCells.get(target) || [],
      (scan) => scan.decors.has(target) && [...scan.decors].every(d => d === target)
    );
    showSolverResults(results, `clean ${escapeHtml(target)}`);
  });
}

async function findComboTarget() {
  if (!decorDataReady) return;
  await withSolverBusy(async () => {
    const targets = selectedTargets();
    if (!targets.length) {
      $('solver-output').textContent = 'Choose a target decor first.';
      return;
    }
    $('solver-output').textContent = `Searching nearby ${targets.join(' + ')} cells…`;
    const getSeedCells = () => targets
      .map(t => decorToCells.get(t) || [])
      .sort((a, b) => a.length - b.length)[0] || [];
    const results = await expandSearchUntilEnough(getSeedCells, (scan) => targets.every(t => scan.decors.has(t)));
    showSolverResults(results, targets.map(t => escapeHtml(t)).join(' + '));
  });
}

function syncCheckboxes() {
  document.querySelectorAll('#filters input').forEach(i => { i.checked = active.has(i.value); });
}

$('search').addEventListener('input', (e) => { searchText = e.target.value.trim().toLowerCase(); draw(); });
$('locate-me').addEventListener('click', () => centerOnUser());
$('load-data').addEventListener('click', async () => {
  await loadDecorData();
  await loadTilesForCurrentView(INITIAL_TILE_PAD);
  setStatus(`Nearby data loaded · ${loadedTileKeys.size}/${tileIndex.tileCount} chunks · ${cellFeatures.length.toLocaleString()} cells`);
});
$('core-view').addEventListener('click', () => {
  active = new Set(categories.filter(c => STARTER_CATEGORIES.has(c.name)).map(c => c.name));
  syncCheckboxes();
  draw();
  setStatus(`Showing starter spots · ${$('visible-count').textContent} visible cells`);
});
$('select-all').addEventListener('click', () => {
  active = new Set(categories.map(c => c.name));
  syncCheckboxes();
  draw();
  setStatus(`Showing all decor overlays · ${$('visible-count').textContent} visible cells`);
});
$('clear-all').addEventListener('click', () => {
  active.clear();
  syncCheckboxes();
  draw();
  setStatus('Map overlays cleared. Choose filters or tap Starter spots to show cells again.');
});
$('find-pure').addEventListener('click', () => findPureTarget());
$('find-combo').addEventListener('click', () => findComboTarget());
map.on('click', async (e) => {
  if (decorDataReady) await loadTileKeys(tileKeysForBounds(L.latLngBounds(e.latlng, e.latlng), DETECTOR_TILE_PAD));
  scanDetector(e.latlng);
});
let moveLoadTimer = null;
map.on('moveend', () => {
  if (!decorDataReady) return;
  clearTimeout(moveLoadTimer);
  moveLoadTimer = setTimeout(() => loadTilesForCurrentView(0), 250);
});

initBasemapOnly();
loadDecorData();
centerOnUser();
