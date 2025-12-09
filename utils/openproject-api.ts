import { testConfig } from './config';
import { ADMIN_USER } from './test-users';

interface OpenProjectApiUser {
  id: number;
  login: string;
  email?: string;
  admin: boolean;
}

interface UsersCollection {
  _type: string;
  total: number;
  count: number;
  pageSize: number;
  offset: number;
  _embedded?: {
    elements?: OpenProjectApiUser[];
  };
}

interface AdminCredentials {
  username: string;
  password: string;
}

const API_BASE_URL = `https://${testConfig.openproject.host}/api/v3`;

const DEFAULT_ADMIN_CREDENTIALS: AdminCredentials = {
  username: ADMIN_USER.username,
  password: ADMIN_USER.password,
};

function buildBasicAuthHeader({ username, password }: AdminCredentials): string {
  const encoded = Buffer.from(`${username}:${password}`).toString('base64');
  return `Basic ${encoded}`;
}

async function apiRequest<T>(
  endpoint: string,
  method: 'GET' | 'PATCH',
  credentials: AdminCredentials,
  body?: Record<string, unknown>
): Promise<T> {
  const headers: Record<string, string> = {
    accept: 'application/hal+json',
    authorization: buildBasicAuthHeader(credentials),
  };

  let payload: string | undefined;
  if (body) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    method,
    headers,
    body: payload,
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(
      `OpenProject API request failed: ${method} ${endpoint} - ${response.status} ${response.statusText} - ${message}`
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

async function listUsers(credentials: AdminCredentials): Promise<OpenProjectApiUser[]> {
  const data = await apiRequest<UsersCollection>(
    '/users?offset=1&pageSize=200',
    'GET',
    credentials
  );
  return data._embedded?.elements ?? [];
}

function matchUser(user: OpenProjectApiUser, identifier: string): boolean {
  const normalized = identifier.toLowerCase();
  return (
    user.login.toLowerCase() === normalized ||
    (user.email?.toLowerCase() === normalized)
  );
}

async function findUserByIdentifier(
  identifier: string,
  credentials: AdminCredentials
): Promise<OpenProjectApiUser | undefined> {
  const users = await listUsers(credentials);
  return users.find((user) => matchUser(user, identifier));
}

async function updateUserAdminStatus(
  userId: number,
  isAdmin: boolean,
  credentials: AdminCredentials
): Promise<void> {
  await apiRequest(
    `/users/${userId}`,
    'PATCH',
    credentials,
    { admin: isAdmin }
  );
}

export interface EnsureAdminResult {
  userId: number;
  updated: boolean;
}

export async function ensureUserIsAdmin(
  identifier: string,
  credentials: AdminCredentials = DEFAULT_ADMIN_CREDENTIALS
): Promise<EnsureAdminResult> {
  const user = await findUserByIdentifier(identifier, credentials);

  if (!user) {
    throw new Error(`OpenProject user '${identifier}' not found via API`);
  }

  if (!user.admin) {
    await updateUserAdminStatus(user.id, true, credentials);
    return { userId: user.id, updated: true };
  }

  return { userId: user.id, updated: false };
}

export async function setUserAdmin(
  userId: number,
  isAdmin: boolean,
  credentials: AdminCredentials = DEFAULT_ADMIN_CREDENTIALS
): Promise<void> {
  await updateUserAdminStatus(userId, isAdmin, credentials);
}
