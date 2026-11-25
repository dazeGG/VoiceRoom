import { canonicalSelection, FULL_SELECTION, VOICE_SPECS, type Selection } from './verification-policy.mts';
import { type measuredInputs, reverseConsumers, type RoutingWorkspace } from './routing-inputs.mts';

export interface TreeInputs {
  workspaces: RoutingWorkspace[];
  measured: ReturnType<typeof measuredInputs>;
}
interface ComponentIntent {
  app: boolean;
  site: boolean;
  docs: boolean;
  installer: boolean;
}
const apiLanes = ['api-unit', 'api-integration', 'test', 'goal-g05'];
const voiceFeatures = ['voice-chat', 'voice-call', 'voice-guest'];
const sorted = (values: Set<string>) => [...values].sort();
export const allTests = (why: string) => ({ selection: FULL_SELECTION, reason: 'ALL: ' + why });

// Shared UI defaults to every feature: mobile opens ChatPanel; friend calls
// embed the DM composer. Narrow production code only at exclusive surfaces.
const voiceSurfaces = [
  {
    group: 'voice-chat',
    path: /^apps\/web\/src\/(?:shared\/chat\/EmojiPickerPanel\.vue|styles\/chat\/_emoji-picker\.scss)$/
  },
  { group: 'voice-call', path: /^apps\/web\/src\/features\/friend-call\/FriendCall(?:Tiles|Stage)\.vue$/ },
  { group: 'voice-guest', path: /^apps\/web\/src\/features\/room\/components\/MobileCall(?:Grid|Focus|Pip|Tile)\.vue$/ }
];
function voiceGroups(path: string) {
  if (path.startsWith('apps/web/src/features/legal/')) return ['voice-core'];
  const surface = voiceSurfaces.find((candidate) => candidate.path.test(path));
  if (surface) return ['voice-core', surface.group];
  if (/^apps\/web\/e2e\/widget-/.test(path)) return ['voice-core', 'widget'];
  for (const [group, specs] of Object.entries(VOICE_SPECS)) {
    if (specs.some((spec) => path === 'apps/web/e2e/' + spec + '.spec.ts')) {
      return [...new Set(['voice-core', group])];
    }
  }
  return ['voice-core', ...voiceFeatures];
}
function broadInput(path: string) {
  return (
    /(?:^|\/)(?:package(?:-lock)?\.json|[^/]*\.config\.[^/]+|tsconfig[^/]*\.json|Dockerfile[^/]*|Caddyfile[^/]*|\.nvmrc|\.npmrc)$/.test(
      path
    ) ||
    /(?:^|\/)(?:migrations|__fixtures__|fixtures)\//.test(path) ||
    /^(?:scripts|\.github|config|deploy|deployment)\//.test(path) ||
    /(?:^|\/)docker-compose[^/]*\.ya?ml$/.test(path)
  );
}

function observesG08(path: string, trees: TreeInputs[]) {
  return trees.some(
    ({ measured }) =>
      measured.exact.includes(path) ||
      measured.prefixes.some((p) => path.startsWith(p)) ||
      measured.fragments.some((p) => path.includes(p))
  );
}

