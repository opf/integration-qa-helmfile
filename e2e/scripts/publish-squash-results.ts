import * as fs from 'fs';
import * as path from 'path';
import { getErrorMessage } from '../utils/error-utils';
import { logError, logInfo, logWarn } from '../utils/logger';
import {
  SQUASH_AUTOMATED_REFERENCE_ANNOTATION,
  SQUASH_DATASET_NAME_ANNOTATION,
  SQUASH_TEST_CASE_ID_ANNOTATION,
  squashAutomatedReference,
} from '../utils/squash-metadata';

type SquashStatus =
  | 'BLOCKED'
  | 'CANCELLED'
  | 'SUCCESS'
  | 'RUNNING'
  | 'SKIPPED'
  | 'FAILURE'
  | 'READY';

interface SquashAttachment {
  name: string;
  content: string;
}

interface SquashTestResult {
  reference: string;
  dataset_name?: string;
  status: SquashStatus;
  duration?: number;
  failure_details?: string[];
  attachments?: SquashAttachment[];
}

interface SquashPayload {
  automated_test_suite?: {
    attachments?: SquashAttachment[];
  };
  tests: SquashTestResult[];
}

interface Annotation {
  type: string;
  description?: string;
}

interface CollectedTest {
  reference: string;
  testCaseId?: number;
  datasetName?: string;
  title: string;
  file?: string;
  status: SquashStatus;
  duration: number;
  failureDetails: string[];
  attachments: SquashAttachment[];
}

interface AttachmentPolicy {
  suiteExtensions: Set<string>;
  testExtensions: Set<string>;
  maxBytes: number;
}

interface PublisherConfig {
  baseUrl: string;
  apiToken: string;
  iterationId: string;
}

const defaultSquashTmUrl = 'https://squashtm.openproject.org/squash';
const defaultAttachmentMaxBytes = 5 * 1024 * 1024;
const fetchMaxAttempts = 3;
const fetchTimeoutMs = 30_000;
const e2eRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(e2eRoot, '..');

class MissingPlaywrightReportError extends Error {}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  if (args.has('--help')) {
    logInfo([
      'Usage: npm run squash:publish -- [--dry-run] [--skip-missing-auth]',
      '',
      'Environment:',
      '  SQUASH_TM_URL              Squash base URL, e.g. https://squashtm.openproject.org/squash',
      '  SQUASH_TM_API_TOKEN        Bearer token with permission to import results',
      '  SQUASH_TM_ITERATION_ID     Target iteration ID',
      '  SQUASH_TM_SYNC_TEST_PLAN   When true, add mapped test case IDs to the iteration before import',
      '  SQUASH_TM_DRY_RUN          When true, write payload without publishing',
      '  SQUASH_TM_TEST_ATTACHMENT_EXTENSIONS  Allowed per-test attachment extensions',
    ].join('\n'));
    return;
  }

  const dryRun = args.has('--dry-run') || envFlag('SQUASH_TM_DRY_RUN');
  const skipMissingAuth =
    args.has('--skip-missing-auth') || envFlag('SQUASH_TM_SKIP_MISSING_AUTH');
  let reportJsonPath: string;
  try {
    reportJsonPath = findPlaywrightJsonReport();
  } catch (error: unknown) {
    if (skipMissingAuth && error instanceof MissingPlaywrightReportError) {
      logWarn(`[Squash TM] ${error.message} Skipping publish.`);
      return;
    }
    throw error;
  }
  const reportRunDir = path.dirname(reportJsonPath);
  logInfo(`[Squash TM] Using Playwright report: ${reportJsonPath}`);
  const report = readJsonFile(reportJsonPath);
  const attachmentPolicy = getAttachmentPolicy();
  const collectedTests = mergeCollectedTests(
    collectMappedTests(report, reportRunDir, attachmentPolicy),
  );

  if (collectedTests.length === 0) {
    const message = 'No Squash-mapped Playwright tests were present in this report.';
    if (envFlag('SQUASH_TM_REQUIRE_MAPPED_TESTS')) {
      throw new Error(message);
    }
    logWarn(`${message} Skipping Squash TM publishing.`);
    return;
  }

  const payload = buildSquashPayload(collectedTests, reportRunDir, attachmentPolicy);
  const outputPath = path.join(reportRunDir, 'squash-results.json');
  fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  logInfo(`[Squash TM] Wrote payload: ${outputPath}`);
  logInfo(`[Squash TM] Mapped test results: ${summarizeStatuses(payload.tests)}`);

  if (dryRun) {
    logInfo('[Squash TM] Dry run enabled; not publishing results.');
    return;
  }

  const config = getPublisherConfig(skipMissingAuth);
  if (!config) return;

  if (envFlag('SQUASH_TM_SYNC_TEST_PLAN')) {
    await syncIterationTestPlan(config, collectedTests);
  }

  await publishResults(config, payload);
}

