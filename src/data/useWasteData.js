import { useEffect, useMemo, useState } from 'react';
import { ref, onValue } from 'firebase/database';
import { db } from '../firebase';
import {
  COLLECTED_TODAY,
  DAILY_GOAL_KG,
  DEMO_BINS,
  DEMO_TRUCKS,
  DEPOT,
  FLEET_TYPES,
  FUEL,
  FUEL_HISTORY,
  LIVE_BIN_DEFAULTS,
  WASTE_TYPES,
} from './demo';

const CONNECT_TIMEOUT_MS = 6000;

// Short, stable display code for a bin id ("bin2" -> "#SW-40218").
function binCode(id) {
  let h = 7;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 99991;
  return `#SW-${String(h).padStart(5, '0')}`;
}

// engine.py writes "Critical Now" or "Full in N hours".
function hoursUntilFull(prediction, fillLevel) {
  if (!prediction) return fillLevel >= 90 ? 0 : null;
  if (/critical/i.test(prediction)) return 0;
  const m = /(\d+)\s*hour/i.exec(prediction);
  return m ? Number(m[1]) : null;
}

function sameSpot(a, b) {
  return Math.abs(a[0] - b[0]) < 1e-4 && Math.abs(a[1] - b[1]) < 1e-4;
}

function addHours(date, h) {
  return new Date(date.getTime() + h * 3600 * 1000);
}

const etaFmt = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short' });
const timeFmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });

export function formatEta(date) {
  return `${etaFmt.format(date)}, ${timeFmt.format(date)}`;
}

function statusOf(bin, onRoute) {
  if (onRoute) return 'assigned';
  if (bin.fillLevel >= 90) return 'critical';
  if (bin.fillLevel < 40 && bin.source === 'demo') return 'collected';
  return 'scheduled';
}

export const STATUS_LABEL = {
  critical: 'Needs pickup',
  assigned: 'En route',
  scheduled: 'Scheduled',
  collected: 'Collected',
};

const VEHICLE_FOR_TYPE = { general: 'truck', organic: 'truck', recyclables: 'van', hazardous: 'car' };

/**
 * Live Firebase bins + logistics, merged with labelled demo data.
 * Every derived record carries `source: 'live' | 'demo'`.
 */
