-- Add optional opening notes to POSSession
ALTER TABLE "POSSession" ADD COLUMN IF NOT EXISTS "openingNotes" TEXT;
