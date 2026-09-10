# Colony Wi-Fi Selling System

Sell Wi-Fi access through a MikroTik captive portal using Safaricom M-Pesa (Daraja).

**Stack:** Next.js 16.3.4 (App Router, TypeScript) · Supabase Postgres via Prisma · Daraja API · Vercel

**A note on the Next.js version, because this changed mid-build and the reasoning matters:** this project was originally built against Next 14. It was then briefly, incorrectly reverted back to 14 after an `npm audit fix --force` accidentally jumped it to 16. That revert was a mistake: Vercel has publicly stated patches are not planned for the 13.x/14.x line going forward, so staying on 14 would have permanently locked in unpatched CVEs (including two critical ones — RCE on Windows-hosted servers, RCE via AVIF image optimization — both fixed in the 16.x line) in an app that moves real M-Pesa money. The correct fix was to move forward deliberately: pin exact versions (`next@16.3.4`, `eslint-config-next@16.3.4`, `eslint@^9`, `vitest@5.0.0`, `@types/node@^22`), resolve the resulting peer-dependency chain by hand rather than with `--force`, and fix the one real breaking change that affected this codebase — dynamic route `params` becoming a `Promise` in route handlers (Next 15+). All three affected routes (`/api/payments/[id]/status`, `/api/admin/packages/[id]`, `/api/admin/payments/[id]/reconcile`) were updated and re-verified: 36/36 unit tests still pass, `next dev` boots cleanly under Turbopack, and no new type errors were introduced (the only remaining `tsc` errors are the pre-existing Prisma-client-not-generated gap — see Verification status below). React stays on 18.3.1: Next 16 still supports it (deprecated, not removed; React 19 becomes mandatory in Next 17).

**Rule going forward: never run `npm audit fix --force`.** It ignores semver boundaries and force-upgrades to whatever satisfies the advisories, breaking changes or not — that's exactly how this project ended up on 16 in the first place, unreviewed. If `npm audit` (without `--force`) flags something, evaluate it individually: most flagged vulnerabilities in `vitest`/`vite`/`esbuild`/`glob` are scoped to local dev tooling (test runners, lint plugin internals) that never ships to production, not the deployed app — check what's actually reachable before treating every line as equally urgent.

**Read `AUDIT.md` first.** It contains the Phase A repository audit, the Phase H
security/QA answers, and an honest account of what is and isn't verified.
This README is setup instructions, not a completeness claim.

---

## What's built vs. blocked

| Phase | Status |
|---|---|
| A — Repository audit | Done (see AUDIT.md) — no prior repo existed; this is a greenfield build |
| B — Database | Built. **Not run against a real database** (see Verification below) |
| C — Daraja (OAuth, STK push, callback, idempotency, state machine, reconciliation) | Built. STK push/callback paths verified against current public Daraja documentation; not exercised against the live sandbox |
| D — Customer portal | Built, wired to real API calls. No fake success states |
| E — Entitlement engine | Built (activation, stacking renewal, expiry sweep) |
| F — MikroTik | **Blocked.** No router was supplied. `src/lib/mikrotik/client.ts` is a typed stub that throws `NotImplementedError` on every real method — see that file's header for exactly what's needed to unblock it |
| G — Admin dashboard | Built, wired to real data. Sessions list is honestly empty (nothing writes to it until Phase F exists) |
| H — Security + QA | See AUDIT.md section "Phase H" for the 20-question audit |

---

## Verification status (important — read this)

This sandbox's network policy blocks `binaries.prisma.sh`, so `prisma generate`
could never run here. That means:

- **36 unit tests pass** (`npm test`) — phone normalization, the payment
  state machine, the entitlement stacking formula, and Daraja callback/
  timestamp parsing are all genuinely exercised, not just written.
- **Nothing that touches the database has been run.** Not the schema, not
  the migration SQL, not `createPayment`/`handleCallback`/the entitlement
  engine's DB-writing paths.
- `tsc --noEmit` fails, but only on imports of Prisma-generated types
  (`PaymentStatus`, `AdminRole`, etc.) that don't exist yet because
  `generate` never ran. Every one of those imports matches a real export
  in `prisma/schema.prisma` — this was checked by hand.

