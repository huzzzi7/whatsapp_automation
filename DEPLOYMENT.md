# Hostinger Deployment Notes

## Install

```bash
npm install
```

## Prisma

```bash
npx prisma generate
npx prisma db push
```

## Admin user

Creates/updates `jonny@ultimatefreshersevents.com` (ADMIN, bcrypt password):

```bash
npm run create-admin
```

Or: `npx prisma db seed` (also runs admin creation + optional Green API seed).

## Start

```bash
npm start
```

## Notes

- Ensure Node >= 18.
- Enable SSL before login testing.
- Set environment variables in Hostinger panel.
