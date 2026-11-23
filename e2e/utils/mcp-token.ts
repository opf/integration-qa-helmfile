import { logInfo } from './logger';

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
 * 3. MCP_OAUTH_TOKEN (setup-mcp.rb / opnc-secrets mcp-oauth-token)
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

  throw new Error(
    'Missing MCP_OAUTH_TOKEN (or MCP_API_TOKEN / OPENPROJECT_API_KEY). ' +
      'Local: run-tests.sh reads opnc-secrets, or export MCP_OAUTH_TOKEN from ' +
      "`kubectl get secret opnc-secrets -n opnc-integration -o jsonpath='{.data.mcp-oauth-token}' | base64 --decode`. " +
      'PullPreview: set MCP_OAUTH_TOKEN from PULLPREVIEW_MCP_TOKEN.',
  );
}
