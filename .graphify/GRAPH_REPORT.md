# Graph Report - .  (2026-09-14)

## Corpus Check
- Large corpus: 790 files · ~385 696 words. Semantic extraction will be expensive (many Claude tokens). Consider running on a subfolder, or use --no-semantic to run AST-only.

## Summary
- 6350 nodes · 17758 edges · 230 communities detected
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 6 edges (avg confidence: 0.73)
- Token cost: 0 input · 0 output
- Edge kinds: contains: 4768 · MODIFIES: 4467 · ON_BRANCH: 3636 · calls: 1940 · imports: 1157 · imports_from: 785 · PARENT_OF: 698 · method: 208 · re_exports: 59 · references: 23 · inherits: 10 · conceptually_related_to: 4 · semantically_similar_to: 2 · implements: 1


## Input Scope
- Requested: auto
- Resolved: committed (source: default-auto)
- Included files: 790 · Candidates: 870
- Excluded: 3 untracked · 46891 ignored · 13 sensitive · 0 missing committed
- Recommendation: Use --scope all or graphify.yaml inputs.corpus for a knowledge-base folder.

## Graph Freshness
- Built from Git commit: `333182d`
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

### Community 24 - "Community 24"
Cohesion: 0.04
Nodes (32): crypto, { transaction }, { verifyPassword }, {
  ACCOUNT_DELETION_GRACE_MS,
  DELETED_ACCOUNT_NAME,
  DELETED_LOGIN_PREFIX
}, PERSONAL_DATA_CLEANUP, createAccountDeletionRepository(), { socketPathForDirectory }, test (+24 more)

### Community 121 - "Community 121"
Cohesion: 0.16
Nodes (14): http, net, { URL }, { createDbPool }, { createGateCredentialSigner }, { createCredentialBoundaryService }, { createRoomStore }, normalizeGatePath() (+6 more)

### Community 26 - "Community 26"
Cohesion: 0.06
Nodes (38): createLinkPreviewRepository(), crypto, { firstPreviewableUrl, normalizeLinkPreview }, { decodeHtmlBody, extractLinkPreviewMetadata }, createLinkPreviewService(), { normalizeLinkPreview }, { createDbPool }, createRoomHistoryRepository() (+30 more)

### Community 84 - "Community 84"
Cohesion: 0.08
Nodes (18): crypto, CONTEXTS, MIME_TYPES, mapAttachment(), test, assert, {
  createAttachmentRepository,
  mapAttachment
}, ROW (+10 more)

### Community 16 - "Community 16"
Cohesion: 0.03
Nodes (50): createAttachmentRepository(), crypto, { Pool }, { readDatabaseConfig }, quoteIdent(), databaseName(), databaseUrlFor(), createTestDatabase() (+42 more)

### Community 60 - "Community 60"
Cohesion: 0.08
Nodes (24): crypto, JOB_KINDS, MediaJobFenceError, mapMediaJob(), createMediaJobRepository(), recordMediaOldestPending(), crypto, sharp (+16 more)

### Community 163 - "Community 163"
Cohesion: 0.27
Nodes (7): createMediaMaintenanceService(), createMediaMaintenanceWorker(), main(), assert, test, { createMediaMaintenanceService }, { createMediaMaintenanceWorker }

### Community 17 - "Community 17"
Cohesion: 0.04
Nodes (47): fs, createMediaPressureService(), httpRequests, maintenanceTasks, mediaPressure, labels(), metricLine(), httpKey() (+39 more)

### Community 3 - "Community 3"
Cohesion: 0.02
Nodes (39): createMediaQuotaRepository(), MediaQuotaError, createMediaQuotaService(), createDirectMessageRepository(), registerDmHistoryRoutes(), { buildMessageDeliveryEvent }, registerRoomHistoryRoutes(), createRoomMessageRepository() (+31 more)

### Community 22 - "Community 22"
Cohesion: 0.04
Nodes (46): createMediaReconciliationService(), sharp, FORMAT_MIME, PNG_END, MediaServiceError, readBounded(), detectExactContainer(), createMediaService() (+38 more)

### Community 67 - "Community 67"
Cohesion: 0.07
Nodes (17): registerMediaRoutes(), MediaVisibilityError, createMediaVisibilityService(), assert, fastify, test, { registerMediaRoutes }, { createMediaVisibilityService } (+9 more)

### Community 177 - "Community 177"
Cohesion: 0.32
Nodes (6): { buildMembershipEnvelope, normalizeMembershipRequest }, presenceForUser(), createMemberDirectoryService(), assert, { test }, { createMemberDirectoryService, presenceForUser }

### Community 82 - "Community 82"
Cohesion: 0.10
Nodes (20): crypto, toMillis(), mapMembership(), mapDirectoryMember(), createMembershipRepository(), registerMembershipRoutes(), { transaction }, { createMembershipRepository } (+12 more)

### Community 69 - "Community 69"
Cohesion: 0.07
Nodes (20): { socketPathForDirectory }, test, assert, fs, http, { spawn }, path, os (+12 more)

### Community 169 - "Community 169"
Cohesion: 0.25
Nodes (7): {
  normalizeRoomMessageContent,
  projectRoomMessageContent
}, projectStoredRoomMessage(), assert, fs, path, test, {projectStoredRoomMessage}

### Community 170 - "Community 170"
Cohesion: 0.25
Nodes (7): {
  contentFromLegacyText,
  normalizeRoomMessageContent,
  projectRoomMessageContent
}, createContentRepository(), assert, fs, path, test, {createContentRepository}

### Community 199 - "Community 199"
Cohesion: 0.33
Nodes (2): { createDbPool }, createDmHistoryRepository()

### Community 32 - "Community 32"
Cohesion: 0.05
Nodes (35): {
  buildHistoryEnvelope,
  normalizeHistoryRequest
}, { normalizeLinkPreview }, DmHistoryError, canonicalParticipants(), createDmHistoryService(), MessageReadError, createMessageReadService(), {
  buildHistoryEnvelope,
  normalizeHistoryRequest
} (+27 more)

### Community 103 - "Community 103"
Cohesion: 0.13
Nodes (12): crypto, IdempotencyConflictError, IdempotencyQuotaError, boundedString(), normalizeIdentity(), encodeParts(), ledgerKey(), actorLockKey() (+4 more)

### Community 119 - "Community 119"
Cohesion: 0.14
Nodes (12): crypto, { buildMessageDeliveryEvent }, MessageDeliveryFenceError, requireQuery(), encodeParts(), logicalKey(), createMessageOutboxRepository(), assert (+4 more)

### Community 11 - "Community 11"
Cohesion: 0.03
Nodes (53): { createDbPool, transaction }, crypto, NotificationFenceError, createNotificationOutboxRepository(), createNotificationPushProvider(), { Pool }, { readDatabaseConfig }, { recordPgPoolError } (+45 more)

### Community 1 - "Community 1"
Cohesion: 0.01
Nodes (188): createMessageReadRepository(), registerPinRoutes(), createFriendStore(), crypto, fastifyCookie, fastifyMultipart, fastifyWebsocket, { buildRoomMembershipPresenceSnapshot, createConnectionRegistry } (+180 more)

### Community 46 - "Community 46"
Cohesion: 0.08
Nodes (30): { ReplyTargetUnavailableError }, REPLY_CONFLICT_BODY, createMessageReplyHandlers(), registerMessageReplyRoutes(), { REPLY_PREVIEW_TEXT_MAX_LENGTH, isSystemCard }, ReplyTargetUnavailableError, toMillis(), messageId() (+22 more)

