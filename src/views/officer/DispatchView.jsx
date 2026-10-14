import { useMemo, useState } from 'react';
import {
  Button, Check, ConfirmModal, DataError, EmptyState, Field, LoadingRows, Modal, Notice, Page, PageHead, Panel, Pill, useToast,
} from '../../components/ui';
import { useAuth } from '../../auth/AuthContext.jsx';
import { createRecord, patchRecord, useList, useNewestFirst } from '../../data/useCollection';
import { fillTone } from '../../data/useWasteData';
import { formatDateTime, plural, timeAgo } from '../../lib/format';

// Layout uses only ui.css classes plus token-based inline styles. The scope
// for this surface did not include a stylesheet, so nothing here is new CSS.

const ACTIVE = ['assigned', 'started'];
const JOB_TONE = { assigned: 'info', started: 'warning', completed: 'ok', cancelled: 'muted' };
const JOB_LABEL = { assigned: 'Assigned', started: 'In progress', completed: 'Completed', cancelled: 'Cancelled' };
const TRUCK_TONE = { available: 'ok', 'in-service': 'info', maintenance: 'warning' };
const TRUCK_LABEL = { available: 'Available', 'in-service': 'In service', maintenance: 'Maintenance' };
const PRIORITY_TONE = { normal: 'muted', high: 'warning', urgent: 'critical' };
const ISSUE_LABEL = { 'inaccessible-bin': 'Bin not accessible', breakdown: 'Breakdown', other: 'Other' };

const rowStyle = { display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', flexWrap: 'wrap' };
const stackStyle = { display: 'grid', gap: 'var(--sp-5)' };
const smallStyle = { margin: 0, fontSize: 'var(--fs-xs)' };

function finite(n) {
  return Number.isFinite(Number(n)) ? Number(n) : 0;
}

/** Freeze a bin as a job stop so drivers never need to read /bins.
 *  Returns null when the bin has no usable coordinates: a stop at a fake
 *  (0, 0) would send a driver into the ocean, so callers drop it loudly.
 *  Note Number(null) and Number('') are both 0, so missing coords arrive here
 *  as (0, 0) and must be rejected explicitly, not just by isFinite. */
function snapshot(bin) {
  if (bin == null) return null;
  const lat = Number(bin.lat);
  const lng = Number(bin.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat === 0 && lng === 0) return null;
  return {
    binId: bin.id,
    location: bin.location ?? bin.id,
    lat,
    lng,
    fillLevel: finite(bin.fillLevel),
    prediction: bin.prediction ?? 'Pending',
    done: false,
  };
}

/** Map bins to stops, reporting how many had no location and were left out. */
function snapshotsWithReport(bins, toast) {
  const stops = [];
  let dropped = 0;
  bins.forEach((b) => {
    const s = snapshot(b);
    if (s) stops.push(s);
    else dropped += 1;
  });
  if (dropped > 0) {
    toast.error(
      dropped === bins.length
        ? 'Those bins have no map location, so no job can be built from them.'
        : `${dropped} ${dropped === 1 ? 'bin has' : 'bins have'} no map location and ${dropped === 1 ? 'was' : 'were'} left out of the job.`,
    );
  }
  return stops;
}

function FillBar({ value, label }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div
      className={`ui-fillbar ui-fillbar--${fillTone(pct)}`}
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <i style={{ width: `${pct}%` }} />
    </div>
  );
}

function BinLine({ bin }) {
  return (
    <div style={{ minWidth: 0, flex: 1 }}>
      <span className="ui-cell-strong">{bin.location}</span>
      <span className="ui-cell-sub">{bin.prediction}</span>
    </div>
  );
}

/* ---------- Assign modal ---------- */

