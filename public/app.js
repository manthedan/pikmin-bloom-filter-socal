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
const detectorLayer = L.layerGroup().addTo(map);
let allFeatures = [];
let cellFeatures = [];
let categories = [];
let active = new Set();
let searchText = '';
let lastScanLatLng = null;

// These categories are real candidates, but they dominate the first view and make the map unreadable/slow.
const NOISY_BY_DEFAULT = new Set(['Bus Stop', 'Bridge', 'Park', 'Waterside', 'Restaurant', 'Clothes Store', 'Makeup Store']);
const STARTER_CATEGORIES = new Set(['Cafe', 'Bakery', 'Sweetshop', 'Movie Theater', 'Library Bookstore', 'Pharmacy', 'Supermarket', 'Post Office']);

const $ = (id) => document.getElementById(id);

function pointStyle(color) {
  return { radius: 4, color: '#fff', weight: 1.5, fillColor: color, fillOpacity: 0.85 };
}

function primaryColor(feature) {
  const first = feature.properties.decors[0];
  return feature.properties.decorColors[first] || '#334d2f';
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

function popup(feature) {
  const p = feature.properties;
  const badges = p.decors.map(d => `<span class="badge" style="background:${p.decorColors[d] || '#555'}">${d}</span>`).join('');
  const tags = Object.entries(p.tags || {}).sort().map(([k, v]) => `${k}=${v}`).join('\n');
  const [lon, lat] = p.center;
  return `<div class="popup-title">${escapeHtml(p.name)}</div>
    <div class="badges">${badges}</div>
    <div><a target="_blank" rel="noopener" href="https://www.openstreetmap.org/${p.osmType}/${p.osmId}">Open in OSM</a> · <a target="_blank" rel="noopener" href="https://maps.google.com/?q=${lat},${lon}">Google Maps</a></div>
    <pre class="tags">${escapeHtml(tags)}</pre>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
}

function featureMatches(feature) {
  const p = feature.properties;
  if (!p.decors.some(d => active.has(d))) return false;
  if (!searchText) return true;
  const haystack = `${p.name} ${p.decors.join(' ')} ${Object.entries(p.tags || {}).map(([k, v]) => `${k} ${v}`).join(' ')}`.toLowerCase();
  return haystack.includes(searchText);
}

function draw() {
  featureLayer.clearLayers();
  let shown = 0;
  const bounds = [];
  for (const feature of allFeatures) {
    if (!featureMatches(feature)) continue;
    shown++;
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
    layer.addTo(featureLayer);
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

async function loadDecorData() {
  $('generated').textContent = 'Loading decor data…';
  const [geojson, manifest, cells] = await Promise.all([
    fetch('./data/decor-spots.geojson').then(r => r.json()),
    fetch('./data/manifest.json').then(r => r.json()),
    fetch('./data/decor-cells-l17.geojson').then(r => r.json()),
  ]);
  allFeatures = geojson.features;
  cellFeatures = cells.features;
  categories = manifest.categories;
  active = new Set();
  $('total-count').textContent = manifest.featureCount.toLocaleString();
  $('generated').textContent = `Generated ${new Date(manifest.generatedAt).toLocaleString()}`;
  renderFilters();
  renderTargetOptions();
  syncCheckboxes();
  draw();

  const bbox = geojson.bbox;
  if (bbox) map.fitBounds([[bbox[1], bbox[0]], [bbox[3], bbox[2]]]);
}

function initBasemapOnly() {
  map.setView(COSTA_MESA_CENTER, 13);
  featureLayer.clearLayers();
  detectorLayer.clearLayers();
  $('visible-count').textContent = '0';
  $('total-count').textContent = '0';
}

function renderTargetOptions() {
  const options = categories.filter(c => c.count > 0).map(c => `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>`).join('');
  const selectA = $('target-decor');
  const selectB = $('target-decor-2');
  selectA.innerHTML = options;
  selectB.innerHTML = `<option value="">— none —</option>${options}`;
  selectA.value = categories.find(c => c.name === 'Sushi Restaurant') ? 'Sushi Restaurant' : categories.find(c => c.count > 0)?.name || '';
  selectB.value = '';
}

function cellsWithinDetector(lat, lon) {
  return cellFeatures.filter(c => {
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

function decorsAt(lat, lon) {
  return new Set(cellsWithinDetector(lat, lon).flatMap(c => c.properties.decors));
}

function candidateIsPure(lat, lon, target) {
  const decors = decorsAt(lat, lon);
  return decors.has(target) && [...decors].every(d => d === target);
}

function candidateContainsAll(lat, lon, targets) {
  const decors = decorsAt(lat, lon);
  return targets.every(t => decors.has(t));
}

function searchCandidatePositions(seedCells, predicate) {
  const origin = lastScanLatLng || map.getCenter();
  let best = null;
  for (const cell of seedCells) {
    const [clon, clat] = cell.properties.center;
    for (let east = -100; east <= 100; east += 10) {
      for (let north = -100; north <= 100; north += 10) {
        if (Math.hypot(east, north) > 100) continue;
        const [lat, lon] = offsetMeters(clat, clon, east, north);
        if (!predicate(lat, lon)) continue;
        const dist = metersBetween(origin.lat, origin.lng, lat, lon);
        if (!best || dist < best.dist) best = { lat, lon, dist, decors: [...decorsAt(lat, lon)].sort() };
      }
    }
  }
  return best;
}

function showSolverResult(best, label) {
  if (!best) {
    $('solver-output').textContent = `No ${label} spot found in this dataset.`;
    return;
  }
  const before = lastScanLatLng;
  scanDetector(L.latLng(best.lat, best.lon));
  map.setView([best.lat, best.lon], Math.max(map.getZoom(), 17));
  $('solver-output').innerHTML = `Closest ${label} spot: ${Math.round(best.dist)}m from ${before ? 'last scan' : 'map center'} · <a target="_blank" href="https://maps.google.com/?q=${best.lat},${best.lon}">open in Google Maps</a><br>Detector would include: ${best.decors.map(escapeHtml).join(', ')}`;
}

function selectedTargets() {
  return [$('target-decor').value, $('target-decor-2').value].filter(Boolean);
}

function findPureTarget() {
  if (!cellFeatures.length) return;
  const target = $('target-decor').value;
  const seedCells = cellFeatures.filter(c => c.properties.decors.includes(target));
  const best = searchCandidatePositions(seedCells, (lat, lon) => candidateIsPure(lat, lon, target));
  showSolverResult(best, `clean ${target}`);
}

function findComboTarget() {
  if (!cellFeatures.length) return;
  const targets = selectedTargets();
  const seedCells = cellFeatures.filter(c => targets.some(t => c.properties.decors.includes(t)));
  const best = searchCandidatePositions(seedCells, (lat, lon) => candidateContainsAll(lat, lon, targets));
  showSolverResult(best, targets.map(t => escapeHtml(t)).join(' + '));
}

function syncCheckboxes() {
  document.querySelectorAll('#filters input').forEach(i => { i.checked = active.has(i.value); });
}

$('search').addEventListener('input', (e) => { searchText = e.target.value.trim().toLowerCase(); draw(); });
$('load-data').addEventListener('click', () => loadDecorData());
$('core-view').addEventListener('click', () => { active = new Set(categories.filter(c => STARTER_CATEGORIES.has(c.name)).map(c => c.name)); syncCheckboxes(); draw(); });
$('select-all').addEventListener('click', () => { active = new Set(categories.map(c => c.name)); syncCheckboxes(); draw(); });
$('clear-all').addEventListener('click', () => { active.clear(); syncCheckboxes(); draw(); });
$('find-pure').addEventListener('click', () => findPureTarget());
$('find-combo').addEventListener('click', () => findComboTarget());
map.on('click', (e) => scanDetector(e.latlng));

initBasemapOnly();
