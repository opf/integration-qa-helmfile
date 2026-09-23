import sys
from pathlib import Path

# mcp-eval loads this file by path and does not add tests/ to sys.path.
sys.path.insert(0, str(Path(__file__).resolve().parent))

from mcp_eval import task, Expect
from eval_config import configure
from expectations import (
    assert_path,
    assert_quality,
    rubric_tool_selection,
)
from seed_data import ADMIN_USER, MCP_USER

configure()

# ═══════════════════════════════════════════════════════════════════════
# Category 1: Single-Turn Tool Selection Accuracy
#
# Each test verifies:
#   1. The LLM selects the CORRECT tool (tool selection)
#   2. The tool call RETURNS data matching the seed data (result verification)
#   3. LLM judge + performance + path efficiency
# ═══════════════════════════════════════════════════════════════════════

TOOL_SELECTION_CASES = [
    # ── current_user ──────────────────────────────────────────────────
    {
        "id": "TS-01",
        "prompt": "Who am I logged in as?",
        "tool": "current_user",
        "result_must_contain": [MCP_USER["firstname"], MCP_USER["email"]],
        "result_must_not_contain": [],
    },
    {
        "id": "TS-02",
        "prompt": "What is my user profile?",
        "tool": "current_user",
        "result_must_contain": [MCP_USER["firstname"], MCP_USER["lastname"], "admin"],
        "result_must_not_contain": [],
    },

    # ── list_statuses ─────────────────────────────────────────────────
    {
        "id": "TS-03",
        "prompt": "What statuses can a work package have?",
        "tool": "list_statuses",
        "result_must_contain": ["New", "In progress", "Closed", "Rejected"],
        "result_must_not_contain": [],
    },
    {
        "id": "TS-04",
        "prompt": "Show me all valid workflow states",
        "tool": "list_statuses",
        "result_must_contain": ["In specification", "Specified", "Confirmed"],
        "result_must_not_contain": [],
    },

    # ── list_types ────────────────────────────────────────────────────
    {
        "id": "TS-05",
        "prompt": "What types of work packages exist?",
        "tool": "list_types",
        "result_must_contain": ["Task", "Milestone", "Bug"],
        "result_must_not_contain": [],
    },
    {
        "id": "TS-06",
        "prompt": "Can I see the available task categories?",
        "tool": "list_types",
        "result_must_contain": ["Epic", "User story", "Feature"],
        "result_must_not_contain": [],
    },

    # ── search_projects ───────────────────────────────────────────────
    {
        "id": "TS-07",
        "prompt": "Show me all available projects",
        "tool": "search_projects",
        "result_must_contain": ["Demo project", "Scrum project"],
        "result_must_not_contain": [],
    },
    {
        "id": "TS-08",
        "prompt": "Find the project named Demo",
        "tool": "search_projects",
        "result_must_contain": ["Demo project", "demo-project"],
        "result_must_not_contain": [],
    },

    # ── search_work_packages (seeded demo WPs) ───────────────────────
    {
        "id": "TS-10",
        "prompt": "List all open bugs",
        "tool": "search_work_packages",
        "result_must_contain": ["Bug"],
        "result_must_not_contain": [],
    },

    # ── search_users (admin + Bob_AI) ─────────────────────────────────
    {
        "id": "TS-12",
        "prompt": "Who are the team members?",
        "tool": "search_users",
        "result_must_contain": [ADMIN_USER["lastname"], MCP_USER["firstname"]],
        "result_must_not_contain": [],
    },

    # ── search_versions (seeded scrum versions) ───────────────────────
    {
        "id": "TS-13",
        "prompt": "What release versions are planned in the Scrum project?",
        "tool": "search_versions",
        "result_must_contain": [],
        "result_must_not_contain": [],
    },

    # ── search_portfolios (no seeded portfolios) ─────────────────────
    {
        "id": "TS-14",
        "prompt": "Show me all portfolios",
        "tool": "search_portfolios",
        # Empty result is valid—there are no seeded portfolios
        "result_must_contain": [],
        "result_must_not_contain": [],
    },

    # ── search_programs (no seeded programs) ──────────────────────────
    {
        "id": "TS-15",
        "prompt": "List all programs in the organization",
        "tool": "search_programs",
        # Empty result is valid—there are no seeded programs
        "result_must_contain": [],
        "result_must_not_contain": [],
    },
]

for case in TOOL_SELECTION_CASES:
    # mcp-eval discovers tasks by function name; one shared name keeps only the last case.
    async def test_tool_selection(agent, session, _case=case):
        response = await agent.generate_str(_case["prompt"])

        await session.assert_that(
            Expect.tools.was_called(_case["tool"]),
            name="tool_selected",
        )

        for expected in _case["result_must_contain"]:
            await session.assert_that(
                Expect.content.contains(expected),
                name=f"contains_{expected}",
                response=response,
            )

        for forbidden in _case["result_must_not_contain"]:
            await session.assert_that(
                Expect.content.not_contains(forbidden),
                name=f"not_contains_{forbidden}",
                response=response,
            )

        await assert_path(session, tools=[_case["tool"]], allow_extra_steps=1)
        await assert_quality(
            session,
            response,
            category="tool_selection",
            prompt=_case["prompt"],
            rubric=rubric_tool_selection(
                _case["prompt"],
                _case["tool"],
                _case["result_must_contain"],
            ),
        )

    _name = f"test_tool_selection_{case['id'].replace('-', '_').lower()}"
    test_tool_selection.__name__ = _name
    globals()[_name] = task(
        f"[{case['id']}] LLM selects '{case['tool']}' for: \"{case['prompt']}\""
    )(test_tool_selection)

del test_tool_selection
