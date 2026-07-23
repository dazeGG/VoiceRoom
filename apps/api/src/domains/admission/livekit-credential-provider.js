'use strict';

const { URL } = require('node:url');
const { AccessToken, TrackSource } = require('livekit-server-sdk');
const { normalizeLiveKitServerUrl } = require('@voice-room/shared/runtime-config');

function createLiveKitCredentialProvider({
  apiKey,
  apiSecret,
  boundary,
  gateUrl,
  tokenTtlSeconds = 6 * 60 * 60
} = {}) {
  if (!boundary || typeof boundary.issueCredential !== 'function') throw new TypeError('credential boundary is required');
  const ttlSeconds = Math.max(60, Number(tokenTtlSeconds) || 6 * 60 * 60);

  async function issueAdmission({ roomId, livekitRoom, peerId, name = '', principal } = {}) {
    if (!apiKey || !apiSecret || !gateUrl || !roomId || !livekitRoom || !peerId || !principal) {
      return { status: 'unavailable', admission: null };
    }
    const gate = await boundary.issueCredential({ roomId, peerId, principal });
    if (gate.status !== 'issued') return { status: gate.status, admission: null };

    const token = new AccessToken(apiKey, apiSecret, {
      identity: peerId,
      metadata: JSON.stringify({ roomId }),
      name,
      ttl: ttlSeconds
    });
    token.addGrant({
      canPublish: true,
      canPublishData: true,
      canPublishSources: [TrackSource.MICROPHONE, TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO],
      canSubscribe: true,
      room: livekitRoom,
      roomJoin: true
    });
    const publicUrl = new URL(normalizeLiveKitServerUrl(gateUrl));
    publicUrl.searchParams.set('vr_gate_credential', gate.credential.value);
    return {
      status: 'issued',
      admission: {
        gateCredentialId: gate.credential.id,
        room: livekitRoom,
        token: await token.toJwt(),
        ttlSeconds,
        url: publicUrl.toString()
      }
    };
  }

  return Object.freeze({ issueAdmission });
}

module.exports = { createLiveKitCredentialProvider };
