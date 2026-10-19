// Reports charts, built on Recharts and the design tokens. Colours come from
// CSS variables so light/dark appearances follow automatically; every chart
// keeps a text equivalent (visible peak/legend plus a screen-reader table) so
// colour is never the only signal. Entrance animation is disabled under
// prefers-reduced-motion.

import { useId } from 'react';
import { useReducedMotion } from 'motion/react';
import {
  Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts';

const TONE_VAR = {
  critical: 'var(--s-critical)',
  warning: 'var(--s-warning)',
  ok: 'var(--s-ok)',
  info: 'var(--s-info)',
  muted: 'var(--t-tertiary)',
};

const tickStyle = { fill: 'var(--t-tertiary)', fontSize: 12 };

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

/** Token-styled tooltip shared by every chart. */
function ChartTip({ active, payload, label, unit = '', suffix = '' }) {
  if (!active || !payload?.length) return null;
  const row = payload[0];
  const name = label ?? row?.name ?? '';
  const share = typeof row?.percent === 'number' ? ` · ${Math.round(row.percent * 100)}%` : suffix;
  return (
    <div className="rp-tip">
      {name ? <span className="rp-tip__label">{name}</span> : null}
      <span className="rp-tip__val tabular">{row?.value}{unit}{share}</span>
    </div>
  );
}

/**
 * Vertical bars with gridlines, labelled axis and hover tooltips.
 * data: [{ label, value }]. Same signature as before, so callers don't change.
 */
export function BarSeries({ data, label, unit = '', height = 220 }) {
  const uid = useId();
  const reduce = useReducedMotion();
  const rows = Array.isArray(data) ? data : [];
  const max = Math.max(1, ...rows.map((d) => d.value));
  const total = rows.reduce((s, d) => s + d.value, 0);
  return (
    <figure className="rp-fig" aria-label={label}>
      <div className="rp-fig__peak" aria-hidden="true">Peak {max}{unit} · total {total}{unit}</div>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={rows} margin={{ top: 4, right: 4, bottom: 0, left: -14 }} role="img" aria-label={`${label}. Total ${total}${unit}. Details in the table below.`} aria-describedby={uid}>
          <CartesianGrid vertical={false} stroke="var(--line-strong)" strokeDasharray="3 5" />
          <XAxis dataKey="label" tick={tickStyle} tickLine={false} axisLine={{ stroke: 'var(--line-strong)' }} interval="preserveStartEnd" minTickGap={28} />
          <YAxis tick={tickStyle} tickLine={false} axisLine={false} allowDecimals={false} width={42} />
          <Tooltip content={<ChartTip unit={unit} />} cursor={{ fill: 'var(--c-surface-2)' }} />
          <Bar
            dataKey="value"
            fill="var(--chart-bar)"
            radius={[6, 6, 2, 2]}
            maxBarSize={44}
            isAnimationActive={!reduce}
            animationDuration={700}
            animationEasing="ease-out"
          />
        </BarChart>
      </ResponsiveContainer>
      <DataTable id={uid} caption={label} head={['Period', `Value${unit ? ` (${unit.trim()})` : ''}`]} rows={rows.map((d) => [d.label, d.value])} />
    </figure>
  );
}

/**
 * Part-to-whole as a donut with a visible legend carrying the name, count
 * and percentage of every part. parts: [{ key, label, value, tone, range? }]
 */
export function DonutOrStackedBar({ parts, label }) {
  const uid = useId();
  const reduce = useReducedMotion();
  const rows = (Array.isArray(parts) ? parts : []).map((p) => ({ ...p, fill: TONE_VAR[p.tone] ?? TONE_VAR.muted }));
  const total = rows.reduce((s, p) => s + p.value, 0);
  const pct = (v) => (total ? Math.round((v / total) * 100) : 0);
  return (
    <figure className="rp-fig" aria-label={label}>
      <ResponsiveContainer width="100%" height={168}>
        <PieChart role="img" aria-label={`${label}. ${rows.map((p) => `${p.label} ${p.value}`).join(', ')}.`} aria-describedby={uid}>
          <Tooltip content={<ChartTip />} cursor={false} />
          <Pie
            data={rows}
            dataKey="value"
            nameKey="label"
            innerRadius="64%"
            outerRadius="88%"
            paddingAngle={total > 0 ? 3 : 0}
            cornerRadius={5}
            strokeWidth={0}
            isAnimationActive={!reduce}
            animationDuration={700}
            animationEasing="ease-out"
          >
            {rows.map((p) => (
              <Cell key={p.key} fill={p.fill} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <ul className="rp-legend">
        {rows.map((p) => (
          <li key={p.key}>
            <i aria-hidden="true" style={{ background: p.fill }} />
            <span className="rp-legend__name">{p.label}{p.range ? <small> {p.range}</small> : null}</span>
            <span className="rp-legend__val tabular">{p.value} · {pct(p.value)}%</span>
          </li>
        ))}
      </ul>
      <DataTable id={uid} caption={label} head={['Group', 'Count', 'Share']} rows={rows.map((p) => [p.label, p.value, `${pct(p.value)}%`])} />
    </figure>
  );
}

/** Small trend line. points: [{ label, value }]. Still dependency-free. */
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
