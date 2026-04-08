# sales-copilot

GCP-hosted sales assistance tool. Recording + processing layer captures sales conversations; an LLM layer suggests what to say next based on detected customer sentiment.

**Status:** Phase 1 (skeleton end-to-end with canned suggestions). See `docs/superpowers/plans/` for active plans and `docs/superpowers/specs/2026-04-07-sales-copilot-design.md` for the design spec.

## Layout

```
sales-copilot/
├── services/
│   ├── web/      # Next.js 15 + TypeScript browser app
│   └── gateway/  # Python 3.12 + FastAPI WebSocket service
├── docker-compose.yml
└── docs/superpowers/{specs,plans}/
```

## Prerequisites

- Docker + Docker Compose
- (For local development outside Docker) Node 22 and `uv` (https://docs.astral.sh/uv/)

## Running the whole stack

```bash
docker compose up --build
```

- Web UI → http://localhost:3000
- Gateway health → http://localhost:8080/health

## Manual smoke test (Phase 1)

1. `docker compose up --build`
2. Open http://localhost:3000 in Chrome or Edge
3. Open any second tab (e.g. http://example.com) so you have something to share
4. Click **Start session**, pick the second tab, **check "Share tab audio"**, click Share
5. Within ~5 seconds you should see canned suggestion cards appear and continue every 5s
6. Click **End session** to finish cleanly
7. `docker compose down`

If no suggestions appear:
- Check the gateway logs for `session_open` lines
- Make sure the tab picker had "Share tab audio" checked
- Check the browser console for WebSocket errors

## Development

### Gateway (Python)

```bash
cd services/gateway
uv sync
uv run pytest -v                              # run all tests
uv run ruff check .                           # lint
uv run ruff format .                          # format
uv run uvicorn sales_copilot_gateway.main:app --reload --port 8080
```

Env vars:
- `LOG_LEVEL` — default `INFO`
- `SUGGESTION_TICK_SECONDS` — default `5.0`; set to `1.0` for a fast demo

### Web (Next.js)

```bash
cd services/web
npm install
npm run dev                  # hot-reloading dev server on :3000
npm test                     # vitest
npm run lint
npm run build
```

Env vars:
- `NEXT_PUBLIC_GATEWAY_WS_URL` — default `ws://localhost:8080/ws/session`

## Roadmap

- **Phase 1 (this phase):** skeleton end-to-end, canned suggestions, local only
- **Phase 2:** Identity Platform auth, short-lived WS tokens
- **Phase 3:** Real Chirp 2 Speech-to-Text with diarization
- **Phase 4:** Real Gemini 2.5 Flash suggestions with context caching
- **Phase 5:** Firestore + GCS persistence, 30-day lifecycle
- **Phase 6:** Cloud Run deployment, observability, failure handling, SLOs

Each phase is its own plan document in `docs/superpowers/plans/`.
