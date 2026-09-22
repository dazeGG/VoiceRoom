# Graph Report - .  (2026-09-21)

## Corpus Check
- Large corpus: 817 files · ~404 955 words. Semantic extraction will be expensive (many Claude tokens). Consider running on a subfolder, or use --no-semantic to run AST-only.

## Summary
- 6575 nodes · 21050 edges · 245 communities detected
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 6 edges (avg confidence: 0.73)
- Token cost: 0 input · 0 output
- Edge kinds: ON_BRANCH: 6205 · contains: 4896 · MODIFIES: 4896 · calls: 1974 · imports: 1188 · imports_from: 804 · PARENT_OF: 779 · method: 208 · re_exports: 59 · references: 23 · inherits: 11 · conceptually_related_to: 4 · semantically_similar_to: 2 · implements: 1


## Input Scope
- Requested: auto
- Resolved: committed (source: default-auto)
- Included files: 817 · Candidates: 897
- Excluded: 3 untracked · 48480 ignored · 13 sensitive · 0 missing committed
- Recommendation: Use --scope all or graphify.yaml inputs.corpus for a knowledge-base folder.

## Graph Freshness
- Built from Git commit: `6783809`
- Compare this hash to `git rev-parse HEAD` before trusting freshness-sensitive graph output.
## God Nodes (most connected - your core abstractions)
1. `sendJson()` - 87 edges
2. `createTestDatabase()` - 47 edges
3. `runMigrations()` - 40 edges
4. `readJsonBody()` - 34 edges
5. `getUserStore()` - 31 edges
6. `RealtimeRecoveryController` - 30 edges
7. `resolveSessionUser()` - 29 edges
8. `requireSessionUser()` - 29 edges
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
Cohesion: 0.06
Nodes (246): backup/room-shared-music-pre-rebase, chore/graphify-refresh, develop, feature/2.5.0-manual-fixes, feature/2.5.0-to-rc, feature/account-sessions-recovery, feature/cd-pipeline, feature/desktop-app-settings (+238 more)

### Community 1 - "Community 1"
Cohesion: 0.01
Nodes (189): createFriendStore(), createLinkPreviewRepository(), createMessageReadRepository(), registerPinRoutes(), registerRoomHistoryRoutes(), createRoomMessageRepository(), registerNotificationRoutes(), {
  ACCOUNT_DELETION_GRACE_MS,
  WHATS_NEW_VERSION,
  formatRecoveryCode,
  isDeletedAccountLogin
} (+181 more)

### Community 2 - "Community 2"
Cohesion: 0.03
Nodes (125): 234177e feat(web): redesign screen source picker, 269978f chore(release): bump version to 2.2.6, 4c756b6 Merge branch 'release/2.2.6', 9ba8ece feat(web): tune screen share encoding, f5501ff Merge tag 'v2.2.6' into develop, NoiseModeOption, SCREEN_FPS_OPTIONS, SCREEN_QUALITY_OPTIONS (+117 more)

