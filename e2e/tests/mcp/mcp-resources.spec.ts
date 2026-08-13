import { test, expect } from '@playwright/test';
import { createMcpClient, closeMcpClient } from '../../utils/mcp-client';
import { getAdminMcpAuth } from '../../utils/mcp-token';
import { squashTestCase } from '../../utils/squash-metadata';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

test.describe('MCP Resource Reading & Discovery', { tag: ['@mcp'] }, () => {
  let client: Client;
  let resources: Array<{ name: string; uri: string }>;

  test.beforeAll(async () => {
    client = await createMcpClient(getAdminMcpAuth());
    resources = (await client.listResources()).resources;
  });

  test.afterAll(async () => {
    if (client) await closeMcpClient(client);
  });

  function uriFor(name: string): string {
    const resource = resources.find((r) => r.name === name);
    expect(resource, `Expected resource '${name}' in resources/list`).toBeDefined();
    return resource!.uri;
  }

  test(
    'Read current_user resource via /api/v3/users/me',
    squashTestCase(3014, { stepCount: 2 }),
    async () => {
      const uri = uriFor('current_user');
      let response: Awaited<ReturnType<Client['readResource']>>;

      await test.step('Read resource listed as current_user', async () => {
        response = await client.readResource({ uri });
      });

      await test.step('Verify URI matches and text content is non-empty', async () => {
        expect(response.contents.length).toBeGreaterThan(0);
        expect(response.contents[0].uri).toBe(uri);
        expect(response.contents[0].text).toContain('Bob_AI');
      });
    },
  );

  test(
    'Read status_list resource via /api/v3/statuses',
    squashTestCase(3015, { stepCount: 2 }),
    async () => {
      const uri = uriFor('status_list');
      let response: Awaited<ReturnType<Client['readResource']>>;

      await test.step('Read resource listed as status_list', async () => {
        response = await client.readResource({ uri });
      });

      await test.step('Verify URI matches and contents array is non-empty', async () => {
        expect(response.contents.length).toBeGreaterThan(0);
        expect(response.contents[0].uri).toBe(uri);
        expect(response.contents[0].text).toContain('New');
      });
    },
  );

  test(
    'Read type_list resource via /api/v3/types',
    squashTestCase(3016, { stepCount: 2 }),
    async () => {
      const uri = uriFor('type_list');
      let response: Awaited<ReturnType<Client['readResource']>>;

      await test.step('Read resource listed as type_list', async () => {
        response = await client.readResource({ uri });
      });

      await test.step('Verify URI matches and contents array is non-empty', async () => {
        expect(response.contents.length).toBeGreaterThan(0);
        expect(response.contents[0].uri).toBe(uri);
        expect(response.contents[0].text).toContain('Task');
      });
    },
  );
});
