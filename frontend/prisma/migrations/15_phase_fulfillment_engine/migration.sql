-- Prompt #12 — Delivery & Fulfillment Engine.
-- All additive: new nullable / defaulted columns on Delivery / Order / Store,
-- two new tables (DeliveryEvent, Quote). Legacy Delivery.status / .provider
-- are kept and dual-written; a later migration drops them.

-- 1. Delivery -> normalized fulfillment model -------------------------------
ALTER TABLE "Delivery"
  ADD COLUMN "state"              TEXT NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "providerType"       TEXT,
  ADD COLUMN "externalDeliveryId" TEXT,
  ADD COLUMN "quoteId"            TEXT,
  ADD COLUMN "providerQuoteId"    TEXT,
  ADD COLUMN "quotedFeeCents"     INTEGER,
  ADD COLUMN "feeCents"           INTEGER,
  ADD COLUMN "providerCostCents"  INTEGER,
  ADD COLUMN "currency"           TEXT NOT NULL DEFAULT 'USD',
  ADD COLUMN "quoteExpiresAt"     TIMESTAMP(3),
  ADD COLUMN "estimatedPickupAt"  TIMESTAMP(3),
  ADD COLUMN "estimatedDropoffAt" TIMESTAMP(3),
  ADD COLUMN "dispatchedAt"       TIMESTAMP(3),
  ADD COLUMN "pickedUpAt"         TIMESTAMP(3),
  ADD COLUMN "cancelledAt"        TIMESTAMP(3),
  ADD COLUMN "cancelReason"       TEXT,
  ADD COLUMN "lastProviderStatus" TEXT,
  ADD COLUMN "attemptCount"       INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "failureReason"      TEXT;

CREATE INDEX "Delivery_state_idx" ON "Delivery"("state");

-- Backfill the engine columns from the legacy pair for any pre-existing rows.
UPDATE "Delivery" SET "state" = CASE "status"
  WHEN 'DELIVERED' THEN 'DELIVERED'
  WHEN 'FAILED'    THEN 'FAILED'
  ELSE 'REQUESTED' END;
UPDATE "Delivery" SET "providerType" = CASE "provider"
  WHEN 'uber_direct' THEN 'UBER_DIRECT'
  ELSE 'MERCHANT' END;
UPDATE "Delivery" SET "feeCents" =
  (SELECT o."deliveryFeeCents" FROM "Order" o WHERE o."id" = "Delivery"."orderId");

-- 2. DeliveryEvent — append-only history + webhook/poll idempotency gate ----
CREATE TABLE "DeliveryEvent" (
  "id"              TEXT NOT NULL,
  "deliveryId"      TEXT NOT NULL,
  "state"           TEXT NOT NULL,
  "providerStatus"  TEXT,
  "providerEventId" TEXT,
  "source"          TEXT NOT NULL,
  "payload"         JSONB,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DeliveryEvent_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "DeliveryEvent"
  ADD CONSTRAINT "DeliveryEvent_deliveryId_fkey"
  FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE UNIQUE INDEX "DeliveryEvent_deliveryId_providerEventId_key"
  ON "DeliveryEvent"("deliveryId", "providerEventId");
CREATE INDEX "DeliveryEvent_deliveryId_createdAt_idx"
  ON "DeliveryEvent"("deliveryId", "createdAt");

-- 3. Quote — persisted checkout quotes -------------------------------------
CREATE TABLE "Quote" (
  "id"                 TEXT NOT NULL,
  "batchId"            TEXT NOT NULL,
  "storeId"            TEXT NOT NULL,
  "providerType"       TEXT NOT NULL,
  "serviceable"        BOOLEAN NOT NULL DEFAULT true,
  "feeCents"           INTEGER NOT NULL,
  "currency"           TEXT NOT NULL DEFAULT 'USD',
  "providerQuoteId"    TEXT,
  "providerCostCents"  INTEGER,
  "estimatedPickupAt"  TIMESTAMP(3),
  "estimatedDropoffAt" TIMESTAMP(3),
  "expiresAt"          TIMESTAMP(3),
  "subtotalCents"      INTEGER NOT NULL,
  "dropoffAddressHash" TEXT NOT NULL,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "Quote"
  ADD CONSTRAINT "Quote_storeId_fkey"
  FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "Quote_batchId_idx" ON "Quote"("batchId");
CREATE INDEX "Quote_expiresAt_idx" ON "Quote"("expiresAt");

-- 4. Store — per-method fulfillment config + country ----------------------
ALTER TABLE "Store"
  ADD COLUMN "fulfillmentConfig" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "country"           TEXT NOT NULL DEFAULT 'US';

UPDATE "Store" SET "fulfillmentConfig" = jsonb_build_object(
  'pickup',     jsonb_build_object('enabled', true, 'instructions', NULL),
  'merchant',   jsonb_build_object(
                  'enabled', ("deliveryProvider" <> 'uber_direct'),
                  'feeCents', "deliveryFeeCents",
                  'minOrderCents', 0,
                  'instructions', NULL),
  'uberDirect', jsonb_build_object('enabled', ("deliveryProvider" = 'uber_direct')),
  'doordash',   jsonb_build_object('enabled', false),
  'customerChoosesProvider', false
);

-- 5. Order — chosen provider + quote snapshot ----------------------------
ALTER TABLE "Order"
  ADD COLUMN "deliveryProviderType"   TEXT,
  ADD COLUMN "deliveryQuoteId"        TEXT,
  ADD COLUMN "providerQuoteId"        TEXT,
  ADD COLUMN "deliveryQuoteExpiresAt" TIMESTAMP(3),
  ADD COLUMN "providerCostCents"      INTEGER;
