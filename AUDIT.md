# Colony Wi-Fi — Audit

## PHASE A — REPOSITORY AUDIT

### CURRENT STATE

No repository was supplied to this build session. The handout describes
an existing Colony customer portal and admin dashboard (spec section 2),
but no source files, screenshots, or repo link were provided when asked.
This is therefore a **greenfield build**, not a refactor of existing code.
Nothing existing was inspected because nothing existing was reachable —
this is stated plainly rather than assumed away.

### PROBLEMS

Not applicable in the "existing bugs found" sense — there was no existing
code to find bugs in. The relevant problem this audit exists to flag:
building fresh means the four package definitions and general UI
direction from spec section 2 are the *only* continuity with whatever
the operator already has live. If a real existing repo turns up later,
it must be diffed against this build before either is discarded — spec
section 46 is explicit that existing work should be preserved and
improved, not replaced wholesale.

### RISKS

- Building fresh risks diverging from real production behavior the
  operator is already relying on (e.g. an existing admin dashboard's
  exact metric definitions, an existing customer portal's exact copy/
  branding). Mitigated by keeping UI/copy generic and easy to reskin
  rather than inventing a strong existing brand identity to "match."
- See Phase H below for the full risk register on the code itself.

### DEPENDENCIES

Supabase Postgres (not yet provisioned — no `DATABASE_URL` supplied),
Daraja sandbox/production credentials (not supplied), a MikroTik router
(not supplied — see Phase F / BLOCKERS below), Vercel project (not
supplied).

### PLAN

Followed spec section 42's phase order exactly: B (database) -> C
(Daraja) -> D (customer portal) -> E (entitlements) -> F (MikroTik,
blocked) -> G (admin) -> H (this audit). See README.md for what's built.

### BLOCKERS

None that stopped Phase A itself. Phase F (MikroTik) is blocked — see
"Phase F" below — but per spec section 46, work that doesn't depend on
it proceeded rather than halting the whole build.

---

## PHASE H — SECURITY + QA AUDIT

Per spec section 40, answered explicitly and honestly. Where the honest
answer is "not verified" rather than "yes," that's stated as such —
per section 44, "never say complete if only code compilation was tested,"
and in this case even compilation wasn't fully verified (see README.md).

**1. Can a customer pay twice accidentally?**
Mitigated, not eliminated. The frontend generates one `idempotencyKey`
per checkout attempt and reuses it on retry (`src/app/page.tsx`,
`idempotencyKeyRef`). `createPayment()` looks up that key first and
returns the existing payment rather than creating a second one or
firing a second STK push. A genuinely new checkout attempt (new key) for
the same package would still trigger a second real STK push — that's
correct behavior (the customer might legitimately want two packages),
not a bug. **Not verified against a live DB** — the uniqueness
constraint and the P2002-race-handling fallback in `createPayment.ts`
are written but untested.

**2. Can duplicate Daraja callbacks create duplicate access?**
No, by design: `handleDarajaCallback` looks up the payment by
`checkoutRequestId`, and `checkTransition()` treats re-applying the same
status as a no-op (`stateMachine.ts`). `activateOrRenewEntitlement` is
only ever called once per payment because it's inside the transition's
non-no-op branch, and additionally checks for an existing entitlement
row for that `paymentId` (which is DB-unique) before creating one.
**Not verified against a live DB.**

**3. Can a frontend request fake a lower package price?**
No. `createPayment()` reads `pkg.priceKes` from the database and never
reads an amount from the request body at all — the client-supplied
`initiatePaymentSchema` doesn't even have an amount field. The STK push
amount comes from that same server-side value.

**4. Can an expired customer reconnect and regain access?**
Partially answerable. The entitlement engine correctly refuses to treat
an expired entitlement as stackable (`STACKABLE_STATUSES` + `expiresAt
> now` check) and `expireStaleEntitlements()` flips expired rows to
`EXPIRED`. But **whether a customer can actually still use the network**
after expiry is a Phase F (MikroTik) question — nothing currently
revokes network-level access, because nothing currently grants it
either. This is the same documented payment/network separation as
question 5.

