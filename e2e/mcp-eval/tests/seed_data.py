# Seed data constants for mcp-eval tests
#
# These constants reference data that is guaranteed to exist on a fresh
# OpenProject deployment after standard seeding + setup-mcp.rb.
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

SUPPORTED_TOOLS = {
    "current_user",
    "list_statuses",
    "list_types",
    "search_portfolios",
    "search_programs",
    "search_projects",
    "search_users",
    "search_versions",
    "search_work_packages",
}


def supported_case(case):
    if "tool" in case:
        return case["tool"] in SUPPORTED_TOOLS
    if "tools" in case:
        return all(t in SUPPORTED_TOOLS for t in case["tools"])
    return True

# --- Projects ---
DEMO_PROJECT = {
    "name": "Demo project",
    "identifier": "demo-project",
    "status_code": "on_track",
}

SCRUM_PROJECT = {
    "name": "Scrum project",
    "identifier": "your-scrum-project",
    "status_code": "on_track",
}

# --- Work Package Types ---
TYPES = {
    "task": "Task",
    "milestone": "Milestone",
    "summary_task": "Summary task",
    "feature": "Feature",
    "epic": "Epic",
    "user_story": "User story",
    "bug": "Bug",
}

# --- Work Package Statuses ---
STATUSES = [
    "New",
    "In specification",
    "Specified",
    "Confirmed",
    "To be scheduled",
    "Scheduled",
    "In progress",
    "Developed",
    "In testing",
    "Tested",
    "Test failed",
    "Closed",
    "On hold",
    "Rejected",
]

# --- Known Work Packages (from demo-project) ---
DEMO_WORK_PACKAGES = [
    {"subject": "Start of project", "type": "Milestone", "status": "Closed"},
    {"subject": "Organize open source conference", "type": "Summary task", "status": "In progress"},
    {"subject": "Set date and location of conference", "type": "Task", "status": "In progress"},
    {"subject": "Send invitation to speakers", "type": "Task", "status": "In progress"},
    {"subject": "Contact sponsoring partners", "type": "Task", "status": "New"},
    {"subject": "Create sponsorship brochure and hand-outs", "type": "Task", "status": "New"},
    {"subject": "Invite attendees to conference", "type": "Task", "status": "New"},
    {"subject": "Setup conference website", "type": "Task", "status": "New"},
    {"subject": "Test and quality-check the conference website", "type": "Task", "status": "New"},
    {"subject": "Conference", "type": "Milestone", "status": "Scheduled"},
    {"subject": "Follow-up tasks", "type": "Summary task", "status": "To be scheduled"},
    {"subject": "Upload presentations to website", "type": "Task", "status": "New"},
    {"subject": "Party for conference supporters :-)", "type": "Task", "status": "New"},
    {"subject": "End of project", "type": "Milestone", "status": "New"},
]

# --- Known Work Packages (from scrum-project) ---
SCRUM_WORK_PACKAGES = [
    {"subject": "New login screen", "type": "User story", "status": "In specification"},
    {"subject": "Password reset does not send email", "type": "Bug", "status": "Confirmed"},
    {"subject": "New website", "type": "Epic", "status": "Specified"},
    {"subject": "Newsletter registration form", "type": "User story", "status": "In progress"},
    {"subject": "Wrong hover color", "type": "Bug", "status": "Rejected"},
    {"subject": "SSL certificate", "type": "User story", "status": "Specified"},
]

# --- Known Versions (from scrum-project) ---
SCRUM_VERSIONS = [
    "Product Backlog",
    "Bug Backlog",
    "Sprint 1",
    "Sprint 2",
]

# --- Known Relations (from demo-project) ---
# "Invite attendees to conference" follows "Set date and location of conference"
# "Setup conference website" follows "Set date and location of conference"
# "Test and quality-check..." follows "Setup conference website"
# "Conference" follows "Organize open source conference"
# "End of project" follows "Follow-up tasks"

# --- Known Seeded Users (from demo data departments) ---
SEEDED_USERS = [
    {"firstname": "Marko", "lastname": "Marketing"},
    {"firstname": "Connie", "lastname": "Comms"},
    {"firstname": "Petra", "lastname": "Press"},
    {"firstname": "Polly", "lastname": "PR"},
    {"firstname": "Dora", "lastname": "Design"},
    {"firstname": "Carl", "lastname": "Content"},
    {"firstname": "Evan", "lastname": "Events"},
    {"firstname": "Olga", "lastname": "Ops"},
    {"firstname": "Wanda", "lastname": "Web"},
    {"firstname": "Ivan", "lastname": "IT"},
    {"firstname": "Fritz", "lastname": "Finance"},
    {"firstname": "Adam", "lastname": "Admin"},
    {"firstname": "Tessa", "lastname": "Tester"},
]
