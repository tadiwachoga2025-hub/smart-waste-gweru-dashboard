import { useMemo, useState } from 'react';
import {
  Button, Check, DataError, EmptyState, Field, IconButton, LoadingRows, Notice, Page, PageHead,
  Panel, Pill, Stat, Stats, useToast,
} from '../../components/ui';
import { useAuth } from '../../auth/AuthContext.jsx';
import { patchRecord, useList, useNewestFirst, useRecord } from '../../data/useCollection.js';
import { formatDateTime, plural, timeAgo } from '../../lib/format.js';
import './alerts.css';

const DEFAULTS = { enabled: true, criticalAt: 90, rearmBelow: 75, minIntervalMinutes: 30 };
const MAX_RECIPIENTS = 10;
const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]{2,}$/;

const TYPE_LABEL = { critical: 'Bin full', test: 'Test' };
const STATUS = {
  sent: { label: 'Sent', tone: 'ok' },
  failed: { label: 'Failed', tone: 'critical' },
  skipped: { label: 'Skipped', tone: 'warning' },
};

/** Firebase may hand back an array or an index-keyed object. */
function toList(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return Object.values(value);
  return [];
}

const stringsOf = (value) => toList(value).filter((v) => typeof v === 'string' && v.trim() !== '');

const numOr = (value, fallback) => (Number.isFinite(Number(value)) && value !== null && value !== '' ? Number(value) : fallback);

/** Effective settings: stored values with documented defaults filling the gaps. */
function effective(item) {
  return {
    enabled: item?.enabled !== false,
    criticalAt: numOr(item?.criticalAt, DEFAULTS.criticalAt),
    rearmBelow: numOr(item?.rearmBelow, DEFAULTS.rearmBelow),
    minIntervalMinutes: numOr(item?.minIntervalMinutes, DEFAULTS.minIntervalMinutes),
  };
}

const whole = (raw) => (String(raw).trim() !== '' && Number.isInteger(Number(raw)) ? Number(raw) : null);

function validate(form) {
  const errors = {};
  const critical = whole(form.criticalAt);
  const rearm = whole(form.rearmBelow);
  const interval = whole(form.minIntervalMinutes);
  if (critical == null) errors.criticalAt = 'Enter a whole number between 50 and 100.';
  else if (critical < 50 || critical > 100) errors.criticalAt = 'The critical level must be between 50 and 100.';
  if (rearm == null) errors.rearmBelow = 'Enter a whole number between 0 and 99.';
  else if (rearm < 0 || rearm > 99) errors.rearmBelow = 'The reset level must be between 0 and 99.';
  else if (critical != null && rearm >= critical) errors.rearmBelow = 'The reset level must be lower than the critical level.';
  if (interval == null) errors.minIntervalMinutes = 'Enter a whole number of minutes between 5 and 1440.';
  else if (interval < 5 || interval > 1440) errors.minIntervalMinutes = 'The gap must be between 5 and 1440 minutes.';
  return errors;
}

function describeChanges(before, after) {
  const parts = [];
  if (before.enabled !== after.enabled) parts.push(after.enabled ? 'alerts resumed' : 'alerts paused');
  if (before.criticalAt !== after.criticalAt) parts.push(`critical level ${before.criticalAt}% to ${after.criticalAt}%`);
  if (before.rearmBelow !== after.rearmBelow) parts.push(`reset level ${before.rearmBelow}% to ${after.rearmBelow}%`);
  if (before.minIntervalMinutes !== after.minIntervalMinutes) {
    parts.push(`minimum gap ${before.minIntervalMinutes} to ${after.minIntervalMinutes} min`);
  }
  return parts.join('; ');
}

function binsText(row) {
  const places = stringsOf(row.binLocations);
  const names = places.length > 0 ? places : stringsOf(row.binIds);
  if (names.length === 0) return '—';
  if (names.length <= 3) return names.join(', ');
  return `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`;
}

