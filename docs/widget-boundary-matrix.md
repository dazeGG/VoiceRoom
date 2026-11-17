# Widget boundary surface inventory

This matrix is an implementation inventory, not a passing isolation claim. G001 supplies storage and pure policy; G002 must wire guards and execute negative tests before enabling any widget admission. All paths are relative to apps/api/src. Main adapters must reject widget IDs before reads, mutations, subscriptions or credentials. Widget adapters must reject main IDs. Staff/operator exceptions retain their existing authority.

| Surface | Wiring and subordinate data sources | Required boundary |
|---|---|---|
| Create/lookup/update/delete, public metadata | domains/rooms/rooms.routes.ts; rooms.service.ts; room.repository.ts | Main create cannot select kind; lookup/update/delete reject widget; dedicated guest creation uses quotas |
| Lobby/list/bookmark/membership | domains/membership/membership.routes.ts; domains/rooms/room-access.repository.ts | Exclude widget from all account projections and writes |
| Room metadata/peers/state, join/reconnect/preview | realtime/ws-handler.ts; realtime/registry.ts; realtime/voice-join.ts | Scope assigned by upgrade wiring; check before session/account/presence and every preview subscription |
| WS fanout/typing/chat/pins/reactions | realtime runtime command handlers; domains/messaging/room-chat.service.ts | No account subscriptions in widget; allowlist; room-wide disabled chat denies snapshots/events |
| Admission/token/gate resume | domains/admission/admission.routes.ts; admission.service.ts; livekit-credential-provider.ts | Trusted scope and immutable room binding, microphone/camera only; leave/revoke unchanged |
| Current and paginated chat history, message send/edit/delete | domains/messaging/room-chat.routes.ts; history.routes.ts; room-history.repository.ts; room-message.repository.ts | Main denies widget; widget requires chat capability and existing guest author session |
| Pins/reactions/read state | domains/messaging/pins.routes.ts; reactions.routes.ts; room-chat.repository.ts | Main denies widget; unsupported widget commands denied |
| Social invitations/rings/notifications | domains/social/friends.routes.ts; domains/rings/rings.routes.ts; domains/notifications | Never expose or attach widget rooms to account features |
| Attachments/upload/content/status/retry/delete/variants | domains/media/media.routes.ts; attachment.policy.ts; attachment.repository.ts; attachment-revocation.service.ts | Reject widget target and message attachment binding, including existing IDs and roomId/code/roomCode aliases |
| Rich link preview scheduling/projection | domains/messaging and link-preview services | Widget text links remain plain links; no enrichment jobs or attachment projections |
| Screen reservation/state/source grants | realtime media handlers; domains/admission/livekit-credential-provider.ts | Widget rejects screen and screen audio commands; no screen sources in JWT; data publication remains denied |
| Owner/admin/moderation/report | domains/rooms/peer-moderation.routes.ts; domains/moderation; domains/reports; domains/admin; domains/staff | Ordinary owner/account entry denied; explicit existing staff moderation/report authority retained |
| Idle prune/purge/startup reconciliation | domains/rooms/room.repository.ts; app/room-store.ts | Temporary lifecycle includes widgets; active calls not pruned; activation floor persists after purge |

G002 verification must enumerate actual registered routes/WS commands, test all aliases and check both initial WS cookie resolution and join-time account resolution. A header, body or query discriminator never grants scope. Repository getRoom remains an internal all-kind primitive for staff/lifecycle; trusted adapter policy must guard generic exposure. New internal kind/capability fields are omitted by existing public serializers.

## Concrete HTTP registrations

Current registration inventory; G002 must enforce and test boundaries before activation. Identity-only and staff routes are included to make exclusions explicit.

