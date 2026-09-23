# Graph Report - .  (2026-09-22)

## Corpus Check
- Large corpus: 838 files · ~424 952 words. Semantic extraction will be expensive (many Claude tokens). Consider running on a subfolder, or use --no-semantic to run AST-only.

## Summary
- 6864 nodes · 22186 edges · 252 communities detected
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 6 edges (avg confidence: 0.73)
- Token cost: 0 input · 0 output
- Edge kinds: ON_BRANCH: 6460 · MODIFIES: 5204 · contains: 5122 · calls: 2074 · imports: 1309 · imports_from: 878 · PARENT_OF: 820 · method: 219 · re_exports: 59 · references: 23 · inherits: 11 · conceptually_related_to: 4 · semantically_similar_to: 2 · implements: 1


## Input Scope
- Requested: auto
- Resolved: committed (source: default-auto)
- Included files: 838 · Candidates: 926
- Excluded: 0 untracked · 48908 ignored · 15 sensitive · 0 missing committed
- Recommendation: Use --scope all or graphify.yaml inputs.corpus for a knowledge-base folder.

## Graph Freshness
- Built from Git commit: `1567749`
- Compare this hash to `git rev-parse HEAD` before trusting freshness-sensitive graph output.
## God Nodes (most connected - your core abstractions)
1. `sendJson()` - 88 edges
2. `createTestDatabase()` - 47 edges
3. `runMigrations()` - 40 edges
4. `readJsonBody()` - 35 edges
5. `getUserStore()` - 31 edges
6. `resolveSessionUser()` - 30 edges
7. `RealtimeRecoveryController` - 30 edges
8. `createLogger()` - 29 edges
9. `requireSessionUser()` - 29 edges
10. `handleRoomChatPost()` - 27 edges

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
Nodes (213): createFriendStore(), createLinkPreviewStorage(), reconcileLinkPreviewImages(), createRelease250Pool(), createDirectMessageRepository(), createDmHistoryRepository(), createMessageReadRepository(), registerPinRoutes() (+205 more)

### Community 1 - "Community 1"
Cohesion: 0.01
Nodes (145): 3580978 fix(api): harden session and cookie write security, ec9f802 feat(api): persist visual identity keys, createRoomStore(), { AVATAR_COLOR_KEYS, cleanAvatarColorKey, cleanPresenceStatus }, { createDbPool, transaction }, { createLogger }, createUserStore(), crypto (+137 more)

