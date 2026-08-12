import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { testConfig } from './config';
import { logInfo, logError } from './logger';
import { getErrorMessage } from './error-utils';
import { getDispatcher } from './tls-dispatcher';

export interface McpClientOptions {
  token?: string;
  username?: string;
  password?: string;
  baseUrl?: string;
}

export async function createMcpClient(options: McpClientOptions = {}): Promise<Client> {
  const host = testConfig.openproject.host;
  const baseUrl = options.baseUrl || (process.env.OPENPROJECT_URL ? process.env.OPENPROJECT_URL : `https://${host}`);
  const mcpUrl = new URL('/mcp/', baseUrl);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (options.token) {
    headers['Authorization'] = `Bearer ${options.token}`;
  } else if (options.username && options.password) {
    const auth = Buffer.from(`${options.username}:${options.password}`).toString('base64');
    headers['Authorization'] = `Basic ${auth}`;
  }

  const customFetch: typeof fetch = async (url, init) => {
    const dispatcher = getDispatcher();
    return fetch(url, {
      ...init,
      ...(dispatcher ? { dispatcher } : {}),
    });
  };

  const transport = new StreamableHTTPClientTransport(mcpUrl, {
    requestInit: { headers },
    fetch: customFetch,
  });

  const client = new Client(
    { name: 'openproject-mcp-e2e-client', version: '1.0.0' },
    { capabilities: {} }
  );

  await client.connect(transport);
  logInfo(`[MCP Client] Connected to ${mcpUrl.toString()}`);
  return client;
}

export async function closeMcpClient(client: Client): Promise<void> {
  try {
    await client.close();
    logInfo('[MCP Client] Disconnected client');
  } catch (error: unknown) {
    logError('[MCP Client] Error closing client:', getErrorMessage(error));
  }
}
