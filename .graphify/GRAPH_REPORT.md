# Graph Report - .  (2026-09-15)

## Corpus Check
- Large corpus: 802 files · ~393 346 words. Semantic extraction will be expensive (many Claude tokens). Consider running on a subfolder, or use --no-semantic to run AST-only.

## Summary
- 6449 nodes · 19037 edges · 238 communities detected
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 6 edges (avg confidence: 0.73)
- Token cost: 0 input · 0 output
- Edge kinds: contains: 4826 · ON_BRANCH: 4676 · MODIFIES: 4605 · calls: 1945 · imports: 1159 · imports_from: 787 · PARENT_OF: 732 · method: 208 · re_exports: 59 · references: 23 · inherits: 10 · conceptually_related_to: 4 · semantically_similar_to: 2 · implements: 1


## Input Scope
- Requested: auto
- Resolved: committed (source: default-auto)
- Included files: 802 · Candidates: 882
- Excluded: 0 untracked · 48308 ignored · 13 sensitive · 0 missing committed
- Recommendation: Use --scope all or graphify.yaml inputs.corpus for a knowledge-base folder.

## Graph Freshness
- Built from Git commit: `1dd8bdc`
- Compare this hash to `git rev-parse HEAD` before trusting freshness-sensitive graph output.
## God Nodes (most connected - your core abstractions)
1. `sendJson()` - 86 edges
2. `createTestDatabase()` - 46 edges
3. `runMigrations()` - 39 edges
4. `readJsonBody()` - 34 edges
5. `RealtimeRecoveryController` - 30 edges
6. `getUserStore()` - 29 edges
7. `requireSessionUser()` - 29 edges
8. `resolveSessionUser()` - 28 edges
9. `handleRoomChatPost()` - 26 edges
10. `getRoomStore()` - 24 edges

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
Nodes (191): createDirectMessageRepository(), registerRoomHistoryRoutes(), createRoomMessageRepository(), registerNotificationRoutes(), {
  ACCOUNT_DELETION_GRACE_MS,
  WHATS_NEW_VERSION,
  formatRecoveryCode,
  isDeletedAccountLogin
}, { assertMigrationReady, runMigrations }, attachFastifyRequestBody(), AUTH_RATE_LIMIT (+183 more)

### Community 1 - "Community 1"
Cohesion: 0.07
Nodes (155): develop, feature/2.6.0-prerelease, feature/composer-emoji-picker, feature/emoji-images, feature/whats-new-screenshots, feature/whats-new-stories, fix/api-test-db-teardown, ComposerSelection (+147 more)

### Community 2 - "Community 2"
Cohesion: 0.13
Nodes (151): backup/room-shared-music-pre-rebase, chore/graphify-refresh, feature/2.5.0-manual-fixes, feature/2.5.0-to-rc, feature/cd-pipeline, feature/desktop-app-settings, feature/docs-cleanup, feature/room-shared-music (+143 more)

