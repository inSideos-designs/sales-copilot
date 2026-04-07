# Sales Copilot — Phase 1 Implementation Plan (Skeleton End-to-End)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a working end-to-end skeleton of the sales copilot running on localhost via `docker-compose up`: the rep opens a browser tab, clicks "Start session", shares a meeting tab via `getDisplayMedia`, and sees canned coaching suggestions stream into a sidebar every 5 seconds. No real STT, no real LLM, no GCP — this proves the audio capture + WebSocket pipeline before any cloud cost or ML latency enters the picture.

**Architecture:** Two services in a monorepo. `services/web` is a Next.js 15 + TypeScript app that handles tab capture and WebSocket I/O in the browser. `services/gateway` is a Python 3.12 + FastAPI service that accepts WebSocket connections, maintains per-call session state, and (in this phase) emits canned suggestions on a 5-second timer. Both run in Docker and are wired together with `docker-compose.yml`.

**Tech Stack:**
- **Web:** Next.js 15 (App Router), TypeScript, React 19, Tailwind CSS, native browser `WebSocket` and `getDisplayMedia` APIs
- **Gateway:** Python 3.12, FastAPI, uvicorn, FastAPI's built-in WebSocket support
- **Package management:** `uv` (Python), `npm` (Node)
- **Testing:** `pytest` + `pytest-asyncio` (gateway), `vitest` (web)
- **Lint:** `ruff` (Python), `eslint` + `prettier` (web)
- **Containers:** Docker, `docker-compose`
- **CI:** GitHub Actions

**What this plan does NOT cover** (future phases, see Roadmap at the end):
- Identity Platform auth / JWT token minting
- Real Chirp 2 Speech-to-Text
- Real Gemini 2.5 Flash
- Firestore + GCS persistence
- Cloud Run deployment
- Context caching, failure handling at production-grade, SLOs

---

## File Structure

After Phase 1 the repo will look like this:

```
sales-copilot/
├── .editorconfig                          (created Task 1)
├── .gitattributes                         (created Task 1)
├── .github/
│   └── workflows/
│       └── ci.yml                         (created Task 7)
├── .gitignore                             (already exists)
├── README.md                              (updated Task 1, Task 19)
├── docker-compose.yml                     (created Task 6)
├── docs/
│   └── superpowers/
│       ├── specs/
│       │   └── 2026-04-07-sales-copilot-design.md  (already exists)
│       └── plans/
│           └── 2026-04-07-phase-1-skeleton.md      (this file)
├── services/
│   ├── gateway/
│   │   ├── Dockerfile                     (created Task 3)
│   │   ├── pyproject.toml                 (created Task 2)
│   │   ├── uv.lock                        (created Task 2)
│   │   ├── src/
│   │   │   └── sales_copilot_gateway/
│   │   │       ├── __init__.py            (created Task 2)
│   │   │       ├── main.py                (created Task 3, updated Tasks 9, 12)
│   │   │       ├── protocol.py            (created Task 8)
│   │   │       ├── session.py             (created Task 10)
│   │   │       └── suggestions.py         (created Task 11)
│   │   └── tests/
│   │       ├── __init__.py                (created Task 2)
│   │       ├── test_health.py             (created Task 3)
│   │       ├── test_protocol.py           (created Task 8)
│   │       ├── test_session.py            (created Task 10)
│   │       └── test_suggestions.py        (created Task 11)
│   └── web/
│       ├── .eslintrc.json                 (created Task 4)
│       ├── Dockerfile                     (created Task 5)
│       ├── next.config.ts                 (created Task 4)
│       ├── package.json                   (created Task 4)
│       ├── postcss.config.mjs             (created Task 4)
│       ├── tailwind.config.ts             (created Task 4)
│       ├── tsconfig.json                  (created Task 4)
│       ├── vitest.config.ts               (created Task 4)
│       ├── public/                        (created Task 4, empty)
│       └── src/
│           ├── app/
│           │   ├── globals.css            (created Task 4)
│           │   ├── layout.tsx             (created Task 4)
│           │   └── page.tsx               (created Task 4, updated Task 17)
│           ├── components/
│           │   └── SessionPanel.tsx       (created Task 14, updated Task 17)
│           └── lib/
│               ├── audioCapture.ts        (created Task 15)
│               ├── audioCapture.test.ts   (created Task 15)
│               ├── protocol.ts            (created Task 8)
│               ├── wsClient.ts            (created Task 16)
│               └── wsClient.test.ts       (created Task 16)
```

**Boundaries:**
- `services/gateway` knows nothing about the browser or HTTP UI. It only speaks WebSocket on `/ws/session`.
- `services/web` knows nothing about STT, LLMs, or Python. It only speaks to the gateway's WebSocket.
- `protocol.py` (Python) and `protocol.ts` (TypeScript) are **mirrors**. Both define the same set of message types — if one changes, the other must change. This is enforced socially in Phase 1; future phases may codegen from a shared schema.
- `session.py` owns per-connection state. `suggestions.py` is a pure async generator with no WebSocket knowledge. `main.py` wires them together.

---

## Phase 0 — Repo Scaffolding

### Task 1: Top-level repo files

**Files:**
- Create: `.editorconfig`
- Create: `.gitattributes`
- Modify: `README.md`

- [ ] **Step 1.1: Create `.editorconfig`**

Create `/.editorconfig` with:

```ini
root = true

[*]
charset = utf-8
end_of_line = lf
indent_style = space
insert_final_newline = true
trim_trailing_whitespace = true

[*.{py}]
indent_size = 4

[*.{ts,tsx,js,jsx,json,yml,yaml,md,css}]
indent_size = 2

[Makefile]
indent_style = tab
```

- [ ] **Step 1.2: Create `.gitattributes`**

Create `/.gitattributes` with:

```
* text=auto eol=lf
*.png binary
*.jpg binary
*.webp binary
*.ico binary
```

- [ ] **Step 1.3: Update `README.md`**

Replace the contents of `/README.md` with:

```markdown
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
```

- [ ] **Step 1.4: Commit**

```bash
git add .editorconfig .gitattributes README.md
git commit -m "chore: add editorconfig, gitattributes, update README for Phase 1"
```

---

### Task 2: Gateway Python project scaffold

**Files:**
- Create: `services/gateway/pyproject.toml`
- Create: `services/gateway/src/sales_copilot_gateway/__init__.py`
- Create: `services/gateway/tests/__init__.py`
- Create: `services/gateway/tests/test_smoke.py`

- [ ] **Step 2.1: Create gateway directory structure**

```bash
mkdir -p services/gateway/src/sales_copilot_gateway
mkdir -p services/gateway/tests
```

- [ ] **Step 2.2: Create `services/gateway/pyproject.toml`**

```toml
[project]
name = "sales-copilot-gateway"
version = "0.1.0"
description = "WebSocket gateway for sales-copilot live sessions"
requires-python = ">=3.12"
dependencies = [
    "fastapi>=0.115",
    "uvicorn[standard]>=0.32",
    "pydantic>=2.9",
]

[dependency-groups]
dev = [
    "pytest>=8.3",
    "pytest-asyncio>=0.24",
    "httpx>=0.27",
    "ruff>=0.7",
]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["src/sales_copilot_gateway"]

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]
pythonpath = ["src"]

[tool.ruff]
line-length = 100
target-version = "py312"

[tool.ruff.lint]
select = ["E", "F", "W", "I", "B", "UP", "SIM", "RUF"]
```

- [ ] **Step 2.3: Create empty package files**

Create `services/gateway/src/sales_copilot_gateway/__init__.py` with:

```python
"""Sales-copilot WebSocket gateway."""

__version__ = "0.1.0"
```

Create `services/gateway/tests/__init__.py` as an empty file:

```python
```

- [ ] **Step 2.4: Write the smoke test**

Create `services/gateway/tests/test_smoke.py`:

```python
"""Smoke test: package imports and version is set."""

from sales_copilot_gateway import __version__


def test_version_is_set() -> None:
    assert __version__ == "0.1.0"
```

- [ ] **Step 2.5: Install deps and run the smoke test**

Run:

```bash
cd services/gateway
uv sync
uv run pytest tests/test_smoke.py -v
```

Expected: 1 test passes, `uv.lock` is written.

- [ ] **Step 2.6: Commit**

```bash
git add services/gateway/pyproject.toml services/gateway/uv.lock services/gateway/src services/gateway/tests
git commit -m "feat(gateway): scaffold Python package with pytest smoke test"
```

---

### Task 3: Gateway FastAPI app with health endpoint + Dockerfile

**Files:**
- Create: `services/gateway/src/sales_copilot_gateway/main.py`
- Create: `services/gateway/tests/test_health.py`
- Create: `services/gateway/Dockerfile`

- [ ] **Step 3.1: Write the failing health test**

Create `services/gateway/tests/test_health.py`:

```python
"""Tests for the health endpoint."""

from fastapi.testclient import TestClient

from sales_copilot_gateway.main import app


def test_health_returns_ok() -> None:
    client = TestClient(app)
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "version": "0.1.0"}
```

- [ ] **Step 3.2: Run test to verify it fails**

```bash
cd services/gateway
uv run pytest tests/test_health.py -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'sales_copilot_gateway.main'` (or similar).

- [ ] **Step 3.3: Create the FastAPI app**

