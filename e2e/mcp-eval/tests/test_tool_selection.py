import pytest
from mcp_eval import task, Expect
from seed_data import (
    BRIAN_USER, DEMO_PROJECT, SCRUM_PROJECT,
    TYPES, STATUSES, SEEDED_USERS, SCRUM_VERSIONS,
    DEMO_WORK_PACKAGES, SCRUM_WORK_PACKAGES,
)

# ═══════════════════════════════════════════════════════════════════════
# Category 1: Single-Turn Tool Selection Accuracy
#
# Each test verifies:
#   1. The LLM selects the CORRECT tool (tool selection)
#   2. The tool call RETURNS data matching the seed data (result verification)
# ═══════════════════════════════════════════════════════════════════════

TOOL_SELECTION_CASES = [
    # ── current_user ──────────────────────────────────────────────────
    {
        "id": "TS-01",
        "prompt": "Who am I logged in as?",
        "tool": "current_user",
        "result_must_contain": ["Brian", "brian@example.net"],
        "result_must_not_contain": [],
    },
    {
        "id": "TS-02",
        "prompt": "What is my user profile?",
        "tool": "current_user",
        "result_must_contain": ["Brian", "QA", "admin"],
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
        "id": "TS-09",
        "prompt": "Find work packages related to conference",
        "tool": "search_work_packages",
        "result_must_contain": ["conference"],
        "result_must_not_contain": [],
    },
    {
        "id": "TS-10",
        "prompt": "List all open bugs",
        "tool": "search_work_packages",
        "result_must_contain": ["Bug"],
        "result_must_not_contain": [],
    },

    # ── search_users (seeded demo users) ──────────────────────────────
    {
        "id": "TS-11",
        "prompt": "Find user Brian in the system",
        "tool": "search_users",
        "result_must_contain": ["Brian", "QA"],
        "result_must_not_contain": [],
    },
    {
        "id": "TS-12",
        "prompt": "Who are the team members?",
        "tool": "search_users",
        "result_must_contain": ["Marko", "Wanda"],
        "result_must_not_contain": [],
    },

    # ── search_versions (seeded scrum versions) ───────────────────────
    {
        "id": "TS-13",
        "prompt": "What release versions are planned in the Scrum project?",
        "tool": "search_versions",
        "result_must_contain": ["Sprint 1"],
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

    # ── search_custom_fields (no seeded custom field definitions) ─────
    {
        "id": "TS-16",
        "prompt": "What custom fields are defined?",
        "tool": "search_custom_fields",
        "result_must_contain": [],
        "result_must_not_contain": [],
    },

    # ── create_work_package (verify the created WP) ──────────────────
    {
        "id": "TS-18",
        "prompt": (
            "Create a new Task work package titled "
            "'MCP Eval Smoke Test' in the Demo project"
        ),
        "tool": "create_work_package",
        "result_must_contain": ["MCP Eval Smoke Test"],
        "result_must_not_contain": ["error"],
    },

    # ── update_work_package ──────────────────────────────────────────
    # Uses the first seeded WP ID—the LLM must identify it from context
    {
        "id": "TS-19",
        "prompt": (
            "Find the work package titled 'Setup conference website' "
            "and update its subject to 'Setup conference website - Updated'"
        ),
        "tool": "update_work_package",
        # The update response should echo the new subject
        "result_must_contain": ["Updated"],
        "result_must_not_contain": ["error"],
    },

    # ── create_work_package_comment ──────────────────────────────────
    {
        "id": "TS-20",
        "prompt": (
            "Find work package 'Organize open source conference' "
            "and add a comment saying 'MCP eval test comment'"
        ),
        "tool": "create_work_package_comment",
        "result_must_contain": ["comment"],
        "result_must_not_contain": ["error"],
    },

    # ── list_work_package_comments ───────────────────────────────────
    {
        "id": "TS-21",
        "prompt": "Show me all comments on the work package 'Organize open source conference'",
        "tool": "list_work_package_comments",
        "result_must_contain": [],
        "result_must_not_contain": ["error"],
    },

    # ── create_work_package_relation ─────────────────────────────────
    {
        "id": "TS-22",
        "prompt": (
            "Create a 'relates' relation between "
            "'Contact sponsoring partners' and 'Create sponsorship brochure and hand-outs'"
        ),
        "tool": "create_work_package_relation",
        "result_must_contain": ["relates"],
        "result_must_not_contain": ["error"],
    },

    # ── list_work_package_relations ──────────────────────────────────
    {
        "id": "TS-23",
        "prompt": "What relations does 'Setup conference website' have?",
        "tool": "list_work_package_relations",
        # Seed data has a 'follows' relation for this WP
        "result_must_contain": ["follows"],
        "result_must_not_contain": ["error"],
    },
]

for case in TOOL_SELECTION_CASES:
    @task(f"[{case['id']}] LLM selects '{case['tool']}' for: \"{case['prompt']}\"")
    async def test_tool_selection(agent, session, _case=case):
        response = await agent.generate_str(_case["prompt"])

        # 1. Verify the correct tool was selected
        await session.assert_that(Expect.tools.was_called(_case["tool"]))

        # 2. Verify result content contains expected seed data
        for expected in _case["result_must_contain"]:
            await session.assert_that(
                Expect.content.contains(expected),
                msg=f"Result should contain '{expected}' from seed data",
            )

        # 3. Verify result does NOT contain forbidden strings
        for forbidden in _case["result_must_not_contain"]:
            await session.assert_that(
                Expect.content.not_contains(forbidden),
                msg=f"Result should NOT contain '{forbidden}'",
            )
