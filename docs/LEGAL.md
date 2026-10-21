# VoiceRoom legal compliance

What the service does to meet Russian law (152-FZ on personal data, 149-FZ on
information, art. 1253.1 of the Civil Code on intermediaries), what is still
the operator's job outside the code, and the questions left for a lawyer. This
is an engineering summary, not legal advice.

## In the code

| Requirement | Where |
| --- | --- |
| Published personal data policy (152-FZ art. 18.1 part 2) | `/privacy` — `apps/web/src/lib/features/legal/PrivacyPolicy.svelte` |
| Terms of use: minimum age 14, forbidden content, reports, intermediary liability | `/terms` — `TermsOfService.svelte` |
| Attribution required by CC BY 4.0 (Twemoji, DB-IP, Font Awesome) and other licences | `/licenses` — `Licenses.svelte` |
| Acceptance at sign-up | the notice above «Создать аккаунт» in `AuthDialog.svelte` |
| Legal pages reachable from everywhere, phones included | landing footer, settings sidebar, `lib/platform/mobile-routes.ts` |
| Reports to the operator and removal of any message (art. 1253.1, 149-FZ art. 15.1 takedowns) | `POST /api/reports`, the admin app's reports section (`apps/admin`), `apps/api/src/domains/reports` |
| No IP address kept in the database: stays in voice, room creators and guest room bans keep a keyed hash of it (an IPv6 address by its /64) | `apps/api/src/lib/ip-key.ts`; old guest bans are keyed by the API's `room_ban_ip_key` maintenance task |
| Backups no older than 30 days | `scripts/cd/prune-backups.sh`, run by `remote-deploy.sh` after each rollout |

Facts the pages state (operator, contact address, retention periods) live in
`apps/web/src/lib/features/legal/legal-info.ts`. When the code changes a
retention period, change it there too.

## Operator checklist

1. **Server location.** 152-FZ part 5 art. 18 requires personal data of
   Russian citizens to be collected and stored in a database in Russia, and
   the policy says so. Check the prod VPS location in the Aeza panel; if it is
   abroad, move the service before publishing the policy.
2. **Mailbox.** Set up `support@voiceroom.ru`: the policy and the terms give it
   for data requests and complaints. Requests must be answered within 10
   working days.
3. **Platform administrator.** Put your account id into
   `PLATFORM_ADMIN_USER_IDS` in the host `.env` (find it with
   `SELECT id FROM users WHERE login = '<login>'`), then
   `docker compose up -d api`. That account is a superadmin of the admin app at `https://admin.<DOMAIN>` (it needs a DNS record), where reports are reviewed and staff roles are given.
4. **Notice to Roskomnadzor** (152-FZ art. 22), filed online at
   pd.rkn.gov.ru before processing starts. Values for the form:
   - operator: Ефремов Владимир Владимирович, физическое лицо (самозанятый), ИНН and address as in your documents;
   - purpose: предоставление сервиса голосовых комнат и обмена сообщениями по пользовательскому соглашению; обеспечение безопасности сервиса;
   - categories: иные (логин, отображаемое имя, изображение профиля, сведения об устройстве и городе входа, сообщения, IP-адрес в случаях из политики); subjects: пользователи сервиса;
   - legal basis: п. 5 и п. 7 ч. 1 ст. 6 152-ФЗ;
   - actions: сбор, запись, систематизация, хранение, уточнение, использование, обезличивание, блокирование, удаление, уничтожение; processing: автоматизированная, с передачей по сети интернет;
   - cross-border transfer: нет (Web Push payloads are encrypted end to end; confirm with a lawyer);
   - database location: the country and hosting provider of the prod server;
   - start date and the person responsible for processing (yourself).
5. **Effective date.** `legal-info.ts` says 13 October 2026. Set it to the day
   the release that ships these pages reaches prod.

## For a lawyer

- Whether the service counts as an «организатор распространения информации»
  (149-FZ art. 10.1). Inclusion in the register brings storage of messages and
  metadata and, for messengers, user identification by phone number.
- Whether login-and-password sign-up meets the 406-FZ authorisation rules
  (Russian phone number, Gosuslugi or a system owned by a Russian person), or
  whether the operator's own system counts as such.
- Whether Web Push through Google, Mozilla, Apple or Microsoft is a
  cross-border transfer that needs its own notice.
- Whether a separate consent document is needed beyond the contract basis.

## Known gaps

- Deleted direct messages stay in the database as soft-deleted rows; only room
  messages are purged 30 days after deletion. The policy promises the purge for
  room messages only.
- Container logs have no rotation configured in `docker-compose.yml`, so the
  policy states no log retention period.
- There is no account-level platform ban; restricting a violator's access is a
  manual database operation today.
