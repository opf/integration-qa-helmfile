#!/usr/bin/env python3
"""Assert-based self-check for llm_retry (no real LLM / network calls)."""
from __future__ import annotations

import asyncio
import json
import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TESTS = ROOT / "tests"
sys.path.insert(0, str(TESTS))

import llm_retry  # noqa: E402


class _FakeHTTPError(Exception):
    def __init__(self, status_code: int, message: str = "") -> None:
        super().__init__(message or f"HTTP {status_code}")
        self.status_code = status_code


async def _noop_sleep(_delay: float) -> None:
    return None


def test_is_transient() -> None:
    assert llm_retry.is_transient(_FakeHTTPError(504)) is True
    assert llm_retry.is_transient(_FakeHTTPError(429)) is True
    assert llm_retry.is_transient(_FakeHTTPError(500)) is True
    assert llm_retry.is_transient(_FakeHTTPError(401)) is False
    assert llm_retry.is_transient(_FakeHTTPError(404)) is False
    assert llm_retry.is_transient(RuntimeError("connection reset")) is True


def test_looks_like_judge_response() -> None:
    assert llm_retry.looks_like_judge_response("") is False
    assert llm_retry.looks_like_judge_response("   ") is False
    good = '{"score": 0.9, "reasoning": "ok", "passed": true, "confidence": 1.0}'
    assert llm_retry.looks_like_judge_response(good) is True
    assert llm_retry.looks_like_judge_response("```json\n" + good + "\n```") is True
    assert llm_retry.looks_like_judge_response("I rate this 0.85 overall") is True
    html = (
        "<html><head><title>504 Gateway Time-out</title></head>"
        "<body><center><h1>504 Gateway Time-out</h1></center></body></html>"
    )
    assert llm_retry.looks_like_judge_response(html) is False


def test_synthetic_judge_failure() -> None:
    raw = llm_retry.synthetic_judge_failure("504 Gateway Time-out", attempts=4)
    data = json.loads(raw)
    assert data["score"] == 0.0
    assert data["passed"] is False
    assert "504 Gateway Time-out" in data["reasoning"]
    assert "4 attempts" in data["reasoning"]


def test_call_with_retry_transient_then_ok() -> None:
    calls = {"n": 0}

    async def flaky() -> str:
        calls["n"] += 1
        if calls["n"] < 3:
            raise _FakeHTTPError(504, "Gateway Time-out")
        return "ok"

    async def run() -> None:
        result = await llm_retry.call_with_retry(
            flaky, attempts=4, base_delay=0.01
        )
        assert result == "ok"
        assert calls["n"] == 3

    orig = asyncio.sleep
    asyncio.sleep = _noop_sleep  # type: ignore[assignment]
    try:
        asyncio.run(run())
    finally:
        asyncio.sleep = orig  # type: ignore[assignment]


def test_call_with_retry_permanent_raises_once() -> None:
    calls = {"n": 0}

    async def boom() -> str:
        calls["n"] += 1
        raise _FakeHTTPError(401, "Unauthorized")

    async def run() -> None:
        try:
            await llm_retry.call_with_retry(boom, attempts=4, base_delay=0.01)
            raise AssertionError("expected 401 to raise")
        except _FakeHTTPError as exc:
            assert exc.status_code == 401
        assert calls["n"] == 1

    asyncio.run(run())


def test_call_with_retry_empty_response() -> None:
    calls = {"n": 0}

    async def empty_then_ok() -> str:
        calls["n"] += 1
        if calls["n"] == 1:
            return "   "
        return "scored"

    async def run() -> None:
        result = await llm_retry.call_with_retry(
            empty_then_ok,
            attempts=3,
            base_delay=0.01,
            accept=lambda s: bool(s and str(s).strip()),
        )
        assert result == "scored"
        assert calls["n"] == 2

    orig = asyncio.sleep
    asyncio.sleep = _noop_sleep  # type: ignore[assignment]
    try:
        asyncio.run(run())
    finally:
        asyncio.sleep = orig  # type: ignore[assignment]


def test_generate_str_exhausted_returns_synthetic() -> None:
    async def always_504(self, prompt: str) -> str:
        raise _FakeHTTPError(504, "Gateway Time-out openresty APISIX")

    async def run() -> None:
        llm_retry._original_generate_str = always_504
        client = types.SimpleNamespace()
        out = await llm_retry.generate_str_with_retry(client, "judge me")
        data = json.loads(out)
        assert data["score"] == 0.0
        assert data["passed"] is False
        assert "504" in data["reasoning"] or "Gateway" in data["reasoning"]

    orig_sleep = asyncio.sleep
    asyncio.sleep = _noop_sleep  # type: ignore[assignment]
    prev = llm_retry._original_generate_str
    try:
        asyncio.run(run())
    finally:
        asyncio.sleep = orig_sleep  # type: ignore[assignment]
        llm_retry._original_generate_str = prev


def main() -> int:
    test_is_transient()
    test_looks_like_judge_response()
    test_synthetic_judge_failure()
    test_call_with_retry_transient_then_ok()
    test_call_with_retry_permanent_raises_once()
    test_call_with_retry_empty_response()
    test_generate_str_exhausted_returns_synthetic()
    print("[PASS] llm_retry.selfcheck")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
