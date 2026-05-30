# Costa Mesa Pikmin Decor Map

A fast, static, OSM-derived prototype for Pikmin Bloom decor candidates in Costa Mesa, CA.

## How it works

`npm run build:data` makes one Overpass query for a padded Costa Mesa bounding box, maps OSM tags to likely Pikmin Bloom decor categories, and writes static files:

- `public/data/decor-spots.geojson`
- `public/data/manifest.json`
- `public/data/last-query.overpassql`

The browser app never calls Overpass at runtime; it only loads local static JSON, so browsing/filtering feels instant.

## Run

```bash
npm run build:data
npm run serve
# open http://localhost:5173
```

## Notes

- This is unofficial and approximate. Niantic may use old OSM snapshots and non-OSM sources.
- Data attribution: © OpenStreetMap contributors.
- Next major upgrade: convert these POI/area candidates into S2 cell bitmasks, PikMap-style.
