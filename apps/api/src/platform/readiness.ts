import crypto from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  normalizeManifest,
  PUBLIC_CAPABILITY_KEYS,
  OPERATOR_KEYS,
  toSet,
  type CapabilityManifest,
  type CapabilityPublicNode,
  type CapabilityInternalNode,
  type CapabilityOperatorNode
} from '@voice-room/shared/capabilities';

const DEFAULT_MANIFEST_PATH = 'config/capability-dag.v1.json';

const REPLICA_UNKNOWN_LABEL = 'unknown';
const REPLICA_AGREE_LABEL = 'agree';

type ReadinessCategory = 'binary' | 'schema' | 'index' | 'config' | 'api' | 'web' | 'visibility' | 'worker' | 'internal';
type ReadinessSets = Partial<Record<ReadinessCategory, Set<string>>> & { desired?: Record<string, boolean> };

export type ReplicaInput = {
  id?: unknown;
  manifestDigest?: unknown;
  manifestSchemaVersion?: unknown;
  contractVersion?: unknown;
  checks?: unknown;
  publicCaps?: unknown;
  public?: unknown;
  features?: unknown;
  ready?: unknown;
};

type NormalizedReplica = {
  id: string;
  manifestDigest: string | null;
  manifestSchemaVersion: number | null;
  contractVersion: string | null;
  checks: Set<string>;
  public: Set<string> | Map<unknown, unknown>;
  ready?: boolean | null;
};

export type ReadinessOptions = {
  binaryReady?: unknown;
  schemaReady?: unknown;
  indexReady?: unknown;
  configReady?: unknown;
  apiReady?: unknown;
  webReady?: unknown;
  visibilityReady?: unknown;
  workerReady?: unknown;
  internalReady?: unknown;
  desired?: Record<string, unknown>;
  operatorFlags?: Record<string, unknown>;
  replicas?: ReplicaInput[];
  requireReplicaConsensus?: boolean;
};

export type ReplicaResult = { id: string; signature: string; ready: boolean; stale: boolean; features: Record<string, boolean> };

export type ReadinessManifest = { contractVersion: string; schemaVersion: number; path: string; digest: string };

export type ReadinessReport = {
  manifest: ReadinessManifest;
  features: Record<string, boolean>;
  rawManifest: string;
  operatorFlags: Record<string, boolean | 'normal' | 'rescue'>;
  signature: string;
  replicaConsensus: boolean;
  replica: { disagreeing: string[]; replicas: ReplicaResult[]; reason: string };
};

function resolveManifestPath(manifestPath?: unknown): string {
  const requested = typeof manifestPath === 'string' && manifestPath.trim()
    ? manifestPath.trim()
    : DEFAULT_MANIFEST_PATH;
  if (path.isAbsolute(requested)) return requested;
  const fromCwd = path.resolve(process.cwd(), requested);
  if (existsSync(fromCwd)) return fromCwd;
  return path.resolve(import.meta.dirname, '../../../..', requested);
}

function sha256Hex(text: unknown): string {
  return crypto.createHash('sha256').update(typeof text === 'string' ? text : String(text)).digest('hex');
}

function readManifestText(manifestPath?: unknown): string {
  return readFileSync(resolveManifestPath(manifestPath), 'utf8');
}

function asSet(value: unknown): Set<string> {
  if (value instanceof Set) return value as Set<string>;
  if (Array.isArray(value)) return new Set(value.filter((entry): entry is string => typeof entry === 'string' && Boolean(entry.trim())));
  if (value && typeof value === 'object') {
    const set = new Set<string>();
    for (const [key, enabled] of Object.entries(value)) {
      if (Boolean(enabled) && typeof key === 'string' && key.trim()) set.add(key);
    }
    return set;
  }
  return new Set();
}

function normalizeReplicaInput(replica: ReplicaInput = {}): NormalizedReplica {
  const checks = asSet(replica.checks);
  const publicCapsRaw = replica.publicCaps ?? replica.public ?? replica.features ?? {};
  const publicCaps = publicCapsRaw instanceof Map
    ? new Map(Array.from(publicCapsRaw.entries()).filter(([_, value]) => Boolean(value)))
    : asSet(publicCapsRaw);
  return {
    id: typeof replica.id === 'string' && replica.id.trim() ? replica.id.trim() : REPLICA_UNKNOWN_LABEL,
    manifestDigest: typeof replica.manifestDigest === 'string' ? replica.manifestDigest.trim() : null,
    manifestSchemaVersion:
      Number.isFinite(replica.manifestSchemaVersion) ? Math.trunc(replica.manifestSchemaVersion as number) : null,
    contractVersion: typeof replica.contractVersion === 'string' ? replica.contractVersion.trim() : null,
    checks,
    public: publicCaps,
    ready: typeof replica.ready === 'boolean' ? replica.ready : null
  };
}

