export const COSTA_MESA_BBOX = {
  // south, west, north, east — padded to include South Coast Plaza / Fairview / Newport edge
  south: 33.607,
  west: -117.985,
  north: 33.725,
  east: -117.855,
};

// Tag choices follow the community-verified mappings (OSM wiki "Pikmin Bloom" page,
// pixlpirate/pikmin-map, helixhacks1/PikminDecorPredictor, Pikipedia). Tags marked
// "speculative" appear in no community table but are plausible and low-volume.
//
// APPEND ONLY: this order defines the tile bitmask bit indices in cell-tiles-index.json
// decorTypes. Clients that stay open across a deploy decode fresh tiles with their old
// legend, so inserting mid-list mislabels every decor after the insertion point. Add new
// decors at the END, and when removing one, keep it as `retired: true` so its bit index
// is never reused. Never reorder without bumping the tile schema version.
export const DECOR_MAPPINGS = [
  { name: 'Restaurant', color: '#e74c3c', tags: ['amenity=restaurant'] },
  { name: 'Cafe', color: '#8b5a2b', tags: ['amenity=cafe', 'cuisine=coffee_shop'] },
  { name: 'Sweetshop', color: '#ff69b4', tags: ['shop=confectionery', 'shop=pastry'] },
  { name: 'Bakery', color: '#d99b44', tags: ['shop=bakery', 'cuisine=pretzel'] },
  // All community tables map amenity=fast_food to Burger Place regardless of cuisine;
  // non-burger fast food (tacos, sandwiches) still gets its cuisine decor alongside.
  { name: 'Burger Place', color: '#f39c12', tags: ['amenity=fast_food', 'cuisine=burger'] },
  { name: 'Sushi Restaurant', color: '#1abc9c', tags: ['cuisine=sushi'] },
  { name: 'Italian Restaurant', color: '#27ae60', tags: ['cuisine=italian', 'cuisine=pizza', 'cuisine=pasta', 'cuisine=mediterranean'] },
  { name: 'Mexican Restaurant', color: '#c0392b', tags: ['cuisine=mexican', 'cuisine=tex-mex'] },
  { name: 'Ramen Restaurant', color: '#e67e22', tags: ['cuisine=ramen', 'cuisine=noodle', 'cuisine=udon', 'cuisine=soba', 'cuisine=chinese'] },
  { name: 'Curry Restaurant', color: '#d35400', tags: ['cuisine=indian', 'cuisine=curry', 'cuisine=nepalese', 'cuisine=sri_lankan'] },

  { name: 'Corner Store', color: '#3498db', tags: ['shop=convenience'] },
  { name: 'Supermarket', color: '#2ecc71', tags: ['shop=supermarket'] },
  { name: 'Pharmacy', color: '#16a085', tags: ['amenity=pharmacy', 'shop=chemist' /* speculative */] },
  // Pharmacies double-dip: community maps observe amenity=pharmacy yielding Makeup decor too.
  { name: 'Makeup Store', color: '#e84393', tags: ['shop=cosmetics', 'shop=department_store', 'amenity=pharmacy'] },
  { name: 'Clothes Store', color: '#9b59b6', tags: ['shop=clothes', 'shop=shoes'] },
  { name: 'Hair Salon', color: '#a0522d', tags: ['shop=hairdresser'] },
  { name: 'Appliances Store', color: '#34495e', tags: ['shop=electronics', 'shop=computer', 'shop=appliance'] },
  { name: 'Diy Store', color: '#7f8c8d', tags: ['shop=doityourself', 'shop=hardware'] },

  { name: 'Movie Theater', color: '#8e44ad', tags: ['amenity=cinema'] },
  { name: 'Library Bookstore', color: '#6c5ce7', tags: ['amenity=library', 'shop=books'] },
  { name: 'Art Gallery', color: '#00cec9', tags: ['tourism=museum', 'tourism=gallery' /* speculative */, 'shop=art'] },
  { name: 'Hotel', color: '#fd79a8', tags: ['tourism=hotel', 'tourism=motel' /* speculative */] },
  { name: 'Post Office', color: '#0984e3', tags: ['amenity=post_office'] },
  { name: 'University College', color: '#2d3436', tags: ['amenity=university', 'amenity=college', 'building=university'] },

  { name: 'Park', color: '#00b894', tags: ['leisure=park'] },
  { name: 'Forest', color: '#228b22', tags: ['landuse=forest', 'natural=wood'] },
  // The waterway line tags are speculative: community tables only verify natural=water.
  { name: 'Waterside', color: '#00a8ff', tags: ['natural=water', 'waterway=river', 'waterway=stream', 'waterway=canal'] },
  { name: 'Beach', color: '#f1c40f', tags: ['natural=beach'] },
  { name: 'Mountain', color: '#636e72', tags: ['natural=peak'] },
  { name: 'Zoo', color: '#55efc4', tags: ['tourism=zoo'] },
  { name: 'Theme Park', color: '#fab1a0', tags: ['tourism=theme_park'] },

  { name: 'Airport', color: '#74b9ff', tags: ['aeroway=aerodrome'] },
  { name: 'Station', color: '#2c3e50', tags: ['railway=station', 'building=train_station' /* speculative */] },
  // The tagGroup keeps PTv2-only bus stops (platform + bus=yes) without matching rail platforms.
  { name: 'Bus Stop', color: '#fdcb6e', tags: ['highway=bus_stop'], tagGroups: [['public_transport=platform', 'bus=yes']] },
  { name: 'Bridge', color: '#b2bec3', tags: ['bridge=yes', 'bridge=viaduct', 'man_made=bridge' /* speculative */] },
  { name: 'Stadium', color: '#d63031', tags: ['leisure=stadium', 'building=stadium' /* speculative */] },

  // Fortune decor is Japan-exclusive and was removed from this region, but the entry
  // stays to hold bit index 36 (see APPEND ONLY above). Retired entries match no spots
  // and are excluded from the manifest and UI.
  { name: 'Fortune', color: '#f368e0', retired: true, tags: [] },

  // 2024–2026 decor additions, appended to preserve pre-existing bit indices.
  { name: 'Korean Restaurant', color: '#b71540', tags: ['cuisine=korean'] },
  { name: 'Laundromat', color: '#82ccdd', tags: ['shop=laundry', 'shop=dry_cleaning'] },
  { name: 'Stationery Store', color: '#6a89cc', tags: ['shop=stationery', 'shop=craft'] },
];
