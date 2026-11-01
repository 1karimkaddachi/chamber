# Contributing to Chamber

Thanks for considering a contribution. Chamber is a production-focused open-source project; correctness, honesty about Discord limitations, and real functionality matter more than feature count.

## Development setup

```bash
npm install
cp .env.example .env
# configure DATABASE_URL, SESSION_SECRET and (optionally) Discord credentials
npm run db:deploy
npm run db:seed
npm run dev
```

Ports:

- API + bot: `3100`
- Dashboard: `5174`

Without a Discord token the app runs in **bot-offline mode**; the dashboard and configuration remain usable and unsafe actions are explicitly disabled.

## Before opening a pull request

```bash
npm run test:prepare
npm test
npm run typecheck
npm run build
```

All four must pass. CI runs the same commands against PostgreSQL 17.

## Code style

- Server code is JavaScript ESM. Use explicit imports and avoid circular dependencies.
- Dashboard code is strict TypeScript + React 19 function components.
- Business logic belongs in `apps/server/src/services`; Discord presentation belongs in `apps/server/src/bot`.
- Route handlers validate input with Zod and never trust guild IDs from the client.
- Add Prisma indexes for new query patterns and a new migration for schema changes. Never edit applied migrations.
- Use the Components V2 builders in `src/lib/ui.js`. **Never add Discord embeds**; `IsComponentsV2` messages cannot contain them.
- Every button, select, modal and command must be implemented end to end. No decorative controls, placeholder handlers or fake success paths.
- Keep the UI usable on mobile and preserve the existing dark design system.
- Avoid adding dependencies unless they are clearly justified and stable for Node 22+.

## Database changes

```bash
# edit packages/db/prisma/schema.prisma
npm run db:migrate -- --name describe_the_change
```

Commit the generated migration and regenerate the client. Update tests and the API documentation if behavior changes.

## Tests

- Prefer integration tests with the real PostgreSQL test database and the deterministic Discord adapter in `apps/server/test/helpers.js`.
- Cover permission edges, occupied-room safety, expired records and recovery.
- Do not mock the database for workflows that depend on transactions or unique constraints.
- Live Discord verification requires credentials and is not part of CI. If you change gateway behavior, include manual verification notes and screenshots/logs where possible.

## Commit messages

Use concise, imperative messages, for example:

```
fix: preserve occupied rooms on lifetime expiry
feat: add request-to-join directory panel
docs: document password lockout policy
test: cover queue priority ordering
```

## Pull request checklist

- [ ] Tests, type-check and production build pass.
- [ ] New behavior is covered by tests.
- [ ] No embeds were introduced.
- [ ] Every new interactive component has a working handler with authorization checks.
- [ ] API inputs are validated and responses do not leak secrets.
- [ ] Permissions/roles are verified live when the bot is online.
- [ ] README or API docs updated where relevant.
- [ ] No generated secrets, `.env` files or local storage directories are committed.

## Reporting bugs

Include:

- Discord.js, Node.js and PostgreSQL versions
- Bot permissions and enabled intents
- Exact error code/message
- Reproduction steps
- Whether the bot was online or offline
- Relevant audit log or server logs with secrets removed

Security issues must not be reported in public issues. See [SECURITY.md](SECURITY.md).
