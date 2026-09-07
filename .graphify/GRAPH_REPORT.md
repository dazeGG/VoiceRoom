# Graph Report - .  (2026-09-07)

## Corpus Check
- Large corpus: 745 files · ~435 557 words. Semantic extraction will be expensive (many Claude tokens). Consider running on a subfolder, or use --no-semantic to run AST-only.

## Summary
- 5774 nodes · 13810 edges · 238 communities detected
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 6 edges (avg confidence: 0.73)
- Token cost: 0 input · 0 output
- Edge kinds: contains: 4399 · MODIFIES: 3376 · calls: 2041 · ON_BRANCH: 1217 · imports: 1205 · imports_from: 759 · PARENT_OF: 513 · method: 202 · re_exports: 59 · references: 23 · inherits: 9 · conceptually_related_to: 4 · semantically_similar_to: 2 · implements: 1


## Input Scope
- Requested: auto
- Resolved: committed (source: default-auto)
- Included files: 745 · Candidates: 856
- Excluded: 45 untracked · 25881 ignored · 13 sensitive · 0 missing committed
- Recommendation: Use --scope all or graphify.yaml inputs.corpus for a knowledge-base folder.

## Graph Freshness
- Built from Git commit: `6baa520`
- Compare this hash to `git rev-parse HEAD` before trusting freshness-sensitive graph output.
## God Nodes (most connected - your core abstractions)
1. `sendJson()` - 70 edges
2. `createTestDatabase()` - 34 edges
3. `runMigrations()` - 33 edges
4. `readJsonBody()` - 31 edges
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

### Community 123 - "Community 123"
Cohesion: 0.16
Nodes (14): http, net, { URL }, { createDbPool }, { createGateCredentialSigner }, { createCredentialBoundaryService }, { createRoomStore }, normalizeGatePath() (+6 more)

### Community 55 - "Community 55"
Cohesion: 0.06
Nodes (26): crypto, CONTEXTS, MIME_TYPES, mapAttachment(), createAttachmentRepository(), test, assert, {
  createAttachmentRepository,
  mapAttachment
} (+18 more)

### Community 133 - "Community 133"
Cohesion: 0.16
Nodes (9): crypto, JOB_KINDS, MediaJobFenceError, mapMediaJob(), createMediaJobRepository(), test, assert, {
  MediaJobFenceError,
  createMediaJobRepository,
  mapMediaJob
} (+1 more)

### Community 169 - "Community 169"
Cohesion: 0.27
Nodes (7): createMediaMaintenanceService(), createMediaMaintenanceWorker(), main(), assert, test, { createMediaMaintenanceService }, { createMediaMaintenanceWorker }

### Community 0 - "Community 0"
Cohesion: 0.01
Nodes (184): fs, createMediaPressureService(), createMediaQuotaRepository(), registerMembershipRoutes(), createDirectMessageRepository(), { createDbPool, transaction }, createMessageReadRepository(), registerRoomHistoryRoutes() (+176 more)

### Community 226 - "Community 226"
Cohesion: 0.50
Nodes (2): MediaQuotaError, createMediaQuotaService()

### Community 120 - "Community 120"
Cohesion: 0.15
Nodes (12): createMediaReconciliationService(), { createDbPool }, { createAttachmentRepository }, { createMediaReconciliationService }, { createMediaJobRepository }, { createMediaStorage }, createMediaReconciliationWorker(), main() (+4 more)

### Community 170 - "Community 170"
Cohesion: 0.24
Nodes (6): registerMediaRoutes(), test, assert, fastify, { registerMediaRoutes }, createApp()

### Community 100 - "Community 100"
Cohesion: 0.12
Nodes (16): sharp, FORMAT_MIME, PNG_END, MediaServiceError, readBounded(), detectExactContainer(), createMediaService(), assert (+8 more)

### Community 51 - "Community 51"
Cohesion: 0.06
Nodes (27): MediaVisibilityError, createMediaVisibilityService(), http, { renderPrometheus }, startWorkerMetricsServer(), { startWorkerMetricsServer }, { startWorkerHeartbeat }, workers (+19 more)

### Community 87 - "Community 87"
Cohesion: 0.12
Nodes (18): crypto, fs, path, VARIANTS, STORAGE_KEY_PATTERN, validateAttachmentId(), validateVariant(), createStorageKey() (+10 more)

### Community 98 - "Community 98"
Cohesion: 0.11
Nodes (16): { buildMembershipEnvelope, normalizeMembershipRequest }, presenceForUser(), createMemberDirectoryService(), assert, { test }, { createMemberDirectoryService, presenceForUser }, model, membershipModel (+8 more)

### Community 129 - "Community 129"
Cohesion: 0.16
Nodes (13): crypto, toMillis(), mapMembership(), mapDirectoryMember(), createMembershipRepository(), { transaction }, { createMembershipRepository }, createMembershipService() (+5 more)

### Community 54 - "Community 54"
Cohesion: 0.06
Nodes (27): {
  normalizeRoomMessageContent,
  projectRoomMessageContent
}, projectStoredRoomMessage(), {
  contentFromLegacyText,
  normalizeRoomMessageContent,
  projectRoomMessageContent
}, createContentRepository(), assert, fs, path, test (+19 more)

### Community 205 - "Community 205"
Cohesion: 0.33
Nodes (2): { createDbPool }, createDmHistoryRepository()

### Community 227 - "Community 227"
Cohesion: 0.50
Nodes (1): registerDmHistoryRoutes()

### Community 156 - "Community 156"
Cohesion: 0.20
Nodes (8): {
  buildHistoryEnvelope,
  normalizeHistoryRequest
}, DmHistoryError, canonicalParticipants(), createDmHistoryService(), assert, { test }, { createCursorCodec }, { canonicalParticipants, createDmHistoryService }

### Community 157 - "Community 157"
Cohesion: 0.21
Nodes (8): crypto, IdempotencyQuotaError, boundedString(), normalizeIdentity(), encodeParts(), ledgerKey(), actorLockKey(), createMessageIdempotencyRepository()

### Community 138 - "Community 138"
Cohesion: 0.14
Nodes (10): IdempotencyConflictError, assert, fs, path, { test }, { requireReplyTarget }, assert, { test } (+2 more)

### Community 121 - "Community 121"
Cohesion: 0.14
Nodes (12): crypto, { buildMessageDeliveryEvent }, MessageDeliveryFenceError, requireQuery(), encodeParts(), logicalKey(), createMessageOutboxRepository(), assert (+4 more)

### Community 74 - "Community 74"
Cohesion: 0.08
Nodes (18): MessageReadError, createMessageReadService(), assert, fs, path, { test }, assert, fs (+10 more)

### Community 28 - "Community 28"
Cohesion: 0.04
Nodes (13): { buildMessageDeliveryEvent }, AnchoredHistoryPage, AnchoredHistoryOptions, SelectedMention, AttachmentContext, AttachmentState, MessageAttachment, EmojiReactionAuthority (+5 more)

### Community 171 - "Community 171"
Cohesion: 0.22
Nodes (5): { ReplyTargetUnavailableError }, REPLY_CONFLICT_BODY, createMessageReplyHandlers(), registerMessageReplyRoutes(), ReplyTargetUnavailableError

### Community 134 - "Community 134"
Cohesion: 0.17
Nodes (10): { createMessageVisibilityService }, createMessageService(), MessageVisibilityError, createMessageVisibilityService(), assert, fs, path, { test } (+2 more)

### Community 216 - "Community 216"
Cohesion: 0.60
Nodes (4): requireQuery(), toMillis(), mapPin(), createPinRepository()

### Community 88 - "Community 88"
Cohesion: 0.11
Nodes (8): registerPinRoutes(), test, assert, { TrackSource }, { __private, createApiApp }, ReactionEmojiGroup, 2ea3623 Merge pull request #116 from dazeGG/feature/2.5.0-manual-fixes, 60484d7 feat(api): add contextual social and room actions

### Community 192 - "Community 192"
Cohesion: 0.43
Nodes (5): PinServiceError, normalizeRoomId(), normalizeMessageId(), requireAccount(), createPinService()

