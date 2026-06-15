# frozen_string_literal: true

client_id = ENV.fetch("XWIKI_OAUTH_CLIENT_ID")
client_secret = ENV.fetch("XWIKI_OAUTH_CLIENT_SECRET")
xwiki_host = ENV.fetch("XWIKI_HOST")

redirect_uri = [
  "https://#{xwiki_host}/oidc/authenticator/callback",
  "https://#{xwiki_host}/xwiki/oidc/authenticator/callback"
].join("\n")

def wait_for_openproject!(max_attempts: 120, sleep_seconds: 5)
  max_attempts.times do |attempt|
    begin
      ActiveRecord::Base.connection.execute("SELECT 1")
      unless ActiveRecord::Base.connection.table_exists?("oauth_applications")
        raise ActiveRecord::StatementInvalid, "oauth_applications table missing"
      end

      admin = User.active.admin.first
      return admin if admin

      warn "[INFO] Database reachable but admin user not seeded yet (attempt #{attempt + 1}/#{max_attempts})"
    rescue StandardError => e
      warn "[INFO] Waiting for OpenProject database (#{e.class}: #{e.message}) (attempt #{attempt + 1}/#{max_attempts})"
    end

    sleep sleep_seconds unless attempt == max_attempts - 1
  end

  warn "[ERROR] Timeout waiting for OpenProject database and admin seed"
  exit 1
end

if Doorkeeper::Application.exists?(uid: client_id)
  puts "[INFO] OAuth application '#{client_id}' already exists; skipping."
  exit 0
end

admin = wait_for_openproject!

result = OAuth::Applications::CreateService
  .new(user: admin)
  .call(
    name: "XWiki",
    uid: client_id,
    redirect_uri: redirect_uri,
    scopes: "api_v3",
    confidential: true,
    enabled: true,
    owner: admin
  )

unless result.success?
  warn "[ERROR] Failed to create OAuth application: #{result.errors.full_messages.join(', ')}"
  exit 1
end

app = result.result
app.update_column(:secret, Doorkeeper::Application.secret_strategy.transform_secret(client_secret))

puts "[INFO] Created OAuth application '#{client_id}' for XWiki."
exit 0
