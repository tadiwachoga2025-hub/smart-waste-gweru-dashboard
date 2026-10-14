import { useMemo, useRef, useState } from 'react';
import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import Icon from '../Icon.jsx';
import { useScrollReveal } from '../../lib/useSmoothScroll';
import './map-table.css';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'critical', label: 'Critical' },
  { key: 'route', label: 'On route' },
  { key: 'due', label: 'Due soon' },
  { key: 'normal', label: 'Normal' },
];

const EMPTY = {
  all: 'No bins in the database yet. Readings appear here as soon as a sensor reports.',
  critical: 'No bins are critical right now.',
  route: 'No bins are on the active route.',
  due: 'No bins are due soon.',
  normal: 'No bins are in the normal range.',
};

// Phones show the first rows; the rest sit behind "Show all".
const MOBILE_ROWS = 5;

const pill = { type: 'spring', bounce: 0, duration: 0.32 };
const rowSpring = { type: 'spring', bounce: 0, duration: 0.2 };

function goToMap() {
  if (window.__lenis) window.__lenis.scrollTo('#map', { offset: -104 });
  else document.getElementById('map')?.scrollIntoView({ behavior: 'smooth' });
}

const fillSpring = { type: 'spring', bounce: 0, duration: 0.9 };

// "Full in 19 hours" -> 19, "Critical Now" -> 0, anything else sorts last.
function hoursUntilFull(prediction) {
  const text = String(prediction ?? '');
  if (/critical now/i.test(text)) return 0;
  const m = text.match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : Infinity;
}

const NEXT_SORT = { none: 'high', high: 'low', low: 'none' };

export default function PickupsTable({ bins, selectedId, onSelect }) {
  const [filter, setFilter] = useState('all');
  const [fillSort, setFillSort] = useState('none');
  const [soonSort, setSoonSort] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const rootRef = useRef(null);

  const rows = useMemo(() => {
    let list = bins.filter((b) => (filter === 'all' ? true : b.status === filter));
    if (soonSort) {
      list = [...list].sort((a, b) => hoursUntilFull(a.prediction) - hoursUntilFull(b.prediction));
    } else if (fillSort !== 'none') {
      const dir = fillSort === 'high' ? -1 : 1;
      list = [...list].sort((a, b) => (a.fillLevel - b.fillLevel) * dir);
    }
    return list;
  }, [bins, filter, fillSort, soonSort]);

  const critical = useMemo(() => bins.filter((b) => b.fillLevel >= 90).length, [bins]);

  useScrollReveal(rootRef, 'tr[data-reveal]', [filter]);

  const fillLabel =
    fillSort === 'none' ? 'Sort by fill level' : fillSort === 'high' ? 'Sorted by fill level, highest first' : 'Sorted by fill level, lowest first';
  const soonLabel = soonSort ? 'Sorted by soonest predicted full' : 'Sort by soonest predicted full';

  const cycleFill = () => {
    setFillSort((s) => NEXT_SORT[s]);
    setSoonSort(false);
  };
  const toggleSoon = () => {
    setSoonSort((v) => !v);
    setFillSort('none');
  };

  const activate = (p) => {
    onSelect(p.id);
    goToMap();
  };

  return (
    <div className={`card pt${expanded ? '' : ' is-collapsed'}`} ref={rootRef}>
      <div className="pt-head">
        <div className="pt-title">
          <h2 className="card-title">Live Bin Monitor</h2>
          <span className="pt-chip">Targeting <span className="tabular">{critical}</span> critical {critical === 1 ? 'bin' : 'bins'}</span>
        </div>
        <div className="pt-tools">
          <LayoutGroup id="pt-filter">
            <div className="pt-track" role="group" aria-label="Filter bins by status">
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
          <button type="button" className="pt-icon" aria-pressed={fillSort !== 'none'} aria-label={fillLabel} title={fillLabel} onClick={cycleFill}>
            <Icon name="filter" size={20} />
          </button>
          <button type="button" className="pt-icon" aria-pressed={soonSort} aria-label={soonLabel} title={soonLabel} onClick={toggleSoon}>
            <Icon name="calendar" size={20} />
          </button>
        </div>
      </div>

      <div className="pt-scroll" data-lenis-prevent>
      <table className="pt-table">
        <colgroup>
          <col style={{ width: '17%' }} />
          <col style={{ width: '24%' }} />
          <col style={{ width: '25%' }} />
          <col style={{ width: '19%' }} />
          <col style={{ width: '15%' }} />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">Bin ID</th>
            <th scope="col">Location</th>
            <th scope="col">Fill level</th>
            <th scope="col">AI prediction</th>
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
                className={`pt-row${p.id === selectedId ? ' is-selected' : ''}`}
                aria-label={`${p.code}, ${p.location}, ${Math.round(p.fillLevel)}% full, ${p.statusLabel}`}
                aria-selected={p.id === selectedId}
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
                    <Icon name="bin" size={30} strokeWidth={1.3} className="pt-vehicle" />
                    <span className="pt-code">{p.code}</span>
                  </span>
                </td>
                <td className="pt-c-bin">
                  <span className="pt-main">{p.location}</span>
                  <span className="pt-sub">{p.lastUpdated}</span>
                </td>
                <td className="pt-c-fill">
                  <span className="pt-fill">
                    <span className="pt-bar" aria-hidden="true">
                      <motion.span
                        className={`pt-bar-fill is-${p.tone}`}
                        initial={{ width: 0 }}
                        animate={{ width: `${Math.max(0, Math.min(100, p.fillLevel))}%` }}
                        transition={fillSpring}
                      />
                    </span>
                    <span className="pt-pct tabular">{Math.round(p.fillLevel)}%</span>
                  </span>
                </td>
                <td className={`pt-c-pred${p.prediction === 'Critical Now' ? ' is-critical' : ''}`}>{p.prediction}</td>
                <td className={`pt-c-status pt-right pt-st-${p.status}`}>{p.statusLabel}</td>
              </motion.tr>
            ))}
          </AnimatePresence>
        </tbody>
      </table>

      {rows.length === 0 && (
        <p className="pt-empty" role="status">
          <Icon name="bin" size={28} strokeWidth={1.3} />
          <span>{bins.length === 0 ? EMPTY.all : EMPTY[filter]}</span>
        </p>
      )}
      </div>
      {rows.length > MOBILE_ROWS && (
        <button type="button" className="pt-more" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
          {expanded ? 'Show fewer bins' : `Show all ${rows.length} bins`}
        </button>
      )}
    </div>
  );
}
