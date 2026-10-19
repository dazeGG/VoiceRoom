// The avatar colour palette, kept as JSON so the API validator and the web
// tokens read the same list.

import visualIdentityJson from './visual-identity.json' with { type: 'json' };

// Every colour the palette may name, as a type. The JSON keeps their order and
// must list only these names (checked below).
const AVATAR_COLOR_NAMES = {
  blurple: true,
  violet: true,
  orchid: true,
  magenta: true,
  rose: true,
  coral: true,
  rust: true,
  amber: true,
  olive: true,
  green: true,
  teal: true,
  cyan: true,
  sky: true,
  blue: true,
  indigo: true,
  slate: true
} as const;

export type AvatarColorKey = keyof typeof AVATAR_COLOR_NAMES;

export function isAvatarColorKey(value: unknown): value is AvatarColorKey {
  return typeof value === 'string' && Object.hasOwn(AVATAR_COLOR_NAMES, value);
}

const avatarColorKeys = visualIdentityJson.AVATAR_COLOR_KEYS.filter(isAvatarColorKey);
// A colour added to the JSON alone must fail loudly, not vanish from the palette.
if (avatarColorKeys.length !== visualIdentityJson.AVATAR_COLOR_KEYS.length) {
  throw new Error('visual-identity.json names an avatar colour that AVATAR_COLOR_NAMES does not list');
}

const visualIdentity: { AVATAR_COLOR_KEYS: readonly AvatarColorKey[] } = { AVATAR_COLOR_KEYS: avatarColorKeys };

export default visualIdentity;
