import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  createUserWithEmailAndPassword, onAuthStateChanged, sendPasswordResetEmail,
  signInWithEmailAndPassword, signOut, updateProfile,
} from 'firebase/auth';
import { onValue, ref, serverTimestamp, set } from 'firebase/database';
import { auth, db } from '../firebase';
import { can as canDo, canAny as canAnyOf, dataAccess } from '../lib/rbac';
import { logAction, setAuditActor } from '../lib/audit';

const AuthContext = createContext(null);

/**
 * status:
 *   loading    waiting for Firebase to say who is signed in
 *   signedOut  nobody; show the sign-in screen
 *   ready      signed in with an active profile; `profile.role` decides the app
 *   blocked    signed in but not allowed in: reason 'inactive' | 'no-profile'
 */
export function AuthProvider({ children }) {
  const [authUser, setAuthUser] = useState(undefined); // undefined = not yet known
  // The profile is tagged with the uid it belongs to, so switching accounts
  // reads as "loading" until the new profile arrives.
  const [profileState, setProfileState] = useState({ uid: null, value: undefined });

  useEffect(() => onAuthStateChanged(auth, setAuthUser), []);

  useEffect(() => {
    if (!authUser) return undefined;
    const uid = authUser.uid;
    return onValue(
      ref(db, `users/${uid}`),
      (snap) => setProfileState({ uid, value: snap.val() }),
      () => setProfileState({ uid, value: null }),
    );
  }, [authUser]);

  // undefined = not yet known, null = none
  const profile = !authUser ? null : profileState.uid === authUser.uid ? profileState.value : undefined;

  useEffect(() => {
    setAuditActor(profile && profile.status === 'active' ? profile : null, authUser?.uid);
  }, [profile, authUser]);

  const status = useMemo(() => {
    if (authUser === undefined) return 'loading';
    if (!authUser) return 'signedOut';
    if (profile === undefined) return 'loading';
    if (profile === null) return 'blocked';
    if (profile.status !== 'active') return 'blocked';
    return 'ready';
  }, [authUser, profile]);

  const reason = status === 'blocked' ? (profile ? 'inactive' : 'no-profile') : null;

  const signIn = useCallback(async (email, password) => {
    await signInWithEmailAndPassword(auth, email.trim(), password);
  }, []);

  // Public sign-up always creates a citizen. The database rules refuse any
  // other role on self-registration, so this is not just a UI choice.
  const register = useCallback(async ({ name, email, password }) => {
    const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
    await updateProfile(cred.user, { displayName: name.trim() });
    await set(ref(db, `users/${cred.user.uid}`), {
      name: name.trim(),
      email: email.trim().toLowerCase(),
      role: 'citizen',
      status: 'active',
      createdAt: serverTimestamp(),
    });
  }, []);

  const resetPassword = useCallback((email) => sendPasswordResetEmail(auth, email.trim()), []);

  const logout = useCallback(async () => {
    await logAction('auth.signout', `users/${authUser?.uid ?? ''}`);
    await signOut(auth);
  }, [authUser]);

  const value = useMemo(() => {
    const current = status === 'ready' ? profile : null;
    return {
      status,
      reason,
      uid: authUser?.uid ?? null,
      email: authUser?.email ?? '',
      profile: current,
      role: current?.role ?? null,
      access: dataAccess(current),
      can: (perm) => canDo(current, perm),
      canAny: (perms) => canAnyOf(current, perms),
      signIn,
      register,
      resetPassword,
      logout,
    };
  }, [status, reason, profile, authUser, signIn, register, resetPassword, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
