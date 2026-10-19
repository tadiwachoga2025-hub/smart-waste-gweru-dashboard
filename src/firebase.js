import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";
import { getAuth } from "firebase/auth";
import sharedConfig from "../firebase-config.json";

// The web config is public by design (Firebase ships it in every browser
// bundle) — what protects the data is the Realtime Database rules, not this
// file. It lives in one place so the Python tooling under scripts/ and the
// dashboard can never drift apart, and so a deployment can point at a
// different database (a LAN host, a staging instance) purely through
// VITE_FIREBASE_* environment variables, without touching the code.
const env = import.meta.env;

export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY || sharedConfig.apiKey,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || sharedConfig.authDomain,
  databaseURL: env.VITE_FIREBASE_DATABASE_URL || sharedConfig.databaseURL,
  projectId: env.VITE_FIREBASE_PROJECT_ID || sharedConfig.projectId,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || sharedConfig.storageBucket,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || sharedConfig.messagingSenderId,
  appId: env.VITE_FIREBASE_APP_ID || sharedConfig.appId,
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
export const auth = getAuth(app);
