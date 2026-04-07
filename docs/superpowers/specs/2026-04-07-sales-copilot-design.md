# Sales Copilot — Design Spec

**Date:** 2026-04-07
**Status:** Draft, pending implementation plan
**Owner:** cultistsid

## 1. Problem statement

Sales reps on live video calls (Zoom, Google Meet, Teams) frequently miss
cues: a customer hesitates on pricing, gets excited about a specific
feature, or surfaces an objection that has a known rebuttal. A senior rep
listening in could feed them the right next line in real time — but that
doesn't scale.

We want a browser-based copilot that listens to an ongoing meeting,
interprets customer sentiment from the transcript, and streams short
next-line suggestions to the rep within ~2 seconds of the customer
speaking. The entire system is hosted on GCP, using managed services
wherever possible, so we pay near-zero when idle and scale without ops
work.

## 2. Goals & non-goals

### Goals (v1)

- Live coaching during an active call, suggestion latency ≤ 2s p95
- Zero local install: everything runs in a browser tab
- Works with whatever meeting tool the rep already uses (no integration)
- Full audit trail: audio + transcript + suggestions retained 30 days
- Per-call unit cost under $0.50 for a 15-minute call
- Idle baseline under $15/month when nobody is using it
- Clean seam for migrating the STT backend later without touching the
  rest of the stack

### Non-goals (v1, explicit)

- No retrieval/RAG over past calls or documents
- No post-call summary/scorecard generation
- No multi-tenant self-serve signup (single org, manually provisioned)
- No PSTN / SIP / telephony integration
- No meeting-bot that joins calls as a participant
- No mobile app
- No on-device or browser-side ML
- No audio-prosody emotion model (text sentiment only)
- No real-time translation or non-English playbooks
- No CRM integration (Salesforce, HubSpot, etc.)

## 3. High-level architecture

```
┌────────────────────────┐
│  Rep's browser         │
│  ┌──────────────────┐  │
│  │ Next.js web app  │  │
│  │  - tab capture   │  │
│  │  - WS client     │  │
│  │  - suggestion UI │  │
│  └────────┬─────────┘  │
└───────────┼────────────┘
            │ WSS (Opus audio frames + control)
            ▼
┌─────────────────────────────────────────────┐
│  Cloud Run: session-gateway                 │
│  ┌───────────────────────────────────────┐  │
│  │ WS handler  →  per-call Session       │  │
│  │                                       │  │
│  │  audio in ─► Chirp 2 streaming STT ─┐ │  │
│  │                                     ▼ │  │
│  │         rolling transcript buffer     │  │
│  │                 │                     │  │
│  │                 │ every ~5s / on end- │  │
│  │                 │ of-utterance        │  │
│  │                 ▼                     │  │
│  │        Gemini 2.5 Flash (Vertex)      │  │
│  │         · cached system header        │  │
│  │         · rolling 60s window + summary│  │
│  │                 │                     │  │
│  │                 ▼                     │  │
│  │         suggestion JSON ──► WS out    │  │
│  └───────────────────────────────────────┘  │
└─────┬──────────────┬─────────────────┬──────┘
      │              │                 │
      ▼              ▼                 ▼
┌──────────┐  ┌────────────┐   ┌────────────────┐
│ Identity │  │ Firestore  │   │ GCS (audio +   │
│ Platform │  │ (sessions, │   │ transcript)    │
│ (auth)   │  │ transcripts│   │ 30d lifecycle  │
│          │  │ metadata)  │   │                │
└──────────┘  └────────────┘   └────────────────┘
```

### Two Cloud Run services

We run **two** Cloud Run services, not one:

1. **`web`** — Next.js app. Short-lived HTTP requests, bursty, scale to
   zero, `min-instances=0`. Serves the UI, handles Identity Platform
   login, issues short-lived session tokens for the gateway.
2. **`session-gateway`** — WebSocket + audio pipeline. Long-held
   connections (entire call duration), CPU-bound on audio framing,
   I/O-bound on STT/LLM. `min-instances=1` in production so the first
   call of the day doesn't eat a cold start. `concurrency=80` so one
   instance can host many simultaneous calls.

**Why split them:** the web tier has radically different scaling
characteristics from the gateway. Putting them in the same service means
one deployment's bugs or memory leaks take down both, and Cloud Run's
per-service concurrency/CPU tuning can't be right for both workloads.

### Region

Single region (`us-central1`) for v1. All components co-located:
Chirp 2, Gemini on Vertex, Cloud Run services, Firestore, GCS, Identity
Platform. Zero cross-region egress.

### External services used

- **Google Speech-to-Text V2 (Chirp 2 model, streaming with diarization)**
  for live transcription
