-- Colony Wi-Fi — initial schema migration
-- Mirrors prisma/schema.prisma exactly, plus CHECK constraints that
-- Prisma's schema DSL cannot express directly (marked below).
--
-- NOT YET APPLIED TO ANY DATABASE. This was hand-authored because this
-- sandbox's network policy blocks binaries.prisma.sh, so `prisma migrate
-- dev` could not run here to generate it (see AUDIT.md). Before trusting
-- this migration, run `prisma migrate diff` against it or just run
-- `prisma migrate dev` fresh in an environment with real DB + Prisma
-- engine access and diff the result against this file.

-- ============================================================
-- Enums
-- ============================================================

CREATE TYPE "PaymentStatus" AS ENUM (
  'PENDING', 'SUCCESS', 'FAILED', 'CANCELLED', 'TIMEOUT', 'RECONCILIATION_REQUIRED'
);

CREATE TYPE "PaymentVerificationStatus" AS ENUM (
  'UNVERIFIED', 'VERIFIED', 'VERIFICATION_FAILED'
);

CREATE TYPE "EntitlementStatus" AS ENUM (
  'PENDING_AUTHORIZATION', 'ACTIVE', 'EXPIRED', 'REVOKED', 'AUTHORIZATION_FAILED'
);

CREATE TYPE "SessionStatus" AS ENUM ('ACTIVE', 'ENDED', 'EXPIRED', 'UNKNOWN');

CREATE TYPE "RouterHealthStatus" AS ENUM ('HEALTHY', 'UNHEALTHY', 'UNKNOWN');

CREATE TYPE "RouterEventSeverity" AS ENUM ('INFO', 'WARNING', 'ERROR', 'CRITICAL');

-- ============================================================
-- Tables
-- ============================================================

CREATE TABLE "admins" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "password_hash" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "last_login_at" TIMESTAMP(3),
  CONSTRAINT "admins_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "admins_email_key" ON "admins"("email");

CREATE TABLE "packages" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "price_kes" INTEGER NOT NULL,
  "duration_seconds" INTEGER NOT NULL,
  "bandwidth_down_mbps" INTEGER NOT NULL,
  "bandwidth_up_mbps" INTEGER NOT NULL,
  "data_limit_bytes" BIGINT,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "packages_pkey" PRIMARY KEY ("id"),
  -- Section 7: package price must be non-negative; duration must be positive.
  CONSTRAINT "packages_price_kes_nonnegative" CHECK ("price_kes" >= 0),
  CONSTRAINT "packages_duration_seconds_positive" CHECK ("duration_seconds" > 0),
  CONSTRAINT "packages_bandwidth_down_positive" CHECK ("bandwidth_down_mbps" > 0),
  CONSTRAINT "packages_bandwidth_up_positive" CHECK ("bandwidth_up_mbps" > 0),
  CONSTRAINT "packages_data_limit_positive" CHECK ("data_limit_bytes" IS NULL OR "data_limit_bytes" > 0)
);
CREATE UNIQUE INDEX "packages_name_key" ON "packages"("name");

CREATE TABLE "customers" (
  "id" TEXT NOT NULL,
  "phone_e164" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "last_seen_at" TIMESTAMP(3),
  CONSTRAINT "customers_pkey" PRIMARY KEY ("id"),
  -- Defense in depth: also enforced in application code (src/lib/phone.ts),
  -- but the DB should not accept an obviously malformed phone either.
  CONSTRAINT "customers_phone_format" CHECK ("phone_e164" ~ '^\+254[17]\d{8}$')
);
CREATE UNIQUE INDEX "customers_phone_e164_key" ON "customers"("phone_e164");

CREATE TABLE "payments" (
  "id" TEXT NOT NULL,
  "customer_id" TEXT NOT NULL,
  "package_id" TEXT NOT NULL,
  "amount_kes" INTEGER NOT NULL,
  "phone_e164" TEXT NOT NULL,
  "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
  "merchant_request_id" TEXT,
  "checkout_request_id" TEXT,
  "mpesa_receipt_number" TEXT,
  "transaction_date" TIMESTAMP(3),
  "result_code" INTEGER,
  "result_description" TEXT,
  "callback_received_at" TIMESTAMP(3),
  "verification_status" "PaymentVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
  "idempotency_key" TEXT NOT NULL,
  "callback_metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "payments_pkey" PRIMARY KEY ("id"),
  -- Section 7: payment amount must be non-negative. (Equality to the
  -- server-computed package price at creation time is enforced in
  -- application code — src/lib/payments/createPayment.ts always reads
  -- the price from the package row, never from client input — a DB
  -- CHECK cannot express a cross-table invariant here.)
  CONSTRAINT "payments_amount_kes_nonnegative" CHECK ("amount_kes" >= 0),
  CONSTRAINT "payments_customer_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payments_package_fkey" FOREIGN KEY ("package_id") REFERENCES "packages"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "payments_merchant_request_id_key" ON "payments"("merchant_request_id");
CREATE UNIQUE INDEX "payments_checkout_request_id_key" ON "payments"("checkout_request_id");
CREATE UNIQUE INDEX "payments_mpesa_receipt_number_key" ON "payments"("mpesa_receipt_number");
CREATE UNIQUE INDEX "payments_idempotency_key_key" ON "payments"("idempotency_key");
CREATE INDEX "payments_status_idx" ON "payments"("status");
CREATE INDEX "payments_created_at_idx" ON "payments"("created_at");
CREATE INDEX "payments_customer_id_idx" ON "payments"("customer_id");

CREATE TABLE "entitlements" (
  "id" TEXT NOT NULL,
  "customer_id" TEXT NOT NULL,
  "payment_id" TEXT NOT NULL,
  "package_id" TEXT NOT NULL,
  "starts_at" TIMESTAMP(3) NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "status" "EntitlementStatus" NOT NULL DEFAULT 'PENDING_AUTHORIZATION',
  "authorized_at" TIMESTAMP(3),
  "revoked_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "entitlements_pkey" PRIMARY KEY ("id"),
  -- Section 7: entitlement expiry must be after start.
  CONSTRAINT "entitlements_expiry_after_start" CHECK ("expires_at" > "starts_at"),
  CONSTRAINT "entitlements_customer_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "entitlements_payment_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "entitlements_package_fkey" FOREIGN KEY ("package_id") REFERENCES "packages"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
-- One entitlement per payment (spec section 14: one successful callback
-- -> one entitlement effect, never two). Also closes the race the
-- application-level idempotency guard in engine.ts protects against.
CREATE UNIQUE INDEX "entitlements_payment_id_key" ON "entitlements"("payment_id");
CREATE INDEX "entitlements_customer_id_idx" ON "entitlements"("customer_id");
CREATE INDEX "entitlements_status_idx" ON "entitlements"("status");
CREATE INDEX "entitlements_expires_at_idx" ON "entitlements"("expires_at");

CREATE TABLE "routers" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "management_address" TEXT NOT NULL,
  "api_transport" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "last_health_check_at" TIMESTAMP(3),
  "health_status" "RouterHealthStatus" NOT NULL DEFAULT 'UNKNOWN',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "routers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sessions" (
  "id" TEXT NOT NULL,
  "customer_id" TEXT NOT NULL,
  "entitlement_id" TEXT,
  "router_id" TEXT NOT NULL,
  "mac_address" TEXT,
  "ip_address" TEXT,
  "hotspot_username" TEXT,
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ended_at" TIMESTAMP(3),
  "last_seen_at" TIMESTAMP(3),
  "bytes_in" BIGINT,
  "bytes_out" BIGINT,
  "status" "SessionStatus" NOT NULL DEFAULT 'ACTIVE',
  CONSTRAINT "sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sessions_customer_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "sessions_entitlement_fkey" FOREIGN KEY ("entitlement_id") REFERENCES "entitlements"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "sessions_router_fkey" FOREIGN KEY ("router_id") REFERENCES "routers"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "sessions_customer_id_idx" ON "sessions"("customer_id");
CREATE INDEX "sessions_status_idx" ON "sessions"("status");

CREATE TABLE "router_events" (
  "id" TEXT NOT NULL,
  "router_id" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "severity" "RouterEventSeverity" NOT NULL DEFAULT 'INFO',
  "message" TEXT NOT NULL,
  "correlation_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "router_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "router_events_router_fkey" FOREIGN KEY ("router_id") REFERENCES "routers"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "router_events_router_id_idx" ON "router_events"("router_id");

CREATE TABLE "audit_logs" (
  "id" TEXT NOT NULL,
  "actor" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "resource_type" TEXT NOT NULL,
  "resource_id" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "audit_logs_resource_type_resource_id_idx" ON "audit_logs"("resource_type", "resource_id");
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");
