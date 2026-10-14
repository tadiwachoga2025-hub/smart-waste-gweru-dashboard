import { useEffect, useMemo, useRef } from 'react';
import Icon from '../Icon.jsx';
import { useAnimatedNumber } from '../../lib/useAnimatedNumber';
import { gsap, ScrollTrigger } from '../../lib/useSmoothScroll';
import './left-panels.css';

const CH = 100; // chart viewBox height

// Smooth cubic path through points (Catmull-Rom -> Bezier).
function smoothPath(pts) {
  if (pts.length < 2) return '';
  let d = `M${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(2)} ${c1[1].toFixed(2)} ${c2[0].toFixed(2)} ${c2[1].toFixed(2)} ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`;
  }
  return d;
}

export default function FuelCard({ fuel, route }) {
  const {
    dieselTankPct = 0,
    petrolTankPct = 0,
    avgLitresPer100Km = 0,
    monthCostUsd = 0,
    changeVsLastMonthPct = 0,
    history = [],
    source,
  } = fuel || {};
  const root = useRef(null);
  const avg = useAnimatedNumber(avgLitresPer100Km, { decimals: 1 });

  const { heights, line, summary } = useMemo(() => {
    const vals = history.map((h) => h.litres);
    if (!vals.length) return { heights: [], line: '', summary: 'No fuel history available.' };
    const max = Math.max(...vals);
    const min = Math.min(...vals);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const hs = vals.map((v) => Math.max(0.12, v / max));
    const sm = vals.map((_, i) => {
      const w = vals.slice(Math.max(0, i - 2), i + 3);
      return w.reduce((a, b) => a + b, 0) / w.length;
    });
    const pts = sm.map((v, i) => [((i + 0.5) / vals.length) * 100, CH - (v / max) * CH * 0.78 - 6]);
    return {
      heights: hs,
      line: smoothPath(pts),
      summary: `Fuel use over the last ${vals.length} days: low ${min} L, high ${max} L, average ${mean.toFixed(0)} L per day.`,
    };
  }, [history]);

  useEffect(() => {
    const el = root.current;
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    const ctx = gsap.context(() => {
      gsap.from('.fu-bar', {
        scaleY: 0,
        duration: 0.7,
        ease: 'power3.out',
        stagger: 0.012,
        scrollTrigger: { trigger: el, start: 'top 90%', once: true },
      });
      gsap.from('.fu-line-path', {
        opacity: 0,
        duration: 0.8,
        delay: 0.4,
        scrollTrigger: { trigger: el, start: 'top 90%', once: true },
      });
    }, el);
    ScrollTrigger.refresh();
    return () => ctx.revert();
  }, [heights]);

  const change = `${changeVsLastMonthPct > 0 ? '+' : ''}${changeVsLastMonthPct}%`;

  return (
    <section className="card fu-card" ref={root} aria-label="Fuel usage and cost">
      <div className="card-head">
        <h2 className="card-title">Fuel Usage &amp; Cost</h2>
        <div className="pc-head-right">
          {source === 'demo' ? <span className="demo-tag">Demo</span> : null}
          <button type="button" className="card-expand" aria-label="Open fuel usage details">
            <Icon name="arrowUpRight" size={20} />
          </button>
        </div>
      </div>

      <div className="fu-stats">
        <div className="fu-side">
          <div><span className="fu-num tabular">{dieselTankPct}%</span><span className="fu-lab">Diesel</span></div>
          <div><span className="fu-num tabular">{petrolTankPct}%</span><span className="fu-lab">Petrol</span></div>
        </div>
        <div className="fu-center">
          <span className="fu-center-lab">Average Fuel Efficiency</span>
          <span className="fu-big tabular">{avg.toFixed(1)} L</span>
          <span className="fu-unit">per 100 km</span>
        </div>
        <div className="fu-side fu-side-r">
          <div><span className="fu-num tabular">${(monthCostUsd / 1000).toFixed(1)}k</span><span className="fu-lab">Total Cost</span></div>
          <div><span className="fu-num tabular">{change}</span><span className="fu-lab">Last month</span></div>
        </div>
      </div>

      {route && route.fuelLitres > 0 ? (
        <p className="fu-route tabular">Today&rsquo;s optimised route: {Number(route.fuelLitres).toFixed(1)} L</p>
      ) : null}

      <div className="fu-chart-wrap">
        <div className="fu-chart" role="img" aria-label={summary}>
          <div className="fu-bars" aria-hidden="true">
            {heights.map((h, i) => (
              <div className="fu-slot" key={i}>
                <div className="fu-bar" style={{ height: `${h * 100}%` }} />
              </div>
            ))}
          </div>
          <svg className="fu-line" viewBox={`0 0 100 ${CH}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
            <path
              className="fu-line-path"
              d={line}
              fill="none"
              stroke="var(--chart-line)"
              strokeWidth="2"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        </div>
        <div className="fu-axis" aria-hidden="true"><span>Sep</span><span>Oct</span></div>
      </div>
    </section>
  );
}
