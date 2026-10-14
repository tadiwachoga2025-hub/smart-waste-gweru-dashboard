import { useMemo, useState } from 'react';
import {
  Button, DataError, EmptyState, Field, LoadingRows, Page, PageHead, Panel, Pill, Segmented, Stat, Stats,
} from '../../components/ui';
import { useList } from '../../data/useCollection.js';
import { csvCell, downloadCsvLines } from '../../lib/csv.js';
import { formatDateTime, timeAgo, toMs } from '../../lib/format.js';
import { ROLES, ROLE_KEYS } from '../../lib/rbac.js';
import './admin.css';

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
  'auth.signout': 'Signed out',
  'auth.signin': 'Signed in',
};

const GROUPS = [
  { key: 'all', label: 'All actions' },
  { key: 'user', label: 'Accounts' },
  { key: 'job', label: 'Jobs' },
  { key: 'complaint', label: 'Complaints' },
  { key: 'device', label: 'Devices' },
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

function downloadCsv(rows) {
  const header = ['Time', 'Actor', 'Actor role', 'Action', 'Action id', 'Target', 'Detail'];
  const lines = rows.map((r) => {
    const ms = toMs(r.at);
    return [
      ms == null ? '' : new Date(ms).toISOString(),
      r.actorName, r.actorRole, actionLabel(r.action), r.action, r.target, r.detail,
    ].map(csvCell).join(',');
  });
  downloadCsvLines([header.map(csvCell).join(','), ...lines], `access-log-${new Date().toISOString().slice(0, 10)}.csv`);
}

/** Count for a health stat, or an honest dash when the read was refused. */
function countOf(list, predicate) {
  if (list.error) return { value: '—', hint: list.error === 'permission-denied' ? 'Not permitted to read' : 'Unavailable' };
  if (list.loading) return { value: '…', hint: 'Loading' };
  return { value: list.items.filter(predicate).length };
}

export default function AccessLogView({ data }) {
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
    <Page label="Access log">
      <PageHead
        eyebrow="System administrator"
        title="Access log"
        sub="A record of sensitive actions, with who did them and when."
        actions={(
          <Button icon="arrowUpRight" onClick={() => downloadCsv(rows)} disabled={rows.length === 0}>
            Download CSV
          </Button>
        )}
      />

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

      <Panel flush title="Activity" note={audit.loading ? 'Loading' : `${rows.length} of ${sorted.length} entries, newest first`}>
        <div className="adm-toolbar">
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
                        <span className="ui-cell-strong">{formatDateTime(r.at)}</span>
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
    </Page>
  );
}
