import type { Coordinates } from '../types/map';

export const DEFAULT_CENTER: Coordinates = { lat: 10.0452, lng: 105.7469 };

export function isValidCoordinates(point: unknown): point is Coordinates {
  if (!point || typeof point !== 'object') return false;
  const coordinates = point as Partial<Coordinates>;
  return Number.isFinite(coordinates.lat)
    && Number.isFinite(coordinates.lng)
    && Math.abs(coordinates.lat!) <= 90
    && Math.abs(coordinates.lng!) <= 180;
}

export function toLeafletLatLng(point: Coordinates): [number, number] {
  if (!isValidCoordinates(point)) throw new Error('Tọa độ địa điểm không hợp lệ.');
  return [point.lat, point.lng];
}

export function fromGeoJsonCoordinates(value: unknown): Coordinates | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const point = { lat: Number(value[1]), lng: Number(value[0]) };
  return isValidCoordinates(point) ? point : null;
}

export function toOsrmCoordinate(point: Coordinates): string {
  if (!isValidCoordinates(point)) throw new Error('Tọa độ điểm đi hoặc điểm đến không hợp lệ.');
  return `${point.lng},${point.lat}`;
}

export function parseCoordinates(value: string): Coordinates | null {
  const match = value.trim().match(/^(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const point = { lat: Number(match[1]), lng: Number(match[2]) };
  return isValidCoordinates(point) ? point : null;
}

export function distanceBetween(a: Coordinates, b: Coordinates): number {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const latitudeDifference = radians(b.lat - a.lat);
  const longitudeDifference = radians(b.lng - a.lng);
  const haversine = Math.sin(latitudeDifference / 2) ** 2
    + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat))
    * Math.sin(longitudeDifference / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters)) return '';
  return meters < 1000
    ? `${Math.round(meters)} m từ tâm bản đồ`
    : `${(meters / 1000).toFixed(1)} km từ tâm bản đồ`;
}

export function nearbySearchRadius(zoom: number): number {
  if (zoom >= 18) return 450;
  if (zoom >= 17) return 800;
  if (zoom >= 16) return 1600;
  if (zoom >= 15) return 3500;
  if (zoom >= 14) return 6500;
  return 9000;
}