| Method | Route | Source |
|---|---|---|
| POST | `/api/auth/register` | `apps/api/src/domains/account/account.routes.ts:116` |
| POST | `/api/auth/login` | `apps/api/src/domains/account/account.routes.ts:157` |
| POST | `/api/auth/logout` | `apps/api/src/domains/account/account.routes.ts:188` |
| GET | `/api/auth/me` | `apps/api/src/domains/account/account.routes.ts:193` |
| POST | `/api/auth/recover` | `apps/api/src/domains/account/account.routes.ts:198` |
| POST | `/api/auth/account/restore` | `apps/api/src/domains/account/account.routes.ts:224` |
| POST | `/api/auth/profile` | `apps/api/src/domains/account/account.routes.ts:247` |
| POST | `/api/auth/password` | `apps/api/src/domains/account/account.routes.ts:263` |
| GET | `/api/auth/security` | `apps/api/src/domains/account/account.routes.ts:293` |
| POST | `/api/auth/recovery-codes` | `apps/api/src/domains/account/account.routes.ts:299` |
| POST | `/api/auth/recovery-codes/reminder/snooze` | `apps/api/src/domains/account/account.routes.ts:317` |
| GET | `/api/auth/sessions` | `apps/api/src/domains/account/account.routes.ts:329` |
| POST | `/api/auth/sessions/revoke-others` | `apps/api/src/domains/account/account.routes.ts:335` |
| DELETE | `/api/auth/sessions/:sessionId` | `apps/api/src/domains/account/account.routes.ts:345` |
| GET | `/api/auth/whats-new` | `apps/api/src/domains/account/account.routes.ts:364` |
| POST | `/api/auth/whats-new/seen` | `apps/api/src/domains/account/account.routes.ts:370` |
| POST | `/api/auth/app-prompt/seen` | `apps/api/src/domains/account/account.routes.ts:378` |
| GET | `/api/auth/login-alerts` | `apps/api/src/domains/account/account.routes.ts:386` |
| GET | `/api/auth/account/deletion` | `apps/api/src/domains/account/account.routes.ts:418` |
| POST | `/api/auth/account/deletion` | `apps/api/src/domains/account/account.routes.ts:426` |
| GET | `/api/admin/overview` | `apps/api/src/domains/admin/admin.routes.ts:73` |
| GET | `/api/admin/product` | `apps/api/src/domains/admin/admin.routes.ts:85` |
| GET | `/api/admin/system` | `apps/api/src/domains/admin/admin.routes.ts:97` |
| GET | `/api/admin/rooms` | `apps/api/src/domains/admin/admin.routes.ts:111` |
| GET | `/api/admin/rooms/history` | `apps/api/src/domains/admin/admin.routes.ts:119` |
| GET | `/api/admin/rooms/calls` | `apps/api/src/domains/admin/admin.routes.ts:131` |
| GET | `/api/admin/rooms/static` | `apps/api/src/domains/admin/admin.routes.ts:143` |
| GET | `/api/admin/rooms/calls/:callId` | `apps/api/src/domains/admin/admin.routes.ts:155` |
| GET | `/api/admin/rooms/live/:roomId` | `apps/api/src/domains/admin/admin.routes.ts:168` |
| GET | `/api/admin/accounts` | `apps/api/src/domains/admin/admin.routes.ts:183` |
| GET | `/api/admin/accounts/:userId` | `apps/api/src/domains/admin/admin.routes.ts:203` |
| POST | `/api/admin/accounts/:userId/block` | `apps/api/src/domains/admin/admin.routes.ts:209` |
| POST | `/api/admin/accounts/:userId/unblock` | `apps/api/src/domains/admin/admin.routes.ts:219` |
| POST | `/api/admin/accounts/:userId/sign-out` | `apps/api/src/domains/admin/admin.routes.ts:229` |
| POST | `/api/admin/accounts/:userId/delete` | `apps/api/src/domains/admin/admin.routes.ts:239` |
| POST | `/api/admin/accounts/:userId/cancel-deletion` | `apps/api/src/domains/admin/admin.routes.ts:249` |
| POST | `/api/admin/accounts/:userId/badge` | `apps/api/src/domains/admin/admin.routes.ts:259` |
| GET | `/api/badges` | `apps/api/src/domains/admin/admin.routes.ts:270` |
| POST | `/api/livekit-token` | `apps/api/src/domains/admission/admission.routes.ts:66` |
| POST | `/api/feedback/calls` | `apps/api/src/domains/feedback/call-feedback.routes.ts:26` |
| GET | `/api/admin/feedback` | `apps/api/src/domains/feedback/call-feedback.routes.ts:40` |
| POST | `/api/auth/avatar` | `apps/api/src/domains/media/avatars.routes.ts:95` |
| DELETE | `/api/auth/avatar` | `apps/api/src/domains/media/avatars.routes.ts:104` |
| POST | `/api/rooms/:roomId/avatar` | `apps/api/src/domains/media/avatars.routes.ts:113` |
| DELETE | `/api/rooms/:roomId/avatar` | `apps/api/src/domains/media/avatars.routes.ts:126` |
| GET | `/api/avatars/:key` | `apps/api/src/domains/media/avatars.routes.ts:146` |
| GET | `/api/link-previews/:key` | `apps/api/src/domains/media/avatars.routes.ts:150` |
| POST | `/api/media/attachments` | `apps/api/src/domains/media/media.routes.ts:70` |
| PUT | `/api/media/attachments/:id/content` | `apps/api/src/domains/media/media.routes.ts:86` |
| GET | `/api/media/attachments/:id` | `apps/api/src/domains/media/media.routes.ts:107` |
| POST | `/api/media/attachments/:id/retry` | `apps/api/src/domains/media/media.routes.ts:119` |
| DELETE | `/api/media/attachments/:id` | `apps/api/src/domains/media/media.routes.ts:131` |
| GET | `/api/media/attachments/:id/:variant` | `apps/api/src/domains/media/media.routes.ts:146` |
| GET | `/api/rooms/:roomId/members` | `apps/api/src/domains/membership/membership.routes.ts:49` |
| DELETE | `/api/rooms/:roomId/memberships/me` | `apps/api/src/domains/membership/membership.routes.ts:70` |
| GET | `/api/dm/:userId` | `apps/api/src/domains/messaging/direct-messages.routes.ts:50` |
| POST | `/api/dm/:userId` | `apps/api/src/domains/messaging/direct-messages.routes.ts:66` |
| POST | `/api/dm/:userId/invites/:messageId/respond` | `apps/api/src/domains/messaging/direct-messages.routes.ts:113` |
| POST | `/api/dm/:userId/read` | `apps/api/src/domains/messaging/direct-messages.routes.ts:147` |
| PATCH | `/api/dm/:userId/messages/:messageId` | `apps/api/src/domains/messaging/direct-messages.routes.ts:163` |
| DELETE | `/api/dm/:userId/messages/:messageId` | `apps/api/src/domains/messaging/direct-messages.routes.ts:194` |
| GET | `/api/rooms/:roomId/chat/history` | `apps/api/src/domains/messaging/history.routes.ts:33` |
| GET | `/api/dm/:userId/history` | `apps/api/src/domains/messaging/history.routes.ts:46` |
| GET | `/api/rooms/:roomId/pins` | `apps/api/src/domains/messaging/pins.routes.ts:41` |
| multi-method (see source) | `/api/rooms/:roomId/pins/:messageId` | `apps/api/src/domains/messaging/pins.routes.ts:55` |
| GET | `/api/reactions/:type/:conversationId` | `apps/api/src/domains/messaging/reactions.routes.ts:45` |
| GET | `/api/reactions/:type/:conversationId/:messageId` | `apps/api/src/domains/messaging/reactions.routes.ts:64` |
| PUT | `/api/reactions/:type/:conversationId/:messageId` | `apps/api/src/domains/messaging/reactions.routes.ts:81` |
| GET | `/api/reactions/:type/:conversationId/:messageId/reactors` | `apps/api/src/domains/messaging/reactions.routes.ts:94` |
| GET | `/api/rooms/:roomId/chat` | `apps/api/src/domains/messaging/room-chat.routes.ts:80` |
| POST | `/api/rooms/:roomId/chat` | `apps/api/src/domains/messaging/room-chat.routes.ts:96` |
| PATCH | `/api/rooms/:roomId/chat/:messageId` | `apps/api/src/domains/messaging/room-chat.routes.ts:128` |
| DELETE | `/api/rooms/:roomId/chat/:messageId` | `apps/api/src/domains/messaging/room-chat.routes.ts:153` |
| POST | `/api/rooms/:roomId/read` | `apps/api/src/domains/messaging/room-chat.routes.ts:177` |
| GET | `/api/rooms/:roomId/moderation/bans` | `apps/api/src/domains/moderation/moderation.routes.ts:41` |
| PUT | `/api/rooms/:roomId/moderation/bans` | `apps/api/src/domains/moderation/moderation.routes.ts:57` |
| DELETE | `/api/rooms/:roomId/moderation/bans/:banId` | `apps/api/src/domains/moderation/moderation.routes.ts:97` |
| DELETE | `/api/rooms/:roomId/moderation/messages/:messageId` | `apps/api/src/domains/moderation/moderation.routes.ts:117` |
| POST | `/api/push/devices` | `apps/api/src/domains/notifications/device-tokens.routes.ts:18` |
| DELETE | `/api/push/devices` | `apps/api/src/domains/notifications/device-tokens.routes.ts:56` |
| GET | `/api/notifications/preferences` | `apps/api/src/domains/notifications/notification-settings.routes.ts:66` |
| PUT | `/api/notifications/dm/:userId/mute` | `apps/api/src/domains/notifications/notification-settings.routes.ts:72` |
| PUT | `/api/notifications/room/:roomId/mute` | `apps/api/src/domains/notifications/notification-settings.routes.ts:94` |
| PUT | `/api/notifications/privacy` | `apps/api/src/domains/notifications/notification-settings.routes.ts:116` |
| POST | `/api/notifications/settings` | `apps/api/src/domains/notifications/notification-settings.routes.ts:132` |
| POST | `/api/presence/status` | `apps/api/src/domains/notifications/notification-settings.routes.ts:148` |
| GET | `/api/push/config` | `apps/api/src/domains/notifications/notification-settings.routes.ts:171` |
| POST | `/api/push/subscriptions` | `apps/api/src/domains/notifications/notification-settings.routes.ts:173` |
| DELETE | `/api/push/subscriptions` | `apps/api/src/domains/notifications/notification-settings.routes.ts:219` |
| GET | `/api/notifications/inbox` | `apps/api/src/domains/notifications/notifications.routes.ts:44` |
| GET | `/api/notifications/inbox/unread-count` | `apps/api/src/domains/notifications/notifications.routes.ts:54` |
| POST | `/api/notifications/inbox/:notificationId/read` | `apps/api/src/domains/notifications/notifications.routes.ts:64` |
| POST | `/api/notifications/inbox/read-all` | `apps/api/src/domains/notifications/notifications.routes.ts:76` |
| GET | `/api/notifications/inbox/resync` | `apps/api/src/domains/notifications/notifications.routes.ts:90` |
| GET | `/api/notifications/room/:roomId/level` | `apps/api/src/domains/notifications/notifications.routes.ts:100` |
| PUT | `/api/notifications/room/:roomId/level` | `apps/api/src/domains/notifications/notifications.routes.ts:110` |
| GET | `/api/healthz` | `apps/api/src/domains/ops/ops.routes.ts:42` |
| GET | `/api/metrics` | `apps/api/src/domains/ops/ops.routes.ts:47` |
| GET | `/api/pow-challenge` | `apps/api/src/domains/ops/ops.routes.ts:51` |
| GET | `/api/desktop/latest` | `apps/api/src/domains/ops/ops.routes.ts:67` |
| POST | `/api/client-vitals` | `apps/api/src/domains/ops/ops.routes.ts:82` |
| POST | `/api/client-logs` | `apps/api/src/domains/ops/ops.routes.ts:99` |
| POST | `/api/reports` | `apps/api/src/domains/reports/reports.routes.ts:47` |
| GET | `/api/admin/user-reports` | `apps/api/src/domains/reports/reports.routes.ts:71` |
| POST | `/api/admin/user-reports/:reportId/resolve` | `apps/api/src/domains/reports/reports.routes.ts:83` |
| GET | `/api/admin/reports` | `apps/api/src/domains/reports/reports.routes.ts:98` |
| POST | `/api/admin/reports/:reportId/resolve` | `apps/api/src/domains/reports/reports.routes.ts:110` |
| POST | `/api/rings` | `apps/api/src/domains/rings/rings.routes.ts:13` |
| GET | `/api/rings/:ringId` | `apps/api/src/domains/rings/rings.routes.ts:46` |
| POST | `/api/rings/:ringId/respond` | `apps/api/src/domains/rings/rings.routes.ts:53` |
| POST | `/api/rings/:ringId/cancel` | `apps/api/src/domains/rings/rings.routes.ts:66` |
| POST | `/api/rooms/:roomId/kick` | `apps/api/src/domains/rooms/peer-moderation.routes.ts:46` |
| POST | `/api/rooms/:roomId/server-mute` | `apps/api/src/domains/rooms/peer-moderation.routes.ts:65` |
| POST | `/api/rooms/:roomId/ban` | `apps/api/src/domains/rooms/peer-moderation.routes.ts:93` |
| DELETE | `/api/rooms/:roomId/bans/:banId` | `apps/api/src/domains/rooms/peer-moderation.routes.ts:130` |
| POST | `/api/rooms` | `apps/api/src/domains/rooms/rooms.routes.ts:102` |
| PUT | `/api/rooms/:roomId` | `apps/api/src/domains/rooms/rooms.routes.ts:163` |
| DELETE | `/api/rooms/:roomId` | `apps/api/src/domains/rooms/rooms.routes.ts:188` |
| GET | `/api/rooms/:roomId` | `apps/api/src/domains/rooms/rooms.routes.ts:206` |
| GET | `/api/rooms/:roomId/peers` | `apps/api/src/domains/rooms/rooms.routes.ts:237` |
| POST | `/api/state` | `apps/api/src/domains/rooms/rooms.routes.ts:256` |
| GET | `/api/auth/rooms` | `apps/api/src/domains/rooms/rooms.routes.ts:293` |
| POST | `/api/auth/rooms` | `apps/api/src/domains/rooms/rooms.routes.ts:308` |
| DELETE | `/api/auth/rooms/:roomId` | `apps/api/src/domains/rooms/rooms.routes.ts:335` |
| GET | `/api/friends` | `apps/api/src/domains/social/friends.routes.ts:51` |
| GET | `/api/friends/search` | `apps/api/src/domains/social/friends.routes.ts:57` |
| GET | `/api/friends/requests` | `apps/api/src/domains/social/friends.routes.ts:69` |
| POST | `/api/friends/requests` | `apps/api/src/domains/social/friends.routes.ts:75` |
| DELETE | `/api/friends/requests/:id` | `apps/api/src/domains/social/friends.routes.ts:137` |
| GET | `/api/blocks` | `apps/api/src/domains/social/friends.routes.ts:151` |
| PUT | `/api/blocks/:userId` | `apps/api/src/domains/social/friends.routes.ts:157` |
| DELETE | `/api/blocks/:userId` | `apps/api/src/domains/social/friends.routes.ts:172` |
| DELETE | `/api/friends/:userId` | `apps/api/src/domains/social/friends.routes.ts:186` |
| POST | `/api/rooms/:roomId/ring` | `apps/api/src/domains/social/friends.routes.ts:199` |
| GET | `/api/staff/access` | `apps/api/src/domains/staff/staff.routes.ts:106` |
| GET | `/api/staff/handoff` | `apps/api/src/domains/staff/staff.routes.ts:119` |
| GET | `/api/staff/browser-entry` | `apps/api/src/domains/staff/staff.routes.ts:136` |
| GET | `/api/staff/check` | `apps/api/src/domains/staff/staff.routes.ts:160` |
| GET | `/api/staff/callback` | `apps/api/src/domains/staff/staff.routes.ts:174` |
| GET | `/api/staff/denied` | `apps/api/src/domains/staff/staff.routes.ts:206` |
| GET | `/api/staff/me` | `apps/api/src/domains/staff/staff.routes.ts:210` |
| POST | `/api/staff/logout` | `apps/api/src/domains/staff/staff.routes.ts:216` |
| GET | `/api/staff/members` | `apps/api/src/domains/staff/staff.routes.ts:221` |
| PUT | `/api/staff/role` | `apps/api/src/domains/staff/staff.routes.ts:233` |

