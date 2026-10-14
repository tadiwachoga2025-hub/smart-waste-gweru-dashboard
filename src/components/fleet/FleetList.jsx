import { useState } from 'react';
import { motion } from 'motion/react';
import Icon from '../Icon';
import { spring } from '../../lib/motion';
import { StatusPill, TruckArt } from './Shared';

const TICKS = Array.from({ length: 40 }, (_, i) => i);

function Card({ truck, selected, onSelect }) {
  const pos = `${Math.round(truck.progress * 100)}%`;
  const filledTicks = Math.round(truck.progress * 40);
  return (
    <li className="fv-list__item">
      <button
        type="button"
        className={`fv-card${selected ? ' is-sel' : ''}`}
        aria-pressed={selected}
        aria-label={`${truck.id}, ${truck.from} to ${truck.to}`}
        onClick={() => onSelect(truck.id)}
      >
        {selected ? <motion.span layoutId="fv-sel-bg" className="fv-card__bg" transition={spring} /> : null}
        <span className="fv-card__top">
          <span className="fv-card__id">
            <span className="fv-card__code tabular">{truck.id}</span>
            <StatusPill status={truck.status} />
          </span>
          <TruckArt type={truck.type} />
        </span>
        <span className="fv-card__route">
          <span>{truck.from}</span>
          <span>{truck.to}</span>
        </span>
        <span className="fv-track" aria-hidden="true">
          {TICKS.map((i) => (
            <i key={i} className={i < filledTicks ? 'on' : ''} />
          ))}
          <b className="fv-track__marker" style={{ left: pos }} />
        </span>
        <span className="fv-card__dates tabular">
          <span>{truck.departed}</span>
          <span>{truck.eta}</span>
        </span>
      </button>
    </li>
  );
}

export default function FleetList({ trucks, selectedId, onSelect }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const shown = needle
    ? trucks.filter((t) => [t.id, t.from, t.to].some((s) => s.toLowerCase().includes(needle)))
    : trucks;

  return (
    <section className="card fv-fleet" aria-label="Fleet">
      <div className="fv-fleet__head">
        <h2 className="card-title">Fleet</h2>
        <div className="fv-fleet__tools">
          <span className="fv-muted tabular">{shown.length} vehicles</span>
          <button
            type="button"
            className="card-expand fv-search-btn"
            aria-label={open ? 'Close vehicle filter' : 'Filter vehicles'}
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
            placeholder="Filter by ID, origin or destination"
            aria-label="Filter vehicles"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      ) : null}
      <ul className="fv-list" data-lenis-prevent>
        {shown.map((t) => (
          <Card key={t.id} truck={t} selected={t.id === selectedId} onSelect={onSelect} />
        ))}
        {shown.length === 0 ? <li className="fv-empty">No vehicles match.</li> : null}
      </ul>
    </section>
  );
}
