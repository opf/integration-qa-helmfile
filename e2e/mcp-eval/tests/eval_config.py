"""Apply per-run LLM / MCP env into mcp-eval settings.

mcp-eval loads mcpeval.yaml with plain yaml.safe_load (no ${VAR} expansion).
Call configure() once at import from each test module so TestSession clones
pick up the right model, credentials, and OpenProject MCP URL.
"""
from __future__ import annotations

import os
from urllib.parse import urljoin

_configured = False


def _mcp_url(openproject_url: str) -> str:
    base = openproject_url.rstrip("/") + "/"
    return urljoin(base, "mcp/")


def configure() -> None:
    """Idempotent: patch get_settings() and OPENAI_* env for the judge client."""
    global _configured
    if _configured:
        return

    from mcp_eval.config import get_settings

    settings = get_settings()

    api_key = (os.environ.get("LLM_API_KEY") or "").strip()
    base_url = (
        os.environ.get("LLM_BASE_URL") or "https://llm-stack.openproject-edge.eu/v1"
    ).strip()
    model = (os.environ.get("LLM_MODEL") or "qwen3.6-35b-a3b").strip()
    judge_raw = (os.environ.get("LLM_JUDGE_MODEL") or "").strip()
    if not judge_raw or judge_raw in {"same-as-agent", "provider-default"}:
        judge_model = model
    else:
        judge_model = judge_raw

    openproject_url = (
        os.environ.get("OPENPROJECT_URL") or "https://openproject.test"
    ).strip()
    bearer = (os.environ.get("MCP_BEARER_TOKEN") or "").strip()

    settings.provider = "openai"
    settings.model = model
    settings.judge.provider = "openai"
    settings.judge.model = judge_model

    if settings.openai is None:
        from mcp_agent.config import OpenAISettings

        settings.openai = OpenAISettings()
    settings.openai.api_key = api_key or settings.openai.api_key
    settings.openai.base_url = base_url
    settings.openai.default_model = model

    # Judge path: get_judge_client -> create_llm(context=None) may read
    # mcp-agent global Settings / OPENAI_* env rather than session settings.
    if api_key:
        os.environ.setdefault("OPENAI_API_KEY", api_key)
    os.environ.setdefault("OPENAI_BASE_URL", base_url)
    os.environ.setdefault("OPENAI_DEFAULT_MODEL", model)

    if settings.mcp is None or settings.mcp.servers is None:
        raise RuntimeError("mcpeval.yaml must define mcp.servers.openproject")
    server = settings.mcp.servers.get("openproject")
    if server is None:
        raise RuntimeError("mcpeval.yaml must define mcp.servers.openproject")
    server.url = _mcp_url(openproject_url)
    if bearer:
        server.headers = {
            **(server.headers or {}),
            "Authorization": f"Bearer {bearer}",
            "Content-Type": "application/json",
        }

    # Transient 504/empty judge responses: retry before failing the case.
    from llm_retry import install as install_llm_retry

    install_llm_retry()

    _configured = True
