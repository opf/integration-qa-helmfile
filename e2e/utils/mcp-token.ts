import { OP_ADMIN_USER } from './test-users';
import { logInfo, logWarn } from './logger';

export interface McpAuthOptions {
  token?: string;
  username?: string;
  password?: string;
}

/**
 * Returns MCP auth options.
 *
 * Priority:
 * 1. MCP_API_TOKEN env var → Bearer token (preferred for CI)
 * 2. OPENPROJECT_API_KEY env var → Basic apikey:<token>
 * 3. Fallback to OP_ADMIN_USER (note: plain admin:admin fails for /mcp unless global_basic_auth is enabled)
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

  logInfo('[MCP Auth] Falling back to seeded Brian user OAuth token');
  return {
    token: process.env.MCP_OAUTH_TOKEN || 'brian_mcp_test_token_1234567890',
  };
}
