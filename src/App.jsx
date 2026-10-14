import { lazy, Suspense, useCallback, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import TopNav from './components/TopNav.jsx';
import OverviewView from './components/overview/OverviewView.jsx';
import InstallPrompt from './components/InstallPrompt.jsx';
import Icon from './components/Icon.jsx';
import { useWasteData } from './data/useWasteData';
import { useSmoothScroll } from './lib/useSmoothScroll';
import { useAppearance } from './lib/useAppearance';
import { spring } from './lib/motion';
import './App.css';

const FleetView = lazy(() => import('./components/fleet/FleetView.jsx'));

function scrollToId(id) {
  const el = document.getElementById(id);
  if (!el) return;
  if (window.__lenis) window.__lenis.scrollTo(el, { offset: -104, duration: 1.1 });
  else el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

const App = () => {
  useSmoothScroll();
  const data = useWasteData();
  const { preference, choose } = useAppearance();
  const [view, setView] = useState('overview');
  const [activeTab, setActiveTab] = useState('overview');
  const [selectedId, setSelectedId] = useState(undefined);
  const searchInputRef = useRef(null);

  const goOverviewThen = useCallback((fn) => {
    if (view !== 'overview') {
      setView('overview');
      window.setTimeout(fn, 420);
    } else fn();
  }, [view]);

  const onNavigate = useCallback((item) => {
    setActiveTab(item.key);
    if (item.key === 'fleet') {
      setView('fleet');
      window.__lenis?.scrollTo(0, { immediate: true });
      return;
    }
    if (item.scrollTo) goOverviewThen(() => scrollToId(item.scrollTo));
    else {
      setView('overview');
      window.__lenis ? window.__lenis.scrollTo(0) : window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [goOverviewThen]);

  const onSearch = useCallback(() => {
    setActiveTab('routes');
    goOverviewThen(() => {
      scrollToId('map');
      window.setTimeout(() => searchInputRef.current?.focus({ preventScroll: true }), 350);
    });
  }, [goOverviewThen]);

  const onSelectAlert = useCallback((binId) => {
    setSelectedId(binId);
    setActiveTab('routes');
    goOverviewThen(() => scrollToId('map'));
  }, [goOverviewThen]);

  const alerts = data.bins.filter((b) => b.fillLevel >= 90);

  return (
    <div className="app">
      <TopNav
        active={activeTab}
        onNavigate={onNavigate}
        status={data.status}
        liveCount={data.liveCount}
        alerts={alerts}
        onSearch={onSearch}
        onSelectAlert={onSelectAlert}
        appearance={preference}
        onAppearance={choose}
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
                : 'The live sensor feed could not be reached. Showing demo data until it recovers.'}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      <main className="app-main">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={view}
            initial={{ opacity: 0, y: 10, filter: 'blur(6px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0, y: -6, filter: 'blur(6px)' }}
            transition={{ ...spring, duration: 0.35 }}
          >
            {view === 'overview' ? (
              <OverviewView
                data={data}
                selectedId={selectedId}
                onSelect={setSelectedId}
                searchInputRef={searchInputRef}
              />
            ) : (
              <Suspense fallback={<div className="app-loading" role="status">Loading fleet…</div>}>
                <FleetView data={data} />
              </Suspense>
            )}
          </motion.div>
        </AnimatePresence>
        <footer className="app-foot">
          <span><span className="demo-tag" aria-hidden="true" /> Demo data — fills panels the live sensor feed doesn&rsquo;t report yet.</span>
          <span className="tabular">
            {data.liveCount > 0
              ? `${data.liveCount} live bin${data.liveCount === 1 ? '' : 's'} · AI route ${data.route.distanceKm} km`
              : 'Waiting for live bins'}
          </span>
        </footer>
      </main>
      <InstallPrompt />
    </div>
  );
};

export default App;
