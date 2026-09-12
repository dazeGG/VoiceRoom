# Graph Report - .  (2026-09-12)

## Corpus Check
- Large corpus: 742 files · ~356 506 words. Semantic extraction will be expensive (many Claude tokens). Consider running on a subfolder, or use --no-semantic to run AST-only.

## Summary
- 5887 nodes · 16447 edges · 233 communities detected
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 6 edges (avg confidence: 0.73)
- Token cost: 0 input · 0 output
- Edge kinds: contains: 4396 · MODIFIES: 4115 · ON_BRANCH: 3375 · calls: 1788 · imports: 1095 · imports_from: 739 · PARENT_OF: 634 · method: 207 · re_exports: 59 · references: 23 · inherits: 9 · conceptually_related_to: 4 · semantically_similar_to: 2 · implements: 1


## Input Scope
- Requested: auto
- Resolved: committed (source: default-auto)
- Included files: 742 · Candidates: 822
- Excluded: 0 untracked · 47097 ignored · 13 sensitive · 0 missing committed
- Recommendation: Use --scope all or graphify.yaml inputs.corpus for a knowledge-base folder.

## Graph Freshness
- Built from Git commit: `a8bc6e3`
- Compare this hash to `git rev-parse HEAD` before trusting freshness-sensitive graph output.
## God Nodes (most connected - your core abstractions)
1. `sendJson()` - 76 edges
2. `createTestDatabase()` - 38 edges
3. `runMigrations()` - 36 edges
4. `readJsonBody()` - 32 edges
5. `RealtimeRecoveryController` - 30 edges
6. `requireSessionUser()` - 29 edges
7. `handleRoomChatPost()` - 25 edges
8. `getRoomStore()` - 23 edges
9. `resolveSessionUser()` - 21 edges
10. `createApiApp()` - 21 edges

## Surprising Connections (you probably didn't know these)
- `apps/CLAUDE.md` --references--> `docs/GIT_FLOW.md`  [EXTRACTED]
  apps/CLAUDE.md → .github/CLAUDE.md
- `Root CLAUDE.md` --references--> `docs/GIT_FLOW.md`  [EXTRACTED]
  CLAUDE.md → .github/CLAUDE.md
- `VoiceRoom App Icon (Owl Mascot Mark on Dark Rounded Square)` --semantically_similar_to--> `VoiceRoom Mascot Mark (Masked Owl Silhouette, Transparent)`  [INFERRED] [semantically similar]
  apps/web/static/voiceroom-icon.svg → apps/web/static/voiceroom-mascot.svg
- `apps/web/CLAUDE.md` --references--> `docs/GIT_FLOW.md`  [EXTRACTED]
  apps/web/CLAUDE.md → .github/CLAUDE.md
- `apps/CLAUDE.md` --conceptually_related_to--> `apps/web/CLAUDE.md`  [INFERRED]
  apps/CLAUDE.md → apps/web/CLAUDE.md

## Hyperedges (group relationships)
- **G01 Bootstrap Evidence Bootstrap/Seal/Backfill Flow** — script_recover_landed_bootstrap, script_emit_bootstrap_selection [INFERRED 0.75]
- **Release Evidence OCI Publish/Verify Pipeline** — workflow_release_evidence_producer, workflow_evidence_archive, workflow_evidence_archive_sentinel, script_run_oras [INFERRED 0.80]
- **Room Client Browser/Media Service Boundary Pattern** — screen_capture_service, screen_share_service, livekit_service_ts, microphone_service_ts, participants_ts, room_ts_coordinator [EXTRACTED 0.90]
- **2.5.0/2.6.0/2.7.0 Release Plan Lineage (Absorption)** — test_spec_release_250, release_260_plan, release_270_plan [EXTRACTED 0.90]

## Communities

### Community 0 - "Community 0"
Cohesion: 0.05
Nodes (317): backup/room-shared-music-pre-rebase, chore/graphify-refresh, develop, feature/2.5.0-manual-fixes, feature/2.5.0-to-rc, feature/account-sessions-recovery, feature/cd-pipeline, feature/desktop-app-settings (+309 more)

### Community 1 - "Community 1"
Cohesion: 0.01
Nodes (179): createFriendStore(), createMessageReadRepository(), registerPinRoutes(), { assertMigrationReady, runMigrations }, attachFastifyRequestBody(), AUTH_RATE_LIMIT, AUTH_RATE_WINDOW_MS, authLimiter (+171 more)

