import { describe, expect, it } from 'vitest';
import {
  distanceBetween,
  fromGeoJsonCoordinates,
  isValidCoordinates,
  parseCoordinates,
  toLeafletLatLng,
  toOsrmCoordinate,
} from './geo';

describe('coordinate conversions', () => {
  const canTho = { lat: 10.0452, lng: 105.7469 };

  it('keeps Leaflet coordinates in latitude, longitude order', () => {
    expect(toLeafletLatLng(canTho)).toEqual([10.0452, 105.7469]);
  });

  it('converts GeoJSON longitude, latitude coordinates', () => {
    expect(fromGeoJsonCoordinates([105.7469, 10.0452])).toEqual(canTho);
  });

  it('converts OSRM points to longitude, latitude order', () => {
    expect(toOsrmCoordinate(canTho)).toBe('105.7469,10.0452');
  });

  it('rejects missing, non-finite, and out-of-range coordinates', () => {
    expect(isValidCoordinates({ lat: Number.NaN, lng: 105 })).toBe(false);
    expect(isValidCoordinates({ lat: 91, lng: 105 })).toBe(false);
    expect(fromGeoJsonCoordinates([105, Number.NaN])).toBeNull();
    expect(parseCoordinates('91, 181')).toBeNull();
  });

  it('parses valid typed coordinates and measures distance in meters', () => {
    expect(parseCoordinates('10.0452, 105.7469')).toEqual(canTho);
    expect(distanceBetween(canTho, canTho)).toBe(0);
    expect(distanceBetween(canTho, { lat: 10.0462, lng: 105.7469 })).toBeGreaterThan(100);
  });
});
