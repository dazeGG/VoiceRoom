// The avatar colour palette, kept as JSON so the API validator and the web
// tokens read the same list.

import type { AvatarColorKey } from './validation.ts';
import visualIdentityJson from './visual-identity.json' with { type: 'json' };

const visualIdentity: { AVATAR_COLOR_KEYS: readonly AvatarColorKey[] } = visualIdentityJson as { AVATAR_COLOR_KEYS: readonly AvatarColorKey[] };

export default visualIdentity;