export default function AlertsView({ data }) {
  const { can } = useAuth();
  const toast = useToast();
  const canView = can('alerts.view');
  const canManage = can('alerts.manage');

  const settings = useRecord('settings/alerts', { enabled: canView });
  const log = useList('alertLog', { limit: 100, enabled: canView });
  const entries = useNewestFirst(log.items, 'at');

  const saved = useMemo(() => effective(settings.item), [settings.item]);
  const recipients = useMemo(() => stringsOf(settings.item?.recipients), [settings.item]);

  // `draft` holds unsaved edits; null means the form simply mirrors what is saved.
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  const [recipientBusy, setRecipientBusy] = useState(false);

  if (!canView) {
    return (
      <Page label="Email alerts">
        <EmptyState icon="bell" title="Alerts are not available to your role">
          Bin-full email alerts are visible to administrators and officers.
        </EmptyState>
      </Page>
    );
  }

  const form = draft ?? {
    enabled: saved.enabled,
    criticalAt: String(saved.criticalAt),
    rearmBelow: String(saved.rearmBelow),
    minIntervalMinutes: String(saved.minIntervalMinutes),
  };
  const edit = (field, value) => setDraft({ ...form, [field]: value });
  const errors = validate(form);
  const next = Object.keys(errors).length === 0
    ? {
      enabled: form.enabled,
      criticalAt: Number(form.criticalAt),
      rearmBelow: Number(form.rearmBelow),
      minIntervalMinutes: Number(form.minIntervalMinutes),
    }
    : null;
  const changed = next != null && describeChanges(saved, next) !== '';
  const dirty = draft != null && (next == null || changed);
  // Show a field's message only after the person has touched the form.
  const shown = draft ? errors : {};

  const configured = settings.item != null;
  const bins = data?.bins;
  const binsKnown = Array.isArray(bins) && (bins.length > 0 || data?.status === 'live');
  const fullNow = binsKnown ? bins.filter((b) => Number(b.fillLevel) >= saved.criticalAt).length : null;
  const lastSent = entries.find((e) => e.status === 'sent');
  const newest = entries[0];

  const save = async () => {
    if (!canManage || !next || !changed || saving) return;
    setSaving(true);
    try {
      await patchRecord('settings/alerts', next, { action: 'alerts.settings', detail: describeChanges(saved, next) });
      setDraft(null);
      toast.success('Alert settings saved.');
    } catch {
      toast.error('Could not save the alert settings. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  const writeRecipients = async (list, detail, okMessage) => {
    setRecipientBusy(true);
    try {
      await patchRecord('settings/alerts', { recipients: list }, { action: 'alerts.recipients', detail });
      toast.success(okMessage);
      return true;
    } catch {
      toast.error('Could not update the recipients. Check your connection and try again.');
      return false;
    } finally {
      setRecipientBusy(false);
    }
  };

  const addRecipient = async (e) => {
    e.preventDefault();
    if (!canManage || recipientBusy) return;
    const value = email.trim().toLowerCase();
    if (value === '') { setEmailError('Enter an email address.'); return; }
    if (!EMAIL_RE.test(value)) { setEmailError('That does not look like an email address. Use the form name@example.com.'); return; }
    if (recipients.some((r) => r.toLowerCase() === value)) { setEmailError('That address is already on the list.'); return; }
    if (recipients.length >= MAX_RECIPIENTS) { setEmailError(`You can add up to ${MAX_RECIPIENTS} recipients. Remove one first.`); return; }
    setEmailError('');
    if (await writeRecipients([...recipients, value], `Added ${value}`, 'Recipient added.')) setEmail('');
  };

  const removeRecipient = (address) => {
    if (!canManage || recipientBusy) return;
    writeRecipients(recipients.filter((r) => r !== address), `Removed ${address}`, 'Recipient removed.');
  };

  const lastFailed = newest?.status === 'failed';

  return (
    <Page label="Email alerts">
      <PageHead
        eyebrow="Alerts"
        title="Bin-full email alerts"
        sub="An email is sent when a bin reaches the critical level, once per bin until it is emptied."
      />

      <DataError error={settings.error} />
      {!settings.loading && !settings.error && !configured && (
        <Notice tone="warning">
          Alerts have not been configured yet. The defaults below apply until someone adds a recipient or saves the settings.
        </Notice>
      )}
      {!canManage && (
        <Notice icon="bell">
          You can see the alert settings and history, but only an administrator can change them.
        </Notice>
      )}
      {lastFailed && (
        <Notice tone="error">
          {`The most recent alert failed${newest.error ? `: ${newest.error}` : '.'} The engine could not send email. Check the SMTP settings on the machine that runs engine.py (see docs/ALERTS.md).`}
        </Notice>
      )}

      <Stats>
        <Stat
          label="Alerts"
          value={saved.enabled ? 'Enabled' : 'Paused'}
          tone={saved.enabled ? 'ok' : 'warning'}
          hint={saved.enabled ? 'Emails go out automatically' : 'No emails will be sent'}
        />
        <Stat
          label="Recipients"
          value={settings.loading ? '…' : recipients.length}
          tone={!settings.loading && recipients.length === 0 ? 'warning' : undefined}
          hint={!settings.loading && recipients.length === 0 ? 'Nobody will receive an email' : undefined}
        />
        <Stat
          label={`Bins at ${saved.criticalAt}% or more`}
          value={fullNow == null ? '—' : fullNow}
          tone={fullNow ? 'critical' : undefined}
          hint={fullNow == null ? 'Bin readings not loaded' : 'Right now'}
        />
        <Stat
          label="Last email sent"
          value={log.loading ? '…' : lastSent ? timeAgo(lastSent.at) : 'Never'}
          hint={lastSent ? formatDateTime(lastSent.at) : undefined}
        />
      </Stats>

      <Panel title="Who gets the email" note={`${recipients.length} of ${MAX_RECIPIENTS} recipients`} flush={recipients.length > 0 || !canManage}>
        {settings.loading ? (
          <LoadingRows rows={2} />
        ) : recipients.length === 0 ? (
          <EmptyState icon="bell" title="No recipients yet">
            Nobody will be emailed when a bin fills up.{canManage ? ' Add an address below.' : ''}
          </EmptyState>
        ) : (
          <ul className="ui-list">
            {recipients.map((r) => (
              <li className="ui-row alr-recipient" key={r}>
                <span className="alr-recipient__email">{r}</span>
                {canManage && (
                  <IconButton
                    icon="trash"
                    label={`Remove ${r}`}
                    disabled={recipientBusy}
                    onClick={() => removeRecipient(r)}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
        {canManage && !settings.loading && (
          <form className="alr-add" onSubmit={addRecipient} noValidate style={recipients.length > 0 ? { padding: 'var(--sp-4) var(--sp-6) var(--sp-6)' } : undefined}>
            <Field
              label="Add recipient"
              type="email"
              inputMode="email"
              autoComplete="off"
              placeholder="name@example.com"
              value={email}
              error={emailError}
              hint="They will get one email per full bin."
              disabled={recipientBusy}
              onChange={(e) => { setEmail(e.target.value); setEmailError(''); }}
            />
            <Button className="alr-add__btn" type="submit" variant="primary" icon="plus" loading={recipientBusy}>Add</Button>
          </form>
        )}
      </Panel>

      <Panel title="When to send" note={dirty ? 'Unsaved changes' : undefined}>
        {settings.loading ? (
          <LoadingRows rows={3} />
        ) : (
          <form className="alr-settings" onSubmit={(e) => { e.preventDefault(); save(); }} noValidate>
            <Check
              label="Send bin-full emails"
              hint="Turn this off to pause every alert without losing your settings."
              checked={form.enabled}
              disabled={!canManage || saving}
              onChange={(e) => edit('enabled', e.target.checked)}
            />
            <div className="alr-settings__grid">
              <Field
                label="Critical level (%)"
                type="number"
                inputMode="numeric"
                min={50}
                max={100}
                step={1}
                value={form.criticalAt}
                error={shown.criticalAt}
                hint="A bin this full or fuller counts as full and triggers an email."
                disabled={!canManage || saving}
                onChange={(e) => edit('criticalAt', e.target.value)}
              />
              <Field
                label="Reset level (%)"
                type="number"
                inputMode="numeric"
                min={0}
                max={99}
                step={1}
                value={form.rearmBelow}
                error={shown.rearmBelow}
                hint="After an alert, the bin must drop below this level before it can trigger another."
                disabled={!canManage || saving}
                onChange={(e) => edit('rearmBelow', e.target.value)}
              />
              <Field
                label="Minimum gap (minutes)"
                type="number"
                inputMode="numeric"
                min={5}
                max={1440}
                step={1}
                value={form.minIntervalMinutes}
                error={shown.minIntervalMinutes}
                hint="The shortest wait between two emails, so a busy hour does not flood inboxes."
                disabled={!canManage || saving}
                onChange={(e) => edit('minIntervalMinutes', e.target.value)}
              />
            </div>
            {canManage && (
              <div className="ui-form__actions">
                {dirty && (
                  <Button onClick={() => setDraft(null)} disabled={saving}>Discard changes</Button>
                )}
                <Button type="submit" variant="primary" loading={saving} disabled={!dirty || !next || !changed}>
                  Save settings
                </Button>
              </div>
            )}
          </form>
        )}
      </Panel>

      <DataError error={log.error} />

      <Panel
        flush
        title="Recent alerts"
        note={log.loading ? 'Loading' : `${plural(entries.length, 'entry', 'entries')}, newest first`}
      >
        {log.loading ? (
          <LoadingRows rows={4} />
        ) : entries.length === 0 ? (
          <EmptyState icon="bell" title="No alerts yet">
            Entries appear here after the next engine run that finds a full bin.
          </EmptyState>
        ) : (
          <div className="ui-tablewrap">
            <table className="ui-table ui-table--stack">
              <thead>
                <tr>
                  <th scope="col">Time</th>
                  <th scope="col">Type</th>
                  <th scope="col">Bins</th>
                  <th scope="col">Recipients</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((r) => {
                  const st = STATUS[r.status] ?? { label: r.status || 'Unknown', tone: 'muted' };
                  return (
                    <tr key={r.id}>
                      <td data-label="Time">
                        <span>
                          <span className="ui-cell-strong">{formatDateTime(r.at)}</span>
                          <span className="ui-cell-sub">{timeAgo(r.at)}</span>
                        </span>
                      </td>
                      <td data-label="Type">{TYPE_LABEL[r.type] ?? r.type ?? '—'}</td>
                      <td data-label="Bins"><span className="alr-bins">{binsText(r)}</span></td>
                      <td data-label="Recipients">{toList(r.recipients).length}</td>
                      <td data-label="Status">
                        <span>
                          <Pill tone={st.tone}>{st.label}</Pill>
                          {(r.status === 'failed' || r.status === 'skipped') && r.error && (
                            <span className="ui-cell-sub">{r.error}</span>
                          )}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </Page>
  );
}
