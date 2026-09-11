import os
import pytest

@pytest.fixture(scope="session")
def openproject_url():
    return os.environ.get("OPENPROJECT_URL", "https://openproject.test")

@pytest.fixture(scope="session")
def mcp_bearer_token():
    token = os.environ.get("MCP_BEARER_TOKEN", "")
    if not token:
        pytest.skip("MCP_BEARER_TOKEN not configured")
    return token
