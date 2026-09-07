export type AvatarColorKey =
  | 'blurple'
  | 'violet'
  | 'orchid'
  | 'magenta'
  | 'rose'
  | 'coral'
  | 'rust'
  | 'amber'
  | 'olive'
  | 'green'
  | 'teal'
  | 'cyan'
  | 'sky'
  | 'blue'
  | 'indigo'
  | 'slate';

export type PresenceStatus = 'online' | 'away' | 'dnd' | 'offline';

export const AVATAR_COLOR_KEYS: readonly AvatarColorKey[];

export const PASSWORD_MIN_LENGTH: number;
export const PASSWORD_MAX_LENGTH: number;
export const PRESENCE_STATUSES: readonly PresenceStatus[];
/** Lower-cased identity namespaces reserved for server-minted participants. */
export const RESERVED_PEER_ID_PREFIXES: readonly string[];
export const SCREEN_PROFILE_IDS: ReadonlySet<string>;

export function cleanAvatarColorKey(value: unknown): AvatarColorKey | '';
export function cleanDisplayName(value: unknown): string;
export function cleanLiveKitUrl(value: unknown): string;
export function cleanName(value: unknown): string;
export function cleanPresenceStatus(value: unknown): PresenceStatus | '';
export function cleanRoomName(value: unknown): string;
export function cleanScreenProfileId(value: unknown): string;
export function cleanStreamId(value: unknown): string;
/** True when the value falls inside a reserved system identity namespace. */
export function isReservedPeerId(value: unknown): boolean;
export function isValidPassword(value: unknown): boolean;
export function normalizeLogin(value: unknown): string;
export function normalizePeerId(value: unknown): string;
export function normalizeRoomId(value: unknown): string;
export function normalizeSessionToken(value: unknown): string;
