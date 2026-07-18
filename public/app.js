import { featureMatchesQuery, parseAppHash, pointInBbox } from './app-core.js';

const COSTA_MESA_CENTER = [33.6638, -117.9047];
const map = L.map('map', { preferCanvas: true }).setView(COSTA_MESA_CENTER, 13);

// Muted gray basemap so the decor overlay is the only saturated thing on screen.
L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
  maxZoom: 19,
  subdomains: 'abcd',
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
}).addTo(map);

// Leaflet can render scrambled-looking tiles if it computes size before the CSS grid settles.
setTimeout(() => map.invalidateSize(), 0);
setTimeout(() => map.invalidateSize(), 250);
window.addEventListener('resize', () => map.invalidateSize());

const featureLayer = L.layerGroup().addTo(map);
const emojiLayer = L.layerGroup().addTo(map);
const aggregateLayer = L.layerGroup();
const detectorLayer = L.layerGroup().addTo(map);
const solverPinsLayer = L.layerGroup().addTo(map);
const userLayer = L.layerGroup().addTo(map);
const coverageLayer = L.layerGroup().addTo(map);
let allFeatures = [];
let cellFeatures = [];
let categories = [];
let active = new Set();
let searchText = '';
let lastScanLatLng = null; // solver origin: user location or last scan point
let lastCompletedScanLatLng = null; // set only by scanDetector; drives scan= sharing
let pendingSharedScan = null; // incoming scan= kept in the URL until restored or superseded
let cellBuckets = new Map();
let decorToCells = new Map();
let tileIndex = null;
let tileByKey = new Map();
let loadedTileKeys = new Set();
let loadedCellTokens = new Set();
let featureLayersByToken = new Map();
let decorDataReady = false;
let datasetBbox = null;
let loadDataPromise = null;
let currentLocation = null;
let solverInFlight = false;
let solverAbortController = null;
let activeTileFetches = 0;
let tileFetchQueue = [];
let loadingTilePromises = new Map();
let lastSolverResults = [];
let scanCellLayers = [];
let highlightedDecor = null;
const SOLVER_K = 3;
const DETECTOR_RADIUS_METERS = 100;
const SCAN_CELL_STYLE = { color: '#1565c0', weight: 1, fillColor: '#64b5f6', fillOpacity: 0.18 };
const SCAN_HIGHLIGHT_STYLE = { color: '#e65100', weight: 2, fillColor: '#ff9800', fillOpacity: 0.4 };
const MAX_OFFLINE_SAVE_CHUNKS = 80;
const BUCKET_DEGREES = 0.002;
const INITIAL_TILE_PAD = 1;
const DETECTOR_TILE_PAD = 1;
const MAX_SOLVER_TILE_RING = 5;
const SOLVER_EXCLUDED_DECORS = new Set(['Park', 'Waterside', 'Roadside']);
const TILE_INDEX_SCHEMA_VERSION = 3;
const MAX_TILE_FETCHES = 6;
const CELL_MIN_ZOOM = 13;
const MAX_EMOJI_MARKERS = 350;

// These categories are real candidates, but they dominate the first view and make the map unreadable/slow.
const NOISY_BY_DEFAULT = new Set(['Bus Stop', 'Bridge', 'Park', 'Waterside', 'Restaurant', 'Burger Place', 'Clothes Store', 'Makeup Store']);
const STARTER_CATEGORIES = new Set(['Cafe', 'Bakery', 'Sweetshop', 'Movie Theater', 'Library Bookstore', 'Pharmacy', 'Supermarket', 'Post Office']);
const FILTER_GROUPS = [
  ['Food & Drink', ['Restaurant', 'Cafe', 'Sweetshop', 'Bakery', 'Burger Place', 'Sushi Restaurant', 'Italian Restaurant', 'Mexican Restaurant', 'Korean Restaurant', 'Ramen Restaurant', 'Curry Restaurant']],
  ['Shops & Services', ['Corner Store', 'Supermarket', 'Pharmacy', 'Makeup Store', 'Clothes Store', 'Hair Salon', 'Appliances Store', 'Diy Store', 'Laundromat', 'Stationery Store', 'Post Office', 'Hotel']],
  ['Culture & Fun', ['Movie Theater', 'Library Bookstore', 'Art Gallery', 'University College', 'Zoo', 'Theme Park', 'Stadium']],
  ['Nature & Outdoors', ['Park', 'Forest', 'Waterside', 'Beach', 'Mountain']],
  ['Transit & Landmarks', ['Airport', 'Station', 'Bus Stop', 'Bridge']],
];
const DECOR_EMOJI = {
  'Restaurant': '🍽️',
  'Cafe': '☕',
  'Sweetshop': '🍬',
  'Bakery': '🥐',
  'Burger Place': '🍔',
  'Sushi Restaurant': '🍣',
  'Italian Restaurant': '🍝',
  'Mexican Restaurant': '🌮',
  'Korean Restaurant': '🥬',
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
  'Laundromat': '🧺',
  'Stationery Store': '✏️',
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
    const names = (p.names || []).map(n => `• ${escapeHtml(n)}`).join('<br>');
    return `<div class="popup-title">S2 cell ${escapeHtml(p.token)}</div>
      <div class="badges">${badges}</div>
      <div>${p.spotCount || 0} OSM candidate spot(s) in this approximate cell</div>
      <div><a target="_blank" rel="noopener" href="${mapsHref}">open center in Google Maps</a></div>
      ${names ? `<div class="tags">${names}</div>` : ''}`;
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
  return featureMatchesQuery(feature, active, searchText);
}

function updateLoadedCounts() {
  $('total-count').textContent = `${cellFeatures.length.toLocaleString()} loaded cells${tileIndex ? ` / ${tileIndex.cellCount.toLocaleString()} total cells` : ''}`;
}

function cellStyle(color) {
  const crowded = active.size > 12 && map.getZoom() <= 14;
  return {
    color,
    weight: crowded ? 0.7 : 1,
    opacity: crowded ? 0.18 : 0.35,
    fillColor: color,
    fillOpacity: crowded ? 0.025 : 0.07,
  };
}