**Before you trust this in production**, in an environment with real
network access:

```bash
npm install
npx prisma generate
npx prisma validate
npm run typecheck   # should now be clean
npm test             # should still be 36/36
```

Then point `DATABASE_URL`/`DIRECT_URL` at a real Supabase project and either:
- run `npx prisma migrate dev` fresh and diff the result against
  `prisma/migrations/20260902000000_init/migration.sql` (recommended —
  this confirms the hand-authored migration is actually correct), or
- apply the hand-authored migration directly with `npx prisma migrate deploy`
  and then `npx prisma db pull` to confirm it matches `schema.prisma`.

---

## Local setup

```bash
npm install
cp .env.example .env.local   # fill in real values
npx prisma generate
npx prisma migrate deploy    # applies prisma/migrations/20260902000000_init
npm run prisma:seed          # seeds the 4 packages + first admin
npm run dev
```

Required env vars are documented inline in `.env.example`. Notably:

- `DATABASE_URL` / `DIRECT_URL` — Supabase pooled + direct connection strings
- `DARAJA_*` — sandbox first, always. Never mix sandbox and production credentials
- `ADMIN_JWT_SECRET` — `openssl rand -base64 48`
- `ADMIN_SEED_EMAIL` / `ADMIN_SEED_PASSWORD` — used once by the seed script,
  then remove `ADMIN_SEED_PASSWORD` from the environment
- `CRON_SECRET` — `openssl rand -base64 32`, used by `/api/cron/sweep`

## Daraja callback URL

Daraja needs a public HTTPS URL to POST callbacks to
(`DARAJA_CALLBACK_URL`). Locally this means a tunnel (ngrok or similar)
pointed at `POST /api/payments/daraja/callback`. In production, this is
your Vercel deployment URL.

## Deploying to Vercel

1. Push this repo, import it into Vercel.
2. Set all env vars from `.env.example` in the Vercel project settings
   (Production and Preview separately if you want sandbox-in-preview).
3. `vercel.json` already configures the reconciliation/expiry cron
   (`/api/cron/sweep`, every 5 minutes) — Vercel Cron sends `CRON_SECRET`
   automatically as a Bearer token once it's set as an env var.
4. Run `npx prisma migrate deploy` against production `DATABASE_URL`
   before first traffic (either from CI or locally against the prod URL).

## Admin access

`/admin/login` → `/admin/dashboard`. First admin account comes from the
seed script (`ADMIN_SEED_EMAIL`/`ADMIN_SEED_PASSWORD`). There is no
self-serve admin signup by design — create additional admins directly
in the database (or build an "invite admin" flow later; deliberately
not built now per spec section 41's "don't build ahead of need").

Note: admin page-level route protection is enforced by each API route
checking the session server-side (`src/lib/requireAdmin.ts`), not by
Next.js middleware. `jsonwebtoken` (used for admin session signing) is
not Edge-runtime compatible, and Next.js middleware runs on the Edge
runtime by default — adding middleware here would have meant either
silently broken JWT verification or pulling in a second, unverified JWT
library mid-build. The dashboard page does its own client-side redirect
on a 401, which is UX, not the security boundary; the security boundary
is the server-side check on every admin API route.

## MikroTik — what's needed to unblock Phase F

See the header comment in `src/lib/mikrotik/client.ts` for the exact
list of router details required (model, RouterOS version, interface/
IP/hotspot/firewall config) and the network-topology question that
needs answering first: Vercel's serverless functions have no fixed
egress IP by default, so reaching a LAN-only router needs a deliberate
tunnel/VPN/reverse-proxy design once the router's real topology is known.
Never send router passwords in chat — see spec section 43.

## Tests

```bash
npm test
```

36 tests covering phone normalization, the payment state machine
(including that SUCCESS/FAILED/CANCELLED can never be silently
downgraded), the entitlement stacking formula, and Daraja callback/
timestamp parsing. See "Verification status" above for what is and
isn't covered — DB-touching code has no automated tests yet because
this sandbox has no live Postgres to test against.
