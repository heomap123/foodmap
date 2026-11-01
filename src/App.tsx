import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { MapView } from './components/MapView';
import { PlaceDetailsDialog } from './components/PlaceDetailsDialog';
import { DEFAULT_CENTER, formatDistance, nearbySearchRadius } from './services/geo';
import {
  searchNearbyPlaces,
  searchPlaceAtPoint,
  searchPlaceSuggestions,
  searchPlaces,
} from './services/places';
import { fetchRoute, formatRouteDistance, formatRouteDuration, geocodeAddress } from './services/routing';
import type { Coordinates, Place, RouteResult } from './types/map';

type ViewMode = 'nearby' | 'search';
type NearbyStatus = 'loading' | 'ready' | 'empty' | 'error';

const RecommendedPlaces = lazy(() => import('./components/RecommendedPlaces')
  .then(({ RecommendedPlaces: component }) => ({ default: component })));

interface MapViewport {
  center: Coordinates;
  zoom: number;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Đã xảy ra lỗi không xác định.';
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function Icon({ name }: { name: 'settings' | 'swap' | 'route' | 'location' | 'refresh' }) {
  const paths = {
    settings: <><circle cx="12" cy="12" r="3" /><path d="m19.4 15 .1.1a1.7 1.7 0 1 1-2.4 2.4l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a1.7 1.7 0 1 1-3.4 0v-.2a1.7 1.7 0 0 0-2.9-1.2l-.1.1a1.7 1.7 0 1 1-2.4-2.4l.1-.1a1.7 1.7 0 0 0-1.2-2.9H4a1.7 1.7 0 1 1 0-3.4h.2a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a1.7 1.7 0 1 1 2.4-2.4l.1.1a1.7 1.7 0 0 0 2.9-1.2V2a1.7 1.7 0 1 1 3.4 0v.2a1.7 1.7 0 0 0 2.9 1.2l.1-.1a1.7 1.7 0 1 1 2.4 2.4l-.1.1a1.7 1.7 0 0 0 1.2 2.9h.2a1.7 1.7 0 1 1 0 3.4h-.2a1.7 1.7 0 0 0-1.2 2.9Z" /></>,
    swap: <><path d="M7 7h12l-3-3M17 17H5l3 3" /><path d="M19 7v4M5 17v-4" /></>,
    route: <><path d="M4 12h15M13 5l7 7-7 7" /></>,
    location: <><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></>,
    refresh: <><path d="M20 11a8 8 0 0 0-14.8-3L4 10" /><path d="M4 4v6h6M4 13a8 8 0 0 0 14.8 3L20 14" /><path d="M20 20v-6h-6" /></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

export default function App() {
  const [viewport, setViewport] = useState<MapViewport>({ center: DEFAULT_CENTER, zoom: 14 });
  const [splitPercent, setSplitPercent] = useState(60);
  const [isSmallScreen, setIsSmallScreen] = useState(() => window.matchMedia('(max-width: 767px)').matches);
  const [viewMode, setViewMode] = useState<ViewMode>('nearby');
  const [nearbyPlaces, setNearbyPlaces] = useState<Place[]>([]);
  const [searchResults, setSearchResults] = useState<Place[]>([]);
  const [nearbyStatus, setNearbyStatus] = useState<NearbyStatus>('loading');
  const [nearbyError, setNearbyError] = useState('');
  const [nearbySource, setNearbySource] = useState('OpenStreetMap');
  const [refreshKey, setRefreshKey] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState<Place[]>([]);
  const [suggestionMessage, setSuggestionMessage] = useState('');
  const [searchMessage, setSearchMessage] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [selectedPlace, setSelectedPlace] = useState<Place | null>(null);
  const [target, setTarget] = useState<Coordinates | null>(null);
  const [currentPosition, setCurrentPosition] = useState<Coordinates | null>(null);
  const [originText, setOriginText] = useState('');
  const [destinationText, setDestinationText] = useState('');
  const [originPoint, setOriginPoint] = useState<Coordinates | null>(null);
  const [destinationPoint, setDestinationPoint] = useState<Coordinates | null>(null);
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [routeStatus, setRouteStatus] = useState('');
  const [routeError, setRouteError] = useState('');
  const [isRouting, setIsRouting] = useState(false);
  const [toast, setToast] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const suggestionController = useRef<AbortController | null>(null);
  const searchController = useRef<AbortController | null>(null);
  const routeController = useRef<AbortController | null>(null);
  const mapPickController = useRef<AbortController | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const lastTileError = useRef(0);

  const minSplitPercent = isSmallScreen ? 42 : 34;
  const maxSplitPercent = isSmallScreen
    ? Math.min(82, ((window.innerHeight - 160) / window.innerHeight) * 100)
    : Math.min(74, ((window.innerWidth - 290) / window.innerWidth) * 100);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)');
    const updateScreenSize = () => setIsSmallScreen(media.matches);
    media.addEventListener('change', updateScreenSize);
    return () => media.removeEventListener('change', updateScreenSize);
  }, []);

