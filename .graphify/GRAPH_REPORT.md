# Graph Report - .  (2026-09-23)

## Corpus Check
- Large corpus: 822 files · ~448 836 words. Semantic extraction will be expensive (many Claude tokens). Consider running on a subfolder, or use --no-semantic to run AST-only.

## Summary
- 7496 nodes · 24360 edges · 224 communities detected
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 6 edges (avg confidence: 0.73)
- Token cost: 0 input · 0 output
- Edge kinds: ON_BRANCH: 6757 · MODIFIES: 5904 · contains: 5676 · calls: 2102 · imports: 1649 · imports_from: 1025 · PARENT_OF: 920 · method: 220 · re_exports: 61 · references: 23 · inherits: 16 · conceptually_related_to: 4 · semantically_similar_to: 2 · implements: 1


## Input Scope
- Requested: auto
- Resolved: committed (source: default-auto)
- Included files: 822 · Candidates: 955
- Excluded: 0 untracked · 53562 ignored · 16 sensitive · 0 missing committed
- Recommendation: Use --scope all or graphify.yaml inputs.corpus for a knowledge-base folder.

## Graph Freshness
- Built from Git commit: `e16ad73`
- Compare this hash to `git rev-parse HEAD` before trusting freshness-sensitive graph output.
## God Nodes (most connected - your core abstractions)
1. `sendJson()` - 88 edges
2. `createTestDatabase()` - 48 edges
3. `runMigrations()` - 41 edges
4. `readJsonBody()` - 35 edges
5. `LOG_EVENTS` - 34 edges
6. `getUserStore()` - 31 edges
7. `resolveSessionUser()` - 30 edges
8. `RealtimeRecoveryController` - 30 edges
9. `createLogger()` - 29 edges
10. `requireSessionUser()` - 29 edges

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
Nodes (259): backup/room-shared-music-pre-rebase, chore/graphify-refresh, feature/2.5.0-manual-fixes, feature/2.5.0-to-rc, feature/account-sessions-recovery, feature/cd-pipeline, feature/desktop-app-settings, feature/docs-cleanup (+251 more)

### Community 1 - "Community 1"
Cohesion: 0.01
Nodes (264): gatePrincipalForPeer(), GatePrincipalPeer, GatePrincipalStore, isGatePrincipal(), createServiceRegistry(), resolveCursorHmacKeys(), createFriendStore(), createGeoLocator() (+256 more)

### Community 2 - "Community 2"
Cohesion: 0.01
Nodes (196): 1886650 feat(api): persist rooms and chat in postgres, 3580978 fix(api): harden session and cookie write security, 364b82c build(api): fence G15 predeploy migrations, path, readDatabaseConfig(), readEnvBool(), readMessageDeliveryMode(), acquireMigrationLock() (+188 more)