### Community 3 - "Community 3"
Cohesion: 0.02
Nodes (55): SelectedMention, 2d36bc7 fix(api): bound messaging schema locks, 728cea2 feat: implement release 2.5.0 messaging platform (#105), 88169aa fix(api): preserve migration history with corrective follow-ups, ab373a6 chore(release): 2.5.0 (#121), BASELINE_CASES, createReplayTokenFixture(), runReplayScenario() (+47 more)

### Community 4 - "Community 4"
Cohesion: 0.03
Nodes (50): AuthUser, roomNameFor(), clearSession(), session, setUser(), syncRoomName(), 164b853 refactor(web): neutral input placeholders, dedicated dev port, desktop drag region (#16), 22a796b Merge pull request #8 from feature/404-page (+42 more)

### Community 5 - "Community 5"
Cohesion: 0.03
Nodes (43): AvatarProps, AvatarCropDialogProps, AvatarCropShape, BadgeProps, ButtonProps, 3db468e feat(web): Volt redesign — landing, lobby v2, shared UI (#38), 6584f79 feat: add uploaded avatars for users and rooms (#45), e0eb12c chore(release): prepare 2.4.0 (+35 more)

### Community 6 - "Community 6"
Cohesion: 0.04
Nodes (91): 9ba8ece feat(web): tune screen share encoding, SCREEN_FPS_OPTIONS, SCREEN_QUALITY_OPTIONS, SCREEN_SIMULCAST_LAYER, SCREEN_STREAM_MODE_PROFILES, DesktopAudioCapture, DesktopPickerSelection, ParsedScreenStats (+83 more)

### Community 7 - "Community 7"
Cohesion: 0.03
Nodes (28): 043b73d chore: release v2.1.5, 2391bbe feat(web): migrate UI icons to Lucide (#42), 4497e53 Merge branch 'release/2.2.5', 4e4ea97 fix(web): unify room tile grid layout, 8de78c2 Merge tag 'v2.2.5' into develop, 9976dab Merge tag 'v2.1.5' into develop, aed41e8 fix(web): harden room svelte migration, b3590dc Merge pull request #23 from dazeGG/release/2.1.4 (+20 more)

### Community 8 - "Community 8"
Cohesion: 0.03
Nodes (48): 0f3d7a0 Merge branch 'hotfix/2.1.3', 0ffac54 feat(infra): expose livekit prometheus metrics for status stack (#22), 1840f18 chore: release v2.1.4, 2684b15 chore: release v2.1.3, 2994d09 fix(api): return friend request id from listRequests, 4be8312 chore: release v2.1.0, 551c869 chore: merge v2.1.0 back to develop, 5eef100 feat: friends, direct messages, and social lobby (#19) (+40 more)

### Community 9 - "Community 9"
Cohesion: 0.04
Nodes (76): MicrophoneMode, NOISE_MODES, NoiseMode, amplitudeToDb(), clampGateThresholdDb(), clampParticipantVolume(), DEFAULT_PARTICIPANT_AUDIO_PREFERENCE, getDbMeterPosition() (+68 more)

### Community 10 - "Community 10"
Cohesion: 0.05
Nodes (64): 234177e feat(web): redesign screen source picker, 2c5f8d4 feat(web): show stream quality on tile thumbnails, 4c756b6 Merge branch 'release/2.2.6', 65f8383 chore: removed status agent file, 67b668e chore: merge v2.0.2 back to develop, 7b8da98 feat(web): add the room music player, aaef77d fix(web): move stream metadata onto thumbnails, b3728e3 feat: add guest name modal for room entry (+56 more)

### Community 11 - "Community 11"
Cohesion: 0.05
Nodes (71): deleteDirectMessage(), DirectMessageHistoryPage, DirectMessageInvite, editDirectMessage(), fetchThread(), fetchThreadPage(), HistoryMessageDto, markThreadRead() (+63 more)

### Community 12 - "Community 12"
Cohesion: 0.03
Nodes (47): del(), fetchJson(), patchJson(), postJson(), postJsonAuth(), putJson(), createRoomProof(), hasLeadingZeroBits() (+39 more)

### Community 13 - "Community 13"
Cohesion: 0.04
Nodes (71): isRoomEmbedded(), extractRoomId(), applySpeaking(), attachMeter(), isLocalMicrophoneSpeaking(), isOverSpeakingThreshold(), refreshMicrophoneLevelMeterSoon(), startMeters() (+63 more)

### Community 14 - "Community 14"
Cohesion: 0.03
Nodes (35): AccountSecurity, 51b04d8 Merge branch 'feature/account-sessions-recovery' into develop, cb75953 Merge branch 'feature/new-login-alerts' into develop, ffc3589 feat: ask the account about sign-ins from new devices, sessionDeviceLabel(), SecureAccountTarget, { buildServerEnvelope }, boundedText() (+27 more)

### Community 15 - "Community 15"
Cohesion: 0.03
Nodes (48): ReadReconciliationOptions, 4553c35 fix(web): reconcile repeated cross-tab read cursors, 54086b4 fix(api): serialize notification retraction revisions, b3732be fix(notifications): make inbox revisions monotonic, fcd0beb fix(ci): bind OCI evidence to Actions archive bytes, model, router, ui (+40 more)

### Community 16 - "Community 16"
Cohesion: 0.04
Nodes (39): 02d78bc Merge pull request #69 from dazeGG/hotfix/2.4.2-backmerge, 6cd4b30 fix(web): stabilize screen sharing in 2.4.2 (#68), cf1ea14 chore(release): back-merge 2.4.2 into develop, getScreenPublicationPresence(), ScreenPublicationPresence, getScreenReceiverDemand(), ScreenReceiverDemand, createScreenSubscriptionRetryController() (+31 more)

### Community 17 - "Community 17"
Cohesion: 0.05
Nodes (41): AvatarStackItem, AvatarStackProps, 049a913 fix(web): keep popover open on ambiguous focus loss, 08bd491 fix(web): focus DM compose input when opening a friend chat (#28), 0a9be62 fix(web): keep room preview chat closed by default (#32), 0c20745 chore(release): back-merge 2.1.9, 206a214 refactor(web): use shared slider in settings controls, 3940c26 fix(web): preserve friend online status across realtime race (#27) (+33 more)

### Community 18 - "Community 18"
Cohesion: 0.04
Nodes (47): b16c894 fix(api): expose fail-closed release telemetry, c02e107 fix(web): recover attachment compose safely, cc45703 fix(api): expose worker metrics across process boundaries, d37be0b feat(api): expose media pressure health, composer, dm, room, store (+39 more)

### Community 19 - "Community 19"
Cohesion: 0.09
Nodes (55): detachRemoteAudioTrack(), applyRemoteScreenVideoDemand(), attachSubscribedRemoteScreenTrack(), attemptFreshLiveKitReplacement(), bindLiveKitRoomEvents(), clearAllScreenSubscriptionRetries(), clearScreenSubscriptionRetry(), connectLiveKitRoom() (+47 more)

### Community 20 - "Community 20"
Cohesion: 0.04
Nodes (20): 0a0699b chore: release v2.1.2, 1578df6 feat: add account settings, 3b24424 fix(web): move download control to sidebar footer, 537a9a4 fix(web): auto-join room on direct load and reload, 95a5ce7 fix(web): keep chat-open stage layout when reopening room, cc7f297 Merge pull request: chore private monitoring agent, e6df8d6 fix(web): show entered guest name in room chat, fe15e8b chore: add private monitoring agent (+12 more)

### Community 21 - "Community 21"
Cohesion: 0.07
Nodes (56): main, 0112d02 fix(infra): pin livekit server version, 02824cd fix(web): surface friend request errors, 0753576 fix(web): show avatars in stream placeholders, 07e362c chore(omx): update model routing, 1718dc1 Bump version to 1.6.1, 1ddbd67 fix(web): show viewer avatars in stream badge, 2008ab4 feat(web): standardize interactive control sizing (#40) (+48 more)

### Community 22 - "Community 22"
Cohesion: 0.06
Nodes (38): eventMatchesHotkey(), getDefaultHotkeyBinding(), getHotkeyStorageKey(), HotkeyAction, isTypingTarget(), parseHotkeyBinding(), readHotkeyBinding(), writeHotkeyBinding() (+30 more)

### Community 23 - "Community 23"
Cohesion: 0.07
Nodes (49): dbToAmplitude(), persistMicrophoneVolume(), MicProcessor, MicrophoneCapture, unpublishLocalMicrophone(), applyInputGainToCapture(), applyNoiseGateToCapture(), combineMicrophoneProcessors() (+41 more)

### Community 24 - "Community 24"
Cohesion: 0.05
Nodes (43): 40320f3 fix(release): authenticate oci evidence producers, 6b3fc40 fix(release): require canonical merge commit authority, 74df7a9 fix(api): revoke only failed admission credential, 7609180 fix(web): harden reaction convergence, 760fdfe fix(api): remediate oversized attachments before validation, 824382d test(release): define G71 engagement checkpoint, ac1c7f4 fix(api): allow safe guest reaction reads, ad596da test(api): prove reaction persistence invariants (+35 more)

### Community 25 - "Community 25"
Cohesion: 0.05
Nodes (36): a2ee398 test(api): prove messaging pagination and reads, {
  buildHistoryEnvelope,
  normalizeHistoryRequest
}, canonicalParticipants(), createDmHistoryService(), DmHistoryError, { normalizeLinkPreview }, createMessageReadService(), MessageReadError (+28 more)

### Community 27 - "Community 27"
Cohesion: 0.09
Nodes (47): clampStreamVolume(), getStoredStreamVolume(), normalizeStoredStreamVolume(), storeStreamVolume(), clearScreenAttendance(), setScreenAttendance(), releaseScreenMediaElement(), activateScreenStageUi() (+39 more)

### Community 28 - "Community 28"
Cohesion: 0.06
Nodes (18): accessibleName(), assertAccessibleName(), assertFocusOrder(), assertKeyboardActivation(), assertLiveRegion(), assertReducedMotionEnabled(), assertStableLayout(), text() (+10 more)

### Community 29 - "Community 29"
Cohesion: 0.07
Nodes (53): attachPresence(), authorizeRoomMutation(), bootstrap(), broadcast(), broadcastRoomUpdate(), closePeer(), countRoomCreationQuotaRoomsForIp(), createRoomForRequest() (+45 more)

### Community 30 - "Community 30"
Cohesion: 0.07
Nodes (43): addRoomByCode(), authPost(), authRead(), AuthRequestError, avatarRequest(), changePassword(), confirmLoginAlert(), Credentials (+35 more)

### Community 31 - "Community 31"
Cohesion: 0.06
Nodes (43): 0ec8255 chore(release): bump version to 2.2.3, 2adaec0 Merge branch 'hotfix/2.2.3-ci', 3b6010b Merge branch 'release/2.2.2', 5fa984e Merge tag 'v2.2.2' into develop, bc6c32c Merge tag 'v2.2.3' into develop, cf119b8 fix(api): wait for fresh websocket summary frames, assert, { countWsType, joinVoiceRoom, openWs, sendWs, subscribeRoomPreview, waitForWsType } (+35 more)

### Community 32 - "Community 32"
Cohesion: 0.05
Nodes (30): 10de220 test(api): prove active ban expiry in PostgreSQL, 19902ab feat: prepare 2.5.0 RC and polish chats (#114), 849600b fix(api): persist membership after admission, d8e3847 test(web): prove messaging reconciliation flows, model, desktop, router, sw (+22 more)

### Community 33 - "Community 33"
Cohesion: 0.07
Nodes (48): activeTargetSuppresses(), actorLabel(), BrowserNotificationPayload, buildNotificationPayload(), canUseNotifications(), cleanupMemoryDedupe(), consumeNotificationDedupeKey(), dedupeStorageKey() (+40 more)

### Community 34 - "Community 34"
Cohesion: 0.06
Nodes (42): 08e3e13 Merge branch 'hotfix/2.2.1', 17edd27 feat(web): add lobby voice controls widget, 31409db style(web): restore dock device popover chrome, 397400d chore(release): bump version to 2.2.2, 3ce55ad fix(web): dedupe self avatar and drop count label in room list, 3f83f05 Merge branch 'release/2.2.0', 4cfb160 chore(release): bump version to 2.2.0, 52c6592 Merge tag 'v2.2.1' into develop (+34 more)

### Community 35 - "Community 35"
Cohesion: 0.04
Nodes (1): edf009e feat(web): add desktop autostart settings

### Community 36 - "Community 36"
Cohesion: 0.10
Nodes (46): 1a5009b fix(web): remove transient voice-connecting placeholder, 56ebf7a docs: document root-scoped omx runtime usage, 6895206 fix(web): remove desktop app region from topbar, 8b5b175 chore: merge v2.0.1 back to develop, 9d9411c Merge pull request #10 from dazeGG/hotfix/api-docker-workspace-start, bef8656 fix: start api workspace in docker image, cef76ec chore: release v2.0.1, e9dccb2 fix(web): recover remote microphone playback (+38 more)

### Community 37 - "Community 37"
Cohesion: 0.08
Nodes (35): fetchNotificationPreferences(), normalizePreferences(), NotificationMuteResponse, NotificationPreferences, NotificationPreferencesResponse, RoomNotificationLevel, setDmNotificationsMuted(), setDoNotDisturb() (+27 more)

### Community 38 - "Community 38"
Cohesion: 0.06
Nodes (34): 177f5e3 test(api): prove durable message delivery, 93cad8e test(release): define G42 messaging checkpoint, { buildMessageDeliveryEvent }, createMessageOutboxRepository(), crypto, encodeParts(), logicalKey(), MessageDeliveryFenceError (+26 more)

### Community 39 - "Community 39"
Cohesion: 0.05
Nodes (33): cf49285 fix(api): reconcile media across replicas, CONTEXTS, createAttachmentRepository(), crypto, mapAttachment(), MIME_TYPES, createMediaQuotaRepository(), createMediaQuotaService() (+25 more)

### Community 40 - "Community 40"
Cohesion: 0.12
Nodes (47): broadcastUserProfileToFriends(), buildSessionCookie(), checkAvatarUploadRate(), clearSessionCookie(), describeLoginDevice(), endAccountSessionConnections(), getAccountDeletionRepository(), getGeoLocator() (+39 more)

### Community 41 - "Community 41"
Cohesion: 0.06
Nodes (34): 1886650 feat(api): persist rooms and chat in postgres, 364b82c build(api): fence G15 predeploy migrations, path, readDatabaseConfig(), readEnvBool(), readEnvInt(), readMessageDeliveryMode(), { Pool } (+26 more)

### Community 43 - "Community 43"
Cohesion: 0.05
Nodes (34): 05f2a77 test(api): bind strict credential cutover, 501ef14 test(web): lock leave and rejoin flow, d9f484d test(engagement): prove content and mention UoW, ebd3ed4 test(release): define G50 membership checkpoint, membershipModel, routes, service, voiceSession (+26 more)

### Community 44 - "Community 44"
Cohesion: 0.05
Nodes (33): createPushStore(), assert, { createAttachmentRepository }, { createTestDatabase }, { createUserStore }, crypto, { Pool }, { runMigrations } (+25 more)

### Community 45 - "Community 45"
Cohesion: 0.05
Nodes (32): 2d08528 chore(release): back-merge 2.5.1 into develop, b3c2b1d fix(api): make users who added a room its members (#122), assert, { createTestDatabase }, fs, http, os, path (+24 more)

### Community 46 - "Community 46"
Cohesion: 0.11
Nodes (37): feature/account-sessions-recovery, 01e9d33 feat(room): add side panel participant roster, 1ecef6b fix(room): show persistent participant roster, 2137216 fix(chat): unify image captions, 2ce6059 test(shared): lock attachment contracts, 3d1864e fix(chat): attach captions to image width, 3f2fcf3 fix(room): restore preview side panel behavior, 4125282 fix(room): resolve roster room from route (+29 more)

### Community 47 - "Community 47"
Cohesion: 0.09
Nodes (36): 09c4d42 feat(shared): add the room shared-music wire contract, buildRoomRealtimeSummary(), buildServerEnvelope(), isPlainObject(), KNOWN_CLIENT_TYPES, { normalizeRoomId, normalizePeerId, normalizeSessionToken, cleanName }, normalizeTypingActivity(), parseClientEnvelope() (+28 more)

### Community 48 - "Community 48"
Cohesion: 0.06
Nodes (34): 2a9aa5b test(api): prove media quota and worker safety, 575dc80 fix(api): align private media boundaries, createMediaService(), detectExactContainer(), FORMAT_MIME, MediaServiceError, PNG_END, readBounded() (+26 more)

### Community 49 - "Community 49"
Cohesion: 0.08
Nodes (30): createMessageReplyHandlers(), registerMessageReplyRoutes(), REPLY_CONFLICT_BODY, { ReplyTargetUnavailableError }, isInvitation(), isReplyTargetKindAllowed(), isUnavailable(), messageId() (+22 more)

### Community 50 - "Community 50"
Cohesion: 0.05
Nodes (28): {
  ACCOUNT_DELETION_GRACE_MS,
  DELETED_ACCOUNT_NAME,
  DELETED_LOGIN_PREFIX
}, createAccountDeletionRepository(), crypto, PERSONAL_DATA_CLEANUP, { transaction }, { verifyPassword }, { ACCOUNT_DELETION_GRACE_MS }, assert (+20 more)

### Community 51 - "Community 51"
Cohesion: 0.13
Nodes (10): classifyRecoveryFailure(), DEFAULT_RETRY_DELAYS_MS, elapsedBucket(), RealtimeRecoveryController, RETRYABLE_CODES, SAFE_CODES, sanitizeRecoveryCode(), TERMINAL_CODES (+2 more)

### Community 52 - "Community 52"
Cohesion: 0.08
Nodes (9): 2ea3623 Merge pull request #116 from dazeGG/feature/2.5.0-manual-fixes, c80ed8a feat(web): expand contextual menus, ProfileCardAnchor, profileCardUi, ProfileCardPerson, ProfileCardProps, ProfileCardRelationship, ReactionEmojiGroup (+1 more)

### Community 54 - "Community 54"
Cohesion: 0.09
Nodes (18): AttachmentApiError, AttachmentContext, AttachmentDraft, AttachmentDraftState, createAttachmentSlot(), deleteAttachment(), Envelope, getAttachmentStatus() (+10 more)

### Community 55 - "Community 55"
Cohesion: 0.06
Nodes (26): 53d093e test(api): execute hostile credential boundary scenarios, c928af9 fix(api): require exact migration catalog readiness, d02ad7f fix(release): resolve evidence from immutable external artifacts, f124c57 fix(web): verify reaction boundaries through rendered UI, fa382b2 fix(api): derive backlog age directly from storage, createNotificationOutboxRepository(), crypto, NotificationFenceError (+18 more)

### Community 56 - "Community 56"
Cohesion: 0.06
Nodes (29): AVATAR_KEY_PATTERN, createAvatarStorage(), fs, path, { readUploadsDir }, validateAvatarKey(), readUploadsDir(), createLinkPreviewStorage() (+21 more)

### Community 57 - "Community 57"
Cohesion: 0.08
Nodes (33): assertReactionEmoji(), cleanReactionEmoji(), EMOJI_REACTION_AUTHORITY, buildGroups(), GROUP_ANCHORS, listReactionEmojiGroups(), { listReactionEmojis }, reactionEmojiGroupKey() (+25 more)

### Community 58 - "Community 58"
Cohesion: 0.06
Nodes (24): 3580978 fix(api): harden session and cookie write security, { AVATAR_COLOR_KEYS, cleanAvatarColorKey, cleanPresenceStatus }, { createDbPool, transaction }, createUserStore(), crypto, { hashPassword, verifyPassword }, hashSessionToken(), {
  LOGIN_ALERT_TTL_MS,
  LOGIN_FAMILIARITY_WINDOW_MS,
  RECOVERY_CODES_REMINDER_SNOOZE_MS,
  RECOVERY_CODE_ALPHABET,
  RECOVERY_CODE_COUNT,
  RECOVERY_CODE_LENGTH,
  WHATS_NEW_VERSION,
  describeUserAgent,
  normalizeRecoveryCode,
  normalizeReleaseVersion
} (+16 more)

### Community 59 - "Community 59"
Cohesion: 0.16
Nodes (35): broadcastDmNotification(), broadcastToUser(), cleanUuid(), getFriendStore(), getMessageService(), getNotificationStore(), handleBlockedList(), handleBlockUser() (+27 more)

### Community 60 - "Community 60"
Cohesion: 0.08
Nodes (24): recordMediaOldestPending(), createMediaJobRepository(), crypto, JOB_KINDS, mapMediaJob(), MediaJobFenceError, assert, { DEFAULTS, createMediaProcessingWorker, retryDelay } (+16 more)

### Community 61 - "Community 61"
Cohesion: 0.12
Nodes (34): attachMediaProjection(), attachReplyProjection(), broadcastDirectLinkPreview(), broadcastRoomLinkPreview(), cleanChatText(), cleanDmText(), dispatchMessageDeliveryEvent(), findRoomBan() (+26 more)

### Community 62 - "Community 62"
Cohesion: 0.08
Nodes (22): createPinRepository(), mapPin(), requireQuery(), toMillis(), registerPinRoutes(), createPinService(), normalizeMessageId(), normalizeRoomId() (+14 more)

### Community 63 - "Community 63"
Cohesion: 0.07
Nodes (12): 13254ae docs: document durable room storage, 20fdff5 feat(api): persist static rooms and chat, c860746 feat(web): add static rooms and room chat UI, fs, net, startApiListener(), assert, fs (+4 more)

### Community 64 - "Community 64"
Cohesion: 0.10
Nodes (24): 1595593 feat(notifications): add web push delivery (#51), 4977987 feat(rooms): add friend ring invitations (#52), 5d910ea fix(notifications): fail closed on provider errors, cleanPushEndpoint(), crypto, describePushEndpoint(), EXACT_PUSH_HOSTS, isAllowedPushHost() (+16 more)

### Community 65 - "Community 65"
Cohesion: 0.08
Nodes (25): { createReadinessReport, resolveManifestPath }, createRuntimeReadinessProvider(), { createRuntimeReadinessRepository }, failClosedSnapshot(), { PUBLIC_CAPABILITY_KEYS }, createRuntimeReadinessRepository(), { createDbPool }, { createRuntimeReadinessRepository } (+17 more)

### Community 66 - "Community 66"
Cohesion: 0.15
Nodes (18): dm, picker, reactors, room, store, summary, authDialog(), createPermanentRoom() (+10 more)

### Community 67 - "Community 67"
Cohesion: 0.08
Nodes (18): RealtimeHeartbeatWatchdog, PinsRealtimeEvent, ReactionRealtimeEvent, RealtimeAccountEvent, RealtimeErrorEvent, RealtimeEvent, RealtimeHandle, RealtimeRoomEvent (+10 more)

### Community 68 - "Community 68"
Cohesion: 0.08
Nodes (22): a0fa2d6 feat(api): drive room shared-music sessions, edcdda0 feat(music-bot): add the shared-music bot backed by yt-dlp, createTypingThrottle(), { buildServerEnvelope, buildServerErrorEnvelope, parseInboundMessage }, { createTypingThrottle }, createWsHandler(), {
  normalizePeerId,
  normalizeRoomId,
  normalizeSessionToken
}, { normalizeTypingActivity } (+14 more)

### Community 69 - "Community 69"
Cohesion: 0.10
Nodes (25): c2613dd fix(web): move room moderation into settings sections and popup menus (#124), d500d14 chore(release): back-merge 2.5.2 into develop, api, chat, component, lobby, members, model (+17 more)

### Community 70 - "Community 70"
Cohesion: 0.09
Nodes (20): acquireMigrationLock(), advisoryLockParts(), assertMigrationLockHeld(), assertMigrationReady(), assertNoDirtyMigrationState(), ensureMigrationGuardSchema(), expectedMigrationCatalog(), MIGRATION_GUARD_STATES (+12 more)

### Community 72 - "Community 72"
Cohesion: 0.09
Nodes (25): clearRoomOccupancyRetries(), clearRoomOccupancyRetry(), createApiApp(), createFastifyLoggerOptions(), fastify, getHistoryServices(), getLogLevel(), getMembershipServices() (+17 more)

### Community 73 - "Community 73"
Cohesion: 0.08
Nodes (21): da2ffb3 fix(release): stabilize G01-G03 foundation gates (#112), extensions, files, path, socketPathForDirectory(), assert, { createApiServer }, createFriends() (+13 more)

### Community 74 - "Community 74"
Cohesion: 0.07
Nodes (23): createNotificationStore(), createRoomStore(), assert, {createNotificationService}, {createNotificationStore}, {createRoomStore}, {createTestDatabase}, {createUserStore} (+15 more)

### Community 75 - "Community 75"
Cohesion: 0.09
Nodes (20): createMembershipRepository(), crypto, mapDirectoryMember(), mapMembership(), toMillis(), registerMembershipRoutes(), { createMembershipRepository }, createMembershipService() (+12 more)

### Community 76 - "Community 76"
Cohesion: 0.08
Nodes (14): createDbPool(), { classifyPlatform, PLATFORM_CLASSES }, { createDbPool, transaction }, crypto, normalizePlatformClass(), PLATFORM_SIGNAL_METADATA_KEYS, resolvePlatformClass(), { createDbPool } (+6 more)

### Community 77 - "Community 77"
Cohesion: 0.13
Nodes (22): deletePushSubscription(), fetchPushConfig(), PushConfig, savePushSubscription(), decodeVapidKey(), detachPushSubscription(), getRegistration(), isDesktopRuntime() (+14 more)

### Community 78 - "Community 78"
Cohesion: 0.10
Nodes (18): 1709ead fix(api): centralize active room ban enforcement, createActiveBanRepository(), crypto, mapActiveBan(), normalizePrincipal(), toMillis(), { createActiveBanRepository, normalizePrincipal }, createActiveBanService() (+10 more)

### Community 79 - "Community 79"
Cohesion: 0.11
Nodes (22): persistMicrophoneMode(), persistOutputMuted(), hasLocalScreenAudio(), postState(), supportsAudioOutputSelection(), getLocalMicrophoneCapture(), beginPushToTalk(), CallControlsView (+14 more)

### Community 80 - "Community 80"
Cohesion: 0.11
Nodes (21): fetchReactionSummaries(), fetchReactors(), ReactionConversation, reactionUrl(), setReactionDesired(), validSummaries(), ReactionSnapshotView, replaceReactionSnapshot() (+13 more)

### Community 81 - "Community 81"
Cohesion: 0.11
Nodes (19): RoomSnapshot, acknowledgeActiveVoiceResync(), clearActiveResync(), detailHandlers, ensureAppRealtimeConnected(), ensureReconnectRestore(), isRetryableActiveResyncError(), joinVoiceRoom() (+11 more)

### Community 82 - "Community 82"
Cohesion: 0.11
Nodes (12): 01a206a chore: release v2.1.1, 0d30394 chore: merge v2.1.1 back to develop, 0d74cad Merge branch 'release/2.1.6', 2eb2cbf chore: release v2.1.6, 3f9d416 wip: discord-style redesign (spaces/channels), 4125bf0 Add desktop shell layout styles for Electron., 5cc251a chore: release v2.1.7, 5e9164c feat(web): align lobby preview tiles with room participant chrome (+4 more)

### Community 83 - "Community 83"
Cohesion: 0.09
Nodes (18): 2d8eac5 test(messaging): lock G20-G23 contracts, cb7ad0e feat(api): fence message delivery cutover, createMessageService(), { createMessageVisibilityService }, createMessageVisibilityService(), MessageVisibilityError, assert, history (+10 more)

### Community 84 - "Community 84"
Cohesion: 0.15
Nodes (22): asSet(), buildNodeMap(), compareReplicas(), createReadinessProvider(), createReadinessReport(), crypto, evaluateFromOptions(), evaluatePublicNode() (+14 more)

### Community 85 - "Community 85"
Cohesion: 0.11
Nodes (17): checkApiSources(), findSqlWrites(), findTimers(), globToRegExp(), isOwner(), normalizePath(), walkFiles(), checkImportBoundaries() (+9 more)

### Community 86 - "Community 86"
Cohesion: 0.10
Nodes (19): 2ca6443 test(shared): lock platform classification contract, 69b709a test(shared): correct platform DTO assertion, 88e8e93 test(release): define physical support matrix gate, b318c49 test(web): prove desktop root boundary, c4b1a22 test(api): enforce exact migration lock budget, edf6daf test(api): prove platform class migration, BLOCKED_ROUTES, classifyPlatform() (+11 more)

### Community 87 - "Community 87"
Cohesion: 0.10
Nodes (15): eeb1235 feat(api): list and end account sessions, recover accounts by code, MMDB_METADATA_MARKER, now, previousMonth, target, createGeoLocator(), formatLocation(), fs (+7 more)

### Community 88 - "Community 88"
Cohesion: 0.09
Nodes (17): 166a0e8 test(release): resolve rescue fixtures from repository root, 5dd3691 test(api): serialize database suites, ac8e530 fix(notifications): persist explicit all room level, bf6bba7 test(api): cover media backlog age query, d56e835 fix(notifications): preserve conservative room policy, f540886 test(release): refresh CI gate fixtures, api, prefs (+9 more)

### Community 89 - "Community 89"
Cohesion: 0.15
Nodes (22): clearAllPeerJoinCues(), clearPeerJoinCue(), clearStreamViewerCues(), CueNote, getCueGain(), isCuePlaybackSuppressed(), peerJoinCueTimes, playCueSequence() (+14 more)

### Community 90 - "Community 90"
Cohesion: 0.10
Nodes (11): registerMediaRoutes(), assert, { createMediaVisibilityService }, fastify, { registerMediaRoutes }, test, assert, createApp() (+3 more)

### Community 92 - "Community 92"
Cohesion: 0.16
Nodes (21): addDesktopOverlayGame(), DEFAULT_SETTINGS, desktopOverlayAvailable(), DesktopOverlayForeground, DesktopOverlayParticipant, DesktopOverlayPatch, DesktopOverlaySettings, getBridge() (+13 more)

### Community 93 - "Community 93"
Cohesion: 0.18
Nodes (15): containsPath(), createCoordinatedSnapshot(), filesBelow(), resolvedProspectivePath(), sha256(), 06b943b fix(ops): bind media restore catalog, 1332815 feat(ops): add coordinated media restore, 8e66057 fix(ci): fail release gates on wrong branch (+7 more)

### Community 94 - "Community 94"
Cohesion: 0.11
Nodes (17): 0b4c646 feat(platform): enforce G14 capability readiness, 5459a43 feat(platform): harden G13 runtime configuration edge, createCapabilitySnapshot(), formatCapabilityPayload(), HEALTH_CAPABILITIES_LIMITS, { PUBLIC_CAPABILITY_KEYS }, publicFeatureFlags(), registerCapabilityRoutes() (+9 more)

### Community 95 - "Community 95"
Cohesion: 0.10
Nodes (18): createLinkPreviewRepository(), assert, { createLinkPreviewRepository }, { createLinkPreviewStorage, reconcileLinkPreviewImages }, { createRoomStore }, { createTestDatabase }, { createUserStore }, crypto (+10 more)

### Community 96 - "Community 96"
Cohesion: 0.10
Nodes (13): assert, { createApiApp }, { createCredentialBoundaryService }, { createLiveKitAuthGateService }, { createRoomStore }, { createTestDatabase }, fs, net (+5 more)

### Community 97 - "Community 97"
Cohesion: 0.12
Nodes (16): acceptFirstRequest(), assert, befriend(), cookieFrom(), { createTestDatabase }, fs, http, { openWs, waitForWsType } (+8 more)

### Community 98 - "Community 98"
Cohesion: 0.11
Nodes (15): acceptFirstRequest(), assert, befriend(), cookieFrom(), { createTestDatabase }, fs, http, { joinVoiceRoom, openWs: openHarnessWs, subscribeRoomPreview, waitForWsType } (+7 more)

### Community 99 - "Community 99"
Cohesion: 0.13
Nodes (4): AppRealtimeConnection, connectRealtime(), getAppRealtime(), wsUrl()

### Community 100 - "Community 100"
Cohesion: 0.15
Nodes (8): conversationKey(), createReplyStore(), normalizeTarget(), ReplyAuthor, ReplyConversation, ReplySendInput, ReplyStore, ReplyTarget

### Community 101 - "Community 101"
Cohesion: 0.14
Nodes (16): 2350242 build(api): define expiry-aware rescue profile, 4ea02ee fix(api): harden temporary moderation flows, 7795005 test(web): cover moderation center contract, createModerationRepository(), crypto, mapBanProfile(), mapModerationBan(), toMillis() (+8 more)

### Community 102 - "Community 102"
Cohesion: 0.12
Nodes (14): assert, buildApp(), { createApiApp, createApiServer }, createFakeFriends(), createFakeStore(), createFakeUsers(), fs, http (+6 more)

### Community 103 - "Community 103"
Cohesion: 0.15
Nodes (14): CapabilityFeatures, CapabilityKey, CapabilityResponse, isCapabilityReady(), loadCapabilities(), resetCapabilities(), CapabilityEdge, CapabilityState (+6 more)

### Community 105 - "Community 105"
Cohesion: 0.17
Nodes (18): { AccessToken, TrackSource }, assertCase(), { createDbPool }, { createGateCredentialSigner }, { createRoomStore }, directLocalhostPortClosed(), mintCredentials(), openWebSocket() (+10 more)

### Community 106 - "Community 106"
Cohesion: 0.13
Nodes (12): actorLockKey(), boundedString(), createMessageIdempotencyRepository(), crypto, encodeParts(), IdempotencyConflictError, IdempotencyQuotaError, ledgerKey() (+4 more)

### Community 107 - "Community 107"
Cohesion: 0.20
Nodes (16): flipPlacementVertical(), parsePlacement(), resolvePopoverPlacement(), viewportSpaceAroundTrigger(), PlacementAxis, PopoverCloseReason, PopoverContentState, PopoverDividerProps (+8 more)

### Community 109 - "Community 109"
Cohesion: 0.13
Nodes (17): assert, cookieFrom(), { createTestDatabase }, fs, getSocketPath(), http, me(), { openWs } (+9 more)

### Community 110 - "Community 110"
Cohesion: 0.11
Nodes (12): assert, { createTestDatabase }, fs, http, { openWs, joinVoiceRoom, sendWs, waitForWsType }, os, path, { socketPathForDirectory } (+4 more)

### Community 111 - "Community 111"
Cohesion: 0.18
Nodes (14): deleteModeratedMessage(), fetchActiveBans(), parsePage(), putBan(), responseJson(), roomModerationUrl(), unban(), BAN_DURATIONS (+6 more)

### Community 113 - "Community 113"
Cohesion: 0.22
Nodes (5): cleanView(), createReactionStore(), ReactionStore, reactorKey(), revision()

### Community 114 - "Community 114"
Cohesion: 0.11
Nodes (11): 995ced6 test(api): give spawned test servers 15 seconds to become ready, assert, { createTestDatabase }, fs, http, { openWs, joinVoiceRoom }, os, path (+3 more)

### Community 115 - "Community 115"
Cohesion: 0.12
Nodes (13): BLOCKED_SUBNETS, createLinkPreviewFetcher(), dns, http, https, isPublicAddress(), net, REDIRECT_STATUSES (+5 more)

### Community 116 - "Community 116"
Cohesion: 0.15
Nodes (14): buildNotificationEnvelope(), buildProviderPayload(), cleanString(), normalizeNotificationEnvelope(), normalizeNotificationItem(), NOTIFICATION_LEVEL_SET, NOTIFICATION_LEVELS, NOTIFICATION_REASON_SET (+6 more)

### Community 117 - "Community 117"
Cohesion: 0.14
Nodes (16): assert, cookieFrom(), { createTestDatabase }, fs, http, me(), { openWs, waitForWsType }, os (+8 more)

### Community 118 - "Community 118"
Cohesion: 0.11
Nodes (11): assert, { createTestDatabase }, fs, http, { openWs, joinVoiceRoom, subscribeRoomPreview, waitForWsType }, os, path, { socketPathForDirectory } (+3 more)

### Community 119 - "Community 119"
Cohesion: 0.11
Nodes (12): assert, { createTestDatabase }, fs, http, { openWs, sendWs, joinVoiceRoom, waitForWsType, countWsType }, os, path, { socketPathForDirectory } (+4 more)

### Community 120 - "Community 120"
Cohesion: 0.23
Nodes (15): FetchMembershipsOptions, fetchRoomMemberships(), leaveRoomMembership(), applyRoomVoicePeers(), cacheKey(), clearRoomMembership(), emptyEntry(), getRoomMembership() (+7 more)

### Community 121 - "Community 121"
Cohesion: 0.18
Nodes (12): fetchRoomPins(), pinAuthor(), PinnedMessage, PinnedMessageAuthor, PinResponse, pinRoomMessage(), PinSnapshot, pinUrl() (+4 more)

### Community 122 - "Community 122"
Cohesion: 0.18
Nodes (14): clean(), decodeEntities(), decodeHtmlBody(), extractLinkPreviewMetadata(), NAMED_ENTITIES, parseAttributes(), resolveHttpUrl(), createLinkPreviewService() (+6 more)

### Community 123 - "Community 123"
Cohesion: 0.16
Nodes (14): cleanUpstreamUrl(), { createCredentialBoundaryService }, { createDbPool }, { createGateCredentialSigner }, createLiveKitAuthGateService(), { createRoomStore }, deny(), destroySocket() (+6 more)

### Community 124 - "Community 124"
Cohesion: 0.28
Nodes (15): DEFAULT_FREQUENT_REACTIONS, FrequentReaction, frequentReactionKey(), loadFrequentReactions(), localStorageKey(), memory, normalizeEntries(), openDatabase() (+7 more)

### Community 125 - "Community 125"
Cohesion: 0.14
Nodes (10): CONTEXT_TABLES, createReactionRepository(), requireQuery(), assert, { createReactionRepository }, { createTestDatabase }, fs, { Pool } (+2 more)

### Community 126 - "Community 126"
Cohesion: 0.16
Nodes (13): BrowserIdleDetector, BrowserIdleDetectorConstructor, createPresenceIdleController(), DesktopIdleBridge, DesktopIdleScope, EventTarget, getDesktopIdleSecondsReader(), hasGrantedBrowserIdlePermission() (+5 more)

### Community 127 - "Community 127"
Cohesion: 0.13
Nodes (13): assert, { classifyPlatform }, { Client }, { createPushStore }, { createTestDatabase }, fs, MIGRATIONS_DIR, path (+5 more)

### Community 128 - "Community 128"
Cohesion: 0.13
Nodes (4): DeniedNotification, FakeNotification, require, ts

### Community 129 - "Community 129"
Cohesion: 0.23
Nodes (10): 1b46251 fix(web): fit the image viewer, tighten the picker, ping on mention only, 2207473 fix(web): make the tone strip reachable and settle the DM thread before showing it, 2bb0df7 feat(web): give images a real viewer, and open pending ones in it, 84ba47a feat(web): rebuild the notification centre, and retire notifications on read, 9c1c7df Merge branch 'feature/2.5.0-fixes' into develop, a0dac33 Merge branch 'feature/2.5.0-fixes' into develop, c22c49a Merge branch 'feature/2.5.0-fixes' into develop, e9bf7d5 feat(web): make a mention name a person you can act on (+2 more)

### Community 130 - "Community 130"
Cohesion: 0.13
Nodes (6): 29612d4 fix(web): move room moderation into settings sections and popup menus, ActiveBan, ActiveBanProfile, BanMutation, ModerationDuration, ModerationPage

### Community 131 - "Community 131"
Cohesion: 0.14
Nodes (10): 924295b test(web): prove G13 against pinned Caddy, 94552a2 test(release): fail closed at develop entry, 9e7182b perf(release): freeze 2.5.0 budgets, a37d685 test(web): make G13 paths workspace-safe, d5ce547 test(release): validate frozen budgets, ecc157a refactor(web): preserve async failure evidence, f5c42a7 test(release): prepare fail-closed rc preflight, fbe0d61 test(release): generate activation matrix (+2 more)

### Community 132 - "Community 132"
Cohesion: 0.15
Nodes (2): ContextMenuContentState, ContextMenuProps

### Community 133 - "Community 133"
Cohesion: 0.15
Nodes (10): toWsAccountEvent(), buildRoomMembershipPresenceSnapshot(), { buildServerEnvelope, sendWsEnvelope }, { cleanPresenceStatus }, createConnectionRegistry(), crypto, { toWsAccountEvent }, assert (+2 more)

### Community 134 - "Community 134"
Cohesion: 0.14
Nodes (10): clearViewedScreenPeerReferences(), createRoomRealtimeRuntime(), resolveViewedScreenPeerId(), assert, {
  clearViewedScreenPeerReferences,
  createRoomRealtimeRuntime,
  resolveViewedScreenPeerId
}, createLeaseRuntime(), createRuntime(), OWNER_TOKEN (+2 more)

### Community 135 - "Community 135"
Cohesion: 0.21
Nodes (10): INTERNAL_NODE_KEYS, isManifestValid(), isObject(), normalizeInternalNode(), normalizeManifest(), normalizeOperatorNode(), normalizePublicNode(), OPERATOR_KEYS (+2 more)

### Community 136 - "Community 136"
Cohesion: 0.13
Nodes (11): assert, { createTestDatabase }, { createUserStore }, crypto, fs, MIGRATIONS_DIR, path, { Pool } (+3 more)

### Community 137 - "Community 137"
Cohesion: 0.14
Nodes (13): assert, { createTestDatabase }, crypto, fs, MIGRATIONS_DIR, path, { Pool }, { runMigrations } (+5 more)

### Community 138 - "Community 138"
Cohesion: 0.19
Nodes (11): DesktopNotificationPayload, BridgeResult, DesktopBridge, resolveBridge(), showDesktopNotification(), browserNavigator(), classifyPlatform(), classifyPlatformPolicy() (+3 more)

### Community 139 - "Community 139"
Cohesion: 0.19
Nodes (11): assetName(), catalogueFile, graphicsLicenceFile, main(), outputDir, packageRoot, planEmojiAssets(), require (+3 more)

### Community 140 - "Community 140"
Cohesion: 0.21
Nodes (12): DirectMessage, ActiveResync, contentVersion(), createDmThreadResyncCoordinator(), mergeMessage(), newestTimestamp(), replayMutations(), ResyncRequestOptions (+4 more)

### Community 141 - "Community 141"
Cohesion: 0.29
Nodes (12): ChatDraft, ChatDraftScope, chatDraftScopeKey(), chatDraftStorageKey(), clearChatDrafts(), loadChatDraft(), normalizeChatDrafts(), normalizeMentions() (+4 more)

### Community 143 - "Community 143"
Cohesion: 0.21
Nodes (9): createProofOfWork(), crypto, hasLeadingZeroBits(), normalizePowNonce(), parsePowChallenge(), assert, crypto, {
  hasLeadingZeroBits,
  parsePowChallenge,
  normalizePowNonce,
  createProofOfWork
} (+1 more)

### Community 144 - "Community 144"
Cohesion: 0.26
Nodes (11): cacheKey(), configCache, defaultConfig(), fetchRuntimeConfig(), hasSuspiciousSecrets(), loadRuntimeConfig(), resolveConfigOrigin(), resolveConfigUrl() (+3 more)

### Community 145 - "Community 145"
Cohesion: 0.31
Nodes (11): clamp(), deriveAvatarAccent(), fitChromaToSrgb(), isInSrgbGamut(), linearToSrgb(), normalizeChannel(), oklchToHex(), oklchToLinearRgb() (+3 more)

### Community 146 - "Community 146"
Cohesion: 0.21
Nodes (10): cleanText(), firstPreviewableUrl(), normalizeImage(), normalizeLinkPreview(), toPreviewUrl(), assert, path, { pathToFileURL } (+2 more)

### Community 147 - "Community 147"
Cohesion: 0.27
Nodes (12): buildHistoryEnvelope(), cleanString(), getReadCursorFromMessage(), HISTORY_MODE_SET, HISTORY_MODES, isObject(), isOpaqueCursor(), MESSAGE_KIND_SET (+4 more)

### Community 148 - "Community 148"
Cohesion: 0.28
Nodes (11): DEFAULT_RUNTIME_CONFIG, getRuntimeConfig(), inheritLiveKitGateCredential(), normalizeLiveKitServerUrl(), normalizeLiveKitUrl(), normalizePayload(), parseRuntimeConfig(), resolveLiveKitConnectUrls() (+3 more)

### Community 149 - "Community 149"
Cohesion: 0.15
Nodes (10): assert, { createTestDatabase }, { createUserStore }, crypto, { Pool }, { RECOVERY_CODES_ONBOARDING_KEY, normalizeRecoveryCode }, {
  RECOVERY_CODES_REMINDER_SNOOZE_MS,
  WHATS_NEW_VERSION,
  normalizeRecoveryCode
}, { runMigrations } (+2 more)

### Community 150 - "Community 150"
Cohesion: 0.15
Nodes (11): assert, { createApiApp }, { createGateCredentialSigner }, { createLiveKitAuthGateService, extractCredential }, { EventEmitter }, fs, net, path (+3 more)

### Community 151 - "Community 151"
Cohesion: 0.15
Nodes (10): assert, crypto, {
  EMOJI_REACTION_AUTHORITY,
  assertReactionEmoji,
  cleanReactionEmoji,
  isReactionEmoji,
  listReactionEmojis
}, fs, PACKAGE_JSON, path, { pathToFileURL }, ROOT (+2 more)

### Community 152 - "Community 152"
Cohesion: 0.15
Nodes (10): ADMISSION_INTERNAL_COVERAGE_SCRIPT, { createGateCredentialSigner }, { createLiveKitAuthGateService, extractCredential }, { createRoomRealtimeRuntime }, { createRoomStore }, greenSummary, require, SERVER_INTERNAL_COVERAGE_SCRIPT (+2 more)

### Community 154 - "Community 154"
Cohesion: 0.18
Nodes (6): PLURAL_VERB, SINGLE_VERB, TYPING_ACTIVITIES, TypingActivity, TypingEntry, TypingPerson

### Community 155 - "Community 155"
Cohesion: 0.24
Nodes (10): createAvatarKey(), crypto, { deriveAvatarAccent, dominantAvatarColor }, detectAvatarFormat(), processAvatar(), sharp, assert, {
  AVATAR_SIZE,
  createAvatarKey,
  detectAvatarFormat,
  processAvatar
} (+2 more)

### Community 156 - "Community 156"
Cohesion: 0.24
Nodes (6): formatTime(), pad(), formatChatDayLabel(), isSameDay(), MONTHS, startOfDay()

### Community 158 - "Community 158"
Cohesion: 0.21
Nodes (1): ScreenRecoveryGraceController

### Community 159 - "Community 159"
Cohesion: 0.24
Nodes (9): attachmentTextFallback(), MIME_TYPES, normalizeAttachment(), normalizeAttachments(), STATES, text(), assert, { MAX_ATTACHMENT_BYTES, attachmentTextFallback, normalizeAttachment, normalizeAttachments } (+1 more)

### Community 160 - "Community 160"
Cohesion: 0.18
Nodes (11): assert, { createTestDatabase }, fs, get(), http, os, path, { socketPathForDirectory } (+3 more)

### Community 161 - "Community 161"
Cohesion: 0.24
Nodes (10): hasSurfaceToken(), isAllowedBackground(), lineAt(), paletteViolations(), root, sourceFiles(), sourceRoot, styleFragments() (+2 more)

### Community 162 - "Community 162"
Cohesion: 0.27
Nodes (8): attachmentRevoker(), cleanupEnqueuer(), createMessageModerationService(), requireOperation(), { transaction }, assert, { createMessageModerationService }, test

### Community 163 - "Community 163"
Cohesion: 0.53
Nodes (10): buildMessageDeliveryEvent(), cleanString(), DELIVERY_EVENT_TYPES, isObject(), isSystemCard(), normalizeConversation(), normalizeIdempotency(), normalizeReplyPointer() (+2 more)

### Community 164 - "Community 164"
Cohesion: 0.18
Nodes (8): assert, { createAttachmentRepository }, { createTestDatabase }, crypto, { Pool }, { runMigrations }, SILENT, test

### Community 165 - "Community 165"
Cohesion: 0.24
Nodes (4): DesktopAsset, DesktopRelease, DESKTOP_BUILDS, DesktopBuild

### Community 166 - "Community 166"
Cohesion: 0.22
Nodes (8): apps/CLAUDE.md, docs/GIT_FLOW.md, .github CLAUDE.md Policy, Pull Request Template, docs/RELEASE_<version>_PLAN.md, Root CLAUDE.md, Room client architecture (ARCHITECTURE.md), apps/web/CLAUDE.md

### Community 167 - "Community 167"
Cohesion: 0.27
Nodes (8): BROWSABLE_EMOJIS, BROWSABLE_SET, EmojiCategory, hasSkinToneChoices(), isOfferedEmoji(), OFFERED, skinToneChoices(), withSkinTone()

### Community 168 - "Community 168"
Cohesion: 0.29
Nodes (5): 28759aa fix(web): stack room reactions and keep the message toolbar reachable, 6baa520 Merge pull request #119 from dazeGG/feature/2.5.0-chat-polish, 9a9f2ca fix(web): keep the reply target inside the composer field, aae885c Merge pull request #117 from dazeGG/feature/2.5.0-manual-fixes, bf61139 Merge pull request #118 from dazeGG/feature/2.5.0-chat-parity

### Community 169 - "Community 169"
Cohesion: 0.27
Nodes (7): createMediaMaintenanceService(), assert, { createMediaMaintenanceService }, { createMediaMaintenanceWorker }, test, createMediaMaintenanceWorker(), main()

### Community 170 - "Community 170"
Cohesion: 0.22
Nodes (5): buildAppRoomLink(), markInAppRoomNavigation(), OpenInAppSignals, PRODUCTION_HOSTS, resolveAppLinkScheme()

### Community 171 - "Community 171"
Cohesion: 0.36
Nodes (9): buildMembershipEnvelope(), cleanString(), isObject(), MEMBERSHIP_ROLE_SET, MEMBERSHIP_ROLES, normalizeMembershipEnvelope(), normalizeMembershipLimit(), normalizeMembershipMember() (+1 more)

### Community 172 - "Community 172"
Cohesion: 0.22
Nodes (3): configure(), deferred(), MemoryStorage

### Community 173 - "Community 173"
Cohesion: 0.20
Nodes (5): assert, { createLiveKitAuthGateService }, { EventEmitter }, net, test

### Community 174 - "Community 174"
Cohesion: 0.22
Nodes (9): assert, commonJs, fs, invoke(), packageJson, path, { pathToFileURL }, snapshot() (+1 more)

### Community 175 - "Community 175"
Cohesion: 0.28
Nodes (5): BlockStatus, blockUrl(), blockUser(), unblockUser(), getJsonAuth()

### Community 177 - "Community 177"
Cohesion: 0.31
Nodes (8): buildTrie(), codePoints(), EmojiTextPart, hasEmoji(), matchAt(), splitEmoji(), TRIE, TrieNode

### Community 178 - "Community 178"
Cohesion: 0.36
Nodes (8): authorize(), { createGateCredentialSigner }, createMemoryGateStore(), extractCredential(), mint(), readTopologyEvidence(), require, runAuthGateProof()

### Community 181 - "Community 181"
Cohesion: 0.44
Nodes (8): cleanHttpUrl(), cleanString(), contentFromLegacyText(), normalizeRoomMessageContent(), normalizeSegment(), projectKnownContent(), projectRoomMessageContent(), utf8ByteLength()

### Community 182 - "Community 182"
Cohesion: 0.22
Nodes (7): bans, chatPanel, lobbyRoomSettings, members, model, roomSettings, root

### Community 183 - "Community 183"
Cohesion: 0.25
Nodes (1): lang

### Community 184 - "Community 184"
Cohesion: 0.32
Nodes (5): createRateLimiter(), getClientIp(), assert, { getClientIp, createRateLimiter }, test

### Community 186 - "Community 186"
Cohesion: 0.43
Nodes (7): desktopAutostartAvailable(), DesktopAutostartPatch, DesktopAutostartSettings, getBridge(), normalizeSettings(), readDesktopAutostartSettings(), updateDesktopAutostartSettings()

### Community 187 - "Community 187"
Cohesion: 0.36
Nodes (7): bindDesktopCallActions(), CALL_ACTIONS, DesktopCallAction, DesktopCallState, getBridge(), syncDesktopCallState(), toPayload()

### Community 188 - "Community 188"
Cohesion: 0.32
Nodes (4): getServer(), loadDrafts(), memoryStorage(), webRoot

### Community 189 - "Community 189"
Cohesion: 0.29
Nodes (4): getServer(), loadTyping(), require, webRoot

### Community 190 - "Community 190"
Cohesion: 0.25
Nodes (3): FakeWebSocket, require, ts

### Community 191 - "Community 191"
Cohesion: 0.25
Nodes (6): assert, metricsPath, path, serverPath, { spawn }, test

### Community 192 - "Community 192"
Cohesion: 0.33
Nodes (4): fingerprint(), SendShadow, SendShadowState, stableJson()

### Community 193 - "Community 193"
Cohesion: 0.33
Nodes (6): hasLeadingZeroBits(), waitForUi(), fetchJson(), createRoomProof(), RoomProof, solveProofOfWork()

### Community 194 - "Community 194"
Cohesion: 0.48
Nodes (7): docs/CLAUDE.md governance rules, VoiceRoom 2.5.0 consolidated execution plan, Git Flow workflow, VoiceRoom 2.5.0 unified messaging platform PRD, Release 2.4.0 verification plan, Release 2.4.1 verification plan, Release 2.4.2 hotfix verification plan

### Community 195 - "Community 195"
Cohesion: 0.48
Nodes (6): copyDesktopDiagnostics(), desktopDiagnosticsAvailable(), DesktopDiagnosticsContext, getBridge(), openDesktopLogsFolder(), syncDesktopDiagnosticsContext()

### Community 196 - "Community 196"
Cohesion: 0.29
Nodes (6): CapabilityInternalNode, CapabilityManifest, CapabilityOperatorNode, CapabilityPublicNode, CapabilityReplicaConsensus, CapabilityRequires

### Community 197 - "Community 197"
Cohesion: 0.29
Nodes (6): ConversationRef, IdempotencyDescriptor, MessageDeliveryEvent, ReplyPointer, ReplyPreview, SendEnvelope

### Community 198 - "Community 198"
Cohesion: 0.29
Nodes (6): ClientEnvelope, RoomPeerSummary, RoomRealtimeSummary, RoomTypist, ServerEnvelope, TypingActivity

### Community 199 - "Community 199"
Cohesion: 0.38
Nodes (7): checkPushSubscriptionRate(), cleanPushSubscription(), getPushService(), getPushStore(), handleCreatePushSubscription(), handleDeletePushSubscription(), handlePushConfig()

### Community 200 - "Community 200"
Cohesion: 0.33
Nodes (3): DEFAULT_OPTIONS, getSmoothingCoefficient(), VoiceRoomNoiseGateProcessor

### Community 201 - "Community 201"
Cohesion: 0.29
Nodes (4): assert, { __private, createApiApp }, test, { TrackSource }

### Community 202 - "Community 202"
Cohesion: 0.29
Nodes (2): require, ts

### Community 203 - "Community 203"
Cohesion: 0.29
Nodes (6): assert, { createReadinessReport }, fs, path, { readMessageDeliveryMode }, { test }

### Community 204 - "Community 204"
Cohesion: 0.29
Nodes (3): FakeIdleDetector, require, ts

### Community 205 - "Community 205"
Cohesion: 0.29
Nodes (4): assert, fs, path, test

### Community 206 - "Community 206"
Cohesion: 0.38
Nodes (5): FOCUSABLE_SELECTOR, focusInitialElement(), FocusTrapOptions, getFocusableElements(), isHTMLElement()

### Community 207 - "Community 207"
Cohesion: 0.60
Nodes (5): ChatMessage, mentionProfilePerson(), participantProfilePerson(), presenceFor(), roomMessageProfilePerson()

### Community 208 - "Community 208"
Cohesion: 0.33
Nodes (6): Desktop Support Matrix Doc (G19), Release 2.5.0 Durable Evidence Archive Doc (G03), Coordinated Media Backup and Restore Doc, Release 2.5.0 Budgets Doc (G91), Release 2.5.0 Develop Entry Doc (G93), Release 2.5.0 RC Preflight Doc

### Community 209 - "Community 209"
Cohesion: 0.60
Nodes (4): iconLg, iconMd, iconSm, iconXs

### Community 210 - "Community 210"
Cohesion: 0.53
Nodes (5): countUnreadForBadge(), DesktopBadgeInput, getBridge(), positive(), syncDesktopBadgeCount()

### Community 211 - "Community 211"
Cohesion: 0.47
Nodes (5): bindDesktopLinks(), DesktopLink, getBridge(), matches(), normalizeDesktopLink()

### Community 212 - "Community 212"
Cohesion: 0.33
Nodes (1): LiveKitReconcileGeneration

### Community 213 - "Community 213"
Cohesion: 0.40
Nodes (2): o, s()

### Community 214 - "Community 214"
Cohesion: 0.33
Nodes (2): participantContextMenu, ParticipantMenuVariant

### Community 215 - "Community 215"
Cohesion: 0.33
Nodes (5): RoomMessageContentV1, RoomMessageLinkSegmentV1, RoomMessageMentionSegmentV1, RoomMessageSegmentV1, RoomMessageTextSegmentV1

### Community 216 - "Community 216"
Cohesion: 0.40
Nodes (5): loadRoomRealtime(), moduleUrl(), require, root, ts

### Community 217 - "Community 217"
Cohesion: 0.40
Nodes (3): getServer(), loadEmojiText(), webRoot

### Community 218 - "Community 218"
Cohesion: 0.33
Nodes (1): FakeServer

### Community 219 - "Community 219"
Cohesion: 0.60
Nodes (4): isToneIndex(), loadSkinTone(), saveSkinTone(), SkinToneIndex

### Community 220 - "Community 220"
Cohesion: 0.60
Nodes (5): 0d5875a fix: close migration dependency audit finding, 7a27ba8 chore: prepare v2.0.0 release, 983e909 Merge pull request #11 from dazeGG/hotfix/api-docker-workspace-start-develop, c6b8624 fix: start api workspace in docker image, dcda22d chore: merge v2.0.0 back to develop

### Community 222 - "Community 222"
Cohesion: 0.40
Nodes (5): Expiry-Aware Rescue Profile Doc (G85), Predeploy Migrations Doc, Release 2.6.0 Plan — Engagement & Notifications (Superseded), Release 2.7.0 Plan — Media & Moderation (Superseded), VoiceRoom 2.5.0 Unified — Verification and Release Evidence Specification

### Community 223 - "Community 223"
Cohesion: 0.50
Nodes (2): applyRoomSwitchDecision(), writeRoomSwitchConfirmEnabled()

### Community 224 - "Community 224"
Cohesion: 0.50
Nodes (1): VoiceRoomDesktopAudioSourceProcessor

### Community 225 - "Community 225"
Cohesion: 0.50
Nodes (3): getServer(), loadAttention(), webRoot

### Community 226 - "Community 226"
Cohesion: 0.50
Nodes (3): getServer(), loadModule(), webRoot

### Community 227 - "Community 227"
Cohesion: 0.40
Nodes (1): FakeSocket

### Community 228 - "Community 228"
Cohesion: 0.40
Nodes (1): FakeSocket

### Community 229 - "Community 229"
Cohesion: 0.40
Nodes (1): FakeSocket

### Community 230 - "Community 230"
Cohesion: 0.50
Nodes (1): playbackPolicy

### Community 232 - "Community 232"
Cohesion: 0.67
Nodes (2): copyTextFor(), handleEmojiCopy()

### Community 233 - "Community 233"
Cohesion: 0.67
Nodes (3): crypto, processLinkPreviewImage(), sharp

### Community 234 - "Community 234"
Cohesion: 0.50
Nodes (1): registerDmHistoryRoutes()

### Community 235 - "Community 235"
Cohesion: 0.50
Nodes (1): registerModerationRoutes()

### Community 236 - "Community 236"
Cohesion: 0.50
Nodes (2): NAME_SITES, webRoot

### Community 237 - "Community 237"
Cohesion: 0.67
Nodes (3): addOrigin(), config, liveKitConnectSources()

### Community 238 - "Community 238"
Cohesion: 0.67
Nodes (2): LinkPreview, LinkPreviewImage

### Community 239 - "Community 239"
Cohesion: 0.67
Nodes (1): webRoot

### Community 240 - "Community 240"
Cohesion: 0.67
Nodes (1): webRoot

### Community 241 - "Community 241"
Cohesion: 1.00
Nodes (2): VoiceRoom App Icon (Owl Mascot Mark on Dark Rounded Square), VoiceRoom Mascot Mark (Masked Owl Silhouette, Transparent)

### Community 242 - "Community 242"
Cohesion: 1.00
Nodes (1): ADR: Unicode authority for message reactions

### Community 243 - "Community 243"
Cohesion: 1.00
Nodes (1): VoiceRoom 2.5 Architecture Boundaries

### Community 244 - "Community 244"
Cohesion: 1.00
Nodes (1): Backlog

### Community 245 - "Community 245"
Cohesion: 1.00
Nodes (1): config/capability-dag.v1.json

### Community 246 - "Community 246"
Cohesion: 1.00
Nodes (1): Capability Readiness Doc

### Community 247 - "Community 247"
Cohesion: 1.00
Nodes (1): Design QA — reusable room and chat menus

### Community 248 - "Community 248"
Cohesion: 1.00
Nodes (1): Font Assets README

### Community 249 - "Community 249"
Cohesion: 1.00
Nodes (1): LiveKit External Auth-Gate Operations Doc (G05)

### Community 250 - "Community 250"
Cohesion: 1.00
Nodes (1): VoiceRoom monitoring agent

### Community 251 - "Community 251"
Cohesion: 1.00
Nodes (1): OCI Runtime Publication Doc

### Community 252 - "Community 252"
Cohesion: 1.00
Nodes (1): packages/CLAUDE.md Guidance

### Community 253 - "Community 253"
Cohesion: 1.00
Nodes (1): Production Digest Promotion Doc

### Community 254 - "Community 254"
Cohesion: 1.00
Nodes (1): Release 2.5.0 Repairs README

## Knowledge Gaps
- **1782 isolated node(s):** `crypto`, `{ transaction }`, `{ verifyPassword }`, `{
  ACCOUNT_DELETION_GRACE_MS,
  DELETED_ACCOUNT_NAME,
  DELETED_LOGIN_PREFIX
}`, `PERSONAL_DATA_CLEANUP` (+1777 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 35`** (1 nodes): `edf009e feat(web): add desktop autostart settings`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 132`** (2 nodes): `ContextMenuContentState`, `ContextMenuProps`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 158`** (1 nodes): `ScreenRecoveryGraceController`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 183`** (1 nodes): `lang`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 202`** (2 nodes): `require`, `ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 212`** (1 nodes): `LiveKitReconcileGeneration`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 213`** (2 nodes): `o`, `s()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 214`** (2 nodes): `participantContextMenu`, `ParticipantMenuVariant`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 218`** (1 nodes): `FakeServer`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 223`** (2 nodes): `applyRoomSwitchDecision()`, `writeRoomSwitchConfirmEnabled()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 224`** (1 nodes): `VoiceRoomDesktopAudioSourceProcessor`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 227`** (1 nodes): `FakeSocket`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 228`** (1 nodes): `FakeSocket`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 229`** (1 nodes): `FakeSocket`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 230`** (1 nodes): `playbackPolicy`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 232`** (2 nodes): `copyTextFor()`, `handleEmojiCopy()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 234`** (1 nodes): `registerDmHistoryRoutes()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 235`** (1 nodes): `registerModerationRoutes()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 236`** (2 nodes): `NAME_SITES`, `webRoot`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 238`** (2 nodes): `LinkPreview`, `LinkPreviewImage`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 239`** (1 nodes): `webRoot`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 240`** (1 nodes): `webRoot`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 241`** (2 nodes): `VoiceRoom App Icon (Owl Mascot Mark on Dark Rounded Square)`, `VoiceRoom Mascot Mark (Masked Owl Silhouette, Transparent)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 242`** (1 nodes): `ADR: Unicode authority for message reactions`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 243`** (1 nodes): `VoiceRoom 2.5 Architecture Boundaries`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 244`** (1 nodes): `Backlog`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 245`** (1 nodes): `config/capability-dag.v1.json`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 246`** (1 nodes): `Capability Readiness Doc`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 247`** (1 nodes): `Design QA — reusable room and chat menus`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 248`** (1 nodes): `Font Assets README`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 249`** (1 nodes): `LiveKit External Auth-Gate Operations Doc (G05)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 250`** (1 nodes): `VoiceRoom monitoring agent`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 251`** (1 nodes): `OCI Runtime Publication Doc`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 252`** (1 nodes): `packages/CLAUDE.md Guidance`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 253`** (1 nodes): `Production Digest Promotion Doc`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 254`** (1 nodes): `Release 2.5.0 Repairs README`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `RealtimeRecoveryController` connect `Community 51` to `Community 13`?**
  _High betweenness centrality (0.008) - this node is a cross-community bridge._
- **Why does `AppRealtimeConnection` connect `Community 99` to `Community 67`?**
  _High betweenness centrality (0.005) - this node is a cross-community bridge._
- **What connects `crypto`, `{ transaction }`, `{ verifyPassword }` to the rest of the system?**
  _1782 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.010571884256094783 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.06782911944202266 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.13291976840363937 - nodes in this community are weakly interconnected._
- **Should `Community 3` be split into smaller, more focused modules?**
  _Cohesion score 0.021157304559399133 - nodes in this community are weakly interconnected._