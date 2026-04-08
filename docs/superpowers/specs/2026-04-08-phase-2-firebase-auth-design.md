# Phase 2 — Firebase Auth (permissive plumbing)

**Status:** approved design, ready for implementation planning
**Date:** 2026-04-08
**Author:** brainstormed in collaboration with the project owner
**Related:** [Phase 1 plan](../plans/2026-04-07-phase-1-skeleton.md), [original architecture spec](2026-04-07-sales-copilot-design.md)

---

## Purpose

Land the entire authentication pipeline — Firebase Google sign-in on the web side, JWT validation on the gateway side — **without enforcing it**. Phase 2 ships invisible plumbing so that Phase 3 (real STT) and Phase 4 (real LLM) have a `session.user` to gate, meter, and persist against the moment they need it.

The product goal is dual: this needs to remain a portfolio piece (random visitors hit the README link and see something work in 60 seconds) AND to evolve into a real product (sales reps eventually use it for live calls with their data isolated). Phase 2 reconciles those goals by being **strictly additive**: anonymous visitors keep seeing exactly today's experience, and signed-in users get their identity attached to the session in the background.

Phase 2 explicitly does NOT:

- Reject anonymous connections (Phase 3+4 work)
- Enforce per-user quotas (Phase 4+ work)
- Persist users or sessions (Phase 5 work)
- Add security alerting or audit logging (Phase 6 work)

---

## Architecture decision: Firebase ID tokens directly

**Decision:** Use Firebase Auth ID tokens as the bearer credential the gateway validates. No custom JWT minting service, no Secret Manager key, no `/api/session-token` Next.js route.

**Why:**

- Firebase Auth already mints a JWT for every signed-in user, refreshes it every ~55 minutes automatically, and exposes a public JWKS for validation.
- `firebase-admin` (Python) provides a one-call validation API: `auth.verify_id_token(token)`. It caches the JWKS, validates expiry, audience, signature, and issuer for free.
- Eliminates an entire failure mode (mint route is down but auth is up), an entire artifact to manage (signing key in Secret Manager), and an entire library to add to both sides (`PyJWT` + custom claims).
- The Phase 1 plan document originally suggested the custom-mint approach; that suggestion is **explicitly retired** by this spec.

**Coupling we're accepting:** the gateway depends on Firebase Auth specifically, via `firebase_admin.auth.verify_id_token`. Migrating to a different IdP (Auth0, Ory, Workos, custom OIDC) is a one-function swap on the gateway side. The browser is more coupled (Firebase Auth client SDK), but the surface is contained to one hook + one component.

---

## High-level flow

```
Browser ──Firebase Auth popup (Google)──▶ Google identity
       ◀── Firebase ID token (auto-refreshed every ~55 min) ──

Browser ──ws.connect()──▶ Gateway
                                      ┌── 5s timeout ──┐
Gateway ──await receive (timeout)──▶  │ wait for       │
                                      │ client_hello   │
                                      └────────┬───────┘
                                               │
                                       got     │     timeout / non-hello
                                  client_hello │           │
                                               ▼           ▼
                              validate_id_token       Session.start(user=None)
                                  (id_token)          log "anonymous"
                                       │
                          ┌────────────┴────────────┐
                          ▼                         ▼
                   valid                   invalid / missing
                   Session.start(          Session.start(user=None)
                     user=SessionUser(...) log warning "invalid_id_token"
                   )                       (still permissive — no close)
                          │                         │
                          └────────────┬────────────┘
                                       ▼
                          send session_started
                          start sender + reader tasks
                          (canned suggestion stream as today)
```

The expensive Chirp/Gemini calls don't yet exist — Phase 2's `session.user` is informational. Phase 3+4 will add a `session.user is None` check at the suggestion-sender level to enforce auth for the real backends.

---

## Protocol changes

One optional field added to `client_hello`. No new message types. No changes to server-to-client messages.

### Python (`services/gateway/src/sales_copilot_gateway/protocol.py`)

```python
@dataclass(frozen=True)
class ClientHelloMessage:
    type: Literal["client_hello"] = "client_hello"
    client_version: str = ""
    id_token: str | None = None       # NEW
```

`parse_client_message` reads the wire-format `idToken` (camelCase) and assigns it to `id_token`.

### TypeScript (`services/web/src/lib/protocol.ts`)

