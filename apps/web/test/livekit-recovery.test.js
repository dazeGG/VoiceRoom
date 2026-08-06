import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../src/lib/features/room/client/services/livekit-service.ts', import.meta.url), 'utf8');

test('fresh LiveKit replacement is a snapshot-gated coordinator one-shot with atomic candidate commit', () => {
  assert.match(source, /attemptFreshLiveKitReplacement[\s\S]*postJson\('\/api\/livekit-token'/);
  assert.match(source, /isCurrentRoomRecoveryEpoch\(epoch\)/);
  assert.match(source, /bindLiveKitRoomEvents\(candidate, eventCurrent\)/);
  assert.match(source, /state\.livekitRoom = candidate;\s*state\.localMicPublication = microphonePublication;\s*state\.localScreenPublications = screenPublications;/);
  assert.match(source, /oldRoom && oldRoom !== candidate[\s\S]*disconnectLiveKitRoomInstance\(oldRoom\)/);
  assert.match(source, /setRoomRecoveryLiveKitAdapter\(\{ attemptFreshReplacement: attemptFreshLiveKitReplacement \}\)/);
  assert.doesNotMatch(source, /attemptFreshLiveKitReplacement[\s\S]{0,800}setTimeout/);
});

test('current-room guards isolate stale LiveKit callbacks and candidate publications', () => {
  assert.match(source, /const current = \(\) => isCurrent\(\) && state\.livekitRoom === room/);
  assert.match(source, /RoomEvent\.Disconnected[\s\S]{0,120}if \(!current\(\)\) return;[\s\S]{0,160}notifyLiveKitDisconnected\(\)/);
  assert.match(source, /RoomEvent\.Reconnected[\s\S]{0,120}if \(!current\(\)\) return;[\s\S]{0,300}notifyLiveKitReconciled\(\)/);
  assert.match(source, /disposeCandidatePublications\(candidate, screenPublications\)/);
  assert.match(source, /state\.livekitRoom === room[\s\S]{0,160}state\.localMicPublication = null/);
});

test('recovery restores retained mic, screen, remote voice and screen demand without capture prompts', () => {
  assert.match(source, /publishLocalMicrophoneForRoom\(candidate, microphoneStream, isCurrent, false\)/);
  assert.match(source, /publishLocalScreenTracksForRoom\(candidate, screenStream, isCurrent\)/);
  assert.match(source, /syncMicrophonePublicationMuted\(publication\)/);
  assert.match(source, /retryDemandedScreenSubscriptions\(candidate\)/);
  assert.match(source, /syncLiveKitVoiceSubscriptions\(\)/);
  assert.match(source, /syncRemoteAudioPlayback\(\)/);
  assert.doesNotMatch(source, /attemptFreshLiveKitReplacement[\s\S]*getDisplayMedia/);
});

test('recovery logs are sanitized and never include candidate URLs, lists, raw errors or track SIDs', () => {
  assert.doesNotMatch(source, /LiveKit connected to \$\{url\}/);
  assert.doesNotMatch(source, /LiveKit connect failed for \$\{url\}/);
  assert.doesNotMatch(source, /urls\.join\(/);
  assert.doesNotMatch(source, /console\.warn\('LiveKit recovery failed', error\)/);
  assert.doesNotMatch(source, /Screen subscription failed.*trackSid/);
  assert.match(source, /livekit_recovery_transition/);
  assert.match(source, /candidateIndex, candidateCount: urls\.length, result:/);
});