function buildNodeMap(manifest: CapabilityManifest): Map<string, CapabilityPublicNode> {
  const map = new Map<string, CapabilityPublicNode>();
  for (const node of manifest.publicKeys ?? []) {
    if (!node?.key) continue;
    map.set(node.key, node);
  }
  return map;
}

function normalizeInternalMap(manifest: CapabilityManifest): Map<string, CapabilityInternalNode> {
  const map = new Map<string, CapabilityInternalNode>();
  for (const node of manifest.internalPrerequisites ?? []) {
    if (!node?.key) continue;
    map.set(node.key, node);
  }
  return map;
}

function normalizeOperatorMap(manifest: CapabilityManifest): Map<string, CapabilityOperatorNode> {
  const map = new Map<string, CapabilityOperatorNode>();
  for (const node of manifest.operatorFlags ?? []) {
    if (!node?.key) continue;
    map.set(node.key, node);
  }
  return map;
}

function allCategoryReady(node: CapabilityPublicNode | undefined, category: ReadinessCategory, readinessSets: ReadinessSets): boolean {
  const requirements = node?.requires?.[category];
  const required: unknown[] = Array.isArray(requirements) ? requirements : [];
  const readySet = readinessSets[category];
  if (!readySet) return false;
  for (const token of required) {
    if (typeof token !== 'string' || !token.trim()) continue;
    if (!readySet.has(token)) return false;
  }
  return true;
}

function evaluatePublicNode(
  _manifest: CapabilityManifest,
  nodeByKey: Map<string, CapabilityPublicNode>,
  internalReady: Set<string>,
  options: ReadinessSets
): { readiness: Map<string, boolean>; cycle: Set<string> } {
  const memo = new Map<string, boolean>();
  const inStack = new Set<string>();
  const cycle = new Set<string>();

  const evaluate = (key: string): boolean => {
    if (memo.has(key)) return memo.get(key) as boolean;

    const node = nodeByKey.get(key);
    if (!node) {
      memo.set(key, false);
      return false;
    }
    if (inStack.has(key)) {
      cycle.add(key);
      memo.set(key, false);
      return false;
    }
    if (!options.desired?.[key]) {
      memo.set(key, false);
      return false;
    }

    inStack.add(key);
    for (const dependency of node.dependsOn || []) {
      const depNode = nodeByKey.get(dependency);
      if (!depNode) {
        memo.set(key, false);
        inStack.delete(key);
        return false;
      }
      const depValue = evaluate(dependency);
      if (!depValue) {
        memo.set(key, false);
        inStack.delete(key);
        return false;
      }
    }

    const categoryChecks: [ReadinessCategory, boolean][] = [
      ['binary', allCategoryReady(node, 'binary', options)],
      ['schema', allCategoryReady(node, 'schema', options)],
      ['index', allCategoryReady(node, 'index', options)],
      ['config', allCategoryReady(node, 'config', options)],
      ['api', allCategoryReady(node, 'api', options)],
      ['web', allCategoryReady(node, 'web', options)],
      ['visibility', allCategoryReady(node, 'visibility', options)],
      ['worker', allCategoryReady(node, 'worker', options)],
      ['internal', allCategoryReady(node, 'internal', { internal: internalReady })]
    ];

    inStack.delete(key);
    const ready = categoryChecks.every(([, value]) => value);
    memo.set(key, ready);
    return ready;
  };

  for (const key of PUBLIC_CAPABILITY_KEYS) {
    const node = nodeByKey.get(key);
    if (!node) {
      memo.set(key, false);
      continue;
    }
    evaluate(key);
  }

  return { readiness: memo, cycle: new Set([...memo].filter(([, value]) => value === false).length > 0 ? cycle : []) };
}

