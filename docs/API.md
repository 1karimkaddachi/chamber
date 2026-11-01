# Chamber API reference

Base URL (development): `http://localhost:3100/api`

All endpoints return JSON. The dashboard talks to the API through the Vite proxy in development and through the same origin in production.

---

## Authentication

Chamber uses Discord OAuth2 and a server-side session stored in PostgreSQL.

```
GET /api/auth/login        → Discord authorize page
GET /api/auth/callback     → exchanges code, creates session, redirects to WEB_ORIGIN
POST /api/auth/dev-login   → development-only session (requires DEV_AUTH=true)
POST /api/auth/logout      → destroys the session
```

Requested scopes: `identify`, `guilds`.

The session cookie is `chamber.sid`, `HttpOnly`, `SameSite=Lax`, and `Secure` when configured. Sessions are regenerated on login to prevent fixation.

### CSRF

Every mutating request (`POST`, `PATCH`, `PUT`, `DELETE`) must include the token returned by `GET /api/me`:

```
X-CSRF-Token: <csrfToken>
```

The token is also bound to the session. Missing or mismatched tokens receive `403 FORBIDDEN`. Cross-origin mutations are additionally blocked by an origin allow-list.

### Guild authorization

Every `/api/guilds/:guildId/*` request is authorized against live Discord state when the bot is online:

- Server owner / Administrator / Manage Server → administrator
- Configured admin roles → administrator
- Configured staff roles → staff (moderation, read access)
- Everyone else → `403`

When the bot is offline, the session captured at OAuth login is used (Manage Server/Administrator or development guild). Live room mutations still return `409 BOT_OFFLINE`.

---

## Rate limits

| Scope | Limit |
| --- | --- |
| `/api/*` | 400 requests / minute |
| `/api/auth/*` | 60 requests / 15 minutes |
| `POST /api/guilds/:guildId/ai/suggest` | 20 requests / minute |

Responses use standard `RateLimit-*` headers. Exceeding a limit returns `429 RATE_LIMITED`.

---

## Error envelope

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "The request contains invalid values.",
    "issues": [{ "path": "queueMaxSize", "message": "Too big: expected number to be <=100" }]
  }
}
```

Common codes:

| Code | HTTP | Meaning |
| --- | --- | --- |
| `UNAUTHENTICATED` | 401 | No session |
| `FORBIDDEN` | 403 | No guild access, CSRF failure, origin rejection, owner-only action |
| `NOT_FOUND` | 404 | Missing guild/room/template/event |
| `CONFLICT` | 409 | Already exists, already resolved, capacity/limit conflict |
| `BOT_OFFLINE` | 409 | A live Discord mutation was requested while the bot is offline |
| `VALIDATION_ERROR` | 422 | Zod validation failed |
| `RATE_LIMITED` | 429 | Rate limit |
| `INTERNAL_ERROR` | 500 | Unexpected server failure (logged) |

---

## Public & session

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/health` | Database/bot health, version, uptime |
| `GET` | `/meta` | App name, version, OAuth/AI availability, invite URL |
| `GET` | `/me` | Authenticated user, manageable guilds, CSRF token, preferences |
| `PATCH` | `/me/preferences` | Theme, sidebar state, last guild, notification flags |
| `POST` | `/auth/dev-login` | Development sign-in (disabled in production) |
| `POST` | `/auth/logout` | Destroy session |

`GET /me` response (abridged):

```json
{
  "user": { "id": "…", "username": "…", "globalName": "…", "avatarUrl": "…" },
  "guilds": [{ "id": "…", "name": "…", "icon": null, "admin": true, "staff": true, "botPresent": false }],
  "csrfToken": "…",
  "preferences": { "theme": "dark", "sidebarCollapsed": false, "lastGuildId": null }
}
```

---

## Guild configuration