function findPlaywrightJsonReport(): string {
  const configuredJson = process.env.SQUASH_TM_PLAYWRIGHT_JSON;
  if (configuredJson) {
    const fullPath = path.resolve(process.cwd(), configuredJson);
    assertFileExists(fullPath);
    return fullPath;
  }

  const reportRoot = path.resolve(
    e2eRoot,
    process.env.SQUASH_TM_PLAYWRIGHT_REPORT_DIR || 'playwright-report',
  );

  if (!fs.existsSync(reportRoot)) {
    throw new MissingPlaywrightReportError(`Playwright report directory not found: ${reportRoot}`);
  }

  const runDirs = fs.readdirSync(reportRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('run-'))
    .map((entry) => path.join(reportRoot, entry.name))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);

  for (const runDir of runDirs) {
    const candidate = path.join(runDir, 'results.json');
    if (fs.existsSync(candidate)) return candidate;
  }

  throw new MissingPlaywrightReportError(`No Playwright results.json found under ${reportRoot}`);
}

function readJsonFile(filePath: string): unknown {
  assertFileExists(filePath);
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
}

function assertFileExists(filePath: string): void {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
}

function collectMappedTests(
  report: unknown,
  reportRunDir: string,
  attachmentPolicy: AttachmentPolicy,
): CollectedTest[] {
  const reportObject = asObject(report);
  if (!reportObject) return [];

  const collected: CollectedTest[] = [];
  for (const suite of asArray(reportObject.suites)) {
    collectFromSuite(suite, reportRunDir, attachmentPolicy, collected);
  }
  return collected;
}

function collectFromSuite(
  suite: unknown,
  reportRunDir: string,
  attachmentPolicy: AttachmentPolicy,
  collected: CollectedTest[],
): void {
  const suiteObject = asObject(suite);
  if (!suiteObject) return;

  for (const spec of asArray(suiteObject.specs)) {
    collectFromSpec(spec, reportRunDir, attachmentPolicy, collected);
  }

  for (const childSuite of asArray(suiteObject.suites)) {
    collectFromSuite(childSuite, reportRunDir, attachmentPolicy, collected);
  }
}

function collectFromSpec(
  spec: unknown,
  reportRunDir: string,
  attachmentPolicy: AttachmentPolicy,
  collected: CollectedTest[],
): void {
  const specObject = asObject(spec);
  if (!specObject) return;

  const specTitle = getString(specObject.title) || '(untitled Playwright test)';
  const specFile = getString(specObject.file);
  const specAnnotations = getAnnotations(specObject.annotations);

  for (const test of asArray(specObject.tests)) {
    const testObject = asObject(test);
    if (!testObject) continue;

    const annotations = [
      ...specAnnotations,
      ...getAnnotations(testObject.annotations),
    ];
    const testCaseId = parsePositiveInteger(
      getAnnotationDescription(annotations, SQUASH_TEST_CASE_ID_ANNOTATION),
    );
    const explicitReference = getAnnotationDescription(
      annotations,
      SQUASH_AUTOMATED_REFERENCE_ANNOTATION,
    );
    const reference = explicitReference || (
      testCaseId ? buildAutomatedReferenceFromReport(specFile, specTitle) : undefined
    );
    if (!reference) continue;

    const datasetName = getAnnotationDescription(annotations, SQUASH_DATASET_NAME_ANNOTATION);
    const summary = summarizePlaywrightTest(testObject, reportRunDir, attachmentPolicy);

    collected.push({
      reference,
      testCaseId,
      datasetName,
      title: specTitle,
      file: specFile,
      status: summary.status,
      duration: summary.duration,
      failureDetails: summary.failureDetails,
      attachments: summary.attachments,
    });
  }
}