## Realtime commands

| Command | Source |
|---|---|
| `hello` | `apps/api/src/realtime/ws-handler.ts:165` |
| `ping` | `apps/api/src/realtime/ws-handler.ts:170` |
| `room.preview.subscribe` | `apps/api/src/realtime/ws-handler.ts:176` |
| `room.preview.unsubscribe` | `apps/api/src/realtime/ws-handler.ts:181` |
| `room.join` | `apps/api/src/realtime/ws-handler.ts:186` |
| `room.leave` | `apps/api/src/realtime/ws-handler.ts:235` |
| `room.peer.update` | `apps/api/src/realtime/ws-handler.ts:249` |
| `room.voice.report` | `apps/api/src/realtime/ws-handler.ts:262` |
| `room.media.request` | `apps/api/src/realtime/ws-handler.ts:266` |
| `room.chat.typing` | `apps/api/src/realtime/ws-handler.ts:291` |
| `dm.typing` | `apps/api/src/realtime/ws-handler.ts:300` |

## Aliases and indirect references

Targets include path/body/query roomId, code, roomCode; reaction type=room with conversationId; ringId resolving to a room; attachment id resolving through message/target; preview/avatar references. Guarding one roomId parameter does not cover indirect access. Widget room.peer.update must reject screen fields and room.media.request must reject screen source. Generic preview/typing/account subscriptions remain unavailable to widget.
