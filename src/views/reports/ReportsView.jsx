// Role-scoped reports. One screen, four scopes. The person sees only the most
// privileged scope they hold: reports.all > reports.devices > reports.jobs >
// reports.own. Each scope is its own component so it subscribes only to the
// feeds the database rules let that role read. Everything is computed
// client-side from records.

import { useMemo, useState } from 'react';
import { useAuth } from '../../auth/AuthContext.jsx';
import { useList } from '../../data/useCollection.js';
import {
  Button, DataError, EmptyState, LoadingRows, Page, PageHead, Panel, Pill, Segmented, Stat, Stats,
} from '../../components/ui/index.jsx';
import { csvCell, downloadCsvLines } from '../../lib/csv.js';
import { formatDate, formatDateTime, plural, timeAgo, toMs } from '../../lib/format.js';
import { BarSeries, DonutOrStackedBar } from './charts.jsx';
import './reports.css';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const STALE_AFTER_HOURS = 6; // a bin silent for longer than this is "stale"
const RANGES = [
  { key: 7, label: '7 days' },
  { key: 30, label: '30 days' },
  { key: 90, label: '90 days' },
];

/* ---------- helpers ---------- */

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const toArray = (v) => (Array.isArray(v) ? v.filter(Boolean) : v && typeof v === 'object' ? Object.values(v) : []);
const ratio = (n, d) => (d > 0 ? n / d : null);
const pctText = (r) => (r == null ? '—' : `${Math.round(r * 100)}%`);

function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const mean = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);

