import { useEffect, useRef } from 'react';
import Icon from '../Icon.jsx';
import { useAnimatedNumber } from '../../lib/useAnimatedNumber';
import { gsap, ScrollTrigger } from '../../lib/useSmoothScroll';
import { ENGINE_RULES } from '../../data/useWasteData';
import './left-panels.css';

export default function FuelCard({ route }) {
  const { distanceKm = 0, fuelLitres = 0, trucks = 0, binsToCollect = 0, stops = [] } = route || {};
  const root = useRef(null);
  const fuel = useAnimatedNumber(fuelLitres, { decimals: 1 });
  const count = stops.length;

  useEffect(() => {
    const el = root.current;
    if (!el || !count || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    const ctx = gsap.context(() => {
      const trigger = { trigger: el, start: 'top 90%', once: true };
      gsap.from('.fu-line-fill', { scaleX: 0, duration: 0.8, ease: 'power3.out', transformOrigin: '0% 50%', scrollTrigger: trigger });
      gsap.from('.fu-node', { opacity: 0, y: 10, scale: 0.6, duration: 0.5, ease: 'power3.out', stagger: 0.1, scrollTrigger: trigger });
    }, el);
    ScrollTrigger.refresh();
    return () => ctx.revert();
  }, [count]);

  const summary = count
    ? `Route of ${count} ${count === 1 ? 'stop' : 'stops'}: ${stops
        .map((s, i) => `${s.bin?.location ?? `Stop ${i + 1}`}${s.bin ? ` at ${s.bin.fillLevel}%` : ''}`)
        .join(', then ')}.`
    : 'No active route. The AI engine has not flagged any bins.';

  return (
    <section className="card fu-card" ref={root} aria-label="Route and fuel">
      <div className="card-head">
        <h2 className="card-title">Route &amp; Fuel</h2>
        <div className="pc-head-right">
          <button type="button" className="card-expand" aria-label="Open route and fuel details">
            <Icon name="arrowUpRight" size={20} />
          </button>
        </div>
      </div>

      <div className="fu-stats">
        <div className="fu-side">
          <div><span className="fu-num tabular">{distanceKm} km</span><span className="fu-lab">Route distance</span></div>
          <div><span className="fu-num tabular">{trucks}</span><span className="fu-lab">Trucks</span></div>
        </div>
        <div className="fu-center">
          <span className="fu-center-lab">Estimated fuel</span>
          <span className="fu-big tabular">{fuel.toFixed(1)} L</span>
        </div>
        <div className="fu-side fu-side-r">
          <div><span className="fu-num tabular">{binsToCollect}</span><span className="fu-lab">Bins to collect</span></div>
          <div><span className="fu-num tabular">{ENGINE_RULES.litresPerKm} L/km</span><span className="fu-lab">Engine rate</span></div>
        </div>
      </div>

      <div className="fu-chart-wrap">
        <p className="fu-sr">{summary}</p>
        {count ? (
          <>
            <div className="fu-strip" aria-hidden="true">
              <div className="fu-line"><span className="fu-line-fill" /></div>
              <ol className="fu-nodes">
                {stops.map((s, i) => (
                  <li className="fu-node" key={s.order}>
                    <span className="fu-dot" />
                    <span className="fu-node-name">{s.bin?.location ?? `Stop ${i + 1}`}</span>
                    {s.bin ? <span className="fu-node-sub tabular">{s.bin.fillLevel}%</span> : null}
                  </li>
                ))}
              </ol>
            </div>
            <div className="fu-axis" aria-hidden="true"><span>Route start</span><span>Last stop</span></div>
          </>
        ) : (
          <p className="fu-empty">No active route &mdash; the AI engine hasn&rsquo;t flagged any bins.</p>
        )}
      </div>
    </section>
  );
}
