import { motion } from 'motion/react';
import Icon from '../Icon';
import { useAnimatedNumber } from '../../lib/useAnimatedNumber';
import { spring } from '../../lib/motion';
import { healthText } from './fleetUtils';

function Ring({ value }) {
  const pct = useAnimatedNumber(Math.round(value * 100));
  const tone = value < 0.5 ? 'critical' : 'ok';
  return (
    <div className="fv-ring">
      <svg viewBox="0 0 64 64" width="64" height="64" aria-hidden="true">
        <circle cx="32" cy="32" r="27" className="fv-ring__track" />
        <motion.circle
          key={value}
          cx="32"
          cy="32"
          r="27"
          className={`fv-ring__arc fv-ring__arc--${tone}`}
          pathLength="1"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: value }}
          transition={{ ...spring, duration: 0.9 }}
        />
      </svg>
      <span className="fv-ring__num tabular">{pct}%</span>
    </div>
  );
}

function Meter({ label, value }) {
  const tone = value < 0.5 ? 'critical' : 'ok';
  const key = label === 'Tires' ? 'tires' : 'oil';
  return (
    <li className="fv-maint">
      <div className="fv-maint__row">
        <span className={`fv-maint__dot fv-maint__dot--${tone}`} aria-hidden="true" />
        <strong>{label}</strong>
        <span className="fv-muted tabular">{Math.round(value * 100)}%</span>
      </div>
      <p className="fv-muted">{healthText(key, value)}</p>
      <div
        className="fv-meter"
        role="meter"
        aria-label={`${label} health`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(value * 100)}
      >
        <motion.i
          key={`${label}-${value}`}
          className={`fv-meter__fill fv-meter__fill--${tone}`}
          initial={{ width: 0 }}
          animate={{ width: `${value * 100}%` }}
          transition={{ ...spring, duration: 0.8 }}
        />
      </div>
    </li>
  );
}

export default function VehicleInfo({ truck }) {
  const { health } = truck;
  return (
    <section className="card fv-info" aria-label="Vehicle information">
      <div className="card-head">
        <h2 className="card-title">Vehicle information</h2>
      </div>
      <dl className="fv-info__grid">
        <div>
          <dt>Plate</dt>
          <dd className="tabular">{truck.plate}</dd>
        </div>
        <div>
          <dt>Model</dt>
          <dd>{truck.model}</dd>
        </div>
        <div>
          <dt>Capacity</dt>
          <dd className="tabular">{truck.capacityKg.toLocaleString()} kg</dd>
        </div>
      </dl>
      <div className="fv-gauge">
        <Ring value={health.brakes} />
        <div>
          <p className="fv-gauge__title">
            <Icon name="sparkle" size={14} /> Brakes
          </p>
          <p className="fv-muted">{healthText('brakes', health.brakes)}</p>
        </div>
      </div>
      <ul className="fv-maints">
        <Meter label="Tires" value={health.tires} />
        <Meter label="Engine oil" value={health.oil} />
      </ul>
    </section>
  );
}