export function selectTests(paths: string[], trees: TreeInputs[], intent: ComponentIntent) {
  const lanes = new Set<string>();
  const groups = new Set<string>();
  const workspaces = new Set<string>();
  const owners = new Set<string>();
  const inputs = trees.flatMap((tree) => tree.workspaces);
  const reasons = new Set<string>();
  if (intent.app) ['check-lane', 'check'].forEach((id) => lanes.add(id));
  for (const name of ['site', 'docs', 'installer'] as const) if (intent[name]) lanes.add(name);
  if (trees.length !== 2) return allTests('missing base or tested workspace inventory');
  for (const path of paths) {
    if (broadInput(path) || path.startsWith('packages/shared/'))
      return allTests('shared, configuration or verification input: ' + path);
    if (observesG08(path, trees)) {
      apiLanes.forEach((id) => lanes.add(id));
      reasons.add('G08 source or runtime input');
    }
    if (/^(?:apps\/docs\/|docs\/)|^(?:README|AGENTS|CLAUDE|DESIGN)\.md$/.test(path)) continue;
    if (path.startsWith('apps/get/')) {
      groups.add('personal');
      reasons.add('installer');
      continue;
    }
    const owner = inputs.find((w) => path.startsWith(w.dir + '/'));
    if (!owner) return allTests('unknown path: ' + path);
    reasons.add(owner.dir);
    // Only named tests are private to their runner. A helper beside them can
    // still be imported by browser fixtures (e.g. manual-chat-polish).
    if (path.startsWith(owner.dir + '/test/') && /\.test\.[cm]?[jt]sx?$/.test(path)) {
      if (!owner.tests) return allTests('unresolved test workspace: ' + owner.dir);
      if (owner.dir === 'apps/api') apiLanes.forEach((lane) => lanes.add(lane));
      else if (owner.dir === 'apps/site') lanes.add('site');
      else {
        const name = owner.name.replace(/^@voiceroom\//, '');
        if (!FULL_SELECTION.workspaces.includes(name)) return allTests('unresolved test workspace: ' + owner.dir);
        workspaces.add(name);
      }
      continue;
    }
    owners.add(owner.name);
    switch (owner.dir) {
      case 'apps/api':
        apiLanes.forEach((id) => lanes.add(id));
        for (const g of ['voice-core', ...voiceFeatures, 'widget', 'personal']) groups.add(g);
        // Web imports the client log intake normalizer across the workspace boundary.
        if (path.startsWith('apps/api/src/lib/')) owners.add('@voiceroom/web');
        break;
      case 'packages/ui-kit':
      case 'packages/ui':
      case 'packages/call':
        for (const g of ['voice-core', ...voiceFeatures, 'widget', 'personal']) groups.add(g);
        break;
      case 'apps/web':
        if (!/^apps\/web\/(?:src|test|e2e|public)\//.test(path)) return allTests('unknown Web input: ' + path);
        for (const g of voiceGroups(path)) groups.add(g);
        if (/^apps\/web\/e2e\/(?![^/]+\.spec\.ts$)|embed|widget/i.test(path)) groups.add('widget');
        break;
      case 'apps/admin':
        if (!/^apps\/admin\/(?:src|test|public)\//.test(path)) return allTests('unknown Admin input: ' + path);
        break;
      case 'apps/meet':
        groups.add('personal');
        break;
      case 'apps/widget':
        groups.add('widget');
        break;
      case 'apps/site':
        // Web tests import Site's desktop download entry point and its helpers.
        if (path.startsWith('apps/site/src/')) owners.add('@voiceroom/web');
        break;
      default:
        return allTests('unknown workspace: ' + owner.dir);
    }
  }
  try {
    for (const w of reverseConsumers(
      trees.map((tree) => tree.workspaces),
      owners
    )) {
      if (!w.tests || w.dir === 'apps/api' || w.dir === 'packages/shared') continue;
      const name = w.name.replace(/^@voiceroom\//, '');
      if (w.dir === 'apps/site') lanes.add('site');
      else if (FULL_SELECTION.workspaces.includes(name)) workspaces.add(name);
      else return allTests('unresolved test workspace: ' + w.dir);
    }
    for (const owner of owners)
      if (!inputs.some((w) => w.name === owner)) return allTests('unresolved consumer: ' + owner);
  } catch {
    return allTests('unresolved workspace dependency');
  }

  if (workspaces.size) lanes.add('test-web');
  if (groups.has('voice-core')) lanes.add('voice-join');
  if (groups.has('widget')) lanes.add('widget-smoke');
  if (groups.has('personal')) lanes.add('personal-smoke');
  if (lanes.has('site') || lanes.has('docs')) lanes.add('static-publication');
  if (
    intent.app &&
    ![...lanes].some((lane) => !['check', 'check-lane', 'static-publication', 'site', 'docs'].includes(lane))
  ) {
    return allTests('unexpectedly empty test selection for an app diff');
  }
  const selection: Selection = { lanes: sorted(lanes), groups: sorted(groups), workspaces: sorted(workspaces) };
  try {
    canonicalSelection(selection);
  } catch {
    return allTests('invalid candidate selection');
  }
  return {
    selection,
    reason: 'Affected: ' + (sorted(reasons).join(', ') || 'static or repository documentation only')
  };
}