Base: `/api/guilds/:guildId`

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `GET` | `` | staff | Guild detail, configuration, counts, setup state |
| `GET` | `/channels` | staff | Categories, text/voice channels and roles (empty + `offline: true` if bot offline) |
| `PATCH` | `/config` | admin | Partial `GuildConfig` update |
| `GET/POST` | `/triggers` | staff/admin | List or add trigger channels |
| `PATCH/DELETE` | `/triggers/:triggerId` | admin | Update/remove a trigger |
| `GET/POST` | `/categories` | staff/admin | List or add category rules |
| `PATCH/DELETE` | `/categories/:categoryId` | admin | Update/remove a category rule |

`PATCH /config` fields include engine state, defaults, channels, naming, role lists, cleanup timings, queue/waiting/reservation/event/platform toggles, password policy, AI toggle, retention and capacity limits. Optional fields only; values are validated by `guildConfigUpdateSchema`.

Example:

```bash
curl -X PATCH http://localhost:3100/api/guilds/900.../config \
  -H 'Content-Type: application/json' \
  -H 'X-CSRF-Token: <token>' \
  -b cookies.txt \
  -d '{"queueMaxSize": 12, "emptyGraceSeconds": 45}'
```

---

## Templates, room types, AI, premium

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `GET` | `/templates` | staff | Built-ins + custom templates |
| `POST` | `/templates` | admin | Create a template |
| `PATCH/DELETE` | `/templates/:templateId` | admin | Edit/delete a custom template |
| `POST` | `/templates/:templateId/duplicate` | admin | Duplicate any template |
| `GET` | `/templates/export` | staff | JSON export of custom templates |
| `POST` | `/templates/import` | admin | Import `{ "templates": [...] }` |
| `GET/POST` | `/room-types` | staff/admin | List/create room types |
| `PATCH/DELETE` | `/room-types/:roomTypeId` | admin | Edit/delete custom room types |
| `GET` | `/ai/status` | staff | Provider configuration (no secrets) |
| `POST` | `/ai/suggest` | staff | Generate a suggestion; never mutates |
| `GET` | `/premium` | staff | Feature switches, limits and usage |
| `PATCH` | `/premium` | admin | Toggle advanced features |

Template payload:

```json
{
  "name": "Gaming Squad",
  "description": "A public squad room",
  "emoji": "🎮",
  "accentColor": "#7c6cff",
  "roomTypeKey": "gaming",
  "defaultPrivacy": "PUBLIC",
  "defaultLimit": 0,
  "defaultBitrate": 96000,
  "roomNameRule": "{user}'s squad",
  "allowedRoleIds": []
}
```

AI suggestion request:

```json
{ "purpose": "ranked tournament", "expectedMembers": 5, "tone": "competitive", "roomId": "optional" }
```

Response:

```json
{
  "source": "local",
  "suggestions": { "privacy": "INVITE_ONLY", "userLimit": 5, "bitrate": 128000, "templateSlug": "competitive-team", "templateName": "Competitive Gaming" },
  "template": { "id": "…", "name": "Competitive Gaming", "slug": "competitive-team", "emoji": "🏆" },
  "rationale": ["Competitive sessions usually want a locked five-stack.", "…"]
}
```

---

## Overview, analytics and logs

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `GET` | `/overview?range=7d\|30d\|90d\|365d` | staff | Totals, series, popular types, top owners, active rooms, recent activity |
| `GET` | `/analytics?range=…` | staff | Full analytics payload |
| `GET` | `/logs?page=1&pageSize=25&search=&category=` | staff | Paginated audit log |
| `POST` | `/lobby/refresh` | staff | Repost/repair the Components V2 lobby directory |

Audit categories: `ROOM`, `CONFIG`, `PRIVACY`, `MEMBER`, `RESERVATION`, `QUEUE`, `TEMPLATE`, `AUTH`, `SYSTEM`.

---

## Live rooms

Base: `/api/guilds/:guildId`

