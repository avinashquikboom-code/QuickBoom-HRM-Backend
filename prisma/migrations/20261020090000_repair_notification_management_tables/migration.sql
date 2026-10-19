-- Restore the two tables defined by 0_init without replaying the baseline.
-- A failed migration ledger must be investigated separately before migrate deploy.
-- No existing rows, tables or migration records are removed or modified.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public."NotificationRule" (
    "id" SERIAL NOT NULL,
    "event" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "recipients" TEXT[],
    "inApp" BOOLEAN NOT NULL DEFAULT true,
    "push" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS public."NotificationTemplate" (
    "id" SERIAL NOT NULL,
    "event" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'PUSH',
    "language" TEXT NOT NULL DEFAULT 'English',
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationTemplate_pkey" PRIMARY KEY ("id")
);


CREATE UNIQUE INDEX IF NOT EXISTS "NotificationRule_event_key" ON public."NotificationRule"("event");
CREATE UNIQUE INDEX IF NOT EXISTS "NotificationTemplate_event_key" ON public."NotificationTemplate"("event");

COMMIT;