**5. Can a successful payment remain successful if MikroTik is offline?**
Yes, correctly. Payment status and entitlement status are deliberately
decoupled from network authorization state (spec section 18). A
`SUCCESS` payment and its entitlement exist and are correct regardless
of MikroTik's availability — the entitlement simply stays
`PENDING_AUTHORIZATION` instead of `ACTIVE` until Phase F exists to move
it forward. Money is never lost or misrecorded because a router is down.

**6. Can access eventually recover after router outage?**
**Unknown — blocked on Phase F.** The data model supports it (an
entitlement's paid time doesn't evaporate while `PENDING_AUTHORIZATION`),
but there is no code yet that retries authorization once a router comes
back, because there is no code yet that performs authorization at all.

**7. Can the backend restart without losing payment state?**
Yes. All payment/entitlement state lives in Postgres, not in server
memory, with one narrow documented exception: the Daraja OAuth token
cache (`src/lib/daraja/auth.ts`) and the in-memory rate limiter
(`src/lib/rateLimit.ts`) are both per-instance memory and reset on
restart — by design, since neither holds anything that would be unsafe
to lose (a fresh token is fetched automatically; rate limit windows
simply restart).

**8. Can a delayed callback activate access correctly?**
Yes, as long as it eventually arrives, or reconciliation resolves it —
`checkTransition` explicitly allows `TIMEOUT -> SUCCESS`. A payment that
timed out on the frontend but later gets a genuine success callback (or
a reconciliation query result) still correctly creates/renews the
entitlement. **Not verified against a live DB or a real delayed Daraja
callback.**

**9. Can an unknown callback corrupt another payment?**
No. `handleDarajaCallback` looks up the payment strictly by
`checkoutRequestId`; if no match is found it logs an
`unknown_transaction` audit entry and returns without touching any row.
There is no fallback "closest match" logic that could misattribute a
callback.

**10. Can an admin access another protected resource?**
Every protected route calls `requireAdmin()` first
(`src/lib/requireAdmin.ts`), which rejects with 401/403 before any data
access if the session is missing/invalid or the role doesn't match.
There are currently only two roles (`SUPER_ADMIN`, `ADMIN`) and no
per-resource ownership model (this is a single-operator system, not
multi-tenant — see "what not to build yet," spec section 41), so
"another admin's resource" isn't yet a meaningful concept. If multi-admin
data partitioning becomes a real need, that's a schema change, not
something silently assumed away here.

**11. Can secrets reach browser JavaScript?**
No secret-bearing env var is prefixed `NEXT_PUBLIC_`, and none of them
are read anywhere under `src/app/**/page.tsx` (client components) —
only inside route handlers and `src/lib/*` server modules. `next.config.js`
carries an explicit comment on this. Not independently verified with a
bundle-content scan (would require an actual `next build`, which needs
the same blocked Prisma engine — see README).

**12. Can router management be reached from the public internet?**
Not applicable yet — no router is configured (Phase F blocked). The
requirement is documented as a hard constraint for whoever builds
Phase F: `src/lib/mikrotik/client.ts`'s header explicitly states the
router's management API must not be exposed directly to the public
internet, and flags that Vercel's serverless functions have no fixed
egress IP, so a real tunnel/VPN design is needed once router topology
is known.

**13. Can the database recover after failure?**
Backup/recovery is Supabase's responsibility at the infrastructure
level (point-in-time recovery is a Supabase project setting, not
something this codebase implements). This codebase's contribution is:
every write that matters is a normal transactional Postgres write with
proper constraints (see migration SQL), so there's nothing
Colony-specific to "recover" beyond what Supabase's own backup
configuration already covers. **Documented, not tested** — no failure
was actually injected.

