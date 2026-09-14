# Graph Report - .  (2026-09-14)

## Corpus Check
- Large corpus: 790 files · ~384 545 words. Semantic extraction will be expensive (many Claude tokens). Consider running on a subfolder, or use --no-semantic to run AST-only.

## Summary
- 6355 nodes · 17980 edges · 226 communities detected
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 6 edges (avg confidence: 0.73)
- Token cost: 0 input · 0 output
- Edge kinds: contains: 4768 · MODIFIES: 4477 · ON_BRANCH: 3843 · calls: 1940 · imports: 1157 · imports_from: 785 · PARENT_OF: 703 · method: 208 · re_exports: 59 · references: 23 · inherits: 10 · conceptually_related_to: 4 · semantically_similar_to: 2 · implements: 1


## Input Scope
- Requested: auto
- Resolved: committed (source: default-auto)
- Included files: 790 · Candidates: 872
- Excluded: 6 untracked · 48062 ignored · 13 sensitive · 2 missing committed
- Recommendation: Use --scope all or graphify.yaml inputs.corpus for a knowledge-base folder.

## Graph Freshness
- Built from Git commit: `f63f951`
- Compare this hash to `git rev-parse HEAD` before trusting freshness-sensitive graph output.
## God Nodes (most connected - your core abstractions)
1. `sendJson()` - 86 edges
2. `createTestDatabase()` - 45 edges
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

### Community 34 - "Community 34"
Cohesion: 0.05
Nodes (30): crypto, { transaction }, { verifyPassword }, {
  ACCOUNT_DELETION_GRACE_MS,
  DELETED_ACCOUNT_NAME,
  DELETED_LOGIN_PREFIX
}, PERSONAL_DATA_CLEANUP, createAccountDeletionRepository(), { socketPathForDirectory }, test (+22 more)

### Community 106 - "Community 106"
Cohesion: 0.16
Nodes (14): http, net, { URL }, { createDbPool }, { createGateCredentialSigner }, { createCredentialBoundaryService }, { createRoomStore }, normalizeGatePath() (+6 more)

### Community 25 - "Community 25"
Cohesion: 0.06
Nodes (38): createLinkPreviewRepository(), crypto, { firstPreviewableUrl, normalizeLinkPreview }, { decodeHtmlBody, extractLinkPreviewMetadata }, createLinkPreviewService(), { normalizeLinkPreview }, { createDbPool }, createRoomHistoryRepository() (+30 more)

### Community 131 - "Community 131"
Cohesion: 0.17
Nodes (8): crypto, CONTEXTS, MIME_TYPES, mapAttachment(), test, assert, {
  createAttachmentRepository,
  mapAttachment
}, ROW

### Community 18 - "Community 18"
Cohesion: 0.04
Nodes (58): createAttachmentRepository(), readDatabaseConfig(), { Client }, fs, path, { PG_MIGRATE_LOCK_ID, runner }, { readDatabaseConfig }, DEFAULT_MIGRATIONS_DIR (+50 more)

### Community 113 - "Community 113"
Cohesion: 0.16
Nodes (9): crypto, JOB_KINDS, MediaJobFenceError, mapMediaJob(), createMediaJobRepository(), test, assert, {
  MediaJobFenceError,
  createMediaJobRepository,
  mapMediaJob
} (+1 more)

### Community 154 - "Community 154"
Cohesion: 0.27
Nodes (7): createMediaMaintenanceService(), createMediaMaintenanceWorker(), main(), assert, test, { createMediaMaintenanceService }, { createMediaMaintenanceWorker }

### Community 41 - "Community 41"
Cohesion: 0.06
Nodes (33): fs, createMediaPressureService(), httpRequests, maintenanceTasks, mediaPressure, labels(), metricLine(), httpKey() (+25 more)

### Community 4 - "Community 4"
Cohesion: 0.02
Nodes (46): createMediaQuotaRepository(), MediaQuotaError, createMediaQuotaService(), createDirectMessageRepository(), registerDmHistoryRoutes(), { buildMessageDeliveryEvent }, registerRoomHistoryRoutes(), createRoomMessageRepository() (+38 more)

### Community 24 - "Community 24"
Cohesion: 0.05
Nodes (46): createMediaReconciliationService(), sharp, FORMAT_MIME, PNG_END, MediaServiceError, readBounded(), detectExactContainer(), createMediaService() (+38 more)

### Community 30 - "Community 30"
Cohesion: 0.04
Nodes (33): registerMediaRoutes(), MediaVisibilityError, createMediaVisibilityService(), http, { renderPrometheus }, startWorkerMetricsServer(), { startWorkerMetricsServer }, { startWorkerHeartbeat } (+25 more)

### Community 167 - "Community 167"
Cohesion: 0.32
Nodes (6): { buildMembershipEnvelope, normalizeMembershipRequest }, presenceForUser(), createMemberDirectoryService(), assert, { test }, { createMemberDirectoryService, presenceForUser }

### Community 65 - "Community 65"
Cohesion: 0.09
Nodes (20): crypto, toMillis(), mapMembership(), mapDirectoryMember(), createMembershipRepository(), registerMembershipRoutes(), { transaction }, { createMembershipRepository } (+12 more)

### Community 162 - "Community 162"
Cohesion: 0.25
Nodes (7): {
  normalizeRoomMessageContent,
  projectRoomMessageContent
}, projectStoredRoomMessage(), assert, fs, path, test, {projectStoredRoomMessage}

### Community 163 - "Community 163"
Cohesion: 0.25
Nodes (7): {
  contentFromLegacyText,
  normalizeRoomMessageContent,
  projectRoomMessageContent
}, createContentRepository(), assert, fs, path, test, {createContentRepository}

### Community 192 - "Community 192"
Cohesion: 0.33
Nodes (2): { createDbPool }, createDmHistoryRepository()

### Community 27 - "Community 27"
Cohesion: 0.05
Nodes (36): {
  buildHistoryEnvelope,
  normalizeHistoryRequest
}, { normalizeLinkPreview }, DmHistoryError, canonicalParticipants(), createDmHistoryService(), MessageReadError, createMessageReadService(), {
  buildHistoryEnvelope,
  normalizeHistoryRequest
} (+28 more)

### Community 89 - "Community 89"
Cohesion: 0.13
Nodes (12): crypto, IdempotencyConflictError, IdempotencyQuotaError, boundedString(), normalizeIdentity(), encodeParts(), ledgerKey(), actorLockKey() (+4 more)

### Community 104 - "Community 104"
Cohesion: 0.14
Nodes (12): crypto, { buildMessageDeliveryEvent }, MessageDeliveryFenceError, requireQuery(), encodeParts(), logicalKey(), createMessageOutboxRepository(), assert (+4 more)

### Community 16 - "Community 16"
Cohesion: 0.03
Nodes (58): { createDbPool, transaction }, { transaction }, { buildNotificationEnvelope, buildProviderPayload, normalizeNotificationLevel, normalizeNotificationLimit }, createNotificationService(), { Pool }, { readDatabaseConfig }, { recordPgPoolError }, createDbPool() (+50 more)

### Community 2 - "Community 2"
Cohesion: 0.01
Nodes (190): createMessageReadRepository(), registerPinRoutes(), createFriendStore(), crypto, fastifyCookie, fastifyMultipart, fastifyWebsocket, { buildRoomMembershipPresenceSnapshot, createConnectionRegistry } (+182 more)

