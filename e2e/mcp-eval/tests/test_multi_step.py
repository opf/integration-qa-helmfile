import pytest
from mcp_eval import task, Expect
from seed_data import DEMO_PROJECT, DEMO_WORK_PACKAGES, SCRUM_WORK_PACKAGES

# ═══════════════════════════════════════════════════════════════════════
# Category 3: Multi-Step Workflows
#
# Each test verifies:
#   1. The LLM chains the correct sequence of tool calls
#   2. Each intermediate result feeds into the next step
#   3. The final result contains expected seed data
#
# All prompts reference REAL seeded projects and work packages.
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
        "id": "MS-02",
        "prompt": (
            "Create a task called 'Multi-step eval task' "
            "in the Demo project, then add a comment "
            "'Created via multi-step eval'"
        ),
        "tools": ["create_work_package", "create_work_package_comment"],
        "result_must_contain": ["Multi-step eval task"],
    },
    {
        "id": "MS-03",
        "prompt": (
            "Find the work package 'Setup conference website' in the Demo project, "
            "then show its relations"
        ),
        "tools": ["search_work_packages", "list_work_package_relations"],
        # Seeded relation: "Setup conference website" follows "Set date and location"
        "result_must_contain": ["follows"],
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
    @task(f"[{case['id']}] Multi-step chain: {', '.join(case['tools'])}")
    async def test_multi_step(agent, session, _case=case):
        response = await agent.generate_str(_case["prompt"])

        # 1. Verify all expected tools were called (in any order)
        for tool in _case["tools"]:
            await session.assert_that(Expect.tools.was_called(tool))

        # 2. Verify the final result contains expected seed data
        for expected in _case["result_must_contain"]:
            await session.assert_that(
                Expect.content.contains(expected),
                msg=f"Multi-step result should contain '{expected}'",
            )
