// Pure helpers for the Fleet view (no React).

export const STATUS = {
  delayed: { label: 'Delayed', tone: 'critical' },
  transit: { label: 'In transit', tone: 'ok' },
  done: { label: 'Completed', tone: 'muted' },
  awaiting: { label: 'Awaiting driver', tone: 'muted' },
};

const PLACES = [
  ['depot', [-19.4867, 29.8213]],
  ['msu', [-19.516, 29.84]],
  ['senga', [-19.506, 29.832]],
  ['nehosho', [-19.497, 29.83]],
  ['cbd', [-19.4567, 29.8164]],
  ['mkoba', [-19.468, 29.775]],
  ['ascot', [-19.44, 29.8]],
  ['landfill', [-19.43, 29.85]],
];

export function placeCoord(name = '') {
  const n = name.toLowerCase();
  const hit = PLACES.find(([k]) => n.includes(k));
  return hit ? hit[1] : PLACES[0][1];
}

function hash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i += 1) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// Quadratic bezier between two points, bowed sideways by `bow`.
function curve(a, b, bow, sign, n = 28) {
  const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const ctrl = [mid[0] - dy * bow * sign, mid[1] + dx * bow * sign];
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n;
    const u = 1 - t;
    return [
      u * u * a[0] + 2 * u * t * ctrl[0] + t * t * b[0],
      u * u * a[1] + 2 * u * t * ctrl[1] + t * t * b[1],
    ];
  });
}

// Returns { current, optimized } polylines for a truck.
export function routesFor(truck) {
  if (truck.liveRoute && truck.routeCoords && truck.routeCoords.length > 1) {
    const c = truck.routeCoords;
    const opt = c.filter((_, i) => i % 2 === 0 || i === c.length - 1);
    return { current: c, optimized: opt.length > 1 ? opt : c };
  }
  const a = placeCoord(truck.from);
  let b = placeCoord(truck.to);
  if (a[0] === b[0] && a[1] === b[1]) b = [b[0] + 0.01, b[1] + 0.01];
  const sign = hash(truck.id) % 2 ? 1 : -1;
  return { current: curve(a, b, 0.22, sign), optimized: curve(a, b, 0.05, sign) };
}

function segLen(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

// Splits a polyline at fraction t of its length.
export function splitAt(coords, t) {
  const clamped = Math.min(1, Math.max(0, t));
  const total = coords.slice(1).reduce((s, p, i) => s + segLen(coords[i], p), 0);
  let target = total * clamped;
  const done = [coords[0]];
  for (let i = 1; i < coords.length; i += 1) {
    const l = segLen(coords[i - 1], coords[i]);
    if (target <= l || i === coords.length - 1) {
      const f = l === 0 ? 0 : Math.min(1, target / l);
      const pos = [
        coords[i - 1][0] + (coords[i][0] - coords[i - 1][0]) * f,
        coords[i - 1][1] + (coords[i][1] - coords[i - 1][1]) * f,
      ];
      done.push(pos);
      return { done, rest: [pos, ...coords.slice(i)], pos };
    }
    target -= l;
    done.push(coords[i]);
  }
  return { done: coords, rest: [], pos: coords[coords.length - 1] };
}

export function toMin(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export function fmtDur(min) {
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60);
  return h ? `${h}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`;
}

export function fmtClock(min) {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

// Alternative-route suggestion numbers. Live truck uses engine route figures.
export function suggestionFor(truck, route) {
  const dep = toMin(truck.departed);
  const eta = toMin(truck.eta);
  const curMin = dep != null && eta != null && eta > dep ? eta - dep : Math.round(truck.distanceKm * 4.5);
  const saved = Math.max(4, Math.round(curMin * 0.1));
  const live = !!truck.liveRoute;
  const liveKm = live && route && route.distanceKm > 0 ? route.distanceKm : null;
  const liveFuel = live && route && route.fuelLitres > 0 ? route.fuelLitres : null;
  const km = liveKm ?? truck.distanceKm;
  const fuelUsd = liveFuel != null ? liveFuel * 0.09 * 1.55 : truck.distanceKm * 0.18;
  const co2 = live ? 9 : 6 + (hash(truck.id) % 6);
  return {
    live,
    savedMin: saved,
    curMin,
    optMin: curMin - saved,
    fuelUsd: Math.max(1, Math.round(fuelUsd)),
    co2,
    km,
  };
}

export function adjustedEta(truck, applied, savedMin) {
  const eta = toMin(truck.eta);
  if (!applied || eta == null) return truck.eta;
  return fmtClock(eta - savedMin);
}

export function healthText(label, v) {
  const pct = Math.round(v * 100);
  if (label === 'brakes') {
    if (v < 0.5) return 'Heavy wear, service now';
    if (v < 0.85) return 'Above-baseline wear, service within 1,200 km';
    return 'Within baseline, no action needed';
  }
  if (label === 'tires') return v < 0.5 ? `Needs attention soon (~${pct}% remaining)` : `Good tread (~${pct}% remaining)`;
  return v < 0.5 ? `Service due soon (~${pct}% remaining)` : `Scheduled service (~${pct}% remaining)`;
}

// 12 compartments (2 x 6). Returns [{ id, kg, empty, flagged }].
export function buildSlots(truck) {
  const flagged = truck.liveRoute || truck.status === 'delayed';
  const used = Math.min(12, Math.max(0, Math.round((truck.loadKg / truck.capacityKg) * 12)));
  const n = flagged ? Math.max(used, 7) : used;
  const emptyIdx = new Set();
  for (let i = 11; emptyIdx.size < 12 - n && i >= 0; i -= 1) if (!(flagged && i === 5)) emptyIdx.add(i);
  const filled = 12 - emptyIdx.size;
  const weights = Array.from({ length: 12 }, (_, i) => 1 - i * 0.025);
  const wSum = weights.reduce((s, w, i) => s + (emptyIdx.has(i) ? 0 : w), 0) || 1;
  return Array.from({ length: 12 }, (_, i) => ({
    id: `C-${String(i + 1).padStart(2, '0')}`,
    empty: emptyIdx.has(i),
    flagged: flagged && i === 5,
    kg: emptyIdx.has(i) ? 0 : Math.round((truck.loadKg * weights[i]) / wSum / 10) * 10,
    filled,
  }));
}