- **Vertex AI Gemini 2.5 Flash** (with context caching) for live
  suggestion generation
- **Identity Platform (Firebase Auth)** for user authentication
- **Firestore** for session + transcript metadata
- **Cloud Storage** for raw audio + transcript blobs
- **Secret Manager** for API keys and service account material
- **Cloud Logging + Cloud Monitoring** for observability

## 4. Data flow for a single live call

```
t=0     Rep opens web app, logs in via Identity Platform
        → web tier mints a short-lived (10 min) WS token (signed JWT)

t=0.1   Rep clicks "Start session"
        → browser calls getDisplayMedia() with audio:true, prompts
          tab picker
        → browser opens WSS to session-gateway with the token
        → gateway validates token, creates Session{id, user, startedAt}
        → gateway opens a Chirp 2 StreamingRecognize call (single stream,
          both speakers, diarization on) and a GCS resumable upload
        → gateway writes session doc to Firestore

t=0.2   Audio loop starts (20ms Opus frames over WS):
        frame → gateway:
          • append to GCS upload buffer (flushed every 5s)
          • forward to Chirp 2 streaming request
        Chirp 2 → gateway: interim + final transcript results with
                           speaker tags
        gateway → client: transcript_delta messages (for a live
                          transcript pane)
        gateway → Firestore: append finalized utterances to
                             sessions/{id}/utterances

t=every 5s or on end-of-utterance (whichever first):
        gateway builds a Gemini request:
          • cached_content: system header (playbook + product +
                            sentiment rubric)
          • fresh content: last 60s of transcript + running summary +
                           latest utterance
        gateway → Vertex Gemini 2.5 Flash (streaming generateContent)
        Gemini → gateway → client: suggestion_delta messages
        gateway → Firestore: append suggestion to
                             sessions/{id}/suggestions

t=end   Rep clicks "End session" (or closes tab, or WS drops)
        → gateway finalizes Chirp stream, flushes GCS upload
        → gateway writes final session summary
        → gateway closes Firestore doc with endedAt + stats
        → client shows "session ended" state
```

**Key invariant:** the gateway is the only thing that touches STT, LLM,
or storage. The browser only speaks WebSocket. The `web` tier only
serves the UI and mints tokens. Three clean layers, three different
failure domains.

## 5. Prompt strategy

Two-part prompt per Gemini tick, using Vertex AI explicit context
caching:

### Cached header (~2,000 tokens)

Created once per session, reused every tick at $0.03 per 1M tokens (90%
discount vs. fresh).

- **System instructions.** "You are a live sales coach. Output a single
  JSON object with `{intent, sentiment, suggestion, confidence}`. Keep
  suggestions to one sentence, under 20 words. Never invent product
  facts."
- **Sales playbook.** Objection-handling patterns, discovery question
  bank, closing moves. Loaded from Firestore `playbooks/{pbId}`.
- **Product fact sheet.** Loaded from Firestore `productFacts/{pfId}`.
  Per-org.
- **Sentiment rubric.** 5-point scale with anchors:
  - `-2` frustrated / dismissive
  - `-1` skeptical / hesitant
  - `0`  neutral / information-gathering
  - `+1` interested / engaged
  - `+2` enthusiastic / ready to move forward

### Fresh content per tick (~200-400 tokens)

- Rolling 60-second transcript window (diarized)
- Running summary of the call so far, regenerated every 10 ticks from
  the previous summary + new content (bounded)
- Last 1-2 rep utterances and last 1-2 customer utterances
- Session metadata (duration, prior suggestions that were acted on if
  we track that — deferred to v1.1)

### Output

Streamed JSON, client renders tokens as they arrive.

### Why this saves money

At ~180 ticks per 15-minute call, caching the 2,000-token header saves
~$0.10 per call versus sending it fresh every tick. Small win today,
scales linearly with playbook size. As the playbook grows from 2k →
10k tokens, the savings grow from $0.10/call → $0.50/call — bigger than
the entire Gemini bill today.

## 6. Data model

### Firestore

```
users/{uid}
  email, name, createdAt, orgId

orgs/{orgId}
  name, playbookId, productFactsId

playbooks/{pbId}
  markdown, version, updatedBy, updatedAt

productFacts/{pfId}
  markdown, version, updatedAt

sessions/{sessionId}
  userId, orgId, startedAt, endedAt, status
  gcsAudioPath, gcsTranscriptPath
  stats: {
    durationSec, utteranceCount, suggestionCount, avgLatencyMs
  }

sessions/{sessionId}/utterances/{utteranceId}
  speaker, startMs, endMs, text, isFinal

sessions/{sessionId}/suggestions/{suggestionId}
  tickAt, sentiment, intent, suggestion, confidence, latencyMs
```