### Community 76 - "Community 76"
Cohesion: 0.10
Nodes (17): createReactionRealtimeAdapter(), registerReactionRoutes(), {
  normalizeReactionMutation,
  normalizeReactionSummary,
  normalizeReactorPage,
  normalizeReactorQuery
}, ReactionServiceError, normalizeConversation(), createReactionService(), assert, test (+9 more)

### Community 193 - "Community 193"
Cohesion: 0.33
Nodes (3): CONTEXT_TABLES, requireQuery(), createReactionRepository()

### Community 78 - "Community 78"
Cohesion: 0.14
Nodes (20): { REPLY_PREVIEW_TEXT_MAX_LENGTH, isSystemCard }, toMillis(), messageId(), isInvitation(), isReplyTargetKindAllowed(), isUnavailable(), projectAuthor(), projectText() (+12 more)

### Community 206 - "Community 206"
Cohesion: 0.33
Nodes (2): { createDbPool }, createRoomHistoryRepository()

### Community 66 - "Community 66"
Cohesion: 0.09
Nodes (20): {
  buildHistoryEnvelope,
  normalizeHistoryRequest
}, RoomHistoryError, createRoomHistoryService(), crypto, CursorCodecError, sha256(), normalizeString(), normalizeMicrosecond() (+12 more)

### Community 73 - "Community 73"
Cohesion: 0.10
Nodes (18): crypto, toMillis(), mapActiveBan(), normalizePrincipal(), createActiveBanRepository(), { transaction }, { createActiveBanRepository, normalizePrincipal }, createActiveBanService() (+10 more)

### Community 166 - "Community 166"
Cohesion: 0.27
Nodes (8): { transaction }, requireOperation(), attachmentRevoker(), cleanupEnqueuer(), createMessageModerationService(), test, assert, { createMessageModerationService }

### Community 112 - "Community 112"
Cohesion: 0.16
Nodes (13): crypto, toMillis(), mapModerationBan(), createModerationRepository(), {
  buildModerationPage,
  durationToExpiresAt,
  normalizeBanMutation,
  normalizeIdempotencyKey,
  normalizeModerationPageRequest
}, { transaction }, { createModerationRepository }, createModerationService() (+5 more)

### Community 228 - "Community 228"
Cohesion: 0.50
Nodes (1): registerModerationRoutes()

### Community 38 - "Community 38"
Cohesion: 0.06
Nodes (28): crypto, { transaction }, createInboxRepository(), { transaction }, { buildNotificationEnvelope, buildProviderPayload, normalizeNotificationLevel, normalizeNotificationLimit }, createNotificationService(), { Pool }, { readDatabaseConfig } (+20 more)

### Community 172 - "Community 172"
Cohesion: 0.22
Nodes (7): { normalizeMentionUserIds }, MentionEligibilityError, createMentionEligibilityService(), assert, test, {normalizeMentionUserIds}, {createMentionEligibilityService}

### Community 217 - "Community 217"
Cohesion: 0.40
Nodes (2): crypto, createMentionRepository()

### Community 53 - "Community 53"
Cohesion: 0.07
Nodes (23): crypto, NotificationFenceError, createNotificationOutboxRepository(), createNotificationPushProvider(), { createDbPool }, { readEnvBool, readEnvInt }, { createPushStore }, { createNotificationOutboxRepository } (+15 more)

### Community 69 - "Community 69"
Cohesion: 0.11
Nodes (22): { createPushService }, crypto, EXACT_PUSH_HOSTS, isAllowedPushHost(), cleanPushEndpoint(), describePushEndpoint(), webPush, { PLATFORM_CLASSES } (+14 more)

### Community 155 - "Community 155"
Cohesion: 0.24
Nodes (10): crypto, sharp, { deriveAvatarAccent, dominantAvatarColor }, detectAvatarFormat(), processAvatar(), createAvatarKey(), test, assert (+2 more)

### Community 10 - "Community 10"
Cohesion: 0.04
Nodes (25): reconcileAvatarStorage(), test, assert, { reconcileAvatarStorage }, AvatarCropShape, AvatarCropDialogProps, AvatarProps, MascotVariant (+17 more)

### Community 70 - "Community 70"
Cohesion: 0.08
Nodes (21): fs, path, { readUploadsDir }, AVATAR_KEY_PATTERN, validateAvatarKey(), createAvatarStorage(), test, assert (+13 more)

### Community 83 - "Community 83"
Cohesion: 0.13
Nodes (19): path, readEnvInt(), readEnvBool(), readMessageDeliveryMode(), readDatabaseConfig(), readUploadsDir(), { readDatabaseConfig }, { runMigrations } (+11 more)

### Community 93 - "Community 93"
Cohesion: 0.14
Nodes (14): createDbPool(), crypto, { createDbPool, transaction }, { createActiveBanService }, {
  AVATAR_COLOR_KEYS,
  cleanAvatarColorKey
}, normalizePositiveInt(), toDate(), toMillis() (+6 more)

### Community 5 - "Community 5"
Cohesion: 0.04
Nodes (48): crypto, { createDbPool, transaction }, { cleanAvatarColorKey, cleanPresenceStatus }, toMillis(), mapPublicUser(), mapInvite(), mapMessage(), orderedPair() (+40 more)

### Community 68 - "Community 68"
Cohesion: 0.07
Nodes (20): fs, net, startApiListener(), test, assert, fs, os, path (+12 more)

### Community 26 - "Community 26"
Cohesion: 0.05
Nodes (37): httpRequests, maintenanceTasks, mediaPressure, labels(), metricLine(), httpKey(), recordHttpRequest(), recordMaintenanceDuration() (+29 more)

### Community 104 - "Community 104"
Cohesion: 0.13
Nodes (15): recordMediaOldestPending(), crypto, sharp, { MediaJobFenceError }, { recordMediaOldestPending }, DEFAULTS, retryDelay(), transform() (+7 more)

### Community 47 - "Community 47"
Cohesion: 0.09
Nodes (28): { Client }, fs, path, { PG_MIGRATE_LOCK_ID, runner }, { readDatabaseConfig }, DEFAULT_MIGRATIONS_DIR, MIGRATION_GUARD_STATES, expectedMigrationCatalog() (+20 more)

### Community 46 - "Community 46"
Cohesion: 0.06
Nodes (29): crypto, { cleanPresenceStatus }, { createDbPool, transaction }, createNotificationStore(), assert, test, {Pool}, {normalizeNotificationLevel} (+21 more)

### Community 146 - "Community 146"
Cohesion: 0.21
Nodes (9): crypto, hasLeadingZeroBits(), parsePowChallenge(), normalizePowNonce(), createProofOfWork(), test, assert, crypto (+1 more)

### Community 105 - "Community 105"
Cohesion: 0.12
Nodes (14): crypto, { createDbPool, transaction }, { classifyPlatform, PLATFORM_CLASSES }, PLATFORM_SIGNAL_METADATA_KEYS, normalizePlatformClass(), resolvePlatformClass(), createPushStore(), test (+6 more)

### Community 181 - "Community 181"
Cohesion: 0.32
Nodes (5): getClientIp(), createRateLimiter(), test, assert, { getClientIp, createRateLimiter }

### Community 9 - "Community 9"
Cohesion: 0.04
Nodes (28): createRoomStore(), test, assert, { createRoomStore, mapMessage, mapRoom }, test, assert, { bootstrap, createApiServer }, AuthUser (+20 more)

### Community 8 - "Community 8"
Cohesion: 0.03
Nodes (57): crypto, { createDbPool, transaction }, { hashPassword, verifyPassword }, { AVATAR_COLOR_KEYS, cleanAvatarColorKey, cleanPresenceStatus }, toMillis(), mapUser(), publicUser(), hashSessionToken() (+49 more)

### Community 58 - "Community 58"
Cohesion: 0.06
Nodes (19): test, assert, migration, membershipMigration, visualIdentityMigration, friendsMigration, notificationMigration, roomBansMigration (+11 more)