function AssignModal({ draft, onClose, drivers, trucks, activeJobs }) {
  const toast = useToast();
  const { uid, profile } = useAuth();
  const [driverUid, setDriverUid] = useState('');
  const [truckId, setTruckId] = useState('');
  const [priority, setPriority] = useState('normal');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const busyDrivers = useMemo(() => new Set(activeJobs.map((j) => j.driverUid)), [activeJobs]);
  const activeDrivers = drivers.filter((d) => d.status === 'active');
  const usableTrucks = trucks.filter((t) => t.status !== 'maintenance');
  const stops = draft?.stops ?? [];

  const submit = async (e) => {
    e.preventDefault();
    const next = {};
    if (!driverUid) next.driver = 'Choose a driver.';
    if (!truckId) next.truck = 'Choose a truck.';
    if (stops.length === 0) next.stops = 'Add at least one stop.';
    setErrors(next);
    if (Object.keys(next).length) return;

    const driver = activeDrivers.find((d) => d.id === driverUid);
    const truck = usableTrucks.find((t) => t.id === truckId);
    // The lists are live: a driver deactivated or a truck sent to maintenance
    // after the modal opened would otherwise crash on `.label` below.
    if (!driver || !truck) {
      setErrors({
        ...(driver ? {} : { driver: 'That driver is no longer available. Choose another.' }),
        ...(truck ? {} : { truck: 'That truck is no longer available. Choose another.' }),
      });
      toast.error('The driver or truck list just changed. Choose again.');
      return;
    }
    const truckName = `${truck.label ?? 'Truck'} · ${truck.plate ?? ''}`.trim();
    const title = `${draft.source === 'ai-route' ? 'Route' : 'Manual job'} · ${plural(stops.length, 'stop')}`;
    const data = {
      title,
      driverUid,
      driverName: driver.name ?? driver.email ?? 'Driver',
      truck: truckName,
      priority,
      status: 'assigned',
      source: draft.source,
      createdBy: uid,
      createdByName: profile?.name ?? '',
      stops,
    };
    if (notes.trim()) data.notes = notes.trim();

    setSaving(true);
    try {
      await createRecord('jobs', data, {
        action: 'job.assign',
        detail: `${title} to ${data.driverName} on ${truckName} (${priority})`,
      });
      toast.success(`${title} assigned to ${data.driverName}.`);
      onClose();
    } catch {
      toast.error('The job could not be assigned. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={Boolean(draft)}
      onClose={onClose}
      title="Assign job"
      description={draft ? `${plural(stops.length, 'stop')} · ${draft.source === 'ai-route' ? 'AI-planned order' : 'order you selected'}` : undefined}
    >
      <form className="ui-form" onSubmit={submit} noValidate>
        {errors.stops && <Notice tone="error">{errors.stops}</Notice>}
        <Field
          label="Driver"
          as="select"
          value={driverUid}
          onChange={(e) => setDriverUid(e.target.value)}
          error={errors.driver}
          required
          data-autofocus
          hint={activeDrivers.length === 0 ? 'There are no active drivers. Ask an administrator to add one.' : undefined}
        >
          <option value="">Select a driver</option>
          {activeDrivers.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name ?? d.email}{busyDrivers.has(d.id) ? ' (already has an active job)' : ''}
            </option>
          ))}
        </Field>
        <Field
          label="Truck"
          as="select"
          value={truckId}
          onChange={(e) => setTruckId(e.target.value)}
          error={errors.truck}
          required
          hint={trucks.length === 0 ? 'Add a truck first, from the Trucks panel.' : 'Trucks in maintenance are not listed.'}
        >
          <option value="">Select a truck</option>
          {usableTrucks.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label} · {t.plate}{t.status === 'in-service' ? ' (in service)' : ''}
            </option>
          ))}
        </Field>
        <Field label="Priority" as="select" value={priority} onChange={(e) => setPriority(e.target.value)}>
          <option value="normal">Normal</option>
          <option value="high">High</option>
          <option value="urgent">Urgent</option>
        </Field>
        <Field label="Notes" optional as="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
        <div className="ui-form__actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={saving}>Assign job</Button>
        </div>
      </form>
    </Modal>
  );
}