| Method | Path | Auth | Bot | Description |
| --- | --- | --- | --- | --- |
| `GET` | `/rooms?search=&type=` | staff | no | Active rooms |
| `GET` | `/rooms/:roomId` | staff | no | Room detail: live members, allow-list, bans, queue, waiting, events, history |
| `PATCH` | `/rooms/:roomId` | admin | yes | Update name/topic/limit/bitrate/privacy/password/lock/hide/region/category/identity |
| `DELETE` | `/rooms/:roomId` | admin | yes | Delete the room and disconnect members |
| `POST` | `/rooms/:roomId/actions` | admin | yes | `lock`, `unlock`, `hide`, `reveal`, `refresh`, `reset`, `delete`, `admit-next` |
| `POST` | `/rooms/:roomId/members` | staff | yes | `invite`, `remove`, `move`, `mute`, `unmute`, `deafen`, `undeafen`, `promote`, `demote` |
| `POST` | `/rooms/:roomId/moderation` | staff | yes | `ban`, `unban`, `block`, `unblock`, `allow`, `revoke` |
| `POST` | `/rooms/:roomId/transfer` | admin | yes | `{ "userId": "…" }` |
| `GET` | `/rooms/:roomId/queue` | staff | no | Queue entries |
| `POST` | `/rooms/:roomId/queue/admit` | staff | yes | Admit `entryId` or the next entry |
| `GET` | `/rooms/:roomId/waiting` | staff | no | Waiting requests |
| `POST` | `/rooms/:roomId/waiting/:requestId` | staff | yes | `{ "accept": true\|false }` |
| `GET` | `/rooms/:roomId/events` | staff | no | Room events |
| `POST` | `/rooms/:roomId/events` | admin | yes | Create event + card + Discord scheduled event |
| `DELETE` | `/rooms/:roomId/events/:eventId` | admin | yes | Cancel event |
| `GET` | `/waiting` | staff | no | Pending requests across rooms |
| `GET` | `/queues` | staff | no | Queue groups across rooms |

Room update example:

```json
{
  "name": "Friday squad",
  "topic": "Ranked only",
  "userLimit": 5,
  "bitrate": 128000,
  "privacy": "INVITE_ONLY",
  "locked": false,
  "hidden": false,
  "password": "optional for PASSWORD privacy",
  "emoji": "🎮",
  "theme": "#7c6cff",
  "description": "Squad room",
  "bannerUrl": "https://example.com/banner.png",
  "rtcRegion": null,
  "parentCategoryId": "…"
}
```

Responses always include the updated room plus optional `warnings` (for unsupported voice regions).

Member action payload:

```json
{ "action": "remove", "userId": "123…" }
{ "action": "move", "userId": "123…", "destinationChannelId": "456…" }
{ "action": "promote", "userId": "123…", "durationMinutes": 60 }
```

Moderation payload:

```json
{ "action": "ban", "userId": "123…", "reason": "Spam", "durationMinutes": 60 }
{ "action": "unban", "userId": "123…" }
{ "action": "allow", "userId": "123…" }
{ "action": "revoke", "userId": "123…" }
```

`allow` adds the member to the room allow-list (and syncs the channel overwrites) without sending them anything; it is
refused with `409` while a ban or block is still active. `revoke` removes that grant, disconnects the member if they are
currently in the room, and refuses to target the room owner.

Event payload:

```json
{
  "title": "Tournament night",
  "type": "gaming",
  "description": "Bring your A-game",
  "startsAt": "2026-11-02T18:00:00.000Z",
  "durationMinutes": 90,
  "participantLimit": 10
}
```

Event types: `gaming`, `movie`, `study`, `meeting`, `discussion`, `other`.

---

## Uploads

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `POST` | `/guilds/:guildId/uploads` | staff | Store a room banner image, returns `{ url, bytes, mimeType }` |
| `GET` | `/api/uploads/:file` | none | Serves a stored banner (`Cache-Control: public, max-age=86400`) |