### Community 3 - "Community 3"
Cohesion: 0.02
Nodes (121): SelectedMention, ReactionSnapshotView, 1c5b8e5 docs: record the backend migration decisions, 728cea2 feat: implement release 2.5.0 messaging platform (#105), 7609180 fix(web): harden reaction convergence, ab373a6 chore(release): 2.5.0 (#121), ae1827c fix(reactions): converge updates across realtime clients, b88bcd4 Merge branch 'feature/api-esm' into develop (+113 more)

### Community 4 - "Community 4"
Cohesion: 0.01
Nodes (152): 0ec8255 chore(release): bump version to 2.2.3, 13254ae docs: document durable room storage, 20fdff5 feat(api): persist static rooms and chat, 2adaec0 Merge branch 'hotfix/2.2.3-ci', 397400d chore(release): bump version to 2.2.2, 3b6010b Merge branch 'release/2.2.2', 3f83f05 Merge branch 'release/2.2.0', 4cfb160 chore(release): bump version to 2.2.0 (+144 more)

### Community 5 - "Community 5"
Cohesion: 0.02
Nodes (74): AuthUser, SelfUserFlags, roomNameFor(), clearSession(), session, setUser(), syncRoomName(), 1578df6 feat: add account settings (+66 more)

### Community 6 - "Community 6"
Cohesion: 0.03
Nodes (138): 234177e feat(web): redesign screen source picker, 269978f chore(release): bump version to 2.2.6, 35db896 feat(web): tune screen share codecs and bring back 60 FPS, 4c756b6 Merge branch 'release/2.2.6', 9ba8ece feat(web): tune screen share encoding, f5501ff Merge tag 'v2.2.6' into develop, SCREEN_FPS_OPTIONS, SCREEN_QUALITY_OPTIONS (+130 more)

### Community 7 - "Community 7"
Cohesion: 0.02
Nodes (110): 13b9a17 feat: log structured domain events across the API, workers and browser (#144), 5f20352 Merge pull request #147 from dazeGG/release/2.6.2, CLIENT_LOG_LIMITS, createDbPool(), { createLogger }, { LOG_EVENTS }, { Pool }, { readDatabaseConfig } (+102 more)

### Community 8 - "Community 8"
Cohesion: 0.03
Nodes (114): 2564f07 fix(web): address review findings on voice playback, gate and join, 61fdd06 fix(web): play remote voices on their own element so Chrome cancels echo, 7702bd9 fix(api): address review findings on the gate probe and login limiter, 7b8da98 feat(web): add the room music player, 7c38d36 feat(web): show packet loss, jitter and TCP/relay fallback in the voice status, 9c3b5e4 feat(audio): add unified playback bus (#54), a0ff17a feat(web): improve sound settings with sliders and cue volume (#30), b120355 feat(release): complete 2.4.0 plan (#55) (+106 more)

### Community 9 - "Community 9"
Cohesion: 0.02
Nodes (87): 19902ab feat: prepare 2.5.0 RC and polish chats (#114), c02e107 fix(web): recover attachment compose safely, cc45703 fix(api): expose worker metrics across process boundaries, cf49285 fix(api): reconcile media across replicas, d37be0b feat(api): expose media pressure health, d8e3847 test(web): prove messaging reconciliation flows, composer, dm (+79 more)

### Community 10 - "Community 10"
Cohesion: 0.03
Nodes (52): 043b73d chore: release v2.1.5, 164b853 refactor(web): neutral input placeholders, dedicated dev port, desktop drag region (#16), 1a5009b fix(web): remove transient voice-connecting placeholder, 2c5f8d4 feat(web): show stream quality on tile thumbnails, 4be8312 chore: release v2.1.0, 551c869 chore: merge v2.1.0 back to develop, 56ebf7a docs: document root-scoped omx runtime usage, 5eef100 feat: friends, direct messages, and social lobby (#19) (+44 more)

### Community 11 - "Community 11"
Cohesion: 0.11
Nodes (90): feature/2.6.0-prerelease, feature/composer-emoji-picker, feature/emoji-images, feature/guest-account-app-cta, feature/whats-new-stories, fix/api-test-db-teardown, 035114c Merge branch 'feature/chat-drafts' into develop, 056c561 chore(graphify): rebuild the knowledge graph for account security (+82 more)

### Community 12 - "Community 12"
Cohesion: 0.02
Nodes (68): ReadReconciliationOptions, 4553c35 fix(web): reconcile repeated cross-tab read cursors, 54086b4 fix(api): serialize notification retraction revisions, 5d910ea fix(notifications): fail closed on provider errors, 74df7a9 fix(api): revoke only failed admission credential, ac8e530 fix(notifications): persist explicit all room level, b16c894 fix(api): expose fail-closed release telemetry, b3732be fix(notifications): make inbox revisions monotonic (+60 more)

### Community 13 - "Community 13"
Cohesion: 0.04
Nodes (83): deleteDirectMessage(), DirectMessage, DirectMessageHistoryPage, DirectMessageInvite, editDirectMessage(), fetchThread(), fetchThreadPage(), HistoryMessageDto (+75 more)

### Community 14 - "Community 14"
Cohesion: 0.06
Nodes (90): attachFastifyRequestBody(), authorizeRoomMutation(), broadcast(), broadcastRoomUpdate(), broadcastUserProfileToFriends(), buildSessionCookie(), checkAvatarUploadRate(), checkPushSubscriptionRate() (+82 more)

### Community 15 - "Community 15"
Cohesion: 0.04
Nodes (62): AccountConnection, AccountLifecycle, AccountLifecycleDeps, ActiveVoice, createAccountLifecycle(), GatePrincipal, 17d1982 refactor(api): move the lazily built stores and services into app/service-registry, 655f310 Merge branch 'feature/api-avatars' into develop (+54 more)

### Community 16 - "Community 16"
Cohesion: 0.05
Nodes (58): 4f04d65 Merge branch 'feature/api-rooms' into develop, 67f26b2 docs: record the PR 3 rooms domain, f6022c9 refactor(api): move rooms and owner moderation into domains/rooms, Failure, HttpKitOptions, optionalJsonBody(), RequestSample, createPeerEviction() (+50 more)

### Community 17 - "Community 17"
Cohesion: 0.05
Nodes (66): cancelRoomRecovery(), isCurrentRoomRecoveryEpoch(), log, notifyLiveKitDisconnected(), notifyLiveKitReconciled(), notifyLiveKitReconnecting(), notifyRoomAppConnection(), notifyRoomNetworkOffline() (+58 more)

### Community 18 - "Community 18"
Cohesion: 0.05
Nodes (39): authUserWithoutSelfFlags, lang, feature/mobile-polish, feature/mobile-room, 0580b9c Merge branch 'feature/cd-pipeline' into develop, 09486bf feat(web): open rooms in mobile browsers, 21547ea chore(graphify): rebuild the knowledge graph for mobile rooms, 2697cfb chore(graphify): rebuild the code graph for the deploy pipeline (+31 more)

### Community 19 - "Community 19"
Cohesion: 0.04
Nodes (54): FailureBody, REFUSALS, registerAdmissionRoutes(), TokenRequest, TokenResponse, Admission, AdmissionDeps, AdmissionRequest (+46 more)

### Community 20 - "Community 20"
Cohesion: 0.13
Nodes (59): feature/graphify-rebuild, feature/whats-new-recovery-codes, feature/whats-new-screenshots, fix/open-in-app-download, release/2.6.0, 017195e Merge branch 'feature/composer-emoji-picker' into develop, 0e0a5df Merge branch 'feature/2.6.0-prerelease' into develop, 129387d feat(web): write messages in a field that shows emoji as artwork (+51 more)

### Community 21 - "Community 21"
Cohesion: 0.06
Nodes (58): dbToAmplitude(), persistGateAuto(), persistMicrophoneVolume(), MicProcessor, MicrophoneCapture, disconnectAudioNode(), unpublishLocalMicrophone(), applyInputGainToCapture() (+50 more)

### Community 22 - "Community 22"
Cohesion: 0.08
Nodes (61): develop, feature/audit-hardening, 0b7bfc9 feat(web): add a desktop overlay for borderless games (#134), 0f64514 fix(web): open desktop notifications on their chat and group them per chat (#132), 1048bee chore(release): 2.6.2, 110c9be fix(api): keep banned visitors out of the room chat and roster reads, 1567749 docs: target architecture and migration plan for the API, 19bd00b docs: record the PR 9a shared TypeScript pilot (+53 more)

### Community 23 - "Community 23"
Cohesion: 0.05
Nodes (44): log, d6198c0 perf(web): build the microphone chain in one AudioContext, eventMatchesHotkey(), getDefaultHotkeyBinding(), getHotkeyStorageKey(), HotkeyAction, isTypingTarget(), parseHotkeyBinding() (+36 more)

### Community 24 - "Community 24"
Cohesion: 0.06
Nodes (38): AvatarStackItem, AvatarStackProps, 049a913 fix(web): keep popover open on ambiguous focus loss, 08bd491 fix(web): focus DM compose input when opening a friend chat (#28), 0a9be62 fix(web): keep room preview chat closed by default (#32), 0c20745 chore(release): back-merge 2.1.9, 0d74cad Merge branch 'release/2.1.6', 206a214 refactor(web): use shared slider in settings controls (+30 more)

### Community 25 - "Community 25"
Cohesion: 0.04
Nodes (45): 2d36bc7 fix(api): bound messaging schema locks, 2d8eac5 test(messaging): lock G20-G23 contracts, a2ee398 test(api): prove messaging pagination and reads, cb7ad0e feat(api): fence message delivery cutover, {
  buildHistoryEnvelope,
  normalizeHistoryRequest
}, canonicalParticipants(), createDmHistoryService(), DmHistoryError (+37 more)

### Community 26 - "Community 26"
Cohesion: 0.06
Nodes (63): attachMediaProjection(), attachReplyProjection(), broadcastDirectLinkPreview(), broadcastRoomLinkPreview(), cleanChatText(), cleanDmText(), clearRoomOccupancyRetries(), clearRoomOccupancyRetry() (+55 more)

### Community 27 - "Community 27"
Cohesion: 0.08
Nodes (56): applyRemoteScreenVideoDemand(), attachSubscribedRemoteScreenTrack(), attemptFreshLiveKitReplacement(), bindLiveKitRoomEvents(), clearAllScreenSubscriptionRetries(), clearScreenSubscriptionRetry(), connectLiveKitRoom(), connectLiveKitWithFallback() (+48 more)

### Community 28 - "Community 28"
Cohesion: 0.05
Nodes (38): 02d78bc Merge pull request #69 from dazeGG/hotfix/2.4.2-backmerge, 6cd4b30 fix(web): stabilize screen sharing in 2.4.2 (#68), cf1ea14 chore(release): back-merge 2.4.2 into develop, getScreenPublicationPresence(), ScreenPublicationPresence, getScreenReceiverDemand(), ScreenReceiverDemand, createScreenSubscriptionRetryController() (+30 more)

### Community 29 - "Community 29"
Cohesion: 0.07
Nodes (53): clampStreamVolume(), normalizeStoredStreamVolume(), storeStreamVolume(), Participant, clearScreenAttendance(), setScreenAttendance(), getAllParticipants(), getParticipantById() (+45 more)

### Community 30 - "Community 30"
Cohesion: 0.04
Nodes (56): ecf3155 build(api): wire Kysely with generated schema types and TypeBox, createKysely(), Database, DatabaseTransaction, AccountLoginEvents, AccountRecoveryCodes, CapabilityRuntimeHeartbeats, DB (+48 more)

### Community 31 - "Community 31"
Cohesion: 0.06
Nodes (42): AccountSecurity, addRoomByCode(), authPost(), authRead(), AuthRequestError, avatarRequest(), changePassword(), confirmLoginAlert() (+34 more)

### Community 32 - "Community 32"
Cohesion: 0.04
Nodes (14): 0a0699b chore: release v2.1.2, 0f3d7a0 Merge branch 'hotfix/2.1.3', 0ffac54 feat(infra): expose livekit prometheus metrics for status stack (#22), 1840f18 chore: release v2.1.4, 2684b15 chore: release v2.1.3, 3b24424 fix(web): move download control to sidebar footer, 537a9a4 fix(web): auto-join room on direct load and reload, 95a5ce7 fix(web): keep chat-open stage layout when reopening room (+6 more)

### Community 33 - "Community 33"
Cohesion: 0.06
Nodes (49): 8cc7010 Merge branch 'feature/api-room-chat' into develop, d4c0c0d refactor(api): fold the legacy room chat into domains/messaging, dca80ca Merge branch 'fix/web-contract-room-chat' into develop, fa8b877 docs: record the PR 4 room chat move, fc12312 test(web): read the room chat contract from domains/messaging, avatarColorForPeerId(), cleanChatText(), cleanUuid() (+41 more)

### Community 34 - "Community 34"
Cohesion: 0.04
Nodes (42): 177f5e3 test(api): prove durable message delivery, 93cad8e test(release): define G42 messaging checkpoint, readEnvInt(), { buildMessageDeliveryEvent }, createMessageOutboxRepository(), crypto, encodeParts(), logicalKey() (+34 more)

### Community 35 - "Community 35"
Cohesion: 0.05
Nodes (46): 1f54fa4 refactor(shared): move the emoji corpus, groups and skin tones to single TypeScript sources, 3b37d4b docs: record PR 9f and point the release note at account-security.ts, 61a08b3 Merge branch 'feature/shared-ts-messaging' into develop, 8508841 Merge branch 'feature/shared-ts-emoji' into develop, 937b8c2 refactor(shared): move the membership, notification, moderation, capability and account-security contracts to single TypeScript sources, 94b446c docs: record the PR 9d shared modules, cf23a18 docs: record the PR 9e shared modules and the single-source rule, e16ad73 Merge branch 'feature/shared-esm' into develop (+38 more)

### Community 36 - "Community 36"
Cohesion: 0.06
Nodes (30): BlockStatus, blockUrl(), blockUser(), unblockUser(), del(), fetchJson(), getJsonAuth(), log (+22 more)

### Community 38 - "Community 38"
Cohesion: 0.06
Nodes (18): accessibleName(), assertAccessibleName(), assertFocusOrder(), assertKeyboardActivation(), assertLiveRegion(), assertReducedMotionEnabled(), assertStableLayout(), text() (+10 more)

### Community 39 - "Community 39"
Cohesion: 0.05
Nodes (12): 01a206a chore: release v2.1.1, 08e3e13 Merge branch 'hotfix/2.2.1', 0d30394 chore: merge v2.1.1 back to develop, 17edd27 feat(web): add lobby voice controls widget, 3ce55ad fix(web): dedupe self avatar and drop count label in room list, 52c6592 Merge tag 'v2.2.1' into develop, b53f16e fix(web): show only online status in friends sidebar (#31), bd153ef chore(release): bump version to 2.2.1 (+4 more)

### Community 40 - "Community 40"
Cohesion: 0.06
Nodes (37): 4a15eab Merge pull request #143 from dazeGG/release/2.6.1, 5c8e7e1 Merge branch 'fix/ptt-idle-not-muted' into develop, 97d6dcd fix(web): stop showing idle push-to-talk as a muted microphone, bcdcd06 refactor(web): untangle room client import cycles, isMicrophoneShownMuted(), persistMicrophoneMode(), persistOutputMuted(), RoomLifecycleSummary (+29 more)

### Community 41 - "Community 41"
Cohesion: 0.06
Nodes (40): ACCOUNT_NOT_FOUND, AccountRoutesDeps, Answer, DELETION_UNAVAILABLE, Field, Refusal, registerAccountRoutes(), Responses (+32 more)

### Community 42 - "Community 42"
Cohesion: 0.07
Nodes (48): activeTargetSuppresses(), actorLabel(), BrowserNotificationPayload, buildNotificationPayload(), canUseNotifications(), cleanupMemoryDedupe(), consumeNotificationDedupeKey(), dedupeStorageKey() (+40 more)

### Community 44 - "Community 44"
Cohesion: 0.10
Nodes (46): 8b5b175 chore: merge v2.0.1 back to develop, 9d9411c Merge pull request #10 from dazeGG/hotfix/api-docker-workspace-start, a3f35c0 fix(web): keep self tile when muting, a864b9c fix(web): highlight active speaker tiles, bef8656 fix: start api workspace in docker image, cef76ec chore: release v2.0.1, e9dccb2 fix(web): recover remote microphone playback, applyRemoteScreenCue() (+38 more)

### Community 45 - "Community 45"
Cohesion: 0.08
Nodes (35): fetchNotificationPreferences(), normalizePreferences(), NotificationMuteResponse, NotificationPreferences, NotificationPreferencesResponse, RoomNotificationLevel, setDmNotificationsMuted(), setDoNotDisturb() (+27 more)

### Community 46 - "Community 46"
Cohesion: 0.07
Nodes (10): AvatarProps, BadgeProps, ButtonProps, 3db468e feat(web): Volt redesign — landing, lobby v2, shared UI (#38), 6584f79 feat: add uploaded avatars for users and rooms (#45), 7dd4a5f refactor(rooms): replace visual presets with fallback avatars (#44), DialogProps, SwitchProps (+2 more)

### Community 47 - "Community 47"
Cohesion: 0.06
Nodes (32): 2a9aa5b test(api): prove media quota and worker safety, 575dc80 fix(api): align private media boundaries, crypto, JOB_KINDS, mapMediaJob(), MediaJobFenceError, createStorageKey(), crypto (+24 more)

### Community 48 - "Community 48"
Cohesion: 0.07
Nodes (34): applySpeaking(), attachMeter(), isLocalMicrophoneSpeaking(), isOverSpeakingThreshold(), log, refreshMicrophoneLevelMeterSoon(), startMeters(), stopMeters() (+26 more)

### Community 49 - "Community 49"
Cohesion: 0.06
Nodes (16): playbackPolicy, e0eb12c chore(release): prepare 2.4.0, ContextMenuContentState, ContextMenuProps, reconcileAvatarStorage(), MascotIconProps, MascotVariant, ToastOptions (+8 more)

### Community 50 - "Community 50"
Cohesion: 0.06
Nodes (33): bf6a6a8 refactor(api): move direct messages into domains/messaging, f60d09c docs: record the PR 6b direct messages move, Answer, EMPTY_MESSAGE, MESSAGE_NOT_FOUND, MessageParams, NOT_FRIENDS, Refusal (+25 more)

### Community 51 - "Community 51"
Cohesion: 0.06
Nodes (30): createTransportId(), createWsTransport(), crypto, { buildRoomRealtimeSummaryFromLobbyRoom, createSummaryCoalescer }, { buildServerEnvelope, buildServerErrorEnvelope }, clearViewedScreenPeerReferences(), { createLogger }, createRoomRealtimeRuntime() (+22 more)

### Community 52 - "Community 52"
Cohesion: 0.13
Nodes (10): classifyRecoveryFailure(), DEFAULT_RETRY_DELAYS_MS, elapsedBucket(), RealtimeRecoveryController, RETRYABLE_CODES, SAFE_CODES, sanitizeRecoveryCode(), TERMINAL_CODES (+2 more)

### Community 53 - "Community 53"
Cohesion: 0.08
Nodes (24): 161b721 Merge branch 'feature/api-social' into develop, 23e7ee1 docs: record the PR 6a social domain, c4b10e3 refactor(api): move friends, blocks and room ringing into domains/social, Answer, CANNOT_BLOCK, FriendsRoutesDeps, IdParams, Refusal (+16 more)

### Community 55 - "Community 55"
Cohesion: 0.09
Nodes (18): AttachmentApiError, AttachmentContext, AttachmentDraft, AttachmentDraftState, createAttachmentSlot(), deleteAttachment(), Envelope, getAttachmentStatus() (+10 more)

### Community 56 - "Community 56"
Cohesion: 0.06
Nodes (29): CONTEXTS, createAttachmentRepository(), crypto, mapAttachment(), MIME_TYPES, assert, {
  createAttachmentRepository,
  mapAttachment
}, ROW (+21 more)

### Community 57 - "Community 57"
Cohesion: 0.15
Nodes (38): broadcastDmNotification(), broadcastToUser(), cleanUuid(), getFriendStore(), getMessageService(), getNotificationStore(), getProcessLogger(), handleBlockedList() (+30 more)

### Community 58 - "Community 58"
Cohesion: 0.07
Nodes (27): 0f4ed8a refactor(api): move notification settings and push subscriptions into domains/notifications, 371e6ef Merge branch 'feature/api-notifications' into develop, 44e7bf9 Merge branch 'feature/api-dm' into develop, 64a0448 docs: record the PR 7a notification settings move, Answer, Field, INVALID_TARGET, MUTATION_REFUSALS (+19 more)

### Community 59 - "Community 59"
Cohesion: 0.06
Nodes (26): 05f2a77 test(api): bind strict credential cutover, 10de220 test(api): prove active ban expiry in PostgreSQL, 501ef14 test(web): lock leave and rejoin flow, 849600b fix(api): persist membership after admission, d9f484d test(engagement): prove content and mention UoW, ebd3ed4 test(release): define G50 membership checkpoint, model, membershipModel (+18 more)

### Community 60 - "Community 60"
Cohesion: 0.07
Nodes (32): 81b0578 Merge branch 'feature/shared-ts' into develop, a70488b docs: record the PR 9b shared modules, bf84b79 Merge branch 'feature/shared-ts-core' into develop, ceca0d9 refactor(shared): move seven contract modules to single TypeScript sources, classifyPlatform(), classifyPlatformPolicy(), normalizedString(), PLATFORM_CLASSES (+24 more)

### Community 61 - "Community 61"
Cohesion: 0.08
Nodes (27): PinsRealtimeEvent, ReactionRealtimeEvent, RealtimeAccountEvent, RealtimeErrorEvent, RealtimeHandle, RealtimeRoomEvent, RoomRealtimeSummary, ServerEnvelope (+19 more)

### Community 62 - "Community 62"
Cohesion: 0.09
Nodes (7): 2ea3623 Merge pull request #116 from dazeGG/feature/2.5.0-manual-fixes, c80ed8a feat(web): expand contextual menus, ProfileCardAnchor, profileCardUi, ProfileCardPerson, ProfileCardProps, ProfileCardRelationship

### Community 63 - "Community 63"
Cohesion: 0.09
Nodes (25): createMessageReplyHandlers(), registerMessageReplyRoutes(), REPLY_CONFLICT_BODY, { ReplyTargetUnavailableError }, isInvitation(), isReplyTargetKindAllowed(), isUnavailable(), messageId() (+17 more)

### Community 64 - "Community 64"
Cohesion: 0.11
Nodes (23): emojiAssetName(), emojiAssetUrl(), 42e581f feat(web): draw reactions from bundled artwork and rebuild the picker, 690fee9 build(web): keep the emoji artwork source out of the runtime images, 7c3ad87 feat(web): switch reaction artwork to Twemoji and rework tone picking, 92c8df4 build(web): take emoji artwork from Discord's Twemoji release, bce62ab feat(web): draw emoji in text with the Twemoji colour font, cbaf1f5 Merge branch 'feature/2.5.0-fixes' into develop (+15 more)

### Community 65 - "Community 65"
Cohesion: 0.07
Nodes (25): createMembershipRepository(), crypto, mapDirectoryMember(), mapMembership(), toMillis(), registerMembershipRoutes(), { createMembershipRepository }, createMembershipService() (+17 more)

### Community 66 - "Community 66"
Cohesion: 0.10
Nodes (25): containsPath(), createCoordinatedSnapshot(), filesBelow(), resolvedProspectivePath(), sha256(), 06b943b fix(ops): bind media restore catalog, 1332815 feat(ops): add coordinated media restore, 2350242 build(api): define expiry-aware rescue profile (+17 more)

### Community 67 - "Community 67"
Cohesion: 0.07
Nodes (5): 2391bbe feat(web): migrate UI icons to Lucide (#42), iconLg, iconMd, iconSm, iconXs

### Community 68 - "Community 68"
Cohesion: 0.14
Nodes (28): main, 0d5875a fix: close migration dependency audit finding, 0f0c04b fix(web): align popover trigger inside chat action toolbars, 1718dc1 Bump version to 1.6.1, 2600ae8 Merge pull request #3 from dazeGG/fix/output-mute-unsubscribe, 28759aa fix(web): stack room reactions and keep the message toolbar reachable, 5b54d09 fix(web): remove viewer label from stream badge, 611153a test(web): anchor the DM polish e2e on the message row id (+20 more)

### Community 69 - "Community 69"
Cohesion: 0.08
Nodes (18): ComposerSelection, 5748635 Merge pull request #142 from dazeGG/release/2.6.0, d523ff1 chore(release): back-merge 2.6.0 into develop, parseInboundMessage(), createTypingThrottle(), { buildServerEnvelope, buildServerErrorEnvelope, parseInboundMessage }, { createLogger, hashIp }, { createTypingThrottle } (+10 more)

### Community 70 - "Community 70"
Cohesion: 0.07
Nodes (26): ACCOUNT_SECURITY_CONTRACT_VERSION, AccountDeletionPreview, AccountDeletionRoom, AccountSession, boundedText(), CLIENT_RULES, compareReleaseVersions(), formatRecoveryCode() (+18 more)

### Community 71 - "Community 71"
Cohesion: 0.07
Nodes (27): assert, { createTestDatabase }, { createUserStore }, crypto, { Pool }, { RECOVERY_CODES_ONBOARDING_KEY, normalizeRecoveryCode }, {
  RECOVERY_CODES_REMINDER_SNOOZE_MS,
  WHATS_NEW_VERSION,
  normalizeRecoveryCode
}, { runMigrations } (+19 more)

### Community 72 - "Community 72"
Cohesion: 0.10
Nodes (28): 09c4d42 feat(shared): add the room shared-music wire contract, a0fa2d6 feat(api): drive room shared-music sessions, edcdda0 feat(music-bot): add the shared-music bot backed by yt-dlp, ee1c6f6 feat(shared): add visual identity contracts, ACCOUNT_PEER_ID_PREFIX, accountPeerIdFor(), AVATAR_COLOR_KEY_SET, AvatarColorKey (+20 more)

### Community 73 - "Community 73"
Cohesion: 0.09
Nodes (26): 54d0582 Merge branch 'feature/api-skeleton' into develop, d21730c refactor(api): move the ops routes out of server.js behind an ApiContext, createDesktopReleaseService(), DesktopAsset, DesktopRelease, DesktopReleaseResult, DesktopReleaseService, DesktopReleaseServiceOptions (+18 more)

### Community 74 - "Community 74"
Cohesion: 0.09
Nodes (20): registerHttpKit(), Answer, AvatarRoutesDeps, httpError(), isTooLarge(), readAvatarUpload(), Refusal, registerAvatarRoutes() (+12 more)

### Community 75 - "Community 75"
Cohesion: 0.10
Nodes (27): ActiveBan, ActiveBanProfile, BanMutation, buildModerationPage(), cleanString(), durationToExpiresAt(), isRecord(), Loose (+19 more)

### Community 76 - "Community 76"
Cohesion: 0.14
Nodes (14): fetchReactionSummaries(), fetchReactors(), ReactionConversation, reactionUrl(), setReactionDesired(), validSummaries(), replaceReactionSnapshot(), cleanView() (+6 more)

### Community 77 - "Community 77"
Cohesion: 0.10
Nodes (22): 4ea02ee fix(api): harden temporary moderation flows, attachmentRevoker(), cleanupEnqueuer(), createMessageModerationService(), requireOperation(), { transaction }, createModerationRepository(), crypto (+14 more)

### Community 78 - "Community 78"
Cohesion: 0.07
Nodes (19): 53d093e test(api): execute hostile credential boundary scenarios, c928af9 fix(api): require exact migration catalog readiness, d02ad7f fix(release): resolve evidence from immutable external artifacts, f124c57 fix(web): verify reaction boundaries through rendered UI, assert, { createApiApp }, { createCredentialBoundaryService }, { createLiveKitAuthGateService } (+11 more)

### Community 79 - "Community 79"
Cohesion: 0.18
Nodes (12): authDialog(), createPermanentRoom(), enterRoom(), loginViaUi(), openRoomHeadingMenu(), openRoomSettings(), registerViaUi(), roomHeading() (+4 more)

### Community 80 - "Community 80"
Cohesion: 0.08
Nodes (21): AVATAR_KEY_PATTERN, createAvatarStorage(), fs, path, { readUploadsDir }, validateAvatarKey(), assert, { createApiApp } (+13 more)

### Community 81 - "Community 81"
Cohesion: 0.11
Nodes (24): buildRoomRealtimeSummary(), buildServerEnvelope(), ClientEnvelope, isPlainObject(), KNOWN_CLIENT_TYPES, Loose, MAX_VISIBLE_ROOM_PEERS, normalizeTypingActivity() (+16 more)

### Community 82 - "Community 82"
Cohesion: 0.08
Nodes (18): {
  ACCOUNT_DELETION_GRACE_MS,
  DELETED_ACCOUNT_NAME,
  DELETED_LOGIN_PREFIX
}, createAccountDeletionRepository(), crypto, PERSONAL_DATA_CLEANUP, { transaction }, { verifyPassword }, { ACCOUNT_DELETION_GRACE_MS }, assert (+10 more)

### Community 83 - "Community 83"
Cohesion: 0.11
Nodes (20): RealtimeEvent, RoomSnapshot, acknowledgeActiveVoiceResync(), clearActiveResync(), detailHandlers, ensureAppRealtimeConnected(), ensureReconnectRestore(), isRetryableActiveResyncError() (+12 more)

### Community 84 - "Community 84"
Cohesion: 0.14
Nodes (19): ApiConfig, Env, readApiConfig(), readinessReadySetFromEnv(), readJsonObject(), resolveRealtimeReconnectLeaseMs(), GracefulShutdownOptions, installGracefulShutdown() (+11 more)

### Community 85 - "Community 85"
Cohesion: 0.10
Nodes (18): 1709ead fix(api): centralize active room ban enforcement, createActiveBanRepository(), crypto, mapActiveBan(), normalizePrincipal(), toMillis(), { createActiveBanRepository, normalizePrincipal }, createActiveBanService() (+10 more)

### Community 86 - "Community 86"
Cohesion: 0.08
Nodes (22): 88169aa fix(api): preserve migration history with corrective follow-ups, ecc157a refactor(web): preserve async failure evidence, assert, { classifyPlatform }, { Client }, { createPushStore }, { createTestDatabase }, fs (+14 more)

### Community 87 - "Community 87"
Cohesion: 0.09
Nodes (20): bootstrap(), createApiServer(), installGracefulShutdown(), pruneRooms(), resolveRealtimeReconnectLeaseMs(), startPruneTimer(), assert, buildApp() (+12 more)

### Community 88 - "Community 88"
Cohesion: 0.13
Nodes (12): 1b46251 fix(web): fit the image viewer, tighten the picker, ping on mention only, 2207473 fix(web): make the tone strip reachable and settle the DM thread before showing it, 2bb0df7 feat(web): give images a real viewer, and open pending ones in it, 84ba47a feat(web): rebuild the notification centre, and retire notifications on read, 9c1c7df Merge branch 'feature/2.5.0-fixes' into develop, a0dac33 Merge branch 'feature/2.5.0-fixes' into develop, c22c49a Merge branch 'feature/2.5.0-fixes' into develop, e9bf7d5 feat(web): make a mention name a person you can act on (+4 more)

### Community 89 - "Community 89"
Cohesion: 0.14
Nodes (23): clearAllPeerJoinCues(), clearPeerJoinCue(), clearStreamViewerCues(), CueNote, getCueGain(), isCuePlaybackSuppressed(), log, peerJoinCueTimes (+15 more)

### Community 90 - "Community 90"
Cohesion: 0.09
Nodes (12): registerMediaRoutes(), assert, { createMediaVisibilityService }, fastify, { registerMediaRoutes }, require, test, assert (+4 more)

### Community 91 - "Community 91"
Cohesion: 0.11
Nodes (19): CAPABILITY_CONTRACT, CAPABILITY_SCHEMA_VERSION, CapabilityInternalNode, CapabilityManifest, CapabilityOperatorNode, CapabilityPublicNode, CapabilityReplicaConsensus, CapabilityRequires (+11 more)

### Community 92 - "Community 92"
Cohesion: 0.15
Nodes (22): addDesktopOverlayGame(), DEFAULT_SETTINGS, desktopOverlayAvailable(), DesktopOverlayForeground, DesktopOverlayParticipant, DesktopOverlayPatch, DesktopOverlaySettings, getBridge() (+14 more)

### Community 93 - "Community 93"
Cohesion: 0.16
Nodes (22): buildMessageDeliveryEvent(), cleanString(), ConversationRef, DELIVERY_EVENT_TYPES, IDEMPOTENCY_FINGERPRINT_MAX_LENGTH, IDEMPOTENCY_KEY_MAX_LENGTH, IDEMPOTENCY_KEY_MIN_LENGTH, IdempotencyDescriptor (+14 more)

### Community 95 - "Community 95"
Cohesion: 0.13
Nodes (21): buildHistoryEnvelope(), cleanString(), getReadCursorFromMessage(), HISTORY_CONTRACT_VERSION, HISTORY_DEFAULT_LIMIT, HISTORY_MAX_LIMIT, HISTORY_MODE_SET, HISTORY_MODES (+13 more)

### Community 96 - "Community 96"
Cohesion: 0.12
Nodes (19): buildNotificationEnvelope(), buildProviderPayload(), cleanString(), Loose, normalizeNotificationEnvelope(), normalizeNotificationItem(), NOTIFICATION_CONTRACT_VERSION, NOTIFICATION_DEFAULT_LIMIT (+11 more)

### Community 97 - "Community 97"
Cohesion: 0.11
Nodes (10): getInitials(), FullscreenView, getActiveScreenPeer(), getScreenMetaView(), getScreenViewers(), getStreamVolumeView(), ScreenMetaView, screenUi (+2 more)

### Community 98 - "Community 98"
Cohesion: 0.10
Nodes (13): registerPinRoutes(), assert, { createPinRepository }, { createPinService }, { createRoomStore }, { createTestDatabase }, { createUserStore }, Fastify (+5 more)

### Community 99 - "Community 99"
Cohesion: 0.13
Nodes (4): AppRealtimeConnection, connectRealtime(), getAppRealtime(), wsUrl()

### Community 100 - "Community 100"
Cohesion: 0.15
Nodes (8): conversationKey(), createReplyStore(), normalizeTarget(), ReplyAuthor, ReplyConversation, ReplySendInput, ReplyStore, ReplyTarget

### Community 101 - "Community 101"
Cohesion: 0.15
Nodes (18): 9dfc933 refactor(shared): make the shared package ES modules with .ts sources, cleanHttpUrl(), cleanString(), CONTENT_VERSION, contentFromLegacyText(), normalizeRoomMessageContent(), normalizeSegment(), projectKnownContent() (+10 more)

### Community 102 - "Community 102"
Cohesion: 0.13
Nodes (18): ac1c7f4 fix(api): allow safe guest reaction reads, ad596da test(api): prove reaction persistence invariants, d43fd78 fix(shared): accept signed reactor cursors, cleanCursor(), cleanId(), Loose, normalizeReactionMutation(), normalizeReactionRevision() (+10 more)

### Community 103 - "Community 103"
Cohesion: 0.12
Nodes (16): createMediaService(), detectExactContainer(), FORMAT_MIME, MediaServiceError, PNG_END, readBounded(), sharp, assert (+8 more)

### Community 104 - "Community 104"
Cohesion: 0.19
Nodes (18): asSet(), buildNodeMap(), compareReplicas(), createReadinessProvider(), crypto, evaluateFromOptions(), evaluatePublicNode(), evaluateRawManifest() (+10 more)

### Community 105 - "Community 105"
Cohesion: 0.12
Nodes (16): assert, { createApiServer }, createFriends(), createModerationStore(), createUsers(), crypto, fs, http (+8 more)

### Community 106 - "Community 106"
Cohesion: 0.13
Nodes (16): cleanUpstreamUrl(), { createCredentialBoundaryService }, { createDbPool }, { createGateCredentialSigner }, createLiveKitAuthGateService(), { createLogger }, { createRoomStore }, deny() (+8 more)

### Community 107 - "Community 107"
Cohesion: 0.15
Nodes (14): CapabilityFeatures, CapabilityKey, CapabilityResponse, isCapabilityReady(), loadCapabilities(), resetCapabilities(), CapabilityEdge, CapabilityState (+6 more)

### Community 109 - "Community 109"
Cohesion: 0.17
Nodes (18): { AccessToken, TrackSource }, assertCase(), { createDbPool }, { createGateCredentialSigner }, { createRoomStore }, directLocalhostPortClosed(), mintCredentials(), openWebSocket() (+10 more)

### Community 110 - "Community 110"
Cohesion: 0.20
Nodes (16): flipPlacementVertical(), parsePlacement(), resolvePopoverPlacement(), viewportSpaceAroundTrigger(), PlacementAxis, PopoverCloseReason, PopoverContentState, PopoverDividerProps (+8 more)

### Community 112 - "Community 112"
Cohesion: 0.15
Nodes (13): checkApiSources(), crossDomainTablesFor(), findSqlWrites(), findTimers(), globToRegExp(), isOwner(), normalizePath(), walkFiles() (+5 more)

### Community 113 - "Community 113"
Cohesion: 0.15
Nodes (18): buildMembershipEnvelope(), cleanString(), isObject(), Loose, MEMBER_PRESENCE_STATUSES, MemberPresenceStatus, MEMBERSHIP_CONTRACT_VERSION, MEMBERSHIP_DEFAULT_LIMIT (+10 more)

### Community 114 - "Community 114"
Cohesion: 0.18
Nodes (14): deleteModeratedMessage(), fetchActiveBans(), parsePage(), putBan(), responseJson(), roomModerationUrl(), unban(), BAN_DURATIONS (+6 more)

### Community 116 - "Community 116"
Cohesion: 0.16
Nodes (15): clean(), decodeEntities(), decodeHtmlBody(), extractLinkPreviewMetadata(), NAMED_ENTITIES, parseAttributes(), resolveHttpUrl(), { createLogger } (+7 more)

### Community 117 - "Community 117"
Cohesion: 0.11
Nodes (11): ADMISSION_INTERNAL_COVERAGE_SCRIPT, { createGateCredentialSigner }, { createLiveKitAuthGateService, extractCredential }, { createRoomRealtimeRuntime }, { createRoomStore }, FakeSocket, greenSummary, require (+3 more)

### Community 118 - "Community 118"
Cohesion: 0.23
Nodes (15): FetchMembershipsOptions, fetchRoomMemberships(), leaveRoomMembership(), applyRoomVoicePeers(), cacheKey(), clearRoomMembership(), emptyEntry(), getRoomMembership() (+7 more)

### Community 119 - "Community 119"
Cohesion: 0.18
Nodes (12): fetchRoomPins(), pinAuthor(), PinnedMessage, PinnedMessageAuthor, PinResponse, pinRoomMessage(), PinSnapshot, pinUrl() (+4 more)

### Community 120 - "Community 120"
Cohesion: 0.13
Nodes (12): BLOCKED_SUBNETS, dns, http, https, isPublicAddress(), net, REDIRECT_STATUSES, assert (+4 more)

### Community 121 - "Community 121"
Cohesion: 0.12
Nodes (15): assert, automaticPresenceMigration, avatarMigration, dndMigration, friendsMigration, membershipMigration, messageEditingMigration, migration (+7 more)

### Community 122 - "Community 122"
Cohesion: 0.21
Nodes (13): deletePushSubscription(), fetchPushConfig(), PushConfig, savePushSubscription(), decodeVapidKey(), detachPushSubscription(), getRegistration(), isDesktopRuntime() (+5 more)

### Community 123 - "Community 123"
Cohesion: 0.14
Nodes (2): AvatarCropDialogProps, AvatarCropShape

### Community 124 - "Community 124"
Cohesion: 0.28
Nodes (15): DEFAULT_FREQUENT_REACTIONS, FrequentReaction, frequentReactionKey(), loadFrequentReactions(), localStorageKey(), memory, normalizeEntries(), openDatabase() (+7 more)

### Community 125 - "Community 125"
Cohesion: 0.17
Nodes (15): args, bindingText(), builtins, camel(), convert(), dryRun, files, isBuiltin() (+7 more)

### Community 126 - "Community 126"
Cohesion: 0.14
Nodes (10): CONTEXT_TABLES, createReactionRepository(), requireQuery(), assert, { createReactionRepository }, { createTestDatabase }, fs, { Pool } (+2 more)

### Community 127 - "Community 127"
Cohesion: 0.20
Nodes (12): clearDisconnectedHiddenEmbed(), clearViewedRoom(), connectedRoomIsViewed(), embeddedRoomIsVisible(), getActiveVoiceRoomId(), openActiveVoiceRoom(), roomNavigation, RoomShellMode (+4 more)

### Community 128 - "Community 128"
Cohesion: 0.16
Nodes (13): BrowserIdleDetector, BrowserIdleDetectorConstructor, createPresenceIdleController(), DesktopIdleBridge, DesktopIdleScope, EventTarget, getDesktopIdleSecondsReader(), hasGrantedBrowserIdlePermission() (+5 more)

### Community 129 - "Community 129"
Cohesion: 0.23
Nodes (14): AvatarAccentPresentation, AvatarAccentRgb, clamp(), deriveAvatarAccent(), fitChromaToSrgb(), isInSrgbGamut(), LinearRgb, linearToSrgb() (+6 more)

### Community 130 - "Community 130"
Cohesion: 0.17
Nodes (7): FakeAudioContext, FakeMediaStream, FakeNode, getServer(), loadBus(), voiceElement(), webRoot

### Community 131 - "Community 131"
Cohesion: 0.13
Nodes (4): DeniedNotification, FakeNotification, require, ts

### Community 132 - "Community 132"
Cohesion: 0.13
Nodes (12): extractCredential(), assert, { createApiApp }, { createGateCredentialSigner }, { createLiveKitAuthGateService, extractCredential }, { EventEmitter }, fs, net (+4 more)

### Community 133 - "Community 133"
Cohesion: 0.21
Nodes (9): DesktopAsset, DesktopRelease, fetchDesktopRelease(), DESKTOP_BUILDS, DesktopBuild, detectDesktopBuildId(), isDesktopReleaseAssetUrl(), startDesktopBuildDownload() (+1 more)

### Community 134 - "Community 134"
Cohesion: 0.36
Nodes (14): fix/ptt-idle-not-muted, 1ae08e2 chore(release): back-merge 2.5.12 into develop, 253c24d feat(web): overlay avatar size and panel hints (#138), 3fa3f2e chore(release): back-merge 2.5.10 into develop, 7c03069 Merge pull request #141 from dazeGG/hotfix/2.5.12-backmerge, 929ba0d fix(web): desktop overlay avatars, custom games and idle opacity (#136), af5e82a feat(web): simpler overlay settings and stream state for the desktop HUD (#140), cad2af8 Merge pull request #137 from dazeGG/hotfix/2.5.10-backmerge (+6 more)

### Community 135 - "Community 135"
Cohesion: 0.13
Nodes (12): readUploadsDir(), crypto, fs, { LINK_PREVIEW_IMAGE_KEY_PATTERN }, path, { readUploadsDir }, reconcileLinkPreviewImages(), assert (+4 more)

### Community 136 - "Community 136"
Cohesion: 0.18
Nodes (12): AttachmentContext, AttachmentState, attachmentTextFallback(), MessageAttachment, MIME_TYPES, normalizeAttachment(), normalizeAttachments(), STATES (+4 more)

### Community 137 - "Community 137"
Cohesion: 0.14
Nodes (12): assert, { countWsType, joinVoiceRoom, openWs, sendWs, subscribeRoomPreview, waitForWsType }, { createTestDatabase }, fs, http, os, path, { socketPathForDirectory } (+4 more)

### Community 138 - "Community 138"
Cohesion: 0.14
Nodes (13): assert, { createTestDatabase }, crypto, fs, MIGRATIONS_DIR, path, { Pool }, { runMigrations } (+5 more)

### Community 139 - "Community 139"
Cohesion: 0.19
Nodes (11): DesktopNotificationPayload, BridgeResult, DesktopBridge, resolveBridge(), showDesktopNotification(), browserNavigator(), classifyPlatform(), classifyPlatformPolicy() (+3 more)

### Community 140 - "Community 140"
Cohesion: 0.15
Nodes (10): createWsHandler(), assert, createHandler(), createRegistry(), { createWsHandler }, { EventEmitter }, FakeSocket, test (+2 more)

### Community 141 - "Community 141"
Cohesion: 0.25
Nodes (13): applySkinTone(), build(), data(), hasSkinToneVariants(), isCollapsedSkinToneVariant(), listCollapsedReactionEmojis(), listSkinToneVariants(), SKIN_TONES (+5 more)

### Community 142 - "Community 142"
Cohesion: 0.25
Nodes (12): DEFAULT_RUNTIME_CONFIG, getRuntimeConfig(), inheritLiveKitGateCredential(), normalizeLiveKitServerUrl(), normalizeLiveKitUrl(), normalizePayload(), parseRuntimeConfig(), resolveLiveKitConnectUrls() (+4 more)

### Community 143 - "Community 143"
Cohesion: 0.14
Nodes (10): { ACCOUNT_DELETION_GRACE_MS, DELETED_ACCOUNT_NAME }, assert, { createAccountDeletionRepository }, { createTestDatabase }, { createUserStore }, crypto, { Pool }, { runMigrations } (+2 more)

### Community 144 - "Community 144"
Cohesion: 0.14
Nodes (11): assert, crypto, {
  EMOJI_REACTION_AUTHORITY,
  assertReactionEmoji,
  cleanReactionEmoji,
  isReactionEmoji,
  listReactionEmojis
}, fs, PACKAGE_JSON, path, { pathToFileURL }, ROOT (+3 more)

### Community 145 - "Community 145"
Cohesion: 0.29
Nodes (12): ChatDraft, ChatDraftScope, chatDraftScopeKey(), chatDraftStorageKey(), clearChatDrafts(), loadChatDraft(), normalizeChatDrafts(), normalizeMentions() (+4 more)

### Community 146 - "Community 146"
Cohesion: 0.15
Nodes (10): 0b4c646 feat(platform): enforce G14 capability readiness, assert, { createCapabilitySnapshot }, { createReadinessReport, sha256Hex }, {
  INTERNAL_NODE_KEYS,
  OPERATOR_KEYS,
  PUBLIC_CAPABILITY_KEYS,
  normalizeManifest
}, { mkdtempSync, readFileSync, writeFileSync }, path, repositoryRoot (+2 more)

### Community 147 - "Community 147"
Cohesion: 0.23
Nodes (7): 5cf267b fix(room): preserve chat scroll and participant state, formatTime(), pad(), formatChatDayLabel(), isSameDay(), MONTHS, startOfDay()

### Community 149 - "Community 149"
Cohesion: 0.22
Nodes (11): createAvatarKey(), crypto, { deriveAvatarAccent, dominantAvatarColor }, detectAvatarFormat(), { detectImageFormat }, processAvatar(), sharp, assert (+3 more)

### Community 150 - "Community 150"
Cohesion: 0.21
Nodes (9): createProofOfWork(), crypto, hasLeadingZeroBits(), normalizePowNonce(), parsePowChallenge(), assert, crypto, {
  hasLeadingZeroBits,
  parsePowChallenge,
  normalizePowNonce,
  createProofOfWork
} (+1 more)

### Community 151 - "Community 151"
Cohesion: 0.23
Nodes (10): authorize(), { createGateCredentialSigner }, createMemoryGateStore(), extractCredential(), mint(), readTopologyEvidence(), require, runAuthGateProof() (+2 more)

### Community 152 - "Community 152"
Cohesion: 0.19
Nodes (8): actorLockKey(), boundedString(), crypto, encodeParts(), IdempotencyConflictError, IdempotencyQuotaError, ledgerKey(), normalizeIdentity()

### Community 153 - "Community 153"
Cohesion: 0.26
Nodes (11): cacheKey(), configCache, defaultConfig(), fetchRuntimeConfig(), hasSuspiciousSecrets(), loadRuntimeConfig(), resolveConfigOrigin(), resolveConfigUrl() (+3 more)

### Community 154 - "Community 154"
Cohesion: 0.21
Nodes (11): cleanText(), firstPreviewableUrl(), LinkPreview, LinkPreviewImage, MAX_LINK_PREVIEW_DESCRIPTION, MAX_LINK_PREVIEW_IMAGE_SIDE, MAX_LINK_PREVIEW_SITE_NAME, MAX_LINK_PREVIEW_TITLE (+3 more)

### Community 155 - "Community 155"
Cohesion: 0.18
Nodes (6): PLURAL_VERB, SINGLE_VERB, TYPING_ACTIVITIES, TypingActivity, TypingEntry, TypingPerson

### Community 156 - "Community 156"
Cohesion: 0.17
Nodes (10): createReadinessReport(), assert, { createReadinessReport }, fs, path, { readMessageDeliveryMode }, { test }, assert (+2 more)

### Community 158 - "Community 158"
Cohesion: 0.21
Nodes (1): ScreenRecoveryGraceController

### Community 159 - "Community 159"
Cohesion: 0.24
Nodes (5): buildHeaderPolicy(), readMetaPolicy(), renderCaddySnippet(), repoRoot, repositoryRoot

### Community 160 - "Community 160"
Cohesion: 0.18
Nodes (11): assert, { createTestDatabase }, fs, get(), http, os, path, { socketPathForDirectory } (+3 more)

### Community 161 - "Community 161"
Cohesion: 0.17
Nodes (7): ACCESS_TOKEN, assert, CLAIMS, { createLiveKitAuthGateService }, { EventEmitter }, net, test

### Community 162 - "Community 162"
Cohesion: 0.24
Nodes (10): hasSurfaceToken(), isAllowedBackground(), lineAt(), paletteViolations(), root, sourceFiles(), sourceRoot, styleFragments() (+2 more)

### Community 165 - "Community 165"
Cohesion: 0.38
Nodes (10): cleanContext(), cleanLevel(), cleanNamespace(), cleanSessionId(), cleanText(), cleanTimestamp(), CLIENT_LOG_LEVELS, normalizeClientLogBatch() (+2 more)

### Community 166 - "Community 166"
Cohesion: 0.22
Nodes (8): apps/CLAUDE.md, docs/GIT_FLOW.md, .github CLAUDE.md Policy, Pull Request Template, docs/RELEASE_<version>_PLAN.md, Root CLAUDE.md, Room client architecture (ARCHITECTURE.md), apps/web/CLAUDE.md

### Community 167 - "Community 167"
Cohesion: 0.27
Nodes (8): BROWSABLE_EMOJIS, BROWSABLE_SET, EmojiCategory, hasSkinToneChoices(), isOfferedEmoji(), OFFERED, skinToneChoices(), withSkinTone()

### Community 168 - "Community 168"
Cohesion: 0.22
Nodes (5): buildAppRoomLink(), markInAppRoomNavigation(), OpenInAppSignals, PRODUCTION_HOSTS, resolveAppLinkScheme()

### Community 169 - "Community 169"
Cohesion: 0.36
Nodes (3): dbToAmplitude(), getSmoothingCoefficient(), VoiceRoomNoiseGateProcessor

### Community 170 - "Community 170"
Cohesion: 0.22
Nodes (3): configure(), deferred(), MemoryStorage

### Community 172 - "Community 172"
Cohesion: 0.31
Nodes (8): buildTrie(), codePoints(), EmojiTextPart, hasEmoji(), matchAt(), splitEmoji(), TRIE, TrieNode

### Community 173 - "Community 173"
Cohesion: 0.28
Nodes (6): createFailureLimiter(), createRateLimiter(), getClientIp(), assert, { getClientIp, createRateLimiter }, test

### Community 176 - "Community 176"
Cohesion: 0.36
Nodes (8): desktopAutostartAvailable(), DesktopAutostartPatch, DesktopAutostartSettings, getBridge(), log, normalizeSettings(), readDesktopAutostartSettings(), updateDesktopAutostartSettings()

### Community 177 - "Community 177"
Cohesion: 0.31
Nodes (8): bindDesktopCallActions(), CALL_ACTIONS, DesktopCallAction, DesktopCallState, getBridge(), log, syncDesktopCallState(), toPayload()

### Community 179 - "Community 179"
Cohesion: 0.22
Nodes (7): bans, chatPanel, lobbyRoomSettings, members, model, roomSettings, root

### Community 180 - "Community 180"
Cohesion: 0.25
Nodes (1): RealtimeHeartbeatWatchdog

### Community 181 - "Community 181"
Cohesion: 0.25
Nodes (7): api, chat, component, lobby, members, model, room

### Community 182 - "Community 182"
Cohesion: 0.32
Nodes (4): getFocusedParticipant(), getParticipantCount(), getSortedParticipants(), participantsUi

### Community 183 - "Community 183"
Cohesion: 0.32
Nodes (7): cleanId(), MAX_MENTION_CANDIDATES, MAX_MENTIONS_PER_MESSAGE, MentionNormalization, MENTIONS_CONTRACT_VERSION, mentionUserIdsFromContent(), normalizeMentionUserIds()

### Community 184 - "Community 184"
Cohesion: 0.29
Nodes (8): closePeer(), getLiveKitRoomName(), isLiveKitParticipantAlreadyGone(), queueRoomOccupancyTransition(), removeLiveKitParticipant(), resolveServerMutePermission(), runModeratedPeerCleanup(), setLiveKitParticipantMuted()

### Community 185 - "Community 185"
Cohesion: 0.32
Nodes (4): getServer(), loadDrafts(), memoryStorage(), webRoot

### Community 186 - "Community 186"
Cohesion: 0.29
Nodes (4): getServer(), loadTyping(), require, webRoot

### Community 187 - "Community 187"
Cohesion: 0.29
Nodes (5): assert, { createApiApp }, openWs(), test, waitForFrame()

### Community 188 - "Community 188"
Cohesion: 0.25
Nodes (5): assert, fs, path, require, test

### Community 189 - "Community 189"
Cohesion: 0.33
Nodes (4): fingerprint(), SendShadow, SendShadowState, stableJson()

### Community 191 - "Community 191"
Cohesion: 0.48
Nodes (7): docs/CLAUDE.md governance rules, VoiceRoom 2.5.0 consolidated execution plan, Git Flow workflow, VoiceRoom 2.5.0 unified messaging platform PRD, Release 2.4.0 verification plan, Release 2.4.1 verification plan, Release 2.4.2 hotfix verification plan

### Community 192 - "Community 192"
Cohesion: 0.29
Nodes (6): dm, picker, reactors, room, store, summary

### Community 193 - "Community 193"
Cohesion: 0.29
Nodes (4): MMDB_METADATA_MARKER, now, previousMonth, target

### Community 194 - "Community 194"
Cohesion: 0.33
Nodes (5): { createReadinessReport, resolveManifestPath }, createRuntimeReadinessProvider(), { createRuntimeReadinessRepository }, failClosedSnapshot(), { PUBLIC_CAPABILITY_KEYS }

### Community 195 - "Community 195"
Cohesion: 0.29
Nodes (2): require, ts

### Community 196 - "Community 196"
Cohesion: 0.29
Nodes (1): TestMediaStream

### Community 197 - "Community 197"
Cohesion: 0.38
Nodes (5): FOCUSABLE_SELECTOR, focusInitialElement(), FocusTrapOptions, getFocusableElements(), isHTMLElement()

### Community 198 - "Community 198"
Cohesion: 0.60
Nodes (5): ChatMessage, mentionProfilePerson(), participantProfilePerson(), presenceFor(), roomMessageProfilePerson()

### Community 199 - "Community 199"
Cohesion: 0.33
Nodes (6): Desktop Support Matrix Doc (G19), Release 2.5.0 Durable Evidence Archive Doc (G03), Coordinated Media Backup and Restore Doc, Release 2.5.0 Budgets Doc (G91), Release 2.5.0 Develop Entry Doc (G93), Release 2.5.0 RC Preflight Doc

### Community 200 - "Community 200"
Cohesion: 0.40
Nodes (5): crypto, { isAllowedImage }, PREVIEW_IMAGE_FORMATS, processLinkPreviewImage(), sharp

### Community 201 - "Community 201"
Cohesion: 0.53
Nodes (4): normalizeMessageId(), normalizeRoomId(), PinServiceError, requireAccount()

### Community 202 - "Community 202"
Cohesion: 0.47
Nodes (5): bindDesktopLinks(), DesktopLink, getBridge(), matches(), normalizeDesktopLink()

### Community 203 - "Community 203"
Cohesion: 0.33
Nodes (1): LiveKitReconcileGeneration

### Community 204 - "Community 204"
Cohesion: 0.40
Nodes (2): o, s()

### Community 205 - "Community 205"
Cohesion: 0.33
Nodes (2): participantContextMenu, ParticipantMenuVariant

### Community 206 - "Community 206"
Cohesion: 0.33
Nodes (6): baseHeaders(), getLinkPreviewStorage(), getLiveKitConnectSources(), handleGetAvatar(), handleGetLinkPreviewImage(), openAvatarStream()

### Community 207 - "Community 207"
Cohesion: 0.40
Nodes (5): loadRoomRealtime(), moduleUrl(), require, root, ts

### Community 208 - "Community 208"
Cohesion: 0.40
Nodes (5): assert, { createApiApp }, openAccountWs(), test, waitForFrame()

### Community 209 - "Community 209"
Cohesion: 0.40
Nodes (3): getServer(), loadEmojiText(), webRoot

### Community 210 - "Community 210"
Cohesion: 0.33
Nodes (1): FakeBroadcastChannel

### Community 211 - "Community 211"
Cohesion: 0.33
Nodes (4): assert, { createGeoLocator }, path, test

### Community 212 - "Community 212"
Cohesion: 0.33
Nodes (1): FakeServer

### Community 213 - "Community 213"
Cohesion: 0.60
Nodes (4): isToneIndex(), loadSkinTone(), saveSkinTone(), SkinToneIndex

### Community 215 - "Community 215"
Cohesion: 0.40
Nodes (5): Expiry-Aware Rescue Profile Doc (G85), Predeploy Migrations Doc, Release 2.6.0 Plan — Engagement & Notifications (Superseded), Release 2.7.0 Plan — Media & Moderation (Superseded), VoiceRoom 2.5.0 Unified — Verification and Release Evidence Specification

### Community 216 - "Community 216"
Cohesion: 0.60
Nodes (4): createPinRepository(), mapPin(), requireQuery(), toMillis()

### Community 217 - "Community 217"
Cohesion: 0.50
Nodes (2): applyRoomSwitchDecision(), writeRoomSwitchConfirmEnabled()

### Community 218 - "Community 218"
Cohesion: 0.70
Nodes (3): SelectOption, SelectProps, SelectVariant

### Community 219 - "Community 219"
Cohesion: 0.50
Nodes (1): VoiceRoomDesktopAudioSourceProcessor

### Community 220 - "Community 220"
Cohesion: 0.40
Nodes (1): FakeSocket

### Community 221 - "Community 221"
Cohesion: 0.40
Nodes (1): FakeClient

### Community 222 - "Community 222"
Cohesion: 0.40
Nodes (1): FakeSocket

### Community 224 - "Community 224"
Cohesion: 0.67
Nodes (2): copyTextFor(), handleEmojiCopy()

### Community 225 - "Community 225"
Cohesion: 0.50
Nodes (1): NotificationInboxTransport

### Community 226 - "Community 226"
Cohesion: 0.50
Nodes (2): extensions, files

### Community 227 - "Community 227"
Cohesion: 0.50
Nodes (2): NAME_SITES, webRoot

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
- **2295 isolated node(s):** `Env`, `ApiConfig`, `GracefulShutdownOptions`, `PERSONAL_DATA_CLEANUP`, `ActiveVoice` (+2290 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 123`** (2 nodes): `AvatarCropDialogProps`, `AvatarCropShape`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 158`** (1 nodes): `ScreenRecoveryGraceController`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 180`** (1 nodes): `RealtimeHeartbeatWatchdog`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 195`** (2 nodes): `require`, `ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 196`** (1 nodes): `TestMediaStream`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 203`** (1 nodes): `LiveKitReconcileGeneration`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 204`** (2 nodes): `o`, `s()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 205`** (2 nodes): `participantContextMenu`, `ParticipantMenuVariant`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 210`** (1 nodes): `FakeBroadcastChannel`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 212`** (1 nodes): `FakeServer`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 217`** (2 nodes): `applyRoomSwitchDecision()`, `writeRoomSwitchConfirmEnabled()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 219`** (1 nodes): `VoiceRoomDesktopAudioSourceProcessor`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 220`** (1 nodes): `FakeSocket`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 221`** (1 nodes): `FakeClient`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 222`** (1 nodes): `FakeSocket`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 224`** (2 nodes): `copyTextFor()`, `handleEmojiCopy()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 225`** (1 nodes): `NotificationInboxTransport`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 226`** (2 nodes): `extensions`, `files`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 227`** (2 nodes): `NAME_SITES`, `webRoot`
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

- **Why does `RealtimeRecoveryController` connect `Community 52` to `Community 17`?**
  _High betweenness centrality (0.007) - this node is a cross-community bridge._
- **Why does `AppRealtimeConnection` connect `Community 99` to `Community 61`?**
  _High betweenness centrality (0.004) - this node is a cross-community bridge._
- **What connects `Env`, `ApiConfig`, `GracefulShutdownOptions` to the rest of the system?**
  _2295 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.05180943655519927 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.008337012700309067 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.011667615253272624 - nodes in this community are weakly interconnected._
- **Should `Community 3` be split into smaller, more focused modules?**
  _Cohesion score 0.01602324616023246 - nodes in this community are weakly interconnected._