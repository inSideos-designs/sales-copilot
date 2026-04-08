# syntax=docker/dockerfile:1.7
FROM python:3.12-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

# Install uv
RUN pip install --no-cache-dir uv==0.5.*

WORKDIR /app

# Phase 1: install third-party deps only (cacheable)
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

# Phase 2: install local package (invalidated only by src changes)
COPY src ./src
RUN uv sync --frozen --no-dev

ENV PATH="/app/.venv/bin:${PATH}"

EXPOSE 8080

CMD ["uvicorn", "sales_copilot_gateway.main:app", "--host", "0.0.0.0", "--port", "8080"]