### Community 52 - "Community 52"
Cohesion: 0.06
Nodes (28): assert, fs, { performance }, path, { Client }, { runner }, { test }, { classifyPlatform } (+20 more)

### Community 50 - "Community 50"
Cohesion: 0.08
Nodes (29): { listReactionEmojis }, GROUP_ANCHORS, buildGroups(), listReactionEmojiGroups(), reactionEmojiGroupKey(), REACTION_EMOJIS, EMOJI_REACTION_AUTHORITY, REACTION_EMOJI_SET (+21 more)

### Community 24 - "Community 24"
Cohesion: 0.05
Nodes (29): assert, fs, path, test, BLOCKED_ROUTES, router, sw, desktop (+21 more)

### Community 92 - "Community 92"
Cohesion: 0.11
Nodes (17): { PUBLIC_CAPABILITY_KEYS }, HEALTH_CAPABILITIES_LIMITS, publicFeatureFlags(), formatCapabilityPayload(), registerCapabilityRoutes(), createCapabilitySnapshot(), assert, { mkdtempSync, readFileSync, writeFileSync } (+9 more)

### Community 89 - "Community 89"
Cohesion: 0.12
Nodes (15): crypto, LeaseLostError, abortError(), delay(), boundedBackoff(), createLeaseRuntime(), { createDbPool }, { readEnvInt, readMessageDeliveryMode } (+7 more)

### Community 79 - "Community 79"
Cohesion: 0.15
Nodes (22): crypto, { existsSync, readFileSync }, path, {
  normalizeManifest,
  PUBLIC_CAPABILITY_KEYS,
  OPERATOR_KEYS,
  toSet
}, resolveManifestPath(), sha256Hex(), readManifestText(), asSet() (+14 more)

### Community 62 - "Community 62"
Cohesion: 0.08
Nodes (25): createRuntimeReadinessRepository(), { PUBLIC_CAPABILITY_KEYS }, { createReadinessReport, resolveManifestPath }, { createRuntimeReadinessRepository }, failClosedSnapshot(), createRuntimeReadinessProvider(), os, { createDbPool } (+17 more)

### Community 14 - "Community 14"
Cohesion: 0.06
Nodes (46): { buildServerEnvelope }, toWsAccountEvent(), {
  parseClientEnvelope,
  buildServerEnvelope,
  buildServerErrorEnvelope,
  validateClientCommand
}, serializeEnvelope(), sendWsEnvelope(), parseInboundMessage(), { buildServerEnvelope }, legacyPeerMessageToWs() (+38 more)

### Community 140 - "Community 140"
Cohesion: 0.15
Nodes (9): resolveViewedScreenPeerId(), clearViewedScreenPeerReferences(), test, assert, {
  clearViewedScreenPeerReferences,
  createRoomRealtimeRuntime,
  resolveViewedScreenPeerId
}, OWNER_TOKEN, VIEWER_TOKEN, createRuntime() (+1 more)

### Community 141 - "Community 141"
Cohesion: 0.15
Nodes (10): createWsHandler(), test, assert, { EventEmitter }, { createWsHandler }, TOKEN_A, TOKEN_B, FakeSocket (+2 more)

### Community 23 - "Community 23"
Cohesion: 0.07
Nodes (52): fastify, getLogLevel(), createFastifyLoggerOptions(), resolveCursorHmacKeys(), getHistoryServices(), release250FeatureEnabled(), getRelease250Pool(), getReactionServices() (+44 more)

### Community 142 - "Community 142"
Cohesion: 0.14
Nodes (14): resolveRealtimeReconnectLeaseMs(), getPresenceRoom(), attachPresence(), createRoomId(), pruneRooms(), startPruneTimer(), createRoomForRequest(), getRoom() (+6 more)

### Community 49 - "Community 49"
Cohesion: 0.11
Nodes (37): getRoomStore(), getAvatarStorage(), resolveSessionUser(), sessionDisplayName(), countRoomCreationQuotaRoomsForIp(), publicPeer(), queueRoomOccupancyTransition(), sendEvent() (+29 more)

### Community 196 - "Community 196"
Cohesion: 0.38
Nodes (7): getUserStore(), buildSessionCookie(), clearSessionCookie(), handleRegister(), handleLogin(), handleLogout(), handleChangePassword()

### Community 21 - "Community 21"
Cohesion: 0.12
Nodes (53): getFriendStore(), getMessageService(), getNotificationStore(), getPushStore(), getPushService(), broadcastToUser(), notificationActor(), queuePush() (+45 more)

### Community 230 - "Community 230"
Cohesion: 0.50
Nodes (4): getLiveKitConnectSources(), baseHeaders(), openAvatarStream(), handleGetAvatar()

### Community 164 - "Community 164"
Cohesion: 0.17
Nodes (6): createApiServer(), test, assert, http, { __private, createApiServer }, { openWs, joinVoiceRoom, sendWs, waitForWsType }

### Community 114 - "Community 114"
Cohesion: 0.11
Nodes (11): { socketPathForDirectory }, test, assert, fs, http, { spawn }, path, os (+3 more)

### Community 32 - "Community 32"
Cohesion: 0.05
Nodes (34): test, assert, { Client }, { createTestDatabase }, { runMigrations }, SILENT, NEW_TABLES, crypto (+26 more)

### Community 210 - "Community 210"
Cohesion: 0.40
Nodes (5): test, assert, { createApiApp }, waitForFrame(), openAccountWs()

### Community 184 - "Community 184"
Cohesion: 0.29
Nodes (5): test, assert, { createApiApp }, waitForFrame(), openWs()

### Community 61 - "Community 61"
Cohesion: 0.08
Nodes (21): test, assert, fs, path, { spawnSync }, repositoryRoot, require, { createGateCredentialSigner } (+13 more)

### Community 150 - "Community 150"
Cohesion: 0.15
Nodes (11): test, assert, { EventEmitter }, fs, net, path, { spawnSync }, { createApiApp } (+3 more)

### Community 223 - "Community 223"
Cohesion: 0.40
Nodes (1): FakeSocket

### Community 80 - "Community 80"
Cohesion: 0.11
Nodes (17): assert, fs, os, path, test, normalizePath(), walkFiles(), globToRegExp() (+9 more)

### Community 211 - "Community 211"
Cohesion: 0.33
Nodes (5): assert, fs, path, { test }, { LEASE_IDENTITY, createMessageDeliveryWorker }

### Community 199 - "Community 199"
Cohesion: 0.29
Nodes (6): assert, fs, path, { test }, { readMessageDeliveryMode }, { createReadinessReport }

### Community 153 - "Community 153"
Cohesion: 0.15
Nodes (5): assert, fastify, test, { registerMediaRoutes }, { createMediaVisibilityService }

### Community 185 - "Community 185"
Cohesion: 0.25
Nodes (6): test, assert, fs, path, repositoryRoot, profile

### Community 85 - "Community 85"
Cohesion: 0.10
Nodes (18): path, socketPathForDirectory(), { socketPathForDirectory }, test, assert, crypto, fs, http (+10 more)

### Community 212 - "Community 212"
Cohesion: 0.33
Nodes (1): FakeServer

### Community 115 - "Community 115"
Cohesion: 0.11
Nodes (12): test, assert, Fastify, { Pool }, { createPinRepository }, { createPinService }, { registerPinRoutes }, { createRoomStore } (+4 more)

### Community 94 - "Community 94"
Cohesion: 0.12
Nodes (16): { socketPathForDirectory }, test, assert, fs, http, { spawn }, path, os (+8 more)

### Community 59 - "Community 59"
Cohesion: 0.10
Nodes (29): { socketPathForDirectory }, test, assert, fs, http, { spawn }, path, os (+21 more)

### Community 101 - "Community 101"
Cohesion: 0.12
Nodes (14): { socketPathForDirectory }, test, assert, fs, http, os, path, { createApiApp, createApiServer } (+6 more)

### Community 110 - "Community 110"
Cohesion: 0.11
Nodes (12): { socketPathForDirectory }, test, assert, fs, http, { spawn }, path, os (+4 more)

