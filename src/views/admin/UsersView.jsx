import { useCallback, useMemo, useState } from 'react';
import {
  Button, Check, ConfirmModal, DataError, EmptyState, Field, LoadingRows, Modal, Notice, Page, PageHead,
  Panel, Pill, Segmented, Stat, Stats, useToast,
} from '../../components/ui';
import { useAuth } from '../../auth/AuthContext.jsx';
import { authMessage } from '../../auth/authMessage.js';
import { createStaffAccount } from '../../auth/adminApi.js';
import { patchRecord, useList } from '../../data/useCollection.js';
import { formatDate, plural } from '../../lib/format.js';
import { GRANTABLE, PERMISSIONS, ROLES, ROLE_KEYS, STAFF_ROLES } from '../../lib/rbac.js';
import './admin.css';

// 'device' is a machine identity for the sensors, never offered here.
const ASSIGNABLE_ROLES = ROLE_KEYS.filter((r) => r !== 'device');

const roleTone = { admin: 'info', officer: 'ok', driver: 'warning', technician: 'muted', citizen: 'muted' };

const grantCount = (u) => GRANTABLE.filter((p) => u.grants?.[p] === true).length;

const EMPTY_FORM = { name: '', email: '', password: '', role: 'officer' };

/** Strong random password, never containing look-alike characters. */
function generatePassword(length = 16) {
  const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnpqrstuvwxyz', '23456789', '!@#$%&*?'];
  const all = sets.join('');
  const rand = (n) => {
    const buf = new Uint32Array(1);
    const limit = Math.floor(0x100000000 / n) * n;
    do crypto.getRandomValues(buf); while (buf[0] >= limit);
    return buf[0] % n;
  };
  const chars = sets.map((s) => s[rand(s.length)]);
  while (chars.length < length) chars.push(all[rand(all.length)]);
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = rand(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

/* ---------- Add staff account ---------- */

function AddStaffModal({ open, onClose }) {
  const toast = useToast();
  const [form, setForm] = useState(EMPTY_FORM);
  const [generated, setGenerated] = useState(false);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    if (k === 'password') setGenerated(false);
  };

  const reset = () => { setForm(EMPTY_FORM); setGenerated(false); setErrors({}); setFormError(''); };

  const close = useCallback(() => {
    if (busy) return;
    reset();
    onClose();
  }, [busy, onClose]);

  const generate = () => {
    setForm((f) => ({ ...f, password: generatePassword() }));
    setGenerated(true);
    setErrors((e) => ({ ...e, password: undefined }));
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(form.password);
      toast.success('Password copied.');
    } catch {
      toast.error('Could not copy. Select the password and copy it by hand.');
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    const next = {};
    if (!form.name.trim()) next.name = 'Enter the person’s full name.';
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) next.email = 'Enter a valid email address.';
    if (form.password.length < 8) next.password = 'Use at least 8 characters.';
    if (!STAFF_ROLES.includes(form.role)) next.role = 'Choose a staff role.';
    setErrors(next);
    setFormError('');
    if (Object.keys(next).length) return;
    setBusy(true);
    try {
      await createStaffAccount(form);
      toast.success(`Account created for ${form.name.trim()}. Ask them to use ‘Forgot your password?’ on the sign-in screen to choose their own.`);
      setBusy(false);
      reset();
      onClose();
    } catch (err) {
      setFormError(authMessage(err));
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={close} title="Add staff account" description="Creates a sign-in and a profile with the role you choose. The account is active immediately.">
      <form className="ui-form" onSubmit={submit} noValidate>
        {formError && <Notice tone="error">{formError}</Notice>}
        <Field label="Full name" value={form.name} onChange={set('name')} error={errors.name} autoComplete="off" data-autofocus />
        <Field label="Email" type="email" value={form.email} onChange={set('email')} error={errors.email} autoComplete="off" />
        <div className="adm-pwrow">
          <Field
            label="Temporary password"
            type={generated ? 'text' : 'password'}
            value={form.password}
            onChange={set('password')}
            error={errors.password}
            hint="At least 8 characters."
            autoComplete="new-password"
          />
          <Button onClick={generate}>Generate</Button>
        </div>
        {generated && (
          <div className="adm-secret" role="status">
            <span className="adm-secret__value ui-mono">{form.password}</span>
            <Button size="sm" onClick={copy}>Copy</Button>
            <p className="adm-secret__note">Shown once. It disappears when you close this window, so copy it now if you need it.</p>
          </div>
        )}
        <Field label="Role" as="select" value={form.role} onChange={set('role')} error={errors.role}>
          {STAFF_ROLES.map((r) => <option key={r} value={r}>{ROLES[r].label}</option>)}
        </Field>
        <div className="ui-form__actions">
          <Button onClick={close} disabled={busy}>Cancel</Button>
          <Button variant="primary" type="submit" loading={busy}>Create account</Button>
        </div>
      </form>
    </Modal>
  );
}

/* ---------- Manage one account ---------- */

function ManageModal({ user, users, selfUid, onClose }) {
  const toast = useToast();
  const [role, setRole] = useState(user.role);
  const [name, setName] = useState(user.name ?? '');
  const [phone, setPhone] = useState(user.phone ?? '');
  const [active, setActive] = useState(user.status === 'active');
  const [grants, setGrants] = useState(() => Object.fromEntries(GRANTABLE.map((p) => [p, user.grants?.[p] === true])));
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const isSelf = user.id === selfUid;
  const wasActive = user.status === 'active';
  const activeAdmins = users.filter((u) => u.role === 'admin' && u.status === 'active');
  const isLastAdmin = user.role === 'admin' && wasActive && activeAdmins.length <= 1;

  const locked = isSelf || isLastAdmin;
  const lockReason = isSelf
    ? 'This is your own account. You cannot change your role or deactivate it. Ask another administrator to do that.'
    : isLastAdmin
      ? 'This is the last active administrator. Make another administrator active before changing this role or deactivating the account.'
      : '';

  const toggleGrant = (perm) => (e) => setGrants((g) => ({ ...g, [perm]: e.target.checked }));

  const save = async () => {
    setError('');
    if (!name.trim()) { setError('Name cannot be empty.'); return; }
    if (locked && wasActive && (role !== user.role || !active)) { setError(lockReason); return; }

    const path = `users/${user.id}`;
    const base = { name: name.trim(), phone: phone.trim() || null };
    const who = user.name || user.email || user.id;
    const steps = [];
    if (role !== user.role) {
      steps.push({
        patch: { role, ...(role !== 'admin' ? { grants: null } : {}) },
        audit: { action: 'user.role', detail: `Changed ${who} from ${user.role} to ${role}` },
      });
    }
    if (active !== wasActive) {
      steps.push({
        patch: { status: active ? 'active' : 'inactive' },
        audit: { action: active ? 'user.activate' : 'user.deactivate', detail: `${active ? 'Reactivated' : 'Deactivated'} ${who}` },
      });
    }
    if (role === 'admin') {
      const changed = GRANTABLE.some((p) => (grants[p] === true) !== (user.grants?.[p] === true));
      if (changed) {
        const next = Object.fromEntries(GRANTABLE.map((p) => [p, grants[p] ? true : null]));
        steps.push({
          patch: { grants: next },
          audit: { action: 'user.grants', detail: `Operational permissions for ${who}: ${GRANTABLE.filter((p) => grants[p]).join(', ') || 'none'}` },
        });
      }
    }

    setBusy(true);
    try {
      if (steps.length === 0) {
        await patchRecord(path, base);
      } else {
        // Profile details ride along with the first audited change.
        for (let i = 0; i < steps.length; i += 1) {
          await patchRecord(path, i === 0 ? { ...base, ...steps[i].patch } : steps[i].patch, steps[i].audit);
        }
      }
      toast.success(`Saved changes for ${who}.`);
      onClose();
    } catch (err) {
      setError(authMessage(err));
      setBusy(false);
    }
  };

  const requestStatus = () => {
    if (active) setConfirming(true);
    else setActive(true);
  };

  return (
    <>
      <Modal open={!confirming} onClose={busy ? () => {} : onClose} title="Manage account" description={user.email} wide>
        <form className="ui-form" onSubmit={(e) => { e.preventDefault(); save(); }} noValidate>
          {error && <Notice tone="error">{error}</Notice>}
          {lockReason && <Notice tone="warning">{lockReason}</Notice>}
          <Field label="Full name" value={name} onChange={(e) => setName(e.target.value)} data-autofocus />
          <div className="ui-form__row">
            <Field label="Phone" optional type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="off" />
            <Field label="Role" as="select" value={role} onChange={(e) => setRole(e.target.value)} disabled={locked && wasActive}>
              {ASSIGNABLE_ROLES.map((r) => <option key={r} value={r}>{ROLES[r].label}</option>)}
            </Field>
          </div>

          <div className="adm-statusrow">
            <div className="adm-statusrow__text">
              <span className="adm-section__title">Account status</span>
              <Pill tone={active ? 'ok' : 'critical'}>{active ? 'Active' : 'Inactive'}</Pill>
            </div>
            <Button variant={active ? 'danger' : 'primary'} onClick={requestStatus} disabled={locked && wasActive && active}>
              {active ? 'Deactivate account' : 'Reactivate account'}
            </Button>
          </div>
          {!active && wasActive && <Notice tone="warning">This account will be deactivated when you save. They lose access straight away.</Notice>}

          {role === 'admin' && (
            <fieldset className="adm-section adm-fieldset">
              <legend className="adm-section__title">Operational permissions</legend>
              <Notice icon="sparkle">
                Administrators get operational abilities only when they are granted explicitly here, never automatically.
              </Notice>
              <div className="adm-perms">
                {GRANTABLE.map((p) => (
                  <Check key={p} label={PERMISSIONS[p]} checked={grants[p]} onChange={toggleGrant(p)} />
                ))}
              </div>
            </fieldset>
          )}

          <div className="ui-form__actions">
            <Button onClick={onClose} disabled={busy}>Cancel</Button>
            <Button variant="primary" type="submit" loading={busy}>Save changes</Button>
          </div>
        </form>
      </Modal>
      <ConfirmModal
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={() => { setActive(false); setConfirming(false); }}
        title="Deactivate this account?"
        confirmLabel="Deactivate"
        danger
      >
        {`${user.name || user.email} will be blocked from the app and from reading any data. You can reactivate the account later. The change applies when you save.`}
      </ConfirmModal>
    </>
  );
}

/* ---------- Screen ---------- */

export default function UsersView() {
  const { uid } = useAuth();
  const { items: users, loading, error } = useList('users');
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);

  const counts = useMemo(() => {
    const byRole = Object.fromEntries(ROLE_KEYS.map((r) => [r, 0]));
    let active = 0;
    users.forEach((u) => {
      if (u.role in byRole) byRole[u.role] += 1;
      if (u.status === 'active') active += 1;
    });
    return { byRole, active, inactive: users.length - active };
  }, [users]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users
      .filter((u) => roleFilter === 'all' || u.role === roleFilter)
      .filter((u) => statusFilter === 'all' || (statusFilter === 'active') === (u.status === 'active'))
      .filter((u) => !q || `${u.name ?? ''} ${u.email ?? ''}`.toLowerCase().includes(q))
      .sort((a, b) => String(a.name ?? a.email ?? '').localeCompare(String(b.name ?? b.email ?? '')));
  }, [users, query, roleFilter, statusFilter]);

  const editing = users.find((u) => u.id === editingId) ?? null;

  const roleOptions = [
    { key: 'all', label: 'All', count: users.length },
    ...ROLE_KEYS.map((r) => ({ key: r, label: ROLES[r].short, count: counts.byRole[r] })),
  ];
  const statusOptions = [
    { key: 'all', label: 'All', count: users.length },
    { key: 'active', label: 'Active', count: counts.active },
    { key: 'inactive', label: 'Inactive', count: counts.inactive },
  ];

  return (
    <Page label="Users">
      <PageHead
        eyebrow="System administrator"
        title="Users"
        sub="Create staff accounts, set roles and switch access on or off."
        actions={<Button variant="primary" icon="plus" onClick={() => setAdding(true)}>Add staff account</Button>}
      />

      <DataError error={error} />

      <Stats>
        <Stat label="Total accounts" value={users.length} />
        <Stat label="Active" value={counts.active} tone="ok" />
        <Stat label="Inactive" value={counts.inactive} tone={counts.inactive ? 'warning' : undefined} />
        {ROLE_KEYS.map((r) => <Stat key={r} label={ROLES[r].short} value={counts.byRole[r]} hint={plural(counts.byRole[r], 'account')} />)}
      </Stats>

      <Panel flush title="Accounts" note={loading ? 'Loading' : `${rows.length} of ${users.length} shown`}>
        <div className="adm-toolbar">
          <Field className="adm-toolbar__search" label="Search by name or email" type="search" value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className="adm-toolbar__group">
            <span className="adm-toolbar__label">Role</span>
            <Segmented name="adm-role" label="Filter by role" options={roleOptions} value={roleFilter} onChange={setRoleFilter} />
          </div>
          <div className="adm-toolbar__group">
            <span className="adm-toolbar__label">Status</span>
            <Segmented name="adm-status" label="Filter by status" options={statusOptions} value={statusFilter} onChange={setStatusFilter} />
          </div>
        </div>

        {loading ? (
          <LoadingRows />
        ) : rows.length === 0 ? (
          <EmptyState icon="search" title={users.length === 0 ? 'No accounts yet' : 'No accounts match'}>
            {users.length === 0 ? 'Add a staff account to get started.' : 'Try a different search or clear the filters.'}
          </EmptyState>
        ) : (
          <div className="ui-tablewrap">
            <table className="ui-table ui-table--stack">
              <thead>
                <tr>
                  <th scope="col">Account</th>
                  <th scope="col">Role</th>
                  <th scope="col">Status</th>
                  <th scope="col">Created</th>
                  <th scope="col">Explicit permissions</th>
                  <th scope="col"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((u) => (
                  <tr key={u.id}>
                    <td data-label="Account">
                      <span>
                        <span className="ui-cell-strong">{u.name || 'Unnamed'}{u.id === uid ? ' (you)' : ''}</span>
                        <span className="ui-cell-sub">{u.email}</span>
                      </span>
                    </td>
                    <td data-label="Role"><Pill tone={roleTone[u.role] ?? 'muted'}>{ROLES[u.role]?.short ?? u.role ?? 'Unknown'}</Pill></td>
                    <td data-label="Status"><Pill tone={u.status === 'active' ? 'ok' : 'critical'}>{u.status === 'active' ? 'Active' : 'Inactive'}</Pill></td>
                    <td data-label="Created">{formatDate(u.createdAt)}</td>
                    <td data-label="Explicit permissions">{u.role === 'admin' ? `${grantCount(u)} of ${GRANTABLE.length}` : '—'}</td>
                    <td data-label="Actions">
                      <div className="ui-table__actions">
                        <Button size="sm" onClick={() => setEditingId(u.id)} aria-label={`Manage ${u.name || u.email}`}>Manage</Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <AddStaffModal open={adding} onClose={() => setAdding(false)} />
      {editing && <ManageModal key={editing.id} user={editing} users={users} selfUid={uid} onClose={() => setEditingId(null)} />}
    </Page>
  );
}
