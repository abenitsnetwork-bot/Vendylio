-- Baseline migration — squashed 2026-09-02.
--
-- The original 26 migrations (0_init … 26_withdrawal_statement, archived under
-- prisma/migrations-archive/) could NOT recreate the database from empty: the
-- Store / Product / Customer / Review / Delivery / ProductVariant tables were
-- created by an early `prisma db push` and never captured in a migration, and
-- the unpadded folder names sorted 10_ before 2_ in shadow-DB replay.
--
-- This file is `prisma migrate diff --from-empty --to-schema-datamodel` of the
-- live schema, so it is now the single source of truth. The live databases
-- (dev + prod share ep-wandering-block-a6z7v46o) were re-baselined with
-- `migrate resolve --applied 00000000000000_baseline` — see
-- prisma/migrations-archive/BASELINE-RUNBOOK.md.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "emailVerifiedAt" TIMESTAMP(3),
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "withdrawalPinHash" TEXT,
    "name" TEXT,
    "avatarUrl" TEXT,
    "role" TEXT NOT NULL DEFAULT 'USER',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminAction" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "metadata" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteImage" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "altText" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegalDocument" (
    "slug" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "LegalDocument_pkey" PRIMARY KEY ("slug")
);

-- CreateTable
CREATE TABLE "Testimonial" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "location" TEXT,
    "detail" TEXT,
    "quote" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "rating" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Testimonial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamInvite" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',
    "token" TEXT NOT NULL,
    "invitedByUserId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),

    CONSTRAINT "TeamInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationMember" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganizationMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OAuthAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refreshToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OAuthAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationCode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificationCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FileUpload" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "key" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FileUpload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailJob" (
    "id" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "html" TEXT NOT NULL,
    "text" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "scheduledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB,
    "dedupeKey" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationPreferences" (
    "userId" TEXT NOT NULL,
    "prefs" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationPreferences_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "OutboxEvent" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "scheduledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookLog" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "orderNumber" SERIAL NOT NULL,
    "trackingToken" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "userId" TEXT,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "subtotalCents" INTEGER NOT NULL,
    "deliveryFeeCents" INTEGER NOT NULL DEFAULT 0,
    "taxCents" INTEGER NOT NULL DEFAULT 0,
    "discountCode" TEXT,
    "discountCents" INTEGER NOT NULL DEFAULT 0,
    "fulfillmentMethod" TEXT NOT NULL DEFAULT 'DELIVERY',
    "deliveryProviderType" TEXT,
    "deliveryQuoteId" TEXT,
    "providerQuoteId" TEXT,
    "deliveryQuoteExpiresAt" TIMESTAMP(3),
    "providerCostCents" INTEGER,
    "customerEmail" TEXT,
    "customerPhone" TEXT,
    "customerName" TEXT,
    "deliveryAddress" JSONB,
    "lineItems" JSONB NOT NULL,
    "idempotencyKey" TEXT,
    "idempotencyBodyHash" TEXT,
    "provider" TEXT NOT NULL,
    "providerChargeId" TEXT,
    "paymentUrl" TEXT,
    "paymentMethod" TEXT,
    "commissionAmount" INTEGER,
    "netAmount" INTEGER,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionCharge" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" TEXT NOT NULL DEFAULT 'OWED',
    "kind" TEXT NOT NULL DEFAULT 'SALE',
    "settledByWithdrawalId" TEXT,
    "stripeInvoiceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "CommissionCharge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderStatusEvent" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderStatusEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Delivery" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerDeliveryId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "trackingUrl" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "state" TEXT NOT NULL DEFAULT 'PENDING',
    "providerType" TEXT,
    "externalDeliveryId" TEXT,
    "quoteId" TEXT,
    "providerQuoteId" TEXT,
    "quotedFeeCents" INTEGER,
    "feeCents" INTEGER,
    "providerCostCents" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "quoteExpiresAt" TIMESTAMP(3),
    "estimatedPickupAt" TIMESTAMP(3),
    "estimatedDropoffAt" TIMESTAMP(3),
    "dispatchedAt" TIMESTAMP(3),
    "pickedUpAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "lastProviderStatus" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Delivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryEvent" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "providerStatus" TEXT,
    "providerEventId" TEXT,
    "source" TEXT NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quote" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "providerType" TEXT NOT NULL,
    "serviceable" BOOLEAN NOT NULL DEFAULT true,
    "feeCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "providerQuoteId" TEXT,
    "providerCostCents" INTEGER,
    "estimatedPickupAt" TIMESTAMP(3),
    "estimatedDropoffAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "subtotalCents" INTEGER NOT NULL,
    "dropoffAddressHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Review" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "text" TEXT,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "name" TEXT,
    "address" JSONB,
    "totalSpentCents" INTEGER NOT NULL DEFAULT 0,
    "ordersCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Store" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "city" TEXT,
    "state" TEXT,
    "logoUrl" TEXT,
    "phone" TEXT,
    "template" TEXT NOT NULL DEFAULT 'MODERN',
    "published" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "stripeAccountId" TEXT,
    "stripeOnboardingStatus" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "cashAppCashtag" TEXT,
    "zelleContact" TEXT,
    "deliveryProvider" TEXT NOT NULL DEFAULT 'self_manual',
    "deliveryFeeCents" INTEGER NOT NULL DEFAULT 0,
    "pickupAddress" TEXT,
    "fulfillmentConfig" JSONB NOT NULL DEFAULT '{}',
    "country" TEXT NOT NULL DEFAULT 'US',
    "plan" TEXT NOT NULL DEFAULT 'FREE',
    "defaultLowStockThreshold" INTEGER NOT NULL DEFAULT 3,
    "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "ordersPaused" BOOLEAN NOT NULL DEFAULT false,
    "pauseMessage" TEXT,
    "hours" JSONB NOT NULL DEFAULT '[]',
    "heroImages" JSONB NOT NULL DEFAULT '[]',
    "heroHeadline" TEXT,
    "heroSubhead" TEXT,
    "announcement" TEXT,
    "termsAcceptedAt" TIMESTAMP(3),
    "termsVersion" TEXT,
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "subscriptionStatus" TEXT,
    "subscriptionCurrentPeriodEnd" TIMESTAMP(3),
    "subscriptionInterval" TEXT,
    "planSource" TEXT,
    "planCompExpiresAt" TIMESTAMP(3),
    "customDomain" TEXT,
    "customDomainStatus" TEXT NOT NULL DEFAULT 'NONE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Store_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Discount" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'FREE_DELIVERY',
    "percentOff" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "minSubtotalCents" INTEGER NOT NULL DEFAULT 0,
    "maxRedemptions" INTEGER,
    "redemptionCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Discount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "icon" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "priceCents" INTEGER NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "categoryId" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'UNIT',
    "imageUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "lowStockThreshold" INTEGER,
    "lowStockNotifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductVariant" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "priceDeltaCents" INTEGER NOT NULL DEFAULT 0,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lowStockNotifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "delta" DOUBLE PRECISION NOT NULL,
    "resultingQuantity" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "orderId" TEXT,
    "actorType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Withdrawal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "destination" JSONB NOT NULL,
    "provider" TEXT NOT NULL,
    "providerPayoutId" TEXT,
    "failureReason" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "commissionSettledCents" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Withdrawal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WithdrawalStatement" (
    "id" TEXT NOT NULL,
    "withdrawalId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "periodFrom" TIMESTAMP(3) NOT NULL,
    "periodTo" TIMESTAMP(3) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "data" JSONB NOT NULL,
    "grossSalesCents" INTEGER NOT NULL,
    "totalDeductionsCents" INTEGER NOT NULL,
    "netPayableCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WithdrawalStatement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessLead" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "storeName" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusinessLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "commissionRateBp" INTEGER NOT NULL DEFAULT 0,
    "commissionRateBpPro" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StorefrontDayStat" (
    "storeId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "storeViews" INTEGER NOT NULL DEFAULT 0,
    "productViews" INTEGER NOT NULL DEFAULT 0,
    "visitors" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "StorefrontDayStat_pkey" PRIMARY KEY ("storeId","day")
);