/* ---------- Job detail modal ---------- */

function JobDetailModal({ job, issues, onClose }) {
  const jobIssues = job ? issues.filter((i) => i.jobId === job.id) : [];
  const stops = job?.stops ?? [];
  const done = stops.filter((s) => s.done).length;
  return (
    <Modal open={Boolean(job)} onClose={onClose} wide title={job?.title ?? 'Job'} description={job ? `${job.driverName} · ${job.truck}` : undefined}>
      {job && (
        <div style={stackStyle}>
          <div style={rowStyle}>
            <Pill tone={JOB_TONE[job.status]}>{JOB_LABEL[job.status] ?? job.status}</Pill>
            <Pill tone={PRIORITY_TONE[job.priority]} dot={false}>{job.priority} priority</Pill>
            <span className="ui-tertiary" style={{ fontSize: 'var(--fs-xs)' }}>
              {done} of {plural(stops.length, 'stop')} done · created {formatDateTime(job.createdAt)} by {job.createdByName || 'unknown'}
            </span>
          </div>
          {job.notes && <Notice>{job.notes}</Notice>}
          <div>
            <h3 className="ui-panel__title" style={{ marginBottom: 'var(--sp-2)' }}>Stops</h3>
            <ol className="ui-list" aria-label="Stop checklist">
              {stops.map((s, i) => (
                <li key={`${s.binId}-${i}`} className="ui-row" style={{ padding: 'var(--sp-3) 0' }}>
                  <span className="ui-mono ui-tertiary" aria-hidden="true">{i + 1}</span>
                  <div className="ui-row__main">
                    <span className="ui-cell-strong">{s.location}</span>
                    <span className="ui-cell-sub">{s.fillLevel}% full at assignment{s.doneAt ? ` · done ${formatDateTime(s.doneAt)}` : ''}</span>
                  </div>
                  <Pill tone={s.done ? 'ok' : 'muted'}>{s.done ? 'Collected' : 'Pending'}</Pill>
                </li>
              ))}
            </ol>
          </div>
          <div>
            <h3 className="ui-panel__title" style={{ marginBottom: 'var(--sp-2)' }}>Issues reported</h3>
            {jobIssues.length === 0 ? (
              <p className="ui-muted" style={{ margin: 0 }}>No issues reported on this job.</p>
            ) : (
              <ul className="ui-list">
                {jobIssues.map((i) => (
                  <li key={i.id} className="ui-row" style={{ padding: 'var(--sp-3) 0' }}>
                    <div className="ui-row__main">
                      <span className="ui-cell-strong">{ISSUE_LABEL[i.type] ?? i.type}</span>
                      <span className="ui-cell-sub">{i.note} · {timeAgo(i.createdAt)}</span>
                    </div>
                    <Pill tone={i.status === 'open' ? 'critical' : 'ok'}>{i.status === 'open' ? 'Open' : 'Resolved'}</Pill>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ---------- Add truck modal ---------- */

function AddTruckModal({ open, onClose }) {
  const toast = useToast();
  const [label, setLabel] = useState('');
  const [plate, setPlate] = useState('');
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const close = () => {
    setLabel(''); setPlate(''); setErrors({});
    onClose();
  };

  const submit = async (e) => {
    e.preventDefault();
    const next = {};
    if (!label.trim()) next.label = 'Give the truck a name, for example Truck 4.';
    if (!plate.trim()) next.plate = 'Enter the number plate.';
    setErrors(next);
    if (Object.keys(next).length) return;
    setSaving(true);
    try {
      await createRecord(
        'trucks',
        { label: label.trim(), plate: plate.trim().toUpperCase(), status: 'available' },
        { action: 'truck.create', detail: `${label.trim()} · ${plate.trim().toUpperCase()}` },
      );
      toast.success(`${label.trim()} added.`);
      close();
    } catch {
      toast.error('The truck could not be added. Try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={close} title="Add truck">
      <form className="ui-form" onSubmit={submit} noValidate>
        <Field label="Label" value={label} onChange={(e) => setLabel(e.target.value)} error={errors.label} maxLength={40} required data-autofocus />
        <Field label="Number plate" value={plate} onChange={(e) => setPlate(e.target.value)} error={errors.plate} maxLength={16} required />
        <div className="ui-form__actions">
          <Button onClick={close}>Cancel</Button>
          <Button type="submit" variant="primary" loading={saving}>Add truck</Button>
        </div>
      </form>
    </Modal>
  );
}

/* ---------- Main view ---------- */

export default function DispatchView({ data }) {
  const toast = useToast();
  const { uid, can } = useAuth();
  const jobsQ = useList('jobs');
  const issuesQ = useList('issues');
  const trucksQ = useList('trucks');
  const driversQ = useList('users', { where: ['role', 'driver'] });

  const allJobs = useNewestFirst(jobsQ.items);
  const activeJobs = useMemo(() => allJobs.filter((j) => ACTIVE.includes(j.status)), [allJobs]);
  const openIssues = useNewestFirst(issuesQ.items.filter((i) => i.status === 'open'));
  const trucks = useMemo(() => [...trucksQ.items].sort((a, b) => String(a.label).localeCompare(String(b.label))), [trucksQ.items]);

  const [draft, setDraft] = useState(null);
  const [picked, setPicked] = useState([]);
  const [detailId, setDetailId] = useState(null);
  const [cancelJob, setCancelJob] = useState(null);
  const [truckOpen, setTruckOpen] = useState(false);
  const [busy, setBusy] = useState(null);

  const canUpdate = can('jobs.update.all');
  const canAssign = can('jobs.assign');

  const bins = useMemo(() => data?.bins ?? [], [data]);
  const routeBins = useMemo(
    () => (data?.route?.stops ?? []).map((s) => s.bin).filter(Boolean),
    [data],
  );
  const unmatched = (data?.route?.stops?.length ?? 0) - routeBins.length;
  const onRouteIds = useMemo(() => new Set(routeBins.map((b) => b.id)), [routeBins]);
  const others = useMemo(
    () => bins.filter((b) => !onRouteIds.has(b.id)).sort((a, b) => b.fillLevel - a.fillLevel),
    [bins, onRouteIds],
  );
  const binById = useMemo(() => new Map(bins.map((b) => [b.id, b])), [bins]);

  const togglePick = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const run = async (key, fn, okMessage) => {
    setBusy(key);
    try {
      await fn();
      if (okMessage) toast.success(okMessage);
    } catch {
      toast.error('That change did not save. Check your connection and try again.');
    } finally {
      setBusy(null);
    }
  };

  const setJobStatus = (job, status) => run(
    `${job.id}:${status}`,
    () => patchRecord(
      `jobs/${job.id}`,
      { status, ...(status === 'started' ? { startedAt: Date.now() } : {}), ...(status === 'completed' ? { completedAt: Date.now() } : {}) },
      { action: `job.${status}`, detail: `${job.title} · ${job.driverName}` },
    ),
    status === 'started' ? 'Job marked as started.' : status === 'completed' ? 'Job marked as completed.' : 'Job cancelled.',
  ).then(() => { if (status === 'cancelled') setCancelJob(null); });

  const resolveIssue = (issue) => run(
    `issue:${issue.id}`,
    () => patchRecord(
      `issues/${issue.id}`,
      { status: 'resolved', resolvedBy: uid, resolvedAt: Date.now() },
      { action: 'issue.resolve', detail: `${ISSUE_LABEL[issue.type] ?? issue.type} · ${issue.driverName}` },
    ),
    'Issue resolved.',
  );

  const setTruckStatus = (truck, status) => run(
    `truck:${truck.id}`,
    () => patchRecord(`trucks/${truck.id}`, { status }, { action: 'truck.status', detail: `${truck.label} to ${status}` }),
    `${truck.label} is now ${TRUCK_LABEL[status].toLowerCase()}.`,
  );

  const openRouteDraft = () => {
    const stops = snapshotsWithReport(routeBins, toast);
    if (stops.length === 0) return;
    setDraft({ source: 'ai-route', stops });
  };
  const openManualDraft = () => {
    const stops = snapshotsWithReport(picked.map((id) => binById.get(id)).filter(Boolean), toast);
    if (stops.length === 0) return;
    setDraft({ source: 'manual', stops });
  };
  const closeDraft = () => {
    if (draft?.source === 'manual') setPicked([]);
    setDraft(null);
  };

  const noRoute = routeBins.length === 0;
  const detailJob = allJobs.find((j) => j.id === detailId) ?? null;
  const binFeedDown = !data?.loaded && (data?.status === 'offline' || data?.status === 'error');
  const noBinFeed = !data?.loaded && data?.status !== 'idle' && !binFeedDown;
  const feedDownNotice = (
    <Notice tone="warning">
      The live bin feed is unavailable, so bins and the recommended route cannot be shown. It will appear here when the connection recovers. Jobs, issues and trucks below are not affected.
    </Notice>
  );

  return (
    <Page label="Dispatch">
      <PageHead
        eyebrow="Waste Management Officer"
        title="Dispatch"
        sub="Send the AI-planned route to a driver, build a job by hand, and keep an eye on jobs, issues and trucks."
      />

      <div className="ui-grid ui-grid--side">
        <div style={stackStyle}>
          <Panel
            title="Recommended collection"
            note={noRoute ? undefined : `${plural(routeBins.length, 'stop')} · ${data.route.distanceKm} km`}
            actions={canAssign && (
              <Button
                variant="primary"
                icon="route"
                onClick={openRouteDraft}
                disabled={noRoute}
                aria-describedby={noRoute ? 'dispatch-route-reason' : undefined}
              >
                Assign this route
              </Button>
            )}
          >
            {binFeedDown ? (
              feedDownNotice
            ) : noBinFeed ? (
              <LoadingRows rows={3} />
            ) : noRoute ? (
              <EmptyState icon="route" title="No route to assign">
                <span id="dispatch-route-reason">
                  {data?.route?.hasData
                    ? 'The AI engine has not planned any stops. Every bin is below its collection threshold right now.'
                    : 'The AI engine has not published a route yet. You can still build a job by hand from the bins below.'}
                </span>
              </EmptyState>
            ) : (
              <>
                {unmatched > 0 && (
                  <Notice tone="warning">
                    {plural(unmatched, 'planned stop')} could not be matched to a bin and will be left out of the job.
                  </Notice>
                )}
                <ol className="ui-list" aria-label="Recommended stops in collection order">
                  {routeBins.map((b, i) => (
                    <li key={b.id} className="ui-row" style={{ padding: 'var(--sp-3) 0' }}>
                      <span className="ui-mono ui-tertiary" aria-hidden="true" style={{ width: 20 }}>{i + 1}</span>
                      <BinLine bin={b} />
                      <div style={{ flex: '0 1 160px', minWidth: 120 }}>
                        <span className="tabular" style={{ ...smallStyle, textAlign: 'right', display: 'block', marginBottom: 'var(--sp-1)' }}>{Math.round(b.fillLevel)}% full</span>
                        <FillBar value={b.fillLevel} label={`${b.location} fill level`} />
                      </div>
                    </li>
                  ))}
                </ol>
              </>
            )}
          </Panel>

          <Panel
            title="Other bins to consider"
            note="Fullest first. Select bins to build a manual job."
            actions={canAssign && (
              <Button variant="primary" onClick={openManualDraft} disabled={picked.length === 0}>
                {picked.length ? `Assign ${plural(picked.length, 'bin')}` : 'Assign selected'}
              </Button>
            )}
          >
            {binFeedDown ? (
              feedDownNotice
            ) : noBinFeed ? (
              <LoadingRows rows={3} />
            ) : others.length === 0 ? (
              <EmptyState icon="bin" title="Nothing else to consider">
                {bins.length === 0 ? 'No bins are reporting yet.' : 'Every reporting bin is already on the recommended route.'}
              </EmptyState>
            ) : (
              <ul className="ui-list" aria-label="Bins not on the route">
                {others.map((b) => (
                  <li key={b.id} className="ui-row" style={{ padding: 'var(--sp-1) 0' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <Check
                        label={b.location}
                        hint={`${Math.round(b.fillLevel)}% full · ${b.prediction}`}
                        checked={picked.includes(b.id)}
                        onChange={() => togglePick(b.id)}
                      />
                    </div>
                    <div style={{ flex: '0 1 110px', minWidth: 88 }}>
                      <FillBar value={b.fillLevel} label={`${b.location} fill level`} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <div style={stackStyle}>
          <Panel title="Active jobs" note={plural(activeJobs.length, 'job')} flush>
            {jobsQ.error ? (
              <div style={{ padding: '0 var(--sp-4) var(--sp-4)' }}><DataError error={jobsQ.error} /></div>
            ) : jobsQ.loading ? (
              <LoadingRows rows={2} />
            ) : activeJobs.length === 0 ? (
              <EmptyState icon="truck" title="No active jobs">Jobs you assign appear here until they are completed or cancelled.</EmptyState>
            ) : (
              <ul className="ui-list">
                {activeJobs.map((j) => {
                  const stops = j.stops ?? [];
                  const done = stops.filter((s) => s.done).length;
                  const pct = stops.length ? (done / stops.length) * 100 : 0;
                  return (
                    <li key={j.id} className="ui-row" style={{ alignItems: 'stretch', flexDirection: 'column', gap: 'var(--sp-2)', padding: 'var(--sp-4)' }}>
                      <div style={{ ...rowStyle, justifyContent: 'space-between' }}>
                        <span className="ui-cell-strong">{j.title}</span>
                        <div style={{ ...rowStyle, gap: 'var(--sp-2)' }}>
                          {j.priority !== 'normal' && <Pill tone={PRIORITY_TONE[j.priority]} dot={false}>{j.priority}</Pill>}
                          <Pill tone={JOB_TONE[j.status]}>{JOB_LABEL[j.status]}</Pill>
                        </div>
                      </div>
                      <span className="ui-cell-sub">{j.driverName} · {j.truck} · {timeAgo(j.createdAt)}</span>
                      <FillBar value={pct} label={`${j.title} progress`} />
                      <span className="ui-cell-sub tabular">{done}/{stops.length} stops done</span>
                      <div style={{ ...rowStyle, gap: 'var(--sp-2)' }}>
                        <Button size="sm" onClick={() => setDetailId(j.id)}>Details</Button>
                        {!canUpdate && <span className="ui-cell-sub">Your account can view jobs but not change them.</span>}
                        {canUpdate && j.status === 'assigned' && (
                          <Button size="sm" variant="primary" loading={busy === `${j.id}:started`} onClick={() => setJobStatus(j, 'started')}>Mark started</Button>
                        )}
                        {canUpdate && j.status === 'started' && (
                          <Button size="sm" variant="primary" loading={busy === `${j.id}:completed`} onClick={() => setJobStatus(j, 'completed')}>Mark completed</Button>
                        )}
                        {canUpdate && (
                          <Button size="sm" variant="danger" onClick={() => setCancelJob(j)}>Cancel</Button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          <Panel title="Open driver issues" note={plural(openIssues.length, 'issue')} flush>
            {issuesQ.error ? (
              <div style={{ padding: '0 var(--sp-4) var(--sp-4)' }}><DataError error={issuesQ.error} /></div>
            ) : issuesQ.loading ? (
              <LoadingRows rows={2} />
            ) : openIssues.length === 0 ? (
              <EmptyState icon="hazard" title="No open issues">Problems drivers report from the road show up here.</EmptyState>
            ) : (
              <ul className="ui-list">
                {openIssues.map((i) => (
                  <li key={i.id} className="ui-row" style={{ alignItems: 'flex-start', padding: 'var(--sp-4)' }}>
                    <div className="ui-row__main">
                      <span className="ui-cell-strong">{ISSUE_LABEL[i.type] ?? i.type}</span>
                      <span className="ui-cell-sub">{i.driverName} · {timeAgo(i.createdAt)}</span>
                      <p style={{ margin: 'var(--sp-1) 0 0', fontSize: 'var(--fs-sm)' }}>{i.note}</p>
                    </div>
                    {canUpdate && (
                      <Button size="sm" loading={busy === `issue:${i.id}`} onClick={() => resolveIssue(i)}>Resolve</Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel
            title="Trucks"
            note={plural(trucks.length, 'truck')}
            flush
            actions={canAssign && <Button size="sm" icon="plus" onClick={() => setTruckOpen(true)}>Add truck</Button>}
          >
            {trucksQ.error ? (
              <div style={{ padding: '0 var(--sp-4) var(--sp-4)' }}><DataError error={trucksQ.error} /></div>
            ) : trucksQ.loading ? (
              <LoadingRows rows={2} />
            ) : trucks.length === 0 ? (
              <EmptyState icon="truck" title="No trucks yet" action={canAssign && <Button icon="plus" onClick={() => setTruckOpen(true)}>Add truck</Button>}>
                Add the trucks in your fleet so you can assign them to jobs.
              </EmptyState>
            ) : (
              <ul className="ui-list">
                {trucks.map((t) => (
                  <li key={t.id} className="ui-row" style={{ padding: 'var(--sp-3) var(--sp-4)' }}>
                    <div className="ui-row__main">
                      <span className="ui-cell-strong">{t.label}</span>
                      <span className="ui-cell-sub ui-mono">{t.plate}</span>
                    </div>
                    <Pill tone={TRUCK_TONE[t.status]}>{TRUCK_LABEL[t.status] ?? t.status}</Pill>
                    {canAssign && (
                      <select
                        className="ui-select"
                        style={{ width: 150 }}
                        aria-label={`Change status of ${t.label}`}
                        value={t.status}
                        disabled={busy === `truck:${t.id}`}
                        onChange={(e) => setTruckStatus(t, e.target.value)}
                      >
                        <option value="available">Available</option>
                        <option value="in-service">In service</option>
                        <option value="maintenance">Maintenance</option>
                      </select>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>

      {draft && (
        <AssignModal
          key={draft.source}
          draft={draft}
          onClose={closeDraft}
          drivers={driversQ.items}
          trucks={trucks}
          activeJobs={activeJobs}
        />
      )}
      <JobDetailModal job={detailJob} issues={issuesQ.items} onClose={() => setDetailId(null)} />
      <AddTruckModal open={truckOpen} onClose={() => setTruckOpen(false)} />
      <ConfirmModal
        open={Boolean(cancelJob)}
        onClose={() => setCancelJob(null)}
        onConfirm={() => setJobStatus(cancelJob, 'cancelled')}
        title="Cancel this job?"
        confirmLabel="Cancel job"
        danger
        loading={Boolean(cancelJob) && busy === `${cancelJob.id}:cancelled`}
      >
        {cancelJob ? `${cancelJob.title} for ${cancelJob.driverName} will be cancelled and removed from their list. Stops already collected stay recorded.` : ''}
      </ConfirmModal>
    </Page>
  );
}
