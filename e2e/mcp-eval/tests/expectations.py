"""Shared mcp-eval assertions: LLM judge, performance, path efficiency."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from mcp_eval import Expect
from mcp_eval.evaluators.base import SyncEvaluator, EvaluatorContext
from mcp_eval.evaluators.shared import EvaluatorResult

# ponytail: generous latency/iteration ceilings until 2–3 CI baselines exist;
# then tighten BUDGETS from reports/results.json p95 latency + iteration counts.
BUDGETS: dict[str, dict[str, float | int]] = {
    "tool_selection": {"response_time_ms": 60_000, "max_iterations": 3},
    "argument_extraction": {"response_time_ms": 60_000, "max_iterations": 3},
    "multi_step": {"response_time_ms": 120_000, "max_iterations": 6},
    "negative_guardrails": {"response_time_ms": 45_000, "max_iterations": 2},
    "resource_reading": {"response_time_ms": 60_000, "max_iterations": 3},
}

JUDGE_MIN_SCORE = 0.7


@dataclass
class NoToolsCalled(SyncEvaluator):
    """Pass when the agent made zero MCP tool calls (guardrail cases)."""

    requires_final_metrics: bool = True

    def evaluate_sync(self, ctx: EvaluatorContext) -> EvaluatorResult:
        calls = list(ctx.metrics.tool_calls or [])
        names = [getattr(c, "name", None) or (c.get("name") if isinstance(c, dict) else None) for c in calls]
        return EvaluatorResult(
            passed=len(calls) == 0,
            expected="0 tool calls",
            actual=f"{len(calls)} tool calls: {names}",
            details={"tool_calls": names},
        )


def rubric_tool_selection(prompt: str, tool: str, must_contain: list[str]) -> str:
    expected = ", ".join(must_contain) if must_contain else "(any coherent result)"
    return (
        f"The user asked: {prompt!r}. "
        f"The agent should select tool '{tool}' and answer using its result. "
        f"The response should reflect seed data including: {expected}. "
        "Score low if the wrong tool was used, the answer invents data, or it ignores the tool result."
    )


def rubric_argument_extraction(prompt: str, tool: str, expected_args: dict[str, Any]) -> str:
    args = f" with arguments approximately {expected_args}" if expected_args else ""
    return (
        f"The user asked: {prompt!r}. "
        f"The agent should call '{tool}'{args} and answer from the tool result. "
        "Score low if arguments are wrong, missing, or the answer does not match the tool output."
    )


def rubric_multi_step(prompt: str, tools: list[str]) -> str:
    chain = " → ".join(tools)
    return (
        f"The user asked: {prompt!r}. "
        f"The agent should chain tools in order ({chain}), "
        "feeding each step's result into the next. "
        "Score low if steps are skipped, reordered without reason, or intermediate results are ignored."
    )


def rubric_guardrail(prompt: str) -> str:
    return (
        f"The user asked: {prompt!r}. "
        "No matching MCP tool exists. The agent must refuse clearly, "
        "must not claim the action was performed, and must not invent a tool. "
        "Score low if it calls a tool, pretends success, or invents capabilities."
    )


def rubric_resource(prompt: str, uri: str, must_contain: list[str]) -> str:
    expected = ", ".join(must_contain)
    return (
        f"The user asked: {prompt!r} (resource {uri}). "
        f"The response should accurately reflect resource content including: {expected}. "
        "Score low if the answer is empty, invents fields, or contradicts the seed data."
    )


async def assert_quality(
    session,
    response: str,
    *,
    category: str,
    prompt: str,
    rubric: str,
    name_prefix: str = "quality",
) -> None:
    budget = BUDGETS[category]
    await session.assert_that(
        Expect.judge.llm(
            rubric,
            min_score=JUDGE_MIN_SCORE,
            include_input=True,
        ),
        name=f"{name_prefix}_llm_judge",
        response=response,
        inputs=prompt,
    )
    await session.assert_that(
        Expect.performance.response_time_under(float(budget["response_time_ms"])),
        name=f"{name_prefix}_response_time",
    )
    await session.assert_that(
        Expect.performance.max_iterations(int(budget["max_iterations"])),
        name=f"{name_prefix}_max_iterations",
    )


async def assert_path(
    session,
    *,
    tools: list[str],
    allow_extra_steps: int = 1,
    name_prefix: str = "path",
) -> None:
    limits = {t: 1 for t in tools}
    await session.assert_that(
        Expect.path.efficiency(
            expected_tool_sequence=tools,
            tool_usage_limits=limits,
            allow_extra_steps=allow_extra_steps,
            penalize_backtracking=True,
            penalize_repeated_tools=True,
        ),
        name=f"{name_prefix}_efficiency",
    )
    await session.assert_that(
        Expect.tools.success_rate(min_rate=1.0),
        name=f"{name_prefix}_tool_success",
    )
