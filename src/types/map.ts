export interface Coordinates {
  lat: number;
  lng: number;
}

export interface Place extends Coordinates {
  id: string;
  name: string;
  address: string;
  amenity: string;
  isFoodPlace: boolean;
  isVegetarian: boolean;
  brand: string;
  typeLabel: string;
  isApproximate: boolean;
  cuisine: string;
  openingHours: string;
  phone: string;
  website: string;
  price: string;
  distance: number;
  osmType: string;
  osmId: string | number | undefined;
}

export interface RouteResult {
  coordinates: Coordinates[];
  distanceMeters: number;
  durationSeconds: number;
}

export type FoodType = 'vegetarian';
