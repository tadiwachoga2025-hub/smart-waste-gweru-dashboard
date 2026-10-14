import { useEffect } from 'react';
import { TILES } from '../../lib/tiles';
import { MapContainer, TileLayer, Polyline, Marker, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import Icon from '../Icon';
import { ENGINE_RULES } from '../../data/useWasteData';

const iconCache = new Map();
function pinIcon({ num, critical, selected }) {
  const key = `${num ?? ''}|${critical}|${selected}`;
  if (!iconCache.has(key)) {
    const cls = `fv-pin${critical ? ' fv-pin--critical' : ''}${selected ? ' is-sel' : ''}`;
    const label = num != null ? `<text x="15" y="18" text-anchor="middle" font-size="9" font-weight="700" fill="#0d0d0d">${num}</text>` : '';
    iconCache.set(
      key,
      L.divIcon({
        className: cls,
        html: `<svg width="30" height="38" viewBox="0 0 30 38" aria-hidden="true"><path d="M15 1C7.8 1 2 6.8 2 14c0 9.5 13 22 13 22s13-12.500 13-22C28 6.800 22.200 1 15 1Z" fill="#0d0d0d"/><circle cx="15" cy="14" r="${num != null ? 7.5 : 5}" fill="#b0e454"/>${label}</svg>`,
        iconSize: [30, 38],
        iconAnchor: [15, 36],
      }),
    );
  }
  return iconCache.get(key);
}

function Fitter({ points, nonce }) {
  const map = useMap();
  const sig = points.map((p) => p.join(',')).join('|');
  useEffect(() => {
    if (!sig) return;
    const pts = sig.split('|').map((s) => s.split(',').map(Number));
    if (pts.length === 1) map.setView(pts[0], 15);
    else map.fitBounds(L.latLngBounds(pts), { padding: [56, 56] });
  }, [map, sig, nonce]);
  return null;
}

function Controls({ onRecenter }) {
  const map = useMap();
  return (
    <div className="fv-zoom">
      <button type="button" aria-label="Zoom in" onClick={() => map.zoomIn()}>
        <Icon name="plus" size={18} />
      </button>
      <button type="button" aria-label="Zoom out" onClick={() => map.zoomOut()}>
        <Icon name="minus" size={18} />
      </button>
      <button type="button" className="fv-zoom__locate" aria-label="Re-centre map" onClick={onRecenter}>
        <Icon name="locate" size={18} />
      </button>
    </div>
  );
}

export default function RouteMap({ bins, route, selected, nonce, onSelect, onRecenter }) {
  const plotted = bins.filter((b) => Number.isFinite(b.lat) && Number.isFinite(b.lng));
  const stopPts = route.stops.map((s) => s.coords);
  const fitPts = stopPts.length ? stopPts : plotted.map((b) => [b.lat, b.lng]);

  return (
    <section className="card fv-map" aria-label="Route map">
      <MapContainer
        center={[-19.503, 29.833]}
        zoom={15}
        scrollWheelZoom={false}
        zoomControl={false}
        attributionControl
        className="fv-map__canvas"
      >
        <TileLayer url={TILES.url} attribution={TILES.attribution} subdomains={TILES.subdomains} maxZoom={19} />
        {route.coords.length >= 2 ? (
          <>
            <Polyline
              positions={route.coords}
              className="fv-route-halo"
              interactive={false}
              pathOptions={{ color: '#b0e454', weight: 9, opacity: 0.9, lineCap: 'round' }}
            />
            <Polyline
              positions={route.coords}
              className="fv-route-line"
              interactive={false}
              pathOptions={{ color: '#0d0d0d', weight: 4, lineCap: 'round' }}
            />
          </>
        ) : null}
        {plotted.map((b) => (
          <Marker
            key={b.id}
            position={[b.lat, b.lng]}
            icon={pinIcon({
              num: b.onRoute ? b.routeOrder + 1 : null,
              critical: b.fillLevel >= ENGINE_RULES.criticalFill,
              selected: selected?.id === b.id,
            })}
            zIndexOffset={selected?.id === b.id ? 1000 : 0}
            keyboard={false}
            eventHandlers={{ click: () => onSelect(b.id) }}
          />
        ))}
        <Fitter points={fitPts} nonce={nonce} />
        <Controls onRecenter={onRecenter} />
      </MapContainer>
      {selected ? (
        <aside className="fv-callout" aria-label="Selected bin">
          <h3>{selected.location}</h3>
          <strong className="tabular">{selected.fillLevel}% full</strong>
          <span>{selected.prediction}</span>
        </aside>
      ) : null}
    </section>
  );
}