**14. Are all external calls bounded by timeouts?**
Partially. `/api/health`'s database and Daraja checks are explicitly
timeout-wrapped (`withTimeout`, 3s/5s). The OAuth and STK push/query
calls in `src/lib/daraja/*` use plain `fetch` with no explicit
`AbortController` timeout — they rely on the platform's own request
timeout (Vercel serverless functions have a hard execution limit, which
functions as a backstop, but that's a platform ceiling, not an
intentional per-call timeout). **This is a real, documented gap**, not
a silent one — a hung Daraja request currently blocks a payment
initiation for as long as the platform allows rather than failing fast.

**15. Are retries safe?**
Yes, in the two places retries can happen: Daraja retrying callbacks
(idempotent — no-op on duplicate, see Q2) and the frontend retrying
`/api/payments/initiate` with the same idempotency key (returns the
existing payment, see Q1). The reconciliation sweep itself is bounded
(sequential, not concurrent; minimum-age gate; batch limit) rather than
hammering Daraja — see `src/lib/payments/reconcile.ts`.

**16. Can the operator reconcile payments?**
Yes — `POST /api/admin/payments/:id/reconcile`, wired to a "Reconcile"
button in the admin dashboard for any `PENDING`/`TIMEOUT` payment. Also
runs automatically via `/api/cron/sweep` every 5 minutes.

**17. Can the operator see active sessions and expiry?**
`GET /api/admin/sessions` exists and is wired into the dashboard, but
honestly returns an empty list — nothing currently writes to the
`sessions` table because Phase F doesn't exist yet. This is stated in
the route's own response (`note` field) rather than left silent.
Entitlement expiry *is* visible today via the dashboard's "Active users"
and "Expiring soon" stats.

**18. Can packages be changed without corrupting existing entitlements?**
Price and duration: yes, safely — both are frozen onto the payment/
entitlement row at creation time, not read live. Bandwidth: **no, this
is a real documented gap** — entitlements reference `package_id` rather
than storing a bandwidth snapshot, so editing a package's bandwidth
retroactively changes what a past, still-unexpired entitlement would
appear entitled to if bandwidth is read via that join. Flagged in both
`schema.prisma`'s neighborhood and the PATCH route's comments; not
silently fixed by scope-creeping a schema change into this pass.

**19. Is renewal behaviour deterministic?**
Yes — `calculateEntitlementWindow()` is a pure function
(`src/lib/entitlements/calculateWindow.ts`) with no hidden state, and is
unit-tested for both the "no previous active entitlement" and "stack
onto previous expiry" cases, including an exact 7-day-duration
arithmetic check. **This is one of the few claims in this audit with an
actual passing test behind it**, not just a design description.

**20. Does the complete Wi-Fi -> payment -> internet workflow work?**
**No — not end-to-end, and this must not be understated.** Payment
(Daraja) and entitlement logic are built but never executed against a
live database or a live Daraja sandbox in this session. The MikroTik
leg (the actual "-> internet" part) doesn't exist yet at all. Per spec
section 45's own definition of done, this system is **not done**:
customer portal, entitlement renewal, and admin dashboard are built;
MikroTik authorization, MikroTik-outage handling, and true end-to-end
verification are not.

---

## SUMMARY — spec section 45's definition of done, checked honestly

