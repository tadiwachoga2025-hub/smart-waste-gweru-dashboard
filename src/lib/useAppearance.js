import { useCallback, useEffect, useRef, useState } from 'react';

// Appearance follows the system unless the person picks Light or Dark.
// index.html applies the same rule before first paint, so there's no flash.
const KEY = 'sw-appearance';
export const APPEARANCES = ['system', 'light', 'dark'];
const SHELL = { light: '#eaffd0', dark: '#0d0d0d' };

function readPreference() {
  try {
    const v = window.localStorage.getItem(KEY);
    return APPEARANCES.includes(v) ? v : 'system';
  } catch {
    return 'system';
  }
}

function resolve(pref) {
  if (pref !== 'system') return pref;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

// Flip the theme with a short cross-fade instead of an abrupt brightness jump.
function applyTheme(theme) {
  const root = document.documentElement;
  if (root.dataset.theme === theme) return;
  const flip = () => {
    root.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', SHELL[theme]);
  };
  if (typeof document.startViewTransition === 'function') {
    document.startViewTransition(flip);
    return;
  }
  root.classList.add('theme-easing');
  flip();
  window.setTimeout(() => root.classList.remove('theme-easing'), 320);
}

export function useAppearance() {
  const [preference, setPreference] = useState(readPreference);
  const [theme, setTheme] = useState(() => resolve(readPreference()));
  const prefRef = useRef(preference);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const onSystemChange = () => {
      if (prefRef.current !== 'system') return;
      const next = resolve('system');
      setTheme(next);
      applyTheme(next);
    };
    mq.addEventListener('change', onSystemChange);
    return () => mq.removeEventListener('change', onSystemChange);
  }, []);

  const choose = useCallback((next) => {
    if (!APPEARANCES.includes(next)) return;
    try {
      window.localStorage.setItem(KEY, next);
    } catch {
      // storage unavailable — the choice lasts for this session only
    }
    prefRef.current = next;
    setPreference(next);
    const resolved = resolve(next);
    setTheme(resolved);
    applyTheme(resolved);
  }, []);

  return { preference, theme, choose };
}
