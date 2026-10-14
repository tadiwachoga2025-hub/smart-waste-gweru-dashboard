import { useEffect, useRef } from 'react';
import Icon from '../Icon.jsx';
import { gsap, ScrollTrigger } from '../../lib/useSmoothScroll';
import './left-panels.css';

const TICKS = 32;
const TICK_IDX = Array.from({ length: TICKS }, (_, i) => i);

export default function FleetCard({ fleet }) {
  const { types = [], source } = fleet || {};
  const root = useRef(null);

  useEffect(() => {
    const el = root.current;
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    const ctx = gsap.context(() => {
      el.querySelectorAll('.fc-meter').forEach((meter, r) => {
        const on = meter.querySelectorAll('.fc-tick[data-on="1"]');
        if (!on.length) return;
        gsap.from(on, {
          opacity: 0.15,
          scaleY: 0.35,
          duration: 0.4,
          ease: 'power2.out',
          stagger: 0.018,
          delay: r * 0.07,
          scrollTrigger: { trigger: el, start: 'top 90%', once: true },
        });
      });
    }, el);
    ScrollTrigger.refresh();
    return () => ctx.revert();
  }, [types]);

  return (
    <section className="card fc-card" ref={root} aria-label="Fleet distribution by type">
      <div className="card-head">
        <h2 className="card-title">Fleet distribution by type</h2>
        <div className="pc-head-right">
          {source === 'demo' ? <span className="demo-tag">Demo</span> : null}
          <button type="button" className="card-expand" aria-label="Open fleet distribution details">
            <Icon name="arrowUpRight" size={20} />
          </button>
        </div>
      </div>
      <ul className="fc-list">
        {types.map((t) => {
          const pct = Math.round(t.pct ?? (t.total ? (t.deployed / t.total) * 100 : 0));
          const filled = Math.round((pct / 100) * TICKS);
          return (
            <li className="fc-row" key={t.key}>
              <span className="fc-ico"><Icon name={t.icon} size={24} strokeWidth={1.4} /></span>
              <span className="fc-label">{t.label}</span>
              <span className="fc-count tabular">{t.total}</span>
              <div
                className="fc-meter"
                role="img"
                aria-label={`${t.label}: ${t.deployed} of ${t.total} deployed, ${pct}%`}
              >
                {TICK_IDX.map((i) => (
                  <span key={i} className="fc-tick" data-on={i < filled ? '1' : '0'} />
                ))}
              </div>
              <span className="fc-pct tabular">{pct}%</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
