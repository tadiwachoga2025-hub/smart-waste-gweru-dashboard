import { useEffect, useMemo, useState } from 'react';
import { ref, onValue } from 'firebase/database';
import { db } from '../firebase';

// Everything here comes from Firebase: `bins` (ESP32 sensors + predictions
// written by engine.py) and `logistics` (route + resources from engine.py).
// No seeded or demo data.

const CONNECT_TIMEOUT_MS = 6000;

// Mirrors the constants engine.py uses, so the UI can explain its numbers.
export const ENGINE_RULES = {
  binsPerTruck: 10,          // trucks_required = ceil(bins / 10)
  litresPerKm: 0.5,          // fuel_estimate = distance_km * 0.5
  collectAtFill: 80,         // flagged if fill >= 80%
  collectWithinHours: 12,    // ...or predicted full in < 12 hours
  criticalFill: 90,          // "Critical Now" at >= 90%
};

// Same thresholds the original dashboard used for its fill bars.
export function fillTone(fill) {
  if (fill >= 90) return 'critical';
  if (fill >= 75) return 'warning';
  return 'ok';
}

export const STATUS_LABEL = {
  critical: 'Critical',
  route: 'On route',
  due: 'Due soon',
  normal: 'Normal',
};

function sameSpot(a, b) {
  return Math.abs(a[0] - b[0]) < 1e-4 && Math.abs(a[1] - b[1]) < 1e-4;
}

function statusOf(fill, onRoute) {
  if (onRoute) return 'route';
  if (fill >= 90) return 'critical';
  if (fill >= 75) return 'due';
  return 'normal';
}

// Number(null) and Number('') are both 0, which would plant a "missing
// location" bin at (0, 0) in the Atlantic. Keep missing values as NaN so the
// finite-pair filters downstream (map pins, stop matching, job snapshots)
// drop them instead of plotting them.
function coordOrNaN(v) {
  return v == null || v === '' ? NaN : Number(v);
}

/**
 * Live Firebase bins + logistics.
 * Returns { status, isOnline, liveCount, bins, route, metrics }.
 */
export function useWasteData({ bins: wantBins = true, logistics: wantLogistics = true } = {}) {
  const [rawBins, setRawBins] = useState(null);
  const [logistics, setLogistics] = useState(null);
  const [connection, setConnection] = useState('connecting');
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);

  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  useEffect(() => {
    // Roles without access to a feed never subscribe (the rules would refuse
    // it and the dashboard would show a false "feed error").
    if (!wantBins && !wantLogistics) return undefined;
    const timeout = window.setTimeout(() => {
      setConnection((c) => (c === 'connecting' ? 'offline' : c));
    }, CONNECT_TIMEOUT_MS);
    const onError = () => setConnection('error');

    const offBins = wantBins
      ? onValue(
          ref(db, 'bins'),
          (snapshot) => {
            const data = snapshot.val();
            if (data) setRawBins(Object.keys(data).map((key) => ({ id: key, ...data[key] })));
            else setRawBins([]);
            setConnection('live');
          },
          onError,
        )
      : () => {};
    const offLogistics = wantLogistics
      ? onValue(
          ref(db, 'logistics'),
          (snapshot) => {
            const data = snapshot.val();
            if (data) setLogistics(data);
          },
          onError,
        )
      : () => {};
    return () => {
      window.clearTimeout(timeout);
      offBins();
      offLogistics();
    };
  }, [wantBins, wantLogistics]);

  return useMemo(() => {
    // Route points may be hand-edited or partially written: coerce to finite
    // [lat, lng] pairs and drop the rest. One bad point must never break the
    // map polyline or the stop matching below it.
    const rawRoute = Array.isArray(logistics?.activeRoute) ? logistics.activeRoute : [];
    const activeRoute = rawRoute
      .map((p) => [Number(p?.[0]), Number(p?.[1])])
      .filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
    const resources = logistics?.resources ?? {};

    const bins = (rawBins ?? []).map((b) => {
      const fillLevel = Number(b.fillLevel) || 0;
      const routeOrder = activeRoute.findIndex((p) => sameSpot(p, [b.lat, b.lng]));
      const onRoute = routeOrder !== -1;
      const status = statusOf(fillLevel, onRoute);
      return {
        id: b.id,
        code: `#${String(b.id).toUpperCase()}`,
        location: b.location ?? b.id,
        lat: coordOrNaN(b.lat),
        lng: coordOrNaN(b.lng),
        fillLevel,
        prediction: b.prediction || 'Pending',
        lastUpdated: b.lastUpdated || '—',
        onRoute,
        routeOrder: onRoute ? routeOrder : null,
        status,
        statusLabel: STATUS_LABEL[status],
        tone: fillTone(fillLevel),
      };
    });

    // Route stops in the order engine.py optimised them.
    const stops = activeRoute
      .map((p, i) => ({ order: i, coords: p, bin: bins.find((b) => sameSpot(p, [b.lat, b.lng])) ?? null }));

    const route = {
      coords: activeRoute,
      stops,
      distanceKm: Number(resources.routeDistanceKm) || 0,
      fuelLitres: Number(resources.estimatedFuelLiters) || 0,
      trucks: Number(resources.trucksAllocated) || 0,
      binsToCollect: Number(resources.binsToCollect) || 0,
      hasData: Boolean(logistics),
      // Server-free plan age: the engine stamps logistics.updatedAt each cycle.
      updatedAt: Number(logistics?.updatedAt) || null,
    };

    const criticalBins = bins.filter((b) => b.fillLevel >= ENGINE_RULES.criticalFill).length;
    const avgFill = bins.length ? Math.round(bins.reduce((s, b) => s + b.fillLevel, 0) / bins.length) : 0;

    const metrics = {
      activeBins: bins.length,
      trucksAllocated: route.trucks,
      routeDistanceKm: route.distanceKm,
      criticalBins,
      binsToCollect: route.binsToCollect,
      estimatedFuelLiters: route.fuelLitres,
      avgFill,
      // Distribution of bins across the original fill bands.
      bands: [
        { key: 'critical', label: 'Critical', range: '90–100%', count: bins.filter((b) => b.fillLevel >= 90).length },
        { key: 'high', label: 'High', range: '75–89%', count: bins.filter((b) => b.fillLevel >= 75 && b.fillLevel < 90).length },
        { key: 'medium', label: 'Medium', range: '40–74%', count: bins.filter((b) => b.fillLevel >= 40 && b.fillLevel < 75).length },
        { key: 'low', label: 'Low', range: '0–39%', count: bins.filter((b) => b.fillLevel < 40).length },
      ].map((band) => ({ ...band, pct: bins.length ? Math.round((band.count / bins.length) * 100) : 0 })),
    };

    const status = !wantBins && !wantLogistics ? 'idle' : !isOnline ? 'offline' : connection;
    return { status, isOnline, liveCount: bins.length, loaded: rawBins !== null, bins, route, metrics };
  }, [rawBins, logistics, connection, isOnline, wantBins, wantLogistics]);
}
