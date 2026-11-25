import { createHash } from 'node:crypto';
import { isArray, isRecord } from '../../packages/shared/src/guards.ts';

export interface Selection {
  lanes: string[];
  workspaces: string[];
  groups: string[];
}

// Bump when changing the meaning of a lane, graph edge, group, or proof.
export const SELECTOR_VERSION = 'pr3b-2';
const voiceSmokeSpecs = {
  'voice-core': ['room-voice'],
  'voice-chat': ['chat-typing', 'manual-chat-polish', 'chat-drafts', 'chat-image-paste'],
  'voice-guest': ['guest-account-cta', 'mobile-room'],
  'voice-call': ['friend-call', 'microphone-recovery', 'rnnoise-assets']
};
const voiceFeatureSpecs = {
  'voice-context-menu': ['context-menu'],
  'voice-reactions': ['reactions'],
  'voice-room-delete': ['room-delete'],
  'voice-room-edit': ['room-edit'],
  'voice-room-realtime': ['room-realtime'],
  'voice-localization': ['localization'],
  'voice-desktop-root-boundary': ['desktop-root-boundary'],
  'voice-mic-stall': ['mic-stall']
};
export const VOICE_SPECS: Record<string, string[]> = { ...voiceSmokeSpecs, ...voiceFeatureSpecs };
type VoiceFixture = 'voice' | 'voice-features';
export type BrowserFixture = VoiceFixture | 'widget' | 'personal' | 'ui-audit';

export function voiceFixture(group: string): VoiceFixture | undefined {
  if (Object.hasOwn(voiceSmokeSpecs, group)) return 'voice';
  if (Object.hasOwn(voiceFeatureSpecs, group)) return 'voice-features';
  return undefined;
}

export function fixtureGroups(fixture: BrowserFixture, groups: readonly string[]): string[] {
  return groups.filter((group) => (voiceFixture(group) ?? group) === fixture);
}

export const AUDIT_PROJECTS = ['chromium', 'webkit', 'firefox'];
const auditSpecs = ['focus', 'security-hardening-cache'];
const personalSpecs = ['meet'];
const widgetSpecs = ['widget-embed', 'widget-media-boundary', 'widget-reconnect'];
const apiLanes = ['api-unit', 'api-integration', 'test', 'goal-g05'];
const alwaysFresh = ['installer', 'static-publication', 'site', 'docs'];

// Independent of any affected-path computation. Site and Docs own their own tests;
// shared tests and repository script/build contracts run in API and check respectively.
export const FULL_SELECTION: Selection = {
  lanes: [
    'check-lane',
    'check',
    ...apiLanes,
    'test-web',
    'voice-join',
    'voice-features',
    'widget-smoke',
    'personal-smoke',
    'ui-audit',
    ...alwaysFresh
  ].sort(),
  workspaces: ['admin', 'meet', 'web', 'widget'],
  groups: [...Object.keys(VOICE_SPECS), 'widget', 'personal', 'ui-audit'].sort()
};

function members(value: unknown, allowed: string[], field: string): string[] {
  if (
    !isArray(value) ||
    !value.every((s): s is string => typeof s === 'string' && allowed.includes(s)) ||
    value.length !== new Set(value).size
  )
    throw new Error('Invalid or duplicate ' + field);
  return [...value].sort();
}

export function canonicalSelection(value: unknown): Selection {
  if (!isRecord(value)) throw new Error('Missing selection');
  const lanes = members(value.lanes, FULL_SELECTION.lanes, 'lanes');
  const workspaces = members(value.workspaces, FULL_SELECTION.workspaces, 'workspaces');
  const groups = members(value.groups, FULL_SELECTION.groups, 'groups');
  function requireTogether(lane: string, required: boolean) {
    if (lanes.includes(lane) !== required) throw new Error('Inconsistent selection for ' + lane);
  }
  requireTogether('check-lane', lanes.includes('check'));
  for (const lane of apiLanes) requireTogether(lane, lanes.includes('test'));
  requireTogether('test-web', workspaces.length > 0);
  requireTogether('voice-join', fixtureGroups('voice', groups).length > 0);
  requireTogether('voice-features', fixtureGroups('voice-features', groups).length > 0);
  requireTogether('widget-smoke', groups.includes('widget'));
  requireTogether('ui-audit', groups.includes('ui-audit'));
  requireTogether('personal-smoke', groups.includes('personal'));
  requireTogether('static-publication', lanes.includes('site') || lanes.includes('docs'));
  return { lanes, workspaces, groups };
}

export function selectionDigest(value: Selection): string {
  return createHash('sha256')
    .update(JSON.stringify({ version: SELECTOR_VERSION, ...canonicalSelection(value) }))
    .digest('hex');
}

interface Context {
  event: string;
  branch: string;
  verified: boolean;
}

