"use client";

import { useAuth } from "@/hooks/useAuth";

/**
 * Header sign-in / signed-in widget. Calls useAuth() directly.
 *
 * - Firebase not configured (local docker-compose): renders nothing.
 * - Loading: renders a tiny "..." placeholder so the layout doesn't jump.
 * - Signed out: renders a "▸ SIGN IN WITH GOOGLE" mono pill button.
 * - Signed in: renders avatar + display name + small sign-out link.
 */
export function AuthControls() {
  const { user, loading, signInWithGoogle, signOut, isConfigured } = useAuth();

  if (!isConfigured) {
    return null;
  }

  if (loading) {
    return (
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        ...
      </span>
    );
  }

  if (!user) {
    return (
      <button
        type="button"
        onClick={() => {
          void signInWithGoogle();
        }}
        className="inline-flex items-center gap-2 border border-primary/40 bg-primary/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-primary transition-colors hover:bg-primary/20 hover:border-primary/80"
      >
        <span aria-hidden>▸</span>
        Sign in with Google
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em]">
      {user.photoURL ? (
        // Use a plain img (not next/image) — Google profile photos are
        // small, served from gstatic.com, and we don't want to plumb a
        // remote loader through next.config for one image.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={user.photoURL}
          alt=""
          className="h-5 w-5 rounded-full ring-1 ring-border"
        />
      ) : null}
      <span className="normal-case tracking-normal text-foreground/80">
        {user.displayName ?? user.email ?? "Signed in"}
      </span>
      <button
        type="button"
        onClick={() => {
          void signOut();
        }}
        className="text-muted-foreground hover:text-destructive"
        aria-label="Sign out"
      >
        × sign out
      </button>
    </div>
  );
}
