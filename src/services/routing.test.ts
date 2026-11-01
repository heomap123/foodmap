import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchRoute } from './routing';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchRoute', () => {
  it('requests OSRM with longitude,latitude and converts returned GeoJSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 'Ok',
      routes: [{
        distance: 1800,
        duration: 480,
        geometry: {
          coordinates: [
            [105.7469, 10.0452],
            [105.75, 10.05],
          ],
        },
      }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const route = await fetchRoute(
      { lat: 10.0452, lng: 105.7469 },
      { lat: 10.05, lng: 105.75 },
      new AbortController().signal,
    );

    expect(fetchMock.mock.calls[0][0]).toContain(
      '/105.7469,10.0452;105.75,10.05?',
    );
    expect(route.coordinates).toEqual([
      { lat: 10.0452, lng: 105.7469 },
      { lat: 10.05, lng: 105.75 },
    ]);
    expect(route.distanceMeters).toBe(1800);
    expect(route.durationSeconds).toBe(480);
  });

  it('rejects invalid route response geometry rather than drawing it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 'Ok',
      routes: [{
        distance: 1800,
        duration: 480,
        geometry: { coordinates: [[105, 10], [999, 10]] },
      }],
    }), { status: 200 })));

    await expect(fetchRoute(
      { lat: 10, lng: 105 },
      { lat: 10.01, lng: 105.01 },
      new AbortController().signal,
    )).rejects.toThrow('Dữ liệu tuyến đường có tọa độ hoặc khoảng cách không hợp lệ.');
  });
});
