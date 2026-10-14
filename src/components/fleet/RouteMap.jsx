import { useMemo } from 'react';
import { TILES } from '../../lib/tiles';
import { MapContainer, TileLayer, Polyline, Marker, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { AnimatePresence, motion } from 'motion/react';
import Icon from '../Icon';
import { spring } from '../../lib/motion';
import { splitAt, fmtDur } from './fleetUtils';


const dotIcon = L.divIcon({
  className: 'fv-dot',
  html: '<span class="fv-dot__ring"><i></i></span>',
  iconSize: [26, 26],
  iconAnchor: [13, 13],
});
const pinIcon = L.divIcon({
  className: 'fv-pin',
  html:
    '<svg width="30" height="38" viewBox="0 0 30 38" aria-hidden="true"><path d="M15 1C7.8 1 2 6.8 2 14c0 9.5 13 22 13 22s13-12.500 13-22C28 6.800 22.200 1 15 1Z" fill="#11100f"/><circle cx="15" cy="14" r="5" fill="#d7d1b0"/></svg>',
  iconSize: [30, 38],
  iconAnchor: [15, 36],
});

function Controls({ bounds }) {
  const map = useMap();
  return (
    <div className="fv-zoom">
      <button type="button" aria-label="Zoom in" onClick={() => map.zoomIn()}>
        <Icon name="plus" size={18} />
      </button>
      <button type="button" aria-label="Zoom out" onClick={() => map.zoomOut()}>
        <Icon name="minus" size={18} />
      </button>
      <button
        type="button"
        className="fv-zoom__locate"
        aria-label="Re-centre on route"
        onClick={() => map.fitBounds(bounds, { padding: [48, 48] })}
      >
        <Icon name="locate" size={18} />
      </button>
    </div>
  );
}

function Suggestion({ s, onApply, onDismiss }) {
  return (
    <motion.aside
      className="fv-alt"
      aria-label="Alternative route"
      initial={{ opacity: 0, y: -10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.98 }}
      transition={spring}
    >
      <div className="fv-alt__head">
        <h3>
          <Icon name="sparkle" size={16} /> Alternative route
        </h3>
        {s.live ? <span className="fv-alt__src">From AI engine</span> : <span className="demo-label">AI demo</span>}
      </div>
      <div className="fv-alt__chips tabular">
        <span>−{fmtDur(s.savedMin)}</span>
        <span>−${s.fuelUsd} fuel</span>
        <span>−{s.co2}% CO₂</span>
      </div>
      <div className="fv-alt__cmp tabular">
        <div>
          <span className="fv-muted">Current</span>
          <strong>{fmtDur(s.curMin)}</strong>
        </div>
        <Icon name="arrowRight" size={18} />
        <div>
          <span className="fv-muted">Optimized</span>
          <strong>{fmtDur(s.optMin)}</strong>
        </div>
      </div>
      <div className="fv-alt__actions">
        <button type="button" className="fv-btn fv-btn--ghost" onClick={onDismiss}>
          Dismiss
        </button>
        <button type="button" className="fv-btn fv-btn--primary" onClick={onApply}>
          Apply
        </button>
      </div>
    </motion.aside>
  );
}

export default function RouteMap({ truck, coords, suggestion, showSuggestion, onApply, onDismiss }) {
  const { done, rest, pos } = useMemo(() => splitAt(coords, truck.progress), [coords, truck.progress]);
  const bounds = useMemo(() => L.latLngBounds(coords), [coords]);
  const dest = coords[coords.length - 1];

  return (
    <section className="card fv-map" aria-label="Route map">
      <MapContainer
        key={truck.id}
        bounds={bounds}
        boundsOptions={{ padding: [56, 56] }}
        scrollWheelZoom={false}
        zoomControl={false}
        attributionControl
        className="fv-map__canvas"
      >
        <TileLayer url={TILES.url} attribution={TILES.attribution} subdomains={TILES.subdomains} maxZoom={19} />
        {rest.length > 1 ? (
          <Polyline positions={rest} interactive={false} pathOptions={{ color: '#11100f', weight: 3, dashArray: '2 8', lineCap: 'round', opacity: 0.55 }} />
        ) : null}
        {done.length > 1 ? (
          <>
            <Polyline positions={done} interactive={false} pathOptions={{ color: '#d7d1b0', weight: 9, opacity: 0.9, lineCap: 'round' }} />
            <Polyline positions={done} interactive={false} pathOptions={{ color: '#11100f', weight: 4, lineCap: 'round' }} />
          </>
        ) : null}
        <Marker position={dest} icon={pinIcon} keyboard={false} />
        {truck.progress > 0 && truck.progress < 1 ? <Marker position={pos} icon={dotIcon} keyboard={false} /> : null}
        <Controls bounds={bounds} />
      </MapContainer>
      <AnimatePresence>
        {showSuggestion ? <Suggestion key="alt" s={suggestion} onApply={onApply} onDismiss={onDismiss} /> : null}
      </AnimatePresence>
    </section>
  );
}
