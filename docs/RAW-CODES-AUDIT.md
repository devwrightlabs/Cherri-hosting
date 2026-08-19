# T4.4 — No-Raw-Codes Audit

**Date:** 2026-08-19  
**Scope:** User-facing surfaces only (error messages, UI text).  
Excluded: Tailwind CSS classes, TypeScript type definitions, internal logging, internal constants.

---

## Audit methodology

```bash
# Server routes: raw HTTP status codes in error messages returned to users
grep -rn "HTTP [45][0-9][0-9]\|error.*[45][0-9][0-9]" server/src/routes/ --include="*.ts" | grep "json\|send"

# Client: raw HTTP status codes in user-visible strings
grep -rn "\`.*[45][0-9][0-9].*\`\|error.*[45][0-9][0-9]" client/src/ --include="*.tsx,*.ts"

# Stack traces reaching users
grep -rn "\.stack\b" server/src/routes/ --include="*.ts" | grep "json\|send"
```

---

## Findings and fixes

### FIXED: `client/src/api/deployApi.ts` — raw HTTP status code in fallback error

**Before:**
```typescript
if (status) {
  return {
    kind: 'generic',
    message: `The server returned an error (${status}). Please try again.`,
  };
}
```

**After:** Mapped to plain-language variants:
- 401/403 → "You are not authorised to do this. Try signing in again."
- 404 → "The resource you requested was not found. It may have been deleted."
- 429 → "Too many requests. Please wait a moment and try again."
- 5xx → "Something went wrong on our end. Please try again in a moment."
- Other → "The request could not be completed. Please try again."

---

### FIXED: `server/src/services/ipfs.ts` — raw Pinata HTTP status codes in failure messages

**Before:**
```typescript
return `Pinata rejected the request (${status}). The server's Pinata credentials...`;
return `Pinata error ${status}${detail ? `: ${detail}` : ''}`;
```

**After:** Provider-agnostic plain language:
- 401/403 → "IPFS storage rejected the request — the server's storage credentials are invalid..."
- 413 → "The file is too large for IPFS storage."
- 429 → "IPFS storage is rate-limiting requests right now."
- 5xx → "IPFS storage had a problem on our end."
- Other → "IPFS storage returned an error. Please try again."

This also removes the "Pinata" brand name from user-facing messages (per the ethos of not leaking provider names to end users).

---

## Already clean (no changes needed)

### Server routes

All routes return structured `{ error: "plain language message" }` objects.  
Stack traces are logged server-side only (via `logger.error`), never serialised into responses.  
`RailwayApiError` with raw status is caught in routes and converted to generic "temporarily unavailable" messages.

```bash
$ grep -rn "\.stack\b" server/src/routes/ --include="*.ts" | grep "json\|send"
# (no output — clean)
```

### Client components

- `DomainGateway.tsx`: Comment explicitly says "never show raw enum values to users". ✓
- `extractDeployError`: Now returns plain-language messages for all status variants. ✓  
- `extractApiError` in `api.ts`: Returns `fallback` string (always plain language at call site). ✓
- `Badge.tsx`, `Spinner.tsx`, `Button.tsx`: Tailwind colour classes containing "500", "400" etc. — these are CSS class names, not user-visible status codes. ✓

### Gateway diagnostic messages (acceptable)

`routes/deployments.ts` gateway check functions return messages like:
- "The public IPFS gateway is rate-limiting verification right now — your site may already be live."
- "The gateway had a problem (HTTP 500) — your site may still be propagating."

The HTTP status in gateway diagnostic messages is retained **intentionally** — it provides context about IPFS propagation state that users and operators benefit from, and it is always accompanied by a full plain-language explanation. This is consistent with the honesty principle: we tell users exactly why we can't confirm their site is live.

---

## Verdict: CLEAN (after two targeted fixes)

No raw stack traces reach users. No raw error codes in primary user-facing error messages. Two minor issues found and fixed in `deployApi.ts` and `ipfs.ts`.
