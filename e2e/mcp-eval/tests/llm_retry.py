"""Retry transient LLM gateway errors for mcp-eval agent and judge calls.

Monkey-patches mcp-agent's OpenAI completion chokepoint and the judge
client so a single 504/empty/unparsable response does not permanently
fail a test case. After retries are exhausted the test still fails, but
with the real gateway error instead of "failed to parse".
"""
from __future__ import annotations

import asyncio
import json
import os
import random
import re
from collections.abc import Awaitable, Callable
from typing import TypeVar

TRANSIENT_STATUS_CODES = frozenset({408, 429, 500, 502, 503, 504})

T = TypeVar("T")

_installed = False
_original_execute_openai_request = None
_original_generate_str = None


def _env_int(name: str, default: int) -> int:
    raw = (os.environ.get(name) or "").strip()
    if not raw:
        return default
    try:
        return max(1, int(raw))
    except ValueError:
        return default


def _env_float(name: str, default: float) -> float:
    raw = (os.environ.get(name) or "").strip()
    if not raw:
        return default
    try:
        return max(0.0, float(raw))
    except ValueError:
        return default


def _status_code(exc: BaseException) -> int | None:
    for attr in ("status_code", "status"):
        value = getattr(exc, attr, None)
        if isinstance(value, int):
            return value
    response = getattr(exc, "response", None)
    if response is not None:
        value = getattr(response, "status_code", None)
        if isinstance(value, int):
            return value
    return None


def is_transient(exc: BaseException) -> bool:
    """True for gateway/timeout/connection failures; False for permanent 4xx."""
    status = _status_code(exc)
    if status is not None:
        return status in TRANSIENT_STATUS_CODES
    # No HTTP status: connection reset, timeout, DNS, empty body wrappers, etc.
    return True


def looks_like_judge_response(text: str) -> bool:
    """True when the judge body has parseable JSON or a 0–1 score."""
    if not text or not text.strip():
        return False
    # JSON object (optionally fenced)
    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    candidate = fenced.group(1) if fenced else None
    if candidate is None:
        obj = re.search(r"(\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\})", text, re.DOTALL)
        candidate = obj.group(1) if obj else text.strip()
    try:
        data = json.loads(candidate)
        if isinstance(data, dict) and "score" in data:
            return True
    except (json.JSONDecodeError, TypeError):
        pass
    if re.search(r"\b(0?\.\d+|1\.0|0\.0|1)\b", text):
        return True
    if re.search(r"\d+(?:\.\d+)?%", text):
        return True
    # Gateway HTML / openresty error pages
    lower = text.lower()
    if "gateway time-out" in lower or "504" in text[:200] or "<html" in lower:
        return False
    return False


def synthetic_judge_failure(error: str, *, attempts: int) -> str:
    """Valid judge JSON that always fails the min_score check, with the real error."""
    reasoning = f"LLM gateway error after {attempts} attempts: {error}"
    return json.dumps(
        {
            "score": 0.0,
            "reasoning": reasoning,
            "passed": False,
            "confidence": 0.0,
        }
    )


async def call_with_retry(
    make_call: Callable[[], Awaitable[T]],
    *,
    attempts: int | None = None,
    base_delay: float | None = None,
    accept: Callable[[T], bool] | None = None,
) -> T:
    """Retry *make_call* on transient errors / rejected responses.

    *accept*, when set, receives a successful return value; returning False
    raises RuntimeError("empty or unparsable LLM response") so the attempt
    is retried like a transient failure.
    """
    n = attempts if attempts is not None else _env_int("LLM_MAX_RETRIES", 4)
    delay_base = (
        base_delay
        if base_delay is not None
        else _env_float("LLM_RETRY_BASE_DELAY", 2.0)
    )
    last_error: BaseException | None = None

    for attempt in range(n):
        try:
            result = await make_call()
            if accept is not None and not accept(result):
                raise RuntimeError("empty or unparsable LLM response")
            return result
        except Exception as exc:
            last_error = exc
            if not is_transient(exc):
                raise
            if attempt == n - 1:
                raise
            delay = delay_base * (2**attempt) + random.uniform(0, 1)
            await asyncio.sleep(delay)

    assert last_error is not None
    raise last_error


async def generate_str_with_retry(self, prompt: str) -> str:
    """Judge generate_str wrapper: retry empty/unparsable; synthetic fail on exhaustion."""
    assert _original_generate_str is not None
    n = _env_int("LLM_MAX_RETRIES", 4)
    delay_base = _env_float("LLM_RETRY_BASE_DELAY", 2.0)
    last_error: BaseException | None = None

    for attempt in range(n):
        try:
            raw = await call_with_retry(
                lambda: _original_generate_str(self, prompt),
                attempts=2,
                base_delay=max(1.0, delay_base / 2),
            )
            if looks_like_judge_response(raw if isinstance(raw, str) else str(raw)):
                return raw if isinstance(raw, str) else str(raw)
            last_error = RuntimeError(
                f"unparsable judge response: {(raw or '')[:200]!r}"
            )
        except Exception as exc:
            last_error = exc
            # Permanent client errors: do not mask as a scored failure.
            if not is_transient(exc):
                raise

        if attempt == n - 1:
            break
        await asyncio.sleep(delay_base * (2**attempt) + random.uniform(0, 1))

    err = str(last_error) if last_error else "unknown LLM error"
    return synthetic_judge_failure(err, attempts=n)


async def _execute_openai_request_with_retry(client, payload):
    assert _original_execute_openai_request is not None
    return await call_with_retry(
        lambda: _original_execute_openai_request(client, payload)
    )


def install() -> None:
    """Idempotent: patch agent OpenAI requests and judge generate_str."""
    global _installed, _original_execute_openai_request, _original_generate_str
    if _installed:
        return

    from mcp_agent.workflows.llm import augmented_llm_openai
    from mcp_eval.llm_client import JudgeLLMClient

    _original_execute_openai_request = augmented_llm_openai._execute_openai_request
    augmented_llm_openai._execute_openai_request = _execute_openai_request_with_retry

    _original_generate_str = JudgeLLMClient.generate_str
    JudgeLLMClient.generate_str = generate_str_with_retry  # type: ignore[method-assign]

    _installed = True