export function useWasteData() {
  const [liveBins, setLiveBins] = useState(null);
  const [liveLogistics, setLiveLogistics] = useState(null);
  const [connection, setConnection] = useState('connecting');
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    const tick = window.setInterval(() => setNow(new Date()), 60_000);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      window.clearInterval(tick);
    };
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setConnection((c) => (c === 'connecting' ? 'offline' : c));
    }, CONNECT_TIMEOUT_MS);
    const onError = () => setConnection('error');

    const offBins = onValue(
      ref(db, 'bins'),
      (snap) => {
        const data = snap.val() || {};
        setLiveBins(Object.keys(data).map((key) => ({ id: key, ...data[key] })));
        setConnection('live');
      },
      onError,
    );
    const offLogistics = onValue(
      ref(db, 'logistics'),
      (snap) => setLiveLogistics(snap.val()),
      onError,
    );
    return () => {
      window.clearTimeout(timeout);
      offBins();
      offLogistics();
    };
  }, []);

  return useMemo(() => {
    // ---- Bins -------------------------------------------------------------
    const live = (liveBins || []).map((b) => ({
      ...LIVE_BIN_DEFAULTS[b.id],
      area: LIVE_BIN_DEFAULTS[b.id]?.area ?? 'Gweru',
      wasteType: LIVE_BIN_DEFAULTS[b.id]?.wasteType ?? 'general',
      capacityKg: LIVE_BIN_DEFAULTS[b.id]?.capacityKg ?? 120,
      ...b,
      fillLevel: Number(b.fillLevel) || 0,
      source: 'live',
    }));
    const demo = DEMO_BINS.map((b) => ({
      ...b,
      prediction: b.fillLevel >= 90 ? 'Critical Now' : `Full in ${Math.max(1, Math.round(((90 - b.fillLevel) / 8) * 24))} hours`,
      lastUpdated: 'Simulated',
      source: 'demo',
    }));

    const liveRoute = Array.isArray(liveLogistics?.activeRoute) ? liveLogistics.activeRoute : [];
    const resources = liveLogistics?.resources ?? null;

    const bins = [...live, ...demo].map((b) => {
      const onRoute = liveRoute.some((p) => sameSpot(p, [b.lat, b.lng]));
      const hours = hoursUntilFull(b.prediction, b.fillLevel);
      return {
        ...b,
        code: binCode(b.id),
        onRoute,
        hoursUntilFull: hours,
        estKg: Math.round((b.fillLevel / 100) * b.capacityKg),
        status: statusOf(b, onRoute),
      };
    });

    // ---- Route ------------------------------------------------------------
    const routeBins = bins.filter((b) => b.onRoute);
    const route = {
      coords: [[DEPOT.lat, DEPOT.lng], ...liveRoute],
      depot: DEPOT,
      distanceKm: resources?.routeDistanceKm ?? 0,
      fuelLitres: resources?.estimatedFuelLiters ?? 0,
      trucks: resources?.trucksAllocated ?? 0,
      binsToCollect: resources?.binsToCollect ?? routeBins.length,
      source: liveLogistics ? 'live' : 'demo',
    };

    // ---- Pickups (the "Orders" table) -------------------------------------
    const pickups = bins
      .map((b, i) => {
        let eta;
        if (b.status === 'collected') eta = addHours(now, -(1 + (i % 4)));
        else if (b.status === 'assigned') eta = addHours(now, 0.75 + routeBins.indexOf(b) * 0.4);
        else if (b.status === 'critical') eta = addHours(now, 2 + (i % 3));
        else eta = addHours(now, Math.max(3, (b.hoursUntilFull ?? 24) - 6));
        return {
          id: `pk-${b.id}`,
          code: b.code,
          binId: b.id,
          location: b.location,
          area: b.area,
          wasteType: b.wasteType,
          wasteLabel: WASTE_TYPES.find((w) => w.key === b.wasteType)?.label ?? 'General',
          from: { name: DEPOT.name, area: DEPOT.area },
          to: { name: b.location, area: b.area },
          weightKg: b.estKg,
          fillLevel: b.fillLevel,
          eta,
          etaLabel: formatEta(eta),
          status: b.status,
          statusLabel: STATUS_LABEL[b.status],
          vehicle: VEHICLE_FOR_TYPE[b.wasteType] ?? 'truck',
          source: b.source,
        };
      })
      .sort((a, b) => {
        const order = { critical: 0, assigned: 1, scheduled: 2, collected: 3 };
        return order[a.status] - order[b.status] || b.fillLevel - a.fillLevel;
      });

    // ---- Collection progress ---------------------------------------------
    const byType = WASTE_TYPES.map((w) => ({ ...w, kg: COLLECTED_TODAY[w.key] ?? 0 }));
    const collectedKg = byType.reduce((s, t) => s + t.kg, 0);
    const progress = {
      collectedKg,
      goalKg: DAILY_GOAL_KG,
      pct: Math.min(100, Math.round((collectedKg / DAILY_GOAL_KG) * 100)),
      byType,
      source: 'demo',
    };

    // ---- Fleet ------------------------------------------------------------
    const fleetTypes = FLEET_TYPES.map((t) => {
      // Live engine reports compactors needed today; never show fewer deployed.
      const deployed = t.key === 'compactor' && resources ? Math.max(t.deployed, resources.trucksAllocated) : t.deployed;
      return { ...t, deployed, pct: Math.round((deployed / t.total) * 100) };
    });
    const fleet = {
      types: fleetTypes,
      totalVehicles: fleetTypes.reduce((s, t) => s + t.total, 0),
      deployed: fleetTypes.reduce((s, t) => s + t.deployed, 0),
      source: 'demo',
    };

    // ---- Fuel -------------------------------------------------------------
    const fuel = {
      ...FUEL,
      history: FUEL_HISTORY,
      routeLitres: route.fuelLitres,
      source: 'demo',
    };

    // ---- Trucks (Fleet view) ---------------------------------------------
    const trucks = DEMO_TRUCKS.map((t) =>
      t.id === 'GW-TRK-311' && liveRoute.length
        ? { ...t, routeCoords: route.coords, stops: Math.max(1, routeBins.length), liveRoute: true }
        : t,
    );

    const status = !isOnline ? 'offline' : connection;
    const liveCount = live.length;

    return { status, isOnline, now, bins, liveCount, route, pickups, progress, fleet, fuel, trucks };
  }, [liveBins, liveLogistics, connection, isOnline, now]);
}