function createFeatureLayer(feature) {
  const color = primaryColor(feature);
  let layer;
  if (feature.geometry.type === 'Point') {
    const [lon, lat] = feature.geometry.coordinates;
    layer = L.circleMarker([lat, lon], pointStyle(color));
  } else {
    // Cells are a quiet tint on the muted basemap; the emoji layer carries the meaning.
    layer = L.geoJSON(feature, {
      style: cellStyle(color),
      pointToLayer: (_, latlng) => L.circleMarker(latlng, pointStyle(color)),
    });
  }
  layer.bindPopup(popup(feature));
  return layer;
}

function restyleFeatureLayer(layer, feature) {
  const color = primaryColor(feature);
  if (layer.setStyle) {
    layer.setStyle(cellStyle(color));
  } else if (layer.eachLayer) {
    layer.eachLayer(child => child.setStyle?.(cellStyle(color)));
  }
}

function renderSearchResults(features, totalMatches, inViewCells) {
  const list = $('search-results');
  list.replaceChildren();
  if (!searchText) {
    list.hidden = true;
    $('search-status').textContent = 'Search checks all data loaded around the current map view, independent of filters.';
    return;
  }

  $('search-status').textContent = totalMatches
    ? `${totalMatches.toLocaleString()} loaded match${totalMatches === 1 ? '' : 'es'} · ${inViewCells.toLocaleString()} in view`
    : 'No matches in loaded data. Pan or zoom to another area and try again.';
  list.hidden = features.length === 0;
  for (const feature of features.slice(0, 8)) {
    const p = feature.properties;
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.searchToken = p.token || feature.id;
    button.textContent = p.names?.[0] || p.decors.join(', ');
    const meta = document.createElement('small');
    meta.textContent = p.decors.join(' · ');
    button.appendChild(meta);
    item.appendChild(button);
    list.appendChild(item);
  }
}

function emojiHtmlForGroup(features) {
  const decors = [];
  for (const feature of features) {
    const selected = selectedDecorsForFeature(feature);
    for (const decor of selected.length ? selected : feature.properties.decors) {
      if (!decors.includes(decor)) decors.push(decor);
    }
  }
  const icons = decors.slice(0, 3).map(decor => DECOR_EMOJI[decor] || '📍').join('');
  return `${icons}<span class="emoji-more">+${features.length}</span>`;
}

function draw(options = {}) {
  // fitSearchResults must only be set from the search input handler: draw() also runs on
  // every moveend, and refitting there would snap the map back while the user pans.
  const { fitSearchResults = false } = options;
  emojiLayer.clearLayers();
  let totalMatches = 0;
  let inViewCells = 0;
  const inViewTypes = new Set();
  const bounds = [];
  const searchMatches = [];
  const emojiGroups = new Map();
  const viewBounds = map.getBounds();
  const renderBounds = viewBounds.pad(0.15);
  const emojiBounds = map.getZoom() >= CELL_MIN_ZOOM ? viewBounds.pad(0.08) : null;
  const crowdedOverview = active.size > 12 && map.getZoom() <= 14;
  const markerGridSize = crowdedOverview ? 90 : map.getZoom() >= 16 ? 34 : map.getZoom() >= 14 ? 44 : 60;

  for (const feature of allFeatures) {
    const token = feature.properties.token || feature.id;
    let layer = featureLayersByToken.get(token);
    const matches = featureMatches(feature);
    const [lon, lat] = feature.properties.center;
    if (matches) {
      totalMatches++;
      bounds.push([lat, lon]);
      if (searchText && searchMatches.length < 8) searchMatches.push(feature);
    }
    if (!matches || !renderBounds.contains([lat, lon])) {
      if (layer) {
        if (featureLayer.hasLayer(layer)) featureLayer.removeLayer(layer);
        featureLayersByToken.delete(token);
      }
      continue;
    }

    if (crowdedOverview) {
      if (layer) {
        if (featureLayer.hasLayer(layer)) featureLayer.removeLayer(layer);
        featureLayersByToken.delete(token);
        layer = null;
      }
    } else {
      if (!layer) {
        layer = createFeatureLayer(feature);
        featureLayersByToken.set(token, layer);
      } else {
        restyleFeatureLayer(layer, feature);
      }
      if (!featureLayer.hasLayer(layer)) layer.addTo(featureLayer);
    }

    if (viewBounds.contains([lat, lon])) {
      inViewCells++;
      for (const decor of feature.properties.decors) {
        if (searchText || active.has(decor)) inViewTypes.add(decor);
      }
    }
    if (feature.properties.token && emojiBounds?.contains([lat, lon])) {
      const point = map.latLngToContainerPoint([lat, lon]);
      const key = `${Math.floor(point.x / markerGridSize)},${Math.floor(point.y / markerGridSize)}`;
      if (!emojiGroups.has(key)) emojiGroups.set(key, []);
      emojiGroups.get(key).push(feature);
    }
  }

  let emojiShown = 0;
  for (const features of emojiGroups.values()) {
    if (emojiShown++ >= MAX_EMOJI_MARKERS) break;
    const centers = features.map(feature => feature.properties.center);
    const lat = centers.reduce((sum, center) => sum + center[1], 0) / centers.length;
    const lon = centers.reduce((sum, center) => sum + center[0], 0) / centers.length;
    const grouped = features.length > 1;
    const marker = L.marker([lat, lon], {
      keyboard: false,
      icon: L.divIcon({
        className: `decor-emoji-icon${grouped ? ' grouped' : ''}`,
        html: grouped ? emojiHtmlForGroup(features) : emojiForFeature(features[0]),
        iconSize: grouped ? [56, 28] : [44, 28],
        iconAnchor: grouped ? [28, 14] : [22, 14],
      }),
    });
    if (grouped) {
      marker.bindTooltip(`${features.length.toLocaleString()} nearby cells — click to zoom in`);
      marker.on('click', () => map.setView([lat, lon], Math.min(19, map.getZoom() + 1)));
    } else {
      marker.bindPopup(() => popup(features[0]));
    }
    marker.addTo(emojiLayer);
  }

  $('visible-count').textContent = inViewCells.toLocaleString();
  updateMapStats(inViewCells, inViewTypes.size);
  updateFilterCount();
  renderSearchResults(searchMatches, totalMatches, inViewCells);
  if (fitSearchResults && totalMatches && totalMatches <= 50 && searchText) {
    map.fitBounds(bounds, { padding: [30, 30], maxZoom: 16 });
  }
  return { totalMatches, inViewCells };
}

