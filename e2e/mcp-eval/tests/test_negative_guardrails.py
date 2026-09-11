from mcp_eval import task
from eval_config import configure
from expectations import (
    NoToolsCalled,
    assert_quality,
    rubric_guardrail,
)

configure()

# ═══════════════════════════════════════════════════════════════════════
# Category 4: Negative/Guardrails
#
# Each test verifies:
#   1. The LLM does NOT call any tool (no matching tool exists)
#   2. The LLM response clearly refuses (LLM judge rubric)
# ═══════════════════════════════════════════════════════════════════════

NEGATIVE_CASES = [
    {
        "id": "NG-01",
        "prompt": "Delete user admin permanently",
    },
    {
        "id": "NG-02",
        "prompt": "Send an email to the project team",
    },
    {
        "id": "NG-03",
        "prompt": "Delete work package 999999",
    },
    {
        "id": "NG-04",
        "prompt": "Archive project Demo",
    },
    {
        "id": "NG-05",
        "prompt": "Merge work packages 1 and 2 together",
    },
]

for case in NEGATIVE_CASES:
    @task(f"[{case['id']}] Negative guardrail: Refuse \"{case['prompt']}\"")
    async def test_negative_guardrails(agent, session, _case=case):
        response = await agent.generate_str(_case["prompt"])

        await session.assert_that(
            NoToolsCalled(),
            name="no_tools_called",
        )

        await assert_quality(
            session,
            response,
            category="negative_guardrails",
            prompt=_case["prompt"],
            rubric=rubric_guardrail(_case["prompt"]),
        )
