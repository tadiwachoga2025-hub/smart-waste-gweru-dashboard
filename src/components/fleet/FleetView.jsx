import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import Icon from '../Icon';
import { fadeUp, spring, stagger } from '../../lib/motion';
import FleetList from './FleetList';
import RouteMap from './RouteMap';
import LoadOverview from './LoadOverview';
import VehicleInfo from './VehicleInfo';
import { StatusPill } from './Shared';
import { routesFor, suggestionFor, adjustedEta } from './fleetUtils';
import './fleet.css';

const LIVE_ID = 'GW-TRK-311';

export default function FleetView({ data }) {
  const reduce = useReducedMotion();
  const trucks = data?.trucks;
  const list = useMemo(() => trucks ?? [], [trucks]);
  const [selectedId, setSelectedId] = useState(
    () => (list.find((t) => t.id === LIVE_ID) || list[0] || {}).id,
  );
  const [applied, setApplied] = useState({});
  const [dismissed, setDismissed] = useState({});
  const [toast, setToast] = useState(null);
  const timer = useRef(null);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const truck = list.find((t) => t.id === selectedId) || list[0];

  const routes = useMemo(() => (truck ? routesFor(truck) : null), [truck]);
  const suggestion = useMemo(() => (truck ? suggestionFor(truck, data?.route) : null), [truck, data?.route]);

  if (!truck || !routes) return null;

  const isApplied = !!applied[truck.id];
  const coords = isApplied ? routes.optimized : routes.current;
  const eta = adjustedEta(truck, isApplied, suggestion.savedMin);
  const hasDriver = !!truck.driver;

  const flash = (msg) => {
    setToast(msg);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(null), 3200);
  };

  const container = stagger(0.07);

  return (
    <motion.main
      className="fv"
      variants={container}
      initial={reduce ? false : 'hidden'}
      animate="show"
      aria-label="Fleet"
    >
      <motion.div className="fv__list" variants={fadeUp}>
        <FleetList trucks={list} selectedId={truck.id} onSelect={setSelectedId} />
      </motion.div>

      <div className="fv__main">
        <motion.header className="card fv-head" variants={fadeUp}>
          <div className="fv-head__meta">
            <h1 className="fv-head__id tabular">{truck.id}</h1>
            <StatusPill status={truck.status} />
            <span className="fv-stat tabular">
              <Icon name="weight" size={16} /> {truck.loadKg.toLocaleString()} kg
            </span>
            <span className="fv-stat tabular">
              <Icon name="stops" size={16} /> {truck.stops} {truck.stops === 1 ? 'stop' : 'stops'}
            </span>
            <span className="fv-stat tabular">
              <Icon name="pin" size={16} /> {truck.distanceKm} km
            </span>
            <span className="fv-stat tabular">
              <span className="fv-muted">ETA</span> {eta}
            </span>
          </div>
          <div className="fv-head__actions">
            {hasDriver ? (
              <a className="fv-btn fv-btn--ghost" href={`tel:${truck.driver}`} aria-label={`Contact driver ${truck.driver}`}>
                <Icon name="phone" size={16} /> Contact driver
              </a>
            ) : (
              <button type="button" className="fv-btn fv-btn--ghost" disabled title="No driver assigned">
                <Icon name="phone" size={16} /> Contact driver
              </button>
            )}
            <button
              type="button"
              className="fv-btn fv-btn--primary"
              onClick={() => flash(`Route reassignment requested for ${truck.id}`)}
            >
              Reassign route
            </button>
          </div>
          <AnimatePresence>
            {toast ? (
              <motion.div
                key="toast"
                className="fv-toast"
                role="status"
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={spring}
              >
                {toast}
              </motion.div>
            ) : null}
          </AnimatePresence>
        </motion.header>

        <motion.div variants={fadeUp}>
          <RouteMap
            truck={truck}
            coords={coords}
            suggestion={suggestion}
            showSuggestion={!isApplied && !dismissed[truck.id]}
            onApply={() => {
              setApplied((a) => ({ ...a, [truck.id]: true }));
              flash('Optimized route applied');
            }}
            onDismiss={() => setDismissed((d) => ({ ...d, [truck.id]: true }))}
          />
        </motion.div>

        <div className="fv__bottom">
          <motion.div variants={fadeUp} className="fv__load">
            <LoadOverview truck={truck} />
          </motion.div>
          <motion.div variants={fadeUp} className="fv__info">
            <VehicleInfo truck={truck} />
          </motion.div>
        </div>
      </div>
    </motion.main>
  );
}
