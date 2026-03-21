# Migrations

This project previously contained **SQLite** migration SQL. After switching the datasource to **MySQL** in `schema.prisma`, those files were removed to avoid running incompatible DDL with `prisma migrate deploy`.

**Apply schema to MySQL**

- From a shell: `npx prisma db push` or `npm run db:push`
- Without direct terminal: `npm run db:push:node` (runs `src/dbSetup.js`, which invokes `prisma db push`)

When you are ready to use versioned migrations for MySQL, run `npx prisma migrate dev` against a dev database to create a new baseline, then use `prisma migrate deploy` in production.
