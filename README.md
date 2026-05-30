# OC Pikmin Decor Detector Map

A fast, static, OSM-derived prototype for Pikmin Bloom detector planning in Orange County play areas.

The app uses precomputed Geofabrik/OpenStreetMap data, approximate S2 level-17 decor cells, lazy-loaded static JSON chunks, and a 100m detector simulator.

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

This downloads the Geofabrik SoCal `.osm.pbf`, extracts the OC play-area bbox, builds decor cells, and writes z13 JSON chunks.

## Current generated dataset

- Region bbox: `[-118.06, 33.52, -117.66, 33.80]`
- OSM decor candidate spots: `12,443`
- Approximate S2 level-17 decor cells: `9,072`
- Static z13 chunks: `73`

## Notes

- Unofficial and approximate. In-game results can differ.
- Data attribution: © OpenStreetMap contributors.
- Detector simulation uses 100m range and decor-cell centers, based on community research.
