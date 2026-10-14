import { useEffect, useState } from 'react';

const INSTALLED_KEY = 'sw-install-installed';
const DISMISSED_KEY = 'sw-install-dismissed';
const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;
const SHOW_DELAY_MS = 2500;

function isStandaloneMode() {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return true;
  if (typeof navigator !== 'undefined' && navigator.standalone === true) return true;
  return false;
}

function isInstalledFlagSet() {
  try {
    return window.localStorage.getItem(INSTALLED_KEY) === 'true';
  } catch {
    return false;
  }
}

function isSnoozed() {
  try {
    const raw = window.localStorage.getItem(DISMISSED_KEY);
    if (!raw) return false;
    const ts = Number(raw);
    if (!Number.isFinite(ts)) return false;
    return Date.now() - ts < SNOOZE_MS;
  } catch {
    return false;
  }
}

function isIOSDevice() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || navigator.vendor || '';
  if (/iphone|ipad|ipod/i.test(ua)) return true;
  if (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) return true;
  return false;
}

function shouldSuppress() {
  return isStandaloneMode() || isInstalledFlagSet() || isSnoozed();
}

function persistSnooze() {
  try {
    window.localStorage.setItem(DISMISSED_KEY, String(Date.now()));
  } catch {
    // storage unavailable — popup simply reappears next visit
  }
}

function persistInstalled() {
  try {
    window.localStorage.setItem(INSTALLED_KEY, 'true');
  } catch {
    // storage unavailable — nothing to persist
  }
}

export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [visible, setVisible] = useState(false);
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < 640,
  );

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 640);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    let promptTimer = null;
    let iosTimer = null;

    const onBeforeInstallPrompt = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      if (shouldSuppress()) return;
      window.clearTimeout(promptTimer);
      promptTimer = window.setTimeout(() => {
        if (!shouldSuppress()) setVisible(true);
      }, SHOW_DELAY_MS);
    };

    const onAppInstalled = () => {
      persistInstalled();
      setDeferredPrompt(null);
      setVisible(false);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onAppInstalled);

    // iOS Safari never fires beforeinstallprompt — fall back to manual instructions.
    if (isIOSDevice() && !isStandaloneMode()) {
      iosTimer = window.setTimeout(() => {
        if (!shouldSuppress()) setVisible(true);
      }, SHOW_DELAY_MS);
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onAppInstalled);
      window.clearTimeout(promptTimer);
      window.clearTimeout(iosTimer);
    };
  }, []);

  if (!visible) return null;
  if (shouldSuppress()) return null;

  const iosMode = !deferredPrompt && isIOSDevice() && !isStandaloneMode();
  // Never show an empty popup on non-iOS browsers without a stashed prompt.
  if (!deferredPrompt && !iosMode) return null;

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    try {
      deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice && choice.outcome === 'accepted') {
        persistInstalled();
        setDeferredPrompt(null);
        setVisible(false);
      } else {
        persistSnooze();
        setVisible(false);
      }
    } catch {
      persistSnooze();
      setVisible(false);
    }
  };

  const handleDismiss = () => {
    persistSnooze();
    setVisible(false);
  };

  const containerStyle = isMobile
    ? {
        position: 'fixed',
        left: '16px',
        right: '16px',
        bottom: '16px',
        zIndex: 1000,
      }
    : {
        position: 'fixed',
        right: '24px',
        bottom: '24px',
        width: '360px',
        maxWidth: 'calc(100vw - 48px)',
        zIndex: 1000,
      };

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label="Install Smart Waste app"
      style={{
        ...containerStyle,
        fontFamily: 'system-ui, sans-serif',
        backgroundColor: '#ffffff',
        color: '#111827',
        borderRadius: '12px',
        boxShadow: '0 8px 30px rgba(0, 0, 0, 0.15)',
        border: '1px solid #e5e7eb',
        padding: '16px',
      }}
    >
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss install prompt"
        style={{
          position: 'absolute',
          top: '8px',
          right: '8px',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          fontSize: '18px',
          lineHeight: 1,
          color: '#6b7280',
          padding: '4px 8px',
        }}
      >
        ×
      </button>

      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
        <img
          src="/pwa-192x192.png"
          alt="Smart Waste app icon"
          width="32"
          height="32"
          style={{ width: '32px', height: '32px', borderRadius: '8px', flexShrink: 0 }}
        />
        <div>
          <p style={{ margin: 0, fontWeight: '700', fontSize: '15px' }}>Install Smart Waste</p>
          <p style={{ margin: 0, color: '#6b7280', fontSize: '13px' }}>
            Faster access, works offline
          </p>
        </div>
      </div>

      {iosMode ? (
        <div>
          <p style={{ margin: '8px 0 12px 0', fontSize: '14px', color: '#374151' }}>
            To install: tap <strong>Share</strong> → <strong>Add to Home Screen</strong>.
          </p>
          <button
            type="button"
            onClick={handleDismiss}
            style={{
              width: '100%',
              backgroundColor: '#10b981',
              color: '#ffffff',
              border: 'none',
              borderRadius: '8px',
              padding: '10px 16px',
              fontWeight: '600',
              fontSize: '14px',
              cursor: 'pointer',
            }}
          >
            Got it
          </button>
        </div>
      ) : (
        <div>
          <p style={{ margin: '8px 0 12px 0', fontSize: '14px', color: '#374151' }}>
            Add Smart Waste to your home screen for quick access to live bin levels.
          </p>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              onClick={handleInstall}
              style={{
                flexGrow: 1,
                backgroundColor: '#10b981',
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                padding: '10px 16px',
                fontWeight: '600',
                fontSize: '14px',
                cursor: 'pointer',
              }}
            >
              Install app
            </button>
            <button
              type="button"
              onClick={handleDismiss}
              style={{
                backgroundColor: '#f3f4f6',
                color: '#374151',
                border: '1px solid #e5e7eb',
                borderRadius: '8px',
                padding: '10px 16px',
                fontWeight: '600',
                fontSize: '14px',
                cursor: 'pointer',
              }}
            >
              Not now
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
