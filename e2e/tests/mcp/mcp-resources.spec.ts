import { test, expect } from '@playwright/test';
import { createMcpClient, closeMcpClient } from '../../utils/mcp-client';
import { getAdminMcpAuth } from '../../utils/mcp-token';
import { squashTestCase } from '../../utils/squash-metadata';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

test.describe('MCP Resource Reading & Discovery', { tag: ['@mcp'] }, () => {
  let client: Client;

  test.beforeAll(async () => {
    client = await createMcpClient(getAdminMcpAuth());
  });

  test.afterAll(async () => {
    if (client) await closeMcpClient(client);
  });

  test(
    'Read current_user resource via mcp://current_user',
    squashTestCase(3014, { stepCount: 2 }),
    async () => {
      let response: any;
      
      await test.step('Read resource mcp://current_user', async () => {
        response = await client.readResource({ uri: 'mcp://current_user' });
      });

      await test.step('Verify URI matches and text content is non-empty', async () => {
        expect(response.contents).toBeDefined();
        expect(response.contents.length).toBeGreaterThan(0);
        expect(response.contents[0].uri).toBe('mcp://current_user');
        expect(response.contents[0].text).toBeDefined();
      });
    },
  );

  test(
    'Read status_list resource via mcp://status_list',
    squashTestCase(3015, { stepCount: 2 }),
    async () => {
      let response: any;

      await test.step('Read resource mcp://status_list', async () => {
        response = await client.readResource({ uri: 'mcp://status_list' });
      });

      await test.step('Verify URI matches and contents array is non-empty', async () => {
        expect(response.contents).toBeDefined();
        expect(response.contents.length).toBeGreaterThan(0);
        expect(response.contents[0].uri).toBe('mcp://status_list');
      });
    },
  );

  test(
    'Read type_list resource via mcp://type_list',
    squashTestCase(3016, { stepCount: 2 }),
    async () => {
      let response: any;
      
      await test.step('Read resource mcp://type_list', async () => {
        response = await client.readResource({ uri: 'mcp://type_list' });
      });

      await test.step('Verify URI matches and contents array is non-empty', async () => {
        expect(response.contents).toBeDefined();
        expect(response.contents.length).toBeGreaterThan(0);
        expect(response.contents[0].uri).toBe('mcp://type_list');
      });
    },
  );
});
