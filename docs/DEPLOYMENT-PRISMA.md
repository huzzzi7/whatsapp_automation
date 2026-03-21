# Prisma — production database (Hostinger / VPS)

## Error: `The table main.User does not exist`

`main` is SQLite’s default schema. Prisma is connected, but **no tables were created yet**. Apply the schema with `db push` on the **same machine** where the app runs, using the **same `DATABASE_URL`** as in `.env`.

---

## 1. Verify `DATABASE_URL` on the server

This project uses **SQLite** (`prisma/schema.prisma` → `provider = "sqlite"`).

In `.env` (production):

```env
# Path is relative to the process working directory when Node starts (often project root).
DATABASE_URL="file:./prisma/dev.db"

# Or a dedicated file:
# DATABASE_URL="file:./data/app.db"
```

- Ensure the directory exists and is **writable** by the Node process.
- If you use **MySQL** from Hostinger instead of SQLite, you must change `provider` in `schema.prisma` to `mysql` and use a MySQL `DATABASE_URL` — this doc assumes **SQLite** as in the repo.

---

## 2. Push schema (creates tables — safe on empty DB)

SSH into the server, go to the app root (where `package.json` and `prisma/` live), then:

```bash
npx prisma db push
```

This creates `User`, `ConversationState`, `CampaignLog`, `GreenInstance`, etc., without using migrations.

---

## 3. Generate Prisma Client

```bash
npx prisma generate
```

`npm install` can also run `prisma generate` if you use the `postinstall` script in `package.json`.

---

## 4. Create admin user (empty DB)

With `.env` loaded (same `DATABASE_URL`):

```bash
npm run create-admin
```

Or:

```bash
node prisma/create-admin.js
```

Adjust credentials in `prisma/create-admin.js` or set env vars if you extend the script.

---

## 5. Restart the app

Restart Node (PM2, Passenger, Hostinger panel, etc.) so the new DB file and client are used.

---

## One-liner (after `git pull` / deploy)

```bash
npm ci
npx prisma db push
npx prisma generate
npm run create-admin
# restart your Node process
```

---

## Troubleshooting

| Issue | What to check |
|--------|----------------|
| Still “table does not exist” | Wrong cwd → `DATABASE_URL` points to a different file than the running app. Use absolute path: `file:/var/www/.../prisma/dev.db` |
| `EPERM` on Windows during `generate` | Stop `node` / `npm run server` so Prisma can overwrite `query_engine` DLL, then run `npx prisma generate` again |
| MySQL URL with this schema | Won’t work until `schema.prisma` uses `provider = "mysql"` and URLs match |

---

## Why `db push` and not `migrate`?

On shared hosting, `migrate` needs migration history and care with prod DBs. **`db push`** syncs `schema.prisma` → database and is appropriate for an **empty** database and quick deploys.