Create `services/gateway/src/sales_copilot_gateway/main.py`:

```python
"""FastAPI app entrypoint."""

from fastapi import FastAPI

from sales_copilot_gateway import __version__

app = FastAPI(title="sales-copilot-gateway", version=__version__)


@app.get("/health")
async def health() -> dict[str, str]:
    """Liveness probe for Docker / Cloud Run."""
    return {"status": "ok", "version": __version__}
```

- [ ] **Step 3.4: Run test to verify it passes**

```bash
uv run pytest tests/test_health.py -v
```

Expected: PASS.

- [ ] **Step 3.5: Create the Dockerfile**

Create `services/gateway/Dockerfile`:

```dockerfile
# syntax=docker/dockerfile:1.7
FROM python:3.12-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

# Install uv
RUN pip install --no-cache-dir uv==0.5.*

WORKDIR /app

# Install deps first (cache layer)
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

# Copy source
COPY src ./src

ENV PATH="/app/.venv/bin:${PATH}"

EXPOSE 8080

CMD ["uvicorn", "sales_copilot_gateway.main:app", "--host", "0.0.0.0", "--port", "8080"]
```

- [ ] **Step 3.6: Build and smoke-test the image locally**

```bash
cd services/gateway
docker build -t sales-copilot-gateway:phase1 .
docker run --rm -p 8080:8080 -d --name gw-smoke sales-copilot-gateway:phase1
sleep 2
curl -sf http://localhost:8080/health
docker stop gw-smoke
```

Expected: `curl` prints `{"status":"ok","version":"0.1.0"}`.

- [ ] **Step 3.7: Commit**

```bash
git add services/gateway/src/sales_copilot_gateway/main.py services/gateway/tests/test_health.py services/gateway/Dockerfile
git commit -m "feat(gateway): add FastAPI app, /health endpoint, Dockerfile"
```

---

### Task 4: Web Next.js project scaffold

**Files:**
- Create: `services/web/package.json`
- Create: `services/web/tsconfig.json`
- Create: `services/web/next.config.ts`
- Create: `services/web/postcss.config.mjs`
- Create: `services/web/tailwind.config.ts`
- Create: `services/web/.eslintrc.json`
- Create: `services/web/vitest.config.ts`
- Create: `services/web/src/app/layout.tsx`
- Create: `services/web/src/app/page.tsx`
- Create: `services/web/src/app/globals.css`

- [ ] **Step 4.1: Create the web directory structure**

```bash
mkdir -p services/web/src/app
mkdir -p services/web/src/components
mkdir -p services/web/src/lib
mkdir -p services/web/public
```

- [ ] **Step 4.2: Create `services/web/package.json`**

```json
{
  "name": "sales-copilot-web",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev -p 3000",
    "build": "next build",
    "start": "next start -p 3000",
    "lint": "next lint",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "next": "15.0.3",
    "react": "19.0.0-rc-66855b96-20241106",
    "react-dom": "19.0.0-rc-66855b96-20241106"
  },
  "devDependencies": {
    "@types/node": "22.9.0",
    "@types/react": "18.3.12",
    "@types/react-dom": "18.3.1",
    "@vitejs/plugin-react": "4.3.3",
    "autoprefixer": "10.4.20",
    "eslint": "9.14.0",
    "eslint-config-next": "15.0.3",
    "jsdom": "25.0.1",
    "postcss": "8.4.49",
    "tailwindcss": "3.4.14",
    "typescript": "5.6.3",
    "vitest": "2.1.4"
  }
}
```

- [ ] **Step 4.3: Create `services/web/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 4.4: Create `services/web/next.config.ts`**

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
};

export default nextConfig;
```

- [ ] **Step 4.5: Create `services/web/postcss.config.mjs`**

```js
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

- [ ] **Step 4.6: Create `services/web/tailwind.config.ts`**

```ts
import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: { extend: {} },
  plugins: [],
} satisfies Config;
```

- [ ] **Step 4.7: Create `services/web/.eslintrc.json`**

```json
{
  "extends": "next/core-web-vitals"
}
```

- [ ] **Step 4.8: Create `services/web/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
```

- [ ] **Step 4.9: Create `services/web/src/app/globals.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

html, body {
  height: 100%;
}

body {
  @apply bg-slate-950 text-slate-100;
}
```

- [ ] **Step 4.10: Create `services/web/src/app/layout.tsx`**

```tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sales Copilot",
  description: "Live coaching for sales conversations",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
```

- [ ] **Step 4.11: Create placeholder `services/web/src/app/page.tsx`**

```tsx
export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <h1 className="text-3xl font-semibold">Sales Copilot</h1>
      <p className="mt-4 text-slate-400">Phase 1 skeleton — UI coming in Task 14.</p>
    </main>
  );
}
```

- [ ] **Step 4.12: Install deps and run build**

```bash
cd services/web
npm install
npm run build
```

Expected: Next.js build succeeds, prints `✓ Compiled successfully`, creates `.next/` and `.next/standalone/`.

- [ ] **Step 4.13: Commit**

```bash
git add services/web/package.json services/web/package-lock.json services/web/tsconfig.json services/web/next.config.ts services/web/postcss.config.mjs services/web/tailwind.config.ts services/web/.eslintrc.json services/web/vitest.config.ts services/web/src services/web/public
git commit -m "feat(web): scaffold Next.js 15 + TypeScript + Tailwind project"
```

---

### Task 5: Web Dockerfile

**Files:**
- Create: `services/web/Dockerfile`
- Create: `services/web/.dockerignore`

- [ ] **Step 5.1: Create `services/web/.dockerignore`**

```
node_modules
.next
.git
Dockerfile
.dockerignore
README.md
```

- [ ] **Step 5.2: Create `services/web/Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1.7

# --- deps ---
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# --- build ---
FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# --- runtime ---
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000

# Next.js standalone output
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public

EXPOSE 3000

CMD ["node", "server.js"]
```

- [ ] **Step 5.3: Build the image**

```bash
cd services/web
docker build -t sales-copilot-web:phase1 .
```

Expected: build succeeds, image created.

- [ ] **Step 5.4: Run and smoke-test**

```bash
docker run --rm -d -p 3000:3000 --name web-smoke sales-copilot-web:phase1
sleep 3
curl -sf http://localhost:3000/ | grep -q "Sales Copilot"
echo "smoke test: $?"
docker stop web-smoke
```

Expected: `smoke test: 0` printed.

- [ ] **Step 5.5: Commit**

```bash
git add services/web/Dockerfile services/web/.dockerignore
git commit -m "feat(web): add Dockerfile with Next.js standalone output"
```

---

### Task 6: docker-compose for local dev

**Files:**
- Create: `docker-compose.yml`

- [ ] **Step 6.1: Create `docker-compose.yml` at the repo root**

```yaml
services:
  gateway:
    build:
      context: ./services/gateway
    image: sales-copilot-gateway:phase1
    environment:
      LOG_LEVEL: info
    ports:
      - "8080:8080"
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8080/health').read()"]
      interval: 5s
      timeout: 2s
      retries: 5

  web:
    build:
      context: ./services/web
    image: sales-copilot-web:phase1
    environment:
      NEXT_PUBLIC_GATEWAY_WS_URL: ws://localhost:8080/ws/session
    ports:
      - "3000:3000"
    depends_on:
      gateway:
        condition: service_healthy
```

- [ ] **Step 6.2: Bring the stack up**

```bash
docker compose up --build -d
sleep 5
curl -sf http://localhost:8080/health
curl -sf http://localhost:3000/ > /dev/null && echo "web: ok"
docker compose down
```

Expected: both `curl` calls succeed.

- [ ] **Step 6.3: Commit**

```bash
git add docker-compose.yml
git commit -m "feat: add docker-compose for local dev"
```

---

### Task 7: GitHub Actions CI

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 7.1: Create `.github/workflows/ci.yml`**

```yaml
name: ci

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  gateway:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: services/gateway
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v3
        with:
          version: "0.5.*"
      - name: Install deps
        run: uv sync --frozen
      - name: Lint (ruff)
        run: uv run ruff check .
      - name: Format check (ruff)
        run: uv run ruff format --check .
      - name: Tests
        run: uv run pytest -v

  web:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: services/web
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: "npm"
          cache-dependency-path: services/web/package-lock.json
      - name: Install deps
        run: npm ci
      - name: Lint
        run: npm run lint
      - name: Tests
        run: npm test
      - name: Build
        run: npm run build
```

- [ ] **Step 7.2: Verify locally that the commands the CI runs actually pass**

```bash
cd services/gateway
uv run ruff check .
uv run ruff format --check .
uv run pytest -v
cd ../..
cd services/web
npm run lint
npm test
npm run build
```

Expected: every command exits 0. Fix any formatting complaints by running `uv run ruff format .` in the gateway directory.

- [ ] **Step 7.3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add GitHub Actions workflow for gateway and web"
```

---

## Phase 1 — Skeleton End-to-End

### Task 8: WebSocket protocol definition

Define the message types both sides will exchange. This is the load-bearing contract: if you get this wrong, every subsequent task has to be rewritten. Keep it tiny.

**Files:**
- Create: `services/gateway/src/sales_copilot_gateway/protocol.py`
- Create: `services/gateway/tests/test_protocol.py`
- Create: `services/web/src/lib/protocol.ts`

