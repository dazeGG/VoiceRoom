import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const membershipModel = readFileSync(new URL('../src/lib/features/home/model/room-membership.svelte.ts', import.meta.url), 'utf8');
const voiceSession = readFileSync(new URL('../src/lib/features/room/voice-session.svelte.ts', import.meta.url), 'utf8');
const routes = readFileSync(new URL('../../api/src/domains/membership/membership-routes.js', import.meta.url), 'utf8');
const service = readFileSync(new URL('../../api/src/domains/membership/membership-service.js', import.meta.url), 'utf8');

test('G49-A01 leave-call preserves membership while leave-room uses the durable DELETE endpoint', async () => {
  const leaveCall = voiceSession.slice(
    voiceSession.indexOf('export async function leaveActiveVoiceRoomWithCue'),
    voiceSession.indexOf('export async function leaveConnectedRoomMembership')
  );
  expect(leaveCall).toMatch(/leaveActiveVoiceRoomWithCue[\s\S]*activeLeaveHandler\(\)/);
  expect(leaveCall).not.toContain('leaveActiveRoomMembership');
  expect(membershipModel).toMatch(/leaveActiveRoomMembership[\s\S]*leaveRoomMembership[\s\S]*clearRoomMembership/);
  expect(routes).toContain("app.delete('/api/rooms/:roomId/memberships/me'");
});

test('G49-A02 revoke/disconnect precedes delete, owner is guarded and rejoin remains an upsert', async () => {
  expect(routes.indexOf('prepareLeave')).toBeLessThan(routes.indexOf('membershipService.leaveRoom'));
  expect(routes).toContain('room_owner_cannot_leave');
  expect(service).toMatch(/leaveRoom[\s\S]*deleteActive/);
  expect(service).toMatch(/persistSuccessfulAdmission[\s\S]*upsertActive/);
});
