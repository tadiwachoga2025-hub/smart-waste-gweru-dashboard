import { ENGINE_RULES } from '../../data/useWasteData';

export function RouteSummary({ route }) {
  const { stops } = route;
  return (
    <section className="card fv-load" aria-label="Route summary">
      <div className="card-head fv-load__head">
        <h2 className="card-title">Route summary</h2>
      </div>
      <dl className="fv-stats tabular">
        <div>
          <dt>Stops</dt>
          <dd>{stops.length}</dd>
        </div>
        <div>
          <dt>Distance</dt>
          <dd>{route.distanceKm} km</dd>
        </div>
        <div>
          <dt>Fuel</dt>
          <dd>{route.fuelLitres} L</dd>
        </div>
        <div>
          <dt>Trucks</dt>
          <dd>{route.trucks}</dd>
        </div>
      </dl>
      {stops.length === 0 ? (
        <p className="fv-empty">The AI engine hasn&apos;t flagged any bins for collection.</p>
      ) : (
        <ol className="fv-stoplist">
          {stops.map((s) => {
            const b = s.bin;
            return (
              <li key={s.order} className="fv-stop">
                <span className="fv-stop__num tabular">{s.order + 1}</span>
                <div className="fv-stop__body">
                  <div className="fv-stop__row">
                    <strong>{b ? b.location : `${s.coords[0]}, ${s.coords[1]}`}</strong>
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
