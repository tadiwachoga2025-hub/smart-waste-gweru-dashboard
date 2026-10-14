import { push, ref, serverTimestamp, set } from 'firebase/database';
import { db } from '../firebase';

// Sensitive operations leave a trail in /audit. Entries are append-only (the
// database rules refuse updates and deletes) and readable by administrators.

let actor = null;

/** AuthProvider calls this whenever the signed-in profile changes. */
export function setAuditActor(profile, uid) {
  actor = profile && uid ? { uid, name: profile.name ?? '', role: profile.role ?? '' } : null;
}

/**
 * Record an action. Never throws: a failed audit write must not block the
 * action it describes, so callers can fire and forget.
 *   logAction('user.create', 'users/abc', 'Created driver Tendai M.')
 */
export async function logAction(action, target = '', detail = '') {
  if (!actor) return;
  try {
    await set(push(ref(db, 'audit')), {
      at: serverTimestamp(),
      actorUid: actor.uid,
      actorName: actor.name,
      actorRole: actor.role,
      action,
      target,
      detail,
    });
  } catch (err) {
    console.warn('audit write failed', err);
  }
}
