# Prisma — MySQL (Hostinger / production)

The project uses **MySQL** (`prisma/schema.prisma` → `provider = "mysql"`).

---

## 1. `DATABASE_URL`

Set in `.env` (local) and in your **hosting panel** (production):

```env
# URL-encode special characters in the password.
DATABASE_URL="mysql://USER:PASSWORD@HOST:3306/DATABASE?sslaccept=strict"
```

Use the credentials from **hPanel → Databases → MySQL** (or your provider’s equivalent).

**Local dev:** Your `.env` must use a `mysql://` URL — Prisma will not validate with `file:`. Point at a local MySQL instance or a tunnel to Hostinger.

---

## 2. Apply schema (create tables)

**Option A — shell**

```bash
npx prisma db push
npx prisma generate
```

**Option B — Node (no interactive terminal)**

```bash
npm run db:push:node
```

This runs `src/dbSetup.js`, which executes `prisma db push` for you.

---

## 3. Generate Prisma Client

```bash
npx prisma generate
```

`npm install` runs `postinstall` → `prisma generate` automatically.

---

## 4. Admin + optional seed

```bash
npm run create-admin
npx prisma db seed
```

---

## 5. Restart the app

Restart Node (PM2, Hostinger app manager, etc.) after env and schema changes.

---

## One-liner (after `git pull`)

```bash
npm ci
npm run db:push:node
npm run create-admin
# restart Node
```

---

## Troubleshooting

| Issue | What to check |
|--------|----------------|
| `P1012` / URL must start with `mysql://` | Update `.env` `DATABASE_URL` to a MySQL URL (not `file:`). |
| SSL / connection refused | Try `?sslaccept=strict` or host-specific SSL params from Hostinger docs. |
| `EPERM` on Windows during `generate` | Stop `npm run server` / Node so Prisma can replace `query_engine` DLL. |
| Old SQLite `dev.db` | Safe to delete locally after MySQL works; not used when `provider = mysql`. |

---

## Migrations folder

SQLite migration SQL was removed. Use **`db push`** (or create new MySQL migrations later). See `prisma/migrations/README.md`.

---

## Why `db push` first?

For an empty production DB, **`prisma db push`** syncs `schema.prisma` quickly. You can introduce **`prisma migrate`** later for versioned changes.
