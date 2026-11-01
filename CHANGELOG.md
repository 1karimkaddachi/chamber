# Changelog

All notable changes to Chamber are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/) and the project uses semantic versioning.

## [1.0.0] — 2026-10-31

### Added

- Join-to-create temporary voice engine with multiple triggers, categories, templates and room types.
- Per-user, per-guild and per-category limits; creation locks prevent duplicate rooms during rapid voice updates.
- Full room lifecycle: rename, topic, limit, bitrate, lock, hide, delete, transfer, claim, clone, reset, category move, voice region.
- Member management: invite, remove, ban/block with expiry, unban, allow-list users/roles, move, mute/deafen, temporary admins.
- Seven privacy modes, including bot-verified password protection with bcrypt hashing, attempt limits and lockouts.
- Waiting room with V2 request cards, Accept/Reject, expiry, history and lobby directory.
- Voice queues with priority roles, owner admission, auto-admit, notifications and expiry.
- Scheduled reservations with reminders, automatic room creation, per-user limits and failure reporting.
- Room events with RSVP limits, V2 cards and optional Discord scheduled-event sync.
- Room merging with two-owner approval, permission union, member transfer and empty-source cleanup.
- Components V2–only control panels, settings, member moderation, privacy, queue, stats, events and confirmations. No embeds.
- Visual template builder with live preview, built-in templates, custom templates, duplicate/import/export.
- Optional AI assistant with OpenAI-compatible provider support and deterministic local fallback; explicit apply only.
- 18-page React dashboard with dark premium design, responsive layouts, charts, live WebSocket updates, audit logs and configuration builders.
- Room banner uploads: PNG/JPEG/WebP/GIF under 4 MB, validated by magic bytes, stored under random filenames and swept once unreferenced.
- Discord OAuth2 sessions, CSRF protection, origin checks, rate limiting, Helmet, Zod validation and guild-scoped authorization.
- PostgreSQL + Prisma schema with migrations and indexes across 23 models.
- Restart recovery, automatic cleanup, ownership recovery, temporary permission expiry and retention pruning.
- Docker multi-stage image, Docker Compose with PostgreSQL and health checks, GitHub Actions CI.
- 68 automated tests covering room lifecycle, member operations and allow-lists, permissions, queue/waiting, reservations, merging, events, AI heuristics, control panel layout and interaction dispatch, API auth/CSRF, uploads, WebSocket and recovery.
- Comprehensive README, API reference, contributing guide, security policy and MIT license.
