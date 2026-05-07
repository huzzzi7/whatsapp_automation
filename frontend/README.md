# React + Vite (dashboard)

In production, the built UI is served from **`frontend/dist`** by **`server.js`**. The dashboard campaign flow is **`/campaign`** (Campaign Wizard). **`/send`** redirects to **`/campaign`**.

### Dev: API proxy

`vite.config.js` proxies **`/api`** → **`http://localhost:3000`** (override with **`VITE_DEV_API_PROXY`** in `frontend/.env.development`) so the React app hits Express on the same origin as Vite (avoids HTML being parsed as JSON).

1. From the **repo root**: **`npm run server`** (Express on port **3000** by default).
2. From **`frontend/`**: **`npm run dev`**, then open **`http://localhost:5173`**.

If you see *“Server returned HTML instead of JSON”*, the proxy target is down or the wrong port — fix the backend or set **`VITE_DEV_API_PROXY`**, then **restart** the Vite dev server.

For production or a remote API, set **`VITE_API_URL`** to the full API base (no trailing slash).

---

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
