'use strict';

// Bot admission token.
//
// Deliberately NOT `issueAdmission` from
// `domains/admission/livekit-credential-provider.js`: that path is gate-bound.
// It requires a gate `principal`, burns a single-use gate credential, returns
// the public gate URL with `?vr_gate_credential=`, and pins `identity` to the
// peer id. None of that fits a server-side publisher that connects straight to
// the internal LiveKit URL.
//
// The grant below is the narrowest one that can still publish audio: one room,
// one source, no subscribe, no data. Compromising the most fragile container in
// the stack therefore yields access to exactly one room's audio publication.

const { AccessToken, TrackSource } = require('livekit-server-sdk');
const { RESERVED_PEER_ID_PREFIXES } = require('@voice-room/shared/validation');

// The bot connects the moment it receives the play request, so the credential is
// used within seconds of being minted. It is a plain bearer token with no gate
// binding and no single-use burn, and it travels cleartext to the bot over the
// compose network; anyone who observes one — a sidecar, a core dump, a debug log
// — can publish into that room as the music bot until it expires. Five minutes
// costs nothing and bounds that window; a resolve that outruns it fails the play
// and the item is simply retried with a fresh token.
const MUSIC_BOT_TOKEN_TTL_SECONDS = 5 * 60;

// Taken from the shared reserved list rather than re-typed: `normalizePeerId`
// rejects peer ids in this namespace, and the identity minted here lives inside
// it. Two copies of the string are exactly how the guard and the identity drift
// apart later, so there is only one.
const [MUSIC_BOT_IDENTITY_PREFIX] = RESERVED_PEER_ID_PREFIXES;

// The separator is `:` on purpose, and it is a security boundary rather than
// cosmetics. Client peer ids are caller-supplied and only have to satisfy
// `normalizePeerId`'s `/^[A-Za-z0-9_-]{8,80}$/`, so a `music-bot-<roomId>`
// identity was reachable by an ordinary participant: joining under it would
// evict the real bot and route that participant's screen-share audio into every
// client's music lane, invisible to the participant list, to per-peer mute and
// to kick. `:` is outside that character class, so no peer id can ever collide
// with a bot identity even if the reserved-prefix guard were removed. LiveKit
// itself treats the identity as an opaque string (JWT `sub`, JSON body of
// RemoveParticipant), and so does the bot, which reads it straight out of the
// play request.
function musicBotIdentityFor(roomId) {
  return `${MUSIC_BOT_IDENTITY_PREFIX}:${roomId}`;
}

async function mintMusicBotToken({
  apiKey,
  apiSecret,
  livekitRoom,
  identity,
  ttlSeconds = MUSIC_BOT_TOKEN_TTL_SECONDS
} = {}) {
  if (!apiKey || !apiSecret || !livekitRoom || !identity) return null;
  const token = new AccessToken(apiKey, apiSecret, {
    identity,
    name: 'Music',
    ttl: Math.max(60, Number(ttlSeconds) || MUSIC_BOT_TOKEN_TTL_SECONDS)
  });
  token.addGrant({
    canPublish: true,
    canPublishData: false,
    canPublishSources: [TrackSource.SCREEN_SHARE_AUDIO],
    canSubscribe: false,
    room: livekitRoom,
    roomJoin: true
  });
  return token.toJwt();
}

module.exports = {
  MUSIC_BOT_IDENTITY_PREFIX,
  MUSIC_BOT_TOKEN_TTL_SECONDS,
  mintMusicBotToken,
  musicBotIdentityFor
};
