import { useEffect } from 'react';
import { motion } from 'motion/react';
import { ScrollTrigger } from '../../lib/useSmoothScroll';
import ProgressCard from './ProgressCard.jsx';
import FleetCard from './FleetCard.jsx';
import FuelCard from './FuelCard.jsx';
import BinMap from './BinMap.jsx';
import PickupsTable from './PickupsTable.jsx';
import { fadeUp, stagger } from '../../lib/motion';
import './OverviewView.css';

export default function OverviewView({ data, selectedId, onSelect, searchInputRef }) {
  // Until the dispatcher picks a bin (undefined), spotlight the live bin on the
  // AI route, else the fullest bin. An explicit clear (null) shows none.
  const spotlight =
    selectedId !== undefined
      ? selectedId
      : (data.bins.find((b) => b.onRoute) ??
          [...data.bins].sort((a, b) => b.fillLevel - a.fillLevel)[0])?.id ?? null;

  // Live data changes card heights (more pickups, banners); re-measure the
  // scroll-reveal trigger positions so below-the-fold reveals still fire.
  const rowCount = data.bins.length;
  useEffect(() => {
    const id = window.requestAnimationFrame(() => ScrollTrigger.refresh());
    return () => window.cancelAnimationFrame(id);
  }, [rowCount, data.status]);

  return (
    <motion.div className="overview" variants={stagger(0.06)} initial="hidden" animate="show">
      <div className="overview-left">
        <motion.div variants={fadeUp}><ProgressCard metrics={data.metrics} /></motion.div>
        <motion.div variants={fadeUp}><FleetCard metrics={data.metrics} /></motion.div>
        <motion.div variants={fadeUp} className="overview-grow"><FuelCard route={data.route} metrics={data.metrics} /></motion.div>
      </div>
      <div className="overview-right">
        <motion.section variants={fadeUp} id="map" aria-label="Bin map" className="overview-map">
          <BinMap
            bins={data.bins}
            route={data.route}
            selectedId={spotlight}
            follow={selectedId !== undefined}
            onSelect={onSelect}
            searchInputRef={searchInputRef}
          />
        </motion.section>
        <motion.section variants={fadeUp} id="pickups" aria-label="Pickups" className="overview-grow">
          <PickupsTable bins={data.bins} selectedId={spotlight} onSelect={onSelect} />
        </motion.section>
      </div>
    </motion.div>
  );
}