### Community 2 - "Community 2"
Cohesion: 0.02
Nodes (35): emojiAssetName(), emojiAssetUrl(), SelectedMention, 2d36bc7 fix(api): bound messaging schema locks, 728cea2 feat: implement release 2.5.0 messaging platform (#105), ab373a6 chore(release): 2.5.0 (#121), cbaf1f5 Merge branch 'feature/2.5.0-fixes' into develop, { createDbPool } (+27 more)

### Community 3 - "Community 3"
Cohesion: 0.03
Nodes (28): 043b73d chore: release v2.1.5, 2391bbe feat(web): migrate UI icons to Lucide (#42), 4497e53 Merge branch 'release/2.2.5', 4e4ea97 fix(web): unify room tile grid layout, 564c893 feat(web): support centered nine-tile room layout, 634b607 feat(web): prepare Voice Room 1.7.0, 8de78c2 Merge tag 'v2.2.5' into develop, 9976dab Merge tag 'v2.1.5' into develop (+20 more)

### Community 4 - "Community 4"
Cohesion: 0.04
Nodes (91): isRoomEmbedded(), extractRoomId(), clearPeerJoinCue(), ApiRequestError, checkRoomExists(), postJson(), cancelRoomRecovery(), isCurrentRoomRecoveryEpoch() (+83 more)

### Community 5 - "Community 5"
Cohesion: 0.03
Nodes (36): 01a206a chore: release v2.1.1, 0a0699b chore: release v2.1.2, 0a9be62 fix(web): keep room preview chat closed by default (#32), 0d30394 chore: merge v2.1.1 back to develop, 0d74cad Merge branch 'release/2.1.6', 0f3d7a0 Merge branch 'hotfix/2.1.3', 0ffac54 feat(infra): expose livekit prometheus metrics for status stack (#22), 1840f18 chore: release v2.1.4 (+28 more)

### Community 6 - "Community 6"
Cohesion: 0.04
Nodes (19): AvatarProps, AvatarCropDialogProps, AvatarCropShape, BadgeProps, ButtonProps, 13148b1 style(web): apply canonical background palette, 1594fb0 feat(web): refine chat and room interactions, 3db468e feat(web): Volt redesign — landing, lobby v2, shared UI (#38) (+11 more)

### Community 7 - "Community 7"
Cohesion: 0.04
Nodes (37): AuthUser, roomNameFor(), clearSession(), session, setUser(), syncRoomName(), 2b2c6c9 chore: release v2.0.0, 4a8d9fc fix(api): address room persistence review findings (+29 more)

### Community 8 - "Community 8"
Cohesion: 0.05
Nodes (70): deleteDirectMessage(), DirectMessageHistoryPage, DirectMessageInvite, editDirectMessage(), fetchThread(), fetchThreadPage(), HistoryMessageDto, markThreadRead() (+62 more)

### Community 9 - "Community 9"
Cohesion: 0.04
Nodes (43): del(), fetchJson(), patchJson(), postJson(), postJsonAuth(), putJson(), createRoomProof(), hasLeadingZeroBits() (+35 more)

### Community 10 - "Community 10"
Cohesion: 0.03
Nodes (57): b16c894 fix(api): expose fail-closed release telemetry, cc45703 fix(api): expose worker metrics across process boundaries, httpKey(), httpRequests, labels(), maintenanceTasks, mediaPressure, metricLine() (+49 more)

### Community 11 - "Community 11"
Cohesion: 0.04
Nodes (44): RoomRealtimeSummary, RoomPeer, AvatarStackItem, AvatarStackProps, 049a913 fix(web): keep popover open on ambiguous focus loss, 08bd491 fix(web): focus DM compose input when opening a friend chat (#28), 0c20745 chore(release): back-merge 2.1.9, 206a214 refactor(web): use shared slider in settings controls (+36 more)

### Community 12 - "Community 12"
Cohesion: 0.03
Nodes (50): 1578df6 feat: add account settings, 208f295 feat(presence): add selectable account statuses, 22a796b Merge pull request #8 from feature/404-page, 3580978 fix(api): harden session and cookie write security, cc7f297 Merge pull request: chore private monitoring agent, ec9f802 feat(api): persist visual identity keys, fe15e8b chore: add private monitoring agent, { AVATAR_COLOR_KEYS, cleanAvatarColorKey, cleanPresenceStatus } (+42 more)

### Community 13 - "Community 13"
Cohesion: 0.04
Nodes (46): fa382b2 fix(api): derive backlog age directly from storage, createDbPool(), { Pool }, { readDatabaseConfig }, { recordPgPoolError }, transaction(), recordPgPoolError(), { classifyPlatform, PLATFORM_CLASSES } (+38 more)

### Community 14 - "Community 14"
Cohesion: 0.06
Nodes (58): dbToAmplitude(), persistMicrophoneVolume(), MicProcessor, MicrophoneCapture, applySpeaking(), attachMeter(), isLocalMicrophoneSpeaking(), isOverSpeakingThreshold() (+50 more)

### Community 15 - "Community 15"
Cohesion: 0.04
Nodes (49): CONTEXTS, createAttachmentRepository(), crypto, mapAttachment(), MIME_TYPES, assert, { createAttachmentRepository }, { createTestDatabase } (+41 more)

### Community 16 - "Community 16"
Cohesion: 0.04
Nodes (19): e0eb12c chore(release): prepare 2.4.0, reconcileAvatarStorage(), MascotIconProps, MascotVariant, AvatarAccentPresentation, AvatarAccentRgb, assert, { deriveAvatarAccent, dominantAvatarColor } (+11 more)

### Community 17 - "Community 17"
Cohesion: 0.06
Nodes (44): 31409db style(web): restore dock device popover chrome, 3f83f05 Merge branch 'release/2.2.0', 4cfb160 chore(release): bump version to 2.2.0, 6113243 chore(release): bump version to 2.1.11, 7524c15 feat(realtime): add websocket room updates, 81d9540 Merge tag 'v2.1.11' into develop, beffc4f Merge tag 'v2.2.0' into develop, ff9ac77 Merge branch 'release/2.1.11' (+36 more)

### Community 18 - "Community 18"
Cohesion: 0.04
Nodes (40): 05f2a77 test(api): bind strict credential cutover, 19902ab feat: prepare 2.5.0 RC and polish chats (#114), 501ef14 test(web): lock leave and rejoin flow, 849600b fix(api): persist membership after admission, d9f484d test(engagement): prove content and mention UoW, ebd3ed4 test(release): define G50 membership checkpoint, model, membershipModel (+32 more)

### Community 19 - "Community 19"
Cohesion: 0.09
Nodes (47): clampStreamVolume(), getStoredStreamVolume(), normalizeStoredStreamVolume(), storeStreamVolume(), clearScreenAttendance(), setScreenAttendance(), releaseScreenMediaElement(), activateScreenStageUi() (+39 more)

### Community 20 - "Community 20"
Cohesion: 0.05
Nodes (34): {
  buildHistoryEnvelope,
  normalizeHistoryRequest
}, canonicalParticipants(), createDmHistoryService(), DmHistoryError, createMessageReadService(), MessageReadError, {
  buildHistoryEnvelope,
  normalizeHistoryRequest
}, createRoomHistoryService() (+26 more)

### Community 21 - "Community 21"
Cohesion: 0.06
Nodes (40): 1886650 feat(api): persist rooms and chat in postgres, 364b82c build(api): fence G15 predeploy migrations, 53d093e test(api): execute hostile credential boundary scenarios, 8fdccbd chore(scripts): default to docker compose workflows, a36adca chore(docker): add postgres compose workflows, c928af9 fix(api): require exact migration catalog readiness, d02ad7f fix(release): resolve evidence from immutable external artifacts, f124c57 fix(web): verify reaction boundaries through rendered UI (+32 more)

### Community 22 - "Community 22"
Cohesion: 0.07
Nodes (41): a0ff17a feat(web): improve sound settings with sliders and cue volume (#30), MicrophoneMode, NOISE_MODES, NoiseMode, NoiseModeOption, SCREEN_QUALITY_ORDER, ScreenFpsOption, ScreenQualityOption (+33 more)

### Community 23 - "Community 23"
Cohesion: 0.07
Nodes (48): activeTargetSuppresses(), actorLabel(), BrowserNotificationPayload, buildNotificationPayload(), canUseNotifications(), cleanupMemoryDedupe(), consumeNotificationDedupeKey(), dedupeStorageKey() (+40 more)

### Community 24 - "Community 24"
Cohesion: 0.08
Nodes (42): 9c3b5e4 feat(audio): add unified playback bus (#54), getParticipantAudioPreferenceKey(), getStoredMasterVolume(), applyAudioBusOutput(), AudioBusGraph, AudioBusKind, busNode(), connectDefaultOutput() (+34 more)

### Community 26 - "Community 26"
Cohesion: 0.07
Nodes (38): eventMatchesHotkey(), getDefaultHotkeyBinding(), getHotkeyStorageKey(), HotkeyAction, isTypingTarget(), parseHotkeyBinding(), readHotkeyBinding(), writeHotkeyBinding() (+30 more)

### Community 27 - "Community 27"
Cohesion: 0.14
Nodes (49): broadcastDmNotification(), broadcastToUser(), checkPushSubscriptionRate(), cleanPushSubscription(), cleanUuid(), expireRoomInvitations(), getFriendStore(), getMessageService() (+41 more)

### Community 28 - "Community 28"
Cohesion: 0.08
Nodes (48): attachMediaProjection(), attachReplyProjection(), cleanChatText(), cleanDmText(), createApiApp(), createFastifyLoggerOptions(), dispatchMessageDeliveryEvent(), fastify (+40 more)

### Community 29 - "Community 29"
Cohesion: 0.08
Nodes (35): fetchNotificationPreferences(), normalizePreferences(), NotificationMuteResponse, NotificationPreferences, NotificationPreferencesResponse, RoomNotificationLevel, setDmNotificationsMuted(), setDoNotDisturb() (+27 more)

### Community 30 - "Community 30"
Cohesion: 0.04
Nodes (2): 13254ae docs: document durable room storage, c860746 feat(web): add static rooms and room chat UI

### Community 31 - "Community 31"
Cohesion: 0.10
Nodes (45): 1a5009b fix(web): remove transient voice-connecting placeholder, 56ebf7a docs: document root-scoped omx runtime usage, 6895206 fix(web): remove desktop app region from topbar, 8b5b175 chore: merge v2.0.1 back to develop, cef76ec chore: release v2.0.1, e9dccb2 fix(web): recover remote microphone playback, applyRemoteScreenCue(), applyStreamViewerCue() (+37 more)

### Community 32 - "Community 32"
Cohesion: 0.05
Nodes (34): 69b709a test(shared): correct platform DTO assertion, 74df7a9 fix(api): revoke only failed admission credential, 760fdfe fix(api): remediate oversized attachments before validation, 88169aa fix(api): preserve migration history with corrective follow-ups, 88e8e93 test(release): define physical support matrix gate, b318c49 test(web): prove desktop root boundary, c4b1a22 test(api): enforce exact migration lock budget, edf6daf test(api): prove platform class migration (+26 more)

### Community 33 - "Community 33"
Cohesion: 0.06
Nodes (29): 02d78bc Merge pull request #69 from dazeGG/hotfix/2.4.2-backmerge, 6cd4b30 fix(web): stabilize screen sharing in 2.4.2 (#68), cf1ea14 chore(release): back-merge 2.4.2 into develop, getScreenPublicationPresence(), ScreenPublicationPresence, getScreenReceiverDemand(), ScreenReceiverDemand, createScreenSubscriptionRetryController() (+21 more)

### Community 34 - "Community 34"
Cohesion: 0.08
Nodes (30): 2c5f8d4 feat(web): show stream quality on tile thumbnails, 4c756b6 Merge branch 'release/2.2.6', 7b8da98 feat(web): add the room music player, 7f48829 feat(web): render visual identity tokens, aaef77d fix(web): move stream metadata onto thumbnails, ca162ce build: ship music-bot as a published runtime image, ce89791 feat(web): add the room music player, createPeerId() (+22 more)

### Community 35 - "Community 35"
Cohesion: 0.08
Nodes (38): 08e3e13 Merge branch 'hotfix/2.2.1', 0ec8255 chore(release): bump version to 2.2.3, 17edd27 feat(web): add lobby voice controls widget, 2adaec0 Merge branch 'hotfix/2.2.3-ci', 397400d chore(release): bump version to 2.2.2, 3b6010b Merge branch 'release/2.2.2', 3ce55ad fix(web): dedupe self avatar and drop count label in room list, 52c6592 Merge tag 'v2.2.1' into develop (+30 more)

### Community 36 - "Community 36"
Cohesion: 0.08
Nodes (36): 09c4d42 feat(shared): add the room shared-music wire contract, 6eb964c feat(shared): add the room shared-music wire contract, eb7ef3a fix(web): avoid cjs validation import in ssr, buildRoomRealtimeSummary(), buildServerEnvelope(), isPlainObject(), KNOWN_CLIENT_TYPES, { normalizeRoomId, normalizePeerId, normalizeSessionToken, cleanName } (+28 more)

### Community 37 - "Community 37"
Cohesion: 0.06
Nodes (34): 2a9aa5b test(api): prove media quota and worker safety, 575dc80 fix(api): align private media boundaries, createMediaService(), detectExactContainer(), FORMAT_MIME, MediaServiceError, PNG_END, readBounded() (+26 more)

### Community 38 - "Community 38"
Cohesion: 0.08
Nodes (29): 48b24e0 fix: room notifications for all members, desktop badge, unread for new members, b6c5445 fix(api): reuse account avatar color in calls, c6c3247 fix: room notifications for all members, desktop badge and unread for new members (#129), d6b1773 chore(release): back-merge 2.5.6 into develop, {
  AVATAR_COLOR_KEYS,
  cleanAvatarColorKey
}, avatarColorForPeerId(), { createActiveBanService }, { createDbPool, transaction } (+21 more)

### Community 39 - "Community 39"
Cohesion: 0.06
Nodes (32): ac8e530 fix(notifications): persist explicit all room level, d56e835 fix(notifications): preserve conservative room policy, api, prefs, { cleanPresenceStatus }, { createDbPool, transaction }, createNotificationStore(), crypto (+24 more)

### Community 40 - "Community 40"
Cohesion: 0.05
Nodes (1): edf009e feat(web): add desktop autostart settings

### Community 41 - "Community 41"
Cohesion: 0.08
Nodes (30): createMessageReplyHandlers(), registerMessageReplyRoutes(), REPLY_CONFLICT_BODY, { ReplyTargetUnavailableError }, isInvitation(), isReplyTargetKindAllowed(), isUnavailable(), messageId() (+22 more)

### Community 42 - "Community 42"
Cohesion: 0.10
Nodes (36): DesktopAudioCapture, DesktopPickerSelection, ScreenSourceSelection, applyScreenCaptureProfile(), CaptureAttemptDetail, CaptureError, createBrowserDisplayMediaConstraints(), createDesktopAudioContext() (+28 more)

### Community 43 - "Community 43"
Cohesion: 0.13
Nodes (10): classifyRecoveryFailure(), DEFAULT_RETRY_DELAYS_MS, elapsedBucket(), RealtimeRecoveryController, RETRYABLE_CODES, SAFE_CODES, sanitizeRecoveryCode(), TERMINAL_CODES (+2 more)

### Community 44 - "Community 44"
Cohesion: 0.08
Nodes (9): 2ea3623 Merge pull request #116 from dazeGG/feature/2.5.0-manual-fixes, c80ed8a feat(web): expand contextual menus, ProfileCardAnchor, profileCardUi, ProfileCardPerson, ProfileCardProps, ProfileCardRelationship, ReactionEmojiGroup (+1 more)

### Community 45 - "Community 45"
Cohesion: 0.09
Nodes (18): AttachmentApiError, AttachmentContext, AttachmentDraft, AttachmentDraftState, createAttachmentSlot(), deleteAttachment(), Envelope, getAttachmentStatus() (+10 more)

### Community 46 - "Community 46"
Cohesion: 0.05
Nodes (2): 3c617ec style(web): polish dm day separator, 7db2783 docs(monitoring): align LiveKit track metric labels

### Community 47 - "Community 47"
Cohesion: 0.08
Nodes (7): installDomRuntime(), TestDocument, TestElement, TestEvent, TestKeyboardEvent, TestNode, TestText

### Community 48 - "Community 48"
Cohesion: 0.10
Nodes (38): authorizeRoomMutation(), broadcast(), broadcastRoomUpdate(), broadcastUserProfileToFriends(), checkAvatarUploadRate(), closePeer(), countRoomCreationQuotaRoomsForIp(), disconnectModeratedPeer() (+30 more)

### Community 49 - "Community 49"
Cohesion: 0.09
Nodes (27): AccountSecurity, addRoomByCode(), authPost(), authRead(), avatarRequest(), changePassword(), Credentials, deleteUserAvatar() (+19 more)

### Community 50 - "Community 50"
Cohesion: 0.08
Nodes (30): containsPath(), createCoordinatedSnapshot(), filesBelow(), resolvedProspectivePath(), sha256(), 06b943b fix(ops): bind media restore catalog, 1332815 feat(ops): add coordinated media restore, 94552a2 test(release): fail closed at develop entry (+22 more)

### Community 51 - "Community 51"
Cohesion: 0.06
Nodes (25): c02e107 fix(web): recover attachment compose safely, cf49285 fix(api): reconcile media across replicas, d37be0b feat(api): expose media pressure health, composer, dm, room, store, css (+17 more)

### Community 52 - "Community 52"
Cohesion: 0.07
Nodes (27): 10de220 test(api): prove active ban expiry in PostgreSQL, 177f5e3 test(api): prove durable message delivery, 93cad8e test(release): define G42 messaging checkpoint, path, readEnvBool(), readEnvInt(), readMessageDeliveryMode(), abortError() (+19 more)

### Community 53 - "Community 53"
Cohesion: 0.06
Nodes (25): playbackPolicy, c948bb7 feat(notifications): add do not disturb settings (#53), assert, { createFriendStore, orderedPair }, { createTestDatabase }, { createUserStore }, crypto, { runMigrations } (+17 more)

### Community 54 - "Community 54"
Cohesion: 0.06
Nodes (26): AVATAR_KEY_PATTERN, createAvatarStorage(), fs, path, { readUploadsDir }, validateAvatarKey(), readUploadsDir(), assert (+18 more)

### Community 55 - "Community 55"
Cohesion: 0.08
Nodes (24): recordMediaOldestPending(), createMediaJobRepository(), crypto, JOB_KINDS, mapMediaJob(), MediaJobFenceError, assert, { DEFAULTS, createMediaProcessingWorker, retryDelay } (+16 more)

### Community 56 - "Community 56"
Cohesion: 0.09
Nodes (29): assertReactionEmoji(), cleanReactionEmoji(), EMOJI_REACTION_AUTHORITY, buildGroups(), GROUP_ANCHORS, listReactionEmojiGroups(), { listReactionEmojis }, reactionEmojiGroupKey() (+21 more)

### Community 57 - "Community 57"
Cohesion: 0.08
Nodes (13): AppRealtimeConnection, connectRealtime(), getAppRealtime(), PinsRealtimeEvent, ReactionRealtimeEvent, RealtimeAccountEvent, RealtimeErrorEvent, RealtimeEvent (+5 more)

### Community 58 - "Community 58"
Cohesion: 0.09
Nodes (25): 5d910ea fix(notifications): fail closed on provider errors, cleanPushEndpoint(), crypto, describePushEndpoint(), EXACT_PUSH_HOSTS, isAllowedPushHost(), { cleanPushEndpoint, describePushEndpoint }, createPushService() (+17 more)

### Community 60 - "Community 60"
Cohesion: 0.08
Nodes (21): authorize(), { createGateCredentialSigner }, createMemoryGateStore(), extractCredential(), mint(), readTopologyEvidence(), require, runAuthGateProof() (+13 more)

### Community 61 - "Community 61"
Cohesion: 0.08
Nodes (25): { createReadinessReport, resolveManifestPath }, createRuntimeReadinessProvider(), { createRuntimeReadinessRepository }, failClosedSnapshot(), { PUBLIC_CAPABILITY_KEYS }, createRuntimeReadinessRepository(), { createDbPool }, { createRuntimeReadinessRepository } (+17 more)

### Community 62 - "Community 62"
Cohesion: 0.10
Nodes (22): 4ea02ee fix(api): harden temporary moderation flows, attachmentRevoker(), cleanupEnqueuer(), createMessageModerationService(), requireOperation(), { transaction }, createModerationRepository(), crypto (+14 more)

### Community 63 - "Community 63"
Cohesion: 0.07
Nodes (5): RealtimeHeartbeatWatchdog, lang, 925763f feat(web): security settings, recovery by code and the 2.6.0 onboarding, a8bc6e3 docs: describe signed-in devices, recovery codes and the GeoIP database, webRoot

### Community 64 - "Community 64"
Cohesion: 0.12
Nodes (19): 164b853 refactor(web): neutral input placeholders, dedicated dev port, desktop drag region (#16), 65f8383 chore: removed status agent file, 67b668e chore: merge v2.0.2 back to develop, b3728e3 feat: add guest name modal for room entry, b48e553 chore: release v2.0.2, e2dc193 chore: removed agents md, cleanDisplayName(), clearPendingGuestNameRequest() (+11 more)

### Community 65 - "Community 65"
Cohesion: 0.08
Nodes (20): 2d08528 chore(release): back-merge 2.5.1 into develop, b3c2b1d fix(api): make users who added a room its members (#122), assert, { createTestDatabase }, fs, http, os, path (+12 more)

### Community 66 - "Community 66"
Cohesion: 0.12
Nodes (26): 234177e feat(web): redesign screen source picker, 9ba8ece feat(web): tune screen share encoding, SCREEN_FPS_OPTIONS, SCREEN_QUALITY_OPTIONS, SCREEN_SIMULCAST_LAYER, SCREEN_STREAM_MODE_PROFILES, ScreenProfile, ScreenStreamMode (+18 more)

### Community 67 - "Community 67"
Cohesion: 0.08
Nodes (18): 54086b4 fix(api): serialize notification retraction revisions, b3732be fix(notifications): make inbox revisions monotonic, model, router, ui, inbox, reconcile, room (+10 more)

### Community 68 - "Community 68"
Cohesion: 0.08
Nodes (21): da2ffb3 fix(release): stabilize G01-G03 foundation gates (#112), extensions, files, path, socketPathForDirectory(), assert, { createApiServer }, createFriends() (+13 more)

### Community 69 - "Community 69"
Cohesion: 0.17
Nodes (18): dm, picker, reactors, room, store, summary, authDialog(), createPermanentRoom() (+10 more)

### Community 70 - "Community 70"
Cohesion: 0.09
Nodes (20): createMembershipRepository(), crypto, mapDirectoryMember(), mapMembership(), toMillis(), registerMembershipRoutes(), { createMembershipRepository }, createMembershipService() (+12 more)

### Community 71 - "Community 71"
Cohesion: 0.09
Nodes (19): 40320f3 fix(release): authenticate oci evidence producers, 6b3fc40 fix(release): require canonical merge commit authority, ae1827c fix(reactions): converge updates across realtime clients, ff08a8e test(api): exercise gate through postgres and network boundaries, createReactionRealtimeAdapter(), registerReactionRoutes(), createReactionService(), normalizeConversation() (+11 more)

### Community 72 - "Community 72"
Cohesion: 0.09
Nodes (19): NotificationInboxTransport, buildNotificationEnvelope(), buildProviderPayload(), cleanString(), NotificationEnvelope, NotificationItem, NotificationLevel, NotificationReason (+11 more)

### Community 73 - "Community 73"
Cohesion: 0.13
Nodes (22): deletePushSubscription(), fetchPushConfig(), PushConfig, savePushSubscription(), decodeVapidKey(), detachPushSubscription(), getRegistration(), isDesktopRuntime() (+14 more)

### Community 74 - "Community 74"
Cohesion: 0.10
Nodes (18): 1709ead fix(api): centralize active room ban enforcement, createActiveBanRepository(), crypto, mapActiveBan(), normalizePrincipal(), toMillis(), { createActiveBanRepository, normalizePrincipal }, createActiveBanService() (+10 more)

### Community 75 - "Community 75"
Cohesion: 0.11
Nodes (19): RoomSnapshot, acknowledgeActiveVoiceResync(), clearActiveResync(), detailHandlers, ensureAppRealtimeConnected(), ensureReconnectRestore(), isRetryableActiveResyncError(), joinVoiceRoom() (+11 more)

### Community 76 - "Community 76"
Cohesion: 0.09
Nodes (18): 2d8eac5 test(messaging): lock G20-G23 contracts, cb7ad0e feat(api): fence message delivery cutover, createMessageService(), { createMessageVisibilityService }, createMessageVisibilityService(), MessageVisibilityError, assert, history (+10 more)

### Community 77 - "Community 77"
Cohesion: 0.12
Nodes (21): persistMicrophoneMode(), persistOutputMuted(), hasLocalScreenAudio(), postState(), supportsAudioOutputSelection(), beginPushToTalk(), CallControlsView, endPushToTalk() (+13 more)

### Community 78 - "Community 78"
Cohesion: 0.15
Nodes (23): ParsedScreenStats, ScreenStatsPrevious, unpublishLocalScreenTracks(), setLocalAppAudioSuppressed(), applyLocalScreenEncodingProfile(), applyLocalScreenProfileState(), applyScreenSenderEncoding(), findLocalScreenVideoPublication() (+15 more)

### Community 79 - "Community 79"
Cohesion: 0.15
Nodes (22): asSet(), buildNodeMap(), compareReplicas(), createReadinessProvider(), createReadinessReport(), crypto, evaluateFromOptions(), evaluatePublicNode() (+14 more)

### Community 80 - "Community 80"
Cohesion: 0.11
Nodes (17): checkApiSources(), findSqlWrites(), findTimers(), globToRegExp(), isOwner(), normalizePath(), walkFiles(), checkImportBoundaries() (+9 more)

### Community 81 - "Community 81"
Cohesion: 0.09
Nodes (18): 335132e feat(shared): add the account security contract, boundedText(), CLIENT_RULES, AccountSession, OnboardingKey, RecoveryCodesStatus, UserAgentDescription, formatRecoveryCode() (+10 more)

### Community 82 - "Community 82"
Cohesion: 0.11
Nodes (10): ReadReconciliationOptions, 4553c35 fix(web): reconcile repeated cross-tab read cursors, 8e66057 fix(ci): fail release gates on wrong branch, a2ee398 test(api): prove messaging pagination and reads, d8e3847 test(web): prove messaging reconciliation flows, fcd0beb fix(ci): bind OCI evidence to Actions archive bytes, FakeBroadcastChannel, loadMessagingModule() (+2 more)

### Community 83 - "Community 83"
Cohesion: 0.10
Nodes (11): registerMediaRoutes(), assert, { createMediaVisibilityService }, fastify, { registerMediaRoutes }, test, assert, createApp() (+3 more)

### Community 85 - "Community 85"
Cohesion: 0.16
Nodes (21): clearAllPeerJoinCues(), clearStreamViewerCues(), CueNote, getCueGain(), isCuePlaybackSuppressed(), peerJoinCueTimes, playCueSequence(), playDirectMessageCue() (+13 more)

### Community 86 - "Community 86"
Cohesion: 0.17
Nodes (22): buildSessionCookie(), clearSessionCookie(), endAccountSessionConnections(), getGeoLocator(), getSessionToken(), getUserStore(), handleAccountSecurity(), handleChangePassword() (+14 more)

### Community 87 - "Community 87"
Cohesion: 0.11
Nodes (17): 0b4c646 feat(platform): enforce G14 capability readiness, 5459a43 feat(platform): harden G13 runtime configuration edge, createCapabilitySnapshot(), formatCapabilityPayload(), HEALTH_CAPABILITIES_LIMITS, { PUBLIC_CAPABILITY_KEYS }, publicFeatureFlags(), registerCapabilityRoutes() (+9 more)

### Community 88 - "Community 88"
Cohesion: 0.12
Nodes (16): acceptFirstRequest(), assert, befriend(), cookieFrom(), { createTestDatabase }, fs, http, { openWs, waitForWsType } (+8 more)

### Community 89 - "Community 89"
Cohesion: 0.11
Nodes (15): acceptFirstRequest(), assert, befriend(), cookieFrom(), { createTestDatabase }, fs, http, { joinVoiceRoom, openWs: openHarnessWs, subscribeRoomPreview, waitForWsType } (+7 more)

### Community 90 - "Community 90"
Cohesion: 0.15
Nodes (8): conversationKey(), createReplyStore(), normalizeTarget(), ReplyAuthor, ReplyConversation, ReplySendInput, ReplyStore, ReplyTarget

### Community 91 - "Community 91"
Cohesion: 0.13
Nodes (16): 7609180 fix(web): harden reaction convergence, 824382d test(release): define G71 engagement checkpoint, ac1c7f4 fix(api): allow safe guest reaction reads, ad596da test(api): prove reaction persistence invariants, d43fd78 fix(shared): accept signed reactor cursors, cleanCursor(), cleanId(), { cleanReactionEmoji } (+8 more)

### Community 92 - "Community 92"
Cohesion: 0.11
Nodes (15): a0fa2d6 feat(api): drive room shared-music sessions, edcdda0 feat(music-bot): add the shared-music bot backed by yt-dlp, parseInboundMessage(), { buildServerEnvelope, buildServerErrorEnvelope, parseInboundMessage }, createWsHandler(), {
  normalizePeerId,
  normalizeRoomId,
  normalizeSessionToken
}, assert, createHandler() (+7 more)

### Community 93 - "Community 93"
Cohesion: 0.12
Nodes (14): assert, buildApp(), { createApiApp, createApiServer }, createFakeFriends(), createFakeStore(), createFakeUsers(), fs, http (+6 more)

### Community 94 - "Community 94"
Cohesion: 0.15
Nodes (14): CapabilityFeatures, CapabilityKey, CapabilityResponse, isCapabilityReady(), loadCapabilities(), resetCapabilities(), CapabilityEdge, CapabilityState (+6 more)

### Community 95 - "Community 95"
Cohesion: 0.11
Nodes (12): 20fdff5 feat(api): persist static rooms and chat, assert, { createTestDatabase }, fs, http, { openWs, joinVoiceRoom, subscribeRoomPreview, waitForWsType }, os, path (+4 more)

### Community 96 - "Community 96"
Cohesion: 0.11
Nodes (13): createRoomStore(), assert, { createPinRepository }, { createPinService }, { createRoomStore }, { createTestDatabase }, { createUserStore }, Fastify (+5 more)

### Community 97 - "Community 97"
Cohesion: 0.17
Nodes (18): { AccessToken, TrackSource }, assertCase(), { createDbPool }, { createGateCredentialSigner }, { createRoomStore }, directLocalhostPortClosed(), mintCredentials(), openWebSocket() (+10 more)

### Community 98 - "Community 98"
Cohesion: 0.13
Nodes (12): actorLockKey(), boundedString(), createMessageIdempotencyRepository(), crypto, encodeParts(), IdempotencyConflictError, IdempotencyQuotaError, ledgerKey() (+4 more)

### Community 99 - "Community 99"
Cohesion: 0.20
Nodes (16): flipPlacementVertical(), parsePlacement(), resolvePopoverPlacement(), viewportSpaceAroundTrigger(), PlacementAxis, PopoverCloseReason, PopoverContentState, PopoverDividerProps (+8 more)

### Community 101 - "Community 101"
Cohesion: 0.25
Nodes (19): applyRemoteScreenVideoDemand(), attachSubscribedRemoteScreenTrack(), clearScreenSubscriptionRetry(), ensureRemoteMicrophonePlayback(), getRemoteScreenDemand(), handleLiveKitTrackSubscribed(), handleLiveKitTrackSubscriptionFailed(), handleLiveKitTrackUnpublished() (+11 more)

### Community 102 - "Community 102"
Cohesion: 0.16
Nodes (16): buildModerationPage(), cleanString(), durationToExpiresAt(), MODERATION_DURATION_MS, MODERATION_DURATIONS, normalizeActiveBan(), normalizeBanDuration(), normalizeBanMutation() (+8 more)

### Community 103 - "Community 103"
Cohesion: 0.13
Nodes (17): assert, cookieFrom(), { createTestDatabase }, fs, getSocketPath(), http, me(), { openWs } (+9 more)

### Community 104 - "Community 104"
Cohesion: 0.11
Nodes (12): assert, { createTestDatabase }, fs, http, { openWs, joinVoiceRoom, sendWs, waitForWsType }, os, path, { socketPathForDirectory } (+4 more)

### Community 105 - "Community 105"
Cohesion: 0.18
Nodes (14): deleteModeratedMessage(), fetchActiveBans(), parsePage(), putBan(), responseJson(), roomModerationUrl(), unban(), BAN_DURATIONS (+6 more)

### Community 106 - "Community 106"
Cohesion: 0.22
Nodes (5): cleanView(), createReactionStore(), ReactionStore, reactorKey(), revision()

### Community 107 - "Community 107"
Cohesion: 0.11
Nodes (11): 995ced6 test(api): give spawned test servers 15 seconds to become ready, assert, { createTestDatabase }, fs, http, { openWs, joinVoiceRoom }, os, path (+3 more)

### Community 108 - "Community 108"
Cohesion: 0.14
Nodes (15): createAbortError(), disconnectAudioNode(), errorMessage(), errorName(), getInitials(), hasLeadingZeroBits(), isCaptureCancelled(), isSafariBrowser() (+7 more)

### Community 109 - "Community 109"
Cohesion: 0.11
Nodes (12): assert, { createTestDatabase }, fs, http, { openWs, sendWs, joinVoiceRoom, waitForWsType, countWsType }, os, path, { socketPathForDirectory } (+4 more)

### Community 110 - "Community 110"
Cohesion: 0.23
Nodes (15): FetchMembershipsOptions, fetchRoomMemberships(), leaveRoomMembership(), applyRoomVoicePeers(), cacheKey(), clearRoomMembership(), emptyEntry(), getRoomMembership() (+7 more)

### Community 111 - "Community 111"
Cohesion: 0.18
Nodes (12): fetchRoomPins(), pinAuthor(), PinnedMessage, PinnedMessageAuthor, PinResponse, pinRoomMessage(), PinSnapshot, pinUrl() (+4 more)

### Community 112 - "Community 112"
Cohesion: 0.15
Nodes (11): eeb1235 feat(api): list and end account sessions, recover accounts by code, createGeoLocator(), formatLocation(), fs, namesOf(), net, placeName(), assert (+3 more)

### Community 113 - "Community 113"
Cohesion: 0.14
Nodes (12): { buildMessageDeliveryEvent }, createMessageOutboxRepository(), crypto, encodeParts(), logicalKey(), MessageDeliveryFenceError, requireQuery(), assert (+4 more)

### Community 114 - "Community 114"
Cohesion: 0.16
Nodes (14): cleanUpstreamUrl(), { createCredentialBoundaryService }, { createDbPool }, { createGateCredentialSigner }, createLiveKitAuthGateService(), { createRoomStore }, deny(), destroySocket() (+6 more)

### Community 115 - "Community 115"
Cohesion: 0.28
Nodes (15): DEFAULT_FREQUENT_REACTIONS, FrequentReaction, frequentReactionKey(), loadFrequentReactions(), localStorageKey(), memory, normalizeEntries(), openDatabase() (+7 more)

### Community 116 - "Community 116"
Cohesion: 0.20
Nodes (12): clearDisconnectedHiddenEmbed(), clearViewedRoom(), connectedRoomIsViewed(), embeddedRoomIsVisible(), getActiveVoiceRoomId(), openActiveVoiceRoom(), roomNavigation, RoomShellMode (+4 more)

### Community 117 - "Community 117"
Cohesion: 0.16
Nodes (13): BrowserIdleDetector, BrowserIdleDetectorConstructor, createPresenceIdleController(), DesktopIdleBridge, DesktopIdleScope, EventTarget, getDesktopIdleSecondsReader(), hasGrantedBrowserIdlePermission() (+5 more)

### Community 118 - "Community 118"
Cohesion: 0.13
Nodes (4): DeniedNotification, FakeNotification, require, ts

### Community 119 - "Community 119"
Cohesion: 0.23
Nodes (11): fetchReactionSummaries(), fetchReactors(), ReactionConversation, reactionUrl(), setReactionDesired(), validSummaries(), ReactionSnapshotView, replaceReactionSnapshot() (+3 more)

### Community 120 - "Community 120"
Cohesion: 0.18
Nodes (12): 2ce6059 test(shared): lock attachment contracts, b541a05 test(api): resolve reaction fixtures from workspace, c1f8e3c test(web): bind account-only reaction picker, attachmentTextFallback(), MIME_TYPES, normalizeAttachment(), normalizeAttachments(), STATES (+4 more)

### Community 121 - "Community 121"
Cohesion: 0.15
Nodes (2): ContextMenuContentState, ContextMenuProps

### Community 122 - "Community 122"
Cohesion: 0.14
Nodes (10): clearViewedScreenPeerReferences(), createRoomRealtimeRuntime(), resolveViewedScreenPeerId(), assert, {
  clearViewedScreenPeerReferences,
  createRoomRealtimeRuntime,
  resolveViewedScreenPeerId
}, createLeaseRuntime(), createRuntime(), OWNER_TOKEN (+2 more)

### Community 123 - "Community 123"
Cohesion: 0.23
Nodes (11): accessibleName(), assertAccessibleName(), assertFocusOrder(), assertKeyboardActivation(), assertLiveRegion(), assertReducedMotionEnabled(), assertStableLayout(), text() (+3 more)

### Community 124 - "Community 124"
Cohesion: 0.21
Nodes (10): INTERNAL_NODE_KEYS, isManifestValid(), isObject(), normalizeInternalNode(), normalizeManifest(), normalizeOperatorNode(), normalizePublicNode(), OPERATOR_KEYS (+2 more)

### Community 125 - "Community 125"
Cohesion: 0.13
Nodes (11): assert, { createTestDatabase }, { createUserStore }, crypto, fs, MIGRATIONS_DIR, path, { Pool } (+3 more)

### Community 126 - "Community 126"
Cohesion: 0.13
Nodes (6): assert, { createLiveKitAuthGateService }, { EventEmitter }, FakeSocket, net, test

### Community 127 - "Community 127"
Cohesion: 0.14
Nodes (13): assert, { createTestDatabase }, crypto, fs, MIGRATIONS_DIR, path, { Pool }, { runMigrations } (+5 more)

### Community 128 - "Community 128"
Cohesion: 0.19
Nodes (11): DesktopNotificationPayload, BridgeResult, DesktopBridge, resolveBridge(), showDesktopNotification(), browserNavigator(), classifyPlatform(), classifyPlatformPolicy() (+3 more)

### Community 129 - "Community 129"
Cohesion: 0.14
Nodes (3): ControlHandler, LeaveHandler, voiceSession

### Community 130 - "Community 130"
Cohesion: 0.19
Nodes (11): assetName(), catalogueFile, graphicsLicenceFile, main(), outputDir, packageRoot, planEmojiAssets(), require (+3 more)

### Community 131 - "Community 131"
Cohesion: 0.18
Nodes (12): classifyPlatform(), classifyPlatformPolicy(), normalizedString(), PLATFORM_CLASSES, platformPolicy(), assert, cjs, CORPUS (+4 more)

### Community 132 - "Community 132"
Cohesion: 0.14
Nodes (14): attachPresence(), bootstrap(), createRoomForRequest(), createRoomId(), getPresenceRoom(), getRoom(), handleCreateRoom(), handleRoomPeers() (+6 more)

### Community 133 - "Community 133"
Cohesion: 0.15
Nodes (6): loadParticipantScreenLifecycle(), moduleUrl(), require, root, TestMediaStream, ts

### Community 134 - "Community 134"
Cohesion: 0.21
Nodes (12): DirectMessage, ActiveResync, contentVersion(), createDmThreadResyncCoordinator(), mergeMessage(), newestTimestamp(), replayMutations(), ResyncRequestOptions (+4 more)

### Community 135 - "Community 135"
Cohesion: 0.21
Nodes (9): createProofOfWork(), crypto, hasLeadingZeroBits(), normalizePowNonce(), parsePowChallenge(), assert, crypto, {
  hasLeadingZeroBits,
  parsePowChallenge,
  normalizePowNonce,
  createProofOfWork
} (+1 more)

### Community 136 - "Community 136"
Cohesion: 0.26
Nodes (11): cacheKey(), configCache, defaultConfig(), fetchRuntimeConfig(), hasSuspiciousSecrets(), loadRuntimeConfig(), resolveConfigOrigin(), resolveConfigUrl() (+3 more)

### Community 137 - "Community 137"
Cohesion: 0.31
Nodes (11): clamp(), deriveAvatarAccent(), fitChromaToSrgb(), isInSrgbGamut(), linearToSrgb(), normalizeChannel(), oklchToHex(), oklchToLinearRgb() (+3 more)

### Community 138 - "Community 138"
Cohesion: 0.27
Nodes (12): buildHistoryEnvelope(), cleanString(), getReadCursorFromMessage(), HISTORY_MODE_SET, HISTORY_MODES, isObject(), isOpaqueCursor(), MESSAGE_KIND_SET (+4 more)

### Community 139 - "Community 139"
Cohesion: 0.28
Nodes (11): DEFAULT_RUNTIME_CONFIG, getRuntimeConfig(), inheritLiveKitGateCredential(), normalizeLiveKitServerUrl(), normalizeLiveKitUrl(), normalizePayload(), parseRuntimeConfig(), resolveLiveKitConnectUrls() (+3 more)

### Community 140 - "Community 140"
Cohesion: 0.15
Nodes (11): assert, { createApiApp }, { createGateCredentialSigner }, { createLiveKitAuthGateService, extractCredential }, { EventEmitter }, fs, net, path (+3 more)

### Community 141 - "Community 141"
Cohesion: 0.15
Nodes (10): assert, crypto, {
  EMOJI_REACTION_AUTHORITY,
  assertReactionEmoji,
  cleanReactionEmoji,
  isReactionEmoji,
  listReactionEmojis
}, fs, PACKAGE_JSON, path, { pathToFileURL }, ROOT (+2 more)

### Community 142 - "Community 142"
Cohesion: 0.15
Nodes (10): ADMISSION_INTERNAL_COVERAGE_SCRIPT, { createGateCredentialSigner }, { createLiveKitAuthGateService, extractCredential }, { createRoomRealtimeRuntime }, { createRoomStore }, greenSummary, require, SERVER_INTERNAL_COVERAGE_SCRIPT (+2 more)

### Community 143 - "Community 143"
Cohesion: 0.17
Nodes (10): 166a0e8 test(release): resolve rescue fixtures from repository root, 5dd3691 test(api): serialize database suites, bf6bba7 test(api): cover media backlog age query, f540886 test(release): refresh CI gate fixtures, assert, fs, path, profile (+2 more)

### Community 144 - "Community 144"
Cohesion: 0.24
Nodes (10): createAvatarKey(), crypto, { deriveAvatarAccent, dominantAvatarColor }, detectAvatarFormat(), processAvatar(), sharp, assert, {
  AVATAR_SIZE,
  createAvatarKey,
  detectAvatarFormat,
  processAvatar
} (+2 more)

### Community 145 - "Community 145"
Cohesion: 0.24
Nodes (6): formatTime(), pad(), formatChatDayLabel(), isSameDay(), MONTHS, startOfDay()

### Community 147 - "Community 147"
Cohesion: 0.21
Nodes (1): ScreenRecoveryGraceController

### Community 148 - "Community 148"
Cohesion: 0.17
Nodes (6): createApiServer(), assert, http, { openWs, joinVoiceRoom, sendWs, waitForWsType }, { __private, createApiServer }, test

### Community 149 - "Community 149"
Cohesion: 0.24
Nodes (10): hasSurfaceToken(), isAllowedBackground(), lineAt(), paletteViolations(), root, sourceFiles(), sourceRoot, styleFragments() (+2 more)

### Community 150 - "Community 150"
Cohesion: 0.53
Nodes (10): buildMessageDeliveryEvent(), cleanString(), DELIVERY_EVENT_TYPES, isObject(), isSystemCard(), normalizeConversation(), normalizeIdempotency(), normalizeReplyPointer() (+2 more)

### Community 151 - "Community 151"
Cohesion: 0.24
Nodes (4): DesktopAsset, DesktopRelease, DESKTOP_BUILDS, DesktopBuild

### Community 152 - "Community 152"
Cohesion: 0.22
Nodes (8): apps/CLAUDE.md, docs/GIT_FLOW.md, .github CLAUDE.md Policy, Pull Request Template, docs/RELEASE_<version>_PLAN.md, Root CLAUDE.md, Room client architecture (ARCHITECTURE.md), apps/web/CLAUDE.md

### Community 153 - "Community 153"
Cohesion: 0.27
Nodes (8): BROWSABLE_EMOJIS, BROWSABLE_SET, EmojiCategory, hasSkinToneChoices(), isOfferedEmoji(), OFFERED, skinToneChoices(), withSkinTone()

### Community 154 - "Community 154"
Cohesion: 0.20
Nodes (9): 2350242 build(api): define expiry-aware rescue profile, 7795005 test(web): cover moderation center contract, api, chat, component, lobby, members, model (+1 more)

### Community 155 - "Community 155"
Cohesion: 0.22
Nodes (5): 2ca6443 test(shared): lock platform classification contract, 924295b test(web): prove G13 against pinned Caddy, a37d685 test(web): make G13 paths workspace-safe, fdb6786 test(api): make G14 paths workspace-safe, repositoryRoot

### Community 156 - "Community 156"
Cohesion: 0.27
Nodes (7): createMediaMaintenanceService(), assert, { createMediaMaintenanceService }, { createMediaMaintenanceWorker }, test, createMediaMaintenanceWorker(), main()

### Community 157 - "Community 157"
Cohesion: 0.22
Nodes (5): buildAppRoomLink(), markInAppRoomNavigation(), OpenInAppSignals, PRODUCTION_HOSTS, resolveAppLinkScheme()

### Community 158 - "Community 158"
Cohesion: 0.36
Nodes (9): buildMembershipEnvelope(), cleanString(), isObject(), MEMBERSHIP_ROLE_SET, MEMBERSHIP_ROLES, normalizeMembershipEnvelope(), normalizeMembershipLimit(), normalizeMembershipMember() (+1 more)

### Community 159 - "Community 159"
Cohesion: 0.22
Nodes (3): configure(), deferred(), MemoryStorage

### Community 160 - "Community 160"
Cohesion: 0.22
Nodes (9): assert, commonJs, fs, invoke(), packageJson, path, { pathToFileURL }, snapshot() (+1 more)

### Community 161 - "Community 161"
Cohesion: 0.36
Nodes (9): cancelScreenSourcePicker(), closeScreenSourceOnBackdrop(), closeScreenSourceOnEscape(), closeScreenSourcePicker(), confirmScreenSourcePicker(), getTabSources(), resolveScreenSourcePicker(), showScreenSourcePicker() (+1 more)

### Community 162 - "Community 162"
Cohesion: 0.28
Nodes (5): BlockStatus, blockUrl(), blockUser(), unblockUser(), getJsonAuth()

### Community 166 - "Community 166"
Cohesion: 0.25
Nodes (7): {
  normalizeRoomMessageContent,
  projectRoomMessageContent
}, projectStoredRoomMessage(), assert, fs, path, {projectStoredRoomMessage}, test

### Community 167 - "Community 167"
Cohesion: 0.25
Nodes (7): {
  contentFromLegacyText,
  normalizeRoomMessageContent,
  projectRoomMessageContent
}, createContentRepository(), assert, {createContentRepository}, fs, path, test

### Community 168 - "Community 168"
Cohesion: 0.44
Nodes (8): cleanHttpUrl(), cleanString(), contentFromLegacyText(), normalizeRoomMessageContent(), normalizeSegment(), projectKnownContent(), projectRoomMessageContent(), utf8ByteLength()

### Community 169 - "Community 169"
Cohesion: 0.22
Nodes (7): bans, chatPanel, lobbyRoomSettings, members, model, roomSettings, root

### Community 170 - "Community 170"
Cohesion: 0.25
Nodes (4): FakeTimers, require, root, ts

### Community 171 - "Community 171"
Cohesion: 0.32
Nodes (5): createRateLimiter(), getClientIp(), assert, { getClientIp, createRateLimiter }, test

### Community 172 - "Community 172"
Cohesion: 0.32
Nodes (6): { buildMembershipEnvelope, normalizeMembershipRequest }, createMemberDirectoryService(), presenceForUser(), assert, { createMemberDirectoryService, presenceForUser }, { test }

### Community 173 - "Community 173"
Cohesion: 0.43
Nodes (7): desktopAutostartAvailable(), DesktopAutostartPatch, DesktopAutostartSettings, getBridge(), normalizeSettings(), readDesktopAutostartSettings(), updateDesktopAutostartSettings()

### Community 174 - "Community 174"
Cohesion: 0.36
Nodes (7): bindDesktopCallActions(), CALL_ACTIONS, DesktopCallAction, DesktopCallState, getBridge(), syncDesktopCallState(), toPayload()

### Community 175 - "Community 175"
Cohesion: 0.29
Nodes (5): assert, { createApiApp }, openWs(), test, waitForFrame()

### Community 176 - "Community 176"
Cohesion: 0.25
Nodes (3): FakeWebSocket, require, ts

### Community 177 - "Community 177"
Cohesion: 0.33
Nodes (4): fingerprint(), SendShadow, SendShadowState, stableJson()

### Community 178 - "Community 178"
Cohesion: 0.43
Nodes (6): RoomLifecycleSummary, applyRoomDeleted(), applyRoomNotFound(), applyRoomUpdated(), refreshRoomHeadingSoon(), showRoomNotFoundSoon()

### Community 179 - "Community 179"
Cohesion: 0.48
Nodes (7): docs/CLAUDE.md governance rules, VoiceRoom 2.5.0 consolidated execution plan, Git Flow workflow, VoiceRoom 2.5.0 unified messaging platform PRD, Release 2.4.0 verification plan, Release 2.4.1 verification plan, Release 2.4.2 hotfix verification plan

### Community 180 - "Community 180"
Cohesion: 0.29
Nodes (4): MMDB_METADATA_MARKER, now, previousMonth, target

### Community 181 - "Community 181"
Cohesion: 0.43
Nodes (5): createPinService(), normalizeMessageId(), normalizeRoomId(), PinServiceError, requireAccount()

### Community 182 - "Community 182"
Cohesion: 0.33
Nodes (3): CONTEXT_TABLES, createReactionRepository(), requireQuery()

### Community 183 - "Community 183"
Cohesion: 0.48
Nodes (6): copyDesktopDiagnostics(), desktopDiagnosticsAvailable(), DesktopDiagnosticsContext, getBridge(), openDesktopLogsFolder(), syncDesktopDiagnosticsContext()

### Community 184 - "Community 184"
Cohesion: 0.29
Nodes (6): CapabilityInternalNode, CapabilityManifest, CapabilityOperatorNode, CapabilityPublicNode, CapabilityReplicaConsensus, CapabilityRequires

### Community 185 - "Community 185"
Cohesion: 0.29
Nodes (6): ConversationRef, IdempotencyDescriptor, MessageDeliveryEvent, ReplyPointer, ReplyPreview, SendEnvelope

### Community 186 - "Community 186"
Cohesion: 0.33
Nodes (3): DEFAULT_OPTIONS, getSmoothingCoefficient(), VoiceRoomNoiseGateProcessor

### Community 187 - "Community 187"
Cohesion: 0.29
Nodes (4): assert, { __private, createApiApp }, test, { TrackSource }

### Community 188 - "Community 188"
Cohesion: 0.29
Nodes (6): assert, { createReadinessReport }, fs, path, { readMessageDeliveryMode }, { test }

### Community 189 - "Community 189"
Cohesion: 0.29
Nodes (3): FakeIdleDetector, require, ts

### Community 190 - "Community 190"
Cohesion: 0.29
Nodes (4): assert, fs, path, test

### Community 191 - "Community 191"
Cohesion: 0.38
Nodes (5): FOCUSABLE_SELECTOR, focusInitialElement(), FocusTrapOptions, getFocusableElements(), isHTMLElement()

### Community 192 - "Community 192"
Cohesion: 0.38
Nodes (6): ConnectionStatusView, formatLocalPing(), getConnectionStatusView(), getPeerLatencyQuality(), resetConnectionStatus(), setServerConnectionStatus()

### Community 193 - "Community 193"
Cohesion: 0.60
Nodes (5): ChatMessage, mentionProfilePerson(), participantProfilePerson(), presenceFor(), roomMessageProfilePerson()

### Community 194 - "Community 194"
Cohesion: 0.33
Nodes (6): Desktop Support Matrix Doc (G19), Release 2.5.0 Durable Evidence Archive Doc (G03), Coordinated Media Backup and Restore Doc, Release 2.5.0 Budgets Doc (G91), Release 2.5.0 Develop Entry Doc (G93), Release 2.5.0 RC Preflight Doc

### Community 195 - "Community 195"
Cohesion: 0.60
Nodes (4): iconLg, iconMd, iconSm, iconXs

### Community 196 - "Community 196"
Cohesion: 0.33
Nodes (2): { createDbPool }, createDmHistoryRepository()

### Community 197 - "Community 197"
Cohesion: 0.33
Nodes (2): { createDbPool }, createRoomHistoryRepository()

### Community 198 - "Community 198"
Cohesion: 0.47
Nodes (5): bindDesktopLinks(), DesktopLink, getBridge(), matches(), normalizeDesktopLink()

### Community 199 - "Community 199"
Cohesion: 0.33
Nodes (1): LiveKitReconcileGeneration

### Community 200 - "Community 200"
Cohesion: 0.40
Nodes (2): o, s()

### Community 201 - "Community 201"
Cohesion: 0.33
Nodes (2): participantContextMenu, ParticipantMenuVariant

### Community 202 - "Community 202"
Cohesion: 0.33
Nodes (5): ActiveBan, ActiveBanProfile, BanMutation, ModerationDuration, ModerationPage

### Community 203 - "Community 203"
Cohesion: 0.33
Nodes (5): RoomMessageContentV1, RoomMessageLinkSegmentV1, RoomMessageMentionSegmentV1, RoomMessageSegmentV1, RoomMessageTextSegmentV1

### Community 204 - "Community 204"
Cohesion: 0.40
Nodes (5): loadRoomRealtime(), moduleUrl(), require, root, ts

### Community 205 - "Community 205"
Cohesion: 0.40
Nodes (5): assert, { createApiApp }, openAccountWs(), test, waitForFrame()

### Community 206 - "Community 206"
Cohesion: 0.33
Nodes (1): FakeServer

### Community 207 - "Community 207"
Cohesion: 0.33
Nodes (4): assert, fs, path, test

### Community 208 - "Community 208"
Cohesion: 0.60
Nodes (4): isToneIndex(), loadSkinTone(), saveSkinTone(), SkinToneIndex

### Community 209 - "Community 209"
Cohesion: 0.60
Nodes (5): 0d5875a fix: close migration dependency audit finding, 7a27ba8 chore: prepare v2.0.0 release, 983e909 Merge pull request #11 from dazeGG/hotfix/api-docker-workspace-start-develop, c6b8624 fix: start api workspace in docker image, dcda22d chore: merge v2.0.0 back to develop

### Community 211 - "Community 211"
Cohesion: 0.40
Nodes (5): Expiry-Aware Rescue Profile Doc (G85), Predeploy Migrations Doc, Release 2.6.0 Plan — Engagement & Notifications (Superseded), Release 2.7.0 Plan — Media & Moderation (Superseded), VoiceRoom 2.5.0 Unified — Verification and Release Evidence Specification

### Community 212 - "Community 212"
Cohesion: 0.60
Nodes (4): createPinRepository(), mapPin(), requireQuery(), toMillis()

### Community 213 - "Community 213"
Cohesion: 0.50
Nodes (2): applyRoomSwitchDecision(), writeRoomSwitchConfirmEnabled()

### Community 214 - "Community 214"
Cohesion: 0.40
Nodes (2): createMentionRepository(), crypto

### Community 215 - "Community 215"
Cohesion: 0.40
Nodes (4): MemberPresenceStatus, MembershipEnvelope, MembershipMember, MembershipRole

### Community 216 - "Community 216"
Cohesion: 0.40
Nodes (4): HistoryEnvelope, HistoryMode, HistoryRequest, MessageDto

### Community 217 - "Community 217"
Cohesion: 0.40
Nodes (4): ReactionMutation, ReactionSummary, Reactor, ReactorPage

### Community 218 - "Community 218"
Cohesion: 0.50
Nodes (1): VoiceRoomDesktopAudioSourceProcessor

### Community 219 - "Community 219"
Cohesion: 0.50
Nodes (3): getServer(), loadModule(), webRoot

### Community 220 - "Community 220"
Cohesion: 0.40
Nodes (1): FakeSocket

### Community 221 - "Community 221"
Cohesion: 0.40
Nodes (1): FakeSocket

### Community 222 - "Community 222"
Cohesion: 0.40
Nodes (4): assert, fs, path, { test }

### Community 223 - "Community 223"
Cohesion: 0.40
Nodes (4): assert, fs, path, { test }

### Community 224 - "Community 224"
Cohesion: 0.50
Nodes (3): desktop, router, sw

### Community 225 - "Community 225"
Cohesion: 0.50
Nodes (1): e

### Community 226 - "Community 226"
Cohesion: 0.83
Nodes (3): cleanId(), mentionUserIdsFromContent(), normalizeMentionUserIds()

### Community 227 - "Community 227"
Cohesion: 1.00
Nodes (1): RuntimeConfigV1

### Community 228 - "Community 228"
Cohesion: 1.00
Nodes (2): VoiceRoom App Icon (Owl Mascot Mark on Dark Rounded Square), VoiceRoom Mascot Mark (Masked Owl Silhouette, Transparent)

### Community 229 - "Community 229"
Cohesion: 1.00
Nodes (1): ADR: Unicode authority for message reactions

### Community 230 - "Community 230"
Cohesion: 1.00
Nodes (1): VoiceRoom 2.5 Architecture Boundaries

### Community 231 - "Community 231"
Cohesion: 1.00
Nodes (1): Backlog

### Community 232 - "Community 232"
Cohesion: 1.00
Nodes (1): config/capability-dag.v1.json

### Community 233 - "Community 233"
Cohesion: 1.00
Nodes (1): Capability Readiness Doc

### Community 234 - "Community 234"
Cohesion: 1.00
Nodes (1): Design QA — reusable room and chat menus

### Community 235 - "Community 235"
Cohesion: 1.00
Nodes (1): Font Assets README

### Community 236 - "Community 236"
Cohesion: 1.00
Nodes (1): LiveKit External Auth-Gate Operations Doc (G05)

### Community 237 - "Community 237"
Cohesion: 1.00
Nodes (1): VoiceRoom monitoring agent

### Community 238 - "Community 238"
Cohesion: 1.00
Nodes (1): OCI Runtime Publication Doc

### Community 239 - "Community 239"
Cohesion: 1.00
Nodes (1): packages/CLAUDE.md Guidance

### Community 240 - "Community 240"
Cohesion: 1.00
Nodes (1): Production Digest Promotion Doc

### Community 241 - "Community 241"
Cohesion: 1.00
Nodes (1): Release 2.5.0 Repairs README

## Knowledge Gaps
- **1596 isolated node(s):** `http`, `net`, `{ URL }`, `{ createDbPool }`, `{ createGateCredentialSigner }` (+1591 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 30`** (2 nodes): `13254ae docs: document durable room storage`, `c860746 feat(web): add static rooms and room chat UI`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 40`** (1 nodes): `edf009e feat(web): add desktop autostart settings`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 46`** (2 nodes): `3c617ec style(web): polish dm day separator`, `7db2783 docs(monitoring): align LiveKit track metric labels`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 121`** (2 nodes): `ContextMenuContentState`, `ContextMenuProps`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 147`** (1 nodes): `ScreenRecoveryGraceController`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 196`** (2 nodes): `{ createDbPool }`, `createDmHistoryRepository()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 197`** (2 nodes): `{ createDbPool }`, `createRoomHistoryRepository()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 199`** (1 nodes): `LiveKitReconcileGeneration`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 200`** (2 nodes): `o`, `s()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 201`** (2 nodes): `participantContextMenu`, `ParticipantMenuVariant`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 206`** (1 nodes): `FakeServer`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 213`** (2 nodes): `applyRoomSwitchDecision()`, `writeRoomSwitchConfirmEnabled()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 214`** (2 nodes): `createMentionRepository()`, `crypto`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 218`** (1 nodes): `VoiceRoomDesktopAudioSourceProcessor`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 220`** (1 nodes): `FakeSocket`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 221`** (1 nodes): `FakeSocket`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 225`** (1 nodes): `e`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 227`** (1 nodes): `RuntimeConfigV1`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 228`** (2 nodes): `VoiceRoom App Icon (Owl Mascot Mark on Dark Rounded Square)`, `VoiceRoom Mascot Mark (Masked Owl Silhouette, Transparent)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 229`** (1 nodes): `ADR: Unicode authority for message reactions`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 230`** (1 nodes): `VoiceRoom 2.5 Architecture Boundaries`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 231`** (1 nodes): `Backlog`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 232`** (1 nodes): `config/capability-dag.v1.json`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 233`** (1 nodes): `Capability Readiness Doc`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 234`** (1 nodes): `Design QA — reusable room and chat menus`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 235`** (1 nodes): `Font Assets README`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 236`** (1 nodes): `LiveKit External Auth-Gate Operations Doc (G05)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 237`** (1 nodes): `VoiceRoom monitoring agent`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 238`** (1 nodes): `OCI Runtime Publication Doc`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 239`** (1 nodes): `packages/CLAUDE.md Guidance`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 240`** (1 nodes): `Production Digest Promotion Doc`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 241`** (1 nodes): `Release 2.5.0 Repairs README`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `RealtimeRecoveryController` connect `Community 43` to `Community 4`?**
  _High betweenness centrality (0.009) - this node is a cross-community bridge._
- **What connects `http`, `net`, `{ URL }` to the rest of the system?**
  _1596 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.0548014735980352 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.011343804537521814 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.024287856071964018 - nodes in this community are weakly interconnected._
- **Should `Community 3` be split into smaller, more focused modules?**
  _Cohesion score 0.031266846361185985 - nodes in this community are weakly interconnected._
- **Should `Community 4` be split into smaller, more focused modules?**
  _Cohesion score 0.03939507094846901 - nodes in this community are weakly interconnected._