- [ ] **Step 8.1: Write the failing protocol test**

Create `services/gateway/tests/test_protocol.py`:

```python
"""Tests for the WebSocket protocol message types."""

import json

from sales_copilot_gateway.protocol import (
    ClientHelloMessage,
    EndSessionMessage,
    ServerErrorMessage,
    ServerSessionStartedMessage,
    SuggestionMessage,
    parse_client_message,
    serialize_server_message,
)


def test_client_hello_round_trip() -> None:
    raw = json.dumps({"type": "client_hello", "clientVersion": "0.1.0"})
    msg = parse_client_message(raw)
    assert isinstance(msg, ClientHelloMessage)
    assert msg.client_version == "0.1.0"


def test_end_session_round_trip() -> None:
    raw = json.dumps({"type": "end_session", "reason": "user_clicked_end"})
    msg = parse_client_message(raw)
    assert isinstance(msg, EndSessionMessage)
    assert msg.reason == "user_clicked_end"


def test_session_started_serializes() -> None:
    msg = ServerSessionStartedMessage(session_id="sess_abc123", started_at_ms=1_712_500_000_000)
    raw = serialize_server_message(msg)
    data = json.loads(raw)
    assert data == {
        "type": "session_started",
        "sessionId": "sess_abc123",
        "startedAtMs": 1_712_500_000_000,
    }


def test_suggestion_serializes() -> None:
    msg = SuggestionMessage(
        tick_at_ms=1_712_500_005_000,
        sentiment=1,
        intent="qualify_budget",
        suggestion="Ask about decision timeline.",
        confidence=0.82,
    )
    raw = serialize_server_message(msg)
    data = json.loads(raw)
    assert data == {
        "type": "suggestion",
        "tickAtMs": 1_712_500_005_000,
        "sentiment": 1,
        "intent": "qualify_budget",
        "suggestion": "Ask about decision timeline.",
        "confidence": 0.82,
    }


def test_error_serializes() -> None:
    msg = ServerErrorMessage(code="invalid_message", message="Unknown type 'foo'")
    raw = serialize_server_message(msg)
    data = json.loads(raw)
    assert data == {"type": "error", "code": "invalid_message", "message": "Unknown type 'foo'"}


def test_parse_unknown_type_raises() -> None:
    import pytest

    from sales_copilot_gateway.protocol import ProtocolError

    with pytest.raises(ProtocolError):
        parse_client_message(json.dumps({"type": "totally_made_up"}))
```

- [ ] **Step 8.2: Run test to verify it fails**

```bash
cd services/gateway
uv run pytest tests/test_protocol.py -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'sales_copilot_gateway.protocol'`.

- [ ] **Step 8.3: Create `services/gateway/src/sales_copilot_gateway/protocol.py`**

```python
"""WebSocket protocol for sales-copilot live sessions.

Messages are JSON objects with a `type` discriminator. Field names use
camelCase on the wire (matching the TypeScript client) but snake_case
in Python. Keep this file in sync with services/web/src/lib/protocol.ts.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from typing import Literal, Union


class ProtocolError(ValueError):
    """Raised when a message cannot be parsed or validated."""


# ---- Client → Server ----


@dataclass(frozen=True)
class ClientHelloMessage:
    type: Literal["client_hello"] = "client_hello"
    client_version: str = ""


@dataclass(frozen=True)
class EndSessionMessage:
    type: Literal["end_session"] = "end_session"
    reason: str = ""


ClientMessage = Union[ClientHelloMessage, EndSessionMessage]


# ---- Server → Client ----


@dataclass(frozen=True)
class ServerSessionStartedMessage:
    session_id: str
    started_at_ms: int
    type: Literal["session_started"] = "session_started"


@dataclass(frozen=True)
class SuggestionMessage:
    tick_at_ms: int
    sentiment: int
    intent: str
    suggestion: str
    confidence: float
    type: Literal["suggestion"] = "suggestion"


@dataclass(frozen=True)
class ServerErrorMessage:
    code: str
    message: str
    type: Literal["error"] = "error"


ServerMessage = Union[
    ServerSessionStartedMessage,
    SuggestionMessage,
    ServerErrorMessage,
]


# ---- Parse / serialize ----


def parse_client_message(raw: str) -> ClientMessage:
    """Parse an incoming JSON string into a typed client message."""
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ProtocolError(f"invalid JSON: {exc}") from exc

    if not isinstance(data, dict):
        raise ProtocolError("message must be a JSON object")

    msg_type = data.get("type")
    if msg_type == "client_hello":
        return ClientHelloMessage(client_version=str(data.get("clientVersion", "")))
    if msg_type == "end_session":
        return EndSessionMessage(reason=str(data.get("reason", "")))

    raise ProtocolError(f"unknown message type: {msg_type!r}")


_FIELD_SNAKE_TO_CAMEL = {
    "session_id": "sessionId",
    "started_at_ms": "startedAtMs",
    "tick_at_ms": "tickAtMs",
}


def _to_camel(snake: str) -> str:
    return _FIELD_SNAKE_TO_CAMEL.get(snake, snake)


def serialize_server_message(msg: ServerMessage) -> str:
    """Serialize a server message to the JSON wire format."""
    payload = {_to_camel(k): v for k, v in asdict(msg).items()}
    return json.dumps(payload)
```

- [ ] **Step 8.4: Run test to verify it passes**

```bash
uv run pytest tests/test_protocol.py -v
```

Expected: 6 tests pass.

- [ ] **Step 8.5: Create the TypeScript mirror at `services/web/src/lib/protocol.ts`**

```ts
// Mirror of services/gateway/src/sales_copilot_gateway/protocol.py.
// If you change one, change the other.

export type ClientMessage =
  | { type: "client_hello"; clientVersion: string }
  | { type: "end_session"; reason: string };

export type ServerMessage =
  | { type: "session_started"; sessionId: string; startedAtMs: number }
  | {
      type: "suggestion";
      tickAtMs: number;
      sentiment: number;
      intent: string;
      suggestion: string;
      confidence: number;
    }
  | { type: "error"; code: string; message: string };

export function serializeClientMessage(msg: ClientMessage): string {
  return JSON.stringify(msg);
}

export class ProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProtocolError";
  }
}

export function parseServerMessage(raw: string): ServerMessage {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    throw new ProtocolError(`invalid JSON: ${(err as Error).message}`);
  }
  if (typeof data !== "object" || data === null) {
    throw new ProtocolError("message must be a JSON object");
  }
  const obj = data as Record<string, unknown>;
  const type = obj.type;

  if (type === "session_started") {
    return {
      type: "session_started",
      sessionId: String(obj.sessionId ?? ""),
      startedAtMs: Number(obj.startedAtMs ?? 0),
    };
  }
  if (type === "suggestion") {
    return {
      type: "suggestion",
      tickAtMs: Number(obj.tickAtMs ?? 0),
      sentiment: Number(obj.sentiment ?? 0),
      intent: String(obj.intent ?? ""),
      suggestion: String(obj.suggestion ?? ""),
      confidence: Number(obj.confidence ?? 0),
    };
  }
  if (type === "error") {
    return {
      type: "error",
      code: String(obj.code ?? ""),
      message: String(obj.message ?? ""),
    };
  }
  throw new ProtocolError(`unknown message type: ${String(type)}`);
}
```

- [ ] **Step 8.6: Commit**

```bash
git add services/gateway/src/sales_copilot_gateway/protocol.py services/gateway/tests/test_protocol.py services/web/src/lib/protocol.ts
git commit -m "feat: define WebSocket protocol with parse/serialize in Python and TypeScript"
```

---

### Task 9: Gateway WebSocket endpoint (echo hello)

Before wiring the Session machinery in, get the raw WebSocket endpoint working. At the end of this task, connecting to `/ws/session` will accept the connection, emit a `session_started` message, and echo the `client_hello` back as a log line.

**Files:**
- Modify: `services/gateway/src/sales_copilot_gateway/main.py`
- Create: `services/gateway/tests/test_ws_endpoint.py`

- [ ] **Step 9.1: Write the failing WebSocket endpoint test**

Create `services/gateway/tests/test_ws_endpoint.py`:

```python
"""Tests for the /ws/session WebSocket endpoint (bare connection)."""

import json

import pytest
from fastapi.testclient import TestClient

from sales_copilot_gateway.main import app


def test_ws_accepts_connection_and_sends_session_started() -> None:
    client = TestClient(app)
    with client.websocket_connect("/ws/session") as ws:
        ws.send_text(json.dumps({"type": "client_hello", "clientVersion": "0.1.0"}))
        raw = ws.receive_text()
        msg = json.loads(raw)
        assert msg["type"] == "session_started"
        assert msg["sessionId"].startswith("sess_")
        assert isinstance(msg["startedAtMs"], int)


def test_ws_rejects_unknown_message_type() -> None:
    client = TestClient(app)
    with client.websocket_connect("/ws/session") as ws:
        # Server sends session_started first
        ws.receive_text()
        ws.send_text(json.dumps({"type": "bogus"}))
        raw = ws.receive_text()
        msg = json.loads(raw)
        assert msg["type"] == "error"
        assert msg["code"] == "invalid_message"
```