### Community 45 - "Community 45"
Cohesion: 0.08
Nodes (30): { ReplyTargetUnavailableError }, REPLY_CONFLICT_BODY, createMessageReplyHandlers(), registerMessageReplyRoutes(), { REPLY_PREVIEW_TEXT_MAX_LENGTH, isSystemCard }, ReplyTargetUnavailableError, toMillis(), messageId() (+22 more)

### Community 71 - "Community 71"
Cohesion: 0.09
Nodes (18): { createMessageVisibilityService }, createMessageService(), MessageVisibilityError, createMessageVisibilityService(), assert, fs, path, { test } (+10 more)

### Community 205 - "Community 205"
Cohesion: 0.60
Nodes (4): requireQuery(), toMillis(), mapPin(), createPinRepository()

### Community 176 - "Community 176"
Cohesion: 0.43
Nodes (5): PinServiceError, normalizeRoomId(), normalizeMessageId(), requireAccount(), createPinService()

### Community 66 - "Community 66"
Cohesion: 0.09
Nodes (19): createReactionRealtimeAdapter(), registerReactionRoutes(), {
  normalizeReactionMutation,
  normalizeReactionSummary,
  normalizeReactorPage,
  normalizeReactorQuery
}, ReactionServiceError, normalizeConversation(), createReactionService(), assert, test (+11 more)

### Community 177 - "Community 177"
Cohesion: 0.33
Nodes (3): CONTEXT_TABLES, requireQuery(), createReactionRepository()

### Community 69 - "Community 69"
Cohesion: 0.10
Nodes (18): crypto, toMillis(), mapActiveBan(), normalizePrincipal(), createActiveBanRepository(), { transaction }, { createActiveBanRepository, normalizePrincipal }, createActiveBanService() (+10 more)

### Community 147 - "Community 147"
Cohesion: 0.27
Nodes (8): { transaction }, requireOperation(), attachmentRevoker(), cleanupEnqueuer(), createMessageModerationService(), test, assert, { createMessageModerationService }

### Community 12 - "Community 12"
Cohesion: 0.03
Nodes (42): crypto, toMillis(), mapBanProfile(), mapModerationBan(), createModerationRepository(), {
  buildModerationPage,
  durationToExpiresAt,
  normalizeBanMutation,
  normalizeIdempotencyKey,
  normalizeModerationPageRequest
}, { transaction }, { createModerationRepository } (+34 more)

### Community 219 - "Community 219"
Cohesion: 0.50
Nodes (1): registerModerationRoutes()

### Community 64 - "Community 64"
Cohesion: 0.08
Nodes (18): crypto, { transaction }, createInboxRepository(), assert, {Pool}, test, {runMigrations}, {createInboxRepository} (+10 more)

### Community 207 - "Community 207"
Cohesion: 0.40
Nodes (2): crypto, createMentionRepository()

### Community 6 - "Community 6"
Cohesion: 0.02
Nodes (85): crypto, NotificationFenceError, createNotificationOutboxRepository(), createNotificationPushProvider(), path, readEnvInt(), readEnvBool(), readMessageDeliveryMode() (+77 more)

### Community 57 - "Community 57"
Cohesion: 0.10
Nodes (24): { createPushService }, crypto, EXACT_PUSH_HOSTS, isAllowedPushHost(), cleanPushEndpoint(), describePushEndpoint(), webPush, { PLATFORM_CLASSES } (+16 more)

### Community 140 - "Community 140"
Cohesion: 0.24
Nodes (10): crypto, sharp, { deriveAvatarAccent, dominantAvatarColor }, detectAvatarFormat(), processAvatar(), createAvatarKey(), test, assert (+2 more)

### Community 3 - "Community 3"
Cohesion: 0.03
Nodes (33): reconcileAvatarStorage(), test, assert, { reconcileAvatarStorage }, AvatarCropShape, AvatarCropDialogProps, AvatarProps, BadgeProps (+25 more)

### Community 42 - "Community 42"
Cohesion: 0.05
Nodes (33): fs, path, { readUploadsDir }, AVATAR_KEY_PATTERN, validateAvatarKey(), createAvatarStorage(), readUploadsDir(), crypto (+25 more)

### Community 13 - "Community 13"
Cohesion: 0.03
Nodes (52): crypto, { createDbPool, transaction }, { cleanAvatarColorKey, cleanPresenceStatus }, { normalizeLinkPreview }, toMillis(), mapPublicUser(), mapInvite(), mapMessage() (+44 more)

### Community 120 - "Community 120"
Cohesion: 0.19
Nodes (10): fs, net, namesOf(), placeName(), formatLocation(), createGeoLocator(), test, assert (+2 more)

### Community 96 - "Community 96"
Cohesion: 0.12
Nodes (13): dns, http, https, net, REDIRECT_STATUSES, BLOCKED_SUBNETS, isPublicAddress(), createLinkPreviewFetcher() (+5 more)

### Community 8 - "Community 8"
Cohesion: 0.03
Nodes (52): fs, net, startApiListener(), test, assert, fs, os, path (+44 more)

### Community 87 - "Community 87"
Cohesion: 0.13
Nodes (15): recordMediaOldestPending(), crypto, sharp, { MediaJobFenceError }, { recordMediaOldestPending }, DEFAULTS, retryDelay(), transform() (+7 more)

### Community 130 - "Community 130"
Cohesion: 0.21
Nodes (9): crypto, hasLeadingZeroBits(), parsePowChallenge(), normalizePowNonce(), createProofOfWork(), test, assert, crypto (+1 more)

### Community 166 - "Community 166"
Cohesion: 0.32
Nodes (5): getClientIp(), createRateLimiter(), test, assert, { getClientIp, createRateLimiter }

### Community 22 - "Community 22"
Cohesion: 0.05
Nodes (45): crypto, { createDbPool, transaction }, { createActiveBanService }, {
  AVATAR_COLOR_KEYS,
  cleanAvatarColorKey
}, { normalizeLinkPreview }, normalizePositiveInt(), toDate(), toMillis() (+37 more)

### Community 11 - "Community 11"
Cohesion: 0.03
Nodes (68): crypto, { createDbPool, transaction }, { hashPassword, verifyPassword }, { AVATAR_COLOR_KEYS, cleanAvatarColorKey, cleanPresenceStatus }, {
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
}, toMillis(), mapUser(), publicUser() (+60 more)

### Community 60 - "Community 60"
Cohesion: 0.09
Nodes (6): ContextMenuContentState, ContextMenuProps, root, ReactionEmojiGroup, 2ea3623 Merge pull request #116 from dazeGG/feature/2.5.0-manual-fixes, c80ed8a feat(web): expand contextual menus

### Community 1 - "Community 1"
Cohesion: 0.01
Nodes (163): { socketPathForDirectory }, test, assert, fs, http, { spawn }, path, os (+155 more)

### Community 17 - "Community 17"
Cohesion: 0.03
Nodes (58): test, assert, crypto, fs, path, { Pool }, { runMigrations }, { createUserStore } (+50 more)

### Community 53 - "Community 53"
Cohesion: 0.09
Nodes (17): WhatsNewIcon, WhatsNewItem, WHATS_NEW_ITEMS, webRoot, assert, path, { pathToFileURL }, test (+9 more)

### Community 81 - "Community 81"
Cohesion: 0.11
Nodes (17): { PUBLIC_CAPABILITY_KEYS }, HEALTH_CAPABILITIES_LIMITS, publicFeatureFlags(), formatCapabilityPayload(), registerCapabilityRoutes(), createCapabilitySnapshot(), assert, { mkdtempSync, readFileSync, writeFileSync } (+9 more)

