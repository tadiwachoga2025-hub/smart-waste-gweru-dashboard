import { useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  Button, DataError, EmptyState, Field, LoadingRows, Notice, Page, PageHead, Panel, Pill, Segmented, Stat, Stats,
} from '../../components/ui';
import { useAuth } from '../../auth/AuthContext.jsx';
import { useList, useRecord } from '../../data/useCollection.js';
import { csvCell, downloadCsvLines } from '../../lib/csv.js';
import { formatDateTime, timeAgo, toMs } from '../../lib/format.js';
import { spring } from '../../lib/motion';
import { ROLES, ROLE_KEYS } from '../../lib/rbac.js';
import './admin.css';

// ---------------------------------------------------------------------------
// Audit logs: TWO logs in one section (Operate mode — one task, one screen).
//
//   Internal — who did what. Rows from /audit (append-only, administrators
//     only): account changes, job updates, complaint decisions, sign-ins.
//   External — what the system did. Rows from /engineLog (training runs,
//     collection cycles, errors, lifecycle) plus /alertLog (bin-full emails),
//     readable by administrators and officers.
//
// Design notes (Apple + Impeccable):
// - The tab switch is instant (Segmented with sliding pill) and the panels
//   cross-fade along one symmetric path, so entering and leaving never take
//   different routes (spatial consistency).
// - Critically damped springs everywhere; reduced-motion users get a plain
//   cross-fade with no slide.
// - The filter toolbar is a translucent material with content scrolling under
//   it, not an opaque bar that eats a fixed strip.
// ---------------------------------------------------------------------------

const ACTION_LABELS = {
  'user.create': 'Created an account',
  'user.role': 'Changed a role',
  'user.activate': 'Reactivated an account',
  'user.deactivate': 'Deactivated an account',
  'user.grants': 'Changed operational permissions',
  'job.assign': 'Assigned a job',
  'job.update': 'Updated a job',
  'job.complete': 'Completed a job',
  'complaint.submit': 'Submitted a complaint',
  'complaint.decision': 'Decided on a complaint',
  'device.register': 'Registered a device',
  'device.update': 'Updated a device',
  'device.fault': 'Flagged a device fault',
  'job.started': 'Started a job',
  'job.cancelled': 'Cancelled a job',
  'job.start': 'Started a job',
  'issue.report': 'Reported a driver problem',
  'issue.resolve': 'Resolved a driver problem',
  'truck.create': 'Added a truck',
  'truck.status': 'Changed a truck status',
  'device.report': 'Reported a device fault',
  'device.maintenance': 'Logged device maintenance',
  'alerts.settings': 'Changed alert settings',
  'alerts.recipients': 'Changed alert recipients',
  'auth.signout': 'Signed out',
  'auth.signin': 'Signed in',
};

const GROUPS = [
  { key: 'all', label: 'All actions' },
  { key: 'user', label: 'Accounts' },
  { key: 'job', label: 'Jobs' },
  { key: 'complaint', label: 'Complaints' },
  { key: 'device', label: 'Devices' },
  { key: 'alerts', label: 'Alerts' },
  { key: 'auth', label: 'Sign-in' },
];

const groupOf = (action = '') => String(action).split('.')[0];
const actionLabel = (action) => ACTION_LABELS[action] ?? action ?? '—';

const FEED = {
  live: { label: 'Live', tone: 'ok' },
  offline: { label: 'Offline', tone: 'warning' },
  error: { label: 'Feed error', tone: 'critical' },
  connecting: { label: 'Connecting', tone: 'warning' },
  idle: { label: 'Not subscribed', tone: undefined },
};

/** Count for a health stat, or an honest dash when the read was refused. */
function countOf(list, predicate) {
  if (list.error) return { value: '—', hint: list.error === 'permission-denied' ? 'Not permitted to read' : 'Unavailable' };
  if (list.loading) return { value: '…', hint: 'Loading' };
  return { value: list.items.filter(predicate).length };
}

function downloadInternalCsv(rows) {
  const header = ['Time', 'Actor', 'Actor role', 'Action', 'Action id', 'Target', 'Detail'];
  const lines = rows.map((r) => {
    const ms = toMs(r.at);
    return [
      ms == null ? '' : new Date(ms).toISOString(),
      r.actorName, r.actorRole, actionLabel(r.action), r.action, r.target, r.detail,
    ].map(csvCell).join(',');
  });
  downloadCsvLines([header.map(csvCell).join(','), ...lines], `internal-audit-${new Date().toISOString().slice(0, 10)}.csv`);
}

