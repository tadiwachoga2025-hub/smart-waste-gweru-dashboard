// Shared UI primitives. Every role's screens build from these so the app
// reads as one product: same buttons, fields, panels, empty states, dialogs.
// Styles live in src/styles/ui.css (class names are ui-*).

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import Icon from '../Icon.jsx';
import { spring, springSnappy } from '../../lib/motion';

const cx = (...parts) => parts.filter(Boolean).join(' ');

/* ---------- Layout ---------- */

export function Page({ children, wide = false, label }) {
  return (
    <section className={cx('ui-page', wide && 'ui-page--wide')} aria-label={label}>
      {children}
    </section>
  );
}

/** Title block at the top of a screen. `eyebrow` names the role context. */
export function PageHead({ eyebrow, title, sub, actions }) {
  return (
    <header className="ui-head">
      <div className="ui-head__text">
        {eyebrow && <p className="ui-eyebrow">{eyebrow}</p>}
        <h1 className="ui-title">{title}</h1>
        {sub && <p className="ui-sub">{sub}</p>}
      </div>
      {actions && <div className="ui-head__actions">{actions}</div>}
    </header>
  );
}

/** A titled card. `flush` removes body padding for tables and lists. */
export function Panel({ title, note, actions, flush = false, children, className, as: Tag = 'section', ...rest }) {
  return (
    <Tag className={cx('card', className)} {...rest}>
      {(title || actions || note) && (
        <div className="ui-panel__head">
          <div>
            {title && <h2 className="ui-panel__title">{title}</h2>}
            {note && <span className="ui-panel__note">{note}</span>}
          </div>
          {actions}
        </div>
      )}
      <div className={cx('ui-panel__body', flush && 'ui-panel__body--flush')}>{children}</div>
    </Tag>
  );
}

export function Stat({ label, value, unit, hint, tone }) {
  return (
    <div className={cx('card ui-stat', tone && `ui-stat--${tone}`)}>
      <p className="ui-stat__label">{label}</p>
      <p className="ui-stat__value">
        {value}
        {unit && <span className="ui-stat__unit">{unit}</span>}
      </p>
      {hint && <p className="ui-stat__hint">{hint}</p>}
    </div>
  );
}

export function Stats({ children }) {
  return <div className="ui-stats">{children}</div>;
}

/* ---------- Controls ---------- */

export function Button({ variant = 'ghost', size, block, loading, icon, children, className, type = 'button', disabled, onClick, ...rest }) {
  // While busy the button stays focusable (aria-disabled, not disabled) so
  // keyboard focus is not dropped to <body> mid-action; clicks are ignored.
  return (
    <button
      type={type}
      className={cx('ui-btn', `ui-btn--${variant}`, size === 'sm' && 'ui-btn--sm', block && 'ui-btn--block', className)}
      disabled={disabled}
      aria-disabled={loading || undefined}
      aria-busy={loading || undefined}
      onClick={loading ? (e) => e.preventDefault() : onClick}
      {...rest}
    >
      {loading ? <span className="ui-btn__spin" aria-hidden="true" /> : icon ? <Icon name={icon} size={16} /> : null}
      {children}
    </button>
  );
}

export function IconButton({ icon, label, size = 20, className, ...rest }) {
  return (
    <button type="button" className={cx('ui-iconbtn', className)} aria-label={label} title={label} {...rest}>
      <Icon name={icon} size={size} />
    </button>
  );
}

/**
 * Labelled input. `as` is 'input' (default), 'select' or 'textarea'.
 * Pass `error` to show a message and mark the field invalid for screen readers.
 */
