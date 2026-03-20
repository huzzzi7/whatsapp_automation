# Cursor prompt (paste in **Ask** mode — read-only / planning)

Copy everything inside the fence into Cursor chat when you want step-by-step guidance without auto-editing:

```
@frontend/src/components/Topbar.jsx @frontend/src/index.css

Task: Replace the Topbar "Toggle theme" text button with day/night icons.

Requirements:
1. Use an icon-only control (sun for "switch to light" when current theme is dark, moon for "switch to dark" when current theme is light).
2. Keep `document.documentElement.setAttribute('data-theme', ...)` and `localStorage.setItem('theme', ...)` in sync with existing `main.jsx` boot logic.
3. React must re-render after toggle so the icon updates: store theme in `useState`, initialize from `document.documentElement.getAttribute('data-theme')` or `localStorage`, update state inside the click handler.
4. Accessibility: `aria-label` (e.g. "Switch to light theme" / "Switch to dark theme"), optional `title` tooltip.
5. Style with a small square button (e.g. 40×40px) using design tokens (`var(--border)`, `var(--surface-elevated)`, hover like `.topbar-logout`).
6. Implement icons as inline SVGs (no new npm dependency) or optionally suggest `lucide-react` / `@heroicons/react` if the project prefers a package.

Do not remove session/auth or logout behavior.
```

---

## Quick checklist (if you implement manually)

- [ ] Remove `Button` import if unused.
- [ ] Add `.topbar-theme-btn` (and optional `.topbar-theme-icon`) in `index.css`.
- [ ] Sun visible when `data-theme="dark"`; moon when `data-theme="light"`.
