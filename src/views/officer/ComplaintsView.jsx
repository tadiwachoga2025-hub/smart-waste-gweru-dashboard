import { useEffect, useMemo, useState } from 'react';
import { serverTimestamp } from 'firebase/database';
import {
  Button, DataError, EmptyState, Field, LoadingRows, Modal, Notice, Page, PageHead, Panel, Pill, Segmented, Stat, Stats, useToast,
} from '../../components/ui';
import Icon from '../../components/Icon.jsx';
import { useAuth } from '../../auth/AuthContext.jsx';
import { patchRecord, useList, useNewestFirst } from '../../data/useCollection';
import { COMPLAINT_STATUS, COMPLAINT_STATUS_KEYS, statusMeta, typeLabel } from '../../lib/complaints';
import { formatDateTime, plural, timeAgo, toMs } from '../../lib/format';
import './officer.css';

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const ACTIVE_JOB = ['assigned', 'started'];
const NOTE_MAX = 500;

/**
 * What an officer may do from each status. Lifecycle is
 * new -> reviewing -> assigned -> resolved, and a report can be rejected until
 * it is closed. Resolved and rejected are final.
 */
const ACTIONS = {
  review: {
    to: 'reviewing', label: 'Start review', from: ['new'], variant: 'primary',
    title: 'Start reviewing this report',
    lead: 'The resident will see that an officer is looking at their report.',
  },
  assign: {
    to: 'assigned', label: 'Mark crew arranged', from: ['reviewing'], variant: 'primary',
    title: 'Mark crew arranged',
    lead: 'Use this once a collection crew is on its way to deal with it.',
    noteLabel: 'Message to the resident', noteRequired: false,
    noteHint: 'Optional. A resident will read this, so say when to expect the crew if you can.',
  },
  resolve: {
    to: 'resolved', label: 'Resolve', from: ['reviewing', 'assigned'], variant: 'primary',
    title: 'Resolve this report',
    lead: 'This closes the report.',
    noteLabel: 'What was done', noteRequired: true,
    noteHint: 'A resident will read this. Say plainly what was done, and thank them for reporting.',
    noteMissing: 'Write a short note for the resident about what was done.',
  },
  reject: {
    to: 'rejected', label: 'Reject', from: ['new', 'reviewing', 'assigned'], variant: 'ghost',
    title: 'Reject this report',
    lead: 'This closes the report without action.',
    noteLabel: 'Reason', noteRequired: true,
    noteHint: 'A resident will read this. Be kind, say why we could not act, and what they can do next.',
    noteMissing: 'Give the resident a reason they can read.',
  },
};
const ACTION_ORDER = ['review', 'assign', 'resolve', 'reject'];
const actionsFor = (status) => ACTION_ORDER.filter((k) => ACTIONS[k].from.includes(status));

/** Per filter: what an empty queue means and where to go next. */
const EMPTY = {
  all: { title: 'No complaints yet', text: 'Residents report problems from their own Report a problem screen. They appear here as they arrive.' },
  new: { title: 'Nothing waiting for review', text: 'Every report has been picked up. New ones appear here as residents send them.' },
  reviewing: { title: 'Nothing under review', text: 'Reports you start reviewing wait here until a crew is arranged or you close them.' },
  assigned: { title: 'No crews arranged', text: 'Reports with a collection crew on the way are listed here until they are resolved.' },
  resolved: { title: 'Nothing resolved yet', text: 'Closed reports that were dealt with are kept here as a record.' },
  rejected: { title: 'Nothing rejected', text: 'Reports closed without action are kept here, with the reason the resident saw.' },
};

const isNum = (n) => typeof n === 'number' && Number.isFinite(n);
const closedAt = (c) => toMs(c.resolvedAt) ?? toMs(c.updatedAt);

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function hoursLabel(hours) {
  if (hours == null) return '—';
  if (hours < 0.1) return '<0.1';
  return hours < 10 ? String(Math.round(hours * 10) / 10) : String(Math.round(hours));
}