export function Field({ label, hint, error, optional, as = 'input', className, children, id: idProp, ...rest }) {
  const auto = useId();
  const id = idProp ?? auto;
  const describedBy = [hint && `${id}-hint`, error && `${id}-err`].filter(Boolean).join(' ') || undefined;
  const Tag = as;
  const cls = as === 'select' ? 'ui-select' : as === 'textarea' ? 'ui-textarea' : 'ui-input';
  return (
    <div className={cx('ui-field', error && 'ui-field--error', className)}>
      <label className="ui-field__label" htmlFor={id}>
        {label}
        {optional && <span className="ui-field__opt">optional</span>}
      </label>
      <Tag id={id} className={cls} aria-invalid={error ? true : undefined} aria-describedby={describedBy} {...rest}>
        {children}
      </Tag>
      {hint && !error && <p className="ui-field__hint" id={`${id}-hint`}>{hint}</p>}
      {error && <p className="ui-field__error" id={`${id}-err`} role="alert">{error}</p>}
    </div>
  );
}

export function Check({ label, hint, ...rest }) {
  return (
    <label className="ui-check">
      <input type="checkbox" {...rest} />
      <span className="ui-check__text">
        {label}
        {hint && <span className="ui-check__hint">{hint}</span>}
      </span>
    </label>
  );
}

/** Radio-style segmented control with a sliding pill. options: [{ key, label, count? }] */
export function Segmented({ options, value, onChange, label, name = 'seg' }) {
  const group = useRef(null);
  // Radio-group keyboard pattern: one tab stop (the selected option), arrow
  // keys move and select, Home/End jump.
  const onKeyDown = (e) => {
    const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    const i = options.findIndex((o) => o.key === value);
    let next = null;
    if (e.key in keys) next = (i + keys[e.key] + options.length) % options.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = options.length - 1;
    if (next == null) return;
    e.preventDefault();
    onChange(options[next].key);
    window.requestAnimationFrame(() => group.current?.querySelectorAll('[role="radio"]')[next]?.focus());
  };
  const hasSelection = options.some((o) => o.key === value);
  return (
    <LayoutGroup id={name}>
      <div className="ui-seg" role="radiogroup" aria-label={label} ref={group} onKeyDown={onKeyDown}>
        {options.map((o, idx) => {
          const on = o.key === value;
          return (
            <button
              key={o.key}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={on || (!hasSelection && idx === 0) ? 0 : -1}
              className={cx('ui-seg__btn', on && 'is-on')}
              onClick={() => onChange(o.key)}
            >
              {on && <motion.span layoutId={`${name}-pill`} className="ui-seg__pill" transition={spring} />}
              {o.label}
              {o.count != null && <span className="ui-seg__count">{o.count}</span>}
            </button>
          );
        })}
      </div>
    </LayoutGroup>
  );
}

/* ---------- Feedback ---------- */

/** tone: ok | warning | critical | info | muted. Colour is never the only signal: always pass a label. */
export function Pill({ tone = 'muted', dot = true, children }) {
  return (
    <span className={cx('ui-pill', tone !== 'muted' && `ui-pill--${tone}`)}>
      {dot && <i className="ui-pill__dot" aria-hidden="true" />}
      {children}
    </span>
  );
}

export function Notice({ tone, icon, children, ...rest }) {
  const glyph = icon ?? (tone === 'error' || tone === 'warning' ? 'hazard' : null);
  return (
    <div className={cx('ui-notice', tone && `ui-notice--${tone}`)} role={tone === 'error' ? 'alert' : 'status'} {...rest}>
      {glyph && <Icon name={glyph} size={18} />}
      <span>{children}</span>
    </div>
  );
}

export function EmptyState({ icon = 'leaf', title, children, action }) {
  return (
    <div className="ui-empty">
      <span className="ui-empty__icon"><Icon name={icon} size={24} /></span>
      <p className="ui-empty__title">{title}</p>
      {children && <p className="ui-empty__text">{children}</p>}
      {action && <div className="ui-empty__action">{action}</div>}
    </div>
  );
}

/** Reserve the space content will fill so the page does not jump. */
export function Skeleton({ height = 16, width = '100%', style }) {
  return <div className="ui-skeleton" style={{ height, width, ...style }} aria-hidden="true" />;
}

