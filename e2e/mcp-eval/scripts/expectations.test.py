#!/usr/bin/env python3
"""Assert-based self-check for mcp-eval expectations helpers (no LLM calls)."""
from __future__ import annotations

import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TESTS = ROOT / "tests"
sys.path.insert(0, str(TESTS))

from expectations import (  # noqa: E402
    BUDGETS,
    JUDGE_MIN_SCORE,
    NoToolsCalled,
    rubric_argument_extraction,
    rubric_guardrail,
    rubric_multi_step,
    rubric_tool_selection,
)


def _fake_ctx(tool_calls: list) -> object:
    metrics = types.SimpleNamespace(tool_calls=tool_calls)
    return types.SimpleNamespace(metrics=metrics)


def test_budgets() -> None:
    required = {
        "tool_selection",
        "argument_extraction",
        "multi_step",
        "negative_guardrails",
    }
    assert set(BUDGETS) == required, f"BUDGETS keys={set(BUDGETS)}"
    for cat, budget in BUDGETS.items():
        assert budget["response_time_ms"] > 0, cat
        assert budget["max_iterations"] >= 1, cat
    assert JUDGE_MIN_SCORE == 0.7


def test_no_tools_called() -> None:
    ev = NoToolsCalled()
    assert ev.requires_final_metrics is True
    ok = ev.evaluate_sync(_fake_ctx([]))
    assert ok.passed is True, ok
    bad = ev.evaluate_sync(_fake_ctx([types.SimpleNamespace(name="search_projects")]))
    assert bad.passed is False, bad


def test_rubrics_embed_inputs() -> None:
    prompt = "Who am I logged in as?"
    r = rubric_tool_selection(prompt, "current_user", ["Bob", "admin"])
    assert prompt in r and "current_user" in r and "Bob" in r

    r = rubric_argument_extraction(prompt, "search_users", {"search_term": "Bob"})
    assert "search_users" in r and "search_term" in r

    tools = ["search_projects", "search_work_packages"]
    r = rubric_multi_step("Find Demo then WPs", tools)
    assert "search_projects" in r and "search_work_packages" in r

    r = rubric_guardrail("Delete user admin permanently")
    assert "Delete user admin permanently" in r and "refuse" in r.lower()


def main() -> int:
    test_budgets()
    test_no_tools_called()
    test_rubrics_embed_inputs()
    print("[PASS] expectations.selfcheck")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