/** Address when we have one, else coordinates to four decimal places. */
function whereText(c) {
  if (typeof c.address === 'string' && c.address.trim()) return c.address.trim();
  if (isNum(c.lat) && isNum(c.lng)) return `${c.lat.toFixed(4)}, ${c.lng.toFixed(4)}`;
  return 'Location not given';
}

const mapUrl = (lat, lng) => `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=18/${lat}/${lng}`;
const safePhoto = (p) => (typeof p === 'string' && p.startsWith('data:image/') ? p : null);

/* ---------- Decision dialog ---------- */

function DecisionModal({ complaint, kind, openedStatus, activeJobs, onClose }) {
  const toast = useToast();
  const { uid, profile } = useAuth();
  const cfg = ACTIONS[kind];
  const [note, setNote] = useState('');
  const [jobId, setJobId] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const who = complaint.citizenName || 'a resident';
  const changed = !saving && complaint.status !== openedStatus;
  const asksNote = Boolean(cfg.noteLabel);

  const submit = async (e) => {
    e.preventDefault();
    if (changed) return;
    const text = note.trim();
    if (cfg.noteRequired && !text) {
      setError(cfg.noteMissing);
      return;
    }
    setError('');
    const patch = { status: cfg.to, reviewedBy: uid };
    if (profile?.name) patch.reviewedByName = profile.name;
    if (text) patch.officerNote = text;
    if (cfg.to === 'assigned' && jobId) patch.jobId = jobId;
    if (cfg.to === 'resolved') patch.resolvedAt = serverTimestamp();

    setSaving(true);
    try {
      await patchRecord(`complaints/${complaint.id}`, patch, {
        action: 'complaint.decision',
        detail: `${cfg.to} · ${typeLabel(complaint.type)}`,
      });
      toast.success(`Report from ${who} is now ${statusMeta(cfg.to).label.toLowerCase()}.`);
      onClose();
    } catch {
      setError('That did not save. Nothing was changed. Check your connection and try again.');
      toast.error('The report could not be updated. Try again.');
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={cfg.title} description={`${typeLabel(complaint.type)} from ${who}`}>
      <form className="ui-form" onSubmit={submit} noValidate>
        {complaint.note && <p className="off-quote">{complaint.note}</p>}
        <p className="off-lead">{cfg.lead}</p>
        {changed && (
          <Notice tone="warning">
            This report was changed by someone else while this window was open. Close it and check the queue.
          </Notice>
        )}
        {kind === 'assign' && (
          <Field
            label="Job for the crew"
            optional
            as="select"
            value={jobId}
            onChange={(e) => setJobId(e.target.value)}
            hint={activeJobs.length === 0
              ? 'There are no active jobs right now. You can still mark the crew as arranged.'
              : 'Link the job so the report shows which crew is on it.'}
          >
            <option value="">No job linked</option>
            {activeJobs.map((j) => (
              <option key={j.id} value={j.id}>{j.title} · {j.driverName}</option>
            ))}
          </Field>
        )}
        {asksNote && (
          <Field
            label={cfg.noteLabel}
            optional={!cfg.noteRequired}
            as="textarea"
            value={note}
            onChange={(e) => { setNote(e.target.value); if (error) setError(''); }}
            maxLength={NOTE_MAX}
            required={cfg.noteRequired}
            hint={cfg.noteHint}
            error={error && cfg.noteRequired && !note.trim() ? error : undefined}
            data-autofocus
          />
        )}
        {error && !(cfg.noteRequired && !note.trim()) && <Notice tone="error">{error}</Notice>}
        <div className="ui-form__actions">
          <Button onClick={onClose} data-autofocus={asksNote ? undefined : true}>Cancel</Button>
          <Button type="submit" variant="primary" loading={saving} disabled={changed}>{cfg.label}</Button>
        </div>
      </form>
    </Modal>
  );
}

/* ---------- One complaint ---------- */

function ComplaintRow({ complaint: c, now, binName, onAct, onPhoto }) {
  const meta = statusMeta(c.status);
  const photo = safePhoto(c.photo);
  const who = c.citizenName || 'A resident';
  const options = actionsFor(c.status);
  const hasCoords = isNum(c.lat) && isNum(c.lng);
  const final = c.status === 'resolved' || c.status === 'rejected';

  return (
    <li className={photo ? 'off-row' : 'off-row off-row--nophoto'}>
      {photo && (
        <button
          type="button"
          className="off-thumb"
          aria-label={`Open the photo from ${who} full size`}
          onClick={() => onPhoto(c)}
        >
          <img src={photo} alt={`Photo attached by ${who} to their ${typeLabel(c.type).toLowerCase()} report`} />
        </button>
      )}
      <div className="off-main">
        <div className="off-head">
          <span className="off-type">{typeLabel(c.type)}</span>
          <Pill tone={meta.tone}>{meta.label}</Pill>
        </div>
        <p className="off-meta">
          {who} · <span title={formatDateTime(c.createdAt)}>{timeAgo(c.createdAt, now)}</span>
        </p>
        <div className="off-where">
          <span>{whereText(c)}</span>
          {hasCoords && (
            <a
              className="off-link"
              href={mapUrl(c.lat, c.lng)}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Open map for ${whereText(c)} (opens in a new tab)`}
            >
              Open map
              <Icon name="arrowUpRight" size={14} />
            </a>
          )}
          {c.binId && <span>Bin: {binName ?? c.binId}</span>}
        </div>
        {c.note && <p className="off-note">{c.note}</p>}
        {c.officerNote && (
          <p className="off-reply"><strong>Message the resident sees</strong>{c.officerNote}</p>
        )}
      </div>
      {options.length > 0 ? (
        <div className="off-actions" role="group" aria-label={`Actions for the report from ${who}`}>
          {options.map((k) => (
            <Button key={k} variant={ACTIONS[k].variant} onClick={() => onAct(c, k)}>{ACTIONS[k].label}</Button>
          ))}
        </div>
      ) : final ? (
        <p className="off-final">Closed {timeAgo(closedAt(c), now)}</p>
      ) : null}
    </li>
  );
}

/* ---------- Main view ---------- */

export default function ComplaintsView({ data }) {
  const { can } = useAuth();
  const allowed = can('complaints.review');
  const complaintsQ = useList('complaints', { enabled: allowed });
  const jobsQ = useList('jobs', { enabled: allowed });
  const complaints = useNewestFirst(complaintsQ.items);

  const [choice, setChoice] = useState(null);
  const [decision, setDecision] = useState(null);
  const [photoFor, setPhotoFor] = useState(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 60000);
    return () => window.clearInterval(t);
  }, []);

  const counts = useMemo(() => {
    const out = { all: complaints.length };
    COMPLAINT_STATUS_KEYS.forEach((k) => { out[k] = 0; });
    complaints.forEach((c) => { if (c.status in out) out[c.status] += 1; });
    return out;
  }, [complaints]);

  const stats = useMemo(() => {
    const resolved = complaints.filter((c) => c.status === 'resolved');
    const recent = resolved.filter((c) => {
      const end = closedAt(c);
      return end != null && now - end <= 7 * DAY;
    });
    const durations = resolved
      .map((c) => {
        const start = toMs(c.createdAt);
        const end = closedAt(c);
        return start != null && end != null && end >= start ? (end - start) / HOUR : null;
      })
      .filter((h) => h != null);
    return { recent: recent.length, medianHours: median(durations) };
  }, [complaints, now]);

  const activeJobs = useMemo(() => jobsQ.items.filter((j) => ACTIVE_JOB.includes(j.status)), [jobsQ.items]);
  const binNames = useMemo(() => new Map((data?.bins ?? []).map((b) => [b.id, b.location])), [data]);

  if (!allowed) {
    return (
      <Page label="Complaints">
        <EmptyState icon="hazard" title="Complaints are not available to your account">
          Reviewing resident reports needs the complaints permission. Ask an administrator if you think you should have it.
        </EmptyState>
      </Page>
    );
  }

  const loading = complaintsQ.loading;
  const filter = choice ?? (counts.new > 0 ? 'new' : 'all');
  const visible = filter === 'all' ? complaints : complaints.filter((c) => c.status === filter);
  const live = (id) => complaints.find((c) => c.id === id) ?? null;
  const decisionComplaint = decision ? live(decision.id) : null;
  const photoComplaint = photoFor ? live(photoFor) : null;
  const dash = loading || complaintsQ.error;

  const options = [
    ...COMPLAINT_STATUS_KEYS.map((k) => ({ key: k, label: COMPLAINT_STATUS[k].label, count: counts[k] })),
    { key: 'all', label: 'All', count: counts.all },
  ];

  const filterLabel = filter === 'all' ? 'All complaints' : COMPLAINT_STATUS[filter].label;
  const nextFilter = filter !== 'new' && counts.new > 0 ? 'new' : 'all';
  const empty = EMPTY[filter];
  const emptyAction = filter === 'all' ? null : nextFilter === 'new'
    ? <Button onClick={() => setChoice('new')}>{`Review new reports (${counts.new})`}</Button>
    : counts.all > 0 ? <Button onClick={() => setChoice('all')}>{`Show all ${plural(counts.all, 'complaint')}`}</Button> : null;

  return (
    <Page label="Complaints">
      <PageHead
        eyebrow="Waste Management Officer"
        title="Complaints"
        sub="Reports from residents. Pick one up, arrange a crew, then close it with a note the resident can read."
      />

      <Stats>
        <Stat label="New" value={dash ? '—' : counts.new} tone={!dash && counts.new > 0 ? 'warning' : undefined} hint="Waiting for an officer" />
        <Stat label="Being reviewed" value={dash ? '—' : counts.reviewing} />
        <Stat label="Crew arranged" value={dash ? '—' : counts.assigned} />
        <Stat label="Resolved, last 7 days" value={dash ? '—' : stats.recent} tone={!dash && stats.recent > 0 ? 'ok' : undefined} />
        <Stat
          label="Median time to resolve"
          value={dash ? '—' : hoursLabel(stats.medianHours)}
          unit={!dash && stats.medianHours != null ? 'h' : undefined}
          hint="Report to resolution"
        />
      </Stats>

      <div className="off-filter">
        <Segmented options={options} value={filter} onChange={setChoice} label="Filter complaints by status" name="off-complaints" />
      </div>

      <Panel title={filterLabel} note={loading ? undefined : plural(visible.length, 'complaint')} flush>
        {complaintsQ.error ? (
          <div style={{ padding: '0 var(--sp-4) var(--sp-4)' }}><DataError error={complaintsQ.error} /></div>
        ) : loading ? (
          <LoadingRows rows={4} />
        ) : visible.length === 0 ? (
          <EmptyState icon="leaf" title={empty.title} action={emptyAction}>{empty.text}</EmptyState>
        ) : (
          <ul className="off-queue" aria-label={`${filterLabel}, newest first`}>
            {visible.map((c) => (
              <ComplaintRow
                key={c.id}
                complaint={c}
                now={now}
                binName={c.binId ? binNames.get(c.binId) : undefined}
                onAct={(item, kind) => setDecision({ id: item.id, kind, openedStatus: item.status })}
                onPhoto={(item) => setPhotoFor(item.id)}
              />
            ))}
          </ul>
        )}
      </Panel>

      {decision && decisionComplaint && (
        <DecisionModal
          key={`${decision.id}:${decision.kind}`}
          complaint={decisionComplaint}
          kind={decision.kind}
          openedStatus={decision.openedStatus}
          activeJobs={activeJobs}
          onClose={() => setDecision(null)}
        />
      )}
      <Modal
        open={Boolean(photoComplaint && safePhoto(photoComplaint.photo))}
        onClose={() => setPhotoFor(null)}
        wide
        title={`Photo from ${photoComplaint?.citizenName || 'a resident'}`}
        description={photoComplaint ? typeLabel(photoComplaint.type) : undefined}
      >
        {photoComplaint && safePhoto(photoComplaint.photo) && (
          <img
            className="off-photo"
            src={safePhoto(photoComplaint.photo)}
            alt={`Full size photo from ${photoComplaint.citizenName || 'a resident'} for their ${typeLabel(photoComplaint.type).toLowerCase()} report`}
          />
        )}
      </Modal>
    </Page>
  );
}
