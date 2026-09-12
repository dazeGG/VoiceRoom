# Graph Report - .  (2026-09-12)

## Corpus Check
- Large corpus: 725 files · ~346 031 words. Semantic extraction will be expensive (many Claude tokens). Consider running on a subfolder, or use --no-semantic to run AST-only.

## Summary
- 5723 nodes · 15487 edges · 224 communities detected
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 6 edges (avg confidence: 0.73)
- Token cost: 0 input · 0 output
- Edge kinds: contains: 4263 · MODIFIES: 4066 · ON_BRANCH: 2695 · calls: 1729 · imports: 1082 · imports_from: 726 · PARENT_OF: 622 · method: 206 · re_exports: 59 · references: 23 · inherits: 9 · conceptually_related_to: 4 · semantically_similar_to: 2 · implements: 1


## Input Scope
- Requested: auto
- Resolved: committed (source: default-auto)
- Included files: 725 · Candidates: 805
- Excluded: 3 untracked · 46440 ignored · 13 sensitive · 0 missing committed
- Recommendation: Use --scope all or graphify.yaml inputs.corpus for a knowledge-base folder.

## Graph Freshness
- Built from Git commit: `b69970a`
- Compare this hash to `git rev-parse HEAD` before trusting freshness-sensitive graph output.
## God Nodes (most connected - your core abstractions)
1. `sendJson()` - 68 edges
2. `createTestDatabase()` - 35 edges
3. `runMigrations()` - 34 edges
4. `readJsonBody()` - 30 edges
5. `RealtimeRecoveryController` - 30 edges
6. `requireSessionUser()` - 29 edges
7. `handleRoomChatPost()` - 25 edges
8. `getRoomStore()` - 22 edges
9. `createApiApp()` - 21 edges
10. `broadcastToUser()` - 19 edges

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
Cohesion: 0.01
Nodes (177): { createDbPool }, createRelease250Pool(), createDirectMessageRepository(), createMessageReadRepository(), registerRoomHistoryRoutes(), createRoomMessageRepository(), registerNotificationRoutes(), { assertMigrationReady, runMigrations } (+169 more)

### Community 1 - "Community 1"
Cohesion: 0.02
Nodes (40): emojiAssetName(), emojiAssetUrl(), SelectedMention, isToneIndex(), loadSkinTone(), saveSkinTone(), SkinToneIndex, 2d36bc7 fix(api): bound messaging schema locks (+32 more)

### Community 2 - "Community 2"
Cohesion: 0.04
Nodes (91): isRoomEmbedded(), extractRoomId(), clearPeerJoinCue(), ApiRequestError, checkRoomExists(), postJson(), cancelRoomRecovery(), isCurrentRoomRecoveryEpoch() (+83 more)