### Cloud Storage

```
gs://{project}-sales-copilot-audio/
  {orgId}/{yyyy-mm-dd}/{sessionId}.webm
  (lifecycle: delete after 30 days)

gs://{project}-sales-copilot-transcripts/
  {orgId}/{yyyy-mm-dd}/{sessionId}.json
  (full utterance + suggestion dump, 30-day lifecycle)
```

## 7. Auth & security

### Authentication

- **Identity Platform (Firebase Auth)** for user login. Email/password
  and Google OIDC for v1.
- **WebSocket auth.** Web tier issues a short-lived (10 min) JWT signed
  with a key in Secret Manager, scoped to `{userId, orgId, sessionId}`.
  Gateway validates per-connection and rejects on mismatch.

### Authorization

- **Firestore security rules:** `sessions/{id}` readable only by the
  owning user. No client writes to `utterances` or `suggestions` — only
  the gateway service account writes, via Admin SDK (bypasses rules).
- **GCS:** private buckets, no public read. Audio accessed only via
  gateway-signed URLs with ~5 min TTL, issued when a user requests
  playback of a past session.

### PII

- Transcripts contain customer voice data. Onboarding copy and a
  session-start consent banner surface this explicitly.
- 30-day lifecycle enforced at the bucket level — the app cannot
  bypass it.
- User-initiated "delete this session" RPC triggers immediate GCS +
  Firestore wipe for that session.

### Secrets

All API keys and service account JSON live in Secret Manager, mounted
as env vars via Cloud Run. No secrets in code, no secrets in the repo
(the existing `.gitignore` already blocks common patterns).

## 8. Failure modes and degradation

