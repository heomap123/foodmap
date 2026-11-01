import { mapProviders } from '../config/providers';
import { distanceBetween, fromGeoJsonCoordinates } from './geo';
import type { Coordinates, FoodType, Place } from '../types/map';

const foodAmenities = new Set(['restaurant', 'fast_food', 'food_court', 'ice_cream', 'cafe']);
const ignoredSearchTerms = new Set([
  'can', 'tho', 'viet', 'nam', 'vietnam', 'vn', 'ninh', 'kieu',
  'quan', 'phuong', 'thanh', 'pho', 'tp', 'near', 'in',
]);
let nextOverpassRequestAt = 0;
let nextNominatimRequestAt = 0;

interface PhotonFeature {
  geometry?: { coordinates?: unknown };
  properties?: Record<string, unknown>;
}

interface PhotonResponse {
  features?: PhotonFeature[];
}

interface OverpassResponse {
  elements?: Array<{
    type?: string;
    id?: number;
    lat?: number;
    lon?: number;
    center?: { lat?: number; lon?: number };
    tags?: Record<string, string>;
  }>;
}

interface NominatimResult {
  osm_type?: string;
  osm_id?: number;
  place_id?: number;
  lat?: string;
  lon?: string;
  name?: string;
  display_name?: string;
  type?: string;
  category?: string;
  extratags?: Record<string, string>;
  namedetails?: { name?: string };
}

function abortError(): DOMException {
  return new DOMException('The request was cancelled.', 'AbortError');
}

async function abortableDelay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw abortError();
  await new Promise<void>((resolve, reject) => {
    const timer = globalThis.setTimeout(resolve, milliseconds);
    signal?.addEventListener('abort', () => {
      globalThis.clearTimeout(timer);
      reject(abortError());
    }, { once: true });
  });
}

export async function waitForNominatimRequest(signal?: AbortSignal): Promise<void> {
  const now = Date.now();
  const wait = Math.max(0, nextNominatimRequestAt - now);
  nextNominatimRequestAt = Math.max(now, nextNominatimRequestAt) + 1100;
  await abortableDelay(wait, signal);
}

