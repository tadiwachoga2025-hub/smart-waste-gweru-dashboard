// Tiny dependency-free SVG charts for Reports. Everything is drawn from tokens
// (CSS variables), scales with its container (viewBox, no pixel widths), and
// ships a real table alternative (visually hidden) plus visible text labels so
// colour is never the only signal.

import { useId } from 'react';

const TONE_VAR = {
  critical: 'var(--s-critical)',
  warning: 'var(--s-warning)',
  ok: 'var(--s-ok)',
  info: 'var(--s-info)',
  muted: 'var(--t-tertiary)',
};

function DataTable({ caption, head, rows, id }) {
  return (
    <table className="sr-only" id={id}>
      <caption>{caption}</caption>
      <thead>
        <tr>{head.map((h) => <th key={h} scope="col">{h}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r[0]}>
            {r.map((c, i) => (i === 0 ? <th key={i} scope="row">{c}</th> : <td key={i}>{c}</td>))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Vertical bars. data: [{ label, value }]. Axis text shows the first and last
 * label and the peak value; the full series is in the table alternative.
 */
export function BarSeries({ data, label, unit = '', height = 120 }) {
  const uid = useId();
  const max = Math.max(1, ...data.map((d) => d.value));
  const n = Math.max(1, data.length);
  const slot = 100 / n;
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <figure className="rp-fig" aria-label={label}>
      <div className="rp-fig__peak" aria-hidden="true">Peak {max}{unit}</div>
      <svg
        className="rp-svg"
        viewBox={`0 0 100 ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${label}. Total ${total}${unit}. Details in the table below.`}
        aria-describedby={uid}
        style={{ height }}
      >
        <line x1="0" x2="100" y1={height - 0.5} y2={height - 0.5} className="rp-axis" vectorEffect="non-scaling-stroke" />
        {data.map((d, i) => {
          const h = d.value > 0 ? Math.max(2, (d.value / max) * (height - 4)) : 0;
          return (
            <rect
              key={d.label}
              x={i * slot + slot * 0.15}
              width={slot * 0.7}
              y={height - 1 - h}
              height={h}
              style={{ fill: 'var(--chart-bar)' }}
            >
              <title>{`${d.label}: ${d.value}${unit}`}</title>
            </rect>
          );
        })}
      </svg>
      <div className="rp-fig__axis" aria-hidden="true">
        <span>{data[0]?.label}</span>
        <span>{data[data.length - 1]?.label}</span>
      </div>
      <DataTable id={uid} caption={label} head={['Period', `Value${unit ? ` (${unit.trim()})` : ''}`]} rows={data.map((d) => [d.label, d.value])} />
    </figure>
  );
}

/**
 * Part-to-whole as one stacked bar with a visible legend that carries the
 * name, count and percentage of every part. parts: [{ key, label, value, tone }]
 */
export function DonutOrStackedBar({ parts, label }) {
  const uid = useId();
  const total = parts.reduce((s, p) => s + p.value, 0);
  const pct = (v) => (total ? Math.round((v / total) * 100) : 0);
  let x = 0;
  return (
    <figure className="rp-fig" aria-label={label}>
      <svg
        className="rp-svg rp-svg--stack"
        viewBox="0 0 100 10"
        preserveAspectRatio="none"
        role="img"
        aria-label={`${label}. ${parts.map((p) => `${p.label} ${p.value}`).join(', ')}.`}
        aria-describedby={uid}
      >
        <rect x="0" y="0" width="100" height="10" style={{ fill: 'var(--c-surface-3)' }} />
        {total > 0 && parts.map((p) => {
          const w = (p.value / total) * 100;
          const seg = (
            <rect key={p.key} x={x} y="0" width={w} height="10" style={{ fill: TONE_VAR[p.tone] ?? TONE_VAR.muted, stroke: 'var(--c-surface)', strokeWidth: 0.6 }} vectorEffect="non-scaling-stroke">
              <title>{`${p.label}: ${p.value} (${pct(p.value)}%)`}</title>
            </rect>
          );
          x += w;
          return seg;
        })}
      </svg>
      <ul className="rp-legend">
        {parts.map((p) => (
          <li key={p.key}>
            <i aria-hidden="true" style={{ background: TONE_VAR[p.tone] ?? TONE_VAR.muted }} />
            <span className="rp-legend__name">{p.label}{p.range ? <small> {p.range}</small> : null}</span>
            <span className="rp-legend__val">{p.value} · {pct(p.value)}%</span>
          </li>
        ))}
      </ul>
      <DataTable id={uid} caption={label} head={['Group', 'Count', 'Share']} rows={parts.map((p) => [p.label, p.value, `${pct(p.value)}%`])} />
    </figure>
  );
}

/** Small trend line. points: [{ label, value }]. */
export function Sparkline({ points, label, height = 48 }) {
  const uid = useId();
  const max = Math.max(1, ...points.map((p) => p.value));
  const n = points.length;
  const coords = points.map((p, i) => [n === 1 ? 50 : (i / (n - 1)) * 100, height - 3 - (p.value / max) * (height - 6)]);
  const d = coords.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`).join(' ');
  return (
    <figure className="rp-fig" aria-label={label}>
      <svg
        className="rp-svg"
        viewBox={`0 0 100 ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${label}. Peak ${max}.`}
        aria-describedby={uid}
        style={{ height }}
      >
        {n > 0 && <path d={d} fill="none" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" style={{ stroke: 'var(--chart-line)' }} />}
      </svg>
      <div className="rp-fig__axis" aria-hidden="true">
        <span>{points[0]?.label}</span>
        <span>Peak {max}</span>
        <span>{points[n - 1]?.label}</span>
      </div>
      <DataTable id={uid} caption={label} head={['Period', 'Value']} rows={points.map((p) => [p.label, p.value])} />
    </figure>
  );
}
