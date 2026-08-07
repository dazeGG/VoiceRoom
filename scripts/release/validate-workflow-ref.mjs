import { pathToFileURL } from 'node:url';

export function validateWorkflowRef(actual, expected) {
  if (!expected || actual !== expected) throw new Error(`Workflow requires ${expected || 'an explicit ref'}; received ${actual || '<missing>'}`);
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const index = process.argv.indexOf('--expected');
  try {
    validateWorkflowRef(process.env.GITHUB_REF, index >= 0 ? process.argv[index + 1] : '');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
