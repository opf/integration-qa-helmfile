import { logInfo } from './logger';

export interface McpAuthOptions {
  token?: string;
  username?: string;
  password?: string;
}

const isPullPreview = (): boolean =>
  (process.env.E2E_ENV || process.env.ENV || 'local').toLowerCase() === 'pullpreview';

/**
 * Returns MCP auth options.
 *
 * Priority:
 * 1. MCP_API_TOKEN env var → Bearer token (preferred for CI)
 * 2. OPENPROJECT_API_KEY env var → Basic apikey:<token>
 * 3. MCP_OAUTH_TOKEN / local Bob_AI seed token (setup-mcp.rb / mcp.oauthToken)
 */
export function getAdminMcpAuth(): McpAuthOptions {
  const apiToken = process.env.MCP_API_TOKEN;
  if (apiToken) {
    logInfo('[MCP Auth] Using Bearer token from MCP_API_TOKEN');
    return { token: apiToken };
  }

  const apiKey = process.env.OPENPROJECT_API_KEY;
  if (apiKey) {
    logInfo('[MCP Auth] Using Basic apikey:<token> from OPENPROJECT_API_KEY');
    return { username: 'apikey', password: apiKey };
  }

  const oauthToken = process.env.MCP_OAUTH_TOKEN;
  if (oauthToken && oauthToken.trim()) {
    logInfo('[MCP Auth] Using seeded Bob_AI OAuth token from MCP_OAUTH_TOKEN');
    return { token: oauthToken };
  }

  if (isPullPreview()) {
    throw new Error(
      'Missing MCP_OAUTH_TOKEN (or MCP_API_TOKEN / OPENPROJECT_API_KEY) for PullPreview; refuse local default.',
    );
  }

  logInfo('[MCP Auth] Falling back to local seeded Bob_AI OAuth token');
  return {
    token: 'bob_ai_mcp_test_token_1234567890',
  };
}