function replicaVectorFor(
  manifestDigest: string,
  manifestSchemaVersion: number,
  contractVersion: string | null,
  localFeatures: Record<string, boolean>,
  replica: { public?: Set<string> | Map<unknown, unknown> } | null | undefined
): string {
  const checks: string[] = [];
  checks.push(`digest=${manifestDigest}`);
  checks.push(`schema=${manifestSchemaVersion}`);
  checks.push(`contract=${contractVersion}`);
  const replicaPublic = replica?.public instanceof Set
    ? replica.public
    : replica?.public instanceof Map
      ? new Set(Array.from(replica.public.keys()))
      : new Set();

  for (const key of PUBLIC_CAPABILITY_KEYS) {
    const value = localFeatures[key] === true;
    const external = Boolean(replicaPublic.has(key));
    checks.push(`pub:${key}=${Number(value)}:${Number(external)}`);
  }

  const checksOrdered = [...checks].sort();
  return sha256Hex(checksOrdered.join('\n'));
}

function compareReplicas(
  manifest: { contractVersion: string; schemaVersion: number },
  localReport: { manifest: ReadinessManifest; signature: string; features: Record<string, boolean>; snapshotChecks?: unknown },
  replicas: ReplicaInput[] | undefined,
  { required = false }: { required?: boolean } = {}
): { consensus: boolean; disagreeing: string[]; replicas: ReplicaResult[] } {
  const normalizedReplicas = Array.isArray(replicas) && replicas.length ? replicas : [];
  const localFeatures = localReport.features;
  const localVector = localReport.signature;
  const localDigest = localReport.manifest?.digest || '';

  const replicaResults: ReplicaResult[] = [];
  const disagreeing = new Set<string>();

  if (required && normalizedReplicas.length === 0) {
    return {
      consensus: false,
      disagreeing: [...PUBLIC_CAPABILITY_KEYS],
      replicas: []
    };
  }

  for (let index = 0; index < Math.max(1, normalizedReplicas.length); index += 1) {
    const raw = normalizedReplicas[index] || {};
    const replica: NormalizedReplica = index === 0 && normalizedReplicas.length === 0 ? {
      id: 'api-primary',
      manifestDigest: localDigest,
      manifestSchemaVersion: manifest.schemaVersion || 1,
      contractVersion: manifest.contractVersion,
      checks: asSet(localReport.snapshotChecks),
      public: new Set(PUBLIC_CAPABILITY_KEYS.filter((key) => localFeatures[key]))
    } : normalizeReplicaInput(raw);

    const signature = replicaVectorFor(
      replica.manifestDigest || localDigest,
      replica.manifestSchemaVersion || manifest.schemaVersion || 1,
      replica.contractVersion || manifest.contractVersion,
      localFeatures,
      replica
    );

    const replicaKnownReady = localFeatures;
    const perKey: Record<string, boolean> = {};
    let replicaReady = true;
    let stale = false;

    if (!replica.manifestDigest || replica.manifestDigest !== localDigest) stale = true;
    if (replica.manifestSchemaVersion !== manifest.schemaVersion) stale = true;
    if (replica.contractVersion !== manifest.contractVersion) stale = true;
    if (normalizedReplicas.length > 0 && replica.ready !== true) stale = true;

    for (const key of PUBLIC_CAPABILITY_KEYS) {
      const localValue = Boolean(localFeatures[key]);
      const externalValue = replica.public.has(key);
      const ok = replicaKnownReady[key] === localValue && externalValue === localValue && !stale;
      perKey[key] = ok;
      if (!ok) {
        replicaReady = false;
        disagreeing.add(key);
      }
    }

    replicaResults.push({
      id: replica.id,
      signature,
      ready: replicaReady && !stale,
      stale,
      features: perKey
    });
  }

  const replicaReady = replicaResults.every((item) => item.ready && item.signature === localVector);

  return {
    consensus: replicaReady,
    disagreeing: Array.from(disagreeing),
    replicas: replicaResults
  };
}

function evaluateRawManifest(rawManifest: string) {
  const manifest = normalizeManifest(JSON.parse(rawManifest));
  if (!manifest) return null;
  return {
    manifest,
    manifestRaw: rawManifest,
    manifestDigest: sha256Hex(rawManifest),
    snapshotChecks: []
  };

}

