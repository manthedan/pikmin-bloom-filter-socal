export const COSTA_MESA_BBOX = {
  // south, west, north, east — padded to include South Coast Plaza / Fairview / Newport edge
  south: 33.607,
  west: -117.985,
  north: 33.725,
  east: -117.855,
};

export const DECOR_MAPPINGS = [
  { name: 'Restaurant', color: '#e74c3c', tags: ['amenity=restaurant'] },
  { name: 'Cafe', color: '#8b5a2b', tags: ['amenity=cafe', 'cuisine=coffee_shop'] },
  { name: 'Sweetshop', color: '#ff69b4', tags: ['shop=confectionery', 'shop=pastry'] },
  { name: 'Bakery', color: '#d99b44', tags: ['shop=bakery'] },
  { name: 'Burger Place', color: '#f39c12', tags: ['cuisine=burger'] },
  { name: 'Sushi Restaurant', color: '#1abc9c', tags: ['cuisine=sushi'] },
  { name: 'Italian Restaurant', color: '#27ae60', tags: ['cuisine=italian', 'cuisine=pizza', 'cuisine=pasta', 'cuisine=mediterranean'] },
  { name: 'Mexican Restaurant', color: '#c0392b', tags: ['cuisine=mexican', 'cuisine=tex-mex'] },
  { name: 'Ramen Restaurant', color: '#e67e22', tags: ['cuisine=ramen', 'cuisine=noodle', 'cuisine=chinese'] },
  { name: 'Curry Restaurant', color: '#d35400', tags: ['cuisine=indian', 'cuisine=curry'] },

  { name: 'Corner Store', color: '#3498db', tags: ['shop=convenience'] },
  { name: 'Supermarket', color: '#2ecc71', tags: ['shop=supermarket'] },
  { name: 'Pharmacy', color: '#16a085', tags: ['amenity=pharmacy', 'shop=chemist'] },
  { name: 'Makeup Store', color: '#e84393', tags: ['shop=cosmetics', 'shop=beauty', 'shop=department_store'] },
  { name: 'Clothes Store', color: '#9b59b6', tags: ['shop=clothes', 'shop=fashion', 'shop=shoes'] },
  { name: 'Hair Salon', color: '#a0522d', tags: ['shop=hairdresser'] },
  { name: 'Appliances Store', color: '#34495e', tags: ['shop=electronics', 'shop=computer', 'shop=appliance'] },
  { name: 'Diy Store', color: '#7f8c8d', tags: ['shop=doityourself', 'shop=hardware'] },

  { name: 'Movie Theater', color: '#8e44ad', tags: ['amenity=cinema'] },
  { name: 'Library Bookstore', color: '#6c5ce7', tags: ['amenity=library', 'shop=books'] },
  { name: 'Art Gallery', color: '#00cec9', tags: ['tourism=museum', 'tourism=gallery', 'shop=art'] },
  { name: 'Hotel', color: '#fd79a8', tags: ['tourism=hotel', 'tourism=motel'] },
  { name: 'Post Office', color: '#0984e3', tags: ['amenity=post_office'] },
  { name: 'University College', color: '#2d3436', tags: ['amenity=university', 'amenity=college'] },

  { name: 'Park', color: '#00b894', tags: ['leisure=park', 'leisure=playground'] },
  { name: 'Forest', color: '#228b22', tags: ['landuse=forest', 'natural=wood'] },
  { name: 'Waterside', color: '#00a8ff', tags: ['natural=water', 'waterway=river', 'waterway=stream', 'waterway=canal'] },
  { name: 'Beach', color: '#f1c40f', tags: ['natural=beach'] },
  { name: 'Mountain', color: '#636e72', tags: ['natural=peak'] },
  { name: 'Zoo', color: '#55efc4', tags: ['tourism=zoo'] },
  { name: 'Theme Park', color: '#fab1a0', tags: ['tourism=theme_park', 'tourism=aquarium'] },

  { name: 'Airport', color: '#74b9ff', tags: ['aeroway=aerodrome', 'aeroway=heliport'] },
  { name: 'Station', color: '#2c3e50', tags: ['railway=station', 'building=train_station'] },
  { name: 'Bus Stop', color: '#fdcb6e', tags: ['highway=bus_stop', 'public_transport=platform'] },
  { name: 'Bridge', color: '#b2bec3', tags: ['bridge=yes', 'man_made=bridge'] },
  { name: 'Stadium', color: '#d63031', tags: ['leisure=stadium', 'building=stadium'] },

  { name: 'Fortune', color: '#f368e0', tagGroups: [['amenity=place_of_worship', 'religion=shinto'], ['amenity=place_of_worship', 'religion=buddhist']], tags: [] },
];
