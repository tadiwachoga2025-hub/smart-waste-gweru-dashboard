import { useMemo, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import Icon from '../Icon';
import { fadeUp, stagger } from '../../lib/motion';
import FleetList from './FleetList';
import RouteMap from './RouteMap';
import { RouteSummary, EngineRules } from './RouteSummary';
import './fleet.css';

export default function FleetView({ data }) {
  const reduce = useReducedMotion();
  const bins = data?.bins;
  const route = data?.route;
  const [selectedId, setSelectedId] = useState(null);
  const [nonce, setNonce] = useState(0);

  const ordered = useMemo(() => {
    const list = bins ?? [];
    const onRoute = list.filter((b) => b.onRoute).sort((a, b) => a.routeOrder - b.routeOrder);
    const rest = list.filter((b) => !b.onRoute).sort((a, b) => b.fillLevel - a.fillLevel);
    return [...onRoute, ...rest];
  }, [bins]);

  if (!route) return null;

  const selected = ordered.find((b) => b.id === selectedId) || ordered[0] || null;
  const n = route.stops.length;
  const active = n > 0;

  return (
    <motion.main
      className="fv"
      variants={stagger(0.07)}
      initial={reduce ? false : 'hidden'}
      animate="show"
      aria-label="Route"
    >
      <motion.div className="fv__list" variants={fadeUp}>
        <FleetList bins={ordered} selectedId={selected?.id} onSelect={setSelectedId} />
      </motion.div>

      <div className="fv__main">
        <motion.header className="card fv-head" variants={fadeUp}>
          <div className="fv-head__meta">
            <h1 className="fv-head__id">AI collection route</h1>
            <span className={`fv-pill fv-pill--${active ? 'ok' : 'muted'}`}>
              <i className="fv-pill__dot" aria-hidden="true" />
              {active ? 'Active' : 'No route'}
            </span>
            <span className="fv-stat tabular">
              <Icon name="stops" size={16} /> {n} {n === 1 ? 'stop' : 'stops'}
            </span>
            <span className="fv-stat tabular">
              <Icon name="pin" size={16} /> {route.distanceKm} km
            </span>
            <span className="fv-stat tabular">
              <Icon name="weight" size={16} /> {route.fuelLitres} L fuel
            </span>
            <span className="fv-stat tabular">
              <Icon name="truck" size={16} /> {route.trucks} {route.trucks === 1 ? 'truck' : 'trucks'}
            </span>
          </div>
          <div className="fv-head__actions">
            <button type="button" className="fv-btn fv-btn--ghost" onClick={() => setNonce((x) => x + 1)}>
              <Icon name="locate" size={16} /> Recenter map
            </button>
          </div>
        </motion.header>

        <motion.div variants={fadeUp}>
          <RouteMap
            bins={ordered}
            route={route}
            selected={selected}
            nonce={nonce}
            onSelect={setSelectedId}
            onRecenter={() => setNonce((x) => x + 1)}
          />
        </motion.div>

        <div className="fv__bottom">
          <motion.div variants={fadeUp} className="fv__load">
            <RouteSummary route={route} />
          </motion.div>
          <motion.div variants={fadeUp} className="fv__info">
            <EngineRules />
          </motion.div>
        </div>
      </div>
    </motion.main>
  );
}
