---
name: Dev environment & branding
description: How the Sherry Hosting dev workflow runs and the gold-rebrand constraints.
---

# Dev environment & branding

- `start.sh` runs the Express server (port 4000) and Vite client (port 5000)
  concurrently; the "Start application" workflow runs `bash start.sh`, webview on 5000.
- Vite proxies `/api` → `localhost:4000`; `server.allowedHosts: true` for the Replit iframe proxy.
- Prisma schema lives at root `prisma/schema.prisma`; client generated into root `node_modules`.

## Branding (Cherri → Sherry)
- Brand is "Sherry Hosting", decentralized infrastructure. Brand mark emoji is 🌐.
- **Tailwind palette was migrated to GOLD but the class KEY names `cherry-*` and
  `cherry-gradient` were intentionally kept** so existing `bg-cherry-500` /
  `text-cherry-400` / `bg-cherry-gradient` usages keep working. Do NOT rename
  these class keys — only change visible text/emoji.
- **Why:** renaming the keys would mean touching every component; the colors are
  already gold under the old key names.
- Caution: `tailwind.config.js` `backgroundImage` is a hand-edited object — a
  missing trailing comma there throws a misleading `[postcss] vite:css` parse
  error pointing at `index.css` with a bogus line number. Check the config object
  syntax when you see that error.
