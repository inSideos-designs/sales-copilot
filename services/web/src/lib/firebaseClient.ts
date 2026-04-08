/**
 * Firebase client initialization.
 *
 * Reads NEXT_PUBLIC_FIREBASE_* env vars (baked into the client bundle at
 * build time by Next.js). Firebase API keys are PUBLIC by design — they
 * are identifiers, not secrets. Auth security comes from the authorized
 * domains list configured in the Firebase console.
 *
 * Gracefully degrades when env vars are missing: `auth` becomes null and
 * `isFirebaseConfigured` is false. The rest of the app should check
 * `isFirebaseConfigured` before showing sign-in UI.
 */

import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
};

let app: FirebaseApp | null = null;

export const auth: Auth | null = (() => {
  if (!config.apiKey || !config.authDomain || !config.projectId) {
    return null;
  }
  app = getApps()[0] ?? initializeApp({
    apiKey: config.apiKey,
    authDomain: config.authDomain,
    projectId: config.projectId,
  });
  return getAuth(app);
})();

export const isFirebaseConfigured = auth !== null;