// ---------------------------------------------------------------------------
// Internal log: people and what they changed.
// ---------------------------------------------------------------------------
function InternalLog({ data }) {
  const audit = useList('audit', { limit: 300 });
  const issues = useList('issues');
  const complaints = useList('complaints');
  const devices = useList('devices');
  const users = useList('users');

  const [query, setQuery] = useState('');
  const [actorRole, setActorRole] = useState('all');
  const [group, setGroup] = useState('all');

  const feed = FEED[data?.status] ?? FEED.idle;
  const openIssues = countOf(issues, (i) => i.status === 'open');
  const newComplaints = countOf(complaints, (c) => c.status === 'new');
  const faulty = countOf(devices, (d) => d.status === 'faulty');
  const inactive = countOf(users, (u) => u.status !== 'active');

  const sorted = useMemo(
    () => [...audit.items].sort((a, b) => (toMs(b.at) ?? 0) - (toMs(a.at) ?? 0)),
    [audit.items],
  );

  const roleCounts = useMemo(() => {
    const c = Object.fromEntries(ROLE_KEYS.map((r) => [r, 0]));
    sorted.forEach((r) => { if (r.actorRole in c) c[r.actorRole] += 1; });
    return c;
  }, [sorted]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sorted.filter((r) => {
      if (actorRole !== 'all' && r.actorRole !== actorRole) return false;
      if (group !== 'all' && groupOf(r.action) !== group) return false;
      if (!q) return true;
      return `${r.actorName ?? ''} ${r.action ?? ''} ${actionLabel(r.action)} ${r.target ?? ''} ${r.detail ?? ''}`.toLowerCase().includes(q);
    });
  }, [sorted, query, actorRole, group]);

  const roleOptions = [
    { key: 'all', label: 'All', count: sorted.length },
    ...ROLE_KEYS.map((r) => ({ key: r, label: ROLES[r].short, count: roleCounts[r] })),
  ];

  const filtered = query || actorRole !== 'all' || group !== 'all';

  return (
    <>
      <Panel title="System health" note="Live counts across the system">
        <Stats>
          <Stat label="Sensor feed" value={feed.label} tone={feed.tone} />
          <Stat label="Bins reporting" value={data?.liveCount ?? 0} />
          <Stat label="Open driver issues" value={openIssues.value} hint={openIssues.hint} tone={typeof openIssues.value === 'number' && openIssues.value > 0 ? 'warning' : undefined} />
          <Stat label="New complaints" value={newComplaints.value} hint={newComplaints.hint} tone={typeof newComplaints.value === 'number' && newComplaints.value > 0 ? 'warning' : undefined} />
          <Stat label="Faulty devices" value={faulty.value} hint={faulty.hint} tone={typeof faulty.value === 'number' && faulty.value > 0 ? 'critical' : undefined} />
          <Stat label="Inactive accounts" value={inactive.value} hint={inactive.hint} />
        </Stats>
      </Panel>

      <DataError error={audit.error} />

      <Panel
        flush
        title="People activity"
        note={audit.loading ? 'Loading' : `${rows.length} of ${sorted.length} entries, newest first`}
        actions={(
          <Button icon="arrowUpRight" onClick={() => downloadInternalCsv(rows)} disabled={rows.length === 0}>
            Download CSV
          </Button>
        )}
      >
        <div className="adm-toolbar adm-toolbar--material">
          <Field className="adm-toolbar__search" label="Search actor, action or target" type="search" value={query} onChange={(e) => setQuery(e.target.value)} />
          <Field className="adm-toolbar__select" label="Action group" as="select" value={group} onChange={(e) => setGroup(e.target.value)}>
            {GROUPS.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
          </Field>
          <div className="adm-toolbar__group">
            <span className="adm-toolbar__label">Actor role</span>
            <Segmented name="adm-actor" label="Filter by actor role" options={roleOptions} value={actorRole} onChange={setActorRole} />
          </div>
        </div>

        {audit.loading ? (
          <LoadingRows rows={6} />
        ) : rows.length === 0 ? (
          <EmptyState icon="search" title={filtered ? 'No entries match' : 'Nothing recorded yet'}>
            {filtered
              ? 'Try a different search or clear the filters.'
              : 'Sensitive actions, such as creating accounts, changing roles, assigning jobs and signing out, are recorded here automatically.'}
          </EmptyState>
        ) : (
          <div className="ui-tablewrap">
            <table className="ui-table ui-table--stack">
              <thead>
                <tr>
                  <th scope="col">Time</th>
                  <th scope="col">Actor</th>
                  <th scope="col">Action</th>
                  <th scope="col">Target</th>
                  <th scope="col">Detail</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td data-label="Time">
                      <span>
                        <span className="ui-cell-strong tabular">{formatDateTime(r.at)}</span>
                        <span className="ui-cell-sub">{timeAgo(r.at)}</span>
                      </span>
                    </td>
                    <td data-label="Actor">
                      <span>
                        <span className="ui-cell-strong">{r.actorName || 'Unknown'}</span>
                        <Pill tone={r.actorRole === 'admin' ? 'info' : 'muted'}>{ROLES[r.actorRole]?.short ?? r.actorRole ?? 'Unknown'}</Pill>
                      </span>
                    </td>
                    <td data-label="Action">{actionLabel(r.action)}</td>
                    <td data-label="Target"><span className="ui-mono">{r.target || '—'}</span></td>
                    <td data-label="Detail"><span className="adm-detail">{r.detail || '—'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}

// ---------------------------------------------------------------------------
// External log: the system and what it did (engine + email alerts).
// ---------------------------------------------------------------------------
const EXT_GROUPS = [
  { key: 'all', label: 'Everything' },
  { key: 'training', label: 'Training' },
  { key: 'cycle', label: 'Cycles' },
  { key: 'alert', label: 'Alerts' },
  { key: 'error', label: 'Errors' },
];

const EXT_KIND_LABEL = {
  training: 'Model training',
  cycle: 'Collection cycle',
  alert: 'Bin-full email',
  error: 'Engine error',
  lifecycle: 'Engine lifecycle',
  test: 'Test email',
};

const EXT_STATUS_TONE = { ok: 'ok', sent: 'ok', info: 'info', warning: 'warning', skipped: 'warning', failed: 'critical' };

function metricsSummary(m) {
  if (!m || typeof m !== 'object') return '';
  const parts = [];
  if (m.binsSeen != null) parts.push(`${m.binsSeen} bins`);
  if (m.criticalBins != null) parts.push(`${m.criticalBins} critical`);
  if (m.samples != null) parts.push(`${m.samples} training samples`);
  if (m.rmseHours != null && m.rmseHours >= 0) parts.push(`RMSE ${m.rmseHours}h`);
  if (m.durationS != null) parts.push(`${m.durationS}s`);
  return parts.join(' · ');
}

function downloadExternalCsv(rows) {
  const header = ['Time', 'Source', 'Kind', 'Status', 'Detail', 'Summary'];
  const lines = rows.map((r) => {
    const ms = toMs(r.at);
    return [
      ms == null ? '' : new Date(ms).toISOString(),
      r.source, EXT_KIND_LABEL[r.kind] ?? r.kind, r.status, r.detail, metricsSummary(r.metrics),
    ].map(csvCell).join(',');
  });
  downloadCsvLines([header.map(csvCell).join(','), ...lines], `external-audit-${new Date().toISOString().slice(0, 10)}.csv`);
}

const ENGINE_STATE = {
  live: { label: 'Running', tone: 'ok' },
  starting: { label: 'Starting', tone: 'warning' },
  degraded: { label: 'Degraded', tone: 'warning' },
  error: { label: 'Error', tone: 'critical' },
  stopped: { label: 'Stopped', tone: 'critical' },
  idle: { label: 'Idle', tone: 'warning' },
};

function ExternalLog() {
  const status = useRecord('engineStatus');
  const engineLog = useList('engineLog', { limit: 200 });
  const alertLog = useList('alertLog', { limit: 100 });

  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('all');

  const unified = useMemo(() => {
    const engine = engineLog.items.map((r) => ({ ...r, source: 'engine' }));
    const alerts = alertLog.items.map((r) => ({
      id: r.id,
      at: r.at,
      source: 'alerts',
      kind: r.type === 'test' ? 'test' : 'alert',
      status: r.status ?? 'sent',
      detail: r.subject || (r.error ?? ''),
      metrics: { recipients: Array.isArray(r.recipients) ? r.recipients.length : 0 },
      bins: [...(r.binLocations ?? []), ...(r.binIds ?? [])].filter(Boolean),
    }));
    return [...engine, ...alerts].sort((a, b) => (toMs(b.at) ?? 0) - (toMs(a.at) ?? 0));
  }, [engineLog.items, alertLog.items]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return unified.filter((r) => {
      if (group === 'error') {
        if (!(r.kind === 'error' || r.status === 'failed')) return false;
      } else if (group === 'alert') {
        if (!(r.kind === 'alert' || r.kind === 'test')) return false;
      } else if (group !== 'all' && r.kind !== group) return false;
      if (!q) return true;
      return `${r.kind ?? ''} ${r.status ?? ''} ${r.detail ?? ''} ${(r.bins ?? []).join(' ')}`.toLowerCase().includes(q);
    });
  }, [unified, query, group]);

  const groupCounts = useMemo(() => {
    const isErr = (r) => r.kind === 'error' || r.status === 'failed';
    const isAlert = (r) => r.kind === 'alert' || r.kind === 'test';
    return {
      all: unified.length,
      training: unified.filter((r) => r.kind === 'training').length,
      cycle: unified.filter((r) => r.kind === 'cycle').length,
      alert: unified.filter(isAlert).length,
      error: unified.filter(isErr).length,
    };
  }, [unified]);

  const loading = engineLog.loading || alertLog.loading;
  const denied = engineLog.error === 'permission-denied' || alertLog.error === 'permission-denied';

  const hb = status.item;
  const state = ENGINE_STATE[hb?.state] ?? (status.loading ? { label: '…', tone: undefined } : { label: 'Never reported', tone: 'warning' });
  const lastMetrics = hb?.metrics ?? {};
  const trainings = unified.filter((r) => r.kind === 'training');
  const lastTraining = trainings[0];
  const sent = unified.filter((r) => r.status === 'sent').length;
  const failed = unified.filter((r) => r.status === 'failed').length;

  const filtered = query || group !== 'all';

  return (
    <>
      {!status.loading && !hb && !status.error && (
        <Notice tone="warning">
          The engine has never reported a heartbeat. It may not be running — start it with
          {' '}<span className="ui-mono">python engine.py --watch 300</span> on the machine that serves Firebase.
        </Notice>
      )}
      <DataError error={status.error} />
      <DataError error={denied ? 'permission-denied' : (engineLog.error || alertLog.error)} />

      <Panel title="Engine health" note={hb ? `Last heartbeat ${timeAgo(hb.at)}` : 'No heartbeat yet'}>
        <Stats>
          <Stat label="Engine" value={state.label} tone={state.tone} hint={hb ? formatDateTime(hb.at) : 'Waiting for the first cycle'} />
          <Stat label="Bins last seen" value={lastMetrics.binsSeen ?? '—'} hint={lastMetrics.criticalBins != null ? `${lastMetrics.criticalBins} critical` : undefined} tone={lastMetrics.criticalBins > 0 ? 'warning' : undefined} />
          <Stat
            label="Model error (RMSE)"
            value={lastTraining?.metrics?.rmseHours != null ? `${lastTraining.metrics.rmseHours}h` : '—'}
            hint={lastTraining ? `${lastTraining.metrics?.samples ?? '?'} samples${lastTraining.metrics?.resumed ? ' · resumed' : ''}` : 'No training run logged yet'}
          />
          <Stat label="Emails sent" value={loading ? '…' : sent} tone={sent > 0 ? 'ok' : undefined} />
          <Stat label="Failures" value={loading ? '…' : failed} tone={failed > 0 ? 'critical' : undefined} hint={failed > 0 ? 'See Errors below' : undefined} />
          <Stat label="Engine version" value={hb?.engine ?? '—'} />
        </Stats>
      </Panel>

      <Panel
        flush
        title="System activity"
        note={loading ? 'Loading' : `${rows.length} of ${unified.length} entries, newest first`}
        actions={(
          <Button icon="arrowUpRight" onClick={() => downloadExternalCsv(rows)} disabled={rows.length === 0}>
            Download CSV
          </Button>
        )}
      >
        <div className="adm-toolbar adm-toolbar--material">
          <Field className="adm-toolbar__search" label="Search detail, bins or status" type="search" value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className="adm-toolbar__group">
            <span className="adm-toolbar__label">Entry type</span>
            <Segmented
              name="adm-ext"
              label="Filter by entry type"
              options={EXT_GROUPS.map((g) => ({ ...g, count: groupCounts[g.key] ?? 0 }))}
              value={group}
              onChange={setGroup}
            />
          </div>
        </div>

        {loading ? (
          <LoadingRows rows={6} />
        ) : rows.length === 0 ? (
          <EmptyState icon="search" title={filtered ? 'No entries match' : 'Nothing recorded yet'}>
            {filtered
              ? 'Try a different search or clear the filter.'
              : 'Training runs, collection cycles and email alerts appear here after the next engine cycle.'}
          </EmptyState>
        ) : (
          <div className="ui-tablewrap">
            <table className="ui-table ui-table--stack">
              <thead>
                <tr>
                  <th scope="col">Time</th>
                  <th scope="col">Event</th>
                  <th scope="col">Status</th>
                  <th scope="col">Detail</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.source}-${r.id}`}>
                    <td data-label="Time">
                      <span>
                        <span className="ui-cell-strong tabular">{formatDateTime(r.at)}</span>
                        <span className="ui-cell-sub">{timeAgo(r.at)}</span>
                      </span>
                    </td>
                    <td data-label="Event">
                      <span>
                        <span className="ui-cell-strong">{EXT_KIND_LABEL[r.kind] ?? r.kind ?? '—'}</span>
                        <span className="ui-cell-sub">{r.source === 'engine' ? 'AI engine' : 'Email alerts'}</span>
                      </span>
                    </td>
                    <td data-label="Status">
                      <Pill tone={EXT_STATUS_TONE[r.status] ?? 'muted'}>{r.status ?? '—'}</Pill>
                    </td>
                    <td data-label="Detail">
                      <span className="adm-detail">
                        {r.detail || '—'}
                        {metricsSummary(r.metrics) && <span className="ui-cell-sub">{metricsSummary(r.metrics)}</span>}
                        {(r.bins?.length > 0) && <span className="ui-cell-sub">{r.bins.slice(0, 3).join(', ')}{r.bins.length > 3 ? ` and ${r.bins.length - 3} more` : ''}</span>}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}

// ---------------------------------------------------------------------------
// Section shell: Internal + External tabs.
// ---------------------------------------------------------------------------
export default function AccessLogView({ data }) {
  const { can } = useAuth();
  const reduceMotion = useReducedMotion();
  const canInternal = can('audit.view');
  const canExternal = can('audit.external');
  const [tab, setTab] = useState(canInternal ? 'internal' : 'external');

  const active = tab === 'internal' && canInternal ? 'internal'
    : tab === 'external' && canExternal ? 'external'
      : canInternal ? 'internal' : 'external';

  const tabs = [
    ...(canInternal ? [{ key: 'internal', label: 'Internal' }] : []),
    ...(canExternal ? [{ key: 'external', label: 'External' }] : []),
  ];

  // One symmetric path for both directions; reduced-motion gets a cross-fade.
  const panelMotion = reduceMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.12 } }
    : { initial: { opacity: 0, y: 12, filter: 'blur(6px)' }, animate: { opacity: 1, y: 0, filter: 'blur(0px)' }, exit: { opacity: 0, y: 12, filter: 'blur(6px)' }, transition: spring };

  return (
    <Page label="Audit logs">
      <PageHead
        eyebrow={canInternal && canExternal ? 'Administrator' : canInternal ? 'System administrator' : 'Operations'}
        title="Audit logs"
        sub={active === 'internal'
          ? 'Internal: who did what — every sensitive action, with who did it and when.'
          : 'External: what the system did — model training, collection cycles and email alerts.'}
        actions={tabs.length > 1 ? (
          <Segmented name="audit-tabs" label="Choose audit log" options={tabs} value={active} onChange={setTab} />
        ) : undefined}
      />

      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={active} {...panelMotion}>
          {active === 'internal' ? <InternalLog data={data} /> : <ExternalLog />}
        </motion.div>
      </AnimatePresence>
    </Page>
  );
}
