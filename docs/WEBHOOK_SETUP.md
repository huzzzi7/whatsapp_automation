# Green API webhook (reply automation)

Reply-driven messages (message 2, 3, …) require Green API to **POST** incoming notifications to your server.

## Recommended URL (per WhatsApp instance)

```
https://<PUBLIC_HOST>/api/webhook/greenapi/<GREEN_INSTANCE_DB_ID>
```

- **`<PUBLIC_HOST>`** — URL reachable from the internet (not `localhost` unless Green API runs locally). Use ngrok, a VPS, or similar.
- **`<GREEN_INSTANCE_DB_ID>`** — The **id** shown in **Settings** for that instance (UUID stored in `green_instances`), **not** only the numeric “Green instance ID” from the Green API console. It must match the instance you select for **Send all** / uploads.

Example: `https://abc123.ngrok-free.app/api/webhook/greenapi/clxyz789...`

## Misconfiguration

If the URL ends at `/api/webhook/greenapi` with **no** trailing id:

- The server logs **`[Webhook] MISCONFIGURED`**.
- **Fallback:** If the JSON body includes **`instanceData.idInstance`** and that value matches a row’s **Green API instance ID** in the database, the server may still route the webhook (see server logs **`FALLBACK`**). Prefer fixing the URL as above.

## Frontend hints

Set **`VITE_PUBLIC_WEBHOOK_BASE_URL`** (and optionally **`VITE_API_URL`**) in the frontend env so **Send messages** and **Settings** can show the full URL to paste into Green API.

## Verify

After a user replies on WhatsApp, logs should include:

- `[HTTP] POST /api/webhook/greenapi/<id>` (or `FALLBACK` with DB id)
- `[Webhook] Instance: <id>`
- `[Webhook] Parsed phone: ...`
- `[Webhook] Prod state exists: true` (production) or test state for test flows
- `[ReplyFlow-Prod] State found` / `Sending message 2`