function fullRequired({ event, branch, verified }: Context): boolean {
  if (event === 'push' && branch === 'develop') return !verified;
  if (event === 'pull_request' && (branch === 'main' || branch === 'develop')) return branch === 'main';
  throw new Error('Unsupported verification event: ' + event + ':' + branch);
}

export function schedule(context: Context, affected: unknown): Selection {
  if (fullRequired(context)) return canonicalSelection(FULL_SELECTION);
  const selected = canonicalSelection(affected);
  if (context.event === 'pull_request') return selected;
  return { lanes: selected.lanes.filter((lane) => alwaysFresh.includes(lane)), workspaces: [], groups: [] };
}

function completedFor(lane: string, selected: Selection): string[] {
  switch (lane) {
    case 'test-web':
      return selected.workspaces;
    case 'voice-join':
      return fixtureGroups('voice', selected.groups);
    case 'voice-features':
      return fixtureGroups('voice-features', selected.groups);
    case 'widget-smoke':
      return ['widget'];
    case 'ui-audit':
      return ['ui-audit'];
    case 'personal-smoke':
      return ['personal'];
    default:
      return [];
  }
}

function parsed(value: unknown): unknown {
  if (typeof value !== 'string') return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

// Read the actual needs results, not the schedule emitted by the routing job.
export function verify(event: string, branch: string, needs: unknown): string[] {
  if (
    !isRecord(needs) ||
    !isRecord(needs.changes) ||
    needs.changes.result !== 'success' ||
    !isRecord(needs.changes.outputs)
  )
    throw new Error('Missing successful routing evidence');
  const { verified, selection, digest } = needs.changes.outputs;
  const context = { event, branch, verified: verified === 'true' };
  const affected = parsed(selection);
  const expected = schedule(context, affected);
  const full = fullRequired(context);
  const selected = full ? expected : canonicalSelection(affected);
  if (!full && selectionDigest(selected) !== digest)
    throw new Error('Selection digest does not match routing evidence');
  return FULL_SELECTION.lanes.map((lane) => {
    const fresh = expected.lanes.includes(lane);
    const wanted = fresh ? 'success' : 'skipped';
    const job = needs[lane];
    if (!isRecord(job) || job.result !== wanted) {
      throw new Error(
        lane +
          ': expected ' +
          wanted +
          ', got ' +
          (isRecord(job) && typeof job.result === 'string' ? job.result : 'missing')
      );
    }
    const required = fresh ? completedFor(lane, expected) : [];
    if (required.length > 0) {
      const actual = isRecord(job.outputs) ? parsed(job.outputs.completed) : undefined;
      if (members(actual, required, lane + ' completed evidence').length !== required.length)
        throw new Error(lane + ': missing completed evidence');
    }
    const decision = fresh ? 'success' : selected.lanes.includes(lane) ? 'reused' : 'intentional skip';
    return lane + ': ' + decision;
  });
}

export function fixtureSpecs(fixture: BrowserFixture, input: unknown): string[] {
  const groups = fixtureGroups(fixture, members(input, FULL_SELECTION.groups, 'fixture groups'));
  const otherSpecs = { widget: widgetSpecs, personal: personalSpecs, 'ui-audit': auditSpecs };
  const specs =
    fixture === 'voice' || fixture === 'voice-features'
      ? groups.flatMap((group) => VOICE_SPECS[group] ?? [])
      : groups.includes(fixture)
        ? otherSpecs[fixture]
        : [];
  if (!specs.length) throw new Error('No selected specs for ' + fixture);
  const dir = fixture === 'ui-audit' ? 'ui-audit-e2e' : 'e2e';
  return specs.map((spec) => dir + '/' + spec + '.spec.ts');
}

if (import.meta.main) {
  const { EVENT_NAME: event = '', BASE_BRANCH: branch = '', SELECTION, VERIFIED, NEEDS, GROUPS_JSON } = process.env;
  switch (process.argv[2]) {
    case 'schedule': {
      const execution = schedule({ event, branch, verified: VERIFIED === 'true' }, parsed(SELECTION));
      console.log('schedule=' + JSON.stringify(execution));
      break;
    }
    case 'verify':
      console.log(verify(event, branch, parsed(NEEDS)).join('\n'));
      break;
    case 'voice-specs':
      console.log(fixtureSpecs('voice', parsed(GROUPS_JSON)).join(' '));
      break;
    case 'voice-features-specs':
      console.log(fixtureSpecs('voice-features', parsed(GROUPS_JSON)).join(' '));
      break;
    case 'widget-specs':
      console.log(fixtureSpecs('widget', parsed(GROUPS_JSON)).join(' '));
      break;
    default:
      throw new Error('Expected schedule, verify, voice-specs, voice-features-specs or widget-specs');
  }
}
