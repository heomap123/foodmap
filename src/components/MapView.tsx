import { useEffect, useRef, type MutableRefObject } from 'react';
import L from 'leaflet';
import { CircleMarker, MapContainer, Marker, Polyline, Popup, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import { mapAttribution, mapProviders } from '../config/providers';
import { isValidCoordinates, toLeafletLatLng } from '../services/geo';
import type { Coordinates, Place, RouteResult } from '../types/map';

interface MapViewProps {
  places: Place[];
  selectedPlaceId?: string;
  target?: Coordinates | null;
  currentPosition?: Coordinates | null;
  route?: RouteResult | null;
  onSelectPlace: (place: Place) => void;
  onMapClick: (point: Coordinates) => void;
  onViewportChange: (point: Coordinates, zoom: number) => void;
  onTileError: () => void;
}

function placeIcon(place: Place, selected: boolean): L.DivIcon {
  const kind = place.isVegetarian ? 'vegetarian-marker' : place.isFoodPlace ? 'food-marker' : 'location-marker';
  const classes = ['place-marker-icon', kind, selected ? 'selected-marker' : ''].filter(Boolean).join(' ');
  const size = place.isVegetarian ? 34 : 27;
  return L.divIcon({
    className: 'place-marker-wrapper',
    html: `<span class="${classes}"><span></span></span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  });
}

function MapController({
  target,
  route,
  programmaticUntilRef,
}: Pick<MapViewProps, 'target' | 'route'> & { programmaticUntilRef: MutableRefObject<number> }) {
  const map = useMap();
  useEffect(() => {
    if (route && route.coordinates.length > 1) {
      programmaticUntilRef.current = Date.now() + 1500;
      map.fitBounds(route.coordinates.map(toLeafletLatLng), { padding: [60, 60], maxZoom: 16 });
      return;
    }
    if (target && isValidCoordinates(target)) {
      programmaticUntilRef.current = Date.now() + 1500;
      map.flyTo(toLeafletLatLng(target), Math.max(map.getZoom(), 16), { duration: 0.6 });
    }
  }, [map, programmaticUntilRef, route, target]);

  useEffect(() => {
    const container = map.getContainer();
    const observer = new ResizeObserver(() => {
      programmaticUntilRef.current = Date.now() + 1000;
      map.invalidateSize({ pan: false });
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [map, programmaticUntilRef]);

  return null;
}

function MapEvents({
  onMapClick,
  onViewportChange,
  programmaticUntilRef,
}: Pick<MapViewProps, 'onMapClick' | 'onViewportChange'> & { programmaticUntilRef: MutableRefObject<number> }) {
  const map = useMap();

  useMapEvents({
    click(event) {
      const point = { lat: event.latlng.lat, lng: event.latlng.lng };
      if (isValidCoordinates(point)) onMapClick(point);
    },
    moveend() {
      if (Date.now() < programmaticUntilRef.current) {
        programmaticUntilRef.current = 0;
        return;
      }
      const center = map.getCenter();
      onViewportChange({ lat: center.lat, lng: center.lng }, map.getZoom());
    },
  });

  return null;
}

export function MapView({
  places,
  selectedPlaceId,
  target,
  currentPosition,
  route,
  onSelectPlace,
  onMapClick,
  onViewportChange,
  onTileError,
}: MapViewProps) {
  const programmaticUntilRef = useRef(0);
  return (
    <MapContainer
      center={[10.0452, 105.7469]}
      zoom={14}
      minZoom={3}
      maxZoom={19}
      scrollWheelZoom
      zoomControl
    >
      <TileLayer
        attribution={mapAttribution}
        url={mapProviders.tiles}
        maxZoom={19}
        eventHandlers={{ tileerror: onTileError }}
      />
      <MapController target={target} route={route} programmaticUntilRef={programmaticUntilRef} />
      <MapEvents
        onMapClick={onMapClick}
        onViewportChange={onViewportChange}
        programmaticUntilRef={programmaticUntilRef}
      />
      {route && (
        <Polyline
          positions={route.coordinates.map(toLeafletLatLng)}
          pathOptions={{ color: '#e46d49', weight: 5, opacity: 0.88 }}
        />
      )}
      {currentPosition && isValidCoordinates(currentPosition) && (
        <CircleMarker
          center={toLeafletLatLng(currentPosition)}
          radius={9}
          pathOptions={{ color: '#fff', weight: 3, fillColor: '#4285f4', fillOpacity: 1 }}
        >
          <Popup>Vị trí hiện tại của bạn</Popup>
        </CircleMarker>
      )}
      {places.filter((place) => isValidCoordinates(place)).map((place) => (
        <Marker
          key={place.id}
          position={toLeafletLatLng(place)}
          icon={placeIcon(place, place.id === selectedPlaceId)}
          title={place.name}
        >
          <Popup>
            <div className="map-marker-popup">
              <strong>{place.name}</strong>
              <span>{place.address}</span>
              <button type="button" onClick={() => onSelectPlace(place)}>Xem chi tiết</button>
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
