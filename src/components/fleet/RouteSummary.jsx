import { ENGINE_RULES } from '../../data/useWasteData';
import { timeAgo } from '../../lib/format.js';

export function RouteSummary({ route }) {
  const stops = Array.isArray(route?.stops) ? route.stops : [];
  const distanceKm = Number(route?.distanceKm) || 0;
  const fuelLitres = Number(route?.fuelLitres) || 0;
  const trucks = Number(route?.trucks) || 0;
  // Stops the engine published by coordinates only may match no live bin
  // (moved/removed bin, stale plan). Dispatch leaves those out of the job
  // with a warning; here they stay visible as coordinates so the plan is
  // never silently renumbered, but the mismatch is called out just as loudly.
  const unmatched = stops.filter((s) => !s.bin).length;
  return (
    <section className="card fv-load" aria-label="Route summary">
      <div className="card-head fv-load__head">
        <h2 className="card-title">Route summary</h2>
      </div>
      {Number.isFinite(route?.updatedAt) ? (
        <p className="fv-muted" style={{ padding: '0 var(--sp-6)', margin: '0 0 var(--sp-2)' }}>
          Planned {timeAgo(route.updatedAt)}
        </p>
      ) : null}
      <dl className="fv-stats tabular">
        <div>
          <dt>Stops</dt>
          <dd>{stops.length}</dd>
        </div>
        <div>
          <dt>Distance</dt>
          <dd>{distanceKm} km</dd>
        </div>
        <div>
          <dt>Fuel</dt>
          <dd>{fuelLitres} L</dd>
        </div>
        <div>
          <dt>Trucks</dt>
          <dd>{trucks}</dd>
        </div>
      </dl>
      {stops.length === 0 ? (
        <p className="fv-empty">The AI engine hasn&apos;t flagged any bins for collection.</p>
      ) : (
        <>
          {unmatched > 0 ? (
            <p className="fv-muted" style={{ padding: '0 var(--sp-6) var(--sp-3)', margin: 0 }}>
              {unmatched} {unmatched === 1 ? 'stop' : 'stops'} couldn&apos;t be matched to a live bin and
              {unmatched === 1 ? ' is' : ' are'} shown by coordinates — the plan may reference a moved or
              removed bin.
            </p>
          ) : null}
          <ol className="fv-stoplist">
            {stops.map((s) => {
              const b = s.bin;
              // A stop without coordinates must never throw inside render:
              // one bad stop blanked the whole route screen.
              const coordsLabel =
                Array.isArray(s.coords) && s.coords.every((n) => Number.isFinite(n))
                  ? `${s.coords[0]}, ${s.coords[1]}`
                  : 'Unknown location';
              return (
                <li key={s.order} className="fv-stop">
                  <span className="fv-stop__num tabular">{s.order + 1}</span>
                  <div className="fv-stop__body">
                    <div className="fv-stop__row">
                      <strong>{b ? b.location : coordsLabel}</strong>
                    {b ? <span className="tabular">{b.fillLevel}%</span> : null}
                  </div>
                  {b ? (
                    <>
                      <div className="fv-meter">
                        <span
                          className={`fv-meter__fill fv-meter__fill--${b.tone}`}
                          style={{ width: `${Math.max(0, Math.min(100, b.fillLevel))}%` }}
                        />
                      </div>
                      <span className="fv-muted">{b.prediction}</span>
                    </>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
        </>
      )}
    </section>
  );
}

export function EngineRules() {
  const r = ENGINE_RULES;
  const rows = [
    { k: 'Collect', v: `Fill ≥ ${r.collectAtFill}% or predicted full within ${r.collectWithinHours} h` },
    { k: 'Trucks', v: `1 truck per ${r.binsPerTruck} bins` },
    { k: 'Fuel', v: `Estimate ${r.litresPerKm} L per km` },
    { k: 'Critical', v: `Marked critical at ≥ ${r.criticalFill}%` },
  ];
  return (
    <section className="card fv-info" aria-label="How the AI engine plans">
      <div className="card-head">
        <h2 className="card-title">How the AI engine plans</h2>
      </div>
      <ul className="fv-rules">
        {rows.map((x) => (
          <li key={x.k} className="fv-rule">
            <span className="fv-muted">{x.k}</span>
            <strong>{x.v}</strong>
          </li>
        ))}
      </ul>
    </section>
  );
}