  function updateSplit(clientX: number, clientY: number) {
    const dimension = isSmallScreen ? window.innerHeight : window.innerWidth;
    const position = isSmallScreen ? clientY : clientX;
    setSplitPercent(Math.max(minSplitPercent, Math.min(maxSplitPercent, (position / dimension) * 100)));
  }

  const visiblePlaces = viewMode === 'search' ? searchResults : nearbyPlaces;
  const mapPlaces = useMemo(() => {
    const visible = visiblePlaces.filter((place) => place.distance < 100_000);
    return selectedPlace && !visible.some(({ id }) => id === selectedPlace.id)
      ? [...visible, selectedPlace]
      : visible;
  }, [selectedPlace, visiblePlaces]);

  const notify = useCallback((message: string) => {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(''), 4200);
  }, []);

  useEffect(() => {
    return () => {
      suggestionController.current?.abort();
      searchController.current?.abort();
      routeController.current?.abort();
      mapPickController.current?.abort();
      window.clearTimeout(toastTimer.current);
    };
  }, [notify]);

  useEffect(() => {
    if (viewMode !== 'nearby') return;
    const controller = new AbortController();
    let timer: number | undefined;
    setNearbyStatus('loading');
    setNearbyError('');
    timer = window.setTimeout(() => {
      void searchNearbyPlaces(
        viewport.center,
        nearbySearchRadius(viewport.zoom),
        controller.signal,
      ).then(({ places, source }) => {
        setNearbyPlaces(places);
        setNearbySource(source);
        setNearbyStatus(places.length ? 'ready' : 'empty');
      }).catch((error: unknown) => {
        if (controller.signal.aborted || isAbortError(error)) return;
        console.error('LocaFood could not load nearby places.', error);
        setNearbyError(errorMessage(error));
        setNearbyStatus('error');
      });
    }, nearbyPlaces.length ? 500 : 150);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [refreshKey, viewMode, viewport]);

  useEffect(() => {
    const query = searchQuery.trim();
    suggestionController.current?.abort();
    setSuggestions([]);
    if (query.length < 3 || viewMode === 'search') {
      setSuggestionMessage('');
      return;
    }

    const controller = new AbortController();
    suggestionController.current = controller;
    setSuggestionMessage('Đang tìm gợi ý địa điểm...');
    const timer = window.setTimeout(() => {
      void searchPlaceSuggestions(query, viewport.center, controller.signal)
        .then((results) => {
          if (controller.signal.aborted) return;
          setSuggestions(results);
          setSuggestionMessage(results.length
            ? ''
            : 'Không thấy kết quả khớp. Nhấn “Tìm” để thử tìm cả dữ liệu địa chỉ.');
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted || isAbortError(error)) return;
          console.error('LocaFood could not load place suggestions.', error);
          setSuggestionMessage('Không tải được gợi ý. Nhấn “Tìm” để thử nguồn địa chỉ dự phòng.');
        });
    }, 500);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [searchQuery, viewMode, viewport.center]);

  useEffect(() => {
    if (!settingsOpen) return;
    const dialog = document.getElementById('settings-dialog') as HTMLDialogElement | null;
    if (dialog && !dialog.open) dialog.showModal();
  }, [settingsOpen]);

  function selectPlace(place: Place) {
    mapPickController.current?.abort();
    searchController.current?.abort();
    setIsSearching(false);
    routeController.current?.abort();
    setIsRouting(false);
    setRoute(null);
    setRouteError('');
    setRouteStatus('');
    setSelectedPlace(place);
    setDestinationText(place.name);
    setDestinationPoint({ lat: place.lat, lng: place.lng });
    setTarget({ lat: place.lat, lng: place.lng });
    setSuggestions([]);
    setSuggestionMessage('');
  }

  async function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = searchQuery.trim();
    if (query.length < 2) {
      setSearchMessage('Nhập ít nhất 2 ký tự để tìm địa điểm.');
      return;
    }
    searchController.current?.abort();
    const controller = new AbortController();
    searchController.current = controller;
    setIsSearching(true);
    setSearchMessage('Đang tìm quán và địa chỉ...');
    setSuggestions([]);
    setSuggestionMessage('');
    setSelectedPlace(null);
    setSearchResults([]);
    setViewMode('search');
    try {
      const results = await searchPlaces(query, viewport.center, controller.signal);
      if (controller.signal.aborted) return;
      setSearchResults(results);
      setSearchMessage(results.length
        ? `${results.length} kết quả phù hợp${results.some((place) => place.isApproximate) ? ' · một số vị trí đường chỉ mang tính ước lượng' : ''}.`
        : `OpenStreetMap chưa có kết quả phù hợp cho “${query}”. Hãy thử tên quán hoặc địa chỉ đầy đủ hơn.`);
    } catch (error) {
      if (controller.signal.aborted || isAbortError(error)) return;
      console.error('LocaFood place search failed.', error);
      setSearchResults([]);
      setSearchMessage(errorMessage(error));
    } finally {
      if (!controller.signal.aborted) setIsSearching(false);
    }
  }

  function handleSearchInput(value: string) {
    searchController.current?.abort();
    setIsSearching(false);
    setSearchQuery(value);
    setSearchMessage('');
    if (viewMode === 'search') {
      setViewMode('nearby');
      setSearchResults([]);
    }
  }

  function updateViewport(center: Coordinates, zoom: number) {
    setViewport((current) => {
      if (Math.abs(current.center.lat - center.lat) < 0.0001
        && Math.abs(current.center.lng - center.lng) < 0.0001
        && current.zoom === zoom) return current;
      return { center, zoom };
    });
    if (viewMode === 'search') {
      searchController.current?.abort();
      setIsSearching(false);
      setViewMode('nearby');
      setSearchQuery('');
      setSearchMessage('');
      setSearchMessage('');
    }
  }

  async function handleMapClick(point: Coordinates) {
    mapPickController.current?.abort();
    searchController.current?.abort();
    setIsSearching(false);
    setViewMode('nearby');
    setSearchQuery('');
    const controller = new AbortController();
    mapPickController.current = controller;
    setRoute(null);
    setRouteError('');
    setRouteStatus('Đang tìm địa điểm gần điểm đã chọn...');
    try {
      const place = await searchPlaceAtPoint(point, controller.signal);
      if (controller.signal.aborted) return;
      setRouteStatus('');
      if (!place) {
        notify('Không tìm thấy quán đã được lập bản đồ gần điểm này.');
        return;
      }
      mapPickController.current = null;
      selectPlace(place);
    } catch (error) {
      if (isAbortError(error)) return;
      console.error('LocaFood could not find a place at the selected map point.', error);
      setRouteStatus('');
      notify(errorMessage(error));
    } finally {
      if (mapPickController.current === controller) mapPickController.current = null;
    }
  }

  async function useCurrentLocation() {
    if (!window.isSecureContext) {
      notify('Định vị yêu cầu HTTPS hoặc localhost. Hãy chạy ứng dụng bằng npm run dev.');
      return;
    }
    if (!navigator.geolocation) {
      notify('Trình duyệt này không hỗ trợ định vị.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const point = { lat: coords.latitude, lng: coords.longitude };
        if (!Number.isFinite(point.lat) || Math.abs(point.lat) > 90
          || !Number.isFinite(point.lng) || Math.abs(point.lng) > 180) {
          notify('Thiết bị trả về tọa độ vị trí không hợp lệ.');
          return;
        }
        cancelRouteRequest();
        setCurrentPosition(point);
        setOriginPoint(point);
        setOriginText('Vị trí của tôi');
        setTarget(point);
        setRoute(null);
        setRouteError('');
        notify('Đã cập nhật vị trí xuất phát.');
      },
      (error) => {
        notify(error.code === error.PERMISSION_DENIED
          ? 'Bạn chưa cấp quyền vị trí cho trang này.'
          : 'Không lấy được vị trí. Hãy thử lại hoặc nhập địa chỉ xuất phát.');
      },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 },
    );
  }

  async function submitRoute(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!originPoint && !originText.trim()) {
      setRouteError('Nhập điểm xuất phát hoặc dùng vị trí hiện tại.');
      return;
    }
    if (!destinationPoint && !destinationText.trim()) {
      setRouteError('Nhập điểm đến hoặc chọn một địa điểm trên bản đồ.');
      return;
    }
    cancelRouteRequest();
    const controller = new AbortController();
    routeController.current = controller;
    setIsRouting(true);
    setRoute(null);
    setRouteError('');
    setRouteStatus('Đang tìm địa chỉ và tính tuyến đường...');
    try {
      const origin = originPoint || await geocodeAddress(originText.trim(), viewport.center, controller.signal);
      const destination = destinationPoint
        || await geocodeAddress(destinationText.trim(), viewport.center, controller.signal);
      if (controller.signal.aborted) return;
      const result = await fetchRoute(origin, destination, controller.signal);
      if (controller.signal.aborted) return;
      setRoute(result);
      setRouteStatus('');
    } catch (error) {
      if (controller.signal.aborted || isAbortError(error)) return;
      console.error('LocaFood could not calculate the route.', error);
      setRouteError(errorMessage(error));
      setRouteStatus('');
    } finally {
      if (!controller.signal.aborted) setIsRouting(false);
    }
  }

  function swapRoute() {
    cancelRouteRequest();
    setSelectedPlace(null);
    setOriginText(destinationText);
    setDestinationText(originText);
    setOriginPoint(destinationPoint);
    setDestinationPoint(originPoint);
    setRoute(null);
    setRouteError('');
    setRouteStatus('');
  }

  function cancelRouteRequest() {
    routeController.current?.abort();
    routeController.current = null;
    setIsRouting(false);
  }

  const googleQuery = selectedPlace
    ? [selectedPlace.name, selectedPlace.address].filter(Boolean).join(', ')
    : destinationText.trim() || `vegetarian restaurants near ${viewport.center.lat},${viewport.center.lng}`;
  const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(googleQuery)}`;
  const statusText = nearbyStatus === 'loading'
    ? 'Đang tải địa điểm…'
    : nearbyStatus === 'error'
      ? 'Dịch vụ địa điểm tạm thời lỗi'
      : `${nearbySource} · ${nearbyPlaces.length} địa điểm`;

  return (
    <div
      className="app-shell"
      style={{
        '--panel-split-width': `${splitPercent}vw`,
        '--panel-split-height': `${splitPercent}vh`,
      } as CSSProperties}
    >
      <aside className="explore-panel" id="explore-panel">
        <header className="brand-row">
          <a className="brand" href="./" aria-label="LocaFood trang chủ">
            <span className="brand-mark">L</span>LocaFood<span className="brand-tag">ĐI & ĂN</span>
          </a>
          <button
            className="icon-button"
            type="button"
            aria-label="Thông tin bản đồ"
            title="Thông tin bản đồ"
            onClick={() => setSettingsOpen(true)}
          >
            <Icon name="settings" />
          </button>
        </header>

        <section className="panel-intro">
          <p className="eyebrow">KHÁM PHÁ MÓN CHAY GẦN ĐÂY</p>
          <h1>Quán chay<br />gần bạn.</h1>
          <p>Tìm quán chay quanh bạn, xem thông tin và chia sẻ đánh giá.</p>
        </section>

        <form className="route-form" onSubmit={submitRoute}>
          <label className="route-field" htmlFor="origin">
            <span className="field-caption">Điểm xuất phát</span>
            <span className="input-line">
              <span className="field-dot" aria-hidden="true" />
              <input
                id="origin"
                autoComplete="street-address"
                placeholder="Vị trí của bạn hoặc địa chỉ"
                value={originText}
                onChange={(event) => {
                    cancelRouteRequest();
                    setOriginText(event.target.value);
                    setOriginPoint(null);
                    setRoute(null);
                    setRouteError('');
                    setRouteStatus('');
                  }}
              />
            </span>
          </label>
          <button
            className="swap-button"
            type="button"
            aria-label="Đổi điểm đi và điểm đến"
            title="Đổi điểm đi và điểm đến"
            onClick={swapRoute}
          >
            <Icon name="swap" />
          </button>
          <label className="route-field" htmlFor="destination">
            <span className="field-caption">Điểm đến</span>
            <span className="input-line">
              <span className="field-dot destination" aria-hidden="true" />
              <input
                id="destination"
                autoComplete="street-address"
                placeholder="Chọn quán trên bản đồ hoặc nhập địa chỉ"
                value={destinationText}
                onChange={(event) => {
                  cancelRouteRequest();
                  setDestinationText(event.target.value);
                  setDestinationPoint(null);
                  setSelectedPlace(null);
                  setRoute(null);
                  setRouteError('');
                  setRouteStatus('');
                }}
              />
            </span>
          </label>
          <div className="route-actions">
            <button className="route-button" type="submit" disabled={isRouting}>
              <Icon name="route" /><span>{isRouting ? 'Đang tìm đường…' : 'Tìm đường'}</span>
            </button>
            <button
              className="location-button"
              type="button"
              aria-label="Dùng vị trí hiện tại"
              title="Dùng vị trí hiện tại"
              onClick={() => void useCurrentLocation()}
            >
              <Icon name="location" />
            </button>
          </div>
          {(routeStatus || routeError) && (
            <p className={`route-status${routeError ? ' error' : ''}`} role={routeError ? 'alert' : 'status'}>
              {routeError || routeStatus}
            </p>
          )}
        </form>

        <section className="nearby-section" aria-labelledby="nearby-title">
          <header className="nearby-heading">
            <div>
              <p className="eyebrow">TÌM MÓN CHAY GẦN ĐÂY</p>
              <h2 id="nearby-title">{viewMode === 'search' ? 'Kết quả tìm kiếm' : 'Quán chay quanh bạn'}</h2>
            </div>
            <button
              type="button"
              aria-label="Tải lại địa điểm"
              title="Tải lại địa điểm"
              onClick={() => {
                searchController.current?.abort();
                setIsSearching(false);
                if (viewMode === 'search') {
                  setViewMode('nearby');
                  setSearchQuery('');
                  setSearchMessage('');
                }
                setRefreshKey((key) => key + 1);
              }}
            >
              <Icon name="refresh" />
            </button>
          </header>
          <div className="place-search-container">
            <form className="place-search-form" onSubmit={submitSearch}>
              <label className="visually-hidden" htmlFor="place-search">Tìm quán chay hoặc địa chỉ trên bản đồ</label>
              <input
                className="place-search"
                id="place-search"
                type="search"
                autoComplete="off"
                role="combobox"
                aria-autocomplete="list"
                aria-controls="place-suggestions"
                aria-expanded={Boolean(suggestions.length || suggestionMessage)}
                placeholder="Tìm quán chay, địa chỉ hoặc đường..."
                value={searchQuery}
                onChange={(event) => handleSearchInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    setSuggestions([]);
                    setSuggestionMessage('');
                  }
                }}
              />
              <button className="place-search-button" type="submit" disabled={isSearching}>
                {isSearching ? 'Đang tìm' : 'Tìm'}
              </button>
            </form>
            {(suggestions.length > 0 || suggestionMessage) && (
              <div className="place-suggestions" id="place-suggestions" role="listbox" aria-label="Gợi ý địa điểm">
                {suggestions.map((place) => (
                  <button
                    key={place.id}
                    className="place-suggestion"
                    type="button"
                    role="option"
                    aria-selected="false"
                    onClick={() => selectPlace(place)}
                  >
                    <span className="suggestion-marker" aria-hidden="true">{place.isFoodPlace ? '●' : '⌖'}</span>
                    <span className="suggestion-copy">
                      <span className="suggestion-name">{place.name}</span>
                      <span className="suggestion-address">{place.typeLabel} · {place.address}</span>
                    </span>
                  </button>
                ))}
                {suggestionMessage && <p className="suggestion-status" role="status">{suggestionMessage}</p>}
              </div>
            )}
          </div>
          {viewMode === 'search' && searchMessage && (
            <p className={`search-feedback${searchResults.length ? '' : ' error'}`} role="status">{searchMessage}</p>
          )}
          {viewMode === 'nearby' && nearbyStatus === 'error' && (
            <div className="nearby-error" role="alert">
              {nearbyError} <button type="button" onClick={() => setRefreshKey((key) => key + 1)}>Thử lại</button>
            </div>
          )}
          <p className="results-meta" aria-live="polite">
            {viewMode === 'nearby'
              ? nearbyStatus === 'loading' ? 'Đang tìm quán chay quanh bản đồ…' : `${nearbyPlaces.length} địa điểm · ${nearbySource}`
              : `${searchResults.length} kết quả`}
          </p>
          <div className="place-list" aria-live="polite">
            {visiblePlaces.map((place) => (
              <button
                key={place.id}
                className="place-item"
                type="button"
                aria-current={selectedPlace?.id === place.id ? 'true' : undefined}
                onClick={() => selectPlace(place)}
              >
                <span className="place-thumb" aria-hidden="true">{place.isFoodPlace ? '✦' : '⌖'}</span>
                <span className="place-copy">
                  <span className="place-name">{place.name}</span>
                  <span className="place-card-category">{place.typeLabel}</span>
                  <span className="place-address">{place.address}</span>
                  <span className="place-distance">{formatDistance(place.distance)}</span>
                </span>
                <span className="place-arrow" aria-hidden="true">›</span>
              </button>
            ))}
            {!visiblePlaces.length && viewMode === 'nearby' && nearbyStatus === 'loading' && (
              <div className="empty-state">
                <span className="empty-state-icon" aria-hidden="true">⌖</span>
                <strong>Đang tải địa điểm</strong>
                <p>Đang tìm quán chay quanh khu vực bản đồ.</p>
              </div>
            )}
            {!visiblePlaces.length && viewMode === 'nearby' && nearbyStatus === 'empty' && (
              <div className="empty-state">
                <span className="empty-state-icon" aria-hidden="true">⌖</span>
                <strong>Chưa thấy quán chay gần đây</strong>
                <p>Thử phóng to bản đồ hoặc kéo đến khu vực khác.</p>
              </div>
            )}
            {!visiblePlaces.length && viewMode === 'search' && !isSearching && (
              <div className="empty-state">
                <span className="empty-state-icon" aria-hidden="true">⌕</span>
                <strong>Không có kết quả phù hợp</strong>
                <p>OpenStreetMap có thể chưa lập bản đồ địa điểm này. Hãy thử tên hoặc địa chỉ cụ thể hơn.</p>
              </div>
            )}
          </div>
        </section>
        <Suspense fallback={<section className="recommendation-section" aria-busy="true"><p className="recommendation-empty">Đang tải danh sách gợi ý…</p></section>}>
          <RecommendedPlaces />
        </Suspense>
        <footer className="panel-footer">
          <span>© OpenStreetMap contributors</span>
          <span>{viewMode === 'search' ? 'Leaflet · tìm kiếm' : statusText}</span>
        </footer>
      </aside>

      <div
        className="resize-divider"
        role="separator"
        aria-label="Điều chỉnh kích thước giao diện và bản đồ"
        aria-controls="explore-panel map-stage"
        aria-orientation={isSmallScreen ? 'horizontal' : 'vertical'}
        aria-valuemin={minSplitPercent}
        aria-valuemax={Math.round(maxSplitPercent)}
        aria-valuenow={Math.round(splitPercent)}
        aria-valuetext={`${Math.round(splitPercent)}% ${isSmallScreen ? 'chiều cao' : 'chiều rộng'} giao diện`}
        tabIndex={0}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          updateSplit(event.clientX, event.clientY);
        }}
        onPointerMove={(event) => {
          if (event.buttons) updateSplit(event.clientX, event.clientY);
        }}
        onKeyDown={(event) => {
          const decrease = isSmallScreen ? event.key === 'ArrowUp' : event.key === 'ArrowLeft';
          const increase = isSmallScreen ? event.key === 'ArrowDown' : event.key === 'ArrowRight';
          if (decrease || increase) {
            event.preventDefault();
            const step = event.shiftKey ? 5 : 2;
            setSplitPercent((value) => Math.max(minSplitPercent, Math.min(maxSplitPercent, value + (increase ? step : -step))));
          } else if (event.key === 'Home' || event.key === 'End') {
            event.preventDefault();
            setSplitPercent(event.key === 'Home' ? minSplitPercent : maxSplitPercent);
          }
        }}
      />

      <main className="map-stage" id="map-stage" aria-label="Bản đồ và tuyến đường">
        <MapView
          places={mapPlaces}
          selectedPlaceId={selectedPlace?.id}
          target={target}
          currentPosition={currentPosition}
          route={route}
          onSelectPlace={selectPlace}
          onMapClick={(point) => void handleMapClick(point)}
          onViewportChange={updateViewport}
          onTileError={() => {
            if (Date.now() - lastTileError.current < 5000) return;
            lastTileError.current = Date.now();
            notify('Không tải được một số ô bản đồ. Kiểm tra kết nối hoặc cấu hình nhà cung cấp tile.');
          }}
        />
        <div className="map-overlay">
          <span className="map-pulse" aria-hidden="true" />
          <span>Leaflet · OSM</span>
          <strong>Khám phá quanh bạn</strong>
          <span className="vegetarian-map-key"><span aria-hidden="true" />Quán chay</span>
        </div>
        <a
          className="google-maps-shortcut"
          href={googleMapsUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Mở địa điểm hoặc khu vực đang xem trong Google Maps"
        >
          Google Maps ↗
        </a>
        {route && (
          <div className="route-summary" role="status">
            <div><strong>{formatRouteDuration(route.durationSeconds)}</strong><span>thời gian dự kiến</span></div>
            <span className="summary-line" aria-hidden="true" />
            <div><strong>{formatRouteDistance(route.distanceMeters)}</strong><span>quãng đường</span></div>
          </div>
        )}
        <div className={`map-toast${toast ? ' visible' : ''}`} role="status" aria-live="polite">{toast}</div>
      </main>

      <PlaceDetailsDialog
        place={selectedPlace}
        onClose={() => setSelectedPlace(null)}
        onSelectPlace={selectPlace}
      />

      <dialog
        id="settings-dialog"
        aria-labelledby="settings-title"
        onClose={() => setSettingsOpen(false)}
        onClick={(event) => {
          if (event.target === event.currentTarget) event.currentTarget.close();
        }}
      >
        <div className="dialog-body">
          <button className="icon-button dialog-close" type="button" aria-label="Đóng" onClick={() => {
            (document.getElementById('settings-dialog') as HTMLDialogElement | null)?.close();
          }}>×</button>
          <p className="eyebrow">DỮ LIỆU BẢN ĐỒ</p>
          <h2 id="settings-title">Dữ liệu bản đồ OpenStreetMap</h2>
          <p className="dialog-copy">
            Bản đồ sử dụng Leaflet và dữ liệu OpenStreetMap để hiển thị địa điểm quanh bạn.
          </p>
          <p className="key-help">
            Các dịch vụ tile, tìm địa điểm và tuyến đường công khai có thể giới hạn lưu lượng, thay đổi hoặc không cam kết SLA.
            Khi triển khai cho nhiều người dùng, hãy chọn nhà cung cấp phù hợp và đặt endpoint trong cấu hình môi trường.
          </p>
        </div>
      </dialog>
    </div>
  );
}