### Community 85 - "Community 85"
Cohesion: 0.09
Nodes (18): { createMessageVisibilityService }, createMessageService(), MessageVisibilityError, createMessageVisibilityService(), assert, fs, path, { test } (+10 more)

### Community 213 - "Community 213"
Cohesion: 0.60
Nodes (4): requireQuery(), toMillis(), mapPin(), createPinRepository()

### Community 185 - "Community 185"
Cohesion: 0.43
Nodes (5): PinServiceError, normalizeRoomId(), normalizeMessageId(), requireAccount(), createPinService()

### Community 34 - "Community 34"
Cohesion: 0.05
Nodes (38): createReactionRealtimeAdapter(), registerReactionRoutes(), {
  normalizeReactionMutation,
  normalizeReactionSummary,
  normalizeReactorPage,
  normalizeReactorQuery
}, ReactionServiceError, normalizeConversation(), createReactionService(), assert, test (+30 more)

### Community 186 - "Community 186"
Cohesion: 0.33
Nodes (3): CONTEXT_TABLES, requireQuery(), createReactionRepository()

### Community 18 - "Community 18"
Cohesion: 0.04
Nodes (45): crypto, toMillis(), mapActiveBan(), normalizePrincipal(), createActiveBanRepository(), { transaction }, { createActiveBanRepository, normalizePrincipal }, createActiveBanService() (+37 more)

### Community 156 - "Community 156"
Cohesion: 0.27
Nodes (8): { transaction }, requireOperation(), attachmentRevoker(), cleanupEnqueuer(), createMessageModerationService(), test, assert, { createMessageModerationService }

### Community 28 - "Community 28"
Cohesion: 0.04
Nodes (29): crypto, toMillis(), mapBanProfile(), mapModerationBan(), createModerationRepository(), {
  buildModerationPage,
  durationToExpiresAt,
  normalizeBanMutation,
  normalizeIdempotencyKey,
  normalizeModerationPageRequest
}, { transaction }, { createModerationRepository } (+21 more)

### Community 77 - "Community 77"
Cohesion: 0.08
Nodes (18): crypto, { transaction }, createInboxRepository(), assert, {Pool}, test, {runMigrations}, {createInboxRepository} (+10 more)

### Community 44 - "Community 44"
Cohesion: 0.06
Nodes (32): { transaction }, { buildNotificationEnvelope, buildProviderPayload, normalizeNotificationLevel, normalizeNotificationLimit }, createNotificationService(), crypto, { cleanPresenceStatus }, { createDbPool, transaction }, createNotificationStore(), assert (+24 more)

### Community 56 - "Community 56"
Cohesion: 0.08
Nodes (28): { createPushService }, crypto, EXACT_PUSH_HOSTS, isAllowedPushHost(), cleanPushEndpoint(), describePushEndpoint(), webPush, { PLATFORM_CLASSES } (+20 more)

### Community 147 - "Community 147"
Cohesion: 0.24
Nodes (10): crypto, sharp, { deriveAvatarAccent, dominantAvatarColor }, detectAvatarFormat(), processAvatar(), createAvatarKey(), test, assert (+2 more)

### Community 19 - "Community 19"
Cohesion: 0.04
Nodes (19): reconcileAvatarStorage(), test, assert, { reconcileAvatarStorage }, MascotVariant, MascotIconProps, ChatSegment, addOrigin() (+11 more)

### Community 42 - "Community 42"
Cohesion: 0.05
Nodes (33): fs, path, { readUploadsDir }, AVATAR_KEY_PATTERN, validateAvatarKey(), createAvatarStorage(), readUploadsDir(), crypto (+25 more)

### Community 27 - "Community 27"
Cohesion: 0.06
Nodes (41): path, readEnvBool(), readMessageDeliveryMode(), readDatabaseConfig(), { Client }, fs, path, { PG_MIGRATE_LOCK_ID, runner } (+33 more)

### Community 64 - "Community 64"
Cohesion: 0.08
Nodes (24): readEnvInt(), crypto, LeaseLostError, abortError(), delay(), boundedBackoff(), createLeaseRuntime(), { createDbPool } (+16 more)

### Community 8 - "Community 8"
Cohesion: 0.04
Nodes (46): crypto, { createDbPool, transaction }, { cleanAvatarColorKey, cleanPresenceStatus }, { normalizeLinkPreview }, toMillis(), mapPublicUser(), mapInvite(), mapMessage() (+38 more)

### Community 21 - "Community 21"
Cohesion: 0.04
Nodes (39): fs, net, namesOf(), placeName(), formatLocation(), createGeoLocator(), test, assert (+31 more)

### Community 112 - "Community 112"
Cohesion: 0.12
Nodes (13): dns, http, https, net, REDIRECT_STATUSES, BLOCKED_SUBNETS, isPublicAddress(), createLinkPreviewFetcher() (+5 more)

### Community 65 - "Community 65"
Cohesion: 0.07
Nodes (22): fs, net, startApiListener(), test, assert, fs, os, path (+14 more)

### Community 139 - "Community 139"
Cohesion: 0.21
Nodes (9): crypto, hasLeadingZeroBits(), parsePowChallenge(), normalizePowNonce(), createProofOfWork(), test, assert, crypto (+1 more)

### Community 176 - "Community 176"
Cohesion: 0.32
Nodes (5): getClientIp(), createRateLimiter(), test, assert, { getClientIp, createRateLimiter }

### Community 43 - "Community 43"
Cohesion: 0.08
Nodes (30): crypto, { createDbPool, transaction }, { createActiveBanService }, {
  AVATAR_COLOR_KEYS,
  cleanAvatarColorKey
}, { normalizeLinkPreview }, normalizePositiveInt(), toDate(), toMillis() (+22 more)

### Community 10 - "Community 10"
Cohesion: 0.03
Nodes (57): crypto, { createDbPool, transaction }, { hashPassword, verifyPassword }, { AVATAR_COLOR_KEYS, cleanAvatarColorKey, cleanPresenceStatus }, {
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
}, toMillis(), mapUser(), publicUser() (+49 more)

### Community 12 - "Community 12"
Cohesion: 0.04
Nodes (39): test, assert, { createApiApp, createApiServer }, { PUBLIC_CAPABILITY_KEYS }, { resetMetricsForTest }, test, assert, migration (+31 more)

### Community 20 - "Community 20"
Cohesion: 0.03
Nodes (41): assert, { Pool }, { test }, { runMigrations }, { createTestDatabase }, assert, fs, path (+33 more)

### Community 70 - "Community 70"
Cohesion: 0.10
Nodes (11): profileCardUi, ProfileCardAnchor, ProfileCardPerson, ProfileCardRelationship, ProfileCardProps, ContextMenuContentState, ContextMenuProps, root (+3 more)

### Community 57 - "Community 57"
Cohesion: 0.09
Nodes (17): WhatsNewIcon, WhatsNewItem, WHATS_NEW_ITEMS, webRoot, assert, path, { pathToFileURL }, test (+9 more)

### Community 94 - "Community 94"
Cohesion: 0.11
Nodes (17): { PUBLIC_CAPABILITY_KEYS }, HEALTH_CAPABILITIES_LIMITS, publicFeatureFlags(), formatCapabilityPayload(), registerCapabilityRoutes(), createCapabilitySnapshot(), assert, { mkdtempSync, readFileSync, writeFileSync } (+9 more)

