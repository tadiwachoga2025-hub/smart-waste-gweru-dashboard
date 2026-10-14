// Resident surface (route key 'report'): report a problem, follow your
// reports, and see public bin status. Residents never see operational data:
// no predictions, sensor internals, routes, trucks or drivers.

import { useCallback, useEffect, useId, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../auth/AuthContext.jsx';
import { createRecord, useList, useNewestFirst } from '../../data/useCollection.js';
import { COMPLAINT_STATUS, COMPLAINT_TYPES, typeLabel } from '../../lib/complaints.js';
import { timeAgo } from '../../lib/format.js';
import { TILES } from '../../lib/tiles.js';
import Icon from '../../components/Icon.jsx';
import {
  Button, DataError, EmptyState, Field, LoadingRows, Notice, Page, PageHead, Panel, Pill, Segmented, Skeleton,
} from '../../components/ui/index.jsx';
import { processPhoto } from './photo.js';
import './citizen.css';

/* ---------- Constants ---------- */

const GWERU = { lat: -19.4543, lng: 29.8037 };
const NOTE_MIN = 10;
const NOTE_MAX = 500;

const TABS = [
  { key: 'report', label: 'Report a problem' },
  { key: 'mine', label: 'My reports' },
  { key: 'bins', label: 'Bin status' },
];

// Labels come from the canonical vocabulary; only the icon is local.
const TYPE_ICONS = { overflowing_bin: 'bin', missed_collection: 'truck', other: 'hazard' };
const TYPES = Object.entries(COMPLAINT_TYPES).map(([key, label]) => ({ key, label, icon: TYPE_ICONS[key] ?? 'hazard' }));

const BANDS = {
  normal: { label: 'Normal', tone: 'ok', glyph: '' },
  high: { label: 'High', tone: 'warning', glyph: '!' },
  critical: { label: 'Critical', tone: 'critical', glyph: '!!' },
};
const bandOf = (bin) => {
  const b = String(bin?.band ?? 'normal').toLowerCase();
  return BANDS[b] ? b : 'normal';
};

// Plain-language progress. Step index 0..3, or 'rejected'. Wording is shared
// with the officer and report screens via lib/complaints.js.
const STEP_KEYS = ['new', 'reviewing', 'assigned', 'resolved'];
const STEP_NAMES = STEP_KEYS.map((k) => COMPLAINT_STATUS[k].label);
const STEP_LINES = STEP_KEYS.map((k) => COMPLAINT_STATUS[k].citizen);
const STEP_TONES = STEP_KEYS.map((k) => COMPLAINT_STATUS[k].tone);

function stepOf(status) {
  const s = String(status ?? 'new').toLowerCase().replace(/[\s-]+/g, '_');
  if (['rejected', 'declined', 'cannot_act'].includes(s)) return 'rejected';
  if (['resolved', 'closed', 'done', 'completed'].includes(s)) return 3;
  if (['dispatched', 'assigned', 'scheduled', 'crew_arranged', 'in_progress', 'crew'].includes(s)) return 2;
  if (['reviewing', 'in_review', 'review', 'under_review', 'acknowledged', 'triaged'].includes(s)) return 1;
  return 0;
}

const distKm = (aLat, aLng, bLat, bLng) => {
  const r = Math.PI / 180;
  const dLat = (bLat - aLat) * r;
  const dLng = (bLng - aLng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// Keyboard nudging: ~15 m per press.
const NUDGE_M = 15;
const M_PER_DEG = 111320;
function nudge(pin, dir) {
  const dLat = NUDGE_M / M_PER_DEG;
  const dLng = NUDGE_M / (M_PER_DEG * Math.max(0.01, Math.cos((pin.lat * Math.PI) / 180)));
  const lat = dir === 'north' ? pin.lat + dLat : dir === 'south' ? pin.lat - dLat : pin.lat;
  const lng = dir === 'east' ? pin.lng + dLng : dir === 'west' ? pin.lng - dLng : pin.lng;
  return { lat: Math.max(-90, Math.min(90, lat)), lng: Math.max(-180, Math.min(180, lng)) };
}

const COORD_RANGE = { lat: 90, lng: 180 };
const COORD_NAME = { lat: 'Latitude', lng: 'Longitude' };
function parseCoord(text, axis) {
  const t = String(text).trim().replace(',', '.');
  if (!t) return { empty: true };
  const n = Number(t);
  const max = COORD_RANGE[axis];
  if (!Number.isFinite(n) || n < -max || n > max) {
    return { error: `${COORD_NAME[axis]} must be a number between -${max} and ${max}, for example ${axis === 'lat' ? '-19.4543' : '29.8037'}.` };
  }
  return { value: n };
}
const fmt5 = (n) => n.toFixed(5);
const fmt4 = (n) => n.toFixed(4);

/* ---------- Leaflet (loaded on demand, so the report form paints fast) ---------- */

let leafletPromise;
function loadLeaflet() {
  leafletPromise ??= Promise.all([import('leaflet'), import('leaflet/dist/leaflet.css')]).then(([m]) => m.default ?? m);
  return leafletPromise;
}

function useLeaflet() {
  const [state, setState] = useState({ L: null, failed: false });
  useEffect(() => {
    let live = true;
    loadLeaflet().then(
      (L) => live && setState({ L, failed: false }),
      () => { leafletPromise = undefined; if (live) setState({ L: null, failed: true }); },
    );
    return () => { live = false; };
  }, []);
  return state;
}

function addTiles(L, map) {
  L.tileLayer(TILES.url, { attribution: TILES.attribution, subdomains: TILES.subdomains, maxZoom: 19 }).addTo(map);
}

function MapShell({ L, failed, tall, children, label }) {
  return (
    <div className={`cz-map${tall ? ' cz-map--tall' : ''}`} role="region" aria-label={label}>
      {failed ? (
        <div className="cz-map-skel">The map could not be loaded. You can still use the text options.</div>
      ) : !L ? (
        <div className="cz-map-skel" role="status">Loading map…</div>
      ) : children}
    </div>
  );
}

/** Small map with a draggable pin. Click the map to move the pin too. */
function PinMap({ pin, onMove }) {
  const { L, failed } = useLeaflet();
  const hostRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const onMoveRef = useRef(onMove);
  useEffect(() => { onMoveRef.current = onMove; });
  const initial = useRef(pin);

  useEffect(() => {
    if (!L || !hostRef.current) return undefined;
    const map = L.map(hostRef.current, { center: [initial.current.lat, initial.current.lng], zoom: 15, scrollWheelZoom: false });
    addTiles(L, map);
    const icon = L.divIcon({
      html: '<span class="cz-pin"></span>', className: 'cz-pin-wrap', iconSize: [28, 28], iconAnchor: [14, 34],
    });
    const marker = L.marker([initial.current.lat, initial.current.lng], {
      icon, draggable: true, title: 'Problem location. Drag to adjust.', alt: 'Problem location pin',
    }).addTo(map);
    marker.on('dragend', () => {
      const p = marker.getLatLng();
      onMoveRef.current({ lat: p.lat, lng: p.lng });
    });
    map.on('click', (e) => {
      marker.setLatLng(e.latlng);
      onMoveRef.current({ lat: e.latlng.lat, lng: e.latlng.lng });
    });
    mapRef.current = map;
    markerRef.current = marker;
    return () => { map.remove(); mapRef.current = null; markerRef.current = null; };
  }, [L]);

  // Follow external changes (geolocation fix) without fighting a drag.
  useEffect(() => {
    const marker = markerRef.current;
    const map = mapRef.current;
    if (!marker || !map) return;
    const cur = marker.getLatLng();
    if (Math.abs(cur.lat - pin.lat) < 1e-7 && Math.abs(cur.lng - pin.lng) < 1e-7) return;
    marker.setLatLng([pin.lat, pin.lng]);
    map.setView([pin.lat, pin.lng], Math.max(map.getZoom(), 16));
  }, [pin.lat, pin.lng]);

  return (
    <MapShell L={L} failed={failed} label="Map for choosing the problem location. Drag the pin or tap the map. Keyboard controls are below the map.">
      <div ref={hostRef} className="cz-map__host" />
    </MapShell>
  );
}

/** Read-only map of public bins, coloured by band. */
function BinsMap({ bins }) {
  const { L, failed } = useLeaflet();
  const hostRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);

  useEffect(() => {
    if (!L || !hostRef.current) return undefined;
    const map = L.map(hostRef.current, { center: [GWERU.lat, GWERU.lng], zoom: 13, scrollWheelZoom: false });
    addTiles(L, map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; layerRef.current = null; };
  }, [L]);

  useEffect(() => {
    const layer = layerRef.current;
    const map = mapRef.current;
    if (!L || !layer || !map) return;
    layer.clearLayers();
    const pts = [];
    bins.forEach((b) => {
      if (!isNum(b.lat) || !isNum(b.lng)) return;
      const band = bandOf(b);
      const icon = L.divIcon({
        html: `<span class="cz-dot cz-dot--${band}" aria-hidden="true">${BANDS[band].glyph}</span>`,
        className: 'cz-dot-wrap', iconSize: [26, 26], iconAnchor: [13, 13],
      });
      L.marker([b.lat, b.lng], { icon, title: `${b.location ?? 'Bin'}: ${BANDS[band].label}`, alt: `${b.location ?? 'Bin'}, ${BANDS[band].label}` }).addTo(layer);
      pts.push([b.lat, b.lng]);
    });
    if (pts.length) map.fitBounds(L.latLngBounds(pts), { padding: [30, 30], maxZoom: 16 });
  }, [L, bins]);

  return (
    <MapShell L={L} failed={failed} tall label="Map of public bins coloured by how full they are. A text list follows.">
      <div ref={hostRef} className="cz-map__host" />
    </MapShell>
  );
}

/* ---------- Keyboard location controls ---------- */

const LOC_MISSING = 'Set the location of the problem: use your location, move the pin, or type latitude and longitude.';
const NUDGES = [
  { dir: 'north', label: 'North', area: 'n' },
  { dir: 'west', label: 'West', area: 'w' },
  { dir: 'east', label: 'East', area: 'e' },
  { dir: 'south', label: 'South', area: 's' },
];

/** Non-pointer ways to set the pin: nudge buttons and exact coordinates. */
function LocationControls({ loc, onMove, missing, ref }) {
  const [draft, setDraft] = useState({ lat: null, lng: null });   // null = show the applied value
  const [errs, setErrs] = useState({ lat: '', lng: '' });
  const latRef = useRef(null);
  const lngRef = useRef(null);

  useImperativeHandle(ref, () => ({
    focus() {
      (errs.lng && !errs.lat && !missing ? lngRef : latRef).current?.focus();
    },
  }), [errs, missing]);

  const shown = (axis) => draft[axis] ?? (loc ? fmt5(loc[axis]) : '');

  const commit = () => {
    if (draft.lat === null && draft.lng === null) return;
    const a = parseCoord(shown('lat'), 'lat');
    const b = parseCoord(shown('lng'), 'lng');
    setErrs({ lat: a.error ?? '', lng: b.error ?? '' });
    if (a.value === undefined || b.value === undefined) return;   // incomplete or invalid: nothing applied
    setDraft({ lat: null, lng: null });
    onMove({ lat: a.value, lng: b.value });
  };

  const onKey = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
  };

  const step = (dir) => {
    setDraft({ lat: null, lng: null });
    setErrs({ lat: '', lng: '' });
    onMove(nudge(loc ?? GWERU, dir));
  };

  return (
    <div className="cz-coords">
      <div role="group" aria-label={`Move pin in steps of ${NUDGE_M} metres`} className="cz-nudge">
        {NUDGES.map((n) => (
          <Button
            key={n.dir}
            variant="ghost"
            className="cz-nudge__btn"
            style={{ gridArea: n.area }}
            aria-label={`Move pin ${n.dir}`}
            onClick={() => step(n.dir)}
          >
            {n.label}
          </Button>
        ))}
        <span className="cz-nudge__step" aria-hidden="true">{NUDGE_M} m</span>
      </div>
      <div className="cz-coords__fields">
        <Field
          ref={latRef}
          label="Latitude"
          inputMode="decimal"
          autoComplete="off"
          value={shown('lat')}
          onChange={(e) => setDraft((d) => ({ ...d, lat: e.target.value, ...(d.lng === null ? { lng: loc ? fmt5(loc.lng) : '' } : {}) }))}
          onBlur={commit}
          onKeyDown={onKey}
          error={errs.lat || missing}
          placeholder="-19.4543"
        />
        <Field
          ref={lngRef}
          label="Longitude"
          inputMode="decimal"
          autoComplete="off"
          value={shown('lng')}
          onChange={(e) => setDraft((d) => ({ ...d, lng: e.target.value, ...(d.lat === null ? { lat: loc ? fmt5(loc.lat) : '' } : {}) }))}
          onBlur={commit}
          onKeyDown={onKey}
          error={errs.lng}
          placeholder="29.8037"
        />
      </div>
      <p className="cz-note cz-coords__help">Type both numbers, then press Enter or move to the next field to apply them.</p>
    </div>
  );
}

/* ---------- Report form ---------- */

const EMPTY_FORM = { type: '', binId: '', note: '', address: '' };

function ReportForm({ onDone }) {
  const { uid, profile } = useAuth();
  const bins = useList('publicBins');
  const [form, setForm] = useState(EMPTY_FORM);
  const [loc, setLoc] = useState(null);                 // set once the resident gives or adjusts a location
  const [geo, setGeo] = useState({ busy: false, msg: '', tone: '' });
  const [photo, setPhoto] = useState(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoErr, setPhotoErr] = useState('');
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState('');
  const fileRef = useRef(null);
  const typesRef = useRef(null);
  const locRef = useRef(null);
  const noteRef = useRef(null);
  const failRef = useRef(null);
  const [failTick, setFailTick] = useState(0);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const errors = {
    type: form.type ? '' : 'Choose what kind of problem this is.',
    loc: loc ? '' : LOC_MISSING,
    note: form.note.trim().length >= NOTE_MIN ? '' : `Please describe the problem in at least ${NOTE_MIN} characters.`,
  };
  useEffect(() => { if (failTick) failRef.current?.focus(); }, [failTick]);
  const noteLen = form.note.trim().length;

  const sortedBins = useMemo(() => {
    const list = bins.items.filter((b) => b.location);
    if (loc) {
      const d = (b) => (isNum(b.lat) && isNum(b.lng) ? distKm(loc.lat, loc.lng, b.lat, b.lng) : Infinity);
      return [...list].sort((a, b) => d(a) - d(b));
    }
    return [...list].sort((a, b) => String(a.location).localeCompare(String(b.location)));
  }, [bins.items, loc]);
  const chosenBin = sortedBins.find((b) => b.id === form.binId);

  // Radiogroup arrow keys: move selection and focus together, wrapping at the ends.
  const onTypeKey = (e) => {
    const delta = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!delta) return;
    e.preventDefault();
    const at = TYPES.findIndex((t) => t.key === form.type);
    const next = TYPES[(at < 0 ? (delta > 0 ? 0 : TYPES.length - 1) : (at + delta + TYPES.length) % TYPES.length)];
    set({ type: next.key });
    e.currentTarget.querySelectorAll('[role="radio"]')[TYPES.indexOf(next)]?.focus();
  };

  const useMyLocation = () => {
    if (!('geolocation' in navigator)) {
      setGeo({ busy: false, tone: 'warning', msg: 'This device cannot share its location. Drag the pin on the map instead.' });
      return;
    }
    setGeo({ busy: true, msg: '', tone: '' });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setGeo({ busy: false, tone: 'ok', msg: 'Location found. Drag the pin if it is not quite right.' });
      },
      (err) => {
        const msg = err.code === 1
          ? 'Location permission was denied. Allow location for this site in your browser settings, or drag the pin on the map.'
          : err.code === 3
            ? 'Finding your location took too long. Try again, or drag the pin on the map.'
            : 'We could not work out where you are. Drag the pin on the map instead.';
        setGeo({ busy: false, tone: 'warning', msg });
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
    );
  };

  const onPick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setPhotoErr('');
    setPhotoBusy(true);
    try {
      setPhoto(await processPhoto(file));
    } catch (err) {
      setPhoto(null);
      setPhotoErr(err?.message || 'We could not use that photo.');
    } finally {
      setPhotoBusy(false);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setTouched(true);
    setFailure('');
    if (errors.type) { typesRef.current?.querySelector('[role="radio"]')?.focus(); return; }
    if (errors.loc) { locRef.current?.focus(); return; }
    if (errors.note) { noteRef.current?.focus(); return; }
    const data = {
      citizenUid: uid,
      citizenName: profile?.name,
      type: form.type,
      binId: form.binId || undefined,
      note: form.note.trim(),
      lat: loc?.lat,
      lng: loc?.lng,
      address: form.address.trim() || undefined,
      photo: photo?.dataUrl,
      status: 'new',
    };
    Object.keys(data).forEach((k) => data[k] === undefined && delete data[k]);   // RTDB rejects undefined
    setSubmitting(true);
    try {
      await createRecord('complaints', data, { action: 'complaint.submit', detail: form.type });
      onDone();
    } catch {
      setFailure('Your report did not go through. Nothing has been lost: check your connection and try again.');
      setFailTick((n) => n + 1);
    } finally {
      setSubmitting(false);
    }
  };

  const pin = loc ?? GWERU;

  return (
    <form className="cz-form" onSubmit={submit} noValidate>
      <fieldset className="cz-group">
        <legend>What is the problem?</legend>
        <div
          ref={typesRef}
          className="cz-types"
          role="radiogroup"
          aria-label="Type of problem"
          aria-required="true"
          aria-invalid={touched && errors.type ? true : undefined}
          aria-describedby={touched && errors.type ? 'cz-type-err' : undefined}
          onKeyDown={onTypeKey}
        >
          {TYPES.map((t, i) => (
            <button
              key={t.key}
              type="button"
              role="radio"
              className="cz-type"
              aria-checked={form.type === t.key}
              tabIndex={form.type === t.key || (!form.type && i === 0) ? 0 : -1}
              onClick={() => set({ type: t.key })}
            >
              <Icon name={t.icon} size={22} />
              {t.label}
            </button>
          ))}
        </div>
        {touched && errors.type && <p className="cz-group__err" id="cz-type-err" role="alert">{errors.type}</p>}
      </fieldset>

      <div className="cz-group">
        <Field
          as="select"
          label="Nearest bin"
          optional
          value={form.binId}
          onChange={(e) => set({ binId: e.target.value })}
          disabled={bins.loading || sortedBins.length === 0}
          hint={loc ? 'Sorted nearest first.' : 'Share your location to see the nearest bins first.'}
        >
          <option value="">
            {bins.loading ? 'Loading bins…' : sortedBins.length ? 'Not sure / no bin involved' : 'No bins to choose from'}
          </option>
          {sortedBins.map((b) => (
            <option key={b.id} value={b.id}>{b.location} ({BANDS[bandOf(b)].label})</option>
          ))}
        </Field>
        {chosenBin && (
          <div className="cz-bin-opt">
            <span>{chosenBin.location}</span>
            <Pill tone={BANDS[bandOf(chosenBin)].tone}>{BANDS[bandOf(chosenBin)].label}</Pill>
          </div>
        )}
        {bins.error && <DataError error={bins.error} />}
      </div>

      <div className="cz-group">
        <span className="cz-label">Where is it?</span>
        <div className="cz-loc-row">
          <Button variant="ghost" icon="locate" onClick={useMyLocation} loading={geo.busy}>Use my current location</Button>
          <p className="cz-loc-state" aria-live="polite">
            {geo.busy
              ? 'Finding you…'
              : loc
                ? `Pin set at ${fmt4(loc.lat)}, ${fmt4(loc.lng)}`
                : 'No location yet: use your location, move the pin, or type coordinates'}
          </p>
        </div>
        {geo.msg && <Notice tone={geo.tone === 'ok' ? 'ok' : 'warning'}>{geo.msg}</Notice>}
        <PinMap pin={pin} onMove={(p) => setLoc(p)} />
        <LocationControls
          ref={locRef}
          loc={loc}
          onMove={(p) => setLoc(p)}
          missing={touched && !loc ? LOC_MISSING : ''}
        />
        <Field
          label="Address or landmark"
          optional
          value={form.address}
          onChange={(e) => set({ address: e.target.value })}
          placeholder="e.g. Opposite the bus rank"
          maxLength={160}
          autoComplete="street-address"
        />
      </div>

      <div className="cz-group">
        <Field
          as="textarea"
          label="Tell us what you see"
          value={form.note}
          onChange={(e) => set({ note: e.target.value.slice(0, NOTE_MAX) })}
          onBlur={() => setTouched(true)}
          error={touched ? errors.note : ''}
          ref={noteRef}
          rows={4}
          required
          placeholder="e.g. The bin has been full for three days and rubbish is on the road."
        />
        <p className={`cz-count${noteLen >= NOTE_MIN ? ' is-ok' : ''}`} aria-live="polite">
          {noteLen >= NOTE_MIN ? `${noteLen} of ${NOTE_MAX} characters` : `${Math.max(0, NOTE_MIN - noteLen)} more characters needed`}
        </p>
      </div>

      <div className="cz-photo">
        <span className="cz-label">Photo <span className="ui-field__opt">optional</span></span>
        <input
          ref={fileRef}
          className="cz-photo__input"
          type="file"
          accept="image/*"
          capture="environment"
          onChange={onPick}
          tabIndex={-1}
          aria-hidden="true"
        />
        {photo ? (
          <div className="cz-photo__prev">
            <img className="cz-photo__img" src={photo.dataUrl} alt="Preview of the photo you added" />
            <div className="cz-photo__meta">
              <span>{Math.max(1, Math.round(photo.bytes / 1024))} KB, ready to send</span>
              <Button size="sm" variant="quiet" icon="trash" onClick={() => { setPhoto(null); setPhotoErr(''); }}>Remove photo</Button>
            </div>
          </div>
        ) : (
          <div>
            <Button variant="ghost" icon="plus" onClick={() => fileRef.current?.click()} loading={photoBusy}>
              {photoBusy ? 'Preparing photo…' : 'Add a photo'}
            </Button>
          </div>
        )}
        {photoErr && <Notice tone="error">{photoErr}</Notice>}
      </div>

      {failure && <Notice ref={failRef} tabIndex={-1} tone="error">{failure}</Notice>}

      <div className="cz-actions">
        <Button type="submit" variant="primary" block loading={submitting} disabled={photoBusy}>Send report</Button>
      </div>
    </form>
  );
}

