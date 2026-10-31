# Brightloop

Local-first subscription billing platform.

## Run with Docker

Requires Docker Compose. Copy `.env.example` to `.env`, then run:

```sh
docker compose up
```

Before any shared or production deployment, replace the example
`AUTH_TOKEN_SECRET`, `RESET_TOKEN_ENCRYPTION_KEY`, and seed passwords with
independently generated secrets. The all-zero reset key in `.env.example` is
only a local setup placeholder.

Generate local secrets with Node.js 20:

```sh
node -e "const c=require('node:crypto'); console.log(c.randomBytes(48).toString('base64url'))"
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Use the first value for `AUTH_TOKEN_SECRET` and the second for
`RESET_TOKEN_ENCRYPTION_KEY`.

The Brightloop workspace is available at `http://localhost:4173`; the API listens on
`http://localhost:3000`. Check `GET /api/health`. PostgreSQL 16 data is stored in
a named Docker volume. Stop the services with `Ctrl+C`; use `docker compose down`
to remove the containers while preserving database data.

The API container applies numbered SQL migrations before starting. After
starting the stack, optionally load the development dataset with
`docker compose exec api npm run db:seed`. The seed requires the `SEED_*`
credentials in `.env`, refuses to run with `NODE_ENV=production`, and gives all
seed customer accounts the configured `SEED_CUSTOMER_PASSWORD`. Set unique,
throwaway passwords before seeding; never use these accounts in a shared or
production environment.

## Run without Docker

Install Node.js 20 and PostgreSQL 16 locally, create a database and role matching
the values in `.env.example`, then copy `.env.example` to `.env`. For a locally
running PostgreSQL server, change `DATABASE_URL` to use `localhost` instead of
the Compose service name `db`. Install dependencies and start the API:

```sh
npm install
npm run db:migrate
npm run dev
```

Run `npm run db:seed` to load the same development dataset.

In another terminal, start the web development server:

```sh
npm run web:dev
```

The billing workspace provides a dry-run preview, transactional billing runs,
skip and margin-warning details, invoice confirmation/sending/payment actions,
and printable PDFs. Billing actions require an authenticated admin or staff
session. The billing API and routes are documented in [docs/API.md](./docs/API.md).

## Checks

Run `npm test`, `npm run lint`, `npm run format:check`, `npm run typecheck`, and
`npm run build`.

## Structure

- `src/config`, `src/errors`, `src/middleware`, `src/routes`,
  `src/services`, `src/infrastructure` — API foundation.
- `web/src` — Vite/React finance workspace.
- `tests` — API, billing calculation, state-machine, and migration contract tests.
- `docs` — API and architecture decisions.
- `database/migrations` — ordered PostgreSQL DDL migrations.
- `scripts` — migration runner and local development seeder.