| Failure | Behavior |
|---|---|
| Chirp STT stream errors mid-call | Gateway retries with exponential backoff (max 3). If still failing, UI shows "Transcription unavailable" banner; audio still uploads to GCS so the call is recoverable post-hoc. |
| Gemini timeout (>3s on a tick) | Drop that tick's suggestion. UI shows nothing extra — suggestions are advisory, silence is an acceptable state. Log the latency violation. |
| Gemini rate limit (429) | Gateway enters a 10s cooldown, skipping ticks. UI shows a subtle "coach catching up" indicator. |
| WS disconnect (network blip) | Client auto-reconnects with the same session token. Gateway resumes the existing Session by id, re-establishes the STT stream (fresh context), continues. Lost audio window is dropped — no backfill. |
| Rep revokes tab share | `getDisplayMedia` track ends → client sends `end_session` → gateway finalizes cleanly. |
| Cloud Run instance restarts mid-call | Worst case: client reconnects, lands on a new instance, Session is re-read from Firestore, STT restarts. User sees a ~2s gap. |
| GCS upload fails | Resumable upload retries transparently. If terminal failure, audio is lost but transcript + suggestions are still in Firestore (they're written separately). |
| Identity Platform outage | New logins fail; existing WS tokens continue to work until expiry (10 min). |

## 9. Observability

### Logging

Structured JSON logs from both Cloud Run services, via Cloud Logging.
A per-session correlation ID flows through every log line on both the
`web` and `session-gateway` sides.

### Metrics (Cloud Monitoring)

- `session_active_count` (gauge)
- `suggestion_latency_ms` histogram, p50 / p95 / p99
- `stt_error_rate` counter
- `gemini_error_rate`, `gemini_timeout_rate` counters
- `ws_disconnect_rate` counter
- `cost_per_session_estimate` gauge, computed from durations × unit
  rates at session end

### SLOs for v1

- p95 suggestion latency ≤ 2.0s from end-of-customer-utterance to
  first suggestion token
- STT error rate ≤ 1% of sessions
- WS disconnect rate ≤ 2% of sessions

### Alerts

Pageable only for:
- Sustained cost anomaly: 2× baseline for 1 hour
- Gemini or STT error rate > 10% sustained for 10 minutes

Everything else is dashboard-only.

## 10. Cost model

All prices verified against published GCP rates as of 2026-04-07.

### Per 15-minute call (Approach A)

| Component | Calc | Cost |
|---|---|---|
| Chirp 2 STT (budgeted $0.024/min, published floor $0.016/min) | 15 × $0.024 | $0.360 |
| Gemini Flash cached header | 180 ticks × 2000 tokens × $0.03/M | $0.011 |
| Gemini Flash fresh input | 180 × 200 tokens × $0.30/M | $0.011 |
| Gemini Flash output | 180 × 150 tokens × $2.50/M | $0.068 |
| Cloud Run gateway (1 vCPU + 2 GiB, 900s) | 900 × ($0.000024 + 2 × $0.0000025) | $0.026 |
| Firestore writes (~500/call) | 500 × $0.18/100k | $0.001 |
| GCS audio + transcript (~2 MB, 30 days) | rounding | $0.000 |
| **Total per 15-min call** | | **~$0.48** |

### Monthly bill-of-materials

| Calls/mo (15 min each) | Variable | Baseline | **Monthly total** |
|---|---|---|---|
| 50 | $24 | $10 | **~$34** |
| 500 | $240 | $10 | **~$250** |
| 1,500 | $720 | $12 | **~$732** |
| 5,000 | $2,400 | $15 | **~$2,415** |
| 15,000 | $7,200 | $20 | **~$7,220** |

**Idle baseline** is mostly: Cloud Run `session-gateway` min-instances=1
memory ($6-8/mo), Secret Manager ($0.50), Logging ($2-5 depending on
volume). Firestore, Identity Platform, GCS, and the `web` Cloud Run
service are all inside free-tier-ish at these volumes.

### Why $0.024/min for STT instead of the $0.016/min published floor

The Speech-to-Text V2 published standard rate is $0.016/min, but
enhanced-model surcharges and diarization configuration can push it
higher. Budgeting at $0.024/min gives ~50% headroom until we validate
on real calls and can tighten the number.

## 11. Migration path to self-hosted STT (Approach C)

### When to flip

Watch the monthly bill. Approach C (self-hosted Whisper on Cloud Run
L4 GPU, ~$520/mo fixed baseline, near-zero per-call STT) breaks even
against Approach A at roughly **1,400-1,500 calls/month**. When three
consecutive months exceed that, trigger the migration.

### What changes

The seam is a `transcribe(audio_stream) → transcript_stream` interface
inside the `session-gateway`. Define it up front as an abstract
interface with two implementations:

- `ChirpTranscriber` — default, used for v1
- `WhisperTranscriber` — added later, calls a separate Cloud Run
  service (`stt-whisper`) that hosts `faster-whisper-large-v3` on an
  L4 GPU. Selection is per-session via a config flag, so shadow mode
  and gradual rollout are both trivial.

### What stays the same

Everything else: web tier, auth, prompt construction, Gemini calls,
Firestore writes, GCS, the UI, the WebSocket protocol between browser
and gateway.

### Migration steps (future, not v1)

1. Build `WhisperTranscriber` behind a feature flag
2. Run it in shadow mode on real audio, compare transcripts to Chirp
3. Validate suggestion quality is at least as good (Gemini is consuming
   the transcript, so transcript quality is what actually matters)
4. Cut over per-org, watch metrics
5. Decommission Chirp calls once cutover is stable

## 12. Risks and open questions

- **Chirp 2 streaming + diarization pricing** — the "$0.016/min
  published floor" is for standard V2; we need to confirm the exact
  Chirp 2 + diarization combined rate against a live billing account
  early in implementation. A 50% swing here moves the per-call cost by
  ~$0.12.
- **Tab capture UX friction** — users must remember to share the
  correct tab with "audio" checked. Easy to forget. Mitigation: bold
  onboarding, a real-time "we can't hear anything" warning banner when
  no audio flows for >10s.
- **Suggestion quality** — Gemini Flash is fast and cheap but may not
  reason deeply enough about nuanced objections. Mitigation: start
  with Flash, keep the prompt-engineering seam clean, evaluate upgrade
  to Gemini 2.5 Pro or Claude Sonnet 4.5 (via Vertex Model Garden) per
  tick if v1 feedback demands it.
- **WebSocket survival on Cloud Run** — Cloud Run has a maximum request
  duration (currently 60 min for HTTP/2 and WebSocket as of 2026). Long
  calls approaching that bound will need client-driven reconnection
  every ~50 min. Handle this in the client with a quiet reconnect
  before the hard limit.
- **Consent and recording laws** — two-party consent states require
  informing both parties. The in-app consent banner covers the rep;
  the rep is responsible for informing their customer. Legal should
  review before any non-internal use.

## 13. Future extensions (not v1)

- Post-call summary + scorecard using Gemini 2.5 Pro (one call at
  `end_session`)
- Retrieval over past calls and playbook documents via Vertex Vector
  Search with quantized embeddings
- Multi-tenant self-serve signup and per-org billing
- Audio prosody sentiment model layered on top of text sentiment
- CRM integration to auto-write call summaries to Salesforce/HubSpot
- Real-time translation for non-English calls
- Self-hosted STT (Approach C, above) once volume justifies it
