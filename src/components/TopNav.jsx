import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import Icon, { LogoMark } from './Icon.jsx';
import { spring, springSnappy } from '../lib/motion';
import './TopNav.css';

const NAV_ITEMS = [
  { key: 'overview', label: 'Overview' },
  { key: 'route', label: 'Route' },
  { key: 'bins', label: 'Bins', scrollTo: 'pickups' },
  { key: 'map', label: 'Map', scrollTo: 'map' },
  { key: 'reports', label: 'Reports', soon: true },
  { key: 'analytics', label: 'Analytics', soon: true },
];

const STATUS_COPY = {
  live: { short: 'Live', long: (n) => `Live sensor feed · ${n} bin${n === 1 ? '' : 's'} reporting` },
  connecting: { short: 'Connecting', long: () => 'Connecting to the sensor feed' },
  offline: { short: 'Offline', long: () => 'Offline · showing cached data' },
  error: { short: 'Feed error', long: () => 'Sensor feed unreachable · showing last received data' },
};

const APPEARANCE_OPTIONS = [
  { key: 'system', label: 'System', icon: 'display' },
  { key: 'light', label: 'Light', icon: 'sun' },
  { key: 'dark', label: 'Dark', icon: 'moon' },
];

// Popover that closes on outside press or Escape.
function useDismiss(open, setOpen, ref) {
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => {
      if (e.type === 'keydown' && e.key !== 'Escape') return;
      if (e.type === 'pointerdown' && ref.current?.contains(e.target)) return;
      setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', close);
    };
  }, [open, setOpen, ref]);
}

const popMotion = {
  initial: { opacity: 0, scale: 0.96, y: -6, filter: 'blur(4px)' },
  animate: { opacity: 1, scale: 1, y: 0, filter: 'blur(0px)' },
  exit: { opacity: 0, scale: 0.96, y: -6, filter: 'blur(4px)' },
  transition: springSnappy,
};

export default function TopNav({
  active,
  onNavigate,
  status,
  liveCount,
  alerts,
  onSearch,
  onSelectAlert,
  appearance,
  onAppearance,
}) {
  const [bellOpen, setBellOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const bellRef = useRef(null);
  const menuRef = useRef(null);
  useDismiss(bellOpen, setBellOpen, bellRef);
  useDismiss(menuOpen, setMenuOpen, menuRef);

  return (
    <header className="nav">
      <div className="nav-brand">
        <span className="nav-logo"><LogoMark size={30} /></span>
        <span className="nav-wordmark">SmartWaste.</span>
      </div>

      <nav className="nav-tabs" aria-label="Primary">
        {NAV_ITEMS.map((item) => {
          const isActive = item.key === active;
          return (
            <button
              key={item.key}
              type="button"
              className={`nav-tab${isActive ? ' is-active' : ''}`}
              aria-current={isActive ? 'page' : undefined}
              aria-disabled={item.soon || undefined}
              title={item.soon ? `${item.label} — coming soon` : undefined}
              onClick={() => !item.soon && onNavigate(item)}
            >
              {isActive && (
                <motion.span layoutId="nav-underline" className="nav-tab-mark" transition={spring} />
              )}
              <span className="nav-tab-label">{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="nav-actions">
        <span
          className={`nav-status is-${status}`}
          role="status"
          title={STATUS_COPY[status]?.long(liveCount)}
          aria-label={STATUS_COPY[status]?.long(liveCount)}
        >
          <span className="nav-status-dot" aria-hidden="true" />
          {STATUS_COPY[status]?.short ?? status}
        </span>

        <button type="button" className="nav-round" aria-label="Search bins" onClick={onSearch}>
          <Icon name="search" size={22} />
        </button>

        <div className="nav-bell" ref={bellRef}>
          <button
            type="button"
            className="nav-round"
            aria-label={`Alerts, ${alerts.length} bins need pickup`}
            aria-expanded={bellOpen}
            aria-haspopup="true"
            onClick={() => setBellOpen((o) => !o)}
          >
            <Icon name="bell" size={22} />
            {alerts.length > 0 && <span className="nav-bell-dot" aria-hidden="true" />}
          </button>
          <AnimatePresence>
            {bellOpen && (
              <motion.div className="nav-pop" role="menu" {...popMotion}>
                <p className="nav-pop-title">Needs pickup</p>
                {alerts.length === 0 ? (
                  <p className="nav-pop-empty">No bins above 90%. The next sweep is on schedule.</p>
                ) : (
                  alerts.map((b) => (
                    <button
                      key={b.id}
                      type="button"
                      role="menuitem"
                      className="nav-pop-item"
                      onClick={() => {
                        setBellOpen(false);
                        onSelectAlert(b.id);
                      }}
                    >
                      <span className="nav-pop-name">{b.location}</span>
                      <span className="nav-pop-meta tabular">{b.fillLevel}% · {b.area}</span>
                    </button>
                  ))
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="nav-menu" ref={menuRef}>
          <button
            type="button"
            className="nav-profile"
            aria-label="Account and appearance: Gweru Dispatch, Dispatch officer"
            aria-expanded={menuOpen}
            aria-haspopup="true"
            onClick={() => setMenuOpen((o) => !o)}
          >
            <span className="nav-avatar" aria-hidden="true">GD</span>
            <span className="nav-profile-text">
              <span className="nav-profile-name">Gweru Dispatch</span>
              <span className="nav-profile-role">Dispatch Officer</span>
            </span>
            <motion.span
              className="nav-profile-chev"
              animate={{ rotate: menuOpen ? 180 : 0 }}
              transition={spring}
              aria-hidden="true"
            >
              <Icon name="chevronDown" size={18} />
            </motion.span>
          </button>
          <AnimatePresence>
            {menuOpen && (
              <motion.div className="nav-pop nav-pop-menu" {...popMotion}>
                <p className="nav-pop-title" id="nav-appearance-label">Appearance</p>
                <div className="nav-seg" role="radiogroup" aria-labelledby="nav-appearance-label">
                  {APPEARANCE_OPTIONS.map((o) => {
                    const on = appearance === o.key;
                    return (
                      <button
                        key={o.key}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        className={`nav-seg-btn${on ? ' is-on' : ''}`}
                        onClick={() => onAppearance(o.key)}
                      >
                        {on && <motion.span layoutId="nav-seg-pill" className="nav-seg-pill" transition={spring} />}
                        <Icon name={o.icon} size={18} />
                        <span>{o.label}</span>
                      </button>
                    );
                  })}
                </div>
                <p className="nav-pop-hint">
                  {appearance === 'system' ? 'Matches your device setting.' : 'Saved on this device.'}
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </header>
  );
}