function buildAutomatedReferenceFromReport(
  specFile: string | undefined,
  testTitle: string,
): string | undefined {
  if (!specFile) return undefined;

  let specPathFromRepoRoot = specFile.replace(/\\/g, '/');
  if (path.isAbsolute(specPathFromRepoRoot)) {
    specPathFromRepoRoot = path
      .relative(repoRoot, specPathFromRepoRoot)
      .replace(/\\/g, '/');
  } else if (specPathFromRepoRoot.startsWith('tests/')) {
    specPathFromRepoRoot = `e2e/${specPathFromRepoRoot}`;
  } else if (specPathFromRepoRoot.startsWith('e2e/tests/')) {
    return squashAutomatedReference(specPathFromRepoRoot, testTitle);
  } else {
    specPathFromRepoRoot = `e2e/tests/${specPathFromRepoRoot}`;
  }

  return squashAutomatedReference(specPathFromRepoRoot, testTitle);
}

function summarizePlaywrightTest(
  testObject: Record<string, unknown>,
  reportRunDir: string,
  attachmentPolicy: AttachmentPolicy,
): Pick<CollectedTest, 'status' | 'duration' | 'failureDetails' | 'attachments'> {
  const results = asArray(testObject.results)
    .map((result) => asObject(result))
    .filter((result): result is Record<string, unknown> => Boolean(result));

  if (results.length === 0 || getString(testObject.status) === 'skipped') {
    return {
      status: 'SKIPPED',
      duration: 0,
      failureDetails: [],
      attachments: [],
    };
  }

  const lastResult = results[results.length - 1];
  const status = mapPlaywrightStatus(getString(lastResult.status), getString(testObject.status));
  const duration = results.reduce((sum, result) => sum + getNonNegativeNumber(result.duration), 0);
  const failureDetails = results.flatMap((result) => getFailureDetails(result));
  const attachments = results.flatMap((result) =>
    getResultAttachments(result, reportRunDir, attachmentPolicy),
  );

  return {
    status,
    duration,
    failureDetails,
    attachments,
  };
}

function mapPlaywrightStatus(
  resultStatus: string | undefined,
  testStatus: string | undefined,
): SquashStatus {
  switch (resultStatus) {
    case 'passed':
      return 'SUCCESS';
    case 'failed':
    case 'timedOut':
      return 'FAILURE';
    case 'skipped':
      return 'SKIPPED';
    case 'interrupted':
      return 'CANCELLED';
    default:
      break;
  }

  switch (testStatus) {
    case 'expected':
    case 'flaky':
      return 'SUCCESS';
    case 'unexpected':
      return 'FAILURE';
    case 'skipped':
      return 'SKIPPED';
    default:
      return 'BLOCKED';
  }
}

function getFailureDetails(result: Record<string, unknown>): string[] {
  const failures: string[] = [];
  for (const error of asArray(result.errors)) {
    const message = describeError(error);
    if (message) failures.push(limitText(message, 4000));
  }

  const singleError = describeError(result.error);
  if (singleError) failures.push(limitText(singleError, 4000));

  return [...new Set(failures)];
}

