const TONE = { critical: 'critical', route: 'ok' };

export function StatusPill({ status, label }) {
  const tone = TONE[status] || 'muted';
  return (
    <span className={`fv-pill fv-pill--${tone}`}>
      <i className="fv-pill__dot" aria-hidden="true" />
      {label}
    </span>
  );
}
