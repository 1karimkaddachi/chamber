# Security policy

## Supported versions

| Version | Supported |
| --- | --- |
| `1.x` | Yes |

## Reporting a vulnerability

Please **do not open a public issue** for security vulnerabilities.

Use GitHub's private **Security Advisories** feature on this repository:

1. Open the repository's **Security** tab.
2. Choose **Advisories** → **Report a vulnerability**.
3. Include reproduction steps, impact, affected endpoints/commands, and any suggested fix.

If private advisories are unavailable, contact the maintainers through a private channel listed on the repository profile. Do not disclose details publicly before a fix is available.

You can expect an acknowledgement as soon as reasonably possible. Please allow time for a fix and coordinated disclosure.

## Security model

- Dashboard sessions are server-side, stored in PostgreSQL, and sent as `HttpOnly`, `SameSite=Lax` cookies.
- Sessions are regenerated at login to prevent fixation.
- CSRF tokens are session-bound and required for all mutations.
- Cross-origin mutations are additionally rejected by an origin allow-list.
- Discord OAuth requests only `identify` and `guilds`; no message content is read.
- Every guild request is re-authorized against live Discord roles while the bot is online.
- Room operations verify owner, temporary admin or staff status; members cannot modify another person's room.
- Passwords are hashed with bcrypt (cost 12), attempt-limited and never returned by the API.
- Bot tokens, database credentials, session secrets and password hashes are never sent to the browser.
- Rate limits apply to API, auth and AI routes.
- Prisma parameterizes queries; inputs are validated with Zod.
- Audit logs record actor, action, target, metadata, IP hash and user agent.

## Deployment recommendations

- Use HTTPS and set `SESSION_COOKIE_SECURE=true`.
- Use a unique, long `SESSION_SECRET`.
- Keep `DEV_AUTH=false` in production.
- Do not publish PostgreSQL to the internet.
- Grant the bot only the documented permissions.
- Set `TRUST_PROXY=true` only behind a trusted reverse proxy.
- Rotate the bot token and OAuth client secret if compromised.
- Restrict administrator/staff role IDs to trusted roles.

## Out of scope

- Vulnerabilities in Discord itself or in self-hosted infrastructure outside this project.
- Denial of service through excessive legitimate traffic beyond configured rate limits (report capacity concerns as regular issues).
- Social engineering of server administrators.
- Findings that require already having the bot token, dashboard credentials or database access.
