-- Authorized removal of POS catalog and invoice snapshot dimensions.
ALTER TABLE "POSProductVariant" DROP COLUMN IF EXISTS "size", DROP COLUMN IF EXISTS "color";
ALTER TABLE "POSSaleItem" DROP COLUMN IF EXISTS "size", DROP COLUMN IF EXISTS "color";
