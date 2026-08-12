import { test, expect } from '@playwright/test';
import { createMcpClient, closeMcpClient } from '../../utils/mcp-client';
import { getAdminMcpAuth } from '../../utils/mcp-token';
import { evaluateToolChoice, ToolDefinition } from '../../utils/llm-evaluator';
import { squashTestCase } from '../../utils/squash-metadata';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

test.describe('MCP Layer 3: LLM Tool-Choice Evaluation', { tag: ['@mcp', '@llm'] }, () => {
  let client: Client;
  let tools: ToolDefinition[];

  // Skip entire suite if no LLM key — test.skip() inside beforeAll does NOT skip the suite
  test.skip(!process.env.LLM_STACK_API_KEY, 'LLM_STACK_API_KEY not configured');

  test.beforeAll(async () => {
    client = await createMcpClient(getAdminMcpAuth());
    const toolsResponse = await client.listTools();
    tools = toolsResponse.tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema as object,
    }));
  });

  test.afterAll(async () => {
    if (client) await closeMcpClient(client);
  });

  const TEST_CASES = [
    { squashId: 3017, prompt: 'Who am I logged in as?', expectedTool: 'current_user' },
    { squashId: 3018, prompt: 'Show me all available projects', expectedTool: 'search_projects' },
    { squashId: 3019, prompt: 'Find work packages related to bug fixes', expectedTool: 'search_work_packages' },
    { squashId: 3020, prompt: 'What types of work packages can I create?', expectedTool: 'list_types' },
    { squashId: 3021, prompt: 'List all valid statuses for a work package', expectedTool: 'list_statuses' },
  ];

  for (const { squashId, prompt, expectedTool } of TEST_CASES) {
    test(
      `Llama-3.3-70b selects '${expectedTool}' for: "${prompt}"`,
      squashTestCase(squashId, { stepCount: 3 }),
      async () => {
        await test.step('Fetch live MCP tool schemas via client.listTools()', async () => {
          expect(tools).toBeDefined();
          expect(tools.length).toBeGreaterThan(0);
        });

        let evalResult: any;
        await test.step(`Send prompt "${prompt}" + tool schemas to Llama-3.3-70b-instruct`, async () => {
          evalResult = await evaluateToolChoice(prompt, tools, expectedTool);
        });

        await test.step(`Assert LLM selected ${expectedTool} tool`, async () => {
          if (evalResult.skipped) {
            test.skip();
            return;
          }
          expect(evalResult.correct, evalResult.reasoning).toBe(true);
        });
      },
    );
  }
});
