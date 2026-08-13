import { test, expect } from '@playwright/test';
import { createMcpClient, closeMcpClient } from '../../utils/mcp-client';
import { getAdminMcpAuth } from '../../utils/mcp-token';
import { squashTestCase } from '../../utils/squash-metadata';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

test.describe('MCP Tool Invocation & Integration', { tag: ['@mcp'] }, () => {
  let client: Client;

  test.beforeAll(async () => {
    client = await createMcpClient(getAdminMcpAuth());
  });

  test.afterAll(async () => {
    if (client) await closeMcpClient(client);
  });

  test(
    'current_user tool returns authenticated Bob_AI profile',
    squashTestCase(3006, { stepCount: 2 }),
    async () => {
      let result: any;
      await test.step('Call tool current_user with empty arguments', async () => {
        result = await client.callTool({
          name: 'current_user',
          arguments: {},
        });
      });

      await test.step('Inspect returned text content', async () => {
        expect(result.isError).toBeFalsy();
        expect(result.content).toBeDefined();

        const structured = result.structuredContent as { login?: string } | undefined;
        const blob = JSON.stringify(result);
        expect(structured?.login ?? blob).toContain('Bob_AI');
      });
    },
  );

  test(
    'search_projects tool lists projects',
    squashTestCase(3007, { stepCount: 2 }),
    async () => {
      let result: any;
      await test.step('Call tool search_projects with empty arguments', async () => {
        result = await client.callTool({
          name: 'search_projects',
          arguments: {},
        });
      });

      await test.step('Assert result flags and content payload', async () => {
        expect(result.isError).toBeFalsy();
        expect(result.content).toBeDefined();
      });
    },
  );

  test(
    'list_statuses tool returns work package statuses',
    squashTestCase(3008, { stepCount: 2 }),
    async () => {
      let result: any;
      await test.step('Call tool list_statuses with empty arguments', async () => {
        result = await client.callTool({
          name: 'list_statuses',
          arguments: {},
        });
      });

      await test.step('Assert result execution status', async () => {
        expect(result.isError).toBeFalsy();
      });
    },
  );

  test(
    'list_types tool returns work package types',
    squashTestCase(3009, { stepCount: 2 }),
    async () => {
      let result: any;
      await test.step('Call tool list_types with empty arguments', async () => {
        result = await client.callTool({
          name: 'list_types',
          arguments: {},
        });
      });

      await test.step('Assert result execution status', async () => {
        expect(result.isError).toBeFalsy();
      });
    },
  );

  test(
    'search_work_packages tool queries work packages by subject',
    squashTestCase(3010, { stepCount: 2 }),
    async () => {
      let result: any;
      await test.step('Call tool search_work_packages with { subject: "test" }', async () => {
        result = await client.callTool({
          name: 'search_work_packages',
          arguments: { subject: 'test' },
        });
      });

      await test.step('Assert result execution status', async () => {
        expect(result.isError).toBeFalsy();
      });
    },
  );

  test(
    'create_work_package and update_work_package lifecycle',
    squashTestCase(3011, { stepCount: 5 }),
    async () => {
      let projectId: number = 0;
      let typeId: number = 0;
      const testSubject = `Automated MCP WP ${Date.now()}`;
      let wpId: number = 0;

      await test.step('Call search_projects and list_types to obtain valid project_id and type_id', async () => {
        const projectsResult = await client.callTool({ name: 'search_projects', arguments: {} });
        const typesResult = await client.callTool({ name: 'list_types', arguments: {} });

        expect(projectsResult.isError).toBeFalsy();
        expect(typesResult.isError).toBeFalsy();

        const projectsText = (projectsResult.content as Array<{ text: string }>)[0]?.text || '';
        const typesText = (typesResult.content as Array<{ text: string }>)[0]?.text || '';

        const projectIdMatch = projectsText.match(/"id":\s*(\d+)/);
        const typeIdMatch = typesText.match(/"id":\s*(\d+)/);

        if (!projectIdMatch || !typeIdMatch) {
          test.skip(true, 'No seeded projects/types found to create work package');
          return;
        }

        projectId = parseInt(projectIdMatch[1], 10);
        typeId = parseInt(typeIdMatch[1], 10);
      });

      await test.step('Call create_work_package with subject', async () => {
        const createResult = await client.callTool({
          name: 'create_work_package',
          arguments: {
            project_id: projectId,
            type_id: typeId,
            subject: testSubject,
          },
        });

        expect(createResult.isError).toBeFalsy();
        const createText = (createResult.content as Array<{ text: string }>)[0]?.text || '';
        const wpIdMatch = createText.match(/"id":\s*(\d+)/);
        expect(wpIdMatch).toBeTruthy();

        wpId = parseInt(wpIdMatch![1], 10);
      });

      await test.step('Call update_work_package with the new WP ID and updated subject', async () => {
        const updateResult = await client.callTool({
          name: 'update_work_package',
          arguments: {
            id: wpId,
            subject: `${testSubject} - Updated`,
          },
        });

        expect(updateResult.isError).toBeFalsy();
      });

      let resourceResult: Awaited<ReturnType<Client['readResource']>>;
      await test.step('Read resource /api/v3/work_packages/{id}', async () => {
        const origin = new URL((await client.listResources()).resources[0].uri).origin;
        resourceResult = await client.readResource({
          uri: `${origin}/api/v3/work_packages/${wpId}`,
        });
      });

      await test.step('Verify resource text contains updated subject', async () => {
        expect(resourceResult.contents.length).toBeGreaterThan(0);
        expect(resourceResult.contents[0].text).toContain(`${testSubject} - Updated`);
      });
    },
  );

  test(
    'calling non-existent tool returns error structure without crashing',
    squashTestCase(3012, { stepCount: 2 }),
    async () => {
      let result: any;
      let caughtError: unknown;
      await test.step('Call client.callTool with { name: "non_existent_tool" }', async () => {
        try {
          result = await client.callTool({
            name: 'non_existent_tool',
            arguments: {},
          });
        } catch (err: unknown) {
          caughtError = err;
        }
      });

      await test.step('Assert error structure', async () => {
        if (caughtError) {
          expect(caughtError).toBeDefined();
        } else {
          expect(result.isError).toBe(true);
        }
      });
    },
  );

  test(
    'search_work_packages supports pagination parameter',
    squashTestCase(3013, { stepCount: 2 }),
    async () => {
      await test.step('Call search_work_packages with { page: 1 }', async () => {
        const page1Result = await client.callTool({
          name: 'search_work_packages',
          arguments: { page: 1 },
        });
        expect(page1Result.isError).toBeFalsy();
      });

      await test.step('Call search_work_packages with { page: 2 }', async () => {
        const page2Result = await client.callTool({
          name: 'search_work_packages',
          arguments: { page: 2 },
        });
        expect(page2Result.isError).toBeFalsy();
      });
    },
  );
});