### Community 2 - "Community 2"
Cohesion: 0.02
Nodes (99): SelectedMention, 2d36bc7 fix(api): bound messaging schema locks, 728cea2 feat: implement release 2.5.0 messaging platform (#105), 88169aa fix(api): preserve migration history with corrective follow-ups, ab373a6 chore(release): 2.5.0 (#121), d9f484d test(engagement): prove content and mention UoW, ecc157a refactor(web): preserve async failure evidence, model (+91 more)

### Community 3 - "Community 3"
Cohesion: 0.02
Nodes (94): 13b9a17 feat: log structured domain events across the API, workers and browser (#144), 5f20352 Merge pull request #147 from dazeGG/release/2.6.2, CLIENT_LOG_LIMITS, createDbPool(), { createLogger }, { LOG_EVENTS }, { Pool }, { readDatabaseConfig } (+86 more)

### Community 4 - "Community 4"
Cohesion: 0.02
Nodes (94): 20fdff5 feat(api): persist static rooms and chat, 3f83f05 Merge branch 'release/2.2.0', 4cfb160 chore(release): bump version to 2.2.0, 7524c15 feat(realtime): add websocket room updates, beffc4f Merge tag 'v2.2.0' into develop, {
  parseClientEnvelope,
  buildServerEnvelope,
  buildServerErrorEnvelope,
  validateClientCommand
}, sendWsEnvelope(), serializeEnvelope() (+86 more)

### Community 5 - "Community 5"
Cohesion: 0.04
Nodes (105): isRoomEmbedded(), clearPeerJoinCue(), getScreenPublicationPresence(), ApiRequestError, checkRoomExists(), postJson(), cancelRoomRecovery(), isCurrentRoomRecoveryEpoch() (+97 more)

### Community 6 - "Community 6"
Cohesion: 0.03
Nodes (47): AuthUser, SelfUserFlags, roomNameFor(), clearSession(), session, setUser(), syncRoomName(), 1578df6 feat: add account settings (+39 more)

### Community 7 - "Community 7"
Cohesion: 0.09
Nodes (94): backup/room-shared-music-pre-rebase, develop, feature/2.5.0-manual-fixes, feature/room-shared-music, wip/discord-redesign, 0043b03 build: ship music-bot as a published runtime image, 0112d02 fix(infra): pin livekit server version, 02824cd fix(web): surface friend request errors (+86 more)

### Community 8 - "Community 8"
Cohesion: 0.04
Nodes (83): deleteDirectMessage(), DirectMessage, DirectMessageHistoryPage, DirectMessageInvite, editDirectMessage(), fetchThread(), fetchThreadPage(), HistoryMessageDto (+75 more)

### Community 9 - "Community 9"
Cohesion: 0.04
Nodes (52): 043b73d chore: release v2.1.5, 164b853 refactor(web): neutral input placeholders, dedicated dev port, desktop drag region (#16), 234177e feat(web): redesign screen source picker, 269978f chore(release): bump version to 2.2.6, 2ea67a2 Merge branch 'release/2.2.4', 35db896 feat(web): tune screen share codecs and bring back 60 FPS, 4497e53 Merge branch 'release/2.2.5', 4c756b6 Merge branch 'release/2.2.6' (+44 more)

### Community 10 - "Community 10"
Cohesion: 0.02
Nodes (67): ReadReconciliationOptions, 4553c35 fix(web): reconcile repeated cross-tab read cursors, 54086b4 fix(api): serialize notification retraction revisions, 74df7a9 fix(api): revoke only failed admission credential, 8e66057 fix(ci): fail release gates on wrong branch, ac8e530 fix(notifications): persist explicit all room level, b3732be fix(notifications): make inbox revisions monotonic, d56e835 fix(notifications): preserve conservative room policy (+59 more)

### Community 11 - "Community 11"
Cohesion: 0.19
Nodes (92): chore/graphify-refresh, feature/2.5.0-to-rc, feature/account-sessions-recovery, feature/cd-pipeline, feature/desktop-app-settings, feature/docs-cleanup, hotfix/room-membership-backfill, hotfix/room-moderation-ui (+84 more)

### Community 12 - "Community 12"
Cohesion: 0.03
Nodes (63): ReactionSnapshotView, 19902ab feat: prepare 2.5.0 RC and polish chats (#114), a2ee398 test(api): prove messaging pagination and reads, bb5c3d1 fix(web): reconcile authoritative reaction snapshots, c02e107 fix(web): recover attachment compose safely, cf49285 fix(api): reconcile media across replicas, d37be0b feat(api): expose media pressure health, d8e3847 test(web): prove messaging reconciliation flows (+55 more)

### Community 13 - "Community 13"
Cohesion: 0.04
Nodes (63): 1886650 feat(api): persist rooms and chat in postgres, 364b82c build(api): fence G15 predeploy migrations, c928af9 fix(api): require exact migration catalog readiness, d02ad7f fix(release): resolve evidence from immutable external artifacts, path, readDatabaseConfig(), readEnvBool(), readMessageDeliveryMode() (+55 more)

### Community 14 - "Community 14"
Cohesion: 0.06
Nodes (53): feature/guest-account-app-cta, 056c561 chore(graphify): rebuild the knowledge graph for account security, 15e3ea9 Merge branch 'feature/account-sessions-recovery' into develop, 28a7a98 Merge branch 'feature/account-sessions-recovery' into develop, 3258210 docs: describe account deletion and its grace period, 335132e feat(shared): add the account security contract, 3f068bb docs: describe the recovery codes reminder and what's new versioning, 51b04d8 Merge branch 'feature/account-sessions-recovery' into develop (+45 more)

### Community 15 - "Community 15"
Cohesion: 0.04
Nodes (59): log, persistMicrophoneMode(), persistOutputMuted(), applySpeaking(), attachMeter(), isLocalMicrophoneSpeaking(), isOverSpeakingThreshold(), log (+51 more)

### Community 16 - "Community 16"
Cohesion: 0.04
Nodes (20): 0a0699b chore: release v2.1.2, 0d30394 chore: merge v2.1.1 back to develop, 0f3d7a0 Merge branch 'hotfix/2.1.3', 0ffac54 feat(infra): expose livekit prometheus metrics for status stack (#22), 1840f18 chore: release v2.1.4, 2684b15 chore: release v2.1.3, 2994d09 fix(api): return friend request id from listRequests, 3b24424 fix(web): move download control to sidebar footer (+12 more)

### Community 17 - "Community 17"
Cohesion: 0.04
Nodes (49): 3e80a36 fix(api): bind the LiveKit JWT to its gate credential, 53d093e test(api): execute hostile credential boundary scenarios, b16c894 fix(api): expose fail-closed release telemetry, b9eeec3 fix(api): admit only roster peers to LiveKit, cc45703 fix(api): expose worker metrics across process boundaries, f124c57 fix(web): verify reaction boundaries through rendered UI, fa35a18 fix(api): reserve account peer ids and tie message authorship to accounts, httpKey() (+41 more)

### Community 18 - "Community 18"
Cohesion: 0.06
Nodes (51): 7b8da98 feat(web): add the room music player, 9c3b5e4 feat(audio): add unified playback bus (#54), a0ff17a feat(web): improve sound settings with sliders and cue volume (#30), b120355 feat(release): complete 2.4.0 plan (#55), ca162ce build: ship music-bot as a published runtime image, ce89791 feat(web): add the room music player, d088595 feat(web): add automatic microphone sensitivity, MicrophoneMode (+43 more)

### Community 19 - "Community 19"
Cohesion: 0.06
Nodes (59): 9ba8ece feat(web): tune screen share encoding, SCREEN_FPS_OPTIONS, SCREEN_QUALITY_OPTIONS, SCREEN_SIMULCAST_LAYER, SCREEN_STREAM_MODE_PROFILES, ScreenProfile, ScreenStreamMode, loadLiveKitClient() (+51 more)

### Community 20 - "Community 20"
Cohesion: 0.06
Nodes (58): dbToAmplitude(), persistGateAuto(), persistMicrophoneVolume(), MicProcessor, MicrophoneCapture, disconnectAudioNode(), unpublishLocalMicrophone(), applyInputGainToCapture() (+50 more)

### Community 21 - "Community 21"
Cohesion: 0.07
Nodes (54): 1ddbd67 fix(web): show viewer avatars in stream badge, 5b54d09 fix(web): remove viewer label from stream badge, b944a1b Revert "fix(web): show avatars in stream placeholders", clampStreamVolume(), normalizeStoredStreamVolume(), storeStreamVolume(), Participant, clearScreenAttendance() (+46 more)

### Community 22 - "Community 22"
Cohesion: 0.04
Nodes (48): 2a9aa5b test(api): prove media quota and worker safety, 40320f3 fix(release): authenticate oci evidence producers, 575dc80 fix(api): align private media boundaries, 6b3fc40 fix(release): require canonical merge commit authority, 760fdfe fix(api): remediate oversized attachments before validation, ae1827c fix(reactions): converge updates across realtime clients, ff08a8e test(api): exercise gate through postgres and network boundaries, CONTEXTS (+40 more)

### Community 23 - "Community 23"
Cohesion: 0.18
Nodes (57): feature/2.6.0-prerelease, feature/audit-hardening, feature/composer-emoji-picker, feature/emoji-images, feature/whats-new-stories, 035114c Merge branch 'feature/chat-drafts' into develop, 0580b9c Merge branch 'feature/cd-pipeline' into develop, 1fa0876 docs: remove shipped release plans and stale notes (+49 more)

### Community 24 - "Community 24"
Cohesion: 0.04
Nodes (43): 5d910ea fix(notifications): fail closed on provider errors, fa382b2 fix(api): derive backlog age directly from storage, { cleanPushEndpoint, describePushEndpoint }, { createLogger }, createPushService(), { LOG_EVENTS }, { PLATFORM_CLASSES }, readPushConfig() (+35 more)

### Community 25 - "Community 25"
Cohesion: 0.06
Nodes (48): 97d6dcd fix(web): stop showing idle push-to-talk as a muted microphone, isMicrophoneShownMuted(), cleanDisplayName(), errorMessage(), errorName(), hasLeadingZeroBits(), isCaptureCancelled(), isSafariBrowser() (+40 more)

### Community 26 - "Community 26"
Cohesion: 0.06
Nodes (42): AccountSecurity, addRoomByCode(), authPost(), authRead(), AuthRequestError, avatarRequest(), changePassword(), confirmLoginAlert() (+34 more)

### Community 27 - "Community 27"
Cohesion: 0.05
Nodes (39): eventMatchesHotkey(), getDefaultHotkeyBinding(), getHotkeyStorageKey(), HotkeyAction, isTypingTarget(), parseHotkeyBinding(), readHotkeyBinding(), writeHotkeyBinding() (+31 more)

### Community 28 - "Community 28"
Cohesion: 0.07
Nodes (51): getParticipantAudioPreferenceKey(), applyAudioBusOutput(), applyElementSink(), applyVoicePlayback(), AudioBusGraph, AudioBusKind, busNode(), connectDefaultOutput() (+43 more)

### Community 29 - "Community 29"
Cohesion: 0.06
Nodes (37): AvatarStackItem, AvatarStackProps, 049a913 fix(web): keep popover open on ambiguous focus loss, 08bd491 fix(web): focus DM compose input when opening a friend chat (#28), 0a9be62 fix(web): keep room preview chat closed by default (#32), 0c20745 chore(release): back-merge 2.1.9, 0d74cad Merge branch 'release/2.1.6', 206a214 refactor(web): use shared slider in settings controls (+29 more)

### Community 30 - "Community 30"
Cohesion: 0.06
Nodes (30): BlockStatus, blockUrl(), blockUser(), unblockUser(), del(), fetchJson(), getJsonAuth(), log (+22 more)

### Community 31 - "Community 31"
Cohesion: 0.05
Nodes (37): 1709ead fix(api): centralize active room ban enforcement, b6c5445 fix(api): reuse account avatar color in calls, {
  AVATAR_COLOR_KEYS,
  cleanAvatarColorKey
}, avatarColorForPeerId(), { createActiveBanService }, { createDbPool, transaction }, { createLogger }, crypto (+29 more)

### Community 33 - "Community 33"
Cohesion: 0.05
Nodes (24): playbackPolicy, e0eb12c chore(release): prepare 2.4.0, ContextMenuContentState, ContextMenuProps, MascotIconProps, MascotVariant, AvatarAccentPresentation, AvatarAccentRgb (+16 more)

### Community 34 - "Community 34"
Cohesion: 0.06
Nodes (18): accessibleName(), assertAccessibleName(), assertFocusOrder(), assertKeyboardActivation(), assertLiveRegion(), assertReducedMotionEnabled(), assertStableLayout(), text() (+10 more)

### Community 35 - "Community 35"
Cohesion: 0.07
Nodes (22): authUserWithoutSelfFlags, 09486bf feat(web): open rooms in mobile browsers, 2a41d55 feat(web): ask guests for an account and browser users for the desktop app, 3d42314 feat(shared): allow the room page on every platform class, 4a15eab Merge pull request #143 from dazeGG/release/2.6.1, 816637a Merge branch 'main' into develop, bdae2bd feat(web): finish the mobile room and rework the in-room call to action, cdc01df chore(release): 2.6.1 (+14 more)

### Community 36 - "Community 36"
Cohesion: 0.06
Nodes (14): AvatarProps, BadgeProps, ButtonProps, 3db468e feat(web): Volt redesign — landing, lobby v2, shared UI (#38), 6584f79 feat: add uploaded avatars for users and rooms (#45), 7dd4a5f refactor(rooms): replace visual presets with fallback avatars (#44), DialogProps, reconcileAvatarStorage() (+6 more)

### Community 37 - "Community 37"
Cohesion: 0.09
Nodes (48): 0753576 fix(web): show avatars in stream placeholders, 1a5009b fix(web): remove transient voice-connecting placeholder, 2c5f8d4 feat(web): show stream quality on tile thumbnails, 56ebf7a docs: document root-scoped omx runtime usage, 6895206 fix(web): remove desktop app region from topbar, 72d40ae fix(web): drop empty-room placeholder, auto-join guests, a3f35c0 fix(web): keep self tile when muting, a864b9c fix(web): highlight active speaker tiles (+40 more)

### Community 38 - "Community 38"
Cohesion: 0.07
Nodes (48): activeTargetSuppresses(), actorLabel(), BrowserNotificationPayload, buildNotificationPayload(), canUseNotifications(), cleanupMemoryDedupe(), consumeNotificationDedupeKey(), dedupeStorageKey() (+40 more)

### Community 39 - "Community 39"
Cohesion: 0.12
Nodes (50): broadcastUserProfileToFriends(), buildSessionCookie(), checkAvatarUploadRate(), clearSessionCookie(), describeLoginDevice(), endAccountSessionConnections(), getAccountDeletionRepository(), getGeoLocator() (+42 more)

### Community 40 - "Community 40"
Cohesion: 0.07
Nodes (27): emojiAssetName(), emojiAssetUrl(), 341b9d1 chore(graphify): rebuild the knowledge graph for emoji artwork, 42e581f feat(web): draw reactions from bundled artwork and rebuild the picker, 690fee9 build(web): keep the emoji artwork source out of the runtime images, 6c02eed feat(web): draw emoji in names and room names as artwork, 759c74f fix(web): show who is typing above the message field, 7c3ad87 feat(web): switch reaction artwork to Twemoji and rework tone picking (+19 more)

### Community 41 - "Community 41"
Cohesion: 0.06
Nodes (31): 02d78bc Merge pull request #69 from dazeGG/hotfix/2.4.2-backmerge, 6cd4b30 fix(web): stabilize screen sharing in 2.4.2 (#68), cf1ea14 chore(release): back-merge 2.4.2 into develop, ScreenPublicationPresence, getScreenReceiverDemand(), ScreenReceiverDemand, createScreenSubscriptionRetryController(), SCREEN_SUBSCRIPTION_RETRY_DELAYS_MS (+23 more)

### Community 43 - "Community 43"
Cohesion: 0.08
Nodes (35): fetchNotificationPreferences(), normalizePreferences(), NotificationMuteResponse, NotificationPreferences, NotificationPreferencesResponse, RoomNotificationLevel, setDmNotificationsMuted(), setDoNotDisturb() (+27 more)

### Community 44 - "Community 44"
Cohesion: 0.04
Nodes (2): 13254ae docs: document durable room storage, c860746 feat(web): add static rooms and room chat UI

### Community 45 - "Community 45"
Cohesion: 0.07
Nodes (41): assertReactionEmoji(), cleanReactionEmoji(), EMOJI_REACTION_AUTHORITY, buildGroups(), GROUP_ANCHORS, listReactionEmojiGroups(), { listReactionEmojis }, reactionEmojiGroupKey() (+33 more)

### Community 46 - "Community 46"
Cohesion: 0.08
Nodes (47): authorizeRoomMutation(), broadcast(), broadcastRoomUpdate(), closePeer(), countRoomCreationQuotaRoomsForIp(), createRoomForRequest(), createRoomId(), disconnectModeratedPeer() (+39 more)

### Community 47 - "Community 47"
Cohesion: 0.09
Nodes (41): feature/mobile-polish, main, 0d5875a fix: close migration dependency audit finding, 1048bee chore(release): 2.6.2, 1718dc1 Bump version to 1.6.1, 1f7fcec chore(release): 2.6.3, 21547ea chore(graphify): rebuild the knowledge graph for mobile rooms, 2600ae8 Merge pull request #3 from dazeGG/fix/output-mute-unsubscribe (+33 more)

### Community 48 - "Community 48"
Cohesion: 0.08
Nodes (40): 09c4d42 feat(shared): add the room shared-music wire contract, 6eb964c feat(shared): add the room shared-music wire contract, a0fa2d6 feat(api): drive room shared-music sessions, edcdda0 feat(music-bot): add the shared-music bot backed by yt-dlp, buildRoomRealtimeSummary(), buildServerEnvelope(), isPlainObject(), KNOWN_CLIENT_TYPES (+32 more)

### Community 49 - "Community 49"
Cohesion: 0.05
Nodes (36): 10de220 test(api): prove active ban expiry in PostgreSQL, 177f5e3 test(api): prove durable message delivery, 2d8eac5 test(messaging): lock G20-G23 contracts, 93cad8e test(release): define G42 messaging checkpoint, cb7ad0e feat(api): fence message delivery cutover, readEnvInt(), abortError(), boundedBackoff() (+28 more)

### Community 50 - "Community 50"
Cohesion: 0.16
Nodes (38): feature/whats-new-recovery-codes, feature/whats-new-screenshots, fix/api-test-db-teardown, 017195e Merge branch 'feature/composer-emoji-picker' into develop, 0f0c04b fix(web): align popover trigger inside chat action toolbars, 1051d9c fix(web): make the speaking ring report who is actually audible, 129387d feat(web): write messages in a field that shows emoji as artwork, 28759aa fix(web): stack room reactions and keep the message toolbar reachable (+30 more)

### Community 51 - "Community 51"
Cohesion: 0.06
Nodes (37): bcdcd06 refactor(web): untangle room client import cycles, createPeerId(), createSessionToken(), extractRoomId(), getRoomIdFromPath(), getStoredPeerSession(), rotateStoredPeerSession(), AppState (+29 more)

### Community 52 - "Community 52"
Cohesion: 0.06
Nodes (20): AppRealtimeConnection, connectRealtime(), getAppRealtime(), PinsRealtimeEvent, ReactionRealtimeEvent, RealtimeAccountEvent, RealtimeErrorEvent, RealtimeHandle (+12 more)

### Community 53 - "Community 53"
Cohesion: 0.08
Nodes (30): createMessageReplyHandlers(), registerMessageReplyRoutes(), REPLY_CONFLICT_BODY, { ReplyTargetUnavailableError }, isInvitation(), isReplyTargetKindAllowed(), isUnavailable(), messageId() (+22 more)

### Community 54 - "Community 54"
Cohesion: 0.05
Nodes (10): RealtimeHeartbeatWatchdog, ComposerSelection, copyTextFor(), handleEmojiCopy(), 5748635 Merge pull request #142 from dazeGG/release/2.6.0, createLinkPreviewRepository(), LinkPreview, LinkPreviewImage (+2 more)

### Community 55 - "Community 55"
Cohesion: 0.16
Nodes (36): fix/open-in-app-download, fix/ptt-idle-not-muted, 069f23a chore(graphify): rebuild the knowledge graph for 2.5.8, 0b7bfc9 feat(web): add a desktop overlay for borderless games (#134), 0f64514 fix(web): open desktop notifications on their chat and group them per chat (#132), 1ae08e2 chore(release): back-merge 2.5.12 into develop, 253c24d feat(web): overlay avatar size and panel hints (#138), 2bb7a79 Merge branch 'fix/desktop-autostart-test-vite' into develop (+28 more)

### Community 56 - "Community 56"
Cohesion: 0.13
Nodes (10): classifyRecoveryFailure(), DEFAULT_RETRY_DELAYS_MS, elapsedBucket(), RealtimeRecoveryController, RETRYABLE_CODES, SAFE_CODES, sanitizeRecoveryCode(), TERMINAL_CODES (+2 more)

### Community 57 - "Community 57"
Cohesion: 0.11
Nodes (40): attachMediaProjection(), attachReplyProjection(), broadcastDirectLinkPreview(), broadcastDmNotification(), broadcastRoomLinkPreview(), cleanChatText(), cleanDmText(), dispatchMessageDeliveryEvent() (+32 more)

### Community 59 - "Community 59"
Cohesion: 0.06
Nodes (32): createMediaService(), detectExactContainer(), FORMAT_MIME, MediaServiceError, PNG_END, readBounded(), sharp, createMediaStorage() (+24 more)

### Community 60 - "Community 60"
Cohesion: 0.09
Nodes (18): AttachmentApiError, AttachmentContext, AttachmentDraft, AttachmentDraftState, createAttachmentSlot(), deleteAttachment(), Envelope, getAttachmentStatus() (+10 more)

### Community 61 - "Community 61"
Cohesion: 0.09
Nodes (32): 01e9d33 feat(room): add side panel participant roster, 1ecef6b fix(room): show persistent participant roster, 2137216 fix(chat): unify image captions, 2ce6059 test(shared): lock attachment contracts, 3d1864e fix(chat): attach captions to image width, 4125282 fix(room): resolve roster room from route, 6c425ac fix(chat): restore room invitations, 772038f fix(room): show roster in active room (+24 more)

### Community 62 - "Community 62"
Cohesion: 0.08
Nodes (26): wait(), clearAllPeerJoinCues(), clearStreamViewerCues(), CueNote, getCueGain(), isCuePlaybackSuppressed(), log, peerJoinCueTimes (+18 more)

### Community 63 - "Community 63"
Cohesion: 0.15
Nodes (31): feature/mobile-room, release/2.6.0, 0e0a5df Merge branch 'feature/2.6.0-prerelease' into develop, 189c194 chore(graphify): rebuild the knowledge graph for the 2.6.0 pre-release fixes, 1dd8bdc feat(web): illustrate what is new with screenshots of the real app, 2513c99 Merge branch 'feature/link-previews' into develop, 263b5c6 Merge branch 'feature/whats-new-recovery-codes' into develop, 2b4a3c6 feat(web): make link previews compact (+23 more)

### Community 64 - "Community 64"
Cohesion: 0.13
Nodes (19): dc5ff86 feat: add room CRUD, dm, picker, reactors, room, store, summary, authDialog() (+11 more)

### Community 65 - "Community 65"
Cohesion: 0.09
Nodes (14): 12b694d fix(web): refine room controls and stream notices (#58), 331bb32 fix(web): restore room panel interaction, 3f2fcf3 fix(room): restore preview side panel behavior, 5b7d102 chore(release): back-merge 2.4.0 into develop, 70b16b9 fix(web): align stream tiles and viewer cues (#59), 76fc735 Add desktop notification enable setting, 8d84b9b fix(web): unify room and profile menus, bc72aaa feat(web): unify room and context menus (#56) (+6 more)

### Community 66 - "Community 66"
Cohesion: 0.09
Nodes (30): 0ec8255 chore(release): bump version to 2.2.3, 2adaec0 Merge branch 'hotfix/2.2.3-ci', 397400d chore(release): bump version to 2.2.2, 3b6010b Merge branch 'release/2.2.2', 5fa984e Merge tag 'v2.2.2' into develop, bc6c32c Merge tag 'v2.2.3' into develop, cf119b8 fix(api): wait for fresh websocket summary frames, assert (+22 more)

### Community 67 - "Community 67"
Cohesion: 0.16
Nodes (34): broadcastToUser(), cleanUuid(), getFriendStore(), getMessageService(), getNotificationStore(), handleBlockedList(), handleBlockUser(), handleCancelFriendRequest() (+26 more)

### Community 68 - "Community 68"
Cohesion: 0.07
Nodes (5): 2391bbe feat(web): migrate UI icons to Lucide (#42), iconLg, iconMd, iconSm, iconXs

### Community 69 - "Community 69"
Cohesion: 0.06
Nodes (3): 01a206a chore: release v2.1.1, cce23b6 fix(web): stabilize preview chat identity, ce73d06 fix(web): hotfix lobby dock, preview chat, download, and add-friend flow

### Community 70 - "Community 70"
Cohesion: 0.08
Nodes (21): authorize(), { createGateCredentialSigner }, createMemoryGateStore(), extractCredential(), mint(), readTopologyEvidence(), require, runAuthGateProof() (+13 more)

### Community 71 - "Community 71"
Cohesion: 0.08
Nodes (26): clearRoomOccupancyRetries(), clearRoomOccupancyRetry(), createApiApp(), createFastifyLoggerOptions(), fastify, getHistoryServices(), getLogLevel(), getMembershipServices() (+18 more)

### Community 72 - "Community 72"
Cohesion: 0.14
Nodes (14): fetchReactionSummaries(), fetchReactors(), ReactionConversation, reactionUrl(), setReactionDesired(), validSummaries(), replaceReactionSnapshot(), cleanView() (+6 more)

### Community 73 - "Community 73"
Cohesion: 0.07
Nodes (20): 05f2a77 test(api): bind strict credential cutover, 501ef14 test(web): lock leave and rejoin flow, 849600b fix(api): persist membership after admission, ebd3ed4 test(release): define G50 membership checkpoint, model, membershipModel, routes, service (+12 more)

### Community 74 - "Community 74"
Cohesion: 0.09
Nodes (15): 2600555 fix(api): bound direct typing state and declare the account purge writer, d523ff1 chore(release): back-merge 2.6.0 into develop, parseInboundMessage(), createTypingThrottle(), { buildServerEnvelope, buildServerErrorEnvelope, parseInboundMessage }, { createLogger, hashIp }, { createTypingThrottle }, { LOG_EVENTS } (+7 more)

### Community 75 - "Community 75"
Cohesion: 0.10
Nodes (24): 61fdd06 fix(web): play remote voices on their own element so Chrome cancels echo, 7c38d36 feat(web): show packet loss, jitter and TCP/relay fallback in the voice status, getOutboundNetworkFromStats(), getRoundTripTimeFromStats(), log, previousInbound, roundPct(), startPeerLatencyStats() (+16 more)

### Community 76 - "Community 76"
Cohesion: 0.08
Nodes (21): AVATAR_KEY_PATTERN, createAvatarStorage(), fs, path, { readUploadsDir }, validateAvatarKey(), assert, { createApiApp } (+13 more)

### Community 77 - "Community 77"
Cohesion: 0.09
Nodes (20): createMembershipRepository(), crypto, mapDirectoryMember(), mapMembership(), toMillis(), registerMembershipRoutes(), { createMembershipRepository }, createMembershipService() (+12 more)

### Community 78 - "Community 78"
Cohesion: 0.08
Nodes (18): {
  ACCOUNT_DELETION_GRACE_MS,
  DELETED_ACCOUNT_NAME,
  DELETED_LOGIN_PREFIX
}, createAccountDeletionRepository(), crypto, PERSONAL_DATA_CLEANUP, { transaction }, { verifyPassword }, { ACCOUNT_DELETION_GRACE_MS }, assert (+10 more)

### Community 79 - "Community 79"
Cohesion: 0.11
Nodes (20): RealtimeEvent, RoomSnapshot, acknowledgeActiveVoiceResync(), clearActiveResync(), detailHandlers, ensureAppRealtimeConnected(), ensureReconnectRestore(), isRetryableActiveResyncError() (+12 more)

### Community 80 - "Community 80"
Cohesion: 0.13
Nodes (8): 2ea3623 Merge pull request #116 from dazeGG/feature/2.5.0-manual-fixes, c80ed8a feat(web): expand contextual menus, ProfileCardAnchor, profileCardUi, ProfileCardPerson, ProfileCardProps, ProfileCardRelationship, ReactionEmojiGroup

### Community 81 - "Community 81"
Cohesion: 0.10
Nodes (20): createRuntimeReadinessRepository(), { createDbPool }, { createRuntimeReadinessRepository }, os, startWorkerHeartbeat(), WORKER_CAPABILITIES, assert, { createReadinessReport } (+12 more)

### Community 82 - "Community 82"
Cohesion: 0.13
Nodes (12): 1b46251 fix(web): fit the image viewer, tighten the picker, ping on mention only, 2207473 fix(web): make the tone strip reachable and settle the DM thread before showing it, 2bb0df7 feat(web): give images a real viewer, and open pending ones in it, 84ba47a feat(web): rebuild the notification centre, and retire notifications on read, 9c1c7df Merge branch 'feature/2.5.0-fixes' into develop, a0dac33 Merge branch 'feature/2.5.0-fixes' into develop, c22c49a Merge branch 'feature/2.5.0-fixes' into develop, e9bf7d5 feat(web): make a mention name a person you can act on (+4 more)

### Community 83 - "Community 83"
Cohesion: 0.09
Nodes (17): 7609180 fix(web): harden reaction convergence, ac1c7f4 fix(api): allow safe guest reaction reads, ad596da test(api): prove reaction persistence invariants, d43fd78 fix(shared): accept signed reactor cursors, CONTEXT_TABLES, createReactionRepository(), requireQuery(), assert (+9 more)

### Community 84 - "Community 84"
Cohesion: 0.10
Nodes (12): getInitials(), getAllParticipants(), getParticipantById(), FullscreenView, getActiveScreenPeer(), getScreenMetaView(), getScreenViewers(), getStreamVolumeView() (+4 more)

### Community 85 - "Community 85"
Cohesion: 0.10
Nodes (11): registerMediaRoutes(), assert, { createMediaVisibilityService }, fastify, { registerMediaRoutes }, test, assert, createApp() (+3 more)

### Community 86 - "Community 86"
Cohesion: 0.15
Nodes (22): addDesktopOverlayGame(), DEFAULT_SETTINGS, desktopOverlayAvailable(), DesktopOverlayForeground, DesktopOverlayParticipant, DesktopOverlayPatch, DesktopOverlaySettings, getBridge() (+14 more)

### Community 88 - "Community 88"
Cohesion: 0.11
Nodes (15): createReactionRealtimeAdapter(), registerReactionRoutes(), createReactionService(), normalizeConversation(), {
  normalizeReactionMutation,
  normalizeReactionSummary,
  normalizeReactorPage,
  normalizeReactorQuery
}, ReactionServiceError, assert, { createCursorCodec } (+7 more)

### Community 89 - "Community 89"
Cohesion: 0.11
Nodes (17): 110c9be fix(api): keep banned visitors out of the room chat and roster reads, 3fd49cd fix(api): decode only signature-checked link preview images, 4d2265b fix: stop public endpoints from leaking internals or foreign installers, 7d41ba7 fix(api): cap failed logins per account, a41c317 fix: redact URL queries and tokens from client logs, d568ddc fix(api): check Origin on every cookie write and WebSocket handshake, crypto, { isAllowedImage } (+9 more)

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
Nodes (17): 88e8e93 test(release): define physical support matrix gate, b318c49 test(web): prove desktop root boundary, c4b1a22 test(api): enforce exact migration lock budget, edf6daf test(api): prove platform class migration, assert, { classifyPlatform }, { Client }, { createPushStore } (+9 more)

### Community 94 - "Community 94"
Cohesion: 0.15
Nodes (13): createCursorCodec(), crypto, CursorCodecError, makePayload(), normalizeKeys(), normalizeMicrosecond(), normalizeString(), normalizeTuple() (+5 more)

### Community 95 - "Community 95"
Cohesion: 0.19
Nodes (18): asSet(), buildNodeMap(), compareReplicas(), createReadinessProvider(), crypto, evaluateFromOptions(), evaluatePublicNode(), evaluateRawManifest() (+10 more)

### Community 96 - "Community 96"
Cohesion: 0.12
Nodes (16): assert, { createApiServer }, createFriends(), createModerationStore(), createUsers(), crypto, fs, http (+8 more)

### Community 97 - "Community 97"
Cohesion: 0.12
Nodes (14): assert, buildApp(), { createApiApp, createApiServer }, createFakeFriends(), createFakeStore(), createFakeUsers(), fs, http (+6 more)

### Community 98 - "Community 98"
Cohesion: 0.13
Nodes (16): cleanUpstreamUrl(), { createCredentialBoundaryService }, { createDbPool }, { createGateCredentialSigner }, createLiveKitAuthGateService(), { createLogger }, { createRoomStore }, deny() (+8 more)

### Community 99 - "Community 99"
Cohesion: 0.15
Nodes (14): CapabilityFeatures, CapabilityKey, CapabilityResponse, isCapabilityReady(), loadCapabilities(), resetCapabilities(), CapabilityEdge, CapabilityState (+6 more)

### Community 101 - "Community 101"
Cohesion: 0.15
Nodes (15): 2350242 build(api): define expiry-aware rescue profile, 4ea02ee fix(api): harden temporary moderation flows, createModerationRepository(), crypto, mapBanProfile(), mapModerationBan(), toMillis(), {
  buildModerationPage,
  durationToExpiresAt,
  normalizeBanMutation,
  normalizeIdempotencyKey,
  normalizeModerationPageRequest
} (+7 more)

### Community 102 - "Community 102"
Cohesion: 0.15
Nodes (16): clean(), decodeEntities(), decodeHtmlBody(), extractLinkPreviewMetadata(), NAMED_ENTITIES, parseAttributes(), resolveHttpUrl(), createLinkPreviewService() (+8 more)

### Community 103 - "Community 103"
Cohesion: 0.17
Nodes (18): { AccessToken, TrackSource }, assertCase(), { createDbPool }, { createGateCredentialSigner }, { createRoomStore }, directLocalhostPortClosed(), mintCredentials(), openWebSocket() (+10 more)

### Community 104 - "Community 104"
Cohesion: 0.13
Nodes (12): actorLockKey(), boundedString(), createMessageIdempotencyRepository(), crypto, encodeParts(), IdempotencyConflictError, IdempotencyQuotaError, ledgerKey() (+4 more)

### Community 106 - "Community 106"
Cohesion: 0.15
Nodes (13): checkApiSources(), crossDomainTablesFor(), findSqlWrites(), findTimers(), globToRegExp(), isOwner(), normalizePath(), walkFiles() (+5 more)

### Community 107 - "Community 107"
Cohesion: 0.16
Nodes (16): buildModerationPage(), cleanString(), durationToExpiresAt(), MODERATION_DURATION_MS, MODERATION_DURATIONS, normalizeActiveBan(), normalizeBanDuration(), normalizeBanMutation() (+8 more)

### Community 108 - "Community 108"
Cohesion: 0.13
Nodes (17): assert, cookieFrom(), { createTestDatabase }, fs, getSocketPath(), http, me(), { openWs } (+9 more)

### Community 109 - "Community 109"
Cohesion: 0.18
Nodes (14): deleteModeratedMessage(), fetchActiveBans(), parsePage(), putBan(), responseJson(), roomModerationUrl(), unban(), BAN_DURATIONS (+6 more)

### Community 111 - "Community 111"
Cohesion: 0.12
Nodes (13): BLOCKED_SUBNETS, createLinkPreviewFetcher(), dns, http, https, isPublicAddress(), net, REDIRECT_STATUSES (+5 more)

### Community 112 - "Community 112"
Cohesion: 0.15
Nodes (14): buildNotificationEnvelope(), buildProviderPayload(), cleanString(), normalizeNotificationEnvelope(), normalizeNotificationItem(), NOTIFICATION_LEVEL_SET, NOTIFICATION_LEVELS, NOTIFICATION_REASON_SET (+6 more)

### Community 113 - "Community 113"
Cohesion: 0.14
Nodes (16): assert, cookieFrom(), { createTestDatabase }, fs, http, me(), { openWs, waitForWsType }, os (+8 more)

### Community 114 - "Community 114"
Cohesion: 0.11
Nodes (11): assert, { createTestDatabase }, fs, http, { openWs, joinVoiceRoom, subscribeRoomPreview, waitForWsType }, os, path, { socketPathForDirectory } (+3 more)

### Community 115 - "Community 115"
Cohesion: 0.11
Nodes (11): ADMISSION_INTERNAL_COVERAGE_SCRIPT, { createGateCredentialSigner }, { createLiveKitAuthGateService, extractCredential }, { createRoomRealtimeRuntime }, { createRoomStore }, FakeSocket, greenSummary, require (+3 more)

### Community 116 - "Community 116"
Cohesion: 0.23
Nodes (15): FetchMembershipsOptions, fetchRoomMemberships(), leaveRoomMembership(), applyRoomVoicePeers(), cacheKey(), clearRoomMembership(), emptyEntry(), getRoomMembership() (+7 more)

### Community 117 - "Community 117"
Cohesion: 0.18
Nodes (12): fetchRoomPins(), pinAuthor(), PinnedMessage, PinnedMessageAuthor, PinResponse, pinRoomMessage(), PinSnapshot, pinUrl() (+4 more)

### Community 118 - "Community 118"
Cohesion: 0.14
Nodes (7): 08e3e13 Merge branch 'hotfix/2.2.1', 17edd27 feat(web): add lobby voice controls widget, 3ce55ad fix(web): dedupe self avatar and drop count label in room list, 52c6592 Merge tag 'v2.2.1' into develop, b53f16e fix(web): show only online status in friends sidebar (#31), bd153ef chore(release): bump version to 2.2.1, d52f131 fix(web): restore room topbar spacing in embedded shell

### Community 119 - "Community 119"
Cohesion: 0.13
Nodes (14): 5f973f0 test(api): prove the audit authorization fixes end to end, assert, { createApiServer }, createStore(), createUsers(), crypto, fs, http (+6 more)

### Community 120 - "Community 120"
Cohesion: 0.14
Nodes (12): { buildMessageDeliveryEvent }, createMessageOutboxRepository(), crypto, encodeParts(), logicalKey(), MessageDeliveryFenceError, requireQuery(), assert (+4 more)

### Community 121 - "Community 121"
Cohesion: 0.21
Nodes (13): deletePushSubscription(), fetchPushConfig(), PushConfig, savePushSubscription(), decodeVapidKey(), detachPushSubscription(), getRegistration(), isDesktopRuntime() (+5 more)

### Community 122 - "Community 122"
Cohesion: 0.14
Nodes (2): AvatarCropDialogProps, AvatarCropShape

### Community 123 - "Community 123"
Cohesion: 0.28
Nodes (15): DEFAULT_FREQUENT_REACTIONS, FrequentReaction, frequentReactionKey(), loadFrequentReactions(), localStorageKey(), memory, normalizeEntries(), openDatabase() (+7 more)

### Community 124 - "Community 124"
Cohesion: 0.16
Nodes (12): createGeoLocator(), { createLogger }, formatLocation(), fs, { LOG_EVENTS }, namesOf(), net, placeName() (+4 more)

### Community 125 - "Community 125"
Cohesion: 0.20
Nodes (12): clearDisconnectedHiddenEmbed(), clearViewedRoom(), connectedRoomIsViewed(), embeddedRoomIsVisible(), getActiveVoiceRoomId(), openActiveVoiceRoom(), roomNavigation, RoomShellMode (+4 more)

### Community 126 - "Community 126"
Cohesion: 0.16
Nodes (13): BrowserIdleDetector, BrowserIdleDetectorConstructor, createPresenceIdleController(), DesktopIdleBridge, DesktopIdleScope, EventTarget, getDesktopIdleSecondsReader(), hasGrantedBrowserIdlePermission() (+5 more)

### Community 127 - "Community 127"
Cohesion: 0.17
Nodes (7): FakeAudioContext, FakeMediaStream, FakeNode, getServer(), loadBus(), voiceElement(), webRoot

### Community 128 - "Community 128"
Cohesion: 0.13
Nodes (4): DeniedNotification, FakeNotification, require, ts

### Community 129 - "Community 129"
Cohesion: 0.13
Nodes (12): extractCredential(), assert, { createApiApp }, { createGateCredentialSigner }, { createLiveKitAuthGateService, extractCredential }, { EventEmitter }, fs, net (+4 more)

### Community 130 - "Community 130"
Cohesion: 0.21
Nodes (9): DesktopAsset, DesktopRelease, fetchDesktopRelease(), DESKTOP_BUILDS, DesktopBuild, detectDesktopBuildId(), isDesktopReleaseAssetUrl(), startDesktopBuildDownload() (+1 more)

### Community 131 - "Community 131"
Cohesion: 0.21
Nodes (8): 924295b test(web): prove G13 against pinned Caddy, 9ae0b78 build(web): send the full CSP as a header from Caddy, a37d685 test(web): make G13 paths workspace-safe, buildHeaderPolicy(), readMetaPolicy(), renderCaddySnippet(), repoRoot, repositoryRoot

### Community 132 - "Community 132"
Cohesion: 0.17
Nodes (10): createMessageService(), { createMessageVisibilityService }, createMessageVisibilityService(), MessageVisibilityError, assert, { createMessageService }, { createMessageVisibilityService }, fs (+2 more)

### Community 133 - "Community 133"
Cohesion: 0.14
Nodes (9): clearViewedScreenPeerReferences(), resolveViewedScreenPeerId(), assert, {
  clearViewedScreenPeerReferences,
  createRoomRealtimeRuntime,
  resolveViewedScreenPeerId
}, createLeaseRuntime(), createRuntime(), OWNER_TOKEN, test (+1 more)

### Community 134 - "Community 134"
Cohesion: 0.21
Nodes (10): INTERNAL_NODE_KEYS, isManifestValid(), isObject(), normalizeInternalNode(), normalizeManifest(), normalizeOperatorNode(), normalizePublicNode(), OPERATOR_KEYS (+2 more)

### Community 135 - "Community 135"
Cohesion: 0.14
Nodes (12): assert, { countWsType, joinVoiceRoom, openWs, sendWs, subscribeRoomPreview, waitForWsType }, { createTestDatabase }, fs, http, os, path, { socketPathForDirectory } (+4 more)

### Community 136 - "Community 136"
Cohesion: 0.24
Nodes (10): containsPath(), createCoordinatedSnapshot(), filesBelow(), resolvedProspectivePath(), sha256(), 06b943b fix(ops): bind media restore catalog, 1332815 feat(ops): add coordinated media restore, 7795005 test(web): cover moderation center contract (+2 more)

### Community 137 - "Community 137"
Cohesion: 0.14
Nodes (11): readUploadsDir(), crypto, fs, { LINK_PREVIEW_IMAGE_KEY_PATTERN }, path, { readUploadsDir }, assert, fs (+3 more)

### Community 138 - "Community 138"
Cohesion: 0.19
Nodes (11): DesktopNotificationPayload, BridgeResult, DesktopBridge, resolveBridge(), showDesktopNotification(), browserNavigator(), classifyPlatform(), classifyPlatformPolicy() (+3 more)

### Community 139 - "Community 139"
Cohesion: 0.15
Nodes (10): createWsHandler(), assert, createHandler(), createRegistry(), { createWsHandler }, { EventEmitter }, FakeSocket, test (+2 more)

### Community 140 - "Community 140"
Cohesion: 0.18
Nodes (12): classifyPlatform(), classifyPlatformPolicy(), normalizedString(), PLATFORM_CLASSES, platformPolicy(), assert, cjs, CORPUS (+4 more)

### Community 141 - "Community 141"
Cohesion: 0.14
Nodes (10): { ACCOUNT_DELETION_GRACE_MS, DELETED_ACCOUNT_NAME }, assert, { createAccountDeletionRepository }, { createTestDatabase }, { createUserStore }, crypto, { Pool }, { runMigrations } (+2 more)

### Community 142 - "Community 142"
Cohesion: 0.14
Nodes (7): assert, http, { openWs, joinVoiceRoom, sendWs, waitForWsType }, { __private, createApiServer }, test, openWs(), WebSocket

### Community 143 - "Community 143"
Cohesion: 0.29
Nodes (12): ChatDraft, ChatDraftScope, chatDraftScopeKey(), chatDraftStorageKey(), clearChatDrafts(), loadChatDraft(), normalizeChatDrafts(), normalizeMentions() (+4 more)

### Community 145 - "Community 145"
Cohesion: 0.22
Nodes (11): createAvatarKey(), crypto, { deriveAvatarAccent, dominantAvatarColor }, detectAvatarFormat(), { detectImageFormat }, processAvatar(), sharp, assert (+3 more)

### Community 146 - "Community 146"
Cohesion: 0.21
Nodes (11): { cleanAvatarColorKey, cleanPresenceStatus }, { createDbPool, transaction }, { createLogger }, crypto, lockUserPair(), mapInvite(), mapMessage(), mapPublicUser() (+3 more)

### Community 147 - "Community 147"
Cohesion: 0.21
Nodes (9): createProofOfWork(), crypto, hasLeadingZeroBits(), normalizePowNonce(), parsePowChallenge(), assert, crypto, {
  hasLeadingZeroBits,
  parsePowChallenge,
  normalizePowNonce,
  createProofOfWork
} (+1 more)

### Community 148 - "Community 148"
Cohesion: 0.18
Nodes (9): {
  buildHistoryEnvelope,
  normalizeHistoryRequest
}, canonicalParticipants(), createDmHistoryService(), DmHistoryError, { normalizeLinkPreview }, assert, { canonicalParticipants, createDmHistoryService }, { createCursorCodec } (+1 more)

### Community 149 - "Community 149"
Cohesion: 0.28
Nodes (11): applyDesktopBoundaryToDocument(), getDesktopBoundaryPolicy(), hasDesktopBridge(), isDesktopBoundaryAllowed(), isDesktopBoundaryBlocked(), isRealtimeBlocked(), isRoomClientAllowed(), NavigatorWithUserAgentData (+3 more)

### Community 150 - "Community 150"
Cohesion: 0.26
Nodes (11): cacheKey(), configCache, defaultConfig(), fetchRuntimeConfig(), hasSuspiciousSecrets(), loadRuntimeConfig(), resolveConfigOrigin(), resolveConfigUrl() (+3 more)

### Community 151 - "Community 151"
Cohesion: 0.29
Nodes (11): PopoverCloseReason, PopoverContentState, PopoverDividerProps, PopoverMenuItemProps, PopoverMenuItemVariant, PopoverMenuLabelProps, PopoverPlacement, PopoverProps (+3 more)

### Community 152 - "Community 152"
Cohesion: 0.31
Nodes (11): clamp(), deriveAvatarAccent(), fitChromaToSrgb(), isInSrgbGamut(), linearToSrgb(), normalizeChannel(), oklchToHex(), oklchToLinearRgb() (+3 more)

### Community 153 - "Community 153"
Cohesion: 0.21
Nodes (10): cleanText(), firstPreviewableUrl(), normalizeImage(), normalizeLinkPreview(), toPreviewUrl(), assert, path, { pathToFileURL } (+2 more)

### Community 154 - "Community 154"
Cohesion: 0.27
Nodes (12): buildHistoryEnvelope(), cleanString(), getReadCursorFromMessage(), HISTORY_MODE_SET, HISTORY_MODES, isObject(), isOpaqueCursor(), MESSAGE_KIND_SET (+4 more)

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
Nodes (10): assert, crypto, {
  EMOJI_REACTION_AUTHORITY,
  assertReactionEmoji,
  cleanReactionEmoji,
  isReactionEmoji,
  listReactionEmojis
}, fs, PACKAGE_JSON, path, { pathToFileURL }, ROOT (+2 more)

### Community 158 - "Community 158"
Cohesion: 0.18
Nodes (6): PLURAL_VERB, SINGLE_VERB, TYPING_ACTIVITIES, TypingActivity, TypingEntry, TypingPerson

### Community 159 - "Community 159"
Cohesion: 0.24
Nodes (6): formatTime(), pad(), formatChatDayLabel(), isSameDay(), MONTHS, startOfDay()

### Community 160 - "Community 160"
Cohesion: 0.17
Nodes (10): createReadinessReport(), assert, { createReadinessReport }, fs, path, { readMessageDeliveryMode }, { test }, assert (+2 more)

### Community 162 - "Community 162"
Cohesion: 0.21
Nodes (1): ScreenRecoveryGraceController

### Community 163 - "Community 163"
Cohesion: 0.24
Nodes (9): attachmentTextFallback(), MIME_TYPES, normalizeAttachment(), normalizeAttachments(), STATES, text(), assert, { MAX_ATTACHMENT_BYTES, attachmentTextFallback, normalizeAttachment, normalizeAttachments } (+1 more)

### Community 164 - "Community 164"
Cohesion: 0.17
Nodes (7): ACCESS_TOKEN, assert, CLAIMS, { createLiveKitAuthGateService }, { EventEmitter }, net, test

### Community 165 - "Community 165"
Cohesion: 0.24
Nodes (10): hasSurfaceToken(), isAllowedBackground(), lineAt(), paletteViolations(), root, sourceFiles(), sourceRoot, styleFragments() (+2 more)

### Community 166 - "Community 166"
Cohesion: 0.22
Nodes (8): 1b9f699 fix(api): stop logging a normal leave as a LiveKit failure, 79cf779 chore(release): 2.6.4, 9e6094c Merge pull request #150 from dazeGG/hotfix/livekit-participant-already-gone, df6efae Merge pull request #149 from dazeGG/release/2.6.3, assert, { __private, createApiApp }, test, { TrackSource }

### Community 167 - "Community 167"
Cohesion: 0.18
Nodes (10): a1d0d15 fix(restore): reject escaping snapshot sources, afaf670 fix(release): bind gates to immutable evidence, f50f3bc test(api): pin historical migration byte digests, assert, crypto, EXPECTED, fs, path (+2 more)

### Community 169 - "Community 169"
Cohesion: 0.38
Nodes (10): cleanContext(), cleanLevel(), cleanNamespace(), cleanSessionId(), cleanText(), cleanTimestamp(), CLIENT_LOG_LEVELS, normalizeClientLogBatch() (+2 more)

### Community 170 - "Community 170"
Cohesion: 0.20
Nodes (7): {
  buildHistoryEnvelope,
  normalizeHistoryRequest
}, createRoomHistoryService(), RoomHistoryError, assert, { createCursorCodec }, { createRoomHistoryService }, { test }

### Community 171 - "Community 171"
Cohesion: 0.27
Nodes (8): attachmentRevoker(), cleanupEnqueuer(), createMessageModerationService(), requireOperation(), { transaction }, assert, { createMessageModerationService }, test

### Community 172 - "Community 172"
Cohesion: 0.53
Nodes (10): buildMessageDeliveryEvent(), cleanString(), DELIVERY_EVENT_TYPES, isObject(), isSystemCard(), normalizeConversation(), normalizeIdempotency(), normalizeReplyPointer() (+2 more)

### Community 173 - "Community 173"
Cohesion: 0.31
Nodes (4): dbToAmplitude(), DEFAULT_OPTIONS, getSmoothingCoefficient(), VoiceRoomNoiseGateProcessor

### Community 174 - "Community 174"
Cohesion: 0.22
Nodes (8): apps/CLAUDE.md, docs/GIT_FLOW.md, .github CLAUDE.md Policy, Pull Request Template, docs/RELEASE_<version>_PLAN.md, Root CLAUDE.md, Room client architecture (ARCHITECTURE.md), apps/web/CLAUDE.md

### Community 175 - "Community 175"
Cohesion: 0.27
Nodes (8): BROWSABLE_EMOJIS, BROWSABLE_SET, EmojiCategory, hasSkinToneChoices(), isOfferedEmoji(), OFFERED, skinToneChoices(), withSkinTone()

### Community 176 - "Community 176"
Cohesion: 0.29
Nodes (8): cleanPushEndpoint(), crypto, describePushEndpoint(), EXACT_PUSH_HOSTS, isAllowedPushHost(), assert, { cleanPushEndpoint, describePushEndpoint }, test

### Community 177 - "Community 177"
Cohesion: 0.22
Nodes (5): buildAppRoomLink(), markInAppRoomNavigation(), OpenInAppSignals, PRODUCTION_HOSTS, resolveAppLinkScheme()

### Community 178 - "Community 178"
Cohesion: 0.36
Nodes (9): buildMembershipEnvelope(), cleanString(), isObject(), MEMBERSHIP_ROLE_SET, MEMBERSHIP_ROLES, normalizeMembershipEnvelope(), normalizeMembershipLimit(), normalizeMembershipMember() (+1 more)

### Community 179 - "Community 179"
Cohesion: 0.22
Nodes (9): bootstrap(), createApiServer(), installGracefulShutdown(), pruneRooms(), resolveRealtimeReconnectLeaseMs(), startPruneTimer(), assert, { bootstrap, createApiServer } (+1 more)

### Community 180 - "Community 180"
Cohesion: 0.22
Nodes (3): configure(), deferred(), MemoryStorage

### Community 181 - "Community 181"
Cohesion: 0.22
Nodes (9): assert, commonJs, fs, invoke(), packageJson, path, { pathToFileURL }, snapshot() (+1 more)

### Community 182 - "Community 182"
Cohesion: 0.22
Nodes (1): lang

### Community 184 - "Community 184"
Cohesion: 0.31
Nodes (8): buildTrie(), codePoints(), EmojiTextPart, hasEmoji(), matchAt(), splitEmoji(), TRIE, TrieNode

### Community 187 - "Community 187"
Cohesion: 0.25
Nodes (6): createMessageReadService(), MessageReadError, assert, { createCursorCodec }, { createMessageReadService }, { test }

### Community 188 - "Community 188"
Cohesion: 0.36
Nodes (8): desktopAutostartAvailable(), DesktopAutostartPatch, DesktopAutostartSettings, getBridge(), log, normalizeSettings(), readDesktopAutostartSettings(), updateDesktopAutostartSettings()

### Community 189 - "Community 189"
Cohesion: 0.31
Nodes (8): bindDesktopCallActions(), CALL_ACTIONS, DesktopCallAction, DesktopCallState, getBridge(), log, syncDesktopCallState(), toPayload()

### Community 191 - "Community 191"
Cohesion: 0.44
Nodes (8): cleanHttpUrl(), cleanString(), contentFromLegacyText(), normalizeRoomMessageContent(), normalizeSegment(), projectKnownContent(), projectRoomMessageContent(), utf8ByteLength()

### Community 192 - "Community 192"
Cohesion: 0.22
Nodes (7): bans, chatPanel, lobbyRoomSettings, members, model, roomSettings, root

### Community 193 - "Community 193"
Cohesion: 0.25
Nodes (6): 1567749 docs: target architecture and migration plan for the API, 1d8ebd8 fix(api): answer LiveKit's validate probe through the gate, 515a9ac feat: TURN/TLS on the shared :443 for UDP-blocked networks, 6d53bf5 build(api): type-check new API modules as strict TypeScript, d02a242 test(web): pin the G13 edge contract to the Caddy 2.11.4 image, repoRoot

### Community 194 - "Community 194"
Cohesion: 0.25
Nodes (7): api, chat, component, lobby, members, model, room

### Community 195 - "Community 195"
Cohesion: 0.25
Nodes (5): buildRoomMembershipPresenceSnapshot(), createConnectionRegistry(), assert, { buildRoomMembershipPresenceSnapshot, createConnectionRegistry }, test

### Community 196 - "Community 196"
Cohesion: 0.32
Nodes (4): getServer(), loadDrafts(), memoryStorage(), webRoot

### Community 197 - "Community 197"
Cohesion: 0.29
Nodes (4): getServer(), loadTyping(), require, webRoot

### Community 198 - "Community 198"
Cohesion: 0.25
Nodes (6): assert, fs, path, profile, repositoryRoot, test

### Community 199 - "Community 199"
Cohesion: 0.25
Nodes (3): FakeWebSocket, require, ts

### Community 200 - "Community 200"
Cohesion: 0.33
Nodes (4): fingerprint(), SendShadow, SendShadowState, stableJson()

### Community 202 - "Community 202"
Cohesion: 0.48
Nodes (7): docs/CLAUDE.md governance rules, VoiceRoom 2.5.0 consolidated execution plan, Git Flow workflow, VoiceRoom 2.5.0 unified messaging platform PRD, Release 2.4.0 verification plan, Release 2.4.1 verification plan, Release 2.4.2 hotfix verification plan

### Community 203 - "Community 203"
Cohesion: 0.29
Nodes (4): MMDB_METADATA_MARKER, now, previousMonth, target

### Community 204 - "Community 204"
Cohesion: 0.43
Nodes (5): createPinService(), normalizeMessageId(), normalizeRoomId(), PinServiceError, requireAccount()

### Community 205 - "Community 205"
Cohesion: 0.33
Nodes (5): { createReadinessReport, resolveManifestPath }, createRuntimeReadinessProvider(), { createRuntimeReadinessRepository }, failClosedSnapshot(), { PUBLIC_CAPABILITY_KEYS }

### Community 206 - "Community 206"
Cohesion: 0.57
Nodes (5): assertRegular(), inside(), resolveSnapshotFile(), restoreCoordinatedSnapshot(), sha256()

### Community 207 - "Community 207"
Cohesion: 0.48
Nodes (5): checkImportBoundaries(), extractImports(), globToRegExp(), normalizePath(), walkFiles()

### Community 208 - "Community 208"
Cohesion: 0.29
Nodes (6): ClientEnvelope, RoomPeerSummary, RoomRealtimeSummary, RoomTypist, ServerEnvelope, TypingActivity

### Community 209 - "Community 209"
Cohesion: 0.38
Nodes (7): checkPushSubscriptionRate(), cleanPushSubscription(), getPushService(), getPushStore(), handleCreatePushSubscription(), handleDeletePushSubscription(), handlePushConfig()

### Community 210 - "Community 210"
Cohesion: 0.33
Nodes (3): getServer(), loadModule(), webRoot

### Community 211 - "Community 211"
Cohesion: 0.29
Nodes (2): require, ts

### Community 212 - "Community 212"
Cohesion: 0.29
Nodes (3): FakeIdleDetector, require, ts

### Community 213 - "Community 213"
Cohesion: 0.33
Nodes (5): loadLiveKitService(), moduleUrl(), require, root, ts

### Community 214 - "Community 214"
Cohesion: 0.29
Nodes (1): TestMediaStream

### Community 215 - "Community 215"
Cohesion: 0.38
Nodes (5): FOCUSABLE_SELECTOR, focusInitialElement(), FocusTrapOptions, getFocusableElements(), isHTMLElement()

### Community 216 - "Community 216"
Cohesion: 0.60
Nodes (5): ChatMessage, mentionProfilePerson(), participantProfilePerson(), presenceFor(), roomMessageProfilePerson()

### Community 217 - "Community 217"
Cohesion: 0.33
Nodes (6): Desktop Support Matrix Doc (G19), Release 2.5.0 Durable Evidence Archive Doc (G03), Coordinated Media Backup and Restore Doc, Release 2.5.0 Budgets Doc (G91), Release 2.5.0 Develop Entry Doc (G93), Release 2.5.0 RC Preflight Doc

### Community 218 - "Community 218"
Cohesion: 0.47
Nodes (5): bindDesktopLinks(), DesktopLink, getBridge(), matches(), normalizeDesktopLink()

### Community 219 - "Community 219"
Cohesion: 0.60
Nodes (5): flipPlacementVertical(), parsePlacement(), resolvePopoverPlacement(), viewportSpaceAroundTrigger(), PlacementAxis

### Community 221 - "Community 221"
Cohesion: 0.33
Nodes (1): LiveKitReconcileGeneration

### Community 222 - "Community 222"
Cohesion: 0.40
Nodes (2): o, s()

### Community 223 - "Community 223"
Cohesion: 0.33
Nodes (2): participantContextMenu, ParticipantMenuVariant

### Community 224 - "Community 224"
Cohesion: 0.33
Nodes (5): ActiveBan, ActiveBanProfile, BanMutation, ModerationDuration, ModerationPage

### Community 225 - "Community 225"
Cohesion: 0.40
Nodes (5): loadRoomRealtime(), moduleUrl(), require, root, ts

### Community 226 - "Community 226"
Cohesion: 0.33
Nodes (3): assert, { deriveAvatarAccent, dominantAvatarColor }, test

### Community 227 - "Community 227"
Cohesion: 0.40
Nodes (3): getServer(), loadEmojiText(), webRoot

### Community 228 - "Community 228"
Cohesion: 0.33
Nodes (1): FakeBroadcastChannel

### Community 229 - "Community 229"
Cohesion: 0.33
Nodes (1): FakeServer

### Community 230 - "Community 230"
Cohesion: 0.60
Nodes (4): isToneIndex(), loadSkinTone(), saveSkinTone(), SkinToneIndex

### Community 231 - "Community 231"
Cohesion: 0.40
Nodes (5): 94552a2 test(release): fail closed at develop entry, 9e7182b perf(release): freeze 2.5.0 budgets, d5ce547 test(release): validate frozen budgets, f5c42a7 test(release): prepare fail-closed rc preflight, fbe0d61 test(release): generate activation matrix

### Community 232 - "Community 232"
Cohesion: 0.40
Nodes (5): Expiry-Aware Rescue Profile Doc (G85), Predeploy Migrations Doc, Release 2.6.0 Plan — Engagement & Notifications (Superseded), Release 2.7.0 Plan — Media & Moderation (Superseded), VoiceRoom 2.5.0 Unified — Verification and Release Evidence Specification

### Community 233 - "Community 233"
Cohesion: 0.60
Nodes (4): createPinRepository(), mapPin(), requireQuery(), toMillis()

### Community 234 - "Community 234"
Cohesion: 0.50
Nodes (2): applyRoomSwitchDecision(), writeRoomSwitchConfirmEnabled()

### Community 235 - "Community 235"
Cohesion: 0.40
Nodes (2): ToastOptions, toastState

### Community 236 - "Community 236"
Cohesion: 0.70
Nodes (3): SelectOption, SelectProps, SelectVariant

### Community 237 - "Community 237"
Cohesion: 0.40
Nodes (5): baseHeaders(), getLinkPreviewStorage(), getLiveKitConnectSources(), handleGetAvatar(), handleGetLinkPreviewImage()

### Community 238 - "Community 238"
Cohesion: 0.50
Nodes (1): VoiceRoomDesktopAudioSourceProcessor

### Community 239 - "Community 239"
Cohesion: 0.40
Nodes (4): assert, { createTestDatabase }, pg, test

### Community 240 - "Community 240"
Cohesion: 0.40
Nodes (1): FakeSocket

### Community 241 - "Community 241"
Cohesion: 0.40
Nodes (1): FakeClient

### Community 242 - "Community 242"
Cohesion: 0.40
Nodes (1): FakeSocket

### Community 243 - "Community 243"
Cohesion: 0.50
Nodes (3): getServer(), load(), webRoot

### Community 244 - "Community 244"
Cohesion: 0.50
Nodes (4): 166a0e8 test(release): resolve rescue fixtures from repository root, 5dd3691 test(api): serialize database suites, bf6bba7 test(api): cover media backlog age query, f540886 test(release): refresh CI gate fixtures

### Community 245 - "Community 245"
Cohesion: 0.50
Nodes (1): registerDmHistoryRoutes()

### Community 246 - "Community 246"
Cohesion: 0.50
Nodes (1): registerModerationRoutes()

### Community 247 - "Community 247"
Cohesion: 0.50
Nodes (1): roomSettingsUi

### Community 248 - "Community 248"
Cohesion: 0.50
Nodes (2): extensions, files

### Community 249 - "Community 249"
Cohesion: 0.50
Nodes (2): NAME_SITES, webRoot

### Community 250 - "Community 250"
Cohesion: 0.67
Nodes (3): addOrigin(), config, liveKitConnectSources()

### Community 251 - "Community 251"
Cohesion: 0.67
Nodes (3): 2ca6443 test(shared): lock platform classification contract, 69b709a test(shared): correct platform DTO assertion, fdb6786 test(api): make G14 paths workspace-safe

### Community 252 - "Community 252"
Cohesion: 0.67
Nodes (1): root

### Community 253 - "Community 253"
Cohesion: 1.00
Nodes (1): FakeTimers

### Community 254 - "Community 254"
Cohesion: 1.00
Nodes (2): VoiceRoom App Icon (Owl Mascot Mark on Dark Rounded Square), VoiceRoom Mascot Mark (Masked Owl Silhouette, Transparent)

### Community 255 - "Community 255"
Cohesion: 1.00
Nodes (1): ADR: Unicode authority for message reactions

### Community 256 - "Community 256"
Cohesion: 1.00
Nodes (1): VoiceRoom 2.5 Architecture Boundaries

### Community 257 - "Community 257"
Cohesion: 1.00
Nodes (1): Backlog

### Community 258 - "Community 258"
Cohesion: 1.00
Nodes (1): config/capability-dag.v1.json

### Community 259 - "Community 259"
Cohesion: 1.00
Nodes (1): Capability Readiness Doc

### Community 260 - "Community 260"
Cohesion: 1.00
Nodes (1): Design QA — reusable room and chat menus

### Community 261 - "Community 261"
Cohesion: 1.00
Nodes (1): Font Assets README

### Community 262 - "Community 262"
Cohesion: 1.00
Nodes (1): LiveKit External Auth-Gate Operations Doc (G05)

### Community 263 - "Community 263"
Cohesion: 1.00
Nodes (1): VoiceRoom monitoring agent

### Community 264 - "Community 264"
Cohesion: 1.00
Nodes (1): OCI Runtime Publication Doc

### Community 265 - "Community 265"
Cohesion: 1.00
Nodes (1): packages/CLAUDE.md Guidance

### Community 266 - "Community 266"
Cohesion: 1.00
Nodes (1): Production Digest Promotion Doc

### Community 267 - "Community 267"
Cohesion: 1.00
Nodes (1): Release 2.5.0 Repairs README

## Knowledge Gaps
- **1938 isolated node(s):** `crypto`, `{ transaction }`, `{ verifyPassword }`, `{
  ACCOUNT_DELETION_GRACE_MS,
  DELETED_ACCOUNT_NAME,
  DELETED_LOGIN_PREFIX
}`, `PERSONAL_DATA_CLEANUP` (+1933 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 44`** (2 nodes): `13254ae docs: document durable room storage`, `c860746 feat(web): add static rooms and room chat UI`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 122`** (2 nodes): `AvatarCropDialogProps`, `AvatarCropShape`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 162`** (1 nodes): `ScreenRecoveryGraceController`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 182`** (1 nodes): `lang`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 211`** (2 nodes): `require`, `ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 214`** (1 nodes): `TestMediaStream`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 221`** (1 nodes): `LiveKitReconcileGeneration`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 222`** (2 nodes): `o`, `s()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 223`** (2 nodes): `participantContextMenu`, `ParticipantMenuVariant`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 228`** (1 nodes): `FakeBroadcastChannel`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 229`** (1 nodes): `FakeServer`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 234`** (2 nodes): `applyRoomSwitchDecision()`, `writeRoomSwitchConfirmEnabled()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 235`** (2 nodes): `ToastOptions`, `toastState`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 238`** (1 nodes): `VoiceRoomDesktopAudioSourceProcessor`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 240`** (1 nodes): `FakeSocket`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 241`** (1 nodes): `FakeClient`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 242`** (1 nodes): `FakeSocket`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 245`** (1 nodes): `registerDmHistoryRoutes()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 246`** (1 nodes): `registerModerationRoutes()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 247`** (1 nodes): `roomSettingsUi`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 248`** (2 nodes): `extensions`, `files`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 249`** (2 nodes): `NAME_SITES`, `webRoot`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 252`** (1 nodes): `root`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 253`** (1 nodes): `FakeTimers`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 254`** (2 nodes): `VoiceRoom App Icon (Owl Mascot Mark on Dark Rounded Square)`, `VoiceRoom Mascot Mark (Masked Owl Silhouette, Transparent)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 255`** (1 nodes): `ADR: Unicode authority for message reactions`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 256`** (1 nodes): `VoiceRoom 2.5 Architecture Boundaries`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 257`** (1 nodes): `Backlog`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 258`** (1 nodes): `config/capability-dag.v1.json`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 259`** (1 nodes): `Capability Readiness Doc`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 260`** (1 nodes): `Design QA — reusable room and chat menus`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 261`** (1 nodes): `Font Assets README`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 262`** (1 nodes): `LiveKit External Auth-Gate Operations Doc (G05)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 263`** (1 nodes): `VoiceRoom monitoring agent`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 264`** (1 nodes): `OCI Runtime Publication Doc`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 265`** (1 nodes): `packages/CLAUDE.md Guidance`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 266`** (1 nodes): `Production Digest Promotion Doc`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 267`** (1 nodes): `Release 2.5.0 Repairs README`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `RealtimeRecoveryController` connect `Community 56` to `Community 5`?**
  _High betweenness centrality (0.007) - this node is a cross-community bridge._
- **What connects `crypto`, `{ transaction }`, `{ verifyPassword }` to the rest of the system?**
  _1938 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.009317339789442793 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.013223229706390328 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.015441591864917456 - nodes in this community are weakly interconnected._
- **Should `Community 3` be split into smaller, more focused modules?**
  _Cohesion score 0.024544920728126834 - nodes in this community are weakly interconnected._
- **Should `Community 4` be split into smaller, more focused modules?**
  _Cohesion score 0.02087239095113111 - nodes in this community are weakly interconnected._