```ts
export type ClientMessage =
  | { type: "client_hello"; clientVersion: string; idToken?: string }   // NEW field
  | { type: "end_session"; reason: string };
```

`serializeClientMessage` emits the field only when present (no extra plumbing — `JSON.stringify` skips undefined).

### Permissive validation behavior (gateway)

| First message arrives | `id_token` value | `validate_id_token` result | `Session.user` | Visible side-effect |
|---|---|---|---|---|
| `client_hello` | absent / `null` | `None` | `None` | none — normal anonymous flow |
| `client_hello` | empty string `""` | `None` | `None` | none |
| `client_hello` | valid Firebase ID token | `SessionUser(uid, email, name)` | populated | `session_open ... uid=u_xxx` log line |
| `client_hello` | expired Firebase ID token | `None` | `None` | `invalid_id_token: ExpiredIdTokenError` warning, then anonymous flow |
| `client_hello` | malformed / wrong-audience / wrong-signature | `None` | `None` | `invalid_id_token: <reason>` warning, then anonymous flow |
| (timeout — no message in 5s) | n/a | n/a | `None` | `missing_client_hello — proceeding anonymous` warning, then anonymous flow |
| non-`client_hello` first message | n/a | n/a | `None` | warning, anonymous flow, the offending message is dropped |

**The gateway never closes a connection due to auth failure in Phase 2.** Even an obviously bad token results in a normal anonymous session. Phase 3+4 introduce the `1008 policy violation` close path when there's a real cost to protect.

---

## Backend design

### New file: `services/gateway/src/sales_copilot_gateway/auth.py`

```python
"""Firebase ID token validation.

Phase 2: permissive — invalid/missing tokens result in anonymous sessions,
not rejected connections. Phase 3+4 will add explicit enforcement at the
suggestion-sender level once there's an expensive backend to gate.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from functools import lru_cache

import firebase_admin
from firebase_admin import auth as fb_auth, credentials

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class SessionUser:
    uid: str
    email: str | None
    display_name: str | None


@lru_cache(maxsize=1)
def _firebase_app() -> firebase_admin.App:
    """Initialize the Firebase Admin SDK once per process.

    On Cloud Run this uses Application Default Credentials automatically.
    For local dev, run `gcloud auth application-default login` once.
    """
    return firebase_admin.initialize_app(credentials.ApplicationDefault())


def validate_id_token(id_token: str | None) -> SessionUser | None:
    """Validate a Firebase ID token. Returns None on missing OR invalid token.

    Phase 2 is permissive — callers MUST NOT use a None return as a hard
    rejection. Treat None as 'unauthenticated/anonymous'.
    """
    if not id_token:
        return None
    try:
        _firebase_app()
        decoded = fb_auth.verify_id_token(id_token)
    except Exception as exc:
        logger.warning("invalid_id_token: %s", exc)
        return None
    return SessionUser(
        uid=decoded["uid"],
        email=decoded.get("email"),
        display_name=decoded.get("name"),
    )
```

The broad `except Exception` is intentional: `firebase_admin` raises ~6 different exception types (`InvalidIdTokenError`, `ExpiredIdTokenError`, `RevokedIdTokenError`, `CertificateFetchError`, `UserDisabledError`, etc.) and for permissive mode they all reduce to "treat as anonymous". Phase 3+4 can refactor to discriminate when there's something actionable to do per error type.

`@lru_cache(maxsize=1)` provides lazy, idempotent initialization. Tests monkeypatch `_firebase_app` to a no-op so they never touch real Firebase.

### Changed: `services/gateway/src/sales_copilot_gateway/session.py`

```python
from sales_copilot_gateway.auth import SessionUser

@dataclass
class Session:
    id: str
    started_at_ms: int
    user: SessionUser | None = None             # NEW
    ended_at_ms: int | None = field(default=None)

    @classmethod
    def start(cls, user: SessionUser | None = None) -> "Session":
        return cls(id=_new_session_id(), started_at_ms=_now_ms(), user=user)
```

`user` is mutable in principle but in practice it's only set at construction time (because Phase 2 validates at connect under Option A). Existing tests calling `Session.start()` with no arguments still work.

### Changed: `services/gateway/src/sales_copilot_gateway/main.py`

The connection-init flow changes from "send session_started immediately" to "wait for client_hello first".

