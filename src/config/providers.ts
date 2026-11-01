const env = import.meta.env;

export const mapProviders = {
  tiles: env.VITE_MAP_TILE_URL || 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  photon: env.VITE_PHOTON_API_URL || 'https://photon.komoot.io/api/',
  nominatim: env.VITE_NOMINATIM_API_URL || 'https://nominatim.openstreetmap.org/search',
  overpass: env.VITE_OVERPASS_API_URL || 'https://overpass-api.de/api/interpreter',
  osrm: env.VITE_OSRM_API_URL || 'https://router.project-osrm.org/route/v1/driving',
};

export const mapAttribution =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>';
