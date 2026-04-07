"""FastAPI app entrypoint."""

from fastapi import FastAPI

from sales_copilot_gateway import __version__

app = FastAPI(title="sales-copilot-gateway", version=__version__)


@app.get("/health")
async def health() -> dict[str, str]:
    """Liveness probe for Docker / Cloud Run."""
    return {"status": "ok", "version": __version__}