```python
@app.websocket("/ws/session")
async def session_ws(ws: WebSocket) -> None:
    await ws.accept()

    user: SessionUser | None = None
    try:
        first_raw = await asyncio.wait_for(ws.receive_text(), timeout=5.0)
        first_msg = parse_client_message(first_raw)
        if isinstance(first_msg, ClientHelloMessage):
            user = validate_id_token(first_msg.id_token)
        else:
            logger.warning("expected client_hello, got %s", type(first_msg).__name__)
    except asyncio.TimeoutError:
        logger.warning("missing_client_hello — proceeding anonymous")
    except WebSocketDisconnect:
        return
    except ProtocolError as exc:
        logger.warning("invalid first message: %s — proceeding anonymous", exc)

    session = Session.start(user=user)
    logger.info(
        "session_open session_id=%s uid=%s",
        session.id,
        session.user.uid if session.user else "anonymous",
    )

    await ws.send_text(
        serialize_server_message(
            ServerSessionStartedMessage(
                session_id=session.id, started_at_ms=session.started_at_ms
            )
        )
    )

    sender = asyncio.create_task(_suggestion_sender(ws, session))
    reader = asyncio.create_task(_client_reader(ws, session))
    # ... rest of the existing concurrent flow unchanged
```

`_client_reader` no longer special-cases `ClientHelloMessage` (it was a no-op anyway in Phase 1) — by the time the reader runs, the first hello has already been consumed by the connection-init phase.

### Changed: `services/gateway/pyproject.toml`

Add `firebase-admin>=6.5.0` to the runtime dependencies. No new dev dependencies — tests use `monkeypatch` against the existing `pytest` install.

---

## Frontend design

### New: `services/web/src/lib/firebaseClient.ts`

Module-level singleton. Reads `NEXT_PUBLIC_FIREBASE_*` env vars (all baked at build time, all publicly visible by Firebase design). If `NEXT_PUBLIC_FIREBASE_API_KEY` is undefined or empty, exports a sentinel (`auth = null`) so the rest of the app can detect "Firebase is not configured" and gracefully disable sign-in (this is the local docker-compose path).

```ts
import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
};

let app: FirebaseApp | null = null;
export const auth: Auth | null = (() => {
  if (!config.apiKey) return null;
  app = getApps()[0] ?? initializeApp(config);
  return getAuth(app);
})();

export const isFirebaseConfigured = auth !== null;
```

### New: `services/web/src/hooks/useAuth.ts`

```ts
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

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(isFirebaseConfigured);

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

  return { user, loading, signInWithGoogle, signOut, isConfigured: isFirebaseConfigured };
}
```

### New: `services/web/src/components/AuthControls.tsx`

A small presentational component (~40 lines) that calls `useAuth()` directly and renders:

- **Firebase not configured** (local docker-compose): nothing rendered.
- **Loading**: a tiny mono `…` placeholder so the layout doesn't jump.
- **Signed out**: mono pill button `▸ SIGN IN WITH GOOGLE` matching the editorial-terminal aesthetic.
- **Signed in**: avatar (Google profile photo via `<img src={user.photoURL} />`) + display name in mono + tiny `× SIGN OUT` link.

### Changed: `services/web/src/components/SessionPanel.tsx`

Adds an optional `authSlot?: React.ReactNode` prop. Renders it inside the header strip, alongside the existing session-id and status pill. **Pure presentational** — SessionPanel never imports Firebase or `useAuth`. Existing tests still pass because the prop is optional.

### Changed: `services/web/src/lib/wsClient.ts`

```ts
sendClientHello(clientVersion: string, idToken?: string): void {
  this.send({ type: "client_hello", clientVersion, idToken });
}
```

The `ClientMessage` type already has `idToken?` as optional, so `JSON.stringify` skips it cleanly when undefined.

### Changed: `services/web/src/app/page.tsx`

```tsx
const { user } = useAuth();

const handleStart = useCallback(async () => {
  // ... existing reset logic ...
  // ... existing audio capture ...

  const idToken = user ? await user.getIdToken() : undefined;

  const ws = new SessionWebSocket({
    url: GATEWAY_URL,
    onOpen: () => {
      ws.sendClientHello("0.1.0", idToken);   // NEW second arg
    },
    // ... rest unchanged
  });
  // ...
}, [cleanup, handleServerMessage, user]);

return (
  <main className="min-h-screen">
    <SessionPanel
      // ... existing props
      authSlot={<AuthControls />}
    />
  </main>
);
```

