// Driver surface ("My jobs"). Built for a phone in a truck cab: one hand,
// glanceable, 52px primary targets. Reads only the driver's own /jobs and
// /issues; everything about a stop comes from the job's stops snapshot
// (the rules deny drivers /bins and /logistics).
import { useCallback, useMemo, useState } from 'react';
import { useAuth } from '../../auth/AuthContext.jsx';
import { createRecord, patchRecord, useList } from '../../data/useCollection.js';
import {
  Button, DataError, EmptyState, Field, LoadingRows, Modal, Notice, Page, PageHead, Panel, Pill,
  Skeleton, useToast,
} from '../../components/ui/index.jsx';
import { formatDate, plural, timeAgo, toMs } from '../../lib/format.js';
import './driver.css';

const ISSUE_TYPES = [
  { key: 'inaccessible-bin', label: 'Inaccessible bin' },
  { key: 'breakdown', label: 'Vehicle breakdown' },
  { key: 'other', label: 'Other' },
];
const ISSUE_LABEL = Object.fromEntries(ISSUE_TYPES.map((t) => [t.key, t.label]));

const PRIORITY_TONE = { urgent: 'critical', high: 'critical', medium: 'warning', normal: 'warning', low: 'info' };
const FILL_WARN = 80; // same collect threshold as ENGINE_RULES.collectAtFill
const FILL_CRIT = 90; // ENGINE_RULES.criticalFill (kept local so the driver bundle skips the bins feed module)

/** RTDB returns dense arrays as arrays and sparse ones as objects; keep the original index either way. */
function normaliseStops(stops) {
  if (!stops) return [];
  const entries = Array.isArray(stops)
    ? stops.map((s, i) => [i, s])
    : Object.entries(stops).sort((a, b) => Number(a[0]) - Number(b[0]));
  return entries.filter(([, s]) => s).map(([i, s]) => ({ ...s, i: Number(i) }));
}

const createdOf = (j) => toMs(j.assignedAt) ?? toMs(j.createdAt) ?? 0;

function durationText(job) {
  const a = toMs(job.startedAt);
  const b = toMs(job.completedAt);
  if (a == null || b == null || b < a) return '—';
  const mins = Math.max(1, Math.round((b - a) / 60000));
  return mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)} h ${mins % 60} min`;
}

function Tick() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  );
}

function fillTone(level) {
  if (level >= FILL_CRIT) return 'critical';
  if (level >= FILL_WARN) return 'warning';
  return 'ok';
}

function StopRow({ stop, position, done, isNext, started, busy, onToggle }) {
  const fill = Number.isFinite(Number(stop.fillLevel)) ? Math.round(Number(stop.fillLevel)) : null;
  const hasCoords = Number.isFinite(Number(stop.lat)) && Number.isFinite(Number(stop.lng));
  return (
    <li className={`ui-row drv-stop${isNext ? ' is-next' : ''}${done ? ' is-done' : ''}`}>
      <div className="drv-stop__head">
        <span className="drv-stop__num" aria-hidden="true">{done ? <Tick /> : position}</span>
        <div className="drv-stop__body">
          <p className="drv-stop__loc">
            <span className="ui-tertiary">Stop {position}: </span>{stop.location || stop.binId || 'Unnamed stop'}
          </p>
          {stop.prediction && <p className="drv-stop__pred">{stop.prediction}</p>}
          {fill != null && (
            <div className="drv-stop__fill">
              <div className={`ui-fillbar ui-fillbar--${fillTone(fill)}`} role="img" aria-label={`Fill level ${fill} percent`}>
                <i style={{ width: `${Math.min(100, Math.max(0, fill))}%` }} />
              </div>
              <span className="drv-stop__pct">{fill}%</span>
            </div>
          )}
          <div className="drv-stop__status">
            {done ? <Pill tone="ok">Collected</Pill> : isNext ? <Pill tone="info">Next stop</Pill> : null}
          </div>
        </div>
      </div>
      <div className="drv-stop__actions">
        {hasCoords ? (
          <a
            className="ui-btn ui-btn--ghost drv-big"
            href={`https://www.google.com/maps/dir/?api=1&destination=${stop.lat},${stop.lng}`}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Navigate to stop ${position}, ${stop.location || 'bin'} (opens Google Maps)`}
          >
            Navigate
          </a>
        ) : (
          <span className="ui-btn ui-btn--ghost drv-big" aria-disabled="true" style={{ opacity: 0.5 }}>No location</span>
        )}
        {started && (
          <button
            type="button"
            className="ui-btn ui-btn--primary drv-big drv-toggle"
            aria-pressed={done}
            disabled={busy}
            onClick={() => onToggle(stop, !done)}
          >
            {done ? 'Collected. Tap to undo' : 'Mark collected'}
          </button>
        )}
      </div>
    </li>
  );
}