### Community 3 - "Community 3"
Cohesion: 0.03
Nodes (34): 043b73d chore: release v2.1.5, 2391bbe feat(web): migrate UI icons to Lucide (#42), 2ea67a2 Merge branch 'release/2.2.4', 4497e53 Merge branch 'release/2.2.5', 4e4ea97 fix(web): unify room tile grid layout, 564c893 feat(web): support centered nine-tile room layout, 634b607 feat(web): prepare Voice Room 1.7.0, 8de78c2 Merge tag 'v2.2.5' into develop (+26 more)

### Community 4 - "Community 4"
Cohesion: 0.15
Nodes (104): feature/composer-emoji-picker, feature/emoji-images, feature/guest-account-app-cta, feature/mobile-polish, feature/mobile-room, feature/whats-new-recovery-codes, feature/whats-new-screenshots, fix/api-test-db-teardown (+96 more)

### Community 5 - "Community 5"
Cohesion: 0.02
Nodes (40): SelectedMention, 2d36bc7 fix(api): bound messaging schema locks, 728cea2 feat: implement release 2.5.0 messaging platform (#105), ab373a6 chore(release): 2.5.0 (#121), { createDbPool }, createRelease250Pool(), createMediaQuotaRepository(), createMediaQuotaService() (+32 more)

### Community 6 - "Community 6"
Cohesion: 0.03
Nodes (51): AuthUser, SelfUserFlags, roomNameFor(), clearSession(), session, setUser(), syncRoomName(), 2b2c6c9 chore: release v2.0.0 (+43 more)

### Community 7 - "Community 7"
Cohesion: 0.03
Nodes (49): 15e3ea9 Merge branch 'feature/account-sessions-recovery' into develop, 3258210 docs: describe account deletion and its grace period, 335132e feat(shared): add the account security contract, 51b04d8 Merge branch 'feature/account-sessions-recovery' into develop, 5748635 Merge pull request #142 from dazeGG/release/2.6.0, 78f51ae feat: delete an account with a seven-day grace period, 8a43888 feat: split what's new from the recovery codes reminder, 925763f feat(web): security settings, recovery by code and the 2.6.0 onboarding (+41 more)

### Community 8 - "Community 8"
Cohesion: 0.03
Nodes (31): 0a0699b chore: release v2.1.2, 0d30394 chore: merge v2.1.1 back to develop, 0d74cad Merge branch 'release/2.1.6', 0f3d7a0 Merge branch 'hotfix/2.1.3', 0ffac54 feat(infra): expose livekit prometheus metrics for status stack (#22), 1840f18 chore: release v2.1.4, 2994d09 fix(api): return friend request id from listRequests, 2eb2cbf chore: release v2.1.6 (+23 more)

### Community 9 - "Community 9"
Cohesion: 0.04
Nodes (79): a0ff17a feat(web): improve sound settings with sliders and cue volume (#30), MicrophoneMode, NOISE_MODES, NoiseMode, amplitudeToDb(), clampGateThresholdDb(), clampParticipantVolume(), DEFAULT_PARTICIPANT_AUDIO_PREFERENCE (+71 more)

### Community 10 - "Community 10"
Cohesion: 0.05
Nodes (70): deleteDirectMessage(), DirectMessageHistoryPage, DirectMessageInvite, editDirectMessage(), fetchThread(), fetchThreadPage(), HistoryMessageDto, markThreadRead() (+62 more)

### Community 11 - "Community 11"
Cohesion: 0.03
Nodes (56): 19902ab feat: prepare 2.5.0 RC and polish chats (#114), 4553c35 fix(web): reconcile repeated cross-tab read cursors, 54086b4 fix(api): serialize notification retraction revisions, 74df7a9 fix(api): revoke only failed admission credential, 8e66057 fix(ci): fail release gates on wrong branch, ac8e530 fix(notifications): persist explicit all room level, d56e835 fix(notifications): preserve conservative room policy, fcd0beb fix(ci): bind OCI evidence to Actions archive bytes (+48 more)

### Community 12 - "Community 12"
Cohesion: 0.04
Nodes (33): playbackPolicy, AvatarCropDialogProps, AvatarCropShape, 6584f79 feat: add uploaded avatars for users and rooms (#45), e0eb12c chore(release): prepare 2.4.0, createAvatarKey(), crypto, { deriveAvatarAccent, dominantAvatarColor } (+25 more)

### Community 13 - "Community 13"
Cohesion: 0.07
Nodes (75): authorizeRoomMutation(), broadcast(), broadcastRoomUpdate(), broadcastUserProfileToFriends(), buildSessionCookie(), checkAvatarUploadRate(), clearSessionCookie(), countRoomCreationQuotaRoomsForIp() (+67 more)

### Community 14 - "Community 14"
Cohesion: 0.05
Nodes (64): isRoomEmbedded(), extractRoomId(), ApiRequestError, checkRoomExists(), fetchJson(), postJson(), cancelRoomRecovery(), isCurrentRoomRecoveryEpoch() (+56 more)

### Community 15 - "Community 15"
Cohesion: 0.06
Nodes (44): feature/2.6.0-prerelease, ComposerSelection, emojiAssetName(), emojiAssetUrl(), copyTextFor(), handleEmojiCopy(), 017195e Merge branch 'feature/composer-emoji-picker' into develop, 129387d feat(web): write messages in a field that shows emoji as artwork (+36 more)

### Community 16 - "Community 16"
Cohesion: 0.05
Nodes (43): RoomRealtimeSummary, RoomPeer, AvatarStackItem, AvatarStackProps, 049a913 fix(web): keep popover open on ambiguous focus loss, 08bd491 fix(web): focus DM compose input when opening a friend chat (#28), 0c20745 chore(release): back-merge 2.1.9, 206a214 refactor(web): use shared slider in settings controls (+35 more)

### Community 17 - "Community 17"
Cohesion: 0.04
Nodes (51): 1578df6 feat: add account settings, 22a796b Merge pull request #8 from feature/404-page, 3580978 fix(api): harden session and cookie write security, 6ea473b docs: add git flow workflow, 73f12ba docs: default to ready pull requests, cc7f297 Merge pull request: chore private monitoring agent, fe15e8b chore: add private monitoring agent, { AVATAR_COLOR_KEYS, cleanAvatarColorKey, cleanPresenceStatus } (+43 more)

### Community 18 - "Community 18"
Cohesion: 0.04
Nodes (39): 02d78bc Merge pull request #69 from dazeGG/hotfix/2.4.2-backmerge, 6cd4b30 fix(web): stabilize screen sharing in 2.4.2 (#68), cf1ea14 chore(release): back-merge 2.4.2 into develop, getScreenPublicationPresence(), ScreenPublicationPresence, getScreenReceiverDemand(), ScreenReceiverDemand, createScreenSubscriptionRetryController() (+31 more)

### Community 19 - "Community 19"
Cohesion: 0.04
Nodes (50): 53d093e test(api): execute hostile credential boundary scenarios, b16c894 fix(api): expose fail-closed release telemetry, c928af9 fix(api): require exact migration catalog readiness, cc45703 fix(api): expose worker metrics across process boundaries, d02ad7f fix(release): resolve evidence from immutable external artifacts, f124c57 fix(web): verify reaction boundaries through rendered UI, httpKey(), httpRequests (+42 more)

### Community 20 - "Community 20"
Cohesion: 0.04
Nodes (46): fa382b2 fix(api): derive backlog age directly from storage, path, readEnvBool(), readEnvInt(), readMessageDeliveryMode(), createNotificationOutboxRepository(), crypto, NotificationFenceError (+38 more)

### Community 21 - "Community 21"
Cohesion: 0.04
Nodes (30): del(), fetchJson(), patchJson(), postJson(), postJsonAuth(), putJson(), createRoomProof(), hasLeadingZeroBits() (+22 more)

### Community 22 - "Community 22"
Cohesion: 0.09
Nodes (55): 1a5009b fix(web): remove transient voice-connecting placeholder, detachRemoteAudioTrack(), applyRemoteScreenVideoDemand(), attachSubscribedRemoteScreenTrack(), attemptFreshLiveKitReplacement(), bindLiveKitRoomEvents(), clearAllScreenSubscriptionRetries(), clearScreenSubscriptionRetry() (+47 more)

### Community 23 - "Community 23"
Cohesion: 0.06
Nodes (42): AccountSecurity, addRoomByCode(), authPost(), authRead(), AuthRequestError, avatarRequest(), changePassword(), confirmLoginAlert() (+34 more)

### Community 24 - "Community 24"
Cohesion: 0.07
Nodes (52): dbToAmplitude(), persistMicrophoneVolume(), MicProcessor, MicrophoneCapture, disconnectAudioNode(), unpublishLocalMicrophone(), applyInputGainToCapture(), applyNoiseGateToCapture() (+44 more)

### Community 25 - "Community 25"
Cohesion: 0.07
Nodes (45): 164b853 refactor(web): neutral input placeholders, dedicated dev port, desktop drag region (#16), 2c5f8d4 feat(web): show stream quality on tile thumbnails, 3f83f05 Merge branch 'release/2.2.0', 4cfb160 chore(release): bump version to 2.2.0, 65f8383 chore: removed status agent file, 67b668e chore: merge v2.0.2 back to develop, 7524c15 feat(realtime): add websocket room updates, 7b8da98 feat(web): add the room music player (+37 more)

### Community 26 - "Community 26"
Cohesion: 0.04
Nodes (42): assert, { createTestDatabase }, { createUserStore }, { LOGIN_ALERT_TTL_MS, LOGIN_FAMILIARITY_WINDOW_MS }, { runMigrations }, SILENT, test, createTestDatabase() (+34 more)

### Community 27 - "Community 27"
Cohesion: 0.06
Nodes (43): 1886650 feat(api): persist rooms and chat in postgres, 364b82c build(api): fence G15 predeploy migrations, 8fdccbd chore(scripts): default to docker compose workflows, a36adca chore(docker): add postgres compose workflows, readDatabaseConfig(), acquireMigrationLock(), advisoryLockParts(), assertMigrationLockHeld() (+35 more)

### Community 28 - "Community 28"
Cohesion: 0.06
Nodes (38): eventMatchesHotkey(), getDefaultHotkeyBinding(), getHotkeyStorageKey(), HotkeyAction, isTypingTarget(), parseHotkeyBinding(), readHotkeyBinding(), writeHotkeyBinding() (+30 more)

### Community 30 - "Community 30"
Cohesion: 0.09
Nodes (47): clampStreamVolume(), getStoredStreamVolume(), normalizeStoredStreamVolume(), storeStreamVolume(), clearScreenAttendance(), setScreenAttendance(), releaseScreenMediaElement(), activateScreenStageUi() (+39 more)

### Community 31 - "Community 31"
Cohesion: 0.05
Nodes (35): {
  buildHistoryEnvelope,
  normalizeHistoryRequest
}, canonicalParticipants(), createDmHistoryService(), DmHistoryError, { normalizeLinkPreview }, createMessageReadService(), MessageReadError, {
  buildHistoryEnvelope,
  normalizeHistoryRequest
} (+27 more)

### Community 32 - "Community 32"
Cohesion: 0.07
Nodes (48): activeTargetSuppresses(), actorLabel(), BrowserNotificationPayload, buildNotificationPayload(), canUseNotifications(), cleanupMemoryDedupe(), consumeNotificationDedupeKey(), dedupeStorageKey() (+40 more)

### Community 33 - "Community 33"
Cohesion: 0.04
Nodes (38): 05f2a77 test(api): bind strict credential cutover, 501ef14 test(web): lock leave and rejoin flow, d9f484d test(engagement): prove content and mention UoW, ebd3ed4 test(release): define G50 membership checkpoint, membershipModel, routes, service, voiceSession (+30 more)

### Community 35 - "Community 35"
Cohesion: 0.08
Nodes (35): fetchNotificationPreferences(), normalizePreferences(), NotificationMuteResponse, NotificationPreferences, NotificationPreferencesResponse, RoomNotificationLevel, setDmNotificationsMuted(), setDoNotDisturb() (+27 more)

### Community 36 - "Community 36"
Cohesion: 0.04
Nodes (2): 13254ae docs: document durable room storage, c860746 feat(web): add static rooms and room chat UI

### Community 37 - "Community 37"
Cohesion: 0.07
Nodes (41): assertReactionEmoji(), cleanReactionEmoji(), EMOJI_REACTION_AUTHORITY, buildGroups(), GROUP_ANCHORS, listReactionEmojiGroups(), { listReactionEmojis }, reactionEmojiGroupKey() (+33 more)

### Community 38 - "Community 38"
Cohesion: 0.11
Nodes (43): 2684b15 chore: release v2.1.3, 72d40ae fix(web): drop empty-room placeholder, auto-join guests, 8b5b175 chore: merge v2.0.1 back to develop, cef76ec chore: release v2.0.1, e9dccb2 fix(web): recover remote microphone playback, applyRemoteScreenCue(), applyStreamViewerCue(), attachMeterSoon() (+35 more)

### Community 39 - "Community 39"
Cohesion: 0.05
Nodes (35): CONTEXTS, createAttachmentRepository(), crypto, mapAttachment(), MIME_TYPES, assert, { createAttachmentRepository }, { createTestDatabase } (+27 more)

### Community 40 - "Community 40"
Cohesion: 0.05
Nodes (33): AVATAR_KEY_PATTERN, createAvatarStorage(), fs, path, { readUploadsDir }, validateAvatarKey(), readUploadsDir(), createLinkPreviewStorage() (+25 more)

### Community 41 - "Community 41"
Cohesion: 0.13
Nodes (43): broadcastDmNotification(), broadcastToUser(), checkPushSubscriptionRate(), cleanPushSubscription(), cleanUuid(), getFriendStore(), getMessageService(), getNotificationStore() (+35 more)

### Community 42 - "Community 42"
Cohesion: 0.07
Nodes (10): AvatarProps, BadgeProps, ButtonProps, 3db468e feat(web): Volt redesign — landing, lobby v2, shared UI (#38), DialogProps, ToastOptions, toastState, SwitchProps (+2 more)

### Community 43 - "Community 43"
Cohesion: 0.09
Nodes (37): 09c4d42 feat(shared): add the room shared-music wire contract, 6eb964c feat(shared): add the room shared-music wire contract, buildRoomRealtimeSummary(), buildServerEnvelope(), isPlainObject(), KNOWN_CLIENT_TYPES, { normalizeRoomId, normalizePeerId, normalizeSessionToken, cleanName }, normalizeTypingActivity() (+29 more)

### Community 44 - "Community 44"
Cohesion: 0.06
Nodes (34): 2a9aa5b test(api): prove media quota and worker safety, 575dc80 fix(api): align private media boundaries, createMediaService(), detectExactContainer(), FORMAT_MIME, MediaServiceError, PNG_END, readBounded() (+26 more)

### Community 45 - "Community 45"
Cohesion: 0.08
Nodes (9): 2ea3623 Merge pull request #116 from dazeGG/feature/2.5.0-manual-fixes, aae885c Merge pull request #117 from dazeGG/feature/2.5.0-manual-fixes, c80ed8a feat(web): expand contextual menus, ProfileCardAnchor, profileCardUi, ProfileCardPerson, ProfileCardProps, ProfileCardRelationship (+1 more)

### Community 46 - "Community 46"
Cohesion: 0.05
Nodes (2): 3c617ec style(web): polish dm day separator, 7db2783 docs(monitoring): align LiveKit track metric labels

### Community 47 - "Community 47"
Cohesion: 0.09
Nodes (34): 5c8e7e1 Merge branch 'fix/ptt-idle-not-muted' into develop, 97d6dcd fix(web): stop showing idle push-to-talk as a muted microphone, bcdcd06 refactor(web): untangle room client import cycles, isMicrophoneShownMuted(), persistMicrophoneMode(), persistOutputMuted(), applySpeaking(), attachMeter() (+26 more)

### Community 48 - "Community 48"
Cohesion: 0.07
Nodes (29): b6c5445 fix(api): reuse account avatar color in calls, {
  AVATAR_COLOR_KEYS,
  cleanAvatarColorKey
}, avatarColorForPeerId(), { createActiveBanService }, { createDbPool, transaction }, createRoomStore(), crypto, mapMessage() (+21 more)

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
Cohesion: 0.12
Nodes (32): feature/whats-new-stories, release/2.6.0, 0e0a5df Merge branch 'feature/2.6.0-prerelease' into develop, 189c194 chore(graphify): rebuild the knowledge graph for the 2.6.0 pre-release fixes, 1dd8bdc feat(web): illustrate what is new with screenshots of the real app, 2513c99 Merge branch 'feature/link-previews' into develop, 263b5c6 Merge branch 'feature/whats-new-recovery-codes' into develop, 2b4a3c6 feat(web): make link previews compact (+24 more)

### Community 53 - "Community 53"
Cohesion: 0.09
Nodes (18): AttachmentApiError, AttachmentContext, AttachmentDraft, AttachmentDraftState, createAttachmentSlot(), deleteAttachment(), Envelope, getAttachmentStatus() (+10 more)

### Community 54 - "Community 54"
Cohesion: 0.08
Nodes (7): installDomRuntime(), TestDocument, TestElement, TestEvent, TestKeyboardEvent, TestNode, TestText

### Community 55 - "Community 55"
Cohesion: 0.06
Nodes (25): c02e107 fix(web): recover attachment compose safely, cf49285 fix(api): reconcile media across replicas, d37be0b feat(api): expose media pressure health, composer, dm, room, store, css (+17 more)

### Community 56 - "Community 56"
Cohesion: 0.13
Nodes (18): dm, picker, reactors, room, store, summary, authDialog(), createPermanentRoom() (+10 more)

### Community 57 - "Community 57"
Cohesion: 0.07
Nodes (26): 1709ead fix(api): centralize active room ban enforcement, 2d8eac5 test(messaging): lock G20-G23 contracts, cb7ad0e feat(api): fence message delivery cutover, createActiveBanRepository(), crypto, mapActiveBan(), normalizePrincipal(), toMillis() (+18 more)

### Community 58 - "Community 58"
Cohesion: 0.06
Nodes (21): 20fdff5 feat(api): persist static rooms and chat, fs, net, startApiListener(), assert, FakeServer, fs, os (+13 more)

### Community 59 - "Community 59"
Cohesion: 0.06
Nodes (28): createDbPool(), { classifyPlatform, PLATFORM_CLASSES }, { createDbPool, transaction }, createPushStore(), crypto, normalizePlatformClass(), PLATFORM_SIGNAL_METADATA_KEYS, resolvePlatformClass() (+20 more)

### Community 60 - "Community 60"
Cohesion: 0.07
Nodes (24): 7609180 fix(web): harden reaction convergence, ac1c7f4 fix(api): allow safe guest reaction reads, ad596da test(api): prove reaction persistence invariants, ae1827c fix(reactions): converge updates across realtime clients, d43fd78 fix(shared): accept signed reactor cursors, ff08a8e test(api): exercise gate through postgres and network boundaries, createReactionRealtimeAdapter(), registerReactionRoutes() (+16 more)

### Community 61 - "Community 61"
Cohesion: 0.09
Nodes (30): 0ec8255 chore(release): bump version to 2.2.3, 2adaec0 Merge branch 'hotfix/2.2.3-ci', 397400d chore(release): bump version to 2.2.2, 3b6010b Merge branch 'release/2.2.2', 5fa984e Merge tag 'v2.2.2' into develop, bc6c32c Merge tag 'v2.2.3' into develop, cf119b8 fix(api): wait for fresh websocket summary frames, assert (+22 more)

### Community 62 - "Community 62"
Cohesion: 0.08
Nodes (24): recordMediaOldestPending(), createMediaJobRepository(), crypto, JOB_KINDS, mapMediaJob(), MediaJobFenceError, assert, { DEFAULTS, createMediaProcessingWorker, retryDelay } (+16 more)

### Community 63 - "Community 63"
Cohesion: 0.07
Nodes (25): createMembershipRepository(), crypto, mapDirectoryMember(), mapMembership(), toMillis(), registerMembershipRoutes(), { createMembershipRepository }, createMembershipService() (+17 more)

### Community 64 - "Community 64"
Cohesion: 0.12
Nodes (34): attachMediaProjection(), attachReplyProjection(), broadcastDirectLinkPreview(), broadcastRoomLinkPreview(), cleanChatText(), cleanDmText(), dispatchMessageDeliveryEvent(), findRoomBan() (+26 more)

### Community 65 - "Community 65"
Cohesion: 0.12
Nodes (16): fetchReactionSummaries(), fetchReactors(), ReactionConversation, reactionUrl(), setReactionDesired(), validSummaries(), ReactionSnapshotView, replaceReactionSnapshot() (+8 more)

### Community 66 - "Community 66"
Cohesion: 0.08
Nodes (13): AppRealtimeConnection, connectRealtime(), getAppRealtime(), PinsRealtimeEvent, ReactionRealtimeEvent, RealtimeAccountEvent, RealtimeErrorEvent, RealtimeEvent (+5 more)

### Community 67 - "Community 67"
Cohesion: 0.06
Nodes (3): 01a206a chore: release v2.1.1, cce23b6 fix(web): stabilize preview chat identity, ce73d06 fix(web): hotfix lobby dock, preview chat, download, and add-friend flow

### Community 68 - "Community 68"
Cohesion: 0.08
Nodes (21): authorize(), { createGateCredentialSigner }, createMemoryGateStore(), extractCredential(), mint(), readTopologyEvidence(), require, runAuthGateProof() (+13 more)

### Community 69 - "Community 69"
Cohesion: 0.11
Nodes (24): containsPath(), createCoordinatedSnapshot(), filesBelow(), resolvedProspectivePath(), sha256(), 06b943b fix(ops): bind media restore catalog, 1332815 feat(ops): add coordinated media restore, a1d0d15 fix(restore): reject escaping snapshot sources (+16 more)

### Community 70 - "Community 70"
Cohesion: 0.07
Nodes (9): 08e3e13 Merge branch 'hotfix/2.2.1', 17edd27 feat(web): add lobby voice controls widget, 3ce55ad fix(web): dedupe self avatar and drop count label in room list, 52c6592 Merge tag 'v2.2.1' into develop, bd153ef chore(release): bump version to 2.2.1, d52f131 fix(web): restore room topbar spacing in embedded shell, ControlHandler, LeaveHandler (+1 more)

### Community 71 - "Community 71"
Cohesion: 0.08
Nodes (23): 10de220 test(api): prove active ban expiry in PostgreSQL, 177f5e3 test(api): prove durable message delivery, 849600b fix(api): persist membership after admission, 93cad8e test(release): define G42 messaging checkpoint, model, { buildMembershipEnvelope, normalizeMembershipRequest }, createMemberDirectoryService(), presenceForUser() (+15 more)

### Community 72 - "Community 72"
Cohesion: 0.17
Nodes (26): fix/open-in-app-download, 0b7bfc9 feat(web): add a desktop overlay for borderless games (#134), 1ae08e2 chore(release): back-merge 2.5.12 into develop, 253c24d feat(web): overlay avatar size and panel hints (#138), 3ea131d feat(shared): let typing notices say whether someone types or picks an emoji, 3fa3f2e chore(release): back-merge 2.5.10 into develop, 48b24e0 fix: room notifications for all members, desktop badge, unread for new members, 7c03069 Merge pull request #141 from dazeGG/hotfix/2.5.12-backmerge (+18 more)

### Community 73 - "Community 73"
Cohesion: 0.13
Nodes (23): main, 0d5875a fix: close migration dependency audit finding, 1718dc1 Bump version to 1.6.1, 2600ae8 Merge pull request #3 from dazeGG/fix/output-mute-unsubscribe, 2a61534 fix(api): stop the room read writing a column its table does not have, 56ebf7a docs: document root-scoped omx runtime usage, 6895206 fix(web): remove desktop app region from topbar, 69052e3 fix(web): flash the message a notification opens, as a reply jump does (+15 more)

### Community 74 - "Community 74"
Cohesion: 0.09
Nodes (23): 2350242 build(api): define expiry-aware rescue profile, 4ea02ee fix(api): harden temporary moderation flows, 7795005 test(web): cover moderation center contract, api, chat, component, lobby, members (+15 more)

### Community 75 - "Community 75"
Cohesion: 0.09
Nodes (25): clearRoomOccupancyRetries(), clearRoomOccupancyRetry(), createApiApp(), createFastifyLoggerOptions(), fastify, getHistoryServices(), getLogLevel(), getMembershipServices() (+17 more)

### Community 76 - "Community 76"
Cohesion: 0.10
Nodes (11): authUserWithoutSelfFlags, lang, 2a41d55 feat(web): ask guests for an account and browser users for the desktop app, 6cdbcca feat(api): remember desktop app use and the app prompt per account, f4ad50d Merge branch 'feature/guest-account-app-cta' into develop, AppPromptInput, resolveRoomCta(), RoomCtaInput (+3 more)

### Community 77 - "Community 77"
Cohesion: 0.11
Nodes (21): 5d910ea fix(notifications): fail closed on provider errors, cleanPushEndpoint(), crypto, describePushEndpoint(), EXACT_PUSH_HOSTS, isAllowedPushHost(), { cleanPushEndpoint, describePushEndpoint }, createPushService() (+13 more)

### Community 78 - "Community 78"
Cohesion: 0.10
Nodes (14): 09486bf feat(web): open rooms in mobile browsers, 21547ea chore(graphify): rebuild the knowledge graph for mobile rooms, 3d41c9f ci: stop uploading docker build record artifacts, 3d42314 feat(shared): allow the room page on every platform class, 43122ba Merge branch 'fix/docker-actions-node24' into develop, 6783809 Merge branch 'fix/no-dockerbuild-artifacts' into develop, 6b33199 ci: move docker actions to their Node 24 releases, fd1b759 Merge branch 'feature/mobile-room' into develop (+6 more)

### Community 79 - "Community 79"
Cohesion: 0.11
Nodes (18): checkApiSources(), crossDomainTablesFor(), findSqlWrites(), findTimers(), globToRegExp(), isOwner(), normalizePath(), walkFiles() (+10 more)

### Community 80 - "Community 80"
Cohesion: 0.11
Nodes (19): RoomSnapshot, acknowledgeActiveVoiceResync(), clearActiveResync(), detailHandlers, ensureAppRealtimeConnected(), ensureReconnectRestore(), isRetryableActiveResyncError(), joinVoiceRoom() (+11 more)

### Community 81 - "Community 81"
Cohesion: 0.10
Nodes (20): createRuntimeReadinessRepository(), { createDbPool }, { createRuntimeReadinessRepository }, os, startWorkerHeartbeat(), WORKER_CAPABILITIES, assert, { createReadinessReport } (+12 more)

### Community 82 - "Community 82"
Cohesion: 0.13
Nodes (12): 1b46251 fix(web): fit the image viewer, tighten the picker, ping on mention only, 2207473 fix(web): make the tone strip reachable and settle the DM thread before showing it, 2bb0df7 feat(web): give images a real viewer, and open pending ones in it, 84ba47a feat(web): rebuild the notification centre, and retire notifications on read, 9c1c7df Merge branch 'feature/2.5.0-fixes' into develop, a0dac33 Merge branch 'feature/2.5.0-fixes' into develop, c22c49a Merge branch 'feature/2.5.0-fixes' into develop, e9bf7d5 feat(web): make a mention name a person you can act on (+4 more)

### Community 83 - "Community 83"
Cohesion: 0.15
Nodes (22): clearAllPeerJoinCues(), clearPeerJoinCue(), clearStreamViewerCues(), CueNote, getCueGain(), isCuePlaybackSuppressed(), peerJoinCueTimes, playCueSequence() (+14 more)

### Community 84 - "Community 84"
Cohesion: 0.10
Nodes (11): registerMediaRoutes(), assert, { createMediaVisibilityService }, fastify, { registerMediaRoutes }, test, assert, createApp() (+3 more)

### Community 85 - "Community 85"
Cohesion: 0.10
Nodes (18): path, socketPathForDirectory(), assert, { createApiServer }, createFriends(), createModerationStore(), createUsers(), crypto (+10 more)

### Community 87 - "Community 87"
Cohesion: 0.09
Nodes (14): ReadReconciliationOptions, b3732be fix(notifications): make inbox revisions monotonic, model, router, ui, inbox, reconcile, room (+6 more)

### Community 88 - "Community 88"
Cohesion: 0.16
Nodes (21): addDesktopOverlayGame(), DEFAULT_SETTINGS, desktopOverlayAvailable(), DesktopOverlayForeground, DesktopOverlayParticipant, DesktopOverlayPatch, DesktopOverlaySettings, getBridge() (+13 more)

### Community 89 - "Community 89"
Cohesion: 0.12
Nodes (16): acceptFirstRequest(), assert, befriend(), cookieFrom(), { createTestDatabase }, fs, http, { openWs, waitForWsType } (+8 more)

### Community 90 - "Community 90"
Cohesion: 0.11
Nodes (15): acceptFirstRequest(), assert, befriend(), cookieFrom(), { createTestDatabase }, fs, http, { joinVoiceRoom, openWs: openHarnessWs, subscribeRoomPreview, waitForWsType } (+7 more)

### Community 91 - "Community 91"
Cohesion: 0.15
Nodes (8): conversationKey(), createReplyStore(), normalizeTarget(), ReplyAuthor, ReplyConversation, ReplySendInput, ReplyStore, ReplyTarget

### Community 92 - "Community 92"
Cohesion: 0.12
Nodes (16): 0b4c646 feat(platform): enforce G14 capability readiness, createCapabilitySnapshot(), formatCapabilityPayload(), HEALTH_CAPABILITIES_LIMITS, { PUBLIC_CAPABILITY_KEYS }, publicFeatureFlags(), registerCapabilityRoutes(), assert (+8 more)

### Community 93 - "Community 93"
Cohesion: 0.11
Nodes (16): 40320f3 fix(release): authenticate oci evidence producers, 6b3fc40 fix(release): require canonical merge commit authority, 760fdfe fix(api): remediate oversized attachments before validation, 88169aa fix(api): preserve migration history with corrective follow-ups, assert, BYTE_LIMIT_ROLLBACK_COUNT, { createAttachmentRepository }, { createTestDatabase } (+8 more)

### Community 94 - "Community 94"
Cohesion: 0.19
Nodes (18): asSet(), buildNodeMap(), compareReplicas(), createReadinessProvider(), crypto, evaluateFromOptions(), evaluatePublicNode(), evaluateRawManifest() (+10 more)

### Community 95 - "Community 95"
Cohesion: 0.12
Nodes (14): assert, buildApp(), { createApiApp, createApiServer }, createFakeFriends(), createFakeStore(), createFakeUsers(), fs, http (+6 more)

### Community 96 - "Community 96"
Cohesion: 0.15
Nodes (14): CapabilityFeatures, CapabilityKey, CapabilityResponse, isCapabilityReady(), loadCapabilities(), resetCapabilities(), CapabilityEdge, CapabilityState (+6 more)

### Community 98 - "Community 98"
Cohesion: 0.17
Nodes (18): { AccessToken, TrackSource }, assertCase(), { createDbPool }, { createGateCredentialSigner }, { createRoomStore }, directLocalhostPortClosed(), mintCredentials(), openWebSocket() (+10 more)

### Community 99 - "Community 99"
Cohesion: 0.13
Nodes (12): actorLockKey(), boundedString(), createMessageIdempotencyRepository(), crypto, encodeParts(), IdempotencyConflictError, IdempotencyQuotaError, ledgerKey() (+4 more)

### Community 100 - "Community 100"
Cohesion: 0.20
Nodes (16): flipPlacementVertical(), parsePlacement(), resolvePopoverPlacement(), viewportSpaceAroundTrigger(), PlacementAxis, PopoverCloseReason, PopoverContentState, PopoverDividerProps (+8 more)

### Community 102 - "Community 102"
Cohesion: 0.16
Nodes (16): buildModerationPage(), cleanString(), durationToExpiresAt(), MODERATION_DURATION_MS, MODERATION_DURATIONS, normalizeActiveBan(), normalizeBanDuration(), normalizeBanMutation() (+8 more)

### Community 103 - "Community 103"
Cohesion: 0.13
Nodes (17): assert, cookieFrom(), { createTestDatabase }, fs, getSocketPath(), http, me(), { openWs } (+9 more)

### Community 104 - "Community 104"
Cohesion: 0.11
Nodes (17): assert, { createLinkPreviewRepository }, { createLinkPreviewStorage, reconcileLinkPreviewImages }, { createRoomStore }, { createTestDatabase }, { createUserStore }, crypto, EXPECTED_PREVIEW (+9 more)

### Community 105 - "Community 105"
Cohesion: 0.11
Nodes (12): assert, { createTestDatabase }, fs, http, { openWs, joinVoiceRoom, sendWs, waitForWsType }, os, path, { socketPathForDirectory } (+4 more)

### Community 106 - "Community 106"
Cohesion: 0.18
Nodes (14): deleteModeratedMessage(), fetchActiveBans(), parsePage(), putBan(), responseJson(), roomModerationUrl(), unban(), BAN_DURATIONS (+6 more)

### Community 108 - "Community 108"
Cohesion: 0.19
Nodes (15): 2600555 fix(api): bound direct typing state and declare the account purge writer, 333182d chore(graphify): rebuild the knowledge graph for the typing throttle, 4e52553 Merge branch 'feature/composer-emoji-picker' into develop, 8c60e5d fix(api): deliver a typing activity switch instead of dropping it, d523ff1 chore(release): back-merge 2.6.0 into develop, createTypingThrottle(), { buildServerEnvelope, buildServerErrorEnvelope, parseInboundMessage }, { createTypingThrottle } (+7 more)

### Community 109 - "Community 109"
Cohesion: 0.12
Nodes (13): BLOCKED_SUBNETS, createLinkPreviewFetcher(), dns, http, https, isPublicAddress(), net, REDIRECT_STATUSES (+5 more)

### Community 110 - "Community 110"
Cohesion: 0.15
Nodes (14): buildNotificationEnvelope(), buildProviderPayload(), cleanString(), normalizeNotificationEnvelope(), normalizeNotificationItem(), NOTIFICATION_LEVEL_SET, NOTIFICATION_LEVELS, NOTIFICATION_REASON_SET (+6 more)

### Community 111 - "Community 111"
Cohesion: 0.14
Nodes (16): assert, cookieFrom(), { createTestDatabase }, fs, http, me(), { openWs, waitForWsType }, os (+8 more)

### Community 112 - "Community 112"
Cohesion: 0.11
Nodes (11): assert, { createTestDatabase }, fs, http, { openWs, joinVoiceRoom, subscribeRoomPreview, waitForWsType }, os, path, { socketPathForDirectory } (+3 more)

### Community 113 - "Community 113"
Cohesion: 0.11
Nodes (12): assert, { createPinRepository }, { createPinService }, { createRoomStore }, { createTestDatabase }, { createUserStore }, Fastify, { Pool } (+4 more)

### Community 114 - "Community 114"
Cohesion: 0.11
Nodes (12): assert, { createTestDatabase }, fs, http, { openWs, sendWs, joinVoiceRoom, waitForWsType, countWsType }, os, path, { socketPathForDirectory } (+4 more)

### Community 115 - "Community 115"
Cohesion: 0.23
Nodes (15): FetchMembershipsOptions, fetchRoomMemberships(), leaveRoomMembership(), applyRoomVoicePeers(), cacheKey(), clearRoomMembership(), emptyEntry(), getRoomMembership() (+7 more)

### Community 116 - "Community 116"
Cohesion: 0.18
Nodes (12): fetchRoomPins(), pinAuthor(), PinnedMessage, PinnedMessageAuthor, PinResponse, pinRoomMessage(), PinSnapshot, pinUrl() (+4 more)

### Community 117 - "Community 117"
Cohesion: 0.15
Nodes (6): a2ee398 test(api): prove messaging pagination and reads, d8e3847 test(web): prove messaging reconciliation flows, FakeBroadcastChannel, loadMessagingModule(), require, ts

### Community 118 - "Community 118"
Cohesion: 0.18
Nodes (14): clean(), decodeEntities(), decodeHtmlBody(), extractLinkPreviewMetadata(), NAMED_ENTITIES, parseAttributes(), resolveHttpUrl(), createLinkPreviewService() (+6 more)

### Community 119 - "Community 119"
Cohesion: 0.16
Nodes (14): cleanUpstreamUrl(), { createCredentialBoundaryService }, { createDbPool }, { createGateCredentialSigner }, createLiveKitAuthGateService(), { createRoomStore }, deny(), destroySocket() (+6 more)

### Community 120 - "Community 120"
Cohesion: 0.28
Nodes (15): DEFAULT_FREQUENT_REACTIONS, FrequentReaction, frequentReactionKey(), loadFrequentReactions(), localStorageKey(), memory, normalizeEntries(), openDatabase() (+7 more)

### Community 121 - "Community 121"
Cohesion: 0.20
Nodes (12): clearDisconnectedHiddenEmbed(), clearViewedRoom(), connectedRoomIsViewed(), embeddedRoomIsVisible(), getActiveVoiceRoomId(), openActiveVoiceRoom(), roomNavigation, RoomShellMode (+4 more)

### Community 122 - "Community 122"
Cohesion: 0.16
Nodes (13): BrowserIdleDetector, BrowserIdleDetectorConstructor, createPresenceIdleController(), DesktopIdleBridge, DesktopIdleScope, EventTarget, getDesktopIdleSecondsReader(), hasGrantedBrowserIdlePermission() (+5 more)

### Community 123 - "Community 123"
Cohesion: 0.16
Nodes (16): closePeer(), getCredentialBoundary(), getLiveKitConfig(), getLiveKitCredentialProvider(), getLiveKitHttpUrl(), getLiveKitRoomName(), handleLiveKitToken(), publishClearedScreenViewers() (+8 more)

### Community 124 - "Community 124"
Cohesion: 0.13
Nodes (4): DeniedNotification, FakeNotification, require, ts

### Community 125 - "Community 125"
Cohesion: 0.15
Nodes (2): ContextMenuContentState, ContextMenuProps

### Community 126 - "Community 126"
Cohesion: 0.17
Nodes (10): createMessageService(), { createMessageVisibilityService }, createMessageVisibilityService(), MessageVisibilityError, assert, { createMessageService }, { createMessageVisibilityService }, fs (+2 more)

### Community 127 - "Community 127"
Cohesion: 0.15
Nodes (10): toWsAccountEvent(), buildRoomMembershipPresenceSnapshot(), { buildServerEnvelope, sendWsEnvelope }, { cleanPresenceStatus }, createConnectionRegistry(), crypto, { toWsAccountEvent }, assert (+2 more)

### Community 128 - "Community 128"
Cohesion: 0.23
Nodes (11): accessibleName(), assertAccessibleName(), assertFocusOrder(), assertKeyboardActivation(), assertLiveRegion(), assertReducedMotionEnabled(), assertStableLayout(), text() (+3 more)

### Community 129 - "Community 129"
Cohesion: 0.21
Nodes (10): INTERNAL_NODE_KEYS, isManifestValid(), isObject(), normalizeInternalNode(), normalizeManifest(), normalizeOperatorNode(), normalizePublicNode(), OPERATOR_KEYS (+2 more)

### Community 130 - "Community 130"
Cohesion: 0.13
Nodes (11): assert, { createTestDatabase }, { createUserStore }, crypto, fs, MIGRATIONS_DIR, path, { Pool } (+3 more)

### Community 131 - "Community 131"
Cohesion: 0.13
Nodes (9): assert, { createTestDatabase }, fs, http, os, path, { socketPathForDirectory }, { spawn } (+1 more)

### Community 132 - "Community 132"
Cohesion: 0.14
Nodes (12): assert, { countWsType, joinVoiceRoom, openWs, sendWs, subscribeRoomPreview, waitForWsType }, { createTestDatabase }, fs, http, os, path, { socketPathForDirectory } (+4 more)

### Community 133 - "Community 133"
Cohesion: 0.14
Nodes (13): assert, { createTestDatabase }, crypto, fs, MIGRATIONS_DIR, path, { Pool }, { runMigrations } (+5 more)

### Community 134 - "Community 134"
Cohesion: 0.22
Nodes (8): DesktopAsset, DesktopRelease, fetchDesktopRelease(), DESKTOP_BUILDS, DesktopBuild, detectDesktopBuildId(), startDesktopBuildDownload(), triggerDesktopDownload()

### Community 135 - "Community 135"
Cohesion: 0.22
Nodes (12): deletePushSubscription(), fetchPushConfig(), savePushSubscription(), decodeVapidKey(), detachPushSubscription(), getRegistration(), isDesktopRuntime(), isPushSuppressedByPlatform() (+4 more)

### Community 136 - "Community 136"
Cohesion: 0.15
Nodes (13): 2ca6443 test(shared): lock platform classification contract, 69b709a test(shared): correct platform DTO assertion, 88e8e93 test(release): define physical support matrix gate, b318c49 test(web): prove desktop root boundary, c4b1a22 test(api): enforce exact migration lock budget, edf6daf test(api): prove platform class migration, assert, cjs (+5 more)

### Community 137 - "Community 137"
Cohesion: 0.16
Nodes (12): a0fa2d6 feat(api): drive room shared-music sessions, edcdda0 feat(music-bot): add the shared-music bot backed by yt-dlp, createTransportId(), createWsTransport(), crypto, { buildRoomRealtimeSummaryFromLobbyRoom, createSummaryCoalescer }, { buildServerEnvelope, buildServerErrorEnvelope }, { createTypingThrottle } (+4 more)

### Community 138 - "Community 138"
Cohesion: 0.19
Nodes (10): createGeoLocator(), formatLocation(), fs, namesOf(), net, placeName(), assert, { createGeoLocator } (+2 more)

### Community 139 - "Community 139"
Cohesion: 0.19
Nodes (11): DesktopNotificationPayload, BridgeResult, DesktopBridge, resolveBridge(), showDesktopNotification(), browserNavigator(), classifyPlatform(), classifyPlatformPolicy() (+3 more)

### Community 140 - "Community 140"
Cohesion: 0.15
Nodes (9): clearViewedScreenPeerReferences(), resolveViewedScreenPeerId(), assert, {
  clearViewedScreenPeerReferences,
  createRoomRealtimeRuntime,
  resolveViewedScreenPeerId
}, createLeaseRuntime(), createRuntime(), OWNER_TOKEN, test (+1 more)

### Community 141 - "Community 141"
Cohesion: 0.15
Nodes (10): createWsHandler(), assert, createHandler(), createRegistry(), { createWsHandler }, { EventEmitter }, FakeSocket, test (+2 more)

### Community 142 - "Community 142"
Cohesion: 0.14
Nodes (8): assert, { createRoomStore }, { createTestDatabase }, { createUserStore }, crypto, { Pool }, { runMigrations }, test

### Community 143 - "Community 143"
Cohesion: 0.21
Nodes (12): DirectMessage, ActiveResync, contentVersion(), createDmThreadResyncCoordinator(), mergeMessage(), newestTimestamp(), replayMutations(), ResyncRequestOptions (+4 more)

### Community 144 - "Community 144"
Cohesion: 0.22
Nodes (7): PublicUser, formatTime(), pad(), formatChatDayLabel(), isSameDay(), MONTHS, startOfDay()

### Community 145 - "Community 145"
Cohesion: 0.29
Nodes (12): ChatDraft, ChatDraftScope, chatDraftScopeKey(), chatDraftStorageKey(), clearChatDrafts(), loadChatDraft(), normalizeChatDrafts(), normalizeMentions() (+4 more)

### Community 146 - "Community 146"
Cohesion: 0.19
Nodes (6): 3c7c561 chore(graphify): rebuild the knowledge graph for the open-in-app download, 873c452 fix(web): offer the desktop download on the open-in-app screen, ffe7a0b Merge branch 'fix/open-in-app-download' into develop, getServer(), loadModule(), webRoot

### Community 148 - "Community 148"
Cohesion: 0.21
Nodes (9): createProofOfWork(), crypto, hasLeadingZeroBits(), normalizePowNonce(), parsePowChallenge(), assert, crypto, {
  hasLeadingZeroBits,
  parsePowChallenge,
  normalizePowNonce,
  createProofOfWork
} (+1 more)

### Community 149 - "Community 149"
Cohesion: 0.28
Nodes (11): applyDesktopBoundaryToDocument(), getDesktopBoundaryPolicy(), hasDesktopBridge(), isDesktopBoundaryAllowed(), isDesktopBoundaryBlocked(), isRealtimeBlocked(), isRoomClientAllowed(), NavigatorWithUserAgentData (+3 more)

### Community 150 - "Community 150"
Cohesion: 0.26
Nodes (11): cacheKey(), configCache, defaultConfig(), fetchRuntimeConfig(), hasSuspiciousSecrets(), loadRuntimeConfig(), resolveConfigOrigin(), resolveConfigUrl() (+3 more)

### Community 151 - "Community 151"
Cohesion: 0.31
Nodes (11): clamp(), deriveAvatarAccent(), fitChromaToSrgb(), isInSrgbGamut(), linearToSrgb(), normalizeChannel(), oklchToHex(), oklchToLinearRgb() (+3 more)

### Community 152 - "Community 152"
Cohesion: 0.21
Nodes (10): cleanText(), firstPreviewableUrl(), normalizeImage(), normalizeLinkPreview(), toPreviewUrl(), assert, path, { pathToFileURL } (+2 more)

### Community 153 - "Community 153"
Cohesion: 0.27
Nodes (12): buildHistoryEnvelope(), cleanString(), getReadCursorFromMessage(), HISTORY_MODE_SET, HISTORY_MODES, isObject(), isOpaqueCursor(), MESSAGE_KIND_SET (+4 more)

### Community 154 - "Community 154"
Cohesion: 0.26
Nodes (11): cleanHttpUrl(), cleanString(), contentFromLegacyText(), normalizeRoomMessageContent(), normalizeSegment(), projectKnownContent(), projectRoomMessageContent(), utf8ByteLength() (+3 more)

### Community 155 - "Community 155"
Cohesion: 0.28
Nodes (11): DEFAULT_RUNTIME_CONFIG, getRuntimeConfig(), inheritLiveKitGateCredential(), normalizeLiveKitServerUrl(), normalizeLiveKitUrl(), normalizePayload(), parseRuntimeConfig(), resolveLiveKitConnectUrls() (+3 more)

### Community 156 - "Community 156"
Cohesion: 0.15
Nodes (10): assert, { createTestDatabase }, { createUserStore }, crypto, { Pool }, { RECOVERY_CODES_ONBOARDING_KEY, normalizeRecoveryCode }, {
  RECOVERY_CODES_REMINDER_SNOOZE_MS,
  WHATS_NEW_VERSION,
  normalizeRecoveryCode
}, { runMigrations } (+2 more)

### Community 157 - "Community 157"
Cohesion: 0.15
Nodes (11): assert, { createApiApp }, { createGateCredentialSigner }, { createLiveKitAuthGateService, extractCredential }, { EventEmitter }, fs, net, path (+3 more)

### Community 158 - "Community 158"
Cohesion: 0.15
Nodes (10): assert, crypto, {
  EMOJI_REACTION_AUTHORITY,
  assertReactionEmoji,
  cleanReactionEmoji,
  isReactionEmoji,
  listReactionEmojis
}, fs, PACKAGE_JSON, path, { pathToFileURL }, ROOT (+2 more)

### Community 159 - "Community 159"
Cohesion: 0.15
Nodes (10): ADMISSION_INTERNAL_COVERAGE_SCRIPT, { createGateCredentialSigner }, { createLiveKitAuthGateService, extractCredential }, { createRoomRealtimeRuntime }, { createRoomStore }, greenSummary, require, SERVER_INTERNAL_COVERAGE_SCRIPT (+2 more)

### Community 160 - "Community 160"
Cohesion: 0.15
Nodes (7): assert, http, { openWs, joinVoiceRoom, sendWs, waitForWsType }, { __private, createApiServer }, test, openWs(), WebSocket

### Community 162 - "Community 162"
Cohesion: 0.18
Nodes (6): PLURAL_VERB, SINGLE_VERB, TYPING_ACTIVITIES, TypingActivity, TypingEntry, TypingPerson

### Community 163 - "Community 163"
Cohesion: 0.17
Nodes (10): 166a0e8 test(release): resolve rescue fixtures from repository root, 5dd3691 test(api): serialize database suites, bf6bba7 test(api): cover media backlog age query, f540886 test(release): refresh CI gate fixtures, assert, fs, path, profile (+2 more)

### Community 164 - "Community 164"
Cohesion: 0.23
Nodes (10): { cleanAvatarColorKey, cleanPresenceStatus }, { createDbPool, transaction }, crypto, lockUserPair(), mapInvite(), mapMessage(), mapPublicUser(), { normalizeLinkPreview } (+2 more)

### Community 165 - "Community 165"
Cohesion: 0.17
Nodes (10): createReadinessReport(), assert, { createReadinessReport }, fs, path, { readMessageDeliveryMode }, { test }, assert (+2 more)

### Community 167 - "Community 167"
Cohesion: 0.21
Nodes (1): ScreenRecoveryGraceController

### Community 168 - "Community 168"
Cohesion: 0.24
Nodes (9): attachmentTextFallback(), MIME_TYPES, normalizeAttachment(), normalizeAttachments(), STATES, text(), assert, { MAX_ATTACHMENT_BYTES, attachmentTextFallback, normalizeAttachment, normalizeAttachments } (+1 more)

### Community 169 - "Community 169"
Cohesion: 0.17
Nodes (12): attachPresence(), bootstrap(), createApiServer(), getPresenceRoom(), getRoom(), handleRoomChatList(), handleRoomPeers(), handleRoomStatus() (+4 more)

### Community 170 - "Community 170"
Cohesion: 0.24
Nodes (10): hasSurfaceToken(), isAllowedBackground(), lineAt(), paletteViolations(), root, sourceFiles(), sourceRoot, styleFragments() (+2 more)

### Community 171 - "Community 171"
Cohesion: 0.27
Nodes (8): attachmentRevoker(), cleanupEnqueuer(), createMessageModerationService(), requireOperation(), { transaction }, assert, { createMessageModerationService }, test

### Community 172 - "Community 172"
Cohesion: 0.53
Nodes (10): buildMessageDeliveryEvent(), cleanString(), DELIVERY_EVENT_TYPES, isObject(), isSystemCard(), normalizeConversation(), normalizeIdempotency(), normalizeReplyPointer() (+2 more)

### Community 173 - "Community 173"
Cohesion: 0.18
Nodes (9): assert, { Client }, { createTestDatabase }, fs, NEW_TABLES, path, { runMigrations }, SILENT (+1 more)

### Community 174 - "Community 174"
Cohesion: 0.22
Nodes (8): apps/CLAUDE.md, docs/GIT_FLOW.md, .github CLAUDE.md Policy, Pull Request Template, docs/RELEASE_<version>_PLAN.md, Root CLAUDE.md, Room client architecture (ARCHITECTURE.md), apps/web/CLAUDE.md

### Community 175 - "Community 175"
Cohesion: 0.27
Nodes (8): BROWSABLE_EMOJIS, BROWSABLE_SET, EmojiCategory, hasSkinToneChoices(), isOfferedEmoji(), OFFERED, skinToneChoices(), withSkinTone()

### Community 176 - "Community 176"
Cohesion: 0.27
Nodes (7): createMediaMaintenanceService(), assert, { createMediaMaintenanceService }, { createMediaMaintenanceWorker }, test, createMediaMaintenanceWorker(), main()

### Community 177 - "Community 177"
Cohesion: 0.22
Nodes (5): buildAppRoomLink(), markInAppRoomNavigation(), OpenInAppSignals, PRODUCTION_HOSTS, resolveAppLinkScheme()

### Community 178 - "Community 178"
Cohesion: 0.22
Nodes (8): createRoomRealtimeRuntime(), { buildRoomRealtimeSummary }, buildRoomRealtimeSummaryFromLobbyRoom(), createSummaryCoalescer(), assert, { buildRoomRealtimeSummaryFromLobbyRoom }, { createRoomRealtimeRuntime }, test

### Community 179 - "Community 179"
Cohesion: 0.36
Nodes (9): buildMembershipEnvelope(), cleanString(), isObject(), MEMBERSHIP_ROLE_SET, MEMBERSHIP_ROLES, normalizeMembershipEnvelope(), normalizeMembershipLimit(), normalizeMembershipMember() (+1 more)

### Community 180 - "Community 180"
Cohesion: 0.22
Nodes (3): configure(), deferred(), MemoryStorage

### Community 181 - "Community 181"
Cohesion: 0.20
Nodes (5): assert, { createLiveKitAuthGateService }, { EventEmitter }, net, test

### Community 182 - "Community 182"
Cohesion: 0.22
Nodes (9): assert, commonJs, fs, invoke(), packageJson, path, { pathToFileURL }, snapshot() (+1 more)

### Community 183 - "Community 183"
Cohesion: 0.28
Nodes (5): BlockStatus, blockUrl(), blockUser(), unblockUser(), getJsonAuth()

### Community 185 - "Community 185"
Cohesion: 0.31
Nodes (8): buildTrie(), codePoints(), EmojiTextPart, hasEmoji(), matchAt(), splitEmoji(), TRIE, TrieNode

### Community 186 - "Community 186"
Cohesion: 0.25
Nodes (4): 924295b test(web): prove G13 against pinned Caddy, a37d685 test(web): make G13 paths workspace-safe, fdb6786 test(api): make G14 paths workspace-safe, repositoryRoot

### Community 189 - "Community 189"
Cohesion: 0.22
Nodes (7): bans, chatPanel, lobbyRoomSettings, members, model, roomSettings, root

### Community 190 - "Community 190"
Cohesion: 0.25
Nodes (1): RealtimeHeartbeatWatchdog

### Community 191 - "Community 191"
Cohesion: 0.32
Nodes (5): createRateLimiter(), getClientIp(), assert, { getClientIp, createRateLimiter }, test

### Community 192 - "Community 192"
Cohesion: 0.43
Nodes (7): desktopAutostartAvailable(), DesktopAutostartPatch, DesktopAutostartSettings, getBridge(), normalizeSettings(), readDesktopAutostartSettings(), updateDesktopAutostartSettings()

### Community 193 - "Community 193"
Cohesion: 0.36
Nodes (7): bindDesktopCallActions(), CALL_ACTIONS, DesktopCallAction, DesktopCallState, getBridge(), syncDesktopCallState(), toPayload()

### Community 194 - "Community 194"
Cohesion: 0.29
Nodes (6): { buildServerEnvelope }, legacyPeerMessageToWs(), assert, { legacyPeerMessageToWs }, test, { toWsAccountEvent }

### Community 195 - "Community 195"
Cohesion: 0.32
Nodes (4): getServer(), loadDrafts(), memoryStorage(), webRoot

### Community 196 - "Community 196"
Cohesion: 0.29
Nodes (4): getServer(), loadTyping(), require, webRoot

### Community 197 - "Community 197"
Cohesion: 0.25
Nodes (3): FakeWebSocket, require, ts

### Community 198 - "Community 198"
Cohesion: 0.25
Nodes (6): assert, metricsPath, path, serverPath, { spawn }, test

### Community 199 - "Community 199"
Cohesion: 0.33
Nodes (4): fingerprint(), SendShadow, SendShadowState, stableJson()

### Community 200 - "Community 200"
Cohesion: 0.48
Nodes (7): docs/CLAUDE.md governance rules, VoiceRoom 2.5.0 consolidated execution plan, Git Flow workflow, VoiceRoom 2.5.0 unified messaging platform PRD, Release 2.4.0 verification plan, Release 2.4.1 verification plan, Release 2.4.2 hotfix verification plan

### Community 201 - "Community 201"
Cohesion: 0.43
Nodes (5): createPinService(), normalizeMessageId(), normalizeRoomId(), PinServiceError, requireAccount()

### Community 202 - "Community 202"
Cohesion: 0.33
Nodes (3): CONTEXT_TABLES, createReactionRepository(), requireQuery()

### Community 203 - "Community 203"
Cohesion: 0.29
Nodes (3): { createDbPool }, createRoomHistoryRepository(), { normalizeLinkPreview }

### Community 204 - "Community 204"
Cohesion: 0.48
Nodes (6): copyDesktopDiagnostics(), desktopDiagnosticsAvailable(), DesktopDiagnosticsContext, getBridge(), openDesktopLogsFolder(), syncDesktopDiagnosticsContext()

### Community 205 - "Community 205"
Cohesion: 0.33
Nodes (5): { createReadinessReport, resolveManifestPath }, createRuntimeReadinessProvider(), { createRuntimeReadinessRepository }, failClosedSnapshot(), { PUBLIC_CAPABILITY_KEYS }

### Community 206 - "Community 206"
Cohesion: 0.29
Nodes (6): CapabilityInternalNode, CapabilityManifest, CapabilityOperatorNode, CapabilityPublicNode, CapabilityReplicaConsensus, CapabilityRequires

### Community 207 - "Community 207"
Cohesion: 0.29
Nodes (6): ConversationRef, IdempotencyDescriptor, MessageDeliveryEvent, ReplyPointer, ReplyPreview, SendEnvelope

### Community 208 - "Community 208"
Cohesion: 0.29
Nodes (6): ClientEnvelope, RoomPeerSummary, RoomRealtimeSummary, RoomTypist, ServerEnvelope, TypingActivity

### Community 209 - "Community 209"
Cohesion: 0.33
Nodes (3): DEFAULT_OPTIONS, getSmoothingCoefficient(), VoiceRoomNoiseGateProcessor

### Community 210 - "Community 210"
Cohesion: 0.29
Nodes (4): assert, { __private, createApiApp }, test, { TrackSource }

### Community 211 - "Community 211"
Cohesion: 0.38
Nodes (5): FOCUSABLE_SELECTOR, focusInitialElement(), FocusTrapOptions, getFocusableElements(), isHTMLElement()

### Community 212 - "Community 212"
Cohesion: 0.60
Nodes (5): ChatMessage, mentionProfilePerson(), participantProfilePerson(), presenceFor(), roomMessageProfilePerson()

### Community 213 - "Community 213"
Cohesion: 0.33
Nodes (6): Desktop Support Matrix Doc (G19), Release 2.5.0 Durable Evidence Archive Doc (G03), Coordinated Media Backup and Restore Doc, Release 2.5.0 Budgets Doc (G91), Release 2.5.0 Develop Entry Doc (G93), Release 2.5.0 RC Preflight Doc

### Community 214 - "Community 214"
Cohesion: 0.60
Nodes (4): iconLg, iconMd, iconSm, iconXs

### Community 215 - "Community 215"
Cohesion: 0.53
Nodes (5): countUnreadForBadge(), DesktopBadgeInput, getBridge(), positive(), syncDesktopBadgeCount()

### Community 216 - "Community 216"
Cohesion: 0.47
Nodes (5): bindDesktopLinks(), DesktopLink, getBridge(), matches(), normalizeDesktopLink()

### Community 217 - "Community 217"
Cohesion: 0.33
Nodes (1): LiveKitReconcileGeneration

### Community 218 - "Community 218"
Cohesion: 0.40
Nodes (2): o, s()

### Community 219 - "Community 219"
Cohesion: 0.33
Nodes (2): participantContextMenu, ParticipantMenuVariant

### Community 220 - "Community 220"
Cohesion: 0.33
Nodes (5): ActiveBan, ActiveBanProfile, BanMutation, ModerationDuration, ModerationPage

### Community 221 - "Community 221"
Cohesion: 0.53
Nodes (5): classifyPlatform(), classifyPlatformPolicy(), normalizedString(), PLATFORM_CLASSES, platformPolicy()

### Community 222 - "Community 222"
Cohesion: 0.33
Nodes (5): RoomMessageContentV1, RoomMessageLinkSegmentV1, RoomMessageMentionSegmentV1, RoomMessageSegmentV1, RoomMessageTextSegmentV1

### Community 223 - "Community 223"
Cohesion: 0.40
Nodes (5): loadRoomRealtime(), moduleUrl(), require, root, ts

### Community 224 - "Community 224"
Cohesion: 0.40
Nodes (3): getServer(), loadEmojiText(), webRoot

### Community 225 - "Community 225"
Cohesion: 0.60
Nodes (4): isToneIndex(), loadSkinTone(), saveSkinTone(), SkinToneIndex

### Community 226 - "Community 226"
Cohesion: 0.40
Nodes (5): Expiry-Aware Rescue Profile Doc (G85), Predeploy Migrations Doc, Release 2.6.0 Plan — Engagement & Notifications (Superseded), Release 2.7.0 Plan — Media & Moderation (Superseded), VoiceRoom 2.5.0 Unified — Verification and Release Evidence Specification

### Community 227 - "Community 227"
Cohesion: 0.60
Nodes (4): createPinRepository(), mapPin(), requireQuery(), toMillis()

### Community 228 - "Community 228"
Cohesion: 0.50
Nodes (2): applyRoomSwitchDecision(), writeRoomSwitchConfirmEnabled()

### Community 229 - "Community 229"
Cohesion: 0.40
Nodes (2): createMentionRepository(), crypto

### Community 230 - "Community 230"
Cohesion: 0.50
Nodes (4): {
  parseClientEnvelope,
  buildServerEnvelope,
  buildServerErrorEnvelope,
  validateClientCommand
}, parseInboundMessage(), sendWsEnvelope(), serializeEnvelope()

### Community 231 - "Community 231"
Cohesion: 0.40
Nodes (5): baseHeaders(), getLinkPreviewStorage(), getLiveKitConnectSources(), handleGetAvatar(), handleGetLinkPreviewImage()

### Community 232 - "Community 232"
Cohesion: 0.50
Nodes (1): VoiceRoomDesktopAudioSourceProcessor

### Community 233 - "Community 233"
Cohesion: 0.40
Nodes (1): FakeSocket

### Community 234 - "Community 234"
Cohesion: 0.40
Nodes (1): FakeSocket

### Community 235 - "Community 235"
Cohesion: 0.40
Nodes (4): assert, fs, path, { test }

### Community 236 - "Community 236"
Cohesion: 0.40
Nodes (4): assert, fs, path, test

### Community 237 - "Community 237"
Cohesion: 0.40
Nodes (1): FakeSocket

### Community 238 - "Community 238"
Cohesion: 0.50
Nodes (3): desktop, router, sw

### Community 239 - "Community 239"
Cohesion: 0.67
Nodes (3): crypto, processLinkPreviewImage(), sharp

### Community 240 - "Community 240"
Cohesion: 0.50
Nodes (1): registerModerationRoutes()

### Community 241 - "Community 241"
Cohesion: 0.50
Nodes (2): extensions, files

### Community 242 - "Community 242"
Cohesion: 0.83
Nodes (3): cleanId(), mentionUserIdsFromContent(), normalizeMentionUserIds()

### Community 243 - "Community 243"
Cohesion: 1.00
Nodes (2): VoiceRoom App Icon (Owl Mascot Mark on Dark Rounded Square), VoiceRoom Mascot Mark (Masked Owl Silhouette, Transparent)

### Community 244 - "Community 244"
Cohesion: 1.00
Nodes (1): ADR: Unicode authority for message reactions

### Community 245 - "Community 245"
Cohesion: 1.00
Nodes (1): VoiceRoom 2.5 Architecture Boundaries

### Community 246 - "Community 246"
Cohesion: 1.00
Nodes (1): Backlog

### Community 247 - "Community 247"
Cohesion: 1.00
Nodes (1): config/capability-dag.v1.json

### Community 248 - "Community 248"
Cohesion: 1.00
Nodes (1): Capability Readiness Doc

### Community 249 - "Community 249"
Cohesion: 1.00
Nodes (1): Design QA — reusable room and chat menus

### Community 250 - "Community 250"
Cohesion: 1.00
Nodes (1): Font Assets README

### Community 251 - "Community 251"
Cohesion: 1.00
Nodes (1): LiveKit External Auth-Gate Operations Doc (G05)

### Community 252 - "Community 252"
Cohesion: 1.00
Nodes (1): VoiceRoom monitoring agent

### Community 253 - "Community 253"
Cohesion: 1.00
Nodes (1): OCI Runtime Publication Doc

### Community 254 - "Community 254"
Cohesion: 1.00
Nodes (1): packages/CLAUDE.md Guidance

### Community 255 - "Community 255"
Cohesion: 1.00
Nodes (1): Production Digest Promotion Doc

### Community 256 - "Community 256"
Cohesion: 1.00
Nodes (1): Release 2.5.0 Repairs README

## Knowledge Gaps
- **1807 isolated node(s):** `crypto`, `{ transaction }`, `{ verifyPassword }`, `{
  ACCOUNT_DELETION_GRACE_MS,
  DELETED_ACCOUNT_NAME,
  DELETED_LOGIN_PREFIX
}`, `PERSONAL_DATA_CLEANUP` (+1802 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 36`** (2 nodes): `13254ae docs: document durable room storage`, `c860746 feat(web): add static rooms and room chat UI`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 46`** (2 nodes): `3c617ec style(web): polish dm day separator`, `7db2783 docs(monitoring): align LiveKit track metric labels`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 125`** (2 nodes): `ContextMenuContentState`, `ContextMenuProps`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 167`** (1 nodes): `ScreenRecoveryGraceController`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 190`** (1 nodes): `RealtimeHeartbeatWatchdog`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 217`** (1 nodes): `LiveKitReconcileGeneration`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 218`** (2 nodes): `o`, `s()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 219`** (2 nodes): `participantContextMenu`, `ParticipantMenuVariant`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 228`** (2 nodes): `applyRoomSwitchDecision()`, `writeRoomSwitchConfirmEnabled()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 229`** (2 nodes): `createMentionRepository()`, `crypto`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 232`** (1 nodes): `VoiceRoomDesktopAudioSourceProcessor`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 233`** (1 nodes): `FakeSocket`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 234`** (1 nodes): `FakeSocket`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 237`** (1 nodes): `FakeSocket`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 240`** (1 nodes): `registerModerationRoutes()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 241`** (2 nodes): `extensions`, `files`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 243`** (2 nodes): `VoiceRoom App Icon (Owl Mascot Mark on Dark Rounded Square)`, `VoiceRoom Mascot Mark (Masked Owl Silhouette, Transparent)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 244`** (1 nodes): `ADR: Unicode authority for message reactions`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 245`** (1 nodes): `VoiceRoom 2.5 Architecture Boundaries`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 246`** (1 nodes): `Backlog`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 247`** (1 nodes): `config/capability-dag.v1.json`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 248`** (1 nodes): `Capability Readiness Doc`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 249`** (1 nodes): `Design QA — reusable room and chat menus`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 250`** (1 nodes): `Font Assets README`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 251`** (1 nodes): `LiveKit External Auth-Gate Operations Doc (G05)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 252`** (1 nodes): `VoiceRoom monitoring agent`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 253`** (1 nodes): `OCI Runtime Publication Doc`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 254`** (1 nodes): `packages/CLAUDE.md Guidance`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 255`** (1 nodes): `Production Digest Promotion Doc`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 256`** (1 nodes): `Release 2.5.0 Repairs README`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `RealtimeRecoveryController` connect `Community 51` to `Community 14`?**
  _High betweenness centrality (0.008) - this node is a cross-community bridge._
- **What connects `crypto`, `{ transaction }`, `{ verifyPassword }` to the rest of the system?**
  _1807 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.061936851669569165 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.010443503864556496 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.02925243770314193 - nodes in this community are weakly interconnected._
- **Should `Community 3` be split into smaller, more focused modules?**
  _Cohesion score 0.026967285587975242 - nodes in this community are weakly interconnected._
- **Should `Community 4` be split into smaller, more focused modules?**
  _Cohesion score 0.14774774774774774 - nodes in this community are weakly interconnected._