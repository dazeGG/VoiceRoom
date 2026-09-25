// The capability manifest: which public features, internal prerequisites and
// operator flags exist, how they depend on each other, and the check that
// rejects a manifest with an unknown, missing, duplicate or cyclic node.

export interface CapabilityRequires {
  binary: string[];
  schema: string[];
  index: string[];
  config: string[];
  api: string[];
  web: string[];
  visibility: string[];
  worker: string[];
  internal: string[];
}

export interface CapabilityPublicNode {
  key: string;
  owner: string;
  dependsOn: string[];
  requires: CapabilityRequires;
  safeRead: string;
  activation: { goal: string; checkpoint: string } | null;
  rollback: { public: boolean; operators: string[] } | null;
  order: number;
}

export interface CapabilityInternalNode {
  key: string;
  owner: string;
  readyWhen: string[];
  requiredBy: string[];
  rollback: boolean;
}

export interface CapabilityOperatorNode {
  key: string;
  owner: string;
  default: boolean | string;
  requiredBy: string[];
  stop: string;
  introducedBy: string;
  enum: string[];
}

export interface CapabilityReplicaConsensus {
  algorithm: string;
  disagreement: string;
  unknown: string;
}

export interface CapabilityManifest {
  contractVersion: 'voice-room.capabilities/v1';
  schemaVersion: 1;
  publicKeys: CapabilityPublicNode[];
  internalPrerequisites: CapabilityInternalNode[];
  operatorFlags: CapabilityOperatorNode[];
  replicaConsensus: CapabilityReplicaConsensus | null;
}

type Loose = Record<string, unknown>;

export const CAPABILITY_CONTRACT = 'voice-room.capabilities/v1' as const;
export const CAPABILITY_SCHEMA_VERSION = 1 as const;

export const PUBLIC_CAPABILITY_KEYS: readonly string[] = [
  'historyCursor',
  'readCursor',
  'replies',
  'membership',
  'engagement',
  'reactions',
  'mediaRead',
  'mediaUploads',
  'moderationCenter'
];

export const INTERNAL_NODE_KEYS: readonly string[] = [
  'internal.desktopBoundary',
  'internal.idempotentSend',
  'internal.messageDelivery',
  'internal.structuredContent',
  'internal.mentions',
  'internal.notificationInbox',
  'internal.notificationPolicies',
  'internal.unreadNavigation',
  'internal.attachmentBinding',
  'internal.strictCredential'
];

export const OPERATOR_KEYS: readonly string[] = [
  'op.message.write',
  'op.message.dispatch.claim',
  'op.readCursor.write',
  'op.reply.write',
  'op.membership.join',
  'op.membership.credentialMint',
  'op.engagement.write',
  'op.notification.dispatch.claim',
  'op.reaction.write',
  'op.media.upload.reserve',
  'op.media.process.claim',
  'op.media.maintenance.claim',
  'op.moderation.write',
  'op.rollout.cohort',
  'op.compat.profile'
];

export function toSet(values: unknown = []): Set<string> {
  return new Set(Array.isArray(values) ? values.filter(Boolean) : []);
}

