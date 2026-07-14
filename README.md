# SoCal Pikmin Decor Detector Map

A fast, static, OSM-derived prototype for Pikmin Bloom detector planning in Los Angeles and Orange County play areas.

> Unofficial fan project. Not affiliated with, endorsed by, or connected to Nintendo or Niantic. Pikmin is a trademark of Nintendo.

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

## Other regions

The build pipeline is parameterized — `GEOFABRIK_URL`, `REGION`, and `BBOX` (W,S,E,N) env vars control the extract, so other regions can be built the same way:

```bash
GEOFABRIK_URL=https://download.geofabrik.de/europe/netherlands-latest.osm.pbf \
REGION=amsterdam BBOX=4.72,52.28,5.03,52.43 npm run build
```

## Notes

- Unofficial and approximate. In-game results can differ.
- Detector simulation uses 100m range and decor-cell centers, based on community research.
- The app is an installable PWA; the app shell and visited decor chunks work offline (basemap tiles are not cached).
- Map position and active decor filters live in the URL hash (`#map=z/lat/lon&decors=…`), so views are shareable links.
- The basemap uses [CARTO basemaps](https://carto.com/basemaps/) on their free tier (attribution required, non-commercial scale). If you fork this for something bigger, bring your own basemap.
- Data rebuilds rewrite all ~400 chunk files under `public/data/cell-tiles/`, so git history grows with each dataset refresh.

## Licensing

- **Code**: [MIT](LICENSE).
- **Data** (`public/data/`): derivative database of [OpenStreetMap](https://www.openstreetmap.org/copyright) data, available under the [ODbL 1.0](https://opendatacommons.org/licenses/odbl/) — © OpenStreetMap contributors.
- **Bundled**: [Leaflet](https://leafletjs.com) (BSD-2-Clause) under `public/vendor/leaflet/`.