function evaluateFromOptions(manifestPath: unknown, options: ReadinessOptions = {}) {
  const rawManifest = readManifestText(manifestPath);
  const parsed = evaluateRawManifest(rawManifest);
  if (!parsed) return null;

  const manifest = parsed.manifest;
  const manifestDigest = parsed.manifestDigest;
  const nodeByKey = buildNodeMap(manifest);
  const internalNodes = normalizeInternalMap(manifest);
  const operatorNodes = normalizeOperatorMap(manifest);

  const readinessInputs = {
    binary: asSet(options.binaryReady),
    schema: asSet(options.schemaReady),
    index: asSet(options.indexReady),
    config: asSet(options.configReady),
    api: asSet(options.apiReady),
    web: asSet(options.webReady),
    visibility: asSet(options.visibilityReady),
    worker: asSet(options.workerReady),
    internal: asSet(options.internalReady)
  };

  const desired: Record<string, boolean> = {};
  for (const key of PUBLIC_CAPABILITY_KEYS) {
    desired[key] = options?.desired?.[key] === true;
  }

  const knownInternalRequired = new Set<string>();
  for (const node of manifest.publicKeys || []) {
    for (const required of node.requires?.internal || []) {
      knownInternalRequired.add(required);
    }
  }
  for (const key of knownInternalRequired) {
    if (!internalNodes.has(key)) return null;
  }

  for (const key of PUBLIC_CAPABILITY_KEYS) if (!nodeByKey.has(key)) return null;

  const internalReady = toSet(Array.from(readinessInputs.internal));
  for (const internalKey of internalReady) {
    if (internalNodes.size && !internalNodes.has(internalKey) && internalKey.includes('.')) {
      return null;
    }
  }

  const { readiness: nodeReadyMap } = evaluatePublicNode(manifest, nodeByKey, internalReady, { ...readinessInputs, desired });

  const localFeatures: Record<string, boolean> = {};
  for (const key of PUBLIC_CAPABILITY_KEYS) {
    localFeatures[key] = Boolean(nodeReadyMap.get(key));
  }
  const signature = replicaVectorFor(manifestDigest, manifest.schemaVersion, manifest.contractVersion, localFeatures, {
    public: new Set(PUBLIC_CAPABILITY_KEYS.filter((key) => localFeatures[key]))
  });

  const operatorFlags: Record<string, boolean | 'normal' | 'rescue'> = {};
  for (const key of OPERATOR_KEYS) {
    const node = operatorNodes.get(key);
    if (!node) continue;
    const overrides = options.operatorFlags || {};
    const override = overrides[key];
    if (override === 'normal' || override === 'rescue') {
      operatorFlags[key] = override;
    } else {
      operatorFlags[key] = Boolean(overrides?.[key] ?? (node.default === true));
    }
  }

  const local = {
    manifest: {
      contractVersion: manifest.contractVersion,
      schemaVersion: manifest.schemaVersion,
      path: resolveManifestPath(manifestPath),
      digest: manifestDigest
    },
    features: localFeatures,
    operatorFlags,
    signature
  };

  return { ...local, rawManifest };
}

function createReadinessReport(manifestPath?: unknown, options: ReadinessOptions = {}): ReadinessReport {
  const evaluated = evaluateFromOptions(manifestPath, options);
  if (!evaluated) {
    throw new Error('Invalid capability manifest');
  }

  const consensus = compareReplicas(
    { contractVersion: evaluated.manifest.contractVersion, schemaVersion: evaluated.manifest.schemaVersion },
    {
      manifest: evaluated.manifest,
      signature: evaluated.signature,
      features: evaluated.features
    },
    options.replicas,
    { required: options.requireReplicaConsensus === true }
  );

  const effective: Record<string, boolean> = consensus.consensus
    ? { ...evaluated.features }
    : Object.fromEntries(PUBLIC_CAPABILITY_KEYS.map((key) => [key, false]));

  return {
    manifest: evaluated.manifest,
    features: effective,
    rawManifest: evaluated.rawManifest,
    operatorFlags: evaluated.operatorFlags,
    signature: evaluated.signature,
    replicaConsensus: consensus.consensus,
    replica: {
      disagreeing: consensus.disagreeing,
      replicas: consensus.replicas,
      reason: consensus.consensus ? REPLICA_AGREE_LABEL : 'disagreement'
    }
  };
}

function createReadinessProvider(options: { manifestPath?: unknown; getReadinessOptions?: () => ReadinessOptions } = {}) {
  const manifestPath = resolveManifestPath(options.manifestPath);
  const optionsProvider = typeof options.getReadinessOptions === 'function'
    ? options.getReadinessOptions
    : () => ({});
  const getSnapshot = () => {
    const currentOptions = optionsProvider();
    return createReadinessReport(manifestPath, currentOptions);
  };

  return { manifestPath, getSnapshot };
}

export {
  resolveManifestPath,
  readManifestText,
  createReadinessReport,
  createReadinessProvider,
  sha256Hex
};
