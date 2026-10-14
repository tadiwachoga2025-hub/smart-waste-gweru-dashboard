import { deleteApp, initializeApp } from 'firebase/app';
import { createUserWithEmailAndPassword, getAuth, signOut, updateProfile } from 'firebase/auth';
import { ref, serverTimestamp, set } from 'firebase/database';
import { db, firebaseConfig } from '../firebase';
import { logAction } from '../lib/audit';
import { STAFF_ROLES } from '../lib/rbac';

/**
 * Create a staff account (administrators only: the database rules refuse the
 * profile write for anyone else).
 *
 * Creating an Auth user normally signs that user in, which would log the
 * administrator out. A throwaway second Firebase app does the creation, so the
 * admin's session is untouched.
 *
 * Production note: a Cloud Function or the Admin SDK is the stronger home for
 * this, and the only way to truly disable a login (we deactivate by profile
 * status, which blocks the app and every database read). See docs/RBAC.md.
 */
export async function createStaffAccount({ name, email, password, role }) {
  if (!STAFF_ROLES.includes(role)) throw new Error('Unknown staff role');
  const secondary = initializeApp(firebaseConfig, `staff-create-${Date.now()}`);
  try {
    const secondaryAuth = getAuth(secondary);
    const cred = await createUserWithEmailAndPassword(secondaryAuth, email.trim(), password);
    await updateProfile(cred.user, { displayName: name.trim() });
    await set(ref(db, `users/${cred.user.uid}`), {
      name: name.trim(),
      email: email.trim().toLowerCase(),
      role,
      status: 'active',
      createdAt: serverTimestamp(),
    });
    await signOut(secondaryAuth);
    logAction('user.create', `users/${cred.user.uid}`, `Created ${role} account for ${name.trim()}`);
    return cred.user.uid;
  } finally {
    await deleteApp(secondary);
  }
}
