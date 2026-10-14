import { useMemo, useRef, useState } from 'react';
import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import Icon from '../Icon.jsx';
import { useScrollReveal } from '../../lib/useSmoothScroll';
import './map-table.css';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'critical', label: 'Critical' },
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'assigned', label: 'Assigned' },
  { key: 'collected', label: 'Collected' },
];

const EMPTY = {
  all: 'No pickups to show yet.',
  critical: 'No bins are waiting on a truck right now.',
  scheduled: 'Nothing is scheduled beyond the current route.',
  assigned: 'No trucks are on a route at the moment.',
  collected: 'No bins have been collected yet today.',
};

// Phones show the first rows; the rest sit behind "Show all".
const MOBILE_ROWS = 5;

const pill = { type: 'spring', bounce: 0, duration: 0.32 };
const rowSpring = { type: 'spring', bounce: 0, duration: 0.2 };

function goToMap() {
  if (window.__lenis) window.__lenis.scrollTo('#map', { offset: -104 });
  else document.getElementById('map')?.scrollIntoView({ behavior: 'smooth' });
}

function Timeline() {
  return (
    <span className="pt-timeline" aria-hidden="true">
      <i className="pt-tl-ring" />
      <i className="pt-tl-line" />
      <i className="pt-tl-dot" />
    </span>
  );
}

export default function PickupsTable({ pickups, selectedId, onSelect }) {
  const [filter, setFilter] = useState('all');
  const [etaSort, setEtaSort] = useState('none');
  const [liveOnly, setLiveOnly] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const rootRef = useRef(null);

  const rows = useMemo(() => {
    let list = pickups.filter((p) => (filter === 'all' ? true : p.status === filter));
    if (liveOnly) list = list.filter((p) => p.source === 'live');
    if (etaSort !== 'none') {
      const dir = etaSort === 'asc' ? 1 : -1;
      list = [...list].sort((a, b) => (a.eta - b.eta) * dir);
    }
    return list;
  }, [pickups, filter, liveOnly, etaSort]);

  useScrollReveal(rootRef, 'tr[data-reveal]', [filter, liveOnly]);

  const cycleEta = () => setEtaSort((s) => (s === 'none' ? 'asc' : s === 'asc' ? 'desc' : 'none'));
  const etaLabel =
    etaSort === 'none' ? 'Sort by ETA' : etaSort === 'asc' ? 'Sorted by ETA, soonest first' : 'Sorted by ETA, latest first';

  const activate = (p) => {
    onSelect(p.binId);
    goToMap();
  };

  return (
    <div className={`card pt${expanded ? '' : ' is-collapsed'}`} ref={rootRef}>
      <div className="pt-head">
        <h2 className="card-title">Pickups</h2>
        <div className="pt-tools">
          <LayoutGroup id="pt-filter">
            <div className="pt-track" role="group" aria-label="Filter pickups by status">
              {FILTERS.map((f) => {
                const on = filter === f.key;
                return (
                  <button
                    key={f.key}
                    type="button"
                    className={`pt-seg${on ? ' is-on' : ''}`}
                    aria-pressed={on}
                    onClick={() => setFilter(f.key)}
                  >
                    {on && <motion.span layoutId="pt-seg-bg" className="pt-seg-bg" transition={pill} />}
                    <span className="pt-seg-label">{f.label}</span>
                  </button>
                );
              })}
            </div>
          </LayoutGroup>
          <button type="button" className="pt-icon" aria-pressed={etaSort !== 'none'} aria-label={etaLabel} title={etaLabel} onClick={cycleEta}>
            <Icon name="calendar" size={20} />
          </button>
          <button
            type="button"
            className="pt-icon"
            aria-pressed={liveOnly}
            aria-label="Live sensors only"
            title="Live sensors only"
            onClick={() => setLiveOnly((v) => !v)}
          >
            <Icon name="filter" size={20} />
          </button>
        </div>
      </div>

      <div className="pt-scroll" data-lenis-prevent>
      <table className="pt-table">
        <colgroup>
          <col style={{ width: '20%' }} />
          <col style={{ width: '17%' }} />
          <col style={{ width: '26%' }} />
          <col style={{ width: '10%' }} />
          <col style={{ width: '13%' }} />
          <col style={{ width: '14%' }} />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">Pickup ID</th>
            <th scope="col">Bin</th>
            <th scope="col">Route</th>
            <th scope="col">Est. load</th>
            <th scope="col">ETA</th>
            <th scope="col" className="pt-right">Status</th>
          </tr>
        </thead>
        <tbody>
          <AnimatePresence initial={false} mode="popLayout">
            {rows.map((p) => (
              <motion.tr
                key={p.id}
                data-reveal
                layout="position"
                exit={{ opacity: 0 }}
                transition={rowSpring}
                tabIndex={0}
                className={`pt-row${p.binId === selectedId ? ' is-selected' : ''}`}
                aria-label={`${p.code}, ${p.location}, ${p.statusLabel}`}
                aria-selected={p.binId === selectedId}
                onClick={() => activate(p)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    activate(p);
                  }
                }}
              >
                <td className="pt-c-id">
                  <span className="pt-id">
                    <Icon name={p.vehicle} size={34} strokeWidth={1.2} className="pt-vehicle" />
                    <span className="pt-code">{p.code}</span>
                    {p.source === 'live' && <span className="pt-live" title="Live sensor">Live sensor</span>}
                  </span>
                </td>
                <td className="pt-c-bin">
                  <span className="pt-main">{p.location}</span>
                  <span className="pt-sub">{p.wasteLabel}</span>
                </td>
                <td className="pt-c-route">
                  <Timeline />
                  <span className="pt-stops">
                    <span><span className="pt-main">{p.from.name},</span> <span className="pt-sub-i">{p.from.area}</span></span>
                    <span><span className="pt-main">{p.to.name},</span> <span className="pt-sub-i">{p.to.area}</span></span>
                  </span>
                </td>
                <td className="pt-c-load tabular">{p.weightKg.toLocaleString('en-GB')} kg</td>
                <td className="pt-c-eta tabular">{p.etaLabel}</td>
                <td className={`pt-c-status pt-right pt-st-${p.status}`}>{p.statusLabel}</td>
              </motion.tr>
            ))}
          </AnimatePresence>
        </tbody>
      </table>

      {rows.length === 0 && (
        <p className="pt-empty" role="status">
          <Icon name="truck" size={28} strokeWidth={1.3} />
          <span>{liveOnly && filter === 'all' ? 'No live sensor pickups right now.' : EMPTY[filter]}</span>
        </p>
      )}
      </div>
      {rows.length > MOBILE_ROWS && (
        <button type="button" className="pt-more" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
          {expanded ? 'Show fewer pickups' : `Show all ${rows.length} pickups`}
        </button>
      )}
    </div>
  );
}