| Requirement | Status |
|---|---|
| Customer portal works | Built; **not run** |
| Package prices come from database | Yes (code-verified — no other path exists) |
| Payment initiation works | Built; **not run** |
| Daraja callback works | Built; **not run** |
| Duplicate callbacks are safe | Built + logically verified via state machine tests; **not run against a real duplicate callback** |
| Payment status is durable | By construction (Postgres, no in-memory payment state); **not run** |
| Verified payment creates entitlement | Built; **not run** |
| Entitlement renewal works | **Unit-tested and passing** (the one fully verified business-logic claim) |
| Expiry works | Built (`expireStaleEntitlements`); **not run** |
| MikroTik authorization works | **Not built — blocked, no router supplied** |
| MikroTik outage is handled safely | Payment/entitlement side: yes, by design. Network side: not applicable, nothing built yet |
| Backend restart is safe | Yes, by construction (stateless except token cache + rate limiter, both safe to lose) |
| Database failure behaviour documented/tested | Documented only |
| Admin dashboard uses live data | Yes, wired to real routes; **not run** |
| Admin authentication works | Built (bcrypt + JWT + httpOnly cookie); **not run** |
| Secrets protected | Yes by construction (server-only env reads); not independently bundle-scanned |
| Tests pass | **Yes — 36/36, but only for DB-independent pure logic** |
| Production configuration documented | Yes — `.env.example`, README |
| Backups/recovery documented | Yes, at the level of "this is Supabase's job"; not tested |
| Critical workflow tested end-to-end | **No** |

---

## POST-BUILD AUDIT PASS (self-requested re-check)

Two things found and fixed after the initial build, on request to verify
correctness and check for unnecessary complexity:

**Bug fixed — `resolveOutcome.ts` double-validation gap.** The payment
state-transition legality check validated one status (e.g. `SUCCESS`)
but the code could then write a *different* status
(`RECONCILIATION_REQUIRED`, on an amount mismatch) without that second
status being independently checked against the state machine. This
happened to be harmless under the transition table as written — every
path that can reach `SUCCESS` also permits `RECONCILIATION_REQUIRED`,
or the payment was already in that state — but it was a latent bug
waiting for the next person to change the transition table without
noticing this coupling. Fixed by resolving to one true target status
before validating anything, so exactly one status is ever checked and
exactly one is ever written. Re-verified: 36/36 unit tests still pass.

**Over-engineering found and removed — two-tier admin roles.** The
`Admin` model had `SUPER_ADMIN`/`ADMIN` roles, but a full-codebase grep
showed the distinction was checked in exactly two routes and both
allowed the same two roles — a distinction with zero actual behavioral
difference. This is a single-operator system; the two-tier role model
was building for an org structure that doesn't exist. Removed: the
`AdminRole` enum, the `role` column, `hasRole()`, and the role parameter
on `requireAdmin()`. If multi-admin permission tiers become a real need
later, that's a deliberate schema change made at that point, against a
real requirement — not something to keep half-built now on the chance
it's needed. Re-verified against a real local Postgres instance: the
migration re-applies cleanly, and all 12 constraint tests (price,
duration, phone format, expiry ordering, all five unique constraints,
both foreign key directions, enum validity) still pass identically
after the simplification.

**Third-party service surface checked directly** (not just claimed):
`grep`ed the full dependency list and source tree for any of the usual
scope-creep candidates (Redis, Kafka, a separate auth provider, a
logging/APM vendor, cloud SDKs). Found none. The actual list is
Supabase (database), Safaricom Daraja (payments, non-negotiable), and
Vercel (hosting + cron — already the deployment target, not an added
dependency). Seven runtime npm packages total. This matches spec
section 4's instruction not to add infrastructure without evidence of
need, verified rather than assumed.

---

**Conclusion, stated the way spec section 45 demands: this is not DONE.**
It compiles logically (modulo the sandbox's blocked Prisma engine), the
pure business logic is genuinely tested, and the architecture correctly
keeps payment/entitlement state decoupled from the not-yet-built network
layer. But "payment request was sent" is explicitly not payment success,
and nothing here has been run against a real Daraja sandbox or a real
router (though the schema and all its constraints *have* now been run
against a real local Postgres instance — see above). The next real step
is exactly what README.md says: generate the Prisma client somewhere
with network access, run the migration against a real Supabase project,
and exercise the payment flow against Daraja's sandbox before anything
here is trusted with real money.