### Community 72 - "Community 72"
Cohesion: 0.15
Nodes (22): crypto, { existsSync, readFileSync }, path, {
  normalizeManifest,
  PUBLIC_CAPABILITY_KEYS,
  OPERATOR_KEYS,
  toSet
}, resolveManifestPath(), sha256Hex(), readManifestText(), asSet() (+14 more)

### Community 59 - "Community 59"
Cohesion: 0.08
Nodes (25): createRuntimeReadinessRepository(), { PUBLIC_CAPABILITY_KEYS }, { createReadinessReport, resolveManifestPath }, { createRuntimeReadinessRepository }, failClosedSnapshot(), createRuntimeReadinessProvider(), os, { createDbPool } (+17 more)

### Community 73 - "Community 73"
Cohesion: 0.10
Nodes (17): { buildServerEnvelope }, toWsAccountEvent(), { buildServerEnvelope }, legacyPeerMessageToWs(), crypto, { cleanPresenceStatus }, { buildServerEnvelope, sendWsEnvelope }, { toWsAccountEvent } (+9 more)

### Community 40 - "Community 40"
Cohesion: 0.07
Nodes (38): {
  parseClientEnvelope,
  buildServerEnvelope,
  buildServerErrorEnvelope,
  validateClientCommand
}, serializeEnvelope(), sendWsEnvelope(), parseInboundMessage(), crypto, createTransportId(), createWsTransport(), { SUMMARY_COALESCE_MS } (+30 more)

### Community 122 - "Community 122"
Cohesion: 0.15
Nodes (9): resolveViewedScreenPeerId(), clearViewedScreenPeerReferences(), test, assert, {
  clearViewedScreenPeerReferences,
  createRoomRealtimeRuntime,
  resolveViewedScreenPeerId
}, OWNER_TOKEN, VIEWER_TOKEN, createRuntime() (+1 more)

### Community 123 - "Community 123"
Cohesion: 0.15
Nodes (10): createWsHandler(), test, assert, { EventEmitter }, { createWsHandler }, TOKEN_A, TOKEN_B, FakeSocket (+2 more)

### Community 61 - "Community 61"
Cohesion: 0.09
Nodes (25): fastify, getLogLevel(), createFastifyLoggerOptions(), resolveCursorHmacKeys(), getHistoryServices(), getReactionServices(), getNotificationServices(), getModerationServices() (+17 more)

### Community 127 - "Community 127"
Cohesion: 0.14
Nodes (14): resolveRealtimeReconnectLeaseMs(), getPresenceRoom(), attachPresence(), createRoomId(), pruneRooms(), startPruneTimer(), createRoomForRequest(), getRoom() (+6 more)

### Community 48 - "Community 48"
Cohesion: 0.10
Nodes (40): getRoomStore(), getCredentialBoundary(), getLiveKitCredentialProvider(), getAvatarStorage(), sessionAvatarColorKey(), getLiveKitRoomName(), getLiveKitConfig(), getLiveKitHttpUrl() (+32 more)

### Community 37 - "Community 37"
Cohesion: 0.12
Nodes (47): getUserStore(), getGeoLocator(), getAccountDeletionRepository(), sendJson(), resolveSessionUser(), sessionDeviceFor(), describeLoginDevice(), recordAndAnnounceLogin() (+39 more)

### Community 55 - "Community 55"
Cohesion: 0.16
Nodes (35): getFriendStore(), getMessageService(), getNotificationStore(), broadcastToUser(), notificationActor(), queuePush(), sendFriendPush(), broadcastDmNotification() (+27 more)

### Community 56 - "Community 56"
Cohesion: 0.12
Nodes (34): release250FeatureEnabled(), getRelease250Pool(), getPinServices(), refreshPinsAfterMessageMutation(), getMessageDeliveryServices(), requestIdempotencyKey(), dispatchMessageDeliveryEvent(), startMessageDeliveryListener() (+26 more)

### Community 182 - "Community 182"
Cohesion: 0.38
Nodes (7): getPushStore(), getPushService(), handlePushConfig(), cleanPushSubscription(), checkPushSubscriptionRate(), handleCreatePushSubscription(), handleDeletePushSubscription()

### Community 97 - "Community 97"
Cohesion: 0.14
Nodes (16): { socketPathForDirectory }, test, assert, fs, http, { spawn }, path, os (+8 more)

### Community 116 - "Community 116"
Cohesion: 0.14
Nodes (12): { socketPathForDirectory }, test, assert, fs, http, { spawn }, path, os (+4 more)

### Community 184 - "Community 184"
Cohesion: 0.29
Nodes (4): test, assert, { TrackSource }, { __private, createApiApp }

### Community 98 - "Community 98"
Cohesion: 0.11
Nodes (12): test, assert, { EventEmitter }, fs, net, path, { spawnSync }, { createApiApp } (+4 more)

### Community 74 - "Community 74"
Cohesion: 0.11
Nodes (17): assert, fs, os, path, test, normalizePath(), walkFiles(), globToRegExp() (+9 more)

### Community 214 - "Community 214"
Cohesion: 0.40
Nodes (1): FakeClient

### Community 215 - "Community 215"
Cohesion: 0.40
Nodes (4): assert, fs, path, { test }

### Community 216 - "Community 216"
Cohesion: 0.40
Nodes (4): assert, fs, path, { test }

### Community 185 - "Community 185"
Cohesion: 0.29
Nodes (6): assert, fs, path, { test }, { readMessageDeliveryMode }, { createReadinessReport }

### Community 54 - "Community 54"
Cohesion: 0.06
Nodes (21): assert, { Pool }, { test }, { runMigrations }, { createTestDatabase }, assert, fs, net (+13 more)

### Community 217 - "Community 217"
Cohesion: 0.40
Nodes (4): assert, fs, path, test

### Community 139 - "Community 139"
Cohesion: 0.17
Nodes (10): test, assert, fs, path, repositoryRoot, profile, 166a0e8 test(release): resolve rescue fixtures from repository root, 5dd3691 test(api): serialize database suites (+2 more)

### Community 92 - "Community 92"
Cohesion: 0.11
Nodes (17): test, assert, crypto, fs, os, path, { Pool }, { runMigrations } (+9 more)

### Community 200 - "Community 200"
Cohesion: 0.33
Nodes (1): FakeServer

### Community 117 - "Community 117"
Cohesion: 0.13
Nodes (6): assert, { EventEmitter }, net, test, { createLiveKitAuthGateService }, FakeSocket

### Community 52 - "Community 52"
Cohesion: 0.08
Nodes (30): assert, crypto, fs, path, test, ROOT, EXPECTED, sha256() (+22 more)

### Community 83 - "Community 83"
Cohesion: 0.12
Nodes (16): { socketPathForDirectory }, test, assert, crypto, fs, http, os, path (+8 more)

### Community 100 - "Community 100"
Cohesion: 0.11
Nodes (12): test, assert, Fastify, { Pool }, { createPinRepository }, { createPinService }, { registerPinRoutes }, { createRoomStore } (+4 more)

### Community 84 - "Community 84"
Cohesion: 0.12
Nodes (14): { socketPathForDirectory }, test, assert, fs, http, os, path, { createApiApp, createApiServer } (+6 more)

### Community 187 - "Community 187"
Cohesion: 0.29
Nodes (4): assert, fs, path, test

