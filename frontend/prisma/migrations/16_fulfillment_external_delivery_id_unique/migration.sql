-- Follow-up to 15_phase_fulfillment_engine: the unique index on
-- Delivery.externalDeliveryId (the Vendylio-controlled "vend_<id>" the
-- provider sees). It is an idempotency backstop for dispatch + the lookup key
-- for webhook / poll correlation. Split into its own migration only because
-- it was omitted from 15's SQL.
CREATE UNIQUE INDEX "Delivery_externalDeliveryId_key" ON "Delivery"("externalDeliveryId");
