import { Prisma } from '@prisma/client';
import { NormalizedLine, requireValue } from './normalize';

const uuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

/** Resolve only persisted identities. Never equate names/slugs with catalog keys. */
export async function resolveSubcategory(tx: Prisma.TransactionClient, line: NormalizedLine, at: Date) {
  if (line.subcategoryExternalId) {
    const supplied=await tx.hrmCommissionSubcategory.findUnique({where:{externalId:line.subcategoryExternalId}})
      ?? (uuid(line.subcategoryExternalId)?await tx.hrmCommissionSubcategory.findUnique({where:{id:line.subcategoryExternalId}}):null);
    if(supplied) return supplied;
  }
  if (line.subcategoryName && tx.hrmCommissionSubcategory?.findFirst) {
    const byName = await tx.hrmCommissionSubcategory.findFirst({
      where: { name: { equals: line.subcategoryName, mode: 'insensitive' } }
    });
    if (byName) return byName;
  }
  if (line.categoryExternalId && tx.hrmCommissionSubcategory?.findFirst) {
    const byCat = await tx.hrmCommissionSubcategory.findFirst({
      where: { categoryExternalId: line.categoryExternalId }
    });
    if (byCat) return byCat;
  }
  const mapped = async (products: string[], variants: string[]) => {
    for (const variantId of [...new Set(variants)]) for (const productId of [...new Set(products)]) {
      const mapping = await tx.hrmCommissionMapping.findFirst({
        where:{productId,variantId,effectiveFrom:{lte:at}},orderBy:{effectiveFrom:'desc'},
      });
      if (mapping) return tx.hrmCommissionSubcategory.findUnique({where:{id:mapping.subcategoryId}});
    }
    return null;
  };
  const exact = await mapped([line.productId], [line.variantId]);
  if (exact) return exact;
  const externalId = /^\d+$/.test(line.productId) ? Number(line.productId) : null;
  let product;
  if (uuid(line.productId)) {
    product = await tx.pOSProduct.findUnique({where:{id:line.productId},include:{category:true}});
  } else if (Number.isSafeInteger(externalId) && externalId! <= 2147483647) {
    const products = await tx.pOSProduct.findMany({where:{externalCommissionProductId:externalId!},include:{category:true},take:2});
    if (products.length > 1) return null;
    product = products[0];
  }
  const variants = line.variantId ? [line.variantId] : [];
  if (product && line.variantId && tx.pOSProductVariant?.findMany) {
    // UUID/SKU/barcode aliases are accepted only through the same persisted product.
    const matches = await tx.pOSProductVariant.findMany({where:{productId:product.id,OR:[
      ...(uuid(line.variantId)?[{id:line.variantId}]:[]),{sku:line.variantId},{barcode:line.variantId},
    ]},select:{id:true,sku:true,barcode:true},take:2});
    if (matches.length > 1) throw new Error('PRODUCT_VARIANT_AMBIGUOUS');
    if (matches.length === 1) variants.push(matches[0].id,matches[0].sku,matches[0].barcode);
  }
  // Try all verified variant aliases before the product-wide rule.
  const mapping = await mapped([line.productId,...(product?[product.id]:[])],[...variants,'']);
  if (mapping) return mapping;
  if (!product?.category) return null;
  const keys = [product.category.id, ...(product.category.externalCommissionCategoryId == null ? [] : [String(product.category.externalCommissionCategoryId)])];
  const matches=await tx.hrmCommissionSubcategory.findMany({where:{externalId:{in:keys}}});
  return matches.length===1?matches[0]:null;
}
export async function resolveSubcategoryRate(tx: Prisma.TransactionClient, subcategoryId: string, storeId: number, at: Date) {
  const rates = await tx.hrmCommissionRate.findMany({
    where: { subcategoryId, storeKey: { in: [0, storeId] }, effectiveFrom: { lte: at } },
    orderBy: [{ storeKey: 'desc' }, { effectiveFrom: 'desc' }],
  });
  requireValue(rates.length, 'HISTORICAL_OR_CURRENT_RATE_MISSING');
  // A disabled latest version must not revive an older/global rate.
  requireValue(rates[0].isActive, 'SUBCATEGORY_RATE_INACTIVE');
  return rates[0];
}
