# Chamber

**Temporary voice, perfectly orchestrated.**

Chamber is a production-grade temporary voice room platform for Discord. It pairs a Discord.js bot with a real-time React control dashboard, a REST + WebSocket API, PostgreSQL/Prisma persistence, and a Components V2–only interaction layer.

It is an independent, self-hostable open-source project. It is not affiliated with, or derived from, any existing Discord bot brand.

---

## Contents

- [Screenshots](#screenshots)
- [Features](#features)
- [Architecture](#architecture)
- [Technology stack](#technology-stack)
- [Requirements](#requirements)
- [Quick start](#quick-start)
- [Discord Developer Portal setup](#discord-developer-portal-setup)
- [Bot permissions](#bot-permissions)
- [Required intents](#required-intents)
- [Environment variables](#environment-variables)
- [Database setup](#database-setup)
- [Prisma migrations](#prisma-migrations)
- [Running the bot and dashboard](#running-the-bot-and-dashboard)
- [Docker deployment](#docker-deployment)
- [Slash commands](#slash-commands)
- [Control panel](#control-panel)
- [Room templates](#room-templates)
- [Privacy system](#privacy-system)
- [Waiting room](#waiting-room)
- [Queue system](#queue-system)
- [Reservations](#reservations)
- [Room events](#room-events)
- [AI assistant](#ai-assistant)
- [Analytics](#analytics)
- [API documentation](#api-documentation)
- [Data model](#data-model)
- [Lifecycle, recovery and automation](#lifecycle-recovery-and-automation)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)
- [Security recommendations](#security-recommendations)
- [Known limitations](#known-limitations)
- [Contributing](#contributing)
- [License](#license)
- [Credits](#credits)

---

## Screenshots

> Captured from the bundled local development environment in **bot-offline mode**. The dashboard, database and API shown are real; Discord room actions require a bot token. No demo data ships with the project — the room below was inserted into the local development database by hand, and the controls that need Discord are correctly disabled.

### Sign in

![Chamber sign-in](docs/screenshots/login.png)

### Command center

![Chamber overview dashboard](docs/screenshots/overview.png)

### Room templates

![Room template catalogue](docs/screenshots/templates.png)

### Visual template builder

![Visual template builder with live preview](docs/screenshots/template-builder.png)

### Analytics

![Room analytics](docs/screenshots/analytics.png)

### Room inspector

![Active room with banner, identity, queue, bans and allow-list](docs/screenshots/room-drawer.png)

### Mobile

<p align="center">
  <img src="docs/screenshots/mobile-overview.png" width="360" alt="Chamber mobile overview" />
</p>

---

## Features

### Temporary voice engine

- Join-to-create triggers with multiple channels, categories, templates and room types.
- Per-user and per-server room caps, category caps, and concurrency locks that prevent duplicate rooms during rapid voice updates.
- Owner assignment, permission overwrites, control panel creation and database registration in one flow.
- Persistent ownership with transfer, claim and automatic recovery when the owner leaves.
- Restart recovery that reconciles database rooms with live Discord channels.
- Automatic empty-room cleanup with a grace period. **Occupied rooms are never destroyed automatically.**

### Advanced room controls

Rename, topic, capacity, lock/unlock, hide/reveal, delete, transfer, claim, clone, reset, category move, bitrate, and voice region (applied where Discord supports it, reported honestly when it does not).

### Member management

Invite, remove, temporary ban/block, unban, allow-list users and roles, move, server mute/deafen, and temporary room administrators with automatic expiry.

### Privacy

Seven modes: Public, Private, Invite only, Request to join, Password, Friends-only (trusted list), and Role restricted. Password protection is a real bot verification workflow with bcrypt hashes, attempt limits and lockouts — Discord has no native voice password.

### Waiting room

Request → owner DM with Accept/Reject → permission grant → requester notification, with expiry and history.

### Queue

Per-room voice queues with positions, maximum size, priority roles, owner-controlled admission, auto-admit, and notifications when a slot opens.

### Reservations

Scheduled rooms with date/time, duration, template, privacy, capacity, per-user limits, reminders via Discord timestamps and automatic creation.

### Room events

Gaming, movie, study, meeting and discussion events with descriptions, scheduled times, participant limits, RSVP buttons and Discord scheduled-event sync when permissions allow.

### AI assistant

Optional OpenAI-compatible provider (including local Ollama) with a deterministic local heuristic fallback. Suggestions are advisory; applying a suggestion always requires an explicit action.

### Dashboard

A dark, responsive SaaS control room with 18 pages:

Overview · General · Trigger Channels · Voice Categories · Room Templates · Room Types · Permissions · Privacy · Waiting Room · Queue · Reservations · Room Automation · AI Assistant · Active Rooms · Analytics · Activity Logs · Premium Features · Advanced Settings.

Every page is backed by real REST endpoints and PostgreSQL writes. Mutations are CSRF-protected, validated with Zod, authorized per guild, and audited.

### Operations

Audit logs, room history, daily analytics, retention pruning, live WebSocket updates, configuration export/import, cleanup, panel refresh, recovery, Docker deployment, and automated tests.

---

## Architecture

Chamber runs the bot and API in one supervised Node.js process. This is deliberate: room state, Discord caches and dashboard mutations share a single source of truth, so live updates need no external pub/sub. The dashboard is a separately built React application served by the API in production.

```
┌──────────────────────────────┐        OAuth2 / REST / WS        ┌───────────────────────────┐
│  React dashboard (Vite)      │ ───────────────────────────────► │  Express API + WebSocket   │
│  TypeScript · Tailwind · RQ  │ ◄─────────────────────────────── │  session · CSRF · Zod      │
└──────────────────────────────┘                                  └─────────────┬─────────────┘
                                                                                │ in-process services
┌──────────────────────────────┐        Discord Gateway           ┌─────────────▼─────────────┐
│  Discord servers             │ ◄─────────────────────────────── │  Discord.js bot engine     │
│  voice states · members      │                                  │  rooms · panels · controls │
└──────────────────────────────┘                                  └─────────────┬─────────────┘
                                                                                │ Prisma
                                                                  ┌─────────────▼─────────────┐
                                                                  │  PostgreSQL               │
                                                                  │  rooms · config · audit   │
                                                                  └───────────────────────────┘
```

### Project structure

```
chamber/
├── apps/
│   ├── server/                 # JavaScript: bot engine, Express API, WebSocket hub
│   │   ├── src/
│   │   │   ├── bot/            # client, commands, interactions, panels, gateway, scheduler
│   │   │   ├── services/       # rooms, privacy, queue, reservations, events, merge, AI, audit
│   │   │   ├── api/            # Express app, auth, middleware, routes, WebSocket
│   │   │   ├── lib/            # UI builders, Discord helpers, events, errors, state
│   │   │   ├── config.js
│   │   │   └── index.js
│   │   └── test/               # Vitest unit + integration tests (real PostgreSQL)
│   └── web/                    # TypeScript: React dashboard
│       └── src/
│           ├── pages/          # 18 dashboard pages
│           ├── components/     # design system, layout, forms
│           └── lib/            # API client, auth, hooks, realtime, formatting
├── packages/
│   ├── db/                     # Prisma schema, migrations, seed, client wrapper
│   └── shared/                 # Zod contracts, built-in templates/types, helpers
├── docs/                       # API reference and screenshots
├── scripts/                    # test database preparation, visual QA
├── Dockerfile
└── docker-compose.yml
```

---

## Technology stack

| Layer | Technology |
| --- | --- |
| Bot | Node.js, Discord.js v14 (Components V2), JavaScript ESM |
| API | Express 5, express-session + PostgreSQL store, Helmet, rate limiting, Zod |
| Realtime | `ws` WebSocket hub with session authentication and guild scoping |
| Database | PostgreSQL 14+, Prisma ORM 6, checked-in migrations |
| Dashboard | React 19, TypeScript, Vite 7, Tailwind CSS 4, React Query, Recharts, Lucide |
| Auth | Discord OAuth2 (`identify`, `guilds`), server-side sessions, CSRF tokens |
| AI | Optional OpenAI-compatible endpoint; local deterministic fallback |
| Tests | Vitest 5, Supertest, real PostgreSQL, deterministic Discord adapter |
| Deployment | Docker multi-stage image, Docker Compose, GitHub Actions CI |

No embeds are used anywhere in the bot. Every interactive bot message uses Discord **Components V2** (`IsComponentsV2`) with containers, text displays, separators, sections, buttons, select menus and modals.

---

## Requirements

- Node.js **22.12+** (Node 24 recommended and used in CI/Docker)
- PostgreSQL **14+**
- A Discord application with a bot token
- Optional: Docker + Docker Compose
- For browser QA only: Playwright Core and an installed Chromium-based browser (Edge works)

---

## Quick start

```bash
git clone <your-fork-url> chamber
cd chamber
npm install
cp .env.example .env
```

Edit `.env`:

| Variable | Notes |
| --- | --- |
| `DATABASE_URL` | `postgresql://user:pass@localhost:5432/chamber?schema=public` |
| `SESSION_SECRET` | At least 32 random characters (`openssl rand -hex 32`) |
| `DISCORD_TOKEN` | Bot token from the Developer Portal |
| `DISCORD_CLIENT_ID` | Application ID |
| `DISCORD_CLIENT_SECRET` | OAuth2 client secret |
| `DISCORD_REDIRECT_URI` | Must match the portal exactly |
| `WEB_ORIGIN` | Where the dashboard runs (`http://localhost:5174` locally) |

Create the databases:

```sql
CREATE USER chamber WITH PASSWORD 'chamber';
CREATE DATABASE chamber OWNER chamber;
CREATE DATABASE chamber_test OWNER chamber;
```

Run migrations and seed built-ins:

```bash
npm run db:deploy
npm run db:seed
```

Start development:

```bash
npm run dev
```

- API + bot: `http://localhost:3100`
- Dashboard: `http://localhost:5174`
- Open `/login`. If `DEV_AUTH=true` and the bot token is empty, use **Development sign-in** to explore the dashboard in bot-offline mode.

> Port 5173 is not used by default because it is commonly occupied by another local Vite project. Change the Vite port and `WEB_ORIGIN` together if you prefer it.

### Production build

```bash
npm run build
SERVE_WEB=true npm start
```

The API serves the built dashboard from `apps/web/dist` when `SERVE_WEB=true`.

---

## Discord Developer Portal setup

1. Create an application at the [Discord Developer Portal](https://discord.com/developers/applications).
2. **Bot** → create the bot, copy the token into `DISCORD_TOKEN`.
3. Copy the Application ID into `DISCORD_CLIENT_ID`.
4. **OAuth2** → copy the client secret into `DISCORD_CLIENT_SECRET`.
5. Add a redirect URI exactly matching `DISCORD_REDIRECT_URI`:
   - Local: `http://localhost:3100/api/auth/callback`
   - Docker: `http://localhost:3000/api/auth/callback`
   - Production HTTPS: `https://your-domain/api/auth/callback`
6. Enable **Server Members Intent**. Chamber needs member display names, role checks and voice member state.
7. Enable the **Guild Scheduled Events** intent if your application lists it separately.
8. Invite the bot using the URL returned by `GET /api/meta` (`inviteUrl`) or construct one with the permissions below.

### OAuth scopes

Chamber requests only:

- `identify` — user identity
- `guilds` — the list of servers the user can manage

No message content, email or presence scopes are requested.

### Dashboard access

A user can open a guild in the dashboard when at least one is true:

- They are the Discord server owner.
- They have **Administrator** or **Manage Server**.
- Their role is listed in **Permissions → Dashboard administrators** or **Staff moderators** (resolved live through the bot).

Staff roles require the bot to be online for live role verification. While the bot is offline, the dashboard falls back to the OAuth session permissions captured at login.

---

## Bot permissions

Grant the bot role at least:

| Permission | Why |
| --- | --- |
| View Channels | Read room and lobby channels |
| Send Messages | Control panels, event cards, notifications |
| Read Message History | Fetch and edit existing panels |
| Manage Channels | Create, edit and delete temporary voice channels |
| Manage Roles | Write channel permission overwrites for roles |
| Manage Messages | Clean up room panels when needed |
| Move Members | Move owners into rooms, queue admissions, merges |
| Mute Members | Room moderation |
| Deafen Members | Room moderation |
| Manage Events | Create/cancel Discord scheduled events |

Place the bot role **above** the roles it manages. The bot does not request Administrator, and does not need the Message Content intent.

The exact invite permission bitfield is exposed by `/api/meta` so you never need to guess it.

---

## Required intents

| Intent | Required | Reason |
| --- | --- | --- |
| `Guilds` | Yes | Guild/channel/role cache |
| `GuildVoiceStates` | Yes | Join-to-create and room membership |
| `GuildMembers` | Yes (privileged) | Display names, role checks, moderation, ownership |
| `GuildScheduledEvents` | Yes for event sync | Discord scheduled events |
| `MessageContent` | **No** | Chamber never reads message content |

---

## Environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `NODE_ENV` | `development` | Set `production` in deployment |
| `API_HOST` | `0.0.0.0` | API bind address |
| `API_PORT` | `3100` | API port |
| `WEB_ORIGIN` | `http://localhost:5174` | Dashboard origin used for OAuth redirects and origin checks |
| `SERVE_WEB` | `false` (true in production per config) | Serve `apps/web/dist` from Express |
| `TRUST_PROXY` | `false` | Set true behind a reverse proxy |
| `LOG_LEVEL` | `info` | Pino log level |
| `DATABASE_URL` | — | PostgreSQL connection string |
| `TEST_DATABASE_URL` | dev test DB | Database used by `npm test` |
| `DISCORD_TOKEN` | — | Bot token |
| `DISCORD_CLIENT_ID` | — | Application ID |
| `DISCORD_CLIENT_SECRET` | — | OAuth2 secret |
| `DISCORD_REDIRECT_URI` | `http://localhost:3100/api/auth/callback` | OAuth callback |
| `SESSION_SECRET` | — | Required, 32+ characters |
| `SESSION_COOKIE_SECURE` | `false` in dev, `true` in prod | Set true behind HTTPS |
| `SESSION_MAX_AGE_DAYS` | `7` | Rolling session lifetime |
| `DEV_AUTH` | `false` | Development-only login; impossible in production |
| `DEV_AUTH_USER_ID` / `DEV_AUTH_USERNAME` / `DEV_AUTH_GUILD_ID` | — | Development identity |
| `AI_ENABLED` | `false` | Enable external AI suggestions |
| `AI_BASE_URL` | — | OpenAI-compatible base URL (e.g. `http://localhost:11434/v1`) |
| `AI_API_KEY` | — | Optional provider key |
| `AI_MODEL` | — | Model name |
| `STORAGE_DIR` | `./storage` | Folder for uploaded room banners, resolved from the project root |

Secrets are never sent to the browser. The dashboard receives only the public AI status and provider name.

---

## Database setup

Chamber uses PostgreSQL with Prisma. The schema is in `packages/db/prisma/schema.prisma`.

```bash
npm run db:generate     # Generate Prisma Client
npm run db:migrate      # Create/apply a development migration (interactive)
npm run db:deploy       # Apply committed migrations (CI/production)
npm run db:seed         # Seed built-in templates and room types
npm run db:studio       # Inspect data in Prisma Studio
```

The seed is idempotent. It installs:

- 10 built-in room templates
- 10 built-in room types
- A development guild when `DEV_AUTH=true` and `DEV_AUTH_GUILD_ID` is set

Built-in templates are global and read-only in the UI. Duplicate one to customize it.

### Test database

```bash
npm run test:prepare    # Applies migrations to TEST_DATABASE_URL
npm test
```

---

## Prisma migrations

Two migrations are checked in:

- `20261031113736_init` — users, guilds, configuration, rooms, members, permissions, bans, invitations, waiting requests, queue, reservations, events, merge requests, history, analytics, audit, preferences.
- `20261031115926_room_events_messages` — event card message tracking and sync error reporting.

Apply them with `npm run db:deploy`. Never edit applied migrations; create a new migration instead.

---

## Running the bot and dashboard

### Development

```bash
npm run dev
```

This runs the API/bot on `3100` and Vite on `5174` with `/api` and `/ws` proxied.

If `DISCORD_TOKEN` is missing, the bot enters **bot-offline mode**:

- The dashboard and configuration work.
- Live room actions return `409 BOT_OFFLINE` with a clear message.
- The UI labels offline state and disables unsafe actions.
- No fake rooms or simulated Discord state are created.

### Production

```bash
npm run build
SERVE_WEB=true NODE_ENV=production node apps/server/src/index.js
```

Use a process supervisor (systemd, Docker, PM2) to restart the process. Slash commands are deployed globally on every ready event.

---

## Docker deployment

The image builds the dashboard, generates Prisma Client, applies migrations on boot and starts the bot + API.

```bash
cp .env.example .env
# set POSTGRES_PASSWORD, SESSION_SECRET, DISCORD_* and PUBLIC_WEB_ORIGIN if needed
docker compose up --build -d
```

Defaults:

- App: `http://localhost:3000`
- PostgreSQL is internal; it is not published to the host by default.
- `PUBLIC_WEB_ORIGIN` (optional) controls the public origin and OAuth redirect.
- `APP_PORT` (optional) changes the published port.

Health checks are defined for both services. The database volume is named `chamber-db`.

For production:

- Set `SESSION_COOKIE_SECURE=true` behind HTTPS.
- Set `TRUST_PROXY=true` behind a trusted reverse proxy.
- Set `PUBLIC_WEB_ORIGIN=https://your-domain`.
- Register the matching OAuth redirect URI in the Developer Portal.
- Keep `DEV_AUTH=false`.

---

## Slash commands

All commands are guild-only. Room-management commands target the caller's active room unless noted.

### `/tempvoice`

| Subcommand | Description | Permission |
| --- | --- | --- |
| `setup` | Configure a trigger channel, category and defaults | Manage Server / configured admin role |
| `enable` / `disable` | Toggle the engine | Administrator |
| `configure` | Show a V2 configuration summary + dashboard link | Administrator |
| `triggers` | List, add or remove trigger channels | Administrator |
| `categories` | List, add or remove category rules | Administrator |
| `templates` | List available templates | Administrator |
| `active` | List active temporary rooms | Administrator |
| `statistics` | 30-day server analytics | Administrator |
| `cleanup` | Delete empty rooms and close orphaned records | Administrator |
| `reset` | Reset configuration (rooms are preserved), requires `confirm:true` | Administrator |

### `/room`

| Subcommand | Description |
| --- | --- |
| `create` | Create a room with optional name, template, type, privacy, limit |
| `delete` | Confirm and delete your room |
| `rename` | Rename the room |
| `limit` | Set user limit (0 = unlimited) |
| `lock` / `unlock` | Prevent/allow new joins |
| `hide` / `reveal` | Hide/reveal the channel |
| `invite` | Invite a member (permission grant + DM) |
| `kick` | Remove a member |
| `ban` | Ban/block a member with duration and reason |
| `unban` | Remove a ban |
| `transfer` | Confirmation flow to transfer ownership |
| `clone` | Clone the room with a new owner |
| `claim` | Claim your current room when the owner is absent |
| `privacy` | Change privacy; Password opens a secure modal |
| `permissions` | View/allow/remove user and role allow-list entries |
| `members` | Open the member management panel |
| `info` | Open the full control panel | 
| `settings` | Open advanced settings |
| `queue` | Join, leave, list or admit from the queue |
| `reserve` | Schedule a room (UTC date/time) |
| `statistics` | Show room statistics |

### `/chamber` (advanced extras)

| Subcommand | Description |
| --- | --- |
| `access` | Enter a password-protected room through bot verification |
| `request` | Request access to a private/request room |
| `merge` | Ask another owner to merge their room into yours |
| `event` | Create a room event with RSVP card and Discord event sync |
| `ai` | Generate configuration suggestions |
| `move` | Move a member from your room to another voice channel |

---

## Control panel

Every room posts a persistent Components V2 panel in the room's text-in-voice area (falling back to the configured lobby channel). The panel reflects live state and is refreshed after every join, leave and setting change.

| Row | Buttons |
| --- | --- |
| 1 | Rename · User Limit · Lock · Unlock |
| 2 | Hide · Reveal · Invite · Kick |
| 3 | Transfer · Clone · Queue · Privacy |
| 4 | Members · Settings · Statistics · Refresh |
| 5 | Delete Room |

All 17 buttons are wired. Settings, members, privacy, queue, statistics, waiting requests, events, blocked members and temporary admins live in follow-up V2 panels. Expired interactions, deleted channels, missing permissions and unauthorized users are handled with clear feedback.

---

## Room templates

Built in:

| Template | Privacy | Default limit | Bitrate |
| --- | --- | --- | --- |
| Gaming Squad | Public | Unlimited | 96 kbps |
| Competitive Gaming | Invite only | 5 | 128 kbps |
| Duo Room | Private | 2 | 96 kbps |
| Trio Room | Private | 3 | 96 kbps |
| Study Room | Public | 20 | 64 kbps |
| Music Room | Public | Unlimited | 128 kbps |
| Movie Room | Invite only | 15 | 96 kbps |
| Meeting Room | Invite only | 25 | 64 kbps |
| Private Lounge | Password → locked private until password set | Unlimited | 96 kbps |
| Community Room | Public | Unlimited | 64 kbps |

Administrators can create unlimited custom templates, duplicate built-ins, edit name/emoji/accent/type/privacy/limit/bitrate/name rule/allowed roles, and import or export template JSON. The **visual template builder** includes a live room-preview card.

Room name rules support `{user}`, `{type}` and `{emoji}`. Channel names are sanitized and clamped to Discord's limits.

---

## Privacy system

| Mode | Behaviour |
| --- | --- |
| Public | Everyone can view and connect |
| Private | Hidden from everyone except the owner, allow-list and temp admins |
| Invite only | Visible; only invited members can connect |
| Request to join | Visible; members request access and the owner resolves it |
| Password | Visible; connect denied until the bot verifies the password |
| Friends only | Trusted allow-list only (see limitations) |
| Role restricted | Only allowed roles connect; owner/admin overrides |

### Password workflow

1. Owner sets a password from the panel, `/room privacy`, or the dashboard.
2. Chamber hashes it with bcrypt (cost 12). Plaintext is never logged or returned.
3. A member runs `/chamber access` (or uses a password modal).
4. The bot checks the hash and per-user attempt state.
5. Wrong attempts are counted; after `passwordMaxAttempts` the user is locked out for `passwordLockoutMinutes`.
6. On success, a channel overwrite grants access; the member is moved in if already in voice.

### Privacy honesty

- **Friends only** cannot inspect Discord friend lists — bots have no access to them. Chamber implements it as the owner's trusted allow-list and says so in the UI.
- **Voice regions** are deprecated for many servers; Chamber attempts the change and reports a warning if Discord rejects it.
- **Banners** are a dashboard identity feature only. Discord voice channels do not expose custom channel banners, and Chamber does not claim they do.
  Staff can paste an http(s) image URL or upload a PNG/JPEG/WebP/GIF under 4 MB through `POST /api/guilds/:guildId/uploads`.
  Uploads land in `STORAGE_DIR/uploads` under a random filename, are validated by magic bytes instead of the declared
  content type, and are served from `GET /api/uploads/:file`. Filenames are unguessable, but the folder is not
  access-controlled, so do not upload a banner you would not show to whoever holds the link. Files that no room
  references are swept once they are an hour past their last use.

---

## Waiting room

- Enable it in the dashboard and choose a directory channel.
- Chamber maintains a Components V2 lobby panel listing public and requestable rooms.
- Members choose a request-to-join room from a select menu.
- The owner receives a V2 card with **Accept** and **Reject**.
- Accepting grants a channel overwrite (optionally expiring) and moves the member in if they are in voice.
- Requests expire automatically; history is retained.
- The dashboard shows all pending requests across active rooms.

---

## Queue system

- Available for rooms with a finite user limit.
- Members queue from the room panel, the lobby, or `/room queue join`.
- Priority roles sort ahead of earlier joiners.
- The owner (or staff) admits the next member; auto-admit can be enabled.
- Admission grants access and moves the member if they are already in voice.
- When a slot opens, Chamber notifies the head of the queue and the owner.
- Queue entries expire after two hours.

---

## Reservations

- Created from `/room reserve` or the dashboard.
- Date/time (UTC for slash commands), duration, template, privacy and capacity.
- Per-user limits and booking window enforced before creation.
- Reminder 10 minutes before, via Discord timestamps.
- The room is created automatically and the host receives a link.
- Failures (bot offline, host left, capacity) are recorded and the host is notified.
- Past reservations beyond the grace window are marked expired rather than created late.

---

## Room events

Owners can schedule gaming, movie, study, meeting or discussion events from the room settings panel, `/chamber event`, or the dashboard API.

- A Components V2 RSVP card is posted in the room.
- Participant limits are enforced in the database.
- Chamber attempts to create a Discord scheduled voice event when it has `ManageEvents`; failures are surfaced as a sync warning, not hidden.
- Events move to ACTIVE/COMPLETED automatically and can be cancelled by the owner or staff.

---

## AI assistant

The AI assistant is optional and never required for core functionality.

- Configure an OpenAI-compatible endpoint with `AI_BASE_URL`, `AI_MODEL` and optionally `AI_API_KEY`.
- Local Ollama works through its OpenAI-compatible API.
- Without a provider, a deterministic heuristic engine uses the purpose, expected size, server analytics and built-in templates.
- Suggestions include privacy, capacity, bitrate, template and rationale.
- AI never mutates Discord permissions or kicks members.
- Dashboard “Save as template” and “Apply to room” are explicit user actions.
- The Discord settings panel offers AI suggestions and requires an explicit **Apply suggestions** click.

---

## Analytics

Chamber records room creation/deletion, peak concurrency, participants, voice minutes, room lifetime, owners and room types.

The dashboard offers 7/30/90/365-day ranges with charts, popular room types, top owners, peak concurrent rooms, average lifetime and recent room history. Data is aggregated per UTC day and pruned according to the configured retention policy (daily at 04:00 UTC).

No message content, voice audio, email or private user data is collected.

---

## API documentation

Full endpoint, auth, CSRF, error and WebSocket documentation lives in [docs/API.md](docs/API.md).

Highlights:

- Discord OAuth2 with server-side sessions and CSRF tokens.
- Guild-scoped authorization on every request.
- Zod-validated inputs and consistent error envelopes.
- WebSocket `/ws?guildId=...` authenticated by the session cookie.
- Rate limits on API, auth and AI routes.
- No secrets or password hashes ever returned by the API.
- All live Discord mutations require the bot to be online and return a clear `409` otherwise.

---

## Data model

Prisma models:

`User`, `Guild`, `GuildConfig`, `TriggerChannel`, `VoiceCategory`, `RoomTemplate`, `RoomType`, `ActiveRoom`, `RoomMember`, `RoomPermission`, `RoomBan`, `RoomInvitation`, `WaitingRequest`, `QueueEntry`, `PasswordAttempt`, `Reservation`, `RoomEvent`, `EventParticipant`, `MergeRequest`, `RoomHistory`, `RoomAnalytics`, `DashboardPreference`, `AuditLog`.

Relationships, indexes and cascades are defined in `packages/db/prisma/schema.prisma`. Guild isolation is enforced in queries and routes; no cross-guild room IDs are accepted.

---

## Lifecycle, recovery and automation

- **Empty cleanup**: configurable grace period; rejoining cancels the timer.
- **Lifetime**: configurable maximum; if occupied at expiry, the room is extended 15 minutes with an owner warning and is removed only once empty.
- **Inactivity**: owner notices only; inactivity never deletes a room.
- **Ownership recovery**: owner absent from an occupied room for 5 minutes → longest-present member becomes owner. Owner leaving the server triggers the same recovery immediately.
- **Temporary admins/permissions**: expire automatically; channel overwrites are rebuilt.
- **Restart recovery**: on ready, Chamber reconciles database rooms with Discord. Missing channels close with history (`channel_missing`), interrupted deletions close (`interrupted_deletion`), empty rooms are scheduled for cleanup, panels are repaired, stale member rows are pruned.
- **Scheduler**: every 30 seconds with an overlap guard; reservation reminders/due rooms, room lifecycle, events, analytics peaks, queue/waiting/merge expiry, daily retention pruning.

The occupied-room guarantee is enforced in the engine, not only the UI.

---

## Testing

```bash
npm run test:prepare   # migrate the test database (TEST_DATABASE_URL)
npm test               # Vitest: 68 tests across 9 files
npm run typecheck      # Dashboard TypeScript
npm run build          # Production dashboard build
```

Coverage includes:

- Room creation, V2 control panel composition, permission overwrites, owner movement.
- Control panel row layout, modal and select-menu round-trips, and a source-wide guard that no bot message uses Discord embeds.
- Every panel button is dispatched through the real interaction router and answered, so no control is decorative.
- Duplicate prevention, per-user capacity limits, rapid voice updates.
- Lock/privacy transitions and allow-list/bans/temp admin expiry.
- Ownership transfer, cloning, deletion, room history.
- Password verification, hashing, failed attempts and lockouts.
- Voice join/leave persistence and analytics.
- Queue join/admit/notify/leave; waiting room request accept/reject.
- Reservation validation, due execution, reminders, cancellation, limits.
- Room merging with member transfer and empty-source cleanup.
- Event creation, RSVP limits, cancellation.
- Local AI heuristics.
- Restart recovery and orphaned channel handling.
- API authorization, CSRF, origin checks, validation, template CRUD, offline room protection.
- WebSocket authentication, guild scoping, broadcast and unauthenticated rejection.

The integration suite runs against a **real PostgreSQL database** and a deterministic in-memory Discord adapter, including real Discord.js builders for Components V2.

### Live Discord verification

This project’s automated tests do **not** connect to Discord. A Discord token was not available in the build environment. The Discord gateway round-trip, real rate limits and live client behaviour must be verified by the operator with a token. The UI was exercised in a real Chromium browser with console/network monitoring; the dashboard and API are fully functional in bot-offline mode, which is explicitly labelled.

To verify live:

1. Follow the Developer Portal setup.
2. Start the bot with a token and enable the privileged member intent.
3. Join the trigger channel with a second account.
4. Exercise every panel button, privacy mode, queue admission, request approval, reservation and restart recovery.
5. Check the bot role hierarchy if a permission update fails.

If you find a Discord-specific discrepancy, open an issue with the error code and reproduction steps.

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Dashboard says “Bot offline” | Set `DISCORD_TOKEN`, enable Guild Members intent, restart. Configuration still works without it. |
| `Used disallowed intents` | Enable **Server Members Intent** in the Developer Portal. |
| Trigger channel does nothing | Check engine enabled, trigger enabled, category exists, bot has Manage Channels, and the member is not a bot. |
| Permission overwrite fails | Move the bot role above managed roles; ensure Manage Roles and Manage Channels. |
| Panels not posted | Check View Channel/Send Messages in the voice channel's text chat or configure a lobby fallback channel. |
| OAuth redirect loops or fails | The redirect URI must match exactly; `WEB_ORIGIN` must match the browser origin. |
| CSRF 403 | Refresh the dashboard; mutations require the `X-CSRF-Token` returned by `/api/me`. |
| Session not persisted | Check `DATABASE_URL`; sessions use a PostgreSQL store. Use HTTPS + `SESSION_COOKIE_SECURE=true` correctly. |
| `P1001` database unreachable | Start PostgreSQL and check `DATABASE_URL`. |
| Prisma client missing | Run `npm run db:generate`. |
| Port already in use | API uses 3100, dashboard 5174; change both config and `WEB_ORIGIN`. Docker publishes 3000 by default. |
| Voice region change warns | Discord rejects regions for many guilds; Chamber leaves it automatic and reports this honestly. |
| Reservation failed | Host left the server, bot offline, room capacity reached, or the server hit its room cap. The error is shown to the host. |
| Members can't join a password room | Use `/chamber access` or the password modal; direct channel join is intentionally denied. |
| Queue button says room isn't full | Queues are only for rooms with a finite user limit that is currently reached. |

---

## Security recommendations

- Use HTTPS in production and set `SESSION_COOKIE_SECURE=true`.
- Keep `DEV_AUTH=false` in production; it is rejected by the config validator there.
- Use a unique, 32+ character `SESSION_SECRET`.
- Do not expose PostgreSQL publicly. Docker Compose keeps it internal.
- Put the app behind a reverse proxy and set `TRUST_PROXY=true` only when the proxy is trusted.
- Grant only the bot permissions listed above; avoid Administrator.
- Keep the bot role below your highest trusted administrative role but above managed member roles.
- Rotate the Discord client secret and bot token if exposed.
- Review the audit log regularly; retention is configurable.
- Treat configured staff/admin roles as privileged: they can moderate rooms and, for admin roles, change configuration.
- Members are never able to modify another person's room: every action re-validates owner/temp-admin/staff status against live Discord state.

---

## Known limitations

- Discord does not expose friend lists to bots; **Friends only** is a trusted allow-list.
- Discord has no native voice password; Chamber's bot verification is the supported workflow.
- Voice regions are deprecated for most guilds and may be rejected.
- Discord voice channels do not support custom banners; banners are dashboard-only.
- Channel-level overwrites are limited by Discord (100 overwrites), so extremely large allow-lists can degrade; the UI caps and permission reconciliation handles errors.
- In bot-offline mode, live Discord actions are intentionally unavailable.
- Staff role access requires the bot online for live verification; OAuth fallback is based on Manage Server/Administrator at login.
- The bot and API share one process; horizontal scaling of the bot is not supported (Discord gateway sharding would be a separate feature).
- AI output quality depends on the configured provider; the local heuristic engine is deterministic and intentionally conservative.
- Discord rate limits apply; bulk actions are performed sequentially and may take a moment for large rooms.

---

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) for setup, style, testing and pull-request expectations. Security issues should follow [SECURITY.md](SECURITY.md), not public issues.

---

## License

Chamber is released under the **MIT License**. See [LICENSE](LICENSE).

MIT was selected for this project because it is a recognized permissive open-source license that allows reuse, modification and self-hosting while preserving attribution.

---

## Credits

Built with and thanks to:

- [Discord.js](https://discord.js.org/) and the Discord API
- [Prisma](https://www.prisma.io/)
- [React](https://react.dev/), [Vite](https://vite.dev/), [Tailwind CSS](https://tailwindcss.com/)
- [TanStack Query](https://tanstack.com/query), [Recharts](https://recharts.org/), [Lucide](https://lucide.dev/)
- [Express](https://expressjs.com/), [ws](https://github.com/websockets/ws), [Zod](https://zod.dev/)
- [Vitest](https://vitest.dev/) and [Supertest](https://github.com/ladjs/supertest)

Chamber is an independent project and is not affiliated with Discord Inc. or any existing bot brand.