function hoursText(h) {
  if (h == null) return '—';
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `${h.toFixed(1)} h`;
  return `${(h / 24).toFixed(1)} days`;
}
function durationText(ms) {
  if (ms == null) return '—';
  const mins = Math.max(1, Math.round(ms / 60_000));
  return mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)} h ${mins % 60} min`;
}
const daysText = (d) => (d == null ? '—' : d < 1 ? '< 1 day' : `${d.toFixed(1)} days`);

const shortDay = (ms) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

/** Time a job "happened": finished, else started, else created. */
const jobTime = (j) => toMs(j.completedAt) ?? toMs(j.startedAt) ?? toMs(j.createdAt);
const createdTime = (r) => toMs(r.createdAt);

function within(items, getTime, from) {
  return items.filter((i) => {
    const t = getTime(i);
    return t != null && t >= from;
  });
}

/** Count per bucket across the range. Daily up to 30 days, weekly beyond (or when `weekly`). */
function bucketCounts(items, getTime, now, days, weekly = false) {
  const size = weekly || days > 30 ? 7 : 1;
  const count = Math.ceil(days / size);
  const start = now - count * size * DAY;
  const buckets = Array.from({ length: count }, (_, i) => ({
    label: shortDay(start + (i + 1) * size * DAY - DAY),
    value: 0,
  }));
  for (const it of items) {
    const t = getTime(it);
    if (t == null || t < start || t > now) continue;
    const i = Math.min(count - 1, Math.floor((t - start) / (size * DAY)));
    buckets[i].value += 1;
  }
  return buckets;
}

function downloadCsv(tables, filename) {
  const lines = [];
  tables.forEach((t, i) => {
    if (i) lines.push('');
    if (tables.length > 1) lines.push(csvCell(t.title));
    lines.push(t.columns.map((c) => csvCell(c.label)).join(','));
    for (const r of t.rows) lines.push(t.columns.map((c) => csvCell(r.csv?.[c.key] ?? r[c.key])).join(','));
  });
  downloadCsvLines(lines, filename);
}

const COMPLAINT_STATUS = {
  new: { label: 'New', tone: 'warning' },
  reviewing: { label: 'Reviewing', tone: 'info' },
  assigned: { label: 'Assigned', tone: 'info' },
  resolved: { label: 'Resolved', tone: 'ok' },
  rejected: { label: 'Rejected', tone: 'muted' },
};
const JOB_STATUS = {
  assigned: { label: 'Assigned', tone: 'info' },
  started: { label: 'Started', tone: 'warning' },
  completed: { label: 'Completed', tone: 'ok' },
  cancelled: { label: 'Cancelled', tone: 'muted' },
};
const OPEN_COMPLAINT = ['new', 'reviewing', 'assigned'];
const MAINT_TYPE = { inspection: 'Inspection', repair: 'Repair', replacement: 'Replacement', calibration: 'Calibration', report: 'Report' };

/* ---------- shared pieces ---------- */

function ReportTable({ columns, rows, caption }) {
  return (
    <div className="ui-tablewrap">
      <table className="ui-table ui-table--stack">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>{columns.map((c) => <th key={c.key} scope="col" className={c.num ? 'ui-table__num' : undefined}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              {columns.map((c) => (
                <td key={c.key} data-label={c.label} className={c.num ? 'ui-table__num' : undefined}>{r[c.key]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Table panel that falls back to a quiet line when the range holds nothing. */
function TablePanel({ title, note, table, emptyText }) {
  return (
    <Panel title={title} note={note} flush>
      {table.rows.length ? (
        <ReportTable columns={table.columns} rows={table.rows} caption={title} />
      ) : (
        <p className="ui-muted rp-empty-pad" style={{ paddingInline: 'var(--sp-6)' }}>{emptyText}</p>
      )}
    </Panel>
  );
}

function Shell({ eyebrow, sub, range, onRange, tables, filename, states, children }) {
  const loading = states.some((s) => s.loading);
  const error = states.find((s) => s.error)?.error;
  const exportable = tables.filter((t) => t.rows.length);
  return (
    <Page label="Reports">
      <PageHead
        eyebrow={eyebrow}
        title="Reports"
        sub={sub}
        actions={(
          <>
            <Segmented name="rp-range" label="Time range" options={RANGES} value={range} onChange={onRange} />
            <Button
              variant="primary"
              disabled={loading || !exportable.length}
              onClick={() => downloadCsv(exportable, `${filename}-${range}d.csv`)}
              title={exportable.length ? undefined : 'Nothing to export for this range'}
            >
              Download CSV
            </Button>
          </>
        )}
      />
      {error ? <DataError error={error} /> : loading ? <LoadingRows rows={5} /> : <div className="rp-stack">{children}</div>}
    </Page>
  );
}

function RangeEmpty({ range, onRange, what }) {
  return (
    <Panel>
      <EmptyState
        icon="calendar"
        title={`No ${what} in the last ${range} days`}
        action={range < 90 ? <Button onClick={() => onRange(90)}>Show last 90 days</Button> : null}
      >
        {range < 90 ? 'Try a wider time range to see more activity.' : 'Nothing has been recorded in the widest range yet.'}
      </EmptyState>
    </Panel>
  );
}

/* ---------- scope: all operations ---------- */

function AllReports({ data, range, onRange, now }) {
  const jobsQ = useList('jobs');
  const complaintsQ = useList('complaints');
  const issuesQ = useList('issues');
  const from = now - range * DAY;

  const r = useMemo(() => {
    const jobs = within(jobsQ.items, jobTime, from);
    const completed = jobs.filter((j) => j.status === 'completed');
    const cancelled = jobs.filter((j) => j.status === 'cancelled');
    const stopsOf = (j) => toArray(j.stops);
    const stopsCollected = jobs.reduce((s, j) => s + stopsOf(j).filter((st) => st.done).length, 0);
    const complaints = within(complaintsQ.items, createdTime, from);
    const resolved = complaints.filter((c) => c.status === 'resolved');
    const hours = resolved
      .map((c) => ((toMs(c.updatedAt) ?? NaN) - (toMs(c.createdAt) ?? NaN)) / HOUR)
      .filter((h) => Number.isFinite(h) && h >= 0);
    const issues = within(issuesQ.items, createdTime, from);

    const perDriver = new Map();
    for (const j of jobs) {
      const key = j.driverUid ?? 'unassigned';
      const row = perDriver.get(key) ?? { name: j.driverName || 'Unassigned', jobs: 0, done: 0, stops: 0 };
      row.jobs += 1;
      if (j.status === 'completed') row.done += 1;
      row.stops += stopsOf(j).filter((st) => st.done).length;
      perDriver.set(key, row);
    }
    const driverRows = [...perDriver.entries()]
      .sort((a, b) => b[1].jobs - a[1].jobs)
      .map(([id, d]) => ({
        id, driver: d.name, jobs: d.jobs, stops: d.stops, rate: pctText(ratio(d.done, d.jobs)),
      }));

    const binName = new Map((data?.bins ?? []).map((b) => [b.id, b.location]));
    const perPlace = new Map();
    for (const c of complaints) {
      const name = (c.binId && binName.get(c.binId)) || c.address || (c.binId ? `Bin ${c.binId}` : 'Location not given');
      const row = perPlace.get(name) ?? { total: 0, open: 0 };
      row.total += 1;
      if (OPEN_COMPLAINT.includes(c.status)) row.open += 1;
      perPlace.set(name, row);
    }
    const placeRows = [...perPlace.entries()]
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 8)
      .map(([name, p]) => ({ id: name, place: name, reports: p.total, open: p.open }));

    return {
      jobs, completed: completed.length, cancelled: cancelled.length, stopsCollected,
      complaints, resolved: resolved.length, medianHours: median(hours),
      issues, openIssues: issuesQ.items.filter((i) => i.status === 'open').length,
      perDay: bucketCounts(completed, jobTime, now, range),
      statusParts: Object.entries(COMPLAINT_STATUS).map(([key, s]) => ({
        key, label: s.label, tone: s.tone, value: complaints.filter((c) => c.status === key).length,
      })),
      driverRows, placeRows,
    };
  }, [jobsQ.items, complaintsQ.items, issuesQ.items, data, from, now, range]);

  const driverTable = {
    title: 'Jobs by driver',
    columns: [
      { key: 'driver', label: 'Driver' },
      { key: 'jobs', label: 'Jobs', num: true },
      { key: 'stops', label: 'Stops collected', num: true },
      { key: 'rate', label: 'Completion rate', num: true },
    ],
    rows: r.driverRows,
  };
  const placeTable = {
    title: 'Most-reported locations',
    columns: [
      { key: 'place', label: 'Location' },
      { key: 'reports', label: 'Reports', num: true },
      { key: 'open', label: 'Still open', num: true },
    ],
    rows: r.placeRows,
  };

  const bands = data?.metrics?.bands ?? [];
  const bandParts = bands.map((b) => ({
    key: b.key, label: b.label, range: b.range, value: b.count,
    tone: { critical: 'critical', high: 'warning', medium: 'info', low: 'ok' }[b.key],
  }));
  const quiet = !r.jobs.length && !r.complaints.length && !r.issues.length;

  return (
    <Shell
      eyebrow="All operations"
      sub={`Collections, complaints and driver issues over the last ${range} days.`}
      range={range}
      onRange={onRange}
      tables={[driverTable, placeTable]}
      filename="operations-report"
      states={[jobsQ, complaintsQ, issuesQ]}
    >
      <Stats>
        <Stat label="Jobs completed" value={r.completed} hint={`of ${plural(r.jobs.length, 'job')} in range`} tone="ok" />
        <Stat label="Stops collected" value={r.stopsCollected} />
        <Stat
          label="On-time proxy"
          value={pctText(ratio(r.completed, r.completed + r.cancelled))}
          hint={`${r.completed} completed, ${r.cancelled} cancelled`}
        />
        <Stat label="Complaints received" value={r.complaints.length} hint={`${r.resolved} resolved`} />
        <Stat label="Median time to resolve" value={hoursText(r.medianHours)} hint="Complaints resolved in range" />
        <Stat label="Open driver issues" value={r.openIssues} hint="Right now" tone={r.openIssues ? 'warning' : undefined} />
      </Stats>

      {quiet ? (
        <RangeEmpty range={range} onRange={onRange} what="jobs, complaints or issues" />
      ) : (
        <>
          <div className="rp-grid">
            <Panel title={range > 30 ? 'Collections completed per week' : 'Collections completed per day'} note="Completed jobs">
              <BarSeries data={r.perDay} label="Jobs completed" />
            </Panel>
            <Panel title="Complaints by status" note={`Received in the last ${range} days`}>
              {r.complaints.length ? (
                <DonutOrStackedBar parts={r.statusParts} label="Complaints by status" />
              ) : (
                <p className="ui-muted">No complaints received in this range.</p>
              )}
            </Panel>
            <Panel title="Bins by fill level" note="Right now, not affected by range">
              {bandParts.length && (data?.metrics?.activeBins ?? 0) > 0 ? (
                <DonutOrStackedBar parts={bandParts} label="Bins by fill band" />
              ) : (
                <p className="ui-muted">No live bin readings are available.</p>
              )}
            </Panel>
          </div>
          <TablePanel title="Jobs by driver" note="Completion rate is completed jobs out of all jobs in range" table={driverTable} emptyText="No jobs in this range." />
          <TablePanel title="Most-reported locations" table={placeTable} emptyText="No complaints in this range." />
        </>
      )}
    </Shell>
  );
}

/* ---------- scope: devices ---------- */

function DeviceReports({ data, range, onRange, now }) {
  const devicesQ = useList('devices');
  const maintQ = useList('maintenance');
  const from = now - range * DAY;

  const r = useMemo(() => {
    const bins = data?.bins ?? [];
    const registered = new Set(devicesQ.items.map((d) => d.binId ?? d.id));
    const count = (s) => devicesQ.items.filter((d) => d.status === s).length;
    const parts = [
      { key: 'active', label: 'Active', tone: 'ok', value: count('active') },
      { key: 'faulty', label: 'Faulty', tone: 'critical', value: count('faulty') },
      { key: 'replaced', label: 'Replaced', tone: 'info', value: count('replaced') },
      { key: 'retired', label: 'Retired', tone: 'muted', value: count('retired') },
      { key: 'unregistered', label: 'Unregistered bins', tone: 'warning', value: bins.filter((b) => !registered.has(b.id)).length },
    ];
    const maint = within(maintQ.items, createdTime, from).sort((a, b) => createdTime(b) - createdTime(a));
    const stale = bins
      .map((b) => ({ b, t: toMs(b.lastUpdated) }))
      .filter(({ t }) => t == null || now - t > STALE_AFTER_HOURS * HOUR)
      .sort((a, c) => (a.t ?? -Infinity) - (c.t ?? -Infinity));
    const binName = new Map(bins.map((b) => [b.id, b.location]));
    return { parts, maint, stale, binName, binCount: bins.length };
  }, [devicesQ.items, maintQ.items, data, from, now]);

  const staleTable = {
    title: 'Bins with stale readings',
    columns: [
      { key: 'bin', label: 'Bin' },
      { key: 'last', label: 'Last reading' },
      { key: 'fill', label: 'Last fill', num: true },
    ],
    rows: r.stale.slice(0, 10).map(({ b, t }) => ({
      id: b.id,
      bin: b.location && b.location !== b.id ? `${b.location} (${b.id})` : b.id,
      last: t == null ? 'No reading' : timeAgo(t, now),
      csv: { last: t == null ? 'No reading' : new Date(t).toISOString() },
      fill: `${num(b.fillLevel)}%`,
    })),
  };
  const maintTable = {
    title: 'Recent maintenance',
    columns: [
      { key: 'when', label: 'When' },
      { key: 'bin', label: 'Bin' },
      { key: 'type', label: 'Type' },
      { key: 'tech', label: 'Technician' },
      { key: 'note', label: 'Note' },
    ],
    rows: r.maint.slice(0, 10).map((m) => ({
      id: m.id,
      when: formatDateTime(m.createdAt),
      csv: { when: new Date(createdTime(m)).toISOString() },
      bin: r.binName.get(m.binId) ?? m.binId ?? '—',
      type: MAINT_TYPE[m.type] ?? m.type ?? '—',
      tech: m.techName ?? '—',
      note: m.note ?? '',
    })),
  };

  const totalDevices = devicesQ.items.length;
  const faulty = r.parts[1].value;

  return (
    <Shell
      eyebrow="Device health"
      sub={`Sensor status now, and maintenance over the last ${range} days.`}
      range={range}
      onRange={onRange}
      tables={[staleTable, maintTable]}
      filename="device-report"
      states={[devicesQ, maintQ]}
    >
      <Stats>
        <Stat label="Registered devices" value={totalDevices} />
        <Stat label="Faulty" value={faulty} tone={faulty ? 'critical' : undefined} />
        <Stat label="Stale readings" value={r.stale.length} hint={`Silent for over ${STALE_AFTER_HOURS} hours`} tone={r.stale.length ? 'warning' : undefined} />
        <Stat label="Maintenance actions" value={r.maint.length} hint={`Last ${range} days`} />
      </Stats>
      <div className="rp-grid">
        <Panel title="Device health" note="Right now, not affected by range">
          {totalDevices || r.parts[4].value ? (
            <DonutOrStackedBar parts={r.parts} label="Device health breakdown" />
          ) : (
            <p className="ui-muted">No devices registered yet.</p>
          )}
        </Panel>
        <Panel title="Maintenance per week" note={`Last ${range} days`}>
          {r.maint.length ? (
            <BarSeries data={bucketCounts(r.maint, createdTime, now, range, true)} label="Maintenance actions per week" />
          ) : (
            <EmptyState icon="calendar" title={`No maintenance in the last ${range} days`}>
              {range < 90 ? 'Try a wider time range.' : 'No maintenance has been logged yet.'}
            </EmptyState>
          )}
        </Panel>
      </div>
      <TablePanel
        title="Bins with stale readings"
        note={r.binCount ? `${plural(r.stale.length, 'bin')}${r.stale.length > 10 ? ', showing the 10 quietest' : ''}` : undefined}
        table={staleTable}
        emptyText={r.binCount ? 'Every bin has reported recently.' : 'No live bin readings are available.'}
      />
      <TablePanel title="Recent maintenance" note={r.maint.length > 10 ? 'Showing the latest 10' : undefined} table={maintTable} emptyText="No maintenance in this range. Try a wider range." />
    </Shell>
  );
}

/* ---------- scope: driver ---------- */

function DriverReports({ range, onRange, now, uid }) {
  const jobsQ = useList('jobs', { where: ['driverUid', uid], enabled: Boolean(uid) });
  const issuesQ = useList('issues', { where: ['driverUid', uid], enabled: Boolean(uid) });
  const from = now - range * DAY;

  const r = useMemo(() => {
    const jobs = within(jobsQ.items, jobTime, from).sort((a, b) => jobTime(b) - jobTime(a));
    const completed = jobs.filter((j) => j.status === 'completed');
    const stops = (j) => toArray(j.stops);
    const durations = completed
      .map((j) => (toMs(j.completedAt) ?? NaN) - (toMs(j.startedAt) ?? NaN))
      .filter((d) => Number.isFinite(d) && d >= 0);
    return {
      jobs, completed,
      stopsCollected: jobs.reduce((s, j) => s + stops(j).filter((st) => st.done).length, 0),
      avgDuration: mean(durations),
      issues: within(issuesQ.items, createdTime, from).length,
      stops,
    };
  }, [jobsQ.items, issuesQ.items, from]);

  const table = {
    title: 'Recent jobs',
    columns: [
      { key: 'job', label: 'Job' },
      { key: 'status', label: 'Status' },
      { key: 'when', label: 'Date' },
      { key: 'stops', label: 'Stops', num: true },
      { key: 'duration', label: 'Duration', num: true },
    ],
    rows: r.jobs.slice(0, 10).map((j) => {
      const s = JOB_STATUS[j.status] ?? { label: j.status ?? '—', tone: 'muted' };
      const st = r.stops(j);
      const dur = (toMs(j.completedAt) ?? NaN) - (toMs(j.startedAt) ?? NaN);
      return {
        id: j.id,
        job: j.title ?? 'Collection job',
        status: <Pill tone={s.tone}>{s.label}</Pill>,
        csv: { status: s.label, when: new Date(jobTime(j)).toISOString() },
        when: formatDate(jobTime(j)),
        stops: `${st.filter((x) => x.done).length} / ${st.length}`,
        duration: Number.isFinite(dur) && dur >= 0 ? durationText(dur) : '—',
      };
    }),
  };

  return (
    <Shell
      eyebrow="Your jobs"
      sub={`Your collections over the last ${range} days.`}
      range={range}
      onRange={onRange}
      tables={[table]}
      filename="my-jobs-report"
      states={[jobsQ, issuesQ]}
    >
      <Stats>
        <Stat label="Jobs completed" value={r.completed.length} tone="ok" />
        <Stat label="Stops collected" value={r.stopsCollected} />
        <Stat label="Completion rate" value={pctText(ratio(r.completed.length, r.jobs.length))} hint={`${r.completed.length} of ${plural(r.jobs.length, 'job')}`} />
        <Stat label="Average job duration" value={durationText(r.avgDuration)} hint="Started to completed" />
        <Stat label="Issues reported" value={r.issues} />
      </Stats>
      {r.jobs.length ? (
        <>
          <Panel title={range > 30 ? 'Jobs completed per week' : 'Jobs completed per day'}>
            <BarSeries data={bucketCounts(r.completed, jobTime, now, range)} label="Your jobs completed" />
          </Panel>
          <TablePanel title="Recent jobs" note={r.jobs.length > 10 ? 'Showing the latest 10' : undefined} table={table} emptyText="" />
        </>
      ) : (
        <RangeEmpty range={range} onRange={onRange} what="jobs" />
      )}
    </Shell>
  );
}

/* ---------- scope: citizen ---------- */

function CitizenReports({ range, onRange, now, uid }) {
  const q = useList('complaints', { where: ['citizenUid', uid], enabled: Boolean(uid) });
  const from = now - range * DAY;

  const r = useMemo(() => {
    const mine = within(q.items, createdTime, from).sort((a, b) => createdTime(b) - createdTime(a));
    const resolved = mine.filter((c) => c.status === 'resolved');
    const days = resolved
      .map((c) => ((toMs(c.updatedAt) ?? NaN) - (toMs(c.createdAt) ?? NaN)) / DAY)
      .filter((d) => Number.isFinite(d) && d >= 0);
    return {
      mine,
      resolved: resolved.length,
      open: mine.filter((c) => OPEN_COMPLAINT.includes(c.status)).length,
      avgDays: mean(days),
    };
  }, [q.items, from]);

  const TYPE = { overflow: 'Overflowing bin', missed: 'Missed collection', other: 'Other problem' };
  const table = {
    title: 'Your reports',
    columns: [
      { key: 'what', label: 'Report' },
      { key: 'where', label: 'Where' },
      { key: 'sent', label: 'Sent' },
      { key: 'status', label: 'Status' },
    ],
    rows: r.mine.map((c) => {
      const s = COMPLAINT_STATUS[c.status] ?? { label: c.status ?? '—', tone: 'muted' };
      return {
        id: c.id,
        what: TYPE[c.type] ?? 'Report',
        where: c.address || (c.binId ? `Bin ${c.binId}` : '—'),
        sent: formatDate(c.createdAt),
        csv: { sent: new Date(createdTime(c)).toISOString(), status: s.label },
        status: <Pill tone={s.tone}>{s.label}</Pill>,
      };
    }),
  };

  return (
    <Shell
      eyebrow="Your reports"
      sub={`Problems you reported in the last ${range} days.`}
      range={range}
      onRange={onRange}
      tables={[table]}
      filename="my-reports"
      states={[q]}
    >
      <Stats>
        <Stat label="Reports submitted" value={r.mine.length} />
        <Stat label="Resolved" value={r.resolved} tone="ok" />
        <Stat label="Still open" value={r.open} tone={r.open ? 'warning' : undefined} />
        <Stat label="Average time to resolution" value={daysText(r.avgDays)} />
      </Stats>
      {r.mine.length ? (
        <TablePanel title="Your reports" table={table} emptyText="" />
      ) : (
        <RangeEmpty range={range} onRange={onRange} what="reports from you" />
      )}
    </Shell>
  );
}

/* ---------- entry ---------- */

export default function ReportsView({ data }) {
  const { can, uid } = useAuth();
  const [range, setRange] = useState(30);
  const [now] = useState(() => Date.now());

  const common = { range, onRange: setRange, now };
  if (can('reports.all')) return <AllReports data={data} {...common} />;
  if (can('reports.devices')) return <DeviceReports data={data} {...common} />;
  if (can('reports.jobs')) return <DriverReports uid={uid} {...common} />;
  if (can('reports.own')) return <CitizenReports uid={uid} {...common} />;

  return (
    <Page label="Reports">
      <PageHead title="Reports" />
      <Panel>
        <EmptyState icon="hazard" title="No reports available">
          Your account does not have access to any reports. Ask an administrator if you need them.
        </EmptyState>
      </Panel>
    </Page>
  );
}