export default function DriverView() {
  const { uid, profile } = useAuth();
  const toast = useToast();
  const jobsQ = useList('jobs', { where: ['driverUid', uid], enabled: !!uid });
  const issuesQ = useList('issues', { where: ['driverUid', uid], enabled: !!uid });

  // Optimistic stop ticks: key -> { done, doneAt, base }. An override only wins
  // while the server still shows `base`; once the snapshot changes, the server rules.
  const [optimistic, setOptimistic] = useState({});
  const [busyJob, setBusyJob] = useState(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportDefaults, setReportDefaults] = useState({ type: 'inaccessible-bin', binId: '' });
  const [issuesOpen, setIssuesOpen] = useState(false);
  const [dismissed, setDismissed] = useState({});
  const [seenActive, setSeenActive] = useState({});

  const jobs = jobsQ.items;
  const { active, upcoming, history } = useMemo(() => {
    const open = jobs.filter((j) => j.status === 'started' || j.status === 'assigned');
    const started = open.filter((j) => j.status === 'started').sort((a, b) => createdOf(a) - createdOf(b));
    const assigned = open.filter((j) => j.status === 'assigned').sort((a, b) => createdOf(a) - createdOf(b));
    const first = started[0] ?? assigned[0] ?? null;
    const done = jobs
      .filter((j) => j.status === 'completed' || j.status === 'cancelled')
      .sort((a, b) => (toMs(b.completedAt) ?? toMs(b.updatedAt) ?? 0) - (toMs(a.completedAt) ?? toMs(a.updatedAt) ?? 0))
      .slice(0, 10);
    return { active: first, upcoming: [...started.slice(1), ...assigned].filter((j) => j !== first), history: done };
  }, [jobs]);

  // Remember jobs seen open this session so a cancellation can be announced.
  // Adjusting state during render (guarded) is the supported pattern for this.
  const openIds = jobs.filter((j) => j.status === 'started' || j.status === 'assigned').map((j) => j.id);
  if (openIds.some((id) => !seenActive[id])) {
    setSeenActive((s) => ({ ...s, ...Object.fromEntries(openIds.map((id) => [id, true])) }));
  }
  const cancelledNotices = jobs.filter((j) => j.status === 'cancelled' && seenActive[j.id] && !dismissed[j.id]);

  const stops = useMemo(() => (active ? normaliseStops(active.stops) : []), [active]);
  const isDone = useCallback((job, stop) => {
    const server = !!stop.done;
    const o = optimistic[`${job.id}:${stop.i}`];
    return o && o.base === server ? o.done : server;
  }, [optimistic]);

  const collected = active ? stops.filter((s) => isDone(active, s)).length : 0;
  const remaining = stops.length - collected;
  const nextStop = active ? stops.find((s) => !isDone(active, s)) : null;
  const started = active?.status === 'started';

  const toggleStop = useCallback(async (stop, done) => {
    if (!active) return;
    const key = `${active.id}:${stop.i}`;
    const base = !!stop.done;
    const now = Date.now();
    setOptimistic((o) => ({ ...o, [key]: { done, base } }));
    try {
      await patchRecord(`jobs/${active.id}`, {
        [`stops/${stop.i}/done`]: done,
        [`stops/${stop.i}/doneAt`]: done ? now : null,
      });
    } catch {
      setOptimistic((o) => { const n = { ...o }; delete n[key]; return n; });
      toast.error(`Could not save stop ${stop.i + 1}. Check your signal and try again.`);
    }
  }, [active, toast]);

  const setStatus = useCallback(async (job, status, field, verb) => {
    setBusyJob(job.id);
    try {
      await patchRecord(`jobs/${job.id}`, { status, [field]: Date.now() }, { action: `job.${verb}`, detail: `${verb} job ${job.title ?? job.id}` });
      toast.success(status === 'started' ? 'Job started. Drive safe.' : 'Job completed. Nice work.');
      setConfirmOpen(false);
    } catch {
      toast.error(status === 'started' ? 'Could not start the job. Try again.' : 'Could not complete the job. Try again.');
    } finally {
      setBusyJob(null);
    }
  }, [toast]);

  const onComplete = () => {
    if (remaining > 0) setConfirmOpen(true);
    else setStatus(active, 'completed', 'completedAt', 'complete');
  };

  const openReport = (defaults = {}) => {
    setReportDefaults({ type: 'inaccessible-bin', binId: '', ...defaults });
    setConfirmOpen(false);
    setReportOpen(true);
  };

  const issues = useMemo(
    () => [...issuesQ.items].sort((a, b) => (toMs(b.createdAt) ?? 0) - (toMs(a.createdAt) ?? 0)).slice(0, 8),
    [issuesQ.items],
  );

  const loading = !uid || jobsQ.loading;
  const busy = busyJob === active?.id;

  return (
    <Page label="My jobs">
      <>
        <PageHead eyebrow={profile?.name ? `Driver · ${profile.name}` : 'Driver'} title="My jobs" />

        <DataError error={jobsQ.error} />

        {cancelledNotices.map((j) => (
          <Notice key={j.id} tone="warning">
            <strong>{j.title ?? 'A job'} was cancelled by an officer.</strong> It has moved to Completed below.{' '}
            <button type="button" className="ui-btn ui-btn--quiet ui-btn--sm" onClick={() => setDismissed((d) => ({ ...d, [j.id]: true }))}>Dismiss</button>
          </Notice>
        ))}

        {loading ? (
          <Panel title="Loading your route" aria-busy="true">
            <Skeleton height={28} width="60%" />
            <div style={{ height: 'var(--sp-4)' }} />
            <Skeleton height={12} />
            <LoadingRows rows={3} />
          </Panel>
        ) : !active ? (
          !jobsQ.error && (
            <Panel>
              <EmptyState icon="truck" title="No route assigned yet">
                When an officer assigns you a collection route it appears here instantly. You do not need to refresh.
              </EmptyState>
            </Panel>
          )
        ) : (
          <>
            <Panel as="section" aria-label="Active job" className="drv-hero">
              <div className="drv-hero__top">
                <h2 className="ui-title" style={{ margin: 0 }}>{active.title ?? 'Collection route'}</h2>
                {active.priority && <Pill tone={PRIORITY_TONE[String(active.priority).toLowerCase()] ?? 'muted'}>{`${String(active.priority).charAt(0).toUpperCase()}${String(active.priority).slice(1)} priority`}</Pill>}
                <Pill tone={started ? 'ok' : 'info'}>{started ? 'In progress' : 'Ready to start'}</Pill>
              </div>
              {(active.truckName ?? active.truckId ?? active.truck) && (
                <p className="drv-hero__meta">Truck: <strong>{active.truckName ?? active.truckId ?? active.truck}</strong></p>
              )}
              <div className="drv-progress">
                <p className="drv-progress__text" aria-live="polite">{collected} of {stops.length} collected</p>
                <div
                  className="ui-fillbar ui-fillbar--ok"
                  role="progressbar"
                  aria-label="Stops collected"
                  aria-valuemin={0}
                  aria-valuemax={stops.length}
                  aria-valuenow={collected}
                >
                  <i style={{ width: '100%', transform: `scaleX(${stops.length ? collected / stops.length : 0})` }} />
                </div>
              </div>
              {!started && <p className="drv-sub" style={{ marginTop: 'var(--sp-3)' }}>Tap Start job to begin ticking off stops.</p>}
            </Panel>

            <Panel title="Stops" note={`${plural(remaining, 'stop')} left`} flush>
              {stops.length === 0 ? (
                <EmptyState icon="stops" title="No stops on this job">The officer has not added any stops. Check back shortly.</EmptyState>
              ) : (
                <ol className="ui-list">
                  {stops.map((s, idx) => (
                    <StopRow
                      key={s.i}
                      stop={s}
                      position={idx + 1}
                      done={isDone(active, s)}
                      isNext={nextStop?.i === s.i}
                      started={started}
                      busy={busy}
                      onToggle={toggleStop}
                    />
                  ))}
                </ol>
              )}
            </Panel>
          </>
        )}

        {!loading && (upcoming.length > 0) && (
          <Panel title="Upcoming" note={plural(upcoming.length, 'job')} flush>
            <ul className="ui-list">
              {upcoming.map((j) => (
                <li key={j.id} className="ui-row">
                  <div className="ui-row__main">
                    <p className="drv-row-title">{j.title ?? 'Collection route'}</p>
                    <p className="drv-sub">{plural(normaliseStops(j.stops).length, 'stop')}{(j.truckName ?? j.truckId) ? ` · ${j.truckName ?? j.truckId}` : ''}</p>
                  </div>
                  {j.priority && <Pill tone={PRIORITY_TONE[String(j.priority).toLowerCase()] ?? 'muted'}>{j.priority}</Pill>}
                </li>
              ))}
            </ul>
          </Panel>
        )}

        {!loading && (
          <Panel
            title="Your reports"
            note={issuesQ.loading ? 'Loading' : plural(issues.length, 'recent report')}
            actions={(
              <Button size="sm" variant="quiet" aria-expanded={issuesOpen} aria-controls="drv-issues" onClick={() => setIssuesOpen((v) => !v)}>
                {issuesOpen ? 'Hide' : 'Show'}
              </Button>
            )}
          >
            <div id="drv-issues" hidden={!issuesOpen}>
              <DataError error={issuesQ.error} />
              {issues.length === 0 && !issuesQ.error ? (
                <p className="drv-sub">You have not reported any problems.</p>
              ) : (
                <ul className="ui-list">
                  {issues.map((i) => (
                    <li key={i.id} className="ui-row" style={{ paddingInline: 0 }}>
                      <div className="ui-row__main">
                        <p className="drv-row-title">{ISSUE_LABEL[i.type] ?? i.type}</p>
                        <p className="drv-issue-note">{i.note}</p>
                        <p className="drv-sub">{timeAgo(i.createdAt)}</p>
                      </div>
                      <Pill tone={i.status === 'resolved' ? 'ok' : 'warning'}>{i.status === 'resolved' ? 'Resolved' : 'Open'}</Pill>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Panel>
        )}

        {!loading && history.length > 0 && (
          <Panel title="Completed" note="Last 10" flush>
            <ul className="ui-list">
              {history.map((j) => {
                const list = normaliseStops(j.stops);
                const got = list.filter((s) => s.done).length;
                const cancelled = j.status === 'cancelled';
                return (
                  <li key={j.id} className="ui-row">
                    <div className="ui-row__main">
                      <p className="drv-row-title">{j.title ?? 'Collection route'}</p>
                      <p className="drv-sub">
                        {formatDate(j.completedAt ?? j.updatedAt)} · {got} of {plural(list.length, 'stop')} collected
                        {!cancelled && ` · ${durationText(j)}`}
                      </p>
                    </div>
                    <Pill tone={cancelled ? 'critical' : 'ok'}>{cancelled ? 'Cancelled' : 'Completed'}</Pill>
                  </li>
                );
              })}
            </ul>
          </Panel>
        )}

        {!loading && (
          <div className={`drv-bar${active ? ' drv-bar--two' : ''}`} role="group" aria-label="Job actions">
            {active && (
              started ? (
                <Button variant="primary" className="drv-big" loading={busy} onClick={onComplete}>Complete job</Button>
              ) : (
                <Button variant="primary" className="drv-big" loading={busy} onClick={() => setStatus(active, 'started', 'startedAt', 'start')}>Start job</Button>
              )
            )}
            <Button variant="ghost" className="drv-big" icon="hazard" onClick={() => openReport()}>Report a problem</Button>
          </div>
        )}

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Stops still unchecked"
        description={`${plural(remaining, 'stop')} not marked collected. Finish them, complete anyway, or tell the officer what went wrong.`}
      >
        <div className="drv-modal-actions">
          <Button variant="primary" className="drv-big" loading={busy} onClick={() => setStatus(active, 'completed', 'completedAt', 'complete')}>Complete anyway</Button>
          <Button variant="ghost" className="drv-big" icon="hazard" onClick={() => openReport({ binId: nextStop?.binId ?? '' })}>Report a problem instead</Button>
          <Button variant="quiet" className="drv-big" data-autofocus onClick={() => setConfirmOpen(false)}>Keep collecting</Button>
        </div>
      </Modal>

      <ReportModal
        key={reportOpen ? `open-${reportDefaults.binId}-${reportDefaults.type}` : 'closed'}
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        job={active}
        stops={stops}
        defaults={reportDefaults}
        uid={uid}
        name={profile?.name ?? ''}
        toast={toast}
      />
      </>
    </Page>
  );
}

function ReportModal({ open, onClose, job, stops, defaults, uid, name, toast }) {
  const [type, setType] = useState(defaults.type);
  const [binId, setBinId] = useState(defaults.binId);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!note.trim()) { setError('Add a short note so the officer knows what happened.'); return; }
    setSaving(true);
    try {
      const stop = stops.find((s) => s.binId === binId);
      await createRecord(
        'issues',
        { jobId: job?.id ?? null, driverUid: uid, driverName: name, type, binId: binId || null, note: note.trim(), status: 'open' },
        { action: 'issue.report', detail: `${ISSUE_LABEL[type]}${stop ? ` at ${stop.location}` : ''}: ${note.trim().slice(0, 120)}` },
      );
      toast.success('Problem reported. The officer has been told.');
      onClose();
    } catch {
      toast.error('Could not send your report. Your note is still here, try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Report a problem" description={job ? `About: ${job.title ?? 'your current job'}` : 'Not tied to a job'}>
      <form className="ui-form" onSubmit={submit} noValidate>
        <Field as="select" label="What happened?" value={type} onChange={(e) => setType(e.target.value)} data-autofocus>
          {ISSUE_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
        </Field>
        {stops.length > 0 && (
          <Field as="select" label="Which stop?" optional value={binId} onChange={(e) => setBinId(e.target.value)}>
            <option value="">No specific stop</option>
            {stops.map((s, idx) => (s.binId ? (
              <option key={s.i} value={s.binId}>{`Stop ${idx + 1}: ${s.location || s.binId}`}</option>
            ) : null))}
          </Field>
        )}
        <Field
          as="textarea"
          label="Note"
          value={note}
          error={error}
          onChange={(e) => { setNote(e.target.value); if (error) setError(''); }}
          placeholder="e.g. Gate locked, could not reach the bin"
          required
        />
        <div className="ui-form__actions">
          <Button variant="quiet" className="drv-big" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" className="drv-big" loading={saving}>Send report</Button>
        </div>
      </form>
    </Modal>
  );
}
