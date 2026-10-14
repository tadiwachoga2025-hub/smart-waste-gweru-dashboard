import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import Icon, { LogoMark } from '../components/Icon.jsx';
import { Button, Field, Notice, Segmented } from '../components/ui';
import { ROLES, ROLE_KEYS } from '../lib/rbac';
import { spring } from '../lib/motion';
import { useAuth } from './AuthContext.jsx';
import { authMessage } from './authMessage.js';
import './auth.css';

const MODES = [
  { key: 'signin', label: 'Sign in' },
  { key: 'register', label: 'Resident sign-up' },
];

function Shell({ children }) {
  return (
    <main className="auth">
      <section className="auth__brand" aria-hidden="false">
        <div className="auth__brandtop">
          <span className="auth__logo"><LogoMark size={34} /></span>
          <span className="auth__wordmark">SmartWaste.</span>
        </div>
        <div className="auth__pitch">
          <h1 className="auth__headline">Gweru&rsquo;s bins, reporting for themselves.</h1>
          <p className="auth__lede">
            Live sensor levels, AI-planned collection routes and a direct line from residents to the people who clear the bins.
          </p>
          <ul className="auth__roles" aria-label="Who uses SmartWaste">
            {ROLE_KEYS.map((k) => (
              <li key={k}><span>{ROLES[k].label}</span></li>
            ))}
          </ul>
        </div>
      </section>
      <section className="auth__panel">
        <div className="auth__card card">{children}</div>
      </section>
    </main>
  );
}

export default function LoginView() {
  const { signIn, register, resetPassword } = useAuth();
  const [mode, setMode] = useState('signin');
  const [resetting, setResetting] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [errors, setErrors] = useState({});
  const [banner, setBanner] = useState(null); // { tone, text }
  const [busy, setBusy] = useState(false);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const switchMode = (next) => {
    setMode(next);
    setResetting(false);
    setErrors({});
    setBanner(null);
  };

  const validate = () => {
    const next = {};
    if (mode === 'register' && form.name.trim().length < 2) next.name = 'Enter your name.';
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) next.email = 'Enter a valid email address.';
    if (!resetting) {
      if (!form.password) next.password = 'Enter your password.';
      else if (mode === 'register' && form.password.length < 8) next.password = 'Use at least 8 characters.';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setBanner(null);
    if (!validate()) return;
    setBusy(true);
    try {
      if (resetting) {
        await resetPassword(form.email);
        setBanner({ tone: 'ok', text: 'If an account exists for that email, a reset link is on its way.' });
      } else if (mode === 'register') {
        await register(form);
      } else {
        await signIn(form.email, form.password);
      }
    } catch (err) {
      setBanner({ tone: 'error', text: authMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  const title = resetting ? 'Reset your password' : mode === 'register' ? 'Create a resident account' : 'Welcome back';
  const sub = resetting
    ? 'Enter your email and we will send you a link to choose a new password.'
    : mode === 'register'
      ? 'For residents reporting waste problems. Staff accounts are created by a system administrator.'
      : 'Sign in to see the screens and data your role allows.';

  return (
    <Shell>
      {!resetting && (
        <Segmented options={MODES} value={mode} onChange={switchMode} label="Account type" name="auth-mode" />
      )}
      <h2 className="auth__title">{title}</h2>
      <p className="auth__sub">{sub}</p>

      <form className="ui-form" onSubmit={onSubmit} noValidate>
        <AnimatePresence initial={false}>
          {mode === 'register' && !resetting && (
            <motion.div
              key="name"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={spring}
              style={{ overflow: 'hidden', margin: '-4px', padding: '4px' }}
            >
              <Field
                label="Full name"
                autoComplete="name"
                value={form.name}
                onChange={set('name')}
                error={errors.name}
              />
            </motion.div>
          )}
        </AnimatePresence>

        <Field
          label="Email"
          type="email"
          inputMode="email"
          autoComplete="email"
          value={form.email}
          onChange={set('email')}
          error={errors.email}
          data-autofocus
        />
        {!resetting && (
          <Field
            label="Password"
            type="password"
            autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
            value={form.password}
            onChange={set('password')}
            error={errors.password}
            hint={mode === 'register' ? 'At least 8 characters.' : undefined}
          />
        )}

        {banner && <Notice tone={banner.tone}>{banner.text}</Notice>}

        <Button type="submit" variant="primary" block loading={busy}>
          {resetting ? 'Send reset link' : mode === 'register' ? 'Create account' : 'Sign in'}
        </Button>
      </form>

      <div className="auth__links">
        {resetting ? (
          <button type="button" className="auth__link" onClick={() => { setResetting(false); setBanner(null); }}>
            Back to sign in
          </button>
        ) : mode === 'signin' ? (
          <button type="button" className="auth__link" onClick={() => { setResetting(true); setBanner(null); setErrors({}); }}>
            Forgot your password?
          </button>
        ) : null}
      </div>
    </Shell>
  );
}

const BLOCKED_COPY = {
  'no-access': {
    title: 'This account has no screens to open',
    body: 'Your role is for connected devices and does not use the dashboard. If you are a person, ask a system administrator to give you a role.',
  },
  inactive: {
    title: 'This account is switched off',
    body: 'A system administrator has deactivated your account. If you think that is a mistake, contact them and they can switch it back on.',
  },
  'no-profile': {
    title: 'Your account is not set up yet',
    body: 'You are signed in, but no role has been assigned to this account. Ask a system administrator to finish setting it up.',
  },
};

export function BlockedView({ reason: forced }) {
  const { reason: ctxReason, email, logout } = useAuth();
  const copy = BLOCKED_COPY[forced ?? ctxReason] ?? BLOCKED_COPY['no-profile'];
  return (
    <Shell>
      <span className="auth__blockicon"><Icon name="hazard" size={26} /></span>
      <h2 className="auth__title">{copy.title}</h2>
      <p className="auth__sub">{copy.body}</p>
      <p className="auth__who">Signed in as <strong>{email}</strong></p>
      <Button variant="ghost" block onClick={logout}>Sign out</Button>
    </Shell>
  );
}

export function AuthSplash() {
  return (
    <div className="auth-splash" role="status" aria-label="Loading SmartWaste">
      <span className="auth-splash__logo"><LogoMark size={44} /></span>
    </div>
  );
}
