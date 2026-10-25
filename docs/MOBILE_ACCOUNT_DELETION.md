# Android account deletion: cookie response boundary

The Android client shares an OS-managed cookie jar across asynchronous HTTP
requests. A successful deletion response can arrive after a different account
has signed in. JavaScript cannot prevent a `Set-Cookie` clear already applied by
that jar, so `POST /api/auth/account/deletion` omits the clearing response cookie
when the existing shared parser recognizes a nonempty, valid Android app version.
Browser and malformed-native user agents retain the previous clearing behavior.

This is response delivery policy, not an authentication exception. Session
resolution, password verification, rate limiting, account deletion, all-session
revocation and token invalidation are unchanged. The Android jar may retain the
old revoked token until the next sign-in replaces it; it no longer authenticates.
A forged user agent does not make an unauthenticated deletion request succeed.

The mobile client must still ignore stale operation results and guard HTTP 401
session-ending side effects by authentication generation. Its release dependency
must include this server change: JavaScript-only guards do not prevent cookie-jar
mutation from an older backend response. No production deployment is implied.

Regression coverage lives in `apps/api/test/account-deletion-http.test.ts` and
`apps/api/test/account-domain.test.ts`: native success has no `Set-Cookie`, both
old account tokens are unusable, a replacement account stays authenticated,
browser/malformed-native success still clears, and user-agent spoofing cannot
bypass session or password checks.
