export function pointInBbox(lat, lng, bbox, marginMeters = 0) {
  if (!Array.isArray(bbox) || bbox.length !== 4) return false;
  const [west, south, east, north] = bbox.map(Number);
  const margin = Number(marginMeters);
  if (![lat, lng, west, south, east, north, margin].every(Number.isFinite) || margin < 0) return false;
  const latMargin = margin / 111320;
  const lonMargin = margin / (111320 * Math.max(0.01, Math.cos(lat * Math.PI / 180)));
  return lat >= south + latMargin && lat <= north - latMargin &&
    lng >= west + lonMargin && lng <= east - lonMargin;
}

export function featureMatchesQuery(feature, activeDecors, searchText) {
  const properties = feature?.properties || {};
  const query = String(searchText || '').trim().toLowerCase();
  if (query) return String(properties.searchHay || '').includes(query);
  return Array.isArray(properties.decors) && properties.decors.some(decor => activeDecors.has(decor));
}

export function parseAppHash(hash) {
  const out = {};
  const source = String(hash || '').replace(/^#/, '');
  for (const part of source.split('&')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const key = part.slice(0, eq);
    const value = part.slice(eq + 1);
    if (key === 'map') {
      const parts = value.split('/');
      if (parts.length !== 3 || parts.some(p => p === '')) continue;
      const [z, lat, lng] = parts.map(Number);
      const valid = Number.isFinite(z) && Number.isFinite(lat) && Number.isFinite(lng) &&
        z >= 2 && z <= 19 && lat >= -85 && lat <= 85 && lng >= -180 && lng <= 180;
      if (valid) out.view = { z: Math.round(z), lat, lng };
    } else if (key === 'decors') {
      out.decors = value.split(',').filter(Boolean).map(safeDecode).filter(value => value !== null);
    } else if (key === 'scan') {
      const parts = value.split('/');
      if (parts.length !== 2 || parts.some(p => p === '')) continue;
      const [lat, lng] = parts.map(Number);
      if (Number.isFinite(lat) && Number.isFinite(lng) && lat >= -85 && lat <= 85 && lng >= -180 && lng <= 180) {
        out.scan = { lat, lng };
      }
    }
  }
  return out;
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}