### Community 201 - "Community 201"
Cohesion: 0.33
Nodes (4): assert, fs, path, test

### Community 150 - "Community 150"
Cohesion: 0.18
Nodes (5): test, assert, http, { __private, createApiServer }, { openWs, joinVoiceRoom, sendWs, waitForWsType }

### Community 58 - "Community 58"
Cohesion: 0.16
Nodes (18): store, summary, reactors, room, dm, uniqueLogin(), authDialog(), registerViaUi() (+10 more)

### Community 0 - "Community 0"
Cohesion: 0.06
Nodes (334): emojiAssetName(), emojiAssetUrl(), root, webRoot, getServer(), loadService(), webRoot, webRoot (+326 more)

### Community 86 - "Community 86"
Cohesion: 0.11
Nodes (15): BLOCKED_ROUTES, assert, fs, path, { pathToFileURL }, test, cjs, CORPUS (+7 more)

### Community 218 - "Community 218"
Cohesion: 0.50
Nodes (3): router, sw, desktop

### Community 125 - "Community 125"
Cohesion: 0.19
Nodes (11): require, webRoot, outputDir, catalogueFile, packageRoot, graphicsLicenceFile, { version }, assetName() (+3 more)

### Community 29 - "Community 29"
Cohesion: 0.06
Nodes (16): Window, webRoot, getServer(), loadService(), 0b7bfc9 feat(web): add a desktop overlay for borderless games (#134), 1ae08e2 chore(release): back-merge 2.5.12 into develop, 253c24d feat(web): overlay avatar size and panel hints (#138), 3fa3f2e chore(release): back-merge 2.5.10 into develop (+8 more)

### Community 50 - "Community 50"
Cohesion: 0.09
Nodes (18): AttachmentContext, AttachmentDraftState, AttachmentDraft, Envelope, AttachmentApiError, createAttachmentSlot(), uploadAttachmentContent(), getAttachmentStatus() (+10 more)

### Community 46 - "Community 46"
Cohesion: 0.09
Nodes (37): RoomRelationship, OwnedRoom, avatarRequest(), uploadUserAvatar(), deleteUserAvatar(), Credentials, RegisterInput, authPost() (+29 more)

### Community 118 - "Community 118"
Cohesion: 0.15
Nodes (3): AccountSecurity, sessionDeviceLabel(), SecureAccountTarget

### Community 159 - "Community 159"
Cohesion: 0.28
Nodes (5): BlockStatus, blockUrl(), blockUser(), unblockUser(), getJsonAuth()

### Community 85 - "Community 85"
Cohesion: 0.15
Nodes (14): CapabilityKey, CapabilityFeatures, CapabilityResponse, loadCapabilities(), resetCapabilities(), isCapabilityReady(), CapabilityEdge, CapabilityState (+6 more)

### Community 151 - "Community 151"
Cohesion: 0.24
Nodes (4): DesktopAsset, DesktopRelease, DesktopBuild, DESKTOP_BUILDS

### Community 14 - "Community 14"
Cohesion: 0.05
Nodes (71): DirectMessageInvite, DirectMessageHistoryPage, HistoryMessageDto, fetchThread(), fetchThreadPage(), sendDirectMessage(), markThreadRead(), deleteDirectMessage() (+63 more)

### Community 128 - "Community 128"
Cohesion: 0.21
Nodes (12): DirectMessage, ThreadSnapshot, ThreadMutation, ActiveResync, ThreadResyncOptions, ResyncRequestOptions, newestTimestamp(), contentVersion() (+4 more)

### Community 101 - "Community 101"
Cohesion: 0.23
Nodes (15): FetchMembershipsOptions, fetchRoomMemberships(), leaveRoomMembership(), RoomMembershipEntry, roomMembershipState, emptyEntry(), cacheKey(), readCache() (+7 more)

### Community 93 - "Community 93"
Cohesion: 0.18
Nodes (14): roomModerationUrl(), parsePage(), responseJson(), fetchActiveBans(), putBan(), unban(), deleteModeratedMessage(), ModerationNoticeOptions (+6 more)

### Community 35 - "Community 35"
Cohesion: 0.08
Nodes (35): NotificationPreferences, NotificationPreferencesResponse, NotificationMuteResponse, fetchNotificationPreferences(), setDmNotificationsMuted(), setRoomNotificationsMuted(), setPrivateNotifications(), setDoNotDisturb() (+27 more)

### Community 102 - "Community 102"
Cohesion: 0.18
Nodes (12): PinnedMessageAuthor, PinnedMessage, PinSnapshot, PinResponse, pinAuthor(), pinUrl(), fetchRoomPins(), pinRoomMessage() (+4 more)

### Community 68 - "Community 68"
Cohesion: 0.13
Nodes (22): PushConfig, fetchPushConfig(), savePushSubscription(), deletePushSubscription(), pushNotifications, syncQueue, decodeVapidKey(), getRegistration() (+14 more)

### Community 112 - "Community 112"
Cohesion: 0.23
Nodes (11): ReactionConversation, reactionUrl(), validSummaries(), fetchReactionSummaries(), setReactionDesired(), fetchReactors(), ReactionSnapshotView, replaceReactionSnapshot() (+3 more)

### Community 77 - "Community 77"
Cohesion: 0.09
Nodes (3): RealtimeHeartbeatWatchdog, lang, 925763f feat(web): security settings, recovery by code and the 2.6.0 onboarding

### Community 15 - "Community 15"
Cohesion: 0.04
Nodes (51): RoomRealtimeSummary, RoomPeer, roomPresence, roomChatReadSessions, roomChatIsBeingRead(), applyRoomSummary(), setRoomUnreadCount(), beginRoomChatReadSession() (+43 more)

### Community 38 - "Community 38"
Cohesion: 0.06
Nodes (24): RoomSnapshot, RealtimeEvent, wsUrl(), AppRealtimeConnection, getAppRealtime(), connectRealtime(), RoomDetailHandler, previewSubscriptions (+16 more)

### Community 189 - "Community 189"
Cohesion: 0.60
Nodes (5): ChatMessage, presenceFor(), participantProfilePerson(), roomMessageProfilePerson(), mentionProfilePerson()

### Community 7 - "Community 7"
Cohesion: 0.03
Nodes (31): state, ToastOptions, guestNameUi, participantsUi, getSortedParticipants(), getParticipantCount(), getFocusedParticipant(), startUi (+23 more)

### Community 9 - "Community 9"
Cohesion: 0.03
Nodes (39): API_PROXY, 01a206a chore: release v2.1.1, 0a0699b chore: release v2.1.2, 0a9be62 fix(web): keep room preview chat closed by default (#32), 0d30394 chore: merge v2.1.1 back to develop, 0d74cad Merge branch 'release/2.1.6', 0f3d7a0 Merge branch 'hotfix/2.1.3', 0ffac54 feat(infra): expose livekit prometheus metrics for status stack (#22) (+31 more)

### Community 108 - "Community 108"
Cohesion: 0.15
Nodes (5): profileCardUi, ProfileCardAnchor, ProfileCardPerson, ProfileCardRelationship, ProfileCardProps

### Community 141 - "Community 141"
Cohesion: 0.24
Nodes (6): pad(), formatTime(), MONTHS, startOfDay(), isSameDay(), formatChatDayLabel()

### Community 109 - "Community 109"
Cohesion: 0.20
Nodes (12): RoomShellMode, roomNavigation, getActiveVoiceRoomId(), connectedRoomIsViewed(), embeddedRoomIsVisible(), setViewedRoomFromRoute(), routeToRoom(), selectRoomPreview() (+4 more)

### Community 206 - "Community 206"
Cohesion: 0.50
Nodes (2): writeRoomSwitchConfirmEnabled(), applyRoomSwitchDecision()

### Community 10 - "Community 10"
Cohesion: 0.04
Nodes (80): DeviceOption, NoiseOption, NOISE_OPTIONS, SoundSettings, isGateDisabled(), gateValueLabel(), readDeviceId(), readSoundSettings() (+72 more)

### Community 63 - "Community 63"
Cohesion: 0.12
Nodes (18): cleanDisplayName(), getDisplayName(), saveStartName(), saveNameFromValue(), handleGuestNameSubmit(), requestGuestNameForRoom(), clearPendingGuestNameRequest(), resetGuestNameDialog() (+10 more)

### Community 5 - "Community 5"
Cohesion: 0.03
Nodes (111): NoiseModeOption, SCREEN_STREAM_MODE_PROFILES, ScreenQualityOption, SCREEN_QUALITY_OPTIONS, SCREEN_QUALITY_ORDER, SCREEN_SIMULCAST_LAYER, ScreenFpsOption, SCREEN_FPS_OPTIONS (+103 more)

### Community 19 - "Community 19"
Cohesion: 0.05
Nodes (62): isRoomEmbedded(), extractRoomId(), ApiRequestError, postJson(), checkRoomExists(), RecoveryAttemptOutcome, RoomRecoveryLiveKitAdapter, transitionHandlers (+54 more)

### Community 26 - "Community 26"
Cohesion: 0.06
Nodes (38): HotkeyAction, getHotkeyStorageKey(), getDefaultHotkeyBinding(), readHotkeyBinding(), writeHotkeyBinding(), parseHotkeyBinding(), eventMatchesHotkey(), isTypingTarget() (+30 more)

### Community 44 - "Community 44"
Cohesion: 0.08
Nodes (30): getRoomIdFromPath(), createPeerId(), createSessionToken(), getStoredPeerSession(), rotateStoredPeerSession(), PeerSession, DesktopCaptureSource, ScreenStatsSnapshot (+22 more)

### Community 21 - "Community 21"
Cohesion: 0.06
Nodes (59): persistMicrophoneVolume(), dbToAmplitude(), MicProcessor, MicrophoneCapture, disconnectAudioNode(), refreshMicrophoneLevelMeterSoon(), attachMeter(), startMeters() (+51 more)

### Community 70 - "Community 70"
Cohesion: 0.11
Nodes (22): persistMicrophoneMode(), persistOutputMuted(), hasLocalScreenAudio(), postState(), supportsAudioOutputSelection(), getLocalMicrophoneCapture(), syncVoiceSessionControls(), CallControlsView (+14 more)

### Community 31 - "Community 31"
Cohesion: 0.09
Nodes (47): getStoredStreamVolume(), storeStreamVolume(), normalizeStoredStreamVolume(), clampStreamVolume(), setScreenAttendance(), clearScreenAttendance(), releaseScreenMediaElement(), releaseScreenAudioFallback() (+39 more)

### Community 174 - "Community 174"
Cohesion: 0.43
Nodes (6): RoomLifecycleSummary, refreshRoomHeadingSoon(), showRoomNotFoundSoon(), applyRoomUpdated(), applyRoomNotFound(), applyRoomDeleted()

### Community 76 - "Community 76"
Cohesion: 0.15
Nodes (22): peerJoinCueTimes, streamViewerCueTimes, isCuePlaybackSuppressed(), getCueGain(), CueNote, playCueSequence(), playDirectMessageCue(), roomChatCueTimes (+14 more)

### Community 20 - "Community 20"
Cohesion: 0.04
Nodes (39): ScreenPublicationPresence, getScreenPublicationPresence(), ScreenReceiverDemand, getScreenReceiverDemand(), SCREEN_SUBSCRIPTION_RETRY_DELAYS_MS, ScreenSubscriptionRetryTarget, ScreenSubscriptionRetryState, ScreenSubscriptionRetryScheduler (+31 more)

### Community 194 - "Community 194"
Cohesion: 0.33
Nodes (1): LiveKitReconcileGeneration

### Community 47 - "Community 47"
Cohesion: 0.13
Nodes (10): DEFAULT_RETRY_DELAYS_MS, TERMINAL_CODES, RETRYABLE_CODES, SAFE_CODES, sanitizeRecoveryCode(), classifyRecoveryFailure(), elapsedBucket(), RealtimeRecoveryController (+2 more)

### Community 143 - "Community 143"
Cohesion: 0.21
Nodes (1): ScreenRecoveryGraceController

### Community 39 - "Community 39"
Cohesion: 0.11
Nodes (44): watchedRemoteScreenTracks, streamCueTimes, attachMeterSoon(), syncLiveKitScreenSubscriptionsSoon(), disconnectScreenSoon(), hideScreenStageSoon(), refreshAllScreenActionsSoon(), refreshScreenStageSoon() (+36 more)

### Community 23 - "Community 23"
Cohesion: 0.09
Nodes (54): detachRemoteAudioTrack(), screenSubscriptionRetryController, screenRecoveryGrace, liveKitReconcileGenerations, reconcileGenerationFor(), connectLiveKitRoom(), attemptFreshLiveKitReplacement(), isRetryableLiveKitApiFailure() (+46 more)

### Community 36 - "Community 36"
Cohesion: 0.04
Nodes (2): 13254ae docs: document durable room storage, c860746 feat(web): add static rooms and room chat UI

### Community 196 - "Community 196"
Cohesion: 0.33
Nodes (2): ParticipantMenuVariant, participantContextMenu

### Community 124 - "Community 124"
Cohesion: 0.14
Nodes (3): LeaveHandler, ControlHandler, voiceSession

### Community 168 - "Community 168"
Cohesion: 0.43
Nodes (7): DesktopAutostartSettings, DesktopAutostartPatch, getBridge(), normalizeSettings(), desktopAutostartAvailable(), readDesktopAutostartSettings(), updateDesktopAutostartSettings()

### Community 169 - "Community 169"
Cohesion: 0.36
Nodes (7): DesktopCallState, DesktopCallAction, CALL_ACTIONS, getBridge(), toPayload(), syncDesktopCallState(), bindDesktopCallActions()

### Community 178 - "Community 178"
Cohesion: 0.48
Nodes (6): DesktopDiagnosticsContext, getBridge(), desktopDiagnosticsAvailable(), openDesktopLogsFolder(), copyDesktopDiagnostics(), syncDesktopDiagnosticsContext()

### Community 193 - "Community 193"
Cohesion: 0.47
Nodes (5): DesktopLink, getBridge(), matches(), normalizeDesktopLink(), bindDesktopLinks()

### Community 121 - "Community 121"
Cohesion: 0.19
Nodes (11): BridgeResult, DesktopBridge, resolveBridge(), showDesktopNotification(), RuntimeWindow, browserNavigator(), collectPlatformSignals(), classifyPlatform() (+3 more)

### Community 80 - "Community 80"
Cohesion: 0.16
Nodes (21): OVERLAY_ANCHORS, OverlayAnchor, OVERLAY_AVATAR_SIZES, OverlayAvatarSize, DesktopOverlayParticipant, DesktopOverlaySettings, DesktopOverlayForeground, DesktopOverlayPatch (+13 more)

### Community 155 - "Community 155"
Cohesion: 0.22
Nodes (5): markInAppRoomNavigation(), PRODUCTION_HOSTS, OpenInAppSignals, resolveAppLinkScheme(), buildAppRoomLink()

### Community 132 - "Community 132"
Cohesion: 0.26
Nodes (11): configCache, RuntimeConfigOptions, SENSITIVE_KEY_PATTERNS, hasSuspiciousSecrets(), resolveConfigOrigin(), resolveConfigUrl(), cacheKey(), defaultConfig() (+3 more)

### Community 62 - "Community 62"
Cohesion: 0.09
Nodes (13): ComposerSelection, TYPING_ACTIVITIES, TypingActivity, TypingPerson, PLURAL_VERB, SINGLE_VERB, TypingEntry, webRoot (+5 more)

### Community 129 - "Community 129"
Cohesion: 0.29
Nodes (12): ChatDraftScope, ChatDraft, chatDraftStorageKey(), chatDraftScopeKey(), normalizeMentions(), normalizeChatDrafts(), readDrafts(), writeDrafts() (+4 more)

### Community 153 - "Community 153"
Cohesion: 0.27
Nodes (8): EmojiCategory, OFFERED, isOfferedEmoji(), BROWSABLE_EMOJIS, BROWSABLE_SET, skinToneChoices(), hasSkinToneChoices(), withSkinTone()

### Community 107 - "Community 107"
Cohesion: 0.28
Nodes (15): FrequentReaction, DEFAULT_FREQUENT_REACTIONS, memory, frequentReactionKey(), rankFrequentReactions(), seededEntries(), normalizeEntries(), localStorageKey() (+7 more)

### Community 119 - "Community 119"
Cohesion: 0.19
Nodes (7): SelectedMention, webRoot, getServer(), memoryStorage(), loadDrafts(), 035114c Merge branch 'feature/chat-drafts' into develop, 355c86d feat(web): keep unsent chat text as a draft per chat

### Community 95 - "Community 95"
Cohesion: 0.22
Nodes (5): revision(), reactorKey(), cleanView(), ReactionStore, createReactionStore()

### Community 79 - "Community 79"
Cohesion: 0.11
Nodes (9): ReadReconciliationOptions, FakeBroadcastChannel, require, ts, loadMessagingModule(), 4553c35 fix(web): reconcile repeated cross-tab read cursors, 8e66057 fix(ci): fail release gates on wrong branch, d8e3847 test(web): prove messaging reconciliation flows (+1 more)

### Community 82 - "Community 82"
Cohesion: 0.15
Nodes (8): ReplyConversation, ReplyAuthor, ReplyTarget, ReplySendInput, conversationKey(), normalizeTarget(), ReplyStore, createReplyStore()

### Community 172 - "Community 172"
Cohesion: 0.33
Nodes (4): SendShadowState, SendShadow, stableJson(), fingerprint()

### Community 202 - "Community 202"
Cohesion: 0.60
Nodes (4): SkinToneIndex, isToneIndex(), loadSkinTone(), saveSkinTone()

### Community 67 - "Community 67"
Cohesion: 0.09
Nodes (19): NotificationInboxTransport, NotificationLevel, NotificationReason, NotificationItem, NotificationEnvelope, NOTIFICATION_LEVELS, NOTIFICATION_LEVEL_SET, NOTIFICATION_REASONS (+11 more)

### Community 32 - "Community 32"
Cohesion: 0.07
Nodes (48): NotificationEventType, NotificationActor, NotificationMessageBrief, NotificationRoomContext, NotificationDmMessageEvent, NotificationRoomMessageEvent, NotificationFriendRequestEvent, NotificationFriendAcceptedEvent (+40 more)

### Community 110 - "Community 110"
Cohesion: 0.16
Nodes (13): PresenceIdleSnapshot, PresenceIdleControllerOptions, BrowserIdleDetector, EventTarget, BrowserIdleDetectorConstructor, IdleDetectionScope, DesktopIdleBridge, DesktopIdleScope (+5 more)

### Community 90 - "Community 90"
Cohesion: 0.20
Nodes (16): parsePlacement(), flipPlacementVertical(), viewportSpaceAroundTrigger(), resolvePopoverPlacement(), PopoverPlacement, PopoverRole, PopoverCloseReason, PopoverTriggerState (+8 more)

### Community 188 - "Community 188"
Cohesion: 0.38
Nodes (5): FocusTrapOptions, FOCUSABLE_SELECTOR, isHTMLElement(), getFocusableElements(), focusInitialElement()

### Community 191 - "Community 191"
Cohesion: 0.60
Nodes (4): iconXs, iconSm, iconMd, iconLg

### Community 183 - "Community 183"
Cohesion: 0.33
Nodes (3): DEFAULT_OPTIONS, getSmoothingCoefficient(), VoiceRoomNoiseGateProcessor

### Community 211 - "Community 211"
Cohesion: 0.50
Nodes (1): VoiceRoomDesktopAudioSourceProcessor

### Community 195 - "Community 195"
Cohesion: 0.40
Nodes (2): s(), o

### Community 220 - "Community 220"
Cohesion: 0.50
Nodes (1): e

### Community 199 - "Community 199"
Cohesion: 0.40
Nodes (5): root, require, ts, moduleUrl(), loadRoomRealtime()

### Community 103 - "Community 103"
Cohesion: 0.14
Nodes (12): webRoot, require, getServer(), loadTyping(), TypingActivity, RoomTypist, ClientEnvelope, ServerEnvelope (+4 more)

### Community 157 - "Community 157"
Cohesion: 0.22
Nodes (3): MemoryStorage, deferred(), configure()

### Community 212 - "Community 212"
Cohesion: 0.50
Nodes (3): webRoot, getServer(), loadModule()

### Community 114 - "Community 114"
Cohesion: 0.23
Nodes (11): text(), accessibleName(), assertAccessibleName(), assertFocusOrder(), assertKeyboardActivation(), assertLiveRegion(), assertReducedMotionEnabled(), assertStableLayout() (+3 more)

### Community 165 - "Community 165"
Cohesion: 0.29
Nodes (3): repositoryRoot, 924295b test(web): prove G13 against pinned Caddy, a37d685 test(web): make G13 paths workspace-safe

### Community 111 - "Community 111"
Cohesion: 0.13
Nodes (4): require, ts, FakeNotification, DeniedNotification

### Community 145 - "Community 145"
Cohesion: 0.24
Nodes (10): root, sourceRoot, SURFACE_TOKEN_VALUES, SURFACE_TOKENS, sourceFiles(), lineAt(), styleFragments(), hasSurfaceToken() (+2 more)

### Community 186 - "Community 186"
Cohesion: 0.29
Nodes (3): require, ts, FakeIdleDetector

### Community 170 - "Community 170"
Cohesion: 0.25
Nodes (3): require, ts, FakeWebSocket

### Community 51 - "Community 51"
Cohesion: 0.08
Nodes (7): TestEvent, TestKeyboardEvent, TestNode, TestText, TestElement, TestDocument, installDomRuntime()

### Community 148 - "Community 148"
Cohesion: 0.18
Nodes (10): UserAgentDescription, AccountSession, RecoveryCodesStatus, RecoveryCodesReminder, WhatsNewState, LoginAlertKind, LoginAlert, AccountDeletionRoom (+2 more)

### Community 105 - "Community 105"
Cohesion: 0.16
Nodes (12): LOGIN_ALERT_KINDS, CLIENT_RULES, OS_RULES, normalizeRecoveryCode(), formatRecoveryCode(), normalizeReleaseVersion(), compareReleaseVersions(), hasUnseenWhatsNew() (+4 more)

### Community 75 - "Community 75"
Cohesion: 0.10
Nodes (20): MIME_TYPES, STATES, text(), normalizeAttachment(), normalizeAttachments(), attachmentTextFallback(), assert, test (+12 more)

### Community 133 - "Community 133"
Cohesion: 0.31
Nodes (11): clamp(), normalizeChannel(), srgbToLinear(), linearToSrgb(), rgbToOklch(), oklchToLinearRgb(), isInSrgbGamut(), fitChromaToSrgb() (+3 more)

### Community 179 - "Community 179"
Cohesion: 0.29
Nodes (6): CapabilityRequires, CapabilityPublicNode, CapabilityInternalNode, CapabilityOperatorNode, CapabilityReplicaConsensus, CapabilityManifest

### Community 115 - "Community 115"
Cohesion: 0.21
Nodes (10): PUBLIC_CAPABILITY_KEYS, INTERNAL_NODE_KEYS, OPERATOR_KEYS, isObject(), toStringArray(), normalizePublicNode(), normalizeInternalNode(), normalizeOperatorNode() (+2 more)

### Community 144 - "Community 144"
Cohesion: 0.21
Nodes (10): { listReactionEmojis }, GROUP_ANCHORS, buildGroups(), listReactionEmojiGroups(), reactionEmojiGroupKey(), listReactionEmojis(), test, assert (+2 more)

### Community 126 - "Community 126"
Cohesion: 0.25
Nodes (13): { listReactionEmojis }, SKIN_TONES, TONE_SET, toneless(), tonesIn(), build(), data(), isCollapsedSkinToneVariant() (+5 more)

### Community 180 - "Community 180"
Cohesion: 0.38
Nodes (6): REACTION_EMOJIS, EMOJI_REACTION_AUTHORITY, REACTION_EMOJI_SET, isReactionEmoji(), cleanReactionEmoji(), assertReactionEmoji()

### Community 208 - "Community 208"
Cohesion: 0.40
Nodes (4): MembershipRole, MemberPresenceStatus, MembershipMember, MembershipEnvelope

### Community 156 - "Community 156"
Cohesion: 0.36
Nodes (9): MEMBERSHIP_ROLES, MEMBERSHIP_ROLE_SET, isObject(), cleanString(), normalizeMembershipLimit(), normalizeMembershipRequest(), normalizeMembershipMember(), buildMembershipEnvelope() (+1 more)

### Community 222 - "Community 222"
Cohesion: 0.83
Nodes (3): cleanId(), normalizeMentionUserIds(), mentionUserIdsFromContent()

### Community 209 - "Community 209"
Cohesion: 0.40
Nodes (4): HistoryMode, HistoryRequest, MessageDto, HistoryEnvelope

### Community 134 - "Community 134"
Cohesion: 0.27
Nodes (12): HISTORY_MODES, HISTORY_MODE_SET, MESSAGE_KIND_SET, isObject(), cleanString(), isOpaqueCursor(), normalizeLimit(), normalizeHistoryRequest() (+4 more)

### Community 181 - "Community 181"
Cohesion: 0.29
Nodes (6): ConversationRef, ReplyPointer, ReplyPreview, IdempotencyDescriptor, SendEnvelope, MessageDeliveryEvent

### Community 149 - "Community 149"
Cohesion: 0.53
Nodes (10): DELIVERY_EVENT_TYPES, isObject(), cleanString(), normalizeConversation(), isSystemCard(), normalizeReplyPointer(), normalizeReplyPreview(), normalizeIdempotency() (+2 more)

### Community 135 - "Community 135"
Cohesion: 0.28
Nodes (12): MODERATION_DURATIONS, MODERATION_DURATION_MS, cleanString(), normalizeModerationLimit(), normalizeBanDuration(), durationToExpiresAt(), normalizeBanMutation(), normalizeIdempotencyKey() (+4 more)

### Community 197 - "Community 197"
Cohesion: 0.53
Nodes (5): PLATFORM_CLASSES, normalizedString(), classifyPlatform(), platformPolicy(), classifyPlatformPolicy()

### Community 210 - "Community 210"
Cohesion: 0.40
Nodes (4): ReactionMutation, ReactionSummary, Reactor, ReactorPage

### Community 164 - "Community 164"
Cohesion: 0.33
Nodes (8): { cleanReactionEmoji }, cleanId(), cleanCursor(), normalizeReactionMutation(), normalizeReactionRevision(), normalizeReactionSummary(), normalizeReactorQuery(), normalizeReactorPage()

### Community 43 - "Community 43"
Cohesion: 0.09
Nodes (37): { normalizeRoomId, normalizePeerId, normalizeSessionToken, cleanName }, KNOWN_CLIENT_TYPES, TYPING_ACTIVITIES, isPlainObject(), normalizeTypingActivity(), parseClientEnvelope(), parseServerEnvelope(), buildServerEnvelope() (+29 more)

### Community 198 - "Community 198"
Cohesion: 0.33
Nodes (5): RoomMessageTextSegmentV1, RoomMessageLinkSegmentV1, RoomMessageMentionSegmentV1, RoomMessageSegmentV1, RoomMessageContentV1

### Community 136 - "Community 136"
Cohesion: 0.26
Nodes (11): cleanString(), cleanHttpUrl(), utf8ByteLength(), normalizeSegment(), normalizeRoomMessageContent(), projectKnownContent(), projectRoomMessageContent(), contentFromLegacyText() (+3 more)

### Community 137 - "Community 137"
Cohesion: 0.28
Nodes (11): DEFAULT_RUNTIME_CONFIG, normalizeLiveKitUrl(), normalizeLiveKitServerUrl(), inheritLiveKitGateCredential(), resolveLiveKitConnectUrls(), normalizePayload(), parseRuntimeConfig(), getRuntimeConfig() (+3 more)

### Community 213 - "Community 213"
Cohesion: 0.40
Nodes (4): test, assert, { listReactionEmojis }, cjs

### Community 138 - "Community 138"
Cohesion: 0.15
Nodes (10): test, assert, crypto, fs, path, { pathToFileURL }, {
  EMOJI_REACTION_AUTHORITY,
  assertReactionEmoji,
  cleanReactionEmoji,
  isReactionEmoji,
  listReactionEmojis
}, ROOT (+2 more)

### Community 158 - "Community 158"
Cohesion: 0.22
Nodes (9): assert, fs, path, { pathToFileURL }, test, packageJson, commonJs, snapshot() (+1 more)

### Community 221 - "Community 221"
Cohesion: 0.50
Nodes (2): extensions, files

### Community 88 - "Community 88"
Cohesion: 0.17
Nodes (18): require, { AccessToken, TrackSource }, { createGateCredentialSigner }, { createDbPool }, { runMigrations }, { createRoomStore }, PRINCIPAL, sleep() (+10 more)

### Community 161 - "Community 161"
Cohesion: 0.36
Nodes (8): require, { createGateCredentialSigner }, extractCredential(), createMemoryGateStore(), readTopologyEvidence(), mint(), authorize(), runAuthGateProof()

### Community 99 - "Community 99"
Cohesion: 0.11
Nodes (11): require, { createGateCredentialSigner }, { createLiveKitAuthGateService, extractCredential }, { createRoomStore }, { createRoomRealtimeRuntime }, WEB_ROOM_COVERAGE_SCRIPT, ADMISSION_INTERNAL_COVERAGE_SCRIPT, SERVER_INTERNAL_COVERAGE_SCRIPT (+3 more)

### Community 203 - "Community 203"
Cohesion: 0.60
Nodes (5): 0d5875a fix: close migration dependency audit finding, 7a27ba8 chore: prepare v2.0.0 release, 983e909 Merge pull request #11 from dazeGG/hotfix/api-docker-workspace-start-develop, c6b8624 fix: start api workspace in docker image, dcda22d chore: merge v2.0.0 back to develop

### Community 152 - "Community 152"
Cohesion: 0.22
Nodes (8): .github CLAUDE.md Policy, Pull Request Template, docs/GIT_FLOW.md, Root CLAUDE.md, docs/RELEASE_<version>_PLAN.md, apps/CLAUDE.md, apps/web/CLAUDE.md, Room client architecture (ARCHITECTURE.md)

### Community 227 - "Community 227"
Cohesion: 1.00
Nodes (1): config/capability-dag.v1.json

### Community 230 - "Community 230"
Cohesion: 1.00
Nodes (1): Font Assets README

### Community 229 - "Community 229"
Cohesion: 1.00
Nodes (1): Design QA — reusable room and chat menus

### Community 224 - "Community 224"
Cohesion: 1.00
Nodes (1): ADR: Unicode authority for message reactions

### Community 225 - "Community 225"
Cohesion: 1.00
Nodes (1): VoiceRoom 2.5 Architecture Boundaries

### Community 226 - "Community 226"
Cohesion: 1.00
Nodes (1): Backlog

### Community 175 - "Community 175"
Cohesion: 0.48
Nodes (7): docs/CLAUDE.md governance rules, Git Flow workflow, Release 2.4.0 verification plan, Release 2.4.1 verification plan, Release 2.4.2 hotfix verification plan, VoiceRoom 2.5.0 consolidated execution plan, VoiceRoom 2.5.0 unified messaging platform PRD

### Community 232 - "Community 232"
Cohesion: 1.00
Nodes (1): VoiceRoom monitoring agent

### Community 204 - "Community 204"
Cohesion: 0.40
Nodes (5): VoiceRoom 2.5.0 Unified — Verification and Release Evidence Specification, Release 2.6.0 Plan — Engagement & Notifications (Superseded), Release 2.7.0 Plan — Media & Moderation (Superseded), Expiry-Aware Rescue Profile Doc (G85), Predeploy Migrations Doc

### Community 228 - "Community 228"
Cohesion: 1.00
Nodes (1): Capability Readiness Doc

### Community 190 - "Community 190"
Cohesion: 0.33
Nodes (6): Desktop Support Matrix Doc (G19), Release 2.5.0 Durable Evidence Archive Doc (G03), Coordinated Media Backup and Restore Doc, Release 2.5.0 Budgets Doc (G91), Release 2.5.0 Develop Entry Doc (G93), Release 2.5.0 RC Preflight Doc

### Community 233 - "Community 233"
Cohesion: 1.00
Nodes (1): OCI Runtime Publication Doc

### Community 235 - "Community 235"
Cohesion: 1.00
Nodes (1): Production Digest Promotion Doc

### Community 231 - "Community 231"
Cohesion: 1.00
Nodes (1): LiveKit External Auth-Gate Operations Doc (G05)

### Community 236 - "Community 236"
Cohesion: 1.00
Nodes (1): Release 2.5.0 Repairs README

### Community 234 - "Community 234"
Cohesion: 1.00
Nodes (1): packages/CLAUDE.md Guidance

### Community 223 - "Community 223"
Cohesion: 1.00
Nodes (2): VoiceRoom App Icon (Owl Mascot Mark on Dark Rounded Square), VoiceRoom Mascot Mark (Masked Owl Silhouette, Transparent)

## Knowledge Gaps
- **1767 isolated node(s):** `crypto`, `{ transaction }`, `{ verifyPassword }`, `{
  ACCOUNT_DELETION_GRACE_MS,
  DELETED_ACCOUNT_NAME,
  DELETED_LOGIN_PREFIX
}`, `PERSONAL_DATA_CLEANUP` (+1762 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 192`** (2 nodes): `{ createDbPool }`, `createDmHistoryRepository()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 219`** (1 nodes): `registerModerationRoutes()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 207`** (2 nodes): `crypto`, `createMentionRepository()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 214`** (1 nodes): `FakeClient`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 200`** (1 nodes): `FakeServer`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 206`** (2 nodes): `writeRoomSwitchConfirmEnabled()`, `applyRoomSwitchDecision()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 194`** (1 nodes): `LiveKitReconcileGeneration`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 143`** (1 nodes): `ScreenRecoveryGraceController`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 36`** (2 nodes): `13254ae docs: document durable room storage`, `c860746 feat(web): add static rooms and room chat UI`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 196`** (2 nodes): `ParticipantMenuVariant`, `participantContextMenu`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 211`** (1 nodes): `VoiceRoomDesktopAudioSourceProcessor`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 195`** (2 nodes): `s()`, `o`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 220`** (1 nodes): `e`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 221`** (2 nodes): `extensions`, `files`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 227`** (1 nodes): `config/capability-dag.v1.json`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 230`** (1 nodes): `Font Assets README`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 229`** (1 nodes): `Design QA — reusable room and chat menus`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 224`** (1 nodes): `ADR: Unicode authority for message reactions`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 225`** (1 nodes): `VoiceRoom 2.5 Architecture Boundaries`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 226`** (1 nodes): `Backlog`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 232`** (1 nodes): `VoiceRoom monitoring agent`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 228`** (1 nodes): `Capability Readiness Doc`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 233`** (1 nodes): `OCI Runtime Publication Doc`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 235`** (1 nodes): `Production Digest Promotion Doc`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 231`** (1 nodes): `LiveKit External Auth-Gate Operations Doc (G05)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 236`** (1 nodes): `Release 2.5.0 Repairs README`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 234`** (1 nodes): `packages/CLAUDE.md Guidance`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 223`** (2 nodes): `VoiceRoom App Icon (Owl Mascot Mark on Dark Rounded Square)`, `VoiceRoom Mascot Mark (Masked Owl Silhouette, Transparent)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `RealtimeRecoveryController` connect `Community 47` to `Community 19`?**
  _High betweenness centrality (0.008) - this node is a cross-community bridge._
- **Why does `AppRealtimeConnection` connect `Community 38` to `Community 13`?**
  _High betweenness centrality (0.005) - this node is a cross-community bridge._
- **What connects `crypto`, `{ transaction }`, `{ verifyPassword }` to the rest of the system?**
  _1767 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 34` be split into smaller, more focused modules?**
  _Cohesion score 0.04995374653098982 - nodes in this community are weakly interconnected._
- **Should `Community 25` be split into smaller, more focused modules?**
  _Cohesion score 0.055218855218855216 - nodes in this community are weakly interconnected._
- **Should `Community 18` be split into smaller, more focused modules?**
  _Cohesion score 0.04144869215291751 - nodes in this community are weakly interconnected._
- **Should `Community 41` be split into smaller, more focused modules?**
  _Cohesion score 0.05758582502768549 - nodes in this community are weakly interconnected._