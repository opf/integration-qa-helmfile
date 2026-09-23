# Seed data constants for mcp-eval tests
#
# These constants reference data that is guaranteed to exist on a fresh
# production-mode OpenProject deployment after standard seeding + setup-mcp.rb.
# See: charts/opnc-integration/scripts/setup-mcp.rb
# See: openproject/app/seeders/standard.yml

# --- Users ---
# Bob_AI is provisioned by setup-mcp.rb with admin role and MCP OAuth token
MCP_USER = {
    "login": "Bob_AI",
    "firstname": "Bob",
    "lastname": "AI",
    "email": "bob.ai@example.net",
    "admin": True,
}

# --- Admin user (AdminUserSeeder, name from charts/openproject admin_user.name) ---
# Demo department users (Marko, Wanda, ...) are only seeded in development mode.
ADMIN_USER = {
    "login": "admin",
    "firstname": "OpenProject",
    "lastname": "Admin",
}
