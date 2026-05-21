export const SQUASH_TEST_CASE_ID_ANNOTATION = 'squash_test_case_id';
export const SQUASH_AUTOMATED_REFERENCE_ANNOTATION = 'squash_automated_test_reference';
export const SQUASH_DATASET_NAME_ANNOTATION = 'squash_dataset_name';

const defaultRepositoryName = 'integration-qa-helmfile';

interface SquashAnnotation {
  type: string;
  description: string;
}

interface SquashTestCaseOptions {
  automatedReference?: string;
  datasetName?: string;
  tag?: string | string[];
}

export function squashAutomatedReference(
  specPathFromRepoRoot: string,
  testTitle: string,
  repositoryName = defaultRepositoryName,
): string {
  const normalizedPath = specPathFromRepoRoot.replace(/\\/g, '/');
  const lastSlashIndex = normalizedPath.lastIndexOf('/');
  const folder = lastSlashIndex >= 0 ? normalizedPath.slice(0, lastSlashIndex) : '';
  const fileName = lastSlashIndex >= 0 ? normalizedPath.slice(lastSlashIndex + 1) : normalizedPath;
  const pathPrefix = folder ? `${folder}#` : '';

  return `${repositoryName}/${pathPrefix}${fileName}#${testTitle}`;
}

export function squashTestCase(
  testCaseId: number,
  options: SquashTestCaseOptions = {},
): { annotation: SquashAnnotation[]; tag?: string | string[] } {
  const annotation: SquashAnnotation[] = [
    {
      type: SQUASH_TEST_CASE_ID_ANNOTATION,
      description: String(testCaseId),
    },
  ];

  if (options.automatedReference) {
    annotation.push({
      type: SQUASH_AUTOMATED_REFERENCE_ANNOTATION,
      description: options.automatedReference,
    });
  }

  if (options.datasetName) {
    annotation.push({
      type: SQUASH_DATASET_NAME_ANNOTATION,
      description: options.datasetName,
    });
  }

  return options.tag ? { annotation, tag: options.tag } : { annotation };
}
