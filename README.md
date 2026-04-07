# sales-copilot

GCP-hosted sales assistance tool. Recording + processing layer captures sales conversations; an LLM layer suggests what to say next based on detected customer sentiment.

**Status:** Phase 1 (skeleton end-to-end with canned suggestions). See `docs/superpowers/plans/` for active plans and `docs/superpowers/specs/` for the design spec.

## Layout

- `services/web` — Next.js browser app (tab capture, WebSocket client, suggestion UI)
- `services/gateway` — Python FastAPI service (WebSocket server, session state, suggestion loop)

## Running locally

Requires Docker + docker-compose. See `docker-compose.yml` at the repo root.

```bash
docker compose up --build
# web → http://localhost:3000
# gateway → http://localhost:8080/health
```

Full developer docs land at the end of Phase 1 (Task 19).
