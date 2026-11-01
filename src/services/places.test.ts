import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Place } from '../types/map';
import { branchSearchTerm, rankPlaceResults, searchNearbyPlaces, searchPlaceBranches } from './places';

function place(name: string, address: string, distance: number): Place {
  return {
    id: name,
    name,
    lat: 10,
    lng: 105,
    address,
    amenity: '',
    isFoodPlace: false,
    isVegetarian: false,
    brand: '',
    typeLabel: 'Địa điểm',
    isApproximate: false,
    cuisine: '',
    openingHours: '',
    phone: '',
    website: '',
    price: '',
    distance,
    osmType: '',
    osmId: undefined,
  };
}

describe('rankPlaceResults', () => {
  it('ranks a matching business above unrelated geographic names', () => {
    const results = [
      place('Cầu Cần Thơ', 'Cần Thơ, Việt Nam', 500),
      place('KFC Sense City', 'Ninh Kiều, Cần Thơ, Việt Nam', 1200),
    ];
    expect(rankPlaceResults(results, 'KFC Cần Thơ').map(({ name }) => name))
      .toEqual(['KFC Sense City']);
  });

  it('returns no unrelated results for a brand query with no name match', () => {
    expect(rankPlaceResults([
      place('Cầu Cần Thơ', 'Cần Thơ, Việt Nam', 500),
      place('Ninh Kiều', 'Cần Thơ, Việt Nam', 800),
    ], 'KFC Cần Thơ')).toEqual([]);
  });

  it('does not surface same-brand results from outside an explicitly requested area', () => {
    expect(rankPlaceResults([
      place('KFC Hà Nội', 'Hà Nội, Việt Nam', 1700000),
      place('KFC gần bạn', 'Chưa có địa chỉ OpenStreetMap', 4000),
    ], 'KFC Cần Thơ').map(({ name }) => name)).toEqual(['KFC gần bạn']);
  });

  it('uses proximity to order equally relevant places', () => {
    const results = [
      place('KFC B', 'Cần Thơ', 2000),
      place('KFC A', 'Cần Thơ', 500),
    ];
    expect(rankPlaceResults(results, 'KFC').map(({ name }) => name))
      .toEqual(['KFC A', 'KFC B']);
  });
});

describe('branchSearchTerm', () => {
  it('uses the explicit brand when OpenStreetMap provides it', () => {
    expect(branchSearchTerm({
      ...place('Mì Cay Seoul Cần Thơ', 'Cần Thơ', 0),
      brand: 'Mì Cay Seoul',
    })).toBe('Mì Cay Seoul');
  });

  it('removes address words when inferring a shared branch name', () => {
    expect(branchSearchTerm(place(
      'Mì Cay Seoul Cần Thơ',
      '226D Đường 3 Tháng 2, Ninh Kiều, Cần Thơ',
      0,
    ))).toBe('mi cay seoul');
  });
});

describe('searchPlaceBranches', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns other locations with the same brand and excludes the current address', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      features: [
        {
          geometry: { coordinates: [105.7469, 10.0452] },
          properties: {
            osm_type: 'N', osm_id: 123, name: 'Mì Cay Seoul Cần Thơ',
            brand: 'Mì Cay Seoul', osm_key: 'amenity', osm_value: 'restaurant',
          },
        },
        {
          geometry: { coordinates: [105.75, 10.05] },
          properties: {
            osm_type: 'N', osm_id: 456, name: 'Mì Cay Seoul Ninh Kiều',
            brand: 'Mì Cay Seoul', osm_key: 'amenity', osm_value: 'restaurant',
          },
        },
      ],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const branches = await searchPlaceBranches({
      ...place('Mì Cay Seoul Cần Thơ', 'Cần Thơ', 0),
      id: 'node/123',
      amenity: 'restaurant',
      isFoodPlace: true,
      brand: 'Mì Cay Seoul',
      lat: 10.0452,
      lng: 105.7469,
    });

    expect(branches.map(({ name }) => name)).toEqual(['Mì Cay Seoul Ninh Kiều']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('nearby place search', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns only nearby places tagged vegetarian or named chay', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      elements: [
        {
          type: 'node', id: 123, lat: 10.0452, lon: 105.7469,
          tags: { name: 'Quán chay thử', amenity: 'restaurant' },
        },
        {
          type: 'node', id: 456, lat: 10.0453, lon: 105.747,
          tags: { name: 'Quán ăn thường', amenity: 'restaurant', cuisine: 'vietnamese' },
        },
      ],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await searchNearbyPlaces(
      { lat: 10.0452, lng: 105.7469 },
      6500,
    );

    expect(result.source).toBe('OpenStreetMap');
    expect(result.places.map(({ name }) => name)).toEqual(['Quán chay thử']);
    expect(result.places[0]).toMatchObject({ lat: 10.0452, lng: 105.7469 });
    expect(result.places[0]).toMatchObject({ isVegetarian: true, brand: '' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestUrl = new URL(String(fetchMock.mock.calls[0][0]));
    expect(requestUrl.searchParams.get('data')).toContain('vegetarian|vegan');
  });
});