function Confirmation({ onAgain, onMine, headingId }) {
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <div className="cz-done">
      <span className="cz-done__icon" aria-hidden="true"><Icon name="leaf" size={30} /></span>
      <h2 ref={ref} id={headingId} tabIndex={-1}>Thank you, your report is in</h2>
      <p>The council has received it. You do not need to do anything else.</p>
      <div className="cz-next">
        <h3>What happens next</h3>
        <ol>
          <li>A council officer reviews your report.</li>
          <li>If action is needed, a collection crew is arranged.</li>
          <li>You can follow every step under My reports, and any message from the council appears there.</li>
        </ol>
      </div>
      <div className="cz-actions cz-actions--full">
        <Button variant="ghost" onClick={onAgain}>Report another</Button>
        <Button variant="primary" onClick={onMine}>See my reports</Button>
      </div>
    </div>
  );
}

/* ---------- My reports ---------- */

const seenKey = (uid) => `sw.citizen.seen.${uid}`;
function readSeen(uid) {
  try {
    const raw = window.localStorage.getItem(seenKey(uid));
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}
function writeSeen(uid, map) {
  try {
    window.localStorage.setItem(seenKey(uid), JSON.stringify(map));
  } catch {
    /* storage unavailable: updates simply will not be flagged */
  }
}

function StepBar({ step }) {
  if (step === 'rejected') return null;
  return (
    <ol className="cz-steps" aria-hidden="true">
      {STEP_NAMES.map((n, i) => <li key={n} className={i <= step ? 'is-done' : ''} />)}
    </ol>
  );
}

function ReportCard({ r, updated }) {
  const step = stepOf(r.status);
  const rejected = step === 'rejected';
  return (
    <li className="cz-report">
      <div className="cz-report__body">
        <div className="cz-report__top">
          <span className="cz-report__type">{typeLabel(r.type)}</span>
          {updated && <Pill tone="ok" dot={false}>Updated</Pill>}
          <Pill tone={rejected ? 'muted' : STEP_TONES[step]}>{rejected ? 'Not actioned' : STEP_NAMES[step]}</Pill>
        </div>
        <p className="cz-report__time">Sent {timeAgo(r.createdAt)}</p>
        <p className="cz-report__progress">{rejected ? 'We could not act on this.' : STEP_LINES[step]}</p>
        <StepBar step={step} />
        {r.officerNote && (
          <p className="cz-council"><strong>Message from the council</strong>{r.officerNote}</p>
        )}
      </div>
      {r.photo && <img className="cz-report__thumb" src={r.photo} alt="Photo you attached" loading="lazy" />}
    </li>
  );
}

function MyReports({ onStart }) {
  const { uid } = useAuth();
  const { items, loading, error } = useList('complaints', { where: ['citizenUid', uid], enabled: !!uid });
  const sorted = useNewestFirst(items);
  const [seen] = useState(() => (uid ? readSeen(uid) : {}));   // snapshot from before this visit
  const latest = useRef(items);
  useEffect(() => { latest.current = items; }, [items]);

  // Reports we have never recorded get a baseline so only later changes flag.
  // On leaving the tab, everything shown counts as seen.
  useEffect(() => {
    if (!uid) return undefined;
    return () => {
      const next = { ...readSeen(uid) };
      latest.current.forEach((r) => { next[r.id] = { status: String(r.status ?? 'new'), at: Date.now() }; });
      writeSeen(uid, next);
    };
  }, [uid]);
  useEffect(() => {
    if (!uid || !items.length) return;
    const cur = readSeen(uid);
    let changed = false;
    items.forEach((r) => {
      if (!cur[r.id] && !seen[r.id]) { cur[r.id] = { status: String(r.status ?? 'new'), at: Date.now() }; changed = true; }
    });
    if (changed) writeSeen(uid, cur);
  }, [uid, items, seen]);

  if (loading) return <LoadingRows rows={3} />;
  if (error) return <DataError error={error} />;
  if (!sorted.length) {
    return (
      <EmptyState icon="leaf" title="You have not reported anything yet" action={<Button variant="primary" onClick={onStart}>Report a problem</Button>}>
        Seen an overflowing bin or a missed collection? Tell us and we will keep you updated here.
      </EmptyState>
    );
  }
  return (
    <ul className="cz-list" aria-label="Your reports, newest first">
      {sorted.map((r) => (
        <ReportCard key={r.id} r={r} updated={!!seen[r.id] && seen[r.id].status !== String(r.status ?? 'new')} />
      ))}
    </ul>
  );
}

/* ---------- Bin status ---------- */

function BinStatus() {
  const { items, loading, error } = useList('publicBins');
  const bins = useMemo(() => items.filter((b) => b.location), [items]);
  const list = useMemo(() => [...bins].sort((a, b) => String(a.location).localeCompare(String(b.location))), [bins]);

  if (loading) return <Skeleton height={340} />;
  if (error) return <DataError error={error} />;
  if (!list.length) {
    return <EmptyState icon="bin" title="No bins to show yet">Public bin locations will appear here once they are set up.</EmptyState>;
  }
  return (
    <>
      <BinsMap bins={list} />
      <ul className="cz-legend" aria-label="Map legend">
        {Object.entries(BANDS).map(([k, v]) => (
          <li key={k}><span className={`cz-dot cz-dot--${k}`} aria-hidden="true">{v.glyph}</span>{v.label}</li>
        ))}
      </ul>
      <p className="cz-note">Levels refresh when the collection engine runs, so they may be a little behind.</p>
      <h3 className="ui-panel__title cz-binlist__title">All bins</h3>
      <ul className="cz-binlist">
        {list.map((b) => (
          <li key={b.id}>
            <span>{b.location}</span>
            <Pill tone={BANDS[bandOf(b)].tone}>{BANDS[bandOf(b)].label}</Pill>
          </li>
        ))}
      </ul>
    </>
  );
}

/* ---------- View ---------- */

export default function CitizenView() {
  const [tab, setTab] = useState('report');
  const [done, setDone] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const uid = useId();
  const headingRef = useRef(null);
  const pendingFocus = useRef(false);
  const lastKey = useRef(null);
  const ids = { report: `${uid}-report`, mine: `${uid}-mine`, bins: `${uid}-bins`, done: `${uid}-done` };

  // Move focus into the new panel after a tab change made by Enter or Space.
  // Arrow keys and pointer use leave focus where it is.
  useEffect(() => {
    if (!pendingFocus.current) return;
    pendingFocus.current = false;
    headingRef.current?.focus();
  }, [tab, formKey]);

  const goTab = (key, focus) => {
    if (focus) pendingFocus.current = true;
    setTab(key);
  };
  const toForm = useCallback(() => {
    pendingFocus.current = true;
    setDone(false);
    setFormKey((k) => k + 1);
    setTab('report');
  }, []);
  const toMine = () => { setDone(false); goTab('mine', true); };
  const onTabsKeyDown = (e) => {
    lastKey.current = e.key;
  };
  const onTabsKeyUp = () => {
    window.setTimeout(() => { lastKey.current = null; }, 0);
  };
  const onTabChange = (key) => {
    const viaKey = lastKey.current === 'Enter' || lastKey.current === ' ';
    lastKey.current = null;
    goTab(key, viaKey);
  };

  const reportLabel = done ? ids.done : ids.report;

  return (
    <Page label="Report a problem">
      <div className="cz">
        <PageHead
          eyebrow="Resident"
          title="Report a problem"
          sub="Tell the council about a bin or collection problem and follow what happens."
        />
        <div
          className="cz-tabs"
          onKeyDownCapture={onTabsKeyDown}
          onKeyUpCapture={onTabsKeyUp}
          onPointerDownCapture={() => { lastKey.current = null; }}
        >
          <Segmented options={TABS} value={tab} onChange={onTabChange} label="Resident sections" name="cz-tabs" />
        </div>

        <div className="cz-panels">
          {tab === 'report' && (
            <div role="region" aria-labelledby={reportLabel}>
              {!done && <h2 className="sr-only" id={ids.report} tabIndex={-1} ref={headingRef}>Report a problem form</h2>}
              <Panel title={done ? undefined : 'New report'} note={done ? undefined : 'Takes about a minute'}>
                {done ? (
                  <Confirmation headingId={ids.done} onAgain={toForm} onMine={toMine} />
                ) : (
                  <ReportForm key={formKey} onDone={() => setDone(true)} />
                )}
              </Panel>
            </div>
          )}
          {tab === 'mine' && (
            <div role="region" aria-labelledby={ids.mine}>
              <h2 className="sr-only" id={ids.mine} tabIndex={-1} ref={headingRef}>Your reports</h2>
              <Panel title="My reports"><MyReports onStart={toForm} /></Panel>
            </div>
          )}
          {tab === 'bins' && (
            <div role="region" aria-labelledby={ids.bins}>
              <h2 className="sr-only" id={ids.bins} tabIndex={-1} ref={headingRef}>Public bin status</h2>
              <Panel title="Bin status" note="Public view"><BinStatus /></Panel>
            </div>
          )}
        </div>
      </div>
    </Page>
  );
}