async function fetchJson<T>(
  url: string,
  signal: AbortSignal | undefined,
  timeoutMessage: string,
): Promise<T> {
  if (signal?.aborted) throw abortError();
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), 15_000);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`Dịch vụ bản đồ phản hồi HTTP ${response.status}.`);
    return await response.json() as T;
  } catch (error) {
    if (signal?.aborted) throw abortError();
    if (controller.signal.aborted) throw new Error(timeoutMessage);
    throw error;
  } finally {
    globalThis.clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

function normalizeSearchText(value: string): string {
  return value
    .toLocaleLowerCase('vi')
    .replace(/đ/g, 'd')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tagsAddress(tags: Record<string, string>): string {
  if (tags['addr:full']) return tags['addr:full'];
  const street = [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ');
  return [
    street,
    tags['addr:suburb'] || tags['addr:quarter'],
    tags['addr:city'] || tags['addr:province'],
  ].filter(Boolean).join(', ') || 'Chưa có địa chỉ OpenStreetMap';
}

function makePlace(input: {
  id: string;
  name?: string;
  lat: number;
  lng: number;
  address?: string;
  amenity?: string;
  typeLabel?: string;
  approximate?: boolean;
  osmType?: string;
  osmId?: number | string;
  tags?: Record<string, string>;
}): Place | null {
  if (!Number.isFinite(input.lat) || Math.abs(input.lat) > 90
    || !Number.isFinite(input.lng) || Math.abs(input.lng) > 180) return null;
  const amenity = input.amenity || '';
  const tags = input.tags || {};
  return {
    id: input.id,
    name: input.name || `Vị trí ${input.lat.toFixed(5)}, ${input.lng.toFixed(5)}`,
    lat: input.lat,
    lng: input.lng,
    address: input.address || 'Chưa có địa chỉ trong OpenStreetMap',
    amenity,
    isFoodPlace: foodAmenities.has(amenity),
    isVegetarian: foodAmenities.has(amenity)
      && (/(^|;)\s*(vegetarian|vegan)\s*(;|$)/i.test(tags.cuisine || '')
        || /\b(chay|vegetarian|vegan)\b/i.test(input.name || '')),
    brand: tags.brand || tags['brand:en'] || tags['brand:vi'] || '',
    typeLabel: input.typeLabel || (amenity ? amenity.replaceAll('_', ' ') : 'Địa điểm'),
    isApproximate: Boolean(input.approximate),
    cuisine: tags.cuisine || '',
    openingHours: tags.opening_hours || '',
    phone: tags.phone || tags['contact:phone'] || '',
    website: tags.website || tags['contact:website'] || '',
    price: tags.price || tags.price_range || '',
    distance: 0,
    osmType: input.osmType || '',
    osmId: input.osmId,
  };
}

function photonPlace(feature: PhotonFeature): Place | null {
  const properties = feature.properties || {};
  const coordinates = fromGeoJsonCoordinates(feature.geometry?.coordinates);
  if (!coordinates) return null;

  const osmTypes: Record<string, string> = { N: 'node', W: 'way', R: 'relation' };
  const osmType = osmTypes[String(properties.osm_type || '')] || '';
  const osmId = properties.osm_id as number | undefined;
  const street = [properties.housenumber, properties.street].filter(Boolean).join(' ');
  const address = [
    street,
    properties.locality,
    properties.district,
    properties.city,
    properties.state,
    properties.country,
  ].filter((part, index, all) => Boolean(part) && all.indexOf(part) === index).join(', ');
  const amenity = properties.osm_key === 'amenity' ? String(properties.osm_value || '') : '';
  const typeLabels: Record<string, string> = {
    street: 'Đường (vị trí ước lượng)',
    house: 'Địa điểm hoặc địa chỉ',
    locality: 'Khu vực',
    district: 'Quận/huyện',
    city: 'Thành phố',
  };
  const valueLabels: Record<string, string> = {
    cafe: 'Cà phê',
    fast_food: 'Đồ ăn nhanh',
    restaurant: 'Quán ăn',
    food_court: 'Khu ẩm thực',
    ice_cream: 'Cửa hàng kem',
  };
  const streetName = String(properties.street || '');
  const name = String(properties.name || street || streetName || properties.city || '');

  return makePlace({
    id: osmType && osmId ? `${osmType}/${osmId}` : `photon/${coordinates.lat},${coordinates.lng}`,
    name,
    ...coordinates,
    address: address || name,
    amenity,
    typeLabel: valueLabels[String(properties.osm_value || '')]
      || typeLabels[String(properties.type || '')]
      || String(properties.osm_value || '').replaceAll('_', ' ')
      || 'Địa điểm',
    approximate: properties.type === 'street' || properties.osm_key === 'highway',
    osmType,
    osmId,
    tags: {
      brand: String(properties.brand || ''),
      cuisine: String(properties.cuisine || ''),
    },
  });
}

function nominatimPlace(result: NominatimResult): Place | null {
  const lat = Number(result.lat);
  const lng = Number(result.lon);
  const amenity = result.category === 'amenity' && foodAmenities.has(result.type || '')
    ? result.type || ''
    : '';
  const isRoad = result.type === 'road' || result.category === 'highway';
  return makePlace({
    id: `${result.osm_type || 'place'}/${result.osm_id || result.place_id || `${lat},${lng}`}`,
    name: result.namedetails?.name || result.name || result.display_name?.split(',')[0],
    lat,
    lng,
    address: result.display_name || '',
    amenity,
    typeLabel: amenity
      ? (amenity === 'cafe' ? 'Cà phê' : amenity.replaceAll('_', ' '))
      : isRoad ? 'Đường (vị trí ước lượng)' : result.type || result.category || 'Địa điểm',
    approximate: isRoad,
    osmType: result.osm_type || '',
    osmId: result.osm_id || result.place_id,
    tags: result.extratags,
  });
}

function withDistance(place: Place, center: Coordinates): Place {
  return { ...place, distance: distanceBetween(center, place) };
}

export function rankPlaceResults(results: Place[], query: string): Place[] {
  const allTerms = normalizeSearchText(query).split(/\s+/).filter(Boolean);
  const terms = allTerms.filter((term) => !ignoredSearchTerms.has(term));
  const queryTerms = terms.length ? terms : allTerms;
  const queryText = normalizeSearchText(query);
  const normalizedQuery = ` ${queryText} `;
  const requestedArea = ['can tho', 'ninh kieu']
    .find((area) => normalizedQuery.includes(` ${area} `));

  return results.map((place, index) => {
    const name = normalizeSearchText(place.name);
    const address = normalizeSearchText(place.address);
    const category = normalizeSearchText(place.typeLabel);
    const score = queryTerms.reduce((total, term) => {
      if (name.split(' ').includes(term)) return total + 10;
      if (name.includes(term)) return total + 7;
      if (address.split(' ').includes(term)) return total + 3;
      if (address.includes(term)) return total + 2;
      if (category.includes(term)) return total + 1;
      return total;
    }, 0);
    const phraseBonus = queryTerms.length > 1 && name.includes(queryText) ? 20 : 0;
    const addressMatchesRequestedArea = requestedArea
      ? normalizeSearchText(place.address).includes(requestedArea)
      : true;
    const isNearRequestedArea = !requestedArea || place.distance <= 35_000;
    return {
      place,
      score: score + phraseBonus,
      index,
      matchesArea: addressMatchesRequestedArea || isNearRequestedArea,
    };
  }).filter((result) => result.score > 0 && result.matchesArea)
    .sort((a, b) => b.score - a.score
      || a.place.distance - b.place.distance
      || a.index - b.index)
    .map(({ place }) => place)
    .slice(0, 12);
}

function photonUrl(query: string, limit: number, center: Coordinates): string {
  const params = new URLSearchParams({
    q: query,
    limit: String(limit),
    countrycode: 'VN',
    lat: String(center.lat),
    lon: String(center.lng),
  });
  return `${mapProviders.photon}?${params}`;
}

export async function searchPhotonPlaces(
  query: string,
  center: Coordinates,
  limit = 30,
  signal?: AbortSignal,
): Promise<Place[]> {
  const data = await fetchJson<PhotonResponse>(
    photonUrl(query, limit, center),
    signal,
    'Dịch vụ gợi ý địa điểm phản hồi quá lâu.',
  );
  if (!Array.isArray(data.features)) throw new Error('Dữ liệu gợi ý địa điểm không đúng định dạng.');
  return data.features.map(photonPlace).filter((place): place is Place => Boolean(place))
    .map((place) => withDistance(place, center));
}

export async function searchPlaces(
  query: string,
  center: Coordinates,
  signal?: AbortSignal,
): Promise<Place[]> {
  let photonError: unknown;
  try {
    const photonResults = rankPlaceResults(await searchPhotonPlaces(query, center, 30, signal), query);
    if (photonResults.length) return photonResults.slice(0, 12);
  } catch (error) {
    if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw error;
    photonError = error;
  }

  try {
    await waitForNominatimRequest(signal);
    const params = new URLSearchParams({
      q: query,
      format: 'jsonv2',
      addressdetails: '1',
      extratags: '1',
      namedetails: '1',
      limit: '10',
      countrycodes: 'vn',
      'accept-language': 'vi',
    });
    const results = await fetchJson<NominatimResult[]>(
      `${mapProviders.nominatim}?${params}`,
      signal,
      'Dịch vụ tìm địa chỉ phản hồi quá lâu.',
    );
    if (!Array.isArray(results)) throw new Error('Dữ liệu địa chỉ không đúng định dạng.');
    const ranked = rankPlaceResults(
      results.map(nominatimPlace).filter((place): place is Place => Boolean(place))
        .map((place) => withDistance(place, center)),
      query,
    );
    if (ranked.length) return ranked;
    if (photonError) throw new Error(`Không tìm thấy kết quả khớp. ${errorMessage(photonError)}`);
    return [];
  } catch (error) {
    if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw error;
    if (photonError) {
      throw new Error(`Không thể tìm địa điểm bằng Photon hoặc Nominatim: ${errorMessage(error)}; ${errorMessage(photonError)}`);
    }
    throw error;
  }
}

export function branchSearchTerm(place: Pick<Place, 'brand' | 'name' | 'address'>): string {
  if (place.brand.trim()) return place.brand.trim();
  const addressWords = new Set(normalizeSearchText(place.address).split(/\s+/));
  const sharedNameWords = normalizeSearchText(place.name)
    .split(/\s+/)
    .filter((word) => word.length > 1
      && !addressWords.has(word)
      && !ignoredSearchTerms.has(word));
  return sharedNameWords.length >= 2 ? sharedNameWords.join(' ') : place.name;
}

export async function searchPlaceBranches(place: Place, signal?: AbortSignal): Promise<Place[]> {
  const query = branchSearchTerm(place);
  const normalizedQuery = normalizeSearchText(query);
  const candidates = await searchPlaces(query, { lat: place.lat, lng: place.lng }, signal);
  const selectedAddress = normalizeSearchText(place.address);
  const seenAddresses = new Set<string>();

  return candidates.filter((candidate) => {
    if (candidate.id === place.id || !candidate.isFoodPlace) return false;
    const sameBrand = Boolean(place.brand && candidate.brand)
      && normalizeSearchText(candidate.brand) === normalizeSearchText(place.brand);
    const matchingName = normalizeSearchText(candidate.name).includes(normalizedQuery);
    const candidateAddress = normalizeSearchText(candidate.address);
    const duplicateLocation = candidateAddress === selectedAddress;
    const addressKey = candidateAddress || normalizeSearchText(candidate.name);
    if ((!sameBrand && !matchingName) || duplicateLocation || seenAddresses.has(addressKey)) return false;
    seenAddresses.add(addressKey);
    return true;
  }).slice(0, 8);
}

export async function searchPlaceSuggestions(
  query: string,
  center: Coordinates,
  signal?: AbortSignal,
): Promise<Place[]> {
  const results = await searchPhotonPlaces(query, center, 10, signal);
  return rankPlaceResults(results, query).slice(0, 6);
}

function overpassQuery(center: Coordinates, radius: number, type: FoodType | 'all'): string {
  const location = `${center.lat},${center.lng}`;
  if (type === 'vegetarian') {
    const amenities = 'restaurant|fast_food|food_court';
    return `[out:json][timeout:12];(node["amenity"~"^(${amenities})$"]["cuisine"~"(^|;)(vegetarian|vegan)(;|$)",i](around:${radius},${location});way["amenity"~"^(${amenities})$"]["cuisine"~"(^|;)(vegetarian|vegan)(;|$)",i](around:${radius},${location});node["amenity"~"^(${amenities})$"]["name"~"chay|vegetarian|vegan",i](around:${radius},${location});way["amenity"~"^(${amenities})$"]["name"~"chay|vegetarian|vegan",i](around:${radius},${location}););out center tags 60;`;
  }
  const amenities = 'restaurant|fast_food|food_court|ice_cream|cafe';
  return `[out:json][timeout:12];(node["amenity"~"^(${amenities})$"](around:${radius},${location});way["amenity"~"^(${amenities})$"](around:${radius},${location}););out center tags 60;`;
}

async function searchOverpass(
  center: Coordinates,
  radius: number,
  type: FoodType | 'all',
  signal?: AbortSignal,
): Promise<Place[]> {
  const now = Date.now();
  const wait = Math.max(0, nextOverpassRequestAt - now);
  nextOverpassRequestAt = Math.max(now, nextOverpassRequestAt) + 1200;
  if (wait) await abortableDelay(wait, signal);
  if (signal?.aborted) throw abortError();
  const params = new URLSearchParams({ data: overpassQuery(center, radius, type) });
  const data = await fetchJson<OverpassResponse>(
    `${mapProviders.overpass}?${params}`,
    signal,
    'OpenStreetMap phản hồi quá lâu. Hãy thử lại sau.',
  );
  if (!Array.isArray(data.elements)) throw new Error('Dữ liệu OpenStreetMap không đúng định dạng.');

  return data.elements.map((element) => {
    const tags = element.tags || {};
    const position = element.center || element;
    const amenity = tags.amenity || '';
    return makePlace({
      id: `${element.type || 'place'}/${element.id || `${position.lat},${position.lon}`}`,
      name: tags.name || tags['name:vi'] || tags['addr:full']?.split(',')[0],
      lat: Number(position.lat),
      lng: Number(position.lon),
      address: tagsAddress(tags),
      amenity,
      typeLabel: amenity === 'cafe' ? 'Cà phê' : amenity.replaceAll('_', ' '),
      osmType: element.type || '',
      osmId: element.id,
      tags,
    });
  }).filter((place): place is Place => place !== null && place.isFoodPlace
    && (type === 'all' || (type === 'vegetarian'
      && (/(^|;)\s*(vegetarian|vegan)\s*(;|$)/i.test(place.cuisine)
        || /\b(chay|vegetarian|vegan)\b/i.test(place.name)))))
    .map((place) => withDistance(place, center))
    .filter((place) => place.distance <= radius)
    .sort((a, b) => a.distance - b.distance);
}

export async function searchNearbyPlaces(
  center: Coordinates,
  radius: number,
  signal?: AbortSignal,
): Promise<{ places: Place[]; source: 'OpenStreetMap' | 'Photon' }> {
  return { places: await searchOverpass(center, radius, 'vegetarian', signal), source: 'OpenStreetMap' };
}

export async function searchPlaceAtPoint(
  point: Coordinates,
  signal?: AbortSignal,
): Promise<Place | null> {
  try {
    const places = await searchOverpass(point, 150, 'all', signal);
    return places[0] || null;
  } catch (error) {
    if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw error;
    const [restaurants, cafes] = await Promise.all([
      searchPhotonPlaces('restaurant', point, 20, signal),
      searchPhotonPlaces('cafe', point, 20, signal),
    ]);
    return [...restaurants, ...cafes]
      .filter((place) => place.isFoodPlace && place.distance <= 150)
      .sort((a, b) => a.distance - b.distance)[0] || null;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Lỗi không xác định.';
}
