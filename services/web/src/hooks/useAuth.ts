"use client";

import { useEffect, useState, useCallback } from "react";
import {
  GoogleAuthProvider,
  signInWithPopup,
  signOut as fbSignOut,
  onAuthStateChanged,
  type User,
} from "firebase/auth";

import { auth, isFirebaseConfigured } from "@/lib/firebaseClient";

/**
 * React hook exposing the current Firebase Auth user and sign-in/out actions.
 *
 * - When Firebase is not configured (e.g., local docker-compose without env
 *   vars), `user` stays null and `isConfigured` is false. Sign-in functions
 *   become no-ops so callers don't have to special-case the local setup.
 * - `loading` starts true while the initial auth state is resolving and
 *   flips to false on the first onAuthStateChanged callback.
 */
export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(isFirebaseConfigured);

  useEffect(() => {
    if (!auth) {
      setLoading(false);
      return;
    }
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
  }, []);

  const signInWithGoogle = useCallback(async () => {
    if (!auth) return;
    await signInWithPopup(auth, new GoogleAuthProvider());
  }, []);

  const signOut = useCallback(async () => {
    if (!auth) return;
    await fbSignOut(auth);
  }, []);

  return {
    user,
    loading,
    signInWithGoogle,
    signOut,
    isConfigured: isFirebaseConfigured,
  };
}