function isObject(value: unknown): value is Loose {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function toStringArray(values: unknown = [], fallback: string[] = []): string[] {
  if (!Array.isArray(values)) return fallback;
  return values.filter((value): value is string => typeof value === 'string' && Boolean(value.trim()));
}

function normalizePublicNode(node: unknown, index: number): CapabilityPublicNode | null {
  if (!isObject(node)) return null;
  const requires: Loose = isObject(node.requires) ? node.requires : {};

  return {
    key: String(node.key || '').trim(),
    owner: String(node.owner || '').trim() || 'platform.capabilities',
    dependsOn: toStringArray(node.dependsOn, []),
    requires: {
      binary: toStringArray(requires.binary, []),
      schema: toStringArray(requires.schema, []),
      index: toStringArray(requires.index, []),
      config: toStringArray(requires.config, []),
      api: toStringArray(requires.api, []),
      web: toStringArray(requires.web, []),
      visibility: toStringArray(requires.visibility, []),
      worker: toStringArray(requires.worker, []),
      internal: toStringArray(requires.internal, [])
    },
    safeRead: typeof node.safeRead === 'string' ? node.safeRead : '',
    activation: isObject(node.activation)
      ? { goal: String(node.activation.goal || ''), checkpoint: String(node.activation.checkpoint || '') }
      : null,
    rollback: isObject(node.rollback)
      ? {
          public: Boolean(node.rollback.public),
          operators: toStringArray(node.rollback.operators, [])
        }
      : null,
    order: Number.isFinite(node.order) ? (node.order as number) : index
  };
}

function normalizeInternalNode(node: unknown): CapabilityInternalNode | null {
  if (!isObject(node)) return null;
  return {
    key: String(node.key || '').trim(),
    owner: String(node.owner || '').trim() || 'platform.capabilities',
    readyWhen: toStringArray(node.readyWhen, []),
    requiredBy: toStringArray(node.requiredBy, []),
    rollback: Boolean(node.rollback)
  };
}

function normalizeOperatorNode(node: unknown): CapabilityOperatorNode | null {
  if (!isObject(node)) return null;
  return {
    key: String(node.key || '').trim(),
    owner: String(node.owner || '').trim() || 'platform.capabilities',
    default: (node.default ?? false) as boolean | string,
    requiredBy: toStringArray(node.requiredBy, []),
    stop: String(node.stop || ''),
    introducedBy: String(node.introducedBy || ''),
    enum: Array.isArray(node.enum) ? node.enum.filter((value): value is string => typeof value === 'string') : []
  };
}

export function normalizeManifest(candidate: unknown): CapabilityManifest | null {
  if (!isObject(candidate)) return null;
  const contract = candidate.contractVersion || candidate.contract;
  if (contract !== CAPABILITY_CONTRACT) return null;
  if (candidate.schemaVersion !== CAPABILITY_SCHEMA_VERSION) return null;

  const publicKeys = Array.isArray(candidate.publicKeys) ? candidate.publicKeys.map(normalizePublicNode) : [];
  const internalPrerequisites = Array.isArray(candidate.internalPrerequisites)
    ? candidate.internalPrerequisites.map(normalizeInternalNode)
    : [];
  const operatorFlags = Array.isArray(candidate.operatorFlags)
    ? candidate.operatorFlags.map(normalizeOperatorNode)
    : [];

  const knownPublicKeys = new Set(PUBLIC_CAPABILITY_KEYS);
  const knownInternalKeys = new Set(INTERNAL_NODE_KEYS);
  const knownOperatorKeys = new Set(OPERATOR_KEYS);

  const publicUnknown = publicKeys.filter((item) => item && !knownPublicKeys.has(item.key));
  if (publicUnknown.length > 0) return null;

  const internalUnknown = internalPrerequisites.filter((item) => item && !knownInternalKeys.has(item.key));
  if (internalUnknown.length > 0) return null;

  const operatorUnknown = operatorFlags.filter((item) => item && !knownOperatorKeys.has(item.key));
  if (operatorUnknown.length > 0) return null;

  if (
    publicKeys.length !== PUBLIC_CAPABILITY_KEYS.length ||
    internalPrerequisites.length !== INTERNAL_NODE_KEYS.length ||
    operatorFlags.length !== OPERATOR_KEYS.length
  ) {
    return null;
  }

  const byKey = new Map<string, CapabilityPublicNode>();
  const byKeyInternal = new Map<string, CapabilityInternalNode>();
  const byOperator = new Map<string, CapabilityOperatorNode>();

  for (const item of publicKeys) {
    if (!item?.key) return null;
    if (byKey.has(item.key)) return null;
    byKey.set(item.key, item);
  }

  // A null node reaches these two loops before the key checks and throws, as
  // it always has; the manifest is rejected either way.
  for (const item of internalPrerequisites) {
    if ((item as CapabilityInternalNode).requiredBy.some((key) => !byKey.has(key))) return null;
  }

  for (const item of operatorFlags) {
    if ((item as CapabilityOperatorNode).requiredBy.some((key) => !byKey.has(key))) return null;
  }

  for (const item of internalPrerequisites) {
    if (!item?.key) return null;
    if (byKeyInternal.has(item.key)) return null;
    byKeyInternal.set(item.key, item);
  }

  for (const item of operatorFlags) {
    if (!item?.key) return null;
    if (byOperator.has(item.key)) return null;
    byOperator.set(item.key, item);
  }

  for (const item of publicKeys as CapabilityPublicNode[]) {
    if (item.dependsOn.some((key) => !byKey.has(key))) return null;
    if (item.requires.internal.some((key) => !byKeyInternal.has(key))) return null;
    if (item.rollback?.operators.some((key) => !byOperator.has(key))) return null;
  }

  const visited = new Set<string>();
  const visiting = new Set<string>();
  const visit = (key: string): boolean => {
    if (visited.has(key)) return true;
    if (visiting.has(key)) return false;
    visiting.add(key);
    for (const dependency of byKey.get(key)!.dependsOn) {
      if (!visit(dependency)) return false;
    }
    visiting.delete(key);
    visited.add(key);
    return true;
  };
  if (PUBLIC_CAPABILITY_KEYS.some((key) => !visit(key))) return null;

  return {
    contractVersion: CAPABILITY_CONTRACT,
    schemaVersion: CAPABILITY_SCHEMA_VERSION,
    publicKeys: [...byKey.values()].sort(
      (a, b) => PUBLIC_CAPABILITY_KEYS.indexOf(a.key) - PUBLIC_CAPABILITY_KEYS.indexOf(b.key)
    ),
    internalPrerequisites: [...byKeyInternal.values()].sort(
      (a, b) => INTERNAL_NODE_KEYS.indexOf(a.key) - INTERNAL_NODE_KEYS.indexOf(b.key)
    ),
    operatorFlags: [...byOperator.values()].sort((a, b) => OPERATOR_KEYS.indexOf(a.key) - OPERATOR_KEYS.indexOf(b.key)),
    replicaConsensus: isObject(candidate.replicaConsensus)
      ? {
          algorithm: String(candidate.replicaConsensus.algorithm || ''),
          disagreement: String(candidate.replicaConsensus.disagreement || ''),
          unknown: String(candidate.replicaConsensus.unknown || '')
        }
      : null
  };
}

export function isManifestValid(manifest: unknown): boolean {
  return normalizeManifest(manifest) !== null;
}

export function toPublicKeySet(): Set<string> {
  return new Set(PUBLIC_CAPABILITY_KEYS);
}

export function toInternalKeySet(): Set<string> {
  return new Set(INTERNAL_NODE_KEYS);
}

export function toOperatorKeySet(): Set<string> {
  return new Set(OPERATOR_KEYS);
}