export function LoadingRows({ rows = 4 }) {
  return (
    <div role="status" aria-label="Loading" style={{ display: 'grid', gap: 12, padding: '8px 24px 24px' }}>
      {Array.from({ length: rows }, (_, i) => <Skeleton key={i} height={44} />)}
    </div>
  );
}

/** Standard wording when the rules refuse a read or the feed is down. */
export function DataError({ error }) {
  if (!error) return null;
  return (
    <Notice tone="error">
      {error === 'permission-denied'
        ? 'Your account is not allowed to see this data.'
        : 'This data could not be loaded. It will refresh when the connection recovers.'}
    </Notice>
  );
}

/* ---------- Dialog ---------- */

/**
 * Accessible dialog: Escape and scrim click close it, focus moves in and is
 * returned on close, Tab stays inside. On phones it is a bottom sheet.
 * Enter and exit follow the same path (spatial consistency).
 */
export function Modal({ open, onClose, title, description, wide = false, children }) {
  const panel = useRef(null);
  const returnTo = useRef(null);
  const titleId = useId();
  // Callers pass inline handlers, and the app re-renders on every sensor
  // update. Keep the latest onClose in a ref so the effect below runs once per
  // open, not on every render (which would steal focus from the field in use).
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; });

  useEffect(() => {
    if (!open) return undefined;
    returnTo.current = document.activeElement;
    const node = panel.current;
    const focusable = () => node?.querySelectorAll('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])');
    const first = node?.querySelector('[data-autofocus]') ?? focusable()?.[0] ?? node;
    window.setTimeout(() => first?.focus(), 30);
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); closeRef.current(); return; }
      if (e.key !== 'Tab') return;
      const items = [...(focusable() ?? [])].filter((el) => !el.disabled && el.offsetParent !== null);
      if (items.length === 0) return;
      const a = items[0];
      const z = items[items.length - 1];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Lock smooth scrolling too: Lenis would otherwise keep consuming wheel
    // input behind the scrim while the page is meant to be frozen.
    const lenis = window.__lenis;
    lenis?.stop();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      lenis?.start();
      returnTo.current?.focus?.();
    };
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="ui-scrim"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
          <motion.div
            ref={panel}
            className={cx('ui-modal', wide && 'ui-modal--wide')}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={springSnappy}
          >
            <div className="ui-modal__head">
              <div>
                <h2 className="ui-modal__title" id={titleId}>{title}</h2>
                {description && <p className="ui-modal__desc">{description}</p>}
              </div>
              <IconButton icon="close" label="Close" onClick={onClose} />
            </div>
            <div className="ui-modal__body" data-lenis-prevent>{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Confirm a destructive or irreversible step. Use sparingly; undo is kinder. */
export function ConfirmModal({ open, onClose, onConfirm, title, children, confirmLabel = 'Confirm', danger = false, loading = false }) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <p className="ui-muted" style={{ margin: '0 0 var(--sp-5)' }}>{children}</p>
      <div className="ui-form__actions">
        <Button variant="ghost" onClick={onClose} data-autofocus>Cancel</Button>
        <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>{confirmLabel}</Button>
      </div>
    </Modal>
  );
}

/* ---------- Toasts ---------- */

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((message, tone = 'ok') => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((t) => [...t.slice(-2), { id, message, tone }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 6000 : 3500);
  }, []);
  const value = useMemo(() => ({
    success: (m) => push(m, 'ok'),
    error: (m) => push(m, 'error'),
  }), [push]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="ui-toasts" role="status" aria-live="polite">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              className={cx('ui-toast', t.tone === 'error' && 'ui-toast--error')}
              initial={{ opacity: 0, y: 12, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.97 }}
              transition={spring}
            >
              <Icon name={t.tone === 'error' ? 'hazard' : 'leaf'} size={18} />
              <span>{t.message}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
