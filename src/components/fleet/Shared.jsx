import { STATUS } from './fleetUtils';

export function StatusPill({ status }) {
  const s = STATUS[status] || STATUS.awaiting;
  return (
    <span className={`fv-pill fv-pill--${s.tone}`}>
      <i className="fv-pill__dot" aria-hidden="true" />
      {s.label}
    </span>
  );
}

// Simple side-view truck illustration. Cream body, dark wheels.
export function TruckArt({ type }) {
  const pickup = type === 'pickup';
  const tipper = type === 'tipper';
  return (
    <svg className="fv-truck" viewBox="0 0 120 56" aria-hidden="true" focusable="false">
      {pickup ? (
        <path className="fv-truck__body" d="M44 22h58v14H44z" />
      ) : (
        <rect className="fv-truck__body" x="30" y={tipper ? 14 : 8} width="82" height={tipper ? 27 : 33} rx="3" />
      )}
      <path className="fv-truck__body" d="M4 40V24l8-9h16l4 7v18z" />
      <path className="fv-truck__glass" d="M10 24l5-6h11l3 6z" />
      <path className="fv-truck__line" d="M2 40h112" />
      <circle className="fv-truck__wheel" cx="20" cy="42" r="8" />
      <circle className="fv-truck__hub" cx="20" cy="42" r="3" />
      <circle className="fv-truck__wheel" cx="86" cy="42" r="8" />
      <circle className="fv-truck__hub" cx="86" cy="42" r="3" />
      <circle className="fv-truck__wheel" cx="102" cy="42" r="8" />
      <circle className="fv-truck__hub" cx="102" cy="42" r="3" />
    </svg>
  );
}