function updateMapStats(cells, types) {
  $('ms-cells').textContent = `${cells.toLocaleString()} cells`;
  $('ms-types').textContent = `${types} types`;
  updateZoomBadge();
}

function updateZoomBadge() {
  const zoomBadge = $('ms-zoom');
  zoomBadge.textContent = `Z${map.getZoom()}`;
  // Green when cells are visible at this zoom, amber when the user needs to zoom in.
  zoomBadge.className = `zoom-badge ${map.getZoom() >= CELL_MIN_ZOOM ? 'zoom-ok' : 'zoom-low'}`;
}

function updateFilterCount() {
  const total = categories.filter(c => c.count > 0).length;
  $('filter-count').textContent = total ? `${active.size}/${total}` : '';
}

function filterLabel(cat) {
  const label = document.createElement('label');
  label.className = 'filter';
  label.dataset.name = cat.name.toLowerCase();
  label.innerHTML = `<input type="checkbox" value="${escapeHtml(cat.name)}">
    <span class="filter-emoji">${DECOR_EMOJI[cat.name] || '📍'}</span>
    <span class="swatch" style="background:${cat.color}"></span>
    <span class="filter-name">${escapeHtml(cat.name)}${NOISY_BY_DEFAULT.has(cat.name) ? ' <small>(noisy)</small>' : ''}</span>
    <span class="count">${cat.count}</span>`;
  label.querySelector('input').addEventListener('change', (e) => {
    if (e.target.checked) active.add(cat.name); else active.delete(cat.name);
    draw();
    updateHash();
  });
  return label;
}

function appendFilterGroup(container, title, cats) {
  const heading = document.createElement('div');
  heading.className = 'filter-group';
  heading.textContent = title;
  container.appendChild(heading);
  for (const cat of cats) container.appendChild(filterLabel(cat));
}

function renderFilters() {
  const filters = $('filters');
  filters.innerHTML = '';
  const byName = new Map(categories.filter(c => c.count > 0).map(c => [c.name, c]));
  const grouped = new Set();
  for (const [title, names] of FILTER_GROUPS) {
    names.forEach(n => grouped.add(n));
    const cats = names.map(n => byName.get(n)).filter(Boolean);
    if (cats.length) appendFilterGroup(filters, title, cats);
  }
  const rest = [...byName.values()].filter(c => !grouped.has(c.name));
  if (rest.length) appendFilterGroup(filters, 'Other', rest);
  applyFilterSearch();
  // draw() also updates this, but a low-zoom initial load never draws — initialize here.
  updateFilterCount();
}