### Community 116 - "Community 116"
Cohesion: 0.11
Nodes (12): { socketPathForDirectory }, test, assert, fs, http, { spawn }, path, os (+4 more)

### Community 95 - "Community 95"
Cohesion: 0.11
Nodes (15): { socketPathForDirectory }, test, assert, fs, http, { spawn }, path, os (+7 more)

### Community 29 - "Community 29"
Cohesion: 0.05
Nodes (8): 2137216 fix(chat): unify image captions, 24d9640 fix(chat): restore clipboard image uploads, 3d21918 fix(chat): complete clipboard image processing, 4a58e90 fix(chat): refine attachment composer visuals, 63e4eb1 fix(chat): align attachment previews, 6c425ac fix(chat): restore room invitations, 9eaca9b feat(chat): redesign image attachment composer, f9e04c6 fix(chat): keep attachment composer anchored

### Community 45 - "Community 45"
Cohesion: 0.13
Nodes (18): uniqueLogin(), authDialog(), registerViaUi(), loginViaUi(), createPermanentRoom(), enterRoom(), roomHeading(), roomHeadingMenuButton() (+10 more)

### Community 86 - "Community 86"
Cohesion: 0.09
Nodes (14): model, router, ui, inbox, reconcile, room, ui, ReadReconciliationOptions (+6 more)

### Community 91 - "Community 91"
Cohesion: 0.11
Nodes (18): store, summary, picker, reactors, room, dm, REQUIRED_PROFILES, REQUIRED_CLIENTS (+10 more)

### Community 67 - "Community 67"
Cohesion: 0.11
Nodes (22): component, api, lobby, room, sha256(), filesBelow(), resolvedProspectivePath(), containsPath() (+14 more)

### Community 57 - "Community 57"
Cohesion: 0.07
Nodes (12): Window, DesktopAsset, DesktopRelease, DesktopBuild, DESKTOP_BUILDS, e, API_PROXY, 634b607 feat(web): prepare Voice Room 1.7.0 (+4 more)

### Community 43 - "Community 43"
Cohesion: 0.09
Nodes (18): AttachmentContext, AttachmentDraftState, AttachmentDraft, Envelope, AttachmentApiError, createAttachmentSlot(), uploadAttachmentContent(), getAttachmentStatus() (+10 more)

### Community 96 - "Community 96"
Cohesion: 0.15
Nodes (16): RoomRelationship, OwnedRoom, avatarRequest(), uploadUserAvatar(), deleteUserAvatar(), Credentials, RegisterInput, authPost() (+8 more)

### Community 117 - "Community 117"
Cohesion: 0.18
Nodes (12): BlockStatus, blockUrl(), blockUser(), unblockUser(), getJsonAuth(), roomModerationUrl(), parsePage(), responseJson() (+4 more)

### Community 102 - "Community 102"
Cohesion: 0.15
Nodes (14): CapabilityKey, CapabilityFeatures, CapabilityResponse, loadCapabilities(), resetCapabilities(), isCapabilityReady(), CapabilityEdge, CapabilityState (+6 more)

### Community 6 - "Community 6"
Cohesion: 0.05
Nodes (70): DirectMessageInvite, DirectMessageHistoryPage, HistoryMessageDto, fetchThread(), fetchThreadPage(), sendDirectMessage(), markThreadRead(), deleteDirectMessage() (+62 more)

### Community 144 - "Community 144"
Cohesion: 0.21
Nodes (12): DirectMessage, ThreadSnapshot, ThreadMutation, ActiveResync, ThreadResyncOptions, ResyncRequestOptions, newestTimestamp(), contentVersion() (+4 more)

### Community 118 - "Community 118"
Cohesion: 0.23
Nodes (15): FetchMembershipsOptions, fetchRoomMemberships(), leaveRoomMembership(), RoomMembershipEntry, roomMembershipState, emptyEntry(), cacheKey(), readCache() (+7 more)

### Community 30 - "Community 30"
Cohesion: 0.08
Nodes (34): NotificationPreferences, NotificationPreferencesResponse, NotificationMuteResponse, fetchNotificationPreferences(), setDmNotificationsMuted(), setRoomNotificationsMuted(), setPrivateNotifications(), setDoNotDisturb() (+26 more)

### Community 119 - "Community 119"
Cohesion: 0.18
Nodes (12): PinnedMessageAuthor, PinnedMessage, PinSnapshot, PinResponse, pinAuthor(), pinUrl(), fetchRoomPins(), pinRoomMessage() (+4 more)

### Community 124 - "Community 124"
Cohesion: 0.21
Nodes (13): PushConfig, fetchPushConfig(), savePushSubscription(), deletePushSubscription(), pushNotifications, syncQueue, decodeVapidKey(), getRegistration() (+5 more)

### Community 63 - "Community 63"
Cohesion: 0.13
Nodes (15): ReactionConversation, reactionUrl(), validSummaries(), fetchReactionSummaries(), setReactionDesired(), fetchReactors(), ReactionSnapshotView, replaceReactionSnapshot() (+7 more)

### Community 81 - "Community 81"
Cohesion: 0.09
Nodes (9): RealtimeHeartbeatWatchdog, LiveKitReconcileGeneration, root, require, ts, moduleUrl(), loadRoomRealtime(), source (+1 more)

### Community 111 - "Community 111"
Cohesion: 0.14
Nodes (15): RealtimeAccountEvent, RealtimeRoomEvent, RealtimeErrorEvent, ReactionRealtimeEvent, PinsRealtimeEvent, MusicRealtimeEvent, ServerEnvelope, RealtimeHandle (+7 more)

### Community 16 - "Community 16"
Cohesion: 0.06
Nodes (32): RoomRealtimeSummary, RoomPeer, roomPresence, roomChatReadSessions, roomChatIsBeingRead(), applyRoomSummary(), setRoomUnreadCount(), beginRoomChatReadSession() (+24 more)

### Community 72 - "Community 72"
Cohesion: 0.11
Nodes (20): RoomSnapshot, RealtimeEvent, RoomDetailHandler, previewSubscriptions, detailHandlers, retainDetailDispatch(), retryableActiveResyncErrors, clearActiveResync() (+12 more)

### Community 103 - "Community 103"
Cohesion: 0.14
Nodes (4): wsUrl(), AppRealtimeConnection, getAppRealtime(), connectRealtime()

### Community 213 - "Community 213"
Cohesion: 0.60
Nodes (4): ChatMessage, presenceFor(), participantProfilePerson(), roomMessageProfilePerson()

### Community 202 - "Community 202"
Cohesion: 0.33
Nodes (1): lang

### Community 2 - "Community 2"
Cohesion: 0.03
Nodes (19): state, ToastOptions, guestNameUi, screenSourceUi, startUi, toastUi, dismissToastUi(), invokeToastAction() (+11 more)