### Community 3 - "Community 3"
Cohesion: 0.03
Nodes (22): 043b73d chore: release v2.1.5, 2391bbe feat(web): migrate UI icons to Lucide (#42), 564c893 feat(web): support centered nine-tile room layout, 634b607 feat(web): prepare Voice Room 1.7.0, 9976dab Merge tag 'v2.1.5' into develop, aed41e8 fix(web): harden room svelte migration, e31d9e6 feat(web): add participant context menu, ff38a51 Merge branch 'release/2.1.5' (+14 more)

### Community 4 - "Community 4"
Cohesion: 0.08
Nodes (99): develop, feature/room-shared-music, main, wip/discord-redesign, 0112d02 fix(infra): pin livekit server version, 02824cd fix(web): surface friend request errors, 07e362c chore(omx): update model routing, 0df0656 fix(ci): authenticate artifactless G01 recovery (+91 more)

### Community 5 - "Community 5"
Cohesion: 0.02
Nodes (19): 29612d4 fix(web): move room moderation into settings sections and popup menus, c2613dd fix(web): move room moderation into settings sections and popup menus (#124), d500d14 chore(release): back-merge 2.5.2 into develop, ActiveBan, ActiveBanProfile, BanMutation, ModerationDuration, ModerationPage (+11 more)

### Community 6 - "Community 6"
Cohesion: 0.03
Nodes (72): 0ec8255 chore(release): bump version to 2.2.3, 2adaec0 Merge branch 'hotfix/2.2.3-ci', 3f83f05 Merge branch 'release/2.2.0', 4cfb160 chore(release): bump version to 2.2.0, 7524c15 feat(realtime): add websocket room updates, bc6c32c Merge tag 'v2.2.3' into develop, beffc4f Merge tag 'v2.2.0' into develop, cf119b8 fix(api): wait for fresh websocket summary frames (+64 more)

### Community 7 - "Community 7"
Cohesion: 0.03
Nodes (53): del(), fetchJson(), patchJson(), postJson(), postJsonAuth(), putJson(), createRoomProof(), hasLeadingZeroBits() (+45 more)

### Community 8 - "Community 8"
Cohesion: 0.12
Nodes (83): feature/2.5.0-manual-fixes, feature/2.5.0-to-rc, feature/docs-cleanup, hotfix/room-membership-backfill, release/2.5.0, 01e9d33 feat(room): add side panel participant roster, 01f4965 fix(livekit): unblock browser room joins, 025e0ee test(ci): align G08 with raw TCP gate (+75 more)

### Community 9 - "Community 9"
Cohesion: 0.03
Nodes (60): 1578df6 feat: add account settings, 208f295 feat(presence): add selectable account statuses, 22a796b Merge pull request #8 from feature/404-page, 3580978 fix(api): harden session and cookie write security, 4a8d9fc fix(api): address room persistence review findings, a5a9bf8 chore(dev): update docker workflow docs, cc7f297 Merge pull request: chore private monitoring agent, ec9f802 feat(api): persist visual identity keys (+52 more)

### Community 10 - "Community 10"
Cohesion: 0.04
Nodes (36): addRoomByCode(), authPost(), AuthUser, avatarRequest(), changePassword(), Credentials, deleteUserAvatar(), fetchMe() (+28 more)

### Community 11 - "Community 11"
Cohesion: 0.08
Nodes (60): feature/cd-pipeline, feature/desktop-app-settings, hotfix/room-moderation-ui, 0580b9c Merge branch 'feature/cd-pipeline' into develop, 0f0c04b fix(web): align popover trigger inside chat action toolbars, 1051d9c fix(web): make the speaking ring report who is actually audible, 1a262f9 feat(shared): group reaction emoji, 1fa0876 docs: remove shipped release plans and stale notes (+52 more)

### Community 12 - "Community 12"
Cohesion: 0.04
Nodes (42): ReadReconciliationOptions, 19902ab feat: prepare 2.5.0 RC and polish chats (#114), 4553c35 fix(web): reconcile repeated cross-tab read cursors, 54086b4 fix(api): serialize notification retraction revisions, 8e66057 fix(ci): fail release gates on wrong branch, b3732be fix(notifications): make inbox revisions monotonic, d8e3847 test(web): prove messaging reconciliation flows, fcd0beb fix(ci): bind OCI evidence to Actions archive bytes (+34 more)

### Community 13 - "Community 13"
Cohesion: 0.04
Nodes (23): 01a206a chore: release v2.1.1, 0a0699b chore: release v2.1.2, 0d30394 chore: merge v2.1.1 back to develop, 0d74cad Merge branch 'release/2.1.6', 0f3d7a0 Merge branch 'hotfix/2.1.3', 0ffac54 feat(infra): expose livekit prometheus metrics for status stack (#22), 1840f18 chore: release v2.1.4, 2684b15 chore: release v2.1.3 (+15 more)

### Community 14 - "Community 14"
Cohesion: 0.04
Nodes (54): ac8e530 fix(notifications): persist explicit all room level, d56e835 fix(notifications): preserve conservative room policy, createDbPool(), { Pool }, { readDatabaseConfig }, { recordPgPoolError }, transaction(), { cleanPresenceStatus } (+46 more)

### Community 15 - "Community 15"
Cohesion: 0.04
Nodes (49): 5dd3691 test(api): serialize database suites, b16c894 fix(api): expose fail-closed release telemetry, bf6bba7 test(api): cover media backlog age query, fa382b2 fix(api): derive backlog age directly from storage, recordMediaOldestPending(), createMediaJobRepository(), crypto, JOB_KINDS (+41 more)

### Community 16 - "Community 16"
Cohesion: 0.05
Nodes (60): acceptFriendRequest(), cancelFriendRequest(), declineFriendRequest(), fetchFriends(), fetchRequests(), Friend, FriendLastMessage, IncomingRequest (+52 more)

### Community 17 - "Community 17"
Cohesion: 0.04
Nodes (52): 2204c26 fix(api): make users who added a room its members, 2d08528 chore(release): back-merge 2.5.1 into develop, b3c2b1d fix(api): make users who added a room its members (#122), assert, { createTestDatabase }, fs, http, { openWs, joinVoiceRoom, subscribeRoomPreview, waitForWsType } (+44 more)

### Community 18 - "Community 18"
Cohesion: 0.06
Nodes (59): dbToAmplitude(), persistMicrophoneVolume(), MicProcessor, MicrophoneCapture, applySpeaking(), attachMeter(), isLocalMicrophoneSpeaking(), isOverSpeakingThreshold() (+51 more)

### Community 19 - "Community 19"
Cohesion: 0.05
Nodes (54): 0f64514 fix(web): open desktop notifications on their chat and group them per chat (#132), 4023189 fix: DM notifications, single message cue, Russian notification text (#130), 78d9e92 chore(release): back-merge 2.5.7 into develop, 897f6d3 chore(release): back-merge 2.5.8 into develop, b69970a Merge pull request #133 from dazeGG/hotfix/2.5.8-backmerge, activeTargetSuppresses(), actorLabel(), BrowserNotificationPayload (+46 more)

### Community 20 - "Community 20"
Cohesion: 0.04
Nodes (45): 995ced6 test(api): give spawned test servers 15 seconds to become ready, da2ffb3 fix(release): stabilize G01-G03 foundation gates (#112), assert, { createTestDatabase }, fs, http, os, path (+37 more)

### Community 21 - "Community 21"
Cohesion: 0.05
Nodes (25): RoomPeer, AvatarCropDialogProps, AvatarCropShape, 6584f79 feat: add uploaded avatars for users and rooms (#45), e0eb12c chore(release): prepare 2.4.0, reconcileAvatarStorage(), MascotIconProps, MascotVariant (+17 more)

### Community 22 - "Community 22"
Cohesion: 0.05
Nodes (41): c928af9 fix(api): require exact migration catalog readiness, d02ad7f fix(release): resolve evidence from immutable external artifacts, acquireMigrationLock(), advisoryLockParts(), assertMigrationLockHeld(), assertMigrationReady(), assertNoDirtyMigrationState(), { Client } (+33 more)

### Community 23 - "Community 23"
Cohesion: 0.06
Nodes (38): eventMatchesHotkey(), getDefaultHotkeyBinding(), getHotkeyStorageKey(), HotkeyAction, isTypingTarget(), parseHotkeyBinding(), readHotkeyBinding(), writeHotkeyBinding() (+30 more)

### Community 24 - "Community 24"
Cohesion: 0.04
Nodes (41): 05f2a77 test(api): bind strict credential cutover, 501ef14 test(web): lock leave and rejoin flow, d9f484d test(engagement): prove content and mention UoW, ebd3ed4 test(release): define G50 membership checkpoint, membershipModel, routes, service, voiceSession (+33 more)

### Community 25 - "Community 25"
Cohesion: 0.05
Nodes (35): a2ee398 test(api): prove messaging pagination and reads, {
  buildHistoryEnvelope,
  normalizeHistoryRequest
}, canonicalParticipants(), createDmHistoryService(), DmHistoryError, createMessageReadService(), MessageReadError, {
  buildHistoryEnvelope,
  normalizeHistoryRequest
} (+27 more)

### Community 26 - "Community 26"
Cohesion: 0.06
Nodes (18): accessibleName(), assertAccessibleName(), assertFocusOrder(), assertKeyboardActivation(), assertLiveRegion(), assertReducedMotionEnabled(), assertStableLayout(), text() (+10 more)

### Community 27 - "Community 27"
Cohesion: 0.07
Nodes (53): attachMediaProjection(), attachReplyProjection(), cleanChatText(), cleanDmText(), clearRoomOccupancyRetries(), clearRoomOccupancyRetry(), createApiApp(), createFastifyLoggerOptions() (+45 more)

### Community 28 - "Community 28"
Cohesion: 0.09
Nodes (46): clampStreamVolume(), getStoredStreamVolume(), normalizeStoredStreamVolume(), storeStreamVolume(), clearScreenAttendance(), setScreenAttendance(), activateScreenStageUi(), bindScreenStageIdleUi() (+38 more)

### Community 29 - "Community 29"
Cohesion: 0.07
Nodes (41): a0ff17a feat(web): improve sound settings with sliders and cue volume (#30), MicrophoneMode, NOISE_MODES, NoiseMode, NoiseModeOption, SCREEN_QUALITY_ORDER, ScreenFpsOption, ScreenQualityOption (+33 more)

### Community 30 - "Community 30"
Cohesion: 0.13
Nodes (51): broadcastDmNotification(), broadcastToUser(), broadcastUserProfileToFriends(), checkPushSubscriptionRate(), cleanPushSubscription(), cleanUuid(), expireRoomInvitations(), getFriendStore() (+43 more)

### Community 31 - "Community 31"
Cohesion: 0.08
Nodes (43): 9c3b5e4 feat(audio): add unified playback bus (#54), getParticipantAudioPreferenceKey(), getStoredMasterVolume(), applyAudioBusOutput(), AudioBusGraph, AudioBusKind, busNode(), connectDefaultOutput() (+35 more)

### Community 32 - "Community 32"
Cohesion: 0.05
Nodes (30): cc45703 fix(api): expose worker metrics across process boundaries, http, { renderPrometheus }, startWorkerMetricsServer(), registerMediaRoutes(), createMediaVisibilityService(), MediaVisibilityError, assert (+22 more)

### Community 33 - "Community 33"
Cohesion: 0.05
Nodes (14): 48b24e0 fix: room notifications for all members, desktop badge, unread for new members, 7b6f5cb feat(web): add desktop autostart settings (#123), c6c3247 fix: room notifications for all members, desktop badge and unread for new members (#129), d6b1773 chore(release): back-merge 2.5.6 into develop, edf009e feat(web): add desktop autostart settings, countUnreadForBadge(), DesktopBadgeInput, getBridge() (+6 more)

### Community 35 - "Community 35"
Cohesion: 0.08
Nodes (35): fetchNotificationPreferences(), normalizePreferences(), NotificationMuteResponse, NotificationPreferences, NotificationPreferencesResponse, RoomNotificationLevel, setDmNotificationsMuted(), setDoNotDisturb() (+27 more)

### Community 36 - "Community 36"
Cohesion: 0.06
Nodes (34): 177f5e3 test(api): prove durable message delivery, 93cad8e test(release): define G42 messaging checkpoint, { buildMessageDeliveryEvent }, createMessageOutboxRepository(), crypto, encodeParts(), logicalKey(), MessageDeliveryFenceError (+26 more)

### Community 37 - "Community 37"
Cohesion: 0.10
Nodes (45): 1a5009b fix(web): remove transient voice-connecting placeholder, 56ebf7a docs: document root-scoped omx runtime usage, 6895206 fix(web): remove desktop app region from topbar, 8b5b175 chore: merge v2.0.1 back to develop, cef76ec chore: release v2.0.1, e9dccb2 fix(web): recover remote microphone playback, applyRemoteScreenCue(), applyStreamViewerCue() (+37 more)

### Community 38 - "Community 38"
Cohesion: 0.05
Nodes (33): cf49285 fix(api): reconcile media across replicas, CONTEXTS, createAttachmentRepository(), crypto, mapAttachment(), MIME_TYPES, createMediaQuotaRepository(), createMediaQuotaService() (+25 more)

### Community 39 - "Community 39"
Cohesion: 0.06
Nodes (16): AvatarProps, 08e3e13 Merge branch 'hotfix/2.2.1', 1594fb0 feat(web): refine chat and room interactions, 17edd27 feat(web): add lobby voice controls widget, 397400d chore(release): bump version to 2.2.2, 3b6010b Merge branch 'release/2.2.2', 3ce55ad fix(web): dedupe self avatar and drop count label in room list, 52c6592 Merge tag 'v2.2.1' into develop (+8 more)

### Community 40 - "Community 40"
Cohesion: 0.08
Nodes (32): 2c5f8d4 feat(web): show stream quality on tile thumbnails, 65f8383 chore: removed status agent file, 67b668e chore: merge v2.0.2 back to develop, 7f48829 feat(web): render visual identity tokens, aaef77d fix(web): move stream metadata onto thumbnails, b3728e3 feat: add guest name modal for room entry, b48e553 chore: release v2.0.2, c860746 feat(web): add static rooms and room chat UI (+24 more)

### Community 41 - "Community 41"
Cohesion: 0.06
Nodes (29): 02d78bc Merge pull request #69 from dazeGG/hotfix/2.4.2-backmerge, 6cd4b30 fix(web): stabilize screen sharing in 2.4.2 (#68), cf1ea14 chore(release): back-merge 2.4.2 into develop, getScreenPublicationPresence(), ScreenPublicationPresence, getScreenReceiverDemand(), ScreenReceiverDemand, createScreenSubscriptionRetryController() (+21 more)

### Community 42 - "Community 42"
Cohesion: 0.06
Nodes (34): 7609180 fix(web): harden reaction convergence, 824382d test(release): define G71 engagement checkpoint, ac1c7f4 fix(api): allow safe guest reaction reads, ad596da test(api): prove reaction persistence invariants, ae1827c fix(reactions): converge updates across realtime clients, b541a05 test(api): resolve reaction fixtures from workspace, d43fd78 fix(shared): accept signed reactor cursors, ff08a8e test(api): exercise gate through postgres and network boundaries (+26 more)

### Community 43 - "Community 43"
Cohesion: 0.07
Nodes (34): containsPath(), createCoordinatedSnapshot(), filesBelow(), resolvedProspectivePath(), sha256(), 06b943b fix(ops): bind media restore catalog, 1332815 feat(ops): add coordinated media restore, 166a0e8 test(release): resolve rescue fixtures from repository root (+26 more)

### Community 44 - "Community 44"
Cohesion: 0.06
Nodes (33): c02e107 fix(web): recover attachment compose safely, d37be0b feat(api): expose media pressure health, composer, dm, room, store, css, dm (+25 more)

### Community 45 - "Community 45"
Cohesion: 0.06
Nodes (34): 2a9aa5b test(api): prove media quota and worker safety, 575dc80 fix(api): align private media boundaries, createMediaService(), detectExactContainer(), FORMAT_MIME, MediaServiceError, PNG_END, readBounded() (+26 more)

### Community 47 - "Community 47"
Cohesion: 0.08
Nodes (30): createMessageReplyHandlers(), registerMessageReplyRoutes(), REPLY_CONFLICT_BODY, { ReplyTargetUnavailableError }, isInvitation(), isReplyTargetKindAllowed(), isUnavailable(), messageId() (+22 more)

### Community 48 - "Community 48"
Cohesion: 0.10
Nodes (36): DesktopAudioCapture, DesktopPickerSelection, ScreenSourceSelection, applyScreenCaptureProfile(), CaptureAttemptDetail, CaptureError, createBrowserDisplayMediaConstraints(), createDesktopAudioContext() (+28 more)

### Community 49 - "Community 49"
Cohesion: 0.13
Nodes (10): classifyRecoveryFailure(), DEFAULT_RETRY_DELAYS_MS, elapsedBucket(), RealtimeRecoveryController, RETRYABLE_CODES, SAFE_CODES, sanitizeRecoveryCode(), TERMINAL_CODES (+2 more)

### Community 50 - "Community 50"
Cohesion: 0.09
Nodes (26): RoomRealtimeSummary, AvatarStackItem, AvatarStackProps, 0c20745 chore(release): back-merge 2.1.9, 206a214 refactor(web): use shared slider in settings controls, 3fe3910 test(web): update slider contract tests, 46cb450 feat(web): extend shared slider customization, 98e9f11 chore(release): merge 2.1.9 (+18 more)

### Community 51 - "Community 51"
Cohesion: 0.09
Nodes (18): AttachmentApiError, AttachmentContext, AttachmentDraft, AttachmentDraftState, createAttachmentSlot(), deleteAttachment(), Envelope, getAttachmentStatus() (+10 more)

### Community 52 - "Community 52"
Cohesion: 0.05
Nodes (2): 3c617ec style(web): polish dm day separator, 7db2783 docs(monitoring): align LiveKit track metric labels

### Community 53 - "Community 53"
Cohesion: 0.08
Nodes (33): assertReactionEmoji(), cleanReactionEmoji(), EMOJI_REACTION_AUTHORITY, buildGroups(), GROUP_ANCHORS, listReactionEmojiGroups(), { listReactionEmojis }, reactionEmojiGroupKey() (+25 more)

### Community 54 - "Community 54"
Cohesion: 0.09
Nodes (33): 0753576 fix(web): show avatars in stream placeholders, 08bd491 fix(web): focus DM compose input when opening a friend chat (#28), 0a9be62 fix(web): keep room preview chat closed by default (#32), 1ddbd67 fix(web): show viewer avatars in stream badge, 29b0612 fix(web): keep room preview chat open, 2ce6059 test(shared): lock attachment contracts, 3940c26 fix(web): preserve friend online status across realtime race (#27), 4125282 fix(room): resolve roster room from route (+25 more)

### Community 55 - "Community 55"
Cohesion: 0.11
Nodes (37): authorizeRoomMutation(), broadcast(), broadcastRoomUpdate(), checkAvatarUploadRate(), closePeer(), countRoomCreationQuotaRoomsForIp(), disconnectModeratedPeer(), finalizeModeratedPeers() (+29 more)

### Community 56 - "Community 56"
Cohesion: 0.06
Nodes (23): playbackPolicy, 5d709c6 feat: add open-app push notifications (#43), c948bb7 feat(notifications): add do not disturb settings (#53), toWsAccountEvent(), assert, automaticPresenceMigration, avatarMigration, dndMigration (+15 more)

### Community 57 - "Community 57"
Cohesion: 0.08
Nodes (21): authorize(), { createGateCredentialSigner }, createMemoryGateStore(), extractCredential(), mint(), readTopologyEvidence(), require, runAuthGateProof() (+13 more)

### Community 58 - "Community 58"
Cohesion: 0.08
Nodes (25): { createReadinessReport, resolveManifestPath }, createRuntimeReadinessProvider(), { createRuntimeReadinessRepository }, failClosedSnapshot(), { PUBLIC_CAPABILITY_KEYS }, createRuntimeReadinessRepository(), { createDbPool }, { createRuntimeReadinessRepository } (+17 more)

### Community 59 - "Community 59"
Cohesion: 0.08
Nodes (13): AppRealtimeConnection, connectRealtime(), getAppRealtime(), PinsRealtimeEvent, ReactionRealtimeEvent, RealtimeAccountEvent, RealtimeErrorEvent, RealtimeEvent (+5 more)

### Community 60 - "Community 60"
Cohesion: 0.10
Nodes (22): 31b4543 feat(web): desktop links, call controls, diagnostics and room switch confirmation (#126), 8592f77 chore(release): back-merge 2.5.4 into develop, bbf6f6d chore(release): 2.5.3 (#125), d1fd487 chore(release): 2.5.4 (#127), d7f74b9 chore(release): back-merge 2.5.3 into develop, f814d20 chore(release): prepare 2.5.4, applyRoomSwitchDecision(), writeRoomSwitchConfirmEnabled() (+14 more)

### Community 61 - "Community 61"
Cohesion: 0.10
Nodes (9): BadgeProps, ButtonProps, 3db468e feat(web): Volt redesign — landing, lobby v2, shared UI (#38), DialogProps, ToastOptions, toastState, SwitchProps, ToastItem (+1 more)

### Community 62 - "Community 62"
Cohesion: 0.07
Nodes (20): 20fdff5 feat(api): persist static rooms and chat, fs, net, startApiListener(), assert, fs, os, path (+12 more)

### Community 63 - "Community 63"
Cohesion: 0.11
Nodes (9): 2ea3623 Merge pull request #116 from dazeGG/feature/2.5.0-manual-fixes, 60484d7 feat(api): add contextual social and room actions, c80ed8a feat(web): expand contextual menus, ProfileCardAnchor, profileCardUi, ProfileCardPerson, ProfileCardProps, ProfileCardRelationship (+1 more)

### Community 64 - "Community 64"
Cohesion: 0.10
Nodes (22): 4ea02ee fix(api): harden temporary moderation flows, attachmentRevoker(), cleanupEnqueuer(), createMessageModerationService(), requireOperation(), { transaction }, createModerationRepository(), crypto (+14 more)

### Community 65 - "Community 65"
Cohesion: 0.10
Nodes (21): 33a3ea7 fix(api): remove a left room from the list through the room store, createMembershipRepository(), crypto, mapDirectoryMember(), mapMembership(), toMillis(), registerMembershipRoutes(), { createMembershipRepository } (+13 more)

### Community 66 - "Community 66"
Cohesion: 0.10
Nodes (19): 164b853 refactor(web): neutral input placeholders, dedicated dev port, desktop drag region (#16), 3f9d416 wip: discord-style redesign (spaces/channels), 7d47c23 fix(web): preserve dev API proxy origin, c03d726 feat(web): refine room not-found page, d2ae430 docs(web): document dev proxy origin contract, e2dc193 chore: removed agents md, clearDisconnectedHiddenEmbed(), clearViewedRoom() (+11 more)

### Community 67 - "Community 67"
Cohesion: 0.12
Nodes (26): 234177e feat(web): redesign screen source picker, 9ba8ece feat(web): tune screen share encoding, SCREEN_FPS_OPTIONS, SCREEN_QUALITY_OPTIONS, SCREEN_SIMULCAST_LAYER, SCREEN_STREAM_MODE_PROFILES, ScreenProfile, ScreenStreamMode (+18 more)

### Community 68 - "Community 68"
Cohesion: 0.16
Nodes (20): 53d093e test(api): execute hostile credential boundary scenarios, f124c57 fix(web): verify reaction boundaries through rendered UI, dm, picker, reactors, room, store, summary (+12 more)

### Community 69 - "Community 69"
Cohesion: 0.08
Nodes (21): AVATAR_KEY_PATTERN, createAvatarStorage(), fs, path, { readUploadsDir }, validateAvatarKey(), assert, { createApiApp } (+13 more)

### Community 70 - "Community 70"
Cohesion: 0.11
Nodes (16): 12b694d fix(web): refine room controls and stream notices (#58), 141c6b7 fix(web): clear room badges while reading, 22239a5 feat(chat): add room unread badges, 5b7d102 chore(release): back-merge 2.4.0 into develop, 70b16b9 fix(web): align stream tiles and viewer cues (#59), 76fc735 Add desktop notification enable setting, a511d06 fix(web): align muted notification indicators, aaefeca fix(avatar): align dominant color extraction (+8 more)

### Community 71 - "Community 71"
Cohesion: 0.11
Nodes (21): 5d910ea fix(notifications): fail closed on provider errors, cleanPushEndpoint(), crypto, describePushEndpoint(), EXACT_PUSH_HOSTS, isAllowedPushHost(), { cleanPushEndpoint, describePushEndpoint }, createPushService() (+13 more)

### Community 72 - "Community 72"
Cohesion: 0.13
Nodes (22): deletePushSubscription(), fetchPushConfig(), PushConfig, savePushSubscription(), decodeVapidKey(), detachPushSubscription(), getRegistration(), isDesktopRuntime() (+14 more)

### Community 73 - "Community 73"
Cohesion: 0.08
Nodes (7): 049a913 fix(web): keep popover open on ambiguous focus loss, 31409db style(web): restore dock device popover chrome, 6113243 chore(release): bump version to 2.1.11, 81d9540 Merge tag 'v2.1.11' into develop, b951aa0 Merge tag 'v2.1.10' into develop, cd88873 style(web): show settings sound volume value, ff9ac77 Merge branch 'release/2.1.11'

### Community 74 - "Community 74"
Cohesion: 0.10
Nodes (18): 1709ead fix(api): centralize active room ban enforcement, createActiveBanRepository(), crypto, mapActiveBan(), normalizePrincipal(), toMillis(), { createActiveBanRepository, normalizePrincipal }, createActiveBanService() (+10 more)

### Community 75 - "Community 75"
Cohesion: 0.11
Nodes (17): b6c5445 fix(api): reuse account avatar color in calls, {
  AVATAR_COLOR_KEYS,
  cleanAvatarColorKey
}, avatarColorForPeerId(), { createActiveBanService }, { createDbPool, transaction }, crypto, mapMessage(), mapPeerIdentity() (+9 more)

### Community 76 - "Community 76"
Cohesion: 0.09
Nodes (17): createPinRepository(), mapPin(), requireQuery(), toMillis(), registerPinRoutes(), assert, { createPinRepository }, { createPinService } (+9 more)

### Community 77 - "Community 77"
Cohesion: 0.10
Nodes (22): deleteDirectMessage(), DirectMessage, DirectMessageHistoryPage, DirectMessageInvite, editDirectMessage(), fetchThread(), fetchThreadPage(), HistoryMessageDto (+14 more)

### Community 78 - "Community 78"
Cohesion: 0.11
Nodes (19): RoomSnapshot, acknowledgeActiveVoiceResync(), clearActiveResync(), detailHandlers, ensureAppRealtimeConnected(), ensureReconnectRestore(), isRetryableActiveResyncError(), joinVoiceRoom() (+11 more)

### Community 79 - "Community 79"
Cohesion: 0.09
Nodes (18): 2d8eac5 test(messaging): lock G20-G23 contracts, cb7ad0e feat(api): fence message delivery cutover, createMessageService(), { createMessageVisibilityService }, createMessageVisibilityService(), MessageVisibilityError, assert, history (+10 more)

### Community 80 - "Community 80"
Cohesion: 0.15
Nodes (23): ParsedScreenStats, ScreenStatsPrevious, unpublishLocalScreenTracks(), setLocalAppAudioSuppressed(), applyLocalScreenEncodingProfile(), applyLocalScreenProfileState(), applyScreenSenderEncoding(), findLocalScreenVideoPublication() (+15 more)

### Community 81 - "Community 81"
Cohesion: 0.15
Nodes (22): asSet(), buildNodeMap(), compareReplicas(), createReadinessProvider(), createReadinessReport(), crypto, evaluateFromOptions(), evaluatePublicNode() (+14 more)

### Community 82 - "Community 82"
Cohesion: 0.11
Nodes (17): checkApiSources(), findSqlWrites(), findTimers(), globToRegExp(), isOwner(), normalizePath(), walkFiles(), checkImportBoundaries() (+9 more)

### Community 83 - "Community 83"
Cohesion: 0.09
Nodes (18): createApiServer(), assert, buildApp(), { createApiApp, createApiServer }, createFakeFriends(), createFakeStore(), createFakeUsers(), fs (+10 more)

### Community 84 - "Community 84"
Cohesion: 0.12
Nodes (20): 13254ae docs: document durable room storage, 1886650 feat(api): persist rooms and chat in postgres, 364b82c build(api): fence G15 predeploy migrations, 8fdccbd chore(scripts): default to docker compose workflows, a36adca chore(docker): add postgres compose workflows, path, readDatabaseConfig(), readEnvBool() (+12 more)

### Community 85 - "Community 85"
Cohesion: 0.13
Nodes (20): persistMicrophoneMode(), persistOutputMuted(), supportsAudioOutputSelection(), beginPushToTalk(), CallControlsView, endPushToTalk(), handleMicButtonClick(), OutputControlsView (+12 more)

### Community 86 - "Community 86"
Cohesion: 0.14
Nodes (13): 1b46251 fix(web): fit the image viewer, tighten the picker, ping on mention only, 2207473 fix(web): make the tone strip reachable and settle the DM thread before showing it, 2bb0df7 feat(web): give images a real viewer, and open pending ones in it, 7c3ad87 feat(web): switch reaction artwork to Twemoji and rework tone picking, 84ba47a feat(web): rebuild the notification centre, and retire notifications on read, 9c1c7df Merge branch 'feature/2.5.0-fixes' into develop, a0dac33 Merge branch 'feature/2.5.0-fixes' into develop, c22c49a Merge branch 'feature/2.5.0-fixes' into develop (+5 more)

### Community 88 - "Community 88"
Cohesion: 0.10
Nodes (18): 10de220 test(api): prove active ban expiry in PostgreSQL, 40320f3 fix(release): authenticate oci evidence producers, 6b3fc40 fix(release): require canonical merge commit authority, 74df7a9 fix(api): revoke only failed admission credential, 760fdfe fix(api): remediate oversized attachments before validation, 849600b fix(api): persist membership after admission, model, { buildMembershipEnvelope, normalizeMembershipRequest } (+10 more)

### Community 89 - "Community 89"
Cohesion: 0.16
Nodes (21): clearAllPeerJoinCues(), clearStreamViewerCues(), CueNote, getCueGain(), isCuePlaybackSuppressed(), peerJoinCueTimes, playCueSequence(), playDirectMessageCue() (+13 more)

### Community 90 - "Community 90"
Cohesion: 0.11
Nodes (17): 0b4c646 feat(platform): enforce G14 capability readiness, 5459a43 feat(platform): harden G13 runtime configuration edge, createCapabilitySnapshot(), formatCapabilityPayload(), HEALTH_CAPABILITIES_LIMITS, { PUBLIC_CAPABILITY_KEYS }, publicFeatureFlags(), registerCapabilityRoutes() (+9 more)

### Community 91 - "Community 91"
Cohesion: 0.10
Nodes (13): assert, { createApiApp }, { createCredentialBoundaryService }, { createLiveKitAuthGateService }, { createRoomStore }, { createTestDatabase }, fs, net (+5 more)

### Community 92 - "Community 92"
Cohesion: 0.15
Nodes (8): conversationKey(), createReplyStore(), normalizeTarget(), ReplyAuthor, ReplyConversation, ReplySendInput, ReplyStore, ReplyTarget

### Community 93 - "Community 93"
Cohesion: 0.13
Nodes (16): { buildServerEnvelope }, legacyPeerMessageToWs(), { buildRoomRealtimeSummaryFromLobbyRoom, createSummaryCoalescer }, { buildServerEnvelope, buildServerErrorEnvelope }, createRoomRealtimeRuntime(), { createWsTransport }, { legacyPeerMessageToWs }, {
  normalizeRoomId,
  normalizePeerId,
  normalizeSessionToken,
  cleanName,
  cleanStreamId,
  cleanScreenProfileId
} (+8 more)

### Community 94 - "Community 94"
Cohesion: 0.12
Nodes (10): getAllParticipants(), getParticipantById(), FullscreenView, getActiveScreenPeer(), getScreenMetaView(), getScreenViewers(), getStreamVolumeView(), ScreenMetaView (+2 more)

### Community 95 - "Community 95"
Cohesion: 0.16
Nodes (18): AVATAR_COLOR_KEY_SET, cleanAvatarColorKey(), cleanDisplayName(), cleanLiveKitUrl(), cleanPresenceStatus(), cleanRoomName(), cleanScreenProfileId(), cleanStreamId() (+10 more)

### Community 96 - "Community 96"
Cohesion: 0.15
Nodes (14): CapabilityFeatures, CapabilityKey, CapabilityResponse, isCapabilityReady(), loadCapabilities(), resetCapabilities(), CapabilityEdge, CapabilityState (+6 more)

### Community 97 - "Community 97"
Cohesion: 0.11
Nodes (16): 88e8e93 test(release): define physical support matrix gate, b318c49 test(web): prove desktop root boundary, c4b1a22 test(api): enforce exact migration lock budget, assert, { classifyPlatform }, { Client }, { createPushStore }, { createTestDatabase } (+8 more)

### Community 98 - "Community 98"
Cohesion: 0.12
Nodes (6): e0f8314 feat(web): refine room and lobby interactions, getFocusedParticipant(), getParticipantCount(), getSortedParticipants(), participantsUi, root

### Community 99 - "Community 99"
Cohesion: 0.17
Nodes (18): { AccessToken, TrackSource }, assertCase(), { createDbPool }, { createGateCredentialSigner }, { createRoomStore }, directLocalhostPortClosed(), mintCredentials(), openWebSocket() (+10 more)

### Community 100 - "Community 100"
Cohesion: 0.13
Nodes (12): actorLockKey(), boundedString(), createMessageIdempotencyRepository(), crypto, encodeParts(), IdempotencyConflictError, IdempotencyQuotaError, ledgerKey() (+4 more)

### Community 101 - "Community 101"
Cohesion: 0.20
Nodes (16): flipPlacementVertical(), parsePlacement(), resolvePopoverPlacement(), viewportSpaceAroundTrigger(), PlacementAxis, PopoverCloseReason, PopoverContentState, PopoverDividerProps (+8 more)

### Community 102 - "Community 102"
Cohesion: 0.25
Nodes (19): applyRemoteScreenVideoDemand(), attachSubscribedRemoteScreenTrack(), clearScreenSubscriptionRetry(), ensureRemoteMicrophonePlayback(), getRemoteScreenDemand(), handleLiveKitTrackSubscribed(), handleLiveKitTrackSubscriptionFailed(), handleLiveKitTrackUnpublished() (+11 more)

### Community 103 - "Community 103"
Cohesion: 0.11
Nodes (12): assert, { createTestDatabase }, fs, http, { openWs, joinVoiceRoom, sendWs, waitForWsType }, os, path, { socketPathForDirectory } (+4 more)

### Community 104 - "Community 104"
Cohesion: 0.18
Nodes (14): deleteModeratedMessage(), fetchActiveBans(), parsePage(), putBan(), responseJson(), roomModerationUrl(), unban(), BAN_DURATIONS (+6 more)

### Community 105 - "Community 105"
Cohesion: 0.22
Nodes (5): cleanView(), createReactionStore(), ReactionStore, reactorKey(), revision()

### Community 106 - "Community 106"
Cohesion: 0.14
Nodes (15): createAbortError(), disconnectAudioNode(), errorMessage(), errorName(), getInitials(), hasLeadingZeroBits(), isCaptureCancelled(), isSafariBrowser() (+7 more)

### Community 107 - "Community 107"
Cohesion: 0.15
Nodes (14): buildNotificationEnvelope(), buildProviderPayload(), cleanString(), normalizeNotificationEnvelope(), normalizeNotificationItem(), NOTIFICATION_LEVEL_SET, NOTIFICATION_LEVELS, NOTIFICATION_REASON_SET (+6 more)

### Community 108 - "Community 108"
Cohesion: 0.16
Nodes (15): buildRoomRealtimeSummary(), buildServerEnvelope(), isPlainObject(), KNOWN_CLIENT_TYPES, { normalizeRoomId, normalizePeerId, normalizeSessionToken, cleanName }, parseClientEnvelope(), parseServerEnvelope(), toRoomPeerSummary() (+7 more)

### Community 109 - "Community 109"
Cohesion: 0.23
Nodes (15): FetchMembershipsOptions, fetchRoomMemberships(), leaveRoomMembership(), applyRoomVoicePeers(), cacheKey(), clearRoomMembership(), emptyEntry(), getRoomMembership() (+7 more)

### Community 110 - "Community 110"
Cohesion: 0.18
Nodes (12): fetchRoomPins(), pinAuthor(), PinnedMessage, PinnedMessageAuthor, PinResponse, pinRoomMessage(), PinSnapshot, pinUrl() (+4 more)

### Community 111 - "Community 111"
Cohesion: 0.16
Nodes (9): 312a0b7 fix(web): stop desktop bridge tests from crashing CI, a2947f5 fix(web): stop desktop bridge tests from crashing CI (#128), cad417d chore(release): back-merge 2.5.5 into develop, getServer(), loadService(), webRoot, configure(), deferred() (+1 more)

### Community 112 - "Community 112"
Cohesion: 0.16
Nodes (14): cleanUpstreamUrl(), { createCredentialBoundaryService }, { createDbPool }, { createGateCredentialSigner }, createLiveKitAuthGateService(), { createRoomStore }, deny(), destroySocket() (+6 more)

### Community 113 - "Community 113"
Cohesion: 0.28
Nodes (15): DEFAULT_FREQUENT_REACTIONS, FrequentReaction, frequentReactionKey(), loadFrequentReactions(), localStorageKey(), memory, normalizeEntries(), openDatabase() (+7 more)

### Community 114 - "Community 114"
Cohesion: 0.22
Nodes (11): cleanDisplayName(), clearPendingGuestNameRequest(), handleGuestNameSubmit(), persistName(), requestGuestNameForRoom(), requireSavedName(), resetGuestNameDialog(), saveNameFromValue() (+3 more)

### Community 115 - "Community 115"
Cohesion: 0.16
Nodes (13): BrowserIdleDetector, BrowserIdleDetectorConstructor, createPresenceIdleController(), DesktopIdleBridge, DesktopIdleScope, EventTarget, getDesktopIdleSecondsReader(), hasGrantedBrowserIdlePermission() (+5 more)

### Community 116 - "Community 116"
Cohesion: 0.15
Nodes (2): ContextMenuContentState, ContextMenuProps

### Community 117 - "Community 117"
Cohesion: 0.21
Nodes (10): INTERNAL_NODE_KEYS, isManifestValid(), isObject(), normalizeInternalNode(), normalizeManifest(), normalizeOperatorNode(), normalizePublicNode(), OPERATOR_KEYS (+2 more)

### Community 118 - "Community 118"
Cohesion: 0.13
Nodes (6): assert, { createLiveKitAuthGateService }, { EventEmitter }, FakeSocket, net, test

### Community 119 - "Community 119"
Cohesion: 0.25
Nodes (11): fetchReactionSummaries(), fetchReactors(), ReactionConversation, reactionUrl(), setReactionDesired(), validSummaries(), ReactionSnapshotView, replaceReactionSnapshot() (+3 more)

### Community 120 - "Community 120"
Cohesion: 0.19
Nodes (11): DesktopNotificationPayload, BridgeResult, DesktopBridge, resolveBridge(), showDesktopNotification(), browserNavigator(), classifyPlatform(), classifyPlatformPolicy() (+3 more)

### Community 121 - "Community 121"
Cohesion: 0.16
Nodes (9): buildRoomMembershipPresenceSnapshot(), { buildServerEnvelope, sendWsEnvelope }, { cleanPresenceStatus }, createConnectionRegistry(), crypto, { toWsAccountEvent }, assert, { buildRoomMembershipPresenceSnapshot, createConnectionRegistry } (+1 more)

### Community 122 - "Community 122"
Cohesion: 0.15
Nodes (9): clearViewedScreenPeerReferences(), resolveViewedScreenPeerId(), assert, {
  clearViewedScreenPeerReferences,
  createRoomRealtimeRuntime,
  resolveViewedScreenPeerId
}, createLeaseRuntime(), createRuntime(), OWNER_TOKEN, test (+1 more)

### Community 123 - "Community 123"
Cohesion: 0.15
Nodes (10): createWsHandler(), assert, createHandler(), createRegistry(), { createWsHandler }, { EventEmitter }, FakeSocket, test (+2 more)

### Community 124 - "Community 124"
Cohesion: 0.19
Nodes (11): assetName(), catalogueFile, graphicsLicenceFile, main(), outputDir, packageRoot, planEmojiAssets(), require (+3 more)

### Community 125 - "Community 125"
Cohesion: 0.18
Nodes (12): classifyPlatform(), classifyPlatformPolicy(), normalizedString(), PLATFORM_CLASSES, platformPolicy(), assert, cjs, CORPUS (+4 more)

### Community 126 - "Community 126"
Cohesion: 0.14
Nodes (14): attachPresence(), bootstrap(), createRoomForRequest(), createRoomId(), getPresenceRoom(), getRoom(), handleCreateRoom(), handleRoomPeers() (+6 more)

### Community 127 - "Community 127"
Cohesion: 0.15
Nodes (6): loadParticipantScreenLifecycle(), moduleUrl(), require, root, TestMediaStream, ts

### Community 128 - "Community 128"
Cohesion: 0.22
Nodes (7): PublicUser, formatTime(), pad(), formatChatDayLabel(), isSameDay(), MONTHS, startOfDay()

### Community 129 - "Community 129"
Cohesion: 0.21
Nodes (9): createProofOfWork(), crypto, hasLeadingZeroBits(), normalizePowNonce(), parsePowChallenge(), assert, crypto, {
  hasLeadingZeroBits,
  parsePowChallenge,
  normalizePowNonce,
  createProofOfWork
} (+1 more)

### Community 130 - "Community 130"
Cohesion: 0.26
Nodes (11): cacheKey(), configCache, defaultConfig(), fetchRuntimeConfig(), hasSuspiciousSecrets(), loadRuntimeConfig(), resolveConfigOrigin(), resolveConfigUrl() (+3 more)

### Community 131 - "Community 131"
Cohesion: 0.31
Nodes (11): clamp(), deriveAvatarAccent(), fitChromaToSrgb(), isInSrgbGamut(), linearToSrgb(), normalizeChannel(), oklchToHex(), oklchToLinearRgb() (+3 more)

### Community 132 - "Community 132"
Cohesion: 0.27
Nodes (12): buildHistoryEnvelope(), cleanString(), getReadCursorFromMessage(), HISTORY_MODE_SET, HISTORY_MODES, isObject(), isOpaqueCursor(), MESSAGE_KIND_SET (+4 more)

### Community 133 - "Community 133"
Cohesion: 0.28
Nodes (12): buildModerationPage(), cleanString(), durationToExpiresAt(), MODERATION_DURATION_MS, MODERATION_DURATIONS, normalizeActiveBan(), normalizeBanDuration(), normalizeBanMutation() (+4 more)

### Community 134 - "Community 134"
Cohesion: 0.28
Nodes (11): DEFAULT_RUNTIME_CONFIG, getRuntimeConfig(), inheritLiveKitGateCredential(), normalizeLiveKitServerUrl(), normalizeLiveKitUrl(), normalizePayload(), parseRuntimeConfig(), resolveLiveKitConnectUrls() (+3 more)

### Community 135 - "Community 135"
Cohesion: 0.15
Nodes (11): assert, { createApiApp }, { createGateCredentialSigner }, { createLiveKitAuthGateService, extractCredential }, { EventEmitter }, fs, net, path (+3 more)

### Community 136 - "Community 136"
Cohesion: 0.15
Nodes (10): assert, crypto, {
  EMOJI_REACTION_AUTHORITY,
  assertReactionEmoji,
  cleanReactionEmoji,
  isReactionEmoji,
  listReactionEmojis
}, fs, PACKAGE_JSON, path, { pathToFileURL }, ROOT (+2 more)

### Community 137 - "Community 137"
Cohesion: 0.15
Nodes (10): ADMISSION_INTERNAL_COVERAGE_SCRIPT, { createGateCredentialSigner }, { createLiveKitAuthGateService, extractCredential }, { createRoomRealtimeRuntime }, { createRoomStore }, greenSummary, require, SERVER_INTERNAL_COVERAGE_SCRIPT (+2 more)

### Community 139 - "Community 139"
Cohesion: 0.24
Nodes (10): createAvatarKey(), crypto, { deriveAvatarAccent, dominantAvatarColor }, detectAvatarFormat(), processAvatar(), sharp, assert, {
  AVATAR_SIZE,
  createAvatarKey,
  detectAvatarFormat,
  processAvatar
} (+2 more)

### Community 141 - "Community 141"
Cohesion: 0.21
Nodes (1): ScreenRecoveryGraceController

### Community 142 - "Community 142"
Cohesion: 0.24
Nodes (9): attachmentTextFallback(), MIME_TYPES, normalizeAttachment(), normalizeAttachments(), STATES, text(), assert, { MAX_ATTACHMENT_BYTES, attachmentTextFallback, normalizeAttachment, normalizeAttachments } (+1 more)

### Community 143 - "Community 143"
Cohesion: 0.24
Nodes (10): hasSurfaceToken(), isAllowedBackground(), lineAt(), paletteViolations(), root, sourceFiles(), sourceRoot, styleFragments() (+2 more)

### Community 144 - "Community 144"
Cohesion: 0.31
Nodes (10): 4c756b6 Merge branch 'release/2.2.6', cancelScreenSourcePicker(), closeScreenSourceOnBackdrop(), closeScreenSourceOnEscape(), closeScreenSourcePicker(), confirmScreenSourcePicker(), getTabSources(), resolveScreenSourcePicker() (+2 more)

### Community 145 - "Community 145"
Cohesion: 0.53
Nodes (10): buildMessageDeliveryEvent(), cleanString(), DELIVERY_EVENT_TYPES, isObject(), isSystemCard(), normalizeConversation(), normalizeIdempotency(), normalizeReplyPointer() (+2 more)

### Community 146 - "Community 146"
Cohesion: 0.18
Nodes (8): assert, { createAttachmentRepository }, { createTestDatabase }, crypto, { Pool }, { runMigrations }, SILENT, test

### Community 147 - "Community 147"
Cohesion: 0.24
Nodes (4): DesktopAsset, DesktopRelease, DESKTOP_BUILDS, DesktopBuild

### Community 148 - "Community 148"
Cohesion: 0.22
Nodes (8): apps/CLAUDE.md, docs/GIT_FLOW.md, .github CLAUDE.md Policy, Pull Request Template, docs/RELEASE_<version>_PLAN.md, Root CLAUDE.md, Room client architecture (ARCHITECTURE.md), apps/web/CLAUDE.md

### Community 149 - "Community 149"
Cohesion: 0.27
Nodes (8): BROWSABLE_EMOJIS, BROWSABLE_SET, EmojiCategory, hasSkinToneChoices(), isOfferedEmoji(), OFFERED, skinToneChoices(), withSkinTone()

### Community 150 - "Community 150"
Cohesion: 0.22
Nodes (5): 2ca6443 test(shared): lock platform classification contract, 924295b test(web): prove G13 against pinned Caddy, a37d685 test(web): make G13 paths workspace-safe, fdb6786 test(api): make G14 paths workspace-safe, repositoryRoot

### Community 151 - "Community 151"
Cohesion: 0.27
Nodes (7): createMediaMaintenanceService(), assert, { createMediaMaintenanceService }, { createMediaMaintenanceWorker }, test, createMediaMaintenanceWorker(), main()

### Community 152 - "Community 152"
Cohesion: 0.22
Nodes (5): buildAppRoomLink(), markInAppRoomNavigation(), OpenInAppSignals, PRODUCTION_HOSTS, resolveAppLinkScheme()

### Community 153 - "Community 153"
Cohesion: 0.36
Nodes (9): buildMembershipEnvelope(), cleanString(), isObject(), MEMBERSHIP_ROLE_SET, MEMBERSHIP_ROLES, normalizeMembershipEnvelope(), normalizeMembershipLimit(), normalizeMembershipMember() (+1 more)

### Community 154 - "Community 154"
Cohesion: 0.22
Nodes (9): assert, commonJs, fs, invoke(), packageJson, path, { pathToFileURL }, snapshot() (+1 more)

### Community 155 - "Community 155"
Cohesion: 0.28
Nodes (5): BlockStatus, blockUrl(), blockUser(), unblockUser(), getJsonAuth()

### Community 156 - "Community 156"
Cohesion: 0.44
Nodes (8): cleanHttpUrl(), cleanString(), contentFromLegacyText(), normalizeRoomMessageContent(), normalizeSegment(), projectKnownContent(), projectRoomMessageContent(), utf8ByteLength()

### Community 157 - "Community 157"
Cohesion: 0.25
Nodes (4): FakeTimers, require, root, ts

### Community 158 - "Community 158"
Cohesion: 0.25
Nodes (1): RealtimeHeartbeatWatchdog

### Community 159 - "Community 159"
Cohesion: 0.32
Nodes (5): createRateLimiter(), getClientIp(), assert, { getClientIp, createRateLimiter }, test

### Community 160 - "Community 160"
Cohesion: 0.43
Nodes (7): desktopAutostartAvailable(), DesktopAutostartPatch, DesktopAutostartSettings, getBridge(), normalizeSettings(), readDesktopAutostartSettings(), updateDesktopAutostartSettings()

### Community 161 - "Community 161"
Cohesion: 0.36
Nodes (7): bindDesktopCallActions(), CALL_ACTIONS, DesktopCallAction, DesktopCallState, getBridge(), syncDesktopCallState(), toPayload()

### Community 162 - "Community 162"
Cohesion: 0.29
Nodes (5): assert, { createApiApp }, openWs(), test, waitForFrame()

### Community 163 - "Community 163"
Cohesion: 0.25
Nodes (7): assert, crypto, EXPECTED, fs, path, ROOT, test

### Community 164 - "Community 164"
Cohesion: 0.25
Nodes (3): FakeWebSocket, require, ts

### Community 165 - "Community 165"
Cohesion: 0.33
Nodes (4): fingerprint(), SendShadow, SendShadowState, stableJson()

### Community 166 - "Community 166"
Cohesion: 0.43
Nodes (6): RoomLifecycleSummary, applyRoomDeleted(), applyRoomNotFound(), applyRoomUpdated(), refreshRoomHeadingSoon(), showRoomNotFoundSoon()

### Community 167 - "Community 167"
Cohesion: 0.48
Nodes (7): docs/CLAUDE.md governance rules, VoiceRoom 2.5.0 consolidated execution plan, Git Flow workflow, VoiceRoom 2.5.0 unified messaging platform PRD, Release 2.4.0 verification plan, Release 2.4.1 verification plan, Release 2.4.2 hotfix verification plan

### Community 168 - "Community 168"
Cohesion: 0.43
Nodes (5): createPinService(), normalizeMessageId(), normalizeRoomId(), PinServiceError, requireAccount()

### Community 169 - "Community 169"
Cohesion: 0.33
Nodes (3): CONTEXT_TABLES, createReactionRepository(), requireQuery()

### Community 170 - "Community 170"
Cohesion: 0.29
Nodes (6): CapabilityInternalNode, CapabilityManifest, CapabilityOperatorNode, CapabilityPublicNode, CapabilityReplicaConsensus, CapabilityRequires

### Community 171 - "Community 171"
Cohesion: 0.29
Nodes (6): ConversationRef, IdempotencyDescriptor, MessageDeliveryEvent, ReplyPointer, ReplyPreview, SendEnvelope

### Community 172 - "Community 172"
Cohesion: 0.38
Nodes (7): buildSessionCookie(), clearSessionCookie(), getUserStore(), handleChangePassword(), handleLogin(), handleLogout(), handleRegister()

### Community 173 - "Community 173"
Cohesion: 0.33
Nodes (3): DEFAULT_OPTIONS, getSmoothingCoefficient(), VoiceRoomNoiseGateProcessor

### Community 174 - "Community 174"
Cohesion: 0.29
Nodes (4): assert, { __private, createApiApp }, test, { TrackSource }

### Community 175 - "Community 175"
Cohesion: 0.29
Nodes (2): require, ts

### Community 176 - "Community 176"
Cohesion: 0.29
Nodes (6): assert, { createReadinessReport }, fs, path, { readMessageDeliveryMode }, { test }

### Community 177 - "Community 177"
Cohesion: 0.29
Nodes (3): FakeIdleDetector, require, ts

### Community 178 - "Community 178"
Cohesion: 0.38
Nodes (5): FOCUSABLE_SELECTOR, focusInitialElement(), FocusTrapOptions, getFocusableElements(), isHTMLElement()

### Community 179 - "Community 179"
Cohesion: 0.38
Nodes (6): ConnectionStatusView, formatLocalPing(), getConnectionStatusView(), getPeerLatencyQuality(), resetConnectionStatus(), setServerConnectionStatus()

### Community 180 - "Community 180"
Cohesion: 0.60
Nodes (5): ChatMessage, mentionProfilePerson(), participantProfilePerson(), presenceFor(), roomMessageProfilePerson()

### Community 181 - "Community 181"
Cohesion: 0.33
Nodes (1): lang

### Community 182 - "Community 182"
Cohesion: 0.33
Nodes (6): Desktop Support Matrix Doc (G19), Release 2.5.0 Durable Evidence Archive Doc (G03), Coordinated Media Backup and Restore Doc, Release 2.5.0 Budgets Doc (G91), Release 2.5.0 Develop Entry Doc (G93), Release 2.5.0 RC Preflight Doc

### Community 183 - "Community 183"
Cohesion: 0.60
Nodes (4): iconLg, iconMd, iconSm, iconXs

### Community 184 - "Community 184"
Cohesion: 0.33
Nodes (2): { createDbPool }, createDmHistoryRepository()

### Community 185 - "Community 185"
Cohesion: 0.33
Nodes (2): { createDbPool }, createRoomHistoryRepository()

### Community 186 - "Community 186"
Cohesion: 0.33
Nodes (1): LiveKitReconcileGeneration

### Community 187 - "Community 187"
Cohesion: 0.40
Nodes (2): o, s()

### Community 188 - "Community 188"
Cohesion: 0.33
Nodes (2): participantContextMenu, ParticipantMenuVariant

### Community 189 - "Community 189"
Cohesion: 0.33
Nodes (5): RoomMessageContentV1, RoomMessageLinkSegmentV1, RoomMessageMentionSegmentV1, RoomMessageSegmentV1, RoomMessageTextSegmentV1

### Community 190 - "Community 190"
Cohesion: 0.40
Nodes (5): loadRoomRealtime(), moduleUrl(), require, root, ts

### Community 191 - "Community 191"
Cohesion: 0.40
Nodes (5): assert, { createApiApp }, openAccountWs(), test, waitForFrame()

### Community 192 - "Community 192"
Cohesion: 0.33
Nodes (1): FakeBroadcastChannel

### Community 193 - "Community 193"
Cohesion: 0.33
Nodes (1): FakeServer

### Community 194 - "Community 194"
Cohesion: 0.33
Nodes (4): assert, fs, path, test

### Community 195 - "Community 195"
Cohesion: 0.60
Nodes (5): 0d5875a fix: close migration dependency audit finding, 7a27ba8 chore: prepare v2.0.0 release, 983e909 Merge pull request #11 from dazeGG/hotfix/api-docker-workspace-start-develop, c6b8624 fix: start api workspace in docker image, dcda22d chore: merge v2.0.0 back to develop

### Community 196 - "Community 196"
Cohesion: 0.50
Nodes (3): 2dbec7a fix(web): sync preview identity and friend presence, d7cff37 fix(web): trust server avatar colors, root

### Community 197 - "Community 197"
Cohesion: 0.40
Nodes (5): Expiry-Aware Rescue Profile Doc (G85), Predeploy Migrations Doc, Release 2.6.0 Plan — Engagement & Notifications (Superseded), Release 2.7.0 Plan — Media & Moderation (Superseded), VoiceRoom 2.5.0 Unified — Verification and Release Evidence Specification

### Community 198 - "Community 198"
Cohesion: 0.40
Nodes (2): createMentionRepository(), crypto

### Community 199 - "Community 199"
Cohesion: 0.50
Nodes (1): VoiceRoomDesktopAudioSourceProcessor

### Community 200 - "Community 200"
Cohesion: 0.40
Nodes (1): FakeSocket

### Community 201 - "Community 201"
Cohesion: 0.40
Nodes (1): FakeSocket

### Community 202 - "Community 202"
Cohesion: 0.40
Nodes (4): assert, fs, path, { test }

### Community 203 - "Community 203"
Cohesion: 0.40
Nodes (4): assert, fs, path, { test }

### Community 204 - "Community 204"
Cohesion: 0.50
Nodes (1): registerDmHistoryRoutes()

### Community 205 - "Community 205"
Cohesion: 0.50
Nodes (1): registerModerationRoutes()

### Community 206 - "Community 206"
Cohesion: 0.67
Nodes (3): createTransportId(), createWsTransport(), crypto

### Community 207 - "Community 207"
Cohesion: 0.50
Nodes (1): e

### Community 208 - "Community 208"
Cohesion: 0.50
Nodes (2): extensions, files

### Community 209 - "Community 209"
Cohesion: 0.83
Nodes (3): cleanId(), mentionUserIdsFromContent(), normalizeMentionUserIds()

### Community 210 - "Community 210"
Cohesion: 0.67
Nodes (3): 42bdb02 feat(music-bot): add the shared-music bot backed by yt-dlp, 6eb964c feat(shared): add the room shared-music wire contract, eb183f1 feat(api): drive room shared-music sessions

### Community 211 - "Community 211"
Cohesion: 0.67
Nodes (1): DeniedNotification

### Community 212 - "Community 212"
Cohesion: 0.67
Nodes (1): FakeNotification

### Community 213 - "Community 213"
Cohesion: 1.00
Nodes (2): 0043b03 build: ship music-bot as a published runtime image, 8af6fb6 chore(graphify): rebuild the knowledge graph for the music feature

### Community 214 - "Community 214"
Cohesion: 1.00
Nodes (1): RuntimeConfigV1

### Community 215 - "Community 215"
Cohesion: 1.00
Nodes (2): VoiceRoom App Icon (Owl Mascot Mark on Dark Rounded Square), VoiceRoom Mascot Mark (Masked Owl Silhouette, Transparent)

### Community 216 - "Community 216"
Cohesion: 1.00
Nodes (1): ADR: Unicode authority for message reactions

### Community 217 - "Community 217"
Cohesion: 1.00
Nodes (1): VoiceRoom 2.5 Architecture Boundaries

### Community 218 - "Community 218"
Cohesion: 1.00
Nodes (1): Backlog

### Community 219 - "Community 219"
Cohesion: 1.00
Nodes (1): config/capability-dag.v1.json

### Community 220 - "Community 220"
Cohesion: 1.00
Nodes (1): Capability Readiness Doc

### Community 221 - "Community 221"
Cohesion: 1.00
Nodes (1): Design QA — reusable room and chat menus

### Community 222 - "Community 222"
Cohesion: 1.00
Nodes (1): Font Assets README

### Community 223 - "Community 223"
Cohesion: 1.00
Nodes (1): LiveKit External Auth-Gate Operations Doc (G05)

### Community 224 - "Community 224"
Cohesion: 1.00
Nodes (1): VoiceRoom monitoring agent

### Community 225 - "Community 225"
Cohesion: 1.00
Nodes (1): OCI Runtime Publication Doc

### Community 226 - "Community 226"
Cohesion: 1.00
Nodes (1): packages/CLAUDE.md Guidance

### Community 227 - "Community 227"
Cohesion: 1.00
Nodes (1): Production Digest Promotion Doc

### Community 228 - "Community 228"
Cohesion: 1.00
Nodes (1): Release 2.5.0 Repairs README

## Knowledge Gaps
- **1536 isolated node(s):** `http`, `net`, `{ URL }`, `{ createDbPool }`, `{ createGateCredentialSigner }` (+1531 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 52`** (2 nodes): `3c617ec style(web): polish dm day separator`, `7db2783 docs(monitoring): align LiveKit track metric labels`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 116`** (2 nodes): `ContextMenuContentState`, `ContextMenuProps`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 141`** (1 nodes): `ScreenRecoveryGraceController`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 158`** (1 nodes): `RealtimeHeartbeatWatchdog`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 175`** (2 nodes): `require`, `ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 181`** (1 nodes): `lang`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 184`** (2 nodes): `{ createDbPool }`, `createDmHistoryRepository()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 185`** (2 nodes): `{ createDbPool }`, `createRoomHistoryRepository()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 186`** (1 nodes): `LiveKitReconcileGeneration`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 187`** (2 nodes): `o`, `s()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 188`** (2 nodes): `participantContextMenu`, `ParticipantMenuVariant`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 192`** (1 nodes): `FakeBroadcastChannel`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 193`** (1 nodes): `FakeServer`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 198`** (2 nodes): `createMentionRepository()`, `crypto`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 199`** (1 nodes): `VoiceRoomDesktopAudioSourceProcessor`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 200`** (1 nodes): `FakeSocket`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 201`** (1 nodes): `FakeSocket`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 204`** (1 nodes): `registerDmHistoryRoutes()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 205`** (1 nodes): `registerModerationRoutes()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 207`** (1 nodes): `e`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 208`** (2 nodes): `extensions`, `files`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 211`** (1 nodes): `DeniedNotification`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 212`** (1 nodes): `FakeNotification`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 213`** (2 nodes): `0043b03 build: ship music-bot as a published runtime image`, `8af6fb6 chore(graphify): rebuild the knowledge graph for the music feature`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 214`** (1 nodes): `RuntimeConfigV1`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 215`** (2 nodes): `VoiceRoom App Icon (Owl Mascot Mark on Dark Rounded Square)`, `VoiceRoom Mascot Mark (Masked Owl Silhouette, Transparent)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 216`** (1 nodes): `ADR: Unicode authority for message reactions`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 217`** (1 nodes): `VoiceRoom 2.5 Architecture Boundaries`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 218`** (1 nodes): `Backlog`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 219`** (1 nodes): `config/capability-dag.v1.json`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 220`** (1 nodes): `Capability Readiness Doc`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 221`** (1 nodes): `Design QA — reusable room and chat menus`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 222`** (1 nodes): `Font Assets README`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 223`** (1 nodes): `LiveKit External Auth-Gate Operations Doc (G05)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 224`** (1 nodes): `VoiceRoom monitoring agent`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 225`** (1 nodes): `OCI Runtime Publication Doc`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 226`** (1 nodes): `packages/CLAUDE.md Guidance`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 227`** (1 nodes): `Production Digest Promotion Doc`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 228`** (1 nodes): `Release 2.5.0 Repairs README`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `RealtimeRecoveryController` connect `Community 49` to `Community 2`?**
  _High betweenness centrality (0.009) - this node is a cross-community bridge._
- **What connects `http`, `net`, `{ URL }` to the rest of the system?**
  _1536 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.011188231637832799 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.0242296918767507 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.03939507094846901 - nodes in this community are weakly interconnected._
- **Should `Community 3` be split into smaller, more focused modules?**
  _Cohesion score 0.031029887683228632 - nodes in this community are weakly interconnected._
- **Should `Community 4` be split into smaller, more focused modules?**
  _Cohesion score 0.0795959595959596 - nodes in this community are weakly interconnected._