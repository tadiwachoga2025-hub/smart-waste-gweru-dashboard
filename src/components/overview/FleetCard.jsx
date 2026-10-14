import { useEffect, useRef } from 'react';
import Icon from '../Icon.jsx';
import { gsap, ScrollTrigger } from '../../lib/useSmoothScroll';
import './left-panels.css';

const TICKS = 32;
const TICK_IDX = Array.from({ length: TICKS }, (_, i) => i);
const ICONS = { critical: 'hazard', high: 'bin', medium: 'bin', low: 'bin' };

export default function FleetCard({ metrics }) {
  const { bands = [], binsToCollect = 0 } = metrics || {};
  const root = useRef(null);
  const sig = bands.map((b) => b.pct).join(',');

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
  }, [sig]);

  return (
    <section className="card fc-card" ref={root} aria-label="Bins by fill level">
      <div className="card-head">
        <h2 className="card-title">Bins by fill level</h2>
        <div className="pc-head-right">
          <button type="button" className="card-expand" aria-label="Open fill level details">
            <Icon name="arrowUpRight" size={20} />
          </button>
        </div>
      </div>
      <ul className="fc-list">
        {bands.map((b) => {
          const filled = Math.round((b.pct / 100) * TICKS);
          return (
            <li className="fc-row" key={b.key} title={`${b.label} ${b.range}`}>
              <span className="fc-ico"><Icon name={ICONS[b.key] ?? 'bin'} size={24} strokeWidth={1.4} /></span>
              <span className="fc-label">
                {b.label} <span className="fc-range tabular">{b.range}</span>
              </span>
              <span className="fc-count tabular">{b.count}</span>
              <div
                className="fc-meter"
                data-tone={b.key === 'critical' ? 'critical' : undefined}
                role="img"
                aria-label={`${b.label} ${b.range}: ${b.count} ${b.count === 1 ? 'bin' : 'bins'}, ${b.pct}% of bins`}
              >
                {TICK_IDX.map((i) => (
                  <span key={i} className="fc-tick" data-on={i < filled ? '1' : '0'} />
                ))}
              </div>
              <span className="fc-pct tabular">{b.pct}%</span>
            </li>
          );
        })}
      </ul>
      <p className="fc-note tabular">
        Targeting {binsToCollect} {binsToCollect === 1 ? 'bin' : 'bins'} for collection
      </p>
    </section>
  );
}