**Token freshness:** `user.getIdToken()` is called fresh on every Start Session click. Firebase silently refreshes the token if it's within 5 minutes of expiry. Never cached in app state.

---

## GCP / Firebase setup

One-time setup against the existing project `sales-copilot-04130`. Most steps are Firebase console clicks.

| Step | How | Output |
|---|---|---|
| 1 | `gcloud services enable identitytoolkit.googleapis.com` | API enabled |
| 2 | Firebase console → Add project → pick `sales-copilot-04130` | Project linked to Firebase |
| 3 | Firebase console → Project settings → Add app → Web | `firebaseConfig = { apiKey, authDomain, projectId }` |
| 4 | Firebase console → Authentication → Sign-in method → Google → Enable, set support email | Google provider live |
| 5 | Firebase console → Authentication → Settings → Authorized domains → add `sales-copilot-web-360277569038.us-central1.run.app` | Cloud Run domain whitelisted for OAuth |
| 6 | Verify `localhost` is in the authorized domains list (default) | Local dev sign-in works |

**IAM:** the gateway's Cloud Run service runs as the project's default compute service account. `firebase-admin`'s `verify_id_token` fetches Google's public JWKS from a public URL and validates the token locally — **no IAM permissions are required for the validation path**. The SDK init via `credentials.ApplicationDefault()` uses the default compute SA credentials but doesn't call any Firebase APIs that need special grants. If something unexpected fails after deploy, the fallback is to grant `roles/firebaseauth.viewer` to the compute SA, but this is not expected to be needed.

**Env vars:**

```
# Web (NEXT_PUBLIC_*, baked at build time via Cloud Build)
NEXT_PUBLIC_FIREBASE_API_KEY=AIza...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=sales-copilot-04130.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=sales-copilot-04130

# Gateway (runtime, Cloud Run env var)
FIREBASE_PROJECT_ID=sales-copilot-04130
```

**Cloud Build integration:** `services/web/cloudbuild.yaml` gains 3 new substitutions (`_FIREBASE_API_KEY`, `_FIREBASE_AUTH_DOMAIN`, `_FIREBASE_PROJECT_ID`) and the Dockerfile gains 3 new `ARG`/`ENV` pairs mirroring how `NEXT_PUBLIC_GATEWAY_WS_URL` works today. Local `docker compose up` keeps working without these vars set — `firebaseClient.ts` gracefully degrades to "sign-in disabled" mode.

**Local dev:**

- Web: put the Firebase config in `services/web/.env.local` (gitignored by Next.js convention).
- Gateway: run `gcloud auth application-default login` once and `firebase-admin` picks it up.

---

## Testing strategy

The line: **we test our wrapper logic, not Google's JWT verification.**

### Gateway tests (pytest)

**New file `tests/test_auth.py` — ~5 tests for `validate_id_token()`:**

1. `test_returns_none_when_token_missing` — `validate_id_token(None)` returns `None`
2. `test_returns_none_when_token_empty_string` — `validate_id_token("")` returns `None`
3. `test_returns_session_user_on_valid_token` — monkeypatch `fb_auth.verify_id_token` to return a fake decoded dict, assert the wrapper builds `SessionUser` correctly
4. `test_returns_none_when_firebase_raises` — monkeypatch `verify_id_token` to raise `ExpiredIdTokenError`, assert wrapper returns `None` and logs warning
5. `test_handles_token_with_no_email_or_name` — anonymous Firebase user (uid only), assert wrapper handles missing optional fields

All tests monkeypatch `fb_auth.verify_id_token` directly and `_firebase_app` to a no-op. **No real Firebase calls in CI.**

**Updated `tests/test_ws_endpoint.py`:**

The 4 existing tests need a one-line addition each: send `client_hello` BEFORE reading `session_started`, because the new flow waits for it.

**Plus 3 new tests:**

