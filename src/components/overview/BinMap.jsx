import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TILES } from '../../lib/tiles';
import L from 'leaflet';
import { MapContainer, Marker, Polyline, TileLayer, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import Icon from '../Icon.jsx';
import './map-table.css';

const CENTER = [-19.503, 29.833];

const ROUTE_CASING = { color: '#b0e454', weight: 7 };
const ROUTE_LINE = { color: '#0d0d0d', weight: 3 };

const SORTS = [
  { key: 'all', label: 'All bins', test: () => true },
  { key: 'critical', label: 'Critical (≥90%)', test: (b) => b.fillLevel >= 90 },
  { key: 'due', label: 'Due soon (75–89%)', test: (b) => b.fillLevel >= 75 && b.fillLevel < 90 },
  { key: 'route', label: 'On route', test: (b) => b.onRoute },
];

const TOAST_MS = 6000;

// Same glyph as <Icon name="bin" />, inlined because Leaflet divIcons take HTML strings.
const BIN_SVG =
  '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
  '<path d="M5 8.5h14l-1.3 11a1.5 1.5 0 0 1-1.5 1.3H7.8a1.5 1.5 0 0 1-1.5-1.3Z"/><path d="M4 8.5h16M9.5 8.5 10 5h4l.5 3.5"/></svg>';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function pinIcon(bin, selected, dim) {
  const critical = bin.fillLevel >= 90;
  const callout = selected
    ? `<div class="bm-callout"><strong>${esc(bin.code)}</strong><span>${esc(bin.location)} · <span class="tabular">${Math.round(bin.fillLevel)}%</span></span><span class="bm-callout-ai">AI: ${esc(bin.prediction)}</span></div>`
    : '';
  const badge = bin.onRoute ? `<i class="bm-pin-order tabular">${Number(bin.routeOrder) + 1}</i>` : '';
  const html =
    `<div class="bm-pin${critical ? ' is-critical' : ''}${dim ? ' is-dim' : ''}${selected ? ' is-selected' : ''}">` +
    `<span class="bm-pin-disc">${BIN_SVG}${badge}</span>` +
    `<i class="bm-pin-dot"></i>${callout}</div>`;
  return L.divIcon({ html, className: 'bm-pin-wrap', iconSize: [34, 44], iconAnchor: [17, 40] });
}

const BinMarker = memo(function BinMarker({ bin, selected, dim, onSelect }) {
  const { fillLevel, code, location, prediction, onRoute, routeOrder, id, lat, lng } = bin;
  const icon = useMemo(
    () => pinIcon({ fillLevel, code, location, prediction, onRoute, routeOrder }, selected, dim),
    [fillLevel, code, location, prediction, onRoute, routeOrder, selected, dim],
  );
  const handlers = useMemo(() => ({ click: () => onSelect(id) }), [onSelect, id]);
  return (
    <Marker
      position={[lat, lng]}
      icon={icon}
      zIndexOffset={selected ? 1000 : fillLevel >= 90 ? 400 : 0}
      eventHandlers={handlers}
      keyboard={false}
    />
  );
});

// Background click clears the selection and reports the clicked coordinates
// (the original app's "LocationFinder"). Marker clicks do not bubble here.
function MapClicks({ onSelect, onCoords }) {
  useMapEvents({
    click: (e) => {
      onSelect(null);
      onCoords({ lat: e.latlng.lat, lng: e.latlng.lng, id: Date.now() });
    },
  });
  return null;
}

function CoordToast({ coords, onClose }) {
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef(0);
  const lat = coords.lat.toFixed(3);
  const lng = coords.lng.toFixed(3);

  useEffect(() => {
    const t = window.setTimeout(onClose, TOAST_MS);
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('keydown', onKey);
    };
  }, [coords, onClose]);

  useEffect(() => () => window.clearTimeout(copyTimer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${lat}, ${lng}`);
      setCopied(true);
      window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable: ignore */
    }
  };

  return (
    <div className="bm-toast" role="status">
      <span className="bm-toast-text">
        Latitude <b className="tabular">{lat}</b> · Longitude <b className="tabular">{lng}</b>
      </span>
      <button type="button" className="bm-toast-copy" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
    </div>
  );
}

export default function BinMap({ bins, route, selectedId, onSelect, searchInputRef, follow = true }) {
  const wrapRef = useRef(null);
  const [map, setMap] = useState(null);
  const [sortKey, setSortKey] = useState('all');
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [coords, setCoords] = useState(null);
  const closeToast = useCallback(() => setCoords(null), []);
  const binsRef = useRef(bins);

  useEffect(() => {
    binsRef.current = bins;
  }, [bins]);

  // Fit to all bins on first load and whenever the set of bin positions changes
  // (fill-level updates do not alter the key, so they never re-zoom).
  const posKey = useMemo(() => bins.map((b) => `${b.id}:${b.lat},${b.lng}`).join('|'), [bins]);
  useEffect(() => {
    const list = binsRef.current;
    if (!map || !posKey || !list.length) return;
    map.fitBounds(L.latLngBounds(list.map((b) => [b.lat, b.lng])), { padding: [50, 50], maxZoom: 16 });
  }, [map, posKey]);

  // Fly to the selection when it changes (table click, search, pin click).
  useEffect(() => {
    if (!map || !selectedId || !follow) return;
    const bin = binsRef.current.find((b) => b.id === selectedId);
    if (!bin) return;
    const p = L.latLng(bin.lat, bin.lng);
    if (map.getBounds().pad(-0.25).contains(p)) return;
    map.flyTo(p, Math.max(map.getZoom(), 16), { duration: 0.9 });
  }, [map, selectedId, follow]);

  useEffect(() => {
    const onFs = () => {
      setFullscreen(document.fullscreenElement === wrapRef.current);
      window.setTimeout(() => map?.invalidateSize(), 120);
    };
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, [map]);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else wrapRef.current?.requestFullscreen?.();
  };

  const sort = SORTS.find((s) => s.key === sortKey) ?? SORTS[0];

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return bins
      .filter((b) => `${b.location} ${b.code}`.toLowerCase().includes(q))
      .slice(0, 5);
  }, [bins, query]);

  const pick = (bin) => {
    setQuery(bin.location);
    setOpen(false);
    onSelect(bin.id);
    map?.flyTo([bin.lat, bin.lng], Math.max(map.getZoom(), 16), { duration: 0.9 });
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown' && matches.length) {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (i + 1) % matches.length);
    } else if (e.key === 'ArrowUp' && matches.length) {
      e.preventDefault();
      setActive((i) => (i - 1 + matches.length) % matches.length);
    } else if (e.key === 'Enter' && matches.length) {
      e.preventDefault();
      pick(matches[Math.min(active, matches.length - 1)]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const showList = open && matches.length > 0;
  const routeCoords = route?.coords ?? [];

  return (
    <div className="bm" ref={wrapRef}>
      <div className="bm-map">
        <MapContainer
          ref={setMap}
          center={CENTER}
          zoom={15}
          zoomControl={false}
          scrollWheelZoom={false}
          attributionControl
          style={{ height: '100%', width: '100%' }}
        >
          <TileLayer url={TILES.url} attribution={TILES.attribution} subdomains={TILES.subdomains} maxZoom={19} />
          <MapClicks onSelect={onSelect} onCoords={setCoords} />
          {routeCoords.length > 1 && (
            <>
              {/* className/interactive are creation-time Leaflet options: pass them as
                  props, because react-leaflet applies pathOptions via setStyle(). */}
              <Polyline positions={routeCoords} className="bm-route-casing" interactive={false} pathOptions={ROUTE_CASING} />
              <Polyline positions={routeCoords} className="bm-route" interactive={false} pathOptions={ROUTE_LINE} />
            </>
          )}
          {bins.map((b) => (
            <BinMarker key={b.id} bin={b} selected={b.id === selectedId} dim={!sort.test(b)} onSelect={onSelect} />
          ))}
        </MapContainer>
      </div>

      <div className="bm-ui">
        <div className="bm-top">
          <div className="bm-search" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) { setOpen(false); setFocused(false); } }}>
            <div className="bm-pill bm-search-pill">
              <Icon name="search" size={20} />
              <div className="bm-search-field">
                {!query && !focused && (
                  <span className="bm-ghost" aria-hidden="true">
                    <b>MSU Campus,</b> Gweru
                  </span>
                )}
                <input
                  ref={searchInputRef}
                  type="text"
                  role="combobox"
                  aria-expanded={showList}
                  aria-controls="bm-results"
                  aria-autocomplete="list"
                  aria-activedescendant={showList ? `bm-opt-${active}` : undefined}
                  aria-label="Search area or bin"
                  placeholder="Search area or bin"
                  autoComplete="off"
                  value={query}
                  onFocus={() => { setFocused(true); setOpen(true); }}
                  onChange={(e) => { setQuery(e.target.value); setOpen(true); setActive(0); }}
                  onKeyDown={onKeyDown}
                />
              </div>
            </div>
            {showList && (
              <ul className="bm-results" id="bm-results" role="listbox" aria-label="Matching bins">
                {matches.map((b, i) => (
                  <li
                    key={b.id}
                    id={`bm-opt-${i}`}
                    role="option"
                    aria-selected={i === active}
                    className={i === active ? 'is-active' : undefined}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => pick(b)}
                  >
                    <strong>{b.location}</strong>
                    <span>{b.code} · <span className="tabular">{Math.round(b.fillLevel)}%</span></span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <label className="bm-pill bm-sort">
            <span className="bm-sort-label">Sort by</span>
            <select value={sortKey} onChange={(e) => setSortKey(e.target.value)} aria-label="Sort and emphasise bins">
              {SORTS.map((s) => (
                <option key={s.key} value={s.key}>{s.label}</option>
              ))}
            </select>
            <Icon name="chevronDown" size={18} className="bm-sort-chevron" />
          </label>

          <button
            type="button"
            className="bm-btn bm-fs"
            aria-label={fullscreen ? 'Exit fullscreen map' : 'Fullscreen map'}
            aria-pressed={fullscreen}
            onClick={toggleFullscreen}
          >
            <Icon name="expand" size={20} />
          </button>
        </div>

        {coords && <CoordToast coords={coords} onClose={closeToast} />}

        <div className="bm-zoom">
          <button type="button" className="bm-btn" aria-label="Zoom in" onClick={() => map?.zoomIn()}>
            <Icon name="plus" size={20} />
          </button>
          <button type="button" className="bm-btn" aria-label="Zoom out" onClick={() => map?.zoomOut()}>
            <Icon name="minus" size={20} />
          </button>
        </div>
      </div>
    </div>
  );
}
