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

/**
 * Live Firebase bins + logistics.
 * Returns { status, isOnline, liveCount, bins, route, metrics }.
 */
export function useWasteData() {
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
    const timeout = window.setTimeout(() => {
      setConnection((c) => (c === 'connecting' ? 'offline' : c));
    }, CONNECT_TIMEOUT_MS);
    const onError = () => setConnection('error');

    const offBins = onValue(
      ref(db, 'bins'),
      (snapshot) => {
        const data = snapshot.val();
        if (data) setRawBins(Object.keys(data).map((key) => ({ id: key, ...data[key] })));
        else setRawBins([]);
        setConnection('live');
      },
      onError,
    );
    const offLogistics = onValue(
      ref(db, 'logistics'),
      (snapshot) => {
        const data = snapshot.val();
        if (data) setLogistics(data);
      },
      onError,
    );
    return () => {
      window.clearTimeout(timeout);
      offBins();
      offLogistics();
    };
  }, []);

  return useMemo(() => {
    const activeRoute = Array.isArray(logistics?.activeRoute) ? logistics.activeRoute : [];
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
        lat: Number(b.lat),
        lng: Number(b.lng),
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

    const status = !isOnline ? 'offline' : connection;
    return { status, isOnline, liveCount: bins.length, loaded: rawBins !== null, bins, route, metrics };
  }, [rawBins, logistics, connection, isOnline]);
}
