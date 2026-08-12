import pytest
from mcp_eval import task, Expect
from seed_data import (
    DEMO_PROJECT, SCRUM_PROJECT, BRIAN_USER,
    DEMO_WORK_PACKAGES, SCRUM_VERSIONS,
)

# ═══════════════════════════════════════════════════════════════════════
# Category 2: Argument Extraction
#
# Each test verifies:
#   1. The LLM selects the correct tool
#   2. The LLM extracts the correct arguments from natural language
#   3. The tool result is coherent with the extracted arguments
#
# All prompts reference REAL seeded entities so results are verifiable.
# ═══════════════════════════════════════════════════════════════════════

ARGUMENT_CASES = [
    {
        "id": "AE-01",
        "prompt": "Search for work packages with subject containing 'conference'",
        "tool": "search_work_packages",
        "expected_args": {"subject": "conference"},
        # "conference" appears in several seeded demo-project WPs
        "result_must_contain": ["conference"],
    },
    {
        "id": "AE-02",
        "prompt": "Find work packages assigned to Olga Ops",
        "tool": "search_work_packages",
        "expected_args": {},  # assigned_to resolved by name
        # Olga Ops is assigned "Set date and location of conference" + "Party"
        "result_must_contain": ["Olga"],
    },
    {
        "id": "AE-03",
        "prompt": "Get work packages on page 1",
        "tool": "search_work_packages",
        "expected_args": {"page": 1},
        # Page 1 should return some of the seeded WPs
        "result_must_contain": [],
    },
    {
        "id": "AE-04",
        "prompt": "Find user named Brian",
        "tool": "search_users",
        "expected_args": {"search_term": "Brian"},
        # Brian QA is provisioned by setup-mcp.rb
        "result_must_contain": ["Brian", "QA"],
    },
    {
        "id": "AE-05",
        "prompt": "Search projects with identifier 'demo-project'",
        "tool": "search_projects",
        "expected_args": {"identifier": "demo-project"},
        # demo-project is seeded
        "result_must_contain": ["Demo project", "demo-project"],
    },
    {
        "id": "AE-06",
        "prompt": (
            "Add a comment 'Argument extraction test' to work package "
            "'Organize open source conference'"
        ),
        "tool": "create_work_package_comment",
        "expected_args": {},  # WP ID resolved dynamically from name
        "result_must_contain": ["comment"],
    },
    {
        "id": "AE-07",
        "prompt": (
            "Create a 'blocks' relation from 'Contact sponsoring partners' "
            "to 'Invite attendees to conference'"
        ),
        "tool": "create_work_package_relation",
        "expected_args": {},  # WP IDs resolved dynamically
        "result_must_contain": ["blocks"],
    },
    {
        "id": "AE-08",
        "prompt": "List relations for the work package 'Setup conference website'",
        "tool": "list_work_package_relations",
        "expected_args": {},  # WP ID resolved dynamically
        # This WP has a seeded "follows" relation
        "result_must_contain": ["follows"],
    },
]

for case in ARGUMENT_CASES:
    @task(f"[{case['id']}] LLM extracts args for '{case['tool']}' from: \"{case['prompt']}\"")
    async def test_argument_extraction(agent, session, _case=case):
        response = await agent.generate_str(_case["prompt"])

        # 1. Verify correct tool was selected
        await session.assert_that(Expect.tools.was_called(_case["tool"]))

        # 2. Verify arguments were extracted correctly (where deterministic)
        if _case["expected_args"]:
            await session.assert_that(
                Expect.tools.was_called(_case["tool"]).with_args(_case["expected_args"])
            )

        # 3. Verify result content matches seed data
        for expected in _case["result_must_contain"]:
            await session.assert_that(
                Expect.content.contains(expected),
                msg=f"Result should contain '{expected}' from seed data",
            )
