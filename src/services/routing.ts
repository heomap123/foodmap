import { mapProviders } from '../config/providers';
import {
  distanceBetween,
  fromGeoJsonCoordinates,
  parseCoordinates,
  toOsrmCoordinate,
} from './geo';
import { rankPlaceResults, searchPhotonPlaces, waitForNominatimRequest } from './places';
import type { Coordinates, RouteResult } from '../types/map';

interface NominatimGeocodeResult {
  lat?: string;
  lon?: string;
}

interface OsrmResponse {
  code?: string;
  routes?: Array<{
    distance?: number;
    duration?: number;
    geometry?: { coordinates?: unknown };
  }>;
}

async function fetchJson<T>(url: string, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw new DOMException('The request was cancelled.', 'AbortError');
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), 15_000);
  const onAbort = () => controller.abort();
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`Dịch vụ bản đồ phản hồi HTTP ${response.status}.`);
    return await response.json() as T;
  } catch (error) {
    if (signal.aborted) throw new DOMException('The request was cancelled.', 'AbortError');
    if (controller.signal.aborted) throw new Error('Dịch vụ bản đồ phản hồi quá lâu.');
    throw error;
  } finally {
    globalThis.clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
  }
}

export async function geocodeAddress(
  address: string,
  center: Coordinates,
  signal: AbortSignal,
): Promise<Coordinates> {
  const typedCoordinates = parseCoordinates(address);
  if (typedCoordinates) return typedCoordinates;

  let photonError: unknown;
  try {
    const matches = rankPlaceResults(
      await searchPhotonPlaces(address, center, 8, signal),
      address,
    );
    if (matches.length) return { lat: matches[0].lat, lng: matches[0].lng };
  } catch (error) {
    if (signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw error;
    photonError = error;
  }

  await waitForNominatimRequest(signal);
  const params = new URLSearchParams({
    q: address,
    format: 'jsonv2',
    limit: '1',
    countrycodes: 'vn',
    'accept-language': 'vi',
  });
  try {
    const results = await fetchJson<NominatimGeocodeResult[]>(
      `${mapProviders.nominatim}?${params}`,
      signal,
    );
    if (!Array.isArray(results) || !results[0]) {
      throw new Error(`Không tìm thấy địa chỉ "${address}".`);
    }
    const point = { lat: Number(results[0].lat), lng: Number(results[0].lon) };
    if (!Number.isFinite(point.lat) || Math.abs(point.lat) > 90
      || !Number.isFinite(point.lng) || Math.abs(point.lng) > 180) {
      throw new Error(`Địa chỉ "${address}" trả về tọa độ không hợp lệ.`);
    }
    return point;
  } catch (error) {
    if (photonError && error instanceof Error) {
      throw new Error(`Không tìm thấy địa chỉ "${address}". ${error.message} Photon: ${
        photonError instanceof Error ? photonError.message : 'dịch vụ không khả dụng.'
      }`);
    }
    throw error;
  }
}

export async function fetchRoute(
  origin: Coordinates,
  destination: Coordinates,
  signal: AbortSignal,
): Promise<RouteResult> {
  if (distanceBetween(origin, destination) < 1) {
    throw new Error('Điểm xuất phát và điểm đến quá gần nhau để tính tuyến đường.');
  }
  const coordinates = `${toOsrmCoordinate(origin)};${toOsrmCoordinate(destination)}`;
  const params = new URLSearchParams({ overview: 'full', geometries: 'geojson', steps: 'false' });
  const data = await fetchJson<OsrmResponse>(
    `${mapProviders.osrm}/${coordinates}?${params}`,
    signal,
  );
  if (data.code !== 'Ok' || !Array.isArray(data.routes) || !data.routes[0]) {
    throw new Error('Không tìm thấy tuyến đường phù hợp cho hai điểm đã chọn.');
  }
  const route = data.routes[0];
  if (!Array.isArray(route.geometry?.coordinates) || route.geometry.coordinates.length < 2) {
    throw new Error('Dữ liệu hình học tuyến đường không đúng định dạng.');
  }
  if (typeof route.distance !== 'number' || !Number.isFinite(route.distance)
    || typeof route.duration !== 'number' || !Number.isFinite(route.duration)) {
    throw new Error('Dữ liệu tuyến đường có khoảng cách hoặc thời gian không hợp lệ.');
  }
  const routeCoordinates = route.geometry.coordinates
    .map(fromGeoJsonCoordinates)
    .filter((point): point is Coordinates => Boolean(point));
  if (routeCoordinates.length !== route.geometry.coordinates.length) {
    throw new Error('Dữ liệu tuyến đường có tọa độ hoặc khoảng cách không hợp lệ.');
  }
  return {
    coordinates: routeCoordinates,
    distanceMeters: route.distance,
    durationSeconds: route.duration,
  };
}

export function formatRouteDistance(meters: number): string {
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;
}

export function formatRouteDuration(seconds: number): string {
  const totalMinutes = Math.max(1, Math.round(seconds / 60));
  if (totalMinutes < 60) return `${totalMinutes} phút`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes ? `${hours} giờ ${minutes} phút` : `${hours} giờ`;
}
