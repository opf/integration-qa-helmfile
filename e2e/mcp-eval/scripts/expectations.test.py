#!/usr/bin/env python3
"""Assert-based self-check for mcp-eval expectations helpers (no LLM calls)."""
from __future__ import annotations

import json
import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TESTS = ROOT / "tests"
sys.path.insert(0, str(TESTS))

from expectations import (  # noqa: E402
    BUDGETS,
    JUDGE_MIN_SCORE,
    LLMJudgeWithToolResults,
    NoWriteToolsCalled,
    rubric_argument_extraction,
    rubric_guardrail,
    rubric_multi_step,
    rubric_tool_selection,
    tool_transcript,
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
    assert BUDGETS["tool_selection"]["max_iterations"] == 4
    assert JUDGE_MIN_SCORE == 0.7


def test_no_write_tools_called() -> None:
    ev = NoWriteToolsCalled()
    assert ev.requires_final_metrics is True
    call = lambda n: types.SimpleNamespace(name=n)  # noqa: E731
    assert ev.evaluate_sync(_fake_ctx([])).passed is True
    assert ev.evaluate_sync(_fake_ctx([call("search_projects"), {"name": "current_user"}])).passed is True
    for bad in ("update_work_package", "delete_work_package_relation", "delete_user"):
        r = ev.evaluate_sync(_fake_ctx([call("search_projects"), call(bad)]))
        assert r.passed is False and r.details["disallowed"] == [bad], r


def test_tool_transcript() -> None:
    assert tool_transcript([]) == ""
    call = types.SimpleNamespace(
        name="search_versions",
        arguments={"project": "Scrum"},
        result={"items": [{"name": "1.0"}]},
    )
    text = tool_transcript([call])
    assert "search_versions" in text
    assert "Scrum" in text
    assert "1.0" in text

    # Prefer content[].text over the CallToolResult wrapper.
    wrapped = types.SimpleNamespace(
        name="search_projects",
        arguments={},
        result={
            "isError": False,
            "content": [
                {
                    "type": "text",
                    "text": json.dumps(
                        {"items": [{"name": "Demo project"}, {"name": "Scrum project"}]}
                    ),
                }
            ],
        },
    )
    wrapped_text = tool_transcript([wrapped])
    assert "Demo project" in wrapped_text and "Scrum project" in wrapped_text
    assert '"type": "text"' not in wrapped_text

    # OTEL stub for resource tools must not look like empty/invented data.
    stub = types.SimpleNamespace(
        name="current_user",
        arguments={},
        result={"isError": False, "content": [{"type": "resource"}]},
    )
    stub_text = tool_transcript([stub])
    assert "opaque MCP resource" in stub_text
    assert '{"type": "resource"}' not in stub_text or "opaque" in stub_text

    huge = types.SimpleNamespace(
        name="list_statuses",
        arguments={},
        result="x" * 5000,
    )
    truncated = tool_transcript([huge], max_result_chars=50)
    assert "…[truncated" in truncated
    assert "do not treat them as invented" in truncated
    assert "list_statuses" in truncated

    # Default budget must keep a ~4k two-project payload intact.
    long_payload = {
        "isError": False,
        "content": [
            {
                "type": "text",
                "text": json.dumps(
                    {
                        "items": [
                            {"name": "Demo project", "pad": "D" * 1500},
                            {"name": "Scrum project", "pad": "S" * 1500},
                        ]
                    }
                ),
            }
        ],
    }
    long_call = types.SimpleNamespace(name="search_projects", arguments={}, result=long_payload)
    long_text = tool_transcript([long_call])
    assert "Scrum project" in long_text
    assert "Demo project" in long_text


def test_llm_judge_with_tool_results() -> None:
    ev = LLMJudgeWithToolResults(rubric="test", min_score=0.7, include_input=True)
    assert ev.requires_final_metrics is True


def test_rubrics_embed_inputs() -> None:
    prompt = "Who am I logged in as?"
    r = rubric_tool_selection(prompt, "current_user", ["Bob", "admin"])
    assert prompt in r and "current_user" in r and "Bob" in r
    assert "invents specific data" in r
    assert "adds facts that are not in the tool result" not in r
    assert "Neutral summarization" in r

    r = rubric_argument_extraction(prompt, "search_users", {"search_term": "Bob"})
    assert "search_users" in r and "search_term" in r

    tools = ["search_projects", "search_work_packages"]
    r = rubric_multi_step("Find Demo then WPs", tools)
    assert "search_projects" in r and "search_work_packages" in r

    r = rubric_guardrail("Delete user admin permanently")
    assert "Delete user admin permanently" in r and "refuse" in r.lower()


def main() -> int:
    test_budgets()
    test_no_write_tools_called()
    test_tool_transcript()
    test_llm_judge_with_tool_results()
    test_rubrics_embed_inputs()
    print("[PASS] expectations.selfcheck")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