function applyFilterSearch() {
  const q = ($('filter-search').value || '').trim().toLowerCase();
  const labels = [...document.querySelectorAll('#filters .filter')];
  for (const label of labels) {
    label.style.display = !q || label.dataset.name.includes(q) ? '' : 'none';
  }
  for (const group of document.querySelectorAll('#filters .filter-group')) {
    let el = group.nextElementSibling;
    let anyVisible = false;
    while (el && el.classList?.contains('filter')) {
      if (el.style.display !== 'none') { anyVisible = true; break; }
      el = el.nextElementSibling;
    }
    group.style.display = anyVisible ? '' : 'none';
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

function isPointCovered(lat, lng) {
  return pointInBbox(Number(lat), Number(lng), datasetBbox, DETECTOR_RADIUS_METERS);
}

function renderCoverageBoundary() {
  coverageLayer.clearLayers();
  if (!datasetBbox) return;
  const [west, south, east, north] = datasetBbox;
  const [safeSouth, safeWest] = offsetMeters(south, west, DETECTOR_RADIUS_METERS, DETECTOR_RADIUS_METERS);
  const [safeNorth, safeEast] = offsetMeters(north, east, -DETECTOR_RADIUS_METERS, -DETECTOR_RADIUS_METERS);
  L.rectangle([[safeSouth, safeWest], [safeNorth, safeEast]], {
    color: '#8a5a25',
    weight: 2,
    opacity: 0.7,
    fill: false,
    dashArray: '8 7',
    interactive: false,
  }).addTo(coverageLayer);
}

function reportOutsideCoverage(attemptedLatLng) {
  // Keep the unsupported attempt as the solver origin so a subsequent search cannot
  // silently fall back to an older valid scan. It will be rejected by withSolverBusy.
  lastScanLatLng = attemptedLatLng ? L.latLng(attemptedLatLng) : null;
  lastCompletedScanLatLng = null;
  pendingSharedScan = null;
  detectorLayer.clearLayers();
  scanCellLayers = [];
  highlightedDecor = null;
  $('detector-output').textContent = 'This detector circle is outside or too close to the edge of the supported Los Angeles and Orange County data area.';
  $('solver-output').textContent = 'Move the map inside the dashed coverage boundary to search for detector spots.';
  setStatus('Outside the supported LA/OC data area.');
  updateHash();
}

function maskToDecors(mask) {
  // Do NOT rewrite this with bitwise ops: the decor legend has more than 32 entries
  // (40 as of 2026-07, including retired placeholder slots), and JS bitwise operators
  // truncate to 32 bits. Float division stays exact well below 2^53.
  const decors = [];
  for (let i = 0; i < tileIndex.decorTypes.length; i++) {
    if (Math.floor(mask / (2 ** i)) % 2 === 1) decors.push(tileIndex.decorTypes[i]);
  }
  return decors;
}

function compactChunkToFeatures(chunk) {
  return chunk.cellTokens.map((token, i) => {
    const decors = maskToDecors(chunk.decorMasks[i] || 0);
    const names = chunk.names?.[i] || [];
    return {
      type: 'Feature',
      id: token,
      geometry: { type: 'Polygon', coordinates: [chunk.rings[i]] },
      properties: {
        token,
        level: chunk.cellLevel,
        center: chunk.centers[i],
        decors,
        names,
        colorByDecor: Object.fromEntries(decors.map(d => [d, tileIndex.colorByDecor[d] || '#334d2f'])),
        spotCount: chunk.spotCounts?.[i] || 0,
        searchHay: `${names.join(' ')} ${decors.join(' ')} ${token}`.toLowerCase(),
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

function tileUrl(key) {
  // Tile filenames are stable S2 tokens served with immutable caching, so version the URL
  // by dataset generation — otherwise returning visitors keep year-old tiles after a rebuild.
  const version = encodeURIComponent(tileIndex.generatedAt || TILE_INDEX_SCHEMA_VERSION);
  return `./data/cell-tiles/${tileByKey.get(key).path}?v=${version}`;
}

function scheduleTileFetch(key) {
  if (loadingTilePromises.has(key)) return loadingTilePromises.get(key);
  const promise = new Promise((resolve, reject) => {
    tileFetchQueue.push({
      resolve,
      reject,
      run: () => fetch(tileUrl(key)).then(r => {
        if (!r.ok) throw new Error(`Tile ${key} failed: HTTP ${r.status}`);
        return r.json();
      }),
    });
    pumpTileFetchQueue();
  }).finally(() => loadingTilePromises.delete(key));
  loadingTilePromises.set(key, promise);
  return promise;
}

async function cacheMissingTiles(keys) {
  // Tiles loaded before the SW controlled the page are in memory but not in Cache
  // Storage, and loadTileKeys skips loaded keys — fetch those directly so the SW's
  // cacheFirst path persists them.
  if (typeof caches === 'undefined') return;
  for (const key of keys) {
    try {
      if (!(await caches.match(tileUrl(key)))) await fetch(tileUrl(key));
    } catch {
      // Offline or storage failure mid-save; countCachedTiles reports the truth after.
    }
  }
}

async function countCachedTiles(keys) {
  // Loaded-in-memory is not the same as persisted: the SW deliberately swallows
  // quota failures, so verify against Cache Storage before claiming offline success.
  if (typeof caches === 'undefined') return 0;
  let cached = 0;
  for (const key of keys) {
    try {
      if (await caches.match(tileUrl(key))) cached++;
    } catch {
      break;
    }
  }
  return cached;
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

async function loadTilesForCurrentView(pad = INITIAL_TILE_PAD, options = {}) {
  if (!tileIndex) return 0;
  // Below the cell-overlay zoom the aggregate markers stand in for cells, and the viewport
  // can span the whole dataset — loading it would fetch all ~400 chunks in one go.
  if (map.getZoom() < CELL_MIN_ZOOM) return 0;
  return loadTileKeys(tileKeysForBounds(map.getBounds(), pad), options);
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

function loadDecorData() {
  if (!loadDataPromise) {
    // Drop the cached promise on failure so "Load nearby data" can retry after a network blip.
    loadDataPromise = loadDecorDataInner().catch(err => {
      loadDataPromise = null;
      throw err;
    });
  }
  return loadDataPromise;
}

async function loadDecorDataInner() {
  setStatus('Loading decor index…');
  // cache: 'no-cache' forces conditional revalidation (cheap 304s) so a freshly deployed
  // app.js can never pair with a stale-schema index still sitting in the HTTP cache.
  const [manifest, loadedIndex] = await Promise.all([
    fetch('./data/manifest.json', { cache: 'no-cache' }).then(r => {
      if (!r.ok) throw new Error(`manifest.json failed: HTTP ${r.status}`);
      return r.json();
    }),
    fetch('./data/cell-tiles-index.json', { cache: 'no-cache' }).then(r => {
      if (!r.ok) throw new Error(`cell-tiles-index.json failed: HTTP ${r.status}`);
      return r.json();
    }),
  ]);
  if (loadedIndex.schemaVersion !== TILE_INDEX_SCHEMA_VERSION) {
    throw new Error(`Unsupported cell tile schema ${loadedIndex.schemaVersion}; expected ${TILE_INDEX_SCHEMA_VERSION}`);
  }
  tileIndex = loadedIndex;
  datasetBbox = manifest.bbox || loadedIndex.bbox || null;
  tileByKey = new Map(tileIndex.tiles.map(t => [t.parentToken, t]));
  categories = manifest.categories;
  active = new Set(categories.filter(c => STARTER_CATEGORIES.has(c.name)).map(c => c.name));
  if (Array.isArray(initialHash.decors)) {
    const known = new Set(categories.map(c => c.name));
    const requested = initialHash.decors.filter(d => known.has(d));
    // A link whose every decor has since been removed from the dataset (e.g. old
    // Fortune links) keeps the starter view instead of rendering a blank map; a
    // deliberately empty decors= (all filters off) is still honored.
    if (requested.length || initialHash.decors.length === 0) active = new Set(requested);
  }
  decorDataReady = true;
  setStatus(`Generated ${new Date(manifest.generatedAt).toLocaleString()} · ${tileIndex.tileCount} chunks available`);
  renderFilters();
  renderTargetOptions();
  syncCheckboxes();
  buildAggregateMarkers();
  renderCoverageBoundary();
  updateZoomLayers();
  updateHash();
  await loadTilesForCurrentView(INITIAL_TILE_PAD);
  if (initialHash.scan) {
    // The OSM extract covers the full published bbox, while the tile index is sparse by
    // design: it stores only S2 parents containing mapped decor. Therefore zero tile keys
    // inside the bbox is complete evidence for a valid no-decor/Roadside-only scan, not
    // missing coverage. A scan is accepted only when its full 100m circle fits inside
    // the extract boundary.
    const { lat, lng } = initialHash.scan;
    if (!isPointCovered(lat, lng)) {
      reportOutsideCoverage([lat, lng]);
    } else {
      try {
        const coverageKeys = tileKeysForBounds(boundsAround(lat, lng, 200), 0);
        await loadTileKeys(coverageKeys, { redraw: false });
        scanDetector(L.latLng(lat, lng));
        draw();
      } catch (err) {
        console.error(err);
        setStatus('Could not load the shared spot’s area — tap the map there to retry the scan.');
      }
    }
  } else if (currentLocation) {
    if (isPointCovered(currentLocation.lat, currentLocation.lng)) scanDetector(currentLocation);
    else reportOutsideCoverage(currentLocation);
  }
}

function buildAggregateMarkers() {
  aggregateLayer.clearLayers();
  for (const tile of tileIndex.tiles) {
    const lat = (tile.bbox.minLat + tile.bbox.maxLat) / 2;
    const lng = (tile.bbox.minLng + tile.bbox.maxLng) / 2;
    const label = tile.count >= 1000 ? `${(tile.count / 1000).toFixed(1)}k` : String(tile.count);
    const marker = L.marker([lat, lng], {
      keyboard: false,
      icon: L.divIcon({ className: 'aggregate-icon', html: label, iconSize: [48, 26], iconAnchor: [24, 13] }),
    });
    marker.bindTooltip(`~${tile.count.toLocaleString()} decor cells — click to zoom in`);
    marker.on('click', () => map.setView([lat, lng], CELL_MIN_ZOOM + 1));
    marker.addTo(aggregateLayer);
  }
}

function toggleMapLayer(layer, on) {
  if (on && !map.hasLayer(layer)) layer.addTo(map);
  else if (!on && map.hasLayer(layer)) map.removeLayer(layer);
}

function updateZoomLayers() {
  const showCells = map.getZoom() >= CELL_MIN_ZOOM;
  toggleMapLayer(featureLayer, showCells);
  toggleMapLayer(emojiLayer, showCells);
  toggleMapLayer(aggregateLayer, !showCells && !!tileIndex);
  $('zoom-hint').hidden = showCells || !tileIndex;
  $('map-stats').hidden = !decorDataReady;
  updateZoomBadge();
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
      if (decorDataReady && !isPointCovered(lat, lon)) {
        reportOutsideCoverage(currentLocation);
        resolve(true);
        return;
      }
      let loadFailed = false;
      try {
        if (decorDataReady) await loadTilesForCurrentView(INITIAL_TILE_PAD);
      } catch (err) {
        // Skip the scan rather than report a misleading result from a partially loaded area.
        console.error(err);
        loadFailed = true;
        setStatus('Could not load nearby chunks — pan the map or tap "Use my location" again to retry.');
      }
      if (!loadFailed && decorDataReady) scanDetector(currentLocation);
      resolve(true);
    }, err => {
      setStatus(`Location unavailable: ${err.message}. Showing Costa Mesa.`);
      resolve(false);
    }, { enableHighAccuracy: false, timeout: 6000, maximumAge: 120000 });
  });
}

async function autoLocateIfGranted() {
  // Never fire the permission prompt on page load; only auto-locate when already granted.
  if (!navigator.geolocation || !navigator.permissions?.query) return;
  try {
    const status = await navigator.permissions.query({ name: 'geolocation' });
    if (status.state === 'granted') await centerOnUser();
  } catch {
    // Permissions API unsupported — wait for the explicit "Use my location" tap.
  }
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

function renderTargetOptions() {
  const solverCategories = categories.filter(c => c.count > 0 && !SOLVER_EXCLUDED_DECORS.has(c.name));
  const options = solverCategories.map(c => `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>`).join('');
  const selectA = $('target-decor');
  const selectB = $('target-decor-2');
  const avoid = $('avoid-decor');
  selectA.innerHTML = options;
  selectB.innerHTML = `<option value="">— none —</option>${options}`;
  // Avoid can name any decor, including ambient ones excluded from targets (dodging Park is common).
  avoid.innerHTML = `<option value="">— none —</option>` +
    categories.filter(c => c.count > 0).map(c => `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>`).join('');
  selectA.value = solverCategories.find(c => c.name === 'Sushi Restaurant')?.name || solverCategories[0]?.name || '';
  selectB.value = '';
  avoid.value = '';
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
    return metersBetween(lat, lon, clat, clon) <= DETECTOR_RADIUS_METERS;
  });
}

function scanDetector(latlng) {
  if (!decorDataReady) {
    setStatus('Decor data is still loading — try the scan again in a moment.');
    return;
  }
  if (!isPointCovered(latlng.lat, latlng.lng)) {
    reportOutsideCoverage(latlng);
    return;
  }
  lastScanLatLng = latlng;
  lastCompletedScanLatLng = latlng;
  pendingSharedScan = null; // a completed scan supersedes any not-yet-restored shared one
  detectorLayer.clearLayers();
  scanCellLayers = [];
  highlightedDecor = null;
  L.circle(latlng, { radius: DETECTOR_RADIUS_METERS, color: '#1e88e5', weight: 2, fillColor: '#1e88e5', fillOpacity: 0.05 }).addTo(detectorLayer);
  L.circleMarker(latlng, { radius: 6, color: '#0d47a1', fillColor: '#2196f3', fillOpacity: 1 }).addTo(detectorLayer);

  const cells = cellsWithinDetector(latlng.lat, latlng.lng);
  const decorCounts = new Map();
  for (const cell of cells) for (const d of cell.properties.decors) decorCounts.set(d, (decorCounts.get(d) || 0) + 1);
  const sorted = [...decorCounts.entries()].sort((a, b) => b[1] - a[1]);
  for (const cell of cells) {
    const layer = L.geoJSON(cell, { style: SCAN_CELL_STYLE }).addTo(detectorLayer);
    scanCellLayers.push({ cell, layer });
  }
  const shareButton = `<br><button class="mini-btn" data-share>Share this spot</button>`;
  $('detector-output').innerHTML = (sorted.length
    ? `<strong>${cells.length}</strong> cells in range<br>` +
      sorted.map(([d, n]) => `<a href="#" class="decor-line" data-decor="${escapeHtml(d)}">${escapeHtml(d)}: ${n}</a>`).join('<br>')
    : 'No decor cells in range; likely Roadside-only.') + shareButton;
  updateHash();
}

function toggleScanHighlight(decor) {
  highlightedDecor = highlightedDecor === decor ? null : decor;
  for (const { cell, layer } of scanCellLayers) {
    const on = highlightedDecor && cell.properties.decors.includes(highlightedDecor);
    layer.setStyle(on ? SCAN_HIGHLIGHT_STYLE : SCAN_CELL_STYLE);
  }
  for (const line of document.querySelectorAll('#detector-output .decor-line')) {
    line.classList?.toggle('active', line.dataset.decor === highlightedDecor);
  }
}

async function shareScan() {
  if (!lastCompletedScanLatLng) return;
  // Build the link around the scan point itself — currentHash() would also embed the
  // present map center, disclosing wherever the user has since panned to.
  const { lat, lng } = lastCompletedScanLatLng;
  const zoom = Math.max(map.getZoom(), 16);
  const parts = [
    `map=${zoom}/${lat.toFixed(5)}/${lng.toFixed(5)}`,
    `decors=${[...active].sort().map(encodeURIComponent).join(',')}`,
    `scan=${lat.toFixed(5)}/${lng.toFixed(5)}`,
  ];
  const url = `${location.origin}${location.pathname}#${parts.join('&')}`;
  try {
    if (navigator.share) {
      await navigator.share({ title: 'Pikmin detector spot', url });
      return;
    }
    await navigator.clipboard.writeText(url);
    setStatus('Spot link copied to clipboard.');
  } catch (err) {
    if (err?.name === 'AbortError') return; // user closed the share sheet
    setStatus(`Copy this link to share: ${url}`);
  }
}

function scanAt(lat, lon) {
  if (!isPointCovered(lat, lon)) return { cells: [], decors: new Set(), covered: false };
  const cells = cellsWithinDetector(lat, lon);
  const decors = new Set(cells.flatMap(c => c.properties.decors));
  return { cells, decors, covered: true };
}

function boundsAround(lat, lon, radiusMeters) {
  const [south, west] = offsetMeters(lat, lon, -radiusMeters, -radiusMeters);
  const [north, east] = offsetMeters(lat, lon, radiusMeters, radiusMeters);
  return L.latLngBounds([south, west], [north, east]);
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
  // Nearest-first with early exit: candidate positions sit within 100m of their seed cell
  // center, so once the kth-best result beats the closest possible candidate from the next
  // seed cell, no later cell can improve the answer.
  const ordered = seedCells
    .map(cell => {
      const [clon, clat] = cell.properties.center;
      return { cell, clat, clon, cellDist: metersBetween(origin.lat, origin.lng, clat, clon) };
    })
    .sort((a, b) => a.cellDist - b.cellDist);
  const results = [];
  const visited = new Set();
  for (const { clat, clon, cellDist } of ordered) {
    if (results.length >= k && results[k - 1].dist <= cellDist - (DETECTOR_RADIUS_METERS + 5)) break;
    for (let east = -DETECTOR_RADIUS_METERS; east <= DETECTOR_RADIUS_METERS; east += 10) {
      for (let north = -DETECTOR_RADIUS_METERS; north <= DETECTOR_RADIUS_METERS; north += 10) {
        if (Math.hypot(east, north) > DETECTOR_RADIUS_METERS) continue;
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

function showSolverPins(results) {
  solverPinsLayer.clearLayers();
  results.forEach((r, i) => {
    const marker = L.marker([r.lat, r.lon], {
      keyboard: false,
      icon: L.divIcon({ className: 'result-pin', html: String(i + 1), iconSize: [28, 28], iconAnchor: [14, 14] }),
    });
    marker.bindTooltip(`Result ${i + 1} · ${Math.round(r.dist)}m — click to scan`);
    marker.on('click', () => scanDetector(L.latLng(r.lat, r.lon)));
    marker.addTo(solverPinsLayer);
  });
}

function showSolverResults(results, label) {
  lastSolverResults = results;
  showSolverPins(results);
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
    results.map((r, i) => `<li>${Math.round(r.dist)}m · ${r.cells} cells · <a href="#" data-result-index="${i}">show on map</a> · <a target="_blank" rel="noopener" href="${googleMapsHref(r.lat, r.lon)}">Google Maps</a><br><small>Includes: ${r.decors.map(escapeHtml).join(', ')}</small></li>`).join('') +
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

async function expandSearchUntilEnough(getSeedCells, predicate, signal, progressLabel) {
  const origin = lastScanLatLng || map.getCenter();
  let results = [];
  for (let ring = 0; ring <= MAX_SOLVER_TILE_RING; ring++) {
    if (signal.aborted) throw new DOMException('Search canceled', 'AbortError');
    $('solver-output').textContent = `${progressLabel} · area ${ring + 1}/${MAX_SOLVER_TILE_RING + 1}`;
    await loadTileRingAround(origin.lat, origin.lng, ring, { redraw: false });
    if (signal.aborted) throw new DOMException('Search canceled', 'AbortError');
    let seedCells = getSeedCells();
    await loadDetectorCoverageForSeeds(seedCells, { redraw: false });
    if (signal.aborted) throw new DOMException('Search canceled', 'AbortError');
    seedCells = getSeedCells();
    results = searchCandidatePositions(seedCells, predicate, SOLVER_K);
    if (results.length >= SOLVER_K) break;
  }
  draw();
  return results;
}

function setSolverBusy(isBusy) {
  solverInFlight = isBusy;
  for (const id of ['find-pure', 'find-combo']) {
    const button = $(id);
    button.disabled = isBusy;
    button.setAttribute('aria-busy', String(isBusy));
  }
  $('cancel-solver').hidden = !isBusy;
}

async function withSolverBusy(fn) {
  if (solverInFlight) return;
  const origin = lastScanLatLng || map.getCenter();
  if (!isPointCovered(origin.lat, origin.lng)) {
    reportOutsideCoverage(origin);
    return;
  }
  // Old pins would describe a different query (and stay clickable) once a new
  // search starts or exits on validation/error — clear them up front.
  solverPinsLayer.clearLayers();
  lastSolverResults = [];
  solverAbortController = new AbortController();
  setSolverBusy(true);
  try {
    await fn(solverAbortController.signal);
  } catch (err) {
    if (err?.name === 'AbortError') {
      $('solver-output').textContent = 'Search canceled.';
    } else {
      console.error(err);
      $('solver-output').textContent = 'Search failed while loading map chunks — check your connection and try again.';
    }
  } finally {
    solverAbortController = null;
    setSolverBusy(false);
  }
}

async function findPureTarget() {
  if (!decorDataReady) return;
  await withSolverBusy(async (signal) => {
    const target = $('target-decor').value;
    if (!target) {
      $('solver-output').textContent = 'Choose a target decor first.';
      return;
    }
    $('solver-output').textContent = `Searching nearby ${target} cells…`;
    const results = await expandSearchUntilEnough(
      () => decorToCells.get(target) || [],
      (scan) => scan.decors.has(target) && [...scan.decors].every(d => d === target),
      signal,
      `Searching nearby ${target} cells`,
    );
    showSolverResults(results, `clean ${escapeHtml(target)}`);
  });
}

async function findComboTarget() {
  if (!decorDataReady) return;
  await withSolverBusy(async (signal) => {
    const targets = selectedTargets();
    if (!targets.length) {
      $('solver-output').textContent = 'Choose a target decor first.';
      return;
    }
    const avoid = $('avoid-decor').value;
    if (avoid && targets.includes(avoid)) {
      $('solver-output').textContent = 'The avoid decor is also a target — pick a different one.';
      return;
    }
    const describe = `${targets.join(' + ')}${avoid ? ` without ${avoid}` : ''}`;
    $('solver-output').textContent = `Searching nearby ${describe} cells…`;
    const getSeedCells = () => targets
      .map(t => decorToCells.get(t) || [])
      .sort((a, b) => a.length - b.length)[0] || [];
    const results = await expandSearchUntilEnough(
      getSeedCells,
      (scan) => targets.every(t => scan.decors.has(t)) && (!avoid || !scan.decors.has(avoid)),
      signal,
      `Searching nearby ${describe} cells`,
    );
    showSolverResults(results, escapeHtml(describe));
  });
}

function syncCheckboxes() {
  document.querySelectorAll('#filters input').forEach(i => { i.checked = active.has(i.value); });
}

function currentHash() {
  const c = map.getCenter();
  const parts = [
    `map=${map.getZoom()}/${c.lat.toFixed(5)}/${c.lng.toFixed(5)}`,
    `decors=${[...active].sort().map(encodeURIComponent).join(',')}`,
  ];
  // While a shared scan is still being restored (or failed to restore), keep it in the
  // URL so a reload can retry it instead of silently dropping the shared spot.
  const scanPoint = lastCompletedScanLatLng || pendingSharedScan;
  if (scanPoint) parts.push(`scan=${scanPoint.lat.toFixed(5)}/${scanPoint.lng.toFixed(5)}`);
  return `#${parts.join('&')}`;
}

let hashUpdateTimer = null;
function updateHash() {
  clearTimeout(hashUpdateTimer);
  hashUpdateTimer = setTimeout(() => {
    // Before categories load we can't render the decors= part, and the hash-view setView
    // already fired moveend — rewriting now would strip filters from a shared URL.
    if (!decorDataReady) return;
    history.replaceState(null, '', currentHash());
  }, 200);
}

let searchTimer = null;
$('search').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    searchText = e.target.value.trim().toLowerCase();
    draw({ fitSearchResults: true });
  }, 150);
});
$('search-results').addEventListener('click', (e) => {
  const button = e.target.closest('[data-search-token]');
  if (!button) return;
  const feature = allFeatures.find(candidate => (candidate.properties.token || candidate.id) === button.dataset.searchToken);
  if (!feature) return;
  const [lon, lat] = feature.properties.center;
  map.setView([lat, lon], Math.max(map.getZoom(), 16));
  draw();
  requestAnimationFrame(() => featureLayersByToken.get(button.dataset.searchToken)?.openPopup?.());
});
$('locate-me').addEventListener('click', () => centerOnUser());
$('load-data').addEventListener('click', async () => {
  try {
    await loadDecorData();
    if (map.getZoom() < CELL_MIN_ZOOM) {
      setStatus('Zoom in to load decor cells — chunk totals are shown at this zoom.');
      return;
    }
    await loadTilesForCurrentView(INITIAL_TILE_PAD);
    setStatus(`Nearby data loaded · ${loadedTileKeys.size}/${tileIndex.tileCount} chunks · ${cellFeatures.length.toLocaleString()} cells`);
  } catch (err) {
    console.error(err);
    setStatus('Could not load decor data — check your connection and tap "Load nearby data" to retry.');
  }
});
$('core-view').addEventListener('click', () => {
  active = new Set(categories.filter(c => STARTER_CATEGORIES.has(c.name)).map(c => c.name));
  syncCheckboxes();
  draw();
  updateHash();
  setStatus(`Showing starter spots · ${$('visible-count').textContent} visible cells`);
});
$('select-all').addEventListener('click', () => {
  active = new Set(categories.map(c => c.name));
  syncCheckboxes();
  draw();
  updateHash();
  setStatus(`Showing all decor overlays · ${$('visible-count').textContent} visible cells`);
});
$('clear-all').addEventListener('click', () => {
  active.clear();
  syncCheckboxes();
  draw();
  updateHash();
  setStatus('Map overlays cleared. Choose filters or tap Starter spots to show cells again.');
});
$('find-pure').addEventListener('click', () => findPureTarget());
$('find-combo').addEventListener('click', () => findComboTarget());
$('cancel-solver').addEventListener('click', () => solverAbortController?.abort());
$('fab-locate').addEventListener('click', () => centerOnUser());
$('filter-search').addEventListener('input', () => applyFilterSearch());
$('save-offline').addEventListener('click', async () => {
  try {
    await loadDecorData();
    if (map.getZoom() < CELL_MIN_ZOOM) {
      setStatus('Zoom in to the area you want to save first.');
      return;
    }
    const keys = tileKeysForBounds(map.getBounds(), 3);
    if (!keys.length) {
      setStatus('No decor data covers this area — it may be outside the LA/OC region.');
      return;
    }
    if (keys.length > MAX_OFFLINE_SAVE_CHUNKS) {
      setStatus('Area too large to save — zoom in a bit more.');
      return;
    }
    setStatus(`Saving ${keys.length} chunk(s) for offline…`);
    await loadTileKeys(keys, { redraw: false });
    draw();
    await cacheMissingTiles(keys);
    const cachedCount = await countCachedTiles(keys);
    if (cachedCount === keys.length) {
      setStatus(`Area saved for offline · ${cachedCount}/${keys.length} chunks cached on this device`);
    } else if (cachedCount > 0) {
      setStatus(`Partially saved · ${cachedCount}/${keys.length} chunks cached — device storage may be full, try again`);
    } else {
      setStatus('Area loaded for this session. Offline caching isn’t active yet — it finishes setting up on your next visit.');
    }
  } catch (err) {
    console.error(err);
    setStatus('Could not save this area — check your connection and try again.');
  }
});
$('detector-output').addEventListener('click', (e) => {
  if (e.target.closest('[data-share]')) {
    shareScan();
    return;
  }
  const line = e.target.closest('[data-decor]');
  if (!line) return;
  e.preventDefault();
  toggleScanHighlight(line.dataset.decor);
});
window.addEventListener('online', updateOnlineBadge);
window.addEventListener('offline', updateOnlineBadge);
function updateOnlineBadge() {
  $('offline-badge').hidden = navigator.onLine !== false;
}
updateOnlineBadge();

// --- Mobile bottom sheet ---
const sidebar = document.getElementById('sidebar');
const sheetHandle = $('sheet-handle');
let sheetState = 'half';
let sheetDragStartY = null;
let sheetDragStartOffset = 0;
let sheetJustDragged = false;

function isMobileSheet() {
  return !!window.matchMedia?.('(max-width: 800px)')?.matches;
}

function currentSheetOffset() {
  const match = /translateY\((-?\d+(?:\.\d+)?)px\)/.exec(sidebar.style.transform || '');
  return match ? Number(match[1]) : 0;
}

function sheetOffsets() {
  const h = sidebar.offsetHeight || 0;
  return { full: 0, half: Math.round(h * 0.5), peek: Math.max(0, h - 92) };
}

function updateSheetChrome(offset) {
  if (!isMobileSheet()) {
    document.documentElement.style.setProperty('--sheet-visible-height', '0px');
    document.body.classList.remove('sheet-full');
    return;
  }
  const visibleHeight = Math.max(0, sidebar.offsetHeight - offset);
  document.documentElement.style.setProperty('--sheet-visible-height', `${Math.round(visibleHeight)}px`);
  document.body.classList.toggle('sheet-full', visibleHeight >= sidebar.offsetHeight - 20);
}

function applySheetState() {
  const labels = { peek: 'Show panel', half: 'Expand panel', full: 'Minimize panel' };
  sheetHandle.setAttribute('aria-expanded', String(sheetState !== 'peek'));
  sheetHandle.setAttribute('aria-label', labels[sheetState]);
  if (!isMobileSheet()) {
    sidebar.style.transform = '';
    updateSheetChrome(0);
    return;
  }
  const offset = sheetOffsets()[sheetState];
  sidebar.style.transform = `translateY(${offset}px)`;
  updateSheetChrome(offset);
}

function cycleSheetState() {
  sheetState = sheetState === 'peek' ? 'half' : sheetState === 'half' ? 'full' : 'peek';
  applySheetState();
}

sheetHandle.addEventListener('click', () => {
  // A drag also fires a trailing click; don't let it undo the snap we just made.
  if (sheetJustDragged) {
    sheetJustDragged = false;
    return;
  }
  cycleSheetState();
});
sheetHandle.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  e.preventDefault();
  cycleSheetState();
});
sheetHandle.addEventListener('pointerdown', (e) => {
  if (!isMobileSheet()) return;
  sheetDragStartY = e.clientY;
  sheetDragStartOffset = currentSheetOffset();
  sidebar.style.transition = 'none';
  sheetHandle.setPointerCapture?.(e.pointerId);
});
sheetHandle.addEventListener('pointermove', (e) => {
  if (sheetDragStartY === null) return;
  const { peek } = sheetOffsets();
  const next = Math.min(Math.max(0, sheetDragStartOffset + (e.clientY - sheetDragStartY)), peek);
  sidebar.style.transform = `translateY(${next}px)`;
  updateSheetChrome(next);
});
function endSheetDrag(e, cancelled = false) {
  if (sheetDragStartY === null) return;
  const moved = Math.abs(e.clientY - sheetDragStartY) > 8;
  sheetDragStartY = null;
  sidebar.style.transition = '';
  // A cancelled pointer sequence emits no trailing click, so leaving the
  // suppression flag set would swallow the next legitimate tap.
  sheetJustDragged = moved && !cancelled;
  if (!moved) return; // let the click handler cycle states instead
  const offset = currentSheetOffset();
  const offsets = sheetOffsets();
  sheetState = Object.entries(offsets)
    .reduce((best, entry) => Math.abs(entry[1] - offset) < Math.abs(best[1] - offset) ? entry : best)[0];
  applySheetState();
}
sheetHandle.addEventListener('pointerup', (e) => endSheetDrag(e, false));
sheetHandle.addEventListener('pointercancel', (e) => endSheetDrag(e, true));
window.addEventListener('resize', applySheetState);
applySheetState();
$('solver-output').addEventListener('click', (e) => {
  const link = e.target.closest('[data-result-index]');
  if (!link) return;
  e.preventDefault();
  const result = lastSolverResults[Number(link.dataset.resultIndex)];
  if (!result) return;
  scanDetector(L.latLng(result.lat, result.lon));
  map.setView([result.lat, result.lon], Math.max(map.getZoom(), 17));
});
map.on('click', async (e) => {
  if (!decorDataReady) {
    setStatus('Decor data is still loading — try the scan again in a moment.');
    return;
  }
  if (!isPointCovered(e.latlng.lat, e.latlng.lng)) {
    reportOutsideCoverage(e.latlng);
    return;
  }
  if (decorDataReady) {
    try {
      await loadTileKeys(tileKeysForBounds(L.latLngBounds(e.latlng, e.latlng), DETECTOR_TILE_PAD));
    } catch (err) {
      // Don't scan with a possibly-missing chunk batch — it can report a false "no decor here".
      console.error(err);
      setStatus('Could not load chunks for this area — tap again to retry the scan.');
      return;
    }
  }
  scanDetector(e.latlng);
});
let moveLoadTimer = null;
map.on('moveend', () => {
  updateHash();
  if (!decorDataReady) return;
  clearTimeout(moveLoadTimer);
  moveLoadTimer = setTimeout(async () => {
    try {
      await loadTilesForCurrentView(0, { redraw: false });
    } catch (err) {
      console.error(err);
    }
    draw();
  }, 250);
});
map.on('zoomend', updateZoomLayers);

const initialHash = parseAppHash(location.hash);
pendingSharedScan = initialHash.scan ? { lat: initialHash.scan.lat, lng: initialHash.scan.lng } : null;
initBasemapOnly();
if (initialHash.view) map.setView([initialHash.view.lat, initialHash.view.lng], initialHash.view.z);
loadDecorData().catch(err => {
  console.error(err);
  setStatus('Could not load decor data — check your connection, then tap "Load nearby data" to retry.');
});
if (!initialHash.view) autoLocateIfGranted();

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