1. `test_ws_anonymous_session_when_no_token` — `client_hello` with `idToken` absent → `session_started` arrives, log shows `uid=anonymous`
2. `test_ws_authed_session_when_valid_token` — monkeypatch `validate_id_token` to return a fake `SessionUser`, send `client_hello` with `idToken=<any string>`, assert `session_started` arrives and the log line shows the uid
3. `test_ws_anonymous_fallback_when_invalid_token` — monkeypatch `validate_id_token` to return `None`, assert `session_started` STILL arrives (permissive), warning logged

**Tests explicitly NOT written:**

- Token expiry, signature tampering, wrong audience, revocation — all `firebase-admin`'s responsibility.
- Real Firebase project integration — requires service account, no upside.

### Web tests (vitest)

**Updated `wsClient.test.ts` — 1-2 new tests:**

- `sendClientHello` with `idToken` argument → assert serialized payload includes the field
- `sendClientHello` without `idToken` → assert serialized payload omits the field

**Updated `SessionPanel.test.tsx` — 1 new test:**

- Renders the `authSlot` prop content in the header when provided

**`useAuth.ts`, `AuthControls.tsx`, `firebaseClient.ts` — explicitly NOT unit-tested.**
Mocking the Firebase Auth SDK is a rabbit hole (singleton internal state, popup window logic, IndexedDB persistence). Cost-benefit is bad. They get coverage from the manual smoke test.

### Manual smoke test (Phase 2 equivalent of Task 18)

1. `docker compose up --build` (with `NEXT_PUBLIC_FIREBASE_*` set in `.env.local`)
2. Open <http://localhost:3000>
3. Verify status line shows `idle` and the AuthControls show `▸ SIGN IN WITH GOOGLE`
4. Click sign-in → Google popup → sign in with a Google account
5. Verify the avatar + name appear in the header
6. Click Start Session → share a tab → suggestions stream as before
7. Verify the gateway logs show `session_open ... uid=<your-uid>` (not `uid=anonymous`)
8. End the session, sign out, click Start Session again
9. Verify the gateway logs show `session_open ... uid=anonymous`
10. Sign in, leave the tab open for >1 hour, click Start Session
11. Verify the session still works (token auto-refreshed)
12. `docker compose down`

### Test counts after Phase 2

| Suite | Phase 1 | After Phase 2 | Net change |
|---|---|---|---|
| Gateway pytest | 20 | ~28 | +5 auth, +3 ws_endpoint |
| Web vitest | 16 | ~18 | +1-2 wsClient, +1 SessionPanel |

---

## Out of scope (sanity-checked with the project owner)

**Auth features deferred to later phases:**

- No `/api/session-token` mint route (killed in the architecture decision above)
- No Secret Manager key
- No `/login` or `/logout` pages — sign-in is a header button, no dedicated routes
- No email/password auth, no other identity providers
- No magic-link, SAML, or enterprise SSO
- No custom claims, roles, or admin/user split — every signed-in user is just `{uid, email, name}`
- No user profile, account settings, or email verification flows
- No "remember me" beyond Firebase's default IndexedDB persistence

**Enforcement deferred:**

- No "must be signed in to start a session" gate (Phase 3+4 add this when there's something expensive to gate)
- No quota enforcement (Phase 4+)
- No per-user or per-IP rate limiting (Phase 4-6)
- No connection rejection on invalid token — `1008 policy violation` is not used in Phase 2

**Persistence deferred:**

- No user records in Firestore (Phase 5)
- No session history storage (Phase 5)
- No "your past calls" view (Phase 5)
- No audit logging beyond stdout warnings (Phase 6)

**Operational deferred:**

- No alerting on auth failure spikes (Phase 6)
- No SLO targets for auth latency (Phase 6)
- No security event logging beyond `logger.warning("invalid_id_token: ...")` (Phase 6)

---

## Roadmap impact

| Phase | Reads `session.user` for | Status |
|---|---|---|
| Phase 2 (this) | Logging only | This spec |
| Phase 3 | Decides whether to start a real Chirp session (requires `session.user is not None`) | Future |
| Phase 4 | Decides whether to call Gemini, applies per-user prompt context | Future |
| Phase 5 | Firestore key for the user→sessions index | Future |
| Phase 6 | Auth failure metrics + alerting | Future |

Phase 2 is the smallest possible piece that unlocks all of those. By the end of this phase, the system *can* identify users; subsequent phases decide what to *do* with that identification.

---

## Open questions

None. Spec is approved by the project owner section-by-section as of 2026-04-08.
