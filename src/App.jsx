import { lazy, Suspense, useCallback, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import TopNav from './components/TopNav.jsx';
import OverviewView from './components/overview/OverviewView.jsx';
import InstallPrompt from './components/InstallPrompt.jsx';
import Icon from './components/Icon.jsx';
import { ToastProvider } from './components/ui';
import { AuthProvider, useAuth } from './auth/AuthContext.jsx';
import LoginView, { AuthSplash, BlockedView } from './auth/LoginView.jsx';
import { useWasteData } from './data/useWasteData';
import { useSmoothScroll } from './lib/useSmoothScroll';
import { useAppearance } from './lib/useAppearance';
import { homeFor, navFor } from './lib/rbac';
import { spring } from './lib/motion';
import './App.css';

// One screen per `view` key in rbac.js. Every role-specific screen is lazy, so
// a driver never downloads the administrator's code, and vice versa.
const FleetView = lazy(() => import('./components/fleet/FleetView.jsx'));
const UsersView = lazy(() => import('./views/admin/UsersView.jsx'));
const AccessLogView = lazy(() => import('./views/admin/AccessLogView.jsx'));
const AlertsView = lazy(() => import('./views/admin/AlertsView.jsx'));
const DispatchView = lazy(() => import('./views/officer/DispatchView.jsx'));
const ComplaintsView = lazy(() => import('./views/officer/ComplaintsView.jsx'));
const DriverView = lazy(() => import('./views/driver/DriverView.jsx'));
const DevicesView = lazy(() => import('./views/technician/DevicesView.jsx'));
const CitizenView = lazy(() => import('./views/citizen/CitizenView.jsx'));
const ReportsView = lazy(() => import('./views/reports/ReportsView.jsx'));

const SCREENS = {
  route: FleetView,
  users: UsersView,
  audit: AccessLogView,
  alerts: AlertsView,
  dispatch: DispatchView,
  complaints: ComplaintsView,
  jobs: DriverView,
  devices: DevicesView,
  report: CitizenView,
  reports: ReportsView,
};

function scrollToId(id) {
  const el = document.getElementById(id);
  if (!el) return;
  if (window.__lenis) window.__lenis.scrollTo(el, { offset: -104, duration: 1.1 });
  else el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function Workspace({ appearance, onAppearance }) {
  const { profile, email, access, can, logout } = useAuth();
  const data = useWasteData(access);

  const nav = useMemo(() => navFor(profile), [profile]);
  const home = useMemo(() => homeFor(profile), [profile]);
  const [view, setView] = useState(home?.view ?? 'overview');
  const [activeTab, setActiveTab] = useState(home?.key ?? 'overview');
  const [selectedId, setSelectedId] = useState(undefined);
  const searchInputRef = useRef(null);

  // If an administrator changes this person's role or grants while they are
  // signed in and their current screen disappears, fall back to their home
  // screen. Derived during render: no effect, no flash of a forbidden screen.
  const allowed = nav.some((n) => n.key === activeTab);
  const currentTab = allowed ? activeTab : home.key;
  const currentView = allowed ? view : home.view;

  const goOverviewThen = useCallback((fn) => {
    if (currentView !== 'overview') {
      setView('overview');
      window.setTimeout(fn, 420);
    } else fn();
  }, [currentView]);

  const onNavigate = useCallback((item) => {
    setActiveTab(item.key);
    if (item.view !== 'overview') {
      setView(item.view);
      window.__lenis?.scrollTo(0, { immediate: true });
      return;
    }
    if (item.scrollTo) goOverviewThen(() => scrollToId(item.scrollTo));
    else {
      setView('overview');
      window.__lenis ? window.__lenis.scrollTo(0) : window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [goOverviewThen]);

  const hasMap = can('bins.view');

  const onSearch = useCallback(() => {
    setActiveTab('map');
    goOverviewThen(() => {
      scrollToId('map');
      window.setTimeout(() => searchInputRef.current?.focus({ preventScroll: true }), 350);
    });
  }, [goOverviewThen]);

  const onSelectAlert = useCallback((binId) => {
    setSelectedId(binId);
    setActiveTab('map');
    goOverviewThen(() => scrollToId('map'));
  }, [goOverviewThen]);

  const alerts = hasMap ? data.bins.filter((b) => b.fillLevel >= 90) : null;
  const Screen = SCREENS[currentView];

  return (
    <div className="app">
      <a className="app-skip" href="#main" onClick={(e) => { e.preventDefault(); document.getElementById('main')?.focus(); }}>
        Skip to content
      </a>
      <TopNav
        items={nav}
        active={currentTab}
        onNavigate={onNavigate}
        status={data.status}
        liveCount={data.liveCount}
        alerts={alerts}
        onSearch={hasMap ? onSearch : null}
        onSelectAlert={onSelectAlert}
        profile={profile}
        email={email}
        onSignOut={logout}
        appearance={appearance}
        onAppearance={onAppearance}
      />

      <AnimatePresence initial={false}>
        {(data.status === 'offline' || data.status === 'error') && (
          <motion.div
            className="app-banner"
            role="status"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={spring}
          >
            <span className="app-banner-inner">
              <Icon name="wifiOff" size={18} />
              {data.status === 'offline'
                ? 'You are offline. Showing the cached dashboard; live bin levels resume when you reconnect.'
                : 'The live sensor feed could not be reached. Showing the last data received; it will update when the feed recovers.'}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      <main className="app-main" id="main" tabIndex={-1}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={currentView}
            initial={{ opacity: 0, y: 10, filter: 'blur(6px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0, y: -6, filter: 'blur(6px)' }}
            transition={{ ...spring, duration: 0.35 }}
          >
            {currentView === 'overview' ? (
              <OverviewView
                data={data}
                selectedId={selectedId}
                onSelect={setSelectedId}
                searchInputRef={searchInputRef}
              />
            ) : Screen ? (
              <Suspense fallback={<div className="app-loading" role="status">Loading…</div>}>
                <Screen data={data} />
              </Suspense>
            ) : null}
          </motion.div>
        </AnimatePresence>
        <footer className="app-foot">
          <span>
            {access.bins
              ? 'Bin levels from the ESP32 sensors · predictions and routing from the AI engine.'
              : 'SmartWaste Gweru · AI-assisted waste collection.'}
          </span>
          {access.bins && (
            <span className="tabular">
              {data.liveCount > 0
                ? `${data.liveCount} bin${data.liveCount === 1 ? '' : 's'} reporting${access.logistics ? ` · route ${data.route.distanceKm} km` : ''}`
                : data.loaded
                  ? 'No bins in the database yet'
                  : 'Waiting for live bins'}
            </span>
          )}
        </footer>
      </main>
      <InstallPrompt />
    </div>
  );
}

function Gate({ appearance, onAppearance }) {
  const { status, profile } = useAuth();
  if (status === 'loading') return <AuthSplash />;
  if (status === 'signedOut') return <LoginView />;
  if (status === 'blocked') return <BlockedView />;
  if (navFor(profile).length === 0) return <BlockedView reason="no-access" />;
  return <Workspace appearance={appearance} onAppearance={onAppearance} />;
}

const App = () => {
  useSmoothScroll();
  const { preference, choose } = useAppearance();
  return (
    <AuthProvider>
      <ToastProvider>
        <Gate appearance={preference} onAppearance={choose} />
      </ToastProvider>
    </AuthProvider>
  );
};

export default App;
