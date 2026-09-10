export const CAPABILITY_CONTRACT: 'voice-room.capabilities/v1';
export const CAPABILITY_SCHEMA_VERSION: 1;

export const PUBLIC_CAPABILITY_KEYS: readonly string[];
export const INTERNAL_NODE_KEYS: readonly string[];
export const OPERATOR_KEYS: readonly string[];

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

export function normalizeManifest(manifest: unknown): CapabilityManifest | null;
export function isManifestValid(manifest: unknown): boolean;
export function toSet(values?: string[]): Set<string>;
export function toPublicKeySet(): Set<string>;
export function toInternalKeySet(): Set<string>;
export function toOperatorKeySet(): Set<string>;
