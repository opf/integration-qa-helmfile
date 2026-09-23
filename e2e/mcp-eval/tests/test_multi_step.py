import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from mcp_eval import task, Expect
from eval_config import configure
from expectations import (
    assert_path,
    assert_quality,
    rubric_multi_step,
)
configure()

# ═══════════════════════════════════════════════════════════════════════
# Category 3: Multi-Step Workflows
#
# Each test verifies:
#   1. The LLM chains the correct sequence of tool calls
#   2. Each intermediate result feeds into the next step
#   3. The final result contains expected seed data
#   4. LLM judge + performance + path efficiency
# ═══════════════════════════════════════════════════════════════════════

MULTI_STEP_CASES = [
    {
        "id": "MS-01",
        "prompt": (
            "Find the Demo project, then list its work packages"
        ),
        "tools": ["search_projects", "search_work_packages"],
        # WPs from the demo-project seed should appear
        "result_must_contain": ["conference"],
    },
    {
        "id": "MS-04",
        "prompt": (
            "Look up all Bug types, then find bugs in the Scrum project"
        ),
        "tools": ["list_types", "search_work_packages"],
        # Scrum project has seeded bugs: "Password reset does not send email", "Wrong hover color"
        "result_must_contain": ["Bug"],
    },
]

for case in MULTI_STEP_CASES:
    async def test_multi_step(agent, session, _case=case):
        response = await agent.generate_str(_case["prompt"])

        for tool in _case["tools"]:
            await session.assert_that(
                Expect.tools.was_called(tool),
                name=f"called_{tool}",
            )

        await session.assert_that(
            Expect.tools.sequence(_case["tools"], allow_other_calls=True),
            name="tool_sequence",
        )

        for expected in _case["result_must_contain"]:
            await session.assert_that(
                Expect.content.contains(expected),
                name=f"contains_{expected}",
                response=response,
            )

        await assert_path(
            session,
            tools=_case["tools"],
            allow_extra_steps=2,
        )
        await assert_quality(
            session,
            response,
            category="multi_step",
            prompt=_case["prompt"],
            rubric=rubric_multi_step(_case["prompt"], _case["tools"]),
        )

    _name = f"test_multi_step_{case['id'].replace('-', '_').lower()}"
    test_multi_step.__name__ = _name
    globals()[_name] = task(
        f"[{case['id']}] Multi-step chain: {', '.join(case['tools'])}"
    )(test_multi_step)

del test_multi_step
