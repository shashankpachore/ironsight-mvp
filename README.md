# Ironsight MVP

MVP deal-tracking app using Next.js App Router, TypeScript, Tailwind, Prisma, and SQLite.

## Local Run

1. Install dependencies:

```bash
npm install
```

2. Setup env:

```bash
cp .env.example .env
```

3. Run initial database migration:

```bash
npx prisma migrate dev --name init
```

4. Seed demo data (optional, recommended):

```bash
npm run seed
```

5. Reset DB + reseed in one command (optional):

```bash
npm run reset
```

6. Start app:

```bash
npm run dev
```

Open `http://localhost:3000`.

## Safe Schema Evolution (Prisma)

Use migrations as the source of truth for schema changes.

- Initial setup for a fresh local database:

```bash
npx prisma migrate dev --name init
```

- For every schema change:

```bash
npx prisma migrate dev --name <change_name>
```

- In production:

```bash
npx prisma migrate deploy
```

- Never run `prisma db push` in production. In this project, `db push` is only used for local dev/test SQLite workflows.

## API Endpoints

- `POST /api/deals`
- `GET /api/deals`
- `GET /api/deals/:id`
- `GET /api/accounts`
- `POST /api/accounts/request`
- `GET /api/accounts/pending`
- `POST /api/accounts/:id/approve`
- `POST /api/accounts/:id/reject`
- `POST /api/accounts/:id/assign`
- `POST /api/logs`
- `GET /api/logs/:dealId`
- `GET /api/deals/:id/stage`
- `GET /api/deals/:id/missing-signals`
- `GET /api/export`

## Seed Users

- `admin@ironsight.local` (`ADMIN`)
- `manager@ironsight.local` (`MANAGER`)
- `rep@ironsight.local` (`REP`)

`npm run seed` prints each user's `userId`. Use that value in the `x-user-id` header to simulate role-based access in API requests.
