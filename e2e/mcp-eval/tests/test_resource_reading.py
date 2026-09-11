from mcp_eval import task, Expect
from eval_config import configure
from expectations import (
    assert_quality,
    rubric_resource,
)
from seed_data import MCP_USER

configure()

# ═══════════════════════════════════════════════════════════════════════
# Category 5: Resource Reading
#
# Each test verifies:
#   1. The LLM accesses the correct MCP resource URI
#   2. The resource content matches known seed data
#   3. LLM judge + performance (no path: resource reads ≠ tool calls)
# ═══════════════════════════════════════════════════════════════════════

RESOURCE_CASES = [
    {
        "id": "RR-01",
        "prompt": "Read my user profile from the MCP resource",
        "uri": "mcp://current_user",
        # Bob_AI is the authenticated user (setup-mcp.rb)
        "result_must_contain": [MCP_USER["firstname"], MCP_USER["email"], "admin"],
    },
    {
        "id": "RR-02",
        "prompt": "Get the list of statuses from the resource",
        "uri": "mcp://status_list",
        # Standard seed has 14 statuses
        "result_must_contain": ["New", "In progress", "Closed", "Rejected"],
    },
    {
        "id": "RR-03",
        "prompt": "Fetch the type list resource",
        "uri": "mcp://type_list",
        # Standard seed has 7 types
        "result_must_contain": ["Task", "Milestone", "Bug", "Epic"],
    },
]

for case in RESOURCE_CASES:
    @task(f"[{case['id']}] Resource reading: {case['uri']}")
    async def test_resource_reading(agent, session, _case=case):
        response = await agent.generate_str(_case["prompt"])

        for expected in _case["result_must_contain"]:
            await session.assert_that(
                Expect.content.contains(expected),
                name=f"contains_{expected}",
                response=response,
            )

        await assert_quality(
            session,
            response,
            category="resource_reading",
            prompt=_case["prompt"],
            rubric=rubric_resource(
                _case["prompt"],
                _case["uri"],
                _case["result_must_contain"],
            ),
        )