Wait — the first test expects `session_started` **after** sending `client_hello`, but the second test expects it **before** any send. Let's settle this now to avoid contradicting ourselves: **the server sends `session_started` immediately on connection accept, before any client message**. Fix the first test to match:

```python
def test_ws_accepts_connection_and_sends_session_started() -> None:
    client = TestClient(app)
    with client.websocket_connect("/ws/session") as ws:
        raw = ws.receive_text()
        msg = json.loads(raw)
        assert msg["type"] == "session_started"
        assert msg["sessionId"].startswith("sess_")
        assert isinstance(msg["startedAtMs"], int)

        # Now the client can say hello; server should not error
        ws.send_text(json.dumps({"type": "client_hello", "clientVersion": "0.1.0"}))
```

- [ ] **Step 9.2: Run test to verify it fails**

```bash
cd services/gateway
uv run pytest tests/test_ws_endpoint.py -v
```

Expected: FAIL with `WebSocketException` or 404 (endpoint doesn't exist yet).

- [ ] **Step 9.3: Update `services/gateway/src/sales_copilot_gateway/main.py`**

Replace the file contents with:

```python
"""FastAPI app entrypoint."""

import logging
import secrets
import time

from fastapi import FastAPI, WebSocket, WebSocketDisconnect

from sales_copilot_gateway import __version__
from sales_copilot_gateway.protocol import (
    ProtocolError,
    ServerErrorMessage,
    ServerSessionStartedMessage,
    parse_client_message,
    serialize_server_message,
)

logger = logging.getLogger(__name__)

app = FastAPI(title="sales-copilot-gateway", version=__version__)


@app.get("/health")
async def health() -> dict[str, str]:
    """Liveness probe for Docker / Cloud Run."""
    return {"status": "ok", "version": __version__}


def _new_session_id() -> str:
    return f"sess_{secrets.token_urlsafe(12)}"


def _now_ms() -> int:
    return int(time.time() * 1000)


@app.websocket("/ws/session")
async def session_ws(ws: WebSocket) -> None:
    """Phase 1 WebSocket handler: accept, greet, log incoming client messages."""
    await ws.accept()
    session_id = _new_session_id()
    started_at_ms = _now_ms()
    logger.info("session_open session_id=%s", session_id)

    await ws.send_text(
        serialize_server_message(
            ServerSessionStartedMessage(session_id=session_id, started_at_ms=started_at_ms)
        )
    )

    try:
        while True:
            raw = await ws.receive_text()
            try:
                msg = parse_client_message(raw)
            except ProtocolError as exc:
                logger.warning("session_id=%s invalid_message: %s", session_id, exc)
                await ws.send_text(
                    serialize_server_message(
                        ServerErrorMessage(code="invalid_message", message=str(exc))
                    )
                )
                continue

            logger.info("session_id=%s client_message=%s", session_id, type(msg).__name__)

            if msg.type == "end_session":
                logger.info("session_id=%s end_session reason=%s", session_id, msg.reason)
                break
    except WebSocketDisconnect:
        logger.info("session_id=%s disconnect", session_id)
```

- [ ] **Step 9.4: Run tests to verify they pass**

```bash
uv run pytest tests/test_ws_endpoint.py -v
```

Expected: both tests pass.

- [ ] **Step 9.5: Commit**

```bash
git add services/gateway/src/sales_copilot_gateway/main.py services/gateway/tests/test_ws_endpoint.py
git commit -m "feat(gateway): add /ws/session endpoint that greets and validates messages"
```

---

### Task 10: Gateway Session class

Extract the per-connection state (session id, start time, running suggestion task) out of `main.py` into a `Session` dataclass with a start/stop lifecycle. This keeps `main.py` thin and gives us a clean place to later add transcript buffering (Phase 3) and prompt construction (Phase 4).

**Files:**
- Create: `services/gateway/src/sales_copilot_gateway/session.py`
- Create: `services/gateway/tests/test_session.py`

- [ ] **Step 10.1: Write the failing session test**

Create `services/gateway/tests/test_session.py`:

```python
"""Tests for the Session lifecycle."""

from sales_copilot_gateway.session import Session


def test_session_has_unique_id_prefix() -> None:
    s = Session.start()
    assert s.id.startswith("sess_")
    assert len(s.id) > len("sess_")


def test_session_two_sessions_have_different_ids() -> None:
    s1 = Session.start()
    s2 = Session.start()
    assert s1.id != s2.id


def test_session_started_at_ms_is_set() -> None:
    s = Session.start()
    assert s.started_at_ms > 0


def test_session_is_active_after_start_and_inactive_after_end() -> None:
    s = Session.start()
    assert s.is_active
    s.end()
    assert not s.is_active
```

- [ ] **Step 10.2: Run test to verify it fails**

```bash
cd services/gateway
uv run pytest tests/test_session.py -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'sales_copilot_gateway.session'`.

- [ ] **Step 10.3: Create `services/gateway/src/sales_copilot_gateway/session.py`**

```python
"""Per-connection session state.

A Session tracks one live WebSocket call from start to end. In Phase 1
it holds only id + timestamps + an active flag. Future phases will add
the transcript buffer, running summary, and prompt builder.
"""

from __future__ import annotations

import secrets
import time
from dataclasses import dataclass, field


def _new_session_id() -> str:
    return f"sess_{secrets.token_urlsafe(12)}"


def _now_ms() -> int:
    return int(time.time() * 1000)


@dataclass
class Session:
    id: str
    started_at_ms: int
    ended_at_ms: int | None = field(default=None)

    @classmethod
    def start(cls) -> Session:
        """Create and return a new active session."""
        return cls(id=_new_session_id(), started_at_ms=_now_ms())

    @property
    def is_active(self) -> bool:
        return self.ended_at_ms is None

    def end(self) -> None:
        """Mark the session as ended. Idempotent."""
        if self.ended_at_ms is None:
            self.ended_at_ms = _now_ms()
```

- [ ] **Step 10.4: Run test to verify it passes**

```bash
uv run pytest tests/test_session.py -v
```

Expected: 4 tests pass.

- [ ] **Step 10.5: Commit**

```bash
git add services/gateway/src/sales_copilot_gateway/session.py services/gateway/tests/test_session.py
git commit -m "feat(gateway): add Session dataclass with start/end lifecycle"
```

---

### Task 11: Canned suggestion generator

Build a pure async generator that yields `SuggestionMessage` instances on a 5-second tick. Zero WebSocket knowledge. This makes it trivial to unit-test and to swap for a real Gemini-backed implementation in Phase 4.

**Files:**
- Create: `services/gateway/src/sales_copilot_gateway/suggestions.py`
- Create: `services/gateway/tests/test_suggestions.py`

- [ ] **Step 11.1: Write the failing suggestions test**

Create `services/gateway/tests/test_suggestions.py`:

```python
"""Tests for the canned suggestion generator."""

import asyncio

import pytest

from sales_copilot_gateway.protocol import SuggestionMessage
from sales_copilot_gateway.suggestions import canned_suggestion_stream


async def test_emits_suggestions_with_expected_shape() -> None:
    stream = canned_suggestion_stream(tick_seconds=0.0)  # zero for speed
    got: list[SuggestionMessage] = []
    async for msg in stream:
        got.append(msg)
        if len(got) >= 3:
            break

    assert len(got) == 3
    for msg in got:
        assert isinstance(msg, SuggestionMessage)
        assert msg.intent
        assert msg.suggestion
        assert -2 <= msg.sentiment <= 2
        assert 0.0 <= msg.confidence <= 1.0


async def test_rotates_through_canned_bank() -> None:
    stream = canned_suggestion_stream(tick_seconds=0.0)
    got: list[str] = []
    async for msg in stream:
        got.append(msg.suggestion)
        if len(got) >= 6:
            break

    # With 3 canned lines, we should see each at least once in 6 ticks
    assert len(set(got)) >= 3


async def test_respects_tick_seconds_delay() -> None:
    stream = canned_suggestion_stream(tick_seconds=0.05)
    t0 = asyncio.get_event_loop().time()
    n = 0
    async for _msg in stream:
        n += 1
        if n >= 3:
            break
    elapsed = asyncio.get_event_loop().time() - t0
    # Three ticks * 0.05s = 0.15s minimum, allow generous margin
    assert elapsed >= 0.10
```

- [ ] **Step 11.2: Run test to verify it fails**

```bash
cd services/gateway
uv run pytest tests/test_suggestions.py -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'sales_copilot_gateway.suggestions'`.

- [ ] **Step 11.3: Create `services/gateway/src/sales_copilot_gateway/suggestions.py`**

```python
"""Canned suggestion generator for Phase 1.

In Phase 4 this is replaced with a Gemini-backed generator that takes
a transcript window + running summary and streams suggestions back.
The public interface (`canned_suggestion_stream`) will be renamed then,
but the shape — an async iterator of SuggestionMessage — stays the same.
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import AsyncIterator

from sales_copilot_gateway.protocol import SuggestionMessage

_CANNED_BANK: tuple[tuple[str, str, int, float], ...] = (
    ("discovery", "Ask what metrics they use to measure success today.", 0, 0.78),
    ("qualify_budget", "Confirm budget range before showing pricing.", 1, 0.82),
    ("handle_objection", "Acknowledge the concern, then share a relevant customer story.", -1, 0.74),
)


async def canned_suggestion_stream(
    tick_seconds: float = 5.0,
) -> AsyncIterator[SuggestionMessage]:
    """Yield a SuggestionMessage every `tick_seconds`, cycling the bank forever.

    Pass `tick_seconds=0.0` in tests to drain immediately.
    """
    i = 0
    while True:
        if tick_seconds > 0:
            await asyncio.sleep(tick_seconds)
        else:
            # Cooperative yield so tests can break out
            await asyncio.sleep(0)

        intent, suggestion, sentiment, confidence = _CANNED_BANK[i % len(_CANNED_BANK)]
        yield SuggestionMessage(
            tick_at_ms=int(time.time() * 1000),
            sentiment=sentiment,
            intent=intent,
            suggestion=suggestion,
            confidence=confidence,
        )
        i += 1
```

- [ ] **Step 11.4: Run test to verify it passes**

```bash
uv run pytest tests/test_suggestions.py -v
```

Expected: 3 tests pass.

- [ ] **Step 11.5: Commit**

```bash
git add services/gateway/src/sales_copilot_gateway/suggestions.py services/gateway/tests/test_suggestions.py
git commit -m "feat(gateway): add canned suggestion generator (async iterator)"
```

---

### Task 12: Wire Session + suggestions into the WebSocket handler

Now combine the three pieces from Tasks 9-11. The handler creates a `Session`, starts a background task that drains the suggestion stream and sends each one over the WebSocket, and concurrently reads client messages.

**Files:**
- Modify: `services/gateway/src/sales_copilot_gateway/main.py`
- Modify: `services/gateway/tests/test_ws_endpoint.py`

- [ ] **Step 12.1: Update the WebSocket test to assert suggestions arrive**

Replace the contents of `services/gateway/tests/test_ws_endpoint.py` with:

```python
"""Tests for the /ws/session WebSocket endpoint."""

import json

from fastapi.testclient import TestClient

from sales_copilot_gateway.main import app, SUGGESTION_TICK_SECONDS_ENV


def test_ws_accepts_connection_and_sends_session_started() -> None:
    client = TestClient(app)
    with client.websocket_connect("/ws/session") as ws:
        raw = ws.receive_text()
        msg = json.loads(raw)
        assert msg["type"] == "session_started"
        assert msg["sessionId"].startswith("sess_")
        assert isinstance(msg["startedAtMs"], int)


def test_ws_rejects_unknown_message_type() -> None:
    client = TestClient(app)
    with client.websocket_connect("/ws/session") as ws:
        ws.receive_text()  # session_started
        ws.send_text(json.dumps({"type": "bogus"}))
        raw = ws.receive_text()
        msg = json.loads(raw)
        # Under the concurrent handler the next message could be a suggestion
        # OR the error — drain until we see the error.
        while msg["type"] != "error":
            raw = ws.receive_text()
            msg = json.loads(raw)
        assert msg["code"] == "invalid_message"


def test_ws_streams_canned_suggestions(monkeypatch) -> None:
    # Force zero-tick for test speed
    monkeypatch.setenv(SUGGESTION_TICK_SECONDS_ENV, "0.0")

    client = TestClient(app)
    with client.websocket_connect("/ws/session") as ws:
        # Drop session_started
        first = json.loads(ws.receive_text())
        assert first["type"] == "session_started"

        # Read until we collect 3 suggestions
        suggestions = []
        while len(suggestions) < 3:
            msg = json.loads(ws.receive_text())
            if msg["type"] == "suggestion":
                suggestions.append(msg)

        assert len(suggestions) == 3
        for s in suggestions:
            assert s["intent"]
            assert s["suggestion"]
            assert -2 <= s["sentiment"] <= 2


def test_ws_end_session_closes_cleanly(monkeypatch) -> None:
    monkeypatch.setenv(SUGGESTION_TICK_SECONDS_ENV, "0.0")
    client = TestClient(app)
    with client.websocket_connect("/ws/session") as ws:
        ws.receive_text()  # session_started
        ws.send_text(json.dumps({"type": "end_session", "reason": "test"}))
        # Server closes; receiving again should raise
        import pytest
        from fastapi.websockets import WebSocketDisconnect as WSD

        with pytest.raises(WSD):
            # Drain any queued suggestions until the close is observed
            for _ in range(20):
                ws.receive_text()
```

- [ ] **Step 12.2: Run test to verify the new ones fail**

```bash
cd services/gateway
uv run pytest tests/test_ws_endpoint.py -v
```

Expected: the new `test_ws_streams_canned_suggestions` and `test_ws_end_session_closes_cleanly` fail (no suggestion stream wired in); the existing two still pass.

- [ ] **Step 12.3: Update `services/gateway/src/sales_copilot_gateway/main.py`**

Replace the file contents with:

```python
"""FastAPI app entrypoint — wires Session + suggestions into the /ws/session handler."""

import asyncio
import logging
import os

from fastapi import FastAPI, WebSocket, WebSocketDisconnect

from sales_copilot_gateway import __version__
from sales_copilot_gateway.protocol import (
    EndSessionMessage,
    ProtocolError,
    ServerErrorMessage,
    ServerSessionStartedMessage,
    parse_client_message,
    serialize_server_message,
)
from sales_copilot_gateway.session import Session
from sales_copilot_gateway.suggestions import canned_suggestion_stream

logger = logging.getLogger(__name__)

app = FastAPI(title="sales-copilot-gateway", version=__version__)

SUGGESTION_TICK_SECONDS_ENV = "SUGGESTION_TICK_SECONDS"
_DEFAULT_TICK_SECONDS = 5.0


def _tick_seconds() -> float:
    raw = os.environ.get(SUGGESTION_TICK_SECONDS_ENV)
    if raw is None:
        return _DEFAULT_TICK_SECONDS
    try:
        return float(raw)
    except ValueError:
        return _DEFAULT_TICK_SECONDS


@app.get("/health")
async def health() -> dict[str, str]:
    """Liveness probe for Docker / Cloud Run."""
    return {"status": "ok", "version": __version__}


async def _suggestion_sender(ws: WebSocket, session: Session) -> None:
    """Drain the canned suggestion stream and push messages out the WebSocket."""
    tick = _tick_seconds()
    try:
        async for msg in canned_suggestion_stream(tick_seconds=tick):
            if not session.is_active:
                return
            await ws.send_text(serialize_server_message(msg))
    except asyncio.CancelledError:
        raise
    except WebSocketDisconnect:
        return


async def _client_reader(ws: WebSocket, session: Session) -> None:
    """Read client messages until end_session or disconnect."""
    while session.is_active:
        try:
            raw = await ws.receive_text()
        except WebSocketDisconnect:
            return

        try:
            msg = parse_client_message(raw)
        except ProtocolError as exc:
            logger.warning("session_id=%s invalid_message: %s", session.id, exc)
            await ws.send_text(
                serialize_server_message(
                    ServerErrorMessage(code="invalid_message", message=str(exc))
                )
            )
            continue

        logger.info("session_id=%s client_message=%s", session.id, type(msg).__name__)

        if isinstance(msg, EndSessionMessage):
            logger.info("session_id=%s end_session reason=%s", session.id, msg.reason)
            session.end()
            return


@app.websocket("/ws/session")
async def session_ws(ws: WebSocket) -> None:
    await ws.accept()
    session = Session.start()
    logger.info("session_open session_id=%s", session.id)

    await ws.send_text(
        serialize_server_message(
            ServerSessionStartedMessage(
                session_id=session.id, started_at_ms=session.started_at_ms
            )
        )
    )

    sender = asyncio.create_task(_suggestion_sender(ws, session))
    reader = asyncio.create_task(_client_reader(ws, session))

    try:
        done, pending = await asyncio.wait(
            {sender, reader}, return_when=asyncio.FIRST_COMPLETED
        )
    finally:
        session.end()
        for task in (sender, reader):
            if not task.done():
                task.cancel()
        await asyncio.gather(sender, reader, return_exceptions=True)
        try:
            await ws.close()
        except RuntimeError:
            pass
        logger.info("session_close session_id=%s", session.id)
```

- [ ] **Step 12.4: Run all gateway tests**

```bash
uv run pytest -v
```

Expected: every test in `tests/` passes (smoke, health, protocol, session, suggestions, ws endpoint — all four of those).

- [ ] **Step 12.5: Rebuild the Docker image and smoke-test end-to-end from a shell**

```bash
cd services/gateway
docker build -t sales-copilot-gateway:phase1 .
docker run --rm -d -p 8080:8080 -e SUGGESTION_TICK_SECONDS=1.0 --name gw-ws sales-copilot-gateway:phase1
sleep 2
# Use websocat or python one-liner to connect; here's a Python one-liner:
uv run python - <<'PY'
import asyncio, json
import websockets

async def main():
    async with websockets.connect("ws://localhost:8080/ws/session") as ws:
        print("<-", await ws.recv())  # session_started
        for _ in range(2):
            print("<-", await ws.recv())  # suggestion
        await ws.send(json.dumps({"type": "end_session", "reason": "smoke"}))

asyncio.run(main())
PY
docker stop gw-ws
```

If `websockets` isn't in the dev deps yet, add it: in `services/gateway/pyproject.toml` under `[dependency-groups] dev`, add `"websockets>=13"`, then `uv sync`.

Expected: three messages printed — one `session_started`, two `suggestion`.

- [ ] **Step 12.6: Commit**

```bash
git add services/gateway/src/sales_copilot_gateway/main.py services/gateway/tests/test_ws_endpoint.py services/gateway/pyproject.toml services/gateway/uv.lock
git commit -m "feat(gateway): stream canned suggestions concurrently with client reader"
```

---

### Task 13: (Gateway-side hardening) structured logging config

Keep the gateway easy to debug in docker-compose. Add a tiny logging config so messages are formatted with timestamp + level + message, and configurable via `LOG_LEVEL`.

**Files:**
- Modify: `services/gateway/src/sales_copilot_gateway/main.py`

- [ ] **Step 13.1: Add logging setup to the top of `main.py`**

Edit `services/gateway/src/sales_copilot_gateway/main.py`. Immediately after the `import os` line, add:

```python
logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)-7s %(name)s %(message)s",
)
```

Note: `logging` is already imported at the top of the file. Just make sure this runs at import time, before `logger = logging.getLogger(__name__)`.

- [ ] **Step 13.2: Run the existing tests to confirm nothing broke**

```bash
cd services/gateway
uv run pytest -v
```

Expected: all tests still pass.

- [ ] **Step 13.3: Commit**

```bash
git add services/gateway/src/sales_copilot_gateway/main.py
git commit -m "chore(gateway): configure root logging with LOG_LEVEL env"
```

---

### Task 14: Web SessionPanel component (UI-only, no WS yet)

Build the visual skeleton of the session UI: a "Start session" / "End session" button pair, a status line, and a suggestions list. No WebSocket or audio capture yet — this task is pure React so we can test rendering in isolation before adding side effects.

**Files:**
- Create: `services/web/src/components/SessionPanel.tsx`
- Create: `services/web/src/components/SessionPanel.test.tsx`

- [ ] **Step 14.1: Write the failing component test**

Create `services/web/src/components/SessionPanel.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { SessionPanel } from "./SessionPanel";

describe("SessionPanel", () => {
  it("shows the Start button when idle", () => {
    render(
      <SessionPanel
        status="idle"
        suggestions={[]}
        onStart={() => {}}
        onEnd={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /start session/i })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /end session/i }),
    ).not.toBeInTheDocument();
  });

  it("shows the End button when active", () => {
    render(
      <SessionPanel
        status="active"
        suggestions={[]}
        onStart={() => {}}
        onEnd={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /end session/i })).toBeInTheDocument();
  });

  it("renders suggestions in order", () => {
    render(
      <SessionPanel
        status="active"
        suggestions={[
          { id: "1", intent: "discovery", suggestion: "Ask about metrics", sentiment: 0 },
          { id: "2", intent: "qualify_budget", suggestion: "Confirm budget", sentiment: 1 },
        ]}
        onStart={() => {}}
        onEnd={() => {}}
      />,
    );
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Ask about metrics");
    expect(items[1]).toHaveTextContent("Confirm budget");
  });

  it("calls onStart when Start clicked", () => {
    const onStart = vi.fn();
    render(
      <SessionPanel status="idle" suggestions={[]} onStart={onStart} onEnd={() => {}} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /start session/i }));
    expect(onStart).toHaveBeenCalledOnce();
  });

  it("calls onEnd when End clicked", () => {
    const onEnd = vi.fn();
    render(
      <SessionPanel status="active" suggestions={[]} onStart={() => {}} onEnd={onEnd} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /end session/i }));
    expect(onEnd).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 14.2: Add the testing-library dev deps**

```bash
cd services/web
npm install --save-dev @testing-library/react@^16 @testing-library/jest-dom@^6 @testing-library/user-event@^14
```

- [ ] **Step 14.3: Run the test to verify it fails**

```bash
npm test
```

Expected: FAIL — `Cannot find module './SessionPanel'`.

- [ ] **Step 14.4: Create `services/web/src/components/SessionPanel.tsx`**

```tsx
"use client";

export type SessionStatus = "idle" | "connecting" | "active" | "ended" | "error";

export interface RenderedSuggestion {
  id: string;
  intent: string;
  suggestion: string;
  sentiment: number;
}

interface Props {
  status: SessionStatus;
  suggestions: RenderedSuggestion[];
  onStart: () => void;
  onEnd: () => void;
  errorMessage?: string;
}

function sentimentBadge(sentiment: number): string {
  if (sentiment <= -2) return "bg-red-600";
  if (sentiment === -1) return "bg-orange-500";
  if (sentiment === 0) return "bg-slate-500";
  if (sentiment === 1) return "bg-emerald-500";
  return "bg-emerald-700";
}

export function SessionPanel({ status, suggestions, onStart, onEnd, errorMessage }: Props) {
  const isActive = status === "active" || status === "connecting";

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-8">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Sales Copilot</h1>
        <span
          className="text-sm text-slate-400"
          data-testid="status-line"
          aria-live="polite"
        >
          status: {status}
        </span>
      </header>

      <div>
        {isActive ? (
          <button
            type="button"
            onClick={onEnd}
            className="rounded-md bg-red-600 px-4 py-2 font-medium text-white hover:bg-red-700"
          >
            End session
          </button>
        ) : (
          <button
            type="button"
            onClick={onStart}
            className="rounded-md bg-emerald-600 px-4 py-2 font-medium text-white hover:bg-emerald-700"
          >
            Start session
          </button>
        )}
      </div>

      {errorMessage ? (
        <div role="alert" className="rounded-md bg-red-900/40 p-3 text-red-200">
          {errorMessage}
        </div>
      ) : null}

      <div>
        <h2 className="mb-2 text-sm uppercase tracking-wider text-slate-400">
          Suggestions
        </h2>
        {suggestions.length === 0 ? (
          <p className="text-slate-500">No suggestions yet. They&apos;ll appear here live.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {suggestions.map((s) => (
              <li
                key={s.id}
                className="flex items-start gap-3 rounded-md bg-slate-900 p-3 shadow"
              >
                <span
                  className={`mt-1 h-2 w-2 rounded-full ${sentimentBadge(s.sentiment)}`}
                  aria-hidden
                />
                <div>
                  <div className="text-xs uppercase tracking-wider text-slate-500">
                    {s.intent}
                  </div>
                  <div className="text-slate-100">{s.suggestion}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 14.5: Run the test to verify it passes**

```bash
npm test
```

Expected: all 5 `SessionPanel` tests pass.

- [ ] **Step 14.6: Commit**

```bash
git add services/web/package.json services/web/package-lock.json services/web/src/components/SessionPanel.tsx services/web/src/components/SessionPanel.test.tsx
git commit -m "feat(web): add SessionPanel component with status, buttons, suggestion list"
```

---

### Task 15: Web audio capture utility

Wrap `getDisplayMedia` in a small module we can test via mocking. Phase 1 only needs to *acquire* the stream and report whether an audio track is present — we don't yet encode or upload frames (that's Phase 3 when we care about STT).

**Files:**
- Create: `services/web/src/lib/audioCapture.ts`
- Create: `services/web/src/lib/audioCapture.test.ts`

- [ ] **Step 15.1: Write the failing audio capture test**

Create `services/web/src/lib/audioCapture.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";

import { captureMeetingTabAudio, AudioCaptureError } from "./audioCapture";

type DisplayMediaMock = (constraints: MediaStreamConstraints) => Promise<MediaStream>;

function setGetDisplayMedia(mock: DisplayMediaMock) {
  // Ensure the nested assignment is allowed under strict TS
  const md = (navigator as unknown as { mediaDevices: { getDisplayMedia: DisplayMediaMock } });
  md.mediaDevices = { getDisplayMedia: mock };
}

describe("captureMeetingTabAudio", () => {
  beforeEach(() => {
    setGetDisplayMedia(() => Promise.reject(new Error("not set")));
  });

  it("returns the stream when an audio track is present", async () => {
    const audioTrack = { kind: "audio", stop: vi.fn() } as unknown as MediaStreamTrack;
    const stream = {
      getAudioTracks: () => [audioTrack],
      getVideoTracks: () => [],
      getTracks: () => [audioTrack],
    } as unknown as MediaStream;

    setGetDisplayMedia(() => Promise.resolve(stream));

    const result = await captureMeetingTabAudio();
    expect(result).toBe(stream);
  });

  it("throws AudioCaptureError when no audio track is present", async () => {
    const stream = {
      getAudioTracks: () => [],
      getVideoTracks: () => [{ stop: vi.fn() }],
      getTracks: () => [{ stop: vi.fn() }],
    } as unknown as MediaStream;

    setGetDisplayMedia(() => Promise.resolve(stream));

    await expect(captureMeetingTabAudio()).rejects.toBeInstanceOf(AudioCaptureError);
    await expect(captureMeetingTabAudio()).rejects.toMatchObject({
      code: "no_audio_track",
    });
  });

  it("throws AudioCaptureError when user denies the permission", async () => {
    const err = new DOMException("user denied", "NotAllowedError");
    setGetDisplayMedia(() => Promise.reject(err));

    await expect(captureMeetingTabAudio()).rejects.toMatchObject({
      code: "permission_denied",
    });
  });
});
```

- [ ] **Step 15.2: Run the test to verify it fails**

```bash
cd services/web
npm test
```

Expected: FAIL — `Cannot find module './audioCapture'`.

- [ ] **Step 15.3: Create `services/web/src/lib/audioCapture.ts`**

```ts
/**
 * Capture audio from a meeting tab via `getDisplayMedia`.
 *
 * Phase 1 only acquires the stream and verifies an audio track is
 * present. In Phase 3 we start pumping Opus frames over the WebSocket.
 */

export type AudioCaptureErrorCode =
  | "permission_denied"
  | "no_audio_track"
  | "unsupported";

export class AudioCaptureError extends Error {
  readonly code: AudioCaptureErrorCode;

  constructor(code: AudioCaptureErrorCode, message: string) {
    super(message);
    this.name = "AudioCaptureError";
    this.code = code;
  }
}

export async function captureMeetingTabAudio(): Promise<MediaStream> {
  if (
    typeof navigator === "undefined" ||
    !navigator.mediaDevices ||
    !navigator.mediaDevices.getDisplayMedia
  ) {
    throw new AudioCaptureError(
      "unsupported",
      "Your browser does not support tab capture (getDisplayMedia).",
    );
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      audio: true,
      // We don't need the video; browsers still require the flag.
      video: { width: 1, height: 1, frameRate: 1 },
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "NotAllowedError") {
      throw new AudioCaptureError(
        "permission_denied",
        "Tab capture was denied. Click Start again and share the meeting tab with audio.",
      );
    }
    throw err;
  }

  const audioTracks = stream.getAudioTracks();
  if (audioTracks.length === 0) {
    // Clean up any video track the picker gave us
    stream.getTracks().forEach((t) => t.stop());
    throw new AudioCaptureError(
      "no_audio_track",
      "No audio track was shared. Make sure you check 'Share tab audio' in the picker.",
    );
  }

  return stream;
}
```

- [ ] **Step 15.4: Run the test to verify it passes**

```bash
npm test
```

Expected: all `audioCapture` tests pass.

- [ ] **Step 15.5: Commit**

```bash
git add services/web/src/lib/audioCapture.ts services/web/src/lib/audioCapture.test.ts
git commit -m "feat(web): add audioCapture helper around getDisplayMedia"
```

---

### Task 16: Web WebSocket client utility

Build a small WebSocket client that connects, parses incoming `ServerMessage`s using the protocol module, and fires typed callbacks. No auto-reconnect in Phase 1 — we'll add that in Phase 6.

**Files:**
- Create: `services/web/src/lib/wsClient.ts`
- Create: `services/web/src/lib/wsClient.test.ts`

- [ ] **Step 16.1: Write the failing ws client test**

Create `services/web/src/lib/wsClient.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { SessionWebSocket } from "./wsClient";
import type { ServerMessage } from "./protocol";

// Fake WebSocket constructor that captures the instance so tests can drive it.
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  url: string;
  readyState = 0;
  sent: string[] = [];
  onopen?: () => void;
  onmessage?: (ev: { data: string }) => void;
  onclose?: (ev: { code: number; reason: string }) => void;
  onerror?: (ev: Event) => void;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close(code = 1000, reason = "") {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }

  // Test helpers
  emitOpen() {
    this.readyState = 1;
    this.onopen?.();
  }
  emitMessage(data: string) {
    this.onmessage?.({ data });
  }
}

describe("SessionWebSocket", () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    (globalThis as unknown as { WebSocket: typeof WebSocket }).WebSocket =
      FakeWebSocket as unknown as typeof WebSocket;
  });

  afterEach(() => {
    FakeWebSocket.instances = [];
  });

  it("connects to the given URL and fires onOpen", () => {
    const onOpen = vi.fn();
    const ws = new SessionWebSocket({ url: "ws://example/ws/session", onOpen, onMessage: () => {}, onClose: () => {} });
    ws.connect();
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.instances[0].url).toBe("ws://example/ws/session");

    FakeWebSocket.instances[0].emitOpen();
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("parses and forwards server messages", () => {
    const received: ServerMessage[] = [];
    const ws = new SessionWebSocket({
      url: "ws://example/ws/session",
      onOpen: () => {},
      onMessage: (msg) => received.push(msg),
      onClose: () => {},
    });
    ws.connect();
    FakeWebSocket.instances[0].emitOpen();

    FakeWebSocket.instances[0].emitMessage(
      JSON.stringify({
        type: "suggestion",
        tickAtMs: 1,
        sentiment: 1,
        intent: "discovery",
        suggestion: "Ask X",
        confidence: 0.9,
      }),
    );

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ type: "suggestion", suggestion: "Ask X" });
  });

  it("sends client messages as JSON", () => {
    const ws = new SessionWebSocket({
      url: "ws://example/ws/session",
      onOpen: () => {},
      onMessage: () => {},
      onClose: () => {},
    });
    ws.connect();
    FakeWebSocket.instances[0].emitOpen();

    ws.sendEndSession("user_clicked_end");

    expect(FakeWebSocket.instances[0].sent).toHaveLength(1);
    expect(JSON.parse(FakeWebSocket.instances[0].sent[0])).toEqual({
      type: "end_session",
      reason: "user_clicked_end",
    });
  });

  it("fires onClose when underlying socket closes", () => {
    const onClose = vi.fn();
    const ws = new SessionWebSocket({
      url: "ws://example/ws/session",
      onOpen: () => {},
      onMessage: () => {},
      onClose,
    });
    ws.connect();
    FakeWebSocket.instances[0].emitOpen();
    FakeWebSocket.instances[0].close(1000, "bye");

    expect(onClose).toHaveBeenCalledWith({ code: 1000, reason: "bye" });
  });
});
```

- [ ] **Step 16.2: Run the test to verify it fails**

```bash
cd services/web
npm test
```

Expected: FAIL — `Cannot find module './wsClient'`.

- [ ] **Step 16.3: Create `services/web/src/lib/wsClient.ts`**

```ts
import {
  parseServerMessage,
  serializeClientMessage,
  type ClientMessage,
  type ServerMessage,
  ProtocolError,
} from "./protocol";

interface SessionWebSocketOptions {
  url: string;
  onOpen: () => void;
  onMessage: (msg: ServerMessage) => void;
  onClose: (ev: { code: number; reason: string }) => void;
  onError?: (err: unknown) => void;
}

export class SessionWebSocket {
  private readonly opts: SessionWebSocketOptions;
  private ws: WebSocket | null = null;

  constructor(opts: SessionWebSocketOptions) {
    this.opts = opts;
  }

  connect(): void {
    if (this.ws) {
      return;
    }
    const ws = new WebSocket(this.opts.url);
    this.ws = ws;

    ws.onopen = () => {
      this.opts.onOpen();
    };

    ws.onmessage = (ev: MessageEvent<string>) => {
      try {
        const msg = parseServerMessage(ev.data);
        this.opts.onMessage(msg);
      } catch (err) {
        if (err instanceof ProtocolError && this.opts.onError) {
          this.opts.onError(err);
        } else if (this.opts.onError) {
          this.opts.onError(err);
        }
      }
    };

    ws.onclose = (ev) => {
      this.opts.onClose({ code: ev.code, reason: ev.reason });
      this.ws = null;
    };

    ws.onerror = (ev) => {
      if (this.opts.onError) {
        this.opts.onError(ev);
      }
    };
  }

  send(msg: ClientMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    this.ws.send(serializeClientMessage(msg));
  }

  sendClientHello(clientVersion: string): void {
    this.send({ type: "client_hello", clientVersion });
  }

  sendEndSession(reason: string): void {
    this.send({ type: "end_session", reason });
  }

  close(reason = ""): void {
    if (this.ws) {
      this.ws.close(1000, reason);
    }
  }
}
```

- [ ] **Step 16.4: Run the test to verify it passes**

```bash
npm test
```

Expected: all `SessionWebSocket` tests pass.

- [ ] **Step 16.5: Commit**

```bash
git add services/web/src/lib/wsClient.ts services/web/src/lib/wsClient.test.ts
git commit -m "feat(web): add SessionWebSocket wrapper with typed protocol handlers"
```

---

### Task 17: Wire the UI to the gateway

Turn `page.tsx` into the real home of the session flow. On "Start session" it: (1) calls `captureMeetingTabAudio`, (2) opens a `SessionWebSocket` to `NEXT_PUBLIC_GATEWAY_WS_URL`, (3) renders incoming suggestions via `SessionPanel`. On "End session" it sends `end_session` and closes the socket. Audio frames are **not** forwarded yet — that's Phase 3.

**Files:**
- Modify: `services/web/src/app/page.tsx`

- [ ] **Step 17.1: Replace `services/web/src/app/page.tsx`**

```tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { SessionPanel, type RenderedSuggestion, type SessionStatus } from "@/components/SessionPanel";
import { captureMeetingTabAudio, AudioCaptureError } from "@/lib/audioCapture";
import { SessionWebSocket } from "@/lib/wsClient";
import type { ServerMessage } from "@/lib/protocol";

const GATEWAY_URL =
  process.env.NEXT_PUBLIC_GATEWAY_WS_URL ?? "ws://localhost:8080/ws/session";

export default function HomePage() {
  const [status, setStatus] = useState<SessionStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);
  const [suggestions, setSuggestions] = useState<RenderedSuggestion[]>([]);

  const wsRef = useRef<SessionWebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const cleanup = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close("cleanup");
      wsRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  const handleServerMessage = useCallback((msg: ServerMessage) => {
    if (msg.type === "session_started") {
      setStatus("active");
      return;
    }
    if (msg.type === "suggestion") {
      setSuggestions((prev) => [
        ...prev,
        {
          id: `${msg.tickAtMs}-${prev.length}`,
          intent: msg.intent,
          suggestion: msg.suggestion,
          sentiment: msg.sentiment,
        },
      ]);
      return;
    }
    if (msg.type === "error") {
      setErrorMessage(`${msg.code}: ${msg.message}`);
      return;
    }
  }, []);

  const handleStart = useCallback(async () => {
    setErrorMessage(undefined);
    setSuggestions([]);
    setStatus("connecting");

    try {
      streamRef.current = await captureMeetingTabAudio();
    } catch (err) {
      if (err instanceof AudioCaptureError) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage((err as Error).message);
      }
      setStatus("error");
      return;
    }

    const ws = new SessionWebSocket({
      url: GATEWAY_URL,
      onOpen: () => {
        ws.sendClientHello("0.1.0");
      },
      onMessage: handleServerMessage,
      onClose: () => {
        cleanup();
        setStatus((prev) => (prev === "error" ? "error" : "ended"));
      },
      onError: () => {
        setErrorMessage("WebSocket error. Is the gateway running?");
        setStatus("error");
        cleanup();
      },
    });
    wsRef.current = ws;
    ws.connect();
  }, [cleanup, handleServerMessage]);

  const handleEnd = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.sendEndSession("user_clicked_end");
    }
    cleanup();
    setStatus("ended");
  }, [cleanup]);

  return (
    <main className="min-h-screen">
      <SessionPanel
        status={status}
        suggestions={suggestions}
        onStart={handleStart}
        onEnd={handleEnd}
        errorMessage={errorMessage}
      />
    </main>
  );
}
```

- [ ] **Step 17.2: Run lint + build + tests**

```bash
cd services/web
npm run lint
npm test
npm run build
```

Expected: all three exit clean. If lint complains about `@/` imports, make sure `tsconfig.json` has the `paths` block from Task 4.

- [ ] **Step 17.3: Commit**

```bash
git add services/web/src/app/page.tsx
git commit -m "feat(web): wire HomePage to gateway via SessionWebSocket + tab capture"
```

---

### Task 18: End-to-end smoke test via docker-compose

No automation for this task — it's a manual smoke test that proves the whole pipeline works. Document the steps in the README (Task 19) so future developers can repeat it.

**Files:** none

- [ ] **Step 18.1: Bring the full stack up**

```bash
cd /Users/cultistsid/projects/sales-copilot
docker compose down -v 2>/dev/null || true
docker compose up --build
```

Leave this running in the foreground so you see logs from both services.

- [ ] **Step 18.2: Open the app**

In a browser, open http://localhost:3000. You should see the Sales Copilot page with a big green "Start session" button and "status: idle".

- [ ] **Step 18.3: Open a second tab you can share**

Open http://example.com (or any tab; it won't actually be read). You need something to share in the `getDisplayMedia` picker.

- [ ] **Step 18.4: Click Start session**

A browser prompt appears: choose "Chrome Tab", pick the example.com tab, **check the "Share tab audio" box**, click Share.

Expected:
- Status flips to `connecting`, then to `active` within ~1 second
- Within ~5 seconds, a suggestion card appears in the list
- Suggestions keep appearing every ~5 seconds
- Gateway logs in the terminal show `session_open session_id=sess_...`

- [ ] **Step 18.5: Click End session**

Expected:
- Status flips to `ended`
- No more suggestions arrive
- Gateway logs show `end_session reason=user_clicked_end` followed by `session_close`

- [ ] **Step 18.6: Verify the failure path — deny tab share**

Click Start session again. When the picker appears, click Cancel.

Expected:
- Red error banner appears: "Tab capture was denied. Click Start again and share the meeting tab with audio."
- Status is `error`
- No WebSocket connection opened (no new session_open line in the gateway logs)

- [ ] **Step 18.7: Shut down**

```bash
# Ctrl+C in the docker compose terminal, then:
docker compose down
```

No commit for this task — it's verification only.

---

### Task 19: README developer docs

Finalize the README with setup, run, test, and smoke-test instructions so the next person can get running in under 10 minutes.

**Files:**
- Modify: `README.md`

- [ ] **Step 19.1: Replace `README.md`**

```markdown
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

- **Phase 1 (this phase):** skeleton end-to-end, canned suggestions, local only ✅
- **Phase 2:** Identity Platform auth, short-lived WS tokens
- **Phase 3:** Real Chirp 2 Speech-to-Text with diarization
- **Phase 4:** Real Gemini 2.5 Flash suggestions with context caching
- **Phase 5:** Firestore + GCS persistence, 30-day lifecycle
- **Phase 6:** Cloud Run deployment, observability, failure handling, SLOs

Each phase is its own plan document in `docs/superpowers/plans/`.
```

- [ ] **Step 19.2: Commit**

```bash
git add README.md
git commit -m "docs: Phase 1 README with setup, run, and smoke-test instructions"
```

---

## Roadmap — Future Phases (not part of this plan)

Each phase below will have its own plan document authored at the start of that phase, using this same skill.

### Phase 2: Identity Platform auth + WS tokens

**Goal:** only authenticated users can open a session; WebSocket connections require a short-lived signed JWT.

Scope:
- Enable Identity Platform in a GCP project
- Add Firebase Auth client SDK to `services/web`, build `/login` and `/logout` pages
- Add `/api/session-token` route in `services/web` that mints a 10-minute JWT signed with a key from Secret Manager
- Gateway: validate JWT on `/ws/session` connect, reject with `1008` on mismatch
- Tests: token mint, token validation, expiry, signature tampering

### Phase 3: Real STT with Chirp 2

**Goal:** live transcripts replace canned data; rep sees a running transcript pane alongside suggestions.

Scope:
- Enable Speech-to-Text V2 API on the GCP project
- Define an abstract `Transcriber` interface in the gateway (the migration seam from the spec)
- Implement `ChirpTranscriber` using `google-cloud-speech` streaming
- Encode audio frames from the browser as Opus and forward them over WS binary frames
- Gateway: forward audio → Chirp → yield transcript deltas → forward to client and stash in a rolling buffer
- Web: transcript pane rendered next to SessionPanel
- Tests: mocked Chirp client unit tests + optional integration test gated on a `GCP_PROJECT` env var

### Phase 4: Real Gemini 2.5 Flash suggestions with context caching

**Goal:** replace canned suggestions with live Gemini output built from the transcript window + running summary.

Scope:
- Enable Vertex AI on the GCP project
- Create cached content (system header) at session start using Vertex context caching
- Build the per-tick prompt: rolling 60s transcript + running summary + latest utterances
- Stream suggestions from Gemini, parse JSON incrementally, forward to client
- Regenerate running summary every 10 ticks
- Tests: mocked Vertex client unit tests + optional integration test
- Cost tracking metric computed at session end

### Phase 5: Firestore + GCS persistence

**Goal:** every session leaves a durable record, audio + transcripts deleted after 30 days.

Scope:
- Provision Firestore (native mode) in the GCP project
- Define security rules per the spec (only owner reads own sessions; writes gateway-only)
- Create GCS buckets with 30-day lifecycle policy via `gcloud` or Terraform
- Gateway: write session doc on start, append utterances/suggestions, finalize on end
- Gateway: GCS resumable upload for audio
- Tests: Firestore emulator + fake-gcs-server

### Phase 6: Cloud Run deployment + observability

**Goal:** production-ready deploy on `us-central1` with working dashboards and alerts.

Scope:
- Cloud Run service config: `web` (`min-instances=0`), `session-gateway` (`min-instances=1`, `concurrency=80`)
- Deploy scripts: `gcloud run deploy ...` or a lightweight Terraform module
- Structured JSON logging with correlation IDs across both services
- Cloud Monitoring metrics: `session_active_count`, `suggestion_latency_ms`, `stt_error_rate`, `gemini_error_rate`, `ws_disconnect_rate`, `cost_per_session_estimate`
- Retry logic for STT and Gemini transient failures
- Client WebSocket auto-reconnect before the Cloud Run 60-min hard limit
- Monitoring dashboard JSON committed to the repo
- Alert policies: cost anomaly + sustained error rate

---

## Self-Review Notes

Spec coverage (Phase 1 only): this plan delivers the "skeleton end-to-end with canned suggestions" milestone from the spec's non-goals section implicitly — it's the substrate for every other phase. It does NOT yet implement auth, STT, LLM, persistence, or Cloud Run deploy; those are explicitly deferred to later phases in the Roadmap section, and the spec's longer-term requirements (security rules, failure modes, SLOs, cost model) are scoped to the phase that actually introduces the relevant component.

Type consistency check: `Session.start()` / `Session.end()` are used consistently across tasks 10 and 12. `SuggestionMessage` fields are used consistently across protocol (task 8), suggestions (task 11), and the ws endpoint (task 12). `RenderedSuggestion` on the web side (task 14) is a different type from the wire-format `SuggestionMessage` — intentional, because the UI carries an extra `id` for React keys.

Placeholder scan: no TBDs, no "implement later", no unexplained references. Every code block that declares a function or type is immediately used in a later step.