### Community 11 - "Community 11"
Cohesion: 0.04
Nodes (20): root, root, 09e2f5e feat(web): restore room avatar settings, 48bcc0d fix(web): silence notification success toasts, 5137885 fix(api): guard room removal and muted joins, 5b7d102 chore(release): back-merge 2.4.0 into develop, 672bc61 Allow selecting push to talk before hotkey, 70b16b9 fix(web): align stream tiles and viewer cues (#59) (+12 more)

### Community 19 - "Community 19"
Cohesion: 0.05
Nodes (25): 0a0699b chore: release v2.1.2, 0d30394 chore: merge v2.1.1 back to develop, 0d74cad Merge branch 'release/2.1.6', 0f3d7a0 Merge branch 'hotfix/2.1.3', 0ffac54 feat(infra): expose livekit prometheus metrics for status stack (#22), 1840f18 chore: release v2.1.4, 2684b15 chore: release v2.1.3, 2994d09 fix(api): return friend request id from listRequests (+17 more)

### Community 33 - "Community 33"
Cohesion: 0.08
Nodes (37): root, require, ts, read(), readRoomChat(), readPreviewChat(), importTypeScript(), readTree() (+29 more)

### Community 64 - "Community 64"
Cohesion: 0.06
Nodes (2): 01a206a chore: release v2.1.1, cce23b6 fix(web): stabilize preview chat identity

### Community 56 - "Community 56"
Cohesion: 0.07
Nodes (12): LeaveHandler, ControlHandler, voiceSession, 08e3e13 Merge branch 'hotfix/2.2.1', 17edd27 feat(web): add lobby voice controls widget, 397400d chore(release): bump version to 2.2.2, 3b6010b Merge branch 'release/2.2.2', 3ce55ad fix(web): dedupe self avatar and drop count label in room list (+4 more)

### Community 17 - "Community 17"
Cohesion: 0.05
Nodes (18): toastState, ToastOptions, BadgeProps, ButtonProps, DialogProps, SwitchProps, ToastItem, ToastStackProps (+10 more)

### Community 90 - "Community 90"
Cohesion: 0.13
Nodes (6): profileCardUi, ProfileCardAnchor, ProfileCardPerson, ProfileCardRelationship, ProfileCardProps, c80ed8a feat(web): expand contextual menus

### Community 158 - "Community 158"
Cohesion: 0.24
Nodes (6): pad(), formatTime(), MONTHS, startOfDay(), isSameDay(), formatChatDayLabel()

### Community 130 - "Community 130"
Cohesion: 0.20
Nodes (12): RoomShellMode, roomNavigation, getActiveVoiceRoomId(), connectedRoomIsViewed(), embeddedRoomIsVisible(), setViewedRoomFromRoute(), routeToRoom(), selectRoomPreview() (+4 more)

### Community 18 - "Community 18"
Cohesion: 0.06
Nodes (44): DeviceOption, NoiseOption, NOISE_OPTIONS, SoundSettings, isGateDisabled(), gateValueLabel(), readDeviceId(), readSoundSettings() (+36 more)

### Community 1 - "Community 1"
Cohesion: 0.04
Nodes (101): SCREEN_STREAM_MODE_PROFILES, SCREEN_QUALITY_OPTIONS, SCREEN_SIMULCAST_LAYER, SCREEN_FPS_OPTIONS, ScreenStreamMode, ScreenProfile, DesktopAudioCapture, DesktopPickerSelection (+93 more)

### Community 12 - "Community 12"
Cohesion: 0.05
Nodes (58): isRoomEmbedded(), extractRoomId(), clearPeerJoinCue(), clearAllPeerJoinCues(), clearStreamViewerCues(), startMeters(), stopMeters(), ApiRequestError (+50 more)

### Community 25 - "Community 25"
Cohesion: 0.06
Nodes (37): HotkeyAction, getHotkeyStorageKey(), getDefaultHotkeyBinding(), readHotkeyBinding(), writeHotkeyBinding(), parseHotkeyBinding(), eventMatchesHotkey(), isTypingTarget() (+29 more)

### Community 44 - "Community 44"
Cohesion: 0.09
Nodes (31): getRoomIdFromPath(), createPeerId(), createSessionToken(), getStoredPeerSession(), rotateStoredPeerSession(), PeerSession, DesktopCaptureSource, ScreenStatsSnapshot (+23 more)

### Community 60 - "Community 60"
Cohesion: 0.10
Nodes (26): getStoredMasterVolume(), AudioBusKind, AudioBusGraph, RoutedSource, routedSources, queueAudioOutputTransition, supportsContextSink(), supportsElementSink() (+18 more)

### Community 65 - "Community 65"
Cohesion: 0.12
Nodes (27): persistMicrophoneVolume(), dbToAmplitude(), MicProcessor, GateNode, NoiseGateEnvelope, isGateDisabled(), getGateThresholdAmplitude(), setNoiseMode() (+19 more)

### Community 77 - "Community 77"
Cohesion: 0.12
Nodes (21): persistMicrophoneMode(), persistOutputMuted(), supportsAudioOutputSelection(), getLocalMicrophoneCapture(), syncVoiceSessionControls(), CallControlsView, OutputControlsView, ScreenControlsView (+13 more)

### Community 22 - "Community 22"
Cohesion: 0.09
Nodes (46): getStoredStreamVolume(), storeStreamVolume(), normalizeStoredStreamVolume(), clampStreamVolume(), setScreenAttendance(), clearScreenAttendance(), releaseScreenAudioFallback(), syncScreenAudioFallback() (+38 more)

### Community 82 - "Community 82"
Cohesion: 0.16
Nodes (22): getStoredMusicMuted(), getParticipantAudioPreferenceKey(), syncScreenVideoAudioSoon(), syncPlaybackMuteState(), syncRemoteAudioPlayback(), applyRemoteParticipantAudioPreferences(), releaseRemoteAudioElement(), getMusicTrackId() (+14 more)

### Community 75 - "Community 75"
Cohesion: 0.13
Nodes (23): MicrophoneCapture, refreshMicrophoneLevelMeterSoon(), attachMeter(), updateMeter(), isLocalMicrophoneSpeaking(), unpublishLocalMicrophone(), GateControlView, toggleGate() (+15 more)

### Community 190 - "Community 190"
Cohesion: 0.33
Nodes (6): waitForUi(), hasLeadingZeroBits(), fetchJson(), RoomProof, createRoomProof(), solveProofOfWork()

### Community 128 - "Community 128"
Cohesion: 0.22
Nodes (11): cleanDisplayName(), saveStartName(), saveNameFromValue(), handleGuestNameSubmit(), requestGuestNameForRoom(), clearPendingGuestNameRequest(), resetGuestNameDialog(), setGuestNameDialogOpen() (+3 more)

### Community 107 - "Community 107"
Cohesion: 0.19
Nodes (18): peerJoinCueTimes, streamViewerCueTimes, isCuePlaybackSuppressed(), getCueGain(), CueNote, playCueSequence(), playDirectMessageCue(), playRoomChatMessageCue() (+10 more)

### Community 15 - "Community 15"
Cohesion: 0.05
Nodes (38): ScreenPublicationPresence, getScreenPublicationPresence(), ScreenReceiverDemand, getScreenReceiverDemand(), SCREEN_SUBSCRIPTION_RETRY_DELAYS_MS, ScreenSubscriptionRetryTarget, ScreenSubscriptionRetryState, ScreenSubscriptionRetryScheduler (+30 more)

### Community 41 - "Community 41"
Cohesion: 0.13
Nodes (10): DEFAULT_RETRY_DELAYS_MS, TERMINAL_CODES, RETRYABLE_CODES, SAFE_CODES, sanitizeRecoveryCode(), classifyRecoveryFailure(), elapsedBucket(), RealtimeRecoveryController (+2 more)

### Community 13 - "Community 13"
Cohesion: 0.06
Nodes (53): RecoveryAttemptOutcome, RoomRecoveryLiveKitAdapter, transitionHandlers, subscribeRoomRecoveryTransitions(), setRoomRecoveryLiveKitAdapter(), startRoomRecovery(), cancelRoomRecovery(), notifyRoomAppConnection() (+45 more)

### Community 160 - "Community 160"
Cohesion: 0.21
Nodes (1): ScreenRecoveryGraceController

### Community 37 - "Community 37"
Cohesion: 0.12
Nodes (40): watchedRemoteScreenTracks, streamCueTimes, attachMeterSoon(), syncLiveKitScreenSubscriptionsSoon(), disconnectScreenSoon(), hideScreenStageSoon(), refreshAllScreenActionsSoon(), refreshScreenStageSoon() (+32 more)

### Community 71 - "Community 71"
Cohesion: 0.17
Nodes (28): syncLiveKitParticipant(), createLiveKitParticipant(), isServerKnownRemotePeer(), syncLiveKitParticipantById(), isMusicBotIdentity(), handleMusicPublication(), scheduleMusicSubscriptionRetry(), handleMusicPublicationGone() (+20 more)

### Community 3 - "Community 3"
Cohesion: 0.06
Nodes (92): 0112d02 fix(infra): pin livekit server version, 02824cd fix(web): surface friend request errors, 049a913 fix(web): keep popover open on ambiguous focus loss, 07e362c chore(omx): update model routing, 0d5875a fix: close migration dependency audit finding, 13254ae docs: document durable room storage, 1718dc1 Bump version to 1.6.1, 2008ab4 feat(web): standardize interactive control sizing (#40) (+84 more)

### Community 208 - "Community 208"
Cohesion: 0.33
Nodes (2): ParticipantMenuVariant, participantContextMenu

### Community 183 - "Community 183"
Cohesion: 0.32
Nodes (4): participantsUi, getSortedParticipants(), getParticipantCount(), getFocusedParticipant()

### Community 173 - "Community 173"
Cohesion: 0.36
Nodes (9): NavigatorWithUserAgentData, hasDesktopBridge(), readPlatformSignals(), writeBoundaryDataset(), resolveDesktopBoundaryPolicy(), applyDesktopBoundaryToDocument(), getDesktopBoundaryPolicy(), isDesktopBoundaryAllowed() (+1 more)

### Community 139 - "Community 139"
Cohesion: 0.19
Nodes (11): BridgeResult, DesktopBridge, resolveBridge(), showDesktopNotification(), RuntimeWindow, browserNavigator(), collectPlatformSignals(), classifyPlatform() (+3 more)

### Community 147 - "Community 147"
Cohesion: 0.26
Nodes (11): configCache, RuntimeConfigOptions, SENSITIVE_KEY_PATTERNS, hasSuspiciousSecrets(), resolveConfigOrigin(), resolveConfigUrl(), cacheKey(), defaultConfig() (+3 more)

### Community 214 - "Community 214"
Cohesion: 0.60
Nodes (3): 28759aa fix(web): stack room reactions and keep the message toolbar reachable, 6baa520 Merge pull request #119 from dazeGG/feature/2.5.0-chat-polish, bf61139 Merge pull request #118 from dazeGG/feature/2.5.0-chat-parity

### Community 125 - "Community 125"
Cohesion: 0.28
Nodes (15): FrequentReaction, DEFAULT_FREQUENT_REACTIONS, memory, frequentReactionKey(), rankFrequentReactions(), seededEntries(), normalizeEntries(), localStorageKey() (+7 more)

### Community 97 - "Community 97"
Cohesion: 0.15
Nodes (8): ReplyConversation, ReplyAuthor, ReplyTarget, ReplySendInput, conversationKey(), normalizeTarget(), ReplyStore, createReplyStore()

### Community 189 - "Community 189"
Cohesion: 0.33
Nodes (4): SendShadowState, SendShadow, stableJson(), fingerprint()

### Community 27 - "Community 27"
Cohesion: 0.07
Nodes (48): NotificationEventType, NotificationActor, NotificationMessageBrief, NotificationRoomContext, NotificationDmMessageEvent, NotificationRoomMessageEvent, NotificationFriendRequestEvent, NotificationFriendAcceptedEvent (+40 more)

### Community 131 - "Community 131"
Cohesion: 0.16
Nodes (13): PresenceIdleSnapshot, PresenceIdleControllerOptions, BrowserIdleDetector, EventTarget, BrowserIdleDetectorConstructor, IdleDetectionScope, DesktopIdleBridge, DesktopIdleScope (+5 more)

### Community 225 - "Community 225"
Cohesion: 0.83
Nodes (2): ContextMenuContentState, ContextMenuProps

### Community 108 - "Community 108"
Cohesion: 0.20
Nodes (16): parsePlacement(), flipPlacementVertical(), viewportSpaceAroundTrigger(), resolvePopoverPlacement(), PopoverPlacement, PopoverRole, PopoverCloseReason, PopoverTriggerState (+8 more)

### Community 201 - "Community 201"
Cohesion: 0.38
Nodes (5): FocusTrapOptions, FOCUSABLE_SELECTOR, isHTMLElement(), getFocusableElements(), focusInitialElement()

### Community 204 - "Community 204"
Cohesion: 0.60
Nodes (4): iconXs, iconSm, iconMd, iconLg

### Community 197 - "Community 197"
Cohesion: 0.33
Nodes (3): DEFAULT_OPTIONS, getSmoothingCoefficient(), VoiceRoomNoiseGateProcessor

### Community 222 - "Community 222"
Cohesion: 0.50
Nodes (1): VoiceRoomDesktopAudioSourceProcessor

### Community 207 - "Community 207"
Cohesion: 0.40
Nodes (2): s(), o

### Community 126 - "Community 126"
Cohesion: 0.14
Nodes (13): addOrigin(), liveKitConnectSources(), config, root, 0fbf930 fix(web): polish avatar and chat controls, 2dbec7a fix(web): sync preview identity and friend presence, 451844b feat(web): refine lobby and room settings, 74d4ec7 fix(web): defer audio unlock to stream gesture (+5 more)

### Community 175 - "Community 175"
Cohesion: 0.22
Nodes (3): MemoryStorage, deferred(), configure()

### Community 198 - "Community 198"
Cohesion: 0.29
Nodes (2): require, ts

### Community 20 - "Community 20"
Cohesion: 0.06
Nodes (18): text(), accessibleName(), assertAccessibleName(), assertFocusOrder(), assertKeyboardActivation(), assertLiveRegion(), assertReducedMotionEnabled(), assertStableLayout() (+10 more)

### Community 178 - "Community 178"
Cohesion: 0.25
Nodes (4): repositoryRoot, 924295b test(web): prove G13 against pinned Caddy, a37d685 test(web): make G13 paths workspace-safe, fdb6786 test(api): make G14 paths workspace-safe

### Community 132 - "Community 132"
Cohesion: 0.13
Nodes (4): require, ts, FakeNotification, DeniedNotification

### Community 165 - "Community 165"
Cohesion: 0.24
Nodes (10): root, sourceRoot, SURFACE_TOKEN_VALUES, SURFACE_TOKENS, sourceFiles(), lineAt(), styleFragments(), hasSurfaceToken() (+2 more)

### Community 177 - "Community 177"
Cohesion: 0.25
Nodes (5): require, ts, FakeIdleDetector, 296a168 perf(web): reduce away presence polling, 854abc9 feat(web): improve automatic presence tracking

### Community 186 - "Community 186"
Cohesion: 0.25
Nodes (3): require, ts, FakeWebSocket

### Community 200 - "Community 200"
Cohesion: 0.29
Nodes (1): TestMediaStream

### Community 161 - "Community 161"
Cohesion: 0.24
Nodes (9): MIME_TYPES, STATES, text(), normalizeAttachment(), normalizeAttachments(), attachmentTextFallback(), assert, test (+1 more)

### Community 148 - "Community 148"
Cohesion: 0.31
Nodes (11): clamp(), normalizeChannel(), srgbToLinear(), linearToSrgb(), rgbToOklch(), oklchToLinearRgb(), isInSrgbGamut(), fitChromaToSrgb() (+3 more)

### Community 194 - "Community 194"
Cohesion: 0.29
Nodes (6): CapabilityRequires, CapabilityPublicNode, CapabilityInternalNode, CapabilityOperatorNode, CapabilityReplicaConsensus, CapabilityManifest

### Community 135 - "Community 135"
Cohesion: 0.21
Nodes (10): PUBLIC_CAPABILITY_KEYS, INTERNAL_NODE_KEYS, OPERATOR_KEYS, isObject(), toStringArray(), normalizePublicNode(), normalizeInternalNode(), normalizeOperatorNode() (+2 more)

### Community 218 - "Community 218"
Cohesion: 0.40
Nodes (4): MembershipRole, MemberPresenceStatus, MembershipMember, MembershipEnvelope

### Community 174 - "Community 174"
Cohesion: 0.36
Nodes (9): MEMBERSHIP_ROLES, MEMBERSHIP_ROLE_SET, isObject(), cleanString(), normalizeMembershipLimit(), normalizeMembershipRequest(), normalizeMembershipMember(), buildMembershipEnvelope() (+1 more)

### Community 229 - "Community 229"
Cohesion: 0.83
Nodes (3): cleanId(), normalizeMentionUserIds(), mentionUserIdsFromContent()

### Community 219 - "Community 219"
Cohesion: 0.40
Nodes (4): HistoryMode, HistoryRequest, MessageDto, HistoryEnvelope

### Community 122 - "Community 122"
Cohesion: 0.18
Nodes (15): HISTORY_MODES, HISTORY_MODE_SET, MESSAGE_KIND_SET, isObject(), cleanString(), isOpaqueCursor(), normalizeLimit(), normalizeHistoryRequest() (+7 more)

### Community 195 - "Community 195"
Cohesion: 0.29
Nodes (6): ConversationRef, ReplyPointer, ReplyPreview, IdempotencyDescriptor, SendEnvelope, MessageDeliveryEvent

### Community 136 - "Community 136"
Cohesion: 0.31
Nodes (13): DELIVERY_EVENT_TYPES, isObject(), cleanString(), normalizeConversation(), isSystemCard(), normalizeReplyPointer(), normalizeReplyPreview(), normalizeIdempotency() (+5 more)

### Community 220 - "Community 220"
Cohesion: 0.40
Nodes (4): ModerationDuration, BanMutation, ActiveBan, ModerationPage

### Community 162 - "Community 162"
Cohesion: 0.29
Nodes (11): MODERATION_DURATIONS, MODERATION_DURATION_MS, cleanString(), normalizeModerationLimit(), normalizeBanDuration(), durationToExpiresAt(), normalizeBanMutation(), normalizeIdempotencyKey() (+3 more)

### Community 163 - "Community 163"
Cohesion: 0.24
Nodes (9): NOTIFICATION_LEVELS, NOTIFICATION_LEVEL_SET, NOTIFICATION_REASONS, NOTIFICATION_REASON_SET, cleanString(), normalizeNotificationItem(), buildNotificationEnvelope(), normalizeNotificationEnvelope() (+1 more)

### Community 127 - "Community 127"
Cohesion: 0.16
Nodes (14): PLATFORM_CLASSES, normalizedString(), classifyPlatform(), platformPolicy(), classifyPlatformPolicy(), assert, fs, path (+6 more)

### Community 221 - "Community 221"
Cohesion: 0.40
Nodes (4): ReactionMutation, ReactionSummary, Reactor, ReactorPage

### Community 39 - "Community 39"
Cohesion: 0.08
Nodes (36): { normalizeRoomId, normalizePeerId, normalizeSessionToken, cleanName }, KNOWN_CLIENT_TYPES, isPlainObject(), parseClientEnvelope(), parseServerEnvelope(), buildServerEnvelope(), toRoomPeerSummary(), buildRoomRealtimeSummary() (+28 more)

### Community 209 - "Community 209"
Cohesion: 0.33
Nodes (5): RoomMessageTextSegmentV1, RoomMessageLinkSegmentV1, RoomMessageMentionSegmentV1, RoomMessageSegmentV1, RoomMessageContentV1

### Community 179 - "Community 179"
Cohesion: 0.44
Nodes (8): cleanString(), cleanHttpUrl(), utf8ByteLength(), normalizeSegment(), normalizeRoomMessageContent(), projectKnownContent(), projectRoomMessageContent(), contentFromLegacyText()

### Community 4 - "Community 4"
Cohesion: 0.07
Nodes (88): RuntimeConfigV1, 01f4965 fix(livekit): unblock browser room joins, 025e0ee test(ci): align G08 with raw TCP gate, 0ccab26 docs: add 2.5–2.7 release train plans and backlog, 0f0c04b fix(web): align popover trigger inside chat action toolbars, 12b694d fix(web): refine room controls and stream notices (#58), 141c6b7 fix(web): clear room badges while reading, 14d55d2 fix(web): sync room profiles and improve modal layout (+80 more)

### Community 149 - "Community 149"
Cohesion: 0.28
Nodes (11): DEFAULT_RUNTIME_CONFIG, normalizeLiveKitUrl(), normalizeLiveKitServerUrl(), inheritLiveKitGateCredential(), resolveLiveKitConnectUrls(), normalizePayload(), parseRuntimeConfig(), getRuntimeConfig() (+3 more)

### Community 151 - "Community 151"
Cohesion: 0.15
Nodes (10): test, assert, crypto, fs, path, { pathToFileURL }, {
  EMOJI_REACTION_AUTHORITY,
  assertReactionEmoji,
  cleanReactionEmoji,
  isReactionEmoji,
  listReactionEmojis
}, ROOT (+2 more)

### Community 176 - "Community 176"
Cohesion: 0.22
Nodes (9): assert, fs, path, { pathToFileURL }, test, packageJson, commonJs, snapshot() (+1 more)

### Community 180 - "Community 180"
Cohesion: 0.25
Nodes (3): extensions, files, da2ffb3 fix(release): stabilize G01-G03 foundation gates (#112)

### Community 137 - "Community 137"
Cohesion: 0.26
Nodes (11): EXPECTED, FAILURES, manifestDigest(), unique(), buildActivationMatrix(), verifyActivationEvidence(), exactVector(), cli() (+3 more)

### Community 7 - "Community 7"
Cohesion: 0.06
Nodes (54): sha256(), canonical(), evidenceChainSha256(), checkpointPayload(), bindCheckpointFixture(), bindExternalFixture(), assertCheckpointArtifact(), assertEvidenceIdentity() (+46 more)

### Community 35 - "Community 35"
Cohesion: 0.09
Nodes (41): PUBLICATION_SEQUENCE, ARCHIVE_OBJECT_ORDER, SELECTION_KEYS, ARTIFACT_BINDING_KEYS, ANCESTOR_KEYS, PROVENANCE_KEYS, sha256(), exactCompactJson() (+33 more)

### Community 48 - "Community 48"
Cohesion: 0.14
Nodes (34): isFutureField(), exactKeys(), rejectFutureFacts(), validateAttempt(), validateRecovery(), validatePointer(), validateRegistry(), buildCandidateReport() (+26 more)

### Community 36 - "Community 36"
Cohesion: 0.09
Nodes (37): buildG01VerificationCatalog(), buildF7RepositoryGates(), buildF7Envelope(), read(), json(), readWorkflow(), digest(), compactDigest() (+29 more)

### Community 40 - "Community 40"
Cohesion: 0.14
Nodes (38): TRUSTED_ASSOCIATIONS, REVIEW_LANES, REVIEW_IDENTITY_FIELDS, REVIEW_INPUT_FIELDS, REVIEW_PAYLOAD_FIELDS, exactKeys(), instant(), authenticatedGitHubInstant() (+30 more)

### Community 42 - "Community 42"
Cohesion: 0.12
Nodes (34): buildMergeEnvelope(), SELECTION_KEYS, compactDigest(), bytesDigest(), exactKeys(), canonicalInstant(), validateBinding(), validateEnvelopeBindings() (+26 more)

### Community 154 - "Community 154"
Cohesion: 0.32
Nodes (10): STAGES, sha256(), canonicalPath(), parseBundle(), extractEvidenceBundle(), prepareOciBundle(), argument(), cli() (+2 more)

### Community 145 - "Community 145"
Cohesion: 0.28
Nodes (11): G01_WRITABLE, RECOVERY_WRITABLE, RECOVERY_READ_ONLY, exactArray(), validSelection(), classifyBootstrap(), validateRecoveryFixture(), fixture (+3 more)

### Community 99 - "Community 99"
Cohesion: 0.20
Nodes (19): PHASE_PREFIX, REVIEW_ROLES, TRUSTED_ASSOCIATIONS, F7_GATE_NAMES, F7_REPORT_PATHS, F7_INPUT_PATHS, F7_REPOSITORY_COMMANDS, exactKeys() (+11 more)

### Community 106 - "Community 106"
Cohesion: 0.17
Nodes (18): require, { AccessToken, TrackSource }, { createGateCredentialSigner }, { createDbPool }, { runMigrations }, { createRoomStore }, PRINCIPAL, sleep() (+10 more)

### Community 113 - "Community 113"
Cohesion: 0.24
Nodes (15): RUNTIME_PUBLICATION_SEQUENCE, IDS, sha256(), readRuntimeConfig(), validateRuntimeConfig(), buildRuntimePublicationRecord(), assertRuntimePublicationRecord(), assertDeploymentComposeUsesDigests() (+7 more)

### Community 152 - "Community 152"
Cohesion: 0.15
Nodes (10): require, { createGateCredentialSigner }, { createLiveKitAuthGateService, extractCredential }, { createRoomStore }, { createRoomRealtimeRuntime }, WEB_ROOM_COVERAGE_SCRIPT, ADMISSION_INTERNAL_COVERAGE_SCRIPT, SERVER_INTERNAL_COVERAGE_SCRIPT (+2 more)

### Community 224 - "Community 224"
Cohesion: 0.40
Nodes (1): FakeSocket

### Community 231 - "Community 231"
Cohesion: 0.83
Nodes (3): digest(), sha(), readySnapshot()

### Community 143 - "Community 143"
Cohesion: 0.19
Nodes (10): schema, index, ajv, validateShape, REQUIRED_PLATFORMS, ARTIFACT_FIELDS, digest(), comparableArtifact() (+2 more)

### Community 187 - "Community 187"
Cohesion: 0.46
Nodes (7): digest_text(), parse_args(), read_pair(), validate_canonical(), require(), validate_strict_lkv_amendment(), main()

### Community 167 - "Community 167"
Cohesion: 0.22
Nodes (8): .github CLAUDE.md Policy, Pull Request Template, docs/GIT_FLOW.md, Root CLAUDE.md, docs/RELEASE_<version>_PLAN.md, apps/CLAUDE.md, apps/web/CLAUDE.md, Room client architecture (ARCHITECTURE.md)

### Community 236 - "Community 236"
Cohesion: 1.00
Nodes (1): config/capability-dag.v1.json

### Community 239 - "Community 239"
Cohesion: 1.00
Nodes (1): Font Assets README

### Community 238 - "Community 238"
Cohesion: 1.00
Nodes (1): Design QA — reusable room and chat menus

### Community 233 - "Community 233"
Cohesion: 1.00
Nodes (1): ADR: Unicode authority for message reactions

### Community 234 - "Community 234"
Cohesion: 1.00
Nodes (1): VoiceRoom 2.5 Architecture Boundaries

### Community 235 - "Community 235"
Cohesion: 1.00
Nodes (1): Backlog

### Community 191 - "Community 191"
Cohesion: 0.48
Nodes (7): docs/CLAUDE.md governance rules, Git Flow workflow, Release 2.4.0 verification plan, Release 2.4.1 verification plan, Release 2.4.2 hotfix verification plan, VoiceRoom 2.5.0 consolidated execution plan, VoiceRoom 2.5.0 unified messaging platform PRD

### Community 241 - "Community 241"
Cohesion: 1.00
Nodes (1): VoiceRoom monitoring agent

### Community 215 - "Community 215"
Cohesion: 0.40
Nodes (5): VoiceRoom 2.5.0 Unified — Verification and Release Evidence Specification, Release 2.6.0 Plan — Engagement & Notifications (Superseded), Release 2.7.0 Plan — Media & Moderation (Superseded), Expiry-Aware Rescue Profile Doc (G85), Predeploy Migrations Doc

### Community 237 - "Community 237"
Cohesion: 1.00
Nodes (1): Capability Readiness Doc

### Community 203 - "Community 203"
Cohesion: 0.33
Nodes (6): Desktop Support Matrix Doc (G19), Release 2.5.0 Durable Evidence Archive Doc (G03), Coordinated Media Backup and Restore Doc, Release 2.5.0 Budgets Doc (G91), Release 2.5.0 Develop Entry Doc (G93), Release 2.5.0 RC Preflight Doc

### Community 242 - "Community 242"
Cohesion: 1.00
Nodes (1): OCI Runtime Publication Doc

### Community 244 - "Community 244"
Cohesion: 1.00
Nodes (1): Production Digest Promotion Doc

### Community 240 - "Community 240"
Cohesion: 1.00
Nodes (1): LiveKit External Auth-Gate Operations Doc (G05)

### Community 245 - "Community 245"
Cohesion: 1.00
Nodes (1): Release 2.5.0 Repairs README

### Community 243 - "Community 243"
Cohesion: 1.00
Nodes (1): packages/CLAUDE.md Guidance

### Community 232 - "Community 232"
Cohesion: 1.00
Nodes (2): VoiceRoom App Icon (Owl Mascot Mark on Dark Rounded Square), VoiceRoom Mascot Mark (Masked Owl Silhouette, Transparent)

## Knowledge Gaps
- **1511 isolated node(s):** `http`, `net`, `{ URL }`, `{ createDbPool }`, `{ createGateCredentialSigner }` (+1506 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 226`** (2 nodes): `MediaQuotaError`, `createMediaQuotaService()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 205`** (2 nodes): `{ createDbPool }`, `createDmHistoryRepository()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 227`** (1 nodes): `registerDmHistoryRoutes()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 206`** (2 nodes): `{ createDbPool }`, `createRoomHistoryRepository()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 228`** (1 nodes): `registerModerationRoutes()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 217`** (2 nodes): `crypto`, `createMentionRepository()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 223`** (1 nodes): `FakeSocket`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 212`** (1 nodes): `FakeServer`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 202`** (1 nodes): `lang`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 64`** (2 nodes): `01a206a chore: release v2.1.1`, `cce23b6 fix(web): stabilize preview chat identity`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 160`** (1 nodes): `ScreenRecoveryGraceController`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 208`** (2 nodes): `ParticipantMenuVariant`, `participantContextMenu`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 225`** (2 nodes): `ContextMenuContentState`, `ContextMenuProps`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 222`** (1 nodes): `VoiceRoomDesktopAudioSourceProcessor`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 207`** (2 nodes): `s()`, `o`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 198`** (2 nodes): `require`, `ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 200`** (1 nodes): `TestMediaStream`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 224`** (1 nodes): `FakeSocket`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 236`** (1 nodes): `config/capability-dag.v1.json`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 239`** (1 nodes): `Font Assets README`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 238`** (1 nodes): `Design QA — reusable room and chat menus`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 233`** (1 nodes): `ADR: Unicode authority for message reactions`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 234`** (1 nodes): `VoiceRoom 2.5 Architecture Boundaries`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 235`** (1 nodes): `Backlog`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 241`** (1 nodes): `VoiceRoom monitoring agent`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 237`** (1 nodes): `Capability Readiness Doc`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 242`** (1 nodes): `OCI Runtime Publication Doc`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 244`** (1 nodes): `Production Digest Promotion Doc`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 240`** (1 nodes): `LiveKit External Auth-Gate Operations Doc (G05)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 245`** (1 nodes): `Release 2.5.0 Repairs README`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 243`** (1 nodes): `packages/CLAUDE.md Guidance`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 232`** (2 nodes): `VoiceRoom App Icon (Owl Mascot Mark on Dark Rounded Square)`, `VoiceRoom Mascot Mark (Masked Owl Silhouette, Transparent)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `RealtimeRecoveryController` connect `Community 41` to `Community 13`?**
  _High betweenness centrality (0.009) - this node is a cross-community bridge._
- **Why does `AppRealtimeConnection` connect `Community 103` to `Community 111`?**
  _High betweenness centrality (0.005) - this node is a cross-community bridge._
- **What connects `http`, `net`, `{ URL }` to the rest of the system?**
  _1511 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 55` be split into smaller, more focused modules?**
  _Cohesion score 0.06386554621848739 - nodes in this community are weakly interconnected._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.010535517114464482 - nodes in this community are weakly interconnected._
- **Should `Community 100` be split into smaller, more focused modules?**
  _Cohesion score 0.11578947368421053 - nodes in this community are weakly interconnected._
- **Should `Community 51` be split into smaller, more focused modules?**
  _Cohesion score 0.06190476190476191 - nodes in this community are weakly interconnected._