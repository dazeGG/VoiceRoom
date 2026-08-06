'use strict';

const crypto = require('node:crypto');
const { existsSync, readFileSync } = require('node:fs');
const path = require('node:path');
const {
  normalizeManifest,
  PUBLIC_CAPABILITY_KEYS,
  OPERATOR_KEYS,
  toSet
} = require('@voice-room/shared/capabilities');

const DEFAULT_MANIFEST_PATH = 'config/capability-dag.v1.json';

const REPLICA_UNKNOWN_LABEL = 'unknown';
const REPLICA_AGREE_LABEL = 'agree';

function resolveManifestPath(manifestPath) {
  const requested = typeof manifestPath === 'string' && manifestPath.trim()
    ? manifestPath.trim()
    : DEFAULT_MANIFEST_PATH;
  if (path.isAbsolute(requested)) return requested;
  const fromCwd = path.resolve(process.cwd(), requested);
  if (existsSync(fromCwd)) return fromCwd;
  return path.resolve(__dirname, '../../../..', requested);
}

function sha256Hex(text) {
  return crypto.createHash('sha256').update(typeof text === 'string' ? text : String(text)).digest('hex');
}

function readManifestText(path) {
  return readFileSync(resolveManifestPath(path), 'utf8');
}

function asSet(value) {
  if (value instanceof Set) return value;
  if (Array.isArray(value)) return new Set(value.filter((entry) => typeof entry === 'string' && entry.trim()));
  if (value && typeof value === 'object') {
    const set = new Set();
    for (const [key, enabled] of Object.entries(value)) {
      if (Boolean(enabled) && typeof key === 'string' && key.trim()) set.add(key);
    }
    return set;
  }
  return new Set();
}

function normalizeReplicaInput(replica = {}) {
  const checks = asSet(replica.checks);
  const publicCapsRaw = replica.publicCaps ?? replica.public ?? replica.features ?? {};
  const publicCaps = publicCapsRaw instanceof Map
    ? new Map(Array.from(publicCapsRaw.entries()).filter(([_, value]) => Boolean(value)))
    : asSet(publicCapsRaw);
  return {
    id: typeof replica.id === 'string' && replica.id.trim() ? replica.id.trim() : REPLICA_UNKNOWN_LABEL,
    manifestDigest: typeof replica.manifestDigest === 'string' ? replica.manifestDigest.trim() : null,
    manifestSchemaVersion:
      Number.isFinite(replica.manifestSchemaVersion) ? Math.trunc(replica.manifestSchemaVersion) : null,
    contractVersion: typeof replica.contractVersion === 'string' ? replica.contractVersion.trim() : null,
    checks,
    public: publicCaps,
    ready: typeof replica.ready === 'boolean' ? replica.ready : null
  };
}

function buildNodeMap(manifest) {
  const map = new Map();
  for (const node of manifest.publicKeys ?? []) {
    if (!node?.key) continue;
    map.set(node.key, node);
  }
  return map;
}

function normalizeInternalMap(manifest) {
  const map = new Map();
  for (const node of manifest.internalPrerequisites ?? []) {
    if (!node?.key) continue;
    map.set(node.key, node);
  }
  return map;
}

function normalizeOperatorMap(manifest) {
  const map = new Map();
  for (const node of manifest.operatorFlags ?? []) {
    if (!node?.key) continue;
    map.set(node.key, node);
  }
  return map;
}

function allCategoryReady(node, category, readinessSets) {
  const required = Array.isArray(node?.requires?.[category]) ? node.requires[category] : [];
  const readySet = readinessSets[category];
  if (!readySet) return false;
  for (const token of required) {
    if (typeof token !== 'string' || !token.trim()) continue;
    if (!readySet.has(token)) return false;
  }
  return true;
}

function evaluatePublicNode(manifest, nodeByKey, internalReady, options) {
  const memo = new Map();
  const inStack = new Set();
  const cycle = new Set();

  const evaluate = (key) => {
    if (memo.has(key)) return memo.get(key);

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

    const categoryChecks = [
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

function replicaVectorFor(manifestDigest, manifestSchemaVersion, contractVersion, localFeatures, replica) {
  const checks = [];
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

function compareReplicas(manifest, localReport, replicas) {
  const normalizedReplicas = Array.isArray(replicas) && replicas.length ? replicas : [];
  const localFeatures = localReport.features;
  const localVector = localReport.signature;
  const localDigest = localReport.manifest?.digest || '';

  const replicaResults = [];
  const disagreeing = new Set();

  for (let index = 0; index < Math.max(1, normalizedReplicas.length); index += 1) {
    const raw = normalizedReplicas[index] || {};
    const replica = index === 0 && normalizedReplicas.length === 0 ? {
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
    const perKey = {};
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

function evaluateRawManifest(rawManifest) {
  const manifest = normalizeManifest(JSON.parse(rawManifest));
  if (!manifest) return null;
  return {
    manifest,
    manifestRaw: rawManifest,
    manifestDigest: sha256Hex(rawManifest),
    snapshotChecks: []
  };

}

function evaluateFromOptions(manifestPath, options = {}) {
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

  const desired = {};
  for (const key of PUBLIC_CAPABILITY_KEYS) {
    desired[key] = options?.desired?.[key] === true;
  }

  const knownInternalRequired = new Set();
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

  const localFeatures = {};
  for (const key of PUBLIC_CAPABILITY_KEYS) {
    localFeatures[key] = Boolean(nodeReadyMap.get(key));
  }
  const signature = replicaVectorFor(manifestDigest, manifest.schemaVersion, manifest.contractVersion, localFeatures, {
    public: new Set(PUBLIC_CAPABILITY_KEYS.filter((key) => localFeatures[key])),
    manifestDigest,
    manifestSchemaVersion: manifest.schemaVersion,
    contractVersion: manifest.contractVersion
  });

  const operatorFlags = {};
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

function createReadinessReport(manifestPath, options = {}) {
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
    options.replicas
  );

  const effective = consensus.consensus
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

function createReadinessProvider(options = {}) {
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

module.exports = {
  resolveManifestPath,
  readManifestText,
  createReadinessReport,
  createReadinessProvider,
  sha256Hex
};
