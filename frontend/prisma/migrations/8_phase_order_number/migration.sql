-- Phase 6 — human-friendly Order.orderNumber.
--
-- A Postgres sequence default. `ADD COLUMN ... DEFAULT nextval(...)` on a
-- populated table rewrites it once, assigning every existing order a
-- distinct sequential value (oldest first is not guaranteed, but uniqueness
-- is) — so historical orders get a number too. New inserts get the next
-- value automatically; nothing in application code sets this column.

-- CreateSequence
CREATE SEQUENCE "Order_orderNumber_seq";

-- AlterTable
ALTER TABLE "Order"
  ADD COLUMN "orderNumber" INTEGER NOT NULL DEFAULT nextval('"Order_orderNumber_seq"');

-- Tie the sequence's lifecycle to the column
ALTER SEQUENCE "Order_orderNumber_seq" OWNED BY "Order"."orderNumber";

-- CreateIndex
CREATE UNIQUE INDEX "Order_orderNumber_key" ON "Order"("orderNumber");
