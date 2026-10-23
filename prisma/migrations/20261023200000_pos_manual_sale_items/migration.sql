/* Manual POS billing: a sale item may exist without a catalog variant.
   Catalog items keep the NOT NULL behaviour inside the application layer. */
ALTER TABLE "POSSaleItem" ALTER COLUMN "variantId" DROP NOT NULL;