### Community 99 - "Community 99"
Cohesion: 0.19
Nodes (18): crypto, { existsSync, readFileSync }, path, {
  normalizeManifest,
  PUBLIC_CAPABILITY_KEYS,
  OPERATOR_KEYS,
  toSet
}, resolveManifestPath(), sha256Hex(), readManifestText(), asSet() (+10 more)

### Community 149 - "Community 149"
Cohesion: 0.17
Nodes (10): createReadinessReport(), assert, fs, path, { test }, { readMessageDeliveryMode }, { createReadinessReport }, test (+2 more)

### Community 68 - "Community 68"
Cohesion: 0.08
Nodes (25): createRuntimeReadinessRepository(), { PUBLIC_CAPABILITY_KEYS }, { createReadinessReport, resolveManifestPath }, { createRuntimeReadinessRepository }, failClosedSnapshot(), createRuntimeReadinessProvider(), os, { createDbPool } (+17 more)

### Community 79 - "Community 79"
Cohesion: 0.09
Nodes (19): { buildServerEnvelope }, toWsAccountEvent(), {
  parseClientEnvelope,
  buildServerEnvelope,
  buildServerErrorEnvelope,
  validateClientCommand
}, serializeEnvelope(), sendWsEnvelope(), parseInboundMessage(), crypto, { cleanPresenceStatus } (+11 more)

### Community 50 - "Community 50"
Cohesion: 0.07
Nodes (29): { buildServerEnvelope }, legacyPeerMessageToWs(), crypto, createTransportId(), createWsTransport(), { SUMMARY_COALESCE_MS }, {
  normalizeRoomId,
  normalizePeerId,
  normalizeSessionToken,
  cleanName,
  cleanStreamId,
  cleanScreenProfileId
}, { buildServerEnvelope, buildServerErrorEnvelope } (+21 more)

### Community 62 - "Community 62"
Cohesion: 0.08
Nodes (27): createTypingThrottle(), {
  normalizePeerId,
  normalizeRoomId,
  normalizeSessionToken
}, { normalizeTypingActivity }, { buildServerEnvelope, buildServerErrorEnvelope, parseInboundMessage }, { createTypingThrottle }, { socketPathForDirectory }, test, assert (+19 more)

### Community 133 - "Community 133"
Cohesion: 0.15
Nodes (10): createWsHandler(), test, assert, { EventEmitter }, { createWsHandler }, TOKEN_A, TOKEN_B, FakeSocket (+2 more)

### Community 75 - "Community 75"
Cohesion: 0.09
Nodes (25): fastify, getLogLevel(), createFastifyLoggerOptions(), resolveCursorHmacKeys(), getHistoryServices(), getReactionServices(), getNotificationServices(), getModerationServices() (+17 more)

### Community 135 - "Community 135"
Cohesion: 0.14
Nodes (14): resolveRealtimeReconnectLeaseMs(), getPresenceRoom(), attachPresence(), createRoomId(), pruneRooms(), startPruneTimer(), createRoomForRequest(), getRoom() (+6 more)

### Community 49 - "Community 49"
Cohesion: 0.10
Nodes (40): getRoomStore(), getCredentialBoundary(), getLiveKitCredentialProvider(), getAvatarStorage(), sessionAvatarColorKey(), getLiveKitRoomName(), getLiveKitConfig(), getLiveKitHttpUrl() (+32 more)

### Community 36 - "Community 36"
Cohesion: 0.12
Nodes (49): getUserStore(), getGeoLocator(), getAccountDeletionRepository(), sendJson(), parseCookies(), getSessionToken(), resolveSessionUser(), sessionDeviceFor() (+41 more)

### Community 59 - "Community 59"
Cohesion: 0.16
Nodes (35): getFriendStore(), getMessageService(), getNotificationStore(), broadcastToUser(), notificationActor(), queuePush(), sendFriendPush(), broadcastDmNotification() (+27 more)

### Community 61 - "Community 61"
Cohesion: 0.12
Nodes (34): release250FeatureEnabled(), getRelease250Pool(), getPinServices(), refreshPinsAfterMessageMutation(), getMessageDeliveryServices(), requestIdempotencyKey(), dispatchMessageDeliveryEvent(), startMessageDeliveryListener() (+26 more)

### Community 190 - "Community 190"
Cohesion: 0.38
Nodes (7): getPushStore(), getPushService(), handlePushConfig(), cleanPushSubscription(), checkPushSubscriptionRate(), handleCreatePushSubscription(), handleDeletePushSubscription()

### Community 113 - "Community 113"
Cohesion: 0.14
Nodes (16): { socketPathForDirectory }, test, assert, fs, http, { spawn }, path, os (+8 more)

### Community 107 - "Community 107"
Cohesion: 0.13
Nodes (17): { socketPathForDirectory }, test, assert, fs, http, { spawn }, path, os (+9 more)

### Community 98 - "Community 98"
Cohesion: 0.11
Nodes (13): { socketPathForDirectory }, test, assert, fs, http, { spawn }, path, os (+5 more)

### Community 192 - "Community 192"
Cohesion: 0.29
Nodes (4): test, assert, { TrackSource }, { __private, createApiApp }

### Community 66 - "Community 66"
Cohesion: 0.08
Nodes (21): test, assert, fs, path, { spawnSync }, repositoryRoot, require, { createGateCredentialSigner } (+13 more)

### Community 144 - "Community 144"
Cohesion: 0.15
Nodes (11): test, assert, { EventEmitter }, fs, net, path, { spawnSync }, { createApiApp } (+3 more)

### Community 218 - "Community 218"
Cohesion: 0.40
Nodes (1): FakeSocket

### Community 86 - "Community 86"
Cohesion: 0.11
Nodes (17): assert, fs, os, path, test, normalizePath(), walkFiles(), globToRegExp() (+9 more)

### Community 89 - "Community 89"
Cohesion: 0.09
Nodes (17): assert, fs, { performance }, path, { Client }, { runner }, { test }, { classifyPlatform } (+9 more)

### Community 220 - "Community 220"
Cohesion: 0.40
Nodes (4): assert, fs, path, { test }

### Community 221 - "Community 221"
Cohesion: 0.40
Nodes (4): assert, fs, path, { test }

### Community 91 - "Community 91"
Cohesion: 0.10
Nodes (18): path, socketPathForDirectory(), { socketPathForDirectory }, test, assert, crypto, fs, http (+10 more)

### Community 153 - "Community 153"
Cohesion: 0.18
Nodes (11): { socketPathForDirectory }, test, assert, fs, http, { spawn }, os, path (+3 more)

### Community 108 - "Community 108"
Cohesion: 0.11
Nodes (17): test, assert, crypto, fs, os, path, { Pool }, { runMigrations } (+9 more)

### Community 209 - "Community 209"
Cohesion: 0.33
Nodes (1): FakeServer

### Community 166 - "Community 166"
Cohesion: 0.20
Nodes (5): assert, { EventEmitter }, net, test, { createLiveKitAuthGateService }

### Community 222 - "Community 222"
Cohesion: 0.40
Nodes (1): FakeSocket

### Community 54 - "Community 54"
Cohesion: 0.08
Nodes (30): assert, crypto, fs, path, test, ROOT, EXPECTED, sha256() (+22 more)

### Community 114 - "Community 114"
Cohesion: 0.11
Nodes (12): test, assert, Fastify, { Pool }, { createPinRepository }, { createPinService }, { registerPinRoutes }, { createRoomStore } (+4 more)

### Community 95 - "Community 95"
Cohesion: 0.12
Nodes (16): { socketPathForDirectory }, test, assert, fs, http, { spawn }, path, os (+8 more)

