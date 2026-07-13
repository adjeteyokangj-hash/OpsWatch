-- CreateTable
CREATE TABLE "PlatformStripeSettings" (
    "id" TEXT NOT NULL,
    "secretKeyCiphertext" TEXT,
    "secretKeyIv" TEXT,
    "secretKeyAuthTag" TEXT,
    "webhookSecretCiphertext" TEXT,
    "webhookSecretIv" TEXT,
    "webhookSecretAuthTag" TEXT,
    "publishableKey" TEXT,
    "stripeAccountId" TEXT,
    "apiBase" TEXT NOT NULL DEFAULT 'https://api.stripe.com',
    "mode" TEXT,
    "validationStatus" "IntegrationValidationStatus" NOT NULL DEFAULT 'UNKNOWN',
    "validationMessage" TEXT,
    "validationDetails" JSONB,
    "lastValidatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformStripeSettings_pkey" PRIMARY KEY ("id")
);
