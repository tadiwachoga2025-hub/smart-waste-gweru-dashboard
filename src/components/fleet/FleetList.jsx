import { useState } from 'react';
import { motion } from 'motion/react';
import Icon from '../Icon';
import { spring } from '../../lib/motion';
import { StatusPill } from './Shared';

const TICKS = Array.from({ length: 40 }, (_, i) => i);

function Card({ bin, selected, onSelect }) {
  const fill = Math.max(0, Math.min(100, bin.fillLevel));
  const filledTicks = Math.round((fill / 100) * 40);
  return (
    <li className="fv-list__item">
      <button
        type="button"
        className={`fv-card${selected ? ' is-sel' : ''}`}
        aria-pressed={selected}
        aria-label={`${bin.location}, ${bin.fillLevel}% full, ${bin.statusLabel}`}
        onClick={() => onSelect(bin.id)}
      >
        {selected ? <motion.span layoutId="fv-sel-bg" className="fv-card__bg" transition={spring} /> : null}
        <span className="fv-card__top">
          <span className="fv-card__id">
            <span className="fv-card__code">{bin.location}</span>
            <StatusPill status={bin.status} label={bin.statusLabel} />
          </span>
          {bin.onRoute ? <span className="fv-stopbadge tabular">Stop {bin.routeOrder + 1}</span> : null}
        </span>
        <span className="fv-card__sub tabular">{bin.code}</span>
        <span className="fv-track" aria-hidden="true">
          {TICKS.map((i) => (
            <i key={i} className={i < filledTicks ? 'on' : ''} />
          ))}
          <b className="fv-track__marker" style={{ left: `${fill}%` }} />
        </span>
        <span className="fv-card__dates tabular">
          <span>0%</span>
          <span>{fill >= 100 ? 'Full' : `${bin.fillLevel}%`}</span>
        </span>
        <span className="fv-card__pred">{bin.prediction}</span>
      </button>
    </li>
  );
}

export default function FleetList({ bins, selectedId, onSelect }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const shown = needle
    ? bins.filter((b) => [b.location, b.code, b.statusLabel].some((s) => String(s).toLowerCase().includes(needle)))
    : bins;

  return (
    <section className="card fv-fleet" aria-label="Bins">
      <div className="fv-fleet__head">
        <h2 className="card-title">Bins</h2>
        <div className="fv-fleet__tools">
          <span className="fv-muted tabular">{shown.length}</span>
          <button
            type="button"
            className="card-expand fv-search-btn"
            aria-label={open ? 'Close bin filter' : 'Filter bins'}
            aria-expanded={open}
            onClick={() => {
              setOpen((o) => !o);
              setQ('');
            }}
          >
            <Icon name={open ? 'close' : 'search'} size={18} />
          </button>
        </div>
      </div>
      {open ? (
        <div className="fv-fleet__filter">
          <input
            autoFocus
            type="search"
            className="fv-input"
            placeholder="Filter by location, code or status"
            aria-label="Filter bins"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      ) : null}
      <ul className="fv-list" data-lenis-prevent>
        {shown.map((b) => (
          <Card key={b.id} bin={b} selected={b.id === selectedId} onSelect={onSelect} />
        ))}
        {shown.length === 0 ? <li className="fv-empty">{bins.length ? 'No bins match.' : 'No bins reported yet.'}</li> : null}
      </ul>
    </section>
  );
}
