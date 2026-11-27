import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compareReleaseVersions, parseWhatsNewRelease } from '../../packages/shared/src/account-security.ts';
import { isRecord } from '../../packages/shared/src/guards.ts';

const components = ['api', 'web', 'admin', 'widget', 'meet'];

export function validateRelease(directory: string, component: string, tag: string, sha: string) {
  const match = /^([a-z]+)\/v((?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*))$/.exec(tag);
  if (!components.includes(component) || match?.[1] !== component || !match[2]) {
    throw new Error(`Invalid ${component} release tag: ${tag}`);
  }
  const version = match[2];
  const git = (args: string[]) => execFileSync('git', args, { cwd: directory, encoding: 'utf8' }).trim();
  if (!/^[a-f0-9]{40}$/.test(sha) || git(['rev-parse', 'HEAD']) !== sha) {
    throw new Error('The tag target must be checked out');
  }
  const manifest: unknown = JSON.parse(readFileSync(join(directory, 'apps', component, 'package.json'), 'utf8'));
  if (!isRecord(manifest) || manifest.version !== version) {
    throw new Error(`Tag ${tag} does not match apps/${component}/package.json`);
  }
  if (component === 'web') {
    const source = readFileSync(join(directory, 'apps/web/src/shared/whats-new-release.ts'), 'utf8');
    const release = /^export const WHATS_NEW_RELEASE\s*=\s*(['"])([^'"\r\n]*)\1\s*;/m.exec(source)?.[2];
    const parsed = parseWhatsNewRelease(release);
    if (!parsed || parsed === 'legacy') throw new Error('WHATS_NEW_RELEASE must be web/X.Y.Z');
    if (compareReleaseVersions(parsed.version, version) === 1) {
      throw new Error(`WHATS_NEW_RELEASE ${release} is newer than apps/web/package.json (${version})`);
    }
  }
  if (!git(['rev-list', '--first-parent', 'origin/main']).split(/\r?\n/).includes(sha)) {
    throw new Error(`Tag ${tag} must point to a first-parent commit of main`);
  }
  return version;
}

if (import.meta.main) {
  const [, , component, tag, sha] = process.argv;
  console.log(`version=${validateRelease(process.cwd(), component ?? '', tag ?? '', sha ?? '')}`);
}
