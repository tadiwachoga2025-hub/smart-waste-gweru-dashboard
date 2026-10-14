import { useEffect, useMemo, useState } from 'react';
import {
  endAt, equalTo, limitToLast, onValue, orderByChild, orderByKey, push, query, ref,
  serverTimestamp, set, update,
} from 'firebase/database';
import { db } from '../firebase';
import { logAction } from '../lib/audit';

const NONE = [];
const asError = (err) => (/permission/i.test(err?.message ?? '') ? 'permission-denied' : 'unavailable');

/**
 * Live list of records under `path`, as [{ id, ...fields }].
 * Pass `where: ['driverUid', uid]` for a server-side filter. Rules require
 * this for roles that may only read their own records (drivers, citizens).
 * Pass `enabled: false` to stay idle (e.g. until a uid is known).
 *
 * Returns { items, loading, error }. A permission error lands in `error`
 * as the string 'permission-denied' so screens can say so plainly.
 */
export function useList(path, { where, limit, enabled = true } = {}) {
  const whereField = where?.[0];
  const whereValue = where?.[1];
  // Results are tagged with the query that produced them, so a changed query
  // reads as "loading" without ever calling setState synchronously in an effect.
  const key = enabled ? `${path}|${whereField ?? ''}|${whereValue ?? ''}|${limit ?? ''}` : null;
  const [state, setState] = useState({ key: null, items: NONE, error: null });

  useEffect(() => {
    if (!key) return undefined;
    let q = ref(db, path);
    if (whereField) q = query(q, orderByChild(whereField), equalTo(whereValue));
    else if (limit) q = query(q, orderByKey(), limitToLast(limit));
    return onValue(
      q,
      (snap) => {
        const val = snap.val() ?? {};
        setState({ key, items: Object.keys(val).map((id) => ({ id, ...val[id] })), error: null });
      },
      (err) => setState({ key, items: NONE, error: asError(err) }),
    );
  }, [key, path, whereField, whereValue, limit]);

  const fresh = key !== null && state.key === key;
  return {
    items: fresh ? state.items : NONE,
    loading: key !== null && !fresh,
    error: fresh ? state.error : null,
  };
}

/** Live single value at `path` (object with `id`, or null). */
export function useRecord(path, { enabled = true } = {}) {
  const key = enabled && path ? path : null;
  const [state, setState] = useState({ key: null, item: null, error: null });
  useEffect(() => {
    if (!key) return undefined;
    return onValue(
      ref(db, key),
      (snap) => {
        const val = snap.val();
        setState({ key, item: val == null ? null : { id: snap.key, ...val }, error: null });
      },
      (err) => setState({ key, item: null, error: asError(err) }),
    );
  }, [key]);
  const fresh = key !== null && state.key === key;
  return { item: fresh ? state.item : null, loading: key !== null && !fresh, error: fresh ? state.error : null };
}

/** Newest-first by a timestamp field (default createdAt). Stable for missing values. */
export function useNewestFirst(items, field = 'createdAt') {
  return useMemo(() => [...items].sort((a, b) => (Number(b[field]) || 0) - (Number(a[field]) || 0)), [items, field]);
}

/**
 * Create a record with a generated id. Stamps createdAt from the server.
 * `auditAs` is optional: { action, detail } writes an access-log entry.
 * Resolves to the new id.
 */
export async function createRecord(path, data, auditAs) {
  const node = push(ref(db, path));
  await set(node, { ...data, createdAt: serverTimestamp() });
  if (auditAs) logAction(auditAs.action, `${path}/${node.key}`, auditAs.detail ?? '');
  return node.key;
}

/** Create-or-replace at an exact path (e.g. devices/{binId}). */
export async function setRecord(path, data, auditAs) {
  await set(ref(db, path), { ...data, updatedAt: serverTimestamp() });
  if (auditAs) logAction(auditAs.action, path, auditAs.detail ?? '');
}

/**
 * Patch fields at `path`. Keys may be nested ('stops/2/done': true) to touch
 * one leaf, which is how drivers tick stops without rewriting the job.
 */
export async function patchRecord(path, patch, auditAs) {
  await update(ref(db, path), { ...patch, updatedAt: serverTimestamp() });
  if (auditAs) logAction(auditAs.action, path, auditAs.detail ?? '');
}

// Re-exported so screens needing a one-off query don't import firebase twice.
export { endAt };
