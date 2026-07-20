# VoiceRoom 2.5 Architecture Boundaries

This document records the release 2.5 brownfield ownership gates. It describes the current modular monolith boundaries without creating placeholder domain modules.

## Ownership Matrix

| Area | Current owner | Allowed persistence writes |
| --- | --- | --- |
| API listener and route composition | `apps/api/src/server.js` | None directly; routes call stores |
| Rooms, memberships, messages, bans and room reads | `apps/api/src/lib/room-store.js` | `rooms`, `room_memberships`, `room_bookmarks`, `room_peer_identities`, `room_messages`, `room_bans`, `room_chat_reads` |
| Users and sessions | `apps/api/src/lib/user-store.js` | `users`, `sessions`, user-owned cleanup of `push_subscriptions` |
| Friends and direct messages | `apps/api/src/lib/friend-store.js` | `friend_requests`, `friendships`, `direct_messages` |
| Notification preferences and mutes | `apps/api/src/lib/notification-store.js` | `notification_preferences`, `notification_dm_mutes`, `notification_room_mutes`, notification-owned user preference columns |
| Push subscriptions | `apps/api/src/lib/push-store.js` | `push_subscriptions` |
| Schema migrations | `apps/api/src/migrations/*.js` | All schema-owned tables during migration only |

## Import Boundaries

API code consumes shared contracts through package exports such as `@voice-room/shared/validation` and `@voice-room/shared/realtime`. Deep imports from `packages/shared/src/*` are forbidden because they bypass the published contract.

Persistence access is isolated to store, migration and migration-runner files. Route composition may read store APIs, but it must not import database internals or SQL table models directly.

## Runtime Boundary

The current listener bootstrap lives in `apps/api/src/server.js`. Timers that already exist there are characterized as current API runtime behavior. New worker loops or lease timers must be introduced through explicit worker entrypoints in later goals, not hidden inside listener or route modules.
