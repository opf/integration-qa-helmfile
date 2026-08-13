import { test, expect } from '@playwright/test';
import { createMcpClient, closeMcpClient } from '../../utils/mcp-client';
import { getAdminMcpAuth } from '../../utils/mcp-token';
import { squashTestCase } from '../../utils/squash-metadata';

const EXPECTED_TOOLS = [
  'current_user',
  'list_statuses',
  'list_types',
  'search_portfolios',
  'search_programs',
  'search_projects',
  'search_users',
  'search_versions',
  'search_work_packages',
];

test.describe('MCP Server Protocol Handshake & Discovery', { tag: ['@mcp'] }, () => {
  test(
    'Initialize MCP connection over Streamable HTTP',
    squashTestCase(3003, { stepCount: 2 }),
    async () => {
      await test.step('Initiate MCP client handshake', async () => {
        const client = await createMcpClient(getAdminMcpAuth());
        expect(client).toBeTruthy();
        
        await test.step('Close the MCP client session cleanly', async () => {
          await closeMcpClient(client);
        });
      });
    },
  );

  test(
    'tools/list returns available OpenProject MCP tools',
    squashTestCase(3004, { stepCount: 2 }),
    async () => {
      const client = await createMcpClient(getAdminMcpAuth());
      
      await test.step('Request tools list from MCP server', async () => {
        const response = await client.listTools();

        expect(response.tools).toBeDefined();
        expect(Array.isArray(response.tools)).toBe(true);

        const toolNames = response.tools.map((t) => t.name);

        await test.step('Verify that all expected tools are present', async () => {
          for (const expectedTool of EXPECTED_TOOLS) {
            expect(toolNames, `Expected tool '${expectedTool}' to be registered`).toContain(expectedTool);
          }
        });
      });

      await closeMcpClient(client);
    },
  );

  test(
    'resources/list returns available OpenProject resources',
    squashTestCase(3005, { stepCount: 2 }),
    async () => {
      const client = await createMcpClient(getAdminMcpAuth());
      
      await test.step('Request resources list from MCP server', async () => {
        const response = await client.listResources();

        await test.step('Assert the resources array is defined and contains registered resources', async () => {
          expect(response.resources).toBeDefined();
          expect(Array.isArray(response.resources)).toBe(true);
        });
      });
      
      await closeMcpClient(client);
    },
  );
});
