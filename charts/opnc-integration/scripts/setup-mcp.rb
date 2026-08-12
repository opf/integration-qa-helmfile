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

admin = wait_for_openproject!

# 1. Provision Brian User with Admin Role
brian = User.find_or_initialize_by(login: "brian")
brian.firstname = "Brian"
brian.lastname = "QA"
brian.mail = "brian@example.net"
brian.admin = true
brian.status = User.statuses[:active]
brian.password = "Password123!"
brian.force_password_change = false
brian.save!
puts "[INFO] Provisioned user 'brian' (ID: #{brian.id}, admin: #{brian.admin?})"

# 2. Seed McpConfiguration server_config
sc = McpConfiguration.find_or_create_by!(identifier: "mcp_server")
sc.update!(enabled: true, title: "OpenProject", description: "OpenProject MCP Server")
puts "[INFO] Seeded McpConfiguration server_config (enabled: #{sc.enabled?})"

# 3. Seed all registered MCP tools (14 tools)
McpTools.all.each do |tool_class|
  conf = McpConfiguration.find_or_initialize_by(identifier: tool_class.qualified_name)
  conf.enabled = true
  conf.title ||= tool_class.title
  conf.description ||= tool_class.description
  conf.save!
end
puts "[INFO] Seeded #{McpTools.all.count} MCP Tools in McpConfiguration"

# 4. Seed all registered MCP resources (10 resources)
McpResources.all.each do |res_class|
  conf = McpConfiguration.find_or_initialize_by(identifier: res_class.qualified_name)
  conf.enabled = true
  conf.title ||= res_class.title
  conf.description ||= res_class.description
  conf.save!
end
puts "[INFO] Seeded #{McpResources.all.count} MCP Resources in McpConfiguration"

# 5. Provision API Token for Brian
token_api = Token::API.find_or_create_by!(user: brian) do |t|
  t.value = Token::API.generate_token_value
end
puts "[INFO] Provisioned API Token for 'brian': #{token_api.value}"

# 6. Provision OAuth Token for Brian with 'mcp' scope
raw_oauth_token = ENV.fetch("MCP_OAUTH_TOKEN", "brian_mcp_test_token_1234567890")
hashed_token = Doorkeeper::AccessToken.secret_strategy.transform_secret(raw_oauth_token)

oauth_token = Doorkeeper::AccessToken.find_or_initialize_by(resource_owner_id: brian.id, scopes: "mcp")
oauth_token.token = hashed_token
oauth_token.expires_in = 86400 * 365
oauth_token.save!
puts "[INFO] Provisioned OAuth Token for 'brian' with 'mcp' scope"

exit 0