function describeError(error: unknown): string | undefined {
  const errorObject = asObject(error);
  if (errorObject) {
    const json = safeJson(errorObject);
    return (
      getString(errorObject.message) ||
      getString(errorObject.stack) ||
      getString(errorObject.value) ||
      (json ? limitText(json, 4000) : undefined)
    );
  }

  return typeof error === 'string' ? error : undefined;
}

function getResultAttachments(
  result: Record<string, unknown>,
  reportRunDir: string,
  attachmentPolicy: AttachmentPolicy,
): SquashAttachment[] {
  return asArray(result.attachments).flatMap((attachment) => {
    const attachmentObject = asObject(attachment);
    if (!attachmentObject) return [];

    const attachmentPath = getString(attachmentObject.path);
    if (!attachmentPath) return [];

    const rawAttachmentName =
      getString(attachmentObject.name) || path.basename(attachmentPath);
    const attachmentName = path.extname(rawAttachmentName)
      ? rawAttachmentName
      : `${rawAttachmentName}${path.extname(attachmentPath)}`;
    const resolvedPath = resolveAttachmentPath(attachmentPath, reportRunDir);

    const squashAttachment = createFileAttachment(
      resolvedPath,
      attachmentName,
      attachmentPolicy.testExtensions,
      attachmentPolicy.maxBytes,
    );
    return squashAttachment ? [squashAttachment] : [];
  });
}

function resolveAttachmentPath(attachmentPath: string, reportRunDir: string): string {
  if (path.isAbsolute(attachmentPath)) return attachmentPath;

  const reportRelativePath = path.resolve(reportRunDir, attachmentPath);
  if (fs.existsSync(reportRelativePath)) return reportRelativePath;

  return path.resolve(e2eRoot, attachmentPath);
}

