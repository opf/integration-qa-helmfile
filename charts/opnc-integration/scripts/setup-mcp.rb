# frozen_string_literal: true

def wait_for_openproject!(max_attempts: 120, sleep_seconds: 5)
  max_attempts.times do |attempt|
    begin
      ActiveRecord::Base.connection.execute("SELECT 1")
      if ActiveRecord::Base.connection.table_exists?("mcp_configurations") && ActiveRecord::Base.connection.table_exists?("users")
        admin = User.active.admin.first
        return admin if admin
      end

      warn "[INFO] Database reachable but admin user / tables not ready yet (attempt #{attempt + 1}/#{max_attempts})"
    rescue StandardError => e
      warn "[INFO] Waiting for OpenProject database (#{e.class}: #{e.message}) (attempt #{attempt + 1}/#{max_attempts})"
    end

    sleep sleep_seconds unless attempt == max_attempts - 1
  end

  warn "[ERROR] Timeout waiting for OpenProject database"
  exit 1
end

wait_for_openproject!

# 1. Provision MCP-only Bob_AI user (admin). Login must not collide with Keycloak brian.
bob = User.find_or_initialize_by(login: "Bob_AI")
bob.firstname = "Bob"
bob.lastname = "AI"
bob.mail = "bob.ai@example.net"
bob.admin = true
bob.status = User.statuses[:active]
bob.password = "Password123!"
bob.force_password_change = false
bob.save!
puts "[INFO] Provisioned user 'Bob_AI' (ID: #{bob.id}, admin: #{bob.admin?})"

# 2. Seed McpConfiguration server_config
sc = McpConfiguration.find_or_create_by!(identifier: "mcp_server")
sc.update!(enabled: true, title: "OpenProject", description: "OpenProject MCP Server")
puts "[INFO] Seeded McpConfiguration server_config (enabled: #{sc.enabled?})"

# 3. Seed all registered MCP tools
McpTools.all.each do |tool_class|
  conf = McpConfiguration.find_or_initialize_by(identifier: tool_class.qualified_name)
  conf.enabled = true
  conf.title ||= tool_class.default_title
  conf.description ||= tool_class.default_description
  conf.save!
end
puts "[INFO] Seeded #{McpTools.all.count} MCP Tools in McpConfiguration"

# 4. Seed all registered MCP resources
McpResources.all.each do |res_class|
  conf = McpConfiguration.find_or_initialize_by(identifier: res_class.qualified_name)
  conf.enabled = true
  conf.title ||= res_class.default_title
  conf.description ||= res_class.default_description
  conf.save!
end
puts "[INFO] Seeded #{McpResources.all.count} MCP Resources in McpConfiguration"

# 5. Provision OAuth application + token for Bob_AI with 'mcp' scope.
# Doorkeeper rejects application-less tokens for the MCP auth strategy (falls through to AnonymousUser).
oauth_app = Doorkeeper::Application.find_or_create_by!(name: "MCP E2E") do |app|
  app.redirect_uri = "urn:ietf:wg:oauth:2.0:oob"
  app.scopes = "mcp"
  app.confidential = true
end
oauth_app.update!(scopes: "mcp") unless oauth_app.scopes.to_s.split.include?("mcp")
puts "[INFO] Provisioned Doorkeeper application 'MCP E2E' (ID: #{oauth_app.id})"

raw_oauth_token = ENV.fetch("MCP_OAUTH_TOKEN", "bob_ai_mcp_test_token_1234567890")
oauth_token = Doorkeeper::AccessToken.find_or_initialize_by(resource_owner_id: bob.id, scopes: "mcp")
oauth_token.application_id = oauth_app.id
oauth_token.expires_in = 86400 * 365
oauth_token.revoked_at = nil
oauth_token.save!
# Write the hash via update_column: token= hashes again (same as setup-xwiki-oauth.rb).
oauth_token.update_column(
  :token,
  Doorkeeper::AccessToken.secret_strategy.transform_secret(raw_oauth_token)
)
puts "[INFO] Provisioned OAuth Token for 'Bob_AI' with 'mcp' scope"

exit 0