### Community 55 - "Community 55"
Cohesion: 0.09
Nodes (33): { socketPathForDirectory }, test, assert, fs, http, { spawn }, path, os (+25 more)

### Community 100 - "Community 100"
Cohesion: 0.12
Nodes (14): { socketPathForDirectory }, test, assert, fs, http, os, path, { createApiApp, createApiServer } (+6 more)

### Community 129 - "Community 129"
Cohesion: 0.14
Nodes (13): assert, crypto, fs, path, test, { Pool }, { runner }, { createTestDatabase } (+5 more)

### Community 194 - "Community 194"
Cohesion: 0.29
Nodes (4): assert, fs, path, test

### Community 210 - "Community 210"
Cohesion: 0.33
Nodes (4): assert, fs, path, test

### Community 87 - "Community 87"
Cohesion: 0.11
Nodes (18): test, assert, http, { __private, createApiServer }, { openWs, joinVoiceRoom, sendWs, waitForWsType }, 08e3e13 Merge branch 'hotfix/2.2.1', 31409db style(web): restore dock device popover chrome, 3ce55ad fix(web): dedupe self avatar and drop count label in room list (+10 more)

### Community 115 - "Community 115"
Cohesion: 0.11
Nodes (12): { socketPathForDirectory }, test, assert, fs, http, { spawn }, path, os (+4 more)

### Community 96 - "Community 96"
Cohesion: 0.11
Nodes (15): { socketPathForDirectory }, test, assert, fs, http, { spawn }, path, os (+7 more)

### Community 71 - "Community 71"
Cohesion: 0.16
Nodes (18): store, summary, reactors, room, dm, uniqueLogin(), authDialog(), registerViaUi() (+10 more)

### Community 0 - "Community 0"
Cohesion: 0.05
Nodes (328): root, webRoot, getServer(), loadService(), deferred(), configure(), webRoot, webRoot (+320 more)

### Community 223 - "Community 223"
Cohesion: 0.50
Nodes (3): router, sw, desktop

### Community 72 - "Community 72"
Cohesion: 0.09
Nodes (18): require, webRoot, outputDir, catalogueFile, packageRoot, graphicsLicenceFile, { version }, assetName() (+10 more)

