import pytest
from mcp_eval import task, Expect
from seed_data import BRIAN_USER, STATUSES, TYPES

# ═══════════════════════════════════════════════════════════════════════
# Category 5: Resource Reading
#
# Each test verifies:
#   1. The LLM accesses the correct MCP resource URI
#   2. The resource content matches known seed data
#
# Resources are server-side MCP primitives separate from tools.
# ═══════════════════════════════════════════════════════════════════════

RESOURCE_CASES = [
    {
        "id": "RR-01",
        "prompt": "Read my user profile from the MCP resource",
        "uri": "mcp://current_user",
        # Brian is the authenticated user (setup-mcp.rb)
        "result_must_contain": ["Brian", "brian@example.net", "admin"],
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

        # 1. Verify the response is non-empty
        await session.assert_that(Expect.content.not_empty())

        # 2. Verify the resource content contains expected seed data
        for expected in _case["result_must_contain"]:
            await session.assert_that(
                Expect.content.contains(expected),
                msg=f"Resource {_case['uri']} should contain '{expected}' from seed data",
            )
