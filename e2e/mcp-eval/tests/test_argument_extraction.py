from mcp_eval import task, Expect
from eval_config import configure
from expectations import (
    assert_path,
    assert_quality,
    rubric_argument_extraction,
)
from seed_data import MCP_USER

configure()

# ═══════════════════════════════════════════════════════════════════════
# Category 2: Argument Extraction
#
# Each test verifies:
#   1. The LLM selects the correct tool
#   2. The LLM extracts the correct arguments from natural language
#   3. The tool result is coherent with the extracted arguments
#   4. LLM judge + performance + path efficiency
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
        "prompt": f"Find user named {MCP_USER['firstname']}",
        "tool": "search_users",
        "expected_args": {"search_term": MCP_USER["firstname"]},
        # Bob_AI is provisioned by setup-mcp.rb
        "result_must_contain": [MCP_USER["firstname"], MCP_USER["lastname"]],
    },
    {
        "id": "AE-05",
        "prompt": "Search projects with identifier 'demo-project'",
        "tool": "search_projects",
        "expected_args": {"identifier": "demo-project"},
        # demo-project is seeded
        "result_must_contain": ["Demo project", "demo-project"],
    },
]

for case in ARGUMENT_CASES:
    @task(f"[{case['id']}] LLM extracts args for '{case['tool']}' from: \"{case['prompt']}\"")
    async def test_argument_extraction(agent, session, _case=case):
        response = await agent.generate_str(_case["prompt"])

        await session.assert_that(
            Expect.tools.was_called(_case["tool"]),
            name="tool_selected",
        )

        if _case["expected_args"]:
            await session.assert_that(
                Expect.tools.called_with(_case["tool"], _case["expected_args"]),
                name="args_extracted",
            )

        for expected in _case["result_must_contain"]:
            await session.assert_that(
                Expect.content.contains(expected),
                name=f"contains_{expected}",
                response=response,
            )

        await assert_path(session, tools=[_case["tool"]], allow_extra_steps=1)
        await assert_quality(
            session,
            response,
            category="argument_extraction",
            prompt=_case["prompt"],
            rubric=rubric_argument_extraction(
                _case["prompt"],
                _case["tool"],
                _case["expected_args"],
            ),
        )
