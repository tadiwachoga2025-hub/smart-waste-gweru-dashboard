// Plain-English sign-in/sign-up errors. Never reveals which half was wrong.
export function authMessage(err) {
  switch (err?.code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
    case 'auth/invalid-login-credentials':
      return 'That email and password do not match. Check them and try again.';
    case 'auth/invalid-email':
      return 'That does not look like an email address.';
    case 'auth/email-already-in-use':
      return 'An account with this email already exists. Try signing in instead.';
    case 'auth/weak-password':
      return 'Choose a password with at least 8 characters.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Wait a few minutes, or reset your password.';
    case 'auth/network-request-failed':
      return 'No connection. Check your internet and try again.';
    case 'auth/operation-not-allowed':
      return 'Email sign-in is not switched on for this project yet. An administrator needs to enable it in Firebase.';
    case 'PERMISSION_DENIED':
      return 'The database refused that request. Your account may not be allowed to do this.';
    default:
      return 'Something went wrong. Try again in a moment.';
  }
}