function mergeCollectedTests(tests: CollectedTest[]): CollectedTest[] {
  const merged = new Map<string, CollectedTest>();

  for (const test of tests) {
    const key = `${test.reference}\u0000${test.datasetName || ''}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...test });
      continue;
    }

    existing.status = combineStatuses(existing.status, test.status);
    existing.duration += test.duration;
    existing.failureDetails = uniqueStrings([
      ...existing.failureDetails,
      ...test.failureDetails,
    ]);
    existing.attachments.push(...test.attachments);
    existing.testCaseId = existing.testCaseId ?? test.testCaseId;
    existing.file = existing.file ?? test.file;
  }

  return [...merged.values()];
}

function combineStatuses(first: SquashStatus, second: SquashStatus): SquashStatus {
  const statuses = [first, second];
  if (statuses.includes('FAILURE')) return 'FAILURE';
  if (statuses.includes('CANCELLED')) return 'CANCELLED';
  if (statuses.includes('BLOCKED')) return 'BLOCKED';
  if (statuses.includes('SUCCESS')) return 'SUCCESS';
  if (statuses.includes('SKIPPED')) return 'SKIPPED';
  if (statuses.includes('RUNNING')) return 'RUNNING';
  return 'READY';
}

function buildSquashPayload(
  tests: CollectedTest[],
  reportRunDir: string,
  attachmentPolicy: AttachmentPolicy,
): SquashPayload {
  const suiteAttachments = getSuiteAttachments(reportRunDir, attachmentPolicy);

  return {
    automated_test_suite: suiteAttachments.length > 0
      ? { attachments: suiteAttachments }
      : undefined,
    tests: tests.map((test) => ({
      reference: test.reference,
      dataset_name: test.datasetName,
      status: test.status,
      duration: test.duration > 0 ? Math.round(test.duration) : undefined,
      failure_details: test.failureDetails.length > 0 ? test.failureDetails : undefined,
      attachments: test.attachments.length > 0 ? test.attachments : undefined,
    })),
  };
}

function getSuiteAttachments(
  reportRunDir: string,
  attachmentPolicy: AttachmentPolicy,
): SquashAttachment[] {
  const attachments: SquashAttachment[] = [];
  const junitPath = path.join(reportRunDir, 'junit.xml');
  const junitAttachment = createFileAttachment(
    junitPath,
    'junit.xml',
    attachmentPolicy.suiteExtensions,
    attachmentPolicy.maxBytes,
  );
  if (junitAttachment) attachments.push(junitAttachment);

  const githubRunAttachment = createTextAttachment(
    'github-run.txt',
    getGithubRunSummary(),
    attachmentPolicy.suiteExtensions,
    attachmentPolicy.maxBytes,
  );
  if (githubRunAttachment) attachments.push(githubRunAttachment);

  return attachments;
}

function getGithubRunSummary(): string {
  const lines = [
    `repository=${process.env.GITHUB_REPOSITORY || ''}`,
    `workflow=${process.env.GITHUB_WORKFLOW || ''}`,
    `run_id=${process.env.GITHUB_RUN_ID || ''}`,
    `run_attempt=${process.env.GITHUB_RUN_ATTEMPT || ''}`,
    `sha=${process.env.GITHUB_SHA || ''}`,
    `ref=${process.env.GITHUB_REF || ''}`,
    `server_url=${process.env.GITHUB_SERVER_URL || ''}`,
  ];

  if (process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID) {
    lines.push(
      `run_url=${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`,
    );
  }

  return `${lines.join('\n')}\n`;
}

function createFileAttachment(
  filePath: string,
  attachmentName: string,
  allowedExtensions: Set<string>,
  maxBytes: number,
): SquashAttachment | undefined {
  if (!fs.existsSync(filePath)) return undefined;

  const extension = path.extname(attachmentName).replace('.', '').toLowerCase();
  if (!allowedExtensions.has(extension)) {
    logWarn(`[Squash TM] Skipping unsupported attachment extension: ${attachmentName}`);
    return undefined;
  }

  const stat = fs.statSync(filePath);
  if (stat.size > maxBytes) {
    logWarn(
      `[Squash TM] Skipping attachment over ${maxBytes} bytes: ${attachmentName}`,
    );
    return undefined;
  }

  return {
    name: attachmentName,
    content: fs.readFileSync(filePath).toString('base64'),
  };
}

function createTextAttachment(
  attachmentName: string,
  content: string,
  allowedExtensions: Set<string>,
  maxBytes: number,
): SquashAttachment | undefined {
  const extension = path.extname(attachmentName).replace('.', '').toLowerCase();
  if (!allowedExtensions.has(extension)) return undefined;

  const buffer = Buffer.from(content, 'utf8');
  if (buffer.byteLength > maxBytes) return undefined;

  return {
    name: attachmentName,
    content: buffer.toString('base64'),
  };
}

function getAttachmentPolicy(): AttachmentPolicy {
  const suiteExtensions = parseExtensionSet(
    process.env.SQUASH_TM_SUITE_ATTACHMENT_EXTENSIONS ||
      process.env.SQUASH_TM_ATTACHMENT_EXTENSIONS ||
      'txt,html,xml,doc',
  );
  const testExtensions = parseExtensionSet(
    process.env.SQUASH_TM_TEST_ATTACHMENT_EXTENSIONS ||
      'txt,html,xml,doc,png,jpg,jpeg,webm,zip',
  );
  const configuredMaxBytes = parsePositiveInteger(
    process.env.SQUASH_TM_ATTACHMENT_MAX_BYTES,
  );

  return {
    suiteExtensions,
    testExtensions,
    maxBytes: configuredMaxBytes ?? defaultAttachmentMaxBytes,
  };
}

function parseExtensionSet(value: string): Set<string> {
  return new Set(
    value
      .split(',')
      .map((extension) => extension.trim().replace(/^\./, '').toLowerCase())
      .filter(Boolean),
  );
}

function getPublisherConfig(skipMissingAuth: boolean): PublisherConfig | undefined {
  const baseUrl = (process.env.SQUASH_TM_URL || defaultSquashTmUrl).trim();
  const apiToken = (process.env.SQUASH_TM_API_TOKEN || '').trim();
  const iterationId = (process.env.SQUASH_TM_ITERATION_ID || '').trim();
  const missing = [
    apiToken ? undefined : 'SQUASH_TM_API_TOKEN',
    iterationId ? undefined : 'SQUASH_TM_ITERATION_ID',
  ].filter((name): name is string => Boolean(name));

  if (!apiToken && skipMissingAuth) {
    logWarn(`[Squash TM] Missing ${missing.join(', ')}. Skipping publish.`);
    return undefined;
  }

  if (missing.length > 0) {
    throw new Error(`[Squash TM] Missing ${missing.join(', ')}.`);
  }

  return { baseUrl, apiToken, iterationId };
}

async function syncIterationTestPlan(
  config: PublisherConfig,
  tests: CollectedTest[],
): Promise<void> {
  const testCaseIds = uniqueNumbers(
    tests.map((test) => test.testCaseId).filter((id): id is number => Boolean(id)),
  );
  if (testCaseIds.length === 0) {
    logWarn('[Squash TM] No Squash test case IDs found; cannot sync iteration test plan.');
    return;
  }

  const existingIds = await getIterationTestPlanCaseIds(config);
  for (const testCaseId of testCaseIds) {
    if (existingIds.has(testCaseId)) {
      logInfo(`[Squash TM] Test case ${testCaseId} is already in the iteration test plan.`);
      continue;
    }

    await addTestCaseToIteration(config, testCaseId);
    logInfo(`[Squash TM] Added test case ${testCaseId} to iteration ${config.iterationId}.`);
  }
}

async function getIterationTestPlanCaseIds(config: PublisherConfig): Promise<Set<number>> {
  const response = await fetchWithRetry(
    buildApiUrl(config.baseUrl, `iterations/${config.iterationId}/test-plan?size=1000`),
    {
      headers: {
        Authorization: `Bearer ${config.apiToken}`,
        Accept: 'application/json',
      },
    },
  );
  const body = await response.text();
  if (!response.ok) {
    throw new Error(
      `[Squash TM] Failed to read iteration test plan: HTTP ${response.status} ${body}`,
    );
  }

  return extractTestCaseIds(body ? JSON.parse(body) as unknown : undefined);
}

async function addTestCaseToIteration(
  config: PublisherConfig,
  testCaseId: number,
): Promise<void> {
  const response = await fetchWithRetry(
    buildApiUrl(config.baseUrl, `iterations/${config.iterationId}/test-plan`),
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        _type: 'test-plan-item',
        test_case: {
          _type: 'test-case',
          id: testCaseId,
        },
      }),
    },
  );

  const body = await response.text();
  if (response.ok) return;

  if (response.status === 409 || body.toLowerCase().includes('already')) {
    logWarn(
      `[Squash TM] Test case ${testCaseId} already appears to be in iteration ` +
        `${config.iterationId}; continuing.`,
    );
    return;
  }

  throw new Error(
    `[Squash TM] Failed to add test case ${testCaseId} to iteration ${config.iterationId}: ` +
      `HTTP ${response.status} ${body}`,
  );
}

async function publishResults(config: PublisherConfig, payload: SquashPayload): Promise<void> {
  const url = buildApiUrl(config.baseUrl, `import/results/${config.iterationId}`);
  const response = await fetchWithRetry(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const responseBody = await response.text();

  if (response.ok) {
    logInfo(`[Squash TM] Results imported into iteration ${config.iterationId}.`);
    return;
  }

  throw new Error(
    `[Squash TM] Import failed: HTTP ${response.status} ${response.statusText}` +
      (responseBody ? `\n${responseBody}` : ''),
  );
}

async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= fetchMaxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(fetchTimeoutMs),
      });

      if (response.status >= 500 && attempt < fetchMaxAttempts) {
        logWarn(
          `[Squash TM] HTTP ${response.status} from ${url}; retrying ` +
            `(${attempt}/${fetchMaxAttempts})`,
        );
        await delay(500 * 2 ** (attempt - 1));
        continue;
      }

      return response;
    } catch (error: unknown) {
      lastError = error;
      if (attempt === fetchMaxAttempts) break;

      logWarn(
        `[Squash TM] Request failed for ${url}: ${getErrorMessage(error)}; ` +
          `retrying (${attempt}/${fetchMaxAttempts})`,
      );
      await delay(500 * 2 ** (attempt - 1));
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`[Squash TM] Request failed for ${url}: ${getErrorMessage(lastError)}`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildApiUrl(baseUrl: string, endpoint: string): string {
  const cleanBase = baseUrl.replace(/\/+$/, '');
  const cleanEndpoint = endpoint.replace(/^\/+/, '');
  const apiBase = cleanBase.endsWith('/api/rest/latest')
    ? cleanBase
    : `${cleanBase}/api/rest/latest`;

  return `${apiBase}/${cleanEndpoint}`;
}

function extractTestCaseIds(value: unknown): Set<number> {
  const ids = new Set<number>();
  const object = asObject(value);
  const embedded = asObject(object?._embedded);
  const items = asArray(embedded?.['test-plan-items']);

  for (const item of items) {
    const itemObject = asObject(item);
    const referencedTestCase =
      asObject(itemObject?.referenced_test_case) ||
      asObject(itemObject?.test_case) ||
      asObject(itemObject?.testCase);
    const testCaseId = referencedTestCase ? getNumber(referencedTestCase.id) : undefined;
    if (testCaseId !== undefined) ids.add(testCaseId);
  }

  if (ids.size > 0) return ids;

  collectTestCaseIds(value, ids);
  return ids;
}

function collectTestCaseIds(value: unknown, ids: Set<number>): void {
  const object = asObject(value);
  if (object) {
    const type = getString(object._type);
    const id = getNumber(object.id);
    if (type === 'test-case' && id !== undefined) ids.add(id);

    const testCase = asObject(object.test_case) || asObject(object.testCase);
    const testCaseId = testCase ? getNumber(testCase.id) : undefined;
    if (testCaseId !== undefined) ids.add(testCaseId);

    for (const child of Object.values(object)) {
      collectTestCaseIds(child, ids);
    }
    return;
  }

  for (const child of asArray(value)) {
    collectTestCaseIds(child, ids);
  }
}

function getAnnotations(value: unknown): Annotation[] {
  return asArray(value).flatMap((annotation) => {
    const annotationObject = asObject(annotation);
    if (!annotationObject) return [];

    const type = getString(annotationObject.type);
    if (!type) return [];

    return [{
      type,
      description: getString(annotationObject.description),
    }];
  });
}

function getAnnotationDescription(
  annotations: Annotation[],
  type: string,
): string | undefined {
  return annotations.find((annotation) => annotation.type === type)?.description;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function getNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function getNonNegativeNumber(value: unknown): number {
  const number = getNumber(value);
  return number !== undefined && number > 0 ? number : 0;
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (!value) return undefined;

  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function envFlag(name: string): boolean {
  const value = (process.env[name] || '').trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes';
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function uniqueNumbers(values: number[]): number[] {
  return [...new Set(values)];
}

function summarizeStatuses(tests: SquashTestResult[]): string {
  const counts = new Map<SquashStatus, number>();
  for (const test of tests) {
    counts.set(test.status, (counts.get(test.status) || 0) + 1);
  }

  return [...counts.entries()]
    .map(([status, count]) => `${count} ${status.toLowerCase()}`)
    .join(', ') || '0 results';
}

function limitText(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function safeJson(value: unknown): string | undefined {
  try {
    return JSON.stringify(value);
  } catch (error: unknown) {
    logWarn('[Squash TM] Failed to stringify Playwright error:', getErrorMessage(error));
    return undefined;
  }
}

main().catch((error: unknown) => {
  logError(getErrorMessage(error));
  process.exit(1);
});
