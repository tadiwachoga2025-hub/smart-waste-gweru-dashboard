import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../auth/AuthContext.jsx';
import { createRecord, patchRecord, setRecord, useList, useNewestFirst } from '../../data/useCollection.js';
import { fillTone } from '../../data/useWasteData.js';
import { formatDateTime, plural, timeAgo, toMs } from '../../lib/format.js';
import {
  Button, DataError, EmptyState, Field, LoadingRows, Modal, Notice, Page, PageHead, Panel,
  Pill, Segmented, Stat, Stats, useToast,
} from '../../components/ui/index.jsx';
import './technician.css';

const STALE_MS = 30 * 60 * 1000;
const EARLIEST_PLAUSIBLE = Date.UTC(2015, 0, 1);
const DAY_MS = 24 * 60 * 60 * 1000;

const DEVICE_STATUS = {
  active: { label: 'Active', tone: 'ok' },
  faulty: { label: 'Faulty', tone: 'critical' },
  replaced: { label: 'Replaced', tone: 'info' },
  retired: { label: 'Retired', tone: 'muted' },
  unregistered: { label: 'Unregistered', tone: 'warning' },
};
const FRESH = {
  fresh: { label: 'Fresh', tone: 'ok' },
  stale: { label: 'Stale', tone: 'warning' },
  unknown: { label: 'Unknown', tone: 'muted' },
};
const FEED_LABEL = { live: 'Live', offline: 'Offline', error: 'Feed error', connecting: 'Connecting', idle: 'Not subscribed' };
const MAINT_TYPES = [
  { key: 'inspection', label: 'Inspection' },
  { key: 'repair', label: 'Repair' },
  { key: 'replacement', label: 'Replacement' },
  { key: 'calibration', label: 'Calibration' },
];
const TYPE_LABEL = { ...Object.fromEntries(MAINT_TYPES.map((t) => [t.key, t.label])), report: 'Fault report' };

/** Reading time as epoch ms, or null when the ESP32 string is missing or implausible. */
function readingMs(value, now) {
  const t = toMs(value);
  if (t == null || !Number.isFinite(t) || t < EARLIEST_PLAUSIBLE || t > now + DAY_MS) return null;
  return t;
}

function hasCoords(b) {
  return Number.isFinite(b.lat) && Number.isFinite(b.lng) && !(b.lat === 0 && b.lng === 0);
}

/** Plain-language problems for one bin (shared by the table flags and the check). */
function binProblems(bin, device, now) {
  const problems = [];
  const t = readingMs(bin.lastUpdated, now);
  if (bin.lastUpdated === '—' || bin.lastUpdated == null || bin.lastUpdated === '') problems.push('No reading has ever arrived from this bin.');
  else if (t == null) problems.push('The last reading time is not readable, so freshness is unknown.');
  else if (now - t > STALE_MS) problems.push(`No reading for ${timeAgo(t, now).replace(' ago', '')} (over 30 minutes).`);
  if (bin.fillLevel < 0 || bin.fillLevel > 100) problems.push(`Impossible fill value of ${bin.fillLevel}%.`);
  if (!hasCoords(bin)) problems.push('Coordinates are missing, so the bin cannot be placed on the map.');
  if (!device) problems.push('No device is registered for this bin.');
  else if (device.status === 'faulty') problems.push('The device is marked faulty.');
  return problems;
}

function describe(bin, device, now) {
  const t = readingMs(bin.lastUpdated, now);
  const freshness = t == null ? 'unknown' : now - t > STALE_MS ? 'stale' : 'fresh';
  const anomaly = bin.fillLevel < 0 || bin.fillLevel > 100;
  const status = device?.status && DEVICE_STATUS[device.status] ? device.status : device ? 'active' : 'unregistered';
  return { bin, device, time: t, freshness, anomaly, status };
}

