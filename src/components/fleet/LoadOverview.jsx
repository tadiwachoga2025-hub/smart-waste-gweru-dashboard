import { useEffect, useMemo, useRef } from 'react';
import gsap from 'gsap';
import { useReducedMotion } from 'motion/react';
import Icon from '../Icon';
import { useAnimatedNumber } from '../../lib/useAnimatedNumber';
import { buildSlots } from './fleetUtils';

export default function LoadOverview({ truck }) {
  const reduce = useReducedMotion();
  const gridRef = useRef(null);
  const slots = useMemo(() => buildSlots(truck), [truck]);
  const flagged = slots.find((s) => s.flagged);
  const used = slots.filter((s) => !s.empty).length;
  const capPct = Math.round((truck.loadKg / truck.capacityKg) * 100);
  const kg = useAnimatedNumber(truck.loadKg);

  useEffect(() => {
    if (reduce || !gridRef.current) return undefined;
    const ctx = gsap.context(() => {
      gsap.from('.fv-slot', { opacity: 0, y: 10, scale: 0.96, duration: 0.45, ease: 'power3.out', stagger: 0.035 });
    }, gridRef);
    return () => ctx.revert();
  }, [truck.id, reduce]);

  return (
    <section className="card fv-load" aria-label="Load overview">
      <div className="card-head fv-load__head">
        <div className="fv-load__title">
          <h2 className="card-title">Load overview</h2>
          {flagged ? (
            <span className="fv-alert-pill">
              <Icon name="stops" size={13} /> {flagged.id} · hazardous seal open
            </span>
          ) : null}
        </div>
        <button type="button" className="card-expand" aria-label="More load options">
          <Icon name="more" size={18} />
        </button>
      </div>
      <dl className="fv-stats tabular">
        <div>
          <dt>Total load</dt>
          <dd>{kg.toLocaleString()} kg</dd>
        </div>
        <div>
          <dt>Capacity</dt>
          <dd>{capPct}%</dd>
        </div>
        <div>
          <dt>Slots used</dt>
          <dd>
            {used}/12
          </dd>
        </div>
        <div>
          <dt>Alerts</dt>
          <dd>{flagged ? '1 · seal' : '0'}</dd>
        </div>
      </dl>
      <div className="fv-trailer">
        <div className="fv-trailer__box" ref={gridRef}>
          <ul className="fv-slots" aria-label="Trailer compartments">
            {slots.map((s) => (
              <li
                key={s.id}
                className={`fv-slot${s.empty ? ' is-empty' : ''}${s.flagged ? ' is-flag' : ''}`}
              >
                {s.empty ? (
                  <button type="button" className="fv-slot__add" aria-label={`Assign load to ${s.id}`}>
                    <Icon name="plus" size={14} />
                  </button>
                ) : (
                  <>
                    <span className="fv-slot__id tabular">{s.id}</span>
                    <span className="fv-slot__kg tabular">{s.kg}kg</span>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
        <div className="fv-trailer__chassis" aria-hidden="true">
          <i className="fv-wheel" />
          <i className="fv-wheel" />
          <i className="fv-wheel fv-wheel--cab" />
        </div>
      </div>
    </section>
  );
}
