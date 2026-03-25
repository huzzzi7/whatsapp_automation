# Hostinger / production deployment

## Install

```bash
npm install
```

## MySQL

1. Create a database and import the schema from `db.sql` (phpMyAdmin or `mysql` CLI).
2. Set `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, and `DB_NAME` in `.env`.

## Admin user

```bash
npm run create-admin
```

Creates `admin@gmail.com` with password `admin123` (change after first login).

## Start

```bash
npm start
```

## Notes

- Ensure Node >= 18.
- Use HTTPS in production; set session cookie options accordingly.
- Set environment variables in your hosting panel.
