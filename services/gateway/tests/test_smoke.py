"""Smoke test: package imports and version is set."""

from sales_copilot_gateway import __version__


def test_version_is_set() -> None:
    assert __version__ == "0.1.0"