-- CreateTable
CREATE TABLE "ProductViewDayStat" (
    "storeId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProductViewDayStat_pkey" PRIMARY KEY ("productId","day")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "User_status_idx" ON "User"("status");

-- CreateIndex
CREATE INDEX "AdminAction_actorId_createdAt_idx" ON "AdminAction"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "AdminAction_action_createdAt_idx" ON "AdminAction"("action", "createdAt");

-- CreateIndex
CREATE INDEX "AdminAction_targetType_targetId_idx" ON "AdminAction"("targetType", "targetId");

-- CreateIndex
CREATE UNIQUE INDEX "SiteImage_key_key" ON "SiteImage"("key");

-- CreateIndex
CREATE INDEX "Testimonial_visible_sortOrder_idx" ON "Testimonial"("visible", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE INDEX "Organization_ownerId_idx" ON "Organization"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamInvite_token_key" ON "TeamInvite"("token");

-- CreateIndex
CREATE INDEX "TeamInvite_organizationId_idx" ON "TeamInvite"("organizationId");

-- CreateIndex
CREATE INDEX "TeamInvite_email_idx" ON "TeamInvite"("email");

-- CreateIndex
CREATE INDEX "OrganizationMember_userId_idx" ON "OrganizationMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationMember_organizationId_userId_key" ON "OrganizationMember"("organizationId", "userId");

-- CreateIndex
CREATE INDEX "OAuthAccount_userId_idx" ON "OAuthAccount"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "OAuthAccount_provider_providerAccountId_key" ON "OAuthAccount"("provider", "providerAccountId");

-- CreateIndex
CREATE INDEX "VerificationCode_userId_type_idx" ON "VerificationCode"("userId", "type");

-- CreateIndex
CREATE INDEX "VerificationCode_code_type_idx" ON "VerificationCode"("code", "type");

-- CreateIndex
CREATE UNIQUE INDEX "FileUpload_key_key" ON "FileUpload"("key");

-- CreateIndex
CREATE INDEX "FileUpload_userId_idx" ON "FileUpload"("userId");

-- CreateIndex
CREATE INDEX "FileUpload_createdAt_idx" ON "FileUpload"("createdAt");

-- CreateIndex
CREATE INDEX "EmailJob_status_scheduledAt_idx" ON "EmailJob"("status", "scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_dedupeKey_key" ON "Notification"("dedupeKey");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "OutboxEvent_status_scheduledAt_idx" ON "OutboxEvent"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "WebhookLog_provider_createdAt_idx" ON "WebhookLog"("provider", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookLog_externalId_eventType_key" ON "WebhookLog"("externalId", "eventType");

-- CreateIndex
CREATE UNIQUE INDEX "Order_orderNumber_key" ON "Order"("orderNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Order_trackingToken_key" ON "Order"("trackingToken");

-- CreateIndex
CREATE UNIQUE INDEX "Order_idempotencyKey_key" ON "Order"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Order_providerChargeId_key" ON "Order"("providerChargeId");

-- CreateIndex
CREATE INDEX "Order_storeId_createdAt_idx" ON "Order"("storeId", "createdAt");

-- CreateIndex
CREATE INDEX "Order_userId_createdAt_idx" ON "Order"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Order_status_expiresAt_idx" ON "Order"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "Order_provider_providerChargeId_idx" ON "Order"("provider", "providerChargeId");

-- CreateIndex
CREATE INDEX "CommissionCharge_storeId_status_idx" ON "CommissionCharge"("storeId", "status");

-- CreateIndex
CREATE INDEX "CommissionCharge_stripeInvoiceId_idx" ON "CommissionCharge"("stripeInvoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "CommissionCharge_orderId_kind_key" ON "CommissionCharge"("orderId", "kind");

-- CreateIndex
CREATE INDEX "OrderStatusEvent_orderId_createdAt_idx" ON "OrderStatusEvent"("orderId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Delivery_orderId_key" ON "Delivery"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "Delivery_externalDeliveryId_key" ON "Delivery"("externalDeliveryId");

-- CreateIndex
CREATE INDEX "Delivery_state_idx" ON "Delivery"("state");

-- CreateIndex
CREATE INDEX "DeliveryEvent_deliveryId_createdAt_idx" ON "DeliveryEvent"("deliveryId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryEvent_deliveryId_providerEventId_key" ON "DeliveryEvent"("deliveryId", "providerEventId");

-- CreateIndex
CREATE INDEX "Quote_batchId_idx" ON "Quote"("batchId");

-- CreateIndex
CREATE INDEX "Quote_expiresAt_idx" ON "Quote"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Review_orderId_key" ON "Review"("orderId");

-- CreateIndex
CREATE INDEX "Review_storeId_visible_createdAt_idx" ON "Review"("storeId", "visible", "createdAt");

-- CreateIndex
CREATE INDEX "Customer_storeId_createdAt_idx" ON "Customer"("storeId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_storeId_email_key" ON "Customer"("storeId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_storeId_phone_key" ON "Customer"("storeId", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "Store_organizationId_key" ON "Store"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Store_slug_key" ON "Store"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Store_stripeAccountId_key" ON "Store"("stripeAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Store_stripeCustomerId_key" ON "Store"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "Store_stripeSubscriptionId_key" ON "Store"("stripeSubscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "Store_customDomain_key" ON "Store"("customDomain");

-- CreateIndex
CREATE INDEX "Discount_storeId_idx" ON "Discount"("storeId");

-- CreateIndex
CREATE UNIQUE INDEX "Discount_storeId_code_key" ON "Discount"("storeId", "code");

-- CreateIndex
CREATE INDEX "Category_storeId_sortOrder_idx" ON "Category"("storeId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "Category_storeId_slug_key" ON "Category"("storeId", "slug");

-- CreateIndex
CREATE INDEX "Product_storeId_createdAt_idx" ON "Product"("storeId", "createdAt");

-- CreateIndex
CREATE INDEX "Product_storeId_categoryId_idx" ON "Product"("storeId", "categoryId");

-- CreateIndex
CREATE INDEX "ProductVariant_productId_idx" ON "ProductVariant"("productId");

-- CreateIndex
CREATE INDEX "StockMovement_storeId_createdAt_idx" ON "StockMovement"("storeId", "createdAt");

-- CreateIndex
CREATE INDEX "StockMovement_productId_createdAt_idx" ON "StockMovement"("productId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Withdrawal_providerPayoutId_key" ON "Withdrawal"("providerPayoutId");

-- CreateIndex
CREATE INDEX "Withdrawal_userId_requestedAt_idx" ON "Withdrawal"("userId", "requestedAt");

-- CreateIndex
CREATE INDEX "Withdrawal_status_requestedAt_idx" ON "Withdrawal"("status", "requestedAt");

-- CreateIndex
CREATE INDEX "Withdrawal_provider_providerPayoutId_idx" ON "Withdrawal"("provider", "providerPayoutId");

-- CreateIndex
CREATE UNIQUE INDEX "WithdrawalStatement_withdrawalId_key" ON "WithdrawalStatement"("withdrawalId");

-- CreateIndex
CREATE INDEX "WithdrawalStatement_storeId_createdAt_idx" ON "WithdrawalStatement"("storeId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessLead_email_key" ON "BusinessLead"("email");

-- CreateIndex
CREATE INDEX "ProductViewDayStat_storeId_day_idx" ON "ProductViewDayStat"("storeId", "day");

-- AddForeignKey
ALTER TABLE "AdminAction" ADD CONSTRAINT "AdminAction_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamInvite" ADD CONSTRAINT "TeamInvite_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationMember" ADD CONSTRAINT "OrganizationMember_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationMember" ADD CONSTRAINT "OrganizationMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OAuthAccount" ADD CONSTRAINT "OAuthAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationCode" ADD CONSTRAINT "VerificationCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileUpload" ADD CONSTRAINT "FileUpload_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationPreferences" ADD CONSTRAINT "NotificationPreferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionCharge" ADD CONSTRAINT "CommissionCharge_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionCharge" ADD CONSTRAINT "CommissionCharge_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderStatusEvent" ADD CONSTRAINT "OrderStatusEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryEvent" ADD CONSTRAINT "DeliveryEvent_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Store" ADD CONSTRAINT "Store_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Discount" ADD CONSTRAINT "Discount_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Withdrawal" ADD CONSTRAINT "Withdrawal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WithdrawalStatement" ADD CONSTRAINT "WithdrawalStatement_withdrawalId_fkey" FOREIGN KEY ("withdrawalId") REFERENCES "Withdrawal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WithdrawalStatement" ADD CONSTRAINT "WithdrawalStatement_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StorefrontDayStat" ADD CONSTRAINT "StorefrontDayStat_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductViewDayStat" ADD CONSTRAINT "ProductViewDayStat_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductViewDayStat" ADD CONSTRAINT "ProductViewDayStat_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