export default function DevicesView({ data }) {
  const { can, profile, uid } = useAuth();
  const toast = useToast();
  const full = can('sensors.manage');
  const bins = useMemo(() => data?.bins ?? [], [data?.bins]);

  const devicesQ = useList('devices');
  const maintQ = useList('maintenance');
  const maintenance = useNewestFirst(maintQ.items);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60000);
    return () => window.clearInterval(id);
  }, []);

  const deviceById = useMemo(() => {
    const m = new Map();
    devicesQ.items.forEach((d) => m.set(d.id, d));
    return m;
  }, [devicesQ.items]);

  const rows = useMemo(
    () => bins.map((b) => describe(b, deviceById.get(b.id), now)),
    [bins, deviceById, now],
  );

  const needsAttention = (r) =>
    r.status === 'faulty' || r.status === 'unregistered' || r.freshness !== 'fresh' || r.anomaly || !hasCoords(r.bin);

  const counts = useMemo(() => ({
    registered: rows.filter((r) => r.device).length,
    normal: rows.filter((r) => r.device && r.status === 'active' && r.freshness === 'fresh' && !r.anomaly).length,
    stale: rows.filter((r) => r.freshness === 'stale').length,
    faulty: rows.filter((r) => r.status === 'faulty').length,
    unregistered: rows.filter((r) => !r.device).length,
    attention: rows.filter(needsAttention).length,
  }), [rows]);

  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === 'attention' && !needsAttention(r)) return false;
      if (filter === 'faulty' && r.status !== 'faulty') return false;
      if (filter === 'stale' && r.freshness !== 'stale') return false;
      if (filter === 'unregistered' && r.device) return false;
      if (!q) return true;
      return [r.bin.code, r.bin.location, r.device?.model].some((s) => String(s ?? '').toLowerCase().includes(q));
    });
  }, [rows, filter, search]);

  /* ---------- Firebase check ---------- */
  const [check, setCheck] = useState(null);
  const latest = useMemo(() => {
    const times = rows.map((r) => r.time).filter((t) => t != null);
    return times.length ? Math.max(...times) : null;
  }, [rows]);
  const runCheck = () => {
    const at = Date.now();
    const found = bins
      .map((b) => ({ bin: b, problems: binProblems(b, deviceById.get(b.id), at) }))
      .filter((x) => x.problems.length > 0);
    setCheck({ at, total: bins.length, found });
  };

  /* ---------- Modals ---------- */
  const [modal, setModal] = useState(null); // { kind: 'register'|'maintain'|'history'|'report', binId? }
  const close = useCallback(() => setModal(null), []);
  const modalBin = modal?.binId ? bins.find((b) => b.id === modal.binId) : null;

  const loading = devicesQ.loading || maintQ.loading || (!data?.loaded && data?.status === 'connecting');
  const feedError = devicesQ.error || maintQ.error;
  const unregisteredBins = bins.filter((b) => !deviceById.has(b.id));

  return (
    <Page label="Devices" wide>
      <PageHead
        eyebrow={full ? 'IoT technician' : 'Sensor faults'}
        title="Devices"
        sub="Sensor health and maintenance."
        actions={full
          ? <Button variant="primary" icon="bin" onClick={() => setModal({ kind: 'register' })} disabled={unregisteredBins.length === 0}>Register device</Button>
          : <Button variant="primary" icon="hazard" onClick={() => setModal({ kind: 'report' })} disabled={bins.length === 0}>Report a fault</Button>}
      />

      {!full && <Notice tone="info">You can view device health and report a fault. A technician will log the repair.</Notice>}
      <DataError error={feedError} />

      <Stats>
        <Stat label="Devices registered" value={counts.registered} />
        <Stat label="Reporting normally" value={counts.normal} tone="ok" />
        <Stat label="Stale" value={counts.stale} tone={counts.stale ? 'warning' : undefined} hint="No reading in over 30 minutes" />
        <Stat label="Faulty" value={counts.faulty} tone={counts.faulty ? 'critical' : undefined} />
        <Stat label="Bins with no device" value={counts.unregistered} tone={counts.unregistered ? 'warning' : undefined} />
      </Stats>

      <Panel title="Verify data is reaching Firebase" note="Checks every bin from what this screen has received">
        <div className="tech-check">
          <dl className="tech-check__facts">
            <div>
              <dt>Feed status</dt>
              <dd>{FEED_LABEL[data?.status] ?? 'Unknown'}</dd>
            </div>
            <div>
              <dt>Most recent reading</dt>
              <dd>{latest ? `${timeAgo(latest, now)} (${formatDateTime(latest)})` : 'No readable reading time'}</dd>
            </div>
          </dl>
          <Button variant="ghost" icon="locate" onClick={runCheck} disabled={bins.length === 0}>Run check</Button>
        </div>
        <div aria-live="polite">
          {check && (check.found.length === 0 ? (
            <div style={{ marginTop: 'var(--sp-4)' }}>
              <Notice tone="ok">All {plural(check.total, 'bin')} look healthy as of {formatDateTime(check.at)}.</Notice>
            </div>
          ) : (
            <>
              <p className="ui-muted" style={{ margin: 'var(--sp-4) 0 0' }}>
                {plural(check.found.length, 'bin')} of {check.total} need attention (checked {formatDateTime(check.at)}).
              </p>
              <ul className="tech-problems">
                {check.found.map(({ bin, problems }) => (
                  <li key={bin.id}>
                    <strong>{bin.code}</strong> <span className="ui-muted">{bin.location}</span>
                    <ul>{problems.map((p) => <li key={p}>{p}</li>)}</ul>
                  </li>
                ))}
              </ul>
            </>
          ))}
        </div>
      </Panel>

      <Panel title="Bins and sensors" flush>
        {loading ? (
          <LoadingRows rows={5} />
        ) : bins.length === 0 ? (
          <EmptyState icon="bin" title="No bins yet">
            Sensors appear here when they first report to Firebase. Once a bin sends a reading you can register its device.
          </EmptyState>
        ) : (
          <>
            {counts.registered === 0 && full && (
              <div className="tech-readonly" style={{ marginBottom: 'var(--sp-3)' }}>
                <EmptyState icon="bin" title="No devices registered" action={<Button variant="primary" onClick={() => setModal({ kind: 'register' })}>Register device</Button>}>
                  Bins are reporting, but none has a device record. Register one to track its model, firmware and maintenance.
                </EmptyState>
              </div>
            )}
            {counts.registered === 0 && !full && (
              <div className="tech-readonly" style={{ marginBottom: 'var(--sp-3)' }}>
                <Notice tone="warning">No devices are registered yet. A technician needs to register them.</Notice>
              </div>
            )}
            <div className="tech-toolbar">
              <Segmented
                name="tech-filter"
                label="Filter bins"
                value={filter}
                onChange={setFilter}
                options={[
                  { key: 'all', label: 'All', count: rows.length },
                  { key: 'attention', label: 'Needs attention', count: counts.attention },
                  { key: 'faulty', label: 'Faulty', count: counts.faulty },
                  { key: 'stale', label: 'Stale', count: counts.stale },
                  { key: 'unregistered', label: 'Unregistered', count: counts.unregistered },
                ]}
              />
              <div className="tech-toolbar__search">
                <Field label="Search bins" as="input" type="search" placeholder="Code, location or model" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
            </div>
            {visible.length === 0 ? (
              <EmptyState icon="search" title="No bins match">Try a different filter or search.</EmptyState>
            ) : (
              <div className="ui-tablewrap" style={{ marginTop: 'var(--sp-3)' }}>
                <table className="ui-table ui-table--stack">
                  <caption className="sr-only">
                    Bin sensors and device status
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Bin</th>
                      <th scope="col">Device</th>
                      <th scope="col">Last reading</th>
                      <th scope="col">Fill level</th>
                      <th scope="col">Prediction (diagnostic)</th>
                      <th scope="col"><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((r) => {
                      const { bin, device } = r;
                      const st = DEVICE_STATUS[r.status];
                      const fr = FRESH[r.freshness];
                      const pct = Math.max(0, Math.min(100, Number(bin.fillLevel) || 0));
                      return (
                        <tr key={bin.id}>
                          <td data-label="Bin">
                            <span><span className="ui-cell-strong">{bin.code}</span><span className="ui-cell-sub">{bin.location}</span></span>
                          </td>
                          <td data-label="Device">
                            <span style={{ display: 'grid', gap: 'var(--sp-1)', justifyItems: 'start' }}>
                              {device && <span className="ui-cell-sub">{[device.model, device.firmware && `fw ${device.firmware}`].filter(Boolean).join(' · ') || 'No model recorded'}</span>}
                              <Pill tone={st.tone}>{st.label}</Pill>
                            </span>
                          </td>
                          <td data-label="Last reading">
                            <span style={{ display: 'grid', gap: 'var(--sp-1)', justifyItems: 'start' }}>
                              <span>{r.time ? timeAgo(r.time, now) : 'Unknown'}</span>
                              <Pill tone={fr.tone}>{fr.label}</Pill>
                            </span>
                          </td>
                          <td data-label="Fill level">
                            <span className="tech-fill">
                              <span className="tech-fill__num">{Number.isFinite(bin.fillLevel) ? `${bin.fillLevel}%` : 'Unknown'}</span>
                              <span className={`ui-fillbar ui-fillbar--${fillTone(pct)}`} role="img" aria-label={`Fill ${pct}%`}><i style={{ width: `${pct}%` }} /></span>
                              {r.anomaly && <span className="tech-flag">Impossible value</span>}
                            </span>
                          </td>
                          <td data-label="Prediction (diagnostic)">{bin.prediction}</td>
                          <td data-label="Actions">
                            <div className="ui-table__actions">
                              {full ? (
                                device ? (
                                  <>
                                    <Button size="sm" onClick={() => setModal({ kind: 'maintain', binId: bin.id })}>Log maintenance</Button>
                                    <Button size="sm" variant="quiet" onClick={() => setModal({ kind: 'history', binId: bin.id })} aria-label={`History for ${bin.code}`}>History</Button>
                                  </>
                                ) : (
                                  <Button size="sm" variant="primary" onClick={() => setModal({ kind: 'register', binId: bin.id })}>Register device</Button>
                                )
                              ) : (
                                <>
                                  <Button size="sm" onClick={() => setModal({ kind: 'report', binId: bin.id })} aria-label={`Report a fault on ${bin.code}`}>Report a fault</Button>
                                  <Button size="sm" variant="quiet" onClick={() => setModal({ kind: 'history', binId: bin.id })} aria-label={`History for ${bin.code}`}>History</Button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </Panel>

      <RegisterModal
        open={modal?.kind === 'register'}
        onClose={close}
        bins={unregisteredBins}
        initialBinId={modal?.binId}
        toast={toast}
      />
      <MaintainModal
        open={modal?.kind === 'maintain'}
        onClose={close}
        bin={modalBin}
        device={modalBin ? deviceById.get(modalBin.id) : null}
        tech={{ uid, name: profile?.name ?? '' }}
        toast={toast}
      />
      <ReportModal
        open={modal?.kind === 'report'}
        onClose={close}
        bins={bins}
        initialBinId={modal?.binId}
        tech={{ uid, name: profile?.name ?? '' }}
        toast={toast}
      />
      <HistoryModal
        open={modal?.kind === 'history'}
        onClose={close}
        bin={modalBin}
        items={maintenance.filter((m) => m.binId === modal?.binId)}
        loading={maintQ.loading}
        error={maintQ.error}
      />
    </Page>
  );
}

/* ---------- Modals ---------- */

function useSubmit(onDone) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (fn, okMessage) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      okMessage && onDone(okMessage);
    } catch (err) {
      setError(/permission/i.test(err?.message ?? '') ? 'Your account is not allowed to do this.' : 'That did not save. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, setError, run };
}

function RegisterModal({ open, onClose, bins, initialBinId, toast }) {
  return (
    <Modal open={open} onClose={onClose} title="Register device" description="Link a sensor to a bin that has none yet.">
      {open && <RegisterForm key={initialBinId ?? 'new'} onClose={onClose} bins={bins} initialBinId={initialBinId} toast={toast} />}
    </Modal>
  );
}

function RegisterForm({ onClose, bins, initialBinId, toast }) {
  const [binId, setBinId] = useState(initialBinId && bins.some((b) => b.id === initialBinId) ? initialBinId : bins[0]?.id ?? '');
  const [model, setModel] = useState('');
  const [firmware, setFirmware] = useState('');
  const [installedAt, setInstalledAt] = useState('');
  const [notes, setNotes] = useState('');
  const [errs, setErrs] = useState({});
  const { busy, error, run } = useSubmit((m) => { toast.success(m); onClose(); });

  const submit = (e) => {
    e.preventDefault();
    const next = {};
    if (!binId) next.binId = 'Choose a bin.';
    if (!model.trim()) next.model = 'Enter the device model.';
    setErrs(next);
    if (Object.keys(next).length) return;
    run(
      () => setRecord(`devices/${binId}`, {
        binId,
        model: model.trim(),
        firmware: firmware.trim(),
        installedAt: installedAt || '',
        notes: notes.trim(),
        status: 'active',
      }, { action: 'device.register', detail: `Registered ${model.trim()} on bin ${binId}` }),
      'Device registered.',
    );
  };

  if (bins.length === 0) return <Notice tone="info">Every bin already has a device.</Notice>;
  return (
    <form className="ui-form" onSubmit={submit} noValidate>
      <Field label="Bin" as="select" value={binId} onChange={(e) => setBinId(e.target.value)} error={errs.binId} data-autofocus>
        {bins.map((b) => <option key={b.id} value={b.id}>{b.code} - {b.location}</option>)}
      </Field>
      <div className="ui-form__row">
        <Field label="Model" value={model} onChange={(e) => setModel(e.target.value)} error={errs.model} placeholder="e.g. ESP32 ultrasonic" />
        <Field label="Firmware" optional value={firmware} onChange={(e) => setFirmware(e.target.value)} />
      </div>
      <Field label="Install date" optional type="date" value={installedAt} onChange={(e) => setInstalledAt(e.target.value)} />
      <Field label="Notes" optional as="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} />
      {error && <Notice tone="error">{error}</Notice>}
      <div className="ui-form__actions">
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" loading={busy}>Register device</Button>
      </div>
    </form>
  );
}

function MaintainModal({ open, onClose, bin, device, tech, toast }) {
  return (
    <Modal open={open && !!bin && !!device} onClose={onClose} title="Log maintenance" description={bin ? `${bin.code} - ${bin.location}` : ''}>
      {open && bin && device && <MaintainForm key={bin.id} onClose={onClose} bin={bin} device={device} tech={tech} toast={toast} />}
    </Modal>
  );
}

function MaintainForm({ onClose, bin, device, tech, toast }) {
  const [type, setType] = useState('inspection');
  const [note, setNote] = useState('');
  const [status, setStatus] = useState('');
  const [noteErr, setNoteErr] = useState('');
  const { busy, error, run } = useSubmit((m) => { toast.success(m); onClose(); });

  const submit = (e) => {
    e.preventDefault();
    if (!note.trim()) { setNoteErr('Describe what you did or found.'); return; }
    setNoteErr('');
    const audit = { action: 'device.maintenance', detail: `${TYPE_LABEL[type]} on bin ${bin.id}${status ? `, status set to ${status}` : ''}` };
    run(async () => {
      await createRecord('maintenance', {
        binId: bin.id, type, note: note.trim(), techUid: tech.uid, techName: tech.name,
      }, audit);
      if (status && status !== device.status) await patchRecord(`devices/${bin.id}`, { status }, audit);
    }, 'Maintenance logged.');
  };

  return (
    <form className="ui-form" onSubmit={submit} noValidate>
      <Field label="Type" as="select" value={type} onChange={(e) => setType(e.target.value)} data-autofocus>
        {MAINT_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
      </Field>
      <Field label="Note" as="textarea" value={note} onChange={(e) => setNote(e.target.value)} error={noteErr} />
      <Field label="Device status" as="select" value={status} onChange={(e) => setStatus(e.target.value)} hint={`Currently ${DEVICE_STATUS[device.status]?.label.toLowerCase() ?? 'active'}.`}>
        <option value="">Leave unchanged</option>
        <option value="faulty">Mark faulty</option>
        <option value="active">Return to active</option>
        <option value="replaced">Mark replaced</option>
        <option value="retired">Mark retired</option>
      </Field>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="ui-form__actions">
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" loading={busy}>Save</Button>
      </div>
    </form>
  );
}

function ReportModal({ open, onClose, bins, initialBinId, tech, toast }) {
  return (
    <Modal open={open} onClose={onClose} title="Report a fault" description="Tell a technician what is wrong with this sensor.">
      {open && <ReportForm key={initialBinId ?? 'any'} onClose={onClose} bins={bins} initialBinId={initialBinId} tech={tech} toast={toast} />}
    </Modal>
  );
}

function ReportForm({ onClose, bins, initialBinId, tech, toast }) {
  const [binId, setBinId] = useState(initialBinId ?? bins[0]?.id ?? '');
  const [note, setNote] = useState('');
  const [noteErr, setNoteErr] = useState('');
  const { busy, error, run } = useSubmit((m) => { toast.success(m); onClose(); });

  const submit = (e) => {
    e.preventDefault();
    if (!note.trim()) { setNoteErr('Describe the problem.'); return; }
    setNoteErr('');
    run(
      () => createRecord('maintenance', {
        binId, type: 'report', note: note.trim(), techUid: tech.uid, techName: tech.name,
      }, { action: 'device.report', detail: `Fault reported on bin ${binId}` }),
      'Fault reported.',
    );
  };

  return (
    <form className="ui-form" onSubmit={submit} noValidate>
      <Field label="Bin" as="select" value={binId} onChange={(e) => setBinId(e.target.value)} data-autofocus>
        {bins.map((b) => <option key={b.id} value={b.id}>{b.code} - {b.location}</option>)}
      </Field>
      <Field label="What is wrong?" as="textarea" value={note} onChange={(e) => setNote(e.target.value)} error={noteErr} />
      {error && <Notice tone="error">{error}</Notice>}
      <div className="ui-form__actions">
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" loading={busy}>Send report</Button>
      </div>
    </form>
  );
}

function HistoryModal({ open, onClose, bin, items, loading, error }) {
  return (
    <Modal open={open && !!bin} onClose={onClose} wide title="Maintenance history" description={bin ? `${bin.code} - ${bin.location}` : ''}>
      {error ? <DataError error={error} /> : loading ? (
        <LoadingRows rows={3} />
      ) : items.length === 0 ? (
        <EmptyState icon="recycle" title="No maintenance yet">Inspections, repairs and fault reports for this bin will be listed here.</EmptyState>
      ) : (
        <ol className="tech-timeline">
          {items.map((m) => (
            <li key={m.id}>
              <div className="tech-timeline__top">
                <Pill tone={m.type === 'report' ? 'warning' : 'info'}>{TYPE_LABEL[m.type] ?? String(m.type ?? 'Entry')}</Pill>
                <span className="ui-cell-sub">{formatDateTime(m.createdAt)}{m.techName ? ` by ${m.techName}` : ''}</span>
              </div>
              <p>{m.note}</p>
            </li>
          ))}
        </ol>
      )}
    </Modal>
  );
}