### Community 30 - "Community 30"
Cohesion: 0.06
Nodes (16): Window, webRoot, getServer(), loadService(), 0b7bfc9 feat(web): add a desktop overlay for borderless games (#134), 1ae08e2 chore(release): back-merge 2.5.12 into develop, 253c24d feat(web): overlay avatar size and panel hints (#138), 3fa3f2e chore(release): back-merge 2.5.10 into develop (+8 more)

### Community 51 - "Community 51"
Cohesion: 0.09
Nodes (18): AttachmentContext, AttachmentDraftState, AttachmentDraft, Envelope, AttachmentApiError, createAttachmentSlot(), uploadAttachmentContent(), getAttachmentStatus() (+10 more)

### Community 47 - "Community 47"
Cohesion: 0.09
Nodes (37): RoomRelationship, OwnedRoom, avatarRequest(), uploadUserAvatar(), deleteUserAvatar(), Credentials, RegisterInput, authPost() (+29 more)

### Community 130 - "Community 130"
Cohesion: 0.15
Nodes (3): AccountSecurity, sessionDeviceLabel(), SecureAccountTarget

### Community 168 - "Community 168"
Cohesion: 0.28
Nodes (5): BlockStatus, blockUrl(), blockUser(), unblockUser(), getJsonAuth()

### Community 101 - "Community 101"
Cohesion: 0.15
Nodes (14): CapabilityKey, CapabilityFeatures, CapabilityResponse, loadCapabilities(), resetCapabilities(), isCapabilityReady(), CapabilityEdge, CapabilityState (+6 more)

### Community 159 - "Community 159"
Cohesion: 0.24
Nodes (4): DesktopAsset, DesktopRelease, DesktopBuild, DESKTOP_BUILDS

### Community 7 - "Community 7"
Cohesion: 0.05
Nodes (71): DirectMessageInvite, DirectMessageHistoryPage, HistoryMessageDto, fetchThread(), fetchThreadPage(), sendDirectMessage(), markThreadRead(), deleteDirectMessage() (+63 more)

### Community 136 - "Community 136"
Cohesion: 0.21
Nodes (12): DirectMessage, ThreadSnapshot, ThreadMutation, ActiveResync, ThreadResyncOptions, ResyncRequestOptions, newestTimestamp(), contentVersion() (+4 more)

### Community 116 - "Community 116"
Cohesion: 0.23
Nodes (15): FetchMembershipsOptions, fetchRoomMemberships(), leaveRoomMembership(), RoomMembershipEntry, roomMembershipState, emptyEntry(), cacheKey(), readCache() (+7 more)

### Community 109 - "Community 109"
Cohesion: 0.18
Nodes (14): roomModerationUrl(), parsePage(), responseJson(), fetchActiveBans(), putBan(), unban(), deleteModeratedMessage(), ModerationNoticeOptions (+6 more)

### Community 38 - "Community 38"
Cohesion: 0.08
Nodes (35): NotificationPreferences, NotificationPreferencesResponse, NotificationMuteResponse, fetchNotificationPreferences(), setDmNotificationsMuted(), setRoomNotificationsMuted(), setPrivateNotifications(), setDoNotDisturb() (+27 more)

### Community 117 - "Community 117"
Cohesion: 0.18
Nodes (12): PinnedMessageAuthor, PinnedMessage, PinSnapshot, PinResponse, pinAuthor(), pinUrl(), fetchRoomPins(), pinRoomMessage() (+4 more)

### Community 80 - "Community 80"
Cohesion: 0.13
Nodes (22): PushConfig, fetchPushConfig(), savePushSubscription(), deletePushSubscription(), pushNotifications, syncQueue, decodeVapidKey(), getRegistration() (+14 more)

### Community 126 - "Community 126"
Cohesion: 0.23
Nodes (11): ReactionConversation, reactionUrl(), validSummaries(), fetchReactionSummaries(), setReactionDesired(), fetchReactors(), ReactionSnapshotView, replaceReactionSnapshot() (+3 more)

### Community 174 - "Community 174"
Cohesion: 0.25
Nodes (1): RealtimeHeartbeatWatchdog

### Community 63 - "Community 63"
Cohesion: 0.08
Nodes (13): RealtimeAccountEvent, RealtimeRoomEvent, RealtimeErrorEvent, ReactionRealtimeEvent, PinsRealtimeEvent, RealtimeEvent, ServerEnvelope, RealtimeHandle (+5 more)

### Community 13 - "Community 13"
Cohesion: 0.04
Nodes (44): RoomRealtimeSummary, RoomPeer, roomPresence, roomChatReadSessions, roomChatIsBeingRead(), applyRoomSummary(), setRoomUnreadCount(), beginRoomChatReadSession() (+36 more)

### Community 83 - "Community 83"
Cohesion: 0.11
Nodes (19): RoomSnapshot, RoomDetailHandler, previewSubscriptions, detailHandlers, retainDetailDispatch(), retryableActiveResyncErrors, clearActiveResync(), sendActiveResyncAttempt() (+11 more)

### Community 196 - "Community 196"
Cohesion: 0.60
Nodes (5): ChatMessage, presenceFor(), participantProfilePerson(), roomMessageProfilePerson(), mentionProfilePerson()

### Community 4 - "Community 4"
Cohesion: 0.03
Nodes (28): state, ToastOptions, guestNameUi, participantsUi, getSortedParticipants(), getParticipantCount(), getFocusedParticipant(), startUi (+20 more)

### Community 14 - "Community 14"
Cohesion: 0.05
Nodes (15): AvatarCropShape, AvatarCropDialogProps, AvatarProps, BadgeProps, ButtonProps, DialogProps, SwitchProps, ToastItem (+7 more)

### Community 45 - "Community 45"
Cohesion: 0.05
Nodes (2): 3c617ec style(web): polish dm day separator, 7db2783 docs(monitoring): align LiveKit track metric labels

### Community 6 - "Community 6"
Cohesion: 0.03
Nodes (35): API_PROXY, 01a206a chore: release v2.1.1, 0a0699b chore: release v2.1.2, 0a9be62 fix(web): keep room preview chat closed by default (#32), 0d30394 chore: merge v2.1.1 back to develop, 0d74cad Merge branch 'release/2.1.6', 0f3d7a0 Merge branch 'hotfix/2.1.3', 0ffac54 feat(infra): expose livekit prometheus metrics for status stack (#22) (+27 more)

### Community 148 - "Community 148"
Cohesion: 0.24
Nodes (6): pad(), formatTime(), MONTHS, startOfDay(), isSameDay(), formatChatDayLabel()

### Community 123 - "Community 123"
Cohesion: 0.20
Nodes (12): RoomShellMode, roomNavigation, getActiveVoiceRoomId(), connectedRoomIsViewed(), embeddedRoomIsVisible(), setViewedRoomFromRoute(), routeToRoom(), selectRoomPreview() (+4 more)

### Community 214 - "Community 214"
Cohesion: 0.50
Nodes (2): writeRoomSwitchConfirmEnabled(), applyRoomSwitchDecision()

### Community 5 - "Community 5"
Cohesion: 0.04
Nodes (80): DeviceOption, NoiseOption, NOISE_OPTIONS, SoundSettings, isGateDisabled(), gateValueLabel(), readDeviceId(), readSoundSettings() (+72 more)

### Community 73 - "Community 73"
Cohesion: 0.12
Nodes (19): cleanDisplayName(), getDisplayName(), saveStartName(), saveNameFromValue(), handleGuestNameSubmit(), requestGuestNameForRoom(), clearPendingGuestNameRequest(), resetGuestNameDialog() (+11 more)

### Community 2 - "Community 2"
Cohesion: 0.03
Nodes (111): NoiseModeOption, SCREEN_STREAM_MODE_PROFILES, ScreenQualityOption, SCREEN_QUALITY_OPTIONS, SCREEN_QUALITY_ORDER, SCREEN_SIMULCAST_LAYER, ScreenFpsOption, SCREEN_FPS_OPTIONS (+103 more)

### Community 9 - "Community 9"
Cohesion: 0.04
Nodes (70): isRoomEmbedded(), extractRoomId(), refreshMicrophoneLevelMeterSoon(), attachMeter(), startMeters(), stopMeters(), updateMeter(), isOverSpeakingThreshold() (+62 more)

### Community 35 - "Community 35"
Cohesion: 0.07
Nodes (38): HotkeyAction, getHotkeyStorageKey(), getDefaultHotkeyBinding(), readHotkeyBinding(), writeHotkeyBinding(), parseHotkeyBinding(), eventMatchesHotkey(), isTypingTarget() (+30 more)

### Community 41 - "Community 41"
Cohesion: 0.08
Nodes (30): getRoomIdFromPath(), createPeerId(), createSessionToken(), getStoredPeerSession(), rotateStoredPeerSession(), PeerSession, DesktopCaptureSource, ScreenStatsSnapshot (+22 more)

### Community 25 - "Community 25"
Cohesion: 0.07
Nodes (50): persistMicrophoneVolume(), dbToAmplitude(), MicProcessor, MicrophoneCapture, disconnectAudioNode(), unpublishLocalMicrophone(), GateNode, NoiseGateEnvelope (+42 more)

### Community 81 - "Community 81"
Cohesion: 0.11
Nodes (22): persistMicrophoneMode(), persistOutputMuted(), hasLocalScreenAudio(), postState(), supportsAudioOutputSelection(), getLocalMicrophoneCapture(), syncVoiceSessionControls(), CallControlsView (+14 more)

### Community 31 - "Community 31"
Cohesion: 0.09
Nodes (47): getStoredStreamVolume(), storeStreamVolume(), normalizeStoredStreamVolume(), clampStreamVolume(), setScreenAttendance(), clearScreenAttendance(), releaseScreenMediaElement(), releaseScreenAudioFallback() (+39 more)

### Community 183 - "Community 183"
Cohesion: 0.43
Nodes (6): RoomLifecycleSummary, refreshRoomHeadingSoon(), showRoomNotFoundSoon(), applyRoomUpdated(), applyRoomNotFound(), applyRoomDeleted()

### Community 90 - "Community 90"
Cohesion: 0.15
Nodes (22): peerJoinCueTimes, streamViewerCueTimes, isCuePlaybackSuppressed(), getCueGain(), CueNote, playCueSequence(), playDirectMessageCue(), roomChatCueTimes (+14 more)

### Community 15 - "Community 15"
Cohesion: 0.04
Nodes (39): ScreenPublicationPresence, getScreenPublicationPresence(), ScreenReceiverDemand, getScreenReceiverDemand(), SCREEN_SUBSCRIPTION_RETRY_DELAYS_MS, ScreenSubscriptionRetryTarget, ScreenSubscriptionRetryState, ScreenSubscriptionRetryScheduler (+31 more)

### Community 202 - "Community 202"
Cohesion: 0.33
Nodes (1): LiveKitReconcileGeneration

### Community 48 - "Community 48"
Cohesion: 0.13
Nodes (10): DEFAULT_RETRY_DELAYS_MS, TERMINAL_CODES, RETRYABLE_CODES, SAFE_CODES, sanitizeRecoveryCode(), classifyRecoveryFailure(), elapsedBucket(), RealtimeRecoveryController (+2 more)

### Community 151 - "Community 151"
Cohesion: 0.21
Nodes (1): ScreenRecoveryGraceController

### Community 40 - "Community 40"
Cohesion: 0.11
Nodes (44): watchedRemoteScreenTracks, streamCueTimes, attachMeterSoon(), syncLiveKitScreenSubscriptionsSoon(), disconnectScreenSoon(), hideScreenStageSoon(), refreshAllScreenActionsSoon(), refreshScreenStageSoon() (+36 more)

### Community 23 - "Community 23"
Cohesion: 0.09
Nodes (54): detachRemoteAudioTrack(), screenSubscriptionRetryController, screenRecoveryGrace, liveKitReconcileGenerations, reconcileGenerationFor(), connectLiveKitRoom(), attemptFreshLiveKitReplacement(), isRetryableLiveKitApiFailure() (+46 more)

### Community 39 - "Community 39"
Cohesion: 0.04
Nodes (2): 13254ae docs: document durable room storage, c860746 feat(web): add static rooms and room chat UI

### Community 205 - "Community 205"
Cohesion: 0.33
Nodes (2): ParticipantMenuVariant, participantContextMenu

### Community 171 - "Community 171"
Cohesion: 0.31
Nodes (6): RoomPanelTab, roomUi, markChatRead(), openChat(), toggleChat(), selectRoomPanel()

### Community 134 - "Community 134"
Cohesion: 0.14
Nodes (3): LeaveHandler, ControlHandler, voiceSession

### Community 178 - "Community 178"
Cohesion: 0.43
Nodes (7): DesktopAutostartSettings, DesktopAutostartPatch, getBridge(), normalizeSettings(), desktopAutostartAvailable(), readDesktopAutostartSettings(), updateDesktopAutostartSettings()

### Community 179 - "Community 179"
Cohesion: 0.36
Nodes (7): DesktopCallState, DesktopCallAction, CALL_ACTIONS, getBridge(), toPayload(), syncDesktopCallState(), bindDesktopCallActions()

### Community 187 - "Community 187"
Cohesion: 0.48
Nodes (6): DesktopDiagnosticsContext, getBridge(), desktopDiagnosticsAvailable(), openDesktopLogsFolder(), copyDesktopDiagnostics(), syncDesktopDiagnosticsContext()

### Community 200 - "Community 200"
Cohesion: 0.47
Nodes (5): DesktopLink, getBridge(), matches(), normalizeDesktopLink(), bindDesktopLinks()

### Community 132 - "Community 132"
Cohesion: 0.19
Nodes (11): BridgeResult, DesktopBridge, resolveBridge(), showDesktopNotification(), RuntimeWindow, browserNavigator(), collectPlatformSignals(), classifyPlatform() (+3 more)

### Community 93 - "Community 93"
Cohesion: 0.16
Nodes (21): OVERLAY_ANCHORS, OverlayAnchor, OVERLAY_AVATAR_SIZES, OverlayAvatarSize, DesktopOverlayParticipant, DesktopOverlaySettings, DesktopOverlayForeground, DesktopOverlayPatch (+13 more)

### Community 164 - "Community 164"
Cohesion: 0.22
Nodes (5): markInAppRoomNavigation(), PRODUCTION_HOSTS, OpenInAppSignals, resolveAppLinkScheme(), buildAppRoomLink()

### Community 140 - "Community 140"
Cohesion: 0.26
Nodes (11): configCache, RuntimeConfigOptions, SENSITIVE_KEY_PATTERNS, hasSuspiciousSecrets(), resolveConfigOrigin(), resolveConfigUrl(), cacheKey(), defaultConfig() (+3 more)

### Community 76 - "Community 76"
Cohesion: 0.09
Nodes (13): ComposerSelection, TYPING_ACTIVITIES, TypingActivity, TypingPerson, PLURAL_VERB, SINGLE_VERB, TypingEntry, webRoot (+5 more)

### Community 137 - "Community 137"
Cohesion: 0.29
Nodes (12): ChatDraftScope, ChatDraft, chatDraftStorageKey(), chatDraftScopeKey(), normalizeMentions(), normalizeChatDrafts(), readDrafts(), writeDrafts() (+4 more)

### Community 161 - "Community 161"
Cohesion: 0.27
Nodes (8): EmojiCategory, OFFERED, isOfferedEmoji(), BROWSABLE_EMOJIS, BROWSABLE_SET, skinToneChoices(), hasSkinToneChoices(), withSkinTone()

### Community 122 - "Community 122"
Cohesion: 0.28
Nodes (15): FrequentReaction, DEFAULT_FREQUENT_REACTIONS, memory, frequentReactionKey(), rankFrequentReactions(), seededEntries(), normalizeEntries(), localStorageKey() (+7 more)

### Community 131 - "Community 131"
Cohesion: 0.19
Nodes (7): SelectedMention, webRoot, getServer(), memoryStorage(), loadDrafts(), 035114c Merge branch 'feature/chat-drafts' into develop, 355c86d feat(web): keep unsent chat text as a draft per chat

### Community 111 - "Community 111"
Cohesion: 0.22
Nodes (5): revision(), reactorKey(), cleanView(), ReactionStore, createReactionStore()

### Community 88 - "Community 88"
Cohesion: 0.11
Nodes (10): ReadReconciliationOptions, FakeBroadcastChannel, require, ts, loadMessagingModule(), 4553c35 fix(web): reconcile repeated cross-tab read cursors, 8e66057 fix(ci): fail release gates on wrong branch, a2ee398 test(api): prove messaging pagination and reads (+2 more)

### Community 97 - "Community 97"
Cohesion: 0.15
Nodes (8): ReplyConversation, ReplyAuthor, ReplyTarget, ReplySendInput, conversationKey(), normalizeTarget(), ReplyStore, createReplyStore()

### Community 181 - "Community 181"
Cohesion: 0.33
Nodes (4): SendShadowState, SendShadow, stableJson(), fingerprint()

### Community 78 - "Community 78"
Cohesion: 0.09
Nodes (19): NotificationInboxTransport, NotificationLevel, NotificationReason, NotificationItem, NotificationEnvelope, NOTIFICATION_LEVELS, NOTIFICATION_LEVEL_SET, NOTIFICATION_REASONS (+11 more)

### Community 33 - "Community 33"
Cohesion: 0.07
Nodes (48): NotificationEventType, NotificationActor, NotificationMessageBrief, NotificationRoomContext, NotificationDmMessageEvent, NotificationRoomMessageEvent, NotificationFriendRequestEvent, NotificationFriendAcceptedEvent (+40 more)

### Community 124 - "Community 124"
Cohesion: 0.16
Nodes (13): PresenceIdleSnapshot, PresenceIdleControllerOptions, BrowserIdleDetector, EventTarget, BrowserIdleDetectorConstructor, IdleDetectionScope, DesktopIdleBridge, DesktopIdleScope (+5 more)

### Community 104 - "Community 104"
Cohesion: 0.20
Nodes (16): parsePlacement(), flipPlacementVertical(), viewportSpaceAroundTrigger(), resolvePopoverPlacement(), PopoverPlacement, PopoverRole, PopoverCloseReason, PopoverTriggerState (+8 more)

### Community 195 - "Community 195"
Cohesion: 0.38
Nodes (5): FocusTrapOptions, FOCUSABLE_SELECTOR, isHTMLElement(), getFocusableElements(), focusInitialElement()

### Community 198 - "Community 198"
Cohesion: 0.60
Nodes (4): iconXs, iconSm, iconMd, iconLg

### Community 191 - "Community 191"
Cohesion: 0.33
Nodes (3): DEFAULT_OPTIONS, getSmoothingCoefficient(), VoiceRoomNoiseGateProcessor

### Community 216 - "Community 216"
Cohesion: 0.50
Nodes (1): VoiceRoomDesktopAudioSourceProcessor

### Community 203 - "Community 203"
Cohesion: 0.40
Nodes (2): s(), o

### Community 224 - "Community 224"
Cohesion: 0.50
Nodes (1): e

### Community 208 - "Community 208"
Cohesion: 0.40
Nodes (5): root, require, ts, moduleUrl(), loadRoomRealtime()

### Community 58 - "Community 58"
Cohesion: 0.09
Nodes (27): webRoot, require, getServer(), loadTyping(), TypingActivity, RoomTypist, ClientEnvelope, ServerEnvelope (+19 more)

### Community 227 - "Community 227"
Cohesion: 0.67
Nodes (1): MemoryStorage

### Community 217 - "Community 217"
Cohesion: 0.50
Nodes (3): webRoot, getServer(), loadModule()

### Community 127 - "Community 127"
Cohesion: 0.23
Nodes (11): text(), accessibleName(), assertAccessibleName(), assertFocusOrder(), assertKeyboardActivation(), assertLiveRegion(), assertReducedMotionEnabled(), assertStableLayout() (+3 more)

### Community 175 - "Community 175"
Cohesion: 0.29
Nodes (3): repositoryRoot, 924295b test(web): prove G13 against pinned Caddy, a37d685 test(web): make G13 paths workspace-safe

### Community 125 - "Community 125"
Cohesion: 0.13
Nodes (4): require, ts, FakeNotification, DeniedNotification

### Community 154 - "Community 154"
Cohesion: 0.24
Nodes (10): root, sourceRoot, SURFACE_TOKEN_VALUES, SURFACE_TOKENS, sourceFiles(), lineAt(), styleFragments(), hasSurfaceToken() (+2 more)

### Community 193 - "Community 193"
Cohesion: 0.29
Nodes (3): require, ts, FakeIdleDetector

### Community 180 - "Community 180"
Cohesion: 0.25
Nodes (3): require, ts, FakeWebSocket

### Community 173 - "Community 173"
Cohesion: 0.22
Nodes (7): root, roomSettings, lobbyRoomSettings, members, bans, model, chatPanel

### Community 52 - "Community 52"
Cohesion: 0.08
Nodes (7): TestEvent, TestKeyboardEvent, TestNode, TestText, TestElement, TestDocument, installDomRuntime()

### Community 157 - "Community 157"
Cohesion: 0.18
Nodes (10): UserAgentDescription, AccountSession, RecoveryCodesStatus, RecoveryCodesReminder, WhatsNewState, LoginAlertKind, LoginAlert, AccountDeletionRoom (+2 more)

### Community 120 - "Community 120"
Cohesion: 0.16
Nodes (12): LOGIN_ALERT_KINDS, CLIENT_RULES, OS_RULES, normalizeRecoveryCode(), formatRecoveryCode(), normalizeReleaseVersion(), compareReleaseVersions(), hasUnseenWhatsNew() (+4 more)

### Community 152 - "Community 152"
Cohesion: 0.24
Nodes (9): MIME_TYPES, STATES, text(), normalizeAttachment(), normalizeAttachments(), attachmentTextFallback(), assert, test (+1 more)

### Community 141 - "Community 141"
Cohesion: 0.31
Nodes (11): clamp(), normalizeChannel(), srgbToLinear(), linearToSrgb(), rgbToOklch(), oklchToLinearRgb(), isInSrgbGamut(), fitChromaToSrgb() (+3 more)

### Community 188 - "Community 188"
Cohesion: 0.29
Nodes (6): CapabilityRequires, CapabilityPublicNode, CapabilityInternalNode, CapabilityOperatorNode, CapabilityReplicaConsensus, CapabilityManifest

### Community 128 - "Community 128"
Cohesion: 0.21
Nodes (10): PUBLIC_CAPABILITY_KEYS, INTERNAL_NODE_KEYS, OPERATOR_KEYS, isObject(), toStringArray(), normalizePublicNode(), normalizeInternalNode(), normalizeOperatorNode() (+2 more)

### Community 53 - "Community 53"
Cohesion: 0.08
Nodes (33): { listReactionEmojis }, GROUP_ANCHORS, buildGroups(), listReactionEmojiGroups(), reactionEmojiGroupKey(), { listReactionEmojis }, SKIN_TONES, TONE_SET (+25 more)

### Community 165 - "Community 165"
Cohesion: 0.36
Nodes (9): MEMBERSHIP_ROLES, MEMBERSHIP_ROLE_SET, isObject(), cleanString(), normalizeMembershipLimit(), normalizeMembershipRequest(), normalizeMembershipMember(), buildMembershipEnvelope() (+1 more)

### Community 226 - "Community 226"
Cohesion: 0.83
Nodes (3): cleanId(), normalizeMentionUserIds(), mentionUserIdsFromContent()

### Community 142 - "Community 142"
Cohesion: 0.27
Nodes (12): HISTORY_MODES, HISTORY_MODE_SET, MESSAGE_KIND_SET, isObject(), cleanString(), isOpaqueCursor(), normalizeLimit(), normalizeHistoryRequest() (+4 more)

### Community 189 - "Community 189"
Cohesion: 0.29
Nodes (6): ConversationRef, ReplyPointer, ReplyPreview, IdempotencyDescriptor, SendEnvelope, MessageDeliveryEvent

### Community 158 - "Community 158"
Cohesion: 0.53
Nodes (10): DELIVERY_EVENT_TYPES, isObject(), cleanString(), normalizeConversation(), isSystemCard(), normalizeReplyPointer(), normalizeReplyPreview(), normalizeIdempotency() (+2 more)

### Community 106 - "Community 106"
Cohesion: 0.16
Nodes (16): MODERATION_DURATIONS, MODERATION_DURATION_MS, cleanString(), normalizeModerationLimit(), normalizeBanDuration(), durationToExpiresAt(), normalizeBanMutation(), normalizeIdempotencyKey() (+8 more)

### Community 206 - "Community 206"
Cohesion: 0.53
Nodes (5): PLATFORM_CLASSES, normalizedString(), classifyPlatform(), platformPolicy(), classifyPlatformPolicy()

### Community 215 - "Community 215"
Cohesion: 0.40
Nodes (4): ReactionMutation, ReactionSummary, Reactor, ReactorPage

### Community 207 - "Community 207"
Cohesion: 0.33
Nodes (5): RoomMessageTextSegmentV1, RoomMessageLinkSegmentV1, RoomMessageMentionSegmentV1, RoomMessageSegmentV1, RoomMessageContentV1

### Community 172 - "Community 172"
Cohesion: 0.44
Nodes (8): cleanString(), cleanHttpUrl(), utf8ByteLength(), normalizeSegment(), normalizeRoomMessageContent(), projectKnownContent(), projectRoomMessageContent(), contentFromLegacyText()

### Community 143 - "Community 143"
Cohesion: 0.28
Nodes (11): DEFAULT_RUNTIME_CONFIG, normalizeLiveKitUrl(), normalizeLiveKitServerUrl(), inheritLiveKitGateCredential(), resolveLiveKitConnectUrls(), normalizePayload(), parseRuntimeConfig(), getRuntimeConfig() (+3 more)

### Community 74 - "Community 74"
Cohesion: 0.11
Nodes (26): SCREEN_PROFILE_IDS, PRESENCE_STATUSES, PRESENCE_STATUS_SET, normalizeRoomId(), normalizePeerId(), normalizeSessionToken(), cleanName(), normalizeLogin() (+18 more)

### Community 145 - "Community 145"
Cohesion: 0.15
Nodes (10): test, assert, crypto, fs, path, { pathToFileURL }, {
  EMOJI_REACTION_AUTHORITY,
  assertReactionEmoji,
  cleanReactionEmoji,
  isReactionEmoji,
  listReactionEmojis
}, ROOT (+2 more)

### Community 162 - "Community 162"
Cohesion: 0.20
Nodes (9): assert, fs, path, { pathToFileURL }, test, cjs, CORPUS, 2ca6443 test(shared): lock platform classification contract (+1 more)

### Community 167 - "Community 167"
Cohesion: 0.22
Nodes (9): assert, fs, path, { pathToFileURL }, test, packageJson, commonJs, snapshot() (+1 more)

### Community 225 - "Community 225"
Cohesion: 0.50
Nodes (2): extensions, files

### Community 102 - "Community 102"
Cohesion: 0.17
Nodes (18): require, { AccessToken, TrackSource }, { createGateCredentialSigner }, { createDbPool }, { runMigrations }, { createRoomStore }, PRINCIPAL, sleep() (+10 more)

### Community 146 - "Community 146"
Cohesion: 0.15
Nodes (10): require, { createGateCredentialSigner }, { createLiveKitAuthGateService, extractCredential }, { createRoomStore }, { createRoomRealtimeRuntime }, WEB_ROOM_COVERAGE_SCRIPT, ADMISSION_INTERNAL_COVERAGE_SCRIPT, SERVER_INTERNAL_COVERAGE_SCRIPT (+2 more)

### Community 219 - "Community 219"
Cohesion: 0.40
Nodes (1): FakeSocket

### Community 211 - "Community 211"
Cohesion: 0.60
Nodes (5): 0d5875a fix: close migration dependency audit finding, 7a27ba8 chore: prepare v2.0.0 release, 983e909 Merge pull request #11 from dazeGG/hotfix/api-docker-workspace-start-develop, c6b8624 fix: start api workspace in docker image, dcda22d chore: merge v2.0.0 back to develop

### Community 160 - "Community 160"
Cohesion: 0.22
Nodes (8): .github CLAUDE.md Policy, Pull Request Template, docs/GIT_FLOW.md, Root CLAUDE.md, docs/RELEASE_<version>_PLAN.md, apps/CLAUDE.md, apps/web/CLAUDE.md, Room client architecture (ARCHITECTURE.md)

### Community 232 - "Community 232"
Cohesion: 1.00
Nodes (1): config/capability-dag.v1.json

### Community 235 - "Community 235"
Cohesion: 1.00
Nodes (1): Font Assets README

### Community 234 - "Community 234"
Cohesion: 1.00
Nodes (1): Design QA — reusable room and chat menus

### Community 229 - "Community 229"
Cohesion: 1.00
Nodes (1): ADR: Unicode authority for message reactions

### Community 230 - "Community 230"
Cohesion: 1.00
Nodes (1): VoiceRoom 2.5 Architecture Boundaries

### Community 231 - "Community 231"
Cohesion: 1.00
Nodes (1): Backlog

### Community 184 - "Community 184"
Cohesion: 0.48
Nodes (7): docs/CLAUDE.md governance rules, Git Flow workflow, Release 2.4.0 verification plan, Release 2.4.1 verification plan, Release 2.4.2 hotfix verification plan, VoiceRoom 2.5.0 consolidated execution plan, VoiceRoom 2.5.0 unified messaging platform PRD

### Community 237 - "Community 237"
Cohesion: 1.00
Nodes (1): VoiceRoom monitoring agent

### Community 212 - "Community 212"
Cohesion: 0.40
Nodes (5): VoiceRoom 2.5.0 Unified — Verification and Release Evidence Specification, Release 2.6.0 Plan — Engagement & Notifications (Superseded), Release 2.7.0 Plan — Media & Moderation (Superseded), Expiry-Aware Rescue Profile Doc (G85), Predeploy Migrations Doc

### Community 233 - "Community 233"
Cohesion: 1.00
Nodes (1): Capability Readiness Doc

### Community 197 - "Community 197"
Cohesion: 0.33
Nodes (6): Desktop Support Matrix Doc (G19), Release 2.5.0 Durable Evidence Archive Doc (G03), Coordinated Media Backup and Restore Doc, Release 2.5.0 Budgets Doc (G91), Release 2.5.0 Develop Entry Doc (G93), Release 2.5.0 RC Preflight Doc

### Community 238 - "Community 238"
Cohesion: 1.00
Nodes (1): OCI Runtime Publication Doc

### Community 240 - "Community 240"
Cohesion: 1.00
Nodes (1): Production Digest Promotion Doc

### Community 236 - "Community 236"
Cohesion: 1.00
Nodes (1): LiveKit External Auth-Gate Operations Doc (G05)

### Community 241 - "Community 241"
Cohesion: 1.00
Nodes (1): Release 2.5.0 Repairs README

### Community 239 - "Community 239"
Cohesion: 1.00
Nodes (1): packages/CLAUDE.md Guidance

### Community 228 - "Community 228"
Cohesion: 1.00
Nodes (2): VoiceRoom App Icon (Owl Mascot Mark on Dark Rounded Square), VoiceRoom Mascot Mark (Masked Owl Silhouette, Transparent)

## Knowledge Gaps
- **1767 isolated node(s):** `crypto`, `{ transaction }`, `{ verifyPassword }`, `{
  ACCOUNT_DELETION_GRACE_MS,
  DELETED_ACCOUNT_NAME,
  DELETED_LOGIN_PREFIX
}`, `PERSONAL_DATA_CLEANUP` (+1762 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 199`** (2 nodes): `{ createDbPool }`, `createDmHistoryRepository()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 218`** (1 nodes): `FakeSocket`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 209`** (1 nodes): `FakeServer`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 222`** (1 nodes): `FakeSocket`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 174`** (1 nodes): `RealtimeHeartbeatWatchdog`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 45`** (2 nodes): `3c617ec style(web): polish dm day separator`, `7db2783 docs(monitoring): align LiveKit track metric labels`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 214`** (2 nodes): `writeRoomSwitchConfirmEnabled()`, `applyRoomSwitchDecision()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 202`** (1 nodes): `LiveKitReconcileGeneration`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 151`** (1 nodes): `ScreenRecoveryGraceController`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 39`** (2 nodes): `13254ae docs: document durable room storage`, `c860746 feat(web): add static rooms and room chat UI`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 205`** (2 nodes): `ParticipantMenuVariant`, `participantContextMenu`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 216`** (1 nodes): `VoiceRoomDesktopAudioSourceProcessor`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 203`** (2 nodes): `s()`, `o`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 224`** (1 nodes): `e`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 227`** (1 nodes): `MemoryStorage`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 225`** (2 nodes): `extensions`, `files`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 219`** (1 nodes): `FakeSocket`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 232`** (1 nodes): `config/capability-dag.v1.json`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 235`** (1 nodes): `Font Assets README`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 234`** (1 nodes): `Design QA — reusable room and chat menus`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 229`** (1 nodes): `ADR: Unicode authority for message reactions`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 230`** (1 nodes): `VoiceRoom 2.5 Architecture Boundaries`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 231`** (1 nodes): `Backlog`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 237`** (1 nodes): `VoiceRoom monitoring agent`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 233`** (1 nodes): `Capability Readiness Doc`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 238`** (1 nodes): `OCI Runtime Publication Doc`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 240`** (1 nodes): `Production Digest Promotion Doc`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 236`** (1 nodes): `LiveKit External Auth-Gate Operations Doc (G05)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 241`** (1 nodes): `Release 2.5.0 Repairs README`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 239`** (1 nodes): `packages/CLAUDE.md Guidance`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 228`** (2 nodes): `VoiceRoom App Icon (Owl Mascot Mark on Dark Rounded Square)`, `VoiceRoom Mascot Mark (Masked Owl Silhouette, Transparent)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `RealtimeRecoveryController` connect `Community 48` to `Community 9`?**
  _High betweenness centrality (0.008) - this node is a cross-community bridge._
- **What connects `crypto`, `{ transaction }`, `{ verifyPassword }` to the rest of the system?**
  _1767 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 24` be split into smaller, more focused modules?**
  _Cohesion score 0.04220779220779221 - nodes in this community are weakly interconnected._
- **Should `Community 26` be split into smaller, more focused modules?**
  _Cohesion score 0.055218855218855216 - nodes in this community are weakly interconnected._
- **Should `Community 84` be split into smaller, more focused modules?**
  _Cohesion score 0.08333333333333333 - nodes in this community are weakly interconnected._
- **Should `Community 16` be split into smaller, more focused modules?**
  _Cohesion score 0.033921302578018994 - nodes in this community are weakly interconnected._
- **Should `Community 60` be split into smaller, more focused modules?**
  _Cohesion score 0.0784313725490196 - nodes in this community are weakly interconnected._