The POST body is JSON with base64 (no data-URL prefix) so the route can reuse the same Zod, CSRF and audit pipeline as
every other mutation:

```json
{ "data": "iVBORw0KGgoAAAANSUhEUgAA…", "mimeType": "image/png" }
```

Accepted formats are PNG, JPEG, WebP and GIF up to 4 MB. `mimeType` is only a claim — the leading bytes decide, and a
mismatch is rejected with `403`. Anything that is not one of those four signatures (including SVG, which can carry
script) is rejected with `415`. `bannerUrl` accepts an http(s) URL or the `/api/uploads/…` path returned here; other
schemes fail validation with `422`.

---

## Reservations

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `GET` | `/reservations?status=&take=` | staff | List reservations |
| `POST` | `/reservations` | staff | Schedule a reservation |
| `DELETE` | `/reservations/:reservationId` | staff | Cancel |
| `GET` | `/events` | staff | Guild-wide room events |

Reservation payload:

```json
{
  "name": "Friday tournament",
  "scheduledFor": "2026-11-06T20:00:00.000Z",
  "durationMinutes": 120,
  "privacy": "PUBLIC",
  "userLimit": 10,
  "templateId": "optional"
}
```

---

## Advanced operations

| Method | Path | Auth | Bot | Description |
| --- | --- | --- | --- | --- |
| `GET` | `/export` | admin | no | Download full guild configuration JSON |
| `POST` | `/import` | admin | no | Import `{ config?, triggers?, categories?, templates? }` |
| `POST` | `/cleanup` | admin | yes | Delete empty rooms, close orphaned records |
| `POST` | `/reset` | admin | no | Reset config; body `{ "confirmName": "<guild name>" }`; active rooms preserved |
| `POST` | `/recover` | admin | yes | Reconcile active rooms with Discord |
| `POST` | `/lobby/refresh` | staff | yes | Repair the lobby directory panel |

---

## WebSocket

```
GET /ws?guildId=<guildId>   (WebSocket upgrade, session cookie required)
```

The connection is authenticated by the `chamber.sid` session cookie and scoped to a guild the session can access. Server frames:

```json
{ "type": "hello", "data": { "bot": { "online": false }, "guildId": "…" } }
{ "type": "room.created", "data": { "guildId": "…", "room": { … } }, "at": "…" }
```

Client messages:

```json
{ "type": "ping" }
{ "type": "subscribe", "guildId": "…" }
```

Broadcast event types:

- `room.created`, `room.updated`, `room.deleted`
- `room.member.joined`, `.left`, `.invited`, `.removed`, `.banned`, `.unbanned`, `.promoted`
- `room.access.granted`
- `queue.updated`
- `waiting.created`, `waiting.resolved`, `waiting.expired`
- `reservation.created`, `.cancelled`, `.created_room`, `.failed`
- `event.created`, `event.updated`, `event.cancelled`
- `merge.requested`, `merge.resolved`
- `config.updated`
- `audit.created`

Events are only sent to sockets subscribed to the matching guild. The dashboard invalidates the relevant React Query caches on each event; polling remains as a fallback.

---

## Security notes

- Session cookies are `HttpOnly` and `SameSite=Lax`; set `SESSION_COOKIE_SECURE=true` behind HTTPS.
- CSRF tokens are session-bound and mandatory for mutations.
- Origin checks reject cross-site mutations as defence in depth.
- Passwords are bcrypt-hashed (cost 12), never logged, and never returned.
- API responses never include bot tokens, database credentials, session secrets or password hashes.
- Zod validation rejects unknown/oversized input at the boundary.
- Uploaded banners are content-sniffed from their bytes, size-capped at 4 MB and stored under random filenames; script-bearing
  formats such as SVG are refused, and the uploads folder is public-by-URL rather than access-controlled.
- Prisma parameterizes all queries.
- Role and owner checks are re-evaluated live on every guild request when the bot is online.
- Audit logs record actor, action, target, metadata, IP hash and user agent.
