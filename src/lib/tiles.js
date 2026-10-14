// Basemap config shared by every map. CARTO Voyager (light cream) needs a key
// (VITE_CARTO_KEY in .env.local); without one we fall back to OSM tiles so the
// map still renders.
const CARTO_KEY = import.meta.env.VITE_CARTO_KEY;

export const TILES = CARTO_KEY
  ? {
      url: `https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png?key=${CARTO_KEY}`,
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
      subdomains: 'abcd',
      provider: 'carto',
    }
  : {
      url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      attribution: '&copy; OpenStreetMap contributors',
      subdomains: 'abc',
      provider: 'osm',
    };
