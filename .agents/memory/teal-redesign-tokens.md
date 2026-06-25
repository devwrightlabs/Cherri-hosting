---
name: Teal redesign token strategy
description: How the gold→teal redesign was executed without renaming every utility class; plus the extractApiError helper pattern.
---

## The rule
When doing a brand-color overhaul, keep all Tailwind palette **key names** (`cherry`, `gold`, `accent`) unchanged and swap only their **values** to the new hue. Every downstream component using `text-cherry-400`, `bg-gold-gradient`, `shadow-gold`, etc. automatically picks up the new color with zero component edits.

**Why:** Renaming the keys would require a codebase-wide find-and-replace touching every component; swapping values is a single-file change in tailwind.config.js.

**How to apply:** Change colors → cherry/accent/gold in tailwind.config.js, update the matching CSS variables in index.css (:root), update any hardcoded hex literals in SVG/inline styles (grep for the old hex), and update the theme-color meta in index.html.

## Current teal palette anchor
- Primary action: `#0FB5AE` (cherry-400 / gold.DEFAULT)
- Hover: `#0C9A94` (cherry-500)
- Pressed/dim: `#0A8580` (gold.dim)
- Surface-950: `#0F1117` · Surface-900: `#181B23` · Surface-800: `#20242E`
- Hairline: `#2A2F3A` · Ink: `#F4F5F7` · Ink-mut: `#9CA0AD`
- Live/success: `#10B981`

## extractApiError helper
Added `extractApiError(err: unknown, fallback: string): string` to `client/src/lib/api.ts`. Extracts `response.data.error` string from Axios errors; falls back to `fallback`. Replace any `.catch(console.error)` with a proper error state + this helper.
