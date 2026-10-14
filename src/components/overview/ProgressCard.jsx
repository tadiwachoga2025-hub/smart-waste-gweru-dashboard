import { useEffect } from 'react';
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from 'motion/react';
import Icon from '../Icon.jsx';
import binsBg from '../../assets/bins-dark.jpg';
import './left-panels.css';

const W = 400;
const H = 64;
const END_Y = 50;
const DIP = 64; // apex rise: y = END_Y - DIP * t * (1 - t)
const arcY = (t) => END_Y - DIP * t * (1 - t);
const ARC = `M0 ${END_Y} Q${W / 2} ${END_Y - DIP / 2} ${W} ${END_Y}`;
const fmt = (n) => Number(n).toLocaleString('en-US');

export default function ProgressCard({ metrics }) {
  const { activeBins = 0, trucksAllocated = 0, routeDistanceKm = 0, criticalBins = 0, avgFill = 0 } = metrics || {};
  const pct = activeBins > 0 ? avgFill : 0;
  const chips = [
    { key: 'bins', icon: 'bin', label: 'Active bins', value: fmt(activeBins) },
    { key: 'trucks', icon: 'truck', label: 'Trucks allocated', value: fmt(trucksAllocated) },
    { key: 'route', icon: 'route', label: 'Optimised route', value: `${fmt(routeDistanceKm)} km` },
    { key: 'full', icon: 'hazard', label: 'Full bins', value: fmt(criticalBins), critical: criticalBins > 0 },
  ];
  const reduce = useReducedMotion();
  const target = Math.min(100, Math.max(0, pct)) / 100;
  const t = useMotionValue(0);
  const left = useTransform(t, (v) => `${v * 100}%`);
  const top = useTransform(t, (v) => `${(arcY(v) / H) * 100}%`);
  const label = useTransform(t, (v) => `${Math.round(v * 100)}%`);

  useEffect(() => {
    if (reduce) {
      t.set(target);
      return undefined;
    }
    const controls = animate(t, target, { type: 'spring', bounce: 0.12, duration: 1.3, delay: 0.3 });
    return () => controls.stop();
  }, [target, reduce, t]);

  return (
    <section className="card pc-card" aria-label="Network fill level">
      <div className="card-head">
        <h2 className="card-title">Network Fill Level</h2>
        <div className="pc-head-right">
          <button type="button" className="card-expand" aria-label="Open network fill level details">
            <Icon name="arrowUpRight" size={20} />
          </button>
        </div>
      </div>

      <div className="pc-media">
        <img className="pc-img" src={binsBg} alt="" loading="lazy" decoding="async" />
        {chips.map((c, i) => (
          <motion.div
            key={c.key}
            className="pc-chip"
            data-i={i}
            initial={reduce ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: 'spring', bounce: 0, duration: 0.6, delay: 0.1 + i * 0.09 }}
            whileHover={reduce ? undefined : { y: -3 }}
          >
            <Icon name={c.icon} size={18} />
            <span>
              {c.label}{' '}
              <span className={`pc-chip-val tabular${c.critical ? ' is-critical' : ''}`}>{c.value}</span>
            </span>
          </motion.div>
        ))}

        <div className="pc-gauge">
          <span className="pc-end pc-end-l tabular">0%</span>
          <span className="pc-end pc-end-r tabular">100%</span>
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
            <defs>
              <linearGradient id="pc-grad" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={W} y2="0">
                <stop offset="0" stopColor="#d9837a" />
                <stop offset="0.35" stopColor="#d8b58a" />
                <stop offset="0.65" stopColor="#c9cf8e" />
                <stop offset="1" stopColor="#9fcf86" />
              </linearGradient>
            </defs>
            <path d={ARC} fill="none" stroke="url(#pc-grad)" strokeWidth="3" strokeLinecap="round" opacity="0.4" vectorEffect="non-scaling-stroke" />
            <motion.path
              d={ARC}
              fill="none"
              stroke="url(#pc-grad)"
              strokeWidth="3"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              style={{ pathLength: t }}
            />
          </svg>
          <motion.div className="pc-knob" style={{ left, top }} aria-hidden="true" />
          <motion.div className="pc-tip tabular" style={{ left, top }} aria-hidden="true">
            <motion.span>{label}</motion.span>
          </motion.div>
        </div>

        <p className="pc-caption tabular">
          {activeBins > 0 ? (
            <>
              Average fill <b>{avgFill}%</b> across <b>{fmt(activeBins)}</b> {activeBins === 1 ? 'bin' : 'bins'}
            </>
          ) : (
            'No bins reporting yet'
          )}
        </p>
      </div>
    </section>
  );
}
