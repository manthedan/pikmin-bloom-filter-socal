# SoCal Pikmin Decor Detector Map

A fast, static, OSM-derived prototype for Pikmin Bloom detector planning in Los Angeles and Orange County play areas.

The app uses precomputed Geofabrik/OpenStreetMap data, approximate S2 level-17 decor cells, compact S2 parent level-11 JSON chunks, and a 100m detector simulator.

## Run locally

```bash
npm install
npm run serve
# open http://localhost:5173
```

## Static export / Netlify

The deployable site is the `public/` directory. Netlify is configured in `netlify.toml`.

```bash
npm run export
```

Netlify settings:

- Build command: `npm run netlify:build`
- Publish directory: `public`

The Netlify build intentionally **does not rebuild OSM data**. It validates the checked-in static export so deploys do not download the large Geofabrik extract.

## Rebuild data locally

Requires `osmium`:

```bash
brew install osmium-tool
npm run build
```

This downloads the Geofabrik SoCal `.osm.pbf`, extracts the LA + OC play-area bbox, builds decor cells, and writes compact S2 parent chunks.

Data layout:

- `data/osm/` — Geofabrik downloads and osmium extracts (gitignored).
- `data/derived/` — large intermediate GeoJSON (`decor-spots.geojson`, `decor-cells-l17.geojson`; gitignored).
- `public/data/` — the deployable static export only: `manifest.json`, `cell-tiles-index.json`, and `cell-tiles/` chunks.

## Current generated dataset

- Region bbox: `[-118.70, 33.52, -117.66, 34.35]`
- OSM decor candidate spots: `100,825`
- Approximate S2 level-17 decor cells: `238,923`
- Static S2 parent level-11 chunks: `399` (schema v3, includes top spot names per cell)

## Notes

- Unofficial and approximate. In-game results can differ.
- Data attribution: © OpenStreetMap contributors.
- Detector simulation uses 100m range and decor-cell centers, based on community research.
- The app is an installable PWA; the app shell and visited decor chunks work offline (basemap tiles are not cached).
- Map position and active decor filters live in the URL hash (`#map=z/lat/lon&decors=…`), so views are shareable links.
