import { test, expect } from '@playwright/test';
import { testConfig } from '../../utils/config';
import { getDispatcher } from '../../utils/tls-dispatcher';
import { squashTestCase } from '../../utils/squash-metadata';

test.describe('MCP Authentication & Transport Contract', { tag: ['@mcp'] }, () => {
  const mcpEndpoint = process.env.OPENPROJECT_URL
    ? `${process.env.OPENPROJECT_URL}/mcp`
    : `https://${testConfig.openproject.host}/mcp`;

  test(
    'POST /mcp without Authorization header returns 401 Unauthenticated',
    squashTestCase(2169, { stepCount: 2 }),
    async () => {
      let response: Response;

      await test.step(
        'Send an HTTP POST request to /mcp with initialize JSON-RPC payload and no Authorization header',
        async () => {
          const dispatcher = getDispatcher();
          response = await fetch(mcpEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              method: 'initialize',
              params: {
                protocolVersion: '2025-03-26',
                capabilities: {},
                clientInfo: { name: 'unauthenticated-test', version: '1.0' },
              },
              id: 1,
            }),
            ...(dispatcher ? { dispatcher } : {}),
          });
        },
      );

      await test.step('Assert that the HTTP response status code is 401 Unauthorized', async () => {
        expect(response.status).toBe(401);
      });
    },
  );

  test(
    'POST /mcp with invalid Bearer token returns 401 Unauthenticated',
    squashTestCase(2170, { stepCount: 2 }),
    async () => {
      let response: Response;

      await test.step(
        'Send an HTTP POST request to /mcp with Authorization: Bearer invalid_token_12345',
        async () => {
          const dispatcher = getDispatcher();
          response = await fetch(mcpEndpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer invalid_token_12345',
            },
            body: JSON.stringify({
              jsonrpc: '2.0',
              method: 'initialize',
              params: {
                protocolVersion: '2025-03-26',
                capabilities: {},
                clientInfo: { name: 'invalid-auth-test', version: '1.0' },
              },
              id: 1,
            }),
            ...(dispatcher ? { dispatcher } : {}),
          });
        },
      );

      await test.step('Assert that the HTTP response status code is 401 Unauthorized', async () => {
        expect(response.status).toBe(401);
      });
    },
  );
});
